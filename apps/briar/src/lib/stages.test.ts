import { describe, expect, it } from "vitest";
import {
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
} from "./auto-hunt-contract";

describe("Auto Hunt workflows", () => {
  it("calculates progress from repository-defined stages", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "implementing", label: "Implement", required: true },
        { id: "local_qa", label: "Validate", required: true },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["analyzing", "implementing", "local_qa"] },
    });
    expect(progressForAutoHuntRun("running", "local_qa", workflow)).toBe(75);
  });

  it("normalizes a repository workflow to the execution contract", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "analyzing", label: "분석", required: true },
        { id: "implementing", label: "구현", required: true },
        { id: "local_qa", label: "로컬 검증", required: true },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["analyzing", "implementing", "local_qa"] },
    });

    expect(workflow.stages[0]?.evidence).toEqual(["repository"]);
    expect(workflow.completion.requiredStages).toEqual([
      "analyzing",
      "implementing",
      "local_qa",
    ]);
    expect(workflow.execution).toEqual({ checkpoints: [] });
  });

  it("keeps repository-defined stage ids and checkpoints", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        {
          id: "analyze",
          label: "분석",
          required: true,
          evidence: ["repository"],
        },
        { id: "implement", label: "구현", required: true, evidence: ["diff"] },
        {
          id: "validate",
          label: "로컬 검증",
          required: true,
          checks: ["bun run test", "bun run build"],
        },
      ],
      execution: {
        checkpoints: [{
          key: "after-validate",
          stage: "validate",
          position: "after",
        }],
      },
      completion: { requiredStages: ["analyze", "implement", "validate"] },
    });

    expect(workflow.stages.map((stage) => stage.id)).toEqual([
      "analyze",
      "implement",
      "validate",
    ]);
    expect(workflow.completion.requiredStages).toEqual([
      "analyze",
      "implement",
      "validate",
    ]);
  });

  it("keeps an explicit execution boundary", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "implementing", label: "Implement", required: true },
        { id: "pr_open", label: "Open PR", required: true },
        { id: "production_qa", label: "Production QA", required: false },
      ],
      execution: {
        checkpoints: [{ key: "after-pr", stage: "pr_open", position: "after" }],
      },
      completion: { requiredStages: ["implementing", "pr_open"] },
    });

    expect(workflow.execution.checkpoints).toEqual([
      { key: "after-pr", stage: "pr_open", position: "after" },
    ]);
  });

});
