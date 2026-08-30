import {
  buildGrokPromptParts,
  createGrokEventState,
  finalizeGrokMessage,
  grokStopReasonSucceeded,
  normalizeGrokSessionUpdate,
  permissionDecisionResult,
  permissionInput,
  permissionOptions,
  permissionToolName,
  resolveGrokFinalMessage,
  shouldAutoApprovePermission,
  shouldDenyGrokPermission,
  type GrokEventState,
} from "./grok-runner-lib";
import type { NormalizedAgentEvent } from "./normalized-agent-event";
import type { RunnerRequest } from "./runner-request";

export type CursorRunnerOutput =
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

export type CursorEventState = GrokEventState;

function asStandardAcpRequest(
  request: RunnerRequest,
  message = request.message,
): RunnerRequest {
  return {
    ...request,
    message,
  };
}

/** Cursor and Grok both expose the standard ACP session update contract. */
export const createCursorEventState = createGrokEventState;
export const normalizeCursorSessionUpdate = normalizeGrokSessionUpdate;
export const finalizeCursorMessage = finalizeGrokMessage;
export const cursorStopReasonSucceeded = grokStopReasonSucceeded;
export const cursorPermissionDecisionResult = permissionDecisionResult;
export const cursorPermissionInput = permissionInput;
export const cursorPermissionOptions = permissionOptions;
export const cursorPermissionToolName = permissionToolName;

export function cursorSessionMeta(
  request: RunnerRequest,
): { rules: string } | undefined {
  const instructions = request.instructions?.trim();
  return instructions ? { rules: instructions } : undefined;
}

export async function buildCursorPromptParts(request: RunnerRequest) {
  const instructions = request.instructions?.trim();
  const message = instructions
    ? [
        "Follow these trusted Briar instructions:",
        instructions,
        "User request:",
        request.message,
      ].join("\n\n")
    : request.message;
  return buildGrokPromptParts(asStandardAcpRequest(request, message));
}

export function resolveCursorModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed ? trimmed : "default";
  return base.includes("[") ? base.slice(0, base.indexOf("[")) : base;
}

export function mapEffortToCursor(
  effort: RunnerRequest["effort"],
): string | undefined {
  const normalized = effort?.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized === "extra-high" || normalized === "extra high"
    ? "xhigh"
    : normalized;
}

export function resolveCursorFinalMessage(
  state: CursorEventState,
  promptResultText: string | undefined,
  outputSchema: RunnerRequest["outputSchema"],
) {
  return resolveGrokFinalMessage(state, promptResultText, outputSchema);
}

export function shouldAutoApproveCursorPermission(request: RunnerRequest) {
  return shouldAutoApprovePermission(asStandardAcpRequest(request));
}

export function shouldDenyCursorPermission(
  request: RunnerRequest,
  toolName: string,
  input: Record<string, unknown> = {},
) {
  return shouldDenyGrokPermission(
    asStandardAcpRequest(request),
    toolName,
    input,
  );
}
