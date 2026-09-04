import { useAtomValue } from "@effect/atom-react";

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

/*
  What a conversation view reads.

  Both views owned the whole conversation — messages, thread, participants,
  agent replies, cursor — and both kept a second copy beside it so that leaving
  a channel and coming back did not start from an empty screen: the desktop view
  an unbounded `useRef` map, the companion view a five entry LRU with its own
  bounding rules. Two copies of the same channel, neither shared, and a channel
  reopened in the other view fetched again from scratch.

  This is what replaced them. The state is `state/channel-conversation`'s store,
  so the two views read the same messages and the cache *is* the store, bounded
  once in one place. The `useState`-shaped writers that stood beside this hook
  while the conversation logic was still in `hooks/use-channel-conversation.ts`
  are gone with it: `actions.ts` and `loader.ts` write the store directly.
*/

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
