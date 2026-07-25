/**
 * Grok CLI ACP client helpers.
 *
 * Mirrors t3code's Grok ACP surface (`grok agent stdio`): initialize →
 * authenticate → session/new|load → optional set_model → session/prompt,
 * while mapping stream updates into Briar's provider-neutral agent events.
 */

export type GrokRunnerRequest = {
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
  grokBinary: string;
};

export type GrokApprovalResponse = {
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

export type GrokEventState = {
  activeMessageId: string | null;
  assistantText: string;
  messageStarted: boolean;
};

export type GrokRunnerOutput =
  | {
      type: "event";
      raw: unknown;
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

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
export const BRIAR_OAUTH_REFERRER = "briar";
export const GROK_API_KEY_ENV = "XAI_API_KEY";
export const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
export const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";
export const DEFAULT_GROK_MODEL = "grok-4.5";

export function resolveGrokAuthMethodId(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return environment[GROK_API_KEY_ENV]?.trim()
    ? GROK_AUTH_METHOD_API_KEY
    : GROK_AUTH_METHOD_CACHED_TOKEN;
}

export function shouldAutoApprovePermission(
  request: GrokRunnerRequest,
): boolean {
  return (
    request.sandboxMode === "dangerFullAccess" ||
    request.approvalPolicy === "never"
  );
}

export function shouldDenyWritePermission(
  request: GrokRunnerRequest,
  toolName: string,
): boolean {
  if (request.sandboxMode !== "readOnly") return false;
  const name = toolName.toLowerCase();
  return (
    name.includes("write") ||
    name.includes("edit") ||
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("terminal") ||
    name.includes("apply_patch") ||
    name.includes("delete")
  );
}

export function selectPermissionOptionId(
  options: ReadonlyArray<{ optionId?: string; kind?: string }>,
  preferred: "allow_always" | "allow_once" | "reject_once",
): string | undefined {
  const match = options.find((option) => option.kind === preferred);
  const optionId = match?.optionId?.trim();
  if (optionId) return optionId;
  if (preferred === "allow_always") {
    return selectPermissionOptionId(options, "allow_once");
  }
  return options[0]?.optionId?.trim() || undefined;
}

export function permissionDecisionResult(
  options: ReadonlyArray<{ optionId?: string; kind?: string }>,
  approved: boolean,
): { outcome: { outcome: "selected"; optionId: string } } | { outcome: { outcome: "cancelled" } } {
  if (!approved) {
    const rejectId = selectPermissionOptionId(options, "reject_once");
    if (rejectId) {
      return { outcome: { outcome: "selected", optionId: rejectId } };
    }
    return { outcome: { outcome: "cancelled" } };
  }
  const allowId =
    selectPermissionOptionId(options, "allow_always") ??
    selectPermissionOptionId(options, "allow_once");
  if (!allowId) {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: allowId } };
}

export function buildPromptParts(request: GrokRunnerRequest): Array<{
  type: "text";
  text: string;
}> {
  const parts: Array<{ type: "text"; text: string }> = [];
  const instructions = request.instructions?.trim();
  if (instructions) {
    parts.push({
      type: "text",
      text: `Additional instructions for this turn:\n${instructions}`,
    });
  }
  if (
    request.outputSchema !== null &&
    request.outputSchema !== undefined
  ) {
    parts.push({
      type: "text",
      text: `Respond with JSON that matches this schema:\n${JSON.stringify(request.outputSchema)}`,
    });
  }
  parts.push({ type: "text", text: request.message });
  return parts;
}

export function resolveGrokModelId(model: string | null | undefined): string | undefined {
  const trimmed = model?.trim();
  return trimmed ? trimmed : undefined;
}

export function mapEffortToGrok(
  effort: GrokRunnerRequest["effort"],
): string | undefined {
  if (!effort) return undefined;
  if (effort === "ultra" || effort === "xhigh") return "high";
  if (effort === "max") return "high";
  return effort;
}

export function createGrokEventState(): GrokEventState {
  return {
    activeMessageId: null,
    assistantText: "",
    messageStarted: false,
  };
}

export function normalizeGrokSessionUpdate(
  params: unknown,
  state: GrokEventState,
): { raw: unknown; event?: NormalizedAgentEvent } {
  const record =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>)
      : null;
  const update =
    record && typeof record.update === "object" && record.update !== null
      ? (record.update as Record<string, unknown>)
      : null;
  const kind =
    typeof update?.sessionUpdate === "string" ? update.sessionUpdate : null;

  if (kind === "agent_message_chunk") {
    const content =
      typeof update?.content === "object" && update.content !== null
        ? (update.content as Record<string, unknown>)
        : null;
    const text =
      content?.type === "text" && typeof content.text === "string"
        ? content.text
        : "";
    if (!text) return { raw: params };

    if (!state.messageStarted) {
      state.activeMessageId =
        typeof record?.sessionId === "string"
          ? `${record.sessionId}:assistant`
          : "assistant";
      state.messageStarted = true;
      state.assistantText = text;
      return {
        raw: params,
        event: {
          type: "messageStarted",
          id: state.activeMessageId,
          phase: "commentary",
          text,
        },
      };
    }

    state.assistantText += text;
    return {
      raw: params,
      event: {
        type: "messageDelta",
        id: state.activeMessageId ?? "assistant",
        delta: text,
      },
    };
  }

  if (kind === "tool_call" || kind === "tool_call_update") {
    return { raw: params };
  }

  return { raw: params };
}

export function finalizeGrokMessage(
  state: GrokEventState,
  stopReason: string | undefined,
): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  if (state.messageStarted && state.activeMessageId) {
    events.push({
      type: "messageCompleted",
      id: state.activeMessageId,
      phase: "final",
      text: state.assistantText,
    });
  }
  events.push({
    type: "turnCompleted",
    status:
      !stopReason || stopReason === "end_turn" || stopReason === "stop"
        ? "completed"
        : stopReason,
  });
  return events;
}

export function permissionToolName(params: unknown): string {
  const record =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>)
      : null;
  const toolCall =
    record && typeof record.toolCall === "object" && record.toolCall !== null
      ? (record.toolCall as Record<string, unknown>)
      : null;
  if (typeof toolCall?.title === "string" && toolCall.title.trim()) {
    return toolCall.title.trim();
  }
  if (typeof toolCall?.kind === "string" && toolCall.kind.trim()) {
    return toolCall.kind.trim();
  }
  if (typeof toolCall?.toolName === "string" && toolCall.toolName.trim()) {
    return toolCall.toolName.trim();
  }
  return "tool";
}

export function permissionInput(params: unknown): Record<string, unknown> {
  const record =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>)
      : {};
  const toolCall =
    typeof record.toolCall === "object" && record.toolCall !== null
      ? (record.toolCall as Record<string, unknown>)
      : {};
  const rawInput = toolCall.rawInput;
  if (typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  if (typeof toolCall.input === "object" && toolCall.input !== null) {
    return toolCall.input as Record<string, unknown>;
  }
  return {
    ...(typeof toolCall.title === "string" ? { reason: toolCall.title } : {}),
    ...(typeof toolCall.kind === "string" ? { kind: toolCall.kind } : {}),
  };
}

export function permissionOptions(
  params: unknown,
): Array<{ optionId?: string; kind?: string }> {
  const record =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>)
      : null;
  const options = record?.options;
  if (!Array.isArray(options)) return [];
  return options.filter(
    (option): option is { optionId?: string; kind?: string } =>
      typeof option === "object" && option !== null,
  );
}
