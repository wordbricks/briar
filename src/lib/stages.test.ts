import { describe, expect, it } from "vitest";
import {
  defaultAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
  workflowForPreset,
} from "./auto-hunt-contract";
import { demoDashboard } from "./demo-data";
import { eventMeta, runMeta } from "./stages";

describe("Auto Hunt workflows", () => {
  it("defaults new projects to a deployment-free local workflow", () => {
    expect(defaultAutoHuntWorkflow.preset).toBe("local");
    expect(defaultAutoHuntWorkflow.stages.map((stage) => stage.id)).toEqual([
      "analyzing",
      "implementing",
      "local_qa",
    ]);
    expect(defaultAutoHuntWorkflow.stages.map((stage) => stage.id)).not.toContain(
      "production_qa",
    );
    expect(defaultAutoHuntWorkflow.completion.requiredStages).toEqual([
      "analyzing",
      "implementing",
      "local_qa",
    ]);
    expect(defaultAutoHuntWorkflow.release.enabled).toBe(false);
    expect(defaultAutoHuntWorkflow.stages.at(-1)?.checks).toEqual([
      "bun run test",
      "bun run build",
    ]);
  });

  it("keeps deployment stages in an explicit release preset", () => {
    expect(workflowForPreset("release").stages.map((stage) => stage.id)).toEqual([
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ]);
    expect(
      progressForAutoHuntRun("running", "local_qa", defaultAutoHuntWorkflow),
    ).toBe(75);
  });

  it("upgrades legacy workflow settings to the execution contract", () => {
    const workflow = normalizeAutoHuntWorkflow({
      version: 1,
      preset: "local",
      stages: [
        { id: "analyzing", label: "분석", required: true },
        { id: "implementing", label: "구현", required: true },
        { id: "local_qa", label: "로컬 검증", required: true },
      ],
    });

    expect(workflow.stages[0]?.evidence).toEqual(["velen", "repository"]);
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
        { id: "analyze", label: "분석", required: true, evidence: ["velen", "repository"] },
        { id: "implement", label: "구현", required: true, evidence: ["diff"] },
        { id: "validate", label: "로컬 검증", required: true, checks: ["bun run test", "bun run build"] },
      ],
      completion: { requiredStages: ["analyze", "implement", "validate"] },
      release: { enabled: false },
    });

    expect(workflow.preset).toBe("custom");
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
