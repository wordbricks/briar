import type { ChannelAgentReply, ChannelMessage } from "../../lib/channels-contract";
import type { AtomRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import { channelAgentRepliesAtom } from "./atoms";
import { getChannelConversationLoader } from "./loader";
import { getChannelReplyLedger } from "./reply-ledger";

/*
  The two entry points a page of server-pushed conversation data goes through.

  A realtime delta, a send response and an accepted proposal all deliver the
  same two things — messages and agent replies — and every one of them has to
  record the proposals it carried, advance the reply ledger, and land in the
  store through `applySyncEvent`. `use-channel-conversation.ts` had one copy of
  that in `applyIncomingMessages` / `applyAgentReplies`; these are it.

  The one thing the store cannot decide is whether a failure is *new*, because
  the merge has already replaced the reply by the time anyone could compare. So
  {@link applyIncomingChannelAgentReplies} answers that question for the caller
  and leaves raising the toast to whoever has a toast to raise.
*/

/** Applies a page of messages to one channel's timeline and stored threads. */
export function applyIncomingChannelMessages(
  registry: AtomRegistry,
  channelId: string,
  incoming: readonly ChannelMessage[],
  removedMessageIds: readonly string[],
  includeRepliesInRoot: boolean,
  reset: boolean,
): void {
  const relevant = incoming.filter((item) => item.channelId === channelId);
  getChannelConversationLoader(registry).recordProposalMessages(relevant);
  applySyncEvent(registry, {
    kind: "channel-messages-page",
    channelId,
    messages: relevant,
    removedMessageIds,
    reset,
    includeRepliesInRoot,
  });
}

/**
 * Merges agent replies into one channel and reports the reply that *became*
 * failed, which is the only one worth telling the reader about.
 */
export function applyIncomingChannelAgentReplies(
  registry: AtomRegistry,
  channelId: string,
  incoming: readonly ChannelAgentReply[],
  reset: boolean,
): ChannelAgentReply | null {
  if (incoming.length === 0 && !reset) return null;
  const previousById = new Map(
    registry.get(channelAgentRepliesAtom(channelId)).map((item) => [item.id, item]),
  );
  getChannelReplyLedger(registry).note(channelId, incoming);
  applySyncEvent(registry, {
    kind: "channel-agent-replies-changed",
    channelId,
    replies: incoming,
    reset,
  });
  const failed = incoming.find(
    (reply) => reply.channelId === channelId && reply.status === "failed",
  );
  if (!failed) return null;
  return previousById.get(failed.id)?.status === "failed" ? null : failed;
}
