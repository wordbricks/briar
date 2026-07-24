import type {
  CanUseTool,
  Options,
  PermissionResult,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type ClaudeRunnerRequest = {
  type: "run";
  message: string;
  workspaceRoot: string;
  conversationId?: string | null;
  instructions?: string | null;
  outputSchema?: Record<string, unknown> | boolean | null;
  model?: string | null;
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandboxMode: "readOnly" | "workspaceWrite";
  networkAccess: boolean;
  claudeBinary: string;
};

export type ClaudeApprovalResponse = {
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

export type ClaudeEventState = {
  activeMessageId: string | null;
  lastAssistantMessageId: string | null;
};

export type ClaudeRunnerOutput =
  | {
      type: "event";
      raw: SDKMessage;
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

const readOnlyTools = ["Read", "Glob", "Grep"] as const;

export function claudeOptions(
  request: ClaudeRunnerRequest,
  canUseTool: CanUseTool,
): Options {
  const readOnly = request.sandboxMode === "readOnly";
  const promptAppend = request.instructions?.trim();
  const autoApproveWithinSandbox =
    !readOnly && request.approvalPolicy === "never";

  return {
    cwd: request.workspaceRoot,
    ...(request.conversationId ? { resume: request.conversationId } : {}),
    ...(request.model?.trim() ? { model: request.model.trim() } : {}),
    pathToClaudeCodeExecutable: request.claudeBinary,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      ...(promptAppend ? { append: promptAppend } : {}),
    },
    settingSources: ["user", "project", "local"],
    skills: "all",
    includePartialMessages: true,
    ...(request.outputSchema !== null &&
    request.outputSchema !== undefined
      ? {
          outputFormat: {
            type: "json_schema",
            schema:
              typeof request.outputSchema === "boolean"
                ? request.outputSchema
                  ? {}
                  : { not: {} }
                : request.outputSchema,
          },
        }
      : {}),
    ...(readOnly
      ? {
          tools: [...readOnlyTools],
          allowedTools: [...readOnlyTools],
          permissionMode: "dontAsk",
        }
      : {
          permissionMode: autoApproveWithinSandbox
            ? "acceptEdits"
            : "default",
          canUseTool,
        }),
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: autoApproveWithinSandbox,
      allowUnsandboxedCommands: false,
      network: request.networkAccess
        ? { allowedDomains: ["*"] }
        : { deniedDomains: ["*"] },
    },
    ...(request.networkAccess
      ? {}
      : { disallowedTools: ["WebFetch", "WebSearch"] }),
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: "briar-desktop",
    },
  };
}

function textContent(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  const content = message.message.content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    if (
      typeof block === "object" &&
      block !== null &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      return [block.text];
    }
    return [];
  }).join("");
}

export function normalizeClaudeMessage(
  message: SDKMessage,
  state: ClaudeEventState,
): NormalizedAgentEvent | undefined {
  if (message.type === "stream_event") {
    const event = message.event as unknown as Record<string, unknown>;
    if (event.type === "message_start") {
      const startedMessage = event.message as
        | { id?: unknown }
        | null
        | undefined;
      state.activeMessageId =
        typeof startedMessage?.id === "string"
          ? startedMessage.id
          : message.uuid;
      return;
    }
    const id = state.activeMessageId ?? message.uuid;
    if (event.type === "content_block_start") {
      const block = event.content_block as
        | { type?: unknown; text?: unknown }
        | null
        | undefined;
      if (block?.type === "text") {
        return {
          type: "messageStarted",
          id,
          phase: "commentary",
          text: typeof block.text === "string" ? block.text : "",
        };
      }
    }
    if (event.type === "content_block_delta") {
      const delta = event.delta as
        | { type?: unknown; text?: unknown }
        | null
        | undefined;
      if (
        delta?.type === "text_delta" &&
        typeof delta.text === "string"
      ) {
        return { type: "messageDelta", id, delta: delta.text };
      }
    }
    return;
  }

  if (message.type === "assistant") {
    const text = textContent(message);
    if (!text) return;
    const id = message.message.id ?? message.uuid;
    state.activeMessageId = null;
    state.lastAssistantMessageId = id;
    return {
      type: "messageCompleted",
      id,
      phase: "commentary",
      text,
    };
  }

  if (message.type === "result") {
    if (message.subtype === "success") {
      return {
        type: "messageCompleted",
        id: state.lastAssistantMessageId ?? message.uuid,
        phase: "final",
        text:
          message.structured_output === undefined
            ? message.result
            : JSON.stringify(message.structured_output),
      };
    }
    return { type: "turnCompleted", status: "failed" };
  }

  if (
    message.type === "system" &&
    message.subtype === "session_state_changed" &&
    message.state === "idle"
  ) {
    return { type: "turnCompleted", status: "completed" };
  }
}

export function approvalResult(
  approved: boolean,
  input: Record<string, unknown>,
): PermissionResult {
  return approved
    ? { behavior: "allow", updatedInput: input }
    : {
        behavior: "deny",
        message: "The user declined this tool request.",
      };
}
