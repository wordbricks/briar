import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  RunEvidence_Status,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import type {
  PrepareRunEvidenceImageUploadsRequest,
  RecordRunEvidenceRequest,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { validateEvidenceImages } from "../../src/lib/evidence-images";
import { HttpError } from "./http-response";
import {
  decodeRunEvidenceApplicationInput,
} from "./run-request-contract";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { issueWorkIdentity } from "./worker-run-execution-mappers";

const canonicalUuid = decodeRequestSync(UuidString);

const requiredText = (value: string, field: string, maximum: number) => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new HttpError(400, `${field} must contain 1 to ${maximum} characters`);
  }
  return normalized;
};

export const prepareRunEvidenceImageUploadsApplicationRequest = (
  request: PrepareRunEvidenceImageUploadsRequest,
) => {
  if (request.images.length < 1 || request.images.length > 5) {
    throw new HttpError(400, "Evidence image prepare requires 1 to 5 files");
  }
  const clientIds = new Set<string>();
  const images = request.images.map((image) => {
    const clientId = requiredText(image.clientId, "image.client_id", 128);
    if (clientIds.has(clientId)) {
      throw new HttpError(400, "Evidence image client IDs must be unique");
    }
    clientIds.add(clientId);
    const filename = requiredText(
      image.filename.normalize("NFC"),
      "image.filename",
      255,
    );
    if (filename.includes("\0")) {
      throw new HttpError(400, "Evidence image filename is invalid");
    }
    if (image.byteSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new HttpError(400, "Evidence image byte size is invalid");
    }
    if (image.sha256.byteLength !== 32) {
      throw new HttpError(400, "Evidence image SHA-256 must contain 32 bytes");
    }
    return {
      clientId,
      filename,
      contentType: image.contentType.trim().toLowerCase(),
      byteSize: Number(image.byteSize),
      sha256: Uint8Array.from(image.sha256),
    };
  });
  const validation = validateEvidenceImages(images.map((image) => ({
    name: image.filename,
    size: image.byteSize,
    type: image.contentType,
  })));
  if (validation) throw new HttpError(400, validation);
  return {
    requestId: canonicalUuid(request.requestId).toLowerCase(),
    projectId: canonicalUuid(request.projectId).toLowerCase(),
    work: issueWorkIdentity(request.work),
    images,
  };
};

export const runEvidenceImageUploadIds = (
  request: RecordRunEvidenceRequest,
) => {
  if (request.images.length > 5) {
    throw new HttpError(400, "Evidence is limited to 5 image references");
  }
  const uploadIds = request.images.map((image) =>
    canonicalUuid(image.uploadId).toLowerCase()
  );
  if (new Set(uploadIds).size !== uploadIds.length) {
    throw new HttpError(400, "Evidence image references must be unique");
  }
  return uploadIds;
};

const runEvidenceStatus = (status: RunEvidence_Status) => {
  switch (status) {
    case RunEvidence_Status.PENDING:
      return "pending" as const;
    case RunEvidence_Status.PASSED:
      return "passed" as const;
    case RunEvidence_Status.FAILED:
      return "failed" as const;
    case RunEvidence_Status.SKIPPED:
      return "skipped" as const;
    case RunEvidence_Status.UNSPECIFIED:
      throw new HttpError(400, "Evidence status is required");
    default:
      throw new HttpError(400, "Unknown evidence status");
  }
};

const observedAt = (request: RecordRunEvidenceRequest) => {
  if (!request.observedAt) {
    throw new HttpError(400, "Evidence observed time is required");
  }
  try {
    return timestampDate(request.observedAt).toISOString();
  } catch {
    throw new HttpError(400, "Evidence observed time is invalid");
  }
};

export const recordRunEvidenceApplicationRequest = (
  request: RecordRunEvidenceRequest,
) => decodeRunEvidenceApplicationInput({
  evidenceKey: request.evidenceKey,
  stage: request.stage,
  type: request.type,
  status: runEvidenceStatus(request.status),
  observedAt: observedAt(request),
  actor: request.actor,
  detail: request.detail ?? null,
  command: request.command ?? null,
  url: request.url ?? null,
  metadata: request.metadata ?? null,
});
