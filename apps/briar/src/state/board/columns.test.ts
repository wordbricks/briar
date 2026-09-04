import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { AutoHuntWorkflow } from "../../lib/auto-hunt-contract";
import type { HuntRun, TeamSettings } from "../../types";
import {
  boardColumnDefinitions,
  boardColumnIdForRun,
  groupRunIdsByColumn,
  visibleColumnIds,
} from "./columns";

/*
  Which columns the board draws and which run lands in which, checked against
  the arrangement `IssueCollection` produced for a single team's workflow.
*/

const workflow: AutoHuntWorkflow = {
  version: 2,
  requirements: [],
  stages: [
    { id: "analyzing", label: "Analyze", required: true },
    { id: "implementing", label: "Implement", required: true },
  ],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["analyzing", "implementing"] },
};

const settingsOf = (
  overrides: Partial<TeamSettings> = {},
): TeamSettings => ({
  ...demoDashboard.settings,
  workflow,
  checkpointPolicy: undefined,
  ...overrides,
});

const template = demoDashboard.runs[0]!;
const runOf = (run: Partial<HuntRun> & { id: string }): HuntRun => ({
  ...template,
  ...run,
});

const store = (runs: readonly HuntRun[]) =>
  new Map(runs.map((run) => [run.id, run]));

describe("board columns", () => {
  it("orders the status columns around the workflow stages", () => {
    expect(
      boardColumnDefinitions(settingsOf(), "all").map((column) => column.id),
    ).toEqual([
      "status:backlog",
      "status:queued",
      "stage:analyzing",
      "stage:implementing",
      "status:blocked",
      "status:failed",
      "status:completed",
      "status:cancelled",
    ]);
  });

  it("shows only the status columns while the settings are missing", () => {
    expect(
      boardColumnDefinitions(null, "all").map((column) => column.id),
    ).toEqual([
      "status:backlog",
      "status:queued",
      "status:blocked",
      "status:failed",
      "status:completed",
      "status:cancelled",
    ]);
  });

  it("narrows the columns to the status tab", () => {
    expect(
      boardColumnDefinitions(settingsOf(), "active").map((column) => column.id),
    ).not.toContain("status:completed");
    expect(
      boardColumnDefinitions(settingsOf(), "attention").map(
        (column) => column.id,
      ),
    ).toEqual([
      "stage:analyzing",
      "stage:implementing",
      "status:blocked",
      "status:failed",
    ]);
    expect(
      boardColumnDefinitions(settingsOf(), "completed").map(
        (column) => column.id,
      ),
    ).toEqual(["status:completed", "status:cancelled"]);
  });

  it("marks an effective checkpoint at the boundary it pauses on", () => {
    const columns = boardColumnDefinitions(
      settingsOf({
        checkpointPolicy: {
          availableBoundaries: [],
          teamMandatory: [],
          userDefaults: [],
          effective: [
            { key: "before-implementing", stage: "implementing", position: "before" },
          ],
          teamRevision: 1,
          userRevision: 1,
        },
      }),
      "all",
    );

    expect(
      columns.find((column) => column.id === "stage:implementing")
        ?.checkpointsBefore,
    ).toEqual([
      { stageId: "implementing", fallbackLabel: "Implement", position: "before" },
    ]);
  });

  it("keeps a checkpoint after the last stage on that stage", () => {
    const columns = boardColumnDefinitions(
      settingsOf({
        checkpointPolicy: {
          availableBoundaries: [],
          teamMandatory: [],
          userDefaults: [],
          effective: [
            { key: "after-analyzing", stage: "analyzing", position: "after" },
            { key: "after-implementing", stage: "implementing", position: "after" },
          ],
          teamRevision: 1,
          userRevision: 1,
        },
      }),
      "all",
    );
    const byId = new Map(columns.map((column) => [column.id, column]));

    expect(
      byId.get("stage:implementing")?.checkpointsBefore.map((marker) => marker.stageId),
    ).toEqual(["analyzing", "implementing"]);
    expect(byId.get("stage:analyzing")?.checkpointsBefore).toEqual([]);
  });

  it("falls back to the workflow's checkpoints when there is no policy", () => {
    const columns = boardColumnDefinitions(
      settingsOf({
        workflow: {
          ...workflow,
          execution: {
            checkpoints: [
              { key: "before-analyzing", stage: "analyzing", position: "before" },
            ],
          },
        },
      }),
      "all",
    );

    expect(
      columns.find((column) => column.id === "stage:analyzing")
        ?.checkpointsBefore,
    ).toHaveLength(1);
  });

  it("sends running and paused runs to their stage column", () => {
    expect(
      boardColumnIdForRun(
        runOf({ id: "a", status: "running", workflowStage: "implementing" }),
        workflow,
      ),
    ).toBe("stage:implementing");
    expect(
      boardColumnIdForRun(
        runOf({ id: "b", status: "paused", workflowStage: "implementing" }),
        workflow,
      ),
    ).toBe("stage:implementing");
    // A stage the workflow dropped falls back to the first one.
    expect(
      boardColumnIdForRun(
        runOf({ id: "c", status: "running", workflowStage: "gone" }),
        workflow,
      ),
    ).toBe("stage:analyzing");
    expect(
      boardColumnIdForRun(
        runOf({ id: "d", status: "running", workflowStage: null }),
        null,
      ),
    ).toBe("status:queued");
    expect(
      boardColumnIdForRun(runOf({ id: "e", status: "blocked" }), workflow),
    ).toBe("status:blocked");
  });

  it("groups in list order and drops runs whose column is hidden", () => {
    const definitions = boardColumnDefinitions(settingsOf(), "completed");
    const runs = store([
      runOf({ id: "a", status: "completed" }),
      runOf({ id: "b", status: "running", workflowStage: "analyzing" }),
      runOf({ id: "c", status: "cancelled" }),
    ]);

    const grouped = groupRunIdsByColumn(
      runs,
      ["a", "b", "c"],
      definitions,
      workflow,
    );

    expect(grouped.get("status:completed")).toEqual(["a"]);
    expect(grouped.get("status:cancelled")).toEqual(["c"]);
    expect(grouped.has("stage:analyzing")).toBe(false);
  });

  it("hides empty stage columns on the attention tab only", () => {
    const definitions = boardColumnDefinitions(settingsOf(), "attention");
    const runs = store([
      runOf({ id: "a", status: "paused", workflowStage: "analyzing" }),
    ]);
    const grouped = groupRunIdsByColumn(runs, ["a"], definitions, workflow);

    expect(visibleColumnIds(definitions, grouped, "attention")).toEqual([
      "stage:analyzing",
      "status:blocked",
      "status:failed",
    ]);
    expect(visibleColumnIds(definitions, grouped, "all")).toEqual(
      definitions.map((column) => column.id),
    );
  });
});
