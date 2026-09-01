import { requireChannelWebhookManagement } from "./channel-route-access";
import {
  createChannelWebhook,
  listChannelWebhooks,
  revokeChannelWebhook,
  rotateChannelWebhook,
  updateChannelWebhook,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import { randomUrlSafeToken } from "./slack";

type ChannelWebhookApplicationInput = {
  readonly db: D1Database;
  readonly organizationId: string;
  readonly channelId: string;
  readonly userId: string;
};

export async function listChannelWebhooksApplication(
  input: ChannelWebhookApplicationInput,
) {
  const channel = await requireChannelWebhookManagement(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  return listChannelWebhooks(input.db, channel.id);
}

export async function createChannelWebhookApplication(
  input: ChannelWebhookApplicationInput & { readonly name: string },
) {
  const channel = await requireChannelWebhookManagement(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (channel.archived_at) throw new HttpError(409, "Channel is archived");
  const secret = randomUrlSafeToken();
  const createdAt = new Date().toISOString();
  const webhook = await createChannelWebhook(input.db, {
    id: crypto.randomUUID(),
    channelId: channel.id,
    name: input.name,
    secretHash: await sha256(secret),
    createdByUserId: input.userId,
    createdAt,
  });
  if (!webhook) throw new HttpError(500, "Webhook was not created");
  return { webhook, secret };
}

export async function updateChannelWebhookApplication(
  input: ChannelWebhookApplicationInput & {
    readonly webhookId: string;
    readonly name: string;
  },
) {
  const channel = await requireChannelWebhookManagement(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const webhook = await updateChannelWebhook(input.db, {
    channelId: channel.id,
    webhookId: input.webhookId,
    name: input.name,
    updatedAt: new Date().toISOString(),
  });
  if (!webhook) throw new HttpError(404, "Webhook not found");
  return webhook;
}

export async function rotateChannelWebhookApplication(
  input: ChannelWebhookApplicationInput & { readonly webhookId: string },
) {
  const channel = await requireChannelWebhookManagement(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (channel.archived_at) throw new HttpError(409, "Channel is archived");
  const secret = randomUrlSafeToken();
  const webhook = await rotateChannelWebhook(input.db, {
    channelId: channel.id,
    webhookId: input.webhookId,
    secretHash: await sha256(secret),
    updatedAt: new Date().toISOString(),
  });
  if (!webhook) throw new HttpError(404, "Webhook not found");
  return { webhook, secret };
}

export async function revokeChannelWebhookApplication(
  input: ChannelWebhookApplicationInput & { readonly webhookId: string },
) {
  const channel = await requireChannelWebhookManagement(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const webhook = await revokeChannelWebhook(input.db, {
    channelId: channel.id,
    webhookId: input.webhookId,
    revokedAt: new Date().toISOString(),
  });
  if (!webhook) throw new HttpError(404, "Webhook not found");
  return webhook;
}
