import type {
  Part,
  PermissionRuleset,
  QuestionRequest,
} from "@opencode-ai/sdk/v2";
import { pathToFileURL } from "node:url";
import {
  AgentActivityKind,
  AgentActivityStatus,
  type NormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  normalizedActivityCompleted,
  normalizedActivityDelta,
  normalizedActivityStarted,
  normalizedActivityText,
  normalizedActivityTitle,
  normalizedMessageCompleted,
  normalizedMessageDelta,
  normalizedMessageStarted,
  normalizedTurnCompleted,
} from "./normalized-agent-event";
import type { RunnerRequest } from "./runner-request";
import {
  classifyProviderFailure,
  type ProviderBlock,
} from "./provider-block";

export type OpenCodeBlockedRetry = ProviderBlock;

export type OpenCodeEventState = {
  messageRoles: Map<string, "user" | "assistant">;
  parts: Map<string, Part>;
  /** Current text content for each text/reasoning part. */
  partText: Map<string, string>;
  /** Ordered part IDs that contribute text for each assistant message. */
  messagePartOrder: Map<string, string[]>;
  /** Last emitted agent-message text for each assistant message ID. */
  emittedText: Map<string, string>;
  startedMessages: Set<string>;
  completedMessages: Set<string>;
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

export function createOpenCodeEventState(): OpenCodeEventState {
  return {
    messageRoles: new Map(),
    parts: new Map(),
    partText: new Map(),
    messagePartOrder: new Map(),
    emittedText: new Map(),
    startedMessages: new Set(),
    completedMessages: new Set(),
    activities: new Map(),
  };
}

export function parseOpenCodeServerUrl(output: string): string | undefined {
  for (const line of output.split("\n")) {
    if (!line.toLowerCase().includes("opencode server listening")) continue;
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/i);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function parseOpenCodeModel(
  model: string | null | undefined,
): { providerID: string; modelID: string } | undefined {
  const value = model?.trim();
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return {
    providerID: value.slice(0, separator),
    modelID: value.slice(separator + 1),
  };
}

export function mapEffortToOpenCode(
  effort: RunnerRequest["effort"],
): string | undefined {
  if (!effort) return undefined;
  return effort;
}

export function buildOpenCodePrompt(request: RunnerRequest): string {
  const sections: string[] = [];
  if (request.outputSchema !== null && request.outputSchema !== undefined) {
    sections.push(
      `Return only the JSON value that matches this schema, without Markdown fences or commentary:\n${JSON.stringify(request.outputSchema)}`,
    );
  }
  sections.push(request.message);
  return sections.join("\n\n");
}

export function openCodeSystemPrompt(
  request: RunnerRequest,
): string | undefined {
  return request.instructions?.trim() || undefined;
}

export function buildOpenCodeParts(request: RunnerRequest) {
  return [
    { type: "text" as const, text: buildOpenCodePrompt(request) },
    ...(request.attachments ?? []).map((attachment) => ({
      type: "file" as const,
      mime: attachment.mimeType,
      filename: attachment.name,
      url: pathToFileURL(attachment.path).href,
    })),
  ];
}

const writePermissions = new Set([
  "bash",
  "edit",
  "external_directory",
  "filesystem",
  "patch",
  "shell",
  "write",
]);

const readOnlyPermissions = new Set(["glob", "grep", "list", "read"]);

function isOpenCodeReadOnlyPermission(
  request: RunnerRequest,
  permission: string,
) {
  const normalized = permission.trim().toLowerCase();
  return readOnlyPermissions.has(normalized) ||
    normalized === "question" ||
    (request.networkAccess &&
      (normalized === "webfetch" || normalized === "websearch"));
}

export function isOpenCodeWritePermission(permission: string): boolean {
  const normalized = permission.trim().toLowerCase();
  return (
    writePermissions.has(normalized) ||
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("shell") ||
    normalized.includes("bash")
  );
}

export function shouldAutoApproveOpenCodePermission(
  request: RunnerRequest,
  permission: string,
): boolean {
  if (request.sandboxMode === "readOnly") {
    return isOpenCodeReadOnlyPermission(request, permission);
  }
  if (
    request.sandboxMode === "workspaceWrite" &&
    permission.trim().toLowerCase() === "external_directory"
  ) {
    return false;
  }
  return (
    request.sandboxMode === "dangerFullAccess" ||
    request.approvalPolicy === "never"
  );
}

export function buildOpenCodePermissionRules(
  request: RunnerRequest,
): PermissionRuleset {
  const defaultAction = request.sandboxMode === "readOnly"
    ? "deny"
    : request.sandboxMode === "dangerFullAccess" ||
    request.approvalPolicy === "never"
      ? "allow"
      : "ask";
  return [
    { permission: "*", pattern: "*", action: defaultAction },
    ...(request.sandboxMode === "readOnly"
      ? [
          ...Array.from(readOnlyPermissions, (permission) => ({
            permission,
            pattern: "*",
            action: "allow" as const,
          })),
          ...(request.networkAccess
            ? ["webfetch", "websearch"].map((permission) => ({
                permission,
                pattern: "*",
                action: "allow" as const,
              }))
            : []),
          {
            permission: "external_directory",
            pattern: "*",
            action: "deny" as const,
          },
        ]
      : request.sandboxMode === "workspaceWrite"
        ? [
            {
              permission: "external_directory",
              pattern: "*",
              action: "deny" as const,
            },
          ]
        : []),
    ...(!request.networkAccess
      ? [
          { permission: "webfetch", pattern: "*", action: "deny" as const },
          { permission: "websearch", pattern: "*", action: "deny" as const },
        ]
      : []),
    { permission: "question", pattern: "*", action: "allow" },
  ];
}

function textFromPart(part: Part | undefined): string | undefined {
  return part?.type === "text" || part?.type === "reasoning"
    ? part.text
    : undefined;
}

function eventSessionId(event: Record<string, unknown>): string | undefined {
  const properties = event.properties;
  if (!properties || typeof properties !== "object") return undefined;
  const sessionID = (properties as { sessionID?: unknown }).sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}

const transientUpstreamStatusCodes = new Set([502, 503, 504]);

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
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
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

function openCodeErrorMessage(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const decoded = JSON.parse(trimmed);
        if (typeof decoded === "string" && decoded.trim()) return decoded.trim();
      } catch {
        // Keep the provider's original message when it is not valid JSON.
      }
    }
    return trimmed;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "data"]) {
    const message = openCodeErrorMessage(record[key], depth + 1);
    if (message) return message;
  }
  return null;
}

function openCodeErrorName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * Read a human message out of the OpenCode `session.error` payload, which is
 * shaped like `{ name, data: { message } }` but degrades to plain strings and
 * nested `error`/`message` objects depending on the provider.
 */
export function openCodeSessionErrorMessage(error: unknown): string {
  return (
    openCodeErrorMessage(error) ??
    openCodeErrorName(error) ??
    "OpenCode reported a session error without a message."
  );
}

function openCodeStatusCode(value: unknown, depth = 0): number | null {
  if (depth > 4 || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["statusCode", "status", "httpStatus"]) {
    const parsed = Number(record[key]);
    if (Number.isInteger(parsed) && parsed >= 400 && parsed < 600) return parsed;
  }
  for (const nested of Object.values(record)) {
    const statusCode = openCodeStatusCode(nested, depth + 1);
    if (statusCode) return statusCode;
  }
  return null;
}

const openCodeErrorNameCodes = new Map<string, string>([
  ["ProviderAuthError", "authentication_failed"],
  ["ContextOverflowError", "context_window_exceeded"],
  ["ContextWindowExceededError", "context_window_exceeded"],
]);

/**
 * Classify an OpenCode `session.error` or assistant-response error. OpenCode
 * wraps the upstream model provider's failure as `{ name, data: { message,
 * statusCode } }`; the status and message carry the provider's rate limit,
 * credit, auth, or overload signal.
 */
export function openCodeProviderBlock(
  error: unknown,
  provider = "opencode",
): OpenCodeBlockedRetry | null {
  const name = openCodeErrorName(error);
  const message = openCodeErrorMessage(error) ?? name ?? "";
  if (!message) return null;
  return classifyProviderFailure({
    provider,
    message,
    code: name ? openCodeErrorNameCodes.get(name) : undefined,
    statusCode: openCodeStatusCode(error) ?? transientUpstreamStatusCode(error),
  });
}

/** Kept as the name the runner and tests use for response-level errors. */
export const openCodeTransientOverload = openCodeProviderBlock;

/**
 * Detect OpenCode provider states that should release the worker for a later
 * retry instead of leaving the issue failed or the prompt request open.
 */
export function openCodeBlockedRetry(
  raw: unknown,
  sessionId: string,
  provider = "opencode",
): OpenCodeBlockedRetry | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  if (eventSessionId(event) !== sessionId) {
    return null;
  }
  const properties = event.properties as Record<string, unknown>;
  if (event.type === "session.error") {
    return openCodeProviderBlock(properties.error, provider);
  }
  if (event.type !== "session.status") return null;
  const status = properties.status;
  if (!status || typeof status !== "object") return null;
  const retry = status as Record<string, unknown>;
  if (retry.type !== "retry") return null;
  const action = retry.action;
  const blocker = action && typeof action === "object"
    ? action as Record<string, unknown>
    : null;
  const retryMessage = typeof retry.message === "string"
    ? retry.message.trim()
    : "";
  const isFreeTierLimit = blocker?.reason === "free_tier_limit" ||
    /\bfree usage exceeded\b/iu.test(retryMessage);
  if (!isFreeTierLimit) return null;

  const next = retry.next;
  const nextRetryDate =
    typeof next === "number" && Number.isFinite(next) ? new Date(next) : null;
  return {
    reason: "free_tier_limit",
    provider:
      typeof blocker?.provider === "string" && blocker.provider.trim()
        ? blocker.provider.trim()
        : provider,
    message:
      typeof blocker?.message === "string" && blocker.message.trim()
        ? blocker.message.trim()
        : retryMessage
          ? retryMessage
          : "OpenCode free usage limit reached.",
    nextRetryAt:
      nextRetryDate && !Number.isNaN(nextRetryDate.getTime())
        ? nextRetryDate.toISOString()
        : null,
  };
}

export type OpenCodeTerminalOutcome =
  | { type: "blocked"; blocker: OpenCodeBlockedRetry }
  | { type: "failed"; message: string };

/**
 * Decide whether an OpenCode event must end the run and why.
 *
 * OpenCode reports fatal model failures (usage limits, auth, bad requests) as
 * `session.error` and then never finishes the assistant message, so
 * `session.prompt()` never resolves. Transient upstream overload still becomes
 * a resumable block; every other session error for our session is terminal.
 */
export function openCodeTerminalOutcome(
  raw: unknown,
  sessionId: string,
  provider = "opencode",
): OpenCodeTerminalOutcome | null {
  const blocker = openCodeBlockedRetry(raw, sessionId, provider);
  if (blocker) return { type: "blocked", blocker };
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  if (event.type !== "session.error") return null;
  if (eventSessionId(event) !== sessionId) return null;
  const properties = event.properties as Record<string, unknown>;
  return {
    type: "failed",
    message: openCodeSessionErrorMessage(properties.error),
  };
}

export type OpenCodeRunnerSignal = "SIGTERM" | "SIGINT";

export type OpenCodeRunnerSignalHandlers = {
  /** Registers a one-shot listener, normally `process.once`. */
  on: (signal: OpenCodeRunnerSignal, listener: () => void) => void;
  exit: (code: number) => void;
  /** Terminates the `opencode serve` process group and temporary state. */
  close: (signal: OpenCodeRunnerSignal) => void;
};

function openCodeRunnerSignalExitCode(signal: OpenCodeRunnerSignal): number {
  return signal === "SIGINT" ? 130 : 143;
}

/**
 * Stop the `opencode serve` child before the runner dies. Without this the
 * worker's SIGTERM only kills the runner and leaves the OpenCode server (and
 * its model calls) running forever.
 */
export function installOpenCodeRunnerSignalHandlers(
  handlers: OpenCodeRunnerSignalHandlers,
): void {
  let handled = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    handlers.on(signal, () => {
      if (handled) return;
      handled = true;
      try {
        handlers.close(signal);
      } catch {
        // A failed cleanup must never keep the runner alive.
      }
      handlers.exit(openCodeRunnerSignalExitCode(signal));
    });
  }
}

export type OpenCodeUnhandledRejectionHandlers = {
  /** Reports the swallowed abort so the host's stderr log explains itself. */
  diagnose: (phase: string, detail?: Record<string, unknown>) => void;
  /** Bun's default behaviour for a rejection the runner does not own. */
  fail: (reason: unknown) => void;
};

export type OpenCodeUnhandledRejectionGuard = {
  /**
   * Declares an abort reason the runner is about to raise itself. Only the
   * exact object registered here is ever swallowed.
   */
  expect: (reason: unknown) => void;
  /** Listener for `process.on("unhandledRejection", ...)`. */
  handle: (reason: unknown) => void;
};

/**
 * Keep the runner alive through its own event-stream abort.
 *
 * The OpenCode SDK's SSE client reacts to an aborted signal with a bare
 * `void reader.cancel()`. Under Bun that promise rejects with the signal's
 * reason and nobody awaits it, so Bun kills the process with exit code 1 even
 * though the turn already finished and its result frame is on stdout.
 *
 * The guard swallows only the reason object the runner registered through
 * `expect` — identity, not "any AbortError" — so a genuine unhandled rejection
 * (including an AbortError from anywhere else) still fails the runner.
 */
export function createOpenCodeUnhandledRejectionGuard(
  handlers: OpenCodeUnhandledRejectionHandlers,
): OpenCodeUnhandledRejectionGuard {
  const expected = new Set<unknown>();
  return {
    expect: (reason) => {
      if (reason === null || typeof reason !== "object") return;
      expected.add(reason);
    },
    handle: (reason) => {
      if (reason !== null && typeof reason === "object" && expected.has(reason)) {
        expected.delete(reason);
        handlers.diagnose("runner.event_stream_abort_ignored", {
          reason: reason instanceof Error ? reason.message : String(reason),
        });
        return;
      }
      handlers.fail(reason);
    },
  };
}

function rememberMessagePart(state: OpenCodeEventState, messageId: string, partId: string) {
  const order = state.messagePartOrder.get(messageId) ?? [];
  if (!order.includes(partId)) {
    order.push(partId);
    state.messagePartOrder.set(messageId, order);
  }
}

function messageText(state: OpenCodeEventState, messageId: string): string {
  const order = state.messagePartOrder.get(messageId) ?? [];
  return order
    .map((partId) => state.partText.get(partId) ?? "")
    .filter(Boolean)
    .join("");
}

/**
 * Convert accumulated OpenCode text into Briar agent events.
 *
 * Detached workers drop `messageDelta` from the durable transcript, so each
 * visible work-log entry must land as `messageStarted` and especially
 * `messageCompleted` with the full text under a stable message ID.
 */
function emitForMessageText(
  state: OpenCodeEventState,
  messageId: string,
  options: { complete?: boolean; phase?: string | null } = {},
): NormalizedAgentEvent | undefined {
  if (state.completedMessages.has(messageId)) return undefined;
  const text = messageText(state, messageId);
  const previous = state.emittedText.get(messageId) ?? "";
  const complete = Boolean(options.complete);
  const phase = options.phase ?? "commentary";

  if (!text) {
    if (complete) {
      // Empty complete messages are not useful in the work log.
      state.completedMessages.add(messageId);
    }
    return undefined;
  }

  state.emittedText.set(messageId, text);

  if (!state.startedMessages.has(messageId)) {
    state.startedMessages.add(messageId);
    if (complete) {
      state.completedMessages.add(messageId);
      return normalizedMessageCompleted({ id: messageId, phase, text });
    }
    return normalizedMessageStarted({ id: messageId, phase, text });
  }

  if (complete) {
    state.completedMessages.add(messageId);
    return normalizedMessageCompleted({ id: messageId, phase, text });
  }

  if (text.startsWith(previous) && text.length > previous.length) {
    return normalizedMessageDelta({
      id: messageId,
      delta: text.slice(previous.length),
    });
  }

  // Non-prefix snapshot updates still need a durable full-text event. Re-emit
  // messageStarted so transcript consumers replace the visible body without
  // inventing a second message id.
  if (text !== previous) {
    return normalizedMessageStarted({ id: messageId, phase, text });
  }
  return undefined;
}

function setPartText(
  state: OpenCodeEventState,
  messageId: string,
  partId: string,
  text: string,
) {
  rememberMessagePart(state, messageId, partId);
  state.partText.set(partId, text);
}

function appendPartText(
  state: OpenCodeEventState,
  messageId: string,
  partId: string,
  delta: string,
) {
  rememberMessagePart(state, messageId, partId);
  state.partText.set(partId, `${state.partText.get(partId) ?? ""}${delta}`);
}

/** Normalize the OpenCode events Briar needs while preserving every raw event. */
export function normalizeOpenCodeEvent(
  raw: unknown,
  sessionId: string,
  state: OpenCodeEventState,
): NormalizedAgentEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const event = raw as Record<string, unknown>;
  if (eventSessionId(event) !== sessionId) return [];
  const properties = event.properties as Record<string, unknown>;

  if (event.type === "message.updated") {
    const info = properties.info;
    if (!info || typeof info !== "object") return [];
    const message = info as {
      id?: unknown;
      role?: unknown;
      time?: { completed?: unknown };
    };
    if (
      typeof message.id !== "string" ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      return [];
    }
    const wasAssistant = state.messageRoles.get(message.id) === "assistant";
    state.messageRoles.set(message.id, message.role);
    if (message.role !== "assistant") return [];

    const events: NormalizedAgentEvent[] = [];
    // Role can arrive after part text has already been buffered.
    if (!wasAssistant && messageText(state, message.id)) {
      const started = emitForMessageText(state, message.id);
      if (started) events.push(started);
    }

    if (message.time?.completed != null) {
      const completed = emitForMessageText(state, message.id, {
        complete: true,
        phase: "commentary",
      });
      if (completed) events.push(completed);
    }
    return events;
  }

  if (event.type === "message.part.updated") {
    const part = properties.part as Part | undefined;
    if (!part?.id || !part.messageID) return [];
    state.parts.set(part.id, part);
    if (part.type === "tool") {
      return normalizeOpenCodeActivity(part, state);
    }
    const text = textFromPart(part);
    if (text === undefined) return [];
    setPartText(state, part.messageID, part.id, text);
    if (state.messageRoles.get(part.messageID) !== "assistant") return [];
    // Completing on individual part end is wrong when an assistant message
    // still has more text after tools. Only stream progress here; complete on
    // message.time.completed, session.idle, or the final runner response.
    const normalized = emitForMessageText(state, part.messageID);
    return normalized ? [normalized] : [];
  }

  if (event.type === "message.part.delta") {
    const partID = properties.partID;
    const messageID =
      typeof properties.messageID === "string"
        ? properties.messageID
        : state.parts.get(typeof partID === "string" ? partID : "")?.messageID;
    const delta = properties.delta;
    const field = properties.field;
    if (
      typeof partID !== "string" ||
      typeof messageID !== "string" ||
      typeof delta !== "string" ||
      !delta
    ) {
      return [];
    }
    const part = state.parts.get(partID);
    if (
      part?.type === "tool" &&
      (field === "output" || field === "state.output")
    ) {
      const id = part.callID || part.id;
      const activity = state.activities.get(id);
      if (!activity || activity.completed) return [];
      activity.text = normalizedActivityText(`${activity.text}${delta}`);
      return [normalizedActivityDelta({ id, delta })];
    }
    // OpenCode streams text on field "text"; ignore tool-input and other fields.
    if (typeof field === "string" && field !== "text") return [];
    appendPartText(state, messageID, partID, delta);
    if (state.messageRoles.get(messageID) !== "assistant") return [];
    const normalized = emitForMessageText(state, messageID);
    return normalized ? [normalized] : [];
  }

  if (event.type === "message.part.removed") {
    const partID = properties.partID;
    const messageID = properties.messageID;
    if (typeof partID !== "string" || typeof messageID !== "string") {
      return [];
    }
    state.parts.delete(partID);
    state.partText.delete(partID);
    const order = state.messagePartOrder.get(messageID);
    if (order) {
      state.messagePartOrder.set(
        messageID,
        order.filter((id) => id !== partID),
      );
    }
    if (state.messageRoles.get(messageID) !== "assistant") return [];
    const normalized = emitForMessageText(state, messageID);
    return normalized ? [normalized] : [];
  }

  if (event.type === "session.idle") {
    // Complete any open assistant messages when the session returns to idle so
    // durable transcripts never leave "writing…" placeholders behind.
    const events = completeOpenCodeMessages(state, { phase: "commentary" });
    events.push(normalizedTurnCompleted("completed"));
    return events;
  }

  if (event.type === "session.error") {
    return [normalizedTurnCompleted("failed")];
  }
  return [];
}

function normalizeOpenCodeActivity(
  part: Extract<Part, { type: "tool" }>,
  state: OpenCodeEventState,
): NormalizedAgentEvent[] {
  const id = part.callID || part.id;
  const existing = state.activities.get(id);
  const kind = openCodeActivityKind(part.tool);
  const partState = part.state;
  const title = normalizedActivityTitle(
    openCodeActivityTitle(part.tool, partState, existing?.title),
  );
  const text = normalizedActivityText(
    partState.status === "completed"
      ? partState.output
      : partState.status === "error"
        ? partState.error
        : existing?.text ?? "",
  );
  const activity = {
    kind,
    title,
    text,
    started: existing?.started ?? false,
    completed: existing?.completed ?? false,
  };
  const events: NormalizedAgentEvent[] = [];
  if (!activity.started) {
    activity.started = true;
    events.push(normalizedActivityStarted({ id, kind, title, text: "" }));
  }
  if (
    !activity.completed &&
    (partState.status === "completed" || partState.status === "error")
  ) {
    activity.completed = true;
    events.push(normalizedActivityCompleted({
      id,
      kind,
      title,
      text,
      status: partState.status === "error"
        ? AgentActivityStatus.FAILED
        : AgentActivityStatus.COMPLETED,
    }));
  }
  state.activities.set(id, activity);
  return events;
}

function openCodeActivityKind(tool: string): AgentActivityKind {
  const normalized = tool.toLowerCase();
  if (normalized === "bash" || normalized === "shell") {
    return AgentActivityKind.COMMAND;
  }
  if (
    normalized === "edit" ||
    normalized === "write" ||
    normalized === "patch" ||
    normalized === "apply_patch"
  ) {
    return AgentActivityKind.FILE_CHANGE;
  }
  if (normalized === "webfetch" || normalized === "websearch") {
    return AgentActivityKind.WEB_SEARCH;
  }
  return AgentActivityKind.TOOL;
}

function openCodeActivityTitle(
  tool: string,
  state: Extract<Part, { type: "tool" }>["state"],
  previous: string | undefined,
): string {
  if ("title" in state && typeof state.title === "string" && state.title) {
    return state.title;
  }
  if (previous) return previous;
  if (tool.toLowerCase() === "bash" && typeof state.input.command === "string") {
    return state.input.command;
  }
  for (const key of ["filePath", "file_path", "path"]) {
    if (typeof state.input[key] === "string") return state.input[key];
  }
  return tool;
}

/**
 * Finish any open assistant messages after OpenCode returns the final response.
 * Prefer the response text when provided so the durable work log shows the
 * same final body the runner reports as its result.
 */
export function completeOpenCodeMessages(
  state: OpenCodeEventState,
  options: {
    messageId?: string | null;
    text?: string | null;
    phase?: string | null;
  } = {},
): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  const phase = options.phase ?? "final";
  if (options.messageId && options.text != null && options.text !== "") {
    const messageId = options.messageId;
    // Final runner text wins over any earlier idle/message completion so the
    // durable work log shows the same body as the OpenCode result.
    state.completedMessages.delete(messageId);
    const previousParts = state.messagePartOrder.get(messageId) ?? [];
    for (const partId of previousParts) {
      state.partText.delete(partId);
    }
    const syntheticPartId = `${messageId}:result`;
    state.messagePartOrder.set(messageId, [syntheticPartId]);
    state.partText.set(syntheticPartId, options.text);
    state.messageRoles.set(messageId, "assistant");
    const completed = emitForMessageText(state, messageId, {
      complete: true,
      phase,
    });
    if (completed) events.push(completed);
  }

  for (const [messageId, role] of state.messageRoles) {
    if (role !== "assistant" || state.completedMessages.has(messageId)) {
      continue;
    }
    const completed = emitForMessageText(state, messageId, {
      complete: true,
      phase: "commentary",
    });
    if (completed) events.push(completed);
  }
  return events;
}

export function openCodePermissionInput(properties: Record<string, unknown>) {
  const patterns = Array.isArray(properties.patterns)
    ? properties.patterns.filter((value): value is string => typeof value === "string")
    : [];
  const metadata =
    properties.metadata && typeof properties.metadata === "object"
      ? (properties.metadata as Record<string, unknown>)
      : {};
  return { ...metadata, patterns };
}

export function openCodeQuestionInput(request: QuestionRequest) {
  return {
    questions: request.questions.map((question) => ({
      header: question.header,
      question: question.question,
      options: question.options,
      multiple: question.multiple ?? false,
    })),
  };
}

export function approvedOpenCodeQuestionAnswers(
  request: QuestionRequest,
): string[][] {
  return request.questions.map((question) => {
    const first = question.options[0]?.label;
    return first ? [first] : [];
  });
}

export function openCodeResponseText(parts: readonly Part[]): string {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}
