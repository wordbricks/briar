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
    expect(repositoryWorkflowBootstrap.stages.map((stage) => stage.id)).toEqual([
      "repository_workflow_pending",
    ]);
    expect(repositoryWorkflowBootstrap.stages.map((stage) => stage.id)).not.toContain(
      "production_qa",
    );
    expect(repositoryWorkflowBootstrap.completion.requiredStages).toEqual([
      "repository_workflow_pending",
    ]);
    expect(repositoryWorkflowBootstrap.release.enabled).toBe(false);
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
    expect(
      progressForAutoHuntRun("running", "local_qa", workflow),
    ).toBe(75);
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
    expect(workflow.release).toEqual({ enabled: false });
  });

  it("keeps repository-defined stage ids and execution requirements", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 1,
      stages: [
        { id: "analyze", label: "분석", required: true, evidence: ["repository"] },
        { id: "implement", label: "구현", required: true, evidence: ["diff"] },
        { id: "validate", label: "로컬 검증", required: true, checks: ["bun run test", "bun run build"] },
      ],
      completion: { requiredStages: ["analyze", "implement", "validate"] },
      release: { enabled: false },
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

  it("ships a representative read-only demo", () => {
    expect(demoDashboard.runs).toHaveLength(4);
    expect(demoDashboard.runs.some((run) => run.status === "completed")).toBe(true);
    expect(demoDashboard.runs.some((run) => run.status === "blocked")).toBe(true);
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
