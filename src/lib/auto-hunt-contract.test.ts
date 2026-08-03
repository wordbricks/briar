import { describe, expect, it } from "vitest";
import {
  AutoHuntWorkflowValidationError,
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflowInput,
} from "./auto-hunt-contract";

const stages = [
  { id: "implementing", label: "Implement", required: true },
  { id: "pr_open", label: "Open PR", required: true },
  { id: "production_qa", label: "Production QA", required: true },
];

const v2 = (checkpoints: unknown[]) => ({
  version: 2 as const,
  requirements: [],
  stages,
  execution: { checkpoints },
  completion: { requiredStages: stages.map((stage) => stage.id) },
}) as AutoHuntWorkflowInput;

describe("Auto Hunt workflow v2 contract", () => {
  it("accepts zero checkpoints and writes only the canonical v2 shape", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([]));

    expect(workflow.version).toBe(2);
    expect(workflow.execution.checkpoints).toEqual([]);
    expect(JSON.parse(JSON.stringify(workflow))).toEqual({
      version: 2,
      requirements: [],
      stages: [
        { ...stages[0], evidence: ["diff"] },
        { ...stages[1], evidence: ["pull_request"] },
        { ...stages[2], evidence: ["production"] },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing", "pr_open", "production_qa"] },
    });
  });

  it("canonicalizes checkpoints by stage order and before/after position", () => {
    const workflow = normalizeAutoHuntWorkflow(v2([
      { key: "production-review", stage: "production_qa", position: "after" },
      { key: "pr-review", stage: "pr_open", position: "after" },
      { key: "production-approval", stage: "production_qa", position: "before" },
      { key: "pr-approval", stage: "pr_open", position: "before" },
    ]));

    expect(workflow.execution.checkpoints.map((checkpoint) => checkpoint.key)).toEqual([
      "pr-approval",
      "pr-review",
      "production-approval",
      "production-review",
    ]);
  });

  it.each([
    ["unknown stage", [{ key: "review", stage: "missing", position: "after" }]],
    ["duplicate key", [
      { key: "review", stage: "pr_open", position: "before" },
      { key: "review", stage: "production_qa", position: "after" },
    ]],
    ["duplicate boundary", [
      { key: "first", stage: "pr_open", position: "before" },
      { key: "second", stage: "pr_open", position: "before" },
    ]],
    ["invalid key", [{ key: "Review", stage: "pr_open", position: "before" }]],
    ["invalid position", [{ key: "review", stage: "pr_open", position: "during" }]],
  ])("rejects %s", (_name, checkpoints) => {
    expect(() => normalizeAutoHuntWorkflow(v2(checkpoints))).toThrow(
      AutoHuntWorkflowValidationError,
    );
  });

  it("rejects a v2 execution object without checkpoints", () => {
    expect(() => normalizeAutoHuntWorkflow({
      ...v2([]),
      execution: {},
    })).toThrow(AutoHuntWorkflowValidationError);
  });

  it("normalizes v1 pause and stop fields without mutating the input snapshot", () => {
    const pauseSnapshot = {
      version: 1 as const,
      stages,
      execution: { pauseAfterStage: "pr_open" },
      completion: { requiredStages: stages.map((stage) => stage.id) },
    };
    const before = JSON.stringify(pauseSnapshot);
    const pause = normalizeAutoHuntWorkflow(pauseSnapshot);
    const stop = normalizeAutoHuntWorkflow({
      ...pauseSnapshot,
      execution: { stopAfterStage: "pr_open" },
    });

    expect(JSON.stringify(pauseSnapshot)).toBe(before);
    expect(pause.execution.checkpoints).toEqual([
      { key: "legacy-after-pr_open", stage: "pr_open", position: "after" },
    ]);
    expect(stop.execution.checkpoints).toEqual(pause.execution.checkpoints);
    expect(pause.execution.pauseAfterStage).toBe("pr_open");
    expect(JSON.parse(JSON.stringify(pause)).execution).toEqual({
      checkpoints: [
        { key: "legacy-after-pr_open", stage: "pr_open", position: "after" },
      ],
    });
  });

  it("keeps the workflow clone helper canonical after a v1 input", () => {
    const clone = cloneAutoHuntWorkflow({
      version: 1,
      stages,
      execution: { pauseAfterStage: "pr_open" },
      completion: { requiredStages: stages.map((stage) => stage.id) },
    });

    expect(clone).toEqual({
      version: 2,
      requirements: [],
      stages: [
        { ...stages[0], evidence: ["diff"] },
        { ...stages[1], evidence: ["pull_request"] },
        { ...stages[2], evidence: ["production"] },
      ],
      execution: {
        checkpoints: [
          { key: "legacy-after-pr_open", stage: "pr_open", position: "after" },
        ],
      },
      completion: { requiredStages: stages.map((stage) => stage.id) },
    });
    expect(clone.execution.pauseAfterStage).toBeUndefined();
  });

  it("deduplicates matching v1 pause and stop fields and rejects conflicts", () => {
    const same = normalizeAutoHuntWorkflow({
      version: 1,
      stages,
      execution: { pauseAfterStage: "pr_open", stopAfterStage: "pr_open" },
      completion: { requiredStages: stages.map((stage) => stage.id) },
    });
    expect(same.execution.checkpoints).toHaveLength(1);

    expect(() => normalizeAutoHuntWorkflow({
      version: 1,
      stages,
      execution: { pauseAfterStage: "implementing", stopAfterStage: "pr_open" },
      completion: { requiredStages: stages.map((stage) => stage.id) },
    })).toThrow(AutoHuntWorkflowValidationError);
  });
});
