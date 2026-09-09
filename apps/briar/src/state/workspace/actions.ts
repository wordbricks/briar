import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  createWorkspace as createRemoteWorkspace,
  isWorkspaceHandleAvailable as checkRemoteWorkspaceHandle,
  updateWorkspace as updateRemoteWorkspace,
  updateWorkspaceLogo as updateRemoteWorkspaceLogo,
} from "../../lib/api";
import { demoDashboard } from "../../lib/demo-data";
import type { Workspace } from "../../types";
import { emptyDashboard } from "../demo-fixtures";
import { teamsByIdAtom } from "../entities/teams";
import { upsertManyBy } from "../entities/upsert";
import { demoMode, lockedTeamIdAtom } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { bumpReconnectRequest } from "../local-workspace/api";
import { resetHealth } from "../local-workspace/atoms";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent, markTeamStale } from "../sync/apply";
import { activeTeamIdAtom, loadedTeamIdAtom, teamsAtom } from "../team/atoms";
import { activeWorkspaceIdAtom, workspacesAtom } from "./atoms";

/** Remote writes and reads the workspace actions perform. */
export interface WorkspaceActionApi {
  readonly createWorkspace: typeof createRemoteWorkspace;
  readonly isWorkspaceHandleAvailable: typeof checkRemoteWorkspaceHandle;
  readonly updateWorkspace: typeof updateRemoteWorkspace;
  readonly updateWorkspaceLogo: typeof updateRemoteWorkspaceLogo;
}

export const liveWorkspaceActionApi: WorkspaceActionApi = {
  createWorkspace: createRemoteWorkspace,
  isWorkspaceHandleAvailable: checkRemoteWorkspaceHandle,
  updateWorkspace: updateRemoteWorkspace,
  updateWorkspaceLogo: updateRemoteWorkspaceLogo,
};

/**
 * The health probe is the only piece of an workspace switch these actions do
 * not own: it belongs to `state/workspace`. The dashboard
 * half is read and written here, through the entity store.
 */
export interface WorkspaceActionDeps {
  readonly api?: Partial<WorkspaceActionApi> | undefined;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly handle: string;
}

export interface WorkspaceActions {
  readonly addWorkspace: (
    input: CreateWorkspaceInput,
  ) => Promise<Workspace>;
  readonly changeWorkspaceLogo: (
    workspaceId: string,
    logo: string | null,
  ) => Promise<Workspace>;
  readonly checkWorkspaceHandle: (handle: string) => Promise<boolean>;
  readonly renameWorkspace: (
    workspaceId: string,
    name: string,
  ) => Promise<Workspace>;
  readonly selectWorkspace: (workspaceId: string) => void;
}

export function createWorkspaceActions(
  registry: AtomRegistry,
  deps: WorkspaceActionDeps,
): WorkspaceActions {
  const api: WorkspaceActionApi = {
    ...liveWorkspaceActionApi,
    ...deps.api,
  };

  const replaceWorkspace = (workspace: Workspace) => {
    registry.update(workspacesAtom, (current) =>
      current.map((candidate) =>
        candidate.id === workspace.id ? workspace : candidate,
      ),
    );
  };

  return {
    async addWorkspace(input) {
      bumpReconnectRequest(registry);
      let workspace: Workspace;
      if (demoMode) {
        if (
          registry
            .get(workspacesAtom)
            .some((candidate) => candidate.handle === input.handle)
        ) {
          throw new Error("Workspace handle already exists");
        }
        workspace = {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          handle: input.handle,
          logo: null,
          role: "owner",
          createdAt: new Date().toISOString(),
        };
      } else {
        const token = registry.get(tokenAtom);
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await api.createWorkspace(token, input);
        workspace = result.workspace;
      }
      Atom.batch(() => {
        registry.update(workspacesAtom, (current) => [
          ...current,
          workspace,
        ]);
        registry.set(activeWorkspaceIdAtom, workspace.id);
        // No team is selected in a brand new workspace, so the dashboard
        // view resolves to `null` without anything having to blank it.
        registry.set(activeTeamIdAtom, null);
        registry.set(sessionErrorAtom, null);
      });
      resetHealth(registry);
      return workspace;
    },

    async changeWorkspaceLogo(workspaceId, logo) {
      const currentWorkspace = registry
        .get(workspacesAtom)
        .find((workspace) => workspace.id === workspaceId);
      if (!currentWorkspace) {
        throw new Error("변경할 워크스페이스를 찾을 수 없습니다.");
      }
      const token = registry.get(tokenAtom);
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const workspace =
        demoMode || !token
          ? { ...currentWorkspace, logo }
          : (await api.updateWorkspaceLogo(token, workspaceId, logo))
              .workspace;
      replaceWorkspace(workspace);
      return workspace;
    },

    async checkWorkspaceHandle(handle) {
      if (demoMode) {
        return !registry
          .get(workspacesAtom)
          .some((workspace) => workspace.handle === handle);
      }
      const token = registry.get(tokenAtom);
      if (!token) throw new Error("로그인이 필요합니다.");
      return api.isWorkspaceHandleAvailable(token, handle);
    },

    async renameWorkspace(workspaceId, name) {
      const currentWorkspace = registry
        .get(workspacesAtom)
        .find((workspace) => workspace.id === workspaceId);
      if (!currentWorkspace) {
        throw new Error("변경할 워크스페이스를 찾을 수 없습니다.");
      }
      const token = registry.get(tokenAtom);
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const workspace =
        demoMode || !token
          ? { ...currentWorkspace, name }
          : (await api.updateWorkspace(token, workspaceId, name))
              .workspace;
      Atom.batch(() => {
        replaceWorkspace(workspace);
        registry.update(teamsAtom, (current) =>
          current.map((team) =>
            team.workspaceId === workspaceId
              ? { ...team, workspaceName: workspace.name }
              : team,
          ),
        );
        // The stored team entities carry their own copy of the workspace
        // name, so the rendered dashboard has to be renamed with them.
        registry.update(teamsByIdAtom, (teams) => {
          let next = teams;
          for (const [teamId, team] of teams) {
            if (team.workspaceId !== workspaceId) continue;
            next = upsertManyBy(
              next,
              [{ ...team, workspaceName: workspace.name }],
              () => teamId,
            );
          }
          return next;
        });
      });
      return workspace;
    },

    selectWorkspace(workspaceId) {
      const teams = registry.get(teamsAtom);
      /*
        A project window is pinned to one team by its query string, and may only
        ever select that team's workspace. The pin is a platform fact rather
        than something the caller decides, so it is read from the atom here.
      */
      const lockedTeamId = registry.get(lockedTeamIdAtom);
      if (lockedTeamId) {
        const lockedTeam = teams.find((team) => team.id === lockedTeamId);
        if (lockedTeam?.workspaceId !== workspaceId) return;
        bumpReconnectRequest(registry);
        Atom.batch(() => {
          registry.set(activeWorkspaceIdAtom, workspaceId);
          registry.set(activeTeamIdAtom, lockedTeam.id);
          registry.set(sessionErrorAtom, null);
        });
        return;
      }
      if (
        !registry
          .get(workspacesAtom)
          .some((workspace) => workspace.id === workspaceId)
      ) {
        return;
      }
      const team =
        teams.find((candidate) => candidate.workspaceId === workspaceId) ??
        null;
      const teamId = team?.id ?? null;
      const dashboardMatchesTeam =
        registry.get(loadedTeamIdAtom) === teamId;
      if (
        registry.get(activeWorkspaceIdAtom) === workspaceId &&
        registry.get(activeTeamIdAtom) === teamId &&
        dashboardMatchesTeam
      ) {
        registry.set(sessionErrorAtom, null);
        return;
      }
      bumpReconnectRequest(registry);
      Atom.batch(() => {
        registry.set(activeWorkspaceIdAtom, workspaceId);
        registry.set(activeTeamIdAtom, teamId);
        registry.set(sessionErrorAtom, null);
      });
      if (demoMode && team) {
        applySyncEvent(registry, {
          kind: "team-snapshot",
          teamId: team.id,
          payload:
            team.id === demoDashboard.team.id
              ? demoDashboard
              : emptyDashboard(team),
        });
      } else if (!dashboardMatchesTeam) {
        // The store keeps the team's last payload across the switch, so the
        // board never blanks; it only needs the marker that forces a snapshot.
        markTeamStale(registry, teamId);
      }
      if (!dashboardMatchesTeam) resetHealth(registry);
    },
  };
}

export function useWorkspaceActions(
  deps: WorkspaceActionDeps = {},
): WorkspaceActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => createWorkspaceActions(registry, { api }),
    [api, registry],
  );
}
