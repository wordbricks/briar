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

  The app has no per-user typing signal, so two things say an agent is working:
  the durable reply row (queued or running) and a commentary frame from the
  channel's activity socket. The two surfaces weigh them differently.

  A channel shows the reply row on its own — "{name} is writing a reply…" — and
  upgrades that line to "{name} · {headline}" once a frame arrives. It has to:
  a runner is free to publish no commentary at all (a Codex-backed agent
  answered a mention after two minutes having published nothing), and on a
  channel that silence would otherwise be indistinguishable from the mention
  having been dropped.

  A DM shows only the frame. Its progress is a placeholder message row of its
  own — `ChannelTypingPlaceholder.tsx` — where an empty "is writing a reply…"
  row would be a message-shaped promise with nothing in it, so a reply without
  commentary stays silent there. That is why `ChannelThreadTypingStrip` takes
  `showPendingReplyNames` rather than deciding for itself: the DM surface can
  open the shared thread panel too.

  These two components subscribe instead of taking a `replies` prop, which
  `use-channel-conversation.ts` once handed down per row — a reply tick, one
  every few seconds while an agent works, re-rendered the whole conversation to
  move a three-word line. A tick now reaches the strip under the message it
  belongs to and nothing else, which is what `Channels.typing-strip.test.tsx`
  pins.
*/

/**
 * The agents answering one root message.
 *
 * Channels only: both call sites render it under `channel.kind !== "dm"`
 * (`Channels.tsx`, `CompanionChannels.tsx`), so the pending-reply names are
 * always wanted here and there is no flag to pass.
 */
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
  const activityByAgentName = activityForReplies(
    own,
    agents,
    activity,
    fallbackAgentName,
  );
  return (
    <ChannelTypingState
      activityByAgentName={activityByAgentName}
      className={className}
      pendingAgentNames={typingAgentNamesForReplies(
        own,
        agents,
        new Set([messageId]),
        fallbackAgentName,
      )}
    />
  );
}

/**
 * The agents answering anywhere inside the channel's open thread.
 *
 * `showPendingReplyNames` is the surface's answer, not this component's: the
 * panel is shared, and a DM row offers "reply in thread" like any other, so
 * only the caller knows whether a reply without commentary should be named.
 */
export function ChannelThreadTypingStrip({
  channelId,
  className,
  showPendingReplyNames,
}: {
  readonly channelId: string;
  readonly className?: string;
  readonly showPendingReplyNames: boolean;
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
  const activityByAgentName = activityForReplies(
    own,
    agents,
    activity,
    fallbackAgentName,
  );
  return (
    <ChannelTypingState
      activityByAgentName={activityByAgentName}
      className={className}
      pendingAgentNames={
        showPendingReplyNames
          ? typingAgentNamesForReplies(
              own,
              agents,
              messageIds,
              fallbackAgentName,
            )
          : []
      }
    />
  );
}
