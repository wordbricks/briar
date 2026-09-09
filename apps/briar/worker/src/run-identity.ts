import { type AutoHuntSource } from "../../src/lib/auto-hunt-contract";
import type { TeamIdLike } from "../../src/lib/entity-ids";

const digestUuid = async (parts: readonly string[]) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(parts.join("\u0000")),
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

/** `projectId` here is the owning Team; run ids are derived per Team. */
export const digestRunId = (
  projectId: TeamIdLike,
  source: AutoHuntSource,
  sourceKey: string,
) => digestUuid([projectId, source, sourceKey]);

/**
 * The id of a conversation attachment copied onto an approved issue.
 *
 * The channel attachment's own id cannot be reused: it doubles as a
 * `briar_uploads.upload_id` in the upload-state guards, and the same DM file
 * carried into two issues would collide on the issue attachment primary key.
 * Deriving it from the run instead keeps an approval that reaches this code
 * twice writing the same row rather than a second one.
 */
export const digestIssueAttachmentId = (
  runId: string,
  channelAttachmentId: string,
) => digestUuid([runId, "issue-attachment", channelAttachmentId]);

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
