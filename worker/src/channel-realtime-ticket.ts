import * as Option from "effect/Option";
import {
  decodeChannelRealtimeTicketPayloadJson,
  type ChannelRealtimeTicketPayload,
} from "./channel-realtime-ticket-payload";
import { signJsonToken, verifyJsonToken } from "./signed-json-token";

export const CHANNEL_REALTIME_TICKET_TTL_MS = 60_000;
const channelRealtimeTokenDomain = "briar-channel-realtime";

export async function createChannelRealtimeTicket(
  secret: string,
  input: { organizationId: string; userId: string; now?: number },
) {
  const payload: ChannelRealtimeTicketPayload = {
    organizationId: input.organizationId,
    userId: input.userId,
    expiresAt: (input.now ?? Date.now()) + CHANNEL_REALTIME_TICKET_TTL_MS,
    nonce: crypto.randomUUID(),
  };
  return {
    ticket: await signJsonToken(channelRealtimeTokenDomain, secret, payload),
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export async function verifyChannelRealtimeTicket(
  secret: string,
  ticket: string,
  organizationId: string,
  now = Date.now(),
): Promise<ChannelRealtimeTicketPayload | null> {
  const encodedPayload = Option.getOrNull(
    await verifyJsonToken(channelRealtimeTokenDomain, secret, ticket),
  );
  if (encodedPayload === null) return null;
  const payload = Option.getOrNull(
    decodeChannelRealtimeTicketPayloadJson(encodedPayload),
  );
  if (
    !payload ||
    payload.organizationId !== organizationId ||
    payload.expiresAt <= now ||
    payload.expiresAt > now + CHANNEL_REALTIME_TICKET_TTL_MS
  ) {
    return null;
  }
  return payload;
}
