import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Project } from "../../types";
import { teamEntityAtom } from "../entities/teams";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { setSessionDataSources } from "../session/api";
import { reconnectRequestGeneration } from "../workspace/api";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { readTeamView } from "../../test/team-view";
import {
  createTeamActions,
  type TeamActionApi,
  type TeamActions,
} from "./actions";
import {
  activeTeamIdAtom,
  isCreatingTeamAtom,
  staleTeamIdAtom,
  teamConnectionAtom,
  teamsAtom,
} from "./atoms";

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

/** In-memory stand-in for the team metadata RPCs. */
class TeamServer {
  readonly iconUpdates: string[] = [];
  readonly prefixUpdates: [string, string][] = [];
  readonly tabUpdates: [string, boolean][] = [];

  constructor(private teams: Project[]) {}

  private require(teamId: string) {
    const team = this.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new Error(`unknown team ${teamId}`);
    return team;
  }

  readonly api: TeamActionApi = {
    updateTeamIcon: async (_token, teamId, update) => {
      this.iconUpdates.push(teamId);
      return {
        project: {
          ...this.require(teamId),
          icon: update.type === "image" ? update.dataUrl : null,
          iconName: update.type === "named" ? update.name : null,
          iconColor: update.type === "named" ? update.color : null,
        },
      };
    },
    updateTeamIssueKeyPrefix: async (_token, teamId, issueKeyPrefix) => {
      this.prefixUpdates.push([teamId, issueKeyPrefix]);
      return { project: { ...this.require(teamId), issueKeyPrefix } };
    },
    updateTeamTabs: async (_token, teamId, tabs) => {
      this.tabUpdates.push([teamId, tabs.schedule ?? false]);
      return {
        project: { ...this.require(teamId), scheduleTabEnabled: tabs.schedule },
      };
    },
  };
}

interface Harness {
  readonly actions: TeamActions;
  readonly reconnectBumps: () => number;
  readonly registry: AtomRegistry;
  readonly server: TeamServer;
}

const harness = (): Harness => {
  const registry = createTestRegistry([
    [teamsAtom, [teamA, teamB]],
    [tokenAtom, "token-1"],
  ]);
  const server = new TeamServer([teamA, teamB]);
  // Team A's board is loaded; team B's is not, which is how the "only mirror
  // into a dashboard that exists" rule becomes observable.
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: {
      ...demoDashboard,
      team: teamA,
      runs: [],
      generatedAt: "2026-09-01T00:00:00.000Z",
    },
  });
  const baseReconnectGeneration = reconnectRequestGeneration(registry);
  const actions = createTeamActions(registry, { api: server.api });
  return {
    actions,
    reconnectBumps: () =>
      reconnectRequestGeneration(registry) - baseReconnectGeneration,
    registry,
    server,
  };
};

describe("createTeamActions", () => {
  it("writes an edited icon to the team list and the dashboard", async () => {
    const { actions, registry, server } = harness();

    const team = await actions.changeTeamIcon(teamA.id, {
      type: "image",
      dataUrl: "data:image/png;base64,",
    });

    expect(server.iconUpdates).toEqual([teamA.id]);
    expect(team.icon).toBe("data:image/png;base64,");
    expect(registry.get(teamsAtom)).toEqual([team, teamB]);
    expect(readTeamView(registry, teamA.id)?.team).toBe(team);
  });

  it("leaves a team the store never loaded out of the entity map", async () => {
    const { actions, registry } = harness();

    await actions.changeTeamIssueKeyPrefix(teamB.id, "NEW");

    expect(registry.get(teamEntityAtom(teamB.id))).toBeNull();
  });

  it("also refreshes the team held by an open connection flow", async () => {
    const { actions, registry } = harness();
    registry.set(teamConnectionAtom, {
      kind: "reconnect",
      project: teamA,
      agentToken: null,
    });

    const team = await actions.changeTeamIssueKeyPrefix(teamA.id, "NEW");

    expect(registry.get(teamConnectionAtom)?.project).toEqual(team);
    expect(team.issueKeyPrefix).toBe("NEW");
  });

  it("leaves a connection flow for another team alone", async () => {
    const { actions, registry } = harness();
    const connection = {
      kind: "reconnect" as const,
      project: teamB,
      agentToken: null,
    };
    registry.set(teamConnectionAtom, connection);

    await actions.changeTeamScheduleTab(teamA.id, false);

    expect(registry.get(teamConnectionAtom)).toBe(connection);
  });

  it("toggles the schedule tab through the server", async () => {
    const { actions, server } = harness();

    const team = await actions.changeTeamScheduleTab(teamB.id, false);

    expect(server.tabUpdates).toEqual([[teamB.id, false]]);
    expect(team.scheduleTabEnabled).toBe(false);
  });

  it("rejects editing a team the account cannot see", async () => {
    const { actions, server } = harness();

    await expect(
      actions.changeTeamIssueKeyPrefix("team-missing", "X"),
    ).rejects.toThrow("변경할 프로젝트를 찾을 수 없습니다.");
    expect(server.prefixUpdates).toEqual([]);
  });

  it("rejects editing a team without a session", async () => {
    const { actions, registry, server } = harness();
    registry.set(tokenAtom, null);

    await expect(actions.changeTeamScheduleTab(teamA.id, true)).rejects.toThrow(
      "로그인이 필요합니다.",
    );
    expect(server.tabUpdates).toEqual([]);
  });

  it("opens, cancels and finishes the team creation flow", () => {
    const { actions, registry, reconnectBumps } = harness();
    registry.set(sessionErrorAtom, "이전 오류");

    actions.startTeamCreation();
    expect(registry.get(isCreatingTeamAtom)).toBe(true);
    expect(registry.get(sessionErrorAtom)).toBeNull();

    registry.set(teamConnectionAtom, {
      kind: "new",
      project: teamA,
      agentToken: null,
    });
    actions.cancelTeamCreation();
    expect(registry.get(isCreatingTeamAtom)).toBe(false);
    expect(registry.get(teamConnectionAtom)).toBeNull();

    actions.startTeamCreation();
    actions.finishTeamCreation();
    expect(registry.get(isCreatingTeamAtom)).toBe(false);
    expect(registry.get(teamConnectionAtom)).toBeNull();
    // Opening and cancelling invalidate reconnect attempts; finishing does not,
    // because the flow it completes already established the connection.
    expect(reconnectBumps()).toBe(3);
  });
});

/*
  Selecting a team.

  These were `useBriar`'s `selectProject` and `ensureProjectSelected`. What they
  guard is the moment a switch happens: the board on screen belongs to whichever
  team the entity store last loaded, so the newly selected team's stored copy is
  marked stale unless it is the one already rendered — otherwise the next delta
  would patch a payload nobody refreshed.
*/
describe("selectTeam", () => {
  it("selects a team the account has", () => {
    const { actions, registry, reconnectBumps } = harness();
    registry.set(activeTeamIdAtom, teamA.id);
    registry.set(sessionErrorAtom, "이전 오류");

    actions.selectTeam(teamB.id);

    expect(registry.get(activeTeamIdAtom)).toBe(teamB.id);
    expect(registry.get(activeOrganizationIdAtom)).toBe(teamB.organizationId);
    expect(registry.get(sessionErrorAtom)).toBeNull();
    expect(reconnectBumps()).toBe(1);
    // Team B was never loaded, so there is no stored board to mark stale: the
    // board renders empty and the fetch fills it in.
    expect(registry.get(staleTeamIdAtom)).toBeNull();
  });

  it("marks a stored board stale when returning to it", () => {
    const { actions, registry } = harness();
    registry.set(activeTeamIdAtom, teamB.id);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamB.id,
      payload: {
        ...demoDashboard,
        team: teamB,
        runs: [],
        generatedAt: "2026-09-01T00:00:00.000Z",
      },
    });

    actions.selectTeam(teamA.id);

    // Team A's stored payload is on screen at once, and marked stale so the
    // next fetch replaces it wholesale instead of patching an old cursor.
    expect(registry.get(activeTeamIdAtom)).toBe(teamA.id);
    expect(registry.get(staleTeamIdAtom)).toBe(teamA.id);
  });

  it("leaves the loaded team alone when it is selected again", () => {
    const { actions, registry, reconnectBumps } = harness();
    registry.set(activeTeamIdAtom, teamA.id);

    actions.selectTeam(teamA.id);

    // The payload on screen is already this team's, so nothing is invalidated
    // and no reconnect attempt is thrown away.
    expect(registry.get(activeTeamIdAtom)).toBe(teamA.id);
    expect(registry.get(staleTeamIdAtom)).toBeNull();
    expect(reconnectBumps()).toBe(0);
  });

  it("ignores a team the account does not have", () => {
    const { actions, registry } = harness();
    registry.set(activeTeamIdAtom, teamA.id);

    actions.selectTeam("team-gone");

    expect(registry.get(activeTeamIdAtom)).toBe(teamA.id);
  });

  it("refuses any team but the pinned one in a project window", () => {
    const { actions, registry } = harness();
    registry.set(activeTeamIdAtom, teamA.id);
    registry.set(lockedTeamIdAtom, teamA.id);

    actions.selectTeam(teamB.id);

    expect(registry.get(activeTeamIdAtom)).toBe(teamA.id);
  });
});

describe("ensureTeamSelected", () => {
  it("reloads the team list for a team the account has not seen yet", async () => {
    const { actions, registry } = harness();
    const teamC = teamOf("team-c");
    registry.set(activeTeamIdAtom, teamA.id);
    setSessionDataSources(registry, {
      loadTeams: async () => [teamA, teamB, teamC],
    });

    const team = await actions.ensureTeamSelected(teamC.id);

    expect(team.id).toBe(teamC.id);
    expect(registry.get(teamsAtom)).toEqual([teamA, teamB, teamC]);
    expect(registry.get(activeTeamIdAtom)).toBe(teamC.id);
  });

  it("throws when the team is nowhere to be found", async () => {
    const { actions, registry } = harness();
    setSessionDataSources(registry, { loadTeams: async () => [teamA, teamB] });

    await expect(actions.ensureTeamSelected("team-gone")).rejects.toThrow(
      "요청한 프로젝트를 찾을 수 없습니다.",
    );
  });

  it("refuses to leave the team a project window is pinned to", async () => {
    const { actions, registry } = harness();
    registry.set(lockedTeamIdAtom, teamA.id);

    await expect(actions.ensureTeamSelected(teamB.id)).rejects.toThrow(
      "이 윈도우에서는 다른 프로젝트를 열 수 없습니다.",
    );
  });
});
