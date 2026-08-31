import { matchChannelReplyAttachmentPath } from "../../src/lib/channel-reply-attachment-path";
import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import { channelAttachmentResponse } from "./channel-attachment-response";
import { getClaimedChannelReplyAttachment } from "./channels";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import { requireWorkerOrganization } from "./worker-route-auth";

export type ChannelReplyResultRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  attachmentsBucket: R2Bucket;
};

export async function handleChannelReplyResultRoute(
  input: ChannelReplyResultRouteInput,
): Promise<Response | undefined> {
  const match = matchChannelReplyAttachmentPath(input.url.pathname);
  if (
    !match ||
    (input.request.method !== "GET" && input.request.method !== "HEAD")
  ) {
    return undefined;
  }
  const principal = await requireWorkerOrganization(
    input.db,
    input.request,
    match.organizationId,
  );
  const claimToken = input.request.headers
    .get(channelReplyClaimTokenHeader)
    ?.trim();
  if (
    !claimToken?.startsWith("briar_channel_claim_") ||
    claimToken.length > 200
  ) {
    throw new HttpError(401, "Channel reply claim token required");
  }
  const attachment = await getClaimedChannelReplyAttachment(input.db, {
    organizationId: match.organizationId,
    jobId: match.workId,
    deviceId: principal.deviceId,
    claimTokenHash: await sha256(claimToken),
    attachmentId: match.attachmentId,
    observedAt: new Date().toISOString(),
  });
  if (!attachment) throw new HttpError(404, "Attachment not found");
  if (input.request.method === "HEAD") {
    const object = await input.attachmentsBucket.head(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return channelAttachmentResponse(attachment, object, null);
  }
  const object = await input.attachmentsBucket.get(attachment.object_key);
  if (!object) throw new HttpError(404, "Attachment not found");
  return channelAttachmentResponse(attachment, object, object.body);
}
