import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, type MutableRefObject } from "react";

import {
  CHANNEL_REALTIME_FALLBACK_MS,
  MAX_CHANNEL_DELTA_PAGES_PER_SYNC,
} from "../../lib/channel-realtime";
import { channelReplyErrorText } from "../../lib/channel-reply-error";
import type {
  ChannelAgentReply,
  ChannelDelta,
  ChannelMessage,
  ChannelSummary,
} from "../../lib/channels-contract";
import { useI18n } from "../../i18n";
import { useToast } from "../../components/ui/toast";
import { resolveChannelApi } from "../channels/api";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  applyIncomingChannelAgentReplies,
  applyIncomingChannelMessages,
} from "./incoming";
import { useChannelConversationLoader } from "./loader";

/*
  The conversation's realtime transport.

  This was an effect inside `use-channel-conversation.ts`, keyed by token,
  organization and the open channel, pulling `loadChannelDelta` pages whenever
  the WebSocket says the `channels` topic moved. Everything about its lifetime
  is unchanged — the same visibility pause, the same 60s polling fallback, the
  same "drain until the cursor stops moving" loop, the same 20-page ceiling —
  because that timing is what keeps a channel opened while the socket is down
  still catching up.

  Two things did change. The messages and agent replies a page carries now go
  through `applySyncEvent` rather than through the view's setters, and the
  companion view's "apply this delta to the threads I am not showing" callback
  is gone: `channel-messages-page` walks every stored thread of the channel,
  which is the rule the companion cache implemented by hand.

  It stays a per-view hook rather than moving to `AppEffects` because it is
  scoped to the channel the view has open, and because the catalog callbacks
  below still belong to the view that owns the list. The separate catalog loop
  in `state/channels/useChannelCatalogSync.ts` polls the same endpoint from its
  own cursor; folding the two is the next follow-up.
*/

export type ChannelConversationRealtimeOptions = {
  readonly enabled: boolean;
  /** The channel whose conversation the pages should reach, if any. */
  readonly channelId: string | null;
  /** The catalog cursor the loop resumes from, owned by the view. */
  readonly catalogCursor: MutableRefObject<number>;
  readonly catalogReady: boolean;
  /** Changing this asks for one sync, which is how the inbox nudges a channel. */
  readonly syncSignal?: string;
  /** Direct messages render replies in the single timeline rather than a thread. */
  readonly includeRepliesInRoot?: boolean;
  /** While true the loop holds its place instead of advancing the cursor. */
  readonly isBlocked?: () => boolean;
  readonly onCatalogDelta: (delta: ChannelDelta) => void;
  readonly onSelectedChannelRemoved: () => void;
  readonly onSelectedChannelSummary?: (channel: ChannelSummary) => void;
  /** New root messages arrived, which is what decides the scroll. */
  readonly onIncomingRootMessages?: (messages: ChannelMessage[]) => void;
  readonly warningLabel: string;
};

export function useChannelConversationSync(
  options: ChannelConversationRealtimeOptions | undefined,
): void {
  const registry = useRegistry();
  const loader = useChannelConversationLoader();
  const { t } = useI18n();
  const { toast } = useToast();
  const token = useAtomValue(tokenAtom);
  const organizationId = useAtomValue(activeOrganizationIdAtom);

  /*
    The loop reads its options at await boundaries rather than closing over
    them, so a callback the view rebuilt while a page was in flight does not
    restart the transport.
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

  const enabled = options?.enabled ?? false;
  const catalogReady = options?.catalogReady ?? false;
  const syncSignal = options?.syncSignal;
  const channelId = options?.channelId ?? null;

  useEffect(() => {
    const initial = optionsRef.current;
    if (!initial?.enabled || !initial.catalogReady) return;
    if (!token || !organizationId) return;
    let stopped = false;
    let inFlight = false;
    let pending = false;
    let blockedRetry: number | null = null;
    const abortController = new AbortController();
    const api = resolveChannelApi(registry);
    const transport = api.createChannelRealtimeTransport(token, organizationId);

    const scheduleBlockedRetry = () => {
      if (blockedRetry !== null || stopped) return;
      blockedRetry = window.setTimeout(() => {
        blockedRetry = null;
        if (pending) void sync();
      }, 250);
    };

    const sync = async () => {
      pending = true;
      const current = optionsRef.current;
      if (
        !current?.enabled ||
        !current.catalogReady ||
        stopped ||
        document.hidden ||
        inFlight ||
        current.isBlocked?.()
      ) {
        if (current?.isBlocked?.()) scheduleBlockedRetry();
        return;
      }
      inFlight = true;
      try {
        while (pending && !stopped) {
          pending = false;
          for (
            let page = 0;
            page < MAX_CHANNEL_DELTA_PAGES_PER_SYNC;
            page += 1
          ) {
            const currentOptions = optionsRef.current;
            if (!currentOptions) return;
            const requestedCursor = currentOptions.catalogCursor.current;
            const requestedVersion = loader.readRequestVersion();
            const delta = await api.loadChannelDelta(
              token,
              organizationId,
              requestedCursor,
              abortController.signal,
            );
            if (
              stopped ||
              requestedCursor !== currentOptions.catalogCursor.current ||
              requestedVersion !== loader.readRequestVersion() ||
              currentOptions.isBlocked?.()
            ) return;
            currentOptions.catalogCursor.current = delta.cursor;
            currentOptions.onCatalogDelta(delta);

            const selectedChannelId = currentOptions.channelId;
            const selectedSummary = delta.channels.find(
              (item) => item.id === selectedChannelId,
            );
            if (
              selectedChannelId &&
              (delta.removedChannelIds.includes(selectedChannelId) ||
                (delta.reset && !selectedSummary))
            ) {
              loader.invalidateSurface(null, null);
              currentOptions.onSelectedChannelRemoved();
              return;
            }
            if (selectedSummary) {
              currentOptions.onSelectedChannelSummary?.(selectedSummary);
            }
            if (selectedChannelId) {
              const selectedMessages = delta.messages.filter(
                (item) => item.channelId === selectedChannelId,
              );
              const rootMessages = currentOptions.includeRepliesInRoot
                ? selectedMessages
                : selectedMessages.filter(
                    (item) => item.parentMessageId === null,
                  );
              if (!delta.reset && rootMessages.length > 0) {
                currentOptions.onIncomingRootMessages?.(rootMessages);
              }
              applyIncomingChannelMessages(
                registry,
                selectedChannelId,
                selectedMessages,
                delta.removedMessageIds,
                currentOptions.includeRepliesInRoot ?? false,
                delta.reset,
              );
              const failed = applyIncomingChannelAgentReplies(
                registry,
                selectedChannelId,
                delta.agentReplies.filter(
                  (item) => item.channelId === selectedChannelId,
                ),
                delta.reset,
              );
              if (failed) {
                toast(replyFailureRef.current(failed.error), { tone: "error" });
              }
            }
            if (!delta.hasMore || delta.cursor <= requestedCursor) break;
          }
        }
      } catch (cause) {
        if (!abortController.signal.aborted) {
          console.warn(
            optionsRef.current?.warningLabel ?? "Channel delta failed",
            cause,
          );
        }
      } finally {
        inFlight = false;
        if (pending && !stopped) window.queueMicrotask(() => void sync());
      }
    };

    const unsubscribe = transport.subscribe((notification) => {
      const current = optionsRef.current;
      if (
        current &&
        notification.topic === "channels" &&
        notification.cursor > current.catalogCursor.current
      ) {
        void sync();
      }
    });
    const updateVisibility = () => {
      if (document.hidden) transport.stop();
      else transport.start();
    };
    document.addEventListener("visibilitychange", updateVisibility);
    const fallback = window.setInterval(
      () => void sync(),
      CHANNEL_REALTIME_FALLBACK_MS,
    );
    updateVisibility();
    if (initial.syncSignal !== undefined && !document.hidden) void sync();
    return () => {
      stopped = true;
      unsubscribe();
      transport.stop();
      abortController.abort();
      document.removeEventListener("visibilitychange", updateVisibility);
      window.clearInterval(fallback);
      if (blockedRetry !== null) window.clearTimeout(blockedRetry);
    };
  }, [
    catalogReady,
    channelId,
    enabled,
    loader,
    organizationId,
    registry,
    syncSignal,
    toast,
    token,
  ]);
}
