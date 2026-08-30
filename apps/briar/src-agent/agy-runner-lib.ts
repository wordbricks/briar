import type {
  AgentActivityKind,
  NormalizedAgentEvent,
} from "./normalized-agent-event";
import {
  normalizedActivityText,
  normalizedActivityTitle,
} from "./normalized-agent-event";
import type { RunnerRequest } from "./runner-request";

export type AgyBlockedRetry =
  | {
      reason: "usage_exhausted";
      provider: "agy";
      message: string;
      nextRetryAt: null;
    }
  | {
      reason: "upstream_overloaded";
      provider: "agy";
      message: string;
      nextRetryAt: null;
      statusCode: 502 | 503 | 504;
    };

export type AgyRunnerOutput =
  | { type: "session"; sessionId: string }
  | { type: "event"; raw: unknown; event?: NormalizedAgentEvent }
  | ({ type: "blocked" } & AgyBlockedRetry)
  | { type: "result"; sessionId: string; message: string }
  | { type: "error"; message: string };

export type AgyEventState = {
  messageId: string;
  messageStarted: boolean;
  assistantText: string;
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
  activitySequence: number;
};

export function createAgyEventState(): AgyEventState {
  return {
    messageId: "agy-message-1",
    messageStarted: false,
    assistantText: "",
    activities: new Map(),
    activitySequence: 0,
  };
}

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export function agyConversationId(event: unknown): string | undefined {
  const root = recordValue(event);
  if (!root) return undefined;
  return (
    stringValue(root.conversation_id) ??
    stringValue(root.conversationId) ??
    stringValue(root.session_id) ??
    stringValue(root.sessionId) ??
    agyConversationId(root.init) ??
    agyConversationId(root.step_update) ??
    agyConversationId(root.stepUpdate) ??
    agyConversationId(root.result) ??
    agyConversationId(root.data)
  );
}

function textFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value.map(textFrom).filter(Boolean).join("");
    return text || undefined;
  }
  const record = recordValue(value);
  if (!record) return undefined;
  for (const key of [
    "text_delta",
    "textDelta",
    "text",
    "content",
    "message",
    "response",
    "output",
    "summary",
  ]) {
    const text = textFrom(record[key]);
    if (text) return text;
  }
  return undefined;
}

function eventType(event: Record<string, unknown>) {
  return (
    stringValue(event.event) ??
    stringValue(event.type) ??
    stringValue(event.step_type) ??
    stringValue(recordValue(event.step)?.type) ??
    stringValue(recordValue(event.step)?.step_type) ??
    ""
  ).toLowerCase();
}

function stepRecord(event: Record<string, unknown>) {
  return (
    recordValue(event.step_update) ??
    recordValue(event.stepUpdate) ??
    recordValue(event.step) ??
    recordValue(event.data) ??
    event
  );
}

function isAssistantStep(type: string) {
  return ["assistant", "agent", "message", "response", "text", "final"].some(
    (token) => type.includes(token),
  ) && !type.includes("tool");
}

function activityKind(type: string, toolName: string): AgentActivityKind {
  const value = `${type} ${toolName}`.toLowerCase();
  if (/write|edit|patch|file_change/u.test(value)) return "fileChange";
  if (/shell|command|terminal|run_command/u.test(value)) return "command";
  if (/browser|web|search|fetch|read_url/u.test(value)) return "webSearch";
  return "tool";
}

function completeActiveActivities(state: AgyEventState): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  for (const [id, activity] of state.activities) {
    if (activity.completed) continue;
    activity.completed = true;
    events.push({
      type: "activityCompleted",
      id,
      kind: activity.kind,
      title: activity.title,
      text: activity.text,
      status: "completed",
    });
  }
  return events;
}

export function normalizeAgyEvent(
  raw: unknown,
  state: AgyEventState,
): NormalizedAgentEvent[] {
  const root = recordValue(raw);
  if (!root) return [];
  const type = eventType(root);
  if (type === "result" || type.endsWith("result")) {
    const finalText = textFrom(root.result) ?? textFrom(root);
    const events = completeActiveActivities(state);
    if (finalText && !state.messageStarted) {
      state.messageStarted = true;
      state.assistantText = finalText;
      events.push({
        type: "messageStarted",
        id: state.messageId,
        phase: "final",
        text: finalText,
      });
    } else if (finalText && finalText !== state.assistantText) {
      const delta = finalText.startsWith(state.assistantText)
        ? finalText.slice(state.assistantText.length)
        : finalText;
      state.assistantText = finalText;
      events.push({ type: "messageDelta", id: state.messageId, delta });
    }
    if (state.messageStarted) {
      events.push({
        type: "messageCompleted",
        id: state.messageId,
        phase: "final",
        text: state.assistantText,
      });
    }
    events.push({ type: "turnCompleted", status: "completed" });
    return events;
  }
  if (!type.includes("step")) return [];

  const step = stepRecord(root);
  const stepType = eventType(step) || type;
  const textDelta = stringValue(step.text_delta) ?? stringValue(step.textDelta);
  const text = textDelta ?? textFrom(step) ?? "";
  if (isAssistantStep(stepType) && text) {
    if (!state.messageStarted) {
      state.messageStarted = true;
      state.assistantText = text;
      return [{
        type: "messageStarted",
        id: state.messageId,
        phase: stepType.includes("thought") ? "analysis" : "final",
        text,
      }];
    }
    if (textDelta !== undefined) {
      state.assistantText += textDelta;
      return [{ type: "messageDelta", id: state.messageId, delta: textDelta }];
    }
    const delta = text.startsWith(state.assistantText)
      ? text.slice(state.assistantText.length)
      : text;
    if (!delta) return [];
    state.assistantText = text.startsWith(state.assistantText)
      ? text
      : `${state.assistantText}${text}`;
    return [{ type: "messageDelta", id: state.messageId, delta }];
  }

  const toolInfo = recordValue(step.tool_info) ?? recordValue(step.toolInfo);
  const declaredToolName =
    stringValue(step.tool_name) ?? stringValue(step.toolName);
  if (!toolInfo && !declaredToolName && !stepType.includes("tool")) return [];
  const tool = toolInfo ?? step;
  const toolName =
    stringValue(tool.name) ?? declaredToolName ?? stringValue(tool.tool_name) ?? stringValue(tool.toolName) ??
    stringValue(stepType.replace(/^(tool_|tool-)/u, "")) ?? "Antigravity tool";
  const externalId =
    stringValue(tool.id) ?? stringValue(step.id) ?? stringValue(root.id);
  const stepIndex =
    typeof step.step_index === "number" && Number.isSafeInteger(step.step_index)
      ? step.step_index
      : typeof step.stepIndex === "number" && Number.isSafeInteger(step.stepIndex)
        ? step.stepIndex
        : undefined;
  const id = externalId ?? (stepIndex === undefined
    ? `agy-activity-${++state.activitySequence}`
    : `agy-step-${stepIndex}`);
  const existing = state.activities.get(id);
  const title = normalizedActivityTitle(toolName);
  const activityText = normalizedActivityText(text || JSON.stringify(tool));
  const completed = /done|complete|completed|finish|finished|result|success|error|failed/u.test(
    `${stepType} ${stringValue(step.state) ?? ""}`.toLowerCase(),
  );
  if (!existing) {
    state.activities.set(id, {
      kind: activityKind(stepType, toolName),
      title,
      text: activityText,
      started: true,
      completed,
    });
    if (completed) {
      return [{
        type: "activityCompleted",
        id,
        kind: activityKind(stepType, toolName),
        title,
        text: activityText,
        status: "completed",
      }];
    }
    return [{
      type: "activityStarted",
      id,
      kind: activityKind(stepType, toolName),
      title,
      text: activityText,
    }];
  }
  if (completed && !existing.completed) {
    existing.completed = true;
    existing.text = activityText || existing.text;
    return [{
      type: "activityCompleted",
      id,
      kind: existing.kind,
      title: existing.title,
      text: existing.text,
      status: "completed",
    }];
  }
  if (activityText && activityText !== existing.text) {
    const delta = activityText.startsWith(existing.text)
      ? activityText.slice(existing.text.length)
      : activityText;
    existing.text = activityText;
    return [{ type: "activityDelta", id, delta }];
  }
  return [];
}

export function mapEffortToAgy(effort: RunnerRequest["effort"]) {
  if (!effort) return undefined;
  return effort === "xhigh" || effort === "max" || effort === "ultra"
    ? "high"
    : effort;
}

export function buildAgyPrompt(request: RunnerRequest) {
  const sections: string[] = [];
  if (request.instructions?.trim()) {
    sections.push(`<briar_trusted_instructions>\n${request.instructions.trim()}\n</briar_trusted_instructions>`);
  }
  if (!request.networkAccess) {
    sections.push("Do not use network, browser, web-search, or URL-fetching tools for this turn.");
  }
  if (request.attachments?.length) {
    sections.push(
      `Attached files:\n${request.attachments.map((attachment) => `@${attachment.path}`).join("\n")}`,
    );
  }
  sections.push(request.message);
  return sections.join("\n\n");
}

export function agyArgs(request: RunnerRequest) {
  const args = ["--output-format", "stream-json"];
  if (request.outputSchema !== null && request.outputSchema !== undefined) {
    args.push("--json-schema", JSON.stringify(request.outputSchema));
  }
  if (request.model?.trim()) args.push("--model", request.model.trim());
  const effort = mapEffortToAgy(request.effort);
  if (effort) args.push("--effort", effort);
  if (request.conversationId?.trim()) {
    args.push("--conversation", request.conversationId.trim());
  }
  if (request.sandboxMode !== "dangerFullAccess") args.push("--sandbox");
  args.push("--mode", request.sandboxMode === "readOnly" ? "plan" : "accept-edits");
  if (request.approvalPolicy === "never" && request.sandboxMode !== "readOnly") {
    args.push("--dangerously-skip-permissions");
  }
  args.push("--print", buildAgyPrompt(request));
  return args;
}

export function agyEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  for (const key of [
    "AGY_ADC_AUTH",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]) {
    delete sanitized[key];
  }
  return sanitized;
}

export function agyFinalMessage(raw: unknown, fallback: string) {
  const root = recordValue(raw);
  return (root ? textFrom(root.result) ?? textFrom(root) : undefined) ?? fallback;
}

const transientUpstreamStatusCodes = new Set([502, 503, 504]);

function agyProviderBlockPayload(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  const root = recordValue(value);
  if (!root) return null;
  const step = stepRecord(root);
  const type = eventType(root);
  if (type === "diagnostic") {
    return stringValue(root.text) ?? stringValue(root.message) ?? null;
  }
  if (root.error !== undefined) return root.error;
  if (step.error !== undefined) return step.error;
  const failureSignal = [
    type,
    stringValue(root.status),
    stringValue(root.state),
    eventType(step),
    stringValue(step.status),
    stringValue(step.state),
  ].filter(Boolean).join(" ");
  return /error|fail|blocked|retry|exhausted/iu.test(failureSignal)
    ? step
    : null;
}

function transientUpstreamStatusCode(
  value: unknown,
  depth = 0,
): 502 | 503 | 504 | null {
  if (depth > 4) return null;
  if (typeof value === "string") {
    const match = value.match(
      /\[(502|503|504)\]|\b(?:HTTP|status(?:\s*code)?)\D{0,8}(502|503|504)\b|\b(502|503|504)\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout)\b/iu,
    );
    const parsed = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
    return transientUpstreamStatusCodes.has(parsed)
      ? (parsed as 502 | 503 | 504)
      : null;
  }
  const record = recordValue(value);
  if (!record) return null;
  for (const key of ["status", "statusCode", "code"]) {
    const parsed = Number(record[key]);
    if (transientUpstreamStatusCodes.has(parsed)) {
      return parsed as 502 | 503 | 504;
    }
  }
  for (const nested of Object.values(record)) {
    const statusCode = transientUpstreamStatusCode(nested, depth + 1);
    if (statusCode) return statusCode;
  }
  return null;
}

export function agyBlockedRetry(value: unknown): AgyBlockedRetry | null {
  const payload = agyProviderBlockPayload(value);
  if (payload === null) return null;
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  const message = textFrom(payload) ?? serialized;
  if (/resource_exhausted|quota|usage (?:limit|exhausted)|rate limit/i.test(serialized)) {
    return { reason: "usage_exhausted", provider: "agy", message, nextRetryAt: null };
  }
  const statusCode = transientUpstreamStatusCode(payload);
  if (statusCode) {
    return {
      reason: "upstream_overloaded",
      provider: "agy",
      message,
      nextRetryAt: null,
      statusCode,
    };
  }
  return null;
}
