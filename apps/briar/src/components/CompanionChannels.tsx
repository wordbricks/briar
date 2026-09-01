import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Hash,
  Link2,
  Lock,
  MessageSquare,
  PanelsTopLeft,
  Plus,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  listChannels,
  markChannelRead,
} from "../lib/api";
import {
  groupChannels,
  type ChannelGroupProject,
} from "../lib/channel-grouping";
import {
  channelQuickReactionEmojis,
  type ChannelAgentReply,
  type ChannelAgentSummary,
  type ChannelDelta,
  type ChannelExecutionProposal,
  type ChannelMember,
  type ChannelMessage,
  type ChannelSummary,
} from "../lib/channels-contract";
import {
  laterTimestamp,
  markChannelCatalogRead,
  markChannelSummaryRead,
} from "../lib/channel-unread";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  ExecutionWorker,
  HuntRun,
  IssueExecutionApprovalInput,
  ProjectExecutionWorkerPolicy,
} from "../types";
import type { MentionTarget } from "../lib/channel-mentions";
import {
  mergeChannelMessages,
} from "../lib/channel-message-merge";
import { useToast } from "./ui/toast";
import { maxIssueAttachmentCount } from "../lib/issue-attachments";
import { useI18n } from "../i18n";
import { useChannelComposer } from "../hooks/useChannelComposer";
import { useMobileBackHandler } from "../hooks/useMobileNavigation";
import {
  conversationIsAwayFromBottom,
  scrollConversationToBottom,
} from "../lib/conversation-scroll";
import { useChannelScrollStability } from "../hooks/use-channel-scroll-stability";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { ChannelAgentActivityDescriptor } from "../lib/channel-agent-activity";
import {
  ChannelDraftImages,
  ChannelMessageImageCacheProvider,
  ChannelMessageImages,
  channelBodyWithoutImages,
  useChannelMessageImageCache,
} from "./ChannelImages";
import { ChannelMentionMenu } from "./ChannelMentionMenu";
import { ChannelThreadSubscribeControls } from "./ChannelThreadSubscribeControls";
import { ChannelTypingState } from "./ChannelTypingState";
import { MentionComposerField } from "./MentionComposerField";
import { ChannelMessageText } from "./ChannelMessageText";
import { ChannelLinkPreview } from "./ChannelLinkPreview";
import { ChannelMessageReactions } from "./ChannelMessageReactions";
import {
  ConversationReplySummary,
  type ConversationReplyParticipant,
} from "./ConversationReplySummary";
import { Button } from "./ui/button";
import {
  ProfileDialog,
  profileTargetForChannelAgent,
  profileTargetForChannelMember,
  type ProfileTarget,
} from "./ProfileDialog";
import {
  ChannelIssueProposalDetails,
  channelIssueBatchProposalDetails,
  channelIssueProposalDetails,
  channelIssueProposalRequestsExecution,
} from "./ChannelIssueProposalDetails";
import { IssueExecutionApproval } from "./IssueExecutionApproval";
import { IssueCreateExecutionApproval } from "./IssueCreateExecutionApproval";
import { AgentSkillExecutionApproval } from "./AgentSkillExecutionApproval";
import { ConversationScrollToBottomButton } from "./ConversationScrollToBottomButton";
import {
  copyChannelMessageText,
  copyChannelShareLink,
} from "../lib/issue-links";
import {
  channelConversationError,
  useChannelConversation,
} from "../hooks/use-channel-conversation";

const mergeChannels = (
  current: ChannelSummary[],
  incoming: ChannelSummary[],
  removedIds: string[],
) => {
  const removed = new Set(removedIds);
  const byId = new Map(
    current
      .filter((item) => !removed.has(item.id))
      .map((item) => [item.id, item]),
  );
  for (const item of incoming) {
    if (!removed.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
};

type CompanionChannelsProps = {
  organizationId: string;
  activeProjectId: string | null;
  currentUserId: string | null;
  projects: readonly ChannelGroupProject[];
  token: string;
  onLobbyOpen?: () => void;
  onIssueOpen?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  channelInboxSyncSignal?: string;
  onViewingChannelChange?: (
    channelId: string | null,
    threadRootMessageId: string | null,
  ) => void;
  requestedChannelId?: string | null;
  onRequestedChannelOpen?: () => void;
  requestedMessage?: {
    channelId: string;
    messageId: string;
    rootMessageId: string;
  } | null;
  onRequestedMessageOpen?: () => void;
  channelCache?: CompanionChannelCache;
};

export type CachedCompanionChannel = {
  channel: ChannelSummary;
  members: ChannelMember[];
  agents: ChannelAgentSummary[];
  messages: ChannelMessage[];
  nextCursor: string | null;
  threads: Map<string, ChannelMessage[]>;
};

export type CompanionChannelCache = Map<string, CachedCompanionChannel>;

const mobileChannelMessagePageSize = 20;
export const mobileChannelCacheLimit = 5;
export const mobileThreadCacheLimit = 5;
export const mobileCachedMessageLimit = 40;

function boundedThreadMessages(
  parentMessageId: string,
  messages: ChannelMessage[],
) {
  if (messages.length <= mobileCachedMessageLimit) return messages;
  const root = messages.find((item) => item.id === parentMessageId);
  const replies = messages.filter((item) => item.id !== parentMessageId);
  const replyLimit = root
    ? mobileCachedMessageLimit - 1
    : mobileCachedMessageLimit;
  return [...(root ? [root] : []), ...replies.slice(-replyLimit)];
}

export function cacheCompanionThreadSnapshot(
  threads: Map<string, ChannelMessage[]>,
  parentMessageId: string,
  messages: ChannelMessage[],
) {
  threads.delete(parentMessageId);
  threads.set(
    parentMessageId,
    boundedThreadMessages(parentMessageId, messages),
  );
  while (threads.size > mobileThreadCacheLimit) {
    const oldest = threads.keys().next().value;
    if (oldest === undefined) break;
    threads.delete(oldest);
  }
}

function readCachedThread(
  threads: Map<string, ChannelMessage[]> | undefined,
  parentMessageId: string,
) {
  const cached = threads?.get(parentMessageId) ?? null;
  if (!cached || !threads) return cached;
  threads.delete(parentMessageId);
  threads.set(parentMessageId, cached);
  return cached;
}

export function cacheCompanionChannelSnapshot(
  cache: CompanionChannelCache,
  snapshot: CachedCompanionChannel,
) {
  const threads = new Map<string, ChannelMessage[]>();
  for (const [parentMessageId, messages] of snapshot.threads) {
    cacheCompanionThreadSnapshot(threads, parentMessageId, messages);
  }
  const messages = snapshot.messages.slice(-mobileCachedMessageLimit);
  const bounded = {
    ...snapshot,
    messages,
    nextCursor: snapshot.messages.length > messages.length
      ? messages[0]?.id ?? snapshot.nextCursor
      : snapshot.nextCursor,
    threads,
  };
  cache.delete(snapshot.channel.id);
  cache.set(snapshot.channel.id, bounded);
  while (cache.size > mobileChannelCacheLimit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return bounded;
}

function readCachedChannel(cache: CompanionChannelCache, channelId: string) {
  const cached = cache.get(channelId) ?? null;
  if (!cached) return null;
  cache.delete(channelId);
  cache.set(channelId, cached);
  return cached;
}

/**
 * Home on mobile is a channel list, then a channel's root messages, then one
 * message's thread. Each level replaces the previous one rather than opening a
 * side panel: a phone has no room for the desktop three-column layout.
 */
export function CompanionChannels({
  organizationId,
  activeProjectId,
  currentUserId,
  projects,
  token,
  onLobbyOpen,
  onIssueOpen,
  onSkillSessionAccepted,
  channelInboxSyncSignal,
  onViewingChannelChange,
  requestedChannelId,
  onRequestedChannelOpen,
  requestedMessage,
  onRequestedMessageOpen,
  channelCache,
}: CompanionChannelsProps) {
  const { t } = useI18n();
  const imageCache = useChannelMessageImageCache(`${organizationId}\0${token}`);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channel, setChannel] = useState<ChannelSummary | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<ChannelAgentSummary[]>([]);
  const [replies, setReplies] = useState<ChannelAgentReply[]>([]);
  const [thread, setThread] = useState<ChannelMessage[] | null>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [highlightedMessage, setHighlightedMessage] = useState<{
    channelId: string;
    messageId: string;
  } | null>(null);
  const [messageNextCursor, setMessageNextCursor] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [threadIsAwayFromBottom, setThreadIsAwayFromBottom] = useState(false);
  const cursor = useRef(0);
  const channelSelectionVersion = useRef(0);
  const channelMessagesScrollRef = useRef<HTMLDivElement | null>(null);
  const threadMessagesScrollRef = useRef<HTMLDivElement | null>(null);
  const threadMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const localChannelCache = useRef<CompanionChannelCache>(new Map());
  const resolvedChannelCache = channelCache ?? localChannelCache.current;
  const renderedChannel = useRef<CachedCompanionChannel | null>(null);
  const highlightedMessageRef = useRef(highlightedMessage);
  highlightedMessageRef.current = highlightedMessage;
  const {
    isAwayFromBottom: channelIsAwayFromBottom,
    onScroll: handleChannelScroll,
    requestStickToBottom,
    requestStickToBottomIfAtBottom,
    restoreScrollTop,
    scrollToBottom,
    setStickToBottom,
    stickToBottomRef,
  } = useChannelScrollStability({
    channelKey: channel?.id ?? null,
    rowContainerRef: channelMessagesScrollRef,
    rowCount: threadParentId ? 0 : messages.length,
    rowSelector: "[data-companion-channel-message-id]",
    scrollerRef: channelMessagesScrollRef,
    observeRows: true,
  });
  const cachedThreads = channel
    ? resolvedChannelCache.get(channel.id)?.threads ?? new Map()
    : new Map<string, ChannelMessage[]>();
  renderedChannel.current = channel
    ? {
        channel,
        members,
        agents,
        messages,
        nextCursor: messageNextCursor,
        threads: cachedThreads,
      }
    : null;

  const markSelectedChannelRead = useCallback(
    (summary: ChannelSummary) => {
      if (!summary.hasUnread) return summary;
      const lastReadAt = laterTimestamp(
        summary.lastMessageAt,
        new Date().toISOString(),
      );
      const next = markChannelSummaryRead(summary, lastReadAt);
      setChannels((current) =>
        markChannelCatalogRead(current, summary.id, lastReadAt)
      );
      void markChannelRead(token, organizationId, summary.id, { lastReadAt })
        .catch(() => {
          // The next catalog snapshot restores unread if the write failed.
        });
      return next;
    },
    [organizationId, token],
  );

  const updateRootMessages = useCallback(
    (update: (current: ChannelMessage[]) => ChannelMessage[]) => {
      setMessages(update);
    },
    [],
  );
  const updateThreadMessages = useCallback(
    (update: (current: ChannelMessage[]) => ChannelMessage[]) => {
      setThread((current) => update(current ?? []));
    },
    [],
  );
  const applyConversationSnapshot = useCallback(
    (snapshot: Omit<CachedCompanionChannel, "threads">) => {
      cacheCompanionChannelSnapshot(resolvedChannelCache, {
        ...snapshot,
        threads: resolvedChannelCache.get(snapshot.channel.id)?.threads ??
          new Map(),
      });
    },
    [resolvedChannelCache],
  );
  const applyChannelCatalogDelta = useCallback(
    (delta: ChannelDelta) => {
      setChannels((current) =>
        mergeChannels(
          delta.reset ? [] : current,
          delta.channels,
          delta.removedChannelIds,
        )
      );
    },
    [],
  );
  const handleSelectedChannelRemoved = useCallback(() => {
    channelSelectionVersion.current += 1;
    setChannel(null);
    setMessages([]);
    setMessageNextCursor(null);
    setMembers([]);
    setAgents([]);
    setReplies([]);
    setThread(null);
    setThreadParentId(null);
    setLoading(false);
  }, []);
  const handleSelectedChannelSummary = useCallback(
    (summary: ChannelSummary) => {
      setChannel(markSelectedChannelRead(summary));
    },
    [markSelectedChannelRead],
  );
  const applyCachedDeltaMessages = useCallback(
    (
      incoming: ChannelMessage[],
      removedMessageIds: string[],
      reset: boolean,
    ) => {
      const activeId = channel?.id;
      if (!activeId) return;
      const storedThreads = resolvedChannelCache.get(activeId)?.threads;
      if (!storedThreads) return;
      for (const [parentId, storedThread] of storedThreads) {
        if (removedMessageIds.includes(parentId)) {
          storedThreads.delete(parentId);
          continue;
        }
        const relevant = incoming.filter(
          (item) => item.id === parentId || item.parentMessageId === parentId,
        );
        storedThreads.set(parentId, reset
          ? relevant
          : mergeChannelMessages(storedThread, relevant, removedMessageIds));
      }
    },
    [channel?.id, resolvedChannelCache],
  );
  const handleIncomingRootMessages = useCallback(() => {
    requestStickToBottomIfAtBottom();
  }, [requestStickToBottomIfAtBottom]);
  const channelDeltaIsBlocked = useCallback(() => loading, [loading]);
  const {
    acceptExecutionProposal,
    acceptProposal,
    acceptSkillExecutionProposal,
    acceptingProposalId,
    applyAcceptedExecutionProposal,
    applyAcceptedSkillExecutionProposal,
    applyAgentReplies,
    applyIncomingMessages,
    busy,
    captureChannelSurface,
    channelSurfaceIsCurrent,
    clearProposalHistory,
    closeThread: closeConversationThread,
    declineProposal,
    decliningProposalId,
    error,
    invalidateChannelSurface,
    loadCreateExecutionProposalContext,
    loadChannelConversation,
    loadEarlierChannelMessages: loadEarlierConversationMessages,
    loadExecutionProposalContext,
    loadSkillExecutionProposalContext,
    loadingEarlierMessages,
    openIssue,
    openThread: openConversationThread,
    proposalProjects,
    removeMessage,
    send: sendConversationMessage,
    setError,
    setProposalProjects,
    threadActivityByAgentName,
    threadLoading,
    threadSubscriptionPending,
    threadTypingAgentNames,
    toggleReaction,
    toggleThreadSubscription,
    typingActivityByAgentName,
    typingAgentNames,
  } = useChannelConversation({
    token,
    organizationId,
    currentUserId,
    channel,
    members,
    agents,
    messages,
    replies,
    threadParentId,
    threadMessages: thread ?? [],
    messageNextCursor,
    pageSize: mobileChannelMessagePageSize,
    updateRootMessages,
    updateThreadMessages,
    setMembers,
    setAgents,
    setReplies,
    setThreadParentId,
    setMessageNextCursor,
    onChannelLoaded: setChannel,
    onConversationLoaded: applyConversationSnapshot,
    onIssueOpen,
    onSkillSessionAccepted,
    onRootMessagePending: () => {
      requestStickToBottomIfAtBottom();
    },
    onThreadClosed: () => {
      setLoading(false);
      requestStickToBottomIfAtBottom();
    },
    realtime: {
      enabled: Boolean(channel),
      catalogCursor: cursor,
      catalogReady: Boolean(channel),
      syncSignal: channelInboxSyncSignal,
      isBlocked: channelDeltaIsBlocked,
      onCatalogDelta: applyChannelCatalogDelta,
      onSelectedChannelRemoved: handleSelectedChannelRemoved,
      onSelectedChannelSummary: handleSelectedChannelSummary,
      onSelectedMessages: applyCachedDeltaMessages,
      onIncomingRootMessages: handleIncomingRootMessages,
      warningLabel: "Companion channel delta refresh failed",
    },
  });

  useLayoutEffect(() => {
    if (!channel || !threadParentId || thread === null) return;
    const cached = resolvedChannelCache.get(channel.id);
    if (!cached) return;
    cacheCompanionThreadSnapshot(cached.threads, threadParentId, thread);
    cacheCompanionChannelSnapshot(resolvedChannelCache, cached);
  }, [channel, resolvedChannelCache, thread, threadParentId]);

  useEffect(() => {
    onViewingChannelChange?.(channel?.id ?? null, threadParentId);
    return () => onViewingChannelChange?.(null, null);
  }, [channel?.id, onViewingChannelChange, threadParentId]);

  useLayoutEffect(() => {
    if (!channel || threadParentId || !stickToBottomRef.current) return;
    requestStickToBottom();
  }, [channel, messages, requestStickToBottom, stickToBottomRef, threadParentId]);

  useEffect(() => {
    if (!threadParentId) return;
    threadMessagesEndRef.current?.scrollIntoView?.({ block: "end" });
    setThreadIsAwayFromBottom(false);
  }, [thread, threadParentId, replies.length]);

  useEffect(() => {
    setThreadIsAwayFromBottom(false);
  }, [channel?.id, threadParentId]);

  useEffect(() => {
    if (requestedMessage) {
      const next = {
        channelId: requestedMessage.channelId,
        messageId: requestedMessage.messageId,
      };
      highlightedMessageRef.current = next;
      setHighlightedMessage(next);
      return;
    }
    if (
      !channel ||
      highlightedMessageRef.current?.channelId !== channel.id
    ) {
      highlightedMessageRef.current = null;
      setHighlightedMessage(null);
    }
  }, [channel?.id, requestedMessage?.channelId, requestedMessage?.messageId]);

  const activeHighlightedMessageId =
    requestedMessage?.messageId ?? highlightedMessage?.messageId ?? null;

  const persistRenderedChannel = useCallback(() => {
    const snapshot = renderedChannel.current;
    if (!snapshot) return;
    const cached = resolvedChannelCache.get(snapshot.channel.id);
    cacheCompanionChannelSnapshot(resolvedChannelCache, {
      ...snapshot,
      threads: cached?.threads ?? snapshot.threads,
    });
  }, [resolvedChannelCache]);

  useEffect(
    () => () => {
      persistRenderedChannel();
    },
    [persistRenderedChannel],
  );

  useEffect(() => {
    let cancelled = false;
    channelSelectionVersion.current += 1;
    invalidateChannelSurface(null, null);
    cursor.current = 0;
    clearProposalHistory();
    setChannels([]);
    setChannel(null);
    setMessages([]);
    setMessageNextCursor(null);
    setMembers([]);
    setAgents([]);
    setReplies([]);
    setThread(null);
    setThreadParentId(null);
    setError(null);
    if (!token) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void (async () => {
      try {
        const result = await listChannels(token, organizationId);
        if (!cancelled) {
          cursor.current = result.cursor;
          setChannels(result.channels);
        }
      } catch (cause) {
        if (!cancelled) setError(channelConversationError(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clearProposalHistory,
    invalidateChannelSurface,
    organizationId,
    setError,
    token,
  ]);

  const groups = useMemo(
    () =>
      groupChannels(channels, {
        activeProjectId,
        projects,
        commonLabel: t("companion.channelsCommon"),
        unknownProjectLabel: t("companion.channelsOtherProject"),
      }),
    [activeProjectId, channels, projects, t],
  );

  const openChannel = useCallback(
    async (summary: ChannelSummary) => {
      persistRenderedChannel();
      invalidateChannelSurface(summary.id, null);
      requestStickToBottom();
      const selectionVersion = ++channelSelectionVersion.current;
      const cached = readCachedChannel(resolvedChannelCache, summary.id);
      setChannel(markSelectedChannelRead(cached?.channel ?? summary));
      setThread(null);
      setThreadParentId(null);
      setMessages(cached?.messages ?? []);
      setMessageNextCursor(cached?.nextCursor ?? null);
      setMembers(cached?.members ?? []);
      setAgents(cached?.agents ?? []);
      // Reply jobs are live execution state. A cached running job can finish
      // while another screen is open, so restoring it would replay a stale
      // typing indicator until the authoritative channel load completes.
      setReplies([]);
      setError(null);
      setLoading(true);
      try {
        const result = await loadChannelConversation({
          channelId: summary.id,
          messageLimit: mobileChannelMessagePageSize,
          mergeWithCurrentMessages: false,
        });
        if (
          !result ||
          selectionVersion !== channelSelectionVersion.current
        ) return;
        const nextChannel = markSelectedChannelRead(result.channel);
        setChannel(nextChannel);
        const refreshed = resolvedChannelCache.get(summary.id);
        if (refreshed) {
          cacheCompanionChannelSnapshot(resolvedChannelCache, {
            ...refreshed,
            channel: nextChannel,
          });
        }
        requestStickToBottom();
      } finally {
        if (selectionVersion === channelSelectionVersion.current) {
          setLoading(false);
        }
      }
    },
    [
      invalidateChannelSurface,
      loadChannelConversation,
      markSelectedChannelRead,
      persistRenderedChannel,
      requestStickToBottom,
      resolvedChannelCache,
    ],
  );

  useEffect(() => {
    if (!requestedChannelId || requestedMessage) return;
    const summary = channels.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === requestedChannelId,
    );
    if (!summary) return;
    void openChannel(summary).finally(() => onRequestedChannelOpen?.());
  }, [
    channels,
    onRequestedChannelOpen,
    openChannel,
    organizationId,
    requestedChannelId,
    requestedMessage,
  ]);

  const loadEarlierChannelMessages = useCallback(async () => {
    const scroller = channelMessagesScrollRef.current;
    const previousScrollHeight = scroller?.scrollHeight ?? 0;
    const previousScrollTop = scroller?.scrollTop ?? 0;
    const result = await loadEarlierConversationMessages();
    if (result.applied) {
      window.requestAnimationFrame(() => {
        if (!scroller) return;
        restoreScrollTop(
          previousScrollTop + (scroller.scrollHeight - previousScrollHeight),
        );
      });
    }
  }, [
    loadEarlierConversationMessages,
    restoreScrollTop,
  ]);

  const openThread = useCallback(
    async (parent: ChannelMessage) => {
      if (!channel) return;
      channelSelectionVersion.current += 1;
      const cachedThread = readCachedThread(
        readCachedChannel(resolvedChannelCache, channel.id)?.threads,
        parent.id,
      ) ?? [];
      await openConversationThread(parent.id, cachedThread);
    },
    [
      channel,
      openConversationThread,
      resolvedChannelCache,
    ],
  );

  useEffect(() => {
    if (!requestedMessage) return;
    const summary = channels.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === requestedMessage.channelId,
    );
    if (!summary) return;
    invalidateChannelSurface(summary.id, null);
    const selectionVersion = ++channelSelectionVersion.current;
    let cancelled = false;
    setChannel(summary);
    setReplies([]);
    setThread(null);
    setThreadParentId(null);
    setMessageNextCursor(null);
    setStickToBottom(false);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await loadChannelConversation({
          channelId: summary.id,
          messageLimit: mobileChannelMessagePageSize,
          mergeWithCurrentMessages: false,
          requestedMessage,
        });
        if (
          !result ||
          cancelled ||
          selectionVersion !== channelSelectionVersion.current
        ) return;
        setChannel(markSelectedChannelRead(result.channel));
        if (requestedMessage.rootMessageId === requestedMessage.messageId) {
          setThread(null);
        }
        window.requestAnimationFrame(() => {
          const requestedMessageElement = document.querySelector(
            `[data-companion-channel-message-id="${requestedMessage.messageId}"]`,
          );
          if (requestedMessageElement?.scrollIntoView) {
            setStickToBottom(false);
            requestedMessageElement.scrollIntoView({ block: "center" });
          }
          if (requestedMessageElement instanceof HTMLElement) {
            requestedMessageElement.focus({ preventScroll: true });
          }
          onRequestedMessageOpen?.();
        });
      } finally {
        if (
          !cancelled &&
          selectionVersion === channelSelectionVersion.current
        ) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (channelSelectionVersion.current === selectionVersion) {
        channelSelectionVersion.current += 1;
      }
    };
  }, [
    channels,
    invalidateChannelSurface,
    loadChannelConversation,
    markSelectedChannelRead,
    onRequestedMessageOpen,
    organizationId,
    requestedMessage,
    setStickToBottom,
  ]);

  const send = useCallback(
    (
      body: string,
      mentions: MentionTarget[],
      attachments: File[],
      attachmentReferences: string[],
    ) =>
      sendConversationMessage(
        body,
        mentions,
        threadParentId,
        attachments,
        attachmentReferences,
      ),
    [sendConversationMessage, threadParentId],
  );

  const closeThread = useCallback(() => {
    if (!channel || !threadParentId) return false;
    channelSelectionVersion.current += 1;
    const closed = closeConversationThread();
    setThread(null);
    return closed;
  }, [channel, closeConversationThread, threadParentId]);

  const closeChannel = useCallback(() => {
    if (!channel) return false;
    persistRenderedChannel();
    channelSelectionVersion.current += 1;
    invalidateChannelSurface(null, null);
    setChannel(null);
    setMessages([]);
    setMessageNextCursor(null);
    setReplies([]);
    setLoading(false);
    setError(null);
    return true;
  }, [channel, invalidateChannelSurface, persistRenderedChannel, setError]);

  useMobileBackHandler(
    () => closeThread() || closeChannel(),
    { enabled: Boolean(channel), priority: 100 },
  );

  if (channel && threadParentId) {
    return (
      <ChannelMessageImageCacheProvider cache={imageCache}>
        <section
          aria-busy={threadLoading}
          className="companion-channels companion-channel-detail"
        >
        <ChannelBar
          onBack={closeThread}
          subscribe={(
            <ChannelThreadSubscribeControls
              currentUserId={currentUserId}
              members={members}
              pending={threadSubscriptionPending}
              subscribers={
                thread?.find((item) => item.id === threadParentId)
                  ?.subscribers ?? []
              }
              onToggle={(subscribed) => {
                void toggleThreadSubscription(subscribed);
              }}
            />
          )}
          title={t("companion.channelThread")}
        />
        {error ? <p className="companion-channel-error" role="alert">{error}</p> : null}
        <div className="conversation-scroll-region">
          <div
            className="companion-channel-messages"
            onScroll={(event) =>
              setThreadIsAwayFromBottom(
                conversationIsAwayFromBottom(event.currentTarget),
              )}
            ref={threadMessagesScrollRef}
          >
            {threadLoading && (thread?.length ?? 0) === 0
              ? <CompanionChannelLoadingSpinner />
              : null}
            {(thread ?? []).map((item) => (
            <MessageRow
              acceptingProposal={acceptingProposalId === item.proposal?.id}
              decliningProposal={decliningProposalId === item.proposal?.id}
              agents={agents}
              busy={busy}
              channel={channel}
              currentUserId={currentUserId}
              highlighted={item.id === activeHighlightedMessageId}
              key={item.id}
              members={members}
              message={item}
              onAcceptProposal={(input) =>
                acceptProposal(item, input ?? null)}
              onDeclineProposal={() => declineProposal(item)}
              loadCreateExecutionProposalContext={
                loadCreateExecutionProposalContext
              }
              loadExecutionProposalContext={() =>
                loadExecutionProposalContext(item.executionProposal!)}
              loadSkillExecutionProposalContext={() =>
                loadSkillExecutionProposalContext(
                  item.skillExecutionProposal!,
                )}
              onAcceptExecutionProposal={(input) =>
                acceptExecutionProposal(item, input)}
              onExecutionProposalAccepted={(proposal) =>
                applyAcceptedExecutionProposal(item.id, proposal)}
              onAcceptSkillExecutionProposal={(input) =>
                acceptSkillExecutionProposal(item, input)}
              onSkillExecutionProposalAccepted={(proposal) =>
                applyAcceptedSkillExecutionProposal(item.id, proposal)}
              onIssueOpen={openIssue}
              onProjectChange={(projectId) => {
                const proposalId = item.proposal?.id;
                if (!proposalId) return;
                setProposalProjects((current) => ({
                  ...current,
                  [proposalId]: projectId,
                }));
              }}
              onToggleReaction={(emoji) => void toggleReaction(item, emoji)}
              onDelete={() => void removeMessage(item)}
              projects={projects}
              selectedProjectId={
                item.proposal ? proposalProjects[item.proposal.id] ?? null : null
              }
              token={token}
              typingAgentNames={typingAgentNames(item.id)}
              typingActivityByAgentName={typingActivityByAgentName(item.id)}
              showTypingState={false}
            />
            ))}
            <div ref={threadMessagesEndRef} />
          </div>
          {threadIsAwayFromBottom ? (
            <ConversationScrollToBottomButton
              label={t("run.jumpToLatest")}
              onClick={() => {
                const scroller = threadMessagesScrollRef.current;
                if (!scroller) return;
                setThreadIsAwayFromBottom(false);
                scrollConversationToBottom(scroller);
              }}
            />
          ) : null}
        </div>
        <ChannelTypingState
          agentNames={threadTypingAgentNames}
          activityByAgentName={threadActivityByAgentName}
          className="companion-channel-thread-typing"
        />
        <CompanionChannelComposer
          agents={agents}
          busy={busy}
          currentUserId={currentUserId}
          members={members}
          onSend={send}
        />
        </section>
      </ChannelMessageImageCacheProvider>
    );
  }

  if (channel) {
    return (
      <ChannelMessageImageCacheProvider cache={imageCache}>
        <section
          aria-busy={loading}
          className="companion-channels companion-channel-detail"
        >
        <ChannelBar
          onBack={closeChannel}
          channel={channel}
        />
        {error ? <p className="companion-channel-error" role="alert">{error}</p> : null}
        <div className="conversation-scroll-region">
          <div
            className="companion-channel-messages"
            onScroll={(event) => {
              handleChannelScroll(event.currentTarget);
              if (event.currentTarget.scrollTop <= 32) {
                void loadEarlierChannelMessages();
              }
            }}
            ref={channelMessagesScrollRef}
          >
            {loadingEarlierMessages ? <CompanionChannelLoadingSpinner /> : null}
            {loading && messages.length === 0 ? <CompanionChannelLoadingSpinner /> : null}
            {messages.map((item) => (
            <MessageRow
              acceptingProposal={acceptingProposalId === item.proposal?.id}
              decliningProposal={decliningProposalId === item.proposal?.id}
              agents={agents}
              busy={busy}
              channel={channel}
              currentUserId={currentUserId}
              highlighted={item.id === activeHighlightedMessageId}
              key={item.id}
              members={members}
              message={item}
              onAcceptProposal={(input) =>
                acceptProposal(item, input ?? null)}
              onDeclineProposal={() => declineProposal(item)}
              loadCreateExecutionProposalContext={
                loadCreateExecutionProposalContext
              }
              loadExecutionProposalContext={() =>
                loadExecutionProposalContext(item.executionProposal!)}
              loadSkillExecutionProposalContext={() =>
                loadSkillExecutionProposalContext(
                  item.skillExecutionProposal!,
                )}
              onAcceptExecutionProposal={(input) =>
                acceptExecutionProposal(item, input)}
              onExecutionProposalAccepted={(proposal) =>
                applyAcceptedExecutionProposal(item.id, proposal)}
              onAcceptSkillExecutionProposal={(input) =>
                acceptSkillExecutionProposal(item, input)}
              onSkillExecutionProposalAccepted={(proposal) =>
                applyAcceptedSkillExecutionProposal(item.id, proposal)}
              onIssueOpen={openIssue}
              onOpenThread={() => void openThread(item)}
              onProjectChange={(projectId) => {
                const proposalId = item.proposal?.id;
                if (!proposalId) return;
                setProposalProjects((current) => ({
                  ...current,
                  [proposalId]: projectId,
                }));
              }}
              onToggleReaction={(emoji) => void toggleReaction(item, emoji)}
              onDelete={() => void removeMessage(item)}
              projects={projects}
              selectedProjectId={
                item.proposal ? proposalProjects[item.proposal.id] ?? null : null
              }
              showThreadSummary
              token={token}
              typingAgentNames={typingAgentNames(item.id)}
              typingActivityByAgentName={typingActivityByAgentName(item.id)}
            />
            ))}
            {!loading && messages.length === 0 ? (
              <p className="companion-channel-empty">
                {t("companion.channelsEmpty")}
              </p>
            ) : null}
          </div>
          {channelIsAwayFromBottom ? (
            <ConversationScrollToBottomButton
              label={t("run.jumpToLatest")}
              onClick={() => {
                scrollToBottom();
              }}
            />
          ) : null}
        </div>
        <CompanionChannelComposer
          agents={agents}
          busy={busy}
          currentUserId={currentUserId}
          members={members}
          onSend={send}
        />
        </section>
      </ChannelMessageImageCacheProvider>
    );
  }

  return (
    <ChannelMessageImageCacheProvider cache={imageCache}>
      <section aria-busy={loading} className="companion-channels">
        {onLobbyOpen ? (
          <button
            className="mx-3 mt-3 mb-1 flex min-h-[72px] w-[calc(100%_-_24px)] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left text-foreground shadow-xs active:scale-[.99]"
            onClick={onLobbyOpen}
            type="button"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <PanelsTopLeft aria-hidden size={20} />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <strong className="text-sm font-semibold">
                {t("companion.viewLobby")}
              </strong>
              <small className="truncate text-xs text-muted-foreground">
                {t("companion.viewLobbyDescription")}
              </small>
            </span>
            <ChevronRight aria-hidden className="text-muted-foreground" size={18} />
          </button>
        ) : null}
        {error ? <p className="companion-channel-error" role="alert">{error}</p> : null}
        {loading && channels.length === 0 ? <CompanionChannelLoadingSpinner /> : null}
        {groups.map((group) => (
        <div className="companion-channel-group" key={group.key}>
          <h2 className="companion-channel-divider">{group.label}</h2>
          <ul>
            {group.channels.map((item) => (
              <li key={item.id}>
                <button
                  className={item.hasUnread ? "unread" : undefined}
                  onClick={() => void openChannel(item)}
                  type="button"
                >
                  {item.visibility === "private" ? (
                    <Lock size={15} />
                  ) : (
                    <Hash size={15} />
                  )}
                  <span>{item.name}</span>
                  {item.agentCount > 0 ? (
                    <i className="companion-channel-agent-count">
                      <Bot size={12} />
                      {item.agentCount}
                    </i>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
        ))}
        {!loading && groups.length === 0 ? (
          <p className="companion-channel-empty">{t("companion.channelsEmpty")}</p>
        ) : null}
      </section>
    </ChannelMessageImageCacheProvider>
  );
}

function ChannelBar({
  channel,
  onBack,
  subscribe,
  title,
}: {
  channel?: ChannelSummary;
  onBack: () => void;
  subscribe?: ReactNode;
  title?: string;
}) {
  const { t } = useI18n();
  const memberLabel = channel
    ? t("companion.channelMembers", { count: channel.memberCount })
    : null;
  const agentLabel = channel
    ? t("companion.channelAgents", { count: channel.agentCount })
    : null;
  return (
    <header
      className={`companion-channel-bar${channel ? " is-channel" : ""}`}
    >
      <Button
        aria-label={t("navigation.back")}
        className="companion-channel-bar-back size-10 shrink-0"
        onClick={onBack}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ChevronLeft size={18} />
      </Button>
      {channel ? (
        <>
          <div className="companion-channel-bar-identity">
            {channel.visibility === "private" ? (
              <Lock aria-hidden="true" size={22} />
            ) : (
              <Hash aria-hidden="true" size={24} />
            )}
            <span>
              <strong>{channel.name}</strong>
              <small>
                {memberLabel} • {agentLabel}
              </small>
            </span>
          </div>
        </>
      ) : (
        <strong className="companion-channel-bar-title">{title}</strong>
      )}
      {subscribe}
    </header>
  );
}

const companionChannelAuthorId = (author: ChannelMessage["author"]) =>
  author.type === "user"
    ? `user:${author.id || author.email || author.name}`
    : `${author.type}:${author.id ?? author.name}`;

const companionChannelReplyParticipants = (
  message: ChannelMessage,
): ConversationReplyParticipant[] =>
  [message.author, ...message.replyAuthors]
    .filter(
      (author, index, authors) =>
        authors.findIndex(
          (candidate) =>
            companionChannelAuthorId(candidate) === companionChannelAuthorId(author),
        ) === index,
    )
    .slice(0, 3)
    .map((author) => ({
      id: companionChannelAuthorId(author),
      name: author.name,
      image: author.type === "user" || author.type === "agent"
        ? author.image
        : null,
      isAgent: author.type !== "user",
    }));

const companionReplyRelativeTime = (
  value: string,
  t: ReturnType<typeof useI18n>["t"],
) => {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  if (minutes < 1_440) {
    return t("time.hoursAgo", { count: Math.floor(minutes / 60) });
  }
  return t("time.daysAgo", { count: Math.floor(minutes / 1_440) });
};

function MessageRow({
  acceptingProposal,
  decliningProposal,
  agents,
  busy,
  channel,
  currentUserId,
  highlighted = false,
  loadCreateExecutionProposalContext,
  loadExecutionProposalContext,
  loadSkillExecutionProposalContext,
  members,
  message,
  onAcceptProposal,
  onDeclineProposal,
  onAcceptExecutionProposal,
  onAcceptSkillExecutionProposal,
  onExecutionProposalAccepted,
  onSkillExecutionProposalAccepted,
  onIssueOpen,
  onOpenThread,
  onProjectChange,
  onDelete,
  onToggleReaction,
  projects,
  selectedProjectId,
  showThreadSummary = false,
  token,
  typingAgentNames,
  typingActivityByAgentName,
  showTypingState = true,
}: {
  acceptingProposal: boolean;
  decliningProposal: boolean;
  agents: ChannelAgentSummary[];
  busy: boolean;
  channel: ChannelSummary;
  currentUserId: string | null;
  highlighted?: boolean;
  loadCreateExecutionProposalContext: (projectId: string) => Promise<{
    run: HuntRun | null;
    workers: ExecutionWorker[];
    policy?: ProjectExecutionWorkerPolicy;
  }>;
  loadExecutionProposalContext: () => Promise<{
    run: HuntRun | null;
    workers: ExecutionWorker[];
    policy?: ProjectExecutionWorkerPolicy;
  }>;
  loadSkillExecutionProposalContext: () => Promise<{
    workers: ExecutionWorker[];
    policy?: ProjectExecutionWorkerPolicy;
  }>;
  members: ChannelMember[];
  message: ChannelMessage;
  onAcceptProposal: (
    input?: IssueExecutionApprovalInput,
  ) => Promise<string | null | undefined>;
  onDeclineProposal: () => void | Promise<void>;
  onAcceptExecutionProposal: (
    input: IssueExecutionApprovalInput,
  ) => Promise<ChannelExecutionProposal>;
  onExecutionProposalAccepted: (proposal: ChannelExecutionProposal) => void;
  onAcceptSkillExecutionProposal: (
    input: AgentSkillExecutionApprovalInput,
  ) => Promise<AgentSkillExecutionProposal>;
  onSkillExecutionProposalAccepted: (
    proposal: AgentSkillExecutionProposal,
  ) => void;
  onIssueOpen?: (projectId: string, runId: string) => void | Promise<void>;
  onOpenThread?: () => void;
  onProjectChange: (projectId: string) => void;
  onDelete: () => void;
  onToggleReaction: (emoji: string) => void;
  projects: readonly ChannelGroupProject[];
  selectedProjectId: string | null;
  showThreadSummary?: boolean;
  token: string;
  typingAgentNames: string[];
  typingActivityByAgentName: Readonly<Record<string, ChannelAgentActivityDescriptor>>;
  showTypingState?: boolean;
}) {
  const { localeTag, t } = useI18n();
  const { toast } = useToast();
  const [reacting, setReacting] = useState(false);
  const [showingThreadActions, setShowingThreadActions] = useState(false);
  const canDelete = message.author.type === "user" &&
    message.author.id === currentUserId && !message.deletedAt && !message.optimistic;
  useMobileBackHandler(
    () => {
      if (!showingThreadActions) return false;
      setShowingThreadActions(false);
      return true;
    },
    { enabled: showingThreadActions, priority: 200 },
  );
  const issueProposal = message.proposal;
  const proposalProjectId =
    issueProposal?.projectId ?? channel.defaultProjectId ?? selectedProjectId;
  const needsProject =
    issueProposal?.status === "pending" && !issueProposal.projectId &&
    !channel.defaultProjectId;
  const acceptedProjectId = issueProposal?.projectId;
  const acceptedRunId = issueProposal?.resultRunId;
  const proposalProjectName = proposalProjectId
    ? projects.find((project) => project.id === proposalProjectId)?.name ??
      proposalProjectId
    : null;
  const proposalIssue = channelIssueProposalDetails(issueProposal);
  const proposalBatch = channelIssueBatchProposalDetails(issueProposal);
  const requestsExecution = channelIssueProposalRequestsExecution(issueProposal);
  const executionProjectName = message.executionProposal
    ? projects.find(
        (project) => project.id === message.executionProposal?.projectId,
      )?.name ?? message.executionProposal.projectId
    : null;
  return (
    <article
      aria-current={highlighted ? "true" : undefined}
      className={`companion-channel-message${reacting ? " is-reacting" : ""}${highlighted ? " is-inbox-target" : ""}${message.optimistic ? " is-optimistic" : ""}`}
      data-companion-channel-message-id={message.id}
      data-inbox-highlighted={highlighted ? "true" : undefined}
      tabIndex={highlighted ? -1 : undefined}
      onContextMenu={(event) => {
        if (message.optimistic) return;
        if ((event.target as HTMLElement).closest("button,a,input,select,textarea")) {
          return;
        }
        event.preventDefault();
        setShowingThreadActions(true);
      }}
    >
      <MessageAvatar message={message} />
      <div className="companion-channel-message-copy">
        <header>
          <strong>{message.author.name}</strong>
          {message.author.type === "agent" ? <Bot size={12} /> : null}
          {message.author.type === "webhook" ? <Webhook size={12} /> : null}
          <time>
            {new Date(message.createdAt).toLocaleTimeString(localeTag, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </header>
        <ChannelMessageText agents={agents} members={members} message={message} />
        <ChannelLinkPreview
          channelId={message.channelId}
          message={message}
          organizationId={channel.organizationId}
          token={token}
        />
        <ChannelMessageImages
          attachments={message.attachments}
          interactive={!showThreadSummary}
          token={token}
        />
        {message.document ? (
          <span className="companion-channel-document">
            <FileText size={13} />
            {message.document.title}
          </span>
        ) : null}
        {issueProposal ? (
          <div className="companion-channel-proposal">
            <div className="companion-channel-proposal-copy">
              <strong>{t("channel.issueProposal")}</strong>
              <span>
                {issueProposal.status === "accepted"
                  ? t("channel.issueProposalAccepted")
                  : issueProposal.status === "declined"
                    ? t("channel.issueProposalDeclined")
                    : t("channel.issueProposalPending")}
              </span>
              <ChannelIssueProposalDetails
                projectName={proposalProjectName}
                proposal={issueProposal}
              />
            </div>
            {needsProject ? (
              <select
                aria-label={t("channel.selectProposalProject")}
                disabled={busy || Boolean(channel.archivedAt)}
                onChange={(event) => onProjectChange(event.currentTarget.value)}
                value={selectedProjectId ?? ""}
              >
                <option disabled value="">
                  {t("channel.selectProposalProject")}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : null}
            {requestsExecution && proposalProjectId && proposalIssue ? (
              <>
                <IssueCreateExecutionApproval
                  creating={acceptingProposal}
                  declining={decliningProposal}
                  disabledReason={channel.archivedAt
                    ? t("executionApproval.archived")
                    : busy && !acceptingProposal
                      ? t("executionApproval.approvalUnavailable")
                      : null}
                  executionProposal={message.executionProposal}
                  issueAccepted={issueProposal.status === "accepted"}
                  loadExecutionContext={() =>
                    loadCreateExecutionProposalContext(proposalProjectId)}
                  onAccept={(input) => onAcceptProposal(input)}
                  onCreate={() => onAcceptProposal()}
                  onDecline={onDeclineProposal}
                  projectName={proposalProjectName}
                  proposalId={issueProposal.id}
                  targetTitle={proposalIssue.title}
                />
                {issueProposal.status === "accepted" &&
                    acceptedProjectId && acceptedRunId && onIssueOpen ? (
                  <button
                    className="channel-proposal-view-button"
                    onClick={() => {
                      void onIssueOpen(acceptedProjectId, acceptedRunId);
                    }}
                    type="button"
                  >
                    {t("channel.viewIssue")}
                  </button>
                ) : null}
              </>
            ) : issueProposal.status === "pending" ? (
              <div className="channel-proposal-actions">
                <button
                  aria-busy={acceptingProposal}
                  className="channel-proposal-approve-button"
                  disabled={
                    busy || Boolean(channel.archivedAt) ||
                    !proposalProjectId
                  }
                  onClick={() => void onAcceptProposal()}
                  type="button"
                >
                  {acceptingProposal ? (
                    <>
                      <Spinner aria-hidden="true" size={15} />
                      {t("channel.creatingIssue")}
                    </>
                  ) : (
                    proposalBatch
                      ? t("channel.approveCreateIssueBatch", {
                          count: proposalBatch.items.length,
                        })
                      : t("channel.approveCreateIssue")
                  )}
                </button>
                <button
                  aria-busy={decliningProposal}
                  className="channel-proposal-decline-button"
                  disabled={busy || Boolean(channel.archivedAt)}
                  onClick={() => void onDeclineProposal()}
                  type="button"
                >
                  {decliningProposal
                    ? t("channel.decliningIssueProposal")
                    : t("channel.declineIssueProposal")}
                </button>
              </div>
            ) : acceptedProjectId && acceptedRunId && !proposalBatch &&
              onIssueOpen ? (
              <button
                className="channel-proposal-view-button"
                onClick={() => {
                  void onIssueOpen(acceptedProjectId, acceptedRunId);
                }}
                type="button"
              >
                {t("channel.viewIssue")}
              </button>
            ) : null}
          </div>
        ) : null}
        {message.executionProposal && !requestsExecution ? (
          <IssueExecutionApproval
            disabledReason={channel.archivedAt
              ? t("executionApproval.archived")
              : null}
            loadExecutionContext={loadExecutionProposalContext}
            onAccept={onAcceptExecutionProposal}
            onAccepted={onExecutionProposalAccepted}
            onIssueOpen={onIssueOpen
              ? (runId) => onIssueOpen(
                  message.executionProposal!.projectId,
                  runId,
                )
              : undefined}
            projectName={executionProjectName}
            proposal={message.executionProposal}
            surfaceKey={`${channel.id}:${message.parentMessageId ?? "root"}:${message.id}`}
          />
        ) : null}
        {message.skillExecutionProposal ? (
          <AgentSkillExecutionApproval
            disabledReason={channel.archivedAt
              ? t("skillExecution.archived")
              : null}
            loadExecutionContext={loadSkillExecutionProposalContext}
            onAccept={onAcceptSkillExecutionProposal}
            onAccepted={onSkillExecutionProposalAccepted}
            proposal={message.skillExecutionProposal}
            surfaceKey={`${channel.id}:${message.parentMessageId ?? "root"}:${message.id}`}
          />
        ) : null}
        <ChannelMessageReactions
          busy={busy || message.optimistic}
          currentUserId={currentUserId}
          members={members}
          message={message}
          onReactingChange={setReacting}
          onToggle={onToggleReaction}
        />
        {showThreadSummary && !message.optimistic && onOpenThread &&
            message.replyCount > 0
          ? (
            <ConversationReplySummary
              countLabel={t("channel.replyCount", {
                count: message.replyCount,
              })}
              lastReplyLabel={message.lastReplyAt
                ? t("conversation.lastReply", {
                  time: companionReplyRelativeTime(message.lastReplyAt, t),
                })
                : null}
              onClick={onOpenThread}
              participants={companionChannelReplyParticipants(message)}
            />
          )
          : null}
        {showTypingState ? (
          <ChannelTypingState
            agentNames={typingAgentNames}
            activityByAgentName={typingActivityByAgentName}
            className="companion-channel-typing"
          />
        ) : null}
      </div>
      {showingThreadActions ? (
        <div
          className="companion-channel-action-backdrop"
          onClick={() => setShowingThreadActions(false)}
        >
          <div
            aria-label={t("channel.messageActions")}
            aria-modal="true"
            className="companion-channel-action-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <span aria-hidden="true" className="companion-channel-action-handle" />
            <div className="companion-channel-quick-reactions">
              {message.deletedAt ? null : channelQuickReactionEmojis.map((emoji, index) => (
                <button
                  aria-label={t("channel.reactWith", { emoji })}
                  autoFocus={!onOpenThread && index === 0}
                  disabled={busy}
                  key={emoji}
                  onClick={() => {
                    setShowingThreadActions(false);
                    onToggleReaction(emoji);
                  }}
                  type="button"
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
            {onOpenThread ? (
              <button
                autoFocus
                className="companion-channel-message-button companion-channel-sheet-action companion-channel-start-thread"
                onClick={() => {
                  setShowingThreadActions(false);
                  onOpenThread();
                }}
                type="button"
              >
                <MessageSquare aria-hidden="true" size={20} />
                <strong>{t("channel.startThread")}</strong>
              </button>
            ) : null}
            <button
              className="companion-channel-message-button companion-channel-sheet-action companion-channel-copy-link"
              onClick={() => {
                setShowingThreadActions(false);
                void copyChannelShareLink({
                  organizationId: channel.organizationId,
                  channelId: message.channelId,
                  messageId: message.id,
                  rootMessageId: message.parentMessageId ?? message.id,
                })
                  .then(() => toast(t("channel.linkCopied"), { tone: "success" }))
                  .catch(() => toast(t("channel.copyFailed"), { tone: "error" }));
              }}
              type="button"
            >
              <Link2 aria-hidden="true" size={20} />
              <strong>{t("channel.copyLink")}</strong>
            </button>
            <button
              className="companion-channel-message-button companion-channel-sheet-action companion-channel-copy-text"
              disabled={Boolean(message.deletedAt)}
              onClick={() => {
                setShowingThreadActions(false);
                const text = channelBodyWithoutImages(message.body) || message.body.trim();
                void copyChannelMessageText(text)
                  .then(() => toast(t("channel.messageCopied"), { tone: "success" }))
                  .catch(() => toast(t("channel.copyFailed"), { tone: "error" }));
              }}
              type="button"
            >
              <Copy aria-hidden="true" size={20} />
              <strong>{t("channel.copyText")}</strong>
            </button>
            {canDelete ? (
              <button
                className="companion-channel-message-button companion-channel-sheet-action danger"
                onClick={() => {
                  setShowingThreadActions(false);
                  onDelete();
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" size={20} />
                <strong>{t("channel.deleteMessage")}</strong>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MessageAvatar({ message }: { message: ChannelMessage }) {
  const image =
    message.author.type === "user" || message.author.type === "agent"
      ? message.author.image
      : null;
  if (image) {
    return (
      <img
        alt=""
        className="companion-channel-avatar"
        src={image}
      />
    );
  }
  return (
    <span
      aria-label={message.author.name}
      className={`companion-channel-avatar fallback ${message.author.type}`}
      role="img"
    >
      {message.author.type === "agent" ? (
        <Bot size={18} />
      ) : message.author.type === "webhook" ? (
        <Webhook size={18} />
      ) : (
        message.author.name.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}

export function CompanionChannelComposer({
  agents,
  busy,
  currentUserId,
  members,
  onSend,
}: {
  agents: ChannelAgentSummary[];
  busy: boolean;
  currentUserId: string | null;
  members: ChannelMember[];
  onSend: (
    body: string,
    mentions: MentionTarget[],
    attachments: File[],
    attachmentReferences: string[],
  ) => void;
}) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<ProfileTarget | null>(null);
  const {
    activeSuggestionIndex,
    attachmentError,
    attachmentInputRef,
    body,
    dragging,
    handleCaret,
    handleChange,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileChange,
    handleKeyDown,
    handlePaste,
    handleSubmit,
    images,
    inputRef,
    mentionListId,
    mentions,
    pickSuggestion,
    removeImage,
    setActiveSuggestionIndex,
    showsSuggestions,
    suggestions,
  } = useChannelComposer<HTMLTextAreaElement>({
    agents,
    busy,
    currentUserId,
    members,
    onSend,
  });
  const connectedMentions = useMemo(
    () => mentions.map((mention) => ({
      key: `${mention.type}:${mention.id}`,
      handle: mention.handle,
      label: mention.label,
    })),
    [mentions],
  );
  const profilesByMentionKey = useMemo(() => {
    const profiles = new Map<string, ProfileTarget>();
    for (const agent of agents) {
      profiles.set(
        `agent:${agent.agentId}`,
        profileTargetForChannelAgent(agent),
      );
    }
    for (const member of members) {
      profiles.set(
        `user:${member.userId}`,
        profileTargetForChannelMember(member),
      );
    }
    return profiles;
  }, [agents, members]);

  return (
    <>
      <form
        className={`companion-channel-composer${dragging ? " is-dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onSubmit={handleSubmit}
      >
      {showsSuggestions ? (
        <ChannelMentionMenu
          activeSuggestionIndex={activeSuggestionIndex}
          ariaLabel={t("run.mention")}
          id={mentionListId}
          onActiveSuggestionIndexChange={setActiveSuggestionIndex}
          onPickSuggestion={pickSuggestion}
          suggestions={suggestions}
          variant="companion"
        />
      ) : null}
      <ChannelDraftImages images={images} onRemove={removeImage} />
      <Button
        aria-label={t("channel.toolAttach")}
        className="companion-channel-composer-add"
        disabled={busy || images.length >= maxIssueAttachmentCount}
        onClick={() => attachmentInputRef.current?.click()}
        size="icon"
        type="button"
        variant="outline"
      >
        <Plus size={20} />
      </Button>
      <MentionComposerField
        body={body}
        className="companion-channel-composer-field"
        controlRef={inputRef}
        mentions={connectedMentions}
        onMentionClick={(mention) => {
          const nextProfile = profilesByMentionKey.get(mention.key);
          if (nextProfile) setProfile(nextProfile);
        }}
      >
        <textarea
          aria-activedescendant={
            showsSuggestions
              ? `${mentionListId}-option-${activeSuggestionIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={showsSuggestions ? mentionListId : undefined}
          aria-expanded={showsSuggestions}
          aria-label={t("companion.channelMessagePlaceholder")}
          disabled={busy}
          onChange={handleChange}
          onClick={handleCaret}
          onKeyDown={handleKeyDown}
          onKeyUp={handleCaret}
          onPaste={handlePaste}
          placeholder={t("companion.channelMessagePlaceholder")}
          ref={inputRef}
          rows={1}
          role="combobox"
          value={body}
        />
      </MentionComposerField>
      <input
        accept="image/*"
        className="channel-composer-file-input"
        disabled={busy || images.length >= maxIssueAttachmentCount}
        multiple
        onChange={handleFileChange}
        ref={attachmentInputRef}
        type="file"
      />
      {body.trim() || images.length > 0 ? (
        <Button
          aria-label={t("run.sendMessage")}
          disabled={busy}
          size="icon"
          type="submit"
        >
          <Send size={16} />
        </Button>
      ) : null}
      {attachmentError ? (
        <p className="channel-composer-error">{attachmentError}</p>
      ) : null}
      </form>
      <ProfileDialog
        profile={profile}
        onOpenChange={(open) => {
          if (!open) setProfile(null);
        }}
      />
    </>
  );
}

function relativeTime(value: string, locale: string) {
  const elapsedSeconds = Math.round(
    (new Date(value).getTime() - Date.now()) / 1_000,
  );
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (Math.abs(elapsedSeconds) < 3_600) {
    return formatter.format(Math.round(elapsedSeconds / 60), "minute");
  }
  if (Math.abs(elapsedSeconds) < 86_400) {
    return formatter.format(Math.round(elapsedSeconds / 3_600), "hour");
  }
  return formatter.format(Math.round(elapsedSeconds / 86_400), "day");
}

function CompanionChannelLoadingSpinner() {
  return (
    <p className="companion-channel-loading">
      <Spinner size={16} />
    </p>
  );
}
