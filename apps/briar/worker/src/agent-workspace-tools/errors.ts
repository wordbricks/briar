import { HttpError } from "../http-response";

/**
 * Stable error codes of `tools issue …` / `tools channel …`
 * (docs/plans/agent-workspace-tools.md). The code travels to the Worker CLI as
 * `ApplicationErrorDetail.code`; `unavailable` is the only retryable one.
 */
export type AgentWorkspaceToolErrorCode =
  | "claim_inactive"
  | "not_found"
  | "invalid_request"
  | "not_allowed"
  | "no_agent"
  | "issue_in_execution"
  | "own_run"
  | "rate_limited"
  | "idempotency_conflict"
  | "conflict"
  | "unavailable";

const statusByCode = {
  claim_inactive: 409,
  not_found: 404,
  invalid_request: 400,
  not_allowed: 403,
  no_agent: 403,
  issue_in_execution: 409,
  own_run: 409,
  rate_limited: 429,
  idempotency_conflict: 409,
  conflict: 409,
  unavailable: 503,
} as const satisfies Record<AgentWorkspaceToolErrorCode, number>;

export class AgentWorkspaceToolError extends HttpError {
  constructor(readonly toolCode: AgentWorkspaceToolErrorCode, message: string) {
    super(statusByCode[toolCode], message, toolCode);
    this.name = "AgentWorkspaceToolError";
  }
}

export const toolError = (code: AgentWorkspaceToolErrorCode, message: string) =>
  new AgentWorkspaceToolError(code, message);
