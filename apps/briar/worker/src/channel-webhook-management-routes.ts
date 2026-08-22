import type { BriarAuth } from "./auth";
import { requireChannelWebhookManagement } from "./channel-route-access";
import { decodeChannelWebhookInput } from "./channel-route-decoders";
import {
  channelWebhookJson,
  createChannelWebhook,
  listChannelWebhooks,
  revokeChannelWebhook,
  rotateChannelWebhook,
  updateChannelWebhook,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { HttpError, json } from "./http-response";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import { randomUrlSafeToken } from "./slack";

export type ChannelWebhookManagementRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
};

export async function handleChannelWebhookManagementRoute(
  routeInput: ChannelWebhookManagementRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db } = routeInput;
  const { pathname } = url;

  const channelWebhooksMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/webhooks$/u,
  );
  if (channelWebhooksMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db,
      channelWebhooksMatch[1],
      channelWebhooksMatch[2],
      session.user.id,
    );
    return json({
      webhooks: (await listChannelWebhooks(db, channel.id)).map(
        channelWebhookJson,
      ),
    });
  }
  if (channelWebhooksMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db,
      channelWebhooksMatch[1],
      channelWebhooksMatch[2],
      session.user.id,
    );
    if (channel.archived_at) throw new HttpError(409, "Channel is archived");
    const input = decodeChannelWebhookInput(await readJson(request));
    const secret = randomUrlSafeToken();
    const createdAt = new Date().toISOString();
    const webhook = await createChannelWebhook(db, {
      id: crypto.randomUUID(),
      channelId: channel.id,
      name: input.name,
      secretHash: await sha256(secret),
      createdByUserId: session.user.id,
      createdAt,
    });
    if (!webhook) throw new HttpError(500, "Webhook was not created");
    return json({
      webhook: channelWebhookJson(webhook),
      url: new URL(
        `/hooks/channels/${webhook.id}/${secret}`,
        request.url,
      ).toString(),
    }, 201);
  }

  const channelWebhookMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/webhooks\/([0-9a-f-]+)$/u,
  );
  if (channelWebhookMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db,
      channelWebhookMatch[1],
      channelWebhookMatch[2],
      session.user.id,
    );
    const input = decodeChannelWebhookInput(await readJson(request));
    const webhook = await updateChannelWebhook(db, {
      channelId: channel.id,
      webhookId: channelWebhookMatch[3],
      name: input.name,
      updatedAt: new Date().toISOString(),
    });
    if (!webhook) throw new HttpError(404, "Webhook not found");
    return json({ webhook: channelWebhookJson(webhook) });
  }
  if (channelWebhookMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db,
      channelWebhookMatch[1],
      channelWebhookMatch[2],
      session.user.id,
    );
    const webhook = await revokeChannelWebhook(db, {
      channelId: channel.id,
      webhookId: channelWebhookMatch[3],
      revokedAt: new Date().toISOString(),
    });
    if (!webhook) throw new HttpError(404, "Webhook not found");
    return json({ webhook: channelWebhookJson(webhook) });
  }

  const channelWebhookRotateMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/webhooks\/([0-9a-f-]+)\/rotate$/u,
  );
  if (channelWebhookRotateMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db,
      channelWebhookRotateMatch[1],
      channelWebhookRotateMatch[2],
      session.user.id,
    );
    if (channel.archived_at) throw new HttpError(409, "Channel is archived");
    const secret = randomUrlSafeToken();
    const webhook = await rotateChannelWebhook(db, {
      channelId: channel.id,
      webhookId: channelWebhookRotateMatch[3],
      secretHash: await sha256(secret),
      updatedAt: new Date().toISOString(),
    });
    if (!webhook) throw new HttpError(404, "Webhook not found");
    return json({
      webhook: channelWebhookJson(webhook),
      url: new URL(
        `/hooks/channels/${webhook.id}/${secret}`,
        request.url,
      ).toString(),
    });
  }

  return undefined;
}
