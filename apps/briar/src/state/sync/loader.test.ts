import { describe, expect, it } from "vitest";

import { ApiError } from "../../lib/api/errors";
import { demoDashboard } from "../../lib/demo-data";
import type { DashboardDeltaPayload, DashboardPayload } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import {
  activeTeamIdAtom,
  staleTeamIdAtom,
  teamCursorAtom,
} from "../team/atoms";
import { applySyncEvent } from "./apply";
import { createTeamSyncLoader, type TeamSyncApi } from "./loader";
import { dashboardViewAtom } from "./view";

const teamA = "team-a";
const teamB = "team-b";

const snapshotOf = (teamId: string, cursor: number): DashboardPayload => ({
  ...demoDashboard,
  team: { ...demoDashboard.team, id: teamId },
  runs: [],
  cursor,
  generatedAt: `2026-09-03T00:00:00.00${cursor % 10}Z`,
});

const deltaOf = (
  overrides: Partial<DashboardDeltaPayload> = {},
): DashboardDeltaPayload => ({
  reset: false,
  cursor: 2,
  hasMore: false,
  runs: [],
  deletedRunIds: [],
  workers: demoDashboard.workers ?? [],
  organizationProviders: demoDashboard.organizationProviders ?? [],
  generatedAt: "2026-09-03T01:00:00.000Z",
  ...overrides,
});

/**
 * In-memory stand-in for the two reads the loader performs. Snapshots can be
 * left pending, which is how "a response outlived its request" is observable.
 */
class SyncServer {
  readonly snapshotRequests: string[] = [];
  readonly deltaRequests: { teamId: string; cursor: number }[] = [];
  private pending: {
    teamId: string;
    resolve: (payload: DashboardPayload) => void;
  }[] = [];

  /** Return "pending" to hold the request open until `takePending` settles it. */
  snapshot: (teamId: string) => DashboardPayload | "pending" = (teamId) =>
    snapshotOf(teamId, 1);
  delta: (cursor: number) => DashboardDeltaPayload | Error = () => deltaOf();

  readonly api: TeamSyncApi = {
    loadDashboard: (_token, teamId) => {
      this.snapshotRequests.push(teamId);
      const result = this.snapshot(teamId);
      if (result !== "pending") return Promise.resolve(result);
      return new Promise<DashboardPayload>((resolve) => {
        this.pending.push({ teamId, resolve });
      });
    },
    loadDashboardDelta: (_token, teamId, cursor) => {
      this.deltaRequests.push({ teamId, cursor });
      const result = this.delta(cursor);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };

  /** Removes and returns the open snapshot requests for one team. */
  takePending(teamId: string) {
    const matching = this.pending.filter((request) => request.teamId === teamId);
    this.pending = this.pending.filter((request) => request.teamId !== teamId);
    return matching.map((request) => request.resolve);
  }
}

const setUp = (
  activeTeamId: string | null = teamA,
  token: string | null = "token-1",
) => {
  const server = new SyncServer();
  const registry: AtomRegistry = createTestRegistry([
    [tokenAtom, token],
    [activeTeamIdAtom, activeTeamId],
  ]);
  const loader = createTeamSyncLoader(registry, server.api);
  return { server, registry, loader };
};

const store = (registry: AtomRegistry, teamId: string, cursor: number) => {
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId,
    payload: snapshotOf(teamId, cursor),
  });
};

describe("team sync loader", () => {
  it("asks for a snapshot when the team has nothing stored", async () => {
    const { server, registry, loader } = setUp();

    await loader.refresh(teamA);

    expect(server.snapshotRequests).toEqual([teamA]);
    expect(server.deltaRequests).toEqual([]);
    expect(registry.get(dashboardViewAtom(teamA))?.team.id).toBe(teamA);
  });

  it("resumes from the stored cursor once a payload exists", async () => {
    const { server, registry, loader } = setUp();
    store(registry, teamA, 7);
    server.snapshotRequests.length = 0;

    await loader.refresh(teamA);

    expect(server.deltaRequests).toEqual([{ teamId: teamA, cursor: 7 }]);
    expect(server.snapshotRequests).toEqual([]);
    expect(registry.get(teamCursorAtom(teamA))).toBe(2);
  });

  it("promotes a stale team's next fetch to a snapshot", async () => {
    const { server, registry, loader } = setUp();
    store(registry, teamA, 7);
    registry.set(staleTeamIdAtom, teamA);
    server.snapshotRequests.length = 0;

    await loader.refresh(teamA);

    expect(server.deltaRequests).toEqual([]);
    expect(server.snapshotRequests).toEqual([teamA]);
    expect(registry.get(staleTeamIdAtom)).toBeNull();
  });

  it("falls back to a snapshot when the cursor expired", async () => {
    const { server, registry, loader } = setUp();
    store(registry, teamA, 7);
    server.snapshotRequests.length = 0;
    server.delta = () => new ApiError(410, "cursor expired");

    await loader.refresh(teamA);

    expect(server.snapshotRequests).toEqual([teamA]);
    expect(registry.get(sessionErrorAtom)).toBeNull();
  });

  it("reports a delta failure with any other status", async () => {
    const { server, registry, loader } = setUp();
    store(registry, teamA, 7);
    server.delta = () => new ApiError(500, "boom");

    await loader.refresh(teamA);

    expect(registry.get(sessionErrorAtom)).toBe("boom");
  });

  it("falls back to a snapshot after the delta page cap", async () => {
    const { server, registry, loader } = setUp();
    store(registry, teamA, 1);
    server.snapshotRequests.length = 0;
    server.delta = (cursor) => deltaOf({ cursor: cursor + 1, hasMore: true });

    await loader.refresh(teamA);

    expect(server.deltaRequests).toHaveLength(20);
    expect(server.snapshotRequests).toEqual([teamA]);
  });

  it("restarts from a snapshot when the server resets the stream", async () => {
    const { server, registry, loader } = setUp();
    store(registry, teamA, 7);
    server.snapshotRequests.length = 0;
    server.delta = () => deltaOf({ reset: true });

    await loader.refresh(teamA);

    expect(server.snapshotRequests).toEqual([teamA]);
  });

  it("shares one request between concurrent delta refreshes", async () => {
    const { server, registry, loader } = setUp();
    server.snapshot = () => "pending";

    const first = loader.refresh(teamA);
    const second = loader.refresh(teamA);
    expect(server.snapshotRequests).toEqual([teamA]);

    for (const resolve of server.takePending(teamA)) {
      resolve(snapshotOf(teamA, 1));
    }
    await Promise.all([first, second]);
    expect(registry.get(dashboardViewAtom(teamA))).not.toBeNull();
  });

  it("drops a response a newer request for the same team superseded", async () => {
    const { server, registry, loader } = setUp();
    server.snapshot = () => "pending";

    const stale = loader.refresh(teamA, "snapshot");
    const [resolveStale] = server.takePending(teamA);
    const fresh = loader.refresh(teamA, "snapshot");
    const [resolveFresh] = server.takePending(teamA);

    resolveStale?.(snapshotOf(teamA, 42));
    await stale;
    expect(registry.get(dashboardViewAtom(teamA))).toBeNull();

    resolveFresh?.(snapshotOf(teamA, 43));
    await fresh;
    expect(registry.get(dashboardViewAtom(teamA))?.cursor).toBe(43);
  });

  it("drops a response for a team that is no longer selected", async () => {
    const { server, registry, loader } = setUp();
    server.snapshot = () => "pending";

    const inFlight = loader.refresh(teamA, "snapshot");
    registry.set(activeTeamIdAtom, teamB);
    for (const resolve of server.takePending(teamA)) {
      resolve(snapshotOf(teamA, 1));
    }
    await inFlight;

    expect(registry.get(dashboardViewAtom(teamA))).toBeNull();
  });

  it("drops a response the caller cancelled", async () => {
    const { server, registry, loader } = setUp();
    server.snapshot = () => "pending";

    const inFlight = loader.refresh(teamA, "snapshot");
    loader.cancel(teamA);
    for (const resolve of server.takePending(teamA)) {
      resolve(snapshotOf(teamA, 1));
    }
    await inFlight;

    expect(registry.get(dashboardViewAtom(teamA))).toBeNull();
    expect(registry.get(sessionErrorAtom)).toBeNull();
  });

  it("cancels every team at once when the selection changes", async () => {
    const { server, registry, loader } = setUp();
    server.snapshot = () => "pending";
    registry.set(activeTeamIdAtom, teamB);

    const inFlight = loader.refresh(teamB, "snapshot");
    loader.cancelAll();
    for (const resolve of server.takePending(teamB)) {
      resolve(snapshotOf(teamB, 1));
    }
    await inFlight;

    expect(registry.get(dashboardViewAtom(teamB))).toBeNull();
  });

  it("does nothing without a session or a team", async () => {
    const withoutTeam = setUp(null);
    await withoutTeam.loader.refresh(null);
    expect(withoutTeam.server.snapshotRequests).toEqual([]);

    const withoutToken = setUp(teamA, null);
    await withoutToken.loader.refresh(teamA);
    expect(withoutToken.server.snapshotRequests).toEqual([]);
  });
});
