import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  acceptChannelExecutionProposal,
  acceptChannelProposal,
  acceptChannelSkillExecutionProposal,
  declineChannelProposal,
  deleteChannelMessage,
  listChannelMessages,
  loadChannel,
  loadChannelDelta,
  loadDashboard,
  sendChannelMessage,
  toggleChannelMessageReaction,
  updateChannelThreadSubscription,
} from "../lib/api";
import {
  applyChannelThreadSubscribers,
  type ChannelAgentReply,
  type ChannelAgentSummary,
  type ChannelDelta,
  type ChannelExecutionProposal,
  type ChannelMember,
  type ChannelMessage,
  type ChannelSummary,
} from "../lib/channels-contract";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  IssueExecutionApprovalInput,
} from "../types";
import type { MentionTarget } from "../lib/channel-mentions";
import {
  mergeChannelMessages,
  mergeChannelMessageSnapshot,
} from "../lib/channel-message-merge";
import { applyChannelMessageDeletion } from "../lib/channel-message-deletion";
import {
  createOptimisticChannelMessage,
  removeOptimisticChannelMessage,
} from "../lib/optimistic-channel-message";
import { toggleOptimisticChannelReaction } from "../lib/optimistic-channel-reaction";
import { channelReplyErrorText } from "../lib/channel-reply-error";
import {
  channelIssueProposalIsValid,
  channelIssueProposalRequestsExecution,
} from "../components/ChannelIssueProposalDetails";
import type { ChannelSkillCommandTarget } from "./useChannelComposer";
import { currentExecutionWorkerDeviceId } from "../lib/execution-worker-device";
import { useChannelAgentActivity } from "./use-channel-agent-activity";
import type {
  ChannelAgentActivityDescriptor,
  ChannelAgentActivityFrame,
} from "../lib/channel-agent-activity";
import { useI18n } from "../i18n";
import { useToast } from "../components/ui/toast";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import {
  CHANNEL_REALTIME_FALLBACK_MS,
  createChannelRealtimeTransport,
  MAX_CHANNEL_DELTA_PAGES_PER_SYNC,
} from "../lib/channel-realtime";

export type ChannelSurfaceContext = {
  generation: number;
  channelId: string | null;
  threadParentId: string | null;
};

type MessageUpdater = (update: (current: ChannelMessage[]) => ChannelMessage[]) => void;

type UseChannelConversationOptions = {
  token: string;
  organizationId: string;
  currentUserId: string | null;
  channel: ChannelSummary | null;
  members: ChannelMember[];
  agents: ChannelAgentSummary[];
  messages: ChannelMessage[];
  replies: ChannelAgentReply[];
  threadParentId: string | null;
  threadMessages: ChannelMessage[];
  messageNextCursor: string | null;
  pageSize: number;
  updateRootMessages: MessageUpdater;
  updateThreadMessages: MessageUpdater;
  setMembers: Dispatch<SetStateAction<ChannelMember[]>>;
  setAgents: Dispatch<SetStateAction<ChannelAgentSummary[]>>;
  setReplies: Dispatch<SetStateAction<ChannelAgentReply[]>>;
  setThreadParentId: Dispatch<SetStateAction<string | null>>;
  setMessageNextCursor: Dispatch<SetStateAction<string | null>>;
  onChannelLoaded?: (channel: ChannelSummary) => void;
  onConversationLoaded?: (snapshot: ChannelConversationSnapshot) => void;
  onIssueOpen?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  onRootMessagePending?: () => void;
  onThreadClosed?: () => void;
  realtime?: ChannelConversationRealtimeOptions;
  dependencies?: ChannelConversationDependencies;
  activityEnabled?: boolean;
};

export type ChannelConversationRealtimeOptions = {
  enabled: boolean;
  catalogCursor: MutableRefObject<number>;
  catalogReady: boolean;
  syncSignal?: string;
  includeRepliesInRoot?: boolean;
  isBlocked?: () => boolean;
  onCatalogDelta: (delta: ChannelDelta) => void;
  onSelectedChannelRemoved: () => void;
  onSelectedChannelSummary?: (channel: ChannelSummary) => void;
  onSelectedMessages?: (
    messages: ChannelMessage[],
    removedMessageIds: string[],
    reset: boolean,
  ) => void;
  onIncomingRootMessages?: (messages: ChannelMessage[]) => void;
  warningLabel: string;
};

export type ChannelConversationDependencies = {
  acceptChannelExecutionProposal: typeof acceptChannelExecutionProposal;
  acceptChannelProposal: typeof acceptChannelProposal;
  acceptChannelSkillExecutionProposal: typeof acceptChannelSkillExecutionProposal;
  declineChannelProposal: typeof declineChannelProposal;
  createChannelRealtimeTransport: typeof createChannelRealtimeTransport;
  currentExecutionWorkerDeviceId: typeof currentExecutionWorkerDeviceId;
  deleteChannelMessage: typeof deleteChannelMessage;
  listChannelMessages: typeof listChannelMessages;
  loadChannel: typeof loadChannel;
  loadChannelDelta: typeof loadChannelDelta;
  loadDashboard: typeof loadDashboard;
  sendChannelMessage: typeof sendChannelMessage;
  toggleChannelMessageReaction: typeof toggleChannelMessageReaction;
  updateChannelThreadSubscription: typeof updateChannelThreadSubscription;
};

export const defaultChannelConversationDependencies: ChannelConversationDependencies = {
  acceptChannelExecutionProposal,
  acceptChannelProposal,
  acceptChannelSkillExecutionProposal,
  declineChannelProposal,
  createChannelRealtimeTransport,
  currentExecutionWorkerDeviceId,
  deleteChannelMessage,
  listChannelMessages,
  loadChannel,
  loadChannelDelta,
  loadDashboard,
  sendChannelMessage,
  toggleChannelMessageReaction,
  updateChannelThreadSubscription,
};

export type RequestedChannelMessage = {
  channelId: string;
  messageId: string;
  rootMessageId: string;
};

export type ChannelConversationSnapshot = {
  channel: ChannelSummary;
  members: ChannelMember[];
  agents: ChannelAgentSummary[];
  messages: ChannelMessage[];
  nextCursor: string | null;
};

export type LoadChannelConversationOptions = {
  channelId: string;
  messageLimit: number;
  mergeWithCurrentMessages: boolean;
  requestedMessage?: RequestedChannelMessage | null;
  signal?: AbortSignal;
};

export type LoadEarlierMessagesResult = {
  applied: boolean;
  nextCursor: string | null;
};

export function channelConversationError(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export function mergeChannelReplies(
  current: ChannelAgentReply[],
  incoming: ChannelAgentReply[],
  tombstones: ReadonlySet<string> = new Set(),
) {
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

const channelReplyIsTerminal = (reply: ChannelAgentReply) =>
  reply.status === "completed" || reply.status === "failed";

const channelReplyStatusRank = (reply: ChannelAgentReply) => {
  if (channelReplyIsTerminal(reply)) return 2;
  return reply.status === "running" ? 1 : 0;
};

const channelReplyShouldReplace = (
  current: ChannelAgentReply,
  incoming: ChannelAgentReply,
) => {
  const currentTerminal = channelReplyIsTerminal(current);
  const incomingTerminal = channelReplyIsTerminal(incoming);
  if (currentTerminal !== incomingTerminal) return incomingTerminal;
  if (incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  return channelReplyStatusRank(incoming) > channelReplyStatusRank(current);
};

const channelAuthorId = (author: ChannelMessage["author"]) =>
  author.type === "user"
    ? `user:${author.id || author.email || author.name}`
    : `${author.type}:${author.id ?? author.name}`;

const appendReplySummary = (
  parent: ChannelMessage,
  reply: ChannelMessage,
): ChannelMessage => {
  const replyAuthors: NonNullable<ChannelMessage["replyAuthors"]> = [];
  const seen = new Set<string>();
  for (const author of [reply.author, ...(parent.replyAuthors ?? [])]) {
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

const typingAgentNamesForReplies = (
  replies: ChannelAgentReply[],
  agents: ChannelAgentSummary[],
  messageIds: ReadonlySet<string>,
  fallbackName: string,
) => [
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

const activityForReplies = (
  replies: ChannelAgentReply[],
  agents: ChannelAgentSummary[],
  activity: ReadonlyMap<string, ChannelAgentActivityFrame>,
  fallbackName: string,
) => {
  const result: Record<string, ChannelAgentActivityDescriptor> = {};
  for (const reply of replies) {
    const frame = activity.get(reply.id);
    if (!frame?.activity || frame.attempt !== reply.attempts) continue;
    const name = agents.find((agent) => agent.agentId === reply.agentId)?.name ??
      fallbackName;
    result[name] = frame.activity;
  }
  return result;
};

export function useChannelConversation({
  token,
  organizationId,
  currentUserId,
  channel,
  members,
  agents,
  messages,
  replies,
  threadParentId,
  threadMessages,
  messageNextCursor,
  pageSize,
  updateRootMessages,
  updateThreadMessages,
  setMembers,
  setAgents,
  setReplies,
  setThreadParentId,
  setMessageNextCursor,
  onChannelLoaded,
  onConversationLoaded,
  onIssueOpen,
  onSkillSessionAccepted,
  onRootMessagePending,
  onThreadClosed,
  realtime,
  dependencies = defaultChannelConversationDependencies,
  activityEnabled = true,
}: UseChannelConversationOptions) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptingProposalId, setAcceptingProposalId] = useState<string | null>(
    null,
  );
  const [decliningProposalId, setDecliningProposalId] = useState<string | null>(
    null,
  );
  const [threadSubscriptionPending, setThreadSubscriptionPending] = useState(false);
  const [loadingEarlierMessages, setLoadingEarlierMessages] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [proposalProjects, setProposalProjects] = useState<Record<string, string>>(
    {},
  );

  const channelId = channel?.id ?? null;
  const channelSurfaceGeneration = useRef(0);
  const channelIdRef = useRef(channelId);
  const threadParentIdRef = useRef(threadParentId);
  const renderedSurface = useRef({ channelId, threadParentId });
  const proposalVersions = useRef(new Map<string, number>());
  const latestProposals = useRef(
    new Map<string, NonNullable<ChannelMessage["proposal"]>>(),
  );
  const executionHistoryDashboards = useRef(
    new Map<string, ReturnType<typeof loadDashboard>>(),
  );
  const optimisticThreadMessageIds = useRef(new Set<string>());
  const earlierMessagesPending = useRef(false);
  const requestVersion = useRef(0);
  const messagesRef = useRef(messages);
  const repliesRef = useRef(replies);
  const replyTombstones = useRef(new Set<string>());
  const replyVersions = useRef(new Map<string, number>());
  const replyVersion = useRef(0);
  const messageNextCursorRef = useRef(messageNextCursor);
  const realtimeRef = useRef(realtime);
  const dependenciesRef = useRef(dependencies);

  if (
    renderedSurface.current.channelId !== channelId ||
    renderedSurface.current.threadParentId !== threadParentId
  ) {
    channelSurfaceGeneration.current += 1;
    renderedSurface.current = { channelId, threadParentId };
  }
  channelIdRef.current = channelId;
  threadParentIdRef.current = threadParentId;
  messagesRef.current = messages;
  repliesRef.current = replies;
  for (const reply of replies) {
    if (!replyVersions.current.has(reply.id)) {
      replyVersions.current.set(reply.id, replyVersion.current);
    }
  }
  messageNextCursorRef.current = messageNextCursor;
  realtimeRef.current = realtime;
  dependenciesRef.current = dependencies;

  const liveActivity = useChannelAgentActivity(
    token,
    organizationId,
    activityEnabled ? channelId : null,
  );

  const captureChannelSurface = useCallback(
    (): ChannelSurfaceContext => ({
      generation: channelSurfaceGeneration.current,
      channelId: channelIdRef.current,
      threadParentId: threadParentIdRef.current,
    }),
    [],
  );

  const channelSurfaceIsCurrent = useCallback(
    (context: ChannelSurfaceContext) =>
      context.generation === channelSurfaceGeneration.current &&
      context.channelId === channelIdRef.current &&
      context.threadParentId === threadParentIdRef.current,
    [],
  );

  const invalidateChannelSurface = useCallback(
    (nextChannelId: string | null, nextThreadParentId: string | null) => {
      channelSurfaceGeneration.current += 1;
      requestVersion.current += 1;
      channelIdRef.current = nextChannelId;
      threadParentIdRef.current = nextThreadParentId;
      renderedSurface.current = {
        channelId: nextChannelId,
        threadParentId: nextThreadParentId,
      };
      setBusy(false);
      setAcceptingProposalId(null);
      setDecliningProposalId(null);
      setThreadLoading(false);
      earlierMessagesPending.current = false;
      setLoadingEarlierMessages(false);
    },
    [],
  );

  useEffect(() => {
    setBusy(false);
    setAcceptingProposalId(null);
    setDecliningProposalId(null);
  }, [channelId, threadParentId]);

  useEffect(() => {
    executionHistoryDashboards.current.clear();
  }, [token]);

  useEffect(
    () => () => {
      channelSurfaceGeneration.current += 1;
      requestVersion.current += 1;
      channelIdRef.current = null;
      threadParentIdRef.current = null;
    },
    [],
  );

  const recordProposalMessages = useCallback((incoming: ChannelMessage[]) => {
    const recorded = new Set<string>();
    for (const item of incoming) {
      const proposal = item.proposal;
      if (!proposal || recorded.has(proposal.id)) continue;
      recorded.add(proposal.id);
      const previous = latestProposals.current.get(proposal.id);
      latestProposals.current.set(proposal.id, proposal);
      if (previous && JSON.stringify(previous) === JSON.stringify(proposal)) {
        continue;
      }
      proposalVersions.current.set(
        proposal.id,
        (proposalVersions.current.get(proposal.id) ?? 0) + 1,
      );
    }
  }, []);

  const clearProposalHistory = useCallback(() => {
    proposalVersions.current.clear();
    latestProposals.current.clear();
    setProposalProjects({});
  }, []);

  const replyFailureMessage = useCallback(
    (reply: ChannelAgentReply) =>
      t("run.briarReplyFailed", {
        error: channelReplyErrorText(reply.error, {
          fallback: t("run.failed"),
          noAvailableWorker: t("agents.agentWorkerUnavailable"),
          usageExhausted: t("agents.agentUsageExhausted"),
        }),
      }),
    [t],
  );

  const applyAgentReplies = useCallback(
    (incoming: ChannelAgentReply[], reset = false) => {
      if (incoming.length === 0 && !reset) return;
      for (const reply of incoming) {
        replyVersion.current += 1;
        replyVersions.current.set(reply.id, replyVersion.current);
        if (channelReplyIsTerminal(reply)) replyTombstones.current.add(reply.id);
      }
      setReplies((current) => {
        const next = reset
          ? [...incoming]
          : mergeChannelReplies(current, incoming, replyTombstones.current);
        repliesRef.current = next;
        return next;
      });
      const failed = incoming.find(
        (reply) =>
          reply.channelId === channelIdRef.current && reply.status === "failed",
      );
      if (failed) setError(replyFailureMessage(failed));
    },
    [replyFailureMessage, setReplies],
  );

  const applyAuthoritativeAgentReplies = useCallback(
    (
      incoming: ChannelAgentReply[],
      selectedChannelId: string,
      observedReplyVersion: number,
    ) => {
      const authoritative = incoming.filter(
        (reply) => reply.channelId === selectedChannelId,
      );
      const incomingIds = new Set(authoritative.map((reply) => reply.id));
      const recordTombstones = (current: ChannelAgentReply[]) => {
        for (const reply of current) {
          if (
            reply.channelId === selectedChannelId &&
            (replyVersions.current.get(reply.id) ?? 0) <= observedReplyVersion &&
            !incomingIds.has(reply.id)
          ) {
            replyTombstones.current.add(reply.id);
          }
        }
        for (const reply of authoritative) {
          if (channelReplyIsTerminal(reply)) replyTombstones.current.add(reply.id);
        }
      };
      recordTombstones(repliesRef.current);
      setReplies((current) => {
        recordTombstones(current);
        const concurrent = current.filter(
          (reply) =>
            reply.channelId === selectedChannelId &&
            (replyVersions.current.get(reply.id) ?? 0) > observedReplyVersion,
        );
        const next = [
          ...current.filter((reply) => reply.channelId !== selectedChannelId),
          ...mergeChannelReplies(
            mergeChannelReplies(
              [],
              authoritative,
              replyTombstones.current,
            ),
            concurrent,
            replyTombstones.current,
          ),
        ];
        repliesRef.current = next;
        return next;
      });
    },
    [setReplies],
  );

  const applyIncomingMessages = useCallback(
    (
      incoming: ChannelMessage[],
      removedMessageIds: string[],
      includeRepliesInRoot = false,
      reset = false,
    ) => {
      const activeId = channelIdRef.current;
      const relevant = incoming.filter((item) => item.channelId === activeId);
      recordProposalMessages(relevant);
      const rootUpdates = includeRepliesInRoot
        ? relevant
        : relevant.filter((item) => item.parentMessageId === null);
      if (reset || rootUpdates.length || removedMessageIds.length) {
        updateRootMessages((current) =>
          reset
            ? [...rootUpdates]
            : mergeChannelMessages(current, rootUpdates, removedMessageIds)
        );
      }
      const activeThreadId = threadParentIdRef.current;
      if (
        activeThreadId &&
        (reset || relevant.length || removedMessageIds.length)
      ) {
        const threadUpdates = relevant.filter(
          (item) =>
            item.id === activeThreadId ||
            item.parentMessageId === activeThreadId,
        );
        updateThreadMessages((current) =>
          reset
            ? [...threadUpdates]
            : mergeChannelMessages(current, threadUpdates, removedMessageIds)
        );
      }
    },
    [recordProposalMessages, updateRootMessages, updateThreadMessages],
  );

  useEffect(() => {
    const initial = realtimeRef.current;
    if (!initial?.enabled || !initial.catalogReady) return;
    let stopped = false;
    let inFlight = false;
    let pending = false;
    let blockedRetry: number | null = null;
    const abortController = new AbortController();
    const transport = dependenciesRef.current.createChannelRealtimeTransport(
      token,
      organizationId,
    );

    const scheduleBlockedRetry = () => {
      if (blockedRetry !== null || stopped) return;
      blockedRetry = window.setTimeout(() => {
        blockedRetry = null;
        if (pending) void sync();
      }, 250);
    };

    const sync = async () => {
      pending = true;
      const options = realtimeRef.current;
      if (
        !options?.enabled ||
        !options.catalogReady ||
        stopped ||
        document.hidden ||
        inFlight ||
        options.isBlocked?.()
      ) {
        if (options?.isBlocked?.()) scheduleBlockedRetry();
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
            const currentOptions = realtimeRef.current;
            if (!currentOptions) return;
            const requestedCursor = currentOptions.catalogCursor.current;
            const requestedVersion = requestVersion.current;
            const delta = await dependenciesRef.current.loadChannelDelta(
              token,
              organizationId,
              requestedCursor,
              abortController.signal,
            );
            if (
              stopped ||
              requestedCursor !== currentOptions.catalogCursor.current ||
              requestedVersion !== requestVersion.current ||
              currentOptions.isBlocked?.()
            ) return;
            currentOptions.catalogCursor.current = delta.cursor;
            currentOptions.onCatalogDelta(delta);

            const selectedChannelId = channelIdRef.current;
            const selectedSummary = delta.channels.find(
              (item) => item.id === selectedChannelId,
            );
            if (
              selectedChannelId &&
              (delta.removedChannelIds.includes(selectedChannelId) ||
                (delta.reset && !selectedSummary))
            ) {
              invalidateChannelSurface(null, null);
              currentOptions.onSelectedChannelRemoved();
              return;
            }
            if (selectedSummary) {
              currentOptions.onSelectedChannelSummary?.(selectedSummary);
            }
            const selectedMessages = delta.messages.filter(
              (item) => item.channelId === selectedChannelId,
            );
            currentOptions.onSelectedMessages?.(
              selectedMessages,
              delta.removedMessageIds,
              delta.reset,
            );
            const rootMessages = currentOptions.includeRepliesInRoot
              ? selectedMessages
              : selectedMessages.filter(
                  (item) => item.parentMessageId === null,
                );
            if (!delta.reset && rootMessages.length > 0) {
              currentOptions.onIncomingRootMessages?.(rootMessages);
            }
            if (selectedChannelId) {
              applyIncomingMessages(
                selectedMessages,
                delta.removedMessageIds,
                currentOptions.includeRepliesInRoot,
                delta.reset,
              );
              applyAgentReplies(
                delta.agentReplies.filter(
                  (item) => item.channelId === selectedChannelId,
                ),
                delta.reset,
              );
            }
            if (!delta.hasMore || delta.cursor <= requestedCursor) break;
          }
        }
      } catch (cause) {
        if (!abortController.signal.aborted) {
          console.warn(realtimeRef.current?.warningLabel ?? "Channel delta failed", cause);
        }
      } finally {
        inFlight = false;
        if (pending && !stopped) window.queueMicrotask(() => void sync());
      }
    };

    const unsubscribe = transport.subscribe((notification) => {
      const options = realtimeRef.current;
      if (
        options &&
        notification.topic === "channels" &&
        notification.cursor > options.catalogCursor.current
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
    applyAgentReplies,
    applyIncomingMessages,
    channelId,
    invalidateChannelSurface,
    organizationId,
    realtime?.catalogReady,
    realtime?.enabled,
    realtime?.syncSignal,
    threadParentId,
    token,
  ]);

  const loadChannelConversation = useCallback(
    async ({
      channelId: requestedChannelId,
      messageLimit,
      mergeWithCurrentMessages,
      requestedMessage,
      signal,
    }: LoadChannelConversationOptions) => {
      const context = captureChannelSurface();
      const version = ++requestVersion.current;
      const observedReplyVersion = replyVersion.current;
      try {
        const result = await dependenciesRef.current.loadChannel(
          token,
          organizationId,
          requestedChannelId,
          { messageLimit, signal },
        );
        if (
          signal?.aborted ||
          version !== requestVersion.current ||
          !channelSurfaceIsCurrent(context)
        ) return null;

        onChannelLoaded?.(result.channel);
        setMembers(result.members);
        setAgents(result.agents);
        applyAuthoritativeAgentReplies(
          result.agentReplies ?? [],
          requestedChannelId,
          observedReplyVersion,
        );
        recordProposalMessages(result.messages);
        const currentMessages = messagesRef.current;
        let appliedMessages = mergeWithCurrentMessages
          ? mergeChannelMessages(currentMessages, result.messages, [])
          : result.messages;
        updateRootMessages(() => appliedMessages);
        const nextCursor =
          mergeWithCurrentMessages &&
            currentMessages.length > result.messages.length
            ? messageNextCursorRef.current
            : result.nextCursor ?? null;
        messageNextCursorRef.current = nextCursor;
        setMessageNextCursor(nextCursor);

        const target = requestedMessage?.channelId === requestedChannelId
          ? requestedMessage
          : null;
        let requestedThreadResult: Awaited<
          ReturnType<typeof listChannelMessages>
        > | null = null;
        if (
          target &&
          !appliedMessages.some((item) => item.id === target.rootMessageId)
        ) {
          requestedThreadResult = await dependenciesRef.current.listChannelMessages(
            token,
            organizationId,
            requestedChannelId,
            target.rootMessageId,
            { signal },
          );
          if (
            signal?.aborted ||
            version !== requestVersion.current ||
            !channelSurfaceIsCurrent(context)
          ) return null;
          const roots = requestedThreadResult.messages.filter(
            (item) => item.parentMessageId === null,
          );
          recordProposalMessages(roots);
          appliedMessages = mergeChannelMessages(appliedMessages, roots, []);
          updateRootMessages(() => appliedMessages);
        }
        if (target && target.rootMessageId !== target.messageId) {
          const threadResult = requestedThreadResult ??
            await dependenciesRef.current.listChannelMessages(
              token,
              organizationId,
              requestedChannelId,
              target.rootMessageId,
              { signal },
            );
          if (
            signal?.aborted ||
            version !== requestVersion.current ||
            !channelSurfaceIsCurrent(context)
          ) return null;
          recordProposalMessages(threadResult.messages);
          invalidateChannelSurface(requestedChannelId, target.rootMessageId);
          setThreadParentId(target.rootMessageId);
          updateThreadMessages((current) =>
            mergeChannelMessageSnapshot(current, threadResult.messages)
          );
        } else if (target) {
          setThreadParentId(null);
          updateThreadMessages(() => []);
        }
        const snapshot = {
          channel: result.channel,
          members: result.members,
          agents: result.agents,
          messages: appliedMessages,
          nextCursor,
        };
        onConversationLoaded?.(snapshot);
        return { ...snapshot, requestedMessage: target };
      } catch (cause) {
        if (
          !signal?.aborted &&
          version === requestVersion.current &&
          channelSurfaceIsCurrent(context)
        ) {
          setError(channelConversationError(cause));
        }
        return null;
      }
    },
    [
      applyAuthoritativeAgentReplies,
      captureChannelSurface,
      channelSurfaceIsCurrent,
      invalidateChannelSurface,
      onChannelLoaded,
      onConversationLoaded,
      organizationId,
      recordProposalMessages,
      setAgents,
      setMembers,
      setMessageNextCursor,
      setThreadParentId,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const loadEarlierChannelMessages = useCallback(
    async (signal?: AbortSignal): Promise<LoadEarlierMessagesResult> => {
      const activeId = channelIdRef.current;
      const cursor = messageNextCursorRef.current;
      if (
        !activeId ||
        !cursor ||
        earlierMessagesPending.current
      ) {
        return { applied: false, nextCursor: cursor };
      }
      const context = captureChannelSurface();
      earlierMessagesPending.current = true;
      setLoadingEarlierMessages(true);
      try {
        const result = await dependenciesRef.current.listChannelMessages(
          token,
          organizationId,
          activeId,
          undefined,
          { limit: pageSize, cursor, signal },
        );
        if (!channelSurfaceIsCurrent(context)) {
          return { applied: false, nextCursor: cursor };
        }
        recordProposalMessages(result.messages);
        updateRootMessages((current) =>
          mergeChannelMessages(current, result.messages, [])
        );
        const nextCursor = result.nextCursor ?? null;
        messageNextCursorRef.current = nextCursor;
        setMessageNextCursor(nextCursor);
        return { applied: true, nextCursor };
      } catch (cause) {
        if (!signal?.aborted && channelSurfaceIsCurrent(context)) {
          setError(channelConversationError(cause));
        }
        return { applied: false, nextCursor: cursor };
      } finally {
        earlierMessagesPending.current = false;
        if (channelSurfaceIsCurrent(context)) setLoadingEarlierMessages(false);
      }
    },
    [
      captureChannelSurface,
      channelSurfaceIsCurrent,
      organizationId,
      pageSize,
      recordProposalMessages,
      setMessageNextCursor,
      token,
      updateRootMessages,
    ],
  );

  const openThread = useCallback(
    async (parentMessageId: string, cachedMessages: ChannelMessage[] = []) => {
      const activeId = channelIdRef.current;
      if (!activeId) return false;
      invalidateChannelSurface(activeId, parentMessageId);
      const version = requestVersion.current;
      const context = captureChannelSurface();
      setThreadParentId(parentMessageId);
      updateThreadMessages(() => cachedMessages);
      setThreadLoading(cachedMessages.length === 0);
      setError(null);
      try {
        const result = await dependenciesRef.current.listChannelMessages(
          token,
          organizationId,
          activeId,
          parentMessageId,
        );
        if (
          version !== requestVersion.current ||
          !channelSurfaceIsCurrent(context)
        ) return false;
        recordProposalMessages(result.messages);
        updateThreadMessages((current) =>
          mergeChannelMessageSnapshot(current, result.messages)
        );
        return true;
      } catch (cause) {
        if (
          version === requestVersion.current &&
          channelSurfaceIsCurrent(context)
        ) {
          setError(channelConversationError(cause));
        }
        return false;
      } finally {
        if (
          version === requestVersion.current &&
          channelSurfaceIsCurrent(context)
        ) {
          setThreadLoading(false);
        }
      }
    },
    [
      captureChannelSurface,
      channelSurfaceIsCurrent,
      invalidateChannelSurface,
      organizationId,
      recordProposalMessages,
      setThreadParentId,
      token,
      updateThreadMessages,
    ],
  );

  const closeThread = useCallback(() => {
    const activeId = channelIdRef.current;
    if (!activeId || !threadParentIdRef.current) return false;
    invalidateChannelSurface(activeId, null);
    setThreadParentId(null);
    updateThreadMessages(() => []);
    setError(null);
    onThreadClosed?.();
    return true;
  }, [invalidateChannelSurface, onThreadClosed, setThreadParentId, updateThreadMessages]);

  const send = useCallback(
    async (
      body: string,
      mentions: MentionTarget[],
      parentMessageId: string | null,
      attachments: File[],
      attachmentReferences: string[],
      selectedSkill?: ChannelSkillCommandTarget,
    ) => {
      const activeId = channelIdRef.current;
      if (!activeId || !body.trim()) return;
      const sendContext = captureChannelSurface();
      const clientMessageId = crypto.randomUUID();
      const attachmentUrls = attachments.map((attachment) =>
        URL.createObjectURL(attachment)
      );
      const optimisticMessage = createOptimisticChannelMessage({
        id: clientMessageId,
        channelId: activeId,
        parentMessageId,
        body: body.trim(),
        currentUserId,
        fallbackAuthorName: t("channel.you"),
        members,
        mentions,
        attachments,
        attachmentReferences,
        attachmentUrls,
      });
      const parentBeforeSend = parentMessageId
        ? messages.find((item) => item.id === parentMessageId) ?? null
        : null;
      setBusy(true);
      setError(null);
      if (parentMessageId) {
        optimisticThreadMessageIds.current.add(clientMessageId);
        updateRootMessages((current) => current.map((item) =>
          item.id === parentMessageId
            ? appendReplySummary(item, optimisticMessage)
            : item
        ));
        updateThreadMessages((current) =>
          mergeChannelMessages(current, [optimisticMessage], [])
        );
      } else {
        onRootMessagePending?.();
        updateRootMessages((current) =>
          mergeChannelMessages(current, [optimisticMessage], [])
        );
      }
      try {
        const hasAgentMention = mentions.some(
          (mention) => mention.type === "agent",
        );
        const implicitlyInvokesDirectAgent =
          channel?.kind === "dm" && members.length === 1 && agents.length === 1;
        const preferredDeviceId =
          hasAgentMention || implicitlyInvokesDirectAgent || selectedSkill
            ? await dependenciesRef.current.currentExecutionWorkerDeviceId(
                organizationId,
              )
            : null;
        const mentionedAgentIds = mentions
          .filter((mention) => mention.type === "agent")
          .map((mention) => mention.id);
        if (selectedSkill && !mentionedAgentIds.includes(selectedSkill.agentId)) {
          mentionedAgentIds.push(selectedSkill.agentId);
        }
        const result = await dependenciesRef.current.sendChannelMessage(
          token,
          organizationId,
          activeId,
          {
          body: body.trim(),
          clientMessageId,
          skillId: selectedSkill?.skill.id ?? null,
          parentMessageId,
          mentionedUserIds: mentions
            .filter((mention) => mention.type === "user")
            .map((mention) => mention.id),
          mentionedAgentIds,
          ...(preferredDeviceId ? { preferredDeviceId } : {}),
          attachments,
          attachmentReferences,
          },
        );
        if (!channelSurfaceIsCurrent(sendContext)) return;
        applyAgentReplies(result.agentReplies);
        if (parentMessageId) {
          optimisticThreadMessageIds.current.delete(clientMessageId);
          updateThreadMessages((current) =>
            mergeChannelMessages(current, [result.message], [])
          );
        } else {
          onRootMessagePending?.();
          updateRootMessages((current) =>
            mergeChannelMessages(current, [result.message], [])
          );
        }
      } catch (cause) {
        if (channelSurfaceIsCurrent(sendContext)) {
          const shouldRollbackReplySummary = parentMessageId
            ? optimisticThreadMessageIds.current.delete(clientMessageId)
            : false;
          updateThreadMessages((current) =>
            removeOptimisticChannelMessage(current, clientMessageId)
          );
          updateRootMessages((current) => {
            const removed = removeOptimisticChannelMessage(
              current,
              clientMessageId,
            );
            return parentMessageId && shouldRollbackReplySummary
              ? removed.map((item) =>
                  item.id === parentMessageId
                    ? {
                        ...item,
                        replyCount: Math.max(0, item.replyCount - 1),
                        ...(item.lastReplyAt === optimisticMessage.createdAt
                          ? {
                              lastReplyAt: parentBeforeSend?.lastReplyAt ?? null,
                              replyAuthors: parentBeforeSend?.replyAuthors ?? [],
                            }
                          : {}),
                      }
                    : item
                )
              : removed;
          });
          setError(channelConversationError(cause));
        }
      } finally {
        optimisticThreadMessageIds.current.delete(clientMessageId);
        for (const url of attachmentUrls) URL.revokeObjectURL(url);
        if (channelSurfaceIsCurrent(sendContext)) setBusy(false);
      }
    },
    [
      agents.length,
      applyAgentReplies,
      captureChannelSurface,
      channel?.kind,
      channelSurfaceIsCurrent,
      currentUserId,
      members,
      messages,
      onRootMessagePending,
      organizationId,
      t,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const openIssue = useCallback(
    async (
      projectId: string,
      runId: string,
      context: ChannelSurfaceContext = captureChannelSurface(),
    ) => {
      try {
        await onIssueOpen?.(projectId, runId);
      } catch (cause) {
        if (channelSurfaceIsCurrent(context)) {
          setError(channelConversationError(cause));
        }
      }
    },
    [captureChannelSurface, channelSurfaceIsCurrent, onIssueOpen],
  );

  const loadExecutionProposalContext = useCallback(
    async (proposal: ChannelExecutionProposal) => {
      const cacheHistory = proposal.status === "accepted";
      let dashboardRequest = cacheHistory
        ? executionHistoryDashboards.current.get(proposal.projectId)
        : undefined;
      if (!dashboardRequest) {
        dashboardRequest = dependenciesRef.current.loadDashboard(
          token,
          proposal.projectId,
        );
        if (cacheHistory) {
          executionHistoryDashboards.current.set(
            proposal.projectId,
            dashboardRequest,
          );
        }
      }
      try {
        const dashboard = await dashboardRequest;
        return {
          run: dashboard.runs.find((run) => run.id === proposal.runId) ?? null,
          workers: dashboard.workers ?? [],
          policy: dashboard.executionPolicy,
        };
      } catch (cause) {
        if (
          cacheHistory &&
          executionHistoryDashboards.current.get(proposal.projectId) ===
            dashboardRequest
        ) {
          executionHistoryDashboards.current.delete(proposal.projectId);
        }
        throw cause;
      }
    },
    [token],
  );

  const loadCreateExecutionProposalContext = useCallback(
    async (projectId: string) => {
      const dashboard = await dependenciesRef.current.loadDashboard(
        token,
        projectId,
      );
      return {
        run: null,
        workers: dashboard.workers ?? [],
        policy: dashboard.executionPolicy,
      };
    },
    [token],
  );

  const loadSkillExecutionProposalContext = useCallback(
    async (proposal: AgentSkillExecutionProposal) => {
      const dashboard = await dependenciesRef.current.loadDashboard(
        token,
        proposal.projectId,
      );
      return {
        workers: dashboard.workers ?? [],
        policy: dashboard.executionPolicy,
      };
    },
    [token],
  );

  const acceptExecutionProposal = useCallback(
    async (item: ChannelMessage, input: IssueExecutionApprovalInput) => {
      const proposal = item.executionProposal;
      if (
        !proposal ||
        proposal.status !== "pending" ||
        !channelIdRef.current ||
        channelIdRef.current !== item.channelId
      ) {
        throw new Error(t("executionApproval.targetUnavailable"));
      }
      const result = await dependenciesRef.current.acceptChannelExecutionProposal(
        token,
        organizationId,
        item.channelId,
        proposal.id,
        input,
      );
      return result.proposal;
    },
    [organizationId, t, token],
  );

  const applyAcceptedExecutionProposal = useCallback(
    (messageId: string, proposal: ChannelExecutionProposal) => {
      const apply = (item: ChannelMessage): ChannelMessage =>
        item.id === messageId && item.executionProposal?.id === proposal.id
          ? { ...item, executionProposal: proposal }
          : item;
      updateRootMessages((current) => current.map(apply));
      updateThreadMessages((current) => current.map(apply));
    },
    [updateRootMessages, updateThreadMessages],
  );

  const acceptSkillExecutionProposal = useCallback(
    async (
      item: ChannelMessage,
      input: AgentSkillExecutionApprovalInput,
    ) => {
      const proposal = item.skillExecutionProposal;
      if (
        !proposal ||
        proposal.status !== "pending" ||
        !channelIdRef.current ||
        channelIdRef.current !== item.channelId
      ) {
        throw new Error(t("skillExecution.approvalUnavailable"));
      }
      const result = await dependenciesRef.current.acceptChannelSkillExecutionProposal(
        token,
        organizationId,
        item.channelId,
        proposal,
        input,
      );
      if (result.session) onSkillSessionAccepted?.(result.session);
      return result.proposal;
    },
    [onSkillSessionAccepted, organizationId, t, token],
  );

  const applyAcceptedSkillExecutionProposal = useCallback(
    (messageId: string, proposal: AgentSkillExecutionProposal) => {
      const apply = (item: ChannelMessage): ChannelMessage =>
        item.id === messageId && item.skillExecutionProposal?.id === proposal.id
          ? { ...item, skillExecutionProposal: proposal }
          : item;
      updateRootMessages((current) => current.map(apply));
      updateThreadMessages((current) => current.map(apply));
    },
    [updateRootMessages, updateThreadMessages],
  );

  const refreshProposalState = useCallback(
    async (item: ChannelMessage, proposalId: string) => {
      const activeId = channelIdRef.current;
      if (!activeId) return null;
      const context = captureChannelSurface();
      const version = ++requestVersion.current;
      try {
        if (item.parentMessageId) {
          const result = await dependenciesRef.current.listChannelMessages(
            token,
            organizationId,
            activeId,
            item.parentMessageId,
          );
          if (
            version !== requestVersion.current ||
            !channelSurfaceIsCurrent(context)
          ) return latestProposals.current.get(proposalId) ?? null;
          recordProposalMessages(result.messages);
          updateThreadMessages((current) =>
            mergeChannelMessageSnapshot(current, result.messages)
          );
        } else {
          const result = await dependenciesRef.current.loadChannel(
            token,
            organizationId,
            activeId,
            { messageLimit: pageSize },
          );
          if (
            version !== requestVersion.current ||
            !channelSurfaceIsCurrent(context)
          ) return latestProposals.current.get(proposalId) ?? null;
          recordProposalMessages(result.messages);
          setMembers(result.members);
          setAgents(result.agents);
          updateRootMessages((current) =>
            mergeChannelMessages(current, result.messages, [])
          );
          onChannelLoaded?.(result.channel);
        }
        return latestProposals.current.get(proposalId) ?? null;
      } finally {
        // Request version intentionally remains advanced: any response that
        // started before this authoritative refresh must not overwrite it.
      }
    },
    [
      captureChannelSurface,
      channelSurfaceIsCurrent,
      onChannelLoaded,
      organizationId,
      pageSize,
      recordProposalMessages,
      setAgents,
      setMembers,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const acceptProposal = useCallback(
    async (
      item: ChannelMessage,
      execution: IssueExecutionApprovalInput | null = null,
    ): Promise<string | null | undefined> => {
      const activeId = channelIdRef.current;
      if (
        !activeId ||
        item.channelId !== activeId ||
        item.proposal?.actionType !== "request_issue_create" ||
        !channelIssueProposalIsValid(item.proposal)
      ) return t("executionApproval.targetUnavailable");
      const proposalId = item.proposal.id;
      const requestsExecution = channelIssueProposalRequestsExecution(
        item.proposal,
      );
      const projectId =
        item.proposal.projectId ??
        channel?.defaultProjectId ??
        proposalProjects[proposalId] ??
        null;
      if (!projectId) return;
      const approvalContext = captureChannelSurface();
      const approvalContextIsCurrent = () =>
        approvalContext.channelId === activeId &&
        approvalContext.threadParentId === threadParentIdRef.current &&
        channelSurfaceIsCurrent(approvalContext);
      const approvalProposalVersion = proposalVersions.current.get(proposalId) ?? 0;
      setBusy(true);
      setAcceptingProposalId(proposalId);
      setError(null);
      try {
        const result = execution
          ? await dependenciesRef.current.acceptChannelProposal(
              token,
              organizationId,
              activeId,
              proposalId,
              projectId,
              execution,
            )
          : await dependenciesRef.current.acceptChannelProposal(
              token,
              organizationId,
              activeId,
              proposalId,
              projectId,
            );
        const hasExecutionFollowUp =
          requestsExecution || result.executionProposal != null;
        if (!approvalContextIsCurrent()) return;
        const applyResult = (candidate: ChannelMessage): ChannelMessage =>
          candidate.proposal?.id === proposalId
            ? {
                ...candidate,
                proposal: {
                  ...candidate.proposal,
                  status: "accepted",
                  projectId: result.projectId,
                  resultRunId: result.resultRunId,
                  resultItems: result.resultItems,
                },
                executionProposal:
                  result.executionProposal ?? candidate.executionProposal,
              }
            : candidate;
        const applySuccessfulResponse = () => {
          updateRootMessages((current) => current.map(applyResult));
          updateThreadMessages((current) => current.map(applyResult));
          recordProposalMessages([applyResult(item)]);
        };
        if (
          (proposalVersions.current.get(proposalId) ?? 0) ===
            approvalProposalVersion
        ) {
          applySuccessfulResponse();
          if (hasExecutionFollowUp && !result.executionProposal) {
            await refreshProposalState(applyResult(item), proposalId);
          }
        } else {
          let latest = latestProposals.current.get(proposalId);
          if (latest?.status !== "accepted") {
            latest = (await refreshProposalState(item, proposalId)) ?? undefined;
          }
          if (!approvalContextIsCurrent()) return;
          if (
            latest?.status === "accepted" &&
            latest.projectId &&
            latest.resultRunId &&
            channelIssueProposalIsValid(latest)
          ) {
            if (hasExecutionFollowUp) {
              if (result.executionProposal) applySuccessfulResponse();
              else await refreshProposalState(item, proposalId);
            }
          } else if (
            latest?.status === "pending" &&
            latest.projectId === result.projectId
          ) {
            applySuccessfulResponse();
            if (hasExecutionFollowUp && !result.executionProposal) {
              await refreshProposalState(applyResult(item), proposalId);
            }
          }
        }
        return null;
      } catch (cause) {
        const failure = channelConversationError(cause);
        if (approvalContextIsCurrent()) setError(failure);
        return failure;
      } finally {
        if (approvalContextIsCurrent()) {
          setBusy(false);
          setAcceptingProposalId(null);
        }
      }
    },
    [
      captureChannelSurface,
      channel?.defaultProjectId,
      channelSurfaceIsCurrent,
      organizationId,
      proposalProjects,
      recordProposalMessages,
      refreshProposalState,
      t,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const declineProposal = useCallback(
    async (item: ChannelMessage) => {
      const activeId = channelIdRef.current;
      const proposal = item.proposal;
      if (
        !activeId ||
        item.channelId !== activeId ||
        proposal?.actionType !== "request_issue_create" ||
        proposal.status !== "pending"
      ) return;
      const declineContext = captureChannelSurface();
      setBusy(true);
      setDecliningProposalId(proposal.id);
      setError(null);
      try {
        await dependenciesRef.current.declineChannelProposal(
          token,
          organizationId,
          activeId,
          proposal.id,
        );
        if (!channelSurfaceIsCurrent(declineContext)) return;
        const applyDecline = (candidate: ChannelMessage): ChannelMessage =>
          candidate.proposal?.id === proposal.id &&
            candidate.proposal.status === "pending"
            ? {
                ...candidate,
                proposal: { ...candidate.proposal, status: "declined" },
              }
            : candidate;
        updateRootMessages((current) => current.map(applyDecline));
        updateThreadMessages((current) => current.map(applyDecline));
        recordProposalMessages([applyDecline(item)]);
      } catch (cause) {
        if (channelSurfaceIsCurrent(declineContext)) {
          setError(channelConversationError(cause));
        }
      } finally {
        if (channelSurfaceIsCurrent(declineContext)) {
          setBusy(false);
          setDecliningProposalId(null);
        }
      }
    },
    [
      captureChannelSurface,
      channelSurfaceIsCurrent,
      organizationId,
      recordProposalMessages,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const toggleReaction = useCallback(
    async (item: ChannelMessage, emoji: string) => {
      const activeId = channelIdRef.current;
      if (!activeId) return;
      const reactionContext = captureChannelSurface();
      const optimisticReactions = (candidate: ChannelMessage) =>
        candidate.id === item.id
          ? {
              ...candidate,
              reactions: toggleOptimisticChannelReaction(
                candidate.reactions,
                emoji,
                currentUserId,
              ),
            }
          : candidate;
      updateRootMessages((current) => current.map(optimisticReactions));
      updateThreadMessages((current) => current.map(optimisticReactions));
      try {
        const result = await dependenciesRef.current.toggleChannelMessageReaction(
          token,
          organizationId,
          activeId,
          item.id,
          emoji,
        );
        if (!channelSurfaceIsCurrent(reactionContext)) return;
        const applyReactions = (candidate: ChannelMessage) =>
          candidate.id === result.message.id
            ? { ...candidate, reactions: result.message.reactions }
            : candidate;
        updateRootMessages((current) => current.map(applyReactions));
        updateThreadMessages((current) => current.map(applyReactions));
      } catch (cause) {
        if (!channelSurfaceIsCurrent(reactionContext)) return;
        updateRootMessages((current) => current.map(optimisticReactions));
        updateThreadMessages((current) => current.map(optimisticReactions));
        toast(channelConversationError(cause), { tone: "error" });
      }
    },
    [
      captureChannelSurface,
      channelSurfaceIsCurrent,
      currentUserId,
      organizationId,
      toast,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const removeMessage = useCallback(
    async (item: ChannelMessage) => {
      const activeId = channelIdRef.current;
      if (!activeId || item.deletedAt) return;
      if (!window.confirm(t("channel.deleteMessageConfirm"))) return;
      const deletionContext = captureChannelSurface();
      setBusy(true);
      try {
        const result = await dependenciesRef.current.deleteChannelMessage(
          token,
          organizationId,
          activeId,
          item.id,
        );
        if (!channelSurfaceIsCurrent(deletionContext)) return;
        updateRootMessages((current) =>
          applyChannelMessageDeletion(current, item.id, result)
        );
        updateThreadMessages((current) =>
          applyChannelMessageDeletion(current, item.id, result)
        );
        if (result.deleted) {
          setReplies((current) => current.filter((reply) =>
            reply.triggerMessageId !== item.id &&
            reply.replyMessageId !== item.id
          ));
          if (threadParentIdRef.current === item.id && !result.message) {
            closeThread();
          }
        }
      } catch (cause) {
        if (channelSurfaceIsCurrent(deletionContext)) {
          toast(channelConversationError(cause), { tone: "error" });
        }
      } finally {
        if (channelSurfaceIsCurrent(deletionContext)) setBusy(false);
      }
    },
    [
      captureChannelSurface,
      channelSurfaceIsCurrent,
      closeThread,
      organizationId,
      setReplies,
      t,
      toast,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const toggleThreadSubscription = useCallback(
    async (subscribed: boolean) => {
      const activeId = channelIdRef.current;
      const parentId = threadParentIdRef.current;
      if (!activeId || !parentId || threadSubscriptionPending) return;
      const context = captureChannelSurface();
      setThreadSubscriptionPending(true);
      setError(null);
      try {
        const result = await dependenciesRef.current.updateChannelThreadSubscription(
          token,
          organizationId,
          activeId,
          parentId,
          subscribed,
        );
        if (!channelSurfaceIsCurrent(context)) return;
        const apply = (current: ChannelMessage[]) =>
          applyChannelThreadSubscribers(
            current,
            result.rootMessageId,
            result.subscribers,
          );
        updateRootMessages(apply);
        updateThreadMessages(apply);
      } catch (cause) {
        if (channelSurfaceIsCurrent(context)) {
          setError(channelConversationError(cause));
        }
      } finally {
        if (channelSurfaceIsCurrent(context)) {
          setThreadSubscriptionPending(false);
        }
      }
    },
    [
      captureChannelSurface,
      channelSurfaceIsCurrent,
      organizationId,
      threadSubscriptionPending,
      token,
      updateRootMessages,
      updateThreadMessages,
    ],
  );

  const pendingReplies = useMemo(
    () => replies.filter(
      (reply) =>
        reply.channelId === channelId &&
        (reply.status === "queued" || reply.status === "running"),
    ),
    [channelId, replies],
  );
  const threadMessageIds = useMemo(
    () => threadParentId
      ? new Set([threadParentId, ...threadMessages.map((item) => item.id)])
      : new Set<string>(),
    [threadMessages, threadParentId],
  );
  const threadPendingReplies = useMemo(
    () => pendingReplies.filter((reply) =>
      threadMessageIds.has(reply.parentMessageId)
    ),
    [pendingReplies, threadMessageIds],
  );
  const fallbackAgentName = t("channel.projectAgent");
  const typingAgentNames = useCallback(
    (messageId: string) => typingAgentNamesForReplies(
      pendingReplies,
      agents,
      new Set([messageId]),
      fallbackAgentName,
    ),
    [agents, fallbackAgentName, pendingReplies],
  );
  const typingActivityByAgentName = useCallback(
    (messageId: string) => activityForReplies(
      pendingReplies.filter((reply) => reply.parentMessageId === messageId),
      agents,
      liveActivity,
      fallbackAgentName,
    ),
    [agents, fallbackAgentName, liveActivity, pendingReplies],
  );
  const threadTypingAgentNames = useMemo(
    () => typingAgentNamesForReplies(
      threadPendingReplies,
      agents,
      threadMessageIds,
      fallbackAgentName,
    ),
    [agents, fallbackAgentName, threadMessageIds, threadPendingReplies],
  );
  const threadActivityByAgentName = useMemo(
    () => activityForReplies(
      threadPendingReplies,
      agents,
      liveActivity,
      fallbackAgentName,
    ),
    [agents, fallbackAgentName, liveActivity, threadPendingReplies],
  );

  return {
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
    closeThread,
    declineProposal,
    decliningProposalId,
    error,
    invalidateChannelSurface,
    loadCreateExecutionProposalContext,
    loadChannelConversation,
    loadEarlierChannelMessages,
    loadExecutionProposalContext,
    loadSkillExecutionProposalContext,
    loadingEarlierMessages,
    openIssue,
    openThread,
    proposalProjects,
    recordProposalMessages,
    removeMessage,
    send,
    setBusy,
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
  };
}
