import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo } from "react";

import type { ChannelAgentActivityDescriptor } from "../../lib/channel-agent-activity";
import { useChannelAgentActivity } from "../../hooks/use-channel-agent-activity";
import { useI18n } from "../../i18n";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { tokenAtom } from "../session/atoms";
import {
  channelAgentsAtom,
  channelOpenThreadIdAtom,
  channelPendingAgentRepliesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
} from "./atoms";
import {
  activityForReplies,
  threadMessageIdSet,
  typingAgentNamesForReplies,
} from "./model";

/*
  What the typing strips read.

  The app has no per-user typing signal: an agent that is "typing" is a queued
  or running reply, and the live headline under its name is a frame from the
  channel's activity socket. `use-channel-conversation.ts` derived all of it
  from the `replies` prop, which meant every reply tick re-rendered the whole
  conversation just to move a three-word line above the composer.

  Reading `channelPendingAgentRepliesAtom` instead makes the subscription the
  strip's own, so a tick reaches whatever renders this hook and nothing else.
  Mounting it in a leaf — `ChannelTypingStrip` rather than `Channels` — is what
  turns that into a component-level guarantee.
*/

export interface ChannelTypingView {
  /** The agents replying under one root message. */
  readonly typingAgentNames: (messageId: string) => string[];
  /** Their live activity headlines, keyed by the name the strip shows. */
  readonly typingActivityByAgentName: (
    messageId: string,
  ) => Record<string, ChannelAgentActivityDescriptor>;
  /** The agents replying anywhere inside the open thread. */
  readonly threadTypingAgentNames: string[];
  readonly threadActivityByAgentName: Record<
    string,
    ChannelAgentActivityDescriptor
  >;
}

export function useChannelConversationTyping(
  channelId: string | null,
  options: { readonly activityEnabled?: boolean } = {},
): ChannelTypingView {
  const { t } = useI18n();
  const id = channelId ?? "";
  const token = useAtomValue(tokenAtom);
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const pendingReplies = useAtomValue(channelPendingAgentRepliesAtom(id));
  const agents = useAtomValue(channelAgentsAtom(id));
  const threadParentId = useAtomValue(channelOpenThreadIdAtom(id));
  const threadMessages = useAtomValue(
    channelThreadMessagesAtom(channelThreadKey(id, threadParentId ?? "")),
  );
  const liveActivity = useChannelAgentActivity(
    token ?? "",
    organizationId ?? "",
    (options.activityEnabled ?? true) && channelId ? channelId : null,
  );
  const fallbackAgentName = t("channel.projectAgent");

  const threadMessageIds = useMemo(
    () => threadMessageIdSet(threadParentId, threadMessages),
    [threadMessages, threadParentId],
  );
  const threadPendingReplies = useMemo(
    () =>
      pendingReplies.filter((reply) =>
        threadMessageIds.has(reply.parentMessageId),
      ),
    [pendingReplies, threadMessageIds],
  );

  const typingAgentNames = useCallback(
    (messageId: string) =>
      typingAgentNamesForReplies(
        pendingReplies,
        agents,
        new Set([messageId]),
        fallbackAgentName,
      ),
    [agents, fallbackAgentName, pendingReplies],
  );
  const typingActivityByAgentName = useCallback(
    (messageId: string) =>
      activityForReplies(
        pendingReplies.filter((reply) => reply.parentMessageId === messageId),
        agents,
        liveActivity,
        fallbackAgentName,
      ),
    [agents, fallbackAgentName, liveActivity, pendingReplies],
  );
  const threadTypingAgentNames = useMemo(
    () =>
      typingAgentNamesForReplies(
        threadPendingReplies,
        agents,
        threadMessageIds,
        fallbackAgentName,
      ),
    [agents, fallbackAgentName, threadMessageIds, threadPendingReplies],
  );
  const threadActivityByAgentName = useMemo(
    () =>
      activityForReplies(
        threadPendingReplies,
        agents,
        liveActivity,
        fallbackAgentName,
      ),
    [agents, fallbackAgentName, liveActivity, threadPendingReplies],
  );

  return {
    threadActivityByAgentName,
    threadTypingAgentNames,
    typingActivityByAgentName,
    typingAgentNames,
  };
}
