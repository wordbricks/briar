import * as Option from "effect/Option";
import {
  decodeChannelActivityPublishTokenPayloadJson,
  decodeChannelActivitySocketTicketPayloadJson,
  decodeIssueActivityPublishTokenPayloadJson,
  decodeIssueActivitySocketTicketPayloadJson,
  type ChannelActivityPublishTokenPayload,
  type ChannelActivitySocketTicketPayload,
  type IssueActivityPublishTokenPayload,
  type IssueActivitySocketTicketPayload,
} from "./channel-activity-ticket-payload";

export type {
  ChannelActivityPublishTokenPayload,
  ChannelActivitySocketTicketPayload,
  IssueActivityPublishTokenPayload,
  IssueActivitySocketTicketPayload,
} from "./channel-activity-ticket-payload";

export const CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS = 60_000;
export const CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS = 5 * 60_000;
export const CHANNEL_ACTIVITY_PUBLISH_MAX_TTL_MS = 16 * 60_000;
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
): Promise<string | null> {
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
    return decoder.decode(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }
}

const expiresWithin = (expiresAt: number, now: number, maximumTtl: number) =>
  expiresAt > now && expiresAt <= now + maximumTtl;

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
  const encodedPayload = await verifiedPayload(secret, token);
  if (encodedPayload === null) return null;
  const payload = Option.getOrNull(
    decodeChannelActivityPublishTokenPayloadJson(encodedPayload),
  );
  if (
    !payload ||
    payload.replyJobId !== replyJobId ||
    !expiresWithin(
      payload.expiresAt,
      now,
      CHANNEL_ACTIVITY_PUBLISH_MAX_TTL_MS,
    )
  ) {
    return null;
  }
  return payload;
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
  const encodedPayload = await verifiedPayload(secret, ticket);
  if (encodedPayload === null) return null;
  const payload = Option.getOrNull(
    decodeChannelActivitySocketTicketPayloadJson(encodedPayload),
  );
  if (
    !payload ||
    payload.organizationId !== organizationId ||
    payload.channelId !== channelId ||
    !expiresWithin(
      payload.expiresAt,
      now,
      CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS,
    ) ||
    !expiresWithin(
      payload.authorizationExpiresAt,
      now,
      CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS,
    )
  ) {
    return null;
  }
  return payload;
}

export async function createIssueActivityPublishToken(
  secret: string,
  input: Omit<IssueActivityPublishTokenPayload, "purpose" | "nonce">,
) {
  const payload: IssueActivityPublishTokenPayload = {
    purpose: "publish-issue",
    ...input,
    nonce: crypto.randomUUID(),
  };
  return { token: await signPayload(secret, payload), expiresAt: input.expiresAt };
}

export async function verifyIssueActivityPublishToken(
  secret: string,
  token: string,
  replyJobId: string,
  now = Date.now(),
): Promise<IssueActivityPublishTokenPayload | null> {
  const encodedPayload = await verifiedPayload(secret, token);
  if (encodedPayload === null) return null;
  const payload = Option.getOrNull(
    decodeIssueActivityPublishTokenPayloadJson(encodedPayload),
  );
  if (
    !payload ||
    payload.replyJobId !== replyJobId ||
    !expiresWithin(
      payload.expiresAt,
      now,
      CHANNEL_ACTIVITY_PUBLISH_MAX_TTL_MS,
    )
  ) {
    return null;
  }
  return payload;
}

export async function createIssueActivitySocketTicket(
  secret: string,
  input: {
    organizationId: string;
    projectId: string;
    runId: string;
    userId: string;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();
  const payload: IssueActivitySocketTicketPayload = {
    purpose: "subscribe-issue",
    organizationId: input.organizationId,
    projectId: input.projectId,
    runId: input.runId,
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

export async function verifyIssueActivitySocketTicket(
  secret: string,
  ticket: string,
  projectId: string,
  runId: string,
  now = Date.now(),
): Promise<IssueActivitySocketTicketPayload | null> {
  const encodedPayload = await verifiedPayload(secret, ticket);
  if (encodedPayload === null) return null;
  const payload = Option.getOrNull(
    decodeIssueActivitySocketTicketPayloadJson(encodedPayload),
  );
  if (
    !payload ||
    payload.projectId !== projectId ||
    payload.runId !== runId ||
    !expiresWithin(
      payload.expiresAt,
      now,
      CHANNEL_ACTIVITY_SOCKET_TICKET_TTL_MS,
    ) ||
    !expiresWithin(
      payload.authorizationExpiresAt,
      now,
      CHANNEL_ACTIVITY_SOCKET_AUTHORIZATION_TTL_MS,
    )
  ) {
    return null;
  }
  return payload;
}
