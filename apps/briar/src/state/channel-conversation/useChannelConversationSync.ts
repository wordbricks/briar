import { useEffect, useRef } from "react";

import { channelReplyErrorText } from "../../lib/channel-reply-error";
import type {
  ChannelAgentReply,
  ChannelDelta,
  ChannelMessage,
  ChannelSummary,
} from "../../lib/channels-contract";
import { useI18n } from "../../i18n";
import { useToast } from "../../components/ui/toast";
import { subscribeToChannelDelta } from "../channels/delta";
import { useRegistry } from "../registry";
import {
  applyIncomingChannelAgentReplies,
  applyIncomingChannelMessages,
} from "./incoming";
import { useChannelConversationLoader } from "./loader";

/*
  What the open conversation does with a page the catalog loop pulled.

  This was an effect inside `hooks/use-channel-conversation.ts` that opened its
  own realtime transport and drained its own `loadChannelDelta` pages from a
  cursor the view held — a second loop against the endpoint
  `state/channels/useChannelCatalogSync.ts` was already polling, and a third in
  the companion shell. They raced: a page one loop consumed advanced only that
  loop's cursor, so the others asked for it again, and the conversation's
  `isBlocked` guard dropped pages the catalog had already moved past.

  There is one loop now and this subscribes to it. What is left here is what the
  conversation does with a page: the messages and agent replies of the open
  channel through `applySyncEvent`, the "the channel I am showing is gone"
  fallback, and the scroll cue. The `isBlocked` guard is gone with the loop —
  what it protected against was a delta being overwritten by a detail response
  that started earlier, and the store's own rules cover that now: a revisit
  merges rather than replaces, and a page for a channel whose timeline has never
  been read is not turned into a timeline with a hole in it.
*/

export type ChannelConversationRealtimeOptions = {
  readonly enabled: boolean;
  /** The channel whose conversation the pages should reach, if any. */
  readonly channelId: string | null;
  /** Direct messages render replies in the single timeline rather than a thread. */
  readonly includeRepliesInRoot?: boolean;
  /** The catalog the view keeps for itself, where it still keeps one. */
  readonly onCatalogDelta?: (delta: ChannelDelta) => void;
  readonly onSelectedChannelRemoved: () => void;
  readonly onSelectedChannelSummary?: (channel: ChannelSummary) => void;
  /** New root messages arrived, which is what decides the scroll. */
  readonly onIncomingRootMessages?: (messages: ChannelMessage[]) => void;
};

export function useChannelConversationSync(
  options: ChannelConversationRealtimeOptions | undefined,
): void {
  const registry = useRegistry();
  const loader = useChannelConversationLoader();
  const { t } = useI18n();
  const { toast } = useToast();

  /*
    The listener reads its options from a ref rather than closing over them, so
    a callback the view rebuilt does not re-register it: the subscription is set
    up once and lives as long as the view.
  */
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const replyFailureRef = useRef<(error: ChannelAgentReply["error"]) => string>(
    () => "",
  );
  replyFailureRef.current = (error) =>
    t("run.briarReplyFailed", {
      error: channelReplyErrorText(error, {
        fallback: t("run.failed"),
        noAvailableWorker: t("agents.agentWorkerUnavailable"),
        usageExhausted: t("agents.agentUsageExhausted"),
      }),
    });

  useEffect(() =>
    subscribeToChannelDelta(registry, (delta) => {
      const current = optionsRef.current;
      if (!current?.enabled) return;
      current.onCatalogDelta?.(delta);

      const channelId = current.channelId;
      if (!channelId) return;
      const summary = delta.channels.find((item) => item.id === channelId);
      if (
        delta.removedChannelIds.includes(channelId) ||
        (delta.reset && !summary)
      ) {
        loader.invalidateSurface(null, null);
        current.onSelectedChannelRemoved();
        return;
      }
      if (summary) current.onSelectedChannelSummary?.(summary);

      const messages = delta.messages.filter(
        (item) => item.channelId === channelId,
      );
      const rootMessages = current.includeRepliesInRoot
        ? messages
        : messages.filter((item) => item.parentMessageId === null);
      if (!delta.reset && rootMessages.length > 0) {
        current.onIncomingRootMessages?.(rootMessages);
      }
      applyIncomingChannelMessages(
        registry,
        channelId,
        messages,
        delta.removedMessageIds,
        current.includeRepliesInRoot ?? false,
        delta.reset,
      );
      const failed = applyIncomingChannelAgentReplies(
        registry,
        channelId,
        delta.agentReplies.filter((item) => item.channelId === channelId),
        delta.reset,
      );
      if (failed) {
        toast(replyFailureRef.current(failed.error), { tone: "error" });
      }
    }), [loader, registry, toast]);
}
