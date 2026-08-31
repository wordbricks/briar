import type {
  CanUseTool,
  Options,
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { parse, resolve } from "node:path";
import {
  AgentActivityKind,
  AgentActivityStatus,
  type NormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  normalizedActivityCompleted,
  normalizedActivityStarted,
  normalizedActivityText,
  normalizedActivityTitle,
  normalizedMessageCompleted,
  normalizedMessageDelta,
  normalizedMessageStarted,
  normalizedTurnCompleted,
} from "./normalized-agent-event";
import { readAgentImage } from "./runner-attachments";
import type { RunnerRequest } from "./runner-request";

export type ClaudeEventState = {
  activeMessageId: string | null;
  lastAssistantMessageId: string | null;
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

const readOnlyTools = ["Read", "Glob", "Grep"] as const;
const supportedClaudeImageMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function createClaudeEventState(): ClaudeEventState {
  return {
    activeMessageId: null,
    lastAssistantMessageId: null,
    activities: new Map(),
  };
}

export async function* claudePrompt(
  request: RunnerRequest,
): AsyncIterable<SDKUserMessage> {
  const content: Array<Record<string, unknown>> = [];
  if (request.message.trim()) {
    content.push({ type: "text", text: request.message });
  }
  for (const attachment of request.attachments ?? []) {
    if (!supportedClaudeImageMimeTypes.has(attachment.mimeType)) {
      throw new Error(
        `Claude does not support image attachment type '${attachment.mimeType}'`,
      );
    }
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: Buffer.from(await readAgentImage(attachment)).toString("base64"),
      },
    });
  }
  yield {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: content as unknown as SDKUserMessage["message"]["content"],
    },
  } as SDKUserMessage;
}

export function claudeOptions(
  request: RunnerRequest,
  canUseTool: CanUseTool,
): Options {
  const readOnly = request.sandboxMode === "readOnly";
  const workspaceRoot = resolve(request.workspaceRoot);
  const dangerFullAccess = request.sandboxMode === "dangerFullAccess";
  const promptAppend = request.instructions?.trim();
  const autoApproveWithinSandbox =
    !readOnly &&
    !dangerFullAccess &&
    request.approvalPolicy === "never";

  return {
    cwd: request.workspaceRoot,
    ...(request.additionalDirectories?.length
      ? { additionalDirectories: request.additionalDirectories }
      : {}),
    ...(request.conversationId ? { resume: request.conversationId } : {}),
    ...(request.model?.trim() ? { model: request.model.trim() } : {}),
    ...(request.effort
      ? { effort: request.effort as Options["effort"] }
      : {}),
    pathToClaudeCodeExecutable: request.providerBinaryPath,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      ...(promptAppend ? { append: promptAppend } : {}),
    },
    settingSources: readOnly ? [] : ["user", "project", "local"],
    skills: readOnly ? [] : "all",
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
    ...(dangerFullAccess
      ? {
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        }
      : readOnly
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
    ...(dangerFullAccess
      ? {}
      : {
          sandbox: {
            enabled: true,
            failIfUnavailable: true,
            autoAllowBashIfSandboxed: autoApproveWithinSandbox,
            allowUnsandboxedCommands: false,
            network: request.networkAccess
              ? { allowedDomains: ["*"] }
              : { deniedDomains: ["*"] },
            ...(readOnly
              ? {
                  filesystem: {
                    // Deny the host filesystem first, then narrowly re-allow
                    // the claimed workspace. The SDK resolves symlink targets
                    // against these rules, so links cannot escape it.
                    denyRead: [parse(workspaceRoot).root],
                    allowRead: [workspaceRoot],
                  },
                }
              : {}),
          },
        }),
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
): NormalizedAgentEvent[] {
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
      return [];
    }
    const id = state.activeMessageId ?? message.uuid;
    if (event.type === "content_block_start") {
      const block = record(event.content_block);
      if (block?.type === "text") {
        return [normalizedMessageStarted({
          id,
          phase: "commentary",
          text: typeof block.text === "string" ? block.text : "",
        })];
      }
      if (block?.type === "tool_use") {
        const started = startClaudeActivity(block, state);
        return started ? [started] : [];
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
        return [normalizedMessageDelta({ id, delta: delta.text })];
      }
    }
    return [];
  }

  if (message.type === "assistant") {
    const events: NormalizedAgentEvent[] = [];
    const text = textContent(message);
    const id = message.message.id ?? message.uuid;
    if (text) {
      state.activeMessageId = null;
      state.lastAssistantMessageId = id;
      events.push(normalizedMessageCompleted({
        id,
        phase: "commentary",
        text,
      }));
    }
    if (Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        const started = startClaudeActivity(record(block), state);
        if (started) events.push(started);
      }
    }
    return events;
  }

  if (message.type === "user") {
    const events: NormalizedAgentEvent[] = [];
    const content = message.message.content;
    if (!Array.isArray(content)) return events;
    for (const block of content) {
      const result = completeClaudeActivity(record(block), state);
      if (result) events.push(result);
    }
    return events;
  }

  if (
    message.type === "system" &&
    message.subtype === "permission_denied"
  ) {
    const activity = state.activities.get(message.tool_use_id);
    if (activity?.completed) return [];
    const kind = activity?.kind ?? claudeActivityKind(message.tool_name);
    const title = normalizedActivityTitle(
      activity?.title || message.tool_name || "Use tool",
    );
    const text = normalizedActivityText(
      message.decision_reason || "Permission denied",
    );
    state.activities.set(message.tool_use_id, {
      kind,
      title,
      text,
      started: true,
      completed: true,
    });
    return [normalizedActivityCompleted({
      id: message.tool_use_id,
      kind,
      title,
      text,
      status: AgentActivityStatus.CANCELLED,
    })];
  }

  if (message.type === "result") {
    if (message.subtype === "success") {
      return [normalizedMessageCompleted({
        id: state.lastAssistantMessageId ?? message.uuid,
        phase: "final",
        text:
          message.structured_output === undefined
            ? message.result
            : JSON.stringify(message.structured_output),
      })];
    }
    return [normalizedTurnCompleted("failed")];
  }

  if (
    message.type === "system" &&
    message.subtype === "session_state_changed" &&
    message.state === "idle"
  ) {
    return [normalizedTurnCompleted("completed")];
  }
  return [];
}

function startClaudeActivity(
  block: Record<string, unknown> | null,
  state: ClaudeEventState,
): NormalizedAgentEvent | null {
  if (
    block?.type !== "tool_use" ||
    typeof block.id !== "string" ||
    typeof block.name !== "string"
  ) {
    return null;
  }
  const existing = state.activities.get(block.id);
  if (existing?.started) return null;
  const input = record(block.input);
  const kind = claudeActivityKind(block.name);
  const title = normalizedActivityTitle(
    claudeActivityTitle(block.name, input),
  );
  const activity = {
    kind,
    title,
    text: existing?.text ?? "",
    started: true,
    completed: false,
  };
  state.activities.set(block.id, activity);
  return normalizedActivityStarted({
    id: block.id,
    kind,
    title,
    text: activity.text,
  });
}

function completeClaudeActivity(
  block: Record<string, unknown> | null,
  state: ClaudeEventState,
): NormalizedAgentEvent | null {
  if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") {
    return null;
  }
  const existing = state.activities.get(block.tool_use_id);
  if (existing?.completed) return null;
  const kind = existing?.kind ?? AgentActivityKind.TOOL;
  const title = normalizedActivityTitle(
    existing?.title ?? `Tool ${block.tool_use_id}`,
  );
  const text = normalizedActivityText(claudeToolResultText(block.content));
  const status = block.is_error === true
    ? AgentActivityStatus.FAILED
    : AgentActivityStatus.COMPLETED;
  state.activities.set(block.tool_use_id, {
    kind,
    title,
    text,
    started: true,
    completed: true,
  });
  return normalizedActivityCompleted({
    id: block.tool_use_id,
    kind,
    title,
    text,
    status,
  });
}

function claudeActivityKind(name: string): AgentActivityKind {
  const normalized = name.toLowerCase();
  if (normalized === "bash" || normalized === "shell") {
    return AgentActivityKind.COMMAND;
  }
  if (
    normalized === "edit" ||
    normalized === "write" ||
    normalized === "notebookedit" ||
    normalized === "applypatch"
  ) {
    return AgentActivityKind.FILE_CHANGE;
  }
  if (normalized === "webfetch" || normalized === "websearch") {
    return AgentActivityKind.WEB_SEARCH;
  }
  return AgentActivityKind.TOOL;
}

function claudeActivityTitle(
  name: string,
  input: Record<string, unknown> | null,
): string {
  if (name.toLowerCase() === "bash" && typeof input?.command === "string") {
    return input.command;
  }
  if (
    (name === "Edit" || name === "Write" || name === "NotebookEdit") &&
    typeof input?.file_path === "string"
  ) {
    return input.file_path;
  }
  if (
    (name === "WebFetch" || name === "WebSearch") &&
    typeof input?.query === "string"
  ) {
    return input.query;
  }
  return name;
}

function claudeToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : jsonText(content);
  return content
    .flatMap((value) => {
      const block = record(value);
      return block?.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("");
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
