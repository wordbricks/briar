import {
  acknowledgeWhatsAppOutbox,
  claimWhatsAppOutbox,
  deadLetterWhatsAppOutbox,
  retryWhatsAppOutbox,
  type WhatsAppOutboxClaim,
} from "./whatsapp-repository";
import {
  callWhatsAppMessagesApi,
  decryptWhatsAppToken,
  WhatsAppApiError,
  whatsappCustomerServiceWindowMs,
  whatsappMaximumDeliveryAttempts,
  whatsappOutboxClaimTtlMs,
} from "./whatsapp";

const retryAt = (observedAt: string, nextAttempt: number) =>
  new Date(
    Date.parse(observedAt) + Math.min(
      6 * 60 * 60_000,
      60_000 * 2 ** Math.max(0, nextAttempt - 1),
    ),
  ).toISOString();

const deliveryError = (error: unknown) =>
  error instanceof WhatsAppApiError
    ? `WhatsApp Graph API failed (${error.status}${
      error.code === null ? "" : `/${error.code}`
    }): ${error.message}`
    : error instanceof Error
    ? error.message
    : String(error);

const customerWindowExpired = (
  claim: WhatsAppOutboxClaim,
  observedAt: string,
) => {
  const lastInboundAt = Date.parse(claim.last_customer_message_at);
  const now = Date.parse(observedAt);
  return !Number.isFinite(lastInboundAt) || !Number.isFinite(now) ||
    lastInboundAt + whatsappCustomerServiceWindowMs <= now;
};

export async function flushWhatsAppOutbox(
  env: Pick<
    Env,
    "WHATSAPP_TOKEN_ENCRYPTION_KEY" | "WHATSAPP_GRAPH_API_VERSION"
  >,
  db: D1Database,
  observedAt = new Date().toISOString(),
  limit = 25,
  fetcher: typeof fetch = fetch,
) {
  const encryptionKey = env.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    return { sent: 0, retried: 0, deadLettered: 0, deferred: 1 };
  }
  const staleBefore = new Date(
    Date.parse(observedAt) - whatsappOutboxClaimTtlMs,
  ).toISOString();
  const claims = await claimWhatsAppOutbox(db, {
    observedAt,
    staleBefore,
    limit,
  });
  let sent = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const claim of claims) {
    try {
      if (customerWindowExpired(claim, observedAt)) {
        throw new WhatsAppApiError(
          400,
          131047,
          "The 24-hour customer service window has expired",
        );
      }
      const accessToken = await decryptWhatsAppToken(
        claim.encrypted_access_token,
        claim.token_iv,
        encryptionKey,
      );
      await callWhatsAppMessagesApi({
        graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v25.0",
        phoneNumberId: claim.phone_number_id,
        accessToken,
        recipientPhone: claim.recipient_phone,
        body: claim.body,
      }, fetcher);
      if (await acknowledgeWhatsAppOutbox(db, claim)) sent += 1;
    } catch (error) {
      const message = deliveryError(error).slice(0, 1_000);
      const nextAttempt = claim.attempts + 1;
      const terminal = error instanceof WhatsAppApiError && error.code === 131047 ||
        nextAttempt >= whatsappMaximumDeliveryAttempts;
      if (terminal) {
        if (await deadLetterWhatsAppOutbox(db, claim, { observedAt, error: message })) {
          deadLettered += 1;
          console.error(JSON.stringify({
            message: "WhatsApp outbox dead-lettered",
            outboxId: claim.id,
            connectionId: claim.connection_id,
            attempts: nextAttempt,
            error: message,
          }));
        }
      } else if (await retryWhatsAppOutbox(db, claim, {
        observedAt,
        nextAttemptAt: retryAt(observedAt, nextAttempt),
        error: message,
      })) {
        retried += 1;
      }
    }
  }
  return { sent, retried, deadLettered, deferred: 0 };
}

export function scheduleWhatsAppOutboxFlush(
  env: Env,
  db: D1Database,
  context?: ExecutionContext,
) {
  const task = flushWhatsAppOutbox(env, db).catch((error) => {
    console.error(JSON.stringify({
      message: "WhatsApp outbox flush failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(task);
  else void task;
}
