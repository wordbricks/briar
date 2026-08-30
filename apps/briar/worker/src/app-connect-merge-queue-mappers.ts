import { create } from "@bufbuild/protobuf";
import { DurationSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  GetMergeQueueStatusResponseSchema,
  MergeQueueBatchSchema,
  MergeQueueBatchState,
  MergeQueueCandidateSchema,
  MergeQueueCandidateState,
  MergeQueueProfileSchema,
} from "@briar/contracts/gen/briar/app/v1/merge_queue_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import type { MergeBatchCandidateState, MergeBatchState } from "./merge-batches";
import {
  decodeStoredMergeQueueValidationCommands,
  type getMergeQueueStatusApplication,
} from "./merge-queue-application";
import type { MergeQueueProfileRow } from "./merge-queue-profile";

const internal = (message: string): never => {
  throw new ConnectError(message, Code.Internal);
};

const requiredTimestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return internal(`Invalid ${field} timestamp in MergeQueueService response`);
  }
  return timestampFromDate(date);
};

const optionalTimestamp = (value: string | null, field: string) =>
  value === null ? undefined : requiredTimestamp(value, field);

const uint32 = (value: number, field: string) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    return internal(`Invalid uint32 ${field} in MergeQueueService response`);
  }
  return value;
};

const positiveUint64 = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return internal(`Invalid uint64 ${field} in MergeQueueService response`);
  }
  return BigInt(value);
};

const quietWindow = (milliseconds: number) => {
  if (!Number.isInteger(milliseconds) || milliseconds < 1_000 || milliseconds > 300_000) {
    return internal("Invalid quiet window in MergeQueueService response");
  }
  return create(DurationSchema, {
    seconds: BigInt(Math.floor(milliseconds / 1_000)),
    nanos: (milliseconds % 1_000) * 1_000_000,
  });
};

const batchState = (state: MergeBatchState): MergeQueueBatchState => {
  switch (state) {
    case "collecting":
      return MergeQueueBatchState.COLLECTING;
    case "frozen":
      return MergeQueueBatchState.FROZEN;
    case "enqueueing":
      return MergeQueueBatchState.ENQUEUEING;
    case "waiting_tail":
      return MergeQueueBatchState.WAITING_TAIL;
    case "validating":
      return MergeQueueBatchState.VALIDATING;
    case "publishing":
      return MergeQueueBatchState.PUBLISHING;
    case "awaiting_merge":
      return MergeQueueBatchState.AWAITING_MERGE;
    case "blocked":
      return MergeQueueBatchState.BLOCKED;
    case "draining":
      return MergeQueueBatchState.DRAINING;
    case "completed":
      return MergeQueueBatchState.COMPLETED;
    case "failed":
      return MergeQueueBatchState.FAILED;
    default:
      return internal(`Unknown merge queue batch state: ${String(state)}`);
  }
};

const candidateState = (state: MergeBatchCandidateState): MergeQueueCandidateState => {
  switch (state) {
    case "ready":
      return MergeQueueCandidateState.READY;
    case "frozen":
      return MergeQueueCandidateState.FROZEN;
    case "enqueued":
      return MergeQueueCandidateState.ENQUEUED;
    case "merged":
      return MergeQueueCandidateState.MERGED;
    case "dequeued":
      return MergeQueueCandidateState.DEQUEUED;
    case "failed":
      return MergeQueueCandidateState.FAILED;
    default:
      return internal(`Unknown merge queue candidate state: ${String(state)}`);
  }
};

export const appMergeQueueProfile = (row: MergeQueueProfileRow) => {
  if (row.base_branch !== "main") {
    return internal("Invalid merge queue base branch in MergeQueueService response");
  }
  if (!Number.isInteger(row.max_batch_size) || row.max_batch_size < 2 || row.max_batch_size > 5) {
    return internal("Invalid merge queue batch size in MergeQueueService response");
  }
  if (row.enabled !== 0 && row.enabled !== 1) {
    return internal("Invalid merge queue enabled state in MergeQueueService response");
  }
  let validationCommands: readonly string[];
  try {
    validationCommands = decodeStoredMergeQueueValidationCommands(row.validation_commands_json);
  } catch (error) {
    throw new ConnectError(
      "Invalid validation commands in MergeQueueService response",
      Code.Internal,
      undefined,
      undefined,
      error,
    );
  }
  return create(MergeQueueProfileSchema, {
    projectId: row.project_id,
    repositoryId: positiveUint64(row.repository_id, "profile.repositoryId"),
    repository: row.repository,
    baseBranch: row.base_branch,
    enabled: row.enabled === 1,
    readinessStageId: row.readiness_stage_id,
    validationCommands: [...validationCommands],
    quietWindow: quietWindow(row.quiet_window_ms),
    maxBatchSize: row.max_batch_size,
    updatedAt: requiredTimestamp(row.updated_at, "profile.updatedAt"),
  });
};

type MergeQueueStatus = Awaited<ReturnType<typeof getMergeQueueStatusApplication>>;

export const appMergeQueueStatus = (status: MergeQueueStatus) =>
  create(GetMergeQueueStatusResponseSchema, {
    batches: status.batches.map((batch) =>
      create(MergeQueueBatchSchema, {
        id: batch.id,
        state: batchState(batch.state),
        candidateCount: uint32(batch.candidateCount, "batch.candidateCount"),
        quietUntil: requiredTimestamp(batch.quietUntil, "batch.quietUntil"),
        frozenAt: optionalTimestamp(batch.frozenAt, "batch.frozenAt"),
        mergeGroupSha: batch.mergeGroupSha ?? undefined,
        failureCode: batch.failureCode ?? undefined,
        completedAt: optionalTimestamp(batch.completedAt, "batch.completedAt"),
        createdAt: requiredTimestamp(batch.createdAt, "batch.createdAt"),
        updatedAt: requiredTimestamp(batch.updatedAt, "batch.updatedAt"),
      }),
    ),
    candidates: status.candidates.map((candidate) =>
      create(MergeQueueCandidateSchema, {
        id: candidate.id,
        batchId: candidate.batchId ?? undefined,
        runId: candidate.runId,
        pullRequestNumber: positiveUint64(
          candidate.pullRequestNumber,
          "candidate.pullRequestNumber",
        ),
        pullRequestUrl: candidate.pullRequestUrl,
        state: candidateState(candidate.state),
        ordinal:
          candidate.ordinal === null ? undefined : uint32(candidate.ordinal, "candidate.ordinal"),
        readyAt: requiredTimestamp(candidate.readyAt, "candidate.readyAt"),
        failureCode: candidate.failureCode ?? undefined,
        updatedAt: requiredTimestamp(candidate.updatedAt, "candidate.updatedAt"),
      }),
    ),
    generatedAt: requiredTimestamp(status.generatedAt, "generatedAt"),
  });
