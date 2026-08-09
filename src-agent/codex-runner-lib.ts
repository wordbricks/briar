import type { AgentAttachment } from "./runner-attachments";

export type CodexRunnerRequest = {
  type: "run";
  message: string;
  workspaceRoot: string;
  conversationId?: string | null;
  instructions?: string | null;
  outputSchema?: Record<string, unknown> | boolean | null;
  model?: string | null;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | null;
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandboxMode: "readOnly" | "workspaceWrite" | "dangerFullAccess";
  networkAccess: boolean;
  attachments?: AgentAttachment[];
  codexBinary: string;
};

export type CodexApprovalResponse = {
  type: "approvalResponse";
  id: string;
  approved: boolean;
};

export type NormalizedAgentEvent =
  | {
      type: "messageStarted";
      id: string;
      phase: string | null;
      text: string;
    }
  | {
      type: "messageDelta";
      id: string;
      delta: string;
    }
  | {
      type: "messageCompleted";
      id: string;
      phase: string | null;
      text: string;
    }
  | {
      type: "turnCompleted";
      status: string;
    };

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
      type: "error";
      message: string;
    };

export type CodexRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type CodexAppServerState = {
  phase:
    | "initializing"
    | "startingThread"
    | "startingTurn"
    | "running"
    | "completed";
  threadId: string | null;
  turnId: string | null;
  fallbackText: string | null;
  finalText: string | null;
  turnStatus: string | null;
};

export type CodexAppServerTransition = {
  outgoing: CodexRpcMessage[];
  completed: boolean;
};

const INITIALIZE_REQUEST_ID = 1;
const THREAD_REQUEST_ID = 2;
const TURN_REQUEST_ID = 3;

const approvalMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "execCommandApproval",
  "applyPatchApproval",
]);

export function createCodexAppServerState(): CodexAppServerState {
  return {
    phase: "initializing",
    threadId: null,
    turnId: null,
    fallbackText: null,
    finalText: null,
    turnStatus: null,
  };
}

export function codexAppServerArgs(
  request: Pick<CodexRunnerRequest, "networkAccess">,
): string[] {
  const argumentsList = ["app-server", "--listen", "stdio://"];
  if (request.networkAccess) {
    argumentsList.push(
      "--config",
      "sandbox_workspace_write.network_access=true",
    );
  }
  return argumentsList;
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

export function codexThreadRequest(
  request: CodexRunnerRequest,
): CodexRpcMessage {
  const params: Record<string, unknown> = {
    cwd: request.workspaceRoot,
    sandbox: sandboxModeValue(request.sandboxMode),
    approvalPolicy: request.approvalPolicy,
  };
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

  if (method === "item/started" || method === "item/completed") {
    const item = asRecord(params.item);
    if (item?.type !== "agentMessage" || typeof item.id !== "string") {
      return undefined;
    }
    return {
      type: method === "item/started" ? "messageStarted" : "messageCompleted",
      id: item.id,
      phase: typeof item.phase === "string" ? item.phase : null,
      text: typeof item.text === "string" ? item.text : "",
    };
  }

  if (method === "item/agentMessage/delta") {
    const id = typeof params.itemId === "string" ? params.itemId : undefined;
    const delta = typeof params.delta === "string" ? params.delta : undefined;
    return id && delta !== undefined
      ? { type: "messageDelta", id, delta }
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

export function codexApprovalRequest(
  message: CodexRpcMessage,
): {
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
  return {
    id: `codex-${String(message.id)}`,
    toolName: message.method,
    input,
    ...(title ? { title } : {}),
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
  if (message.method && message.id !== undefined && message.id !== null) {
    return { outgoing: [], completed: false };
  }

  if (message.id !== undefined && message.id !== null) {
    if (message.error) {
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
      state.phase = "startingThread";
      return {
        outgoing: [codexInitializedNotification(), codexThreadRequest(request)],
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
      captureAgentMessage(state, asRecord(item));
    }
    if (status !== "completed") {
      const error = asRecord(turn?.error);
      throw new Error(
        `Codex turn did not complete: ${typeof error?.message === "string" ? error.message : status}`,
      );
    }
    state.phase = "completed";
    return { outgoing: [], completed: true };
  }

  return { outgoing: [], completed: false };
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
