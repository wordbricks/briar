import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
} from "../../lib/channels-contract";
import { useRegistry, type AtomRegistry } from "../registry";
import {
  channelAgentRepliesAtom,
  channelAgentsAtom,
  channelMembersAtom,
  channelMessageCursorAtom,
  channelOpenThreadIdAtom,
  channelRootMessagesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
} from "./atoms";
import {
  resetChannelConversationViewState,
  writeChannelAgentReplies,
  writeChannelDeltaToStoredThreads,
  writeChannelMessageCursor,
  writeChannelOpenThreadId,
  writeChannelParticipants,
  writeChannelThreadMessages,
  writeChannelTimeline,
} from "./write";

/*
  What the two conversation views hold instead of `useState`.

  Both of them owned the whole conversation — messages, thread, participants,
  agent replies, cursor — and both kept a second copy beside it so that leaving
  a channel and coming back did not start from an empty screen: the desktop view
  an unbounded `useRef` map, the companion view a five entry LRU with its own
  bounding rules. Two copies of the same channel, neither shared, and a channel
  reopened in the other view fetched again from scratch.

  This hook is the replacement. The state is `state/channel-conversation`'s
  store, so the two views read the same messages, the cache *is* the store
  (bounded once, in one place), and a row can subscribe to its own message.

  The updater shape is deliberate and temporary. `use-channel-conversation.ts`
  still decides what the next timeline is — it holds the request ordering rules
  and calls the merge helpers — and hands the result to whatever updater it was
  given. Making that updater a store write is what let the caches go without
  moving 1,800 lines of request ordering in the same change; follow-up F5-3
  moves that half into `actions.ts` and this shape disappears with it.
*/

/** A `useState`-style updater, which is what the conversation hook expects. */
type Update<A> = A | ((current: A) => A);

const resolve = <A,>(update: Update<A>, current: A): A =>
  typeof update === "function" ? (update as (value: A) => A)(current) : update;

/** The store writes one conversation view makes, bound to its open channel. */
export interface ChannelConversationStore {
  /** The channel these writers address, or `""` when none is open. */
  readonly channelId: string;
  readonly updateRootMessages: (
    update: (current: ChannelMessage[]) => ChannelMessage[],
  ) => void;
  readonly updateThreadMessages: (
    update: (current: ChannelMessage[]) => ChannelMessage[],
  ) => void;
  readonly setMembers: (update: Update<ChannelMember[]>) => void;
  readonly setAgents: (update: Update<ChannelAgentSummary[]>) => void;
  readonly setReplies: (update: Update<ChannelAgentReply[]>) => void;
  readonly setThreadParentId: (update: Update<string | null>) => void;
  readonly setMessageNextCursor: (update: Update<string | null>) => void;
  /** Applies a delta page to the threads this channel holds but is not showing. */
  readonly applyDeltaToStoredThreads: (
    messages: readonly ChannelMessage[],
    removedMessageIds: readonly string[],
    reset: boolean,
  ) => void;
  /** Drops the per-channel flags a newly opened channel starts clean with. */
  readonly resetViewState: (channelId: string) => void;
}

/**
 * Reads the thread a channel has open. Kept in the store rather than in the
 * view because the updater below has to see it in the same synchronous step
 * that opens it — `openThread` sets the id and writes the thread's messages one
 * after the other, and a `useState` value is a render behind.
 */
export function readChannelOpenThreadId(
  registry: AtomRegistry,
  channelId: string,
): string | null {
  return channelId ? registry.get(channelOpenThreadIdAtom(channelId)) : null;
}

/** The store writers for `channelId`, stable while that channel stays open. */
export function useChannelConversationStore(
  channelId: string | null,
): ChannelConversationStore {
  const registry = useRegistry();
  return useMemo<ChannelConversationStore>(() => {
    const id = channelId ?? "";
    const threadKeyOf = () =>
      channelThreadKey(id, readChannelOpenThreadId(registry, id) ?? "");
    return {
      channelId: id,
      updateRootMessages: (update) => {
        if (!id) return;
        writeChannelTimeline(
          registry,
          id,
          update(registry.get(channelRootMessagesAtom(id))),
        );
      },
      updateThreadMessages: (update) => {
        const rootMessageId = readChannelOpenThreadId(registry, id);
        if (!id || !rootMessageId) return;
        writeChannelThreadMessages(
          registry,
          id,
          rootMessageId,
          update(registry.get(channelThreadMessagesAtom(threadKeyOf()))),
        );
      },
      setMembers: (update) => {
        if (!id) return;
        writeChannelParticipants(registry, id, {
          members: resolve(update, registry.get(channelMembersAtom(id))),
        });
      },
      setAgents: (update) => {
        if (!id) return;
        writeChannelParticipants(registry, id, {
          agents: resolve(update, registry.get(channelAgentsAtom(id))),
        });
      },
      setReplies: (update) => {
        if (!id) return;
        writeChannelAgentReplies(
          registry,
          id,
          resolve(update, registry.get(channelAgentRepliesAtom(id))),
        );
      },
      setThreadParentId: (update) => {
        if (!id) return;
        writeChannelOpenThreadId(
          registry,
          id,
          resolve(update, registry.get(channelOpenThreadIdAtom(id))),
        );
      },
      setMessageNextCursor: (update) => {
        if (!id) return;
        writeChannelMessageCursor(
          registry,
          id,
          resolve(update, registry.get(channelMessageCursorAtom(id))),
        );
      },
      applyDeltaToStoredThreads: (messages, removedMessageIds, reset) => {
        if (!id) return;
        writeChannelDeltaToStoredThreads(
          registry,
          id,
          messages,
          removedMessageIds,
          reset,
        );
      },
      resetViewState: (target) =>
        resetChannelConversationViewState(registry, target),
    };
  }, [channelId, registry]);
}

/**
 * The conversation of `channelId` as a view renders it. `null` reads as "no
 * channel open" and subscribes to nothing that moves, which is the empty-key
 * idiom the board views use for a closed dialog.
 */
export function useChannelConversationView(channelId: string | null) {
  const id = channelId ?? "";
  const messages = useAtomValue(channelRootMessagesAtom(id));
  const members = useAtomValue(channelMembersAtom(id));
  const agents = useAtomValue(channelAgentsAtom(id));
  const replies = useAtomValue(channelAgentRepliesAtom(id));
  const messageNextCursor = useAtomValue(channelMessageCursorAtom(id));
  const threadParentId = useAtomValue(channelOpenThreadIdAtom(id));
  const threadMessages = useAtomValue(
    channelThreadMessagesAtom(channelThreadKey(id, threadParentId ?? "")),
  );
  return {
    agents,
    members,
    messageNextCursor,
    messages,
    replies,
    threadMessages,
    threadParentId,
  };
}
