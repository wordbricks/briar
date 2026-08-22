import * as SchemaIssue from "effect/SchemaIssue";
import {
  channelIncomingWebhookMessageSchema,
  channelMessageBlocksFallback,
} from "../../src/lib/channels-contract";
import {
  consumeChannelWebhookRateLimit,
  createIncomingChannelWebhookMessage,
  getIncomingChannelWebhook,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { HttpError, json } from "./http-response";
import { readJson } from "./request-readers";
import { decodeRequestSync, RequestDecodeError } from "./request-schema";
import { scheduleChannelRealtimePublish } from "./realtime-scheduling";

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const decodeChannelIncomingWebhookMessage = decodeRequestSync(
  channelIncomingWebhookMessageSchema,
);

export type IncomingChannelWebhookRouteInput = {
  request: Request;
  env: Env;
  context?: ExecutionContext;
};

async function receiveIncomingChannelWebhook(
  request: Request,
  env: Env,
  context: ExecutionContext | undefined,
  webhookId: string,
  secret: string,
) {
  const webhook = await getIncomingChannelWebhook(
    env.DB,
    webhookId,
    await sha256(secret),
  );
  if (!webhook) throw new HttpError(404, "Webhook not found");
  if (webhook.channel_archived_at) {
    throw new HttpError(409, "Channel is archived");
  }
  if (
    !request.headers.get("content-type")?.toLowerCase().startsWith(
      "application/json",
    )
  ) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const observedAt = new Date();
  const allowed = await consumeChannelWebhookRateLimit(
    env.DB,
    webhook.id,
    observedAt.toISOString(),
    new Date(observedAt.getTime() - 60_000).toISOString(),
  );
  if (!allowed) throw new HttpError(429, "Webhook rate limit exceeded");

  const input = decodeChannelIncomingWebhookMessage(
    await readJson(request, 65_536),
  );
  const rawHeaderEventId = request.headers.get("idempotency-key");
  const headerEventId = rawHeaderEventId?.trim() ?? null;
  if (
    rawHeaderEventId !== null &&
    (!headerEventId || headerEventId.length > 200)
  ) {
    throw new HttpError(400, "Invalid idempotency key");
  }
  if (headerEventId && input.eventId && input.eventId !== headerEventId) {
    throw new HttpError(400, "Invalid idempotency key");
  }

  const eventId = input.eventId ?? headerEventId;
  const result = await createIncomingChannelWebhookMessage(env.DB, {
    id: crypto.randomUUID(),
    webhookId: webhook.id,
    channelId: webhook.channel_id,
    webhookName: webhook.name,
    eventId,
    body: input.text ?? channelMessageBlocksFallback(input.blocks ?? []),
    blocks: input.blocks ?? null,
    createdAt: observedAt.toISOString(),
  });
  if (!result?.message) throw new HttpError(500, "Message was not created");
  if (result.created) {
    scheduleChannelRealtimePublish(
      env,
      env.DB,
      webhook.organization_id,
      context,
    );
  }
  return json(
    { message: result.message, duplicate: !result.created },
    result.created ? 201 : 200,
  );
}

export async function handleIncomingChannelWebhookRoute(
  routeInput: IncomingChannelWebhookRouteInput,
): Promise<Response | undefined> {
  const { request, env, context } = routeInput;
  const webhookMatch = new URL(request.url).pathname.match(
    /^\/hooks\/channels\/([0-9a-f-]+)\/([A-Za-z0-9_-]{43})$/u,
  );
  if (!webhookMatch || request.method !== "POST") return undefined;

  try {
    return await receiveIncomingChannelWebhook(
      request,
      env,
      context,
      webhookMatch[1],
      webhookMatch[2],
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ message: error.message }, error.status);
    }
    if (error instanceof RequestDecodeError) {
      return json(
        {
          message: "Invalid request",
          issues: formatSchemaIssue(error.cause.issue).issues,
        },
        400,
      );
    }
    console.error(
      JSON.stringify({
        message: "Incoming channel webhook failed",
        webhookId: webhookMatch[1],
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ message: "Internal server error" }, 500);
  }
}
