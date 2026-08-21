import { type AutoHuntSource } from "../../src/lib/auto-hunt-contract";

export const digestRunId = async (
  projectId: string,
  source: AutoHuntSource,
  sourceKey: string,
) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${projectId}\u0000${source}\u0000${sourceKey}`),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const scopedRunKey = async (
  key: string,
  attempt: number,
  revision: number,
) => {
  if (attempt === 1 && revision === 1) return key;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  const fingerprint = [...digest.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const suffix = `:attempt-${attempt}:revision-${revision}:${fingerprint}`;
  return `${key.slice(0, 300 - suffix.length)}${suffix}`;
};

export const scopedEvidenceKey = async (key: string, revision: number) => {
  if (revision === 1) return key;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  const fingerprint = [...digest.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const suffix = `:revision-${revision}:${fingerprint}`;
  return `${key.slice(0, 300 - suffix.length)}${suffix}`;
};
