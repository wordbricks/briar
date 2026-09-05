import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMessage,
} from "../../lib/channels-contract";
import type {
  ChannelAgentActivityDescriptor,
  ChannelAgentActivityFrame,
} from "../../lib/channel-agent-activity";

/*
  The pure half of a channel conversation.

  Everything here is a function of its arguments: merging a cursor page into a
  timeline, folding an optimistic reply into its parent's summary, deciding
  which agent reply supersedes which, and naming the agents a typing strip
  shows. `use-channel-conversation.ts` kept these next to its `useState`
  closures, which is why none of them had a test of their own.

  The merge itself still lives in `lib/channel-message-merge.ts` and the
  deletion in `lib/channel-message-deletion.ts`: both are imported by views
  that have nothing to do with the store, and moving them would have been a
  wider diff than pointing at them from here.
*/

export {
  mergeChannelMessages,
  mergeChannelMessageSnapshot,
} from "../../lib/channel-message-merge";
export { applyChannelMessageDeletion } from "../../lib/channel-message-deletion";

/** The message describing a failed conversation request. */
export function channelConversationError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * An author's identity across message objects. Users are keyed by account,
 * falling back to the address and then the display name for the partial authors
 * a webhook or an agent produces.
 */
export const channelAuthorId = (author: ChannelMessage["author"]): string =>
  author.type === "user"
    ? `user:${author.id || author.email || author.name}`
    : `${author.type}:${author.id ?? author.name}`;

/** A reply that will not change again. */
export const channelReplyIsTerminal = (reply: ChannelAgentReply): boolean =>
  reply.status === "completed" || reply.status === "failed";

const channelReplyStatusRank = (reply: ChannelAgentReply) => {
  if (channelReplyIsTerminal(reply)) return 2;
  return reply.status === "running" ? 1 : 0;
};

/**
 * Whether `incoming` supersedes `current`. A terminal reply always wins over a
 * running one, then the newer `updatedAt`, then the further-along status — so a
 * page that arrives out of order cannot walk a finished reply backwards.
 */
export const channelReplyShouldReplace = (
  current: ChannelAgentReply,
  incoming: ChannelAgentReply,
): boolean => {
  const currentTerminal = channelReplyIsTerminal(current);
  const incomingTerminal = channelReplyIsTerminal(incoming);
  if (currentTerminal !== incomingTerminal) return incomingTerminal;
  if (incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  return channelReplyStatusRank(incoming) > channelReplyStatusRank(current);
};

/**
 * Merges agent replies under {@link channelReplyShouldReplace}. `tombstones`
 * names replies a newer authoritative answer already settled, so a stale page
 * cannot resurrect one that finished.
 */
export function mergeChannelReplies(
  current: readonly ChannelAgentReply[],
  incoming: readonly ChannelAgentReply[],
  tombstones: ReadonlySet<string> = new Set(),
): ChannelAgentReply[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (tombstones.has(item.id) && !channelReplyIsTerminal(item)) continue;
    const previous = byId.get(item.id);
    if (!previous || channelReplyShouldReplace(previous, item)) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

/**
 * The parent as it renders once `reply` exists: one more reply, a newer last
 * reply time, and the reply's author at the front of the three-avatar strip.
 */
export const appendReplySummary = (
  parent: ChannelMessage,
  reply: ChannelMessage,
): ChannelMessage => {
  const replyAuthors: ChannelMessage["replyAuthors"] = [];
  const seen = new Set<string>();
  for (const author of [reply.author, ...parent.replyAuthors]) {
    const id = channelAuthorId(author);
    if (seen.has(id)) continue;
    seen.add(id);
    replyAuthors.push(author);
    if (replyAuthors.length === 3) break;
  }
  return {
    ...parent,
    replyCount: parent.replyCount + 1,
    lastReplyAt: reply.createdAt,
    replyAuthors,
  };
};

/** The parent as it renders once a failed optimistic reply is taken back. */
export const removeReplySummary = (
  parent: ChannelMessage,
  reply: ChannelMessage,
  before: Pick<ChannelMessage, "lastReplyAt" | "replyAuthors"> | null,
): ChannelMessage => ({
  ...parent,
  replyCount: Math.max(0, parent.replyCount - 1),
  ...(parent.lastReplyAt === reply.createdAt
    ? {
        lastReplyAt: before?.lastReplyAt ?? null,
        replyAuthors: before?.replyAuthors ?? [],
      }
    : {}),
});

/** The distinct agent names replying under any of `messageIds`. */
export const typingAgentNamesForReplies = (
  replies: readonly ChannelAgentReply[],
  agents: readonly ChannelAgentSummary[],
  messageIds: ReadonlySet<string>,
  fallbackName: string,
): string[] => [
  ...new Set(
    replies
      .filter((reply) => messageIds.has(reply.parentMessageId))
      .map(
        (reply) =>
          agents.find((agent) => agent.agentId === reply.agentId)?.name ??
          fallbackName,
      ),
  ),
];

/**
 * What this module reads of a live activity frame. Narrower than
 * `ChannelAgentActivityFrame` on purpose: the typing strip needs the headline
 * and the attempt it belongs to, not the transport envelope around them.
 */
export type ChannelAgentActivityAttempt = Pick<
  ChannelAgentActivityFrame,
  "attempt" | "activity"
>;

/**
 * The live activity frame of each replying agent, keyed by the name the typing
 * strip shows. A frame from an earlier attempt is dropped: it describes work
 * that is no longer running.
 */
export const activityForReplies = (
  replies: readonly ChannelAgentReply[],
  agents: readonly ChannelAgentSummary[],
  activity: ReadonlyMap<string, ChannelAgentActivityAttempt>,
  fallbackName: string,
) => {
  const result: Record<string, ChannelAgentActivityDescriptor> = {};
  for (const reply of replies) {
    const frame = activity.get(reply.id);
    if (!frame?.activity || frame.attempt !== reply.attempts) continue;
    const name =
      agents.find((agent) => agent.agentId === reply.agentId)?.name ??
      fallbackName;
    result[name] = frame.activity;
  }
  return result;
};

/**
 * The distinct agents replying under any of `messageIds`, with avatar, provider,
 * and the reply's `createdAt` for placeholder-row timestamps.
 */
export interface TypingAgentDescriptor {
  readonly name: string;
  readonly avatar: string | null;
  readonly provider: ChannelAgentSummary["provider"];
  readonly createdAt: string;
}

export const typingAgentsForReplies = (
  replies: readonly ChannelAgentReply[],
  agents: readonly ChannelAgentSummary[],
  messageIds: ReadonlySet<string>,
  fallbackName: string,
): TypingAgentDescriptor[] => {
  const seen = new Set<string>();
  const result: TypingAgentDescriptor[] = [];
  for (const reply of replies) {
    if (!messageIds.has(reply.parentMessageId)) continue;
    const key = reply.agentId;
    if (seen.has(key)) continue;
    seen.add(key);
    const agent = agents.find((a) => a.agentId === reply.agentId);
    result.push({
      name: agent?.name ?? fallbackName,
      avatar: agent?.avatar ?? null,
      provider: agent?.provider ?? "claude",
      createdAt: reply.createdAt,
    });
  }
  return result;
};

/** A reply that is still going to produce something. */
export const channelReplyIsPending = (reply: ChannelAgentReply): boolean =>
  reply.status === "queued" || reply.status === "running";

/**
 * The ids a thread's typing strip watches: the root and everything under it.
 */
export const threadMessageIdSet = (
  rootMessageId: string | null,
  threadMessages: readonly ChannelMessage[],
): ReadonlySet<string> =>
  rootMessageId
    ? new Set([rootMessageId, ...threadMessages.map((item) => item.id)])
    : new Set<string>();

/**
 * What a message list needs to group, separate and key its rows — and nothing
 * else, so an edit inside a message never reaches the list itself.
 */
export interface ChannelMessageSummary {
  readonly id: string;
  readonly channelId: string;
  readonly createdAt: string;
  readonly authorId: string;
  readonly parentMessageId: string | null;
  readonly optimistic: boolean;
}

const sameChannelMessageSummary = (
  left: ChannelMessageSummary,
  right: ChannelMessageSummary,
) =>
  left.id === right.id &&
  left.channelId === right.channelId &&
  left.createdAt === right.createdAt &&
  left.authorId === right.authorId &&
  left.parentMessageId === right.parentMessageId &&
  left.optimistic === right.optimistic;

/** {@link ChannelMessageSummary} for a whole timeline, reusing every entry. */
export function summarizeChannelMessages(
  previous: readonly ChannelMessageSummary[],
  messages: readonly ChannelMessage[],
): ChannelMessageSummary[] {
  const previousById = new Map(
    previous.map((summary) => [summary.id, summary]),
  );
  return messages.map((message) => {
    const next: ChannelMessageSummary = {
      id: message.id,
      channelId: message.channelId,
      createdAt: message.createdAt,
      authorId: channelAuthorId(message.author),
      parentMessageId: message.parentMessageId,
      optimistic: Boolean(message.optimistic),
    };
    const stored = previousById.get(next.id);
    return stored && sameChannelMessageSummary(stored, next) ? stored : next;
  });
}
