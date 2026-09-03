import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { PlanningProject, Project } from "../../types";
import { teamRunsAtom } from "../entities/runs";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
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
    [activeTeamIdAtom, teamA.id],
  ]);
  const server = new PlanningServer();
  const actions = createPlanningActions(registry, { api: server.api });
  return { actions, registry, server };
};

/** Loads team A's board with one issue filed under `featureA`. */
const loadTeamAWithIssue = (registry: AtomRegistry) => {
  const run = {
    ...demoDashboard.runs[0]!,
    id: "run-1",
    projectId: featureA.id,
    projectName: featureA.name,
  };
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: {
      ...demoDashboard,
      team: teamA,
      runs: [run],
      generatedAt: "2026-09-01T00:00:00.000Z",
    },
  });
  return run;
};

const issueProjects = (registry: AtomRegistry) =>
  (registry.get(teamRunsAtom(teamA.id)) ?? []).map((run) => [
    run.projectId,
    run.projectName,
  ]);

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
    const { actions, registry, server } = harness();
    loadTeamAWithIssue(registry);
    server.movedIssueCount = 3;

    const result = await actions.removePlanningProject(featureA.id);

    expect(result).toEqual({ movedIssueCount: 3 });
    expect(server.deleted).toEqual([featureA.id]);
    expect(registry.get(planningProjectsAtom)).toEqual([defaultA, defaultB]);
    // The issues the server re-filed are re-pointed in the store too.
    expect(issueProjects(registry)).toEqual([[defaultA.id, defaultA.name]]);
  });

  it("leaves the board alone when nothing moved", async () => {
    const { actions, registry } = harness();
    const run = loadTeamAWithIssue(registry);

    await actions.removePlanningProject(featureA.id);

    expect(registry.get(teamRunsAtom(teamA.id))).toEqual([run]);
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
