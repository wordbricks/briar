import type { AtomRegistry } from "../registry";
import type { InboxApi } from "./api";
import { resolveInboxApi } from "./api";
import {
  inboxReadSyncIdentityAtom,
  inboxStateAtom,
  type InboxReadSyncIdentity,
} from "./atoms";
import { inboxReadVersionsToPush, mergeInboxReadVersions } from "./model";
import { readInboxStorage, writeInboxStorage } from "./persistence";

/*
  The account's read versions, kept in step with the server.

  This is the machinery `useInbox` spent most of its length on, moved out of
  refs and into one object per registry. Its rules are unchanged, and each of
  them exists because of a race that actually happened:

  - one PUT at a time, so two marks cannot reach the server out of order;
  - a GET that started before a local mark is discarded, because the response it
    is carrying predates the intent;
  - a failed PUT keeps its payload underneath any newer local intent and waits
    for the next focus or visibility sync rather than retrying immediately, so a
    permanent 4xx cannot become a request loop;
  - a generation belongs to one account and record, and anything that outlives
    its account is dropped on arrival.
*/

/** One account's read-state round trip, alive until the account changes. */
export interface InboxReadSyncGeneration {
  id: number;
  active: boolean;
  readonly storageKey: string;
  readonly token: string;
  readonly userId: string;
  remoteReadVersions: Record<string, string>;
  pendingPush: Record<string, string>;
  inFlightPush: Record<string, string>;
  pushInFlight: boolean;
  pushQueueRevision: number;
  remoteMutationGeneration: number;
  syncInFlight: boolean;
  syncRequested: boolean;
}

interface InboxReadSyncHolder {
  current: InboxReadSyncGeneration | null;
  nextId: number;
}

const holders = new WeakMap<AtomRegistry, InboxReadSyncHolder>();

function readSyncHolder(registry: AtomRegistry): InboxReadSyncHolder {
  let holder = holders.get(registry);
  if (!holder) {
    holder = { current: null, nextId: 0 };
    holders.set(registry, holder);
  }
  return holder;
}

/** The generation this registry is currently pushing through, if any. */
export function currentInboxReadSync(
  registry: AtomRegistry,
): InboxReadSyncGeneration | null {
  return readSyncHolder(registry).current ?? null;
}

const isLive = (
  registry: AtomRegistry,
  generation: InboxReadSyncGeneration,
) => generation.active && readSyncHolder(registry).current === generation;

const sameIdentity = (
  left: InboxReadSyncIdentity | null,
  right: InboxReadSyncIdentity,
) =>
  left !== null &&
  left.storageKey === right.storageKey &&
  left.token === right.token &&
  left.userId === right.userId;

function applyRemoteReadVersions(
  registry: AtomRegistry,
  generation: InboxReadSyncGeneration,
  remote: Record<string, string>,
  protectedLocal: Record<string, string>,
) {
  if (!isLive(registry, generation)) return;
  const current = registry.get(inboxStateAtom);
  if (current.storageKey === generation.storageKey) {
    generation.remoteReadVersions = remote;
    const readVersions = mergeInboxReadVersions(
      mergeInboxReadVersions(current.readVersions, remote),
      protectedLocal,
    );
    const next = { messages: current.messages, readVersions };
    writeInboxStorage(generation.storageKey, next);
    registry.set(inboxStateAtom, {
      storageKey: generation.storageKey,
      ...next,
    });
  }
  const identity: InboxReadSyncIdentity = {
    storageKey: generation.storageKey,
    token: generation.token,
    userId: generation.userId,
  };
  if (!sameIdentity(registry.get(inboxReadSyncIdentityAtom), identity)) {
    registry.set(inboxReadSyncIdentityAtom, identity);
  }
}

function flushReadStatePush(
  registry: AtomRegistry,
  api: InboxApi,
  generation: InboxReadSyncGeneration,
) {
  const drain = () => {
    if (!isLive(registry, generation) || generation.pushInFlight) return;
    const payload = generation.pendingPush;
    if (Object.keys(payload).length === 0) return;

    generation.pendingPush = {};
    generation.inFlightPush = payload;
    generation.pushInFlight = true;
    let failed = false;
    let failedAtQueueRevision = generation.pushQueueRevision;

    void api.saveReadStates(generation.token, payload)
      .then((remote) => {
        if (!isLive(registry, generation)) return;
        // A completed PUT is newer than any GET that was already waiting.
        generation.remoteMutationGeneration += 1;
        generation.inFlightPush = {};
        applyRemoteReadVersions(
          registry,
          generation,
          remote,
          generation.pendingPush,
        );
      })
      .catch(() => {
        if (!isLive(registry, generation)) return;
        // Keep the failed payload underneath any newer local intent. A later
        // mark, focus, or visibility sync retries it; a permanent 4xx must not
        // create an immediate recursive request loop.
        generation.pendingPush = mergeInboxReadVersions(
          payload,
          generation.pendingPush,
        );
        generation.inFlightPush = {};
        failed = true;
        failedAtQueueRevision = generation.pushQueueRevision;
      })
      .finally(() => {
        if (!isLive(registry, generation)) return;
        generation.pushInFlight = false;
        const hasPending = Object.keys(generation.pendingPush).length > 0;
        if (
          hasPending &&
          (!failed || generation.pushQueueRevision > failedAtQueueRevision)
        ) {
          drain();
        }
      });
  };

  drain();
}

function queueReadStatePushForGeneration(
  registry: AtomRegistry,
  api: InboxApi,
  generation: InboxReadSyncGeneration,
  readVersions: Record<string, string>,
) {
  if (!isLive(registry, generation)) return;
  const pending = inboxReadVersionsToPush(readVersions, {
    ...generation.remoteReadVersions,
    ...generation.inFlightPush,
  });
  let changed = false;
  for (const [messageId, version] of Object.entries(pending)) {
    if (generation.pendingPush[messageId] === version) continue;
    generation.pendingPush[messageId] = version;
    changed = true;
  }
  if (!changed) return;

  // Invalidates GET responses that began before this explicit local read.
  generation.remoteMutationGeneration += 1;
  generation.pushQueueRevision += 1;
  flushReadStatePush(registry, api, generation);
}

/**
 * Queues the versions a local read produced, if the generation on screen is
 * still the one they belong to. Before the first generation exists — a gate
 * screen, a signed-out window — there is nothing to push and nothing to fail.
 */
export function queueInboxReadStatePush(
  registry: AtomRegistry,
  api: InboxApi,
  identity: InboxReadSyncIdentity,
  readVersions: Record<string, string>,
): void {
  const generation = currentInboxReadSync(registry);
  if (
    !generation ||
    !generation.active ||
    generation.storageKey !== identity.storageKey ||
    generation.token !== identity.token ||
    generation.userId !== identity.userId
  ) {
    return;
  }
  queueReadStatePushForGeneration(registry, api, generation, readVersions);
}

/**
 * Pulls the account's read versions and reconciles them with what this device
 * knows. The server wins conflicts from an older persisted cache; entries that
 * have never reached the server, plus explicit pending or in-flight reads,
 * remain local until their serial PUT succeeds.
 */
export function synchronizeInboxReadStates(
  registry: AtomRegistry,
  api: InboxApi,
  generation: InboxReadSyncGeneration,
): void {
  const run = () => {
    if (!isLive(registry, generation)) return;

    // A focus/visibility sync is also the retry boundary for a failed PUT.
    flushReadStatePush(registry, api, generation);
    if (generation.syncInFlight) {
      generation.syncRequested = true;
      return;
    }

    generation.syncInFlight = true;
    const responseGeneration = generation.remoteMutationGeneration;
    const localAtRequestStart = readInboxStorage(
      generation.storageKey,
    ).readVersions;

    void api.loadReadStates(generation.token)
      .then((remote) => {
        if (
          !isLive(registry, generation) ||
          generation.remoteMutationGeneration !== responseGeneration
        ) {
          return;
        }

        const localOnly = Object.fromEntries(
          Object.entries(localAtRequestStart).filter(
            ([messageId]) =>
              !Object.prototype.hasOwnProperty.call(remote, messageId),
          ),
        );
        const protectedLocal = mergeInboxReadVersions(
          mergeInboxReadVersions(localOnly, generation.inFlightPush),
          generation.pendingPush,
        );
        applyRemoteReadVersions(registry, generation, remote, protectedLocal);
        if (Object.keys(localOnly).length > 0) {
          queueReadStatePushForGeneration(
            registry,
            api,
            generation,
            localOnly,
          );
        }
      })
      .catch(() => {
        // Offline or auth race: keep local cache until the next sync.
      })
      .finally(() => {
        if (!isLive(registry, generation)) return;
        generation.syncInFlight = false;
        if (generation.syncRequested) {
          generation.syncRequested = false;
          run();
        }
      });
  };

  run();
}

export interface InboxReadSyncOptions {
  readonly api?: Partial<InboxApi> | undefined;
  readonly storageKey: string;
  readonly token: string | null;
  readonly userId: string | null;
}

/**
 * Opens the read-state round trip for one account and record, and returns the
 * canceller that closes it. Re-reading the stored record first is what makes a
 * change of account swap the whole inbox rather than blending two of them.
 */
export function startInboxReadSync(
  registry: AtomRegistry,
  { api: overrides, storageKey, token, userId }: InboxReadSyncOptions,
): () => void {
  const holder = readSyncHolder(registry);
  if (holder.current) holder.current.active = false;
  holder.current = null;
  registry.set(inboxStateAtom, {
    storageKey,
    ...readInboxStorage(storageKey),
  });
  // The identity survives only when it is still this account's and this
  // record's: anything else would report a completed sync for somebody else.
  const identity = registry.get(inboxReadSyncIdentityAtom);
  const keepsIdentity =
    identity !== null &&
    identity.storageKey === storageKey &&
    identity.token === token &&
    identity.userId === userId;
  if (identity !== null && !keepsIdentity) {
    registry.set(inboxReadSyncIdentityAtom, null);
  }

  if (!token || !userId) return () => {};

  const api = resolveInboxApi(registry, overrides);
  const generation: InboxReadSyncGeneration = {
    id: ++holder.nextId,
    active: true,
    storageKey,
    token,
    userId,
    remoteReadVersions: {},
    pendingPush: {},
    inFlightPush: {},
    pushInFlight: false,
    pushQueueRevision: 0,
    remoteMutationGeneration: 0,
    syncInFlight: false,
    syncRequested: false,
  };
  holder.current = generation;
  synchronizeInboxReadStates(registry, api, generation);

  const handleFocus = () =>
    synchronizeInboxReadStates(registry, api, generation);
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      synchronizeInboxReadStates(registry, api, generation);
    }
  };
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    generation.active = false;
    if (holder.current === generation) holder.current = null;
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
