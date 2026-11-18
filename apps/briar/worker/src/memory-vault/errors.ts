import { HttpError } from "../http-response";

/**
 * Stable error codes of the memory tools (spec §6). The code travels to the
 * Worker CLI as `ApplicationErrorDetail.code`; `busy` and `memory_unavailable`
 * are the retryable ones.
 */
export type MemoryVaultErrorCode =
  | "revision_conflict"
  | "expected_revision_required"
  | "protected_record"
  | "type_mismatch"
  | "memory_disabled"
  | "write_not_allowed"
  | "secret_detected"
  | "invalid_record"
  | "frontmatter_not_allowed"
  | "readme_read_only"
  | "not_found"
  | "busy"
  | "memory_unavailable"
  | "idempotency_conflict"
  | "claim_inactive"
  | "invalid_request";

const statusByCode = {
  revision_conflict: 409,
  expected_revision_required: 428,
  protected_record: 403,
  type_mismatch: 409,
  memory_disabled: 403,
  write_not_allowed: 403,
  secret_detected: 422,
  invalid_record: 422,
  frontmatter_not_allowed: 422,
  readme_read_only: 403,
  not_found: 404,
  busy: 503,
  memory_unavailable: 503,
  idempotency_conflict: 409,
  claim_inactive: 409,
  invalid_request: 400,
} as const satisfies Record<MemoryVaultErrorCode, number>;

export type MemoryVaultErrorDetails = {
  readonly recordId?: string;
  readonly currentRevision?: number;
  readonly expectedRevision?: number;
};

export class MemoryVaultError extends HttpError {
  constructor(
    readonly vaultCode: MemoryVaultErrorCode,
    message: string,
    readonly details: MemoryVaultErrorDetails = {},
  ) {
    super(statusByCode[vaultCode], message, vaultCode);
    this.name = "MemoryVaultError";
  }

  get retryable() {
    return this.vaultCode === "busy" || this.vaultCode === "memory_unavailable";
  }
}

export const isMemoryVaultError = (error: unknown): error is MemoryVaultError =>
  error instanceof MemoryVaultError;
