import * as Schema from "effect/Schema";
import { decodeRequestSync } from "./request-schema";
import {
  decryptSlackToken,
  encryptSlackToken,
} from "./slack";

const encoder = new TextEncoder();

const boundedText = (minimum: number, maximum: number) =>
  Schema.Trim.check(
    Schema.isLengthBetween(minimum, maximum),
  );

const WhatsAppText = Schema.Struct({
  body: boundedText(1, 100_000),
});

const WhatsAppMessage = Schema.Struct({
  from: boundedText(1, 32),
  id: boundedText(1, 500),
  timestamp: Schema.optional(boundedText(1, 32)),
  type: boundedText(1, 64),
  text: Schema.optional(WhatsAppText),
});

const WhatsAppValue = Schema.Struct({
  metadata: Schema.Struct({
    phone_number_id: boundedText(1, 64),
  }),
  messages: Schema.optional(Schema.Array(WhatsAppMessage)),
});

const WhatsAppWebhookPayload = Schema.Struct({
  object: boundedText(1, 100),
  entry: Schema.optional(Schema.Array(Schema.Struct({
    changes: Schema.Array(Schema.Struct({
      field: boundedText(1, 100),
      value: WhatsAppValue,
    })),
  }))),
});

const WhatsAppApiErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.Finite),
    message: Schema.optional(Schema.String),
  }),
});

export type WhatsAppInboundMessage = {
  phoneNumberId: string;
  from: string;
  wamid: string;
  type: string;
  body: string | null;
};

export const whatsappEventClaimTtlMs = 5 * 60_000;
export const whatsappOutboxClaimTtlMs = 5 * 60_000;
export const whatsappCustomerServiceWindowMs = 24 * 60 * 60_000;
export const whatsappMaximumTextLength = 4_096;
export const whatsappMaximumDeliveryAttempts = 8;

export const encryptWhatsAppToken = encryptSlackToken;
export const decryptWhatsAppToken = decryptSlackToken;

export function normalizeWhatsAppPhoneNumber(value: string) {
  const normalized = value.replace(/[+()\s.-]/gu, "");
  return /^\d{8,20}$/u.test(normalized) ? normalized : null;
}

export function decodeWhatsAppWebhookMessages(
  input: unknown,
): WhatsAppInboundMessage[] {
  const payload = decodeRequestSync(WhatsAppWebhookPayload)(input);
  if (payload.object !== "whatsapp_business_account") return [];
  return (payload.entry ?? []).flatMap((entry) =>
    entry.changes.flatMap((change) => {
      if (change.field !== "messages") return [];
      return (change.value.messages ?? []).flatMap((message) => {
        const from = normalizeWhatsAppPhoneNumber(message.from);
        if (!from) return [];
        return [{
          phoneNumberId: change.value.metadata.phone_number_id,
          from,
          wamid: message.id,
          type: message.type,
          body: message.type === "text" ? message.text?.body.trim() || null : null,
        }];
      });
    })
  );
}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const timingSafeEqual = (left: string, right: string) => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

export async function verifyWhatsAppSignature(
  rawBody: Uint8Array,
  signature: string | null,
  appSecret: string,
) {
  if (!signature || !/^sha256=[0-9a-f]{64}$/u.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, Uint8Array.from(rawBody)),
  );
  return timingSafeEqual(`sha256=${bytesToHex(digest)}`, signature);
}

export function markdownToWhatsApp(markdown: string) {
  return markdown
    .replace(/\r\n?/gu, "\n")
    .replace(/^```[^\n`]*$/gmu, "```")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, (_match, label, url) =>
      `${String(label).trim() || "첨부 이미지"} (${String(url).trim()})`
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label, url) =>
      `${String(label).trim()} (${String(url).trim()})`
    )
    .replace(/^#{1,6}\s+(.+)$/gmu, "*$1*")
    .replace(/\*\*([^*\n]+)\*\*/gu, "*$1*")
    .replace(/__([^_\n]+)__/gu, "*$1*")
    .replace(/~~([^~\n]+)~~/gu, "~$1~")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function splitWhatsAppText(
  text: string,
  maximumLength = whatsappMaximumTextLength,
) {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 1) {
    throw new Error("WhatsApp text limit must be a positive integer");
  }
  const remaining = Array.from(text.trim());
  const chunks: string[] = [];
  while (remaining.length > maximumLength) {
    let boundary = maximumLength;
    for (let index = maximumLength; index >= Math.floor(maximumLength / 2); index -= 1) {
      if (remaining[index - 1] === "\n") {
        boundary = index;
        break;
      }
      if (/\s/u.test(remaining[index - 1] ?? "")) boundary = index;
    }
    const chunk = remaining.splice(0, boundary).join("").trim();
    if (chunk) chunks.push(chunk);
    while (remaining[0] && /\s/u.test(remaining[0])) remaining.shift();
  }
  const tail = remaining.join("").trim();
  if (tail) chunks.push(tail);
  return chunks;
}

export function buildWhatsAppReplyChunks(input: {
  body: string;
  approvalSummary?: string | null;
  appOrigin: string;
  workspaceId: string;
  channelId: string;
  messageId: string;
}) {
  const sections = [markdownToWhatsApp(input.body)];
  if (input.approvalSummary) {
    const origin = input.appOrigin.replace(/\/+$/u, "");
    sections.push([
      `*${input.approvalSummary}*`,
      "검토와 승인은 보안을 위해 Briar 앱에서만 할 수 있습니다.",
      `${origin}/open/channels/${input.workspaceId}/${input.channelId}/${input.messageId}`,
    ].join("\n"));
  }
  const text = sections.filter(Boolean).join("\n\n") || "Briar에서 답변이 도착했습니다.";
  return splitWhatsAppText(text);
}

export class WhatsAppApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export async function callWhatsAppMessagesApi(
  input: {
    graphApiVersion: string;
    phoneNumberId: string;
    accessToken: string;
    recipientPhone: string;
    body: string;
  },
  fetcher: typeof fetch = fetch,
) {
  const version = /^v\d+\.\d+$/u.test(input.graphApiVersion)
    ? input.graphApiVersion
    : "v25.0";
  const response = await fetcher(
    `https://graph.facebook.com/${version}/${input.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.recipientPhone,
        type: "text",
        text: { preview_url: false, body: input.body },
      }),
    },
  );
  if (response.ok) return;
  let code: number | null = null;
  let message = `WhatsApp Graph API returned HTTP ${response.status}`;
  try {
    const decoded = Schema.decodeUnknownSync(WhatsAppApiErrorEnvelope)(
      JSON.parse(await response.text()),
    );
    code = decoded.error.code ?? null;
    if (decoded.error.message?.trim()) message = decoded.error.message.trim();
  } catch {}
  throw new WhatsAppApiError(response.status, code, message.slice(0, 1_000));
}
