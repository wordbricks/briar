import * as Schema from "effect/Schema";
import type { JsonRpcMessage } from "./json-rpc-message";
import {
  normalizedActivityText,
  normalizedActivityTitle,
  type AgentActivityKind,
  type AgentActivityStatus,
  type NormalizedAgentEvent,
} from "./normalized-agent-event";
import {
  commonRunnerRequestFields,
  runnerRequestDecoderOptions,
} from "./runner-request";

export type {
  AgentActivityKind,
  AgentActivityStatus,
  NormalizedAgentEvent,
} from "./normalized-agent-event";

export const CodexRunnerRequest = Schema.Struct({
  ...commonRunnerRequestFields,
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  externalTools: Schema.optional(Schema.Boolean),
  codexBinary: Schema.String,
});

export type CodexRunnerRequest = typeof CodexRunnerRequest.Type;

export const decodeCodexRunnerRequest = Schema.decodeUnknownResult(
  CodexRunnerRequest,
  runnerRequestDecoderOptions,
);

export type CodexRunnerOutput =
  | {
      type: "session";
      sessionId: string;
    }
  | {
      type: "event";
      direction: "client" | "server";
      raw: CodexRpcMessage;
      event?: NormalizedAgentEvent;
    }
  | {
      type: "approval";
      id: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
    }
  | {
      type: "result";
      sessionId: string;
      message: string;
    }
  | {
      type: "blocked";
      reason: "mcp_auth_required";
      provider: "codex";
      message: string;
      serverNames: string[];
      nextRetryAt: null;
    }
  | {
      type: "error";
      message: string;
    };

export type CodexRpcMessage = JsonRpcMessage;

export type CodexAppServerState = {
  phase:
    | "initializing"
    | "readingConfig"
    | "listingModels"
    | "readingApps"
    | "startingThread"
    | "startingTurn"
    | "running"
    | "completed";
  threadId: string | null;
  turnId: string | null;
  fallbackText: string | null;
  finalText: string | null;
  turnStatus: string | null;
  configuredMcpServers: string[];
  configuredPlugins: string[];
  installedApps: CodexInstalledApp[];
  invokedMcpServers: Set<string>;
  invokedMcpCapabilities: Map<string, Set<string>>;
  mcpFailures: Map<string, CodexMcpFailure>;
  isolation: CodexMcpIsolation;
};

export type CodexMcpFailureReason =
  | "authenticationRequired"
  | "connectionFailed";

export type CodexMcpIsolation = {
  mcpServers: string[];
  apps: string[];
  disableApps: boolean;
  disablePlugins: boolean;
};

export type CodexMcpFailure = {
  serverName: string;
  capabilityNames: string[];
  reason: CodexMcpFailureReason;
  message: string;
  required: boolean;
  isolation: CodexMcpIsolation;
};

export type CodexInstalledApp = {
  id: string;
  name: string;
};

export type CodexMcpTurnFailure = {
  disposition: "recover" | "blocked";
  message: string;
  serverNames: string[];
  isolation: CodexMcpIsolation;
};

export type CodexAppServerTransition = {
  outgoing: CodexRpcMessage[];
  completed: boolean;
  mcpFailure?: CodexMcpTurnFailure;
};

const INITIALIZE_REQUEST_ID = 1;
const CONFIG_REQUEST_ID = 2;
const MODEL_LIST_REQUEST_ID = 3;
const THREAD_REQUEST_ID = 4;
const TURN_REQUEST_ID = 5;
const APPS_INSTALLED_REQUEST_ID = 6;

const approvalMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "execCommandApproval",
  "applyPatchApproval",
]);

export function createCodexAppServerState(
  isolation: CodexMcpIsolation = emptyCodexMcpIsolation(),
): CodexAppServerState {
  return {
    phase: "initializing",
    threadId: null,
    turnId: null,
    fallbackText: null,
    finalText: null,
    turnStatus: null,
    configuredMcpServers: [],
    configuredPlugins: [],
    installedApps: [],
    invokedMcpServers: new Set(),
    invokedMcpCapabilities: new Map(),
    mcpFailures: new Map(),
    isolation,
  };
}

export function codexAppServerArgs(
  request: Pick<CodexRunnerRequest, "networkAccess" | "externalTools">,
  browserAutomationProvider?: string,
): string[] {
  const argumentsList = ["app-server", "--listen", "stdio://"];
  if (request.externalTools === false) {
    argumentsList.push(
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
    );
  }
  if (
    request.externalTools !== false &&
    browserAutomationProvider === "aside"
  ) {
    argumentsList.push(
      "--config",
      'mcp_servers.aside.command="aside"',
      "--config",
      'mcp_servers.aside.args=["mcp"]',
    );
  }
  if (request.networkAccess) {
    argumentsList.push(
      "--config",
      "sandbox_workspace_write.network_access=true",
    );
  }
  return argumentsList;
}

export function codexMcpRecoveryPrompt(): string {
  return [
    "Continue the same task from the preceding failed turn.",
    "One or more optional MCP integrations failed during startup and have now been disabled for this runner only.",
    "Do not use those unavailable integrations; continue with the remaining tools and preserve all work already completed in this conversation.",
  ].join(" ");
}

function emptyCodexMcpIsolation(): CodexMcpIsolation {
  return {
    mcpServers: [],
    apps: [],
    disableApps: false,
    disablePlugins: false,
  };
}

function codexMcpSessionConfig(
  isolation: CodexMcpIsolation,
): Record<string, unknown> | null {
  const config: Record<string, unknown> = {};
  const features: Record<string, boolean> = {};
  if (isolation.disableApps) features.apps = false;
  if (isolation.disablePlugins) features.plugins = false;
  if (Object.keys(features).length > 0) config.features = features;
  const apps = Object.fromEntries(
    uniqueSorted(isolation.apps).map((appId) => [appId, { enabled: false }]),
  );
  if (Object.keys(apps).length > 0) config.apps = apps;
  const mcpServers = Object.fromEntries(
    uniqueSorted(isolation.mcpServers).map((serverName) => [
      serverName,
      { enabled: false },
    ]),
  );
  if (Object.keys(mcpServers).length > 0) config.mcp_servers = mcpServers;
  return Object.keys(config).length > 0 ? config : null;
}

export function codexInitializeRequest(): CodexRpcMessage {
  return {
    method: "initialize",
    id: INITIALIZE_REQUEST_ID,
    params: {
      clientInfo: {
        name: "briar",
        title: "Briar",
        version: process.env.BRIAR_VERSION?.trim() || "0.0.0",
      },
    },
  };
}

export function codexInitializedNotification(): CodexRpcMessage {
  return { method: "initialized", params: {} };
}

export function codexConfigReadRequest(
  request: Pick<CodexRunnerRequest, "workspaceRoot">,
): CodexRpcMessage {
  return {
    method: "config/read",
    id: CONFIG_REQUEST_ID,
    params: { cwd: request.workspaceRoot, includeLayers: false },
  };
}

export function codexModelListRequest(): CodexRpcMessage {
  return {
    method: "model/list",
    id: MODEL_LIST_REQUEST_ID,
    params: { includeHidden: false },
  };
}

export function codexAppsInstalledRequest(): CodexRpcMessage {
  return {
    method: "app/installed",
    id: APPS_INSTALLED_REQUEST_ID,
    params: { forceRefresh: false },
  };
}

export function codexThreadRequest(
  request: CodexRunnerRequest,
  isolation: CodexMcpIsolation = emptyCodexMcpIsolation(),
): CodexRpcMessage {
  const params: Record<string, unknown> = {
    cwd: request.workspaceRoot,
    approvalPolicy: request.approvalPolicy,
  };
  // Isolated conversational turns use the narrower permission profile passed
  // at App Server startup. Supplying the legacy sandbox field would make Codex
  // ignore that filesystem read allowlist.
  if (request.externalTools !== false) {
    params.sandbox = sandboxModeValue(request.sandboxMode);
  }
  const config = codexMcpSessionConfig(isolation);
  if (config) params.config = config;
  const instructions = request.instructions?.trim();
  if (instructions) params.developerInstructions = instructions;

  const conversationId = request.conversationId?.trim();
  if (conversationId) {
    params.threadId = conversationId;
    return { method: "thread/resume", id: THREAD_REQUEST_ID, params };
  }
  return { method: "thread/start", id: THREAD_REQUEST_ID, params };
}

export function codexTurnRequest(
  request: CodexRunnerRequest,
  threadId: string,
): CodexRpcMessage {
  const params: Record<string, unknown> = {
    threadId,
    cwd: request.workspaceRoot,
    approvalPolicy: request.approvalPolicy,
    input: [
      { type: "text", text: request.message },
      ...(request.attachments ?? []).map((attachment) => ({
        type: "localImage",
        path: attachment.path,
      })),
    ],
  };
  if (request.outputSchema !== null && request.outputSchema !== undefined) {
    params.outputSchema = request.outputSchema;
  }
  if (request.model?.trim()) params.model = request.model.trim();
  if (request.effort) params.effort = request.effort;
  return { method: "turn/start", id: TURN_REQUEST_ID, params };
}

export function normalizeCodexAppServerMessage(
  message: CodexRpcMessage,
): NormalizedAgentEvent | undefined {
  const method = message.method;
  const params = asRecord(message.params);
  if (!method || !params) return undefined;

  if (method === "mcpServer/startupStatus/updated") {
    const name = firstText(params.name)?.trim();
    if (!name || firstText(params.status)?.toLowerCase() !== "failed") {
      return undefined;
    }
    const detail =
      firstText(params.error)?.trim() ||
      (params.failureReason === "reauthenticationRequired"
        ? "Authentication is required."
        : "The MCP connection failed during startup.");
    return {
      type: "activityCompleted",
      id: `mcp-startup:${name}`,
      kind: "tool",
      title: normalizedActivityTitle(`${name} MCP unavailable`),
      text: normalizedActivityText(detail),
      status: "failed",
    };
  }

  if (method === "item/started" || method === "item/completed") {
    const item = asRecord(params.item);
    if (item?.type === "agentMessage" && typeof item.id === "string") {
      return {
        type: method === "item/started" ? "messageStarted" : "messageCompleted",
        id: item.id,
        phase: typeof item.phase === "string" ? item.phase : null,
        text: typeof item.text === "string" ? item.text : "",
      };
    }
    if (!item) return undefined;
    const activity = codexActivity(item);
    if (!activity) return undefined;
    if (method === "item/started") {
      return { type: "activityStarted", ...activity };
    }
    return {
      type: "activityCompleted",
      ...activity,
      status: codexActivityStatus(item),
    };
  }

  if (method === "item/agentMessage/delta") {
    const id = typeof params.itemId === "string" ? params.itemId : undefined;
    const delta = typeof params.delta === "string" ? params.delta : undefined;
    return id && delta !== undefined
      ? { type: "messageDelta", id, delta }
      : undefined;
  }

  if (
    method === "item/commandExecution/outputDelta" ||
    method === "item/fileChange/outputDelta" ||
    method === "item/mcpToolCall/progress" ||
    method === "item/dynamicToolCall/outputDelta"
  ) {
    const id = typeof params.itemId === "string" ? params.itemId : undefined;
    const delta = firstText(params.delta, params.output, params.message);
    return id && delta !== undefined
      ? { type: "activityDelta", id, delta: normalizedActivityText(delta) }
      : undefined;
  }

  if (method === "turn/completed") {
    const turn = asRecord(params.turn);
    return typeof turn?.status === "string"
      ? { type: "turnCompleted", status: turn.status }
      : undefined;
  }
  return undefined;
}

function codexActivity(item: Record<string, unknown> | null): {
  id: string;
  kind: AgentActivityKind;
  title: string;
  text: string;
} | null {
  if (!item || typeof item.id !== "string" || typeof item.type !== "string") {
    return null;
  }
  const kind = codexActivityKind(item.type);
  if (!kind) return null;
  return {
    id: item.id,
    kind,
    title: normalizedActivityTitle(codexActivityTitle(item)),
    text: normalizedActivityText(codexActivityText(item)),
  };
}

function codexActivityKind(type: string): AgentActivityKind | null {
  if (type === "commandExecution") return "command";
  if (type === "fileChange") return "fileChange";
  if (type === "webSearch") return "webSearch";
  if (
    type === "mcpToolCall" ||
    type === "dynamicToolCall" ||
    type === "collabToolCall" ||
    type === "collabAgentToolCall" ||
    type === "imageView"
  ) {
    return "tool";
  }
  return null;
}

function codexActivityTitle(item: Record<string, unknown>): string {
  if (item.type === "commandExecution") {
    return firstText(item.command) ?? "Run command";
  }
  if (item.type === "fileChange") {
    const paths = asArray(item.changes)
      .map(asRecord)
      .flatMap((change) => {
        const path = firstText(change?.path, change?.filePath);
        return path ? [path] : [];
      });
    return paths.length > 0 ? paths.join(", ") : "Change files";
  }
  if (item.type === "mcpToolCall") {
    const server = firstText(item.server, item.serverName);
    const tool = firstText(item.tool, item.toolName);
    return [server, tool].filter(Boolean).join("/") || "MCP tool";
  }
  if (item.type === "webSearch") {
    return firstText(item.query) ?? "Search the web";
  }
  if (item.type === "imageView") {
    return firstText(item.path) ?? "View image";
  }
  return firstText(item.tool, item.toolName, item.title) ?? "Use tool";
}

function codexActivityText(item: Record<string, unknown>): string {
  const direct = firstText(
    item.aggregatedOutput,
    item.output,
    asRecord(item.error)?.message,
    item.message,
  );
  if (direct !== undefined) return direct;
  for (const value of [
    item.result,
    item.results,
    item.rawOutput,
    item.contentItems,
    item.type === "fileChange" ? item.changes : undefined,
  ]) {
    if (value === undefined || value === null) continue;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return "";
}

function codexActivityStatus(
  item: Record<string, unknown>,
): AgentActivityStatus {
  const status = firstText(item.status)?.toLowerCase();
  if (
    status === "cancelled" ||
    status === "canceled" ||
    status === "declined" ||
    status === "denied" ||
    status === "aborted" ||
    status === "interrupted"
  ) {
    return "cancelled";
  }
  if (
    status === "failed" ||
    status === "error" ||
    item.success === false ||
    item.error != null ||
    (typeof item.exitCode === "number" && item.exitCode !== 0)
  ) {
    return "failed";
  }
  return "completed";
}

export function codexApprovalRequest(message: CodexRpcMessage): {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
} | null {
  if (
    typeof message.method !== "string" ||
    message.id === undefined ||
    message.id === null ||
    !approvalMethods.has(message.method)
  ) {
    return null;
  }
  const input = asRecord(message.params) ?? {};
  const title =
    typeof input.reason === "string"
      ? input.reason
      : typeof input.command === "string"
        ? input.command
        : undefined;
  if (title) {
    return {
      id: `codex-${String(message.id)}`,
      toolName: message.method,
      input,
      title,
    };
  }
  return {
    id: `codex-${String(message.id)}`,
    toolName: message.method,
    input,
  };
}

export function codexServerRequestResponse(
  message: CodexRpcMessage,
  approved: boolean,
): CodexRpcMessage | null {
  if (
    message.id === undefined ||
    message.id === null ||
    typeof message.method !== "string"
  ) {
    return null;
  }
  const decision = approvalDecision(message.method, approved);
  if (decision) {
    return { id: message.id, result: decision };
  }
  return {
    id: message.id,
    error: {
      code: -32601,
      message:
        "Briar detached worker does not support this Codex App Server request.",
    },
  };
}

export function consumeCodexAppServerMessage(
  state: CodexAppServerState,
  request: CodexRunnerRequest,
  message: CodexRpcMessage,
): CodexAppServerTransition {
  captureCodexMcpMessage(state, message);

  if (message.method && message.id !== undefined && message.id !== null) {
    return { outgoing: [], completed: false };
  }

  if (message.id !== undefined && message.id !== null) {
    if (message.error) {
      // Config and capability discovery are observational. Older App Server
      // builds may not implement these RPCs, and discovery must never prevent
      // the actual thread from running.
      if (
        message.id === CONFIG_REQUEST_ID ||
        message.id === MODEL_LIST_REQUEST_ID
      ) {
        state.phase = "readingApps";
        return {
          outgoing: [codexAppsInstalledRequest()],
          completed: false,
        };
      }
      if (message.id === APPS_INSTALLED_REQUEST_ID) {
        state.phase = "startingThread";
        return {
          outgoing: [codexThreadRequest(request, state.isolation)],
          completed: false,
        };
      }
      throw new Error(
        message.error.message?.trim() ||
          "Codex App Server returned an RPC error.",
      );
    }
    const result = asRecord(message.result);
    if (!result) {
      throw new Error("Codex App Server returned an empty RPC result.");
    }

    if (message.id === INITIALIZE_REQUEST_ID) {
      state.phase = "readingConfig";
      return {
        outgoing: [
          codexInitializedNotification(),
          codexConfigReadRequest(request),
        ],
        completed: false,
      };
    }

    if (message.id === CONFIG_REQUEST_ID) {
      const config = asRecord(result.config);
      state.configuredMcpServers = Object.keys(
        asRecord(config?.mcp_servers) ?? {},
      );
      state.configuredPlugins = Object.keys(asRecord(config?.plugins) ?? {});
      if (request.externalTools === false) {
        state.isolation = mergeMcpIsolation([
          state.isolation,
          {
            mcpServers: state.configuredMcpServers,
            apps: [],
            disableApps: true,
            disablePlugins: true,
          },
        ]);
      }
      const effectiveModel =
        typeof config?.model === "string" ? config.model.trim() : "";
      if (!request.model?.trim() && !effectiveModel) {
        state.phase = "listingModels";
        return {
          outgoing: [codexModelListRequest()],
          completed: false,
        };
      }
      state.phase = "readingApps";
      return {
        outgoing: [codexAppsInstalledRequest()],
        completed: false,
      };
    }

    if (message.id === MODEL_LIST_REQUEST_ID) {
      state.phase = "readingApps";
      return {
        outgoing: [codexAppsInstalledRequest()],
        completed: false,
      };
    }

    if (message.id === APPS_INSTALLED_REQUEST_ID) {
      state.installedApps = asArray(result.apps).flatMap((value) => {
        const app = asRecord(value);
        const id = firstText(app?.id)?.trim();
        const name = firstText(app?.runtimeName)?.trim();
        return id && name ? [{ id, name }] : [];
      });
      if (request.externalTools === false) {
        state.isolation = mergeMcpIsolation([
          state.isolation,
          {
            mcpServers: [],
            apps: state.installedApps.map((app) => app.id),
            disableApps: true,
            disablePlugins: true,
          },
        ]);
      }
      state.phase = "startingThread";
      return {
        outgoing: [codexThreadRequest(request, state.isolation)],
        completed: false,
      };
    }

    if (message.id === THREAD_REQUEST_ID) {
      const thread = asRecord(result.thread);
      const threadId = typeof thread?.id === "string" ? thread.id.trim() : "";
      if (!threadId) {
        throw new Error("Codex App Server did not return a thread ID.");
      }
      state.threadId = threadId;
      state.phase = "startingTurn";
      return {
        outgoing: [codexTurnRequest(request, threadId)],
        completed: false,
      };
    }

    if (message.id === TURN_REQUEST_ID) {
      const turn = asRecord(result.turn);
      const turnId = typeof turn?.id === "string" ? turn.id.trim() : "";
      if (!turnId) {
        throw new Error("Codex App Server did not return a turn ID.");
      }
      state.turnId = turnId;
      state.phase = "running";
      return { outgoing: [], completed: false };
    }
  }

  if (message.method === "item/completed") {
    captureAgentMessage(state, asRecord(asRecord(message.params)?.item));
    return { outgoing: [], completed: false };
  }

  if (message.method === "turn/completed") {
    const params = asRecord(message.params);
    const turn = asRecord(params?.turn);
    const status = typeof turn?.status === "string" ? turn.status : "failed";
    state.turnStatus = status;
    for (const item of asArray(turn?.items)) {
      const record = asRecord(item);
      captureCodexMcpItem(state, record);
      captureAgentMessage(state, record);
    }
    if (status !== "completed") {
      const error = asRecord(turn?.error);
      const message =
        typeof error?.message === "string" ? error.message : status;
      const mcpFailure = codexMcpTurnFailure(state, message);
      if (mcpFailure) {
        return { outgoing: [], completed: false, mcpFailure };
      }
      throw new Error(
        `Codex turn did not complete: ${message}`,
      );
    }
    state.phase = "completed";
    return { outgoing: [], completed: true };
  }

  return { outgoing: [], completed: false };
}

function captureCodexMcpMessage(
  state: CodexAppServerState,
  message: CodexRpcMessage,
) {
  const params = asRecord(message.params);
  if (message.method === "mcpServer/startupStatus/updated" && params) {
    const serverName = firstText(params.name)?.trim();
    const status = firstText(params.status)?.toLowerCase();
    if (!serverName) return;
    if (status === "ready") {
      state.mcpFailures.delete(serverName);
      return;
    }
    if (status !== "failed") return;
    const detail =
      firstText(params.error)?.trim() ||
      (params.failureReason === "reauthenticationRequired"
        ? "Authentication is required."
        : "MCP startup failed.");
    const capabilityNames = codexMcpFailureCapabilities(
      state,
      serverName,
      detail,
    );
    state.mcpFailures.set(serverName, {
      serverName,
      capabilityNames,
      reason:
        params.failureReason === "reauthenticationRequired" ||
          mcpAuthenticationRequired(detail)
          ? "authenticationRequired"
          : "connectionFailed",
      message: detail,
      required: codexMcpCapabilityWasInvoked(
        state,
        serverName,
        capabilityNames,
      ),
      isolation: codexMcpIsolation(state, serverName, capabilityNames),
    });
    return;
  }

  if (message.method === "item/started" || message.method === "item/completed") {
    captureCodexMcpItem(state, asRecord(params?.item));
  }
}

function captureCodexMcpItem(
  state: CodexAppServerState,
  item: Record<string, unknown> | null,
) {
  if (item?.type !== "mcpToolCall") return;
  const serverName = firstText(item.server, item.serverName)?.trim();
  if (!serverName) return;
  state.invokedMcpServers.add(serverName);
  const capabilityNames = codexMcpItemCapabilities(state, item);
  const invokedCapabilities = state.invokedMcpCapabilities.get(serverName) ??
    new Set<string>();
  for (const capabilityName of capabilityNames) {
    invokedCapabilities.add(normalizedCapabilityName(capabilityName));
  }
  state.invokedMcpCapabilities.set(serverName, invokedCapabilities);
  const existing = state.mcpFailures.get(serverName);
  if (
    existing &&
    codexMcpCapabilityWasInvoked(
      state,
      serverName,
      existing.capabilityNames,
    )
  ) {
    state.mcpFailures.set(serverName, { ...existing, required: true });
  }
  if (codexActivityStatus(item) !== "failed") return;
  const detail = codexActivityText(item).trim() || "MCP tool call failed.";
  state.mcpFailures.set(serverName, {
    serverName,
    capabilityNames: capabilityNames.length > 0
      ? capabilityNames
      : existing?.capabilityNames ?? [serverName],
    reason: mcpAuthenticationRequired(detail)
      ? "authenticationRequired"
      : existing?.reason ?? "connectionFailed",
    message: detail,
    required: true,
    isolation: existing?.isolation ??
      codexMcpIsolation(state, serverName, capabilityNames),
  });
}

function codexMcpTurnFailure(
  state: CodexAppServerState,
  turnError: string,
): CodexMcpTurnFailure | null {
  const failures = [...state.mcpFailures.values()];
  if (failures.length === 0) return null;
  const normalizedError = turnError.toLowerCase();
  const required = failures.filter((failure) => failure.required);
  const named = failures.filter((failure) =>
    normalizedError.includes(failure.serverName.toLowerCase())
  );
  const relevant = required.length > 0
    ? required
    : named.length > 0
      ? named
      : mcpFailureText(turnError)
        ? failures
        : [];
  if (relevant.length === 0) return null;

  if (relevant.some((failure) => failure.required)) {
    const authFailures = relevant.filter(
      (failure) =>
        failure.required && failure.reason === "authenticationRequired",
    );
    if (authFailures.length === 0) return null;
    return {
      disposition: "blocked",
      message: turnError,
      serverNames: uniqueCapabilityNames(
        authFailures.flatMap((failure) =>
          failure.capabilityNames.map(safeMcpServerLabel)
        ),
      ),
      isolation: emptyCodexMcpIsolation(),
    };
  }

  const isolation = mergeMcpIsolation(
    relevant.map((failure) => failure.isolation),
  );
  if (
    isolation.mcpServers.length === 0 &&
    isolation.apps.length === 0 &&
    !isolation.disableApps &&
    !isolation.disablePlugins
  ) {
    return null;
  }
  return {
    disposition: "recover",
    message: turnError,
    serverNames: uniqueCapabilityNames(
      relevant.flatMap((failure) =>
        failure.capabilityNames.map(safeMcpServerLabel)
      ),
    ),
    isolation,
  };
}

function codexMcpFailureCapabilities(
  state: Pick<CodexAppServerState, "configuredPlugins" | "installedApps">,
  serverName: string,
  detail: string,
): string[] {
  const matchedPlugins = state.configuredPlugins.flatMap((pluginId) => {
    const pluginName = pluginId.split("@", 1)[0]?.trim();
    if (!pluginName) return [];
    return normalizedCapabilityName(pluginName).length >= 3 &&
        capabilityMentioned(detail, pluginName)
      ? [pluginName]
      : [];
  });
  const matchedApps = state.installedApps
    .filter((app) => capabilityMentioned(detail, app.name))
    .map((app) => app.name);
  const matchedCapabilities = [...matchedApps, ...matchedPlugins];
  return uniqueCapabilityNames(
    matchedCapabilities.length > 0 ? matchedCapabilities : [serverName],
  );
}

function capabilityMentioned(detail: string, capabilityName: string): boolean {
  const words = capabilityName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return false;
  return new RegExp(
    `(?:^|[^a-z0-9])${words.join("[^a-z0-9]+")}(?=$|[^a-z0-9])`,
    "i",
  ).test(detail);
}

function codexMcpItemCapabilities(
  state: Pick<CodexAppServerState, "installedApps">,
  item: Record<string, unknown>,
): string[] {
  const appContext = asRecord(item.appContext);
  const connectorId = firstText(appContext?.connectorId)?.trim();
  const installedAppName = state.installedApps.find(
    (app) => connectorId && app.id === connectorId,
  )?.name;
  const pluginId = firstText(item.pluginId)?.split("@", 1)[0]?.trim();
  const capabilityName = firstText(appContext?.appName)?.trim() ||
    installedAppName || pluginId || connectorId;
  return capabilityName ? [capabilityName] : [];
}

function codexMcpCapabilityWasInvoked(
  state: Pick<
    CodexAppServerState,
    "invokedMcpServers" | "invokedMcpCapabilities"
  >,
  serverName: string,
  capabilityNames: string[],
): boolean {
  if (!state.invokedMcpServers.has(serverName)) return false;
  if (normalizedCapabilityName(serverName) !== "codexapps") return true;
  const specificCapabilities = capabilityNames
    .map(normalizedCapabilityName)
    .filter((name) => name && name !== "codexapps");
  if (specificCapabilities.length === 0) return true;
  const invoked = state.invokedMcpCapabilities.get(serverName);
  if (!invoked || invoked.size === 0) return true;
  return specificCapabilities.some((capability) => invoked.has(capability));
}

function codexMcpIsolation(
  state: Pick<
    CodexAppServerState,
    "configuredMcpServers" | "configuredPlugins" | "installedApps"
  >,
  serverName: string,
  capabilityNames: string[],
): CodexMcpIsolation {
  const normalizedServer = normalizedCapabilityName(serverName);
  const mcpServers = state.configuredMcpServers.filter(
    (candidate) => candidate.toLowerCase() === serverName.toLowerCase(),
  );
  const normalizedCapabilities = new Set(
    capabilityNames.map(normalizedCapabilityName),
  );
  const plugins = state.configuredPlugins.filter((pluginId) => {
    const pluginName = pluginId.split("@", 1)[0] ?? pluginId;
    const normalizedPlugin = normalizedCapabilityName(pluginName);
    return normalizedPlugin === normalizedServer ||
      normalizedCapabilities.has(normalizedPlugin);
  });
  const apps = state.installedApps
    .filter((app) =>
      normalizedCapabilities.has(normalizedCapabilityName(app.id)) ||
      normalizedCapabilities.has(normalizedCapabilityName(app.name))
    )
    .map((app) => app.id);
  const disableApps = normalizedServer === "codexapps" && apps.length === 0;
  return {
    mcpServers: uniqueSorted(mcpServers),
    apps: uniqueSorted(apps),
    disableApps,
    disablePlugins:
      normalizedServer !== "codexapps" &&
      mcpServers.length === 0 &&
      apps.length === 0 &&
      plugins.length > 0,
  };
}

function mergeMcpIsolation(
  values: CodexMcpIsolation[],
): CodexMcpIsolation {
  return {
    mcpServers: uniqueSorted(values.flatMap((value) => value.mcpServers)),
    apps: uniqueSorted(values.flatMap((value) => value.apps)),
    disableApps: values.some((value) => value.disableApps),
    disablePlugins: values.some((value) => value.disablePlugins),
  };
}

function normalizedCapabilityName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mcpAuthenticationRequired(value: string): boolean {
  return /auth\s*required|authentication\s+(?:is\s+)?required|reauthentication|required to authenticate|not logged in|token\s+(?:is\s+)?expired|expired\s+(?:authentication\s+)?token|\b401\b/i.test(
    value,
  );
}

function mcpFailureText(value: string): boolean {
  return /\bmcp\b|auth\s*required|reauthentication|transport\s+worker/i.test(
    value,
  );
}

function safeMcpServerLabel(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N} ._@/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "MCP";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueCapabilityNames(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const key = normalizedCapabilityName(value) || value.toLowerCase();
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right));
}

export function codexFinalMessage(state: CodexAppServerState): string | null {
  const message = state.finalText ?? state.fallbackText;
  const trimmed = message?.trim();
  return trimmed || null;
}

function sandboxModeValue(
  mode: CodexRunnerRequest["sandboxMode"],
): "read-only" | "workspace-write" | "danger-full-access" {
  if (mode === "readOnly") return "read-only";
  if (mode === "dangerFullAccess") return "danger-full-access";
  return "workspace-write";
}

function captureAgentMessage(
  state: CodexAppServerState,
  item: Record<string, unknown> | null,
) {
  if (item?.type !== "agentMessage" || typeof item.text !== "string") return;
  const text = item.text.trim();
  if (!text) return;
  state.fallbackText = item.text;
  if (item.phase === "final_answer") state.finalText = item.text;
}

function approvalDecision(
  method: string,
  approved: boolean,
): Record<string, string> | null {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    return { decision: approved ? "accept" : "decline" };
  }
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: approved ? "approved" : "denied" };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}
