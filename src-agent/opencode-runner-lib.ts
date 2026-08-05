import type {
  Part,
  PermissionRuleset,
  QuestionRequest,
} from "@opencode-ai/sdk/v2";

export type OpenCodeRunnerRequest = {
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
  opencodeBinary: string;
};

export type OpenCodeApprovalResponse = {
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
  | { type: "messageDelta"; id: string; delta: string }
  | {
      type: "messageCompleted";
      id: string;
      phase: string | null;
      text: string;
    }
  | { type: "turnCompleted"; status: string };

export type OpenCodeRunnerOutput =
  | { type: "session"; sessionId: string }
  | { type: "event"; raw: unknown; event?: NormalizedAgentEvent }
  | {
      type: "approval";
      id: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
    }
  | { type: "result"; sessionId: string; message: string }
  | { type: "error"; message: string };

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
  effort: OpenCodeRunnerRequest["effort"],
): string | undefined {
  if (!effort) return undefined;
  if (effort === "ultra" || effort === "max" || effort === "xhigh") {
    return "high";
  }
  return effort;
}

export function buildOpenCodePrompt(request: OpenCodeRunnerRequest): string {
  const sections: string[] = [];
  const instructions = request.instructions?.trim();
  if (instructions) {
    sections.push(`Additional instructions for this turn:\n${instructions}`);
  }
  if (request.outputSchema !== null && request.outputSchema !== undefined) {
    sections.push(
      `Return only the JSON value that matches this schema, without Markdown fences or commentary:\n${JSON.stringify(request.outputSchema)}`,
    );
  }
  sections.push(request.message);
  return sections.join("\n\n");
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
  request: OpenCodeRunnerRequest,
  permission: string,
): boolean {
  if (
    request.sandboxMode === "readOnly" &&
    isOpenCodeWritePermission(permission)
  ) {
    return false;
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
  request: OpenCodeRunnerRequest,
): PermissionRuleset {
  const defaultAction =
    request.sandboxMode === "dangerFullAccess" ||
    request.approvalPolicy === "never"
      ? "allow"
      : "ask";
  return [
    { permission: "*", pattern: "*", action: defaultAction },
    ...(request.sandboxMode === "readOnly"
      ? Array.from(writePermissions, (permission) => ({
          permission,
          pattern: "*",
          action: "deny" as const,
        }))
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
      return { type: "messageCompleted", id: messageId, phase, text };
    }
    return { type: "messageStarted", id: messageId, phase, text };
  }

  if (complete) {
    state.completedMessages.add(messageId);
    return { type: "messageCompleted", id: messageId, phase, text };
  }

  if (text.startsWith(previous) && text.length > previous.length) {
    return {
      type: "messageDelta",
      id: messageId,
      delta: text.slice(previous.length),
    };
  }

  // Non-prefix snapshot updates still need a durable full-text event. Re-emit
  // messageStarted so transcript consumers replace the visible body without
  // inventing a second message id.
  if (text !== previous) {
    return { type: "messageStarted", id: messageId, phase, text };
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
    events.push({ type: "turnCompleted", status: "completed" });
    return events;
  }

  if (event.type === "session.error") {
    return [{ type: "turnCompleted", status: "failed" }];
  }
  return [];
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
