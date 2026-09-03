import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { DashboardPayload, HuntRun } from "../../types";
import { runAtom } from "../entities/runs";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { applySyncEvent } from "./apply";
import { applyRunPatch, applyRunPatches, optimisticRunUpdate } from "./optimistic";

const teamId = "team-a";

const runOf = (id: string, updatedAt: string): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  title: id,
  updatedAt,
});

const snapshotOf = (runs: HuntRun[]): DashboardPayload => ({
  ...demoDashboard,
  team: { ...demoDashboard.team, id: teamId },
  runs,
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const harness = (runs: HuntRun[]) => {
  const registry = createTestRegistry();
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId,
    payload: snapshotOf(runs),
  });
  return registry;
};

const runIn = (registry: AtomRegistry, runId: string) =>
  registry.get(runAtom(runId));

describe("applyRunPatch", () => {
  it("writes the patched run and returns it", () => {
    const registry = harness([runOf("run-1", "2026-09-01T00:00:00.000Z")]);
    const patched = applyRunPatch(registry, "run-1", (run) => ({
      ...run,
      title: "edited",
    }));
    expect(patched?.title).toBe("edited");
    expect(runIn(registry, "run-1")?.title).toBe("edited");
  });

  it("writes nothing for a run the store does not hold", () => {
    const registry = harness([]);
    expect(applyRunPatch(registry, "missing", (run) => run)).toBeNull();
    expect(runIn(registry, "missing")).toBeNull();
  });

  it("keeps the run's identity when the patch returns it unchanged", () => {
    const registry = harness([runOf("run-1", "2026-09-01T00:00:00.000Z")]);
    const before = runIn(registry, "run-1");
    applyRunPatch(registry, "run-1", (run) => run);
    expect(runIn(registry, "run-1")).toBe(before);
  });
});

describe("applyRunPatches", () => {
  it("notifies subscribers once for a patch spanning several runs", () => {
    const registry = harness([
      runOf("run-1", "2026-09-01T00:00:00.000Z"),
      runOf("run-2", "2026-09-01T00:00:00.000Z"),
    ]);
    let notifications = 0;
    const unsubscribe = registry.subscribe(runAtom("run-1"), () => {
      notifications += 1;
    });
    applyRunPatches(registry, ["run-1", "run-2"], (run) => ({
      ...run,
      title: `${run.id}-edited`,
    }));
    expect(notifications).toBe(1);
    expect(runIn(registry, "run-2")?.title).toBe("run-2-edited");
    unsubscribe();
  });
});

describe("optimisticRunUpdate", () => {
  it("keeps the patch and applies the confirmed run on success", async () => {
    const registry = harness([runOf("run-1", "2026-09-01T00:00:00.000Z")]);
    const confirmed = runOf("run-1", "2026-09-01T00:00:02.000Z");
    const seenDuringCommit: string[] = [];

    const result = await optimisticRunUpdate(
      registry,
      "run-1",
      (run) => ({ ...run, title: "optimistic" }),
      async () => {
        seenDuringCommit.push(runIn(registry, "run-1")?.title ?? "");
        return { run: { ...confirmed, title: "confirmed" } };
      },
      { confirm: (response) => response.run },
    );

    expect(seenDuringCommit).toEqual(["optimistic"]);
    expect(result.run.title).toBe("confirmed");
    expect(runIn(registry, "run-1")?.title).toBe("confirmed");
  });

  it("restores the previous run when the write fails", async () => {
    const registry = harness([runOf("run-1", "2026-09-01T00:00:00.000Z")]);
    const before = runIn(registry, "run-1");

    await expect(
      optimisticRunUpdate(
        registry,
        "run-1",
        (run) => ({ ...run, title: "optimistic" }),
        async () => {
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow("nope");

    expect(runIn(registry, "run-1")).toEqual(before);
  });

  it("keeps a newer server value instead of rolling back over it", async () => {
    const registry = harness([runOf("run-1", "2026-09-01T00:00:00.000Z")]);

    await expect(
      optimisticRunUpdate(
        registry,
        "run-1",
        (run) => ({
          ...run,
          title: "optimistic",
          updatedAt: "2026-09-01T00:00:01.000Z",
        }),
        async () => {
          // The delta stream lands while the write is in flight.
          applySyncEvent(registry, {
            kind: "run-changed",
            run: {
              ...runOf("run-1", "2026-09-01T00:00:05.000Z"),
              title: "from-server",
            },
            teamId,
          });
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow("nope");

    expect(runIn(registry, "run-1")?.title).toBe("from-server");
  });

  it("rolls back over a server value that is not newer", async () => {
    const registry = harness([runOf("run-1", "2026-09-01T00:00:03.000Z")]);

    await expect(
      optimisticRunUpdate(
        registry,
        "run-1",
        (run) => ({
          ...run,
          title: "optimistic",
          updatedAt: "2026-09-01T00:00:04.000Z",
        }),
        async () => {
          applySyncEvent(registry, {
            kind: "run-changed",
            run: {
              ...runOf("run-1", "2026-09-01T00:00:01.000Z"),
              title: "stale-server",
            },
            teamId,
          });
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow("nope");

    expect(runIn(registry, "run-1")?.title).toBe("run-1");
    expect(runIn(registry, "run-1")?.updatedAt).toBe("2026-09-01T00:00:03.000Z");
  });

  it("does not resurrect a run the server deleted while the write ran", async () => {
    const registry = harness([runOf("run-1", "2026-09-01T00:00:00.000Z")]);

    await expect(
      optimisticRunUpdate(
        registry,
        "run-1",
        (run) => ({ ...run, title: "optimistic" }),
        async () => {
          applySyncEvent(registry, { kind: "run-deleted", teamId, runId: "run-1" });
          throw new Error("nope");
        },
      ),
    ).rejects.toThrow("nope");

    expect(runIn(registry, "run-1")).toBeNull();
  });

  it("commits without an optimistic write for an unknown run", async () => {
    const registry = harness([]);
    let committed = false;
    const result = await optimisticRunUpdate(
      registry,
      "missing",
      (run) => run,
      async (patched) => {
        committed = true;
        return patched;
      },
    );
    expect(committed).toBe(true);
    expect(result).toBeNull();
  });
});
