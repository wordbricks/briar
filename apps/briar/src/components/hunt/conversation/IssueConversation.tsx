import { Bell, CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConversationScrollToBottomButton } from "@/components/ConversationScrollToBottomButton";
import { conversationIsAwayFromBottom, scrollConversationToBottom } from "@/lib/conversation-scroll";
import { agentReplyParentMessageId, issueMentionHandle } from "@/lib/issue-agent-reply";
import { mentionHandle } from "@/lib/channel-mentions";
import { ProfileDialog, type ProfileTarget } from "@/components/ProfileDialog";
import { type ConversationReplyParticipant } from "@/components/ConversationReplySummary";
import { isApiErrorStatus, loadDashboard, loadIssueConversationDelta, loadIssueConversationSnapshot } from "@/lib/api";
import { CHANNEL_REALTIME_FALLBACK_MS, MAX_PROJECT_DELTA_PAGES_PER_SYNC, createProjectRealtimeTransport } from "@/lib/channel-realtime";
import { issueExecutionApprovalUnavailable } from "@/lib/issue-execution-approval";
import type { ChannelAgentActivityDescriptor } from "@/lib/channel-agent-activity";
import { useIssueAgentActivity } from "@/hooks/use-issue-agent-activity";
import { mergeIssueMessages } from "@/lib/issue-message-merge";
import type { AgentSkillExecutionApprovalInput, AgentSkillExecutionProposal, ExecutionWorker, HuntRun, IssueAttachment, IssueAgentReplyState, IssueMessage, IssueMessageSendResult, IssueProposedAction, IssueExecutionApprovalInput, IssueExecutionProposal, OrganizationMember, ProjectAgent, ProjectExecutionWorkerPolicy } from "@/types";
import { useI18n } from "@/i18n";
import { AgentReplyState } from "./AgentReplyState";
import { IssueMessageItem } from "./IssueMessageItem";
import { MessageComposer } from "./MessageComposer";
import { issueReplyParticipant } from "./model";
import { localizeWorkflowStage } from "../model/formatters";
import { scrollElementToCenter } from "@/lib/scroll-container";
export function IssueConversation({
  currentUserId = null,
  executionPolicy,
  executionRuns,
  executionWorkers,
  inboxSyncSignal,
  mentionMembers,
  mentionAgents,
  onAcceptIssueAction,
  onAcceptIssueExecution,
  onAcceptSkillExecution,
  onDelete,
  onEdit,
  onIssueOpen,
  onLoadAttachment,
  onLoad,
  onSend,
  onUpdateSubscription,
  organizationId,
  projectId,
  run,
  highlightedMessageId = null,
  showsScrollToLatest = false,
  token
}: {
  currentUserId?: string | null;
  executionPolicy?: ProjectExecutionWorkerPolicy;
  executionRuns: HuntRun[];
  executionWorkers: ExecutionWorker[];
  inboxSyncSignal?: string;
  mentionMembers: OrganizationMember[];
  mentionAgents: ProjectAgent[];
  onAcceptIssueAction?: (proposal: IssueProposedAction) => Promise<IssueProposedAction>;
  onAcceptIssueExecution?: (proposal: IssueExecutionProposal, input: IssueExecutionApprovalInput) => Promise<IssueExecutionProposal>;
  onAcceptSkillExecution?: (proposal: AgentSkillExecutionProposal, input: AgentSkillExecutionApprovalInput) => Promise<AgentSkillExecutionProposal>;
  onDelete: (messageId: string) => Promise<unknown>;
  onEdit: (messageId: string, input: {
    body: string;
    mentionedUserIds?: string[];
  }) => Promise<IssueMessage>;
  onIssueOpen?: (runId: string) => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoad: () => Promise<IssueMessage[]>;
  onSend: (input: {
    body: string;
    clientMessageId?: string;
    parentMessageId: string | null;
    mentionedUserIds?: string[];
    mentionedAgentIds?: string[];
    attachments?: File[];
    attachmentReferences?: string[];
  }) => Promise<IssueMessageSendResult>;
  onUpdateSubscription?: (subscribed: boolean) => Promise<unknown>;
  organizationId: string | null;
  projectId: string;
  run: HuntRun;
  highlightedMessageId?: string | null;
  showsScrollToLatest?: boolean;
  token: string | null;
}) {
  const {
    localeTag,
    t
  } = useI18n();
  const {
    toast
  } = useToast();
  const [messages, setMessages] = useState<IssueMessage[]>([]);
  const [activeReplyMessageId, setActiveReplyMessageId] = useState<string | null>(null);
  const [activeEditMessageId, setActiveEditMessageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const [messageErrors, setMessageErrors] = useState<Record<string, string | null>>({});
  const [agentReplyStates, setAgentReplyStates] = useState<Record<string, {
    pending: number;
    error: string | null;
  }>>({});
  const issueActivity = useIssueAgentActivity(token, projectId, run.id);
  const [actionProposalStates, setActionProposalStates] = useState<Record<string, {
    accepting: boolean;
    error: string | null;
  }>>({});
  const [activeProfile, setActiveProfile] = useState<ProfileTarget | null>(null);
  const subscriberMembers = useMemo(() => (run.subscribers ?? []).flatMap(subscriber => {
    const member = mentionMembers.find(candidate => candidate.userId === subscriber.userId);
    return member ? [member] : [];
  }), [mentionMembers, run.subscribers]);
  const backendSubscribed = Boolean(currentUserId && (run.assigneeUserId === currentUserId || (run.subscribers ?? []).some(subscriber => subscriber.userId === currentUserId)));
  const assigneeSubscriptionRequired = Boolean(currentUserId && run.assigneeUserId === currentUserId);
  const [subscriptionOverride, setSubscriptionOverride] = useState<boolean | null>(null);
  const [subscriptionPending, setSubscriptionPending] = useState(false);
  const [conversationCursor, setConversationCursor] = useState<number | null>(null);
  const isSubscribed = subscriptionOverride ?? backendSubscribed;
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const focusedHighlightedMessageKeyRef = useRef<string | null>(null);
  const pendingSentMessageIdRef = useRef<string | null>(null);
  const userHasSentMessageRef = useRef(false);
  const onLoadRef = useRef(onLoad);
  const mountedRef = useRef(true);
  const activeRunIdRef = useRef(run.id);
  const messageLoadVersion = useRef(0);
  const conversationCursorRef = useRef<number | null>(null);
  const trackedAgentRepliesRef = useRef(new Map<string, {
    replyThreadId: string;
  }>());
  const agentRepliesByIdRef = useRef(new Map<string, IssueAgentReplyState>());
  const executionProposalStateByIdRef = useRef(new Map<string, string>());
  if (activeRunIdRef.current !== run.id) {
    activeRunIdRef.current = run.id;
    messageLoadVersion.current += 1;
    executionProposalStateByIdRef.current.clear();
  }
  onLoadRef.current = onLoad;
  const trackAgentReply = useCallback((job: IssueAgentReplyState, trigger: IssueMessage) => {
    const observed = agentRepliesByIdRef.current.get(job.id);
    if (observed?.status === "completed" || observed?.status === "failed") {
      return;
    }
    agentRepliesByIdRef.current.set(job.id, job);
    if (trackedAgentRepliesRef.current.has(job.id)) return;
    const replyThreadId = job.parentMessageId ?? agentReplyParentMessageId(trigger);
    trackedAgentRepliesRef.current.set(job.id, {
      replyThreadId
    });
    setAgentReplyStates(current => ({
      ...current,
      [replyThreadId]: {
        pending: (current[replyThreadId]?.pending ?? 0) + 1,
        error: null
      }
    }));
  }, []);
  const finishTrackedAgentReply = useCallback((job: IssueAgentReplyState) => {
    const tracked = trackedAgentRepliesRef.current.get(job.id);
    if (!tracked) return;
    trackedAgentRepliesRef.current.delete(job.id);
    setAgentReplyStates(current => {
      const state = current[tracked.replyThreadId];
      if (!state) return current;
      const pending = Math.max(state.pending - 1, 0);
      if (pending === 0 && !job.error) {
        const next = {
          ...current
        };
        delete next[tracked.replyThreadId];
        return next;
      }
      return {
        ...current,
        [tracked.replyThreadId]: {
          pending,
          error: job.status === "failed" ? job.error ?? "워커가 Agent 답변을 만들지 못했습니다." : null
        }
      };
    });
  }, []);
  const reconcileAgentReplies = useCallback((jobs: IssueAgentReplyState[], snapshotMessages: IssueMessage[]) => {
    const messagesById = new Map(snapshotMessages.map(message => [message.id, message]));
    for (const job of jobs) {
      agentRepliesByIdRef.current.set(job.id, job);
      if (job.status === "queued" || job.status === "running") {
        const trigger = messagesById.get(job.triggerMessageId);
        if (trigger) trackAgentReply(job, trigger);
      } else {
        finishTrackedAgentReply(job);
      }
    }
  }, [finishTrackedAgentReply, trackAgentReply]);
  useEffect(() => {
    setSubscriptionOverride(null);
    setSubscriptionPending(false);
  }, [backendSubscribed, run.id]);
  useEffect(() => {
    conversationCursorRef.current = null;
    trackedAgentRepliesRef.current.clear();
    agentRepliesByIdRef.current.clear();
    setConversationCursor(null);
    setAgentReplyStates({});
    focusedHighlightedMessageKeyRef.current = null;
    pendingSentMessageIdRef.current = null;
    userHasSentMessageRef.current = false;
  }, [run.id]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      messageLoadVersion.current += 1;
    };
  }, []);
  const loadMessages = useCallback(async () => {
    const requestedRunId = activeRunIdRef.current;
    const requestedVersion = ++messageLoadVersion.current;
    setLoading(true);
    setLoadError(null);
    try {
      const snapshot = token && organizationId && projectId ? await loadIssueConversationSnapshot(token, projectId, requestedRunId) : null;
      const loaded = snapshot?.messages ?? (await onLoadRef.current());
      if (mountedRef.current && activeRunIdRef.current === requestedRunId && messageLoadVersion.current === requestedVersion) {
        setMessages(current => mergeIssueMessages(current, loaded));
        if (snapshot && Number.isSafeInteger(snapshot.cursor)) {
          conversationCursorRef.current = snapshot.cursor;
          setConversationCursor(snapshot.cursor);
          reconcileAgentReplies(snapshot.agentReplies ?? [], loaded);
        }
      }
    } catch {
      if (mountedRef.current && activeRunIdRef.current === requestedRunId && messageLoadVersion.current === requestedVersion) {
        setLoadError(t("run.messagesLoadFailed"));
      }
    } finally {
      if (mountedRef.current && activeRunIdRef.current === requestedRunId && messageLoadVersion.current === requestedVersion) {
        setLoading(false);
      }
    }
  }, [organizationId, projectId, reconcileAgentReplies, t, token]);
  const loadSkillExecutionContext = useCallback(async (proposal: AgentSkillExecutionProposal) => {
    if (!token) {
      return {
        workers: executionWorkers,
        policy: executionPolicy
      };
    }
    const dashboard = await loadDashboard(token, proposal.projectId || projectId);
    return {
      workers: dashboard.workers ?? [],
      policy: dashboard.executionPolicy
    };
  }, [executionPolicy, executionWorkers, projectId, token]);
  useEffect(() => {
    void loadMessages();
  }, [loadMessages, run.id]);
  useEffect(() => {
    if (!token || !organizationId || conversationCursor === null) return;
    let disposed = false;
    let syncing = false;
    let pending = false;
    let continuationTimer: number | null = null;
    const sync = async () => {
      pending = true;
      if (disposed || syncing) return;
      syncing = true;
      let needsContinuation = false;
      try {
        while (pending && !disposed) {
          pending = false;
          let hasMore = false;
          for (let pageCount = 0; pageCount < MAX_PROJECT_DELTA_PAGES_PER_SYNC; pageCount += 1) {
            const cursor = conversationCursorRef.current;
            if (cursor === null) return;
            const delta = await loadIssueConversationDelta(token, projectId, run.id, cursor);
            if (disposed || activeRunIdRef.current !== run.id) return;
            conversationCursorRef.current = delta.cursor;
            if (delta.changed && delta.messages && delta.agentReplies) {
              setMessages(current => mergeIssueMessages(current, delta.messages!));
              reconcileAgentReplies(delta.agentReplies, delta.messages);
            }
            hasMore = delta.hasMore;
            if (!hasMore) break;
          }
          needsContinuation = hasMore;
          if (needsContinuation) break;
        }
      } catch (caught) {
        if (disposed) return;
        if (isApiErrorStatus(caught, 410)) {
          await loadMessages();
        } else {
          console.warn("Issue conversation realtime sync failed", caught);
        }
      } finally {
        syncing = false;
      }
      if ((needsContinuation || pending) && !disposed) {
        continuationTimer = window.setTimeout(() => void sync(), 0);
      }
    };
    const transport = createProjectRealtimeTransport(token, organizationId);
    const unsubscribe = transport.subscribe(notification => {
      if (notification.topic === "project" && notification.projectId === projectId && notification.cursor > (conversationCursorRef.current ?? -1)) {
        void sync();
      } else if (notification.topic === "ready") {
        // An explicit ready frame closes any notification gap after a reconnect.
        void sync();
      }
    });
    const updateVisibility = () => {
      if (document.hidden) {
        transport.stop();
      } else {
        transport.start();
      }
    };
    document.addEventListener("visibilitychange", updateVisibility);
    const fallback = window.setInterval(() => void sync(), CHANNEL_REALTIME_FALLBACK_MS);
    updateVisibility();
    if (inboxSyncSignal !== undefined && !document.hidden) {
      void sync();
    }
    return () => {
      disposed = true;
      if (continuationTimer !== null) window.clearTimeout(continuationTimer);
      document.removeEventListener("visibilitychange", updateVisibility);
      window.clearInterval(fallback);
      unsubscribe();
      transport.stop();
    };
  }, [conversationCursor, inboxSyncSignal, loadMessages, organizationId, projectId, reconcileAgentReplies, run.id, token]);
  const executionProposalStates = useMemo(() => {
    const runsById = new Map(executionRuns.map(candidate => [candidate.id, candidate]));
    runsById.set(run.id, run);
    return messages.flatMap(message => {
      const proposal = message.executionProposal;
      if (!proposal || proposal.status !== "pending") return [];
      const target = runsById.get(proposal.runId);
      return [[proposal.id, JSON.stringify(target ? [target.updatedAt, target.status, target.executionReadiness ?? null, target.agentId ?? null, target.requestedProvider ?? null, target.requestedModel ?? null, target.requestedEffort ?? null, target.requestedWorkerId ?? null, target.requestedByUserId ?? null, target.dispatchMode ?? null, target.workerId ?? null, target.claimedBy ?? null, target.claimedAt ?? null, target.dispatchedAt ?? null] : null), issueExecutionApprovalUnavailable(target ?? null, proposal.runId) !== null] as const];
    });
  }, [executionRuns, messages, run]);
  const executionProposalStateSignature = JSON.stringify(executionProposalStates);
  useEffect(() => {
    const previous = executionProposalStateByIdRef.current;
    const next = new Map(executionProposalStates.map(([proposalId, state]) => [proposalId, state]));
    const changed = executionProposalStates.some(([proposalId, state, initiallyUnavailable]) => previous.has(proposalId) ? previous.get(proposalId) !== state : initiallyUnavailable);
    executionProposalStateByIdRef.current = next;
    if (changed) void loadMessages();
  }, [executionProposalStateSignature, loadMessages]);
  const messagesById = useMemo(() => {
    const byId = new Map<string, IssueMessage>();
    for (const message of messages) byId.set(message.id, message);
    return byId;
  }, [messages]);
  const orderedMessages = useMemo(() => [...messages].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    if (byTime !== 0) return byTime;
    return left.id.localeCompare(right.id);
  }), [messages]);
  const agentReplyIndicatorsByThreadId = useMemo(() => {
    const byThread = new Map<string, Map<string, {
      agentName: string | null;
      activity?: ChannelAgentActivityDescriptor;
      sentAt?: string;
    }>>();
    for (const [jobId, tracked] of trackedAgentRepliesRef.current) {
      const job = agentRepliesByIdRef.current.get(jobId);
      if (!job) continue;
      const agentName = job.agentName?.trim() || mentionAgents.find(agent => agent.id === job.agentId)?.name.trim() || null;
      const frame = issueActivity.get(jobId);
      const key = job.agentId ? `agent:${job.agentId}` : agentName ? `name:${agentName}` : `job:${job.id}`;
      const indicators = byThread.get(tracked.replyThreadId) ?? new Map();
      const current = indicators.get(key);
      const hasCurrentActivity = Boolean(current?.activity && current.sentAt);
      const hasNextActivity = Boolean(frame?.activity && frame.attempt === job.attempts);
      if (!current || hasNextActivity && (!hasCurrentActivity || current.sentAt! < frame!.sentAt)) {
        indicators.set(key, {
          agentName,
          ...(hasNextActivity ? {
            activity: frame!.activity,
            sentAt: frame!.sentAt
          } : {})
        });
      }
      byThread.set(tracked.replyThreadId, indicators);
    }
    return Object.fromEntries([...byThread].map(([threadId, indicators]) => [threadId, [...indicators].map(([key, indicator]) => ({
      key,
      ...indicator
    }))]));
  }, [agentReplyStates, issueActivity, mentionAgents]);
  const replySummaries = useMemo(() => {
    const summaries = new Map<string, {
      lastReplyAt: string;
      participants: ConversationReplyParticipant[];
    }>();
    const replies = [...messages].filter(message => message.parentMessageId).sort((left, right) => {
      const byTime = right.createdAt.localeCompare(left.createdAt);
      if (byTime !== 0) return byTime;
      return right.id.localeCompare(left.id);
    });
    for (const reply of replies) {
      const parentId = reply.parentMessageId;
      if (!parentId) continue;
      const summary = summaries.get(parentId) ?? {
        lastReplyAt: reply.createdAt,
        participants: []
      };
      const participant = issueReplyParticipant(reply.author);
      if (summary.participants.length < 3 && !summary.participants.some(candidate => candidate.id === participant.id)) {
        summary.participants.push(participant);
      }
      summaries.set(parentId, summary);
    }
    return summaries;
  }, [messages]);
  const pendingAgentReplyCount = Object.values(agentReplyStates).reduce((total, state) => total + state.pending, 0);
  const mentionHandles = useMemo(() => [...mentionMembers.map(member => issueMentionHandle(member)), ...mentionAgents.map(agent => mentionHandle(agent.name))], [mentionAgents, mentionMembers]);
  const profilesByHandle = useMemo(() => {
    const profiles = new Map<string, ProfileTarget>();
    for (const member of mentionMembers) {
      profiles.set(issueMentionHandle(member).toLowerCase(), {
        type: "user",
        id: member.userId,
        name: member.name,
        email: member.email,
        image: member.image,
        role: member.role,
        roleContext: "organization",
        createdAt: member.createdAt
      });
    }
    for (const agent of mentionAgents) {
      profiles.set(mentionHandle(agent.name).toLowerCase(), {
        type: "agent",
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        description: agent.description ?? null,
        responsibility: agent.responsibility,
        skills: agent.skills,
        projectId: agent.projectId,
        createdAt: agent.createdAt
      });
    }
    return profiles;
  }, [mentionAgents, mentionMembers]);
  const openMentionProfile = useCallback((handle: string) => {
    const profile = profilesByHandle.get(handle.toLowerCase());
    if (profile) setActiveProfile(profile);
  }, [profilesByHandle]);
  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    if (pendingSentMessageIdRef.current) {
      const sentMessageId = pendingSentMessageIdRef.current;
      messageList.scrollTop = messageList.scrollHeight;
      scrollConversationToBottom(messageList);
      setIsAwayFromBottom(false);
      const target = [...messageList.querySelectorAll<HTMLElement>(
        "[data-issue-message-id]",
      )].find(element => element.dataset.issueMessageId === sentMessageId);
      if (target) {
        target.focus({ preventScroll: true });
        pendingSentMessageIdRef.current = null;
      }
      return;
    }
    if (!highlightedMessageId) {
      messageList.scrollTop = messageList.scrollHeight;
      setIsAwayFromBottom(false);
    }
  }, [highlightedMessageId, loading, messages.length, pendingAgentReplyCount]);
  useLayoutEffect(() => {
    if (userHasSentMessageRef.current || !highlightedMessageId || loading || pendingSentMessageIdRef.current) return;
    const targetKey = `${run.id}:${highlightedMessageId}`;
    if (focusedHighlightedMessageKeyRef.current === targetKey) return;
    const messageList = messageListRef.current;
    const target = [...(messageList?.querySelectorAll<HTMLElement>(
      "[data-issue-message-id]",
    ) ?? [])].find(
      (element) => element.dataset.issueMessageId === highlightedMessageId,
    );
    if (!messageList || !target) return;
    scrollElementToCenter(messageList, target);
    target.focus({ preventScroll: true });
    focusedHighlightedMessageKeyRef.current = targetKey;
    setIsAwayFromBottom(false);
  }, [highlightedMessageId, loading, messages.length, orderedMessages.length, run.id]);
  const sendMessage = async (body: string, parentMessageId: string | null, mentionedUserIds: string[], mentionedAgentIds: string[], attachments: File[], attachmentReferences: string[]) => {
    const appendMessage = (message: IssueMessage) => setMessages(current => {
      if (current.some(candidate => candidate.id === message.id)) {
        return current.map(candidate => candidate.id === message.id ? message : candidate);
      }
      return [...current.map(candidate => candidate.id === message.parentMessageId ? {
        ...candidate,
        replyCount: candidate.replyCount + 1
      } : candidate), message];
    });
    const clientMessageId = crypto.randomUUID();
    pendingSentMessageIdRef.current = clientMessageId;
    userHasSentMessageRef.current = true;
    focusedHighlightedMessageKeyRef.current = `${run.id}:${clientMessageId}`;
    const createdAt = new Date().toISOString();
    const currentMember = mentionMembers.find(member => member.userId === currentUserId);
    const previewUrls = attachments.map(attachment => URL.createObjectURL(attachment));
    appendMessage({
      id: clientMessageId,
      runId: run.id,
      parentMessageId,
      body,
      attachments: attachments.map((attachment, index) => ({
        id: attachmentReferences[index] ?? crypto.randomUUID(),
        filename: attachment.name,
        contentType: attachment.type,
        byteSize: attachment.size,
        url: previewUrls[index] ?? ""
      })),
      author: {
        id: currentUserId,
        name: currentMember?.name ?? t("channel.you"),
        image: currentMember?.image ?? null,
        provider: null
      },
      replyCount: 0,
      optimistic: true,
      createdAt,
      updatedAt: createdAt
    });
    let result: IssueMessageSendResult;
    try {
      result = await onSend({
        body,
        clientMessageId,
        parentMessageId,
        mentionedUserIds,
        mentionedAgentIds,
        ...(attachments.length > 0 ? {
          attachments,
          attachmentReferences
        } : {})
      });
      appendMessage(result.message);
    } catch (caught) {
      setMessages(current => {
        const pending = current.find(message => message.id === clientMessageId && message.optimistic);
        if (!pending) return current;
        return current.filter(message => message.id !== clientMessageId).map(message => message.id === parentMessageId ? {
          ...message,
          replyCount: Math.max(0, message.replyCount - 1)
        } : message);
      });
      throw caught;
    } finally {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    }
    const replyJobs = result.agentReplyJobs ?? (result.agentReplyJob ? [result.agentReplyJob] : []);
    for (const replyJob of replyJobs) {
      trackAgentReply(replyJob, result.message);
    }
    if (!result.agentReply) return;
    const replyThreadId = agentReplyParentMessageId(result.message);
    setAgentReplyStates(current => ({
      ...current,
      [replyThreadId]: {
        pending: (current[replyThreadId]?.pending ?? 0) + 1,
        error: null
      }
    }));
    void result.agentReply.then(message => {
      appendMessage(message);
      setAgentReplyStates(current => {
        const state = current[replyThreadId];
        if (!state) return current;
        const pending = Math.max(state.pending - 1, 0);
        if (pending === 0) {
          const next = {
            ...current
          };
          delete next[replyThreadId];
          return next;
        }
        return {
          ...current,
          [replyThreadId]: {
            ...state,
            pending
          }
        };
      });
    }).catch((caught: unknown) => {
      const error = caught instanceof Error ? caught.message : String(caught);
      setAgentReplyStates(current => ({
        ...current,
        [replyThreadId]: {
          pending: Math.max((current[replyThreadId]?.pending ?? 1) - 1, 0),
          error
        }
      }));
    });
  };
  const acceptIssueAction = async (proposal: IssueProposedAction) => {
    if (!onAcceptIssueAction) return;
    const requestedRunId = activeRunIdRef.current;
    setActionProposalStates(current => ({
      ...current,
      [proposal.id]: {
        accepting: true,
        error: null
      }
    }));
    try {
      const accepted = await onAcceptIssueAction(proposal);
      if (!mountedRef.current || activeRunIdRef.current !== requestedRunId) return;
      setMessages(current => current.map(message => message.proposedAction?.id === proposal.id ? {
        ...message,
        proposedAction: accepted
      } : message));
      if (proposal.type === "request_issue_create" && proposal.executeAfterCreate) {
        // The create transaction materializes a separate execution proposal
        // on this same reply. Reload the conversation authoritatively so the
        // accepted creation evidence and second approval card coexist.
        await loadMessages();
        if (!mountedRef.current || activeRunIdRef.current !== requestedRunId) {
          return;
        }
      }
      setActionProposalStates(current => {
        const next = {
          ...current
        };
        delete next[proposal.id];
        return next;
      });
    } catch (caught) {
      if (!mountedRef.current || activeRunIdRef.current !== requestedRunId) return;
      setActionProposalStates(current => ({
        ...current,
        [proposal.id]: {
          accepting: false,
          error: caught instanceof Error ? caught.message : String(caught)
        }
      }));
    }
  };
  const editMessage = async (messageId: string, body: string, mentionedUserIds: string[]) => {
    setMessageErrors(current => ({
      ...current,
      [messageId]: null
    }));
    try {
      const updated = await onEdit(messageId, {
        body,
        mentionedUserIds
      });
      setMessages(current => current.map(message => message.id === messageId ? updated : message));
      setActiveEditMessageId(current => current === messageId ? null : current);
    } catch (caught) {
      setMessageErrors(current => ({
        ...current,
        [messageId]: caught instanceof Error ? caught.message : String(caught)
      }));
    }
  };
  const deleteMessage = async (messageId: string) => {
    if (!window.confirm(t("run.deleteMessageConfirm"))) return;
    setMessageErrors(current => ({
      ...current,
      [messageId]: null
    }));
    try {
      await onDelete(messageId);
      const deletedIds = new Set<string>([messageId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const message of messages) {
          if (message.parentMessageId && deletedIds.has(message.parentMessageId) && !deletedIds.has(message.id)) {
            deletedIds.add(message.id);
            changed = true;
          }
        }
      }
      const deletedRepliesByParent = new Map<string, number>();
      for (const message of messages) {
        if (!deletedIds.has(message.id) || !message.parentMessageId || deletedIds.has(message.parentMessageId)) {
          continue;
        }
        deletedRepliesByParent.set(message.parentMessageId, (deletedRepliesByParent.get(message.parentMessageId) ?? 0) + 1);
      }
      setMessages(current => current.filter(message => !deletedIds.has(message.id)).map(message => {
        const deletedReplyCount = deletedRepliesByParent.get(message.id) ?? 0;
        return deletedReplyCount > 0 ? {
          ...message,
          replyCount: Math.max(0, message.replyCount - deletedReplyCount)
        } : message;
      }));
      setActiveEditMessageId(current => current && deletedIds.has(current) ? null : current);
    } catch (caught) {
      setMessageErrors(current => ({
        ...current,
        [messageId]: caught instanceof Error ? caught.message : String(caught)
      }));
    }
  };
  const toggleSubscription = async () => {
    if (!onUpdateSubscription || subscriptionPending) return;
    const next = !isSubscribed;
    setSubscriptionOverride(next);
    setSubscriptionPending(true);
    try {
      await onUpdateSubscription(next);
    } catch {
      setSubscriptionOverride(null);
      toast(t("run.subscriptionFailed"), {
        tone: "error"
      });
    } finally {
      setSubscriptionPending(false);
    }
  };
  return <section className="issue-conversation" aria-label={t("run.messages")}>
      <header className="issue-conversation-header">
        <strong>
          {t("run.messages")}
          {!loading && <span>{messages.length}</span>}
        </strong>
        <div className="issue-conversation-header-actions">
          {subscriberMembers.length > 0 ? <div aria-label={t("run.subscribers", {
          count: subscriberMembers.length
        })} className="issue-subscriber-avatars" title={subscriberMembers.map(member => member.name).join(", ")}>
              {subscriberMembers.slice(0, 4).map(member => <span className="issue-subscriber-avatar" key={member.userId}>
                  {member.image ? <img alt="" src={member.image} /> : member.name.trim().charAt(0).toUpperCase() || "?"}
                </span>)}
              {subscriberMembers.length > 4 ? <span className="issue-subscriber-overflow">
                  +{subscriberMembers.length - 4}
                </span> : null}
            </div> : null}
          {currentUserId && onUpdateSubscription ? <button aria-pressed={isSubscribed} className={`issue-subscribe-button${isSubscribed ? " active" : ""}`} disabled={subscriptionPending || isSubscribed && assigneeSubscriptionRequired} onClick={() => void toggleSubscription()} title={assigneeSubscriptionRequired ? t("run.assigneeSubscriptionRequired") : isSubscribed ? t("run.unsubscribe") : t("run.subscribe")} type="button">
              {subscriptionPending ? <Spinner aria-hidden="true" size={13} /> : <Bell aria-hidden="true" size={13} />}
              {isSubscribed ? t("run.subscribed") : t("run.subscribe")}
            </button> : <small>{t("run.agentRepliesHere")}</small>}
        </div>
      </header>
      <div className="conversation-scroll-region">
        <div className="issue-message-list" onScroll={event => setIsAwayFromBottom(conversationIsAwayFromBottom(event.currentTarget))} ref={messageListRef}>
        {loading ? <div className="issue-message-state">
            <Spinner size={16} />
            {t("run.messagesLoading")}
          </div> : loadError ? <button className="issue-message-state error" onClick={() => void loadMessages()} type="button">
            <CircleAlert size={15} />
            {loadError}
          </button> : orderedMessages.length === 0 ? <p className="issue-message-empty">{t("run.messagesEmpty")}</p> : orderedMessages.map(message => {
          const replyComposerId = `issue-reply-composer-${message.id}`;
          const editComposerId = `issue-edit-composer-${message.id}`;
          const isReplying = activeReplyMessageId === message.id;
          const isEditing = activeEditMessageId === message.id;
          const parentMessage = message.parentMessageId ? messagesById.get(message.parentMessageId) ?? null : null;
          const replySummary = replySummaries.get(message.id);
          const replyParticipants = [issueReplyParticipant(message.author), ...(replySummary?.participants ?? [])].filter((participant, index, participants) => participants.findIndex(candidate => candidate.id === participant.id) === index).slice(0, 3);
          return <div className="issue-message-group" key={message.id}>
                <IssueMessageItem currentUserId={currentUserId} highlighted={message.id === highlightedMessageId} isEditing={isEditing} isReplying={isReplying} localeTag={localeTag} message={message} mentionHandles={mentionHandles} onMentionOpen={openMentionProfile} onAcceptIssueAction={onAcceptIssueAction && message.proposedAction ? () => void acceptIssueAction(message.proposedAction!) : undefined} onAcceptIssueExecution={onAcceptIssueExecution && message.executionProposal ? input => onAcceptIssueExecution(message.executionProposal!, input) : undefined} onIssueOpen={onIssueOpen} onAcceptSkillExecution={onAcceptSkillExecution && message.skillExecutionProposal ? input => onAcceptSkillExecution(message.skillExecutionProposal!, input) : undefined} onExecutionProposalAccepted={accepted => {
              setMessages(current => current.map(candidate => candidate.id === message.id ? {
                ...candidate,
                executionProposal: accepted
              } : candidate));
            }} onSkillExecutionProposalAccepted={accepted => {
              setMessages(current => current.map(candidate => candidate.id === message.id ? {
                ...candidate,
                skillExecutionProposal: accepted
              } : candidate));
            }} loadSkillExecutionContext={() => loadSkillExecutionContext(message.skillExecutionProposal!)} executionPolicy={executionPolicy} executionRun={message.executionProposal ? executionRuns.find(candidate => candidate.id === message.executionProposal?.runId) ?? null : run} executionWorkers={executionWorkers} onDelete={message.optimistic ? undefined : () => void deleteMessage(message.id)} onEdit={message.optimistic ? undefined : () => setActiveEditMessageId(current => current === message.id ? null : message.id)} onLoadAttachment={onLoadAttachment} onReply={message.optimistic ? undefined : () => setActiveReplyMessageId(current => current === message.id ? null : message.id)} parentMessage={parentMessage} replyParticipants={replyParticipants} lastReplyAt={replySummary?.lastReplyAt ?? null} replyComposerId={replyComposerId} editComposerId={editComposerId} actionProposalState={message.proposedAction ? actionProposalStates[message.proposedAction.id] : undefined} actionError={messageErrors[message.id] ?? null} reworkStageLabel={message.proposedAction?.type === "request_issue_rework" ? localizeWorkflowStage(t, message.proposedAction.workflowStage, run.workflow.stages.find(stage => message.proposedAction?.type === "request_issue_rework" && stage.id === message.proposedAction.workflowStage)?.label ?? message.proposedAction.workflowStage) : null} />
                <AgentReplyState indicators={agentReplyIndicatorsByThreadId[message.id]} state={agentReplyStates[message.id]} />
                {isReplying && <div className="issue-inline-reply-composer" id={replyComposerId}>
                    <MessageComposer autoFocus compact mentionMembers={mentionMembers} mentionAgents={mentionAgents} onCancel={() => setActiveReplyMessageId(null)} onMentionOpen={openMentionProfile} onSubmit={async (body, mentionedUserIds, mentionedAgentIds, attachments, references) => {
                await sendMessage(body, message.id, mentionedUserIds, mentionedAgentIds, attachments, references);
                setActiveReplyMessageId(current => current === message.id ? null : current);
              }} placeholder={t("run.threadPlaceholder")} />
                  </div>}
                {isEditing && <div className="issue-inline-reply-composer" id={editComposerId}>
                    <MessageComposer autoFocus compact disableAttachments initialBody={message.body} mentionMembers={mentionMembers} mentionAgents={mentionAgents} onCancel={() => setActiveEditMessageId(null)} onMentionOpen={openMentionProfile} onSubmit={async (body, mentionedUserIds, _mentionedAgentIds, _attachments, _references) => {
                await editMessage(message.id, body, mentionedUserIds);
              }} placeholder={t("run.editMessagePlaceholder")} />
                  </div>}
              </div>;
        })}
        </div>
        {showsScrollToLatest && isAwayFromBottom ? <ConversationScrollToBottomButton label={t("run.jumpToLatest")} onClick={() => {
        const scroller = messageListRef.current;
        if (!scroller) return;
        setIsAwayFromBottom(false);
        scrollConversationToBottom(scroller);
      }} /> : null}
      </div>
      <MessageComposer mentionMembers={mentionMembers} mentionAgents={mentionAgents} onMentionOpen={openMentionProfile} onSubmit={(body, mentionedUserIds, mentionedAgentIds, attachments, references) => sendMessage(body, null, mentionedUserIds, mentionedAgentIds, attachments, references)} placeholder={t("run.messagePlaceholder", {
      title: run.title
    })} />
      <ProfileDialog profile={activeProfile} onOpenChange={open => {
      if (!open) setActiveProfile(null);
    }} />
    </section>;
}
