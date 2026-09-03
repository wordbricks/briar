import { useMemo } from "react";

import {
  createPlanningProject as createRemotePlanningProject,
  deletePlanningProject as deleteRemotePlanningProject,
  updatePlanningProject as updateRemotePlanningProject,
} from "../../lib/api";
import type { PlanningProject, PlanningProjectStatus } from "../../types";
import { demoOrganization } from "../demo-fixtures";
import { runsByIdAtom, teamRunsAtom } from "../entities/runs";
import { upsertMany } from "../entities/upsert";
import { demoMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { loadedDashboardTeamIdAtom } from "../sync/view";
import { teamsAtom } from "../team/atoms";
import { planningProjectsAtom } from "./atoms";

/** Remote writes the planning project actions perform. */
export interface PlanningActionApi {
  readonly createPlanningProject: typeof createRemotePlanningProject;
  readonly deletePlanningProject: typeof deleteRemotePlanningProject;
  readonly updatePlanningProject: typeof updateRemotePlanningProject;
}

export const livePlanningActionApi: PlanningActionApi = {
  createPlanningProject: createRemotePlanningProject,
  deletePlanningProject: deleteRemotePlanningProject,
  updatePlanningProject: updateRemotePlanningProject,
};

export interface PlanningActionDeps {
  readonly api?: Partial<PlanningActionApi> | undefined;
}

export interface CreatePlanningProjectInput {
  readonly name: string;
  readonly description?: string | undefined;
  readonly status?: PlanningProjectStatus | undefined;
}

export interface EditPlanningProjectInput {
  readonly name: string;
  readonly description: string;
  readonly status: PlanningProjectStatus;
}

export interface PlanningActions {
  readonly addPlanningProject: (
    teamId: string,
    input: CreatePlanningProjectInput,
  ) => Promise<PlanningProject>;
  readonly editPlanningProject: (
    planningProjectId: string,
    input: EditPlanningProjectInput,
  ) => Promise<PlanningProject>;
  readonly removePlanningProject: (
    planningProjectId: string,
  ) => Promise<{ movedIssueCount: number }>;
}

/**
 * Server order for the flattened planning project list: grouped by team, then
 * by the team's own ordering, then oldest first.
 */
const byTeamThenSortOrder = (left: PlanningProject, right: PlanningProject) =>
  left.teamId.localeCompare(right.teamId) ||
  left.sortOrder - right.sortOrder ||
  left.createdAt.localeCompare(right.createdAt);

export function createPlanningActions(
  registry: AtomRegistry,
  deps: PlanningActionDeps = {},
): PlanningActions {
  const api: PlanningActionApi = { ...livePlanningActionApi, ...deps.api };

  /** Demo mode has no server to report a moved-issue count, so it counts here. */
  const countTeamIssues = (planningProjectId: string) => {
    const teamId = registry.get(loadedDashboardTeamIdAtom);
    if (!teamId) return 0;
    return (registry.get(teamRunsAtom(teamId)) ?? []).filter(
      (run) => run.projectId === planningProjectId,
    ).length;
  };

  /** Re-points a deleted planning project's issues at the default one. */
  const moveTeamIssues = (
    teamId: string,
    fromPlanningProjectId: string,
    toPlanningProject: PlanningProject,
  ) => {
    const runs = registry.get(teamRunsAtom(teamId));
    if (!runs) return;
    const moved = runs
      .filter((run) => run.projectId === fromPlanningProjectId)
      .map((run) => ({
        ...run,
        projectId: toPlanningProject.id,
        projectName: toPlanningProject.name,
      }));
    if (moved.length === 0) return;
    registry.update(runsByIdAtom, (current) => upsertMany(current, moved));
  };

  return {
    async addPlanningProject(teamId, input) {
      const team = registry
        .get(teamsAtom)
        .find((candidate) => candidate.id === teamId);
      if (!team) throw new Error("프로젝트를 추가할 팀이 없습니다.");
      if (demoMode) {
        const observedAt = new Date().toISOString();
        const project: PlanningProject = {
          id: crypto.randomUUID(),
          workspaceId: team.organizationId ?? demoOrganization.id,
          workspaceName: team.organizationName ?? demoOrganization.name,
          teamId,
          teamName: team.name,
          name: input.name.trim(),
          description: input.description?.trim() ?? "",
          status: input.status ?? "planned",
          leadUserId: null,
          leadName: null,
          startDate: null,
          targetDate: null,
          icon: null,
          color: null,
          sortOrder: registry
            .get(planningProjectsAtom)
            .filter((candidate) => candidate.teamId === teamId).length,
          isDefault: false,
          role: team.role ?? "owner",
          createdAt: observedAt,
          updatedAt: observedAt,
        };
        registry.update(planningProjectsAtom, (current) => [
          ...current,
          project,
        ]);
        return project;
      }
      const token = registry.get(tokenAtom);
      if (!token) throw new Error("로그인이 필요합니다.");
      const project = await api.createPlanningProject(token, teamId, input);
      registry.update(planningProjectsAtom, (current) =>
        [...current, project].sort(byTeamThenSortOrder),
      );
      return project;
    },

    async editPlanningProject(planningProjectId, input) {
      const existing = registry
        .get(planningProjectsAtom)
        .find((candidate) => candidate.id === planningProjectId);
      if (!existing) throw new Error("수정할 프로젝트가 없습니다.");
      const normalized = {
        name: input.name.trim(),
        description: input.description.trim(),
        status: input.status,
      };
      let project: PlanningProject;
      if (demoMode) {
        project = {
          ...existing,
          ...normalized,
          updatedAt: new Date().toISOString(),
        };
      } else {
        const token = registry.get(tokenAtom);
        if (!token) throw new Error("로그인이 필요합니다.");
        project = await api.updatePlanningProject(
          token,
          planningProjectId,
          normalized,
        );
      }
      registry.update(planningProjectsAtom, (current) =>
        current.map((candidate) =>
          candidate.id === planningProjectId ? project : candidate,
        ),
      );
      return project;
    },

    async removePlanningProject(planningProjectId) {
      const planningProjects = registry.get(planningProjectsAtom);
      const project = planningProjects.find(
        (candidate) => candidate.id === planningProjectId,
      );
      if (!project) throw new Error("삭제할 프로젝트가 없습니다.");
      if (project.isDefault) {
        throw new Error("팀의 기본 프로젝트는 삭제할 수 없습니다.");
      }
      const defaultProject = planningProjects.find(
        (candidate) =>
          candidate.teamId === project.teamId && candidate.isDefault,
      );
      if (!defaultProject) {
        throw new Error("이슈를 옮길 기본 프로젝트를 찾을 수 없습니다.");
      }
      const result = demoMode
        ? { movedIssueCount: countTeamIssues(planningProjectId) }
        : await (async () => {
            const token = registry.get(tokenAtom);
            if (!token) throw new Error("로그인이 필요합니다.");
            return api.deletePlanningProject(token, planningProjectId);
          })();
      registry.update(planningProjectsAtom, (current) =>
        current.filter((candidate) => candidate.id !== planningProjectId),
      );
      if (result.movedIssueCount > 0) {
        moveTeamIssues(project.teamId, planningProjectId, defaultProject);
      }
      return result;
    },
  };
}

export function usePlanningActions(
  deps: PlanningActionDeps = {},
): PlanningActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => createPlanningActions(registry, { api }),
    [api, registry],
  );
}
