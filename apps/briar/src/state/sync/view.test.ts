import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { DashboardDeltaPayload, DashboardPayload } from "../../types";
import { createTestRegistry } from "../registry";
import { activeTeamIdAtom } from "../team/atoms";
import { applySyncEvent } from "./apply";
import {
  activeDashboardAtom,
  dashboardViewAtom,
  loadedDashboardTeamIdAtom,
} from "./view";

const teamId = "team-a";

const snapshot: DashboardPayload = {
  ...demoDashboard,
  team: { ...demoDashboard.team, id: teamId },
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

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
  generatedAt: "2026-09-02T00:00:00.000Z",
  ...overrides,
});

const loadedRegistry = () => {
  const registry = createTestRegistry([[activeTeamIdAtom, teamId]]);
  applySyncEvent(registry, { kind: "team-snapshot", teamId, payload: snapshot });
  return registry;
};

describe("dashboard view", () => {
  it("is null until the team is loaded", () => {
    const registry = createTestRegistry([[activeTeamIdAtom, teamId]]);

    expect(registry.get(dashboardViewAtom(teamId))).toBeNull();
    expect(registry.get(activeDashboardAtom)).toBeNull();
    expect(registry.get(loadedDashboardTeamIdAtom)).toBeNull();
  });

  it("reassembles the payload the snapshot carried", () => {
    const registry = loadedRegistry();

    expect(registry.get(activeDashboardAtom)).toEqual(snapshot);
  });

  it("follows the selected team", () => {
    const registry = loadedRegistry();

    registry.set(activeTeamIdAtom, "team-b");
    expect(registry.get(activeDashboardAtom)).toBeNull();

    registry.set(activeTeamIdAtom, teamId);
    expect(registry.get(activeDashboardAtom)).toEqual(snapshot);
  });

  it("keeps the parts a delta did not touch", () => {
    const registry = loadedRegistry();
    const before = registry.get(dashboardViewAtom(teamId));
    const target = snapshot.runs[0]!;

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId,
      payload: deltaOf({
        runs: [{ ...target, detail: "changed", updatedAt: target.updatedAt }],
      }),
    });

    const after = registry.get(dashboardViewAtom(teamId));
    expect(after).not.toBe(before);
    expect(after?.runs).not.toBe(before?.runs);
    expect(after?.team).toBe(before?.team);
    expect(after?.settings).toBe(before?.settings);
    expect(after?.members).toBe(before?.members);
    expect(after?.organizationProviders).toBe(before?.organizationProviders);
  });

  it("rebuilds nothing when a delta only advances the cursor", () => {
    const registry = loadedRegistry();
    const before = registry.get(dashboardViewAtom(teamId));

    applySyncEvent(registry, { kind: "team-delta", teamId, payload: deltaOf() });

    expect(registry.get(dashboardViewAtom(teamId))).toBe(before);
  });
});
