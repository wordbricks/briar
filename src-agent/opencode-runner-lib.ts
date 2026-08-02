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
  emittedText: Map<string, string>;
};

export function createOpenCodeEventState(): OpenCodeEventState {
  return {
    messageRoles: new Map(),
    parts: new Map(),
    emittedText: new Map(),
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

/** Normalize the OpenCode events Briar needs while preserving every raw event. */
export function normalizeOpenCodeEvent(
  raw: unknown,
  sessionId: string,
  state: OpenCodeEventState,
): NormalizedAgentEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const event = raw as Record<string, unknown>;
  if (eventSessionId(event) !== sessionId) return undefined;
  const properties = event.properties as Record<string, unknown>;

  if (event.type === "message.updated") {
    const info = properties.info;
    if (info && typeof info === "object") {
      const message = info as { id?: unknown; role?: unknown };
      if (
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant")
      ) {
        state.messageRoles.set(message.id, message.role);
      }
    }
    return undefined;
  }

  if (event.type === "message.part.updated") {
    const part = properties.part as Part | undefined;
    if (!part?.id) return undefined;
    state.parts.set(part.id, part);
    if (state.messageRoles.get(part.messageID) !== "assistant") return undefined;
    const text = textFromPart(part);
    if (text === undefined) return undefined;
    const previous = state.emittedText.get(part.id);
    state.emittedText.set(part.id, text);
    if (previous === undefined) {
      return {
        type: "messageStarted",
        id: part.id,
        phase: "commentary",
        text,
      };
    }
    if (text.startsWith(previous) && text.length > previous.length) {
      return { type: "messageDelta", id: part.id, delta: text.slice(previous.length) };
    }
    return undefined;
  }

  if (event.type === "message.part.delta") {
    const partID = properties.partID;
    const delta = properties.delta;
    if (typeof partID !== "string" || typeof delta !== "string" || !delta) {
      return undefined;
    }
    const part = state.parts.get(partID);
    if (!part || state.messageRoles.get(part.messageID) !== "assistant") {
      return undefined;
    }
    state.emittedText.set(partID, `${state.emittedText.get(partID) ?? ""}${delta}`);
    return { type: "messageDelta", id: partID, delta };
  }

  if (event.type === "session.error") {
    return { type: "turnCompleted", status: "failed" };
  }
  return undefined;
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
