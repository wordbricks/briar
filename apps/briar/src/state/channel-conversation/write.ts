import * as Atom from "effect/unstable/reactivity/Atom";

import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
} from "../../lib/channels-contract";
import {
  removeMany,
  replaceEntities,
  replaceEntitiesBy,
  upsertMany,
} from "../entities/upsert";
import type { AtomRegistry } from "../registry";
import {
  CHANNEL_CONVERSATION_RETENTION_LIMIT,
  CHANNEL_THREAD_RETENTION_LIMIT,
  channelAcceptingProposalIdAtom,
  channelAgentRepliesAtom,
  channelAgentsAtom,
  channelConversationBusyAtom,
  channelConversationLoadingAtom,
  channelDecliningProposalIdAtom,
  channelEarlierMessagesLoadingAtom,
  channelMembersAtom,
  channelMessageCursorAtom,
  channelMessagesByIdAtom,
  channelOpenThreadIdAtom,
  channelProposalProjectsAtom,
  channelRootMessageIdsAtom,
  channelRootMessagesAtom,
  channelSettledAgentReplyIdsAtom,
  channelThreadKey,
  channelThreadLoadingAtom,
  channelThreadMessageIdsAtom,
  channelThreadMessagesAtom,
  channelThreadRootIdsAtom,
  channelThreadSubscriptionPendingAtom,
  retainedConversationChannelIdsAtom,
  touchRetained,
} from "./atoms";
import {
  channelReplyIsTerminal,
  mergeChannelMessages,
  mergeChannelMessageSnapshot,
  mergeChannelReplies,
} from "./model";

/*
  Every write to the channel conversation store.

  `state/sync/apply.ts` calls these for the events a server payload produces,
  and the conversation views call the exported `write*` pair for the two places
  where the view still computes the next value itself (see the note on
  `writeChannelTimeline`). Keeping the mutations in one module is what makes
  "one merge rule per thing" true even while there are two callers.

  The timeline is stored twice on purpose: a map keyed by message id, which is
  what a row subscribes to, and an ordered array of ids, which is what the list
  subscribes to. `upsertMany` keeps the stored object of every message a page
  re-sent unchanged, so a page that changed one message reaches one row.
*/

/** Drops from the map every message no index of the channel points at. */
function pruneChannelMessages(registry: AtomRegistry, channelId: string) {
  const reachable = new Set(registry.get(channelRootMessageIdsAtom(channelId)) ?? []);
  for (const rootId of registry.get(channelThreadRootIdsAtom(channelId))) {
    for (const id of registry.get(
      channelThreadMessageIdsAtom(channelThreadKey(channelId, rootId)),
    ) ?? []) {
      reachable.add(id);
    }
  }
  registry.update(channelMessagesByIdAtom(channelId), (stored) =>
    removeMany(
      stored,
      [...stored.keys()].filter((id) => !reachable.has(id)),
    ),
  );
}

/** Forgets one channel's conversation entirely. */
export function clearChannelConversation(registry: AtomRegistry, channelId: string) {
  for (const rootId of registry.get(channelThreadRootIdsAtom(channelId))) {
    registry.set(
      channelThreadMessageIdsAtom(channelThreadKey(channelId, rootId)),
      null,
    );
  }
  registry.set(channelThreadRootIdsAtom(channelId), []);
  registry.set(channelRootMessageIdsAtom(channelId), null);
  if (registry.get(channelMessagesByIdAtom(channelId)).size > 0) {
    registry.set(channelMessagesByIdAtom(channelId), new Map());
  }
  registry.set(channelMembersAtom(channelId), []);
  registry.set(channelAgentsAtom(channelId), []);
  registry.set(channelAgentRepliesAtom(channelId), []);
  registry.set(channelSettledAgentReplyIdsAtom(channelId), []);
  registry.set(channelMessageCursorAtom(channelId), null);
  registry.update(retainedConversationChannelIdsAtom, (retained) =>
    retained.includes(channelId)
      ? retained.filter((candidate) => candidate !== channelId)
      : retained,
  );
}

/** Marks `channelId` most recently used and evicts whatever that pushed out. */
export function touchChannelConversation(registry: AtomRegistry, channelId: string) {
  const { retained, evicted } = touchRetained(
    registry.get(retainedConversationChannelIdsAtom),
    channelId,
    CHANNEL_CONVERSATION_RETENTION_LIMIT,
  );
  registry.set(retainedConversationChannelIdsAtom, retained);
  for (const dropped of evicted) clearChannelConversation(registry, dropped);
}

/** Writes one channel's root timeline: the messages and their order. */
function writeChannelRootMessages(
  registry: AtomRegistry,
  channelId: string,
  messages: readonly ChannelMessage[],
  removedMessageIds: readonly string[] = [],
) {
  registry.update(channelMessagesByIdAtom(channelId), (stored) =>
    upsertMany(stored, messages, removedMessageIds),
  );
  registry.set(
    channelRootMessageIdsAtom(channelId),
    messages.map((message) => message.id),
  );
}

/** Writes one thread and keeps the channel's thread list within its bound. */
export function writeChannelThread(
  registry: AtomRegistry,
  channelId: string,
  rootMessageId: string,
  messages: readonly ChannelMessage[],
) {
  registry.update(channelMessagesByIdAtom(channelId), (stored) =>
    upsertMany(stored, messages),
  );
  registry.set(
    channelThreadMessageIdsAtom(channelThreadKey(channelId, rootMessageId)),
    messages.map((message) => message.id),
  );
  const { retained, evicted } = touchRetained(
    registry.get(channelThreadRootIdsAtom(channelId)),
    rootMessageId,
    CHANNEL_THREAD_RETENTION_LIMIT,
  );
  registry.set(channelThreadRootIdsAtom(channelId), retained);
  for (const dropped of evicted) {
    registry.set(
      channelThreadMessageIdsAtom(channelThreadKey(channelId, dropped)),
      null,
    );
  }
  if (evicted.length > 0) pruneChannelMessages(registry, channelId);
}

/**
 * Merges one thread's complete server snapshot into the store, keeping only
 * the monotonic accepts a stale page must not undo.
 */
export function writeChannelThreadSnapshot(
  registry: AtomRegistry,
  channelId: string,
  rootMessageId: string,
  messages: readonly ChannelMessage[],
) {
  touchChannelConversation(registry, channelId);
  const key = channelThreadKey(channelId, rootMessageId);
  writeChannelThread(
    registry,
    channelId,
    rootMessageId,
    mergeChannelMessageSnapshot(registry.get(channelThreadMessagesAtom(key)), messages),
  );
}

/**
 * Applies a page to every thread the channel holds. The desktop view only ever
 * updated the thread that was open; the companion cache walked all of them so a
 * thread reopened from cache was not stale, and that is the rule kept here.
 */
function applyChannelPageToThreads(
  registry: AtomRegistry,
  channelId: string,
  messages: readonly ChannelMessage[],
  removedMessageIds: readonly string[],
  reset: boolean,
) {
  const rootIds = registry.get(channelThreadRootIdsAtom(channelId));
  if (rootIds.length === 0) return;
  const removed = new Set(removedMessageIds);
  const survivors = rootIds.filter((rootId) => !removed.has(rootId));
  for (const rootId of survivors) {
    const key = channelThreadKey(channelId, rootId);
    const current = registry.get(channelThreadMessagesAtom(key));
    const relevant = messages.filter(
      (message) =>
        message.id === rootId || message.parentMessageId === rootId,
    );
    if (!reset && relevant.length === 0 && removedMessageIds.length === 0) {
      continue;
    }
    const next = reset
      ? [...relevant]
      : mergeChannelMessages(current, relevant, removedMessageIds);
    registry.update(channelMessagesByIdAtom(channelId), (stored) =>
      upsertMany(stored, next),
    );
    registry.set(
      channelThreadMessageIdsAtom(key),
      next.map((message) => message.id),
    );
  }
  if (survivors.length !== rootIds.length) {
    for (const rootId of rootIds) {
      if (survivors.includes(rootId)) continue;
      registry.set(
        channelThreadMessageIdsAtom(channelThreadKey(channelId, rootId)),
        null,
      );
    }
    registry.set(channelThreadRootIdsAtom(channelId), survivors);
  }
  pruneChannelMessages(registry, channelId);
}

export function applyChannelConversationSnapshot(
  registry: AtomRegistry,
  channelId: string,
  members: readonly ChannelMember[],
  agents: readonly ChannelAgentSummary[],
  messages: readonly ChannelMessage[],
  nextCursor: string | null,
  merge: boolean,
) {
  touchChannelConversation(registry, channelId);
  registry.update(channelMembersAtom(channelId), (stored) =>
    replaceEntitiesBy(stored, members, (member) => member.userId),
  );
  registry.update(channelAgentsAtom(channelId), (stored) =>
    replaceEntitiesBy(stored, agents, (agent) => agent.agentId),
  );
  const current = registry.get(channelRootMessagesAtom(channelId));
  writeChannelRootMessages(
    registry,
    channelId,
    merge ? mergeChannelMessages(current, messages, []) : [...messages],
  );
  registry.set(channelMessageCursorAtom(channelId), nextCursor);
  pruneChannelMessages(registry, channelId);
}

export function applyChannelMessagesPage(
  registry: AtomRegistry,
  channelId: string,
  incoming: readonly ChannelMessage[],
  removedMessageIds: readonly string[],
  reset: boolean,
  includeRepliesInRoot: boolean,
) {
  const relevant = incoming.filter((item) => item.channelId === channelId);
  if (!reset && relevant.length === 0 && removedMessageIds.length === 0) {
    // A delta page that carried nothing for this channel leaves every atom
    // alone, so a quiet realtime tick notifies nobody.
    return;
  }
  /*
    A page for a channel whose timeline has never been loaded reaches only the
    threads it already holds. Building a root index out of one delta page would
    mark the channel loaded while holding a hole in the middle of its history,
    and the detail response that is already in flight replaces it a moment
    later anyway.
  */
  const rootIds = registry.get(channelRootMessageIdsAtom(channelId));
  if (
    rootIds === null &&
    registry.get(channelThreadRootIdsAtom(channelId)).length === 0
  ) {
    return;
  }
  touchChannelConversation(registry, channelId);
  const rootUpdates = includeRepliesInRoot
    ? relevant
    : relevant.filter((item) => item.parentMessageId === null);
  if (rootIds !== null && (reset || rootUpdates.length > 0 || removedMessageIds.length > 0)) {
    writeChannelRootMessages(
      registry,
      channelId,
      reset
        ? [...rootUpdates]
        : mergeChannelMessages(
            registry.get(channelRootMessagesAtom(channelId)),
            rootUpdates,
            removedMessageIds,
          ),
      removedMessageIds,
    );
  }
  applyChannelPageToThreads(
    registry,
    channelId,
    relevant,
    removedMessageIds,
    reset,
  );
}

export function applyChannelMessageChanged(
  registry: AtomRegistry,
  channelId: string,
  message: ChannelMessage,
  includeRepliesInRoot: boolean,
) {
  applyChannelMessagesPage(
    registry,
    channelId,
    [message],
    [],
    false,
    includeRepliesInRoot,
  );
}

export function applyChannelMessageRemoved(
  registry: AtomRegistry,
  channelId: string,
  messageId: string,
) {
  const rootIds = registry.get(channelRootMessageIdsAtom(channelId));
  if (rootIds?.includes(messageId)) {
    registry.set(
      channelRootMessageIdsAtom(channelId),
      rootIds.filter((candidate) => candidate !== messageId),
    );
  }
  for (const rootId of registry.get(channelThreadRootIdsAtom(channelId))) {
    const key = channelThreadKey(channelId, rootId);
    const ids = registry.get(channelThreadMessageIdsAtom(key));
    if (!ids?.includes(messageId)) continue;
    registry.set(
      channelThreadMessageIdsAtom(key),
      ids.filter((candidate) => candidate !== messageId),
    );
  }
  pruneChannelMessages(registry, channelId);
}

/**
 * Merges replies under the store's rules, with the settled ids as tombstones so
 * a page that started before an authoritative answer cannot resurrect one.
 */
export function applyChannelAgentReplies(
  registry: AtomRegistry,
  channelId: string,
  incoming: readonly ChannelAgentReply[],
  reset: boolean,
) {
  if (incoming.length === 0 && !reset) return;
  const settled = new Set(registry.get(channelSettledAgentReplyIdsAtom(channelId)));
  const relevant = incoming.filter((reply) => reply.channelId === channelId);
  const next = reset
    ? [...relevant]
    : mergeChannelReplies(
        registry.get(channelAgentRepliesAtom(channelId)),
        relevant,
        settled,
      );
  for (const reply of relevant) {
    if (channelReplyIsTerminal(reply)) settled.add(reply.id);
  }
  registry.set(channelSettledAgentReplyIdsAtom(channelId), [...settled]);
  registry.set(
    channelAgentRepliesAtom(channelId),
    replaceEntities(registry.get(channelAgentRepliesAtom(channelId)), next),
  );
}

/**
 * Replaces the channel's replies with a detail response. Everything it omits is
 * settled — unless it arrived after the request started, which is what
 * `retainedReplyIds` names.
 */
export function applyAuthoritativeChannelAgentReplies(
  registry: AtomRegistry,
  channelId: string,
  incoming: readonly ChannelAgentReply[],
  retainedReplyIds: readonly string[],
) {
  const authoritative = incoming.filter((reply) => reply.channelId === channelId);
  const incomingIds = new Set(authoritative.map((reply) => reply.id));
  const retained = new Set(retainedReplyIds);
  const current = registry.get(channelAgentRepliesAtom(channelId));
  const settled = new Set(registry.get(channelSettledAgentReplyIdsAtom(channelId)));
  for (const reply of current) {
    if (!incomingIds.has(reply.id) && !retained.has(reply.id)) {
      settled.add(reply.id);
    }
  }
  for (const reply of authoritative) {
    if (channelReplyIsTerminal(reply)) settled.add(reply.id);
  }
  registry.set(channelSettledAgentReplyIdsAtom(channelId), [...settled]);
  const concurrent = current.filter((reply) => retained.has(reply.id));
  registry.set(
    channelAgentRepliesAtom(channelId),
    replaceEntities(
      current,
      mergeChannelReplies(
        mergeChannelReplies([], authoritative, settled),
        concurrent,
        settled,
      ),
    ),
  );
}

/*
  The writes the conversation views still make themselves.

  `hooks/use-channel-conversation.ts` computes the next timeline with the merge
  helpers in `model.ts` and hands it to an updater it is given, which until now
  was a `useState` setter inside each view. The updater is these functions now,
  so the two per-view caches are gone and the store is the only copy. The hook
  still decides *what* the next list is, which is the half F5-3 moves; the
  ordering, the identity preservation and the retention bound are here, so
  there is still one implementation of each.
*/

/** Replaces one channel's root timeline. */
export function writeChannelTimeline(
  registry: AtomRegistry,
  channelId: string,
  messages: readonly ChannelMessage[],
): void {
  Atom.batch(() => {
    touchChannelConversation(registry, channelId);
    writeChannelRootMessages(registry, channelId, messages);
    pruneChannelMessages(registry, channelId);
  });
}

/** Replaces one thread's messages, root first. */
export function writeChannelThreadMessages(
  registry: AtomRegistry,
  channelId: string,
  rootMessageId: string,
  messages: readonly ChannelMessage[],
): void {
  Atom.batch(() => {
    touchChannelConversation(registry, channelId);
    writeChannelThread(registry, channelId, rootMessageId, messages);
  });
}

/** Replaces the channel's participants. */
export function writeChannelParticipants(
  registry: AtomRegistry,
  channelId: string,
  participants: {
    readonly members?: readonly ChannelMember[];
    readonly agents?: readonly ChannelAgentSummary[];
  },
): void {
  Atom.batch(() => {
    if (participants.members) {
      registry.update(channelMembersAtom(channelId), (stored) =>
        replaceEntitiesBy(stored, participants.members ?? [], (m) => m.userId),
      );
    }
    if (participants.agents) {
      registry.update(channelAgentsAtom(channelId), (stored) =>
        replaceEntitiesBy(stored, participants.agents ?? [], (a) => a.agentId),
      );
    }
  });
}

/** Sets the cursor the next page of older messages resumes from. */
export function writeChannelMessageCursor(
  registry: AtomRegistry,
  channelId: string,
  cursor: string | null,
): void {
  registry.set(channelMessageCursorAtom(channelId), cursor);
}

/**
 * Replaces the channel's agent replies. The hook owns the tombstone rules for
 * now, so this is a plain replace that keeps the object of every reply that did
 * not move.
 */
export function writeChannelAgentReplies(
  registry: AtomRegistry,
  channelId: string,
  replies: readonly ChannelAgentReply[],
): void {
  registry.update(channelAgentRepliesAtom(channelId), (stored) =>
    replaceEntities(stored, replies),
  );
}

/**
 * Applies a delta page to the threads the channel holds but is not showing.
 * The companion cache walked its stored threads by hand for this reason: a
 * thread reopened from cache must not be missing the replies that arrived
 * while another screen was up.
 */
export function writeChannelDeltaToStoredThreads(
  registry: AtomRegistry,
  channelId: string,
  messages: readonly ChannelMessage[],
  removedMessageIds: readonly string[],
  reset: boolean,
): void {
  Atom.batch(() => {
    applyChannelPageToThreads(
      registry,
      channelId,
      messages.filter((message) => message.channelId === channelId),
      removedMessageIds,
      reset,
    );
  });
}

/** The thread open in one channel, which the views reset as a channel opens. */
export function writeChannelOpenThreadId(
  registry: AtomRegistry,
  channelId: string,
  rootMessageId: string | null,
): void {
  registry.set(channelOpenThreadIdAtom(channelId), rootMessageId);
}

/** Drops the per-channel flags a newly opened channel starts clean with. */
export function resetChannelConversationViewState(
  registry: AtomRegistry,
  channelId: string,
): void {
  Atom.batch(() => {
    registry.set(channelConversationBusyAtom(channelId), false);
    registry.set(channelAcceptingProposalIdAtom(channelId), null);
    registry.set(channelDecliningProposalIdAtom(channelId), null);
    registry.set(channelThreadLoadingAtom(channelId), false);
    registry.set(channelEarlierMessagesLoadingAtom(channelId), false);
    registry.set(channelThreadSubscriptionPendingAtom(channelId), false);
    registry.set(channelProposalProjectsAtom(channelId), {});
    registry.set(channelOpenThreadIdAtom(channelId), null);
  });
}
