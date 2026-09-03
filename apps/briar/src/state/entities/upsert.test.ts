import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { HuntRun, OrganizationMember } from "../../types";
import {
  mergeTeamRuns,
  removeMany,
  replaceEntities,
  sameValue,
  TEAM_RUN_LIMIT,
  upsertMany,
  upsertManyBy,
} from "./upsert";

const runs = demoDashboard.runs;
const mapOf = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.id, item]));

const runAt = (index: number, overrides: Partial<HuntRun> = {}): HuntRun => ({
  ...runs[index]!,
  ...overrides,
});

describe("entity upsert", () => {
  it("returns the same map when every incoming entity is deep equal", () => {
    const map = mapOf(runs);

    expect(upsertMany(map, runs.map((run) => ({ ...run })))).toBe(map);
  });

  it("keeps the stored reference for entities that did not change", () => {
    const map = mapOf(runs);
    const target = runs[0]!;
    const untouched = runs[1]!;

    const next = upsertMany(map, [
      { ...target, detail: "Only this issue changed" },
      { ...untouched },
    ]);

    expect(next).not.toBe(map);
    expect(next.get(target.id)).not.toBe(target);
    expect(next.get(target.id)?.detail).toBe("Only this issue changed");
    expect(next.get(untouched.id)).toBe(untouched);
  });

  it("applies tombstones without rebuilding surviving entities", () => {
    const map = mapOf(runs);
    const removed = runs[0]!;
    const survivor = runs[1]!;

    const next = upsertMany(map, [], [removed.id]);

    expect(next.has(removed.id)).toBe(false);
    expect(next.get(survivor.id)).toBe(survivor);
  });

  it("ignores tombstones for entities it never held", () => {
    const map = mapOf(runs);

    expect(upsertMany(map, [], ["missing-run"])).toBe(map);
  });

  it("keys entities that carry no id under the identifier they do have", () => {
    const members = demoDashboard.members ?? [];
    const identify = (member: OrganizationMember) => member.userId;
    const map = new Map(members.map((member) => [member.userId, member]));

    expect(upsertManyBy(map, members, identify)).toBe(map);
    const renamed = { ...members[0]!, name: "Renamed" };
    const next = upsertManyBy(map, [renamed], identify);
    expect(next.get(renamed.userId)).toBe(renamed);
  });

  it("removes only the ids it actually held", () => {
    const map = mapOf(runs);

    expect(removeMany(map, ["missing"])).toBe(map);
    expect(removeMany(map, [runs[0]!.id]).size).toBe(map.size - 1);
  });

  it("replaces a projection while preserving unchanged element references", () => {
    const current = [...runs];
    const untouched = current[1]!;

    expect(replaceEntities(current, current.map((run) => ({ ...run })))).toBe(
      current,
    );

    const next = replaceEntities(current, [
      { ...current[0]!, detail: "changed" },
      { ...untouched },
    ]);
    expect(next).not.toBe(current);
    expect(next[1]).toBe(untouched);
  });

  it("treats structurally equal values as unchanged", () => {
    expect(sameValue({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
  });
});

describe("team run merge", () => {
  it("keeps the exact array when a delta carries no run change", () => {
    const current = [...runs];

    expect(mergeTeamRuns(current, [], [])).toBe(current);
  });

  it("keeps the array when every changed run is deep equal", () => {
    const current = [...runs];

    expect(mergeTeamRuns(current, [{ ...current[0]! }], [])).toBe(current);
  });

  it("orders terminal runs last and newest first", () => {
    const active = runAt(0, {
      id: "run-active",
      status: "running",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const newer = runAt(0, {
      id: "run-newer",
      status: "running",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
    const done = runAt(0, {
      id: "run-done",
      status: "completed",
      updatedAt: "2026-08-03T00:00:00.000Z",
    });

    expect(
      mergeTeamRuns([], [active, done, newer], []).map((run) => run.id),
    ).toEqual(["run-newer", "run-active", "run-done"]);
  });

  it("caps a team at the run limit", () => {
    const many = Array.from({ length: TEAM_RUN_LIMIT + 5 }, (_unused, index) =>
      runAt(0, {
        id: `run-${index}`,
        status: "running",
        updatedAt: `2026-08-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      }),
    );

    expect(mergeTeamRuns([], many, [])).toHaveLength(TEAM_RUN_LIMIT);
  });

  it("drops tombstoned runs while surviving runs keep their reference", () => {
    const current = [...runs];
    const removed = current[0]!;
    const survivor = current[1]!;

    const next = mergeTeamRuns(current, [], [removed.id]);

    expect(next.some((run) => run.id === removed.id)).toBe(false);
    expect(next.find((run) => run.id === survivor.id)).toBe(survivor);
  });
});
