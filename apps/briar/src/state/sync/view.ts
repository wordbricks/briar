import * as Atom from "effect/unstable/reactivity/Atom";

import type { DashboardPayload } from "../../types";
import { teamMembersAtom } from "../entities/members";
import { teamOrganizationProvidersAtom } from "../entities/providers";
import { teamRunsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { teamWorkersAtom } from "../entities/workers";
import {
  activeTeamIdAtom,
  teamExecutionPolicyAtom,
  teamGeneratedAtAtom,
  teamNotificationsAtom,
  teamPayloadCursorAtom,
  teamSettingsAtom,
} from "../team/atoms";

/*
  The wire shape, reassembled from the normalized store.

  A dozen views still take a whole `DashboardPayload`, so this rebuilds one that
  looks exactly like what the server sent — including which optional projections
  were absent. Each part comes straight from the atom that owns it, so a part
  that did not change keeps its reference and the equality below keeps the whole
  object identical: a run edit notifies the run's subscribers, and a view holding
  the payload sees the same object it had.
*/

const sameDashboardView = (
  left: DashboardPayload | null,
  right: DashboardPayload | null,
) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.team === right.team &&
    left.settings === right.settings &&
    left.runs === right.runs &&
    left.workers === right.workers &&
    left.organizationProviders === right.organizationProviders &&
    left.executionPolicy === right.executionPolicy &&
    left.members === right.members &&
    left.conversationNotifications === right.conversationNotifications &&
    left.channelNotifications === right.channelNotifications &&
    left.cursor === right.cursor &&
    left.generatedAt === right.generatedAt);

/**
 * One team's dashboard payload rebuilt from the store, or `null` when the team
 * has never been loaded.
 */
export const dashboardViewAtom = Atom.family((teamId: string) =>
  Atom.make((get): DashboardPayload | null => {
    const generatedAt = get(teamGeneratedAtAtom(teamId));
    const team = get(teamEntityAtom(teamId));
    const settings = get(teamSettingsAtom(teamId));
    const runs = get(teamRunsAtom(teamId));
    if (generatedAt === null || !team || !settings || !runs) return null;
    const workers = get(teamWorkersAtom(teamId));
    const organizationProviders = get(teamOrganizationProvidersAtom(teamId));
    const executionPolicy = get(teamExecutionPolicyAtom(teamId));
    const members = get(teamMembersAtom(teamId));
    const notifications = get(teamNotificationsAtom(teamId));
    const cursor = get(teamPayloadCursorAtom(teamId));
    return {
      team,
      settings,
      runs,
      workers: workers ?? undefined,
      organizationProviders: organizationProviders ?? undefined,
      executionPolicy: executionPolicy ?? undefined,
      members: members ?? undefined,
      conversationNotifications: notifications.conversation ?? undefined,
      channelNotifications: notifications.channel ?? undefined,
      cursor: cursor ?? undefined,
      generatedAt,
    };
  }).pipe(
    Atom.withEquality(sameDashboardView),
    Atom.withLabel(`sync/dashboard/${teamId}`),
  ),
);

/** The selected team's dashboard payload, or `null` when there is none. */
export const activeDashboardAtom = Atom.make((get): DashboardPayload | null => {
  const teamId = get(activeTeamIdAtom);
  return teamId === null ? null : get(dashboardViewAtom(teamId));
}).pipe(Atom.keepAlive, Atom.withLabel("sync/activeDashboard"));
