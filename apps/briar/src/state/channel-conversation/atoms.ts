import * as Option from "effect/Option";
import * as Atom from "effect/unstable/reactivity/Atom";

import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
} from "../../lib/channels-contract";
import { shallowArrayEqual } from "../entities/upsert";
import {
  channelReplyIsPending,
  summarizeChannelMessages,
  type ChannelMessageSummary,
} from "./model";

/*
  One channel's conversation, normalized.

  The messages used to be a `useState` array inside `Channels` and another
  inside `CompanionChannels`, with a per-instance `Map` beside each one so that
  leaving a channel and coming back did not start from an empty screen. Both
  copies are this store now: the map is the cache, the id arrays are the order,
  and the per-message family is what lets a row subscribe to its own message
  rather than to the timeline it sits in.

  Everything is keyed by channel, so the two views share what they load and the
  desktop view no longer refetches a channel it rendered a moment ago. The
  bound on that sharing is {@link retainedConversationChannelIdsAtom}: an LRU
  over channels, the same shape `entities/retention.ts` gives teams.
*/

/** The shared empty collections every "nothing here yet" branch returns. */
const noMessages: ChannelMessage[] = [];
const noMembers: ChannelMember[] = [];
const noAgents: ChannelAgentSummary[] = [];
const noReplies: ChannelAgentReply[] = [];
const noSummaries: ChannelMessageSummary[] = [];

/*
  `Atom.family` takes one key, so the families below that need two axes join
  them with a NUL. Written as an escape sequence on purpose: a literal NUL byte
  in the source is invisible and survives copy-paste (Phase 2C learned this the
  hard way with the board keys).
*/
const keySeparator = "\u0000";

/** The family key of one message inside one channel. */
export const channelMessageKey = (channelId: string, messageId: string): string =>
  `${channelId}${keySeparator}${messageId}`;

/** The family key of one thread, named by its root message. */
export const channelThreadKey = (
  channelId: string,
  rootMessageId: string,
): string => `${channelId}${keySeparator}${rootMessageId}`;

/** Splits either key back into its two parts. */
export const splitChannelKey = (
  key: string,
): { readonly channelId: string; readonly messageId: string } => {
  const index = key.indexOf(keySeparator);
  return index < 0
    ? { channelId: key, messageId: "" }
    : {
        channelId: key.slice(0, index),
        messageId: key.slice(index + keySeparator.length),
      };
};

/*
  The stored half. Only `state/sync/apply.ts` writes these.
*/

/**
 * Every message of one channel by id — roots and thread replies together, the
 * way the server's delta pages deliver them. The order lives in the two index
 * atoms below.
 */
export const channelMessagesByIdAtom = Atom.family((channelId: string) =>
  Atom.make<ReadonlyMap<string, ChannelMessage>>(new Map()).pipe(
    Atom.keepAlive,
    Atom.withLabel(`channelConversation/${channelId}/messagesById`),
  ),
);

/**
 * The channel's root timeline in render order, oldest first, or `null` while
 * the channel has never been loaded. A list subscribes to this and to nothing
 * else, so an edit inside one message cannot re-render the container.
 */
export const channelRootMessageIdsAtom = Atom.family((channelId: string) =>
  Atom.make<string[] | null>(null).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[] | null>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/rootIds`),
  ),
);

/**
 * One thread in render order, root first, or `null` while it has never been
 * opened. Keyed by {@link channelThreadKey}.
 */
export const channelThreadMessageIdsAtom = Atom.family((threadKey: string) =>
  Atom.make<string[] | null>(null).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[] | null>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${threadKey}/threadIds`),
  ),
);

/**
 * The thread roots this channel holds messages for, most recently opened last.
 * `Atom.family` cannot be enumerated, so dropping a channel needs this list to
 * know which thread entries exist — and it is what bounds them.
 */
export const channelThreadRootIdsAtom = Atom.family((channelId: string) =>
  Atom.make<string[]>([]).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/threadRoots`),
  ),
);

/** The channel's members, as its last load reported them. */
export const channelMembersAtom = Atom.family((channelId: string) =>
  Atom.make<ChannelMember[]>(noMembers).pipe(
    Atom.keepAlive,
    Atom.withEquality<ChannelMember[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/members`),
  ),
);

/** The agents that can answer in the channel. */
export const channelAgentsAtom = Atom.family((channelId: string) =>
  Atom.make<ChannelAgentSummary[]>(noAgents).pipe(
    Atom.keepAlive,
    Atom.withEquality<ChannelAgentSummary[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/agents`),
  ),
);

/**
 * The agent replies in flight or lately settled for the channel. This is what
 * the typing strip renders: the app has no per-user typing signal, an agent
 * that is "typing" is a queued or running reply.
 */
export const channelAgentRepliesAtom = Atom.family((channelId: string) =>
  Atom.make<ChannelAgentReply[]>(noReplies).pipe(
    Atom.keepAlive,
    Atom.withEquality<ChannelAgentReply[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/agentReplies`),
  ),
);

/**
 * The replies a newer authoritative answer already settled. A page that started
 * before that answer may not resurrect one of them: it is describing a moment
 * the channel has already left.
 */
export const channelSettledAgentReplyIdsAtom = Atom.family((channelId: string) =>
  Atom.make<string[]>([]).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/settledReplyIds`),
  ),
);

/** The cursor the next page of older messages resumes from, if there is one. */
export const channelMessageCursorAtom = Atom.family((channelId: string) =>
  Atom.make<string | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`channelConversation/${channelId}/cursor`),
  ),
);

/*
  The derived half.
*/

/**
 * One message of one channel, or `null` when the channel no longer holds it.
 * Keyed by {@link channelMessageKey}; a row reads this and re-renders only when
 * its own message moves.
 */
export const channelMessageAtom = Atom.family((key: string) => {
  const { channelId, messageId } = splitChannelKey(key);
  return Atom.map(
    channelMessagesByIdAtom(channelId),
    (messages) => messages.get(messageId) ?? null,
  ).pipe(Atom.withLabel(`channelConversation/${key}/message`));
});

/*
  Resolution keeps whatever reference the map holds, and the map keeps the
  reference of every message a page re-sent unchanged (`upsertMany`), so the
  identity a row compares against survives a page that changed one message.
*/
const resolveMessages = (
  ids: readonly string[] | null,
  messages: ReadonlyMap<string, ChannelMessage>,
) => {
  if (!ids) return noMessages;
  const resolved: ChannelMessage[] = [];
  for (const id of ids) {
    const message = messages.get(id);
    if (message) resolved.push(message);
  }
  return resolved;
};

/** The channel's root timeline resolved against the store. */
export const channelRootMessagesAtom = Atom.family((channelId: string) =>
  Atom.make((get): ChannelMessage[] =>
    resolveMessages(
      get(channelRootMessageIdsAtom(channelId)),
      get(channelMessagesByIdAtom(channelId)),
    ),
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<ChannelMessage[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/rootMessages`),
  ),
);

/** One thread resolved against the store, keyed by {@link channelThreadKey}. */
export const channelThreadMessagesAtom = Atom.family((threadKey: string) => {
  const { channelId } = splitChannelKey(threadKey);
  return Atom.make((get): ChannelMessage[] =>
    resolveMessages(
      get(channelThreadMessageIdsAtom(threadKey)),
      get(channelMessagesByIdAtom(channelId)),
    ),
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<ChannelMessage[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${threadKey}/threadMessages`),
  );
});

/**
 * The root timeline as the list reads it: what it needs to key rows, draw day
 * separators and group consecutive authors, and nothing else. An edit inside a
 * message leaves every summary equal, so the list is not woken at all.
 */
export const channelRootMessageSummariesAtom = Atom.family((channelId: string) =>
  Atom.make((get): ChannelMessageSummary[] =>
    summarizeChannelMessages(
      Option.getOrElse(
        get.self<ChannelMessageSummary[]>(),
        (): ChannelMessageSummary[] => noSummaries,
      ),
      get(channelRootMessagesAtom(channelId)),
    ),
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<ChannelMessageSummary[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/rootSummaries`),
  ),
);

/** Whether the channel has ever been loaded into the store. */
export const channelConversationLoadedAtom = Atom.family((channelId: string) =>
  Atom.map(
    channelRootMessageIdsAtom(channelId),
    (ids) => ids !== null,
  ).pipe(Atom.withLabel(`channelConversation/${channelId}/loaded`)),
);

/** The replies of the channel that are still going to produce something. */
export const channelPendingAgentRepliesAtom = Atom.family((channelId: string) =>
  Atom.make((get): ChannelAgentReply[] =>
    get(channelAgentRepliesAtom(channelId)).filter(channelReplyIsPending),
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<ChannelAgentReply[]>(shallowArrayEqual),
    Atom.withLabel(`channelConversation/${channelId}/pendingReplies`),
  ),
);

/*
  Retention.
*/

/**
 * How many channels keep their conversation in memory.
 *
 * The desktop view's cache was unbounded and lived only as long as the mounted
 * component; the companion view's held five channels. Five is the tighter of
 * the two and the one that was chosen for a phone, so it is the shared bound.
 */
export const CHANNEL_CONVERSATION_RETENTION_LIMIT = 5;

/** How many threads of one channel keep their messages. */
export const CHANNEL_THREAD_RETENTION_LIMIT = 5;

/**
 * The channels holding a conversation, least recently opened first. Written
 * only by `state/sync/apply.ts`, which drops whatever falls off the front.
 */
export const retainedConversationChannelIdsAtom = Atom.make<string[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("channelConversation/retainedChannels"),
);

/**
 * Moves `id` to the most recent end of `current` and reports what that pushed
 * past `limit`. Returns `current` unchanged when it was already the most recent
 * one, so a quiet delta tick does not churn the atom.
 */
export function touchRetained(current: string[], id: string, limit: number) {
  if (current.at(-1) === id) {
    return { retained: current, evicted: [] as string[] };
  }
  const next = current.filter((candidate) => candidate !== id);
  next.push(id);
  const overflow = Math.max(0, next.length - limit);
  return { retained: next.slice(overflow), evicted: next.slice(0, overflow) };
}
