import {
  providerBlockRecovery,
  type ProviderBlock,
} from "../../src/lib/provider-block";

export const MAX_REPLY_FAILURE_ATTEMPTS = 3;

export type ReplyFailureDisposition = "requeued" | "failed";

/**
 * Decide whether a failed reply attempt goes back to the queue.
 *
 * An ordinary failure retries until the attempt budget is spent. A provider
 * block is different: when the request itself cannot succeed anywhere (the
 * prompt no longer fits, the model does not exist) the job fails now, and
 * when only this Worker's provider account is blocked the job is requeued
 * only if another live Worker can actually take it. Otherwise the requester
 * would watch a queued job go nowhere, which is the silence this replaces.
 */
export function replyFailureDisposition(input: {
  attempts: number;
  block: ProviderBlock | null;
  anotherWorkerAvailable: boolean;
  maxAttempts?: number;
}): ReplyFailureDisposition {
  const maxAttempts = input.maxAttempts ?? MAX_REPLY_FAILURE_ATTEMPTS;
  if (!input.block) {
    return input.attempts >= maxAttempts ? "failed" : "requeued";
  }
  if (providerBlockRecovery(input.block.reason) === "request") return "failed";
  if (input.attempts >= maxAttempts) return "failed";
  return input.anotherWorkerAvailable ? "requeued" : "failed";
}
