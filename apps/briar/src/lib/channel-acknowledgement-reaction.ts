import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { isWorkerEmoji } from "./worker-icon-validation";

/** Optional decoration must never reject an otherwise valid reply. */
export const channelAcknowledgementReactionSchema = Schema.NullOr(
  Schema.String.check(Schema.makeFilter((value) =>
    value.length <= 32 && value === value.trim() && isWorkerEmoji(value)
  )),
).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(null))));

const decodeReaction = Schema.decodeUnknownSync(channelAcknowledgementReactionSchema);
const reactionOutput = Schema.Struct({
  acknowledgementReaction: Schema.optional(Schema.Unknown),
});
const isReactionOutput = Schema.is(reactionOutput);

/** Run before provider codec validation, which can strip field recovery middleware. */
export function normalizeChannelAcknowledgementReaction(output: unknown) {
  if (!isReactionOutput(output) || output.acknowledgementReaction === undefined) return output;
  return { ...output, acknowledgementReaction: decodeReaction(output.acknowledgementReaction) };
}
