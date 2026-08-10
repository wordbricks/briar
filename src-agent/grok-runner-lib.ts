import type { AgentAttachment } from "./runner-attachments";
import {
  normalizedActivityText,
  normalizedActivityTitle,
  type AgentActivityKind,
  type NormalizedAgentEvent,
} from "./normalized-agent-event";
import { readAgentImage } from "./runner-attachments";

export type {
  AgentActivityKind,
  AgentActivityStatus,
  NormalizedAgentEvent,
} from "./normalized-agent-event";

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
  attachments?: AgentAttachment[];
  grokBinary: string;
};

export type GrokEventState = {
  activeMessageId: string | null;
  activeAssistantText: string;
  lastAssistantText: string;
  messageSequence: number;
  activities: Map<
    string,
    {
      kind: AgentActivityKind;
      title: string;
      text: string;
      started: boolean;
      completed: boolean;
    }
  >;
};

export type GrokRunnerOutput =
  | {
      type: "session";
      sessionId: string;
    }
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

export type GrokPromptPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function grokSessionMeta(
  request: GrokRunnerRequest,
): { rules: string } | undefined {
  const instructions = request.instructions?.trim();
  return instructions ? { rules: instructions } : undefined;
}

export function buildPromptParts(request: GrokRunnerRequest): GrokPromptPart[] {
  const parts: GrokPromptPart[] = [];
  if (
    request.outputSchema !== null &&
    request.outputSchema !== undefined
  ) {
    parts.push({
      type: "text",
      text: `Return only the JSON value that matches this schema, without Markdown fences or commentary:\n${JSON.stringify(request.outputSchema)}`,
    });
  }
  parts.push({ type: "text", text: request.message });
  return parts;
}

export async function buildGrokPromptParts(
  request: GrokRunnerRequest,
): Promise<GrokPromptPart[]> {
  const parts = buildPromptParts(request);
  for (const attachment of request.attachments ?? []) {
    parts.push({
      type: "image",
      data: Buffer.from(await readAgentImage(attachment)).toString("base64"),
      mimeType: attachment.mimeType,
    });
  }
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
    activeAssistantText: "",
    lastAssistantText: "",
    messageSequence: 0,
    activities: new Map(),
  };
}

function completeActiveGrokMessage(
  state: GrokEventState,
  phase: string,
): NormalizedAgentEvent | undefined {
  if (!state.activeMessageId) return;
  const text = state.activeAssistantText;
  state.lastAssistantText = text;
  const event: NormalizedAgentEvent = {
    type: "messageCompleted",
    id: state.activeMessageId,
    phase,
    text,
  };
  state.activeMessageId = null;
  state.activeAssistantText = "";
  return event;
}

export function normalizeGrokSessionUpdate(
  params: unknown,
  state: GrokEventState,
): { raw: unknown; events: NormalizedAgentEvent[] } {
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
    if (!text) return { raw: params, events: [] };

    if (!state.activeMessageId) {
      state.messageSequence += 1;
      state.activeMessageId =
        typeof record?.sessionId === "string"
          ? `${record.sessionId}:assistant:${state.messageSequence}`
          : `assistant:${state.messageSequence}`;
      state.activeAssistantText = text;
      return {
        raw: params,
        events: [{
          type: "messageStarted",
          id: state.activeMessageId,
          phase: "commentary",
          text,
        }],
      };
    }

    state.activeAssistantText += text;
    return {
      raw: params,
      events: [{
        type: "messageDelta",
        id: state.activeMessageId,
        delta: text,
      }],
    };
  }

  if (kind === "tool_call" || kind === "tool_call_update") {
    if (!update) return { raw: params, events: [] };
    const events: NormalizedAgentEvent[] = [];
    const completedMessage = completeActiveGrokMessage(state, "commentary");
    if (completedMessage) events.push(completedMessage);
    events.push(...normalizeGrokActivity(update, state));
    return { raw: params, events };
  }

  return { raw: params, events: [] };
}

function normalizeGrokActivity(
  update: Record<string, unknown>,
  state: GrokEventState,
): NormalizedAgentEvent[] {
  const id = typeof update.toolCallId === "string" ? update.toolCallId : null;
  if (!id) return [];
  const existing = state.activities.get(id);
  const kind = grokActivityKind(
    typeof update.kind === "string" ? update.kind : null,
    existing?.kind,
  );
  const rawInput = asRecord(update.rawInput);
  const title = normalizedActivityTitle(
    (typeof update.title === "string" && update.title) ||
      existing?.title ||
      (kind === "command" && typeof rawInput?.command === "string"
        ? rawInput.command
        : "Use tool"),
  );
  const output = normalizedActivityText(
    grokActivityOutput(update) ?? existing?.text ?? "",
  );
  const activity = {
    kind,
    title,
    text: output,
    started: existing?.started ?? false,
    completed: existing?.completed ?? false,
  };
  const events: NormalizedAgentEvent[] = [];

  if (!activity.started) {
    activity.started = true;
    events.push({
      type: "activityStarted",
      id,
      kind,
      title,
      text: output,
    });
  } else if (
    output &&
    output !== existing?.text &&
    output.startsWith(existing?.text ?? "")
  ) {
    events.push({
      type: "activityDelta",
      id,
      delta: output.slice(existing?.text.length ?? 0),
    });
  }

  const status = typeof update.status === "string"
    ? update.status.toLowerCase()
    : null;
  const cancelled =
    status === "cancelled" ||
    status === "canceled" ||
    status === "denied" ||
    status === "aborted" ||
    status === "interrupted";
  if (
    !activity.completed &&
    (status === "completed" || status === "failed" || cancelled)
  ) {
    activity.completed = true;
    events.push({
      type: "activityCompleted",
      id,
      kind,
      title,
      text: output,
      status: cancelled ? "cancelled" : status === "failed" ? "failed" : "completed",
    });
  }
  state.activities.set(id, activity);
  return events;
}

function grokActivityKind(
  kind: string | null,
  fallback: AgentActivityKind | undefined,
): AgentActivityKind {
  if (!kind) return fallback ?? "tool";
  const normalized = kind.toLowerCase();
  if (normalized === "execute") return "command";
  if (
    normalized === "edit" ||
    normalized === "delete" ||
    normalized === "move"
  ) {
    return "fileChange";
  }
  if (normalized === "fetch" || normalized === "search") return "webSearch";
  return "tool";
}

function grokActivityOutput(update: Record<string, unknown>): string | null {
  if (typeof update.rawOutput === "string") return update.rawOutput;
  if (update.rawOutput != null) return jsonText(update.rawOutput);
  if (!Array.isArray(update.content)) return null;
  const text = update.content.flatMap((value) => activityContentText(value)).join("");
  return text || null;
}

function activityContentText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  const content = asRecord(value);
  if (!content) return [];
  if (typeof content.text === "string") return [content.text];
  if (content.content !== undefined) return activityContentText(content.content);
  if (typeof content.diff === "string") return [content.diff];
  return [];
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function finalizeGrokMessage(
  state: GrokEventState,
  stopReason: string | undefined,
): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  const completed = completeActiveGrokMessage(state, "final");
  if (completed) events.push(completed);
  events.push({
    type: "turnCompleted",
    status:
      !stopReason || stopReason === "end_turn" || stopReason === "stop"
        ? "completed"
        : stopReason,
  });
  return events;
}

export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) return trimmed;

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }
  return trimmed.slice(start);
}

export function resolveGrokFinalMessage(
  state: GrokEventState,
  promptResultText: string | undefined,
  outputSchema: GrokRunnerRequest["outputSchema"],
): string {
  const message =
    state.lastAssistantText.trim() || promptResultText?.trim() || "";
  return outputSchema === null || outputSchema === undefined
    ? message
    : extractJsonObject(message);
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
