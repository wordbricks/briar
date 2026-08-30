import type {
  CancelRunRequest,
  ResumeRunRequest,
  RetryRunRequest,
  ReworkRunRequest,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import type { AutoHuntWorkflowStageId } from "../../src/lib/auto-hunt-contract";
import { HttpError } from "./http-response";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";

const canonicalUuid = decodeRequestSync(UuidString);

const optionalReason = (value: string | undefined) => {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 4_000) {
    throw new HttpError(400, "reason must contain 1 to 4000 characters");
  }
  return normalized;
};

const requiredReason = (value: string) => {
  const reason = optionalReason(value);
  if (!reason) throw new HttpError(400, "reason is required");
  return reason;
};

const workflowStage = (value: string, field: string) => {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(normalized)) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return normalized as AutoHuntWorkflowStageId;
};

const positiveUint32 = (value: number, field: string) => {
  if (value < 1) throw new HttpError(400, `${field} must be positive`);
  return value;
};

const identity = (
  request: RetryRunRequest | CancelRunRequest | ResumeRunRequest | ReworkRunRequest,
) => ({
  projectId: canonicalUuid(request.projectId).toLowerCase(),
  runId: canonicalUuid(request.runId).toLowerCase(),
  requestId: canonicalUuid(request.requestId).toLowerCase(),
});

export const recoveryRunCommand = (
  request: RetryRunRequest | CancelRunRequest,
) => ({
  ...identity(request),
  reason: optionalReason(request.reason),
});

export const resumeRunCommand = (request: ResumeRunRequest) => ({
  ...identity(request),
  checkpointKey: workflowStage(request.checkpointKey, "checkpoint_key"),
  attempt: positiveUint32(request.attempt, "attempt"),
  revision: positiveUint32(request.revision, "revision"),
});

export const reworkRunCommand = (request: ReworkRunRequest) => ({
  ...identity(request),
  workflowStage: workflowStage(request.workflowStage, "workflow_stage"),
  reason: requiredReason(request.reason),
  checkpoint: request.checkpoint
    ? {
        key: workflowStage(request.checkpoint.key, "checkpoint.key"),
        attempt: positiveUint32(request.checkpoint.attempt, "checkpoint.attempt"),
        revision: positiveUint32(
          request.checkpoint.revision,
          "checkpoint.revision",
        ),
      }
    : undefined,
});
