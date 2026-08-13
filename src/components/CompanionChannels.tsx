import {
  Bot,
  ChevronLeft,
  FileText,
  Hash,
  LoaderCircle,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Webhook,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  acceptChannelSkillExecutionProposal,
  acceptChannelExecutionProposal,
  acceptChannelProposal,
  listChannelMessages,
  listChannels,
  loadChannel,
  loadChannelDelta,
  markChannelRead,
  loadDashboard,
  sendChannelMessage,
  toggleChannelMessageReaction,
} from "../lib/api";
import {
  groupChannels,
  type ChannelGroupProject,
} from "../lib/channel-grouping";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelExecutionProposal,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import {
  channelHasUnread,
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
  mergeChannelMessageSnapshot,
} from "../lib/channel-message-merge";
import { maxIssueAttachmentCount } from "../lib/issue-attachments";
import { useI18n } from "../i18n";
import { useChannelComposer } from "../hooks/useChannelComposer";
import { useMobileBackHandler } from "../hooks/useMobileNavigation";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import {
  ChannelDraftImages,
  ChannelMessageImages,
} from "./ChannelImages";
import { ChannelMentionMenu } from "./ChannelMentionMenu";
import { MentionComposerField } from "./MentionComposerField";
import { ChannelMessageText } from "./ChannelMessageText";
import { ChannelMessageReactions } from "./ChannelMessageReactions";
import { Button } from "./ui/button";
import {
  ProfileDialog,
  profileTargetForChannelAgent,
  profileTargetForChannelMember,
  type ProfileTarget,
} from "./ProfileDialog";
import {
  ChannelIssueProposalDetails,
  channelIssueProposalDetails,
  channelIssueProposalRequestsExecution,
} from "./ChannelIssueProposalDetails";
import { IssueExecutionApproval } from "./IssueExecutionApproval";
import { AgentSkillExecutionApproval } from "./AgentSkillExecutionApproval";
import {
  CHANNEL_REALTIME_FALLBACK_MS,
  createChannelRealtimeTransport,
  MAX_CHANNEL_DELTA_PAGES_PER_SYNC,
} from "../lib/channel-realtime";

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

const mergeReplies = (
  current: ChannelAgentReply[],
  incoming: ChannelAgentReply[],
) => {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
};

const typingAgentNamesForMessage = (
  replies: ChannelAgentReply[],
  agents: ChannelAgentSummary[],
  messageId: string,
  fallbackName: string,
) => [
  ...new Set(
    replies
      .filter((reply) => reply.parentMessageId === messageId)
      .map(
        (reply) =>
          agents.find((agent) => agent.agentId === reply.agentId)?.name ??
          fallbackName,
      ),
  ),
];

type CompanionChannelsProps = {
  organizationId: string;
  activeProjectId: string | null;
  currentUserId: string | null;
  projects: readonly ChannelGroupProject[];
  token: string;
  onIssueOpen?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  requestedMessage?: {
    channelId: string;
    messageId: string;
    rootMessageId: string;
  } | null;
  onRequestedMessageOpen?: () => void;
};

type ChannelSurfaceContext = {
  generation: number;
  channelId: string | null;
  threadParentId: string | null;
};

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
  onIssueOpen,
  onSkillSessionAccepted,
  requestedMessage,
  onRequestedMessageOpen,
}: CompanionChannelsProps) {
  const { t } = useI18n();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channel, setChannel] = useState<ChannelSummary | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<ChannelAgentSummary[]>([]);
  const [replies, setReplies] = useState<ChannelAgentReply[]>([]);
  const [thread, setThread] = useState<ChannelMessage[] | null>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [acceptingProposalId, setAcceptingProposalId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [proposalProjects, setProposalProjects] = useState<
    Record<string, string>
  >({});
  const cursor = useRef(0);
  const channelSelectionVersion = useRef(0);
  const channelSurfaceGeneration = useRef(0);
  const channelIdRef = useRef(channel?.id ?? null);
  const threadParentIdRef = useRef(threadParentId);
  const channelMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const threadMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const proposalVersions = useRef(new Map<string, number>());
  const latestProposals = useRef(
    new Map<string, NonNullable<ChannelMessage["proposal"]>>(),
  );
  const executionHistoryDashboards = useRef(
    new Map<string, ReturnType<typeof loadDashboard>>(),
  );
  channelIdRef.current = channel?.id ?? null;
  threadParentIdRef.current = threadParentId;

  useEffect(() => {
    if (!channel || threadParentId) return;
    channelMessagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [channel, messages, replies.length, threadParentId]);

  useEffect(() => {
    if (!threadParentId) return;
    threadMessagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [thread, threadParentId, replies.length]);

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
    (channelId: string | null, parentMessageId: string | null) => {
      channelSurfaceGeneration.current += 1;
      channelIdRef.current = channelId;
      threadParentIdRef.current = parentMessageId;
      setBusy(false);
      setAcceptingProposalId(null);
    },
    [],
  );

  useEffect(
    () => () => {
      channelSurfaceGeneration.current += 1;
      channelIdRef.current = null;
      threadParentIdRef.current = null;
    },
    [],
  );

  useEffect(() => {
    executionHistoryDashboards.current.clear();
  }, [token]);

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

  useEffect(() => {
    let cancelled = false;
    channelSelectionVersion.current += 1;
    invalidateChannelSurface(null, null);
    cursor.current = 0;
    proposalVersions.current.clear();
    latestProposals.current.clear();
    setChannels([]);
    setChannel(null);
    setMessages([]);
    setMembers([]);
    setAgents([]);
    setReplies([]);
    setThread(null);
    setThreadParentId(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await listChannels(token, organizationId);
        if (!cancelled) {
          cursor.current = result.cursor;
          setChannels(result.channels);
        }
      } catch (cause) {
        if (!cancelled) setError(message(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invalidateChannelSurface, organizationId, token]);

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

  const markSelectedChannelRead = useCallback(
    (summary: ChannelSummary) => {
      if (!channelHasUnread(summary)) return summary;
      const lastReadAt = laterTimestamp(
        summary.lastMessageAt,
        new Date().toISOString(),
      );
      const next = markChannelSummaryRead(summary, lastReadAt);
      setChannels((current) =>
        markChannelCatalogRead(current, summary.id, lastReadAt),
      );
      void markChannelRead(token, organizationId, summary.id, { lastReadAt })
        .catch(() => {
          // The next catalog snapshot restores unread if the write failed.
        });
      return next;
    },
    [organizationId, token],
  );

  const openChannel = useCallback(
    async (summary: ChannelSummary) => {
      invalidateChannelSurface(summary.id, null);
      const selectionVersion = ++channelSelectionVersion.current;
      setChannel(markSelectedChannelRead(summary));
      setThread(null);
      setThreadParentId(null);
      setMessages([]);
      setMembers([]);
      setAgents([]);
      setReplies([]);
      setError(null);
      setLoading(true);
      try {
        const result = await loadChannel(token, organizationId, summary.id);
        if (selectionVersion !== channelSelectionVersion.current) return;
        setChannel(markSelectedChannelRead(result.channel));
        recordProposalMessages(result.messages);
        setMessages((current) =>
          mergeChannelMessageSnapshot(current, result.messages));
        setMembers(result.members);
        setAgents(result.agents);
      } catch (cause) {
        if (selectionVersion === channelSelectionVersion.current) {
          setError(message(cause));
        }
      } finally {
        if (selectionVersion === channelSelectionVersion.current) {
          setLoading(false);
        }
      }
    },
    [
      invalidateChannelSurface,
      markSelectedChannelRead,
      organizationId,
      recordProposalMessages,
      token,
    ],
  );

  useEffect(() => {
    const selectedChannelId = channel?.id;
    // Keep the organization cursor behind an authoritative channel/thread
    // load. Otherwise a delta can advance first and then be overwritten by a
    // slower full response, permanently hiding that reply.
    if (!selectedChannelId || loading) return;
    const pollingSelectionVersion = channelSelectionVersion.current;
    let stopped = false;
    let inFlight = false;
    let pending = false;
    const abortController = new AbortController();
    const transport = createChannelRealtimeTransport(token, organizationId);

    const sync = async () => {
      pending = true;
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        while (pending && !stopped) {
          pending = false;
          for (
            let page = 0;
            page < MAX_CHANNEL_DELTA_PAGES_PER_SYNC;
            page += 1
          ) {
            const requestedCursor = cursor.current;
            const delta = await loadChannelDelta(
              token,
              organizationId,
              requestedCursor,
              abortController.signal,
            );
            if (
              stopped ||
              pollingSelectionVersion !== channelSelectionVersion.current
            ) return;
            cursor.current = delta.cursor;

            setChannels((current) =>
              mergeChannels(
                current,
                delta.channels,
                delta.removedChannelIds,
              ),
            );
            if (delta.removedChannelIds.includes(selectedChannelId)) {
              channelSelectionVersion.current += 1;
              invalidateChannelSurface(null, null);
              setChannel(null);
              setMessages([]);
              setMembers([]);
              setAgents([]);
              setReplies([]);
              setThread(null);
              setThreadParentId(null);
              return;
            }

            const selectedSummary = delta.channels.find(
              (item) => item.id === selectedChannelId,
            );
            if (selectedSummary) {
              setChannel(markSelectedChannelRead(selectedSummary));
            }

            const selectedMessages = delta.messages.filter(
              (item) => item.channelId === selectedChannelId,
            );
            recordProposalMessages(selectedMessages);
            setMessages((current) =>
              mergeChannelMessages(
                current,
                selectedMessages.filter(
                  (item) => item.parentMessageId === null,
                ),
                delta.removedMessageIds,
              ),
            );
            if (threadParentId) {
              setThread((current) =>
                current
                  ? mergeChannelMessages(
                      current,
                      selectedMessages.filter(
                        (item) =>
                          item.id === threadParentId ||
                          item.parentMessageId === threadParentId,
                      ),
                      delta.removedMessageIds,
                    )
                  : current,
              );
            }

            const selectedReplies = delta.agentReplies.filter(
              (item) => item.channelId === selectedChannelId,
            );
            if (selectedReplies.length > 0) {
              setReplies((current) => mergeReplies(current, selectedReplies));
              const failed = selectedReplies.find(
                (item) => item.status === "failed",
              );
              if (failed) {
                setError(
                  t("run.briarReplyFailed", {
                    error: failed.error ?? t("run.failed"),
                  }),
                );
              }
            }

            if (!delta.hasMore || delta.cursor <= requestedCursor) break;
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn("Companion channel delta refresh failed", error);
        }
      } finally {
        inFlight = false;
        if (pending && !stopped) window.queueMicrotask(() => void sync());
      }
    };

    const unsubscribe = transport.subscribe((notification) => {
      if (notification.cursor > cursor.current) void sync();
    });
    const updateVisibility = () => {
      if (document.hidden) transport.stop();
      else {
        transport.start();
      }
    };
    document.addEventListener("visibilitychange", updateVisibility);
    const fallback = window.setInterval(
      () => void sync(),
      CHANNEL_REALTIME_FALLBACK_MS,
    );
    updateVisibility();
    return () => {
      stopped = true;
      unsubscribe();
      transport.stop();
      abortController.abort();
      document.removeEventListener("visibilitychange", updateVisibility);
      window.clearInterval(fallback);
    };
  }, [
    channel?.id,
    invalidateChannelSurface,
    loading,
    markSelectedChannelRead,
    organizationId,
    recordProposalMessages,
    t,
    threadParentId,
    token,
  ]);

  const openThread = useCallback(
    async (parent: ChannelMessage) => {
      if (!channel) return;
      invalidateChannelSurface(channel.id, parent.id);
      const selectionVersion = ++channelSelectionVersion.current;
      setThreadParentId(parent.id);
      setThread(null);
      setError(null);
      setLoading(true);
      try {
        const result = await listChannelMessages(
          token,
          organizationId,
          channel.id,
          parent.id,
        );
        if (selectionVersion !== channelSelectionVersion.current) return;
        recordProposalMessages(result.messages);
        setThread((current) =>
          mergeChannelMessageSnapshot(current ?? [], result.messages));
      } catch (cause) {
        if (selectionVersion === channelSelectionVersion.current) {
          setError(message(cause));
        }
      } finally {
        if (selectionVersion === channelSelectionVersion.current) {
          setLoading(false);
        }
      }
    },
    [
      channel,
      invalidateChannelSurface,
      organizationId,
      recordProposalMessages,
      token,
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
    invalidateChannelSurface(
      summary.id,
      requestedMessage.rootMessageId !== requestedMessage.messageId
        ? requestedMessage.rootMessageId
        : null,
    );
    const selectionVersion = ++channelSelectionVersion.current;
    let cancelled = false;
    setReplies([]);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await loadChannel(token, organizationId, summary.id);
        if (
          cancelled ||
          selectionVersion !== channelSelectionVersion.current
        ) return;
        setChannel(result.channel);
        recordProposalMessages(result.messages);
        setMessages((current) =>
          mergeChannelMessageSnapshot(current, result.messages));
        setMembers(result.members);
        setAgents(result.agents);
        if (requestedMessage.rootMessageId !== requestedMessage.messageId) {
          const threadResult = await listChannelMessages(
            token,
            organizationId,
            summary.id,
            requestedMessage.rootMessageId,
          );
          if (
            cancelled ||
            selectionVersion !== channelSelectionVersion.current
          ) return;
          recordProposalMessages(threadResult.messages);
          setThreadParentId(requestedMessage.rootMessageId);
          setThread((current) =>
            mergeChannelMessageSnapshot(current ?? [], threadResult.messages));
        } else {
          setThreadParentId(null);
          setThread(null);
        }
        window.requestAnimationFrame(() => {
          const requestedMessageElement = document.querySelector(
            `[data-companion-channel-message-id="${requestedMessage.messageId}"]`,
          );
          if (requestedMessageElement?.scrollIntoView) {
            requestedMessageElement.scrollIntoView({ block: "center" });
          }
          onRequestedMessageOpen?.();
        });
      } catch (cause) {
        if (
          !cancelled &&
          selectionVersion === channelSelectionVersion.current
        ) {
          setError(message(cause));
        }
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
    onRequestedMessageOpen,
    organizationId,
    recordProposalMessages,
    requestedMessage,
    token,
  ]);

  const send = useCallback(
    async (
      body: string,
      mentions: MentionTarget[],
      attachments: File[],
      attachmentReferences: string[],
    ) => {
      if (!channel || !body.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const result = await sendChannelMessage(token, organizationId, channel.id, {
          body: body.trim(),
          parentMessageId: threadParentId,
          mentionedUserIds: mentions
            .filter((mention) => mention.type === "user")
            .map((mention) => mention.id),
          mentionedAgentIds: mentions
            .filter((mention) => mention.type === "agent")
            .map((mention) => mention.id),
          attachments,
          attachmentReferences,
        });
        setReplies((current) => mergeReplies(current, result.agentReplies));
        if (threadParentId) {
          setThread((current) =>
            mergeChannelMessages(current ?? [], [result.message], []),
          );
        } else {
          setMessages((current) =>
            mergeChannelMessages(current, [result.message], []));
        }
      } catch (cause) {
        setError(message(cause));
      } finally {
        setBusy(false);
      }
    },
    [channel, organizationId, threadParentId, token],
  );

  const pendingReplies = replies.filter(
    (item) =>
      item.channelId === channel?.id &&
      (item.status === "queued" || item.status === "running"),
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
          setError(message(cause));
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
        dashboardRequest = loadDashboard(token, proposal.projectId);
        if (cacheHistory) {
          executionHistoryDashboards.current.set(
            proposal.projectId,
            dashboardRequest,
          );
        }
      }
      let dashboard: Awaited<ReturnType<typeof loadDashboard>>;
      try {
        dashboard = await dashboardRequest;
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
      return {
        run: dashboard.runs.find((run) => run.id === proposal.runId) ?? null,
        workers: dashboard.workers ?? [],
        policy: dashboard.executionPolicy,
      };
    },
    [token],
  );

  const loadSkillExecutionProposalContext = useCallback(
    async (proposal: AgentSkillExecutionProposal) => {
      const dashboard = await loadDashboard(token, proposal.projectId);
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
        !channel ||
        channel.id !== item.channelId
      ) {
        throw new Error(t("executionApproval.targetUnavailable"));
      }
      const result = await acceptChannelExecutionProposal(
        token,
        organizationId,
        item.channelId,
        proposal.id,
        input,
      );
      return result.proposal;
    },
    [channel, organizationId, t, token],
  );

  const applyAcceptedExecutionProposal = useCallback(
    (messageId: string, proposal: ChannelExecutionProposal) => {
      const apply = (item: ChannelMessage): ChannelMessage =>
        item.id === messageId && item.executionProposal?.id === proposal.id
          ? { ...item, executionProposal: proposal }
          : item;
      setMessages((current) => current.map(apply));
      setThread((current) => current?.map(apply) ?? null);
    },
    [],
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
        !channel ||
        channel.id !== item.channelId
      ) {
        throw new Error(t("skillExecution.approvalUnavailable"));
      }
      const result = await acceptChannelSkillExecutionProposal(
        token,
        organizationId,
        item.channelId,
        proposal,
        input,
      );
      onSkillSessionAccepted?.(result.session);
      return result.proposal;
    },
    [channel, onSkillSessionAccepted, organizationId, t, token],
  );

  const applyAcceptedSkillExecutionProposal = useCallback(
    (messageId: string, proposal: AgentSkillExecutionProposal) => {
      const apply = (item: ChannelMessage): ChannelMessage =>
        item.id === messageId &&
        item.skillExecutionProposal?.id === proposal.id
          ? { ...item, skillExecutionProposal: proposal }
          : item;
      setMessages((current) => current.map(apply));
      setThread((current) => current?.map(apply) ?? null);
    },
    [],
  );

  const refreshProposalState = useCallback(
    async (item: ChannelMessage, proposalId: string) => {
      if (!channel) return null;
      const selectionVersion = ++channelSelectionVersion.current;
      setLoading(true);
      try {
        if (item.parentMessageId) {
          const result = await listChannelMessages(
            token,
            organizationId,
            channel.id,
            item.parentMessageId,
          );
          if (selectionVersion !== channelSelectionVersion.current) {
            return latestProposals.current.get(proposalId) ?? null;
          }
          recordProposalMessages(result.messages);
          setThread((current) =>
            mergeChannelMessageSnapshot(current ?? [], result.messages));
        } else {
          const result = await loadChannel(token, organizationId, channel.id);
          if (selectionVersion !== channelSelectionVersion.current) {
            return latestProposals.current.get(proposalId) ?? null;
          }
          recordProposalMessages(result.messages);
          setChannel(result.channel);
          setMessages((current) =>
            mergeChannelMessageSnapshot(current, result.messages));
          setMembers(result.members);
          setAgents(result.agents);
        }
        return latestProposals.current.get(proposalId) ?? null;
      } finally {
        if (selectionVersion === channelSelectionVersion.current) {
          setLoading(false);
        }
      }
    },
    [channel, organizationId, recordProposalMessages, token],
  );

  const acceptProposal = useCallback(
    async (item: ChannelMessage) => {
      if (
        !channel ||
        item.proposal?.actionType !== "request_issue_create" ||
        !channelIssueProposalDetails(item.proposal)
      ) return;
      const proposalId = item.proposal.id;
      const requestsExecution = channelIssueProposalRequestsExecution(
        item.proposal,
      );
      const projectId =
        item.proposal.projectId ??
        channel.defaultProjectId ??
        proposalProjects[item.proposal.id];
      if (!projectId) return;
      const approvalChannelId = channel.id;
      const approvalThreadParentId = threadParentIdRef.current;
      const approvalContext = captureChannelSurface();
      const approvalContextIsCurrent = () =>
        approvalContext.channelId === approvalChannelId &&
        approvalContext.threadParentId === approvalThreadParentId &&
        channelSurfaceIsCurrent(approvalContext);
      const approvalProposalVersion = proposalVersions.current.get(proposalId) ?? 0;
      setBusy(true);
      setAcceptingProposalId(proposalId);
      setError(null);
      try {
        const result = await acceptChannelProposal(
          token,
          organizationId,
          channel.id,
          proposalId,
          projectId,
        );
        const hasExecutionFollowUp =
          requestsExecution || result.executionProposal != null;
        if (!approvalContextIsCurrent()) return;
        const applyResult = (candidate: ChannelMessage): ChannelMessage => {
          if (candidate.proposal?.id !== proposalId) return candidate;
          return {
            ...candidate,
            proposal: {
              ...candidate.proposal,
              status: "accepted",
              projectId: result.projectId,
              resultRunId: result.resultRunId,
            },
            executionProposal:
              result.executionProposal ?? candidate.executionProposal,
          };
        };
        if (
          (proposalVersions.current.get(proposalId) ?? 0) ===
            approvalProposalVersion
        ) {
          setMessages((current) => current.map(applyResult));
          setThread((current) => current?.map(applyResult) ?? null);
          recordProposalMessages([applyResult(item)]);
          if (hasExecutionFollowUp) {
            if (!result.executionProposal) {
              await refreshProposalState(applyResult(item), proposalId);
            }
          }
        } else {
          let latest = latestProposals.current.get(proposalId);
          if (latest?.status !== "accepted") {
            latest =
              (await refreshProposalState(item, proposalId)) ?? undefined;
          }
          if (!approvalContextIsCurrent()) return;
          if (latest?.status === "accepted" && latest.projectId && latest.resultRunId) {
            if (hasExecutionFollowUp) {
              if (result.executionProposal) {
                setMessages((current) => current.map(applyResult));
                setThread((current) => current?.map(applyResult) ?? null);
                recordProposalMessages([applyResult(item)]);
              } else {
                await refreshProposalState(item, proposalId);
              }
            }
          } else if (
            latest?.status === "pending" &&
            latest.projectId === result.projectId
          ) {
            setMessages((current) => current.map(applyResult));
            setThread((current) => current?.map(applyResult) ?? null);
            recordProposalMessages([applyResult(item)]);
            if (hasExecutionFollowUp) {
              if (!result.executionProposal) {
                await refreshProposalState(applyResult(item), proposalId);
              }
            }
          }
        }
      } catch (cause) {
        if (approvalContextIsCurrent()) {
          setError(message(cause));
        }
      } finally {
        if (approvalContextIsCurrent()) {
          setBusy(false);
          setAcceptingProposalId(null);
        }
      }
    },
    [
      channel,
      captureChannelSurface,
      channelSurfaceIsCurrent,
      organizationId,
      proposalProjects,
      recordProposalMessages,
      refreshProposalState,
      token,
    ],
  );

  const toggleReaction = useCallback(
    async (item: ChannelMessage, emoji: string) => {
      if (!channel) return;
      setBusy(true);
      setError(null);
      try {
        const result = await toggleChannelMessageReaction(
          token,
          organizationId,
          channel.id,
          item.id,
          emoji,
        );
        const applyReactions = (candidate: ChannelMessage) =>
          candidate.id === result.message.id
            ? { ...candidate, reactions: result.message.reactions }
            : candidate;
        setMessages((current) => current.map(applyReactions));
        setThread((current) => current?.map(applyReactions) ?? null);
      } catch (cause) {
        setError(message(cause));
      } finally {
        setBusy(false);
      }
    },
    [channel, organizationId, token],
  );

  const closeThread = useCallback(() => {
    if (!channel || !threadParentId) return false;
    channelSelectionVersion.current += 1;
    invalidateChannelSurface(channel.id, null);
    setThreadParentId(null);
    setThread(null);
    setLoading(false);
    setError(null);
    return true;
  }, [channel, invalidateChannelSurface, threadParentId]);

  const closeChannel = useCallback(() => {
    if (!channel) return false;
    channelSelectionVersion.current += 1;
    invalidateChannelSurface(null, null);
    setChannel(null);
    setMessages([]);
    setReplies([]);
    setLoading(false);
    setError(null);
    return true;
  }, [channel, invalidateChannelSurface]);

  useMobileBackHandler(
    () => closeThread() || closeChannel(),
    { enabled: Boolean(channel), priority: 100 },
  );

  if (channel && threadParentId) {
    return (
      <section className="companion-channels companion-channel-detail">
        <ChannelBar
          onBack={closeThread}
          title={t("companion.channelThread")}
        />
        {error ? <p className="companion-channel-error">{error}</p> : null}
        <div className="companion-channel-messages">
          {loading && !thread ? <Spinner /> : null}
          {(thread ?? []).map((item) => (
            <MessageRow
              acceptingProposal={acceptingProposalId === item.proposal?.id}
              agents={agents}
              busy={busy}
              channel={channel}
              currentUserId={currentUserId}
              key={item.id}
              members={members}
              message={item}
              onAcceptProposal={() => void acceptProposal(item)}
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
              projects={projects}
              selectedProjectId={
                item.proposal ? proposalProjects[item.proposal.id] ?? null : null
              }
              token={token}
              typingAgentNames={typingAgentNamesForMessage(
                pendingReplies,
                agents,
                item.id,
                t("channel.projectAgent"),
              )}
            />
          ))}
          <div ref={threadMessagesEndRef} />
        </div>
        <CompanionChannelComposer
          agents={agents}
          busy={busy}
          currentUserId={currentUserId}
          members={members}
          onSend={send}
        />
      </section>
    );
  }

  if (channel) {
    return (
      <section className="companion-channels companion-channel-detail">
        <ChannelBar
          onBack={closeChannel}
          channel={channel}
        />
        {error ? <p className="companion-channel-error">{error}</p> : null}
        <div className="companion-channel-messages">
          {loading && messages.length === 0 ? <Spinner /> : null}
          {messages.map((item) => (
            <MessageRow
              acceptingProposal={acceptingProposalId === item.proposal?.id}
              agents={agents}
              busy={busy}
              channel={channel}
              currentUserId={currentUserId}
              key={item.id}
              members={members}
              message={item}
              onAcceptProposal={() => void acceptProposal(item)}
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
              projects={projects}
              selectedProjectId={
                item.proposal ? proposalProjects[item.proposal.id] ?? null : null
              }
              showThreadSummary
              token={token}
              typingAgentNames={typingAgentNamesForMessage(
                pendingReplies,
                agents,
                item.id,
                t("channel.projectAgent"),
              )}
            />
          ))}
          {!loading && messages.length === 0 ? (
            <p className="companion-channel-empty">
              {t("companion.channelsEmpty")}
            </p>
          ) : null}
          <div ref={channelMessagesEndRef} />
        </div>
        <CompanionChannelComposer
          agents={agents}
          busy={busy}
          currentUserId={currentUserId}
          members={members}
          onSend={send}
        />
      </section>
    );
  }

  return (
    <section className="companion-channels">
      {error ? <p className="companion-channel-error">{error}</p> : null}
      {loading && channels.length === 0 ? <Spinner /> : null}
      {groups.map((group) => (
        <div className="companion-channel-group" key={group.key}>
          <h2 className="companion-channel-divider">{group.label}</h2>
          <ul>
            {group.channels.map((item) => (
              <li key={item.id}>
                <button
                  className={channelHasUnread(item) ? "unread" : undefined}
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
  );
}

function ChannelBar({
  channel,
  onBack,
  title,
}: {
  channel?: ChannelSummary;
  onBack: () => void;
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
    </header>
  );
}

function MessageRow({
  acceptingProposal,
  agents,
  busy,
  channel,
  currentUserId,
  loadExecutionProposalContext,
  loadSkillExecutionProposalContext,
  members,
  message,
  onAcceptProposal,
  onAcceptExecutionProposal,
  onAcceptSkillExecutionProposal,
  onExecutionProposalAccepted,
  onSkillExecutionProposalAccepted,
  onIssueOpen,
  onOpenThread,
  onProjectChange,
  onToggleReaction,
  projects,
  selectedProjectId,
  showThreadSummary = false,
  token,
  typingAgentNames,
}: {
  acceptingProposal: boolean;
  agents: ChannelAgentSummary[];
  busy: boolean;
  channel: ChannelSummary;
  currentUserId: string | null;
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
  onAcceptProposal: () => void;
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
  onToggleReaction: (emoji: string) => void;
  projects: readonly ChannelGroupProject[];
  selectedProjectId: string | null;
  showThreadSummary?: boolean;
  token: string;
  typingAgentNames: string[];
}) {
  const { localeTag, t } = useI18n();
  const issueProposal = message.proposal?.actionType === "request_issue_create"
    ? message.proposal
    : null;
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
  const executionProjectName = message.executionProposal
    ? projects.find(
        (project) => project.id === message.executionProposal?.projectId,
      )?.name ?? message.executionProposal.projectId
    : null;
  return (
    <article
      className="companion-channel-message"
      data-companion-channel-message-id={message.id}
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
        {typingAgentNames.map((name) => (
          <div className="channel-typing companion-channel-typing" key={name}>
            <LoaderCircle className="spin" size={15} />
            {t("channel.namedAgentTyping", { name })}
          </div>
        ))}
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
            {issueProposal.status === "pending" ? (
              <button
                aria-busy={acceptingProposal}
                className="channel-proposal-approve-button"
                disabled={
                  busy || Boolean(channel.archivedAt) ||
                  !proposalProjectId || !proposalIssue
                }
                onClick={onAcceptProposal}
                type="button"
              >
                {acceptingProposal ? (
                  <>
                    <LoaderCircle aria-hidden="true" className="spin" size={15} />
                    {t("channel.creatingIssue")}
                  </>
                ) : (
                  t("channel.approveCreateIssue")
                )}
              </button>
            ) : acceptedProjectId && acceptedRunId && onIssueOpen ? (
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
        {message.executionProposal ? (
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
          alwaysShowAdd
          busy={busy}
          currentUserId={currentUserId}
          message={message}
          onToggle={onToggleReaction}
        />
        {showThreadSummary && onOpenThread ? (
          <button
            aria-label={`${t("run.viewThread")}: ${message.author.name} — ${message.body}`}
            className="companion-channel-message-button companion-channel-thread-summary"
            onClick={onOpenThread}
            type="button"
          >
            <MessageSquare size={14} />
            <strong>
              {message.replyCount > 0
                ? t("run.replies", { count: message.replyCount })
                : t("channel.replyInThread")}
            </strong>
            {message.lastReplyAt ? (
              <small>
                · {t("companion.channelLastReply", {
                  time: relativeTime(message.lastReplyAt, localeTag),
                })}
              </small>
            ) : null}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MessageAvatar({ message }: { message: ChannelMessage }) {
  if (message.author.type === "user" && message.author.image) {
    return (
      <img
        alt=""
        className="companion-channel-avatar"
        src={message.author.image}
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
  } = useChannelComposer<HTMLInputElement>({
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
        <input
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

function Spinner() {
  return (
    <p className="companion-channel-loading">
      <LoaderCircle className="spin" size={16} />
    </p>
  );
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
