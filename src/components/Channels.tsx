import {
  AtSign,
  Bot,
  Check,
  Copy,
  FileText,
  Hash,
  Headphones,
  LoaderCircle,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  RefreshCw,
  Trash2,
  Type,
  UserPlus,
  Users,
  Webhook,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useI18n } from "../i18n";
import { useChannelComposer } from "../hooks/useChannelComposer";
import { useHorizontalPaneResize } from "../hooks/useHorizontalPaneResize";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import {
  acceptChannelSkillExecutionProposal,
  acceptChannelExecutionProposal,
  acceptChannelProposal,
  createChannelWebhook,
  listChannelMessages,
  listChannelWebhooks,
  listChannels,
  listOrganizationAgents,
  loadChannel,
  loadChannelDelta,
  markChannelRead,
  loadDashboard,
  loadOrganizationMembers,
  sendChannelMessage,
  revokeChannelWebhook,
  rotateChannelWebhook,
  setChannelAgent,
  setChannelMember,
  toggleChannelMessageReaction,
  updateChannelWebhook,
} from "../lib/api";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  ExecutionWorker,
  HuntRun,
  IssueExecutionApprovalInput,
  OrganizationMember,
  Project,
  ProjectExecutionWorkerPolicy,
} from "../types";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelExecutionProposal,
  ChannelSummary,
  ChannelWebhook,
} from "../lib/channels-contract";
import {
  channelHasUnread,
  laterTimestamp,
  markChannelCatalogRead,
} from "../lib/channel-unread";
import type { MentionTarget } from "../lib/channel-mentions";
import {
  mergeChannelMessages,
  mergeChannelMessageSnapshot,
} from "../lib/channel-message-merge";
import { maxIssueAttachmentCount } from "../lib/issue-attachments";
import {
  ChannelDraftImages,
  ChannelMessageImages,
} from "./ChannelImages";
import { ChannelMentionMenu } from "./ChannelMentionMenu";
import { MentionComposerField } from "./MentionComposerField";
import {
  ProfileDialog,
  profileTargetForChannelAgent,
  profileTargetForChannelMember,
  type ProfileTarget,
} from "./ProfileDialog";
import {
  channelThreadWidthDefault,
  channelThreadWidthMax,
  channelThreadWidthMin,
  clampChannelThreadWidth,
  loadChannelThreadWidth,
  saveChannelThreadWidth,
} from "../lib/channel-thread-width";
import { ChannelMessageText } from "./ChannelMessageText";
import { ChannelMessageReactions } from "./ChannelMessageReactions";
import {
  ConversationReplySummary,
  type ConversationReplyParticipant,
} from "./ConversationReplySummary";
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

type ChannelsProps = {
  organizationId: string;
  token: string;
  currentUserId: string | null;
  channels: ChannelSummary[];
  projects?: readonly Pick<Project, "id" | "name" | "organizationId">[];
  activeChannelId: string | null;
  onChannelSelect: (channelId: string | null) => void;
  onChannelsChange: Dispatch<SetStateAction<ChannelSummary[]>>;
  onIssueCreated?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  onCreateAgent?: () => void;
  requestedMessage?: {
    channelId: string;
    messageId: string;
    rootMessageId: string;
  } | null;
  onRequestedMessageOpen?: () => void;
};

type ChannelInviteCandidate =
  | { type: "user"; id: string; member: OrganizationMember }
  | { type: "agent"; id: string; agent: ChannelAgentSummary };

const dayKey = (iso: string, localeTag: string) => {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const formatDayLabel = (
  iso: string,
  localeTag: string,
  t: (key: "channel.today" | "channel.yesterday") => string,
) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso, localeTag) === dayKey(today.toISOString(), localeTag)) {
    return t("channel.today");
  }
  if (dayKey(iso, localeTag) === dayKey(yesterday.toISOString(), localeTag)) {
    return t("channel.yesterday");
  }
  return new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

const formatMessageTime = (iso: string, localeTag: string) =>
  new Intl.DateTimeFormat(localeTag, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

const authorInitial = (name: string) =>
  name.trim().charAt(0).toUpperCase() || "?";

type Translate = ReturnType<typeof useI18n>["t"];

type ChannelSurfaceContext = {
  generation: number;
  channelId: string | null;
  threadParentId: string | null;
};

const replyRelativeTime = (value: string, t: Translate) => {
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

const channelAuthorId = (author: ChannelMessage["author"]) =>
  author.type === "user"
    ? `user:${author.id || author.email || author.name}`
    : `${author.type}:${author.id ?? author.name}`;

const channelReplyParticipants = (
  message: ChannelMessage,
): ConversationReplyParticipant[] =>
  [message.author, ...(message.replyAuthors ?? [])]
    .filter(
      (author, index, authors) =>
        authors.findIndex(
          (candidate) => channelAuthorId(candidate) === channelAuthorId(author),
        ) === index,
    )
    .slice(0, 3)
    .map((author) => ({
      id: channelAuthorId(author),
      name: author.name,
      image: author.type === "user" || author.type === "agent"
        ? author.image
        : null,
      isAgent: author.type !== "user",
    }));

const appendChannelReplySummary = (
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

export function Channels({
  organizationId,
  token,
  currentUserId,
  channels,
  projects = [],
  activeChannelId,
  onChannelSelect,
  onChannelsChange,
  onIssueCreated,
  onSkillSessionAccepted,
  requestedMessage,
  onRequestedMessageOpen,
  onCreateAgent,
}: ChannelsProps) {
  const { t, localeTag } = useI18n();
  useEffect(() => {
    if (!activeChannelId) return;
    const channel = channels.find((item) => item.id === activeChannelId);
    if (!channel || !channelHasUnread(channel)) return;
    const lastReadAt = laterTimestamp(
      channel.lastMessageAt,
      new Date().toISOString(),
    );
    onChannelsChange((current) =>
      markChannelCatalogRead(current, activeChannelId, lastReadAt),
    );
    void markChannelRead(token, organizationId, activeChannelId, { lastReadAt })
      .catch(() => {
        // The next catalog snapshot restores unread if the write failed.
      });
  }, [
    activeChannelId,
    channels,
    onChannelsChange,
    organizationId,
    token,
  ]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<ChannelAgentSummary[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [replies, setReplies] = useState<ChannelAgentReply[]>([]);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([]);
  const [proposalProjects, setProposalProjects] = useState<
    Record<string, string>
  >({});
  const [channelListReady, setChannelListReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptingProposalId, setAcceptingProposalId] = useState<string | null>(
    null,
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMembers, setInviteMembers] = useState<OrganizationMember[]>([]);
  const [inviteAgents, setInviteAgents] = useState<ChannelAgentSummary[]>([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [webhooksOpen, setWebhooksOpen] = useState(false);
  const [webhooks, setWebhooks] = useState<ChannelWebhook[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksSaving, setWebhooksSaving] = useState(false);
  const [webhooksError, setWebhooksError] = useState<string | null>(null);
  const [revealedWebhookUrl, setRevealedWebhookUrl] = useState<string | null>(null);
  const {
    containerRef: channelsRef,
    effectiveWidth: effectiveThreadWidth,
    isResizing: isResizingThread,
    separatorProps: threadResizeProps,
    width: threadWidth,
  } = useHorizontalPaneResize({
    clamp: clampChannelThreadWidth,
    defaultWidth: channelThreadWidthDefault,
    load: loadChannelThreadWidth,
    max: channelThreadWidthMax,
    min: channelThreadWidthMin,
    save: saveChannelThreadWidth,
  });
  const cursor = useRef(0);
  const channelDataVersion = useRef(0);
  const authoritativeLoadVersion = useRef<number | null>(null);
  const channelSurfaceGeneration = useRef(0);
  const renderedChannelSurface = useRef({
    channelId: activeChannelId,
    threadParentId,
  });
  const proposalVersions = useRef(new Map<string, number>());
  const latestProposals = useRef(
    new Map<string, NonNullable<ChannelMessage["proposal"]>>(),
  );
  const executionHistoryDashboards = useRef(
    new Map<string, ReturnType<typeof loadDashboard>>(),
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const threadMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeChannelIdRef = useRef(activeChannelId);
  const threadParentIdRef = useRef(threadParentId);
  if (
    renderedChannelSurface.current.channelId !== activeChannelId ||
    renderedChannelSurface.current.threadParentId !== threadParentId
  ) {
    channelSurfaceGeneration.current += 1;
    renderedChannelSurface.current = {
      channelId: activeChannelId,
      threadParentId,
    };
  }
  activeChannelIdRef.current = activeChannelId;
  threadParentIdRef.current = threadParentId;

  const captureChannelSurface = useCallback(
    (): ChannelSurfaceContext => ({
      generation: channelSurfaceGeneration.current,
      channelId: activeChannelIdRef.current,
      threadParentId: threadParentIdRef.current,
    }),
    [],
  );

  const channelSurfaceIsCurrent = useCallback(
    (context: ChannelSurfaceContext) =>
      context.generation === channelSurfaceGeneration.current &&
      context.channelId === activeChannelIdRef.current &&
      context.threadParentId === threadParentIdRef.current,
    [],
  );

  const invalidateChannelSurface = useCallback(
    (channelId: string | null, parentMessageId: string | null) => {
      channelSurfaceGeneration.current += 1;
      activeChannelIdRef.current = channelId;
      threadParentIdRef.current = parentMessageId;
      setBusy(false);
      setAcceptingProposalId(null);
    },
    [],
  );

  useEffect(() => {
    // A parent-selected channel change and a rendered thread transition both
    // invalidate the previous surface synchronously above. Clear its shared
    // busy presentation here so a deliberately ignored completion cannot leave
    // the newly selected surface disabled.
    setBusy(false);
  }, [activeChannelId, threadParentId]);

  useEffect(() => {
    executionHistoryDashboards.current.clear();
  }, [token]);

  useEffect(
    () => () => {
      channelSurfaceGeneration.current += 1;
      activeChannelIdRef.current = null;
      threadParentIdRef.current = null;
    },
    [],
  );

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const recordProposalMessages = useCallback((incoming: ChannelMessage[]) => {
    const recorded = new Set<string>();
    for (const message of incoming) {
      const proposal = message.proposal;
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

  const openInvite = useCallback(() => {
    if (!activeChannelId) return;
    setInviteOpen(true);
    setInviteLoading(true);
    setInviteError(null);
    setInviteMembers([]);
    setInviteAgents([]);
    void Promise.all([
      loadOrganizationMembers(token, organizationId),
      listOrganizationAgents(token, organizationId),
    ])
      .then(([organizationMembers, organizationAgents]) => {
        setInviteMembers(organizationMembers);
        setInviteAgents(organizationAgents.agents);
      })
      .catch((cause) => setInviteError(errorMessage(cause)))
      .finally(() => setInviteLoading(false));
  }, [activeChannelId, organizationId, token]);

  const openWebhooks = useCallback(() => {
    if (!activeChannelId) return;
    setWebhooksOpen(true);
    setWebhooksLoading(true);
    setWebhooksError(null);
    setWebhooks([]);
    setRevealedWebhookUrl(null);
    void listChannelWebhooks(token, organizationId, activeChannelId)
      .then((result) => setWebhooks(result.webhooks))
      .catch((cause) => setWebhooksError(errorMessage(cause)))
      .finally(() => setWebhooksLoading(false));
  }, [activeChannelId, organizationId, token]);

  const createWebhook = useCallback(async (name: string) => {
    if (!activeChannelId) return;
    setWebhooksSaving(true);
    setWebhooksError(null);
    try {
      const result = await createChannelWebhook(
        token, organizationId, activeChannelId, name,
      );
      setWebhooks((current) => [...current, result.webhook]);
      setRevealedWebhookUrl(result.url);
    } catch (cause) {
      setWebhooksError(errorMessage(cause));
      throw cause;
    } finally {
      setWebhooksSaving(false);
    }
  }, [activeChannelId, organizationId, token]);

  const renameWebhook = useCallback(async (webhookId: string, name: string) => {
    if (!activeChannelId) return;
    setWebhooksSaving(true);
    setWebhooksError(null);
    try {
      const result = await updateChannelWebhook(
        token, organizationId, activeChannelId, webhookId, name,
      );
      setWebhooks((current) => current.map((item) =>
        item.id === result.webhook.id ? result.webhook : item));
    } catch (cause) {
      setWebhooksError(errorMessage(cause));
    } finally {
      setWebhooksSaving(false);
    }
  }, [activeChannelId, organizationId, token]);

  const rotateWebhook = useCallback(async (webhookId: string) => {
    if (!activeChannelId) return;
    setWebhooksSaving(true);
    setWebhooksError(null);
    try {
      const result = await rotateChannelWebhook(
        token, organizationId, activeChannelId, webhookId,
      );
      setWebhooks((current) => current.map((item) =>
        item.id === result.webhook.id ? result.webhook : item));
      setRevealedWebhookUrl(result.url);
    } catch (cause) {
      setWebhooksError(errorMessage(cause));
    } finally {
      setWebhooksSaving(false);
    }
  }, [activeChannelId, organizationId, token]);

  const revokeWebhook = useCallback(async (webhookId: string) => {
    if (!activeChannelId) return;
    setWebhooksSaving(true);
    setWebhooksError(null);
    try {
      const result = await revokeChannelWebhook(
        token, organizationId, activeChannelId, webhookId,
      );
      setWebhooks((current) => current.map((item) =>
        item.id === result.webhook.id ? result.webhook : item));
    } catch (cause) {
      setWebhooksError(errorMessage(cause));
    } finally {
      setWebhooksSaving(false);
    }
  }, [activeChannelId, organizationId, token]);

  const addInvitees = useCallback(
    async (selected: ChannelInviteCandidate[]) => {
      if (!activeChannelId || selected.length === 0) return;
      setInviteSaving(true);
      setInviteError(null);
      const refreshRoster = async () => {
        const refreshed = await loadChannel(
          token,
          organizationId,
          activeChannelId,
        );
        setMembers(refreshed.members);
        setAgents(refreshed.agents);
        onChannelsChange((current) =>
          current.map((channel) =>
            channel.id === refreshed.channel.id ? refreshed.channel : channel,
          ),
        );
      };
      try {
        const results = await Promise.allSettled(
          selected.map((candidate) =>
            candidate.type === "user"
              ? setChannelMember(
                  token,
                  organizationId,
                  activeChannelId,
                  candidate.id,
                  true,
                )
              : setChannelAgent(
                  token,
                  organizationId,
                  activeChannelId,
                  candidate.id,
                  true,
                ),
          ),
        );
        const failed = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        try {
          await refreshRoster();
        } catch (cause) {
          setInviteError(errorMessage(failed?.reason ?? cause));
          return;
        }

        if (failed) {
          // Some idempotent roster writes may have succeeded. Keep the modal
          // open with the refreshed roster so retrying the remaining entries
          // is safe and cannot race an in-flight write.
          setInviteError(errorMessage(failed.reason));
          return;
        }
        setInviteOpen(false);
      } finally {
        setInviteSaving(false);
      }
    },
    [activeChannelId, onChannelsChange, organizationId, token],
  );

  useEffect(() => {
    let cancelled = false;
    cursor.current = 0;
    setChannelListReady(false);
    proposalVersions.current.clear();
    latestProposals.current.clear();
    void (async () => {
      try {
        const result = await listChannels(token, organizationId);
        if (cancelled) return;
        cursor.current = result.cursor;
        onChannelsChange(result.channels);
        setChannelListReady(true);
        if (!activeChannelIdRef.current) {
          onChannelSelect(result.channels[0]?.id ?? null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause));
          // A channel detail can still load from the parent's last catalog;
          // polling from cursor zero will reconcile once connectivity returns.
          setChannelListReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onChannelSelect, onChannelsChange, organizationId, token]);

  useEffect(() => {
    if (!activeChannelId || !channelListReady) return;
    let cancelled = false;
    const loadVersion = ++channelDataVersion.current;
    authoritativeLoadVersion.current = loadVersion;
    setProposalProjects({});
    void (async () => {
      try {
        const result = await loadChannel(token, organizationId, activeChannelId);
        if (cancelled || loadVersion !== channelDataVersion.current) return;
        onChannelsChange((current) =>
          current.some((channel) => channel.id === result.channel.id)
            ? current.map((channel) =>
                channel.id === result.channel.id ? result.channel : channel,
              )
            : [...current, result.channel],
        );
        setMembers(result.members);
        setAgents(result.agents);
        recordProposalMessages(result.messages);
        setMessages((current) =>
          mergeChannelMessageSnapshot(current, result.messages));
        const target = requestedMessage?.channelId === activeChannelId
          ? requestedMessage
          : null;
        if (target && target.rootMessageId !== target.messageId) {
          const threadResult = await listChannelMessages(
            token,
            organizationId,
            activeChannelId,
            target.rootMessageId,
          );
          if (cancelled || loadVersion !== channelDataVersion.current) return;
          recordProposalMessages(threadResult.messages);
          setThreadParentId(target.rootMessageId);
          setThreadMessages((current) =>
            mergeChannelMessageSnapshot(current, threadResult.messages));
        } else {
          setThreadParentId(null);
          setThreadMessages([]);
        }
        if (target) {
          window.requestAnimationFrame(() => {
            document
              .querySelector(`[data-channel-message-id="${target.messageId}"]`)
              ?.scrollIntoView?.({ block: "center" });
            onRequestedMessageOpen?.();
          });
        }
      } catch (cause) {
        if (!cancelled && loadVersion === channelDataVersion.current) {
          setError(errorMessage(cause));
        }
      } finally {
        if (authoritativeLoadVersion.current === loadVersion) {
          authoritativeLoadVersion.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
      if (loadVersion === channelDataVersion.current) {
        channelDataVersion.current += 1;
      }
      if (authoritativeLoadVersion.current === loadVersion) {
        authoritativeLoadVersion.current = null;
      }
    };
  }, [
    activeChannelId,
    channelListReady,
    onRequestedMessageOpen,
    onChannelsChange,
    organizationId,
    requestedMessage,
    recordProposalMessages,
    token,
  ]);

  // WebSocket carries only the latest organization cursor. D1 remains authoritative:
  // every notification drains the delta feed, and a low-frequency fallback
  // closes gaps after sleep, proxy disconnects, or a missed publish.
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let pending = false;
    let blockedRetry: number | null = null;
    const abortController = new AbortController();
    const transport = createChannelRealtimeTransport(token, organizationId);

    const scheduleBlockedRetry = () => {
      if (blockedRetry !== null || stopped) return;
      blockedRetry = window.setTimeout(() => {
        blockedRetry = null;
        if (pending) void sync();
      }, 250);
    };

    const sync = async () => {
      pending = true;
      if (
        !channelListReady ||
        document.hidden ||
        inFlight ||
        authoritativeLoadVersion.current != null
      ) {
        if (authoritativeLoadVersion.current != null) scheduleBlockedRetry();
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
            const requestedCursor = cursor.current;
            const requestedDataVersion = channelDataVersion.current;
            const delta = await loadChannelDelta(
              token,
              organizationId,
              requestedCursor,
              abortController.signal,
            );
            if (
              stopped ||
              requestedCursor !== cursor.current ||
              requestedDataVersion !== channelDataVersion.current ||
              authoritativeLoadVersion.current != null
            ) return;
            cursor.current = delta.cursor;
            if (delta.channels.length || delta.removedChannelIds.length) {
              onChannelsChange((current) => {
                const byId = new Map(
                  current.map((channel) => [channel.id, channel]),
                );
                for (const channel of delta.channels) {
                  byId.set(channel.id, channel);
                }
                for (const id of delta.removedChannelIds) byId.delete(id);
                return [...byId.values()].sort((left, right) =>
                  left.name.localeCompare(right.name),
                );
              });
            }
            if (delta.agentReplies.length) {
              setReplies((current) => {
                const byId = new Map(
                  current.map((reply) => [reply.id, reply]),
                );
                for (const reply of delta.agentReplies) byId.set(reply.id, reply);
                return [...byId.values()];
              });
            }
            const relevant = delta.messages.filter(
              (message) => message.channelId === activeChannelId,
            );
            if (relevant.length || delta.removedMessageIds.length) {
              recordProposalMessages(relevant);
              setMessages((current) =>
                mergeChannelMessages(
                  current,
                  relevant.filter(
                    (message) => message.parentMessageId === null,
                  ),
                  delta.removedMessageIds,
                ),
              );
              setThreadParentId((parentId) => {
                if (parentId) {
                  const threadUpdates = relevant.filter(
                    (message) =>
                      message.parentMessageId === parentId ||
                      message.id === parentId,
                  );
                  if (threadUpdates.length) {
                    setThreadMessages((current) =>
                      mergeChannelMessages(
                        current,
                        threadUpdates,
                        delta.removedMessageIds,
                      ),
                    );
                  }
                }
                return parentId;
              });
            }
            if (!delta.hasMore || delta.cursor <= requestedCursor) break;
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn("Channel delta refresh failed", error);
        }
      } finally {
        inFlight = false;
        if (pending && !stopped) {
          window.queueMicrotask(() => void sync());
        }
      }
    };

    const unsubscribe = transport.subscribe((notification) => {
      if (
        notification.topic === "channels" &&
        notification.cursor > cursor.current
      ) {
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
      if (blockedRetry !== null) window.clearTimeout(blockedRetry);
    };
  }, [
    activeChannelId,
    channelListReady,
    onChannelsChange,
    organizationId,
    recordProposalMessages,
    token,
  ]);

  useEffect(() => {
    if (
      activeChannelId &&
      channels.length > 0 &&
      !channels.some((channel) => channel.id === activeChannelId)
    ) {
      onChannelSelect(channels[0]?.id ?? null);
    }
  }, [activeChannelId, channels, onChannelSelect]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, activeChannelId, replies.length]);

  useEffect(() => {
    if (!threadParentId) return;
    threadMessagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [threadMessages, threadParentId]);

  const openThread = useCallback(
    async (parentId: string) => {
      if (!activeChannelId) return;
      invalidateChannelSurface(activeChannelId, parentId);
      const loadVersion = ++channelDataVersion.current;
      authoritativeLoadVersion.current = loadVersion;
      setThreadParentId(parentId);
      try {
        const result = await listChannelMessages(
          token,
          organizationId,
          activeChannelId,
          parentId,
        );
        if (loadVersion !== channelDataVersion.current) return;
        recordProposalMessages(result.messages);
        setThreadMessages((current) =>
          mergeChannelMessageSnapshot(current, result.messages));
      } catch (cause) {
        if (loadVersion === channelDataVersion.current) {
          setError(errorMessage(cause));
        }
      } finally {
        if (authoritativeLoadVersion.current === loadVersion) {
          authoritativeLoadVersion.current = null;
        }
      }
    },
    [
      activeChannelId,
      invalidateChannelSurface,
      organizationId,
      recordProposalMessages,
      token,
    ],
  );

  const send = useCallback(
    async (
      body: string,
      mentions: MentionTarget[],
      parentMessageId: string | null,
      attachments: File[],
      attachmentReferences: string[],
    ) => {
      if (!activeChannelId || !body.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const result = await sendChannelMessage(token, organizationId, activeChannelId, {
          body: body.trim(),
          parentMessageId,
          mentionedUserIds: mentions
            .filter((mention) => mention.type === "user")
            .map((mention) => mention.id),
          mentionedAgentIds: mentions
            .filter((mention) => mention.type === "agent")
            .map((mention) => mention.id),
          attachments,
          attachmentReferences,
        });
        setReplies((current) => [...current, ...result.agentReplies]);
        if (parentMessageId) {
          setMessages((current) =>
            current.map((message) =>
              message.id === parentMessageId
                ? appendChannelReplySummary(message, result.message)
                : message,
            ),
          );
          setThreadMessages((current) =>
            mergeChannelMessages(
              current.map((message) =>
                message.id === parentMessageId
                  ? appendChannelReplySummary(message, result.message)
                  : message,
              ),
              [result.message],
              [],
            ),
          );
        } else {
          setMessages((current) =>
            mergeChannelMessages(current, [result.message], []));
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [activeChannelId, organizationId, token],
  );

  const openIssue = useCallback(
    async (
      projectId: string,
      runId: string,
      context: ChannelSurfaceContext = captureChannelSurface(),
    ) => {
      try {
        await onIssueCreated?.(projectId, runId);
      } catch (cause) {
        if (channelSurfaceIsCurrent(context)) {
          setError(errorMessage(cause));
        }
      }
    },
    [captureChannelSurface, channelSurfaceIsCurrent, onIssueCreated],
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
    async (
      message: ChannelMessage,
      input: IssueExecutionApprovalInput,
    ) => {
      const proposal = message.executionProposal;
      if (
        !proposal ||
        proposal.status !== "pending" ||
        !activeChannelId ||
        activeChannelId !== message.channelId
      ) {
        throw new Error(t("executionApproval.targetUnavailable"));
      }
      const result = await acceptChannelExecutionProposal(
        token,
        organizationId,
        message.channelId,
        proposal.id,
        input,
      );
      return result.proposal;
    },
    [activeChannelId, organizationId, t, token],
  );

  const applyAcceptedExecutionProposal = useCallback(
    (messageId: string, proposal: ChannelExecutionProposal) => {
      const apply = (message: ChannelMessage): ChannelMessage =>
        message.id === messageId &&
        message.executionProposal?.id === proposal.id
          ? { ...message, executionProposal: proposal }
          : message;
      setMessages((current) => current.map(apply));
      setThreadMessages((current) => current.map(apply));
    },
    [],
  );

  const acceptSkillExecutionProposal = useCallback(
    async (
      message: ChannelMessage,
      input: AgentSkillExecutionApprovalInput,
    ) => {
      const proposal = message.skillExecutionProposal;
      if (
        !proposal ||
        proposal.status !== "pending" ||
        !activeChannelId ||
        activeChannelId !== message.channelId
      ) {
        throw new Error(t("skillExecution.approvalUnavailable"));
      }
      const result = await acceptChannelSkillExecutionProposal(
        token,
        organizationId,
        message.channelId,
        proposal,
        input,
      );
      onSkillSessionAccepted?.(result.session);
      return result.proposal;
    },
    [activeChannelId, onSkillSessionAccepted, organizationId, t, token],
  );

  const applyAcceptedSkillExecutionProposal = useCallback(
    (messageId: string, proposal: AgentSkillExecutionProposal) => {
      const apply = (message: ChannelMessage): ChannelMessage =>
        message.id === messageId &&
        message.skillExecutionProposal?.id === proposal.id
          ? { ...message, skillExecutionProposal: proposal }
          : message;
      setMessages((current) => current.map(apply));
      setThreadMessages((current) => current.map(apply));
    },
    [],
  );

  const refreshProposalState = useCallback(
    async (message: ChannelMessage, proposalId: string) => {
      if (!activeChannelId) return null;
      const loadVersion = ++channelDataVersion.current;
      authoritativeLoadVersion.current = loadVersion;
      try {
        if (message.parentMessageId) {
          const result = await listChannelMessages(
            token,
            organizationId,
            activeChannelId,
            message.parentMessageId,
          );
          if (loadVersion !== channelDataVersion.current) {
            return latestProposals.current.get(proposalId) ?? null;
          }
          recordProposalMessages(result.messages);
          setThreadMessages((current) =>
            mergeChannelMessageSnapshot(current, result.messages));
        } else {
          const result = await loadChannel(token, organizationId, activeChannelId);
          if (loadVersion !== channelDataVersion.current) {
            return latestProposals.current.get(proposalId) ?? null;
          }
          recordProposalMessages(result.messages);
          setMembers(result.members);
          setAgents(result.agents);
          setMessages((current) =>
            mergeChannelMessageSnapshot(current, result.messages));
          onChannelsChange((current) =>
            current.map((item) =>
              item.id === result.channel.id ? result.channel : item,
            ),
          );
        }
        return latestProposals.current.get(proposalId) ?? null;
      } finally {
        if (authoritativeLoadVersion.current === loadVersion) {
          authoritativeLoadVersion.current = null;
        }
      }
    },
    [
      activeChannelId,
      onChannelsChange,
      organizationId,
      recordProposalMessages,
      token,
    ],
  );

  const acceptProposal = useCallback(
    async (message: ChannelMessage) => {
      if (!activeChannelId || !message.proposal) return;
      const proposalId = message.proposal.id;
      const requestsExecution = channelIssueProposalRequestsExecution(
        message.proposal,
      );
      const projectId =
        message.proposal.projectId ??
        activeChannel?.defaultProjectId ??
        proposalProjects[proposalId] ??
        null;
      if (!projectId) return;
      const approvalChannelId = activeChannelId;
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
          activeChannelId,
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
                },
                executionProposal:
                  result.executionProposal ?? candidate.executionProposal,
              }
            : candidate;
        if (
          (proposalVersions.current.get(proposalId) ?? 0) ===
            approvalProposalVersion
        ) {
          setMessages((current) => current.map(applyResult));
          setThreadMessages((current) => current.map(applyResult));
          recordProposalMessages([applyResult(message)]);
          if (hasExecutionFollowUp) {
            if (!result.executionProposal) {
              await refreshProposalState(applyResult(message), proposalId);
            }
          }
        } else {
          let latest = latestProposals.current.get(proposalId);
          if (latest?.status !== "accepted") {
            latest =
              (await refreshProposalState(message, proposalId)) ?? undefined;
          }
          if (!approvalContextIsCurrent()) return;
          if (latest?.status === "accepted" && latest.projectId && latest.resultRunId) {
            if (hasExecutionFollowUp) {
              if (result.executionProposal) {
                setMessages((current) => current.map(applyResult));
                setThreadMessages((current) => current.map(applyResult));
                recordProposalMessages([applyResult(message)]);
              } else {
                await refreshProposalState(message, proposalId);
              }
            }
          } else if (
            latest?.status === "pending" &&
            latest.projectId === result.projectId
          ) {
            // A reservation delta can be visible before the same approval
            // transaction's accepted delta. The post-response refresh proves
            // it is still that exact reservation, so the successful response
            // is safe to apply without overwriting a reopen or transfer.
            setMessages((current) => current.map(applyResult));
            setThreadMessages((current) => current.map(applyResult));
            recordProposalMessages([applyResult(message)]);
            if (hasExecutionFollowUp) {
              if (!result.executionProposal) {
                await refreshProposalState(applyResult(message), proposalId);
              }
            }
          }
        }
      } catch (cause) {
        if (approvalContextIsCurrent()) {
          setError(errorMessage(cause));
        }
      } finally {
        if (approvalContextIsCurrent()) {
          setBusy(false);
          setAcceptingProposalId(null);
        }
      }
    },
    [
      activeChannel?.defaultProjectId,
      activeChannelId,
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
    async (message: ChannelMessage, emoji: string) => {
      if (!activeChannelId) return;
      setBusy(true);
      setError(null);
      try {
        const result = await toggleChannelMessageReaction(
          token,
          organizationId,
          activeChannelId,
          message.id,
          emoji,
        );
        const applyReactions = (candidate: ChannelMessage) =>
          candidate.id === result.message.id
            ? { ...candidate, reactions: result.message.reactions }
            : candidate;
        setMessages((current) => current.map(applyReactions));
        setThreadMessages((current) => current.map(applyReactions));
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [activeChannelId, organizationId, token],
  );

  const pendingReplies = replies.filter(
    (reply) =>
      reply.channelId === activeChannelId &&
      (reply.status === "queued" || reply.status === "running"),
  );

  const memberCount = Math.max(activeChannel?.memberCount ?? 0, members.length);
  let lastDay: string | null = null;

  return (
    <div
      className={`channels${isResizingThread ? " is-resizing-thread" : ""}`}
      ref={channelsRef}
      style={
        threadWidth === null
          ? undefined
          : ({
              "--channel-thread-width": `${threadWidth}%`,
            } as CSSProperties)
      }
    >
      <section className="channel-main">
        {activeChannel ? (
          <>
            <header className="channel-header">
              <div className="channel-header-title">
                {activeChannel.visibility === "private" ? (
                  <Lock size={16} aria-hidden="true" />
                ) : (
                  <Hash size={16} aria-hidden="true" />
                )}
                <h2>{activeChannel.name}</h2>
              </div>
              <div className="channel-header-actions">
                <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.webhooks")}
                  title={t("channel.webhooks")}
                  onClick={openWebhooks}
                >
                  <Webhook size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="channel-header-icon channel-header-members"
                  aria-label={t("channel.headerMembers", { count: memberCount })}
                  onClick={openInvite}
                >
                  <Users size={16} aria-hidden="true" />
                  <span>{memberCount}</span>
                </button>
                <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.headerHuddle")}
                  title={t("channel.headerHuddle")}
                >
                  <Headphones size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.headerMore")}
                  title={t("channel.headerMore")}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            {error ? <div className="channel-error">{error}</div> : null}

            <div className="channel-messages">
              <ChannelWelcome
                channel={activeChannel}
                onCreateAgent={onCreateAgent}
                onAddPeople={openInvite}
              />

              {messages.map((message) => {
                const currentDay = dayKey(message.createdAt, localeTag);
                const showDay = currentDay !== lastDay;
                lastDay = currentDay;
                return (
                  <div key={message.id} className="channel-message-block">
                    {showDay ? (
                      <div className="channel-day-separator">
                        <span>
                          {formatDayLabel(message.createdAt, localeTag, t)}
                        </span>
                      </div>
                    ) : null}
                    <MessageRow
                      agents={agents}
                      channel={activeChannel}
                      message={message}
                      members={members}
                      localeTag={localeTag}
                      currentUserId={currentUserId}
                      onAcceptProposal={() => void acceptProposal(message)}
                      loadExecutionProposalContext={() =>
                        loadExecutionProposalContext(message.executionProposal!)}
                      loadSkillExecutionProposalContext={() =>
                        loadSkillExecutionProposalContext(
                          message.skillExecutionProposal!,
                        )}
                      onAcceptExecutionProposal={(input) =>
                        acceptExecutionProposal(message, input)}
                      onExecutionProposalAccepted={(proposal) =>
                        applyAcceptedExecutionProposal(message.id, proposal)}
                      onAcceptSkillExecutionProposal={(input) =>
                        acceptSkillExecutionProposal(message, input)}
                      onSkillExecutionProposalAccepted={(proposal) =>
                        applyAcceptedSkillExecutionProposal(message.id, proposal)}
                      onIssueOpen={openIssue}
                      onOpenThread={() => void openThread(message.id)}
                      onProjectChange={(projectId) => {
                        const proposalId = message.proposal?.id;
                        if (!proposalId) return;
                        setProposalProjects((current) => ({
                          ...current,
                          [proposalId]: projectId,
                        }));
                      }}
                      onToggleReaction={(emoji) =>
                        void toggleReaction(message, emoji)
                      }
                      busy={busy}
                      acceptingProposal={
                        acceptingProposalId === message.proposal?.id
                      }
                      projects={projects}
                      selectedProjectId={
                        message.proposal
                          ? proposalProjects[message.proposal.id] ?? null
                          : null
                      }
                      token={token}
                      typingAgentNames={typingAgentNamesForMessage(
                        pendingReplies,
                        agents,
                        message.id,
                        t("channel.projectAgent"),
                      )}
                    />
                  </div>
                );
              })}

              {messages.length === 0 ? (
                <p className="channel-empty-hint muted">{t("channel.emptyHint")}</p>
              ) : null}

              <div ref={messagesEndRef} />
            </div>

            <Composer
              agents={agents}
              busy={busy}
              members={members}
              currentUserId={currentUserId}
              channelName={activeChannel.name}
              onInvite={openInvite}
              onSend={(body, mentions, attachments, references) =>
                void send(body, mentions, null, attachments, references)
              }
            />
          </>
        ) : (
          <p className="muted channel-empty">{t("channel.selectPrompt")}</p>
        )}
      </section>

      {threadParentId && activeChannel ? (
        <>
          <div
            aria-label={t("channel.resizeThread")}
            aria-orientation="vertical"
            aria-valuemax={channelThreadWidthMax}
            aria-valuemin={channelThreadWidthMin}
            aria-valuenow={effectiveThreadWidth}
            className="channel-thread-resizer"
            role="separator"
            tabIndex={0}
            {...threadResizeProps}
          />
          <aside className="channel-thread">
          <header>
            <span>
              <MessageSquare size={15} /> {t("channel.thread")}
            </span>
            <button
              aria-label={t("channel.closeThread")}
              onClick={() => {
                invalidateChannelSurface(activeChannel.id, null);
                setThreadParentId(null);
              }}
            >
              <X size={15} />
            </button>
          </header>
          <div className="channel-messages">
            {threadMessages.map((message) => (
              <MessageRow
                agents={agents}
                channel={activeChannel}
                key={message.id}
                message={message}
                members={members}
                localeTag={localeTag}
                currentUserId={currentUserId}
                onAcceptProposal={() => void acceptProposal(message)}
                loadExecutionProposalContext={() =>
                  loadExecutionProposalContext(message.executionProposal!)}
                loadSkillExecutionProposalContext={() =>
                  loadSkillExecutionProposalContext(
                    message.skillExecutionProposal!,
                  )}
                onAcceptExecutionProposal={(input) =>
                  acceptExecutionProposal(message, input)}
                onExecutionProposalAccepted={(proposal) =>
                  applyAcceptedExecutionProposal(message.id, proposal)}
                onAcceptSkillExecutionProposal={(input) =>
                  acceptSkillExecutionProposal(message, input)}
                onSkillExecutionProposalAccepted={(proposal) =>
                  applyAcceptedSkillExecutionProposal(message.id, proposal)}
                onIssueOpen={openIssue}
                onProjectChange={(projectId) => {
                  const proposalId = message.proposal?.id;
                  if (!proposalId) return;
                  setProposalProjects((current) => ({
                    ...current,
                    [proposalId]: projectId,
                  }));
                }}
                onToggleReaction={(emoji) =>
                  void toggleReaction(message, emoji)
                }
                busy={busy}
                acceptingProposal={
                  acceptingProposalId === message.proposal?.id
                }
                projects={projects}
                selectedProjectId={
                  message.proposal
                    ? proposalProjects[message.proposal.id] ?? null
                    : null
                }
                token={token}
                typingAgentNames={typingAgentNamesForMessage(
                  pendingReplies,
                  agents,
                  message.id,
                  t("channel.projectAgent"),
                )}
              />
            ))}
            <div ref={threadMessagesEndRef} />
          </div>
          <Composer
            agents={agents}
            busy={busy}
            members={members}
            currentUserId={currentUserId}
            channelName={activeChannel.name}
            onInvite={openInvite}
            placeholder={t("channel.threadPlaceholder")}
            onSend={(body, mentions, attachments, references) =>
              void send(
                body,
                mentions,
                threadParentId,
                attachments,
                references,
              )
            }
          />
          </aside>
        </>
      ) : null}

      {inviteOpen && activeChannel ? (
        <ChannelInviteDialog
          agents={inviteAgents}
          channel={activeChannel}
          channelAgents={agents}
          channelMembers={members}
          loading={inviteLoading}
          members={inviteMembers}
          saving={inviteSaving}
          error={inviteError}
          onAdd={(selected) => void addInvitees(selected)}
          onClose={() => {
            if (!inviteSaving) setInviteOpen(false);
          }}
        />
      ) : null}
      {webhooksOpen && activeChannel ? (
        <ChannelWebhooksDialog
          channel={activeChannel}
          error={webhooksError}
          loading={webhooksLoading}
          revealedUrl={revealedWebhookUrl}
          saving={webhooksSaving}
          webhooks={webhooks}
          onClose={() => {
            if (!webhooksSaving) setWebhooksOpen(false);
          }}
          onCreate={createWebhook}
          onRename={renameWebhook}
          onRevoke={revokeWebhook}
          onRotate={rotateWebhook}
        />
      ) : null}
    </div>
  );
}

function ChannelWelcome({
  channel,
  onCreateAgent,
  onAddPeople,
}: {
  channel: ChannelSummary;
  onCreateAgent?: () => void;
  onAddPeople?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="channel-welcome">
      <div className="channel-welcome-icon" aria-hidden="true">
        {channel.visibility === "private" ? <Lock size={28} /> : <Hash size={28} />}
      </div>
      <h3>
        {channel.visibility === "private" ? (
          <Lock size={18} aria-hidden="true" />
        ) : (
          <Hash size={18} aria-hidden="true" />
        )}
        {channel.name}
      </h3>
      <p className="channel-welcome-lead">
        {t("channel.welcomeLead", { name: channel.name })}
      </p>
      {channel.topic ? (
        <p className="channel-welcome-topic">{channel.topic}</p>
      ) : (
        <p className="channel-welcome-topic">{t("channel.welcomeDefaultTopic")}</p>
      )}

      <div className="channel-welcome-actions">
        <button
          type="button"
          className="channel-welcome-card"
          onClick={onCreateAgent}
          disabled={!onCreateAgent}
        >
          <span className="channel-welcome-card-icon" aria-hidden="true">
            <Bot size={20} />
          </span>
          <strong>{t("channel.createAgent")}</strong>
          <span>{t("channel.createAgentHint")}</span>
        </button>
        <button
          type="button"
          className="channel-welcome-card"
          onClick={onAddPeople}
          disabled={!onAddPeople}
        >
          <span className="channel-welcome-card-icon" aria-hidden="true">
            <UserPlus size={20} />
          </span>
          <strong>{t("channel.addPeople")}</strong>
          <span>{t("channel.addPeopleHint")}</span>
        </button>
      </div>
    </div>
  );
}

function ChannelWebhooksDialog({
  channel,
  error,
  loading,
  revealedUrl,
  saving,
  webhooks,
  onClose,
  onCreate,
  onRename,
  onRevoke,
  onRotate,
}: {
  channel: ChannelSummary;
  error: string | null;
  loading: boolean;
  revealedUrl: string | null;
  saving: boolean;
  webhooks: ChannelWebhook[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onRotate: (id: string) => Promise<void>;
}) {
  const { t, localeTag } = useI18n();
  const titleId = useId();
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  useEffect(() => setCopied(false), [revealedUrl]);

  const submit = async () => {
    const normalized = name.trim();
    if (!normalized) return;
    try {
      await onCreate(normalized);
      setName("");
    } catch {
      // The parent presents the request error and the input stays retryable.
    }
  };

  return (
    <div className="channel-invite-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="channel-invite-dialog channel-webhooks-dialog"
        role="dialog"
      >
        <header>
          <div>
            <h2 id={titleId}>{t("channel.webhooksTitle", { name: channel.name })}</h2>
            <p>{t("channel.webhooksDescription")}</p>
          </div>
          <button aria-label={t("common.close")} disabled={saving} onClick={onClose} type="button">
            <X size={20} />
          </button>
        </header>

        <div className="channel-webhook-create">
          <input
            aria-label={t("channel.webhookName")}
            disabled={loading || saving || Boolean(channel.archivedAt)}
            maxLength={100}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder={t("channel.webhookNamePlaceholder")}
            value={name}
          />
          <button
            disabled={!name.trim() || loading || saving || Boolean(channel.archivedAt)}
            onClick={() => void submit()}
            type="button"
          >
            <Webhook size={15} /> {t("channel.webhookCreate")}
          </button>
        </div>

        {revealedUrl ? (
          <div className="channel-webhook-secret">
            <strong>{t("channel.webhookUrlReady")}</strong>
            <p>{t("channel.webhookUrlWarning")}</p>
            <div>
              <code>{revealedUrl}</code>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(revealedUrl)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
                type="button"
              >
                <Copy size={14} /> {copied ? t("channel.webhookCopied") : t("channel.webhookCopy")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="channel-webhook-list">
          {loading ? (
            <p className="channel-invite-status"><LoaderCircle className="spin" size={16} />{t("channel.webhookLoading")}</p>
          ) : webhooks.length === 0 ? (
            <p className="channel-invite-status">{t("channel.webhookEmpty")}</p>
          ) : webhooks.map((webhook) => (
            <article className={`channel-webhook-row${webhook.active ? "" : " revoked"}`} key={webhook.id}>
              <Webhook aria-hidden="true" size={18} />
              <div>
                <input
                  aria-label={t("channel.webhookRename", { name: webhook.name })}
                  defaultValue={webhook.name}
                  disabled={!webhook.active || saving}
                  maxLength={100}
                  onBlur={(event) => {
                    const next = event.currentTarget.value.trim();
                    if (next && next !== webhook.name) void onRename(webhook.id, next);
                  }}
                />
                <small>{webhook.active
                  ? webhook.lastUsedAt
                    ? t("channel.webhookLastUsed", { date: new Date(webhook.lastUsedAt).toLocaleString(localeTag) })
                    : t("channel.webhookNeverUsed")
                  : t("channel.webhookRevoked")}</small>
              </div>
              {webhook.active ? (
                <span className="channel-webhook-actions">
                  <button
                    aria-label={t("channel.webhookRotate", { name: webhook.name })}
                    disabled={saving || Boolean(channel.archivedAt)}
                    onClick={() => {
                      if (window.confirm(t("channel.webhookRotateConfirm"))) void onRotate(webhook.id);
                    }}
                    type="button"
                  ><RefreshCw size={15} /></button>
                  <button
                    aria-label={t("channel.webhookRevoke", { name: webhook.name })}
                    disabled={saving}
                    onClick={() => {
                      if (window.confirm(t("channel.webhookRevokeConfirm"))) void onRevoke(webhook.id);
                    }}
                    type="button"
                  ><Trash2 size={15} /></button>
                </span>
              ) : null}
            </article>
          ))}
        </div>
        {error ? <p className="channel-invite-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function ChannelInviteDialog({
  agents,
  channel,
  channelAgents,
  channelMembers,
  error,
  loading,
  members,
  saving,
  onAdd,
  onClose,
}: {
  agents: ChannelAgentSummary[];
  channel: ChannelSummary;
  channelAgents: ChannelAgentSummary[];
  channelMembers: ChannelMember[];
  error: string | null;
  loading: boolean;
  members: OrganizationMember[];
  saving: boolean;
  onAdd: (selected: ChannelInviteCandidate[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  const candidates = useMemo<ChannelInviteCandidate[]>(() => {
    const channelMemberIds = new Set(
      channelMembers.map((member) => member.userId),
    );
    const channelAgentIds = new Set(
      channelAgents.map((agent) => agent.agentId),
    );
    return [
      ...members
        .filter((member) => !channelMemberIds.has(member.userId))
        .map((member) => ({
          type: "user" as const,
          id: member.userId,
          member,
        })),
      ...agents
        .filter((agent) => !channelAgentIds.has(agent.agentId))
        .map((agent) => ({
          type: "agent" as const,
          id: agent.agentId,
          agent,
        })),
    ];
  }, [agents, channelAgents, channelMembers, members]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = candidates.filter((candidate) => {
    if (!normalizedQuery) return true;
    const searchable =
      candidate.type === "user"
        ? `${candidate.member.name} ${candidate.member.email}`
        : `${candidate.agent.name} ${candidate.agent.projectName ?? ""} ${candidate.agent.provider} ${candidate.agent.responsibility} ${candidate.agent.skills.map((skill) => skill.name).join(" ")}`;
    return searchable.toLowerCase().includes(normalizedQuery);
  });

  const toggle = (candidate: ChannelInviteCandidate) => {
    const key = `${candidate.type}:${candidate.id}`;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selected = candidates.filter((candidate) =>
    selectedKeys.has(`${candidate.type}:${candidate.id}`),
  );

  return (
    <div
      className="channel-invite-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="channel-invite-dialog"
        role="dialog"
      >
        <header>
          <div>
            <h2 id={titleId}>
              {t("channel.inviteTitle", { name: channel.name })}
            </h2>
            <p>{t("channel.inviteDescription")}</p>
          </div>
          <button
            aria-label={t("common.close")}
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </header>

        <label className="channel-invite-search">
          <Search aria-hidden="true" size={17} />
          <input
            autoFocus
            disabled={loading || saving}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("channel.inviteSearchPlaceholder")}
            type="search"
            value={query}
          />
        </label>

        <div className="channel-invite-results">
          {loading ? (
            <p className="channel-invite-status">
              <LoaderCircle className="spin" size={16} />
              {t("channel.inviteLoading")}
            </p>
          ) : filtered.length > 0 ? (
            filtered.map((candidate) => {
              const key = `${candidate.type}:${candidate.id}`;
              const checked = selectedKeys.has(key);
              const name =
                candidate.type === "user"
                  ? candidate.member.name
                  : candidate.agent.name;
              const detail =
                candidate.type === "user"
                  ? candidate.member.email
                  : candidate.agent.projectId
                    ? candidate.agent.projectName
                      ? `${t("channel.projectAgent")} · ${candidate.agent.projectName}`
                      : t("channel.projectAgent")
                    : t("channel.orgAgent");
              const image =
                candidate.type === "user"
                  ? candidate.member.image
                  : candidate.agent.avatar;
              return (
                <button
                  aria-pressed={checked}
                  className="channel-invite-candidate"
                  disabled={saving}
                  key={key}
                  onClick={() => toggle(candidate)}
                  type="button"
                >
                  <span className={`channel-invite-avatar ${candidate.type}`}>
                    {image ? (
                      <img alt="" src={image} />
                    ) : candidate.type === "agent" ? (
                      <Bot aria-hidden="true" size={18} />
                    ) : (
                      authorInitial(name)
                    )}
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>{detail}</small>
                  </span>
                  <i aria-hidden="true">{checked ? <Check size={15} /> : null}</i>
                </button>
              );
            })
          ) : (
            <p className="channel-invite-status">
              {candidates.length === 0
                ? t("channel.inviteEveryoneAdded")
                : t("channel.inviteNoResults")}
            </p>
          )}
        </div>

        {error ? (
          <p className="channel-invite-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer>
          <span>
            {selected.length > 0
              ? t("channel.inviteSelected", { count: selected.length })
              : t("channel.inviteSelectHint")}
          </span>
          <button
            disabled={selected.length === 0 || loading || saving}
            onClick={() => onAdd(selected)}
            type="button"
          >
            {saving ? t("channel.inviting") : t("channel.inviteAdd")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MessageRow({
  acceptingProposal,
  agents,
  channel,
  loadExecutionProposalContext,
  loadSkillExecutionProposalContext,
  message,
  members,
  localeTag,
  currentUserId,
  onOpenThread,
  onAcceptProposal,
  onAcceptExecutionProposal,
  onAcceptSkillExecutionProposal,
  onExecutionProposalAccepted,
  onSkillExecutionProposalAccepted,
  onIssueOpen,
  onProjectChange,
  onToggleReaction,
  busy,
  projects,
  selectedProjectId,
  token,
  typingAgentNames,
}: {
  acceptingProposal: boolean;
  agents: ChannelAgentSummary[];
  channel: ChannelSummary;
  loadExecutionProposalContext: () => Promise<{
    run: HuntRun | null;
    workers: ExecutionWorker[];
    policy?: ProjectExecutionWorkerPolicy;
  }>;
  loadSkillExecutionProposalContext: () => Promise<{
    workers: ExecutionWorker[];
    policy?: ProjectExecutionWorkerPolicy;
  }>;
  message: ChannelMessage;
  members: ChannelMember[];
  localeTag: string;
  currentUserId: string | null;
  onOpenThread?: () => void;
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
  onProjectChange: (projectId: string) => void;
  onToggleReaction: (emoji: string) => void;
  busy: boolean;
  projects: readonly Pick<Project, "id" | "name" | "organizationId">[];
  selectedProjectId: string | null;
  token: string;
  typingAgentNames: string[];
}) {
  const { t } = useI18n();
  const [reacting, setReacting] = useState(false);
  const isAgent = message.author.type === "agent";
  const isWebhook = message.author.type === "webhook";
  const isSelf =
    message.author.type === "user" && message.author.id === currentUserId;
  const displayName = isSelf ? t("channel.you") : message.author.name;
  const image =
    message.author.type === "user" || message.author.type === "agent"
      ? message.author.image
      : null;
  const issueProposal = message.proposal?.actionType === "request_issue_create"
    ? message.proposal
    : null;
  const availableProjects = projects.filter(
    (project) =>
      !project.organizationId || project.organizationId === channel.organizationId,
  );
  const proposalProjectId =
    issueProposal?.projectId ?? channel.defaultProjectId ?? selectedProjectId;
  const proposalProjectName = proposalProjectId
    ? availableProjects.find((project) => project.id === proposalProjectId)?.name ??
      proposalProjectId
    : null;
  const needsProject =
    issueProposal?.status === "pending" && !issueProposal.projectId &&
    !channel.defaultProjectId;
  const proposalIssue = channelIssueProposalDetails(issueProposal);
  const executionProjectName = message.executionProposal
    ? availableProjects.find(
        (project) => project.id === message.executionProposal?.projectId,
      )?.name ?? message.executionProposal.projectId
    : null;

  return (
    <article
      className={`channel-message ${message.author.type}${reacting ? " is-reacting" : ""}`}
      data-channel-message-id={message.id}
    >
      <div className="channel-message-avatar" aria-hidden="true">
        {image ? (
          <img alt="" src={image} />
        ) : isAgent ? (
          <span className="channel-message-avatar-fallback agent">
            <Bot size={16} />
          </span>
        ) : isWebhook ? (
          <span className="channel-message-avatar-fallback webhook">
            <Webhook size={16} />
          </span>
        ) : (
          <span className="channel-message-avatar-fallback">
            {authorInitial(message.author.name)}
          </span>
        )}
      </div>
      <div className="channel-message-body">
        <header>
          <strong>{displayName}</strong>
          {message.author.type === "agent" ? (
            <span className="channel-agent-badge">
              <Bot size={12} /> {message.author.provider ?? "agent"}
            </span>
          ) : message.author.type === "webhook" ? (
            <span className="channel-agent-badge webhook">
              <Webhook size={12} /> {t("channel.webhookBadge")}
            </span>
          ) : null}
          <time dateTime={message.createdAt}>
            {formatMessageTime(message.createdAt, localeTag)}
          </time>
        </header>
        <ChannelMessageText agents={agents} members={members} message={message} />
        {typingAgentNames.map((name) => (
          <div className="channel-typing" key={name}>
            <LoaderCircle className="spin" size={15} />
            {t("channel.namedAgentTyping", { name })}
          </div>
        ))}
        <ChannelMessageImages attachments={message.attachments} token={token} />

        {message.document ? (
          <div className="channel-document-card">
            <FileText size={15} />
            <div>
              <strong>{message.document.title}</strong>
              <span>
                {t("channel.planDocument")}
                {message.document.projectId ? "" : ` · ${t("channel.orgDocument")}`}
              </span>
            </div>
          </div>
        ) : null}

        {issueProposal ? (
          <div className="channel-proposal-card">
            <div className="channel-proposal-copy">
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
                {availableProjects.map((project) => (
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
            ) : issueProposal.projectId &&
              issueProposal.resultRunId &&
              onIssueOpen ? (
              <button
                className="channel-proposal-view-button"
                onClick={() => {
                  void onIssueOpen(
                    issueProposal.projectId!,
                    issueProposal.resultRunId!,
                  );
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
          busy={busy}
          currentUserId={currentUserId}
          message={message}
          onOpenThread={onOpenThread}
          onReactingChange={setReacting}
          onToggle={onToggleReaction}
          showHoverActions
        />

        {onOpenThread && message.replyCount > 0 ? (
          <ConversationReplySummary
            countLabel={t("channel.replyCount", {
              count: message.replyCount,
            })}
            lastReplyLabel={message.lastReplyAt
              ? t("conversation.lastReply", {
                  time: replyRelativeTime(message.lastReplyAt, t),
                })
              : null}
            onClick={onOpenThread}
            participants={channelReplyParticipants(message)}
          />
        ) : null}
      </div>
    </article>
  );
}

function Composer({
  agents,
  members,
  currentUserId,
  channelName,
  placeholder,
  busy,
  onInvite,
  onSend,
}: {
  agents: ChannelAgentSummary[];
  members: ChannelMember[];
  currentUserId: string | null;
  channelName: string;
  placeholder?: string;
  busy: boolean;
  onInvite: () => void;
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
    inputRef: textareaRef,
    insertAtCaret,
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
    onInvite,
    onSend,
    submitOnEnter: true,
  });

  const resolvedPlaceholder =
    placeholder ?? t("channel.messagePlaceholder", { name: channelName });
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
        className={`channel-composer${dragging ? " is-dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onSubmit={handleSubmit}
      >
      {showsSuggestions ? (
        <ChannelMentionMenu
          activeSuggestionIndex={activeSuggestionIndex}
          ariaLabel={t("channel.mentionCandidates")}
          id={mentionListId}
          onActiveSuggestionIndexChange={setActiveSuggestionIndex}
          onPickSuggestion={pickSuggestion}
          suggestions={suggestions}
          variant="desktop"
        />
      ) : null}

      <div className="channel-composer-shell">
        <ChannelDraftImages images={images} onRemove={removeImage} />
        <MentionComposerField
          body={body}
          className="channel-composer-field"
          controlRef={textareaRef}
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
            aria-label={t("channel.messageAria")}
            disabled={busy}
            placeholder={resolvedPlaceholder}
            value={body}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleCaret}
            onPaste={handlePaste}
            onClick={handleCaret}
            ref={textareaRef}
            role="combobox"
            rows={1}
          />
        </MentionComposerField>
        <div className="channel-composer-toolbar">
          <div className="channel-composer-tools">
            <button
              type="button"
              className="channel-composer-tool"
              aria-label={t("channel.toolMention")}
              onClick={() => insertAtCaret("@")}
              disabled={busy}
            >
              <AtSign size={16} />
            </button>
            <button
              type="button"
              className="channel-composer-tool"
              aria-label={t("channel.toolAttach")}
              disabled={busy || images.length >= maxIssueAttachmentCount}
              onClick={() => attachmentInputRef.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <input
              accept="image/*"
              className="channel-composer-file-input"
              disabled={busy || images.length >= maxIssueAttachmentCount}
              multiple
              onChange={handleFileChange}
              ref={attachmentInputRef}
              type="file"
            />
            <button
              type="button"
              className="channel-composer-tool"
              aria-label={t("channel.toolFormat")}
              disabled
              title={t("channel.toolComingSoon")}
            >
              <Type size={16} />
            </button>
          </div>
          <button
            aria-label={t("channel.send")}
            className="channel-composer-send"
            disabled={busy || (!body.trim() && images.length === 0)}
            type="submit"
          >
            <Send size={16} />
          </button>
        </div>
        {attachmentError ? (
          <p className="channel-composer-error">{attachmentError}</p>
        ) : null}
      </div>
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

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
