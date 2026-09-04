/**
 * Reply contracts decode with `onExcessProperty: "error"`, so a single invented
 * field rejects an otherwise complete answer and the durable reply fails. The
 * model does not invent those fields from the prompt alone: the claim snapshot
 * shows execution targets and earlier proposals that carry server-owned `id`
 * and `status` members, and a reply drifts into copying them.
 *
 * Tightening prompt wording alone did not hold, so a decode failure now feeds
 * the exact validation error back into the same provider conversation and asks
 * for a corrected result. The contract stays strict, the repair costs a turn
 * only when a reply would otherwise have been lost, and an exhausted budget
 * still surfaces the original schema error.
 */

/** Repair turns allowed per reply before the decode failure becomes final. */
export const structuredOutputRepairLimit = 2;

/** Keeps a repair prompt bounded when a contract reports every failed path. */
const repairDetailLimit = 4_000;

/**
 * Marks a contract decode failure so only that failure starts a repair turn.
 * Authorization and policy rejections must stay terminal.
 */
export class ProviderOutputDecodeError extends Error {
  constructor(readonly failure: unknown) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = "ProviderOutputDecodeError";
  }
}

/** Wraps a contract decoder so its failures are repairable. */
export function repairableDecoder<T>(
  decodeJson: (text: string) => T,
): (text: string) => T {
  return (text) => {
    try {
      return decodeJson(text);
    } catch (failure) {
      throw new ProviderOutputDecodeError(failure);
    }
  };
}

/**
 * Returns the prompt for the next repair turn, or rethrows the original failure
 * when the budget is spent or the rejection was never a decode failure. A
 * provider that reports no conversation cannot see the discarded answer, so the
 * repair carries the full reply prompt again.
 */
export function nextStructuredOutputRepairPrompt(input: {
  error: unknown;
  rounds: number;
  basePrompt: string;
  conversationId: string | null;
}): string {
  const { error } = input;
  if (!(error instanceof ProviderOutputDecodeError)) throw error;
  if (input.rounds >= structuredOutputRepairLimit) throw error.failure;
  const repair = structuredOutputRepairPrompt(error);
  return input.conversationId ? repair : `${input.basePrompt}\n\n${repair}`;
}

export function structuredOutputRepairPrompt(error: unknown): string {
  const detail = error instanceof ProviderOutputDecodeError
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error);
  const bounded = detail.length > repairDetailLimit
    ? `${detail.slice(0, repairDetailLimit)}\n…`
    : detail;
  return [
    "Your last result did not satisfy the required response contract, so Briar discarded it. Nothing was delivered to the conversation.",
    `Validation error:\n\n${bounded}`,
    "Return the corrected JSON result now, keeping the same intent, wording, and attachments as the answer you just produced. Use exactly the members the response contract defines: never add a member it does not define, and never copy a server-owned member such as id, status, runId, or createdAt out of snapshot data into your result.",
  ].join("\n\n");
}
