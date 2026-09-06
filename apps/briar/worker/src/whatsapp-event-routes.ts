import { createOrganizationChannelMessage } from "./channel-message-routes";
import { HttpError, json } from "./http-response";
import { createOrganizationDirectMessage } from "./organization-channel-routes";
import { flushOrganizationInboxRealtimeOutbox } from "./realtime-scheduling";
import { sha256 } from "./crypto-digest";
import {
  decodeWhatsAppWebhookMessages,
  verifyWhatsAppSignature,
  whatsappEventClaimTtlMs,
  type WhatsAppInboundMessage,
} from "./whatsapp";
import { flushWhatsAppOutbox } from "./whatsapp-outbox";
import {
  claimWhatsAppEvent,
  completeWhatsAppEvent,
  enqueueWhatsAppSystemMessage,
  getWhatsAppConnectionByPhoneNumberId,
  getWhatsAppConnectionByVerifyTokenHash,
  getWhatsAppUserLinkByPhone,
  recordWhatsAppInboundAt,
  releaseWhatsAppEvent,
} from "./whatsapp-repository";

const unlinkedNumberMessage =
  "이 번호는 Briar 계정에 연결되어 있지 않습니다. 조직 관리자에게 WhatsApp 번호 연결을 요청한 뒤 다시 보내 주세요.";
const unsupportedMessage =
  "현재 Briar WhatsApp 연동은 텍스트 메시지만 지원합니다. 텍스트로 다시 보내 주세요.";

async function inboundChannelMessageId(connectionId: string, wamid: string) {
  const digest = await sha256(`${connectionId}:${wamid}`);
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

async function processWhatsAppMessage(
  env: Env,
  message: WhatsAppInboundMessage,
) {
  const connection = await getWhatsAppConnectionByPhoneNumberId(
    env.DB,
    message.phoneNumberId,
  );
  if (!connection) return;
  const now = new Date();
  const observedAt = now.toISOString();
  const event = await claimWhatsAppEvent(env.DB, {
    connectionId: connection.id,
    wamid: message.wamid,
    senderPhone: message.from,
    messageId: await inboundChannelMessageId(connection.id, message.wamid),
    observedAt,
    staleBefore: new Date(now.getTime() - whatsappEventClaimTtlMs).toISOString(),
  });
  if (!event) return;
  try {
    const link = await getWhatsAppUserLinkByPhone(
      env.DB,
      connection.id,
      message.from,
    );
    if (!link) {
      await enqueueWhatsAppSystemMessage(env.DB, {
        connectionId: connection.id,
        wamid: message.wamid,
        recipientPhone: message.from,
        body: unlinkedNumberMessage,
        observedAt,
      });
      await completeWhatsAppEvent(env.DB, connection.id, message.wamid, observedAt);
      return;
    }
    await recordWhatsAppInboundAt(env.DB, link.id, observedAt);
    if (message.type !== "text" || !message.body) {
      await enqueueWhatsAppSystemMessage(env.DB, {
        connectionId: connection.id,
        wamid: message.wamid,
        recipientPhone: message.from,
        body: unsupportedMessage,
        observedAt,
      });
      await completeWhatsAppEvent(env.DB, connection.id, message.wamid, observedAt);
      return;
    }
    const directMessage = await createOrganizationDirectMessage({
      db: env.DB,
      organizationId: connection.organization_id,
      userId: link.user_id,
      request: { memberIds: [], agentIds: [connection.agent_id] },
    });
    await createOrganizationChannelMessage({
      db: env.DB,
      env,
      organizationId: connection.organization_id,
      channelId: directMessage.channel.id,
      userId: link.user_id,
      request: {
        clientMessageId: event.message_id,
        body: message.body,
        parentMessageId: null,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        skillId: null,
        preferredDeviceId: null,
      },
      attachmentIds: [],
    });
    await completeWhatsAppEvent(env.DB, connection.id, message.wamid, observedAt);
  } catch (error) {
    await releaseWhatsAppEvent(env.DB, connection.id, message.wamid);
    console.error(JSON.stringify({
      message: "WhatsApp inbound message failed",
      connectionId: connection.id,
      wamid: message.wamid,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function processWhatsAppMessages(
  env: Env,
  messages: WhatsAppInboundMessage[],
) {
  await Promise.all(messages.map((message) => processWhatsAppMessage(env, message)));
  await Promise.all([
    flushOrganizationInboxRealtimeOutbox(env, env.DB),
    flushWhatsAppOutbox(env, env.DB),
  ]);
}

async function verifyWebhookChallenge(url: URL, env: Env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token")?.trim();
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token || challenge === null) {
    throw new HttpError(400, "Invalid WhatsApp webhook challenge");
  }
  const connection = await getWhatsAppConnectionByVerifyTokenHash(
    env.DB,
    await sha256(token),
  );
  if (!connection) throw new HttpError(403, "Invalid WhatsApp verify token");
  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handleWebhookEvent(
  request: Request,
  env: Env,
  context?: ExecutionContext,
) {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) {
    throw new HttpError(503, "WhatsApp webhook is not configured");
  }
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (!(await verifyWhatsAppSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    appSecret,
  ))) {
    throw new HttpError(401, "Invalid WhatsApp signature");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new HttpError(400, "Invalid WhatsApp webhook payload");
  }
  const messages = decodeWhatsAppWebhookMessages(payload);
  const processing = processWhatsAppMessages(env, messages);
  if (context) context.waitUntil(processing);
  else await processing;
  return json({ ok: true });
}

export async function handleWhatsAppEventPublicRoute(input: {
  request: Request;
  url: URL;
  env: Env;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  if (input.url.pathname !== "/whatsapp/webhook") return undefined;
  try {
    if (input.request.method === "GET") {
      return await verifyWebhookChallenge(input.url, input.env);
    }
    if (input.request.method === "POST") {
      return await handleWebhookEvent(input.request, input.env, input.context);
    }
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ message: error.message }, error.status);
    }
    console.error(JSON.stringify({
      message: "WhatsApp webhook request failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({ message: "Internal server error" }, 500);
  }
}
