import * as Option from "effect/Option";
import { decodeReplyUploadTicketPayloadJson } from "./reply-upload-ticket-payload";
import { signJsonToken, verifyJsonToken } from "./signed-json-token";

export const REPLY_UPLOAD_TICKET_MAX_TTL_MS = 10 * 60_000;
const replyUploadTicketDomain = "briar-reply-attachment-upload";

export async function createReplyUploadTicket(
  secret: string,
  input: { attachmentId: string; expiresAt: number },
) {
  return signJsonToken(replyUploadTicketDomain, secret, {
    purpose: "reply-attachment-upload" as const,
    attachmentId: input.attachmentId,
    expiresAt: input.expiresAt,
    nonce: crypto.randomUUID(),
  });
}

export async function verifyReplyUploadTicket(
  secret: string,
  token: string,
  attachmentId: string,
  now = Date.now(),
) {
  const json = Option.getOrNull(
    await verifyJsonToken(replyUploadTicketDomain, secret, token),
  );
  if (json === null) return null;
  const payload = Option.getOrNull(decodeReplyUploadTicketPayloadJson(json));
  if (
    !payload || payload.attachmentId !== attachmentId ||
    payload.expiresAt <= now ||
    payload.expiresAt > now + REPLY_UPLOAD_TICKET_MAX_TTL_MS
  ) {
    return null;
  }
  return payload;
}
