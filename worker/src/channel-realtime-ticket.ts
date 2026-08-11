export const CHANNEL_REALTIME_TICKET_TTL_MS = 60_000;

type ChannelRealtimeTicketPayload = {
  organizationId: string;
  userId: string;
  expiresAt: number;
  nonce: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const base64UrlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const base64UrlDecode = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const hmacKey = (secret: string, usages: KeyUsage[]) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(`briar-channel-realtime:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );

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
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, ["sign"]),
    encoder.encode(encodedPayload),
  );
  return {
    ticket: `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`,
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export async function verifyChannelRealtimeTicket(
  secret: string,
  ticket: string,
  organizationId: string,
  now = Date.now(),
): Promise<ChannelRealtimeTicketPayload | null> {
  try {
    const parts = ticket.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, encodedSignature] = parts;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, ["verify"]),
      base64UrlDecode(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!valid) return null;
    const payload = JSON.parse(
      decoder.decode(base64UrlDecode(encodedPayload)),
    ) as Partial<ChannelRealtimeTicketPayload>;
    if (
      payload.organizationId !== organizationId ||
      typeof payload.userId !== "string" ||
      payload.userId.length < 1 ||
      typeof payload.expiresAt !== "number" ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= now ||
      payload.expiresAt > now + CHANNEL_REALTIME_TICKET_TTL_MS ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 1
    ) {
      return null;
    }
    return payload as ChannelRealtimeTicketPayload;
  } catch {
    return null;
  }
}
