import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  updateTeamIcon as updateRemoteTeamIcon,
  updateTeamIssueKeyPrefix as updateRemoteTeamIssueKeyPrefix,
  updateTeamTabs as updateRemoteTeamTabs,
  type TeamIconUpdate,
} from "../../lib/api";
import { demoDashboard } from "../../lib/demo-data";
import type { Project } from "../../types";
import { emptyDashboard } from "../demo-fixtures";
import { teamsByIdAtom } from "../entities/teams";
import { upsertManyBy } from "../entities/upsert";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { demoMode, lockedTeamIdAtom } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { bumpReconnectRequest } from "../workspace/api";
import { resolveSessionApi } from "../session/api";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { markTeamStale } from "../sync/apply";
import { commitTeamSnapshot } from "../sync/commit";
import { getTeamSyncLoader } from "../sync/loader";
import { loadedDashboardTeamIdAtom } from "../sync/view";
import { activeTeamIdAtom, isCreatingTeamAtom, teamConnectionAtom, teamsAtom } from "./atoms";

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
  /**
   * Opens a team the account already has. A no-op in a project window asked for
   * anything but its pinned team, and for an id that is not in the list.
   */
  readonly selectTeam: (teamId: string) => void;
  /**
   * {@link selectTeam} for a team that may not be in the list yet — a deep link
   * into a team joined on another device. Reloads the list once before giving
   * up, and throws rather than silently doing nothing, because every caller is
   * navigating somewhere on the strength of it.
   */
  readonly ensureTeamSelected: (teamId: string) => Promise<Project>;
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

  /*
    Selecting a team.

    The board for a team the store already holds is on screen before this
    returns — that is the whole point of the entity store — so the only question
    left is what the next fetch may do with it. `loadedDashboardTeamId` answers
    it: when the payload on screen belongs to another team, this team's stored
    copy is marked stale so the next fetch replaces it wholesale instead of
    patching an arbitrarily old cursor.

    The refetch itself is `useTeamSync`'s, which reacts to the selection
    changing. The one case it cannot see is re-selecting the team that is
    already selected while the payload on screen belongs to another one, so that
    case asks the loader directly.
  */
  const commitSelection = (team: Project) => {
    const activeTeamId = registry.get(activeTeamIdAtom);
    const dashboardMatchesTeam =
      registry.get(loadedDashboardTeamIdAtom) === team.id;
    if (activeTeamId === team.id && dashboardMatchesTeam) {
      Atom.batch(() => {
        registry.set(activeOrganizationIdAtom, team.organizationId);
        registry.set(sessionErrorAtom, null);
      });
      return;
    }
    bumpReconnectRequest(registry);
    Atom.batch(() => {
      registry.set(activeTeamIdAtom, team.id);
      registry.set(activeOrganizationIdAtom, team.organizationId);
      if (!demoMode && !dashboardMatchesTeam) markTeamStale(registry, team.id);
      registry.set(sessionErrorAtom, null);
    });
    if (!demoMode) {
      if (activeTeamId === team.id && !dashboardMatchesTeam) {
        void getTeamSyncLoader(registry).refresh(team.id, "snapshot");
      }
      return;
    }
    // Demo mode has no server: the sample board is the demo team's, and every
    // other team opens empty.
    commitTeamSnapshot(
      registry,
      team.id,
      team.id === demoDashboard.team.id ? demoDashboard : emptyDashboard(team),
    );
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

    selectTeam(teamId) {
      const lockedTeamId = registry.get(lockedTeamIdAtom);
      if (lockedTeamId && teamId !== lockedTeamId) return;
      const team = registry
        .get(teamsAtom)
        .find((candidate) => candidate.id === teamId);
      if (!team) return;
      commitSelection(team);
    },

    async ensureTeamSelected(teamId) {
      const lockedTeamId = registry.get(lockedTeamIdAtom);
      if (lockedTeamId && teamId !== lockedTeamId) {
        throw new Error("이 윈도우에서는 다른 프로젝트를 열 수 없습니다.");
      }
      let teams = registry.get(teamsAtom);
      let team = teams.find((candidate) => candidate.id === teamId);
      const token = registry.get(tokenAtom);
      if (!team && token && !demoMode) {
        teams = await resolveSessionApi(registry).loadTeams(token);
        registry.set(teamsAtom, teams);
        team = teams.find((candidate) => candidate.id === teamId);
      }
      if (!team) throw new Error("요청한 프로젝트를 찾을 수 없습니다.");
      commitSelection(team);
      return team;
    },
  };
}

/*
  One team action object per registry, so the registry-bound callers that reach
  for a team selection — the issue actions after creating an issue in another
  team, the navigation reconciliation — share the identity the views hold.
*/
const teamActions = new WeakMap<AtomRegistry, TeamActions>();

export function getTeamActions(registry: AtomRegistry): TeamActions {
  let actions = teamActions.get(registry);
  if (!actions) {
    actions = createTeamActions(registry);
    teamActions.set(registry, actions);
  }
  return actions;
}

export function useTeamActions(deps: TeamActionDeps = {}): TeamActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => (api ? createTeamActions(registry, { api }) : getTeamActions(registry)),
    [api, registry],
  );
}
