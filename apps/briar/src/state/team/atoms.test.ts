import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Project } from "../../types";
import { createTestRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import {
  activeTeamAtom,
  activeTeamIdAtom,
  deletingTeamIdAtom,
  isCreatingTeamAtom,
  loadedTeamIdAtom,
  renderedTeamSettingsAtom,
  teamAgentBoardAtom,
  teamConnectionAtom,
  teamsAtom,
} from "./atoms";

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
});

const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

describe("team atoms", () => {
  it("starts with no teams, no selection and no flow in progress", () => {
    const registry = createTestRegistry();

    expect(registry.get(teamsAtom)).toEqual([]);
    expect(registry.get(activeTeamIdAtom)).toBeNull();
    expect(registry.get(activeTeamAtom)).toBeNull();
    expect(registry.get(teamConnectionAtom)).toBeNull();
    expect(registry.get(isCreatingTeamAtom)).toBe(false);
    expect(registry.get(deletingTeamIdAtom)).toBeNull();
  });

  it("resolves the active team from the list", () => {
    const registry = createTestRegistry([[teamsAtom, [teamA, teamB]]]);

    registry.set(activeTeamIdAtom, teamB.id);
    expect(registry.get(activeTeamAtom)).toBe(teamB);

    registry.set(activeTeamIdAtom, "team-missing");
    expect(registry.get(activeTeamAtom)).toBeNull();
  });

  it("announces the active team only when it actually changes", () => {
    const registry = createTestRegistry([
      [teamsAtom, [teamA, teamB]],
      [activeTeamIdAtom, teamA.id],
    ]);
    const seen: (Project | null)[] = [];
    registry.subscribe(
      activeTeamAtom,
      (value) => {
        seen.push(value);
      },
      { immediate: true },
    );
    expect(seen).toEqual([teamA]);
    seen.length = 0;

    // Another team's icon change must not wake the views reading this one.
    registry.set(teamsAtom, [teamA, { ...teamB, icon: "data:image/png;base64," }]);
    expect(seen).toEqual([]);

    const renamedA = { ...teamA, name: "Team A renamed" };
    registry.set(teamsAtom, [renamedA, teamB]);
    expect(seen).toEqual([renamedA]);
  });

  it("counts one notification per team-selection change", () => {
    const registry = createTestRegistry([[teamsAtom, [teamA, teamB]]]);
    const seen: (string | null)[] = [];
    registry.subscribe(activeTeamIdAtom, (value) => {
      seen.push(value);
    });

    registry.set(activeTeamIdAtom, teamA.id);
    // Reselecting the same team is not a change, so no subscriber is woken —
    // this is what lets a view read the selection without extra renders.
    registry.set(activeTeamIdAtom, teamA.id);
    registry.set(activeTeamIdAtom, teamB.id);
    registry.set(activeTeamIdAtom, null);

    expect(seen).toEqual([teamA.id, teamB.id, null]);
  });

  it("reports the team on screen only once its payload arrived", () => {
    const registry = createTestRegistry([
      [teamsAtom, [teamA, teamB]],
      [activeTeamIdAtom, teamA.id],
    ]);

    // Selected, but nothing has been loaded for it yet.
    expect(registry.get(loadedTeamIdAtom)).toBeNull();
    expect(registry.get(renderedTeamSettingsAtom(teamA.id))).toBeNull();

    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamA.id,
      payload: { ...demoDashboard, team: teamA },
    });

    expect(registry.get(loadedTeamIdAtom)).toBe(teamA.id);
    expect(registry.get(renderedTeamSettingsAtom(teamA.id))).toBe(
      demoDashboard.settings,
    );

    // A team whose payload is loaded but that is not the one on screen reads
    // as absent: a write aimed at it would land under a cursor nobody follows.
    registry.set(activeTeamIdAtom, teamB.id);
    expect(registry.get(loadedTeamIdAtom)).toBeNull();
    expect(registry.get(renderedTeamSettingsAtom(teamA.id))).toBeNull();
  });

  it("keeps the agent board identical across a run edit it does not show", () => {
    const registry = createTestRegistry([
      [teamsAtom, [teamA]],
      [activeTeamIdAtom, teamA.id],
    ]);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamA.id,
      payload: { ...demoDashboard, team: teamA },
    });
    const board = teamAgentBoardAtom(teamA.id);
    const seen: unknown[] = [];
    registry.subscribe(board, (value) => seen.push(value), { immediate: true });
    seen.length = 0;
    const before = registry.get(board);

    // A delta that moves the cursor and nothing else: every projection keeps
    // its reference, so the composite keeps its own.
    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA.id,
      payload: {
        reset: false,
        cursor: 99,
        hasMore: false,
        runs: [],
        deletedRunIds: [],
        workers: demoDashboard.workers ?? [],
        organizationProviders: demoDashboard.organizationProviders ?? [],
        generatedAt: "2026-09-04T00:00:00.000Z",
      },
    });

    expect(registry.get(board)).toBe(before);
    expect(seen).toEqual([]);

    const target = demoDashboard.runs[0]!;
    applySyncEvent(registry, {
      kind: "run-changed",
      teamId: teamA.id,
      run: { ...target, title: "고친 이슈" },
    });

    // The runs are what the Agents page dispatches over, so a run edit does
    // reach it — and the three projections it did not touch do not move.
    const after = registry.get(board);
    expect(seen).toHaveLength(1);
    expect(after?.runs).not.toBe(before?.runs);
    expect(after?.team).toBe(before?.team);
    expect(after?.workers).toBe(before?.workers);
    expect(after?.executionPolicy).toBe(before?.executionPolicy);
  });

  it("keeps the selection when the last subscriber leaves", () => {
    const registry = createTestRegistry();
    const unsubscribe = registry.subscribe(activeTeamIdAtom, () => undefined);
    registry.set(activeTeamIdAtom, teamA.id);
    unsubscribe();

    // Switching away from a team drops its subscribers; `Atom.keepAlive` is
    // what stops that from also dropping the selection.
    expect(registry.get(activeTeamIdAtom)).toBe(teamA.id);
  });
});
