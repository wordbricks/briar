import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

import type { AgentProvider } from "../../lib/agent-provider";
import type { ChannelSummary } from "../../lib/channels-contract";
import type {
  ChannelConversationNotification,
  ExecutionWorker,
  HuntRun,
  IssueConversationNotification,
  Organization,
  OrganizationMember,
  Project,
  SessionUser,
  Team,
  TeamExecutionWorkerPolicy,
  TeamSettings,
} from "../../types";
import {
  channelCatalogOrganizationIdsAtom,
  channelsByIdAtom,
  organizationChannelIdsAtom,
} from "../entities/channels";
import { membersByIdAtom, teamMemberIdsAtom } from "../entities/members";
import { teamOrganizationProvidersAtom } from "../entities/providers";
import {
  retainedTeamIdsAtom,
  TEAM_RETENTION_LIMIT,
} from "../entities/retention";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamsByIdAtom } from "../entities/teams";
import { teamWorkerIdsAtom, workersByIdAtom } from "../entities/workers";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import type { AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import {
  activeTeamIdAtom,
  teamCursorAtom,
  teamExecutionPolicyAtom,
  teamGeneratedAtAtom,
  teamNotificationsAtom,
  teamPayloadCursorAtom,
  teamSettingsAtom,
  teamsAtom,
} from "../team/atoms";

/*
  What a cold start may render before the network answers.

  The store is normalized and the views read it through per-team families, so a
  snapshot is that store written out: the entity maps, the per-team projections
  those families hold, the organization's channel index, and the account they
  belong to. Nothing else — the snapshot exists to put the last screen back on
  the display, not to be a second source of truth.

  It is written from the atoms and read back into them one by one, so it never
  passes through a payload: `collectSnapshot` reads each family and
  `applySnapshot` writes the same ones `applySyncEvent` would. The serialized
  shape is therefore the store's, not the wire's, and did not change when the
  reassembled `DashboardPayload` view was removed.

  Deliberately absent, and it has to stay that way:

  - the session token and the device-authorization code. The credential lives in
    the OS keychain (or the browser's own session) and a copy of it in an
    IndexedDB record readable by any script on the origin would be a downgrade.
    A hydrated screen is unauthenticated until the bootstrap restores the token;
    nothing fetches until it does.
  - `restoringSession` / `loading` / the pending mutation flags — in-flight
    state belongs to the run that produced it.
  - run detail (messages, evidence, events) — unbounded, and every view that
    shows it fetches on open anyway.
  - `state/dialogs` and `state/navigation` — a dialog or a location restored
    from a previous run is a surprise, not a head start. Navigation has no local
    persistence today and this does not add one.
  - workspace readiness and health — facts about *this* machine's checkouts,
    re-inspected on every boot by the session bootstrap.
*/

/** Bumped whenever a stored snapshot can no longer be read into the store. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** One team's slice of the store: the projections its views read, by team. */
export interface PersistedTeamState {
  readonly teamId: string;
  readonly settings: TeamSettings | null;
  readonly executionPolicy: TeamExecutionWorkerPolicy | null;
  readonly notifications: {
    readonly conversation: readonly IssueConversationNotification[] | null;
    readonly channel: readonly ChannelConversationNotification[] | null;
  };
  readonly organizationProviders: readonly AgentProvider[] | null;
  /** The resume cursor `state/sync/loader.ts` catches up from. */
  readonly cursor: number | null;
  /** The cursor of the payload that is on screen. */
  readonly payloadCursor: number | null;
  readonly generatedAt: string | null;
  readonly runIds: readonly string[] | null;
  readonly workerIds: readonly string[] | null;
  readonly memberIds: readonly string[] | null;
}

/** An organization's channel list in render order. */
export interface PersistedChannelIndex {
  readonly organizationId: string;
  readonly channelIds: readonly string[];
}

/**
 * Everything one account's work in one organization needs to render again. Keyed
 * by `${userId}:${organizationId}`, so switching either one reads a different
 * record rather than merging two accounts' work.
 */
export interface ClientSnapshot {
  readonly schemaVersion: number;
  readonly userId: string;
  readonly organizationId: string;
  readonly savedAt: string;
  readonly session: {
    readonly user: SessionUser;
    readonly organizations: readonly Organization[];
    /**
     * The teams the account can open. The shell resolves the selected team
     * against this list, so a snapshot without it would render an empty app.
     */
    readonly teams: readonly Project[];
    readonly activeOrganizationId: string | null;
    readonly activeTeamId: string | null;
  };
  readonly entities: {
    readonly runs: readonly HuntRun[];
    /**
     * Dashboard team projections, paired with the id they are stored under:
     * `state/sync/apply.ts` keys them by the event's team rather than by
     * `payload.team.id`, and the snapshot keeps that distinction.
     */
    readonly teams: readonly { readonly teamId: string; readonly team: Team }[];
    readonly workers: readonly ExecutionWorker[];
    readonly members: readonly OrganizationMember[];
    readonly channels: readonly ChannelSummary[];
  };
  readonly teamState: readonly PersistedTeamState[];
  readonly channelIndex: readonly PersistedChannelIndex[];
}

/*
  Validation.

  The envelope is checked field by field, because a wrong shape there is what
  would let a corrupted record write nonsense into the store. The entities
  inside are checked for the key the store indexes them by and nothing else:
  they are the server's own DTOs, which the API layer does not validate either,
  so a stricter schema here would be a second copy of the wire contract free to
  drift from it. `Schema.Record` keeps every property, unlike a `Struct`, so
  what comes back out is the entity the server sent.
*/

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

/** An entity object that carries a non-empty string under `key`. */
const identified = (key: string) =>
  UnknownRecord.check(
    Schema.makeFilter((value) =>
      typeof value[key] === "string" && value[key] !== ""
        ? undefined
        : `expected a non-empty string \`${key}\``,
    ),
  );

const ClientSnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(SNAPSHOT_SCHEMA_VERSION),
  userId: Schema.String,
  organizationId: Schema.String,
  savedAt: Schema.String,
  session: Schema.Struct({
    user: identified("id"),
    organizations: Schema.Array(identified("id")),
    teams: Schema.Array(identified("id")),
    activeOrganizationId: Schema.NullOr(Schema.String),
    activeTeamId: Schema.NullOr(Schema.String),
  }),
  entities: Schema.Struct({
    runs: Schema.Array(identified("id")),
    teams: Schema.Array(
      Schema.Struct({ teamId: Schema.String, team: identified("id") }),
    ),
    workers: Schema.Array(identified("id")),
    members: Schema.Array(identified("userId")),
    channels: Schema.Array(identified("id")),
  }),
  teamState: Schema.Array(
    Schema.Struct({
      teamId: Schema.String,
      settings: Schema.NullOr(UnknownRecord),
      executionPolicy: Schema.NullOr(UnknownRecord),
      notifications: Schema.Struct({
        conversation: Schema.NullOr(Schema.Array(UnknownRecord)),
        channel: Schema.NullOr(Schema.Array(UnknownRecord)),
      }),
      organizationProviders: Schema.NullOr(Schema.Array(Schema.String)),
      cursor: Schema.NullOr(Schema.Finite),
      payloadCursor: Schema.NullOr(Schema.Finite),
      generatedAt: Schema.NullOr(Schema.String),
      runIds: Schema.NullOr(Schema.Array(Schema.String)),
      workerIds: Schema.NullOr(Schema.Array(Schema.String)),
      memberIds: Schema.NullOr(Schema.Array(Schema.String)),
    }),
  ),
  channelIndex: Schema.Array(
    Schema.Struct({
      organizationId: Schema.String,
      channelIds: Schema.Array(Schema.String),
    }),
  ),
});

const decodeSnapshot = Schema.decodeUnknownSync(ClientSnapshotSchema);

/** The stored form. JSON rather than a structured clone: one shape to reason about. */
export function serializeSnapshot(snapshot: ClientSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Reads a stored record back, or `null` when it is not one. Every failure —
 * malformed JSON, a schema the version no longer matches, a truncated write —
 * lands here and means the same thing: boot without a snapshot.
 */
export function deserializeSnapshot(stored: unknown): ClientSnapshot | null {
  try {
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    return decodeSnapshot(parsed) as unknown as ClientSnapshot;
  } catch {
    return null;
  }
}

/** Resolves ids against an entity map, skipping the ones it no longer holds. */
function resolveAll<T>(
  map: ReadonlyMap<string, T>,
  ids: Iterable<string>,
): T[] {
  const resolved: T[] = [];
  for (const id of ids) {
    const entity = map.get(id);
    if (entity) resolved.push(entity);
  }
  return resolved;
}

/**
 * The store as it stands, or `null` when there is nothing worth writing — no
 * account, or no organization to key the record by.
 *
 * Only teams of the active organization are collected: the record is keyed by
 * that organization, and `state/sync/apply.ts` drops the others from memory the
 * moment the account switches away.
 */
export function collectSnapshot(registry: AtomRegistry): ClientSnapshot | null {
  const user = registry.get(userAtom);
  const organizationId = registry.get(activeOrganizationIdAtom);
  if (!user || !organizationId) return null;

  const teams = registry.get(teamsAtom);
  const organizationTeamIds = new Set(
    teams
      .filter((team) => team.organizationId === organizationId)
      .map((team) => team.id),
  );
  /*
    The most recently synced teams, never more than the retention limit. The
    retained list can hold more while a view has pinned teams across it ("내
    이슈" reads every team of the organization), and those extra boards are a
    live memory decision, not one to write to disk on every debounce.
  */
  const teamIds = registry
    .get(retainedTeamIdsAtom)
    .filter((teamId) => organizationTeamIds.has(teamId))
    .slice(-TEAM_RETENTION_LIMIT);

  const runIds = new Set<string>();
  const workerIds = new Set<string>();
  const memberIds = new Set<string>();
  const teamState: PersistedTeamState[] = [];
  const teamProjections: { teamId: string; team: Team }[] = [];

  for (const teamId of teamIds) {
    const teamRunIds = registry.get(teamRunIdsAtom(teamId));
    const teamWorkerIds = registry.get(teamWorkerIdsAtom(teamId));
    const teamMemberIds = registry.get(teamMemberIdsAtom(teamId));
    for (const id of teamRunIds ?? []) runIds.add(id);
    for (const id of teamWorkerIds ?? []) workerIds.add(id);
    for (const id of teamMemberIds ?? []) memberIds.add(id);
    const notifications = registry.get(teamNotificationsAtom(teamId));
    teamState.push({
      teamId,
      settings: registry.get(teamSettingsAtom(teamId)),
      executionPolicy: registry.get(teamExecutionPolicyAtom(teamId)),
      notifications: {
        conversation: notifications.conversation,
        channel: notifications.channel,
      },
      organizationProviders: registry.get(
        teamOrganizationProvidersAtom(teamId),
      ),
      cursor: registry.get(teamCursorAtom(teamId)),
      payloadCursor: registry.get(teamPayloadCursorAtom(teamId)),
      generatedAt: registry.get(teamGeneratedAtAtom(teamId)),
      runIds: teamRunIds,
      workerIds: teamWorkerIds,
      memberIds: teamMemberIds,
    });
    const team = registry.get(teamsByIdAtom).get(teamId);
    if (team) teamProjections.push({ teamId, team });
  }

  const channelIds =
    registry.get(organizationChannelIdsAtom(organizationId)) ?? null;
  const channelIndex: PersistedChannelIndex[] = channelIds
    ? [{ organizationId, channelIds }]
    : [];

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    userId: user.id,
    organizationId,
    savedAt: new Date().toISOString(),
    session: {
      user,
      organizations: registry.get(organizationsAtom),
      teams,
      activeOrganizationId: organizationId,
      activeTeamId: registry.get(activeTeamIdAtom),
    },
    entities: {
      runs: resolveAll(registry.get(runsByIdAtom), runIds),
      teams: teamProjections,
      workers: resolveAll(registry.get(workersByIdAtom), workerIds),
      members: resolveAll(registry.get(membersByIdAtom), memberIds),
      channels: resolveAll(registry.get(channelsByIdAtom), channelIds ?? []),
    },
    teamState,
    channelIndex,
  };
}

const mapOf = <T>(entities: readonly T[], identify: (entity: T) => string) =>
  new Map(entities.map((entity) => [identify(entity), entity] as const));

/**
 * Writes a snapshot into the store. Called inside the caller's `Atom.batch`, so
 * the whole account — entities, per-team state, channels and the session —
 * arrives as one notification and no subscriber sees half an app.
 *
 * It writes the same atoms `applySyncEvent` would, which is what lets the
 * bootstrap's own results replace them without any special case.
 */
export function applySnapshot(
  registry: AtomRegistry,
  snapshot: ClientSnapshot,
): void {
  Atom.batch(() => {
    registry.set(runsByIdAtom, mapOf(snapshot.entities.runs, (run) => run.id));
    registry.set(
      workersByIdAtom,
      mapOf(snapshot.entities.workers, (worker) => worker.id),
    );
    registry.set(
      membersByIdAtom,
      mapOf(snapshot.entities.members, (member) => member.userId),
    );
    registry.set(
      teamsByIdAtom,
      new Map(
        snapshot.entities.teams.map((entry) => [entry.teamId, entry.team]),
      ),
    );
    registry.set(
      channelsByIdAtom,
      mapOf(snapshot.entities.channels, (channel) => channel.id),
    );

    for (const team of snapshot.teamState) {
      registry.set(teamSettingsAtom(team.teamId), team.settings);
      registry.set(teamExecutionPolicyAtom(team.teamId), team.executionPolicy);
      registry.set(teamNotificationsAtom(team.teamId), {
        conversation: team.notifications.conversation
          ? [...team.notifications.conversation]
          : null,
        channel: team.notifications.channel
          ? [...team.notifications.channel]
          : null,
      });
      registry.set(
        teamOrganizationProvidersAtom(team.teamId),
        team.organizationProviders ? [...team.organizationProviders] : null,
      );
      registry.set(teamCursorAtom(team.teamId), team.cursor);
      registry.set(teamPayloadCursorAtom(team.teamId), team.payloadCursor);
      registry.set(teamGeneratedAtAtom(team.teamId), team.generatedAt);
      registry.set(
        teamRunIdsAtom(team.teamId),
        team.runIds ? [...team.runIds] : null,
      );
      registry.set(
        teamWorkerIdsAtom(team.teamId),
        team.workerIds ? [...team.workerIds] : null,
      );
      registry.set(
        teamMemberIdsAtom(team.teamId),
        team.memberIds ? [...team.memberIds] : null,
      );
    }
    registry.set(
      retainedTeamIdsAtom,
      snapshot.teamState.map((team) => team.teamId),
    );

    for (const index of snapshot.channelIndex) {
      registry.set(organizationChannelIdsAtom(index.organizationId), [
        ...index.channelIds,
      ]);
    }
    registry.set(
      channelCatalogOrganizationIdsAtom,
      snapshot.channelIndex.map((index) => index.organizationId),
    );

    registry.set(userAtom, snapshot.session.user);
    registry.set(organizationsAtom, [...snapshot.session.organizations]);
    registry.set(teamsAtom, [...snapshot.session.teams]);
    registry.set(
      activeOrganizationIdAtom,
      snapshot.session.activeOrganizationId,
    );
    registry.set(activeTeamIdAtom, snapshot.session.activeTeamId);
  });
}
