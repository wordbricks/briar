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
  channelIssueProposalRequestsExecution,
} from "../components/ChannelIssueProposalDetails";
import {
  type ChannelMessageImageCache,
  registerChannelMessageImageSource,
} from "../components/ChannelImages";
import type { ChannelSkillCommandTarget } from "./useChannelComposer";
import { currentExecutionWorkerDeviceId } from "../lib/execution-worker-device";
import { useChannelAgentActivity } from "./use-channel-agent-activity";
import type {
  ChannelAgentActivityDescriptor,
  ChannelAgentActivityFrame,
} from "../lib/channel-agent-activity";
import { useI18n } from "../i18n";
import { useToast } from "../components/ui/toast";
import type { AutoHuntSession } from "../types";
import {
  CHANNEL_REALTIME_FALLBACK_MS,
  createChannelRealtimeTransport,
  MAX_CHANNEL_DELTA_PAGES_PER_SYNC,
} from "../lib/channel-realtime";
import { useRegistry } from "../state/registry";
import {
  channelAgentRepliesAtom,
  channelEarlierMessagesLoadingAtom,
  channelMessageCursorAtom,
  channelRootMessagesAtom,
  channelThreadLoadingAtom,
} from "../state/channel-conversation/atoms";
import {
  createChannelConversationLoader,
  getChannelConversationLoader,
  type ChannelSurfaceContext,
  type LoadChannelConversationOptions,
  type LoadEarlierMessagesResult,
} from "../state/channel-conversation/loader";
import { channelConversationFailureAtom } from "../state/channel-conversation/errors";
import { getChannelReplyLedger } from "../state/channel-conversation/reply-ledger";
import { applySyncEvent } from "../state/sync/apply";
import { writeChannelAgentReplies } from "../state/channel-conversation/write";
import { useAtomValue } from "@effect/atom-react";
import {
  activityForReplies,
  appendReplySummary,
  channelConversationError,
  channelReplyIsTerminal,
  typingAgentNamesForReplies,
} from "../state/channel-conversation/model";

export type {
  ChannelConversationSnapshot,
  ChannelSurfaceContext,
  LoadChannelConversationOptions,
  LoadEarlierMessagesResult,
  RequestedChannelMessage,
} from "../state/channel-conversation/loader";


type MessageUpdater = (update: (current: ChannelMessage[]) => ChannelMessage[]) => void;

type UseChannelConversationOptions = {
  token: string;
  organizationId: string;
  currentUserId: string | null;
  channel: ChannelSummary | null;
  members: ChannelMember[];
  agents: ChannelAgentSummary[];
  replies: ChannelAgentReply[];
  threadParentId: string | null;
  threadMessages: ChannelMessage[];
  pageSize: number;
  updateRootMessages: MessageUpdater;
  updateThreadMessages: MessageUpdater;
  setThreadParentId: Dispatch<SetStateAction<string | null>>;
  onChannelLoaded?: (channel: ChannelSummary) => void;
  onIssueOpen?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  onRootMessagePending?: () => void;
  onThreadClosed?: () => void;
  realtime?: ChannelConversationRealtimeOptions;
  dependencies?: ChannelConversationDependencies;
  activityEnabled?: boolean;
  imageCache?: ChannelMessageImageCache | null;
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

export {
  channelConversationError,
  mergeChannelReplies,
} from "../state/channel-conversation/model";

export function useChannelConversation({
  token,
  organizationId,
  currentUserId,
  channel,
  members,
  agents,
  replies,
  threadParentId,
  threadMessages,
  pageSize,
  updateRootMessages,
  updateThreadMessages,
  setThreadParentId,
  onChannelLoaded,
  onIssueOpen,
  onSkillSessionAccepted,
  onRootMessagePending,
  onThreadClosed,
  realtime,
  dependencies = defaultChannelConversationDependencies,
  activityEnabled = true,
  imageCache,
}: UseChannelConversationOptions) {
  const { t } = useI18n();
  const { toast } = useToast();
  const registry = useRegistry();
  /*
    The timeline and its cursor live in `state/channel-conversation`, so they
    are read at call time rather than mirrored into a ref every render. What is
    left as props is what the hook needs *during* a render — the replies the
    typing strips derive from, and the thread on screen.
  */
  /*
    The request ordering, the reads and the proposal history are
    `state/channel-conversation/loader.ts`'s now, so what is left here is the
    writes and the render-time derivations. The loader is the registry's own
    unless a test injected reads, which is the one case that needs an instance
    of its own.
  */
  const loader = useMemo(
    () =>
      dependencies === defaultChannelConversationDependencies
        ? getChannelConversationLoader(registry)
        : createChannelConversationLoader(registry, dependencies),
    [dependencies, registry],
  );
  const replyLedger = useMemo(() => getChannelReplyLedger(registry), [registry]);
  const storedMessages = useCallback(
    () => registry.get(channelRootMessagesAtom(channelIdRef.current ?? "")),
    [registry],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportConversationError = useCallback((cause: unknown) => {
    toast(channelConversationError(cause), { tone: "error" });
  }, [toast]);
  const [acceptingProposalId, setAcceptingProposalId] = useState<string | null>(
    null,
  );
  const [decliningProposalId, setDecliningProposalId] = useState<string | null>(
    null,
  );
  const [threadSubscriptionPending, setThreadSubscriptionPending] = useState(false);
  const [proposalProjects, setProposalProjects] = useState<Record<string, string>>(
    {},
  );

  const channelId = channel?.id ?? null;
  const loadingEarlierMessages = useAtomValue(
    channelEarlierMessagesLoadingAtom(channelId ?? ""),
  );
  const threadLoading = useAtomValue(channelThreadLoadingAtom(channelId ?? ""));
  const channelIdRef = useRef(channelId);
  const threadParentIdRef = useRef(threadParentId);
  const optimisticThreadMessageIds = useRef(new Set<string>());
  const repliesRef = useRef(replies);
  const realtimeRef = useRef(realtime);
  const dependenciesRef = useRef(dependencies);

  /*
    The surface the loader compares a response against is what this render is
    showing, so it is published during the render rather than from an effect: a
    request started in a layout effect below has to already see the channel the
    view is drawing.
  */
  loader.syncSurface(channelId, threadParentId);
  channelIdRef.current = channelId;
  threadParentIdRef.current = threadParentId;
  repliesRef.current = replies;
  realtimeRef.current = realtime;
  dependenciesRef.current = dependencies;

  const liveActivity = useChannelAgentActivity(
    token,
    organizationId,
    activityEnabled ? channelId : null,
  );

  const captureChannelSurface = loader.captureSurface;
  const channelSurfaceIsCurrent = loader.surfaceIsCurrent;

  const invalidateChannelSurface = useCallback(
    (nextChannelId: string | null, nextThreadParentId: string | null) => {
      loader.invalidateSurface(nextChannelId, nextThreadParentId);
      channelIdRef.current = nextChannelId;
      threadParentIdRef.current = nextThreadParentId;
      setBusy(false);
      setAcceptingProposalId(null);
      setDecliningProposalId(null);
    },
    [loader],
  );

  useEffect(() => {
    setBusy(false);
    setAcceptingProposalId(null);
    setDecliningProposalId(null);
  }, [channelId, threadParentId]);

  useEffect(() => {
    loader.clearExecutionHistory();
  }, [loader, token]);

  useEffect(
    () => () => {
      loader.invalidateSurface(null, null);
      channelIdRef.current = null;
      threadParentIdRef.current = null;
    },
    [loader],
  );

  /*
    A failed read publishes its message rather than raising a toast, because the
    loader has no provider context to raise one from. Subscribing rather than
    reading keeps a failure from re-rendering the conversation: nothing here
    draws it.
  */
  useEffect(() => {
    let seen = registry.get(channelConversationFailureAtom)?.id ?? 0;
    return registry.subscribe(channelConversationFailureAtom, (failure) => {
      if (!failure || failure.id <= seen) return;
      seen = failure.id;
      toast(failure.message, { tone: "error" });
    });
  }, [registry, toast]);

  const recordProposalMessages = loader.recordProposalMessages;

  const clearProposalHistory = useCallback(() => {
    loader.clearProposalHistory(null);
    setProposalProjects({});
  }, [loader]);

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

  /*
    The tombstones and the observation versions moved to the store and to
    `reply-ledger.ts`, so this is the entry point plus the one thing the store
    cannot decide: whether a failure is *new*, which is what earns a toast.
  */
  const applyAgentReplies = useCallback(
    (incoming: ChannelAgentReply[], reset = false) => {
      const activeId = channelIdRef.current;
      if (!activeId) return;
      if (incoming.length === 0 && !reset) return;
      const previousById = new Map(
        registry
          .get(channelAgentRepliesAtom(activeId))
          .map((item) => [item.id, item]),
      );
      replyLedger.note(activeId, incoming);
      applySyncEvent(registry, {
        kind: "channel-agent-replies-changed",
        channelId: activeId,
        replies: incoming,
        reset,
      });
      const failed = incoming.find(
        (reply) => reply.channelId === activeId && reply.status === "failed",
      );
      if (!failed) return;
      const previous = previousById.get(failed.id);
      if (previous?.status === "failed") return;
      toast(replyFailureMessage(failed), { tone: "error" });
    },
    [registry, replyFailureMessage, replyLedger, toast],
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
            const requestedVersion = loader.readRequestVersion();
            const delta = await dependenciesRef.current.loadChannelDelta(
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
    loader,
    organizationId,
    realtime?.catalogReady,
    realtime?.enabled,
    realtime?.syncSignal,
    threadParentId,
    token,
  ]);

  const loadChannelConversation = useCallback(
    ({
      channelId: requestedChannelId,
      messageLimit,
      mergeWithCurrentMessages,
      requestedMessage,
    }: LoadChannelConversationOptions & { channelId: string }) =>
      loader.loadConversation(requestedChannelId, {
        messageLimit,
        mergeWithCurrentMessages,
        requestedMessage,
        onChannelLoaded,
      }),
    [loader, onChannelLoaded],
  );

  const loadEarlierChannelMessages = useCallback(
    (): Promise<LoadEarlierMessagesResult> => {
      const activeId = channelIdRef.current;
      if (!activeId) {
        return Promise.resolve({ applied: false, nextCursor: null });
      }
      return loader.loadEarlier(activeId, pageSize);
    },
    [loader, pageSize],
  );

  const openThread = useCallback(
    async (parentMessageId: string, cachedMessages: ChannelMessage[] = []) => {
      const activeId = channelIdRef.current;
      if (!activeId) return false;
      setError(null);
      return loader.loadThread(activeId, parentMessageId, cachedMessages);
    },
    [loader],
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
      if (imageCache) {
        for (let i = 0; i < attachmentUrls.length; i++) {
          const url = attachmentUrls[i]!;
          const ref = attachmentReferences[i];
          registerChannelMessageImageSource(imageCache, url, url);
          if (ref) {
            registerChannelMessageImageSource(imageCache, ref, url);
            registerChannelMessageImageSource(imageCache, `${ref}:${url}`, url);
          }
        }
      }
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
        ? storedMessages().find((item) => item.id === parentMessageId) ?? null
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
        if (imageCache && result?.message?.attachments) {
          result.message.attachments.forEach((attachment, index) => {
            const url = attachmentUrls[index];
            if (url) {
              registerChannelMessageImageSource(imageCache, attachment.id, url);
              registerChannelMessageImageSource(imageCache, attachment.url, url);
              registerChannelMessageImageSource(
                imageCache,
                `${attachment.id}:${attachment.url}`,
                url,
              );
            }
          });
        }
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
          reportConversationError(cause);
        }
        for (const url of attachmentUrls) {
          URL.revokeObjectURL(url);
          imageCache?.entries.delete(url);
        }
      } finally {
        optimisticThreadMessageIds.current.delete(clientMessageId);
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
      imageCache,
      members,
      onRootMessagePending,
      storedMessages,
      organizationId,
      reportConversationError,
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
          reportConversationError(cause);
        }
      }
    },
    [captureChannelSurface, channelSurfaceIsCurrent, onIssueOpen, reportConversationError],
  );

  const loadExecutionProposalContext = loader.loadExecutionProposalContext;
  const loadCreateExecutionProposalContext =
    loader.loadCreateExecutionProposalContext;
  const loadSkillExecutionProposalContext =
    loader.loadSkillExecutionProposalContext;

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
      return loader.refresh(activeId, {
        item,
        proposalId,
        pageSize,
        onChannelLoaded,
      });
    },
    [loader, onChannelLoaded, pageSize],
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
        !item.proposal
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
      const approvalProposalVersion = loader.proposalVersion(proposalId);
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
        if (loader.proposalVersion(proposalId) === approvalProposalVersion) {
          applySuccessfulResponse();
          if (hasExecutionFollowUp && !result.executionProposal) {
            await refreshProposalState(applyResult(item), proposalId);
          }
        } else {
          let latest = loader.latestProposal(proposalId) ?? undefined;
          if (latest?.status !== "accepted") {
            latest = (await refreshProposalState(item, proposalId)) ?? undefined;
          }
          if (!approvalContextIsCurrent()) return;
          if (
            latest?.status === "accepted" &&
            latest.projectId &&
            latest.resultRunId
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
        if (approvalContextIsCurrent()) reportConversationError(cause);
        return channelConversationError(cause);
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
      loader,
      organizationId,
      proposalProjects,
      recordProposalMessages,
      refreshProposalState,
      reportConversationError,
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
        !proposal ||
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
          reportConversationError(cause);
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
      reportConversationError,
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
          writeChannelAgentReplies(
            registry,
            activeId,
            registry
              .get(channelAgentRepliesAtom(activeId))
              .filter((reply) =>
                reply.triggerMessageId !== item.id &&
                reply.replyMessageId !== item.id
              ),
          );
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
      registry,
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
          reportConversationError(cause);
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
      reportConversationError,
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
