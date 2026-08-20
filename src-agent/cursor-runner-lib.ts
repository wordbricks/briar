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
  type GrokRunnerRequest,
} from "./grok-runner-lib";
import * as Schema from "effect/Schema";
import type { NormalizedAgentEvent } from "./normalized-agent-event";
import {
  commonRunnerRequestFields,
  runnerRequestDecoderOptions,
} from "./runner-request";

export const CursorRunnerRequest = Schema.Struct({
  ...commonRunnerRequestFields,
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  cursorBinary: Schema.String,
});

export type CursorRunnerRequest = typeof CursorRunnerRequest.Type;

export const decodeCursorRunnerRequest = Schema.decodeUnknownResult(
  CursorRunnerRequest,
  runnerRequestDecoderOptions,
);

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
  request: CursorRunnerRequest,
  message = request.message,
): GrokRunnerRequest {
  return {
    ...request,
    message,
    grokBinary: request.cursorBinary,
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
  request: CursorRunnerRequest,
): { rules: string } | undefined {
  const instructions = request.instructions?.trim();
  return instructions ? { rules: instructions } : undefined;
}

export async function buildCursorPromptParts(request: CursorRunnerRequest) {
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
  effort: CursorRunnerRequest["effort"],
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
  outputSchema: CursorRunnerRequest["outputSchema"],
) {
  return resolveGrokFinalMessage(state, promptResultText, outputSchema);
}

export function shouldAutoApproveCursorPermission(request: CursorRunnerRequest) {
  return shouldAutoApprovePermission(asStandardAcpRequest(request));
}

export function shouldDenyCursorPermission(
  request: CursorRunnerRequest,
  toolName: string,
  input: Record<string, unknown> = {},
) {
  return shouldDenyGrokPermission(
    asStandardAcpRequest(request),
    toolName,
    input,
  );
}
