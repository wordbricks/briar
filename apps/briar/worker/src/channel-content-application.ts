import { requireChannelAccess } from "./channel-route-access";
import { getChannelMessageDocument } from "./channels";
import { HttpError } from "./http-response";
import { fetchChannelLinkPreview } from "./link-preview";

type ChannelContentApplicationInput = {
  readonly db: D1Database;
  readonly organizationId: string;
  readonly channelId: string;
  readonly userId: string;
};

export async function getChannelMessageDocumentApplication(
  input: ChannelContentApplicationInput & { readonly messageId: string },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const document = await getChannelMessageDocument(
    input.db,
    channel.id,
    input.messageId,
  );
  if (!document) throw new HttpError(404, "Document not found");
  return document;
}

export async function getChannelLinkPreviewApplication(
  input: ChannelContentApplicationInput & { readonly url: string },
) {
  await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (!input.url) throw new HttpError(400, "Link preview URL is required");
  return fetchChannelLinkPreview(input.url);
}
