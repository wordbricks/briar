import { describe, expect, it } from "vitest";
import { huntStages } from "../types";
import { demoDashboard } from "./demo-data";
import { stageMeta } from "./stages";

describe("Auto Hunt stages", () => {
  it("keeps the Wordbricks stage contract and progress mapping", () => {
    expect(huntStages).toEqual([
      "queued",
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
      "completed",
      "blocked",
      "failed",
      "cancelled",
    ]);
    expect(huntStages.map((stage) => stageMeta[stage].progress)).toEqual([
      10, 25, 45, 65, 80, 92, 100, 50, 50, 0,
    ]);
  });

  it("ships a representative read-only demo", () => {
    expect(demoDashboard.runs).toHaveLength(4);
    expect(demoDashboard.runs.some((run) => run.stage === "completed")).toBe(true);
    expect(demoDashboard.runs.some((run) => run.stage === "blocked")).toBe(true);
  });
});
