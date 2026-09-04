import { useAtomValue } from "@effect/atom-react";

import { useI18n } from "../i18n";
import {
  channelAgentsAtom,
  channelMessageKey,
  channelMessagePendingRepliesAtom,
  channelOpenThreadIdAtom,
  channelPendingAgentRepliesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
} from "../state/channel-conversation/atoms";
import {
  channelAgentActivityAtom,
  channelMessageActivityAtom,
} from "../state/channel-conversation/activity";
import {
  activityForReplies,
  threadMessageIdSet,
  typingAgentNamesForReplies,
} from "../state/channel-conversation/model";
import { ChannelTypingState } from "./ChannelTypingState";

/*
  Who is answering, drawn where it is read.

  The app has no per-user typing signal: an agent that is "typing" is a queued
  or running reply, and the headline under its name is a frame from the
  channel's activity socket. `use-channel-conversation.ts` derived both from a
  `replies` prop and handed the result down as two props per row, so a reply
  tick — one every few seconds while an agent works — re-rendered the whole
  conversation to move a three-word line.

  These two components subscribe instead. A tick reaches the strip under the
  message it belongs to and nothing else, which is what
  `Channels.typing-strip.test.tsx` pins.
*/

/** The agents answering one root message. */
export function ChannelMessageTypingStrip({
  channelId,
  className,
  messageId,
}: {
  readonly channelId: string;
  readonly className?: string;
  readonly messageId: string;
}) {
  const { t } = useI18n();
  const key = channelMessageKey(channelId, messageId);
  const own = useAtomValue(channelMessagePendingRepliesAtom(key));
  const agents = useAtomValue(channelAgentsAtom(channelId));
  const activity = useAtomValue(channelMessageActivityAtom(key));
  const fallbackAgentName = t("channel.projectAgent");
  return (
    <ChannelTypingState
      agentNames={typingAgentNamesForReplies(
        own,
        agents,
        new Set([messageId]),
        fallbackAgentName,
      )}
      activityByAgentName={activityForReplies(
        own,
        agents,
        activity,
        fallbackAgentName,
      )}
      className={className}
    />
  );
}

/** The agents answering anywhere inside the channel's open thread. */
export function ChannelThreadTypingStrip({
  channelId,
  className,
}: {
  readonly channelId: string;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const replies = useAtomValue(channelPendingAgentRepliesAtom(channelId));
  const agents = useAtomValue(channelAgentsAtom(channelId));
  const activity = useAtomValue(channelAgentActivityAtom(channelId));
  const threadParentId = useAtomValue(channelOpenThreadIdAtom(channelId));
  const threadMessages = useAtomValue(
    channelThreadMessagesAtom(
      channelThreadKey(channelId, threadParentId ?? ""),
    ),
  );
  const fallbackAgentName = t("channel.projectAgent");
  const messageIds = threadMessageIdSet(threadParentId, threadMessages);
  const own = replies.filter((reply) => messageIds.has(reply.parentMessageId));
  return (
    <ChannelTypingState
      agentNames={typingAgentNamesForReplies(
        own,
        agents,
        messageIds,
        fallbackAgentName,
      )}
      activityByAgentName={activityForReplies(
        own,
        agents,
        activity,
        fallbackAgentName,
      )}
      className={className}
    />
  );
}
