import { randomUUID } from "node:crypto";
import {
  AcpJsonRpcConnection,
  AcpRpcError,
  type AcpJsonRpcMessage,
} from "./acp-json-rpc";
import {
  acpStopReasonSucceeded,
  createAcpEventState,
  finalizeAcpMessage,
  normalizeAcpSessionUpdate,
  permissionDecisionResult,
  permissionInput,
  permissionOptions,
  permissionToolName,
  resolveAcpFinalMessage,
  type AcpPromptPart,
} from "./acp-runner-lib";
import {
  prepareComputerUseMcp,
  type PreparedComputerUseMcp,
} from "./computer-use-mcp-config";
import { acpComputerUseServers } from "./computer-use-provider-adapters";
import { createRunnerIo } from "./runner-io";
import type { RunnerRequest } from "./runner-request";
import {
  ProviderBlockedError,
  classifyProviderFailure,
  providerBlockFromError,
  type ProviderBlock,
} from "./provider-block";
import { ensureReadOnlyAgentEnvironment } from "./read-only-agent-environment";
import type { AgentProvider } from "../src/lib/agent-provider";

/**
 * Shared Agent Client Protocol runner core.
 *
 * Every ACP agent speaks the same lifecycle over newline-delimited JSON-RPC:
 * `initialize` → `authenticate` → `session/new` or `session/load` → optional
 * per-session configuration → `session/prompt`, with `session/update`
 * notifications and `session/request_permission` server requests in between.
 * `runAcpProvider` owns that lifecycle, the approval round trip, computer-use
 * MCP wiring, and the sidecar frames; the agents differ only in the values an
 * {@link AcpProviderProfile} carries.
 *
 * ## Adding a new ACP provider
 *
 * 1. Create `src-agent/<provider>-runner.ts` and build an
 *    {@link AcpProviderProfile}:
 *    - `providerName` / `displayName` / `missingSessionIdMessage` supply the
 *      transport label and the two lifecycle error strings;
 *    - `spawn` returns the command and arguments, routing read-only turns
 *      through `readOnlySeatbeltSpawnSpec` with the agent's own state root and
 *      denied path patterns;
 *    - `environment` adds any process environment the agent needs;
 *    - `clientCapabilities` declares what Briar exposes back to the agent;
 *    - `authMethods` lists the `authenticate` method ids in priority order,
 *      each optionally gated on the process environment;
 *    - `sessionMeta`, `promptParts`, and `configureSession` map the Briar
 *      request onto the agent's session, model, and effort controls;
 *    - `permissionPolicy` normally reuses `shouldDenyPermission` and
 *      `shouldAutoApprovePermission` from `acp-runner-lib`;
 *    - `serverRequestResponses` answers any agent-specific server request.
 * 2. Export `run<Provider>Runner = () => runAcpProvider(profile)` and call it
 *    from `import.meta.main`.
 * 3. Add the entry to `agent:build` in `apps/briar/package.json`, the Tauri
 *    resource list, and the Rust provider config.
 *
 * Nothing in this file may branch on the provider: a new difference belongs in
 * the profile, not in a conditional here.
 */

export type AcpSpawnSpec = {
  readonly command: string;
  readonly arguments: string[];
};

export type AcpSpawnInput = {
  readonly binary: string;
  readonly workspaceRoot: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly readOnly: boolean;
};

/** Client capabilities advertised to the agent during `initialize`. */
export type AcpClientCapabilities = {
  readonly fs: {
    readonly readTextFile: boolean;
    readonly writeTextFile: boolean;
  };
  readonly terminal?: boolean;
  readonly _meta?: Readonly<Record<string, boolean>>;
};

/**
 * One `authenticate` method id. The first method whose `available` predicate
 * passes wins, so the fallback is the last entry without a predicate.
 */
export type AcpAuthMethod = {
  readonly methodId: string;
  readonly available?: (environment: NodeJS.ProcessEnv) => boolean;
};

/** Trusted Briar instructions carried as ACP session rules. */
export type AcpSessionMeta = { readonly rules: string };

export type AcpPermissionPolicy = {
  readonly shouldDeny: (
    request: RunnerRequest,
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<boolean>;
  readonly shouldAutoApprove: (request: RunnerRequest) => boolean;
};

/**
 * Model and effort selection, run after the session exists and before the
 * prompt. `setup` is the raw `session/new` or `session/load` result, which
 * agents use to discover their own config option ids.
 */
export type AcpSessionConfiguration = {
  readonly request: RunnerRequest;
  readonly sessionId: string;
  readonly setup: unknown;
  readonly call: (method: string, params: unknown) => Promise<unknown>;
  readonly emitRpc: (
    method: string,
    params: unknown,
    result: unknown,
  ) => void;
};

export type AcpProviderProfile = {
  /**
   * Briar provider id carried on blocks ("grok", "cursor"). It also selects
   * the read-only isolation profile for the turn.
   */
  readonly providerId: AgentProvider;
  /** Transport label, used in process lifecycle errors ("Grok Agent"). */
  readonly providerName: string;
  /** Short label for the runner close and turn failure errors ("Grok"). */
  readonly displayName: string;
  /**
   * Exact message emitted when `session/new` returns no session id. Kept as a
   * literal because the installed agents capitalize themselves differently.
   */
  readonly missingSessionIdMessage: string;
  readonly spawn: (input: AcpSpawnInput) => AcpSpawnSpec;
  readonly environment: (
    environment: NodeJS.ProcessEnv,
    readOnly: boolean,
  ) => NodeJS.ProcessEnv;
  readonly clientCapabilities: AcpClientCapabilities;
  readonly authMethods: ReadonlyArray<AcpAuthMethod>;
  readonly sessionMeta: (request: RunnerRequest) => AcpSessionMeta | undefined;
  readonly promptParts: (
    request: RunnerRequest,
  ) => Promise<ReadonlyArray<AcpPromptPart>>;
  readonly configureSession: (
    configuration: AcpSessionConfiguration,
  ) => Promise<void>;
  readonly permissionPolicy: AcpPermissionPolicy;
  /** Agent-specific server requests answered without an approval prompt. */
  readonly serverRequestResponses?: Readonly<Record<string, unknown>>;
};

export type AcpConnectionHandlers = {
  onNotification?: (message: AcpJsonRpcMessage) => void | Promise<void>;
  onServerRequest?: (message: AcpJsonRpcMessage) => void | Promise<void>;
};

export type AcpConnectionInput = {
  providerName: string;
  command: string;
  arguments: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
};

/** The transport surface the lifecycle needs; `AcpJsonRpcConnection` implements it. */
export type AcpConnection = {
  setHandlers(handlers: AcpConnectionHandlers): void;
  request(method: string, params?: unknown): Promise<unknown>;
  respond(id: number | string, result: unknown): void;
  close(): void;
};

type RunnerIo = ReturnType<typeof createRunnerIo>;

/** The sidecar channel slice the ACP lifecycle uses. */
export type AcpRunnerIo = {
  readonly emit: Pick<
    RunnerIo["emit"],
    "approval" | "error" | "event" | "result" | "session"
  >;
  readonly request: Promise<RunnerRequest>;
  readonly waitForApproval: RunnerIo["waitForApproval"];
};

/** Seams the lifecycle tests drive; production runs every default. */
export type AcpRunnerOverrides = {
  readonly connect?: (input: AcpConnectionInput) => AcpConnection;
  readonly prepareComputerUse?: (
    request: RunnerRequest,
  ) => Promise<PreparedComputerUseMcp>;
  readonly allocatePromptId?: () => string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly prepareEnvironment?: typeof ensureReadOnlyAgentEnvironment;
};

type AcpSessionSetup = { sessionId?: string };

type AcpPromptResult = { stopReason?: string; text?: string };

export function acpRpcResultEnvelope(
  method: string,
  params: unknown,
  result: unknown,
) {
  return {
    jsonrpc: "2.0" as const,
    method,
    ...(params === undefined ? {} : { params }),
    result: result ?? null,
  };
}

export function createAcpPromptInvocation(
  sessionId: string,
  prompt: unknown,
  allocateId: () => string = randomUUID,
) {
  const promptId = allocateId();
  return {
    promptId,
    params: {
      sessionId,
      prompt,
      messageId: promptId,
      _meta: {
        promptId,
        requestId: promptId,
      },
    },
  };
}

export function acpPromptResultEnvelope(
  invocation: ReturnType<typeof createAcpPromptInvocation>,
  result: unknown,
) {
  const { sessionId, messageId, _meta } = invocation.params;
  return acpRpcResultEnvelope(
    "session/prompt",
    { sessionId, messageId, _meta },
    result,
  );
}

export function acpPromptStartEnvelope(
  invocation: ReturnType<typeof createAcpPromptInvocation>,
) {
  const { sessionId, messageId, _meta } = invocation.params;
  return {
    jsonrpc: "2.0" as const,
    method: "briar/session/prompt_start",
    params: { sessionId, messageId, _meta },
  };
}

function hasReplayMeta(message: AcpJsonRpcMessage): boolean {
  if (!message.params || typeof message.params !== "object") return false;
  const meta = (message.params as Record<string, unknown>)._meta;
  return Boolean(
    meta &&
      typeof meta === "object" &&
      (meta as Record<string, unknown>).isReplay === true,
  );
}

/**
 * ACP agents replay both standard and private notifications while
 * `session/load` is pending. Once loading ends, private completion
 * notifications remain visible so a live turn can still be correlated.
 */
export function shouldSuppressAcpNotification(
  message: AcpJsonRpcMessage,
  sessionLoadInProgress: boolean,
): boolean {
  if (hasReplayMeta(message)) return true;
  return sessionLoadInProgress;
}

export function resolveAcpAuthMethodId(
  profile: AcpProviderProfile,
  environment: NodeJS.ProcessEnv,
): string {
  const selected = profile.authMethods.find(
    (method) => method.available?.(environment) ?? true,
  );
  if (!selected) {
    throw new Error(
      `No ${profile.displayName} authentication method is available.`,
    );
  }
  return selected.methodId;
}

export async function runAcpTurn(
  profile: AcpProviderProfile,
  io: AcpRunnerIo,
  overrides: AcpRunnerOverrides = {},
): Promise<void> {
  const { emit, waitForApproval } = io;
  const request = await io.request;
  if (!request.message.trim()) {
    throw new Error("LLM에 보낼 메시지를 입력하세요.");
  }

  const readOnly = request.sandboxMode === "readOnly";
  // The desktop sidecar hands the runner the plain process environment, so a
  // read-only turn builds its isolated provider home here: the seatbelt state
  // root and the profile's own isolation guard both read it back off `environment`.
  const isolation = await (
    overrides.prepareEnvironment ?? ensureReadOnlyAgentEnvironment
  )(profile.providerId, {
    readOnly,
    workspaceRoot: request.workspaceRoot,
    environment: overrides.environment ?? process.env,
  });
  const environment = isolation.environment;
  const computerUseMcp = await (
    overrides.prepareComputerUse ?? prepareComputerUseMcp
  )(request);
  const spawnSpec = profile.spawn({
    binary: request.providerBinaryPath,
    workspaceRoot: request.workspaceRoot,
    environment,
    readOnly,
  });
  const connect = overrides.connect ??
    ((input: AcpConnectionInput) => new AcpJsonRpcConnection(input));
  const connection = connect({
    providerName: profile.providerName,
    command: spawnSpec.command,
    arguments: spawnSpec.arguments,
    cwd: request.workspaceRoot,
    environment: profile.environment(environment, readOnly),
  });
  const state = createAcpEventState();
  let approvalSequence = 0;
  let sessionLoadInProgress = false;

  try {
    connection.setHandlers({
      onNotification: (rpc) => {
        if (shouldSuppressAcpNotification(rpc, sessionLoadInProgress)) return;
        if (rpc.method !== "session/update") {
          emit.event({ raw: rpc });
          return;
        }
        const normalized = normalizeAcpSessionUpdate(rpc.params, state);
        if (normalized.events.length === 0) {
          emit.event({ raw: normalized.raw });
          return;
        }
        for (const event of normalized.events) {
          emit.event({ raw: normalized.raw, event });
        }
      },
      onServerRequest: async (rpc) => {
        if (rpc.id === undefined || rpc.id === null) return;
        if (rpc.method !== "session/request_permission") {
          const configured = rpc.method === undefined
            ? undefined
            : profile.serverRequestResponses?.[rpc.method];
          connection.respond(rpc.id, configured ?? {});
          return;
        }

        const toolName = permissionToolName(rpc.params);
        const input = permissionInput(rpc.params);
        const options = permissionOptions(rpc.params);
        if (await profile.permissionPolicy.shouldDeny(request, toolName, input)) {
          connection.respond(rpc.id, permissionDecisionResult(options, false));
          return;
        }
        if (profile.permissionPolicy.shouldAutoApprove(request)) {
          connection.respond(rpc.id, permissionDecisionResult(options, true));
          return;
        }

        const id = String(++approvalSequence);
        emit.approval({
          id,
          toolName,
          input,
          ...(typeof input.reason === "string" ? { title: input.reason } : {}),
        });
        connection.respond(
          rpc.id,
          permissionDecisionResult(options, await waitForApproval(id)),
        );
      },
    });

    await connection.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: profile.clientCapabilities,
      clientInfo: { name: "briar-desktop", version: "0.0.0" },
    });
    await connection.request("authenticate", {
      methodId: resolveAcpAuthMethodId(profile, environment),
    });

    const sessionMeta = profile.sessionMeta(request);
    const mcpServers = acpComputerUseServers(computerUseMcp.servers);
    const resumeId = request.conversationId?.trim();
    let setup: AcpSessionSetup | undefined;
    let sessionId: string;
    if (resumeId) {
      const params = {
        sessionId: resumeId,
        cwd: request.workspaceRoot,
        mcpServers,
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
      sessionLoadInProgress = true;
      try {
        setup = await connection.request(
          "session/load",
          params,
        ) as AcpSessionSetup;
      } finally {
        sessionLoadInProgress = false;
      }
      emit.event({ raw: acpRpcResultEnvelope("session/load", params, setup) });
      sessionId = setup?.sessionId?.trim() || resumeId;
    } else {
      const params = {
        cwd: request.workspaceRoot,
        mcpServers,
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
      setup = await connection.request(
        "session/new",
        params,
      ) as AcpSessionSetup;
      emit.event({ raw: acpRpcResultEnvelope("session/new", params, setup) });
      sessionId = setup?.sessionId?.trim() || "";
      if (!sessionId) throw new Error(profile.missingSessionIdMessage);
    }
    emit.session(sessionId);

    await profile.configureSession({
      request,
      sessionId,
      setup,
      call: (method, params) => connection.request(method, params),
      emitRpc: (method, params, result) =>
        emit.event({ raw: acpRpcResultEnvelope(method, params, result) }),
    });

    const invocation = createAcpPromptInvocation(
      sessionId,
      await profile.promptParts(request),
      overrides.allocatePromptId,
    );
    emit.event({ raw: acpPromptStartEnvelope(invocation) });
    const promptResult = await connection.request(
      "session/prompt",
      invocation.params,
    ) as AcpPromptResult | undefined;
    emit.event({ raw: acpPromptResultEnvelope(invocation, promptResult) });

    for (const event of finalizeAcpMessage(state, promptResult?.stopReason)) {
      emit.event({ raw: { type: "turn", event }, event });
    }
    if (!acpStopReasonSucceeded(promptResult?.stopReason)) {
      throw new Error(
        `${profile.displayName} turn did not complete successfully (stop reason: ${
          promptResult?.stopReason?.trim() || "missing"
        }).`,
      );
    }

    const finalMessage = resolveAcpFinalMessage(
      state,
      typeof promptResult?.text === "string" ? promptResult.text : undefined,
      request.outputSchema,
    );
    emit.result({
      sessionId,
      message: finalMessage || "(empty response)",
    });
  } finally {
    connection.close();
    await computerUseMcp.cleanup();
    await isolation.cleanup();
  }
}

/**
 * Classify an ACP lifecycle failure. JSON-RPC errors keep their `code` and
 * `data`, where agents put HTTP statuses and provider error tags; anything
 * else is judged by its text. Null means the turn simply failed.
 */
/**
 * ACP's reserved JSON-RPC code for "authenticate before this request".
 *
 * It sits in the generic server-error range that agents also use for their own
 * failures, so the code alone does not identify an auth error; it counts only
 * alongside the `authMethods` list `RequestError.authRequired` carries.
 */
export const ACP_AUTH_REQUIRED_CODE = -32000;

export function acpFailureBlock(
  profile: Pick<AcpProviderProfile, "providerId">,
  error: unknown,
): ProviderBlock | null {
  if (error instanceof ProviderBlockedError) return error.block;
  if (error instanceof AcpRpcError) {
    const data = error.data && typeof error.data === "object"
      ? (error.data as Record<string, unknown>)
      : null;
    const dataCode = data
      ? ["code", "type", "error", "reason"]
        .map((key) => data[key])
        .find((value): value is string => typeof value === "string" && value.trim() !== "")
      : undefined;
    const dataStatus = data
      ? ["status", "statusCode", "httpStatus"]
        .map((key) => Number(data[key]))
        .find((value) => Number.isInteger(value) && value > 0)
      : undefined;
    return classifyProviderFailure({
      provider: profile.providerId,
      message: [error.message, typeof error.data === "string" ? error.data : null]
        .filter(Boolean)
        .join(" "),
      // An agent that raises ACP's authenticate-first error carries its auth
      // methods in `data` and no error tag of its own, so this pairing is
      // what makes the turn a sign-in block rather than the wording the agent
      // happened to choose. The code alone is not enough: agents also report
      // rate limits under it.
      code: dataCode ??
        (error.code === ACP_AUTH_REQUIRED_CODE &&
            Array.isArray(data?.authMethods)
          ? "auth_required"
          : undefined),
      statusCode: dataStatus ?? null,
    });
  }
  return providerBlockFromError(profile.providerId, error);
}

export async function runAcpProvider(
  profile: AcpProviderProfile,
  overrides: AcpRunnerOverrides = {},
) {
  const runnerIo = createRunnerIo({
    closeError: `Briar closed the ${profile.displayName} runner input.`,
  });
  try {
    await runAcpTurn(profile, runnerIo, overrides);
  } catch (caught) {
    const block = acpFailureBlock(profile, caught);
    if (block) {
      runnerIo.emit.blocked(block);
      return;
    }
    runnerIo.emit.error(
      caught instanceof Error ? caught.message : String(caught),
    );
    process.exitCode = 1;
  } finally {
    runnerIo.close();
  }
}
