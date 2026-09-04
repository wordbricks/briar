import type { AtomRegistry } from "../state/registry";
import { teamMembersAtom } from "../state/entities/members";
import { teamOrganizationProvidersAtom } from "../state/entities/providers";
import { teamRunsAtom } from "../state/entities/runs";
import { teamEntityAtom } from "../state/entities/teams";
import { teamWorkersAtom } from "../state/entities/workers";
import {
  activeTeamIdAtom,
  teamExecutionPolicyAtom,
  teamGeneratedAtAtom,
  teamNotificationsAtom,
  teamPayloadCursorAtom,
  teamSettingsAtom,
} from "../state/team/atoms";
import type { DashboardPayload } from "../types";

/*
  The wire payload a team's stored state adds up to — for assertions only.

  `state/sync/apply.ts` turns one `DashboardPayload` into a dozen atoms, and the
  cases that check it ask the obvious question back: does the store still hold
  what the server sent? Answering it field by field would be a second copy of
  the merge rules, so this puts the payload back together instead.

  Deliberately not an atom and deliberately not in `src/state`: the app reads
  the projections it draws, one subscription each, and a view that took the
  whole payload would re-render for every one of them, which is exactly what
  follow-up F2 removed when it deleted `state/sync/view.ts`. Nothing outside a
  test may use this.
*/
export function readTeamView(
  registry: AtomRegistry,
  teamId: string,
): DashboardPayload | null {
  const generatedAt = registry.get(teamGeneratedAtAtom(teamId));
  const team = registry.get(teamEntityAtom(teamId));
  const settings = registry.get(teamSettingsAtom(teamId));
  const runs = registry.get(teamRunsAtom(teamId));
  if (generatedAt === null || !team || !settings || !runs) return null;
  const notifications = registry.get(teamNotificationsAtom(teamId));
  return {
    team,
    settings,
    runs,
    workers: registry.get(teamWorkersAtom(teamId)) ?? undefined,
    organizationProviders:
      registry.get(teamOrganizationProvidersAtom(teamId)) ?? undefined,
    executionPolicy: registry.get(teamExecutionPolicyAtom(teamId)) ?? undefined,
    members: registry.get(teamMembersAtom(teamId)) ?? undefined,
    conversationNotifications: notifications.conversation ?? undefined,
    channelNotifications: notifications.channel ?? undefined,
    cursor: registry.get(teamPayloadCursorAtom(teamId)) ?? undefined,
    generatedAt,
  };
}

/** {@link readTeamView} for the team the window has selected. */
export function readActiveTeamView(
  registry: AtomRegistry,
): DashboardPayload | null {
  const teamId = registry.get(activeTeamIdAtom);
  return teamId === null ? null : readTeamView(registry, teamId);
}
