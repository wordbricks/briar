import type { Organization, Project } from "../types";

/*
  What a team window is allowed to show.

  A team window is pinned to one team, so every list the shell hands a view has
  to be narrowed to that team and the organization it belongs to — otherwise the
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

/** Organizations the window may switch between, narrowed the same way. */
export function visibleOrganizations(
  organizations: Organization[],
  teams: Project[],
  lockedTeamId: string | null,
): Organization[] {
  if (!lockedTeamId) return organizations;
  const organizationId = lockedTeam(teams, lockedTeamId)?.organizationId;
  if (!organizationId) return [];
  return organizations.filter(
    (organization) => organization.id === organizationId,
  );
}

/**
 * Teams of the selected organization, plus the selected team even when the
 * organization switch has not reached it yet — which is what keeps the issue
 * board from blanking for a frame during an organization change.
 */
export function activeOrganizationTeams(
  teams: Project[],
  lockedTeamId: string | null,
  activeOrganizationId: string | null,
  activeTeamId: string | null,
): Project[] {
  if (lockedTeamId) return visibleTeams(teams, lockedTeamId);
  return teams.filter(
    (team) =>
      team.organizationId === activeOrganizationId || team.id === activeTeamId,
  );
}
