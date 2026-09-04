import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  acpPromptResultEnvelope,
  acpPromptStartEnvelope,
  acpRpcResultEnvelope,
  createAcpPromptInvocation,
  resolveAcpAuthMethodId,
  runAcpTurn,
  shouldSuppressAcpNotification,
  type AcpConnection,
  type AcpConnectionHandlers,
  type AcpConnectionInput,
  type AcpProviderProfile,
  type AcpRunnerIo,
} from "./acp-runner";
import {
  acpSessionMeta,
  buildAcpPromptParts,
  shouldAutoApprovePermission,
  shouldDenyPermission,
} from "./acp-runner-lib";
import type {
  SidecarApprovalInput,
  SidecarProviderEventInput,
  SidecarResultInput,
} from "./sidecar-protocol";
import type { RunnerRequest } from "./runner-request";
import { readOnlyStateRootEnvironmentKey } from "./read-only-agent-environment";

const request: RunnerRequest = {
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "test-model",
  approvalPolicy: "on-request",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/usr/local/bin/test-agent",
};

const testProfile: AcpProviderProfile = {
  providerId: "grok",
  providerName: "Test Agent",
  displayName: "Test",
  missingSessionIdMessage: "Test agent did not return a session id.",
  spawn: (input) => ({
    command: input.binary,
    arguments: input.readOnly ? ["acp", "--read-only"] : ["acp"],
  }),
  environment: (environment) => ({ ...environment, TEST_AGENT: "1" }),
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  authMethods: [
    {
      methodId: "test.api_key",
      available: (environment) => Boolean(environment.TEST_API_KEY?.trim()),
    },
    { methodId: "cached_token" },
  ],
  sessionMeta: acpSessionMeta,
  promptParts: buildAcpPromptParts,
  configureSession: async ({ sessionId, call, emitRpc }) => {
    emitRpc(
      "session/set_model",
      { sessionId },
      await call("session/set_model", { sessionId }),
    );
  },
  permissionPolicy: {
    shouldDeny: shouldDenyPermission,
    shouldAutoApprove: shouldAutoApprovePermission,
  },
  serverRequestResponses: { "test/ask": { answers: {} } },
};

type ConnectionCall = { method: string; params: unknown };
type ConnectionResponse = { id: number | string; result: unknown };

function createFakeConnection(
  reply: (method: string, params: unknown) => unknown,
) {
  const calls: ConnectionCall[] = [];
  const responses: ConnectionResponse[] = [];
  const inputs: AcpConnectionInput[] = [];
  let handlers: AcpConnectionHandlers = {};
  let closeCount = 0;
  const connection: AcpConnection = {
    setHandlers: (next) => {
      handlers = next;
    },
    request: (method, params) => {
      calls.push({ method, params });
      return Promise.resolve(reply(method, params));
    },
    respond: (id, result) => {
      responses.push({ id, result });
    },
    close: () => {
      closeCount += 1;
    },
  };
  return {
    calls,
    responses,
    inputs,
    closeCount: () => closeCount,
    connect: (input: AcpConnectionInput) => {
      inputs.push(input);
      return connection;
    },
    notify: (message: Parameters<
      NonNullable<AcpConnectionHandlers["onNotification"]>
    >[0]) => handlers.onNotification?.(message),
    serverRequest: (message: Parameters<
      NonNullable<AcpConnectionHandlers["onServerRequest"]>
    >[0]) => handlers.onServerRequest?.(message),
  };
}

function createFakeIo(
  turnRequest: RunnerRequest,
  approve: (id: string) => Promise<boolean> = () => Promise.resolve(true),
) {
  const events: SidecarProviderEventInput[] = [];
  const approvals: SidecarApprovalInput[] = [];
  const results: SidecarResultInput[] = [];
  const sessions: string[] = [];
  const errors: string[] = [];
  const io: AcpRunnerIo = {
    emit: {
      approval: (input) => {
        approvals.push(input);
      },
      error: (message) => {
        errors.push(message);
      },
      event: (input) => {
        events.push(input);
      },
      result: (input) => {
        results.push(input);
      },
      session: (sessionId) => {
        sessions.push(sessionId);
      },
    },
    request: Promise.resolve(turnRequest),
    waitForApproval: (id) => approve(id),
  };
  return { approvals, errors, events, io, results, sessions };
}

const emptyComputerUse = () =>
  Promise.resolve({ servers: [], cleanup: () => Promise.resolve(undefined) });

const succeedingReply = (method: string) => {
  if (method === "session/new") return { sessionId: "session-1" };
  if (method === "session/load") return { sessionId: "loaded-1" };
  if (method === "session/prompt") return { stopReason: "end_turn" };
  return {};
};

/** A fake agent that raises one permission request while the prompt is open. */
function connectionRequestingPermission(permission: {
  id: string;
  toolName: string;
  options: ReadonlyArray<{ optionId: string; kind: string }>;
}) {
  const connection: ReturnType<typeof createFakeConnection> =
    createFakeConnection((method) => {
      if (method !== "session/prompt") return succeedingReply(method);
      return (async () => {
        await connection.serverRequest({
          id: permission.id,
          method: "session/request_permission",
          params: {
            toolCall: { toolName: permission.toolName, rawInput: {} },
            options: permission.options,
          },
        });
        return { stopReason: "end_turn" };
      })();
    });
  return connection;
}

describe("ACP runner core", () => {
  it("negotiates the first available authentication method", () => {
    expect(resolveAcpAuthMethodId(testProfile, { TEST_API_KEY: "sk" }))
      .toBe("test.api_key");
    expect(resolveAcpAuthMethodId(testProfile, {})).toBe("cached_token");
    expect(() =>
      resolveAcpAuthMethodId(
        {
          ...testProfile,
          authMethods: [{ methodId: "never", available: () => false }],
        },
        {},
      )
    ).toThrow("No Test authentication method is available.");
  });

  it("suppresses load replay and _meta.isReplay notifications", () => {
    const live = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "session-1" },
    };
    expect(shouldSuppressAcpNotification(live, true)).toBe(true);
    expect(shouldSuppressAcpNotification(live, false)).toBe(false);
    expect(
      shouldSuppressAcpNotification(
        { ...live, params: { _meta: { isReplay: true } } },
        false,
      ),
    ).toBe(true);
  });

  it("keeps the prompt payload out of the replayed RPC envelopes", () => {
    const invocation = createAcpPromptInvocation(
      "session-1",
      [{ type: "image", data: "large-sensitive-base64" }],
      () => "prompt-1",
    );
    expect(invocation.params).toHaveProperty("prompt");
    expect(acpPromptStartEnvelope(invocation)).toEqual({
      jsonrpc: "2.0",
      method: "briar/session/prompt_start",
      params: {
        sessionId: "session-1",
        messageId: "prompt-1",
        _meta: { promptId: "prompt-1", requestId: "prompt-1" },
      },
    });
    const envelope = acpPromptResultEnvelope(invocation, {
      stopReason: "end_turn",
    });
    expect(envelope.params).not.toHaveProperty("prompt");
    expect(envelope.result).toEqual({ stopReason: "end_turn" });
    expect(acpRpcResultEnvelope("session/set_model", { a: 1 }, undefined))
      .toEqual({
        jsonrpc: "2.0",
        method: "session/set_model",
        params: { a: 1 },
        result: null,
      });
  });

  it("spawns, initializes, creates a session, and resolves the final message", async () => {
    const connection = createFakeConnection(succeedingReply);
    const { events, io, results, sessions } = createFakeIo(request);

    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      allocatePromptId: () => "prompt-1",
      environment: { TEST_API_KEY: "sk", HOME: "/home" },
    });

    expect(connection.inputs).toEqual([{
      providerName: "Test Agent",
      command: "/usr/local/bin/test-agent",
      arguments: ["acp"],
      cwd: "/repo",
      environment: { TEST_API_KEY: "sk", HOME: "/home", TEST_AGENT: "1" },
    }]);
    expect(connection.calls.map((call) => call.method)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "session/set_model",
      "session/prompt",
    ]);
    expect(connection.calls[0]?.params).toEqual({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: "briar-desktop", version: "0.0.0" },
    });
    expect(connection.calls[1]?.params).toEqual({ methodId: "test.api_key" });
    expect(connection.calls[2]?.params).toEqual({
      cwd: "/repo",
      mcpServers: [],
    });
    expect(connection.calls[4]?.params).toEqual({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "Inspect the repository" }],
      messageId: "prompt-1",
      _meta: { promptId: "prompt-1", requestId: "prompt-1" },
    });
    expect(sessions).toEqual(["session-1"]);
    expect(results).toEqual([{
      sessionId: "session-1",
      message: "(empty response)",
    }]);
    expect(events.map((event) => event.raw)).toContainEqual(
      acpPromptStartEnvelope(
        createAcpPromptInvocation("session-1", [], () => "prompt-1"),
      ),
    );
    expect(connection.closeCount()).toBe(1);
  });

  it("resumes an existing conversation with session/load and its session rules", async () => {
    const connection = createFakeConnection(succeedingReply);
    const { events, io, sessions } = createFakeIo({
      ...request,
      conversationId: "  prior-session  ",
      instructions: "Follow the workflow skill.",
      sandboxMode: "readOnly",
    });

    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      allocatePromptId: () => "prompt-1",
      // The worker path already isolated this turn, so the marker keeps the
      // runner from preparing a second read-only state root.
      environment: { [readOnlyStateRootEnvironmentKey]: "/isolated" },
    });

    expect(connection.inputs[0]?.arguments).toEqual(["acp", "--read-only"]);
    expect(connection.inputs[0]?.environment).toEqual({
      [readOnlyStateRootEnvironmentKey]: "/isolated",
      TEST_AGENT: "1",
    });
    expect(connection.calls.map((call) => call.method)).toEqual([
      "initialize",
      "authenticate",
      "session/load",
      "session/set_model",
      "session/prompt",
    ]);
    expect(connection.calls[1]?.params).toEqual({ methodId: "cached_token" });
    expect(connection.calls[2]?.params).toEqual({
      sessionId: "prior-session",
      cwd: "/repo",
      mcpServers: [],
      _meta: { rules: "Follow the workflow skill." },
    });
    expect(sessions).toEqual(["loaded-1"]);
    expect(events.map((event) => event.raw)).toContainEqual(
      acpRpcResultEnvelope(
        "session/load",
        {
          sessionId: "prior-session",
          cwd: "/repo",
          mcpServers: [],
          _meta: { rules: "Follow the workflow skill." },
        },
        { sessionId: "loaded-1" },
      ),
    );
  });

  it("isolates provider state for a read-only turn and removes it afterwards", async () => {
    const connection = createFakeConnection(succeedingReply);
    const { io } = createFakeIo({ ...request, sandboxMode: "readOnly" });

    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      allocatePromptId: () => "prompt-1",
      environment: {
        HOME: "/Users/worker",
        XAI_API_KEY: "xai-secret",
        BRIAR_WORKER_TOKEN: "worker-secret",
      },
    });

    const spawned = connection.inputs[0]?.environment ?? {};
    const stateRoot = spawned[readOnlyStateRootEnvironmentKey];
    expect(stateRoot).toBeTruthy();
    // The seatbelt state root, the Grok isolation guard, and OpenCode's
    // recursive `$TMPDIR` creation all have to live under the isolated root.
    expect(spawned.HOME).toBe(stateRoot);
    expect(spawned.GROK_HOME).toBe(stateRoot);
    expect(spawned.TMPDIR).toBe(stateRoot);
    expect(spawned.TMP).toBe(stateRoot);
    expect(spawned.TEMP).toBe(stateRoot);
    expect(spawned.XAI_API_KEY).toBe("xai-secret");
    expect(spawned.BRIAR_WORKER_TOKEN).toBeUndefined();
    await expect(access(stateRoot!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves a workspace-write turn on the inherited environment", async () => {
    const connection = createFakeConnection(succeedingReply);
    const { io } = createFakeIo(request);

    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      allocatePromptId: () => "prompt-1",
      environment: { HOME: "/Users/worker", BRIAR_WORKER_TOKEN: "worker-secret" },
    });

    expect(connection.inputs[0]?.environment).toEqual({
      HOME: "/Users/worker",
      BRIAR_WORKER_TOKEN: "worker-secret",
      TEST_AGENT: "1",
    });
  });

  it("suppresses session updates replayed while session/load is pending", async () => {
    const chunk = (text: string) => ({
      method: "session/update",
      params: {
        sessionId: "loaded-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    });
    const connection = createFakeConnection((method) => {
      if (method === "session/load") {
        // The agent replays history before the load result resolves.
        void connection.notify(chunk("replayed"));
        return { sessionId: "loaded-1" };
      }
      if (method === "session/prompt") {
        void connection.notify(chunk("live"));
        void connection.notify({
          ...chunk("also replayed"),
          params: { ...chunk("also replayed").params, _meta: { isReplay: true } },
        });
        return { stopReason: "end_turn" };
      }
      return succeedingReply(method);
    });
    const { io, results } = createFakeIo({
      ...request,
      conversationId: "prior-session",
    });

    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      allocatePromptId: () => "prompt-1",
      environment: {},
    });

    expect(results).toEqual([{ sessionId: "loaded-1", message: "live" }]);
  });

  it("round trips a permission request through the sidecar approval channel", async () => {
    const permission = (optionPrefix: string) => ({
      id: optionPrefix,
      method: "session/request_permission",
      params: {
        toolCall: {
          toolName: "write_file",
          title: "Write config",
          rawInput: { path: "config.json", reason: "Write config" },
        },
        options: [
          { optionId: `${optionPrefix}-allow`, kind: "allow_once" },
          { optionId: `${optionPrefix}-reject`, kind: "reject_once" },
        ],
      },
    });
    const connection = createFakeConnection((method) => {
      if (method !== "session/prompt") return succeedingReply(method);
      // Permission requests arrive while session/prompt is in flight.
      return (async () => {
        await connection.serverRequest(permission("a"));
        await connection.serverRequest(permission("b"));
        await connection.serverRequest({
          id: "c",
          method: "test/ask",
          params: {},
        });
        await connection.serverRequest({
          id: "d",
          method: "unknown",
          params: {},
        });
        await connection.serverRequest({ method: "no-id", params: {} });
        return { stopReason: "end_turn" };
      })();
    });
    const requested: string[] = [];
    const { approvals, io } = createFakeIo(request, (id) => {
      requested.push(id);
      return Promise.resolve(id === "1");
    });

    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      allocatePromptId: () => "prompt-1",
      environment: {},
    });

    expect(requested).toEqual(["1", "2"]);
    expect(approvals).toEqual([
      {
        id: "1",
        toolName: "write_file",
        input: { path: "config.json", reason: "Write config" },
        title: "Write config",
      },
      {
        id: "2",
        toolName: "write_file",
        input: { path: "config.json", reason: "Write config" },
        title: "Write config",
      },
    ]);
    expect(connection.responses).toEqual([
      { id: "a", result: { outcome: { outcome: "selected", optionId: "a-allow" } } },
      { id: "b", result: { outcome: { outcome: "selected", optionId: "b-reject" } } },
      { id: "c", result: { answers: {} } },
      { id: "d", result: {} },
    ]);
  });

  it("auto-approves and denies without reaching the approval channel", async () => {
    const mustNotPrompt = () => Promise.reject(new Error("must not prompt"));
    const allowing = connectionRequestingPermission({
      id: "auto",
      toolName: "write_file",
      options: [{ optionId: "auto-allow", kind: "allow_once" }],
    });
    const allowed = createFakeIo(
      { ...request, approvalPolicy: "never" },
      mustNotPrompt,
    );
    await runAcpTurn(testProfile, allowed.io, {
      connect: allowing.connect,
      prepareComputerUse: emptyComputerUse,
      environment: {},
    });

    const denying = connectionRequestingPermission({
      id: "deny",
      toolName: "web_search",
      options: [{ optionId: "deny-reject", kind: "reject_once" }],
    });
    const denied = createFakeIo(
      { ...request, networkAccess: false, approvalPolicy: "never" },
      mustNotPrompt,
    );
    await runAcpTurn(testProfile, denied.io, {
      connect: denying.connect,
      prepareComputerUse: emptyComputerUse,
      environment: {},
    });

    expect(allowed.approvals).toEqual([]);
    expect(allowing.responses).toEqual([{
      id: "auto",
      result: { outcome: { outcome: "selected", optionId: "auto-allow" } },
    }]);
    expect(denied.approvals).toEqual([]);
    expect(denying.responses).toEqual([{
      id: "deny",
      result: { outcome: { outcome: "selected", optionId: "deny-reject" } },
    }]);
  });

  it("cancels the pending approval when the sidecar channel closes", async () => {
    const connection = connectionRequestingPermission({
      id: "cancelled",
      toolName: "write_file",
      options: [
        { optionId: "allow", kind: "allow_once" },
        { optionId: "reject", kind: "reject_once" },
      ],
    });
    // createRunnerIo settles every pending approval as `false` once the parent
    // closes the channel, so a cancelled turn must select the reject option.
    const { approvals, io } = createFakeIo(request, () =>
      Promise.resolve(false));
    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      environment: {},
    });
    expect(approvals).toHaveLength(1);
    expect(connection.responses).toEqual([{
      id: "cancelled",
      result: { outcome: { outcome: "selected", optionId: "reject" } },
    }]);
  });

  it("resolves the streamed assistant text and honours the output schema", async () => {
    const connection = createFakeConnection((method) => {
      if (method === "session/prompt") {
        void connection.notify({
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: 'Done.\n```json\n{"ok":true}\n```',
              },
            },
          },
        });
        return { stopReason: "end_turn" };
      }
      return succeedingReply(method);
    });
    const { io, results } = createFakeIo({
      ...request,
      outputSchema: { type: "object" },
    });

    await runAcpTurn(testProfile, io, {
      connect: connection.connect,
      prepareComputerUse: emptyComputerUse,
      allocatePromptId: () => "prompt-1",
      environment: {},
    });

    expect(results).toEqual([{
      sessionId: "session-1",
      message: '{"ok":true}',
    }]);
  });

  it("fails the turn on a missing session id or an unsuccessful stop reason", async () => {
    const withoutSession = createFakeConnection((method) =>
      method === "session/new" ? {} : succeedingReply(method)
    );
    const missing = createFakeIo(request);
    await expect(
      runAcpTurn(testProfile, missing.io, {
        connect: withoutSession.connect,
        prepareComputerUse: emptyComputerUse,
        environment: {},
      }),
    ).rejects.toThrow("Test agent did not return a session id.");
    expect(withoutSession.closeCount()).toBe(1);

    const refused = createFakeConnection((method) =>
      method === "session/prompt"
        ? { stopReason: "max_tokens" }
        : succeedingReply(method)
    );
    const stopped = createFakeIo(request);
    await expect(
      runAcpTurn(testProfile, stopped.io, {
        connect: refused.connect,
        prepareComputerUse: emptyComputerUse,
        environment: {},
      }),
    ).rejects.toThrow(
      "Test turn did not complete successfully (stop reason: max_tokens).",
    );

    const silent = createFakeConnection((method) =>
      method === "session/prompt" ? undefined : succeedingReply(method)
    );
    await expect(
      runAcpTurn(testProfile, createFakeIo(request).io, {
        connect: silent.connect,
        prepareComputerUse: emptyComputerUse,
        environment: {},
      }),
    ).rejects.toThrow(
      "Test turn did not complete successfully (stop reason: missing).",
    );
  });

  it("rejects an empty message before spawning the agent", async () => {
    const connection = createFakeConnection(succeedingReply);
    await expect(
      runAcpTurn(testProfile, createFakeIo({ ...request, message: "  " }).io, {
        connect: connection.connect,
        prepareComputerUse: emptyComputerUse,
        environment: {},
      }),
    ).rejects.toThrow("LLM에 보낼 메시지를 입력하세요.");
    expect(connection.inputs).toEqual([]);
  });

  it("closes the connection and cleans up computer-use MCP on every exit", async () => {
    let cleanups = 0;
    const connection = createFakeConnection(succeedingReply);
    await runAcpTurn(testProfile, createFakeIo(request).io, {
      connect: connection.connect,
      prepareComputerUse: () =>
        Promise.resolve({
          servers: [],
          cleanup: () => {
            cleanups += 1;
            return Promise.resolve(undefined);
          },
        }),
      allocatePromptId: () => "prompt-1",
      environment: {},
    });
    expect(cleanups).toBe(1);
    expect(connection.closeCount()).toBe(1);
  });
});
