import {
  AtSign,
  Bot,
  Brain,
  Check,
  ChevronLeft,
  Copy,
  Hash,
  Headphones,
  Lock,
  MessageCircle,
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
import { Spinner } from "./ui/spinner";
import { DmMemoryCitations } from "./DmMemoryCitations";
import { DmComputerPanel } from "./DmComputerPanel";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { useI18n } from "../i18n";
import { useToast } from "./ui/toast";
import {
  useChannelComposer,
  type ChannelSkillCommandTarget,
} from "../hooks/useChannelComposer";
import { useHorizontalPaneResize } from "../hooks/useHorizontalPaneResize";
import type { AutoHuntSession } from "../types";
import {
  createChannelWebhook,
  listDirectMessageRecipients,
  listChannelWebhooks,
  listChannels,
  loadChannel,
  markChannelRead,
  revokeChannelWebhook,
  rotateChannelWebhook,
  setChannelAgent,
  setChannelMember,
  updateChannel,
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
  type ChannelAgentReply,
  type ChannelAgentSummary,
  type ChannelDelta,
  type ChannelMember,
  type ChannelMessage,
  type ChannelExecutionProposal,
  type ChannelSummary,
  type ChannelWebhook,
  type DirectMessageParticipant,
} from "../lib/channels-contract";
import {
  directMessageDisplayName,
  directMessageParticipants,
} from "../lib/direct-messages";
import {
  laterTimestamp,
  markChannelCatalogRead,
} from "../lib/channel-unread";
import type { MentionTarget } from "../lib/channel-mentions";
import { agentProviderLabels } from "../lib/agent-provider";
import { maxIssueAttachmentCount } from "../lib/issue-attachments";
import {
  ChannelDraftImages,
  ChannelMessageImageCacheProvider,
  ChannelMessageImages,
  useChannelMessageImageCache,
} from "./ChannelImages";
import { channelAttachmentAccept } from "../lib/channel-attachments";
import { ChannelMentionMenu } from "./ChannelMentionMenu";
import { ChannelSkillMenu } from "./ChannelSkillMenu";
import { ChannelTypingState } from "./ChannelTypingState";
import { MentionComposerField } from "./MentionComposerField";
import { AgentProviderIcon } from "./AgentIcons";
import { ChannelLinkPreview } from "./ChannelLinkPreview";
import {
  ProfileDialog,
  profileTargetForChannelAgent,
  profileTargetForChannelMember,
  profileTargetForDirectMessageParticipant,
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
import { ChannelDocumentPreview } from "./ChannelDocumentPreview";
import { ChannelThreadSubscribeControls } from "./ChannelThreadSubscribeControls";
import {
  ConversationReplySummary,
  type ConversationReplyParticipant,
} from "./ConversationReplySummary";
import {
  ChannelIssueProposalDetails,
  channelIssueBatchProposalDetails,
  channelIssueProposalDetails,
  channelIssueProposalRequestsExecution,
} from "./ChannelIssueProposalDetails";
import { IssueExecutionApproval } from "./IssueExecutionApproval";
import { IssueCreateExecutionApproval } from "./IssueCreateExecutionApproval";
import { AgentSkillExecutionApproval } from "./AgentSkillExecutionApproval";
import {
  resizeObserverEntryHeight,
  useChannelScrollStability,
  type ChannelScrollRowMeasurement,
  type ChannelScrollRowsResize,
} from "../hooks/use-channel-scroll-stability";
import {
  scrollContainerToEnd,
  scrollElementToCenter,
} from "../lib/scroll-container";
import {
  recordDesktopChannelFirstMessage,
  recordDesktopChannelHeader,
  type DesktopChannelDisplaySource,
} from "../lib/channel-performance";
import type { ChannelAgentActivityDescriptor } from "../lib/channel-agent-activity";
import { useChannelConversation } from "../hooks/use-channel-conversation";

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
  onChannelFallback?: (channelId: string | null) => void;
  onChannelsChange: Dispatch<SetStateAction<ChannelSummary[]>>;
  channelInboxSyncSignal?: string;
  onIssueCreated?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  onViewingChannelChange?: (
    channelId: string | null,
    threadRootMessageId: string | null,
  ) => void;
  initialInviteChannelId?: string | null;
  onInitialInviteHandled?: (channelId: string) => void;
  initialSettingsChannelId?: string | null;
  onInitialSettingsHandled?: () => void;
  onCreateAgent?: () => void;
  surface?: "channel" | "dm";
  inboxDetail?: boolean;
  onInboxDetailClose?: () => void;
  onInboxChannelOpen?: (channelId: string) => void;
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

/** Only opened from the DM header menu, so it loads on demand. */
const DmMemoryDialog = lazy(() =>
  import("./DmMemoryDialog").then((m) => ({ default: m.DmMemoryDialog })),
);

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
  [message.author, ...message.replyAuthors]
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
  onChannelFallback = onChannelSelect,
  onChannelsChange,
  channelInboxSyncSignal,
  onIssueCreated,
  onSkillSessionAccepted,
  onViewingChannelChange,
  initialInviteChannelId = null,
  onInitialInviteHandled,
  initialSettingsChannelId = null,
  onInitialSettingsHandled,
  requestedMessage,
  onRequestedMessageOpen,
  inboxDetail = false,
  onInboxDetailClose,
  onInboxChannelOpen,
  onCreateAgent,
  surface = "channel",
}: ChannelsProps) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const { t, localeTag } = useI18n();
  const { toast } = useToast();
  const imageCache = useChannelMessageImageCache(`${organizationId}\0${token}`);
  useEffect(() => {
    if (!activeChannelId) return;
    const channel = channels.find((item) => item.id === activeChannelId);
    if (!channel?.hasUnread) return;
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
  const [headerProfile, setHeaderProfile] = useState<ProfileTarget | null>(null);
  const [participantMenuOpen, setParticipantMenuOpen] = useState(false);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [messageNextCursor, setMessageNextCursor] = useState<string | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [replies, setReplies] = useState<ChannelAgentReply[]>([]);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  useEffect(() => {
    onViewingChannelChange?.(activeChannelId, threadParentId);
    return () => onViewingChannelChange?.(null, null);
  }, [activeChannelId, onViewingChannelChange, threadParentId]);
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([]);
  const [channelListReady, setChannelListReady] = useState(false);
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
  } = useHorizontalPaneResize({
    clamp: clampChannelThreadWidth,
    cssVariable: "--channel-thread-width",
    defaultWidth: channelThreadWidthDefault,
    load: loadChannelThreadWidth,
    max: channelThreadWidthMax,
    min: channelThreadWidthMin,
    save: saveChannelThreadWidth,
  });
  const cursor = useRef(0);
  const channelDataVersion = useRef(0);
  const authoritativeLoadVersion = useRef<number | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const threadMessagesScrollRef = useRef<HTMLDivElement | null>(null);
  const initialInviteHandledChannelId = useRef<string | null>(null);
  const activeChannelIdRef = useRef(activeChannelId);
  const channelCache = useRef(new Map<string, CachedDesktopChannel>());
  const channelLoadAbortController = useRef<AbortController | null>(null);
  const preparedChannelId = useRef<string | null>(null);
  const requestedMessageFocusKeyRef = useRef<string | null>(null);
  const suppressEarlierLoadOnNextScroll = useRef(false);
  const displaySource = useRef<DesktopChannelDisplaySource>("network");
  const initialSettingsHandledChannelId = useRef<string | null>(null);
  activeChannelIdRef.current = activeChannelId;
  const {
    onScroll: handleChannelScroll,
    reportRowsResize: reportChannelRowsResize,
    requestStickToBottom,
    requestStickToBottomIfAtBottom,
    restoreScrollTop,
    setStickToBottom,
    stickToBottomRef,
  } = useChannelScrollStability({
    channelKey: activeChannelId,
    scrollerRef: messagesScrollRef,
  });

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

  const updateThreadMessages = useCallback(
    (update: (current: ChannelMessage[]) => ChannelMessage[]) => {
      setThreadMessages(update);
    },
    [],
  );

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );
  const applyLoadedChannel = useCallback(
    (loadedChannel: ChannelSummary) => {
      onChannelsChange((current) =>
        current.some((item) => item.id === loadedChannel.id)
          ? current.map((item) =>
              item.id === loadedChannel.id ? loadedChannel : item
            )
          : [...current, loadedChannel]
      );
      const cached = channelCache.current.get(loadedChannel.id);
      if (cached) {
        channelCache.current.set(loadedChannel.id, {
          ...cached,
          channel: loadedChannel,
        });
      }
    },
    [onChannelsChange],
  );
  const applyConversationSnapshot = useCallback(
    (snapshot: CachedDesktopChannel) => {
      channelCache.current.set(snapshot.channel.id, snapshot);
    },
    [],
  );
  const applyChannelCatalogDelta = useCallback(
    (delta: ChannelDelta) => {
      onChannelsChange((current) => {
        const byId = new Map(
          (delta.reset ? [] : current).map((item) => [item.id, item]),
        );
        for (const item of delta.channels) byId.set(item.id, item);
        for (const id of delta.removedChannelIds) byId.delete(id);
        return [...byId.values()].sort((left, right) =>
          left.name.localeCompare(right.name)
        );
      });
    },
    [onChannelsChange],
  );
  const handleSelectedChannelRemoved = useCallback(() => {
    const remaining = channels.filter((item) => item.id !== activeChannelId);
    onChannelFallback(remaining[0]?.id ?? null);
  }, [activeChannelId, channels, onChannelFallback]);
  const handleIncomingRootMessages = useCallback(() => {
    requestStickToBottomIfAtBottom();
  }, [requestStickToBottomIfAtBottom]);
  const channelDeltaIsBlocked = useCallback(
    () => authoritativeLoadVersion.current != null,
    [],
  );
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
    closeThread,
    declineProposal,
    decliningProposalId,
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
    send,
    setError,
    setProposalProjects,
    threadActivityByAgentName,
    threadSubscriptionPending,
    threadTypingAgentNames,
    toggleReaction,
    toggleThreadSubscription,
    typingActivityByAgentName,
    typingAgentNames,
  } = useChannelConversation({
    token,
    organizationId,
    imageCache,
    currentUserId,
    channel: activeChannel,
    members,
    agents,
    messages,
    replies,
    threadParentId,
    threadMessages,
    messageNextCursor,
    pageSize: desktopChannelMessagePageSize,
    updateRootMessages,
    updateThreadMessages,
    setMembers,
    setAgents,
    setReplies,
    setThreadParentId,
    setMessageNextCursor,
    onChannelLoaded: applyLoadedChannel,
    onConversationLoaded: applyConversationSnapshot,
    onIssueOpen: onIssueCreated,
    onSkillSessionAccepted,
    onRootMessagePending: () => {
      requestStickToBottomIfAtBottom();
    },
    realtime: {
      enabled: true,
      catalogCursor: cursor,
      catalogReady: channelListReady,
      syncSignal: channelInboxSyncSignal,
      includeRepliesInRoot: surface === "dm",
      isBlocked: channelDeltaIsBlocked,
      onCatalogDelta: applyChannelCatalogDelta,
      onSelectedChannelRemoved: handleSelectedChannelRemoved,
      onIncomingRootMessages: handleIncomingRootMessages,
      warningLabel: "Channel delta refresh failed",
    },
  });
  const activeChannelName = activeChannel && surface === "dm"
    ? directMessageDisplayName(activeChannel, currentUserId)
    : activeChannel?.name ?? "";
  const dmParticipants = activeChannel && surface === "dm"
    ? directMessageParticipants(activeChannel, currentUserId)
    : [];
  const isGroupDirectMessage = dmParticipants.length > 1;

  useEffect(() => {
    setParticipantMenuOpen(false);
    setHeaderProfile(null);
    setInviteOpen(false);
    setInviteIsInitial(false);
    setInviteError(null);
    setSettingsOpen(false);
    setSettingsError(null);
    setWebhooksOpen(false);
    setWebhooksError(null);
    setRevealedWebhookUrl(null);
  }, [activeChannelId]);
  const showRequestedThreadOnly = Boolean(
    inboxDetail &&
      requestedMessage &&
      requestedMessage.rootMessageId !== requestedMessage.messageId,
  );

  const openInvite = useCallback((initial = false) => {
    if (!activeChannelId) return;
    const channelId = activeChannelId;
    setInviteOpen(true);
    setInviteIsInitial(initial);
    setInviteLoading(true);
    setInviteError(null);
    setInviteMembers([]);
    setInviteAgents([]);
    void listDirectMessageRecipients(token, organizationId)
      .then(({ members, agents }) => {
        if (activeChannelIdRef.current !== channelId) return;
        setInviteMembers(members);
        setInviteAgents(agents);
      })
      .catch((cause) => {
        if (activeChannelIdRef.current === channelId) {
          setInviteError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (activeChannelIdRef.current === channelId) {
          setInviteLoading(false);
        }
      });
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

  useEffect(() => {
    if (!initialSettingsChannelId) {
      initialSettingsHandledChannelId.current = null;
      return;
    }
    if (
      initialSettingsChannelId !== activeChannelId ||
      !activeChannel ||
      !channelListReady ||
      channelLoading ||
      initialSettingsHandledChannelId.current === initialSettingsChannelId
    ) {
      return;
    }
    initialSettingsHandledChannelId.current = initialSettingsChannelId;
    setSettingsError(null);
    setSettingsOpen(true);
    onInitialSettingsHandled?.();
  }, [
    activeChannel,
    activeChannelId,
    channelListReady,
    channelLoading,
    initialSettingsChannelId,
    onInitialSettingsHandled,
  ]);

  const openWebhooks = useCallback(() => {
    if (!activeChannelId) return;
    const channelId = activeChannelId;
    setWebhooksOpen(true);
    setWebhooksLoading(true);
    setWebhooksError(null);
    setWebhooks([]);
    setRevealedWebhookUrl(null);
    void listChannelWebhooks(token, organizationId, channelId)
      .then((result) => {
        if (activeChannelIdRef.current === channelId) {
          setWebhooks(result.webhooks);
        }
      })
      .catch((cause) => {
        if (activeChannelIdRef.current === channelId) {
          setWebhooksError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (activeChannelIdRef.current === channelId) {
          setWebhooksLoading(false);
        }
      });
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
    clearProposalHistory();
    void (async () => {
      try {
        const result = await listChannels(token, organizationId);
        if (cancelled) return;
        cursor.current = result.cursor;
        onChannelsChange(result.channels);
        setChannelListReady(true);
        if (!activeChannelIdRef.current) {
          onChannelFallback(result.channels[0]?.id ?? null);
        }
      } catch (cause) {
        if (!cancelled) {
          toast(errorMessage(cause), { tone: "error" });
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
    clearProposalHistory,
    onChannelFallback,
    onChannelsChange,
    organizationId,
    toast,
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
    invalidateChannelSurface(activeChannelId, null);
    channelLoadAbortController.current?.abort();
    const cached = channelCache.current.get(activeChannelId) ?? null;
    displaySource.current = cached ? "cache" : "network";
    requestStickToBottom();
    setMembers(cached?.members ?? []);
    setAgents(cached?.agents ?? []);
    setMessages(cached?.messages ?? []);
    setMessageNextCursor(cached?.nextCursor ?? null);
    setChannelLoading(!cached);
    setProposalProjects({});
    setThreadParentId(null);
    setThreadMessages([]);
    setReplies([]);
    setError(null);
  }, [
    activeChannelId,
    channelListReady,
    invalidateChannelSurface,
    requestStickToBottom,
    setError,
    setProposalProjects,
  ]);

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
        const loaded = await loadChannelConversation({
          channelId: activeChannelId,
          messageLimit: desktopChannelMessagePageSize,
          mergeWithCurrentMessages: Boolean(cached),
          requestedMessage,
          signal: abortController.signal,
        });
        if (
          !loaded ||
          cancelled ||
          loadVersion !== channelDataVersion.current
        ) return;
        if (!cached) {
          displaySource.current = loaded.messages.length > 0
            ? "network"
            : "empty";
          requestStickToBottom();
        }
        const target = loaded.requestedMessage;
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
            const focusRequestedMessage = () => {
              const targetKey = `${activeChannelId}:${target.messageId}`;
              if (requestedMessageFocusKeyRef.current === targetKey) return false;
              const targetElement = findTarget();
              if (!targetElement) return false;
              setStickToBottom(false);
              scrollElementToCenter(messageScroller, targetElement);
              targetElement.focus({ preventScroll: true });
              requestedMessageFocusKeyRef.current = targetKey;
              return true;
            };
            const requestedMessageElement = findTarget();
            if (
              !requestedMessageElement &&
              target.rootMessageId === target.messageId &&
              messageScroller
            ) {
              const targetIndex = channelCache.current
                .get(activeChannelId)
                ?.messages.findIndex(
                  (message) => message.id === target.messageId,
                ) ?? -1;
              if (targetIndex >= 0) {
                setStickToBottom(false);
                messageScroller.scrollTop =
                  targetIndex * desktopChannelEstimatedMessageHeight;
                suppressEarlierLoadOnNextScroll.current = true;
                messageScroller.dispatchEvent(new Event("scroll"));
                window.requestAnimationFrame(() => {
                  if (focusRequestedMessage()) onRequestedMessageOpen?.();
                });
                return;
              }
            }
            if (focusRequestedMessage()) onRequestedMessageOpen?.();
          });
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
    loadChannelConversation,
    onRequestedMessageOpen,
    requestedMessage,
    requestStickToBottom,
    setStickToBottom,
  ]);

  useEffect(() => {
    if (
      activeChannelId &&
      channelListReady &&
      !channels.some((channel) => channel.id === activeChannelId)
    ) {
      onChannelFallback(channels[0]?.id ?? null);
    }
  }, [activeChannelId, channelListReady, channels, onChannelFallback]);

  const loadEarlierChannelMessages = useCallback(async () => {
    const scroller = messagesScrollRef.current;
    const previousScrollHeight = scroller?.scrollHeight ?? 0;
    const previousScrollTop = scroller?.scrollTop ?? 0;
    const result = await loadEarlierConversationMessages();
    if (result.applied) {
      const activeId = activeChannelIdRef.current;
      const cached = activeId ? channelCache.current.get(activeId) : null;
      if (activeId && cached) {
        channelCache.current.set(activeId, {
          ...cached,
          nextCursor: result.nextCursor,
        });
      }
      window.requestAnimationFrame(() => {
        if (!scroller) return;
        restoreScrollTop(
          previousScrollTop + (scroller.scrollHeight - previousScrollHeight),
        );
        suppressEarlierLoadOnNextScroll.current = true;
        scroller.dispatchEvent(new Event("scroll"));
      });
    }
  }, [loadEarlierConversationMessages, restoreScrollTop]);

  useLayoutEffect(() => {
    if (!activeChannelId || channelLoading) return;
    const cached = channelCache.current.get(activeChannelId);
    if (!cached) return;
    if (
      messages.length !== cached.messages.length ||
      messages.some((message) => message.channelId !== activeChannelId)
    ) {
      return;
    }
    if (stickToBottomRef.current) {
      requestStickToBottom();
      suppressEarlierLoadOnNextScroll.current = true;
      messagesScrollRef.current?.dispatchEvent(new Event("scroll"));
    }
    recordDesktopChannelFirstMessage(activeChannelId, displaySource.current);
  }, [
    activeChannelId,
    channelLoading,
    messages,
    requestStickToBottom,
    stickToBottomRef,
  ]);

  useEffect(() => {
    if (!threadParentId) return;
    if (
      requestedMessage?.rootMessageId === threadParentId &&
      requestedMessage.messageId !== threadParentId
    ) {
      return;
    }
    scrollContainerToEnd(threadMessagesScrollRef.current);
  }, [requestedMessage, threadMessages, threadParentId]);

  useLayoutEffect(() => {
    if (!requestedMessage || !activeChannelId || channelLoading) {
      if (!requestedMessage) requestedMessageFocusKeyRef.current = null;
      return;
    }
    const targetKey = `${activeChannelId}:${requestedMessage.messageId}`;
    if (requestedMessageFocusKeyRef.current === targetKey) return;
    const messageScroller =
      requestedMessage.rootMessageId === requestedMessage.messageId
        ? messagesScrollRef.current
        : threadMessagesScrollRef.current;
    const targetElement = [
      ...(messageScroller?.querySelectorAll<HTMLElement>(
        "[data-channel-message-id]",
      ) ?? []),
    ].find(
      (element) =>
        element.dataset.channelMessageId === requestedMessage.messageId,
    ) ?? null;
    if (!messageScroller || !targetElement) return;
    setStickToBottom(false);
    scrollElementToCenter(messageScroller, targetElement);
    targetElement.focus({ preventScroll: true });
    requestedMessageFocusKeyRef.current = targetKey;
    onRequestedMessageOpen?.();
  }, [
    activeChannelId,
    channelLoading,
    messages.length,
    onRequestedMessageOpen,
    requestedMessage,
    setStickToBottom,
    threadMessages.length,
    threadParentId,
  ]);

  const openThread = useCallback(
    async (parentId: string) => {
      if (!activeChannelId) return;
      const loadVersion = ++channelDataVersion.current;
      authoritativeLoadVersion.current = loadVersion;
      channelLoadAbortController.current?.abort();
      try {
        await openConversationThread(parentId);
      } finally {
        if (authoritativeLoadVersion.current === loadVersion) {
          authoritativeLoadVersion.current = null;
        }
      }
    },
    [
      activeChannelId,
      openConversationThread,
    ],
  );

  /*
    What a row can do, as one object that outlives every render.

    The conversation hook rebuilds its callbacks whenever the messages or the
    channel change, so passing them straight through would change every row's
    props on every incoming message. A ref holds the latest set and the bundle
    below forwards to it, which is the same shape the registry-bound actions
    use: one identity for the component's lifetime, always the current closure.
  */
  const latestMessageHandlers = useRef<MessageRowHandlers>(null as never);
  latestMessageHandlers.current = {
    acceptExecutionProposal,
    acceptProposal,
    acceptSkillExecutionProposal,
    applyAcceptedExecutionProposal,
    applyAcceptedSkillExecutionProposal,
    declineProposal,
    loadExecutionProposalContext,
    loadSkillExecutionProposalContext,
    openThread: (messageId) => void openThread(messageId),
    removeMessage,
    selectProposalProject: (proposalId, projectId) => {
      setProposalProjects((current) => ({
        ...current,
        [proposalId]: projectId,
      }));
    },
    toggleReaction,
  };
  const messageHandlers = useMemo<MessageRowHandlers>(
    () => ({
      acceptExecutionProposal: (message, input) =>
        latestMessageHandlers.current.acceptExecutionProposal(message, input),
      acceptProposal: (message, input) =>
        latestMessageHandlers.current.acceptProposal(message, input),
      acceptSkillExecutionProposal: (message, input) =>
        latestMessageHandlers.current.acceptSkillExecutionProposal(
          message,
          input,
        ),
      applyAcceptedExecutionProposal: (messageId, proposal) =>
        latestMessageHandlers.current.applyAcceptedExecutionProposal(
          messageId,
          proposal,
        ),
      applyAcceptedSkillExecutionProposal: (messageId, proposal) =>
        latestMessageHandlers.current.applyAcceptedSkillExecutionProposal(
          messageId,
          proposal,
        ),
      declineProposal: (message) =>
        latestMessageHandlers.current.declineProposal(message),
      loadExecutionProposalContext: (proposal) =>
        latestMessageHandlers.current.loadExecutionProposalContext(proposal),
      loadSkillExecutionProposalContext: (proposal) =>
        latestMessageHandlers.current.loadSkillExecutionProposalContext(
          proposal,
        ),
      openThread: (messageId) =>
        latestMessageHandlers.current.openThread(messageId),
      removeMessage: (message) =>
        latestMessageHandlers.current.removeMessage(message),
      selectProposalProject: (proposalId, projectId) =>
        latestMessageHandlers.current.selectProposalProject(
          proposalId,
          projectId,
        ),
      toggleReaction: (message, emoji) =>
        latestMessageHandlers.current.toggleReaction(message, emoji),
    }),
    [],
  );

  /*
    The typing state of one message, as a value rather than a fresh array or
    record per render. Both helpers build a new object every call, which is the
    other half of what defeated the row memo; returning the previous one when
    the content matches lets an unrelated tick pass a row by.
  */
  const typingNamesCache = useRef(new Map<string, string[]>());
  const typingActivityCache = useRef(
    new Map<string, Readonly<Record<string, ChannelAgentActivityDescriptor>>>(),
  );
  const rowTypingAgentNames = useCallback(
    (messageId: string) => {
      const next = typingAgentNames(messageId);
      const previous = typingNamesCache.current.get(messageId);
      if (
        previous &&
        previous.length === next.length &&
        previous.every((name, index) => name === next[index])
      ) {
        return previous;
      }
      typingNamesCache.current.set(messageId, next);
      return next;
    },
    [typingAgentNames],
  );
  const rowTypingActivity = useCallback(
    (messageId: string) => {
      const next = typingActivityByAgentName(messageId);
      const previous = typingActivityCache.current.get(messageId);
      const nextKeys = Object.keys(next);
      if (
        previous &&
        Object.keys(previous).length === nextKeys.length &&
        nextKeys.every((key) => previous[key] === next[key])
      ) {
        return previous;
      }
      typingActivityCache.current.set(messageId, next);
      return next;
    },
    [typingActivityByAgentName],
  );

  const memberCount = Math.max(activeChannel?.memberCount ?? 0, members.length);
  const participantCount = memberCount + Math.max(
    activeChannel?.agentCount ?? 0,
    agents.length,
  );

  return (
    <ChannelMessageImageCacheProvider cache={imageCache}>
      <div
      className={`channels${isResizingThread ? " is-resizing-thread" : ""}${
        showRequestedThreadOnly ? " channels-inbox-thread-only" : ""
      }`}
      ref={channelsRef}
    >
      {!showRequestedThreadOnly ? (
        <div
          className={surface === "dm"
            ? "flex min-h-0 min-w-0 overflow-hidden"
            : "contents"}
        >
        <section
          aria-busy={channelLoading}
          className={`channel-main${surface === "dm" ? " flex-1" : ""}`}
        >
        {activeChannel ? (
          <>
            <header className="channel-header" data-tauri-drag-region="deep">
              {surface === "dm" ? (
                <button
                  aria-label={t("navigation.back")}
                  className="channel-header-back"
                  onClick={() => onChannelSelect(null)}
                  type="button"
                >
                  <ChevronLeft size={18} />
                </button>
              ) : null}
              {surface === "dm" ? (
                <DirectMessageHeaderIdentity
                  members={members}
                  agents={agents}
                  isGroup={isGroupDirectMessage}
                  menuOpen={participantMenuOpen}
                  name={activeChannelName}
                  onMenuOpenChange={setParticipantMenuOpen}
                  onSelectProfile={setHeaderProfile}
                  participants={dmParticipants}
                />
              ) : (
                <div className="channel-header-title">
                  {activeChannel.visibility === "private" ? (
                    <Lock size={16} aria-hidden="true" />
                  ) : (
                    <Hash size={16} aria-hidden="true" />
                  )}
                  <h2>{activeChannelName}</h2>
                </div>
              )}
              <div className="channel-header-actions">
                {surface === "dm" && <button type="button" className="channel-header-icon"
                  aria-label={t("memory.title")} title={t("memory.title")} onClick={() => setMemoryOpen(true)}>
                  <Brain size={16} aria-hidden="true" />
                </button>}
                {surface === "channel" ? <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.webhooks")}
                  title={t("channel.webhooks")}
                  onClick={openWebhooks}
                >
                  <Webhook size={16} aria-hidden="true" />
                </button> : null}
                <button
                  type="button"
                  className="channel-header-icon channel-header-members"
                  aria-label={t("channel.headerMembers", { count: participantCount })}
                  onClick={() => openInvite()}
                >
                  <Users size={16} aria-hidden="true" />
                  <span>{participantCount}</span>
                </button>
                {surface === "channel" ? <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.headerHuddle")}
                  title={t("channel.headerHuddle")}
                >
                  <Headphones size={16} aria-hidden="true" />
                </button> : null}
                {surface === "channel" ? <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.headerMore")}
                  title={t("channel.headerMore")}
                  onClick={openSettings}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button> : null}
              </div>
            </header>

            <div
              className="channel-messages"
              onScroll={(event) => {
                if (suppressEarlierLoadOnNextScroll.current) {
                  suppressEarlierLoadOnNextScroll.current = false;
                  return;
                }
                handleChannelScroll(event.currentTarget);
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
                  {surface === "dm" ? (
                    <DirectMessageWelcome name={activeChannelName} />
                  ) : (
                    <ChannelWelcome
                      channel={activeChannel}
                      onCreateAgent={onCreateAgent}
                      onAddPeople={() => openInvite()}
                    />
                  )}
                  {loadingEarlierMessages ? (
                    <div className="channel-message-page-loader" role="status">
                      <Spinner aria-hidden="true" size={15} />
                    </div>
                  ) : null}
                  <VirtualizedChannelMessageList
                    key={`${organizationId}:${activeChannelId}`}
                    localeTag={localeTag}
                    messages={messages}
                    onRowsResize={reportChannelRowsResize}
                    renderMessage={(message) => (
                      <MessageRow
                      agents={agents}
                      canOpenThread={surface === "channel"}
                      channel={activeChannel}
                      handlers={messageHandlers}
                      highlighted={message.id === requestedMessage?.messageId}
                      message={message}
                      members={members}
                      localeTag={localeTag}
                      currentUserId={currentUserId}
                      loadCreateExecutionProposalContext={
                        loadCreateExecutionProposalContext
                      }
                      onIssueOpen={openIssue}
                      busy={busy}
                      acceptingProposal={
                        acceptingProposalId === message.proposal?.id
                      }
                      decliningProposal={
                        decliningProposalId === message.proposal?.id
                      }
                      projects={projects}
                      selectedProjectId={
                        message.proposal
                          ? proposalProjects[message.proposal.id] ?? null
                          : null
                      }
                      token={token}
                      typingAgentNames={rowTypingAgentNames(message.id)}
                      typingActivityByAgentName={rowTypingActivity(message.id)}
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
              enableSkillCommands={surface === "dm"}
              members={members}
              currentUserId={currentUserId}
              channelName={activeChannelName}
              key={`channel:${organizationId}:${activeChannelId}`}
              onInvite={() => openInvite()}
              placeholder={
                surface === "dm"
                  ? t("dm.messagePlaceholder", { name: activeChannelName })
                  : undefined
              }
              onSend={(body, mentions, attachments, references, selectedSkill) =>
                void send(
                  body,
                  mentions,
                  null,
                  attachments,
                  references,
                  selectedSkill,
                )
              }
            />
          </>
        ) : (
          <p className="muted channel-empty">{t("channel.selectPrompt")}</p>
        )}
        </section>
        {surface === "dm" ? (
          <DmComputerPanel
            agents={agents}
            organizationId={organizationId}
            token={token}
          />
        ) : null}
        </div>
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
          <header data-tauri-drag-region="deep">
            <div className="channel-thread-heading">
              <span>
                <MessageSquare size={15} /> {t("channel.thread")}
              </span>
              {showRequestedThreadOnly && onInboxChannelOpen ? (
                <button
                  aria-label={t("channel.openChannel", {
                    name: activeChannelName,
                  })}
                  className="channel-thread-channel-link"
                  onClick={() => onInboxChannelOpen(activeChannel.id)}
                  type="button"
                >
                  {activeChannel.visibility === "private" ? (
                    <Lock aria-hidden="true" size={13} />
                  ) : (
                    <Hash aria-hidden="true" size={13} />
                  )}
                  <span>{activeChannelName}</span>
                </button>
              ) : null}
            </div>
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
                  closeThread();
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
                handlers={messageHandlers}
                highlighted={message.id === requestedMessage?.messageId}
                key={message.id}
                message={message}
                members={members}
                localeTag={localeTag}
                currentUserId={currentUserId}
                loadCreateExecutionProposalContext={
                  loadCreateExecutionProposalContext
                }
                onIssueOpen={openIssue}
                busy={busy}
                acceptingProposal={
                  acceptingProposalId === message.proposal?.id
                }
                decliningProposal={
                  decliningProposalId === message.proposal?.id
                }
                projects={projects}
                selectedProjectId={
                  message.proposal
                    ? proposalProjects[message.proposal.id] ?? null
                    : null
                }
                token={token}
                typingAgentNames={rowTypingAgentNames(message.id)}
                typingActivityByAgentName={rowTypingActivity(message.id)}
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
            enableSkillCommands={surface === "dm"}
            members={members}
            currentUserId={currentUserId}
            channelName={activeChannelName}
            key={`thread:${organizationId}:${activeChannelId}:${threadParentId}`}
            onInvite={() => openInvite()}
            placeholder={t("channel.threadPlaceholder")}
            onSend={(body, mentions, attachments, references, selectedSkill) =>
              void send(
                body,
                mentions,
                threadParentId,
                attachments,
                references,
                selectedSkill,
              )
            }
          />
          </aside>
        </>
      ) : null}

      {showRequestedThreadOnly && !(threadParentId && activeChannel) ? (
        <div
          className="inbox-detail-loading grid h-full w-full place-items-center bg-card text-xs text-muted-foreground"
          role="status"
        >
          <LoadingState label={t("inbox.detailLoading")} />
        </div>
      ) : null}

      {surface === "channel" && settingsOpen && activeChannel ? (
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
      <ProfileDialog
        profile={headerProfile}
        onOpenChange={(open) => {
          if (!open) setHeaderProfile(null);
        }}
      />
      {memoryOpen && surface === "dm" && activeChannel && <Suspense fallback={null}>
        <DmMemoryDialog
          key={`${organizationId}:${activeChannel.id}:${currentUserId}`}
          scope={{ token, organizationId, channelId: activeChannel.id }} onClose={() => setMemoryOpen(false)}
        />
      </Suspense>}
      {surface === "channel" && webhooksOpen && activeChannel ? (
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
    </ChannelMessageImageCacheProvider>
  );
}

function DirectMessageHeaderAvatar({
  name,
  participants,
}: {
  name: string;
  participants: readonly DirectMessageParticipant[];
}) {
  const visible = participants.slice(0, 2);
  const items = visible.length > 0
    ? visible
    : [{ type: "user" as const, id: "fallback", name, image: null }];
  return (
    <span
      aria-hidden="true"
      className={`channel-header-dm-avatar${items.length > 1 ? " is-group" : ""}`}
    >
      {items.map((participant) => (
        <span
          className="channel-header-dm-avatar-part"
          key={`${participant.type}:${participant.id}`}
        >
          {participant.image ? (
            <img alt="" src={participant.image} />
          ) : participant.type === "agent" ? (
            <Bot size={14} />
          ) : (
            participant.name.trim().charAt(0).toUpperCase() || "?"
          )}
        </span>
      ))}
    </span>
  );
}

function DirectMessageHeaderIdentity({
  agents,
  isGroup,
  members,
  menuOpen,
  name,
  onMenuOpenChange,
  onSelectProfile,
  participants,
}: {
  agents: ChannelAgentSummary[];
  isGroup: boolean;
  members: ChannelMember[];
  menuOpen: boolean;
  name: string;
  onMenuOpenChange: (open: boolean) => void;
  onSelectProfile: (profile: ProfileTarget) => void;
  participants: readonly DirectMessageParticipant[];
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        onMenuOpenChange(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen, onMenuOpenChange]);

  const openProfile = (participant: DirectMessageParticipant) => {
    onMenuOpenChange(false);
    onSelectProfile(
      profileTargetForDirectMessageParticipant(participant, members, agents),
    );
  };

  return (
    <div className="channel-header-identity" ref={menuRef}>
      <button
        aria-expanded={isGroup ? menuOpen : undefined}
        aria-haspopup={isGroup ? "menu" : undefined}
        aria-label={
          isGroup ? t("dm.participants") : t("dm.openProfile", { name })
        }
        className="channel-header-identity-button"
        onClick={() => {
          if (isGroup) {
            onMenuOpenChange(!menuOpen);
            return;
          }
          if (participants[0]) openProfile(participants[0]);
        }}
        type="button"
      >
        <DirectMessageHeaderAvatar name={name} participants={participants} />
        <h2>{name}</h2>
      </button>
      {isGroup && menuOpen ? (
        <div
          aria-label={t("dm.participants")}
          className="channel-header-participant-menu"
          role="menu"
        >
          {participants.map((participant) => (
            <button
              key={`${participant.type}:${participant.id}`}
              onClick={() => openProfile(participant)}
              role="menuitem"
              type="button"
            >
              <DirectMessageHeaderAvatar
                name={participant.name}
                participants={[participant]}
              />
              <span>{participant.name}</span>
            </button>
          ))}
        </div>
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
  onRowsResize,
  renderMessage,
  scrollerRef,
  t,
}: {
  localeTag: string;
  messages: ChannelMessage[];
  onRowsResize: ChannelScrollRowsResize;
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
      const measurements: ChannelScrollRowMeasurement[] = [];
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.channelVirtualMessageId;
        if (!id) continue;
        const height = resizeObserverEntryHeight(entry);
        const previousHeight = heights.current.get(id) ??
          desktopChannelEstimatedMessageHeight;
        if (height <= 0 || Math.abs(previousHeight - height) < 1) {
          continue;
        }
        heights.current.set(id, height);
        measurements.push({
          element: entry.target as HTMLElement,
          height,
          previousHeight,
        });
        changed = true;
      }
      if (changed) {
        onRowsResize(measurements);
        setMeasurementVersion((version) => version + 1);
      }
    });
    const rows = listRef.current?.querySelectorAll<HTMLElement>(
      "[data-channel-virtual-message-id]",
    ) ?? [];
    for (const row of rows) observer.observe(row);
    return () => observer.disconnect();
  }, [end, onRowsResize, start]);

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

function DirectMessageWelcome({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <div className="channel-welcome">
      <div className="channel-welcome-icon" aria-hidden="true">
        <MessageCircle size={28} />
      </div>
      <h3 className="justify-start">{name}</h3>
      <p className="channel-welcome-lead">
        {t("dm.welcome", { name })}
      </p>
      <p className="channel-welcome-topic">{t("dm.welcomeDescription")}</p>
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
            <p className="channel-invite-status"><Spinner size={16} />{t("channel.webhookLoading")}</p>
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
                  <Spinner size={16} />
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

/*
  Everything a row does to the conversation, in one object that never changes
  identity.

  The row is memoised, and it used to take a dozen props that were inline arrow
  functions closing over its own message — so every prop was a new value on
  every render of the list and the memo did nothing at all. The message is a
  prop the row already has, so the row binds it here instead: what arrives is
  message-agnostic and stable, and a row re-renders when its own message,
  its typing state or one of the flags about it actually changes.
*/
export interface MessageRowHandlers
  extends Pick<
    ReturnType<typeof useChannelConversation>,
    | "acceptExecutionProposal"
    | "acceptProposal"
    | "acceptSkillExecutionProposal"
    | "applyAcceptedExecutionProposal"
    | "applyAcceptedSkillExecutionProposal"
    | "declineProposal"
    | "loadExecutionProposalContext"
    | "loadSkillExecutionProposalContext"
    | "removeMessage"
    | "toggleReaction"
  > {
  readonly openThread: (messageId: string) => void;
  readonly selectProposalProject: (
    proposalId: string,
    projectId: string,
  ) => void;
}

export const MessageRow = memo(function MessageRow({
  acceptingProposal,
  decliningProposal,
  agents,
  canOpenThread = false,
  channel,
  handlers,
  highlighted = false,
  loadCreateExecutionProposalContext,
  message,
  members,
  localeTag,
  currentUserId,
  onIssueOpen,
  busy,
  projects,
  selectedProjectId,
  token,
  typingAgentNames,
  typingActivityByAgentName,
  showTypingState = true,
}: {
  acceptingProposal: boolean;
  decliningProposal: boolean;
  agents: ChannelAgentSummary[];
  /** The surface has threads, so a row may offer to open one. */
  canOpenThread?: boolean;
  channel: ChannelSummary;
  handlers: MessageRowHandlers;
  highlighted?: boolean;
  loadCreateExecutionProposalContext: (projectId: string) => Promise<{
    run: HuntRun | null;
    workers: ExecutionWorker[];
    policy?: ProjectExecutionWorkerPolicy;
  }>;
  message: ChannelMessage;
  members: ChannelMember[];
  localeTag: string;
  currentUserId: string | null;
  onIssueOpen?: (projectId: string, runId: string) => void | Promise<void>;
  busy: boolean;
  projects: readonly Pick<Project, "id" | "name" | "organizationId">[];
  selectedProjectId: string | null;
  token: string;
  typingAgentNames: string[];
  typingActivityByAgentName: Readonly<Record<string, ChannelAgentActivityDescriptor>>;
  showTypingState?: boolean;
}) {
  const { t } = useI18n();
  /*
    The row's own message, bound to the shared handlers. Each one depends on
    nothing but the handler bundle and the message, so it changes exactly when
    the row would have re-rendered anyway.
  */
  const onAcceptProposal = useCallback(
    (input?: IssueExecutionApprovalInput) =>
      handlers.acceptProposal(message, input ?? null),
    [handlers, message],
  );
  const onDeclineProposal = useCallback(
    () => handlers.declineProposal(message),
    [handlers, message],
  );
  const loadExecutionProposalContext = useCallback(
    () => handlers.loadExecutionProposalContext(message.executionProposal!),
    [handlers, message],
  );
  const loadSkillExecutionProposalContext = useCallback(
    () =>
      handlers.loadSkillExecutionProposalContext(
        message.skillExecutionProposal!,
      ),
    [handlers, message],
  );
  const onAcceptExecutionProposal = useCallback(
    (input: IssueExecutionApprovalInput) =>
      handlers.acceptExecutionProposal(message, input),
    [handlers, message],
  );
  const onExecutionProposalAccepted = useCallback(
    (proposal: ChannelExecutionProposal) =>
      handlers.applyAcceptedExecutionProposal(message.id, proposal),
    [handlers, message.id],
  );
  const onAcceptSkillExecutionProposal = useCallback(
    (input: AgentSkillExecutionApprovalInput) =>
      handlers.acceptSkillExecutionProposal(message, input),
    [handlers, message],
  );
  const onSkillExecutionProposalAccepted = useCallback(
    (proposal: AgentSkillExecutionProposal) =>
      handlers.applyAcceptedSkillExecutionProposal(message.id, proposal),
    [handlers, message.id],
  );
  const onProjectChange = useCallback(
    (projectId: string) => {
      const proposalId = message.proposal?.id;
      if (!proposalId) return;
      handlers.selectProposalProject(proposalId, projectId);
    },
    [handlers, message.proposal?.id],
  );
  const onToggleReaction = useCallback(
    (emoji: string) => void handlers.toggleReaction(message, emoji),
    [handlers, message],
  );
  const onDelete = useCallback(
    () => void handlers.removeMessage(message),
    [handlers, message],
  );
  const onOpenThread = useMemo(
    () =>
      canOpenThread
        ? () => void handlers.openThread(message.id)
        : undefined,
    [canOpenThread, handlers, message.id],
  );
  const [reacting, setReacting] = useState(false);
  const isAgent = message.author.type === "agent";
  const isWebhook = message.author.type === "webhook";
  const isSelf =
    message.author.type === "user" && message.author.id === currentUserId;
  const displayName = message.author.name;
  const agentProvider =
    message.author.type === "agent" ? message.author.provider : null;
  const image =
    message.author.type === "user" || message.author.type === "agent"
      ? message.author.image
      : null;
  const issueProposal = message.proposal;
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
  const proposalBatch = channelIssueBatchProposalDetails(issueProposal);
  const requestsExecution = channelIssueProposalRequestsExecution(issueProposal);
  const executionProjectName = message.executionProposal
    ? availableProjects.find(
        (project) => project.id === message.executionProposal?.projectId,
      )?.name ?? message.executionProposal.projectId
    : null;

  return (
    <article
      aria-current={highlighted ? "true" : undefined}
      className={`channel-message ${message.author.type}${reacting ? " is-reacting" : ""}${highlighted ? " is-inbox-target" : ""}${message.optimistic ? " is-optimistic" : ""}`}
      data-channel-message-id={message.id}
      data-inbox-highlighted={highlighted ? "true" : undefined}
      tabIndex={highlighted ? -1 : undefined}
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
        {isAgent && agentProvider ? (
          <span
            aria-label={agentProviderLabels[agentProvider]}
            className={`channel-agent-badge ${agentProvider}`}
            role="img"
            title={agentProviderLabels[agentProvider]}
          >
            <AgentProviderIcon provider={agentProvider} size={11} />
          </span>
        ) : null}
      </div>
      <div className="channel-message-body">
        <header>
          <strong>{displayName}</strong>
          {message.author.type === "webhook" ? (
            <span className="channel-agent-badge webhook">
              <Webhook size={12} /> {t("channel.webhookBadge")}
            </span>
          ) : null}
          <time dateTime={message.createdAt}>
            {formatMessageTime(message.createdAt, localeTag)}
          </time>
        </header>
        <ChannelMessageText agents={agents} members={members} message={message} />
        {channel.kind === "dm" && <DmMemoryCitations
          scope={{ token, organizationId: channel.organizationId, channelId: message.channelId }}
          references={message.memoryCitations ?? []} />}
        <ChannelLinkPreview
          channelId={message.channelId}
          message={message}
          organizationId={channel.organizationId}
          token={token}
        />
        <ChannelMessageImages attachments={message.attachments} token={token} />
        {message.document ? (
          <ChannelDocumentPreview
            channelId={message.channelId}
            document={message.document}
            organizationId={channel.organizationId}
            token={token}
          />
        ) : null}

        {issueProposal ? (
          <div className="channel-proposal-card">
            <div className="channel-proposal-copy">
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
                {availableProjects.map((project) => (
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
                    issueProposal.projectId &&
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
            ) : issueProposal.projectId &&
              issueProposal.resultRunId &&
              !proposalBatch &&
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
          onDelete={isSelf && !message.deletedAt ? onDelete : undefined}
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
        {showTypingState ? (
          <ChannelTypingState
            agentNames={typingAgentNames}
            activityByAgentName={typingActivityByAgentName}
          />
        ) : null}
      </div>
    </article>
  );
}, (previous, next) =>
  previous.acceptingProposal === next.acceptingProposal &&
  previous.decliningProposal === next.decliningProposal &&
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
  enableSkillCommands = false,
  onInvite,
  onSend,
}: {
  agents: ChannelAgentSummary[];
  members: ChannelMember[];
  currentUserId: string | null;
  channelName: string;
  placeholder?: string;
  busy: boolean;
  enableSkillCommands?: boolean;
  onInvite: () => void;
  onSend: (
    body: string,
    mentions: MentionTarget[],
    attachments: File[],
    attachmentReferences: string[],
    selectedSkill?: ChannelSkillCommandTarget,
  ) => void;
}) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<ProfileTarget | null>(null);
  const {
    activeSkillSuggestionIndex,
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
    pickSkillSuggestion,
    pickSuggestion,
    removeImage,
    setActiveSkillSuggestionIndex,
    setActiveSuggestionIndex,
    showsSkillSuggestions,
    showsSuggestions,
    skillListId,
    skillSuggestions,
    suggestions,
  } = useChannelComposer<HTMLTextAreaElement>({
    agents,
    busy,
    currentUserId,
    enableSkillCommands,
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
      {showsSkillSuggestions ? (
        <ChannelSkillMenu
          activeSuggestionIndex={activeSkillSuggestionIndex}
          ariaLabel={t("agents.skills")}
          id={skillListId}
          onActiveSuggestionIndexChange={setActiveSkillSuggestionIndex}
          onPickSuggestion={pickSkillSuggestion}
          skillLabel={t("agents.skill")}
          suggestions={skillSuggestions}
        />
      ) : null}
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
              showsSkillSuggestions
                ? `${skillListId}-option-${activeSkillSuggestionIndex}`
                : showsSuggestions
                ? `${mentionListId}-option-${activeSuggestionIndex}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={
              showsSkillSuggestions
                ? skillListId
                : showsSuggestions
                  ? mentionListId
                  : undefined
            }
            aria-expanded={showsSkillSuggestions || showsSuggestions}
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
              accept={channelAttachmentAccept}
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
