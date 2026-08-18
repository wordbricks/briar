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
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { LoadingState } from "@/components/ui/loading-state";
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
  updateChannel,
  updateChannelThreadSubscription,
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
import {
  applyChannelThreadSubscribers,
  type ChannelAgentReply,
  type ChannelAgentSummary,
  type ChannelMember,
  type ChannelMessage,
  type ChannelExecutionProposal,
  type ChannelSummary,
  type ChannelWebhook,
} from "../lib/channels-contract";
import {
  channelHasUnread,
  laterTimestamp,
  markChannelCatalogRead,
} from "../lib/channel-unread";
import type { MentionTarget } from "../lib/channel-mentions";
import { agentProviderLabels } from "../lib/agent-provider-contract";
import {
  mergeChannelMessages,
  mergeChannelMessageSnapshot,
} from "../lib/channel-message-merge";
import { channelReplyErrorText } from "../lib/channel-reply-error";
import { maxIssueAttachmentCount } from "../lib/issue-attachments";
import {
  ChannelDraftImages,
  ChannelMessageImages,
} from "./ChannelImages";
import { ChannelMentionMenu } from "./ChannelMentionMenu";
import { ChannelTypingState } from "./ChannelTypingState";
import { MentionComposerField } from "./MentionComposerField";
import { AgentProviderIcon } from "./AgentIcons";
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
import { ChannelThreadSubscribeControls } from "./ChannelThreadSubscribeControls";
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
import {
  scrollContainerToEnd,
  scrollElementToCenter,
} from "../lib/scroll-container";
import {
  recordDesktopChannelFirstMessage,
  recordDesktopChannelHeader,
  type DesktopChannelDisplaySource,
} from "../lib/channel-performance";
import { currentExecutionWorkerDeviceId } from "../lib/execution-worker-device";
import {
  createOptimisticChannelMessage,
  removeOptimisticChannelMessage,
} from "../lib/optimistic-channel-message";
import { useChannelAgentActivity } from "../hooks/use-channel-agent-activity";
import type {
  ChannelAgentActivityDescriptor,
  ChannelAgentActivityFrame,
} from "../lib/channel-agent-activity";

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

const typingAgentNamesForMessages = (
  replies: ChannelAgentReply[],
  agents: ChannelAgentSummary[],
  messageIds: readonly string[],
  fallbackName: string,
) => {
  const messageIdSet = new Set(messageIds);
  return [
    ...new Set(
      replies
        .filter((reply) => messageIdSet.has(reply.parentMessageId))
        .map(
          (reply) =>
            agents.find((agent) => agent.agentId === reply.agentId)?.name ??
            fallbackName,
        ),
    ),
  ];
};

const activityByAgentNameForReplies = (
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

type ChannelsProps = {
  organizationId: string;
  organizationName?: string;
  token: string;
  currentUserId: string | null;
  channels: ChannelSummary[];
  projects?: readonly Pick<Project, "id" | "name" | "organizationId">[];
  activeChannelId: string | null;
  channelCatalogCursor?: number | null;
  onChannelSelect: (channelId: string | null) => void;
  onChannelsChange: Dispatch<SetStateAction<ChannelSummary[]>>;
  channelInboxSyncSignal?: string;
  onIssueCreated?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  onViewingChannelChange?: (channelId: string | null) => void;
  initialInviteChannelId?: string | null;
  onInitialInviteHandled?: (channelId: string) => void;
  onCreateAgent?: () => void;
  inboxDetail?: boolean;
  onInboxDetailClose?: () => void;
  requestedMessage?: {
    channelId: string;
    messageId: string;
    rootMessageId: string;
  } | null;
  onRequestedMessageOpen?: () => void;
};

type CachedDesktopChannel = {
  channel: ChannelSummary;
  members: ChannelMember[];
  agents: ChannelAgentSummary[];
  messages: ChannelMessage[];
  nextCursor: string | null;
};

const desktopChannelMessagePageSize = 20;
const desktopChannelVirtualizationThreshold = 40;
const desktopChannelEstimatedMessageHeight = 112;
const desktopChannelVirtualOverscan = 6;

type ChannelInviteCandidate =
  | { type: "user"; id: string; member: OrganizationMember }
  | { type: "agent"; id: string; agent: ChannelAgentSummary };

type ChannelInviteMode = "all" | "specific";

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
  organizationName = "",
  token,
  currentUserId,
  channels,
  projects = [],
  activeChannelId,
  channelCatalogCursor,
  onChannelSelect,
  onChannelsChange,
  channelInboxSyncSignal,
  onIssueCreated,
  onSkillSessionAccepted,
  onViewingChannelChange,
  initialInviteChannelId = null,
  onInitialInviteHandled,
  requestedMessage,
  onRequestedMessageOpen,
  inboxDetail = false,
  onInboxDetailClose,
  onCreateAgent,
}: ChannelsProps) {
  const { t, localeTag } = useI18n();
  useEffect(() => {
    onViewingChannelChange?.(activeChannelId);
    return () => onViewingChannelChange?.(null);
  }, [activeChannelId, onViewingChannelChange]);
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
  const [messageNextCursor, setMessageNextCursor] = useState<string | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [loadingEarlierMessages, setLoadingEarlierMessages] = useState(false);
  const [replies, setReplies] = useState<ChannelAgentReply[]>([]);
  const liveActivity = useChannelAgentActivity(
    token,
    organizationId,
    activeChannelId,
  );
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([]);
  const [threadSubscriptionPending, setThreadSubscriptionPending] = useState(false);
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
  const [inviteIsInitial, setInviteIsInitial] = useState(false);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
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
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const threadMessagesScrollRef = useRef<HTMLDivElement | null>(null);
  const optimisticThreadMessageIds = useRef(new Set<string>());
  const initialInviteHandledChannelId = useRef<string | null>(null);
  const activeChannelIdRef = useRef(activeChannelId);
  const channelCache = useRef(new Map<string, CachedDesktopChannel>());
  const channelLoadAbortController = useRef<AbortController | null>(null);
  const preparedChannelId = useRef<string | null>(null);
  const loadingEarlierMessagesRef = useRef(false);
  const shouldScrollChannelToEnd = useRef(false);
  const suppressEarlierLoadOnNextScroll = useRef(false);
  const displaySource = useRef<DesktopChannelDisplaySource>("network");
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

  const updateRootMessages = useCallback(
    (update: (current: ChannelMessage[]) => ChannelMessage[]) => {
      setMessages((current) => {
        const next = update(current);
        const channelId = activeChannelIdRef.current;
        if (channelId) {
          const cached = channelCache.current.get(channelId);
          if (cached) {
            channelCache.current.set(channelId, { ...cached, messages: next });
          }
        }
        return next;
      });
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
  const showRequestedThreadOnly = Boolean(
    inboxDetail &&
      requestedMessage &&
      requestedMessage.rootMessageId !== requestedMessage.messageId,
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

  const openInvite = useCallback((initial = false) => {
    if (!activeChannelId) return;
    setInviteOpen(true);
    setInviteIsInitial(initial);
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

  useEffect(() => {
    if (
      !initialInviteChannelId ||
      initialInviteChannelId !== activeChannelId ||
      !activeChannel ||
      !channelListReady ||
      channelLoading ||
      initialInviteHandledChannelId.current === initialInviteChannelId
    ) {
      return;
    }
    initialInviteHandledChannelId.current = initialInviteChannelId;
    openInvite(true);
    onInitialInviteHandled?.(initialInviteChannelId);
  }, [
    activeChannel,
    activeChannelId,
    channelListReady,
    channelLoading,
    initialInviteChannelId,
    onInitialInviteHandled,
    openInvite,
  ]);

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

  const openSettings = useCallback(() => {
    if (!activeChannelId) return;
    setSettingsError(null);
    setSettingsOpen(true);
  }, [activeChannelId]);

  const saveChannelSettings = useCallback(
    async (input: { name?: string; defaultProjectId?: string | null }) => {
      if (!activeChannelId) return;
      setSettingsSaving(true);
      setSettingsError(null);
      try {
        const result = await updateChannel(
          token,
          organizationId,
          activeChannelId,
          input,
        );
        onChannelsChange((current) =>
          current.map((channel) =>
            channel.id === result.channel.id ? result.channel : channel,
          ),
        );
        const cached = channelCache.current.get(activeChannelId);
        if (cached) {
          channelCache.current.set(activeChannelId, {
            ...cached,
            channel: result.channel,
          });
        }
      } catch (cause) {
        setSettingsError(errorMessage(cause));
      } finally {
        setSettingsSaving(false);
      }
    },
    [activeChannelId, onChannelsChange, organizationId, token],
  );

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
      if (!activeChannelId) return;
      if (selected.length === 0) {
        setInviteOpen(false);
        setInviteIsInitial(false);
        return;
      }
      setInviteSaving(true);
      setInviteError(null);
      const refreshRoster = async () => {
        const refreshed = await loadChannel(
          token,
          organizationId,
          activeChannelId,
          { messageLimit: 1 },
        );
        setMembers(refreshed.members);
        setAgents(refreshed.agents);
        const cached = channelCache.current.get(activeChannelId);
        if (cached) {
          channelCache.current.set(activeChannelId, {
            ...cached,
            channel: refreshed.channel,
            members: refreshed.members,
            agents: refreshed.agents,
          });
        }
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
        setInviteIsInitial(false);
      } finally {
        setInviteSaving(false);
      }
    },
    [activeChannelId, onChannelsChange, organizationId, token],
  );

  useEffect(() => {
    if (channelCatalogCursor !== undefined) {
      cursor.current = channelCatalogCursor ?? 0;
      setChannelListReady(channelCatalogCursor !== null);
      return;
    }
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
  }, [
    channelCatalogCursor,
    onChannelSelect,
    onChannelsChange,
    organizationId,
    token,
  ]);

  useEffect(() => {
    channelCache.current.clear();
    preparedChannelId.current = null;
  }, [organizationId, token]);

  useLayoutEffect(() => {
    if (!activeChannelId || !channelListReady) return;
    recordDesktopChannelHeader(activeChannelId);
    if (preparedChannelId.current === activeChannelId) return;
    preparedChannelId.current = activeChannelId;
    channelLoadAbortController.current?.abort();
    const cached = channelCache.current.get(activeChannelId) ?? null;
    displaySource.current = cached ? "cache" : "network";
    shouldScrollChannelToEnd.current = true;
    setMembers(cached?.members ?? []);
    setAgents(cached?.agents ?? []);
    setMessages(cached?.messages ?? []);
    setMessageNextCursor(cached?.nextCursor ?? null);
    setChannelLoading(!cached);
    setLoadingEarlierMessages(false);
    loadingEarlierMessagesRef.current = false;
    setProposalProjects({});
    setThreadParentId(null);
    setThreadMessages([]);
    setReplies([]);
    setError(null);
  }, [activeChannelId, channelListReady]);

  useEffect(() => {
    if (!activeChannelId || !channelListReady) return;
    let cancelled = false;
    const abortController = new AbortController();
    channelLoadAbortController.current?.abort();
    channelLoadAbortController.current = abortController;
    const loadVersion = ++channelDataVersion.current;
    authoritativeLoadVersion.current = loadVersion;
    void (async () => {
      try {
        const cached = channelCache.current.get(activeChannelId) ?? null;
        const result = await loadChannel(token, organizationId, activeChannelId, {
          messageLimit: desktopChannelMessagePageSize,
          signal: abortController.signal,
        });
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
        setReplies(result.agentReplies ?? []);
        recordProposalMessages(result.messages);
        const nextCursor = cached && cached.messages.length > result.messages.length
          ? cached.nextCursor
          : result.nextCursor ?? null;
        if (!cached) {
          displaySource.current = result.messages.length > 0 ? "network" : "empty";
        }
        setMessages((current) => {
          const nextMessages = cached
            ? mergeChannelMessages(current, result.messages, [])
            : result.messages;
          channelCache.current.set(activeChannelId, {
            channel: result.channel,
            members: result.members,
            agents: result.agents,
            messages: nextMessages,
            nextCursor,
          });
          return nextMessages;
        });
        setMessageNextCursor(nextCursor);
        shouldScrollChannelToEnd.current = true;
        const target = requestedMessage?.channelId === activeChannelId
          ? requestedMessage
          : null;
        if (target && target.rootMessageId !== target.messageId) {
          const threadResult = await listChannelMessages(
            token,
            organizationId,
            activeChannelId,
            target.rootMessageId,
            { signal: abortController.signal },
          );
          if (cancelled || loadVersion !== channelDataVersion.current) return;
          recordProposalMessages(threadResult.messages);
          setThreadParentId(target.rootMessageId);
          setThreadMessages((current) =>
            mergeChannelMessageSnapshot(current, threadResult.messages));
        } else if (target) {
          setThreadParentId(null);
          setThreadMessages([]);
          if (
            !result.messages.some((message) => message.id === target.messageId)
          ) {
            const requestedRoot = await listChannelMessages(
              token,
              organizationId,
              activeChannelId,
              target.rootMessageId,
              { signal: abortController.signal },
            );
            if (cancelled || loadVersion !== channelDataVersion.current) return;
            const roots = requestedRoot.messages.filter(
              (message) => message.parentMessageId === null,
            );
            recordProposalMessages(roots);
            setMessages((current) => {
              const next = mergeChannelMessages(current, roots, []);
              const cachedChannel = channelCache.current.get(activeChannelId);
              if (cachedChannel) {
                channelCache.current.set(activeChannelId, {
                  ...cachedChannel,
                  messages: next,
                });
              }
              return next;
            });
          }
        }
        if (target) {
          window.requestAnimationFrame(() => {
            const messageScroller =
              target.rootMessageId === target.messageId
                ? messagesScrollRef.current
                : threadMessagesScrollRef.current;
            const findTarget = () => [
              ...(messageScroller?.querySelectorAll<HTMLElement>(
                "[data-channel-message-id]",
              ) ?? []),
            ].find(
              (element) => element.dataset.channelMessageId === target.messageId,
            ) ?? null;
            const requestedMessageElement = findTarget();
            if (
              !requestedMessageElement &&
              target.rootMessageId === target.messageId &&
              messageScroller
            ) {
              const targetIndex = channelCache.current
                .get(activeChannelId)
                ?.messages.findIndex((message) => message.id === target.messageId) ?? -1;
              if (targetIndex >= 0) {
                messageScroller.scrollTop = targetIndex *
                  desktopChannelEstimatedMessageHeight;
                suppressEarlierLoadOnNextScroll.current = true;
                messageScroller.dispatchEvent(new Event("scroll"));
                window.requestAnimationFrame(() => {
                  scrollElementToCenter(messageScroller, findTarget());
                  onRequestedMessageOpen?.();
                });
                return;
              }
            }
            scrollElementToCenter(messageScroller, requestedMessageElement);
            onRequestedMessageOpen?.();
          });
        }
      } catch (cause) {
        if (
          !abortController.signal.aborted &&
          !cancelled &&
          loadVersion === channelDataVersion.current
        ) {
          setError(errorMessage(cause));
        }
      } finally {
        if (!cancelled && loadVersion === channelDataVersion.current) {
          setChannelLoading(false);
        }
        if (authoritativeLoadVersion.current === loadVersion) {
          authoritativeLoadVersion.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
      abortController.abort();
      if (loadVersion === channelDataVersion.current) {
        channelDataVersion.current += 1;
      }
      if (authoritativeLoadVersion.current === loadVersion) {
        authoritativeLoadVersion.current = null;
      }
      if (channelLoadAbortController.current === abortController) {
        channelLoadAbortController.current = null;
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
              const failed = delta.agentReplies.find(
                (reply) =>
                  reply.channelId === activeChannelId &&
                  reply.status === "failed",
              );
              if (failed) {
                setError(
                  t("run.briarReplyFailed", {
                    error: channelReplyErrorText(failed.error, {
                      fallback: t("run.failed"),
                      noAvailableWorker: t("agents.agentWorkerUnavailable"),
                    }),
                  }),
                );
              }
            }
            const relevant = delta.messages.filter(
              (message) => message.channelId === activeChannelId,
            );
            if (relevant.length || delta.removedMessageIds.length) {
              recordProposalMessages(relevant);
              const rootUpdates = relevant.filter(
                (message) => message.parentMessageId === null,
              );
              const scroller = messagesScrollRef.current;
              if (
                rootUpdates.length > 0 &&
                scroller &&
                scroller.scrollHeight - scroller.scrollTop -
                    scroller.clientHeight <= 80
              ) {
                shouldScrollChannelToEnd.current = true;
              }
              setMessages((current) => {
                const next = mergeChannelMessages(
                  current,
                  rootUpdates,
                  delta.removedMessageIds,
                );
                if (activeChannelId) {
                  const cached = channelCache.current.get(activeChannelId);
                  if (cached) {
                    channelCache.current.set(activeChannelId, {
                      ...cached,
                      messages: next,
                    });
                  }
                }
                return next;
              });
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
    if (channelInboxSyncSignal !== undefined && !document.hidden) {
      void sync();
    }
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
    channelInboxSyncSignal,
    channelListReady,
    onChannelsChange,
    organizationId,
    recordProposalMessages,
    t,
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

  const loadEarlierChannelMessages = useCallback(async () => {
    if (
      !activeChannelId ||
      threadParentIdRef.current ||
      !messageNextCursor ||
      loadingEarlierMessagesRef.current
    ) return;
    const context = captureChannelSurface();
    const scroller = messagesScrollRef.current;
    const previousScrollHeight = scroller?.scrollHeight ?? 0;
    const previousScrollTop = scroller?.scrollTop ?? 0;
    const abortController = new AbortController();
    channelLoadAbortController.current?.abort();
    channelLoadAbortController.current = abortController;
    loadingEarlierMessagesRef.current = true;
    setLoadingEarlierMessages(true);
    try {
      const result = await listChannelMessages(
        token,
        organizationId,
        activeChannelId,
        undefined,
        {
          limit: desktopChannelMessagePageSize,
          cursor: messageNextCursor,
          signal: abortController.signal,
        },
      );
      if (!channelSurfaceIsCurrent(context)) return;
      recordProposalMessages(result.messages);
      setMessages((current) => {
        const next = mergeChannelMessages(current, result.messages, []);
        const cached = channelCache.current.get(activeChannelId);
        if (cached) {
          channelCache.current.set(activeChannelId, {
            ...cached,
            messages: next,
            nextCursor: result.nextCursor ?? null,
          });
        }
        return next;
      });
      setMessageNextCursor(result.nextCursor ?? null);
      window.requestAnimationFrame(() => {
        if (!channelSurfaceIsCurrent(context) || !scroller) return;
        scroller.scrollTop = previousScrollTop +
          (scroller.scrollHeight - previousScrollHeight);
        suppressEarlierLoadOnNextScroll.current = true;
        scroller.dispatchEvent(new Event("scroll"));
      });
    } catch (cause) {
      if (!abortController.signal.aborted && channelSurfaceIsCurrent(context)) {
        setError(errorMessage(cause));
      }
    } finally {
      if (channelLoadAbortController.current === abortController) {
        channelLoadAbortController.current = null;
      }
      loadingEarlierMessagesRef.current = false;
      if (channelSurfaceIsCurrent(context)) setLoadingEarlierMessages(false);
    }
  }, [
    activeChannelId,
    captureChannelSurface,
    channelSurfaceIsCurrent,
    messageNextCursor,
    organizationId,
    recordProposalMessages,
    token,
  ]);

  useLayoutEffect(() => {
    if (!activeChannelId || channelLoading) return;
    const cached = channelCache.current.get(activeChannelId);
    if (!cached) return;
    if (shouldScrollChannelToEnd.current) {
      scrollContainerToEnd(messagesScrollRef.current);
      suppressEarlierLoadOnNextScroll.current = true;
      messagesScrollRef.current?.dispatchEvent(new Event("scroll"));
      shouldScrollChannelToEnd.current = false;
    }
    recordDesktopChannelFirstMessage(activeChannelId, displaySource.current);
  }, [activeChannelId, channelLoading, messages]);

  useEffect(() => {
    if (!threadParentId) return;
    scrollContainerToEnd(threadMessagesScrollRef.current);
  }, [threadMessages, threadParentId]);

  useEffect(() => {
    for (const message of threadMessages) {
      if (!message.optimistic) {
        optimisticThreadMessageIds.current.delete(message.id);
      }
    }
  }, [threadMessages]);

  const openThread = useCallback(
    async (parentId: string) => {
      if (!activeChannelId) return;
      invalidateChannelSurface(activeChannelId, parentId);
      const loadVersion = ++channelDataVersion.current;
      authoritativeLoadVersion.current = loadVersion;
      const abortController = new AbortController();
      channelLoadAbortController.current?.abort();
      channelLoadAbortController.current = abortController;
      setThreadParentId(parentId);
      try {
        const result = await listChannelMessages(
          token,
          organizationId,
          activeChannelId,
          parentId,
          { signal: abortController.signal },
        );
        if (loadVersion !== channelDataVersion.current) return;
        recordProposalMessages(result.messages);
        setThreadMessages((current) =>
          mergeChannelMessageSnapshot(current, result.messages));
      } catch (cause) {
        if (
          !abortController.signal.aborted &&
          loadVersion === channelDataVersion.current
        ) {
          setError(errorMessage(cause));
        }
      } finally {
        if (authoritativeLoadVersion.current === loadVersion) {
          authoritativeLoadVersion.current = null;
        }
        if (channelLoadAbortController.current === abortController) {
          channelLoadAbortController.current = null;
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
      const sendContext = captureChannelSurface();
      const clientMessageId = crypto.randomUUID();
      const attachmentUrls = attachments.map((attachment) =>
        URL.createObjectURL(attachment)
      );
      const optimisticMessage = createOptimisticChannelMessage({
        id: clientMessageId,
        channelId: activeChannelId,
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
        ? messages.find((message) => message.id === parentMessageId) ?? null
        : null;
      setBusy(true);
      setError(null);
      if (parentMessageId) {
        optimisticThreadMessageIds.current.add(clientMessageId);
        updateRootMessages((current) => current.map((message) =>
          message.id === parentMessageId
            ? appendChannelReplySummary(message, optimisticMessage)
            : message
        ));
        setThreadMessages((current) =>
          mergeChannelMessages(current, [optimisticMessage], [])
        );
      } else {
        shouldScrollChannelToEnd.current = true;
        updateRootMessages((current) =>
          mergeChannelMessages(current, [optimisticMessage], [])
        );
      }
      try {
        const hasAgentMention = mentions.some(
          (mention) => mention.type === "agent",
        );
        const preferredDeviceId = hasAgentMention
          ? await currentExecutionWorkerDeviceId(organizationId)
          : null;
        const result = await sendChannelMessage(token, organizationId, activeChannelId, {
          body: body.trim(),
          clientMessageId,
          parentMessageId,
          mentionedUserIds: mentions
            .filter((mention) => mention.type === "user")
            .map((mention) => mention.id),
          mentionedAgentIds: mentions
            .filter((mention) => mention.type === "agent")
            .map((mention) => mention.id),
          ...(preferredDeviceId ? { preferredDeviceId } : {}),
          attachments,
          attachmentReferences,
        });
        if (!channelSurfaceIsCurrent(sendContext)) return;
        setReplies((current) => [...current, ...result.agentReplies]);
        const failed = result.agentReplies.find(
          (reply) => reply.status === "failed",
        );
        if (failed) {
          setError(
            t("run.briarReplyFailed", {
              error: channelReplyErrorText(failed.error, {
                fallback: t("run.failed"),
                noAvailableWorker: t("agents.agentWorkerUnavailable"),
              }),
            }),
          );
        }
        if (parentMessageId) {
          optimisticThreadMessageIds.current.delete(clientMessageId);
          setThreadMessages((current) =>
            mergeChannelMessages(current, [result.message], []),
          );
        } else {
          shouldScrollChannelToEnd.current = true;
          updateRootMessages((current) =>
            mergeChannelMessages(current, [result.message], []));
        }
      } catch (cause) {
        if (channelSurfaceIsCurrent(sendContext)) {
          const shouldRollbackReplySummary = parentMessageId
            ? optimisticThreadMessageIds.current.delete(clientMessageId)
            : false;
          setThreadMessages((current) =>
            removeOptimisticChannelMessage(current, clientMessageId)
          );
          updateRootMessages((current) => {
            const removed = removeOptimisticChannelMessage(
              current,
              clientMessageId,
            );
            return parentMessageId && shouldRollbackReplySummary
              ? removed.map((message) =>
                  message.id === parentMessageId
                    ? {
                        ...message,
                        replyCount: Math.max(0, message.replyCount - 1),
                        ...(message.lastReplyAt === optimisticMessage.createdAt
                          ? {
                              lastReplyAt: parentBeforeSend?.lastReplyAt ?? null,
                              replyAuthors: parentBeforeSend?.replyAuthors ?? [],
                            }
                          : {}),
                      }
                    : message
                )
              : removed;
          });
          setError(errorMessage(cause));
        }
      } finally {
        optimisticThreadMessageIds.current.delete(clientMessageId);
        for (const url of attachmentUrls) URL.revokeObjectURL(url);
        if (channelSurfaceIsCurrent(sendContext)) setBusy(false);
      }
    },
    [
      activeChannelId,
      captureChannelSurface,
      channelSurfaceIsCurrent,
      currentUserId,
      members,
      messages,
      organizationId,
      t,
      token,
      updateRootMessages,
    ],
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
      updateRootMessages((current) => current.map(apply));
      setThreadMessages((current) => current.map(apply));
    },
    [updateRootMessages],
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
      updateRootMessages((current) => current.map(apply));
      setThreadMessages((current) => current.map(apply));
    },
    [updateRootMessages],
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
          const result = await loadChannel(token, organizationId, activeChannelId, {
            messageLimit: desktopChannelMessagePageSize,
          });
          if (loadVersion !== channelDataVersion.current) {
            return latestProposals.current.get(proposalId) ?? null;
          }
          recordProposalMessages(result.messages);
          setMembers(result.members);
          setAgents(result.agents);
          updateRootMessages((current) =>
            mergeChannelMessages(current, result.messages, []));
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
      updateRootMessages,
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
          updateRootMessages((current) => current.map(applyResult));
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
                updateRootMessages((current) => current.map(applyResult));
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
            updateRootMessages((current) => current.map(applyResult));
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
      updateRootMessages,
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
        updateRootMessages((current) => current.map(applyReactions));
        setThreadMessages((current) => current.map(applyReactions));
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [activeChannelId, organizationId, token, updateRootMessages],
  );

  const toggleThreadSubscription = useCallback(
    async (subscribed: boolean) => {
      if (!activeChannelId || !threadParentId || threadSubscriptionPending) return;
      setThreadSubscriptionPending(true);
      setError(null);
      try {
        const result = await updateChannelThreadSubscription(
          token,
          organizationId,
          activeChannelId,
          threadParentId,
          subscribed,
        );
        const apply = (current: ChannelMessage[]) =>
          applyChannelThreadSubscribers(
            current,
            result.rootMessageId,
            result.subscribers,
          );
        updateRootMessages(apply);
        setThreadMessages(apply);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setThreadSubscriptionPending(false);
      }
    },
    [
      activeChannelId,
      organizationId,
      threadParentId,
      threadSubscriptionPending,
      token,
      updateRootMessages,
    ],
  );

  const pendingReplies = replies.filter(
    (reply) =>
      reply.channelId === activeChannelId &&
      (reply.status === "queued" || reply.status === "running"),
  );
  const threadMessageIds = threadParentId
    ? new Set([threadParentId, ...threadMessages.map((message) => message.id)])
    : new Set<string>();
  const threadPendingReplies = pendingReplies.filter((reply) =>
    threadMessageIds.has(reply.parentMessageId)
  );
  const threadTypingAgentNames = threadParentId
    ? typingAgentNamesForMessages(
        threadPendingReplies,
        agents,
        [...threadMessageIds],
        t("channel.projectAgent"),
      )
    : [];
  const threadActivityByAgentName = activityByAgentNameForReplies(
    threadPendingReplies,
    agents,
    liveActivity,
    t("channel.projectAgent"),
  );

  const memberCount = Math.max(activeChannel?.memberCount ?? 0, members.length);

  return (
    <div
      className={`channels${isResizingThread ? " is-resizing-thread" : ""}${
        showRequestedThreadOnly ? " channels-inbox-thread-only" : ""
      }`}
      ref={channelsRef}
      style={
        threadWidth === null
          ? undefined
          : ({
              "--channel-thread-width": `${threadWidth}%`,
            } as CSSProperties)
      }
    >
      {!showRequestedThreadOnly ? (
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
                  onClick={() => openInvite()}
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
                  onClick={openSettings}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            {error ? <div className="channel-error">{error}</div> : null}

            <div
              className="channel-messages"
              onScroll={(event) => {
                if (suppressEarlierLoadOnNextScroll.current) {
                  suppressEarlierLoadOnNextScroll.current = false;
                  return;
                }
                if (event.currentTarget.scrollTop <= 80) {
                  void loadEarlierChannelMessages();
                }
              }}
              ref={messagesScrollRef}
            >
              {channelLoading ? (
                <ChannelMessageSkeleton label={t("channel.loadingMessages")} />
              ) : (
                <>
                  <ChannelWelcome
                    channel={activeChannel}
                    onCreateAgent={onCreateAgent}
                    onAddPeople={() => openInvite()}
                  />
                  {loadingEarlierMessages ? (
                    <div className="channel-message-page-loader" role="status">
                      <LoaderCircle aria-hidden="true" className="spin" size={15} />
                    </div>
                  ) : null}
                  <VirtualizedChannelMessageList
                    localeTag={localeTag}
                    messages={messages}
                    renderMessage={(message) => (
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
                      typingActivityByAgentName={activityByAgentNameForReplies(
                        pendingReplies.filter((reply) =>
                          reply.parentMessageId === message.id
                        ),
                        agents,
                        liveActivity,
                        t("channel.projectAgent"),
                      )}
                      showTypingState={message.id !== threadParentId}
                    />
                    )}
                    scrollerRef={messagesScrollRef}
                    t={t}
                  />
                  {messages.length === 0 ? (
                    <p className="channel-empty-hint muted">
                      {t("channel.emptyHint")}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <Composer
              agents={agents}
              busy={busy || channelLoading}
              members={members}
              currentUserId={currentUserId}
              channelName={activeChannel.name}
              onInvite={() => openInvite()}
              onSend={(body, mentions, attachments, references) =>
                void send(body, mentions, null, attachments, references)
              }
            />
          </>
        ) : (
          <p className="muted channel-empty">{t("channel.selectPrompt")}</p>
        )}
        </section>
      ) : null}

      {threadParentId && activeChannel ? (
        <>
          {showRequestedThreadOnly ? null : (
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
          )}
          <aside className="channel-thread">
          <header>
            <span>
              <MessageSquare size={15} /> {t("channel.thread")}
            </span>
            <div className="channel-thread-header-actions">
              <ChannelThreadSubscribeControls
                currentUserId={currentUserId}
                members={members}
                pending={threadSubscriptionPending}
                subscribers={
                  threadMessages.find((message) => message.id === threadParentId)
                    ?.subscribers ?? []
                }
                onToggle={(subscribed) => {
                  void toggleThreadSubscription(subscribed);
                }}
              />
              <button
                aria-label={t("channel.closeThread")}
                onClick={() => {
                  if (showRequestedThreadOnly) {
                    onInboxDetailClose?.();
                    return;
                  }
                  invalidateChannelSurface(activeChannel.id, null);
                  setThreadParentId(null);
                }}
              >
                <X size={15} />
              </button>
            </div>
          </header>
          <div className="channel-messages" ref={threadMessagesScrollRef}>
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
                typingActivityByAgentName={activityByAgentNameForReplies(
                  pendingReplies.filter((reply) =>
                    reply.parentMessageId === message.id
                  ),
                  agents,
                  liveActivity,
                  t("channel.projectAgent"),
                )}
                showTypingState={false}
              />
            ))}
          </div>
          <ChannelTypingState
            agentNames={threadTypingAgentNames}
            activityByAgentName={threadActivityByAgentName}
            className="channel-thread-typing"
          />
          <Composer
            agents={agents}
            busy={busy}
            members={members}
            currentUserId={currentUserId}
            channelName={activeChannel.name}
            onInvite={() => openInvite()}
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

      {showRequestedThreadOnly && !(threadParentId && activeChannel) ? (
        <div className="inbox-detail-loading" role="status">
          <LoadingState label={t("inbox.detailLoading")} />
        </div>
      ) : null}

      {settingsOpen && activeChannel ? (
        <ChannelSettingsDialog
          agents={agents}
          channel={activeChannel}
          currentUserId={currentUserId}
          error={settingsError}
          members={members}
          projects={projects}
          saving={settingsSaving}
          onAddPeople={() => openInvite()}
          onClose={() => {
            if (!settingsSaving && !inviteOpen) setSettingsOpen(false);
          }}
          onSave={saveChannelSettings}
        />
      ) : null}
      {inviteOpen && activeChannel ? (
        <ChannelInviteDialog
          agents={inviteAgents}
          channel={activeChannel}
          channelAgents={agents}
          channelMembers={members}
          loading={inviteLoading}
          members={inviteMembers}
          initialInvite={inviteIsInitial}
          organizationName={organizationName}
          saving={inviteSaving}
          error={inviteError}
          onAdd={(selected) => void addInvitees(selected)}
          onClose={() => {
            if (!inviteSaving) {
              setInviteOpen(false);
              setInviteIsInitial(false);
            }
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

function ChannelMessageSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="channel-message-skeleton">
      {[0, 1, 2, 3, 4].map((index) => (
        <div className="channel-message-skeleton-row" key={index}>
          <span className="channel-message-skeleton-avatar" />
          <span className="channel-message-skeleton-copy">
            <span />
            <span />
          </span>
        </div>
      ))}
    </div>
  );
}

function VirtualizedChannelMessageList({
  localeTag,
  messages,
  renderMessage,
  scrollerRef,
  t,
}: {
  localeTag: string;
  messages: ChannelMessage[];
  renderMessage: (message: ChannelMessage) => ReactNode;
  scrollerRef: RefObject<HTMLDivElement | null>;
  t: Translate;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const heights = useRef(new Map<string, number>());
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [viewport, setViewport] = useState({ height: 800, top: 0 });

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      const listTop = listRef.current
        ? listRef.current.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top + scroller.scrollTop
        : 0;
      setViewport({
        height: scroller.clientHeight || 800,
        top: Math.max(0, scroller.scrollTop - listTop),
      });
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(update);
    resizeObserver?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
    };
  }, [messages.length, scrollerRef]);

  const offsets = useMemo(() => {
    const values = [0];
    for (const message of messages) {
      values.push(
        values.at(-1)! +
          (heights.current.get(message.id) ?? desktopChannelEstimatedMessageHeight),
      );
    }
    return values;
  }, [measurementVersion, messages]);
  const totalHeight = offsets.at(-1) ?? 0;
  let start = 0;
  let end = messages.length;
  if (messages.length > desktopChannelVirtualizationThreshold) {
    const visibleTop = Math.max(
      0,
      viewport.top - desktopChannelVirtualOverscan *
        desktopChannelEstimatedMessageHeight,
    );
    const visibleBottom = viewport.top + viewport.height +
      desktopChannelVirtualOverscan * desktopChannelEstimatedMessageHeight;
    while (start < messages.length && offsets[start + 1]! < visibleTop) start += 1;
    end = start;
    while (end < messages.length && offsets[end]! <= visibleBottom) end += 1;
  }

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.channelVirtualMessageId;
        if (!id) continue;
        const borderBox = entry.borderBoxSize;
        const borderBoxHeight = Array.isArray(borderBox)
          ? borderBox[0]?.blockSize
          : (borderBox as unknown as ResizeObserverSize | undefined)?.blockSize;
        const height = borderBoxHeight ?? entry.contentRect.height;
        if (height <= 0 || Math.abs((heights.current.get(id) ?? 0) - height) < 1) {
          continue;
        }
        heights.current.set(id, height);
        changed = true;
      }
      if (changed) setMeasurementVersion((version) => version + 1);
    });
    const rows = listRef.current?.querySelectorAll<HTMLElement>(
      "[data-channel-virtual-message-id]",
    ) ?? [];
    for (const row of rows) observer.observe(row);
    return () => observer.disconnect();
  }, [end, start]);

  return (
    <div
      className="channel-message-virtual-list"
      data-virtualized={messages.length > desktopChannelVirtualizationThreshold}
      ref={listRef}
    >
      {start > 0 ? (
        <div
          aria-hidden="true"
          className="channel-message-virtual-spacer"
          style={{ height: offsets[start] }}
        />
      ) : null}
      {messages.slice(start, end).map((message, relativeIndex) => {
        const index = start + relativeIndex;
        const currentDay = dayKey(message.createdAt, localeTag);
        const previousDay = index > 0
          ? dayKey(messages[index - 1]!.createdAt, localeTag)
          : null;
        return (
          <div
            className="channel-message-block"
            data-channel-virtual-message-id={message.id}
            key={message.id}
          >
            {currentDay !== previousDay ? (
              <div className="channel-day-separator">
                <span>{formatDayLabel(message.createdAt, localeTag, t)}</span>
              </div>
            ) : null}
            {renderMessage(message)}
          </div>
        );
      })}
      {end < messages.length ? (
        <div
          aria-hidden="true"
          className="channel-message-virtual-spacer"
          style={{ height: Math.max(0, totalHeight - offsets[end]!) }}
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

function ChannelSettingsDialog({
  agents,
  channel,
  currentUserId,
  error,
  members,
  projects,
  saving,
  onAddPeople,
  onClose,
  onSave,
}: {
  agents: ChannelAgentSummary[];
  channel: ChannelSummary;
  currentUserId: string | null;
  error: string | null;
  members: ChannelMember[];
  projects: readonly Pick<Project, "id" | "name" | "organizationId">[];
  saving: boolean;
  onAddPeople: () => void;
  onClose: () => void;
  onSave: (input: {
    name?: string;
    defaultProjectId?: string | null;
  }) => Promise<void>;
}) {
  const { t, localeTag } = useI18n();
  const titleId = useId();
  const settingsPanelId = useId();
  const membersPanelId = useId();
  const [tab, setTab] = useState<"settings" | "members">("settings");
  const [name, setName] = useState(channel.name);
  const [memberQuery, setMemberQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  // Follow external renames (catalog sync) while the dialog stays open.
  useEffect(() => setName(channel.name), [channel.name]);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  const archived = Boolean(channel.archivedAt);
  const trimmedName = name.trim();
  const nameDirty = trimmedName !== channel.name;
  const projectId = channel.defaultProjectId ?? "";
  const organizationProjects = useMemo(
    () =>
      projects.filter(
        (project) => project.organizationId === channel.organizationId,
      ),
    [channel.organizationId, projects],
  );

  const submitName = async () => {
    if (!nameDirty || !trimmedName) return;
    await onSave({ name: trimmedName });
  };

  const normalizedQuery = memberQuery.trim().toLowerCase();
  const visibleMembers = members.filter((member) =>
    !normalizedQuery ||
    `${member.name} ${member.email}`.toLowerCase().includes(normalizedQuery)
  );
  const visibleAgents = agents.filter((agent) =>
    !normalizedQuery ||
    `${agent.name} ${agent.projectName ?? ""}`.toLowerCase().includes(
      normalizedQuery,
    )
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
        className="channel-invite-dialog channel-settings-dialog"
        role="dialog"
      >
        <header>
          <div>
            <h2 id={titleId}>
              {channel.visibility === "private" ? (
                <Lock aria-hidden="true" size={18} />
              ) : (
                <Hash aria-hidden="true" size={18} />
              )}
              {channel.name}
            </h2>
            <p>{t("channel.settingsDescription")}</p>
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

        <div className="channel-settings-tabs" role="tablist">
          <button
            aria-controls={settingsPanelId}
            aria-selected={tab === "settings"}
            className={tab === "settings" ? "active" : ""}
            id={`${settingsPanelId}-tab`}
            onClick={() => setTab("settings")}
            role="tab"
            type="button"
          >
            {t("channel.settingsTabGeneral")}
          </button>
          <button
            aria-controls={membersPanelId}
            aria-selected={tab === "members"}
            className={tab === "members" ? "active" : ""}
            id={`${membersPanelId}-tab`}
            onClick={() => setTab("members")}
            role="tab"
            type="button"
          >
            {t("channel.settingsTabMembers", {
              count: members.length + agents.length,
            })}
          </button>
        </div>

        {tab === "settings" ? (
          <div
            aria-labelledby={`${settingsPanelId}-tab`}
            className="channel-settings-body"
            id={settingsPanelId}
            role="tabpanel"
          >
            <div className="channel-settings-field">
              <label htmlFor="channel-settings-name">{t("channel.name")}</label>
              <div className="channel-settings-row">
                <input
                  disabled={saving || archived}
                  id="channel-settings-name"
                  maxLength={100}
                  onChange={(event) => setName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitName();
                  }}
                  value={name}
                />
                <button
                  disabled={!nameDirty || !trimmedName || saving || archived}
                  onClick={() => void submitName()}
                  type="button"
                >
                  {saving
                    ? t("channel.settingsSaving")
                    : t("channel.settingsSave")}
                </button>
              </div>
            </div>

            <div className="channel-settings-field">
              <label htmlFor="channel-settings-project">
                {t("channel.settingsProject")}
              </label>
              <select
                disabled={saving || archived}
                id="channel-settings-project"
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next !== projectId) {
                    void onSave({ defaultProjectId: next || null });
                  }
                }}
                value={projectId}
              >
                <option value="">{t("channel.settingsProjectNone")}</option>
                {organizationProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="channel-settings-field">
              <span>{t("channel.settingsChannelId")}</span>
              <div className="channel-settings-row">
                <code className="channel-settings-id">{channel.id}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(channel.id)
                      .then(() => {
                        setCopied(true);
                        if (copyTimer.current !== null) {
                          window.clearTimeout(copyTimer.current);
                        }
                        copyTimer.current = window.setTimeout(
                          () => setCopied(false),
                          2000,
                        );
                      })
                      .catch(() => setCopied(false));
                  }}
                  type="button"
                >
                  <Copy size={14} aria-hidden="true" />
                  {copied
                    ? t("channel.settingsIdCopied")
                    : t("channel.settingsCopyId")}
                </button>
              </div>
            </div>

            <div className="channel-settings-field">
              <span>{t("channel.settingsCreatedAt")}</span>
              <p className="channel-settings-created">
                {new Date(channel.createdAt).toLocaleString(localeTag)}
              </p>
            </div>
          </div>
        ) : (
          <div
            aria-labelledby={`${membersPanelId}-tab`}
            className="channel-settings-body"
            id={membersPanelId}
            role="tabpanel"
          >
            <label className="channel-invite-search channel-settings-search">
              <Search aria-hidden="true" size={17} />
              <input
                disabled={saving}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder={t("channel.settingsMembersSearch")}
                type="search"
                value={memberQuery}
              />
            </label>
            <button
              className="channel-settings-add"
              disabled={saving || archived}
              onClick={onAddPeople}
              type="button"
            >
              <UserPlus aria-hidden="true" size={16} />
              {t("channel.settingsAddPeople")}
            </button>
            <div className="channel-settings-member-list">
              {visibleMembers.length + visibleAgents.length === 0 ? (
                <p className="channel-invite-status">
                  {members.length + agents.length === 0
                    ? t("channel.settingsMembersEmpty")
                    : t("channel.inviteNoResults")}
                </p>
              ) : (
                <>
                  {visibleMembers.map((member) => (
                    <article className="channel-settings-member" key={member.userId}>
                      <span className="channel-invite-avatar user">
                        {member.image
                          ? <img alt="" src={member.image} />
                          : authorInitial(member.name)}
                      </span>
                      <span className="channel-settings-member-copy">
                        <strong>
                          {member.name}
                          {member.userId === currentUserId
                            ? ` (${t("channel.you")})`
                            : ""}
                        </strong>
                        <small>{member.email}</small>
                      </span>
                      <em>
                        {member.role === "owner"
                          ? t("profile.channelOwner")
                          : t("profile.channelMember")}
                      </em>
                    </article>
                  ))}
                  {visibleAgents.map((agent) => (
                    <article className="channel-settings-member" key={agent.agentId}>
                      <span className="channel-invite-avatar agent">
                        {agent.avatar
                          ? <img alt="" src={agent.avatar} />
                          : <Bot aria-hidden="true" size={18} />}
                      </span>
                      <span className="channel-settings-member-copy">
                        <strong>{agent.name}</strong>
                        <small>
                          {agent.projectId
                            ? agent.projectName
                              ? `${t("channel.projectAgent")} · ${agent.projectName}`
                              : t("channel.projectAgent")
                            : t("channel.orgAgent")}
                        </small>
                      </span>
                    </article>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {error ? (
          <p className="channel-invite-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
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
  initialInvite,
  loading,
  members,
  organizationName,
  saving,
  onAdd,
  onClose,
}: {
  agents: ChannelAgentSummary[];
  channel: ChannelSummary;
  channelAgents: ChannelAgentSummary[];
  channelMembers: ChannelMember[];
  error: string | null;
  initialInvite: boolean;
  loading: boolean;
  members: OrganizationMember[];
  organizationName: string;
  saving: boolean;
  onAdd: (selected: ChannelInviteCandidate[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [inviteMode, setInviteMode] = useState<ChannelInviteMode>(
    initialInvite ? "all" : "specific",
  );

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

  const allMemberCandidates = useMemo<ChannelInviteCandidate[]>(
    () =>
      members.map((member) => ({
        type: "user" as const,
        id: member.userId,
        member,
      })),
    [members],
  );
  const candidatesToInvite = initialInvite
    ? candidates.filter((candidate) => candidate.type === "user")
    : candidates;

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = candidatesToInvite.filter((candidate) => {
    if (!normalizedQuery) return true;
    const searchable =
      candidate.type === "user"
        ? `${candidate.member.name} ${candidate.member.email}`
        : `${candidate.agent.name} ${candidate.agent.projectName ?? ""} ${candidate.agent.provider} ${candidate.agent.description ?? ""} ${candidate.agent.responsibility} ${candidate.agent.skills.map((skill) => skill.name).join(" ")}`;
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

  const selected = candidatesToInvite.filter((candidate) =>
    selectedKeys.has(`${candidate.type}:${candidate.id}`),
  );
  const selectedForAdd =
    initialInvite && inviteMode === "all" ? allMemberCandidates : selected;
  const organizationLabel = organizationName || t("channel.inviteOrganizationFallback");
  const canAdd =
    initialInvite && inviteMode === "all"
      ? !loading && !saving
      : selected.length > 0 && !loading && !saving;

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
        className={`channel-invite-dialog${initialInvite ? " initial" : ""}`}
        role="dialog"
      >
        <header>
          <div>
            <h2 id={titleId}>
              {t(
                initialInvite
                  ? "channel.inviteInitialTitle"
                  : "channel.inviteTitle",
                { name: channel.name },
              )}
            </h2>
            <p>
              {initialInvite
                ? t("channel.inviteInitialChannelName", { name: channel.name })
                : t("channel.inviteDescription")}
            </p>
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

        {initialInvite ? (
          <fieldset className="channel-invite-mode-fieldset">
            <legend>{t("channel.inviteMode")}</legend>
            <div className="channel-invite-mode-options">
              <label
                className="channel-invite-mode-option"
                data-selected={inviteMode === "all"}
              >
                <input
                  autoFocus={inviteMode === "all"}
                  checked={inviteMode === "all"}
                  disabled={saving}
                  name="channel-invite-mode"
                  onChange={() => setInviteMode("all")}
                  type="radio"
                  value="all"
                />
                <strong>
                  {t("channel.inviteAllMembers", {
                    count: loading ? "…" : members.length,
                    organization: organizationLabel,
                  })}
                </strong>
              </label>
              <label
                className="channel-invite-mode-option"
                data-selected={inviteMode === "specific"}
              >
                <input
                  checked={inviteMode === "specific"}
                  disabled={saving}
                  name="channel-invite-mode"
                  onChange={() => setInviteMode("specific")}
                  type="radio"
                  value="specific"
                />
                <strong>{t("channel.inviteSpecificPeople")}</strong>
              </label>
            </div>
          </fieldset>
        ) : null}

        {!initialInvite || inviteMode === "specific" ? (
          <>
            <label className="channel-invite-search">
              <Search aria-hidden="true" size={17} />
              <input
                autoFocus={initialInvite && inviteMode === "specific"}
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
                  {candidatesToInvite.length === 0
                    ? t("channel.inviteEveryoneAdded")
                    : t("channel.inviteNoResults")}
                </p>
              )}
            </div>
          </>
        ) : null}

        {error ? (
          <p className="channel-invite-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer>
          <span>
            {initialInvite && inviteMode === "all"
              ? null
              : selected.length > 0
              ? t("channel.inviteSelected", { count: selected.length })
              : t("channel.inviteSelectHint")}
          </span>
          <button
            disabled={!canAdd}
            onClick={() => onAdd(selectedForAdd)}
            type="button"
          >
            {saving ? t("channel.inviting") : t("channel.inviteAdd")}
          </button>
        </footer>
      </section>
    </div>
  );
}

const MessageRow = memo(function MessageRow({
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
  typingActivityByAgentName,
  showTypingState = true,
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
  typingActivityByAgentName: Readonly<Record<string, ChannelAgentActivityDescriptor>>;
  showTypingState?: boolean;
}) {
  const { t } = useI18n();
  const [reacting, setReacting] = useState(false);
  const isAgent = message.author.type === "agent";
  const isWebhook = message.author.type === "webhook";
  const isSelf =
    message.author.type === "user" && message.author.id === currentUserId;
  const displayName = isSelf ? t("channel.you") : message.author.name;
  const agentProvider =
    message.author.type === "agent" ? message.author.provider : null;
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
      className={`channel-message ${message.author.type}${reacting ? " is-reacting" : ""}${message.optimistic ? " is-optimistic" : ""}`}
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
            <span
              aria-label={agentProvider ? agentProviderLabels[agentProvider] : "Agent"}
              className={`channel-agent-badge${agentProvider ? ` ${agentProvider}` : ""}`}
              role="img"
              title={agentProvider ? agentProviderLabels[agentProvider] : "Agent"}
            >
              {agentProvider ? (
                <AgentProviderIcon provider={agentProvider} size={12} />
              ) : (
                <>
                  <Bot size={12} /> agent
                </>
              )}
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
        {showTypingState ? (
          <ChannelTypingState
            agentNames={typingAgentNames}
            activityByAgentName={typingActivityByAgentName}
          />
        ) : null}
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
          busy={busy || message.optimistic}
          currentUserId={currentUserId}
          members={members}
          message={message}
          onOpenThread={message.optimistic ? undefined : onOpenThread}
          onReactingChange={setReacting}
          onToggle={onToggleReaction}
          organizationId={channel.organizationId}
          showHoverActions
        />

        {!message.optimistic && onOpenThread && message.replyCount > 0 ? (
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
}, (previous, next) =>
  previous.acceptingProposal === next.acceptingProposal &&
  previous.agents === next.agents &&
  previous.busy === next.busy &&
  previous.channel === next.channel &&
  previous.currentUserId === next.currentUserId &&
  previous.localeTag === next.localeTag &&
  previous.members === next.members &&
  previous.message === next.message &&
  previous.projects === next.projects &&
  previous.selectedProjectId === next.selectedProjectId &&
  previous.showTypingState === next.showTypingState &&
  previous.token === next.token &&
  JSON.stringify(previous.typingActivityByAgentName) ===
    JSON.stringify(next.typingActivityByAgentName) &&
  previous.typingAgentNames.length === next.typingAgentNames.length &&
  previous.typingAgentNames.every(
    (name, index) => name === next.typingAgentNames[index],
  ));

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
