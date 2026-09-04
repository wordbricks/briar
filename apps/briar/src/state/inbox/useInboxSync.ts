import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import type { InboxFeedSyncState } from "../../lib/api";
import {
  createInboxRealtimeTransport,
  INBOX_REALTIME_DEBOUNCE_MS,
  INBOX_REALTIME_FALLBACK_MS,
} from "../../lib/channel-realtime";
import type { RealtimeTransport } from "../../lib/realtime-transport";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { teamsAtom } from "../team/atoms";
import { resolveInboxApi, type InboxApi } from "./api";
import {
  inboxFeedIdentityAtom,
  inboxMergeSourcesAtom,
  inboxStateAtom,
  inboxStorageKeyAtom,
  inboxUserIdAtom,
} from "./atoms";
import {
  inboxMessageSnapshotsEqual,
  keepStoredInboxFeedMessage,
  mergeInboxMessages,
  type InboxMessage,
} from "./model";
import { writeInboxStorage } from "./persistence";
import { startInboxReadSync } from "./read-sync";

/*
  The inbox's transports: the account feed, its realtime channel, and the merge
  of the open board into the stored record.

  All three were `useInbox`'s effects and all three are still effects, because
  each is a lifecycle over something outside the store — a socket, a polling
  timer, an abortable request. What changed is where their results land: in the
  atoms, through the same storage record the hook wrote.

  The realtime notification stays a *refresh trigger* rather than a `SyncEvent`.
  A publish on the `inbox` topic carries a version and nothing else; the
  messages themselves only exist as the organization feed's answer, which is a
  compact summary that has to be merged against the richer local copy. Turning
  the trigger into an event would mean inventing a payload the server never
  sends. The feed response that follows is what enters the store, and it does so
  through one function, which is the property the single entry point buys.
*/

/** Where each feed scope's cursor lives, for as long as the registry does. */
interface InboxFeedBookkeeping {
  scope: string;
  state: InboxFeedSyncState | null;
}

const feedBookkeeping = new WeakMap<AtomRegistry, InboxFeedBookkeeping>();

/**
 * Folds the messages the open board implies into the stored record. It is the
 * store's own writer: the feed is authoritative for the organization, and this
 * is authoritative for the team whose board is loaded.
 */
export function mergeCurrentInboxMessages(registry: AtomRegistry): void {
  const { currentMessages, projects, storageKey, userId } = registry.get(
    inboxMergeSourcesAtom,
  );
  if (!userId) return;
  const current = registry.get(inboxStateAtom);
  if (current.storageKey !== storageKey) return;
  const messages = mergeInboxMessages(
    current.messages,
    currentMessages,
    projects,
  );
  if (inboxMessageSnapshotsEqual(current.messages, messages)) return;
  // Keep account-synced read versions even when a message temporarily leaves
  // the local feed, so another device's read state is not lost.
  const next = { messages, readVersions: current.readVersions };
  writeInboxStorage(storageKey, next);
  registry.set(inboxStateAtom, { storageKey, ...next });
}

export interface InboxFeedSyncOptions {
  readonly api?: Partial<InboxApi> | undefined;
  readonly organizationId: string | null;
  readonly realtime: RealtimeTransport | null;
  readonly storageKey: string;
  readonly token: string | null;
  readonly userId: string | null;
}

/**
 * Opens the organization feed for one account and returns the canceller. The
 * feed is what makes the inbox account-wide rather than a view of the open
 * team, and its first response is half of {@link inboxFeedIdentityAtom}'s job:
 * unread markers stay off until an authoritative answer has arrived.
 */
export function startInboxFeedSync(
  registry: AtomRegistry,
  {
    api: overrides,
    organizationId,
    realtime,
    storageKey,
    token,
    userId,
  }: InboxFeedSyncOptions,
): () => void {
  if (!token || !userId || !organizationId) {
    if (registry.get(inboxFeedIdentityAtom) !== null) {
      registry.set(inboxFeedIdentityAtom, null);
    }
    return () => {};
  }

  const api = resolveInboxApi(registry, overrides);
  const feedScope = `${userId}:${organizationId}`;
  let bookkeeping = feedBookkeeping.get(registry);
  if (bookkeeping?.scope !== feedScope) {
    bookkeeping = { scope: feedScope, state: null };
    feedBookkeeping.set(registry, bookkeeping);
  }
  const identity = registry.get(inboxFeedIdentityAtom);
  if (!(identity?.scope === feedScope && identity.token === token)) {
    if (identity !== null) registry.set(inboxFeedIdentityAtom, null);
  }

  const abort = new AbortController();
  let disposed = false;
  let refreshInFlight = false;
  let refreshRequested = false;
  let latestRealtimeVersion = -1;
  let realtimeDebounce: number | null = null;

  const applyFeed = (
    messages: InboxMessage[],
    subscribedIssueIds: string[] | undefined,
  ) => {
    const current = registry.get(inboxStateAtom);
    if (current.storageKey !== storageKey) return;
    const subscribed = subscribedIssueIds
      ? new Set(subscribedIssueIds)
      : null;
    const authorizedSessionMessageIds = new Set(
      messages.flatMap((message) =>
        message.kind === "session" ? [message.id] : []
      ),
    );
    const retainedMessages = current.messages.filter((message) => {
      if (message.kind === "session") {
        return authorizedSessionMessageIds.has(message.id);
      }
      if (
        subscribed &&
        (message.kind === "issue" || message.kind === "conversation")
      ) {
        return subscribed.has(message.targetId);
      }
      return true;
    });
    const storedById = new Map(
      retainedMessages.map((message) => [message.id, message]),
    );
    const feedSnapshot = messages.map((message) =>
      keepStoredInboxFeedMessage(storedById.get(message.id), message)
    );
    const merged = mergeInboxMessages(
      retainedMessages,
      feedSnapshot,
      registry.get(teamsAtom),
    );
    if (inboxMessageSnapshotsEqual(current.messages, merged)) return;
    const next = { messages: merged, readVersions: current.readVersions };
    writeInboxStorage(storageKey, next);
    registry.set(inboxStateAtom, { storageKey, ...next });
  };

  const refresh = async () => {
    if (refreshInFlight) {
      refreshRequested = true;
      return;
    }
    refreshInFlight = true;
    try {
      const result = await api.loadFeed(
        token,
        organizationId,
        bookkeeping?.scope === feedScope ? bookkeeping.state : null,
        abort.signal,
      );
      if (disposed) return;
      bookkeeping = { scope: feedScope, state: result.state };
      feedBookkeeping.set(registry, bookkeeping);
      if (!result.notModified) {
        applyFeed(result.messages, result.subscribedIssueIds);
      }
      // The first authoritative feed and account read-state response jointly
      // unlock unread markers, app badges, and OS notification change
      // detection. Later feed refreshes keep the same scoped baseline.
      const settled = registry.get(inboxFeedIdentityAtom);
      if (!(settled?.scope === feedScope && settled.token === token)) {
        registry.set(inboxFeedIdentityAtom, { scope: feedScope, token });
      }
    } catch {
      // Preserve the local Inbox cache while offline; reconnect and resume
      // events from the polling transport retry the authoritative feed.
    } finally {
      refreshInFlight = false;
      if (!disposed && refreshRequested) {
        refreshRequested = false;
        void refresh();
      }
    }
  };

  const unsubscribe = realtime?.subscribe((notification) => {
    if (
      notification.topic !== "inbox" ||
      notification.version <= latestRealtimeVersion
    ) {
      return;
    }
    latestRealtimeVersion = notification.version;
    if (realtimeDebounce !== null) {
      window.clearTimeout(realtimeDebounce);
    }
    realtimeDebounce = window.setTimeout(() => {
      realtimeDebounce = null;
      void refresh();
    }, INBOX_REALTIME_DEBOUNCE_MS);
  });
  // Inbox realtime is what lets system notifications arrive while the app
  // window is hidden. Other organization consumers may pause in the
  // background, but this consumer deliberately keeps the shared socket alive
  // until the authenticated Inbox scope is disposed.
  realtime?.start();
  const stopPolling = api.startPolling(
    () => void refresh(),
    undefined,
    realtime ? INBOX_REALTIME_FALLBACK_MS : undefined,
  );

  return () => {
    disposed = true;
    abort.abort();
    stopPolling();
    unsubscribe?.();
    realtime?.stop();
    if (realtimeDebounce !== null) {
      window.clearTimeout(realtimeDebounce);
    }
  };
}

export interface InboxSyncDeps {
  readonly api?: Partial<InboxApi> | undefined;
  /** The realtime transport factory. `null` runs the inbox on polling alone. */
  readonly createRealtime?:
    | typeof createInboxRealtimeTransport
    | null
    | undefined;
}

/** Mounts the inbox's three transports for this registry. */
export function useInboxSync(deps: InboxSyncDeps = {}): void {
  const registry = useRegistry();
  const token = useAtomValue(tokenAtom);
  const userId = useAtomValue(inboxUserIdAtom);
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const storageKey = useAtomValue(inboxStorageKeyAtom);
  const { api } = deps;
  const createRealtime =
    deps.createRealtime === undefined
      ? createInboxRealtimeTransport
      : deps.createRealtime;

  useEffect(
    () =>
      startInboxReadSync(registry, { api, storageKey, token, userId }),
    [api, registry, storageKey, token, userId],
  );

  /*
    The board merge needs no render: it reads three atoms and writes a fourth.
    Subscribing immediately builds the dependency graph and folds the board that
    is already loaded into the record this boot restored.
  */
  useEffect(
    () =>
      registry.subscribe(
        inboxMergeSourcesAtom,
        () => mergeCurrentInboxMessages(registry),
        { immediate: true },
      ),
    [registry],
  );

  const realtime = useMemo(
    () =>
      token && organizationId && userId && createRealtime
        ? createRealtime(token, organizationId)
        : null,
    [createRealtime, organizationId, token, userId],
  );

  useEffect(
    () =>
      startInboxFeedSync(registry, {
        api,
        organizationId,
        realtime,
        storageKey,
        token,
        userId,
      }),
    [api, organizationId, realtime, registry, storageKey, token, userId],
  );
}
