import * as Atom from "effect/unstable/reactivity/Atom";

import { demoDashboard } from "../../lib/demo-data";
import type {
  ChannelConversationNotification,
  IssueConversationNotification,
  Project,
  ProjectConnection,
  TeamAgentBoard,
  TeamExecutionWorkerPolicy,
  TeamSettings,
} from "../../types";
import { demoSelectionApplies } from "../demo-fixtures";
import { teamRunsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { shallowArrayEqual } from "../entities/upsert";
import { teamWorkersAtom } from "../entities/workers";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { demoMode, lockedTeamIdAtom } from "../platform";

/*
  Teams (`Project` in the type layer) the account can open, which one is
  selected, and the transient state of the team creation / reconnect flow.

  `activeTeamIdAtom` replaces the `activeProjectIdRef` mirror `useBriar` used to
  keep: an async callback that needs the *current* selection reads
  `registry.get(activeTeamIdAtom)` instead of a ref written during render.
*/

/** Every team the account can open, across all of its organizations. */
export const teamsAtom = Atom.make<Project[]>(
  demoMode ? [demoDashboard.team] : [],
).pipe(Atom.keepAlive, Atom.withLabel("team/list"));

/**
 * The selected team. Demo mode preselects its own, except in a project window
 * pinned to another team — see {@link demoSelectionApplies}. The session
 * bootstrap replaces it as soon as a real session is restored.
 */
export const activeTeamIdAtom = Atom.make<string | null>(
  demoSelectionApplies ? demoDashboard.team.id : null,
).pipe(Atom.keepAlive, Atom.withLabel("team/activeId"));

/**
 * The team currently being created or reconnected, together with the agent
 * token and workflow the flow collected. `null` outside the flow.
 */
export const teamConnectionAtom = Atom.make<ProjectConnection | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("team/connection"));

/** The team creation flow is open. */
export const isCreatingTeamAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("team/isCreating"),
);

/** The team whose deletion is in flight, if any. */
export const deletingTeamIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("team/deletingId"),
);

/**
 * The selected team resolved against the list. The result is an element of
 * `teamsAtom`, never a fresh object, so subscribers are notified only when the
 * selected team itself changes.
 */
export const activeTeamAtom = Atom.make((get) => {
  const activeTeamId = get(activeTeamIdAtom);
  if (!activeTeamId) return null;
  return get(teamsAtom).find((team) => team.id === activeTeamId) ?? null;
}).pipe(Atom.keepAlive, Atom.withLabel("team/active"));

/**
 * The teams this window may show at all. A project window is pinned to one, so
 * it shows that one and nothing else.
 */
export const visibleTeamsAtom = Atom.make((get): Project[] => {
  const teams = get(teamsAtom);
  const lockedTeamId = get(lockedTeamIdAtom);
  if (!lockedTeamId) return teams;
  const lockedTeam = teams.find((team) => team.id === lockedTeamId);
  return lockedTeam ? [lockedTeam] : [];
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<Project[]>(shallowArrayEqual),
  Atom.withLabel("team/visible"),
);

/**
 * The teams a view scoped to the active organization offers. The selected team
 * is always included: it stays reachable for the moment between switching
 * organizations and the team selection catching up.
 */
export const activeOrganizationTeamsAtom = Atom.make((get): Project[] => {
  if (get(lockedTeamIdAtom)) return get(visibleTeamsAtom);
  const activeOrganizationId = get(activeOrganizationIdAtom);
  const activeTeamId = get(activeTeamIdAtom);
  return get(teamsAtom).filter(
    (team) =>
      team.organizationId === activeOrganizationId || team.id === activeTeamId,
  );
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<Project[]>(shallowArrayEqual),
  Atom.withLabel("team/activeOrganization"),
);

/*
  Per-team state that is team scoped but not an entity: the settings, policy,
  notification and sync cursor projections a `DashboardPayload` carries. Each is
  an `Atom.family` keyed by team id, so switching teams changes which value the
  views read instead of tearing anything down.

  `null` means "this team's payload did not carry the field", which the
  reassembled dashboard turns back into an absent optional property. That
  distinction is load bearing: the delta merge leaves an absent projection
  untouched, and treating it as an empty list would fabricate changes.
*/

const demoTeamId = demoMode ? demoDashboard.team.id : null;

/** A team's settings, or `null` before its first payload. */
export const teamSettingsAtom = Atom.family((teamId: string) =>
  Atom.make<TeamSettings | null>(
    teamId === demoTeamId ? demoDashboard.settings : null,
  ).pipe(Atom.keepAlive, Atom.withLabel(`team/${teamId}/settings`)),
);

/** A team's execution worker policy, or `null` when the payload omitted it. */
export const teamExecutionPolicyAtom = Atom.family((teamId: string) =>
  Atom.make<TeamExecutionWorkerPolicy | null>(
    teamId === demoTeamId ? (demoDashboard.executionPolicy ?? null) : null,
  ).pipe(Atom.keepAlive, Atom.withLabel(`team/${teamId}/executionPolicy`)),
);

/**
 * The conversation and channel notification feeds a team's payload carries.
 * They live in one atom because they always arrive together; the two arrays
 * keep their own references, so a change to one does not disturb the other.
 */
export type TeamNotifications = {
  readonly conversation: IssueConversationNotification[] | null;
  readonly channel: ChannelConversationNotification[] | null;
};

const emptyTeamNotifications: TeamNotifications = {
  conversation: null,
  channel: null,
};

const sameTeamNotifications = (
  left: TeamNotifications,
  right: TeamNotifications,
) => left.conversation === right.conversation && left.channel === right.channel;

/** A team's notification feeds. */
export const teamNotificationsAtom = Atom.family((teamId: string) =>
  Atom.make<TeamNotifications>(
    teamId === demoTeamId
      ? {
          conversation: demoDashboard.conversationNotifications ?? null,
          channel: demoDashboard.channelNotifications ?? null,
        }
      : emptyTeamNotifications,
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality(sameTeamNotifications),
    Atom.withLabel(`team/${teamId}/notifications`),
  ),
);

const demoCursor = Number.isSafeInteger(demoDashboard.cursor)
  ? (demoDashboard.cursor ?? null)
  : null;

/**
 * The delta cursor `state/sync/loader.ts` resumes from. It advances on every
 * delta page, including the ones that changed nothing, which is why it is not
 * the cursor the reassembled payload reports.
 */
export const teamCursorAtom = Atom.family((teamId: string) =>
  Atom.make<number | null>(teamId === demoTeamId ? demoCursor : null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`team/${teamId}/cursor`),
  ),
);

/**
 * `generatedAt` of the payload currently rendered for the team, and `null`
 * before the team was ever loaded — half of the "does this team have a
 * dashboard" check {@link teamLoadedAtom} exposes.
 */
export const teamGeneratedAtAtom = Atom.family((teamId: string) =>
  Atom.make<string | null>(
    teamId === demoTeamId ? demoDashboard.generatedAt : null,
  ).pipe(Atom.keepAlive, Atom.withLabel(`team/${teamId}/generatedAt`)),
);

/**
 * `cursor` of the payload currently rendered. It moves with
 * {@link teamGeneratedAtAtom}, so a delta that changed no entity leaves the
 * rendered payload identical instead of producing a new object every polling
 * tick.
 */
export const teamPayloadCursorAtom = Atom.family((teamId: string) =>
  Atom.make<number | null>(teamId === demoTeamId ? demoCursor : null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`team/${teamId}/payloadCursor`),
  ),
);

/** The team has a payload on hand, so switching to it renders immediately. */
export const teamLoadedAtom = Atom.family((teamId: string) =>
  Atom.make(
    (get) =>
      get(teamGeneratedAtAtom(teamId)) !== null &&
      get(teamSettingsAtom(teamId)) !== null,
  ).pipe(Atom.keepAlive, Atom.withLabel(`team/${teamId}/loaded`)),
);

/**
 * The team whose payload is the one on screen, or `null` when none is.
 *
 * An action that writes a team's projections asks this first: a write aimed at
 * a team the window is not showing would install itself under a cursor nobody
 * is following, so it is dropped instead.
 */
export const loadedTeamIdAtom = Atom.make((get): string | null => {
  const teamId = get(activeTeamIdAtom);
  return teamId !== null && get(teamLoadedAtom(teamId)) ? teamId : null;
}).pipe(Atom.keepAlive, Atom.withLabel("team/loadedId"));

/**
 * A team's settings while that team is the one on screen, and `null` otherwise
 * — the `dashboard && dashboard.team.id === teamId ? dashboard.settings : null`
 * check every settings write used to open with.
 */
export const renderedTeamSettingsAtom = Atom.family((teamId: string) =>
  Atom.make((get): TeamSettings | null =>
    get(loadedTeamIdAtom) === teamId ? get(teamSettingsAtom(teamId)) : null,
  ).pipe(Atom.withLabel(`team/${teamId}/renderedSettings`)),
);

/**
 * The server has answered for this team since the app started: a `team-snapshot`
 * or a `team-delta` that `state/sync/apply.ts` actually applied.
 *
 * Hydration deliberately does not set it. A record read from disk is enough to
 * *render* the last screen, but it carries no authority — the work it describes
 * may have moved on while the app was closed. So an effect that would **act** on
 * a team's stored state rather than display it waits here until the server has
 * confirmed that state, and `false` on a hydrated boot means exactly "this is
 * still the disk's copy".
 */
export const teamSyncedSinceBootAtom = Atom.family((teamId: string) =>
  Atom.make(false).pipe(
    Atom.keepAlive,
    Atom.withLabel(`team/${teamId}/syncedSinceBoot`),
  ),
);

const sameAgentBoard = (
  left: TeamAgentBoard | null,
  right: TeamAgentBoard | null,
) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.team === right.team &&
    left.runs === right.runs &&
    left.workers === right.workers &&
    left.executionPolicy === right.executionPolicy);

/**
 * The four projections the Agents page runs on, or `null` before the team has
 * a payload.
 *
 * It is one atom rather than four props because all four are handed to the
 * same three components and every one of them needs the set: a dispatch picks
 * runs, checks them against the workers and the policy, and reports in the
 * team's own issue key. The equality below is over the four references the
 * store holds, so a projection the page does not read cannot wake it.
 */
export const teamAgentBoardAtom = Atom.family((teamId: string) =>
  Atom.make((get): TeamAgentBoard | null => {
    const team = get(teamEntityAtom(teamId));
    const runs = get(teamRunsAtom(teamId));
    if (!team || !runs) return null;
    return {
      team,
      runs,
      workers: get(teamWorkersAtom(teamId)) ?? undefined,
      executionPolicy: get(teamExecutionPolicyAtom(teamId)) ?? undefined,
    };
  }).pipe(
    Atom.withEquality(sameAgentBoard),
    Atom.withLabel(`team/${teamId}/agentBoard`),
  ),
);

/**
 * The team whose stored payload is on screen waiting to be replaced by fresh
 * data, or `null`. It forces the next fetch for that team to be a snapshot
 * rather than a delta from a possibly ancient cursor.
 */
export const staleTeamIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("team/staleId"),
);

/** A previously loaded team's payload is on screen, waiting for fresh data. */
export const dashboardStaleAtom = Atom.map(
  staleTeamIdAtom,
  (teamId) => teamId !== null,
).pipe(Atom.keepAlive, Atom.withLabel("team/dashboardStale"));
