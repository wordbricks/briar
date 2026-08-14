import { lstat, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
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
  effort?: string | null;
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

const grokWorkspaceReadPermissions = new Set([
  "find",
  "find_files",
  "glob",
  "grep",
  "list",
  "list_dir",
  "list_directory",
  "list_files",
  "read",
  "read_file",
  "search_files",
]);

const grokNetworkReadPermissions = new Set([
  "browser_search",
  "http_get",
  "web_fetch",
  "web_search",
]);

const normalizedGrokPermission = (toolName: string) =>
  toolName.trim().replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

const grokRequiredPathPermissions = new Set(["read", "read_file"]);

const directPathKeys = new Set([
  "base",
  "base_dir",
  "base_directory",
  "base_path",
  "cwd",
  "dir",
  "dirs",
  "directory",
  "directories",
  "file",
  "files",
  "file_name",
  "filename",
  "filepath",
  "file_path",
  "file_paths",
  "folder",
  "folders",
  "location",
  "locations",
  "path",
  "paths",
  "root",
  "roots",
  "root_dir",
  "root_directory",
  "root_path",
  "search_dir",
  "search_directory",
  "search_path",
  "source",
  "sources",
  "target",
  "targets",
  "workspace",
  "workspace_root",
  "working_dir",
  "working_directory",
]);

const globPathKeys = new Set([
  "exclude",
  "excludes",
  "file_glob",
  "file_globs",
  "glob",
  "globs",
  "glob_pattern",
  "glob_patterns",
  "include",
  "includes",
  "pattern",
  "patterns",
]);

type GrokPathCandidate = { value: string; glob: boolean };

type GrokPathCollection = {
  candidates: GrokPathCandidate[];
  invalid: boolean;
};

const normalizedInputKey = (key: string) => normalizedGrokPermission(key);

const isDirectPathKey = (key: string) => {
  if (directPathKeys.has(key)) return true;
  return [
    "_cwd",
    "_dir",
    "_dirs",
    "_directory",
    "_directories",
    "_file",
    "_files",
    "_folder",
    "_folders",
    "_location",
    "_locations",
    "_path",
    "_paths",
    "_root",
    "_roots",
  ].some((suffix) => key.endsWith(suffix));
};

const isGlobPathKey = (key: string) =>
  globPathKeys.has(key) || key.includes("glob");

const collectPathValue = (
  value: unknown,
  glob: boolean,
  collection: GrokPathCollection,
) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      collection.invalid = true;
      return;
    }
    collection.candidates.push({ value: trimmed, glob });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) collection.invalid = true;
    for (const item of value) collectPathValue(item, glob, collection);
    return;
  }
  if (value && typeof value === "object") {
    const before = collection.candidates.length;
    collectGrokPathInputs(
      value as Record<string, unknown>,
      collection,
    );
    if (collection.candidates.length === before) collection.invalid = true;
    return;
  }
  collection.invalid = true;
};

const collectGrokPathInputs = (
  input: Record<string, unknown>,
  collection: GrokPathCollection = { candidates: [], invalid: false },
) => {
  for (const [rawKey, value] of Object.entries(input)) {
    const key = normalizedInputKey(rawKey);
    const glob = isGlobPathKey(key);
    if (glob || isDirectPathKey(key)) {
      collectPathValue(value, glob, collection);
      continue;
    }
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            collectGrokPathInputs(
              item as Record<string, unknown>,
              collection,
            );
          }
        }
      } else {
        collectGrokPathInputs(
          value as Record<string, unknown>,
          collection,
        );
      }
    }
  }
  return collection;
};

const pathIsWithin = (root: string, candidate: string) => {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." &&
      !isAbsolute(fromRoot));
};

const nearestExistingRealPath = async (candidate: string) => {
  let current = candidate;
  for (;;) {
    try {
      return await realpath(current);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
      // A dangling/looping symlink is not equivalent to a missing leaf. Do not
      // climb past it and accidentally approve a path whose eventual target is
      // outside the workspace.
      try {
        if ((await lstat(current)).isSymbolicLink()) return null;
      } catch (statError) {
        const statCode = statError && typeof statError === "object" &&
            "code" in statError
          ? String(statError.code)
          : null;
        if (statCode !== "ENOENT" && statCode !== "ENOTDIR") return null;
      }
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
};

const unsafePathSyntax = (value: string) =>
  value.includes("\0") ||
  /^(?:file|https?|ftp):/iu.test(value) ||
  /^~(?:[\\/]|$)/u.test(value) ||
  /(^|[\\/,{])\.\.($|[\\/},])/u.test(value) ||
  /%2e(?:%2e|\.)/iu.test(value);

async function grokPathIsWithinWorkspace(
  workspaceRoot: string,
  candidate: GrokPathCandidate,
) {
  if (unsafePathSyntax(candidate.value)) return false;

  const absoluteRoot = resolve(workspaceRoot);
  let value = candidate.value;
  // A leading ! is glob negation, not part of the path being constrained.
  if (candidate.glob) value = value.replace(/^!+/u, "");
  if (!value || (win32.isAbsolute(value) && !isAbsolute(value))) return false;

  // Treat either slash style as a separator while validating traversal. Grok
  // may normalize ACP inputs independently of the host Node implementation.
  const portableValue = value.replaceAll("\\", "/");
  const absoluteCandidate = isAbsolute(portableValue)
    ? resolve(portableValue)
    : resolve(absoluteRoot, portableValue);
  if (!pathIsWithin(absoluteRoot, absoluteCandidate)) return false;

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(absoluteRoot);
  } catch {
    return false;
  }
  const canonicalCandidate = await nearestExistingRealPath(absoluteCandidate);
  return canonicalCandidate !== null &&
    pathIsWithin(canonicalRoot, canonicalCandidate);
}

async function grokWorkspaceReadInputIsAllowed(
  request: GrokRunnerRequest,
  toolName: string,
  input: Record<string, unknown>,
) {
  const collection = collectGrokPathInputs(input);
  if (collection.invalid) return false;
  if (
    grokRequiredPathPermissions.has(toolName) &&
    collection.candidates.length === 0
  ) {
    return false;
  }
  const decisions = await Promise.all(
    collection.candidates.map((candidate) =>
      grokPathIsWithinWorkspace(request.workspaceRoot, candidate)
    ),
  );
  return decisions.every(Boolean);
}

export async function shouldDenyGrokPermission(
  request: GrokRunnerRequest,
  toolName: string,
  input: Record<string, unknown> = {},
): Promise<boolean> {
  const name = normalizedGrokPermission(toolName);
  if (request.sandboxMode === "readOnly") {
    if (grokWorkspaceReadPermissions.has(name)) {
      return !(await grokWorkspaceReadInputIsAllowed(request, name, input));
    }
    return !(request.networkAccess && grokNetworkReadPermissions.has(name));
  }
  return !request.networkAccess && grokNetworkReadPermissions.has(name);
}

export function selectPermissionOptionId(
  options: ReadonlyArray<{ optionId?: string; kind?: string }>,
  preferred: "allow_always" | "allow_once" | "reject_once",
): string | undefined {
  const match = options.find((option) => option.kind === preferred);
  const optionId = match?.optionId?.trim();
  return optionId || undefined;
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
  // Never persist a permission decision. Every call must be re-evaluated with
  // its concrete path so a safe first read cannot authorize a later escape.
  const allowId = selectPermissionOptionId(options, "allow_once");
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
    status: grokStopReasonSucceeded(stopReason)
      ? "completed"
      : stopReason || "failed",
  });
  return events;
}

export function grokStopReasonSucceeded(stopReason: string | undefined) {
  return stopReason === "end_turn";
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
  if (typeof toolCall?.toolName === "string" && toolCall.toolName.trim()) {
    return toolCall.toolName.trim();
  }
  if (typeof toolCall?.kind === "string" && toolCall.kind.trim()) {
    return toolCall.kind.trim();
  }
  if (typeof toolCall?.title === "string" && toolCall.title.trim()) {
    return toolCall.title.trim();
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
