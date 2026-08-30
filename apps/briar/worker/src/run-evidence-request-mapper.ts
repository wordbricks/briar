import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  RunEvidence_Status,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import type {
  RecordRunEvidenceRequest,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { HttpError } from "./http-response";
import {
  decodeRunEvidenceApplicationInput,
} from "./run-request-contract";

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
