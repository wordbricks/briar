import { describe, expect, it } from "vitest";
import {
  defaultAutoHuntWorkflow,
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
