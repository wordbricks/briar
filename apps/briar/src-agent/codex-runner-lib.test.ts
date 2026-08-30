import { describe, expect, it } from "vitest";
import {
  codexAppServerArgs,
  codexAppsInstalledRequest,
  codexApprovalRequest,
  codexConfigReadRequest,
  codexFinalMessage,
  codexInitializeRequest,
  codexModelListRequest,
  codexServerRequestResponse,
  codexThreadRequest,
  codexTurnRequest,
  consumeCodexAppServerMessage,
  createCodexAppServerState,
  normalizeCodexAppServerMessage,
} from "./codex-runner-lib";
import type { RunnerRequest } from "./runner-request";

const request: RunnerRequest = {
  message: "Inspect the repository",
  workspaceRoot: "/worktree",
  instructions: "Use the Briar workflow.",
  model: "gpt-5",
  effort: "high",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/usr/local/bin/codex",
};

describe("Codex App Server runner", () => {
  it("uses the desktop App Server command and sandbox requests", () => {
    expect(codexAppServerArgs(request)).toEqual([
      "app-server",
      "--listen",
      "stdio://",
      "--config",
      "sandbox_workspace_write.network_access=true",
    ]);
    expect(codexAppServerArgs({ networkAccess: false })).toEqual([
      "app-server",
      "--listen",
      "stdio://",
    ]);
    expect(codexAppServerArgs({ networkAccess: true }, "aside")).toEqual([
      "app-server",
      "--listen",
      "stdio://",
      "--config",
      'mcp_servers.aside.command="aside"',
      "--config",
      'mcp_servers.aside.args=["mcp"]',
      "--config",
      "sandbox_workspace_write.network_access=true",
    ]);
    expect(
      codexAppServerArgs({ networkAccess: false, externalTools: false }),
    ).toEqual([
      "app-server",
      "--listen",
      "stdio://",
      "--strict-config",
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "--config",
      "mcp_servers={}",
      "--config",
      "shell_environment_policy.inherit=core",
      "--config",
      'web_search="disabled"',
      "--config",
      "project_doc_max_bytes=0",
      "--config",
      "skills.include_instructions=false",
      "--config",
      'default_permissions="briar_read_only"',
      "--config",
      'permissions.briar_read_only={filesystem={":minimal"="read",":workspace_roots"={"."="read"}},network={enabled=false}}',
    ]);
    expect(
      codexAppServerArgs(
        { networkAccess: false, externalTools: false },
        "aside",
      ),
    ).not.toContain('mcp_servers.aside.command="aside"');
    expect(codexInitializeRequest()).toMatchObject({
      method: "initialize",
      id: 1,
      params: { clientInfo: { name: "briar", title: "Briar" } },
    });
    expect(codexThreadRequest(request)).toMatchObject({
      method: "thread/start",
      id: 4,
      params: {
        cwd: "/worktree",
        sandbox: "workspace-write",
        approvalPolicy: "never",
        developerInstructions: "Use the Briar workflow.",
      },
    });
    expect(
      codexThreadRequest(request, {
        mcpServers: ["figma.v1"],
        apps: ["connector_figma"],
        disableApps: true,
        disablePlugins: true,
      }),
    ).toMatchObject({
      method: "thread/start",
      params: {
        config: {
          features: { apps: false, plugins: false },
          apps: { connector_figma: { enabled: false } },
          mcp_servers: { "figma.v1": { enabled: false } },
        },
      },
    });
    expect(codexTurnRequest(request, "thread-1")).toMatchObject({
      method: "turn/start",
      id: 5,
      params: {
        threadId: "thread-1",
        cwd: "/worktree",
        model: "gpt-5",
        effort: "high",
      },
    });
    expect(codexConfigReadRequest(request)).toEqual({
      method: "config/read",
      id: 2,
      params: { cwd: "/worktree", includeLayers: false },
    });
    expect(codexModelListRequest()).toEqual({
      method: "model/list",
      id: 3,
      params: { includeHidden: false },
    });
  });

  it("maps App Server messages to the shared Agent event contract", () => {
    expect(
      normalizeCodexAppServerMessage({
        method: "item/started",
        params: {
          item: {
            id: "message-1",
            type: "agentMessage",
            phase: "commentary",
            text: "Working",
          },
        },
      }),
    ).toEqual({
      type: "messageStarted",
      id: "message-1",
      phase: "commentary",
      text: "Working",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/agentMessage/delta",
        params: { itemId: "message-1", delta: " more" },
      }),
    ).toEqual({ type: "messageDelta", id: "message-1", delta: " more" });
    expect(
      normalizeCodexAppServerMessage({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      }),
    ).toEqual({ type: "turnCompleted", status: "completed" });
    expect(
      normalizeCodexAppServerMessage({
        method: "mcpServer/startupStatus/updated",
        params: {
          threadId: "thread-1",
          name: "figma",
          status: "failed",
          error: "AuthRequired",
          failureReason: "reauthenticationRequired",
        },
      }),
    ).toEqual({
      type: "activityCompleted",
      id: "mcp-startup:figma",
      kind: "tool",
      title: "figma MCP unavailable",
      text: "AuthRequired",
      status: "failed",
    });
  });

  it("normalizes command activity output and terminal outcomes", () => {
    expect(
      normalizeCodexAppServerMessage({
        method: "item/started",
        params: {
          item: {
            id: "command-1",
            type: "commandExecution",
            command: "bun test",
            status: "inProgress",
            aggregatedOutput: null,
            exitCode: null,
          },
        },
      }),
    ).toEqual({
      type: "activityStarted",
      id: "command-1",
      kind: "command",
      title: "bun test",
      text: "",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/commandExecution/outputDelta",
        params: { itemId: "command-1", delta: "PASS first suite\n" },
      }),
    ).toEqual({
      type: "activityDelta",
      id: "command-1",
      delta: "PASS first suite\n",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/completed",
        params: {
          item: {
            id: "command-1",
            type: "commandExecution",
            command: "bun test",
            status: "completed",
            aggregatedOutput: "PASS first suite\nPASS second suite\n",
            exitCode: 0,
          },
        },
      }),
    ).toEqual({
      type: "activityCompleted",
      id: "command-1",
      kind: "command",
      title: "bun test",
      text: "PASS first suite\nPASS second suite\n",
      status: "completed",
    });

    expect(
      normalizeCodexAppServerMessage({
        method: "item/completed",
        params: {
          item: {
            id: "command-failed",
            type: "commandExecution",
            command: "bun test",
            status: "failed",
            aggregatedOutput: "1 test failed",
            exitCode: 1,
          },
        },
      }),
    ).toMatchObject({
      type: "activityCompleted",
      id: "command-failed",
      text: "1 test failed",
      status: "failed",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/completed",
        params: {
          item: {
            id: "command-declined",
            type: "commandExecution",
            command: "git push",
            status: "declined",
            aggregatedOutput: null,
            exitCode: null,
          },
        },
      }),
    ).toMatchObject({
      type: "activityCompleted",
      id: "command-declined",
      status: "cancelled",
    });
  });

  it("adds local channel images to the same App Server turn as the text", () => {
    const turn = codexTurnRequest(
      {
        ...request,
        attachments: [
          {
            type: "image",
            path: "/worktree/.briar-channel-images/first.png",
            name: "first.png",
            mimeType: "image/png",
          },
          {
            type: "image",
            path: "/worktree/.briar-channel-images/second.jpg",
            name: "second.jpg",
            mimeType: "image/jpeg",
          },
        ],
      },
      "thread-1",
    );

    expect(turn).toMatchObject({
      method: "turn/start",
      params: {
        input: [
          { type: "text", text: "Inspect the repository" },
          {
            type: "localImage",
            path: "/worktree/.briar-channel-images/first.png",
          },
          {
            type: "localImage",
            path: "/worktree/.briar-channel-images/second.jpg",
          },
        ],
      },
    });
  });

  it("reads effective config before starting a thread and turn", () => {
    const state = createCodexAppServerState();
    const defaultRequest = { ...request, model: undefined };
    const initialized = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 1,
      result: {},
    });
    expect(initialized.outgoing.map((message) => message.method)).toEqual([
      "initialized",
      "config/read",
    ]);

    const configured = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 2,
      result: { config: { model: "gpt-5.6-sol" } },
    });
    expect(configured.outgoing).toEqual([codexAppsInstalledRequest()]);

    const apps = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 6,
      result: { apps: [] },
    });
    expect(apps.outgoing[0]).toMatchObject({ method: "thread/start" });

    const thread = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 4,
      result: { thread: { id: "thread-1" } },
    });
    expect(state.threadId).toBe("thread-1");
    expect(thread.outgoing[0]).toMatchObject({
      method: "turn/start",
      params: { threadId: "thread-1" },
    });

    consumeCodexAppServerMessage(state, defaultRequest, {
      id: 5,
      result: { turn: { id: "turn-1" } },
    });
    consumeCodexAppServerMessage(state, defaultRequest, {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "message-1",
          type: "agentMessage",
          phase: "final_answer",
          text: "Done",
        },
      },
    });
    const completed = consumeCodexAppServerMessage(state, defaultRequest, {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    });
    expect(completed.completed).toBe(true);
    expect(codexFinalMessage(state)).toBe("Done");
  });

  it("reads isolation config but skips the model catalog when a model is explicit", () => {
    const state = createCodexAppServerState();
    const initialized = consumeCodexAppServerMessage(state, request, {
      id: 1,
      result: {},
    });
    expect(initialized.outgoing.map((message) => message.method)).toEqual([
      "initialized",
      "config/read",
    ]);

    const configured = consumeCodexAppServerMessage(state, request, {
      id: 2,
      result: {
        config: {
          model: null,
          mcp_servers: { playwright: { enabled: true } },
          plugins: { "figma@openai-curated": { enabled: true } },
        },
      },
    });
    expect(configured.outgoing.map((message) => message.method)).toEqual([
      "app/installed",
    ]);
    expect(state.configuredMcpServers).toEqual(["playwright"]);
    expect(state.configuredPlugins).toEqual(["figma@openai-curated"]);
    const apps = consumeCodexAppServerMessage(state, request, {
      id: 6,
      result: {
        apps: [{ id: "connector_figma", runtimeName: "Figma" }],
      },
    });
    expect(apps.outgoing.map((message) => message.method)).toEqual([
      "thread/start",
    ]);
    expect(state.installedApps).toEqual([
      { id: "connector_figma", name: "Figma" },
    ]);

    const isolatedState = createCodexAppServerState();
    const isolatedRequest = { ...request, externalTools: false };
    consumeCodexAppServerMessage(isolatedState, isolatedRequest, {
      id: 1,
      result: {},
    });
    consumeCodexAppServerMessage(isolatedState, isolatedRequest, {
      id: 2,
      result: {
        config: {
          model: "gpt-5",
          mcp_servers: { playwright: { enabled: true } },
          plugins: { "figma@openai-curated": { enabled: true } },
        },
      },
    });
    const isolatedApps = consumeCodexAppServerMessage(
      isolatedState,
      isolatedRequest,
      {
        id: 6,
        result: {
          apps: [{ id: "connector_figma", runtimeName: "Figma" }],
        },
      },
    );
    expect(isolatedApps.outgoing[0]).toMatchObject({
      method: "thread/start",
      params: {
        config: {
          features: { apps: false, plugins: false },
          apps: { connector_figma: { enabled: false } },
          mcp_servers: { playwright: { enabled: false } },
        },
      },
    });
    expect(isolatedApps.outgoing[0]?.params).not.toHaveProperty("sandbox");
  });

  it("falls back to the provider model catalog when config has no model", () => {
    const state = createCodexAppServerState();
    const defaultRequest = { ...request, model: undefined };
    consumeCodexAppServerMessage(state, defaultRequest, {
      id: 1,
      result: {},
    });
    const config = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 2,
      result: { config: { model: null } },
    });
    expect(config.outgoing).toEqual([codexModelListRequest()]);

    const models = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 3,
      result: {
        data: [{ model: "gpt-5.6-sol", isDefault: true }],
        nextCursor: null,
      },
    });
    expect(models.outgoing).toEqual([codexAppsInstalledRequest()]);
    const apps = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 6,
      result: { apps: [] },
    });
    expect(apps.outgoing[0]).toMatchObject({ method: "thread/start", id: 4 });
  });

  it("keeps running when model-discovery RPCs are unavailable", () => {
    const state = createCodexAppServerState();
    const defaultRequest = { ...request, model: undefined };
    consumeCodexAppServerMessage(state, defaultRequest, {
      id: 1,
      result: {},
    });

    const fallback = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 2,
      error: { code: -32601, message: "Method not found" },
    });

    expect(fallback.outgoing).toEqual([codexAppsInstalledRequest()]);
    const appsFallback = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 6,
      error: { code: -32601, message: "Method not found" },
    });
    expect(appsFallback.outgoing).toEqual([
      codexThreadRequest(defaultRequest),
    ]);
  });

  it("keeps approval handling compatible with the desktop decisions", () => {
    const approval = {
      id: 4,
      method: "item/commandExecution/requestApproval",
      params: { command: "git status" },
    };
    expect(codexApprovalRequest(approval)).toMatchObject({
      id: "codex-4",
      toolName: "item/commandExecution/requestApproval",
      input: { command: "git status" },
    });
    expect(codexServerRequestResponse(approval, true)).toEqual({
      id: 4,
      result: { decision: "accept" },
    });
    expect(codexServerRequestResponse(approval, false)).toEqual({
      id: 4,
      result: { decision: "decline" },
    });
  });

  it("isolates unauthenticated optional Figma and lets an independent task continue", () => {
    const state = createCodexAppServerState();
    consumeCodexAppServerMessage(state, request, { id: 1, result: {} });
    consumeCodexAppServerMessage(state, request, {
      id: 2,
      result: {
        config: {
          model: "gpt-5",
          plugins: { "figma@openai-curated": { enabled: true } },
        },
      },
    });
    consumeCodexAppServerMessage(state, request, {
      id: 6,
      result: {
        apps: [{ id: "connector_figma", runtimeName: "Figma" }],
      },
    });
    consumeCodexAppServerMessage(state, request, {
      id: 4,
      result: { thread: { id: "thread-1" } },
    });
    consumeCodexAppServerMessage(state, request, {
      id: 5,
      result: { turn: { id: "turn-1" } },
    });
    consumeCodexAppServerMessage(state, request, {
      method: "mcpServer/startupStatus/updated",
      params: {
        threadId: "thread-1",
        name: "figma",
        status: "failed",
        error: "transport worker quit with fatal: AuthRequired",
        failureReason: "reauthenticationRequired",
      },
    });

    const failedTurn = consumeCodexAppServerMessage(state, request, {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "failed",
          error: {
            message: "Figma MCP transport worker stopped after AuthRequired",
          },
          items: [],
        },
      },
    });

    expect(failedTurn.mcpFailure).toEqual({
      disposition: "recover",
      message: "Figma MCP transport worker stopped after AuthRequired",
      serverNames: ["figma"],
      isolation: {
        mcpServers: [],
        apps: ["connector_figma"],
        disableApps: false,
        disablePlugins: false,
      },
    });
    expect(
      codexThreadRequest(request, failedTurn.mcpFailure!.isolation),
    ).toMatchObject({
      params: {
        config: { apps: { connector_figma: { enabled: false } } },
      },
    });

    const recovered = createCodexAppServerState();
    recovered.threadId = "thread-1";
    recovered.turnId = "turn-2";
    consumeCodexAppServerMessage(recovered, request, {
      method: "item/completed",
      params: {
        item: {
          id: "message-2",
          type: "agentMessage",
          phase: "final_answer",
          text: "Static checks and review completed without Figma.",
        },
      },
    });
    const completed = consumeCodexAppServerMessage(recovered, request, {
      method: "turn/completed",
      params: {
        turn: { id: "turn-2", status: "completed", items: [] },
      },
    });
    expect(completed.completed).toBe(true);
    expect(codexFinalMessage(recovered)).toContain("completed without Figma");
  });

  it("isolates a configured optional MCP after a connection failure", () => {
    const state = createCodexAppServerState();
    state.configuredMcpServers = ["design.preview"];
    state.threadId = "thread-1";
    state.turnId = "turn-1";
    consumeCodexAppServerMessage(state, request, {
      method: "mcpServer/startupStatus/updated",
      params: {
        name: "design.preview",
        status: "failed",
        error: "connection refused",
        failureReason: null,
      },
    });

    const failedTurn = consumeCodexAppServerMessage(state, request, {
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "failed",
          error: { message: "MCP startup failed" },
          items: [],
        },
      },
    });

    expect(failedTurn.mcpFailure).toMatchObject({
      disposition: "recover",
      serverNames: ["design.preview"],
      isolation: {
        mcpServers: ["design.preview"],
        apps: [],
        disableApps: false,
        disablePlugins: false,
      },
    });
    expect(
      codexThreadRequest(request, failedTurn.mcpFailure!.isolation),
    ).toMatchObject({
      params: {
        config: {
          mcp_servers: { "design.preview": { enabled: false } },
        },
      },
    });
  });

  it("isolates the shared apps transport even without configured plugins", () => {
    const state = createCodexAppServerState();
    state.threadId = "thread-1";
    state.turnId = "turn-1";
    consumeCodexAppServerMessage(state, request, {
      method: "mcpServer/startupStatus/updated",
      params: {
        threadId: "thread-1",
        name: "codex_apps",
        status: "failed",
        error: "Figma connector transport worker quit with fatal: AuthRequired",
        failureReason: "reauthenticationRequired",
      },
    });

    const failedTurn = consumeCodexAppServerMessage(state, request, {
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "failed",
          error: { message: "codex_apps transport stopped after AuthRequired" },
          items: [],
        },
      },
    });

    expect(failedTurn.mcpFailure).toEqual({
      disposition: "recover",
      message: "codex_apps transport stopped after AuthRequired",
      serverNames: ["codex_apps"],
      isolation: {
        mcpServers: [],
        apps: [],
        disableApps: true,
        disablePlugins: false,
      },
    });
  });

  it("does not treat another app on the shared transport as the failed dependency", () => {
    const state = createCodexAppServerState();
    state.configuredPlugins = [
      "figma@openai-curated",
      "github@openai-curated",
    ];
    state.installedApps = [
      { id: "connector_figma", name: "Figma" },
      { id: "connector_github", name: "GitHub" },
    ];
    state.threadId = "thread-1";
    state.turnId = "turn-1";
    consumeCodexAppServerMessage(state, request, {
      method: "mcpServer/startupStatus/updated",
      params: {
        name: "codex_apps",
        status: "failed",
        error: "Figma connector transport worker quit with fatal: AuthRequired",
        failureReason: "reauthenticationRequired",
      },
    });
    consumeCodexAppServerMessage(state, request, {
      method: "item/started",
      params: {
        item: {
          id: "github-call-1",
          type: "mcpToolCall",
          server: "codex_apps",
          tool: "get_pull_request",
          pluginId: "github@openai-curated",
          status: "inProgress",
        },
      },
    });

    const failedTurn = consumeCodexAppServerMessage(state, request, {
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "failed",
          error: { message: "Figma AuthRequired stopped the MCP transport" },
          items: [],
        },
      },
    });

    expect(failedTurn.mcpFailure).toMatchObject({
      disposition: "recover",
      serverNames: ["Figma"],
      isolation: {
        apps: ["connector_figma"],
        disableApps: false,
      },
    });
  });

  it("maps authentication failure for an invoked MCP to a blocked turn", () => {
    const state = createCodexAppServerState();
    state.configuredPlugins = ["figma@openai-curated"];
    state.threadId = "thread-1";
    state.turnId = "turn-1";
    consumeCodexAppServerMessage(state, request, {
      method: "mcpServer/startupStatus/updated",
      params: {
        threadId: "thread-1",
        name: "figma",
        status: "failed",
        error: "AuthRequired",
        failureReason: "reauthenticationRequired",
      },
    });
    consumeCodexAppServerMessage(state, request, {
      method: "item/started",
      params: {
        item: {
          id: "figma-call-1",
          type: "mcpToolCall",
          server: "figma",
          tool: "get_design_context",
          status: "inProgress",
        },
      },
    });

    const failedTurn = consumeCodexAppServerMessage(state, request, {
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "failed",
          error: { message: "Figma MCP AuthRequired" },
          items: [],
        },
      },
    });

    expect(failedTurn.mcpFailure).toMatchObject({
      disposition: "blocked",
      serverNames: ["figma"],
    });
  });

  it("turns a failed App Server turn into a terminal runner error", () => {
    const state = createCodexAppServerState();
    state.threadId = "thread-1";
    state.turnId = "turn-1";
    expect(() =>
      consumeCodexAppServerMessage(state, request, {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "failed",
            error: { message: "provider disconnected" },
          },
        },
      }),
    ).toThrow("provider disconnected");
  });
});
