import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { HuntRun } from "../../types";
import { createTestRegistry } from "../registry";
import { runAtom, runsByIdAtom, teamRunIdsAtom, teamRunsAtom } from "./runs";
import { upsertMany } from "./upsert";

const teamId = "team-a";
const [first, second] = demoDashboard.runs;

const store = (runs: readonly HuntRun[]) =>
  createTestRegistry([
    [runsByIdAtom, new Map(runs.map((run) => [run.id, run]))],
    [teamRunIdsAtom(teamId), runs.map((run) => run.id)],
  ]);

describe("run entities", () => {
  it("resolves one run by id and reports missing ones as null", () => {
    const registry = store([first!, second!]);

    expect(registry.get(runAtom(first!.id))).toBe(first);
    expect(registry.get(runAtom("run-missing"))).toBeNull();
  });

  it("notifies only the subscribers of the run that changed", () => {
    const registry = store([first!, second!]);
    const changedSeen: (HuntRun | null)[] = [];
    const untouchedSeen: (HuntRun | null)[] = [];
    registry.subscribe(
      runAtom(first!.id),
      (run) => {
        changedSeen.push(run);
      },
      { immediate: true },
    );
    registry.subscribe(
      runAtom(second!.id),
      (run) => {
        untouchedSeen.push(run);
      },
      { immediate: true },
    );
    changedSeen.length = 0;
    untouchedSeen.length = 0;

    const edited = { ...first!, detail: "Only this issue changed" };
    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [edited, { ...second! }]),
    );

    expect(changedSeen).toEqual([edited]);
    expect(untouchedSeen).toEqual([]);
  });

  it("leaves the id index alone when a run's content changes", () => {
    const registry = store([first!, second!]);
    const indexSeen: (string[] | null)[] = [];
    registry.subscribe(
      teamRunIdsAtom(teamId),
      (ids) => {
        indexSeen.push(ids);
      },
      { immediate: true },
    );
    indexSeen.length = 0;

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...first!, detail: "changed" }]),
    );

    expect(indexSeen).toEqual([]);
  });

  it("keeps the resolved list identical while its runs are untouched", () => {
    const registry = store([first!, second!]);
    const listSeen: (HuntRun[] | null)[] = [];
    registry.subscribe(
      teamRunsAtom(teamId),
      (list) => {
        listSeen.push(list);
      },
      { immediate: true },
    );
    const initial = registry.get(teamRunsAtom(teamId));
    expect(initial).toEqual([first, second]);
    listSeen.length = 0;

    // A no-op upsert must not reach the list at all.
    registry.update(runsByIdAtom, (runs) => upsertMany(runs, [{ ...first! }]));
    expect(listSeen).toEqual([]);
    expect(registry.get(teamRunsAtom(teamId))).toBe(initial);

    registry.update(runsByIdAtom, (runs) =>
      upsertMany(runs, [{ ...first!, detail: "changed" }]),
    );
    expect(listSeen).toHaveLength(1);
    expect(listSeen[0]?.[1]).toBe(second);
  });

  it("reports a team that was never loaded as null", () => {
    const registry = createTestRegistry();

    expect(registry.get(teamRunIdsAtom("team-unknown"))).toBeNull();
    expect(registry.get(teamRunsAtom("team-unknown"))).toBeNull();
  });
});
