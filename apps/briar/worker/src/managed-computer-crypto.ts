const encoder = new TextEncoder();

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function randomManagedComputerRemoteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `briar_remote_${base64Url(bytes)}`;
}

export async function hmacBase64Url(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return base64Url(new Uint8Array(signature));
}

export function normalizePromotionCode(value: string) {
  return value.trim().toUpperCase();
}

export async function promotionCodesEqual(candidate: string, expected: string) {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest(
      "SHA-256",
      encoder.encode(normalizePromotionCode(candidate)),
    ),
    crypto.subtle.digest(
      "SHA-256",
      encoder.encode(normalizePromotionCode(expected)),
    ),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function managedComputerEnrollmentNonce(
  secret: string,
  managedComputerId: string,
  provisioningJobId: string,
) {
  return hmacBase64Url(
    secret,
    `managed-computer-enrollment:${managedComputerId}:${provisioningJobId}`,
  );
}

export async function managedComputerCredential(
  secret: string,
  managedComputerId: string,
  nonce: string,
) {
  return `briar_worker_${await hmacBase64Url(
    secret,
    `managed-computer-credential:${managedComputerId}:${nonce}`,
  )}`;
}

export async function managedComputerSetupToken(
  secret: string,
  managedComputerId: string,
  requestId: string,
) {
  return `briar_setup_${await hmacBase64Url(
    secret,
    `managed-computer-setup:${managedComputerId}:${requestId}`,
  )}`;
}

function base64Bytes(value: string) {
  const binary = atob(value.replace(/\s+/gu, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function verifyEc2IdentityDocumentSignature(
  publicKeyPem: string,
  identityDocument: string,
  identitySignature: string,
) {
  try {
    const publicKey = base64Bytes(
      publicKeyPem
        .replace(/-----BEGIN PUBLIC KEY-----/gu, "")
        .replace(/-----END PUBLIC KEY-----/gu, ""),
    );
    const signature = base64Bytes(identitySignature);
    const key = await crypto.subtle.importKey(
      "spki",
      publicKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      encoder.encode(identityDocument),
    );
  } catch {
    return false;
  }
}
