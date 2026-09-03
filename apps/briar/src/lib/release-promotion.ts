import * as Schema from "effect/Schema";

const StableVersion = Schema.String.check(
  Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u),
);
const CommitSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);

export const ReleasePromotionPayload = Schema.Struct({
  commitSha: CommitSha,
  version: StableVersion,
});
export type ReleasePromotionPayload = typeof ReleasePromotionPayload.Type;

const ReleasePromotionPayloadJson = Schema.fromJsonString(
  ReleasePromotionPayload,
);
const decodePromotionJson = Schema.decodeUnknownSync(ReleasePromotionPayloadJson);

export function releasePromotionPayload(input: ReleasePromotionPayload) {
  return JSON.stringify({ commitSha: input.commitSha, version: input.version });
}

export function parseReleasePromotionPayload(payload: string) {
  return decodePromotionJson(payload);
}

export function compareStableVersions(left: string, right: string) {
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index]! < rightParts[index]!) return -1;
    if (leftParts[index]! > rightParts[index]!) return 1;
  }
  return 0;
}

const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]{64}$/u.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hmacKey(secret: string, usages: ReadonlyArray<"sign" | "verify">) {
  if (secret.length < 32) {
    throw new Error("RELEASE_PROMOTION_SECRET must contain at least 32 characters.");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    usages,
  );
}

export async function signReleasePromotion(secret: string, payload: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, ["sign"]),
    new TextEncoder().encode(payload),
  );
  return bytesToHex(signature);
}

export async function verifyReleasePromotion(
  secret: string,
  payload: string,
  signature: string,
) {
  const bytes = hexToBytes(signature);
  if (!bytes) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, ["verify"]),
    bytes,
    new TextEncoder().encode(payload),
  );
}
