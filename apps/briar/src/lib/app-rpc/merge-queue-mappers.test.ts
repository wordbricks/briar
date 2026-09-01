import { create } from "@bufbuild/protobuf";
import { durationFromMs, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  GetMergeQueueStatusResponseSchema,
  MergeQueueBatchSchema,
  MergeQueueBatchState,
  MergeQueueCandidateSchema,
  MergeQueueCandidateState,
  MergeQueueProfileSchema,
} from "@briar/contracts/gen/briar/app/v1/merge_queue_pb";
import { describe, expect, it } from "vitest";
import {
  mergeQueueProfileFromProto,
  mergeQueueQuietWindowToProto,
  mergeQueueStatusFromProto,
} from "./merge-queue-mappers";

const observedAt = timestampFromDate(new Date("2026-08-31T03:04:05.000Z"));

describe("Merge queue protobuf mapping", () => {
  it("preserves duration, uint64, and lifecycle enum semantics", () => {
    const profile = mergeQueueProfileFromProto(create(MergeQueueProfileSchema, {
      projectId: "project-1",
      repositoryId: 9_007_199n,
      repository: "briar-dev/briar",
      baseBranch: "main",
      enabled: true,
      readinessStageId: "validate",
      validationCommands: ["bun test"],
      quietWindow: durationFromMs(1_250),
      maxBatchSize: 5,
      updatedAt: observedAt,
    }));
    const status = mergeQueueStatusFromProto(create(
      GetMergeQueueStatusResponseSchema,
      {
        generatedAt: observedAt,
        batches: [create(MergeQueueBatchSchema, {
          id: "batch-1",
          state: MergeQueueBatchState.AWAITING_MERGE,
          candidateCount: 1,
          quietUntil: observedAt,
          createdAt: observedAt,
          updatedAt: observedAt,
        })],
        candidates: [create(MergeQueueCandidateSchema, {
          id: "candidate-1",
          runId: "run-1",
          pullRequestNumber: 42n,
          pullRequestUrl: "https://github.com/briar-dev/briar/pull/42",
          state: MergeQueueCandidateState.ENQUEUED,
          readyAt: observedAt,
          updatedAt: observedAt,
        })],
      },
    ));

    expect(profile).toMatchObject({
      repositoryId: 9_007_199,
      baseBranch: "main",
      quietWindowMs: 1_250,
      maxBatchSize: 5,
    });
    expect(status).toMatchObject({
      status: {
        batches: [{ state: "awaiting_merge" }],
        candidates: [{ state: "enqueued", pullRequestNumber: 42 }],
      },
      generatedAt: "2026-08-31T03:04:05.000Z",
    });
  });

  it("rejects wire values outside the UI domain", () => {
    expect(() => mergeQueueQuietWindowToProto(999)).toThrow(
      "must be an integer from 1000 to 300000",
    );
    expect(() => mergeQueueProfileFromProto(create(MergeQueueProfileSchema, {
      repositoryId: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      baseBranch: "main",
      validationCommands: ["bun test"],
      quietWindow: durationFromMs(1_000),
      maxBatchSize: 2,
      updatedAt: observedAt,
    }))).toThrow("outside JavaScript's safe integer range");

    expect(() => mergeQueueStatusFromProto(create(
      GetMergeQueueStatusResponseSchema,
      {
        generatedAt: observedAt,
        batches: [create(MergeQueueBatchSchema, {
          state: MergeQueueBatchState.UNSPECIFIED,
          quietUntil: observedAt,
          createdAt: observedAt,
          updatedAt: observedAt,
        })],
      },
    ))).toThrow("Merge queue batch state is missing");
  });
});
