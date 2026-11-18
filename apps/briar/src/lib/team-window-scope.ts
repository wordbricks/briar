import type { Workspace, Project } from "../types";

/*
  What a team window is allowed to show.

  A team window is pinned to one team, so every list the shell hands a view has
  to be narrowed to that team and the workspace it belongs to — otherwise the
  window offers navigation to teams it cannot open. The main window has no lock
  and sees everything.
*/

/** The pinned team itself, or `null` in the main window and for an unknown id. */
export function lockedTeam(
  teams: Project[],
  lockedTeamId: string | null,
): Project | null {
  if (!lockedTeamId) return null;
  return teams.find((team) => team.id === lockedTeamId) ?? null;
}

/** Teams the window may switch between: all of them, or only the pinned one. */
export function visibleTeams(
  teams: Project[],
  lockedTeamId: string | null,
): Project[] {
  if (!lockedTeamId) return teams;
  const team = lockedTeam(teams, lockedTeamId);
  return team ? [team] : [];
}

/** Workspaces the window may switch between, narrowed the same way. */
export function visibleWorkspaces(
  workspaces: Workspace[],
  teams: Project[],
  lockedTeamId: string | null,
): Workspace[] {
  if (!lockedTeamId) return workspaces;
  const workspaceId = lockedTeam(teams, lockedTeamId)?.workspaceId;
  if (!workspaceId) return [];
  return workspaces.filter(
    (workspace) => workspace.id === workspaceId,
  );
}

/**
 * Teams of the selected workspace, plus the selected team even when the
 * workspace switch has not reached it yet — which is what keeps the issue
 * board from blanking for a frame during a workspace change.
 */
export function activeWorkspaceTeams(
  teams: Project[],
  lockedTeamId: string | null,
  activeWorkspaceId: string | null,
  activeTeamId: string | null,
): Project[] {
  if (lockedTeamId) return visibleTeams(teams, lockedTeamId);
  return teams.filter(
    (team) =>
      team.workspaceId === activeWorkspaceId || team.id === activeTeamId,
  );
}
