import type * as Atom from "effect/unstable/reactivity/Atom";
import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { AutoHuntWorkflow } from "../../lib/auto-hunt-contract";
import type { HuntRun, Project, TeamSettings } from "../../types";
import { activePlanningProjectIdAtom } from "../dialogs/atoms";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamsByIdAtom } from "../entities/teams";
import { upsertMany } from "../entities/upsert";
import { companionStatusAtom } from "../navigation/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import {
  teamGeneratedAtAtom,
  teamSettingsAtom,
} from "../team/atoms";
import {
  boardColumnKey,
  boardColumnRunIdsAtom,
  boardGroupedRunIdsAtom,
  boardLoadedAtom,
  boardPropertyFiltersAtom,
  boardQueryAtom,
  boardRunAtom,
  boardRunIdsAtom,
  boardRunKey,
  boardScopedRunIdsAtom,
  boardSourceAtom,
  boardStatusAtom,
  boardStatusCountsAtom,
  boardViewAtom,
  boardVisibleColumnIdsAtom,
  companionRunIdsAtom,
  resetBoardPropertyFilters,
  resetBoardViewState,
} from "./atoms";
import { emptyIssuePropertyFilters } from "./filters";

/*
  The board's derived ids, and what a change does and does not notify.

  Every assertion here is one half of Phase 2's second promise: a run edit
  reaches the run's own subscribers and produces id lists that are element-wise
  identical, so nothing that renders a list is told about it.
*/

const teamId = "team-a";

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

const settings: TeamSettings = {
  ...demoDashboard.settings,
  workflow,
  checkpointPolicy: undefined,
};

const team: Project = {
  ...demoDashboard.team,
  id: teamId,
  issueKeyPrefix: "BRI",
};

const template = demoDashboard.runs[0]!;
const runOf = (run: Partial<HuntRun> & { id: string }): HuntRun => ({
  ...template,
  teamId,
  projectId: undefined,
  runNumber: 1,
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...run,
});

const backlog = runOf({ id: "run-a", title: "첫 번째", status: "backlog" });
const queued = runOf({ id: "run-b", title: "두 번째", status: "queued" });
const done = runOf({ id: "run-c", title: "세 번째", status: "completed" });

const harness = (runs: readonly HuntRun[] = [backlog, queued, done]) =>
  createTestRegistry([
    [runsByIdAtom, new Map(runs.map((run) => [run.id, run]))],
    [teamRunIdsAtom(teamId), runs.map((run) => run.id)],
    [teamsByIdAtom, new Map([[teamId, team]])],
    [teamSettingsAtom(teamId), settings],
    [teamGeneratedAtAtom(teamId), "2026-09-01T00:00:00.000Z"],
  ]);

/** Records what an atom notifies after the initial read. */
const watch = <A>(registry: AtomRegistry, atom: Atom.Atom<A>) => {
  const seen: A[] = [];
  registry.subscribe(
    atom,
    (value) => {
      seen.push(value);
    },
    { immediate: true },
  );
  seen.length = 0;
  return seen;
};

describe("board atoms", () => {
  it("reports a loaded team and an unknown one apart", () => {
    expect(harness().get(boardLoadedAtom(teamId))).toBe(true);
    expect(createTestRegistry().get(boardLoadedAtom(teamId))).toBe(false);
  });

  it("narrows the board to the selected planning project", () => {
    const registry = harness([
      runOf({ id: "run-a", projectId: "planning-general" }),
      runOf({ id: "run-b", projectId: "planning-other" }),
    ]);

    expect(registry.get(boardScopedRunIdsAtom(teamId))).toEqual([
      "run-a",
      "run-b",
    ]);
    registry.set(activePlanningProjectIdAtom, "planning-general");
    expect(registry.get(boardScopedRunIdsAtom(teamId))).toEqual(["run-a"]);
  });

  it("keeps the filtered ids identical when a run's title changes", () => {
    const registry = harness();
    const seen = watch(registry, boardRunIdsAtom(teamId));
    const before = registry.get(boardRunIdsAtom(teamId));
    expect(before).toEqual(["run-a", "run-b", "run-c"]);

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...queued, title: "고친 이슈" }]),
    );

    expect(seen).toEqual([]);
    expect(registry.get(boardRunIdsAtom(teamId))).toBe(before);
  });

  it("moves an id between the two columns a status change touches", () => {
    const registry = harness();
    const backlogColumn = watch(
      registry,
      boardColumnRunIdsAtom(boardColumnKey(teamId, "status:backlog")),
    );
    const queuedColumn = watch(
      registry,
      boardColumnRunIdsAtom(boardColumnKey(teamId, "status:queued")),
    );
    const completedColumn = watch(
      registry,
      boardColumnRunIdsAtom(boardColumnKey(teamId, "status:completed")),
    );

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...backlog, status: "queued" }]),
    );

    expect(backlogColumn).toEqual([[]]);
    expect(queuedColumn).toEqual([["run-a", "run-b"]]);
    expect(completedColumn).toEqual([]);
  });

  it("leaves every column alone when a run's title changes", () => {
    const registry = harness();
    const columns = ["status:backlog", "status:queued", "status:completed"].map(
      (columnId) =>
        watch(
          registry,
          boardColumnRunIdsAtom(boardColumnKey(teamId, columnId)),
        ),
    );

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...queued, title: "고친 이슈" }]),
    );

    expect(columns).toEqual([[], [], []]);
  });

  it("keeps the grouping equal when a run's title changes", () => {
    const registry = harness();
    const seen = watch(registry, boardGroupedRunIdsAtom(teamId));

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...queued, title: "고친 이슈" }]),
    );
    expect(seen).toEqual([]);

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...queued, status: "blocked" }]),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.get("status:blocked")).toEqual(["run-b"]);
  });

  it("counts the status tabs and only moves them when a status does", () => {
    const registry = harness();
    const seen = watch(registry, boardStatusCountsAtom(teamId));

    expect(registry.get(boardStatusCountsAtom(teamId))).toEqual({
      all: 3,
      active: 2,
      attention: 0,
      completed: 1,
    });

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...queued, title: "고친 이슈" }]),
    );
    expect(seen).toEqual([]);

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...queued, status: "blocked" }]),
    );
    expect(seen).toEqual([{ all: 3, active: 2, attention: 1, completed: 1 }]);
  });

  it("applies the search box, the source tab and the property filters", () => {
    const registry = harness([
      runOf({ id: "run-a", title: "스키마 추가", source: "issue" }),
      runOf({ id: "run-b", title: "다른 작업", source: "feedback" }),
    ]);

    registry.set(boardQueryAtom, "스키마");
    expect(registry.get(boardRunIdsAtom(teamId))).toEqual(["run-a"]);

    registry.set(boardQueryAtom, "");
    registry.set(boardSourceAtom, "feedback");
    expect(registry.get(boardRunIdsAtom(teamId))).toEqual(["run-b"]);

    registry.set(boardSourceAtom, "all");
    registry.set(boardPropertyFiltersAtom, {
      ...emptyIssuePropertyFilters(),
      source: ["issue"],
    });
    expect(registry.get(boardRunIdsAtom(teamId))).toEqual(["run-a"]);
  });

  it("finds a run through its issue key", () => {
    const registry = harness([runOf({ id: "run-a", runNumber: 12 })]);
    registry.set(boardQueryAtom, "bri-12");

    expect(registry.get(boardRunIdsAtom(teamId))).toEqual(["run-a"]);
  });

  it("hides empty stage columns on the attention tab", () => {
    const registry = harness([
      runOf({ id: "run-a", status: "paused", workflowStage: "analyzing" }),
      runOf({ id: "run-b", status: "blocked" }),
    ]);
    registry.set(boardStatusAtom, "attention");

    expect(registry.get(boardVisibleColumnIdsAtom(teamId))).toEqual([
      "stage:analyzing",
      "status:blocked",
      "status:failed",
    ]);
  });

  it("streams the companion tasks newest updated first", () => {
    const registry = harness([
      runOf({
        id: "run-a",
        status: "running",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
      runOf({
        id: "run-b",
        status: "completed",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
      runOf({
        id: "run-c",
        status: "blocked",
        updatedAt: "2026-09-03T00:00:00.000Z",
      }),
    ]);

    expect(registry.get(companionRunIdsAtom(teamId))).toEqual([
      "run-c",
      "run-b",
      "run-a",
    ]);

    // The companion status comes from the bottom bar, not the desktop tab.
    registry.set(boardStatusAtom, "completed");
    registry.set(companionStatusAtom, "attention");
    expect(registry.get(companionRunIdsAtom(teamId))).toEqual(["run-c"]);
  });

  it("resolves the open run only while the board's scope holds it", () => {
    const registry = harness();

    expect(registry.get(boardRunAtom(boardRunKey(teamId, "run-b")))).toBe(
      queued,
    );
    registry.set(activePlanningProjectIdAtom, "planning-general");
    expect(registry.get(boardRunAtom(boardRunKey(teamId, "run-b")))).toBeNull();
  });

  it("clears the property filters on a team switch and nothing else", () => {
    const registry = harness();
    const seen = watch(registry, boardPropertyFiltersAtom);

    resetBoardPropertyFilters(registry);
    expect(seen).toEqual([]);

    registry.set(boardPropertyFiltersAtom, {
      ...emptyIssuePropertyFilters(),
      status: ["running"],
    });
    resetBoardPropertyFilters(registry);
    expect(registry.get(boardPropertyFiltersAtom)).toEqual(
      emptyIssuePropertyFilters(),
    );
  });

  it("puts a remounted board back to its defaults", () => {
    const registry = harness();
    registry.set(boardQueryAtom, "search");
    registry.set(boardSourceAtom, "feedback");
    registry.set(boardStatusAtom, "completed");
    registry.set(boardViewAtom, "list");

    resetBoardViewState(registry);

    expect(registry.get(boardQueryAtom)).toBe("");
    expect(registry.get(boardSourceAtom)).toBe("all");
    expect(registry.get(boardStatusAtom)).toBe("all");
    expect(registry.get(boardViewAtom)).toBe("kanban");
  });
});
