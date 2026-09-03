import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  updateTeamIcon as updateRemoteTeamIcon,
  updateTeamIssueKeyPrefix as updateRemoteTeamIssueKeyPrefix,
  updateTeamTabs as updateRemoteTeamTabs,
  type TeamIconUpdate,
} from "../../lib/api";
import type { Project } from "../../types";
import { teamsByIdAtom } from "../entities/teams";
import { upsertManyBy } from "../entities/upsert";
import { demoMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { bumpReconnectRequest } from "../workspace/api";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { isCreatingTeamAtom, teamConnectionAtom, teamsAtom } from "./atoms";

/** Remote writes the team metadata actions perform. */
export interface TeamActionApi {
  readonly updateTeamIcon: typeof updateRemoteTeamIcon;
  readonly updateTeamIssueKeyPrefix: typeof updateRemoteTeamIssueKeyPrefix;
  readonly updateTeamTabs: typeof updateRemoteTeamTabs;
}

export const liveTeamActionApi: TeamActionApi = {
  updateTeamIcon: updateRemoteTeamIcon,
  updateTeamIssueKeyPrefix: updateRemoteTeamIssueKeyPrefix,
  updateTeamTabs: updateRemoteTeamTabs,
};

export interface TeamActionDeps {
  readonly api?: Partial<TeamActionApi> | undefined;
}

export interface TeamActions {
  readonly cancelTeamCreation: () => void;
  readonly changeTeamIcon: (
    teamId: string,
    update: TeamIconUpdate,
  ) => Promise<Project>;
  readonly changeTeamIssueKeyPrefix: (
    teamId: string,
    issueKeyPrefix: string,
  ) => Promise<Project>;
  readonly changeTeamScheduleTab: (
    teamId: string,
    scheduleTabEnabled: boolean,
  ) => Promise<Project>;
  readonly finishTeamCreation: () => void;
  readonly startTeamCreation: () => void;
}

export function createTeamActions(
  registry: AtomRegistry,
  deps: TeamActionDeps = {},
): TeamActions {
  const api: TeamActionApi = { ...liveTeamActionApi, ...deps.api };

  const requireTeam = (teamId: string) => {
    const team = registry
      .get(teamsAtom)
      .find((candidate) => candidate.id === teamId);
    if (!team) throw new Error("변경할 프로젝트를 찾을 수 없습니다.");
    return team;
  };

  /**
   * Writes an edited team everywhere it is duplicated: the team list, the
   * in-progress connection flow, and the entity the dashboard renders. The
   * entity is only touched when the store already holds that team, matching the
   * "mirror it into the rendered dashboard" rule this replaced.
   */
  const commitTeam = (team: Project) => {
    Atom.batch(() => {
      registry.update(teamsAtom, (current) =>
        current.map((candidate) => (candidate.id === team.id ? team : candidate)),
      );
      registry.update(teamConnectionAtom, (current) =>
        current?.project.id === team.id ? { ...current, project: team } : current,
      );
      registry.update(teamsByIdAtom, (teams) =>
        teams.has(team.id)
          ? upsertManyBy(teams, [team], () => team.id)
          : teams,
      );
    });
    return team;
  };

  return {
    cancelTeamCreation() {
      bumpReconnectRequest(registry);
      Atom.batch(() => {
        registry.set(sessionErrorAtom, null);
        registry.set(isCreatingTeamAtom, false);
        registry.set(teamConnectionAtom, null);
      });
    },

    async changeTeamIcon(teamId, update) {
      const currentTeam = requireTeam(teamId);
      const token = registry.get(tokenAtom);
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      return commitTeam(
        demoMode || !token
          ? {
              ...currentTeam,
              icon: update.type === "image" ? update.dataUrl : null,
              iconName: update.type === "named" ? update.name : null,
              iconColor: update.type === "named" ? update.color : null,
            }
          : (await api.updateTeamIcon(token, teamId, update)).project,
      );
    },

    async changeTeamIssueKeyPrefix(teamId, issueKeyPrefix) {
      const currentTeam = requireTeam(teamId);
      const token = registry.get(tokenAtom);
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      return commitTeam(
        demoMode || !token
          ? { ...currentTeam, issueKeyPrefix }
          : (await api.updateTeamIssueKeyPrefix(token, teamId, issueKeyPrefix))
              .project,
      );
    },

    async changeTeamScheduleTab(teamId, scheduleTabEnabled) {
      const currentTeam = requireTeam(teamId);
      const token = registry.get(tokenAtom);
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      return commitTeam(
        demoMode || !token
          ? { ...currentTeam, scheduleTabEnabled }
          : (
              await api.updateTeamTabs(token, teamId, {
                schedule: scheduleTabEnabled,
              })
            ).project,
      );
    },

    finishTeamCreation() {
      Atom.batch(() => {
        registry.set(sessionErrorAtom, null);
        registry.set(isCreatingTeamAtom, false);
        registry.set(teamConnectionAtom, null);
      });
    },

    startTeamCreation() {
      bumpReconnectRequest(registry);
      Atom.batch(() => {
        registry.set(sessionErrorAtom, null);
        registry.set(isCreatingTeamAtom, true);
      });
    },
  };
}

export function useTeamActions(deps: TeamActionDeps = {}): TeamActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(() => createTeamActions(registry, { api }), [api, registry]);
}
