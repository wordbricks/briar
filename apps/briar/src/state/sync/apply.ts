import * as Atom from "effect/unstable/reactivity/Atom";

import type {
  DashboardDeltaPayload,
  DashboardPayload,
  ExecutionWorker,
  HuntRun,
  OrganizationMember,
} from "../../types";
import {
  channelCatalogOrganizationIdsAtom,
  channelsByIdAtom,
  organizationChannelIdsAtom,
  organizationChannelsAtom,
} from "../entities/channels";
import type { ChannelSummary } from "../../lib/channels-contract";
import {
  membersByIdAtom,
  teamMemberIdsAtom,
  teamMembersAtom,
} from "../entities/members";
import { teamOrganizationProvidersAtom } from "../entities/providers";
import { retainedTeamIdsAtom, touchRetainedTeam } from "../entities/retention";
import { runsByIdAtom, teamRunIdsAtom, teamRunsAtom } from "../entities/runs";
import { teamEntityAtom, teamsByIdAtom } from "../entities/teams";
import {
  mergeTeamRuns,
  removeMany,
  replaceEntities,
  sameValue,
  upsertMany,
  upsertManyBy,
} from "../entities/upsert";
import {
  teamWorkerIdsAtom,
  teamWorkersAtom,
  workersByIdAtom,
} from "../entities/workers";
import type { AtomRegistry } from "../registry";
import {
  activeTeamIdAtom,
  staleTeamIdAtom,
  teamCursorAtom,
  teamExecutionPolicyAtom,
  teamGeneratedAtAtom,
  teamLoadedAtom,
  teamNotificationsAtom,
  teamPayloadCursorAtom,
  teamSettingsAtom,
  teamSyncedSinceBootAtom,
} from "../team/atoms";
import type { SyncEvent } from "./events";
import { dashboardViewAtom } from "./view";

/*
  The one place server payloads become client state.

  Snapshot loads, cursor deltas, realtime events and confirmed writes all arrive
  as a `SyncEvent` and leave as writes to the entity maps and the per-team
  families. Every event is applied inside a single `Atom.batch`, so a subscriber
  is notified once no matter how many atoms the event touched.

  The merge rules are the ones the payload-level dashboard merge applied to a whole
  `DashboardPayload`, kept intact: an unchanged projection keeps its reference,
  and a delta that moves nothing leaves even the rendered `cursor` and
  `generatedAt` alone. That is what makes a quiet polling tick free.
*/

type TeamIndexAtom = (teamId: string) => Atom.Writable<string[] | null>;

/**
 * Removes `droppedIds` from a shared entity map unless another retained team
 * still lists them. Members in particular are organization scoped and appear in
 * every team of that organization.
 */
function releaseSharedIds<T>(
  registry: AtomRegistry,
  mapAtom: Atom.Writable<ReadonlyMap<string, T>>,
  indexAtom: TeamIndexAtom,
  teamId: string,
  droppedIds: readonly string[],
) {
  if (droppedIds.length === 0) return;
  const referenced = new Set<string>();
  for (const other of registry.get(retainedTeamIdsAtom)) {
    if (other === teamId) continue;
    for (const id of registry.get(indexAtom(other)) ?? []) referenced.add(id);
  }
  const removable = droppedIds.filter((id) => !referenced.has(id));
  if (removable.length === 0) return;
  registry.update(mapAtom, (map) => removeMany(map, removable));
}

/**
 * Replaces one team's slice of a shared entity map and its id index. `null`
 * clears the index, which is how an omitted payload projection is stored.
 */
function writeTeamSlice<T>(
  registry: AtomRegistry,
  mapAtom: Atom.Writable<ReadonlyMap<string, T>>,
  indexAtom: TeamIndexAtom,
  teamId: string,
  entities: readonly T[] | null,
  identify: (entity: T) => string,
) {
  const previousIds = registry.get(indexAtom(teamId)) ?? [];
  if (entities === null) {
    registry.set(indexAtom(teamId), null);
    releaseSharedIds(registry, mapAtom, indexAtom, teamId, previousIds);
    return;
  }
  const nextIds = entities.map(identify);
  registry.update(mapAtom, (map) => upsertManyBy(map, entities, identify));
  registry.set(indexAtom(teamId), nextIds);
  const kept = new Set(nextIds);
  releaseSharedIds(
    registry,
    mapAtom,
    indexAtom,
    teamId,
    previousIds.filter((id) => !kept.has(id)),
  );
}

const writeTeamRuns = (
  registry: AtomRegistry,
  teamId: string,
  runs: readonly HuntRun[] | null,
) =>
  writeTeamSlice(registry, runsByIdAtom, teamRunIdsAtom, teamId, runs, (run) => run.id);

const writeTeamWorkers = (
  registry: AtomRegistry,
  teamId: string,
  workers: readonly ExecutionWorker[] | null,
) =>
  writeTeamSlice(
    registry,
    workersByIdAtom,
    teamWorkerIdsAtom,
    teamId,
    workers,
    (worker) => worker.id,
  );

const writeTeamMembers = (
  registry: AtomRegistry,
  teamId: string,
  members: readonly OrganizationMember[] | null,
) =>
  writeTeamSlice(
    registry,
    membersByIdAtom,
    teamMemberIdsAtom,
    teamId,
    members,
    (member) => member.userId,
  );

/** The cursor the loader may resume a delta from. */
const syncCursorOf = (cursor: number | undefined) =>
  Number.isSafeInteger(cursor) ? (cursor ?? null) : null;

/**
 * Marks `teamId` as the most recently synced team and drops whatever that
 * pushes past the retention limit. The active team is never evicted: unlike the
 * payload cache it replaces, dropping it would blank the screen.
 */
function touchTeam(registry: AtomRegistry, teamId: string) {
  const current = registry.get(retainedTeamIdsAtom);
  const { retained, evicted } = touchRetainedTeam(current, teamId);
  if (retained === current && evicted.length === 0) return;
  const activeTeamId = registry.get(activeTeamIdAtom);
  const dropped = evicted.filter((candidate) => candidate !== activeTeamId);
  registry.set(
    retainedTeamIdsAtom,
    dropped.length === evicted.length || activeTeamId === null
      ? retained
      : [activeTeamId, ...retained],
  );
  for (const candidate of dropped) clearTeamState(registry, candidate);
}

/**
 * Records that the server has answered for this team in this session, which is
 * what separates a payload from the copy hydration read off the disk. The
 * registry drops a write of the value it already holds, so the deltas of a quiet
 * polling tick still notify nobody.
 */
const markTeamSynced = (registry: AtomRegistry, teamId: string) =>
  registry.set(teamSyncedSinceBootAtom(teamId), true);

/** Drops everything the store knows about one team. */
function clearTeamState(registry: AtomRegistry, teamId: string) {
  writeTeamRuns(registry, teamId, null);
  writeTeamWorkers(registry, teamId, null);
  writeTeamMembers(registry, teamId, null);
  registry.update(teamsByIdAtom, (teams) => removeMany(teams, [teamId]));
  registry.set(teamSettingsAtom(teamId), null);
  registry.set(teamExecutionPolicyAtom(teamId), null);
  registry.set(teamOrganizationProvidersAtom(teamId), null);
  registry.set(teamNotificationsAtom(teamId), {
    conversation: null,
    channel: null,
  });
  registry.set(teamCursorAtom(teamId), null);
  registry.set(teamPayloadCursorAtom(teamId), null);
  registry.set(teamGeneratedAtAtom(teamId), null);
  // Nothing of the server's answer is left, so the next payload for this team is
  // its first again.
  registry.set(teamSyncedSinceBootAtom(teamId), false);
  registry.update(retainedTeamIdsAtom, (retained) =>
    retained.includes(teamId)
      ? retained.filter((candidate) => candidate !== teamId)
      : retained,
  );
  if (registry.get(staleTeamIdAtom) === teamId) {
    registry.set(staleTeamIdAtom, null);
  }
}

/** Unpacks a full payload. Run order is the server's, verbatim and uncapped. */
function applyTeamSnapshot(
  registry: AtomRegistry,
  teamId: string,
  payload: DashboardPayload,
) {
  // Keyed by the event's team rather than `payload.team.id` so a mislabelled
  // payload can never hide a team's dashboard behind an id nothing looks up.
  registry.update(teamsByIdAtom, (teams) =>
    upsertManyBy(teams, [payload.team], () => teamId),
  );
  registry.set(teamSettingsAtom(teamId), payload.settings);
  writeTeamRuns(registry, teamId, payload.runs);
  writeTeamWorkers(registry, teamId, payload.workers ?? null);
  writeTeamMembers(registry, teamId, payload.members ?? null);
  registry.set(
    teamOrganizationProvidersAtom(teamId),
    payload.organizationProviders ?? null,
  );
  registry.set(teamExecutionPolicyAtom(teamId), payload.executionPolicy ?? null);
  registry.set(teamNotificationsAtom(teamId), {
    conversation: payload.conversationNotifications ?? null,
    channel: payload.channelNotifications ?? null,
  });
  registry.set(teamCursorAtom(teamId), syncCursorOf(payload.cursor));
  registry.set(teamPayloadCursorAtom(teamId), payload.cursor ?? null);
  registry.set(teamGeneratedAtAtom(teamId), payload.generatedAt);
  markTeamSynced(registry, teamId);
  touchTeam(registry, teamId);
}

/**
 * Applies one cursor page onto the team's stored payload. A delta needs a base,
 * so a team that was never loaded ignores it and lets the loader ask for a
 * snapshot instead.
 */
function applyTeamDelta(
  registry: AtomRegistry,
  teamId: string,
  delta: DashboardDeltaPayload,
) {
  if (!registry.get(teamLoadedAtom(teamId))) return;

  const currentRuns = registry.get(teamRunsAtom(teamId)) ?? [];
  const runs = mergeTeamRuns(currentRuns, delta.runs, delta.deletedRunIds);

  const currentWorkers = registry.get(teamWorkersAtom(teamId));
  const workers = sameValue(currentWorkers ?? [], delta.workers)
    ? currentWorkers
    : replaceEntities(currentWorkers ?? [], delta.workers);

  const currentProviders = registry.get(teamOrganizationProvidersAtom(teamId));
  const organizationProviders = sameValue(
    currentProviders ?? [],
    delta.organizationProviders,
  )
    ? currentProviders
    : delta.organizationProviders;

  const currentTeam = registry.get(teamEntityAtom(teamId));
  const team =
    delta.team && !sameValue(currentTeam, delta.team) ? delta.team : currentTeam;

  const currentSettings = registry.get(teamSettingsAtom(teamId));
  const settings =
    delta.settings && !sameValue(currentSettings, delta.settings)
      ? delta.settings
      : currentSettings;

  const currentPolicy = registry.get(teamExecutionPolicyAtom(teamId));
  const executionPolicy =
    delta.executionPolicy === undefined ||
    sameValue(currentPolicy ?? undefined, delta.executionPolicy)
      ? currentPolicy
      : delta.executionPolicy;

  const currentMembers = registry.get(teamMembersAtom(teamId));
  const members =
    delta.members === undefined || sameValue(currentMembers ?? [], delta.members)
      ? currentMembers
      : delta.members;

  const currentNotifications = registry.get(teamNotificationsAtom(teamId));
  const conversation =
    delta.conversationNotifications === undefined
      ? currentNotifications.conversation
      : replaceEntities(
          currentNotifications.conversation ?? [],
          delta.conversationNotifications,
        );
  const channel =
    delta.channelNotifications === undefined
      ? currentNotifications.channel
      : replaceEntities(
          currentNotifications.channel ?? [],
          delta.channelNotifications,
        );

  if (runs !== currentRuns) writeTeamRuns(registry, teamId, runs);
  if (workers !== currentWorkers) writeTeamWorkers(registry, teamId, workers);
  if (members !== currentMembers) writeTeamMembers(registry, teamId, members);
  if (organizationProviders !== currentProviders) {
    registry.set(teamOrganizationProvidersAtom(teamId), organizationProviders);
  }
  if (team !== currentTeam && team) {
    registry.update(teamsByIdAtom, (teams) =>
      upsertManyBy(teams, [team], () => teamId),
    );
  }
  if (settings !== currentSettings) {
    registry.set(teamSettingsAtom(teamId), settings);
  }
  if (executionPolicy !== currentPolicy) {
    registry.set(teamExecutionPolicyAtom(teamId), executionPolicy);
  }
  if (
    conversation !== currentNotifications.conversation ||
    channel !== currentNotifications.channel
  ) {
    registry.set(teamNotificationsAtom(teamId), { conversation, channel });
  }

  // The resume cursor advances even when nothing moved; the rendered payload's
  // cursor does not, so a quiet tick produces no new dashboard object.
  registry.set(teamCursorAtom(teamId), delta.cursor);
  const changed =
    runs !== currentRuns ||
    workers !== currentWorkers ||
    organizationProviders !== currentProviders ||
    team !== currentTeam ||
    settings !== currentSettings ||
    executionPolicy !== currentPolicy ||
    members !== currentMembers ||
    conversation !== currentNotifications.conversation ||
    channel !== currentNotifications.channel;
  if (changed) {
    registry.set(teamPayloadCursorAtom(teamId), delta.cursor);
    registry.set(teamGeneratedAtAtom(teamId), delta.generatedAt);
  }
  // A page that moved nothing is still the server answering: it confirms that
  // the stored state is current, which is exactly what a hydrated boot waits on.
  markTeamSynced(registry, teamId);
  touchTeam(registry, teamId);
}

/** The retained team that lists `runId`, if any. */
function findTeamOwningRun(registry: AtomRegistry, runId: string) {
  for (const teamId of registry.get(retainedTeamIdsAtom)) {
    if (registry.get(teamRunIdsAtom(teamId))?.includes(runId)) return teamId;
  }
  return null;
}

function applyRunChanged(
  registry: AtomRegistry,
  run: HuntRun,
  explicitTeamId: string | undefined,
) {
  registry.update(runsByIdAtom, (runs) => upsertMany(runs, [run]));
  const teamId = explicitTeamId ?? run.teamId ?? findTeamOwningRun(registry, run.id);
  if (!teamId) return;
  const ids = registry.get(teamRunIdsAtom(teamId));
  if (!ids || ids.includes(run.id)) return;
  registry.set(teamRunIdsAtom(teamId), [run.id, ...ids]);
}

function applyRunDeleted(
  registry: AtomRegistry,
  teamId: string,
  runId: string,
) {
  const ids = registry.get(teamRunIdsAtom(teamId));
  if (ids?.includes(runId)) {
    registry.set(
      teamRunIdsAtom(teamId),
      ids.filter((candidate) => candidate !== runId),
    );
  }
  releaseSharedIds(registry, runsByIdAtom, teamRunIdsAtom, teamId, [runId]);
}

/**
 * Replaces one organization's ordered channel list. Summaries that did not
 * change keep their stored reference, and ids the new list dropped leave the
 * shared map — channels belong to exactly one organization, so nothing else can
 * still be referencing them.
 */
function writeChannelCatalog(
  registry: AtomRegistry,
  organizationId: string,
  channels: readonly ChannelSummary[],
) {
  const previousIds = registry.get(organizationChannelIdsAtom(organizationId));
  const nextIds = channels.map((channel) => channel.id);
  registry.update(channelsByIdAtom, (stored) => upsertMany(stored, channels));
  registry.set(organizationChannelIdsAtom(organizationId), nextIds);
  const kept = new Set(nextIds);
  const dropped = (previousIds ?? []).filter((id) => !kept.has(id));
  if (dropped.length > 0) {
    registry.update(channelsByIdAtom, (stored) => removeMany(stored, dropped));
  }
  registry.update(channelCatalogOrganizationIdsAtom, (organizationIds) =>
    organizationIds.includes(organizationId)
      ? organizationIds
      : [...organizationIds, organizationId],
  );
}

/**
 * Merges one catalog delta page. The merge and the name ordering are the ones
 * the catalog sync in the app shell applied to its own array, kept intact: a
 * page that carries nothing leaves the list — and its reference — alone.
 */
function applyChannelCatalogDelta(
  registry: AtomRegistry,
  organizationId: string,
  channels: readonly ChannelSummary[],
  removedChannelIds: readonly string[],
  reset: boolean,
) {
  if (!reset && channels.length === 0 && removedChannelIds.length === 0) return;
  const current = registry.get(organizationChannelsAtom(organizationId));
  const byId = new Map(
    (reset ? [] : current).map((channel) => [channel.id, channel] as const),
  );
  for (const channel of channels) byId.set(channel.id, channel);
  for (const id of removedChannelIds) byId.delete(id);
  writeChannelCatalog(
    registry,
    organizationId,
    [...byId.values()].sort((left, right) => left.name.localeCompare(right.name)),
  );
}

/**
 * Upserts one summary. The organization's list is left in place unless the
 * channel is new to it, which keeps a read receipt from reordering anything.
 */
function applyChannelChanged(registry: AtomRegistry, channel: ChannelSummary) {
  registry.update(channelsByIdAtom, (stored) => upsertMany(stored, [channel]));
  const ids = registry.get(organizationChannelIdsAtom(channel.organizationId));
  if (!ids || ids.includes(channel.id)) return;
  registry.set(organizationChannelIdsAtom(channel.organizationId), [
    ...ids,
    channel.id,
  ]);
}

function applyChannelRemoved(
  registry: AtomRegistry,
  organizationId: string,
  channelId: string,
) {
  const ids = registry.get(organizationChannelIdsAtom(organizationId));
  if (ids?.includes(channelId)) {
    registry.set(
      organizationChannelIdsAtom(organizationId),
      ids.filter((candidate) => candidate !== channelId),
    );
  }
  registry.update(channelsByIdAtom, (stored) => removeMany(stored, [channelId]));
}

/** Forgets an organization's catalog entirely, summaries included. */
function clearChannelCatalog(registry: AtomRegistry, organizationId: string) {
  const ids = registry.get(organizationChannelIdsAtom(organizationId));
  registry.set(organizationChannelIdsAtom(organizationId), null);
  if (ids && ids.length > 0) {
    registry.update(channelsByIdAtom, (stored) => removeMany(stored, ids));
  }
  registry.update(channelCatalogOrganizationIdsAtom, (organizationIds) =>
    organizationIds.includes(organizationId)
      ? organizationIds.filter((candidate) => candidate !== organizationId)
      : organizationIds,
  );
}

function applySessionCleared(registry: AtomRegistry) {
  for (const teamId of [...registry.get(retainedTeamIdsAtom)]) {
    clearTeamState(registry, teamId);
  }
  registry.set(runsByIdAtom, new Map());
  registry.set(workersByIdAtom, new Map());
  registry.set(membersByIdAtom, new Map());
  registry.set(teamsByIdAtom, new Map());
  for (const organizationId of [
    ...registry.get(channelCatalogOrganizationIdsAtom),
  ]) {
    registry.set(organizationChannelIdsAtom(organizationId), null);
  }
  registry.set(channelCatalogOrganizationIdsAtom, []);
  registry.set(channelsByIdAtom, new Map());
  registry.set(retainedTeamIdsAtom, []);
  registry.set(staleTeamIdAtom, null);
}

/**
 * Applies one sync event to the normalized store. The only function that writes
 * entity maps and per-team families from a server payload.
 */
export function applySyncEvent(registry: AtomRegistry, event: SyncEvent): void {
  Atom.batch(() => {
    switch (event.kind) {
      case "team-snapshot":
        applyTeamSnapshot(registry, event.teamId, event.payload);
        return;
      case "team-delta":
        applyTeamDelta(registry, event.teamId, event.payload);
        return;
      case "run-changed":
        applyRunChanged(registry, event.run, event.teamId);
        return;
      case "run-deleted":
        applyRunDeleted(registry, event.teamId, event.runId);
        return;
      case "channel-changed":
        applyChannelChanged(registry, event.channel);
        return;
      case "channel-catalog-snapshot":
        writeChannelCatalog(registry, event.organizationId, event.channels);
        return;
      case "channel-catalog-delta":
        applyChannelCatalogDelta(
          registry,
          event.organizationId,
          event.channels,
          event.removedChannelIds,
          event.reset,
        );
        return;
      case "channel-removed":
        applyChannelRemoved(registry, event.organizationId, event.channelId);
        return;
      case "channel-catalog-cleared":
        clearChannelCatalog(registry, event.organizationId);
        return;
      case "team-settings-changed": {
        // The guard the payload level commit had: settings replace a payload
        // that is actually rendered, and a write for a team that is not on
        // screen is dropped rather than installed under a stale cursor.
        if (registry.get(activeTeamIdAtom) !== event.teamId) return;
        if (registry.get(dashboardViewAtom(event.teamId)) === null) return;
        registry.set(teamSettingsAtom(event.teamId), event.settings);
        return;
      }
      case "team-cleared":
        clearTeamState(registry, event.teamId);
        return;
      case "organization-left": {
        for (const teamId of [...registry.get(retainedTeamIdsAtom)]) {
          const team = registry.get(teamEntityAtom(teamId));
          if (team?.organizationId === event.retainedOrganizationId) continue;
          clearTeamState(registry, teamId);
        }
        return;
      }
      case "session-cleared":
        applySessionCleared(registry);
        return;
    }
  });
}

/**
 * Marks the team the user just switched to as showing stored data, so the next
 * fetch is a snapshot rather than a delta from a cursor of unknown age. Teams
 * with nothing stored clear the marker instead: they render the loading state.
 */
export function markTeamStale(
  registry: AtomRegistry,
  teamId: string | null,
): boolean {
  const loaded = teamId !== null && registry.get(teamLoadedAtom(teamId));
  Atom.batch(() => {
    registry.set(staleTeamIdAtom, loaded ? teamId : null);
    if (loaded && teamId) touchTeam(registry, teamId);
  });
  return loaded;
}

/** Drops the "showing stored data" marker once fresh data for it landed. */
export function clearTeamStaleness(registry: AtomRegistry, teamId: string) {
  if (registry.get(staleTeamIdAtom) !== teamId) return;
  registry.set(staleTeamIdAtom, null);
}
