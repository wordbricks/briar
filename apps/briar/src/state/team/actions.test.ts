import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Project } from "../../types";
import { teamEntityAtom } from "../entities/teams";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { dashboardViewAtom } from "../sync/view";
import {
  createTeamActions,
  type TeamActionApi,
  type TeamActions,
} from "./actions";
import { isCreatingTeamAtom, teamConnectionAtom, teamsAtom } from "./atoms";

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
  let reconnectBumps = 0;
  const actions = createTeamActions(registry, {
    api: server.api,
    bumpReconnectRequest: () => {
      reconnectBumps += 1;
    },
  });
  return {
    actions,
    reconnectBumps: () => reconnectBumps,
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
    expect(registry.get(dashboardViewAtom(teamA.id))?.team).toBe(team);
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
