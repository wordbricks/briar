import * as Option from "effect/Option";
import { signJsonToken, verifyJsonToken } from "./signed-json-token";
import { decodeUploadCapabilityPayloadJson } from "./upload-capability-payload";

export const UPLOAD_CAPABILITY_MAX_TTL_MS = 10 * 60_000;
const uploadCapabilityDomain = "briar-raw-upload";

export async function createUploadCapability(
  secret: string,
  input: { uploadId: string; expiresAt: number },
) {
  return signJsonToken(uploadCapabilityDomain, secret, {
    purpose: "raw-upload" as const,
    uploadId: input.uploadId,
    expiresAt: input.expiresAt,
    nonce: crypto.randomUUID(),
  });
}

export async function verifyUploadCapability(
  secret: string,
  token: string,
  uploadId: string,
  now = Date.now(),
) {
  const json = Option.getOrNull(
    await verifyJsonToken(uploadCapabilityDomain, secret, token),
  );
  if (json === null) return null;
  const payload = Option.getOrNull(decodeUploadCapabilityPayloadJson(json));
  if (
    !payload || payload.uploadId !== uploadId || payload.expiresAt <= now ||
    payload.expiresAt > now + UPLOAD_CAPABILITY_MAX_TTL_MS
  ) return null;
  return payload;
}
