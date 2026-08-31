import * as Schema from "effect/Schema";
import { decodeClaimedChannelReply } from "./worker-claim-contract";

export const channelReplyClaimValidationError =
  "Channel reply claim response validation failed. Update the Briar Worker and retry.";

// A claim is already running on the server before the Worker decodes it.
// Decode only the authority needed to fail it; never execute a partial claim.
const ChannelReplyClaimReference = Schema.Struct({
  workType: Schema.Literal("channelReply"),
  workId: Schema.String.check(Schema.isUUID()),
  organizationId: Schema.String.check(Schema.isUUID()),
  claimToken: Schema.String.check(
    Schema.isStartsWith("briar_channel_claim_"),
    Schema.isLengthBetween("briar_channel_claim_".length + 1, 200),
  ),
});
type ChannelReplyClaimReference = typeof ChannelReplyClaimReference.Type;
const decodeClaimReference = Schema.decodeUnknownSync(ChannelReplyClaimReference);

export async function decodeChannelReplyClaimOrFail(
  raw: unknown,
  dependencies: {
    organizationId: string;
    failClaim: (
      claim: ChannelReplyClaimReference,
      error: Error,
      signal: AbortSignal,
    ) => Promise<void>;
  },
) {
  try {
    return decodeClaimedChannelReply(raw);
  } catch (cause) {
    let claim: ChannelReplyClaimReference;
    try {
      claim = decodeClaimReference(raw);
    } catch {
      throw new Error(
        `${channelReplyClaimValidationError} Failure was not reported because claim credentials are invalid.`,
        { cause },
      );
    }
    if (claim.organizationId !== dependencies.organizationId) {
      throw new Error(
        `${channelReplyClaimValidationError} Failure was not reported because the organization does not match this Worker.`,
        { cause },
      );
    }
    const error = new Error(channelReplyClaimValidationError, { cause });
    try {
      // Do not send decoder errors, which can contain credentials or context.
      await dependencies.failClaim(claim, error, AbortSignal.timeout(10_000));
    } catch {
      throw new Error(
        `${channelReplyClaimValidationError} Could not confirm failure reporting for reply ${claim.workId}.`,
        { cause },
      );
    }
    throw new Error(
      `${channelReplyClaimValidationError} Reported failure for reply ${claim.workId}.`,
      { cause },
    );
  }
}
