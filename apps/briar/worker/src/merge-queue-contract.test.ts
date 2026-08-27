import { describe, expect, it } from "vitest";
import { decodeMergeQueueProfileUpdate } from "./merge-queue-contract";

describe("merge queue contract", () => {
  it("accepts UI updates without operator-only batching controls", () => {
    expect(decodeMergeQueueProfileUpdate({
      enabled: true,
      readinessStageId: "reviewing",
    })).toEqual({
      enabled: true,
      readinessStageId: "reviewing",
    });
  });

  it("rejects invalid workflow stage ids and batching values", () => {
    expect(() => decodeMergeQueueProfileUpdate({
      enabled: true,
      readinessStageId: "Reviewing!",
    })).toThrow();
    expect(() => decodeMergeQueueProfileUpdate({
      enabled: true,
      readinessStageId: "reviewing",
      quietWindowMs: 999,
      maxBatchSize: 1,
    })).toThrow();
  });
});
