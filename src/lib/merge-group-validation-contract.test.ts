import { describe, expect, it } from "vitest";
import {
  assertCanonicalMergeWaitCheckpoint,
  hasCanonicalMergeWaitCheckpoint,
} from "./merge-group-validation-contract";

const workflow = {
  version: 2 as const,
  requirements: [],
  stages: [{ id: "merged", label: "Merge", required: true, evidence: [] }],
  execution: {
    checkpoints: [{
      key: "issue-before-merged",
      stage: "merged",
      position: "before" as const,
    }],
  },
  completion: { requiredStages: ["merged"] },
};

describe("canonical merge-wait checkpoint", () => {
  it("accepts the exact before-merged checkpoint", () => {
    expect(hasCanonicalMergeWaitCheckpoint(workflow)).toBe(true);
    expect(() => assertCanonicalMergeWaitCheckpoint(workflow)).not.toThrow();
  });

  it("accepts the project-owned canonical key for the same boundary", () => {
    expect(hasCanonicalMergeWaitCheckpoint({
      ...workflow,
      execution: {
        checkpoints: [{
          ...workflow.execution.checkpoints[0],
          key: "project-before-merged",
        }],
      },
    })).toBe(true);
  });

  it("rejects a custom workflow without that checkpoint", () => {
    const custom = {
      ...workflow,
      execution: { checkpoints: [] },
    };
    expect(hasCanonicalMergeWaitCheckpoint(custom)).toBe(false);
    expect(() => assertCanonicalMergeWaitCheckpoint(custom)).toThrow(
      /before-merged/u,
    );
  });
});
