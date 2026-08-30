import { durationFromMs, durationMs } from "@bufbuild/protobuf/wkt";
import {
  MergeQueueBatchState as ProtoBatchState,
  MergeQueueCandidateState as ProtoCandidateState,
  type GetMergeQueueStatusResponse,
  type MergeQueueProfile as MergeQueueProfileMessage,
} from "@briar/contracts/gen/briar/app/v1/merge_queue_pb";
import type {
  MergeQueueBatchState,
  MergeQueueCandidateState,
  MergeQueueProfile,
} from "../../types";
import {
  optionalTimestamp,
  requiredMessage,
  requiredTimestamp,
  safeNumber,
} from "./mappers";

const quietWindowMs = (
  value: MergeQueueProfileMessage["quietWindow"],
  field: string,
): number => {
  const result = durationMs(requiredMessage(value, field));
  if (!Number.isSafeInteger(result) || result < 1_000 || result > 300_000) {
    throw new Error(`${field} must be an integer from 1000 to 300000 milliseconds`);
  }
  return result;
};

export const mergeQueueQuietWindowToProto = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error("mergeQueue.quietWindowMs must be an integer from 1000 to 300000");
  }
  return durationFromMs(value);
};

const maxBatchSize = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value < 2 || value > 5) {
    throw new Error(`${field} must be an integer from 2 to 5`);
  }
  return value;
};

const positiveSafeNumber = (value: bigint, field: string): number => {
  const result = safeNumber(value, field);
  if (result < 1) throw new Error(`${field} must be positive`);
  return result;
};

export const mergeQueueProfileFromProto = (
  value: MergeQueueProfileMessage,
): MergeQueueProfile => {
  if (value.baseBranch !== "main") {
    throw new Error(`Unknown merge queue base branch: ${value.baseBranch}`);
  }
  if (value.validationCommands.length < 1 || value.validationCommands.length > 20) {
    throw new Error("mergeQueue.validationCommands must contain 1 to 20 commands");
  }
  return {
    projectId: value.projectId,
    repositoryId: positiveSafeNumber(value.repositoryId, "mergeQueue.repositoryId"),
    repository: value.repository,
    baseBranch: value.baseBranch,
    enabled: value.enabled,
    readinessStageId: value.readinessStageId,
    validationCommands: value.validationCommands,
    quietWindowMs: quietWindowMs(value.quietWindow, "mergeQueue.quietWindow"),
    maxBatchSize: maxBatchSize(value.maxBatchSize, "mergeQueue.maxBatchSize"),
    updatedAt: requiredTimestamp(value.updatedAt, "mergeQueue.updatedAt"),
  };
};

const batchStateFromProto = (
  value: ProtoBatchState,
): MergeQueueBatchState => {
  switch (value) {
    case ProtoBatchState.COLLECTING:
      return "collecting";
    case ProtoBatchState.FROZEN:
      return "frozen";
    case ProtoBatchState.ENQUEUEING:
      return "enqueueing";
    case ProtoBatchState.WAITING_TAIL:
      return "waiting_tail";
    case ProtoBatchState.VALIDATING:
      return "validating";
    case ProtoBatchState.PUBLISHING:
      return "publishing";
    case ProtoBatchState.AWAITING_MERGE:
      return "awaiting_merge";
    case ProtoBatchState.BLOCKED:
      return "blocked";
    case ProtoBatchState.DRAINING:
      return "draining";
    case ProtoBatchState.COMPLETED:
      return "completed";
    case ProtoBatchState.FAILED:
      return "failed";
    case ProtoBatchState.UNSPECIFIED:
      throw new Error("Merge queue batch state is missing");
    default:
      throw new Error(`Unknown merge queue batch state: ${value}`);
  }
};

const candidateStateFromProto = (
  value: ProtoCandidateState,
): MergeQueueCandidateState => {
  switch (value) {
    case ProtoCandidateState.READY:
      return "ready";
    case ProtoCandidateState.FROZEN:
      return "frozen";
    case ProtoCandidateState.ENQUEUED:
      return "enqueued";
    case ProtoCandidateState.MERGED:
      return "merged";
    case ProtoCandidateState.DEQUEUED:
      return "dequeued";
    case ProtoCandidateState.FAILED:
      return "failed";
    case ProtoCandidateState.UNSPECIFIED:
      throw new Error("Merge queue candidate state is missing");
    default:
      throw new Error(`Unknown merge queue candidate state: ${value}`);
  }
};

export const mergeQueueStatusFromProto = (
  response: GetMergeQueueStatusResponse,
) => ({
  status: {
    batches: response.batches.map((batch) => ({
      id: batch.id,
      state: batchStateFromProto(batch.state),
      candidateCount: batch.candidateCount,
      quietUntil: requiredTimestamp(batch.quietUntil, "mergeQueueBatch.quietUntil"),
      frozenAt: optionalTimestamp(batch.frozenAt),
      mergeGroupSha: batch.mergeGroupSha ?? null,
      failureCode: batch.failureCode ?? null,
      completedAt: optionalTimestamp(batch.completedAt),
      createdAt: requiredTimestamp(batch.createdAt, "mergeQueueBatch.createdAt"),
      updatedAt: requiredTimestamp(batch.updatedAt, "mergeQueueBatch.updatedAt"),
    })),
    candidates: response.candidates.map((candidate) => ({
      id: candidate.id,
      batchId: candidate.batchId ?? null,
      runId: candidate.runId,
      pullRequestNumber: positiveSafeNumber(
        candidate.pullRequestNumber,
        "mergeQueueCandidate.pullRequestNumber",
      ),
      pullRequestUrl: candidate.pullRequestUrl,
      state: candidateStateFromProto(candidate.state),
      ordinal: candidate.ordinal ?? null,
      readyAt: requiredTimestamp(candidate.readyAt, "mergeQueueCandidate.readyAt"),
      failureCode: candidate.failureCode ?? null,
      updatedAt: requiredTimestamp(candidate.updatedAt, "mergeQueueCandidate.updatedAt"),
    })),
  },
  generatedAt: requiredTimestamp(response.generatedAt, "mergeQueue.generatedAt"),
});
