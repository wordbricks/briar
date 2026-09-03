import { describe, expect, it } from "vitest";

import type { RepositoryReadiness } from "../../generated/tauri";
import { demoRepositoryReadiness } from "../../lib/demo-data";
import type { Project } from "../../types";
import { demoDashboard } from "../../lib/demo-data";
import { createTestRegistry } from "../registry";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  activeTeamConnectionStateAtom,
  applyInventoryObservation,
  applyReadinessObservation,
  beginHealthProbe,
  clearWorkspaceInventory,
  connectedTeamIdsAtom,
  healthAtom,
  localInventoryErrorAtom,
  readinessLoadingTeamIdsAtom,
  resetHealth,
  setConnectedTeamIds,
  setHealthError,
  setHealthResult,
  setTeamReadinessLoading,
  teamReadinessAtom,
  teamReadinessErrorRecordAtom,
  teamReadinessRecordAtom,
} from "./atoms";

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const readinessOf = (path: string): RepositoryReadiness => ({
  ...demoRepositoryReadiness,
  repositoryPath: path,
});

const registryWithTeams = () =>
  createTestRegistry([[teamsAtom, [teamA, teamB]]]);

describe("workspace atoms", () => {
  it("keeps the inventory instance when a re-read finds the same teams", () => {
    const registry = createTestRegistry();
    const first = ["team-a", "team-b"];
    setConnectedTeamIds(registry, first);

    // Order differs and the array is new, but the set is the same: the schedule
    // runner and the workflow mirror must not restart on this.
    const kept = setConnectedTeamIds(registry, ["team-b", "team-a"]);

    expect(kept).toBe(first);
    expect(registry.get(connectedTeamIdsAtom)).toBe(first);

    const changed = setConnectedTeamIds(registry, ["team-a"]);
    expect(changed).not.toBe(first);
    expect(registry.get(connectedTeamIdsAtom)).toEqual(["team-a"]);
  });

  it("records the inventory error and clears it on the next good read", () => {
    const registry = createTestRegistry();

    applyInventoryObservation(registry, {
      status: "error",
      connectedTeamIds: null,
      error: new Error("소켓이 닫혔습니다"),
    });
    expect(registry.get(localInventoryErrorAtom)).toContain("소켓이 닫혔습니다");
    expect(registry.get(connectedTeamIdsAtom)).toBeNull();

    applyInventoryObservation(registry, {
      status: "loaded",
      connectedTeamIds: ["team-a"],
      error: null,
    });
    expect(registry.get(localInventoryErrorAtom)).toBeNull();
    expect(registry.get(connectedTeamIdsAtom)).toEqual(["team-a"]);

    clearWorkspaceInventory(registry);
    expect(registry.get(connectedTeamIdsAtom)).toBeNull();
    expect(registry.get(localInventoryErrorAtom)).toBeNull();
  });

  it("resolves the selected team's connection state", () => {
    const registry = registryWithTeams();

    // Nothing selected and nothing read: neither claim can be made.
    expect(registry.get(activeTeamConnectionStateAtom)).toBe("unknown");

    registry.set(activeTeamIdAtom, teamA.id);
    expect(registry.get(activeTeamConnectionStateAtom)).toBe("unknown");

    setConnectedTeamIds(registry, [teamB.id]);
    expect(registry.get(activeTeamConnectionStateAtom)).toBe("disconnected");

    setConnectedTeamIds(registry, [teamA.id, teamB.id]);
    expect(registry.get(activeTeamConnectionStateAtom)).toBe("connected");
  });

  it("keeps a loading probe's previous value and clears it only on repair", () => {
    const registry = createTestRegistry();
    const health = { ...demoDashboard, projectId: teamA.id } as never;

    setHealthResult(registry, health);
    expect(registry.get(healthAtom)).toEqual({
      status: "ready",
      value: health,
      error: null,
    });

    // A refresh leaves the last result on screen while it runs, which is what
    // the separate loading flag did.
    beginHealthProbe(registry);
    expect(registry.get(healthAtom).value).toBe(health);
    expect(registry.get(healthAtom).status).toBe("loading");

    setHealthError(registry, "실패");
    expect(registry.get(healthAtom)).toEqual({
      status: "error",
      value: null,
      error: "실패",
    });

    // Repair opens with a cleared error and keeps whatever health it found.
    setHealthResult(registry, health);
    beginHealthProbe(registry, { clearError: true });
    expect(registry.get(healthAtom).error).toBeNull();
    setHealthError(registry, "복구 실패", { keepValue: true });
    expect(registry.get(healthAtom).value).toBe(health);

    resetHealth(registry);
    expect(registry.get(healthAtom)).toEqual({
      status: "idle",
      value: null,
      error: null,
    });
  });

  it("notifies only the probed team's readiness subscribers", () => {
    const registry = registryWithTeams();
    let teamAUpdates = 0;
    let teamBUpdates = 0;
    const stopA = registry.subscribe(teamReadinessAtom(teamA.id), () => {
      teamAUpdates += 1;
    });
    const stopB = registry.subscribe(teamReadinessAtom(teamB.id), () => {
      teamBUpdates += 1;
    });

    applyReadinessObservation(registry, teamA.id, {
      status: "ready",
      connectedTeamIds: [teamA.id],
      readiness: readinessOf("/a"),
      error: null,
    });

    expect(teamAUpdates).toBe(1);
    expect(teamBUpdates).toBe(0);

    // Writing the same loading flag again produces no notification at all.
    setTeamReadinessLoading(registry, teamA.id, false);
    expect(teamAUpdates).toBe(1);

    stopA();
    stopB();
  });

  it("projects the facade records and keeps their identity while unchanged", () => {
    const registry = registryWithTeams();
    const readiness = readinessOf("/a");

    applyReadinessObservation(registry, teamA.id, {
      status: "ready",
      connectedTeamIds: [teamA.id],
      readiness,
      error: null,
    });
    const record = registry.get(teamReadinessRecordAtom);
    expect(record).toEqual({ [teamA.id]: readiness });

    // A loading flag on another team leaves the readiness record identical, so
    // the dependency arrays `App.tsx` builds from it do not churn.
    setTeamReadinessLoading(registry, teamB.id, true);
    expect(registry.get(teamReadinessRecordAtom)).toBe(record);
    expect(registry.get(readinessLoadingTeamIdsAtom)).toEqual(
      new Set([teamB.id]),
    );

    applyReadinessObservation(registry, teamB.id, {
      status: "error",
      connectedTeamIds: [teamA.id],
      readiness: null,
      error: new Error("검사 실패"),
    });
    expect(registry.get(teamReadinessErrorRecordAtom)).toEqual({
      [teamB.id]: "검사 실패",
    });
    expect(registry.get(teamReadinessRecordAtom)).toBe(record);
  });

  it("carries the inventory an unknown readiness observation reports", () => {
    const registry = registryWithTeams();
    setConnectedTeamIds(registry, [teamA.id]);

    applyReadinessObservation(registry, teamA.id, {
      status: "unknown",
      connectedTeamIds: null,
      readiness: null,
      error: new Error("연결 목록 없음"),
    });

    expect(registry.get(connectedTeamIdsAtom)).toBeNull();
    expect(registry.get(localInventoryErrorAtom)).toContain("연결 목록 없음");
    expect(registry.get(teamReadinessAtom(teamA.id)).error).toBe(
      "연결 목록 없음",
    );
  });
});
