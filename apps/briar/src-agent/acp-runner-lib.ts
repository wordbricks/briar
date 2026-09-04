import { lstat, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
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
import { readAgentImage } from "./runner-attachments";
import { extractSingleJsonObject } from "../src/lib/single-json-object";
import type { RunnerRequest } from "./runner-request";

/**
 * Provider-neutral Agent Client Protocol helpers.
 *
 * Every ACP agent Briar drives (`grok agent stdio`, `cursor-agent acp`, …)
 * exposes the same session-update, permission, and prompt contract, so the
 * stream normalization, permission policy, and final-message resolution live
 * here while `acp-runner.ts` owns the lifecycle and `AcpProviderProfile`
 * carries the per-agent differences.
 */

export type AcpEventState = {
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

export function shouldAutoApprovePermission(
  request: RunnerRequest,
): boolean {
  return (
    request.sandboxMode === "dangerFullAccess" ||
    request.approvalPolicy === "never"
  );
}

const workspaceReadPermissions = new Set([
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

const networkReadPermissions = new Set([
  "browser_search",
  "http_get",
  "web_fetch",
  "web_search",
]);

const normalizedPermissionName = (toolName: string) =>
  toolName.trim().replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

const requiredPathPermissions = new Set(["read", "read_file"]);

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

type PathCandidate = { value: string; glob: boolean };

type PathCollection = {
  candidates: PathCandidate[];
  invalid: boolean;
};

const normalizedInputKey = (key: string) => normalizedPermissionName(key);

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
  collection: PathCollection,
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
    collectPathInputs(
      value as Record<string, unknown>,
      collection,
    );
    if (collection.candidates.length === before) collection.invalid = true;
    return;
  }
  collection.invalid = true;
};

const collectPathInputs = (
  input: Record<string, unknown>,
  collection: PathCollection = { candidates: [], invalid: false },
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
            collectPathInputs(
              item as Record<string, unknown>,
              collection,
            );
          }
        }
      } else {
        collectPathInputs(
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

async function pathIsWithinWorkspace(
  workspaceRoot: string,
  candidate: PathCandidate,
) {
  if (unsafePathSyntax(candidate.value)) return false;

  const absoluteRoot = resolve(workspaceRoot);
  let value = candidate.value;
  // A leading ! is glob negation, not part of the path being constrained.
  if (candidate.glob) value = value.replace(/^!+/u, "");
  if (!value || (win32.isAbsolute(value) && !isAbsolute(value))) return false;

  // Treat either slash style as a separator while validating traversal. An ACP
  // agent may normalize inputs independently of the host Node implementation.
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

async function workspaceReadInputIsAllowed(
  request: RunnerRequest,
  toolName: string,
  input: Record<string, unknown>,
) {
  const collection = collectPathInputs(input);
  if (collection.invalid) return false;
  if (
    requiredPathPermissions.has(toolName) &&
    collection.candidates.length === 0
  ) {
    return false;
  }
  const decisions = await Promise.all(
    collection.candidates.map((candidate) =>
      pathIsWithinWorkspace(request.workspaceRoot, candidate)
    ),
  );
  return decisions.every(Boolean);
}

export async function shouldDenyPermission(
  request: RunnerRequest,
  toolName: string,
  input: Record<string, unknown> = {},
): Promise<boolean> {
  const name = normalizedPermissionName(toolName);
  if (request.sandboxMode === "readOnly") {
    if (workspaceReadPermissions.has(name)) {
      return !(await workspaceReadInputIsAllowed(request, name, input));
    }
    return !(request.networkAccess && networkReadPermissions.has(name));
  }
  return !request.networkAccess && networkReadPermissions.has(name);
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

export type AcpPromptPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function acpSessionMeta(
  request: RunnerRequest,
): { rules: string } | undefined {
  const instructions = request.instructions?.trim();
  return instructions ? { rules: instructions } : undefined;
}

export function buildPromptParts(request: RunnerRequest): AcpPromptPart[] {
  const parts: AcpPromptPart[] = [];
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

export async function buildAcpPromptParts(
  request: RunnerRequest,
): Promise<AcpPromptPart[]> {
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

export function createAcpEventState(): AcpEventState {
  return {
    activeMessageId: null,
    activeAssistantText: "",
    lastAssistantText: "",
    messageSequence: 0,
    activities: new Map(),
  };
}

function completeActiveMessage(
  state: AcpEventState,
  phase: string,
): NormalizedAgentEvent | undefined {
  if (!state.activeMessageId) return;
  const text = state.activeAssistantText;
  state.lastAssistantText = text;
  const event = normalizedMessageCompleted({
    id: state.activeMessageId,
    phase,
    text,
  });
  state.activeMessageId = null;
  state.activeAssistantText = "";
  return event;
}

export type NormalizedAcpSessionUpdate = {
  raw: unknown;
  events: NormalizedAgentEvent[];
};

export function normalizeAcpSessionUpdate(
  params: unknown,
  state: AcpEventState,
): NormalizedAcpSessionUpdate {
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
        events: [normalizedMessageStarted({
          id: state.activeMessageId,
          phase: "commentary",
          text,
        })],
      };
    }

    state.activeAssistantText += text;
    return {
      raw: params,
      events: [normalizedMessageDelta({
        id: state.activeMessageId,
        delta: text,
      })],
    };
  }

  if (kind === "tool_call" || kind === "tool_call_update") {
    if (!update) return { raw: params, events: [] };
    const events: NormalizedAgentEvent[] = [];
    const completedMessage = completeActiveMessage(state, "commentary");
    if (completedMessage) events.push(completedMessage);
    events.push(...normalizeAcpActivity(update, state));
    return { raw: params, events };
  }

  return { raw: params, events: [] };
}

function normalizeAcpActivity(
  update: Record<string, unknown>,
  state: AcpEventState,
): NormalizedAgentEvent[] {
  const id = typeof update.toolCallId === "string" ? update.toolCallId : null;
  if (!id) return [];
  const existing = state.activities.get(id);
  const kind = acpActivityKind(
    typeof update.kind === "string" ? update.kind : null,
    existing?.kind,
  );
  const rawInput = asRecord(update.rawInput);
  const title = normalizedActivityTitle(
    (typeof update.title === "string" && update.title) ||
      existing?.title ||
      (kind === AgentActivityKind.COMMAND &&
          typeof rawInput?.command === "string"
        ? rawInput.command
        : "Use tool"),
  );
  const output = normalizedActivityText(
    acpActivityOutput(update) ?? existing?.text ?? "",
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
    events.push(normalizedActivityStarted({
      id,
      kind,
      title,
      text: output,
    }));
  } else if (
    output &&
    output !== existing?.text &&
    output.startsWith(existing?.text ?? "")
  ) {
    events.push(normalizedActivityDelta({
      id,
      delta: output.slice(existing?.text.length ?? 0),
    }));
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
    events.push(normalizedActivityCompleted({
      id,
      kind,
      title,
      text: output,
      status: cancelled
        ? AgentActivityStatus.CANCELLED
        : status === "failed"
          ? AgentActivityStatus.FAILED
          : AgentActivityStatus.COMPLETED,
    }));
  }
  state.activities.set(id, activity);
  return events;
}

function acpActivityKind(
  kind: string | null,
  fallback: AgentActivityKind | undefined,
): AgentActivityKind {
  if (!kind) return fallback ?? AgentActivityKind.TOOL;
  const normalized = kind.toLowerCase();
  if (normalized === "execute") return AgentActivityKind.COMMAND;
  if (
    normalized === "edit" ||
    normalized === "delete" ||
    normalized === "move"
  ) {
    return AgentActivityKind.FILE_CHANGE;
  }
  if (normalized === "fetch" || normalized === "search") {
    return AgentActivityKind.WEB_SEARCH;
  }
  return AgentActivityKind.TOOL;
}

function acpActivityOutput(update: Record<string, unknown>): string | null {
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

export function finalizeAcpMessage(
  state: AcpEventState,
  stopReason: string | undefined,
): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  const completed = completeActiveMessage(state, "final");
  if (completed) events.push(completed);
  events.push(normalizedTurnCompleted(
    acpStopReasonSucceeded(stopReason)
      ? "completed"
      : stopReason || "failed",
  ));
  return events;
}

export function acpStopReasonSucceeded(stopReason: string | undefined) {
  return stopReason === "end_turn";
}

export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with conversational-output extraction.
  }
  return extractSingleJsonObject(trimmed)?.text ?? trimmed;
}

export function resolveAcpFinalMessage(
  state: AcpEventState,
  promptResultText: string | undefined,
  outputSchema: RunnerRequest["outputSchema"],
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

export interface PermissionInput {
  [key: string]: unknown;
}

export function permissionInput(params: unknown): PermissionInput {
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
