import { describe, expect, it } from "vitest";
import {
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
  repositoryWorkflowBootstrap,
} from "./auto-hunt-contract";
import { demoDashboard } from "./demo-data";
import { eventMeta, runMeta } from "./stages";

describe("Auto Hunt workflows", () => {
  it("marks the pre-analysis contract as pending instead of inventing stages", () => {
    expect(repositoryWorkflowBootstrap.stages.map((stage) => stage.id)).toEqual(
      ["repository_workflow_pending"],
    );
    expect(
      repositoryWorkflowBootstrap.stages.map((stage) => stage.id),
    ).not.toContain("production_qa");
    expect(repositoryWorkflowBootstrap.completion.requiredStages).toEqual([
      "repository_workflow_pending",
    ]);
    expect(repositoryWorkflowBootstrap.execution.pauseAfterStage).toBe(
      "repository_workflow_pending",
    );
  });

  it("calculates progress from repository-defined stages", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 1,
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "implementing", label: "Implement", required: true },
        { id: "local_qa", label: "Validate", required: true },
      ],
    });
    expect(progressForAutoHuntRun("running", "local_qa", workflow)).toBe(75);
  });

  it("normalizes a repository workflow to the execution contract", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 1,
      stages: [
        { id: "analyzing", label: "분석", required: true },
        { id: "implementing", label: "구현", required: true },
        { id: "local_qa", label: "로컬 검증", required: true },
      ],
    });

    expect(workflow.stages[0]?.evidence).toEqual(["repository"]);
    expect(workflow.completion.requiredStages).toEqual([
      "analyzing",
      "implementing",
      "local_qa",
    ]);
    expect(workflow.execution).toEqual({ pauseAfterStage: "local_qa" });
  });

  it("keeps repository-defined stage ids and normalizes the legacy pause key", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 1,
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
      execution: { stopAfterStage: "validate" },
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

  it("upgrades a legacy release workflow to an explicit execution boundary", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 1,
      stages: [
        { id: "implementing", label: "Implement", required: true },
        { id: "pr_open", label: "Open PR", required: true },
        { id: "production_qa", label: "Production QA", required: false },
      ],
      completion: { requiredStages: ["implementing", "pr_open"] },
      release: { enabled: false },
    });

    expect(workflow.execution.pauseAfterStage).toBe("pr_open");
    expect(workflow).not.toHaveProperty("release");
  });

  it("ships a representative read-only demo", () => {
    expect(demoDashboard.runs).toHaveLength(4);
    expect(demoDashboard.runs.some((run) => run.status === "completed")).toBe(
      true,
    );
    expect(demoDashboard.runs.some((run) => run.status === "blocked")).toBe(
      true,
    );
  });

  it("renders legacy stage values returned in the status field", () => {
    expect(runMeta("analyzing", undefined)).toEqual({
      label: "분석",
      tone: "blue",
    });
    expect(eventMeta("production_qa", undefined)).toEqual({
      label: "Production QA",
      tone: "orange",
    });
  });
});
