/**
 * Provider-neutral classification of the failures a coding-agent CLI can
 * raise before or during a turn.
 *
 * Every runner maps its provider's native failure signal (a structured error
 * code, an HTTP status, or plain error text) onto one {@link ProviderBlock}
 * and emits it as a `RunBlocked` frame. Parents never see provider error
 * text as their only signal, so the same quota exhaustion is handled the same
 * way whether Claude, Codex, or Grok produced it.
 *
 * A block is an account, quota, or environment condition that time or a
 * person can clear. A turn that failed for any other reason stays a
 * `RunError`.
 */

import {
  providerBlockReasons,
  type ProviderBlock,
  type ProviderBlockReason,
} from "../src/lib/provider-block";

export { providerBlockReasons, type ProviderBlock, type ProviderBlockReason };

/** Thrown inside a runner so the outer handler emits `blocked`, not `error`. */
export class ProviderBlockedError extends Error {
  constructor(readonly block: ProviderBlock) {
    super(block.message);
    this.name = "ProviderBlockedError";
  }
}

export type ProviderFailureSignal = {
  provider: string;
  /** Provider error text; may be several lines or serialized JSON. */
  message?: string | null;
  statusCode?: number | null;
  /** Provider error identifier such as `rate_limit` or `usage_limit_reached`. */
  code?: string | null;
  /** Reset moment as ISO text, epoch seconds, or epoch milliseconds. */
  retryAt?: string | number | Date | null;
  /** Seconds until the provider allows another request. */
  retryAfterSeconds?: number | null;
  now?: () => number;
};

const maxBlockMessageLength = 600;

/** Collapse provider output into one line that fits a chat or issue message. */
export function providerBlockMessage(value: unknown): string {
  const text = typeof value === "string"
    ? value
    : value instanceof Error
      ? value.message
      : value === undefined || value === null
        ? ""
        : JSON.stringify(value);
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= maxBlockMessageLength) return collapsed;
  return `${collapsed.slice(0, maxBlockMessageLength - 1)}…`;
}

export function providerRetryAt(
  value: string | number | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date
    ? value
    : typeof value === "number"
      ? new Date(value < 10_000_000_000 ? value * 1_000 : value)
      : /^\d{9,13}$/u.test(value.trim())
        ? providerRetryAtFromEpochText(value.trim())
        : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function providerRetryAtFromEpochText(value: string): Date {
  const parsed = Number(value);
  return new Date(parsed < 10_000_000_000 ? parsed * 1_000 : parsed);
}

const codeReasons: ReadonlyArray<readonly [RegExp, ProviderBlockReason]> = [
  [/^(?:mcp_auth_required)$/iu, "mcp_auth_required"],
  [/^(?:free_tier_limit|free_tier_exceeded)$/iu, "free_tier_limit"],
  [
    /^(?:billing_error|insufficient_quota|usage_not_included|credits_required|out_of_credits|payment_required|billing_required|insufficient_credits)$/iu,
    "billing_required",
  ],
  [
    /^(?:prompt_too_long|context_length_exceeded|context_window_exceeded|context_overflow|context_window_overflow)$/iu,
    "context_window_exceeded",
  ],
  [
    /^(?:authentication_failed|authentication_error|invalid_api_key|unauthorized|unauthenticated|oauth_org_not_allowed|auth_required|permission_error|permission_denied|forbidden|invalid_request_error_unauthorized|token_expired|login_required)$/iu,
    "auth_required",
  ],
  [
    /^(?:rate_limit|rate_limited|rate_limit_error|rate_limit_reached|rate_limit_exceeded|usage_limit_reached|usage_limit|usage_exhausted|resource_exhausted|quota_exceeded|blocking_limit|too_many_requests|rapid_refill_breaker)$/iu,
    "usage_exhausted",
  ],
  [
    /^(?:model_not_found|model_unavailable|model_not_supported|unknown_model|invalid_model|not_found_error)$/iu,
    "model_unavailable",
  ],
  [
    /^(?:overloaded|overloaded_error|upstream_overloaded|service_unavailable|bad_gateway|gateway_timeout|api_error_overloaded)$/iu,
    "upstream_overloaded",
  ],
];

const textReasons: ReadonlyArray<readonly [RegExp, ProviderBlockReason]> = [
  [
    /\bfree (?:tier|usage|plan)\b[^.]{0,40}\b(?:limit|exceeded|exhausted|used up)\b|\bfree usage exceeded\b|\bfree[_ ]tier[_ ]limit\b/iu,
    "free_tier_limit",
  ],
  [
    /\binsufficient[_ ](?:quota|credits?|funds|balance)\b|\busage[_ ]not[_ ]included\b|\bnot included in your plan\b|\bplan does not include\b|\bbilling\b|\bpayment (?:required|method)\b|\bout of credits\b|\bcredits? (?:required|exhausted|depleted)\b|\badd (?:credits|a payment method)\b|\bpurchase (?:credits|more)\b|\bupgrade your plan\b|\bcredit balance is too low\b/iu,
    "billing_required",
  ],
  [
    /\bprompt is too long\b|\bcontext window\b[^.]{0,40}\b(?:exceeded|full|overflow)\b|\bexceeds? the (?:model'?s? )?(?:context (?:window|length|limit)|maximum context)\b|\bcontext[_ ]length[_ ]exceeded\b|\bmaximum context length\b|\btoo many tokens\b|\bexceed(?:s|ed)? (?:the )?(?:context|token) limit\b|\binput (?:is )?too long\b|\brequest too large\b/iu,
    "context_window_exceeded",
  ],
  [
    /\b(?:status(?: code)?|http)\s*(?:401|403)\b|\b(?:401|403)\s+(?:unauthorized|forbidden)\b|\bunauthori[sz]ed\b|\bunauthenticated\b|\bnot (?:logged|signed) in\b|\b(?:log|sign) ?in (?:again|required|to continue)\b|\bauthentication (?:failed|required|error|expired)\b|\binvalid (?:api[_ ]?key|token|credentials?)\b|\b(?:token|session|credentials?) (?:has |have )?expired\b|\bplease (?:re-?)?(?:sign|log) ?in\b|\bre-?authenticat(?:e|ion)\b|\bauthentication_failed\b|\boauth[_ ]org[_ ]not[_ ]allowed\b|\bapi key (?:is )?(?:invalid|missing|required)\b|\bpermission denied\b[^.]{0,40}\b(?:api|account|organization)\b/iu,
    "auth_required",
  ],
  [
    /\brate[_ ]?limit(?:ed|s)?\b|\btoo many requests\b|\b(?:status(?: code)?|http)\s*429\b|\[429\]|\busage[_ ]limit(?:s)?\b|\busage (?:limit|exhausted|cap)\b|\bhit your (?:usage |weekly |daily |session )?limit\b|\bquota (?:exceeded|reached|exhausted|limit)\b|\bexceeded (?:your )?(?:current )?quota\b|\bresource[_ ]exhausted\b|\bout of (?:usage|tokens|quota)\b|\b(?:usage|weekly|daily|session|5-hour|five-hour|7-day|seven-day) limit (?:reached|exceeded|exhausted)\b|\blimit reached\b|\busage_limit_reached\b|\brate_limit_reached\b|\bblocking_limit\b|\bspending limit\b|\bthrottled\b/iu,
    "usage_exhausted",
  ],
  [
    /\bmodel\b[^.]{0,40}\b(?:not found|is not available|unavailable|does not exist|not supported|is not supported|not permitted|not allowed)\b|\bunknown model\b|\binvalid model\b|\bno such model\b|\bmodel_not_found\b|\b(?:do not|don't|does not|doesn't) have access to (?:the |this )?model\b|\bunsupported model\b/iu,
    "model_unavailable",
  ],
  [
    /\b(?:status(?: code)?|http)\s*(?:502|503|504|529)\b|\[(?:502|503|504|529)\]|\b(?:502|503|504)\s+(?:bad gateway|service unavailable|gateway time-?out)\b|\boverloaded(?:_error)?\b|\b529\b|\bbad gateway\b|\bservice (?:is )?unavailable\b|\bgateway time-?out\b|\bat capacity\b|\bcapacity (?:is )?(?:exhausted|limited|unavailable)\b|\bserver is (?:busy|overloaded)\b|\btemporarily unavailable\b|\bupstream (?:error|unavailable|overloaded)\b/iu,
    "upstream_overloaded",
  ],
];

const statusReasons = new Map<number, ProviderBlockReason>([
  [401, "auth_required"],
  [402, "billing_required"],
  [403, "auth_required"],
  [429, "usage_exhausted"],
  [502, "upstream_overloaded"],
  [503, "upstream_overloaded"],
  [504, "upstream_overloaded"],
  [529, "upstream_overloaded"],
]);

function reasonForCode(code: string | null | undefined) {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  for (const [pattern, reason] of codeReasons) {
    if (pattern.test(trimmed)) return reason;
  }
  return null;
}

function reasonForText(text: string) {
  for (const [pattern, reason] of textReasons) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

/** An HTTP status a provider quoted inside its text, when it is one we act on. */
export function providerStatusCodeFromText(text: string): number | null {
  const match = text.match(
    /\[(\d{3})\]|\b(?:status(?: code)?|http)\s*:?\s*(\d{3})\b|\b(\d{3})\s+(?:too many requests|unauthorized|forbidden|payment required|bad gateway|service unavailable|gateway time-?out|overloaded)\b/iu,
  );
  const parsed = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return Number.isInteger(parsed) && statusReasons.has(parsed) ? parsed : null;
}

/**
 * Find the reset moment a provider mentions inside its message, such as the
 * epoch Claude Code appends after `|`, `resets at <ISO>`, or `retry after 90s`.
 */
export function providerRetryAtFromText(
  text: string,
  now: () => number = Date.now,
): string | null {
  const epoch = text.match(/\|\s*(\d{10,13})\b/u);
  if (epoch) return providerRetryAt(epoch[1]!);
  const iso = text.match(
    /\b(?:reset(?:s)?|retry|available|try again)\b[^0-9]{0,30}(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/iu,
  );
  if (iso) return providerRetryAt(iso[1]!);
  const relative = text.match(
    /\b(?:retry|try again|available|resets?)\b[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/iu,
  );
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const seconds = unit.startsWith("h")
      ? amount * 3_600
      : unit.startsWith("m")
        ? amount * 60
        : amount;
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(now() + seconds * 1_000).toISOString();
    }
  }
  return null;
}

/**
 * Decide whether a provider failure is a block and which one. Structured
 * signals win over text: an explicit provider code first, then an HTTP status,
 * then the message text. Returns null when the failure is not a block.
 */
export function classifyProviderFailure(
  signal: ProviderFailureSignal,
): ProviderBlock | null {
  const message = providerBlockMessage(signal.message);
  const code = signal.code?.trim() || undefined;
  const statusCode = typeof signal.statusCode === "number" &&
      Number.isInteger(signal.statusCode) && signal.statusCode > 0
    ? signal.statusCode
    : providerStatusCodeFromText(message) ?? undefined;
  const now = signal.now ?? Date.now;

  const reason = reasonForCode(code) ??
    (statusCode !== undefined && statusCode === 429 &&
        reasonForText(message) === "billing_required"
      ? "billing_required"
      : statusCode !== undefined
        ? statusReasons.get(statusCode) ?? reasonForText(message)
        : reasonForText(message));
  if (!reason) return null;

  const retryFromSignal = signal.retryAfterSeconds && signal.retryAfterSeconds > 0
    ? new Date(now() + signal.retryAfterSeconds * 1_000).toISOString()
    : providerRetryAt(signal.retryAt ?? null);
  const nextRetryAt = retryFromSignal ?? providerRetryAtFromText(message, now);

  return {
    reason,
    provider: signal.provider,
    message: message || defaultBlockMessage(reason, signal.provider),
    nextRetryAt: reason === "usage_exhausted" || reason === "free_tier_limit" ||
        reason === "upstream_overloaded"
      ? nextRetryAt
      : null,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(code ? { providerCode: code } : {}),
  };
}

function defaultBlockMessage(reason: ProviderBlockReason, provider: string) {
  switch (reason) {
    case "mcp_auth_required":
      return `${provider} requires MCP authentication.`;
    case "usage_exhausted":
      return `${provider} usage limit reached.`;
    case "upstream_overloaded":
      return `${provider} is temporarily overloaded.`;
    case "free_tier_limit":
      return `${provider} free usage limit reached.`;
    case "auth_required":
      return `${provider} is not signed in.`;
    case "context_window_exceeded":
      return `${provider} request exceeds the model context window.`;
    case "billing_required":
      return `${provider} account needs billing attention.`;
    case "model_unavailable":
      return `${provider} cannot use the selected model.`;
  }
}

/** Convenience for runners that only have an Error or a string in hand. */
export function providerBlockFromError(
  provider: string,
  error: unknown,
  extra: Omit<ProviderFailureSignal, "provider" | "message"> = {},
): ProviderBlock | null {
  if (error instanceof ProviderBlockedError) return error.block;
  const record = error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : null;
  const statusCode = extra.statusCode ??
    numberField(record, ["status", "statusCode", "status_code"]);
  const code = extra.code ??
    stringField(record, ["code", "type", "error_code", "errorCode"]);
  return classifyProviderFailure({
    ...extra,
    provider,
    message: providerBlockMessage(error),
    statusCode,
    code,
  });
}

function numberField(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^\d{3}$/u.test(value)) return Number(value);
  }
  return null;
}

function stringField(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
