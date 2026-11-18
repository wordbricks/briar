import type { ProviderBlock } from "../src/lib/provider-block";
import { providerBlockHeadline } from "../src/lib/provider-block";

/*
  A reply to a person in a 1:1 DM must not report its failure text: provider
  stderr, schema errors and transport messages can echo the prompt, recalled
  memory or the DM itself, and the reported failure is stored and shown beside
  the conversation. Such a reply reports one fixed code, and a provider block
  keeps its reason and provider with the headline only. The original error
  stays as the cause, which only `replyErrorDiagnostic` reads, and that line
  (its shape: class, machine codes, stack frames) never leaves this Worker.
*/

/**
 * Codes that carry no conversation text and may be reported as they are.
 * Enumerated rather than prefix-matched, so a message cannot pass by merely
 * starting like a code.
 */
const dmReplyFailureCodes = new Set([
  "memory_scope_revoked", "memory_snapshot_changed", "memory_unavailable", "memory_request_invalid",
  "memory_response_invalid", "memory_response_missing", "memory_response_missing_memory",
  "memory_response_missing_response", "memory_response_too_large", "memory_transport_failed",
  "memory_invocation_aborted", "memory_invocation_closed", "lookup_budget_exhausted", "lookup_request_conflict",
  "lookup_in_progress", "lookup_failed",
]);

/** Reported for any other DM failure. */
export const dmReplyRedactedFailureCode = "memory_reply_failed";

/** A known code as it is, anything else as `memory_reply_failed`; the original is the cause. */
export function dmReplyRedactedError(error: unknown): Error {
  const code = error instanceof Error ? error.message : "";
  return new Error(dmReplyFailureCodes.has(code) ? code : dmReplyRedactedFailureCode, { cause: error });
}

/**
 * Whether this reply's failures are redacted. The claim says so for every
 * person's DM (`ClaimedChannelReply.direct_message`); an older server does not
 * send the field (`null`), which redacts too. A vault context scoped to a DM
 * redacts regardless.
 */
export function dmReplyRedacted(
  reply: { readonly directMessage: boolean | null },
  vaultScopeKind: string | null = null,
) {
  return reply.directMessage !== false || vaultScopeKind === "dm";
}

/** Keep the reason and provider; drop provider text that could echo a prompt. */
export function dmSafeProviderBlock(block: ProviderBlock): ProviderBlock {
  return { ...block, message: providerBlockHeadline(block) };
}
