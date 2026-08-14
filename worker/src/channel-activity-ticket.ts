export const CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS = 60_000;
export const CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS = 5 * 60_000;
export const CHANNEL_ACTIVITY_PUBLISH_MAX_TTL_MS = 16 * 60_000;

export type ChannelActivityPublishTokenPayload = {
  purpose: "publish";
  organizationId: string;
  channelId: string;
  replyJobId: string;
  agentId: string;
  triggerMessageId: string;
  parentMessageId: string;
  attempt: number;
  workerId: string;
  deviceId: string;
  expiresAt: number;
  nonce: string;
};

export type ChannelActivitySocketTicketPayload = {
  purpose: "subscribe";
  organizationId: string;
  channelId: string;
  userId: string;
  expiresAt: number;
  authorizationExpiresAt: number;
  nonce: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
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
    encoder.encode(`briar-channel-activity:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );

async function signPayload(secret: string, payload: object) {
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, ["sign"]),
    encoder.encode(encodedPayload),
  );
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifiedPayload(
  secret: string,
  token: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, encodedSignature] = parts;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, ["verify"]),
      base64UrlDecode(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!valid) return null;
    const value = JSON.parse(
      decoder.decode(base64UrlDecode(encodedPayload)),
    ) as unknown;
    return value && typeof value === "object"
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

const validUuid = (value: unknown): value is string =>
  typeof value === "string" && uuidPattern.test(value);
const validShortText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export async function createChannelActivityPublishToken(
  secret: string,
  input: Omit<ChannelActivityPublishTokenPayload, "purpose" | "nonce">,
) {
  const payload: ChannelActivityPublishTokenPayload = {
    purpose: "publish",
    ...input,
    nonce: crypto.randomUUID(),
  };
  return { token: await signPayload(secret, payload), expiresAt: input.expiresAt };
}

export async function verifyChannelActivityPublishToken(
  secret: string,
  token: string,
  replyJobId: string,
  now = Date.now(),
): Promise<ChannelActivityPublishTokenPayload | null> {
  const payload = await verifiedPayload(secret, token);
  if (
    payload?.purpose !== "publish" ||
    payload.replyJobId !== replyJobId ||
    !validUuid(payload.organizationId) ||
    !validUuid(payload.channelId) ||
    !validUuid(payload.replyJobId) ||
    !validUuid(payload.agentId) ||
    !validUuid(payload.triggerMessageId) ||
    !validUuid(payload.parentMessageId) ||
    !Number.isSafeInteger(payload.attempt) ||
    (payload.attempt as number) < 1 ||
    !validShortText(payload.workerId, 64) ||
    !validShortText(payload.deviceId, 200) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    (payload.expiresAt as number) <= now ||
    (payload.expiresAt as number) > now + CHANNEL_ACTIVITY_PUBLISH_MAX_TTL_MS ||
    !validShortText(payload.nonce, 100)
  ) {
    return null;
  }
  return payload as ChannelActivityPublishTokenPayload;
}

export async function createChannelActivitySocketTicket(
  secret: string,
  input: { organizationId: string; channelId: string; userId: string; now?: number },
) {
  const now = input.now ?? Date.now();
  const payload: ChannelActivitySocketTicketPayload = {
    purpose: "subscribe",
    organizationId: input.organizationId,
    channelId: input.channelId,
    userId: input.userId,
    expiresAt: now + CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS,
    authorizationExpiresAt: now + CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS,
    nonce: crypto.randomUUID(),
  };
  return {
    ticket: await signPayload(secret, payload),
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export async function verifyChannelActivitySocketTicket(
  secret: string,
  ticket: string,
  organizationId: string,
  channelId: string,
  now = Date.now(),
): Promise<ChannelActivitySocketTicketPayload | null> {
  const payload = await verifiedPayload(secret, ticket);
  if (
    payload?.purpose !== "subscribe" ||
    payload.organizationId !== organizationId ||
    payload.channelId !== channelId ||
    !validUuid(payload.organizationId) ||
    !validUuid(payload.channelId) ||
    !validShortText(payload.userId, 200) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    (payload.expiresAt as number) <= now ||
    (payload.expiresAt as number) > now + CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS ||
    !Number.isSafeInteger(payload.authorizationExpiresAt) ||
    (payload.authorizationExpiresAt as number) <= now ||
    (payload.authorizationExpiresAt as number) >
      now + CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS ||
    !validShortText(payload.nonce, 100)
  ) {
    return null;
  }
  return payload as ChannelActivitySocketTicketPayload;
}
