import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Project } from "../../types";
import { createTestRegistry } from "../registry";
import {
  activeTeamAtom,
  activeTeamIdAtom,
  deletingTeamIdAtom,
  isCreatingTeamAtom,
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
