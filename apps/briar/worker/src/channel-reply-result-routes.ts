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
  const match = input.url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  if (
    !match ||
    (input.request.method !== "GET" && input.request.method !== "HEAD")
  ) {
    return undefined;
  }
  const principal = await requireWorkerOrganization(
    input.db,
    input.request,
    match[1],
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
    organizationId: match[1],
    jobId: match[2],
    deviceId: principal.deviceId,
    claimTokenHash: await sha256(claimToken),
    attachmentId: match[3],
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
