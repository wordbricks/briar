import { contentDisposition } from "./attachment-storage";
import { sha256Bytes } from "./crypto-digest";
import {
  enqueueUploadObjectCleanup,
  getScopedUpload,
  markUploadStored,
} from "./upload-repository";
import { verifyUploadCapability } from "./upload-capability";

export class UploadApplicationError extends Error {
  constructor(
    readonly reason: "invalid_request" | "invalid_capability" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "UploadApplicationError";
  }
}

export type UploadApplicationServices = {
  readonly sha256Bytes: typeof sha256Bytes;
  readonly verifyUploadCapability: typeof verifyUploadCapability;
  readonly getScopedUpload: typeof getScopedUpload;
  readonly markUploadStored: typeof markUploadStored;
  readonly enqueueUploadObjectCleanup: typeof enqueueUploadObjectCleanup;
};

const uploadApplicationServices: UploadApplicationServices = {
  sha256Bytes,
  verifyUploadCapability,
  getScopedUpload,
  markUploadStored,
  enqueueUploadObjectCleanup,
};

const equalHexDigest = (stored: ArrayBuffer, actualHex: string) => {
  const storedBytes = new Uint8Array(stored);
  if (storedBytes.byteLength !== 32 || actualHex.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < storedBytes.length; index += 1) {
    const actual = Number.parseInt(actualHex.slice(index * 2, index * 2 + 2), 16);
    difference |= storedBytes[index]! ^ actual;
  }
  return difference === 0;
};

export async function uploadReservedFileApplication(
  input: {
    db: D1Database;
    bucket: R2Bucket;
    signingSecret: string;
    uploadId: string;
    capability: string;
    contentType: string;
    body: ArrayBuffer;
    observedAt?: string;
  },
  overrides: Partial<UploadApplicationServices> = {},
) {
  const services = { ...uploadApplicationServices, ...overrides };
  const observedAt = input.observedAt ?? new Date().toISOString();
  const ticket = await services.verifyUploadCapability(
    input.signingSecret,
    input.capability,
    input.uploadId,
    Date.parse(observedAt),
  );
  if (!ticket) {
    throw new UploadApplicationError(
      "invalid_capability",
      "Upload capability is invalid or expired",
    );
  }
  const upload = await services.getScopedUpload(input.db, input.uploadId);
  if (
    !upload || upload.expires_at <= observedAt || upload.consumed_at
  ) {
    throw new UploadApplicationError("unavailable", "Upload is no longer available");
  }
  const contentType = input.contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== upload.content_type || input.body.byteLength !== upload.byte_size) {
    throw new UploadApplicationError(
      "invalid_request",
      "Uploaded content metadata does not match its reservation",
    );
  }
  const digest = await services.sha256Bytes(input.body);
  if (!equalHexDigest(upload.sha256, digest)) {
    throw new UploadApplicationError(
      "invalid_request",
      "Uploaded content digest does not match its reservation",
    );
  }
  // A client may lose the 204 response and retry its whole prepared batch.
  // Matching immutable metadata and digest make this PUT safely idempotent.
  if (upload.uploaded_at) {
    return { objectKey: upload.object_key, replayed: true };
  }
  await input.bucket.put(upload.object_key, input.body, {
    httpMetadata: {
      contentType: upload.content_type,
      contentDisposition: contentDisposition(upload.filename),
    },
    customMetadata: {
      uploadId: upload.upload_id,
      purpose: upload.purpose,
      organizationId: upload.organization_id,
      ...(upload.project_id ? { projectId: upload.project_id } : {}),
      ...(upload.work_id ? { workId: upload.work_id } : {}),
      ...(upload.run_id ? { runId: upload.run_id } : {}),
    },
  });
  const stored = await services.markUploadStored(
    input.db,
    input.uploadId,
    observedAt,
  );
  if (!stored) {
    const current = await services.getScopedUpload(input.db, input.uploadId);
    if (!current?.uploaded_at) {
      await services.enqueueUploadObjectCleanup(input.db, {
        objectKey: upload.object_key,
        batchRequestId: upload.batch_request_id,
        observedAt,
      });
    }
    throw new UploadApplicationError(
      "unavailable",
      "Upload lost its reservation",
    );
  }
  return { objectKey: upload.object_key, replayed: false };
}
