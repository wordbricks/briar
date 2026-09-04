import * as Atom from "effect/unstable/reactivity/Atom";

import { applyChannelMessageDeletion } from "../../lib/channel-message-deletion";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  DeleteChannelMessageResponse,
} from "../../lib/channels-contract";
import { removeOptimisticChannelMessage } from "../../lib/optimistic-channel-message";
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
  channelAgentRepliesAtom,
  channelAgentsAtom,
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
  members: readonly ChannelMember[] | undefined,
  agents: readonly ChannelAgentSummary[] | undefined,
  messages: readonly ChannelMessage[],
  nextCursor: string | null,
  merge: boolean,
) {
  touchChannelConversation(registry, channelId);
  if (members) {
    registry.update(channelMembersAtom(channelId), (stored) =>
      replaceEntitiesBy(stored, members, (member) => member.userId),
    );
  }
  if (agents) {
    registry.update(channelAgentsAtom(channelId), (stored) =>
      replaceEntitiesBy(stored, agents, (agent) => agent.agentId),
    );
  }
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
  The writes the conversation's own actions make.

  These are the optimistic paths: a send, a rollback, a reaction, an approval and
  a deletion all touch messages the server has not answered for yet, so there is
  no event to apply. Each one says what it does to the store rather than handing
  a whole next list in — `actions.ts` used to compute the timeline itself and
  pass it through a pair of `updateRoot` / `updateThread` helpers shaped like the
  `useState` setters the deleted hook was given, which meant every caller had to
  remember to do the same thing to both surfaces.

  "Both surfaces" is the rule these encode: a message can be drawn twice at once,
  as a row of the root timeline and as a row of the open thread, and an
  optimistic patch that reached only one of them showed two different versions of
  the same message on one screen.
*/

/** The open thread of one channel, or `null` when none is open. */
const openThreadKey = (registry: AtomRegistry, channelId: string) => {
  const rootMessageId = registry.get(channelOpenThreadIdAtom(channelId));
  return rootMessageId === null
    ? null
    : ({ rootMessageId, key: channelThreadKey(channelId, rootMessageId) } as const);
};

/**
 * Rewrites every message of the channel's root timeline and of its open thread
 * through `patch`. The patch returns the message unchanged for rows it does not
 * touch, and the writers below drop the write when nothing moved.
 */
export function patchChannelMessages(
  registry: AtomRegistry,
  channelId: string,
  patch: (message: ChannelMessage) => ChannelMessage,
): void {
  Atom.batch(() => {
    writeChannelTimeline(
      registry,
      channelId,
      registry.get(channelRootMessagesAtom(channelId)).map(patch),
    );
    const thread = openThreadKey(registry, channelId);
    if (!thread) return;
    writeChannelThreadMessages(
      registry,
      channelId,
      thread.rootMessageId,
      registry.get(channelThreadMessagesAtom(thread.key)).map(patch),
    );
  });
}

/**
 * Rewrites one message of the root timeline — the reply summary an optimistic
 * thread reply moves, which only a root row draws. The stored message is one
 * object per id per channel, so a thread holding that same message as its own
 * first row sees the new value too; what this skips is rewriting the thread's
 * id index, which the patch cannot move.
 */
export function patchChannelRootMessage(
  registry: AtomRegistry,
  channelId: string,
  messageId: string,
  patch: (message: ChannelMessage) => ChannelMessage,
): void {
  writeChannelTimeline(
    registry,
    channelId,
    registry
      .get(channelRootMessagesAtom(channelId))
      .map((message) => (message.id === messageId ? patch(message) : message)),
  );
}

/**
 * Merges `messages` into one surface of the channel — the root timeline or the
 * open thread — under the same ordering and identity rules a server page gets.
 * This is the optimistic send and the confirmation that replaces it.
 */
export function mergeIntoChannelSurface(
  registry: AtomRegistry,
  channelId: string,
  surface: "root" | "thread",
  messages: readonly ChannelMessage[],
): void {
  if (surface === "root") {
    writeChannelTimeline(
      registry,
      channelId,
      mergeChannelMessages(
        registry.get(channelRootMessagesAtom(channelId)),
        messages,
        [],
      ),
    );
    return;
  }
  const thread = openThreadKey(registry, channelId);
  if (!thread) return;
  writeChannelThreadMessages(
    registry,
    channelId,
    thread.rootMessageId,
    mergeChannelMessages(
      registry.get(channelThreadMessagesAtom(thread.key)),
      messages,
      [],
    ),
  );
}

/**
 * Drops the placeholder a failed send left behind, from both surfaces. Only a
 * message still marked optimistic is removed, so a confirmation that arrived
 * first is never rolled back.
 */
export function removeOptimisticChannelMessages(
  registry: AtomRegistry,
  channelId: string,
  clientMessageId: string,
): void {
  Atom.batch(() => {
    writeChannelTimeline(
      registry,
      channelId,
      removeOptimisticChannelMessage(
        registry.get(channelRootMessagesAtom(channelId)),
        clientMessageId,
      ),
    );
    const thread = openThreadKey(registry, channelId);
    if (!thread) return;
    writeChannelThreadMessages(
      registry,
      channelId,
      thread.rootMessageId,
      removeOptimisticChannelMessage(
        registry.get(channelThreadMessagesAtom(thread.key)),
        clientMessageId,
      ),
    );
  });
}

/** Applies a delete response to both surfaces, refreshed parent summary included. */
export function applyChannelMessageDeletionToChannel(
  registry: AtomRegistry,
  channelId: string,
  messageId: string,
  response: DeleteChannelMessageResponse,
): void {
  Atom.batch(() => {
    writeChannelTimeline(
      registry,
      channelId,
      applyChannelMessageDeletion(
        registry.get(channelRootMessagesAtom(channelId)),
        messageId,
        response,
      ),
    );
    const thread = openThreadKey(registry, channelId);
    if (!thread) return;
    writeChannelThreadMessages(
      registry,
      channelId,
      thread.rootMessageId,
      applyChannelMessageDeletion(
        registry.get(channelThreadMessagesAtom(thread.key)),
        messageId,
        response,
      ),
    );
  });
}

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

/**
 * Replaces the channel's agent replies outright, keeping the object of every
 * reply that did not move. The tombstone rules belong to the entry points
 * above; this is for the two places that drop replies rather than merge them —
 * opening a channel, and deleting the message a reply answered.
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

/** The thread open in one channel, which the views reset as a channel opens. */
export function writeChannelOpenThreadId(
  registry: AtomRegistry,
  channelId: string,
  rootMessageId: string | null,
): void {
  registry.set(channelOpenThreadIdAtom(channelId), rootMessageId);
}

/**
 * Drops the per-channel flags a newly opened channel starts clean with.
 *
 * The write flags are not among them any more. "A send is running", "this
 * proposal is being approved" and the thread subscribe toggle are the request's
 * own state now, and a request that is still going is not something a fresh
 * view may declare finished — it goes down when the request does, and a request
 * that was never started reads as not running to begin with.
 */
export function resetChannelConversationViewState(
  registry: AtomRegistry,
  channelId: string,
): void {
  Atom.batch(() => {
    registry.set(channelThreadLoadingAtom(channelId), false);
    registry.set(channelEarlierMessagesLoadingAtom(channelId), false);
    registry.set(channelProposalProjectsAtom(channelId), {});
    registry.set(channelOpenThreadIdAtom(channelId), null);
  });
}
