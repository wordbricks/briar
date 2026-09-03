import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { PlanningProject, Project } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { teamsAtom } from "../team/atoms";
import {
  createPlanningActions,
  type PlanningActionApi,
  type PlanningActions,
} from "./actions";
import { planningProjectsAtom } from "./atoms";

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const planningProjectOf = (
  id: string,
  team: Project,
  overrides: Partial<PlanningProject> = {},
): PlanningProject => ({
  id,
  workspaceId: team.organizationId,
  workspaceName: team.organizationName,
  teamId: team.id,
  teamName: team.name,
  name: id,
  description: "",
  status: "active",
  leadUserId: null,
  leadName: null,
  startDate: null,
  targetDate: null,
  icon: null,
  color: null,
  sortOrder: 0,
  isDefault: false,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const defaultA = planningProjectOf("a-default", teamA, { isDefault: true });
const featureA = planningProjectOf("a-feature", teamA, { sortOrder: 1 });
const defaultB = planningProjectOf("b-default", teamB, { isDefault: true });

/** In-memory stand-in for the planning project RPCs. */
class PlanningServer {
  readonly created: [string, string][] = [];
  readonly updated: [string, string][] = [];
  readonly deleted: string[] = [];
  movedIssueCount = 0;

  readonly api: PlanningActionApi = {
    createPlanningProject: async (_token, teamId, input) => {
      this.created.push([teamId, input.name]);
      return planningProjectOf(`remote-${input.name}`, teamOf(teamId), {
        name: input.name,
        sortOrder: 5,
        status: input.status ?? "planned",
      });
    },
    deletePlanningProject: async (_token, projectId) => {
      this.deleted.push(projectId);
      return { movedIssueCount: this.movedIssueCount };
    },
    updatePlanningProject: async (_token, projectId, input) => {
      this.updated.push([projectId, input.name ?? ""]);
      return planningProjectOf(projectId, teamA, {
        ...input,
        name: input.name ?? projectId,
      });
    },
  };
}

interface Harness {
  readonly actions: PlanningActions;
  readonly moves: [string, string, string][];
  readonly registry: AtomRegistry;
  readonly server: PlanningServer;
}

const harness = (
  planningProjects: PlanningProject[] = [defaultA, featureA, defaultB],
): Harness => {
  const registry = createTestRegistry([
    [teamsAtom, [teamA, teamB]],
    [planningProjectsAtom, planningProjects],
    [tokenAtom, "token-1"],
  ]);
  const server = new PlanningServer();
  const moves: [string, string, string][] = [];
  const actions = createPlanningActions(registry, {
    api: server.api,
    countDashboardIssues: () => 0,
    movePlanningProjectIssues: (teamId, from, to) => {
      moves.push([teamId, from, to.id]);
    },
  });
  return { actions, moves, registry, server };
};

describe("createPlanningActions", () => {
  it("appends a created project in server order", async () => {
    const { actions, registry, server } = harness();

    const project = await actions.addPlanningProject(teamB.id, {
      name: "Roadmap",
    });

    expect(server.created).toEqual([[teamB.id, "Roadmap"]]);
    // Sorted by team, then the team's own ordering: the new project belongs to
    // team B and sorts after its default.
    expect(registry.get(planningProjectsAtom)).toEqual([
      defaultA,
      featureA,
      defaultB,
      project,
    ]);
  });

  it("rejects adding a project to a team the account cannot see", async () => {
    const { actions, server } = harness();

    await expect(
      actions.addPlanningProject("team-missing", { name: "x" }),
    ).rejects.toThrow("프로젝트를 추가할 팀이 없습니다.");
    expect(server.created).toEqual([]);
  });

  it("replaces only the edited project", async () => {
    const { actions, registry, server } = harness();

    const project = await actions.editPlanningProject(featureA.id, {
      name: "  Renamed  ",
      description: "  trimmed  ",
      status: "completed",
    });

    // The action trims before it sends, so the server never stores padding.
    expect(server.updated).toEqual([[featureA.id, "Renamed"]]);
    expect(registry.get(planningProjectsAtom)).toEqual([
      defaultA,
      project,
      defaultB,
    ]);
  });

  it("rejects editing a project that is gone", async () => {
    const { actions, server } = harness();

    await expect(
      actions.editPlanningProject("missing", {
        name: "x",
        description: "",
        status: "active",
      }),
    ).rejects.toThrow("수정할 프로젝트가 없습니다.");
    expect(server.updated).toEqual([]);
  });

  it("removes a project and moves its issues to the team default", async () => {
    const { actions, moves, registry, server } = harness();
    server.movedIssueCount = 3;

    const result = await actions.removePlanningProject(featureA.id);

    expect(result).toEqual({ movedIssueCount: 3 });
    expect(server.deleted).toEqual([featureA.id]);
    expect(registry.get(planningProjectsAtom)).toEqual([defaultA, defaultB]);
    expect(moves).toEqual([[teamA.id, featureA.id, defaultA.id]]);
  });

  it("leaves the dashboard alone when nothing moved", async () => {
    const { actions, moves } = harness();

    await actions.removePlanningProject(featureA.id);

    expect(moves).toEqual([]);
  });

  it("refuses to remove a team's default project", async () => {
    const { actions, server } = harness();

    await expect(actions.removePlanningProject(defaultA.id)).rejects.toThrow(
      "팀의 기본 프로젝트는 삭제할 수 없습니다.",
    );
    expect(server.deleted).toEqual([]);
  });

  it("refuses to remove a project with nowhere to move its issues", async () => {
    const { actions, server } = harness([featureA, defaultB]);

    await expect(actions.removePlanningProject(featureA.id)).rejects.toThrow(
      "이슈를 옮길 기본 프로젝트를 찾을 수 없습니다.",
    );
    expect(server.deleted).toEqual([]);
  });

  it("refuses every write without a session", async () => {
    const { actions, registry } = harness();
    registry.set(tokenAtom, null);

    await expect(
      actions.addPlanningProject(teamA.id, { name: "x" }),
    ).rejects.toThrow("로그인이 필요합니다.");
    await expect(actions.removePlanningProject(featureA.id)).rejects.toThrow(
      "로그인이 필요합니다.",
    );
  });
});
