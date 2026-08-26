import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  CalendarDays,
  FolderPlus,
  Hash,
  House,
  Inbox as InboxIcon,
  Keyboard as KeyboardIcon,
  MessageCircle,
  MessagesSquare,
  PanelLeft,
  Plus,
  Settings,
} from "lucide-react";
import { AgentUsageStatusBar } from "./components/AgentUsageStatusBar";
import { WorkerStatusBar } from "./components/WorkerStatusBar";
import { AppVersionStatus } from "./components/AppVersionStatus";
import { AppSettings } from "./components/AppSettings";
import {
  CompanionBottomNavigation,
  type CompanionStatusFilter,
} from "./components/CompanionBottomNavigation";
import { CompanionEmptyState, CompanionHeader } from "./components/CompanionHeader";
import { CompanionSettings } from "./components/CompanionSettings";
import { ConnectionHealth } from "./components/ConnectionHealth";
import { HuntDashboard, RunPage } from "./components/HuntDashboard";
import { WorkerDispatchDialog } from "./components/WorkerDispatchDialog";
import { Inbox } from "./components/Inbox";
import { InboxDetailPanel } from "./components/InboxDetailPanel";
import { Channels } from "./components/Channels";
import {
  CommandPalette,
  type CommandPaletteItem,
} from "./components/CommandPalette";
import { KeyboardShortcutModeHint } from "./components/KeyboardShortcutModeHint";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { DirectMessages } from "./components/DirectMessages";
import {
  CompanionChannels,
  type CompanionChannelCache,
} from "./components/CompanionChannels";
import { FirstOrganizationSetup } from "./components/FirstOrganizationSetup";
import { FirstRunTutorial } from "./components/FirstRunTutorial";
import { InitialOnboarding } from "./components/InitialOnboarding";
import { InvitationOnboarding } from "./components/InvitationOnboarding";
import { LaunchIntro } from "./components/LaunchIntro";
import { LoginScreen } from "./components/LoginScreen";
import { OrganizationSettings } from "./components/OrganizationSettings";
import { OrganizationCreate } from "./components/OrganizationCreate";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { ProjectLobby } from "./components/ProjectLobby";
import { ProjectAgents } from "./components/ProjectAgents";
import { ProjectIcon } from "./components/ProjectIcon";
import { ProjectAgentSessionDetail } from "./components/ProjectAgentSessionDetail";
import { ProjectSchedule } from "./components/ProjectSchedule";
import { ProjectRepositorySetupDialog } from "./components/ProjectRepositorySetupDialog";
import { ProjectSettings } from "./components/ProjectSettings";
import { SessionLoadingScreen } from "./components/SessionLoadingScreen";
import { LoadingState } from "./components/ui/loading-state";
import { Sidebar } from "./components/Sidebar";
import {
  UnifiedSettingsSidebar,
  type UnifiedSettingsTarget,
} from "./components/UnifiedSettingsSidebar";
import { WindowNavigationControls } from "./components/WindowNavigationControls";
import { useBriar, type UseBriarOptions } from "./hooks/useBriar";
import {
  collapseLinkedAutoHuntSessions,
  useAutoHuntSessions,
} from "./hooks/useAutoHuntSessions";
import { useInbox } from "./hooks/useInbox";
import {
  inboxConversationSyncSignal,
  useInboxNotificationClicks,
  useInboxNotifications,
} from "./hooks/useInboxNotifications";
import { useHorizontalPaneResize } from "./hooks/useHorizontalPaneResize";
import {
  useMobileBackHandler,
  useMobileNavigationGestures,
} from "./hooks/useMobileNavigation";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
import {
  useAppKeyboardCommandScope,
  useAppKeyboardCommandState,
} from "./hooks/appKeyboardCommands";
import { isProjectScheduleTabEnabled } from "./lib/project-tabs";
import {
  clearLaunchIntroPreview,
  isLaunchIntroPreview,
  markLaunchIntroSeen,
  shouldShowLaunchIntro,
} from "./lib/launch-intro";
import {
  hasCompletedInitialOnboarding,
  markInitialOnboardingComplete,
} from "./lib/initial-onboarding";
import {
  leaveOrganizationInvitationRoute,
  loadOrganizationInvitationToken,
} from "./lib/organization-invitation";
import { syncAppBadgeCount } from "./lib/app-badge";
import {
  clampInboxPaneWidth,
  inboxPaneWidthDefault,
  inboxPaneWidthMax,
  inboxPaneWidthMin,
  loadInboxPaneWidth,
  saveInboxPaneWidth,
} from "./lib/inbox-pane-width";
import { DASHBOARD_POLL_INTERVAL_MS } from "./lib/dashboard-polling";
import {
  buildStatusTrayItems,
  buildStatusTraySnapshot,
  listenForStatusTrayOpenRun,
  syncStatusTray,
} from "./lib/status-tray";
import type { MessageKey } from "./i18n/messages";
import {
  inboxNotificationTarget,
  isInboxChannelTarget,
  isInboxRunDetailTarget,
  type InboxNotificationTarget,
} from "./lib/inbox-notifications";
import {
  clearFirstRunTutorialPending,
  hasPendingFirstRunTutorial,
  markFirstRunTutorialPending,
  shouldShowFirstOrganizationSetup as resolveShouldShowFirstOrganizationSetup,
} from "./lib/project-onboarding";
import {
  getMobilePlatform,
  isDesktopTauri,
  isMacDesktopTauri,
  isWebApp,
} from "./lib/platform";
import {
  openProjectWindow,
  readProjectWindowProjectId,
} from "./lib/project-window";
import {
  listenForBriarLinks,
  type BriarLinkTarget,
} from "./lib/issue-links";
import { isRepositoryConnectedForImport } from "./lib/linear-import";
import type { IssueDetailTab } from "./lib/issue-detail-tab";
import { settingsAccountSelection } from "./lib/settings-account-selection";
import { LITELLM_MAIN_PRICING_SOURCE } from "./lib/agent-usage-pricing";
import { createCachedProjectUsageSummaryLoader } from "./lib/project-usage-summary";
import {
  createChannel,
  deleteChannel,
  dispatchHuntRun,
  listChannels,
  loadChannelDelta,
  markChannelRead,
  loadAgentUsageReport,
  loadDashboard,
  loadStatusTrayRuns,
  loadProjectAgents,
  loadProjectUsageSummary,
  runProjectAgentTaskOnWorker,
  retryHuntRun,
} from "./lib/api";
import type {
  ChannelSummary,
  ChannelVisibility,
} from "./lib/channels-contract";
import {
  channelHasUnread,
  laterTimestamp,
  markChannelCatalogRead,
} from "./lib/channel-unread";
import {
  CHANNEL_REALTIME_FALLBACK_MS,
  createChannelRealtimeTransport,
  createInboxRealtimeTransport,
  MAX_CHANNEL_DELTA_PAGES_PER_SYNC,
} from "./lib/channel-realtime";
import { startDesktopChannelTransition } from "./lib/channel-performance";
import { directMessageDisplayName } from "./lib/direct-messages";
import { dispatchAutoHuntToWorkers } from "./lib/auto-hunt-worker-dispatch";
import { demoProjectAgents } from "./lib/demo-project-agents";
import { executeProjectAgentTask } from "./lib/project-agent-execution";
import { runProjectAgent } from "./lib/project-llm";
import type {
  AgentProvider,
  ModelEffort,
  ProjectAgentRunInput,
} from "./lib/project-llm";
import {
  recoveryAgent,
  takePlannedUpdateAgentRecoveries,
} from "./lib/planned-update-recovery";
import {
  formatShortcut,
  isMacPlatform,
  loadKeybindings,
  loadKeyboardNavigationPreferences,
  subscribeKeyboardNavigationPreferences,
} from "./lib/keybindings";
import {
  appKeyboardShortcutSpecs,
  createKeyboardShortcutHelpSections,
  type AppKeyboardShortcutCommandId,
} from "./lib/app-keyboard-shortcuts";
import { hasOpenKeyboardShortcutOverlay } from "./lib/keyboard-shortcuts";
import { formatIssueKey } from "./lib/issue-key";
import { listenForAppMenuSettings } from "./lib/app-menu";
import type { AppZoomCommands } from "./lib/app-zoom";
import {
  channelIdFromNavigationLocation,
  channelNavigationLocation,
  channelPageNavigationLocation,
  isProjectNavigationPage,
  issueNavigationLocation,
  organizationNavigationLocation,
  organizationIdFromNavigationLocation,
  pageFromNavigationLocation,
  projectIdFromNavigationLocation,
  projectNavigationLocation,
  runIdFromNavigationLocation,
  settingsNavigationLocation,
  settingsTargetFromNavigationLocation,
  type ActivePage,
  type AppNavigationLocation,
  type ChannelNavigationPage,
} from "./lib/app-navigation";
import { useI18n } from "./i18n";
import type { HuntRun, ProjectAgent, StatusTrayRun } from "./types";

type AgentAutoHuntOptions = {
  coordinatorConversationId?: string | null;
  parentSessionId?: string;
  maxIssues?: number;
  targetRunIds?: string[];
  retryReason?: string | null;
};

const CHANNEL_CATALOG_RETRY_MS = 3_000;

export function App({
  appZoomCommands = null,
}: {
  readonly appZoomCommands?: AppZoomCommands | null;
}) {
  const { locale, t } = useI18n();
  const [projectWindowProjectId] = useState(readProjectWindowProjectId);
  const autoHunt = useAutoHuntSessions();
  const [invitationToken, setInvitationToken] = useState(
    loadOrganizationInvitationToken,
  );
  const [acceptingInvitation, setAcceptingInvitation] = useState(false);
  const invitationAcceptanceAttemptRef = useRef<string | null>(null);
  const plannedUpdateRecoveryRef = useRef<Promise<void> | null>(null);
  const scheduleSessionOptions = useMemo<UseBriarOptions>(() => ({
    adoptRemoteAgentSession: autoHunt.adoptRemoteSession,
    deferDefaultOrganization: true,
    lockedProjectId: projectWindowProjectId,
    startScheduledAgentSession: (run) =>
      autoHunt.startTaskSession(run.projectId, run.agent.id, {
        agentName: run.agent.name,
        request: run.scheduleName,
        startedAt: run.startedAt,
        trigger: "scheduled",
        scheduleId: run.scheduleId,
        scheduleRunId: run.id,
      }),
    settleScheduledAgentSession: autoHunt.settleTaskSession,
    startScheduledAgentWorkerDispatch: (
      parentSessionId,
      run,
      runs,
      dispatch,
    ) => autoHunt.startWorkerDispatchSession(
      run.projectId,
      run.agent,
      runs,
      {
        ...dispatch,
        parentSessionId,
        startedAt: run.startedAt,
      },
    ),
  }), [
    autoHunt.adoptRemoteSession,
    autoHunt.settleTaskSession,
    autoHunt.startTaskSession,
    autoHunt.startWorkerDispatchSession,
    projectWindowProjectId,
  ]);
  const briar = useBriar(scheduleSessionOptions);
  const [organizationChannels, setOrganizationChannels] = useState<
    ChannelSummary[]
  >([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [requestedChannelSettingsId, setRequestedChannelSettingsId] =
    useState<string | null>(null);
  const [requestedChannelId, setRequestedChannelId] = useState<string | null>(
    null,
  );
  const [requestedChannelMessage, setRequestedChannelMessage] = useState<{
    channelId: string;
    messageId: string;
    rootMessageId: string;
  } | null>(null);
  const [initialChannelInviteId, setInitialChannelInviteId] = useState<string | null>(
    null,
  );
  const [viewingChannelId, setViewingChannelId] = useState<string | null>(null);
  const [viewingChannelThreadRootMessageId, setViewingChannelThreadRootMessageId]
    = useState<string | null>(null);
  const [viewingIssueConversationRunId, setViewingIssueConversationRunId] =
    useState<string | null>(null);
  const handleViewingChannelChange = useCallback(
    (channelId: string | null, threadRootMessageId: string | null = null) => {
      setViewingChannelId(channelId);
      setViewingChannelThreadRootMessageId(
        channelId ? threadRootMessageId : null,
      );
    },
    [],
  );
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelCatalogSnapshot, setChannelCatalogSnapshot] = useState<{
    organizationId: string;
    cursor: number;
  } | null>(null);
  const [channelCatalogRetry, setChannelCatalogRetry] = useState(0);
  const channelCatalogCursorRef = useRef(0);
  const companionChannelCache = useRef<CompanionChannelCache>(new Map());
  useEffect(() => {
    const organizationId = briar.activeOrganizationId;
    const token = briar.token;
    setOrganizationChannels([]);
    setActiveChannelId(null);
    setInitialChannelInviteId(null);
    setRequestedChannelSettingsId(null);
    setRequestedChannelId(null);
    setChannelCatalogSnapshot(null);
    channelCatalogCursorRef.current = 0;
    companionChannelCache.current.clear();
    if (!organizationId || !token) {
      setChannelsLoading(false);
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    setChannelsLoading(true);
    void listChannels(token, organizationId)
      .then((result) => {
        if (!cancelled) {
          channelCatalogCursorRef.current = result.cursor;
          setChannelCatalogSnapshot({ organizationId, cursor: result.cursor });
          setOrganizationChannels(result.channels);
        }
      })
      .catch(() => {
        // The conversation view reports request errors when opened. Keep the
        // sidebar usable so channel creation can still be retried.
        if (!cancelled) {
          retryTimer = window.setTimeout(
            () => setChannelCatalogRetry((retry) => retry + 1),
            CHANNEL_CATALOG_RETRY_MS,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setChannelsLoading(false);
      });
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [briar.activeOrganizationId, briar.token, channelCatalogRetry]);
  useEffect(() => {
    const organizationId = briar.activeOrganizationId;
    const token = briar.token;
    if (
      !organizationId ||
      !token ||
      channelCatalogSnapshot?.organizationId !== organizationId
    ) return;

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
            const requestedCursor = channelCatalogCursorRef.current;
            const delta = await loadChannelDelta(
              token,
              organizationId,
              requestedCursor,
              abortController.signal,
            );
            if (stopped || requestedCursor !== channelCatalogCursorRef.current) {
              return;
            }
            channelCatalogCursorRef.current = delta.cursor;
            if (delta.channels.length || delta.removedChannelIds.length) {
              setOrganizationChannels((current) => {
                const byId = new Map(
                  current.map((channel) => [channel.id, channel]),
                );
                for (const channel of delta.channels) byId.set(channel.id, channel);
                for (const id of delta.removedChannelIds) byId.delete(id);
                return [...byId.values()].sort((left, right) =>
                  left.name.localeCompare(right.name)
                );
              });
            }
            if (!delta.hasMore || delta.cursor <= requestedCursor) break;
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn("Channel catalog delta refresh failed", error);
        }
      } finally {
        inFlight = false;
        if (pending && !stopped) window.queueMicrotask(() => void sync());
      }
    };
    const unsubscribe = transport.subscribe((notification) => {
      if (
        notification.topic === "channels" &&
        notification.cursor > channelCatalogCursorRef.current
      ) {
        void sync();
      }
    });
    const updateVisibility = () => {
      if (document.hidden) transport.stop();
      else {
        transport.start();
        void sync();
      }
    };
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    const interval = window.setInterval(() => {
      if (!document.hidden) void sync();
    }, CHANNEL_REALTIME_FALLBACK_MS);
    return () => {
      stopped = true;
      unsubscribe();
      transport.stop();
      abortController.abort();
      document.removeEventListener("visibilitychange", updateVisibility);
      window.clearInterval(interval);
    };
  }, [
    briar.activeOrganizationId,
    briar.token,
    channelCatalogSnapshot?.organizationId,
  ]);
  const markOrganizationChannelRead = useCallback(
    (channelId: string) => {
      const token = briar.token;
      const organizationId = briar.activeOrganizationId;
      if (!token || !organizationId) return;
      const channel = organizationChannels.find((item) => item.id === channelId);
      if (!channel || !channelHasUnread(channel)) return;
      const lastReadAt = laterTimestamp(
        channel.lastMessageAt,
        new Date().toISOString(),
      );
      setOrganizationChannels((current) =>
        markChannelCatalogRead(current, channelId, lastReadAt),
      );
      void markChannelRead(token, organizationId, channelId, { lastReadAt })
        .catch(() => {
          // The next catalog snapshot restores unread if the write failed.
        });
    },
    [briar.activeOrganizationId, briar.token, organizationChannels],
  );
  const [statusTrayRuns, setStatusTrayRuns] = useState<StatusTrayRun[]>([]);
  const loadUsageReport = useCallback(async () => {
    if (!briar.token || !briar.activeOrganizationId) {
      return {
        runs: [],
        generatedAt: new Date().toISOString(),
        pricing: {
          status: "unavailable" as const,
          source: LITELLM_MAIN_PRICING_SOURCE,
          fetchedAt: null,
          knownModels: 0,
        },
      };
    }
    return loadAgentUsageReport(
      briar.token,
      briar.activeOrganizationId,
      90,
    );
  }, [briar.activeOrganizationId, briar.token]);
  const loadProjectHomeUsage = useMemo(
    () => createCachedProjectUsageSummaryLoader(async (projectId, period) => {
      if (!briar.token) return null;
      return loadProjectUsageSummary(briar.token, projectId, period);
    }),
    [briar.token],
  );
  useEffect(() => {
    autoHunt.configureSync(
      briar.token,
      briar.projects.map((project) => ({
        id: project.id,
        organizationId: project.organizationId,
      })),
    );
  }, [autoHunt.configureSync, briar.projects, briar.token]);
  useEffect(() => {
    if (!briar.dashboard) return;
    autoHunt.reconcileWorkerDispatches(
      briar.dashboard.project.id,
      briar.dashboard.runs,
    );
  }, [autoHunt.reconcileWorkerDispatches, briar.dashboard]);
  const inboxRealtime = useMemo(
    () =>
      briar.token && briar.activeOrganizationId && briar.user?.id
        ? createInboxRealtimeTransport(
            briar.token,
            briar.activeOrganizationId,
          )
        : null,
    [briar.activeOrganizationId, briar.token, briar.user?.id],
  );
  const inbox = useInbox(
    briar.user?.id ?? null,
    briar.activeOrganizationId,
    briar.dashboard,
    autoHunt.sessions,
    briar.projects,
    briar.token,
    inboxRealtime,
  );
  const visibleInboxMessages = useMemo(
    () =>
      projectWindowProjectId
        ? inbox.messages.filter(
            (message) => message.projectId === projectWindowProjectId,
          )
        : inbox.messages,
    [inbox.messages, projectWindowProjectId],
  );
  const visibleInboxUnreadCount = useMemo(
    () => visibleInboxMessages.filter((message) => message.isUnread).length,
    [visibleInboxMessages],
  );
  const markInboxIssueRead = useCallback(
    (runId: string) => inbox.markIssueRead(runId),
    [inbox.markIssueRead],
  );
  const channelInboxSyncSignal = useMemo(
    () => inboxConversationSyncSignal(inbox.messages, "channel"),
    [inbox.messages],
  );
  const conversationInboxSyncSignal = useMemo(
    () => inboxConversationSyncSignal(inbox.messages, "conversation"),
    [inbox.messages],
  );
  useInboxNotifications(
    projectWindowProjectId ? null : (briar.user?.id ?? null),
    briar.activeOrganizationId,
    inbox.messages,
    inbox.notificationBaselineId,
    viewingChannelId,
    viewingChannelThreadRootMessageId,
    viewingIssueConversationRunId,
    inbox.initialSyncComplete,
  );
  useEffect(() => {
    if (projectWindowProjectId) return;
    void syncAppBadgeCount(inbox.unreadCount).catch(() => {
      // An unsupported desktop environment or Android launcher must not block the app.
    });
  }, [inbox.unreadCount, projectWindowProjectId]);
  const mobilePlatform = getMobilePlatform() ?? "android";
  const previewsLaunchIntro = isLaunchIntroPreview();
  const runsOnDesktopTauri = isDesktopTauri();
  const runsOnMacDesktop = isMacDesktopTauri();
  const runsOnWeb = isWebApp();
  useEffect(() => {
    if (!runsOnMacDesktop || projectWindowProjectId) return;
    const dashboard = briar.dashboard;
    if (!dashboard) return;
    const projectRuns: StatusTrayRun[] = dashboard.runs
      .filter((run) => run.status === "running")
      .map((run) => ({
        projectId: dashboard.project.id,
        projectName: dashboard.project.name,
        id: run.id,
        title: run.title,
        status: "running",
        workflowStage: run.workflowStage,
        workflowStageLabel:
          run.workflow.stages.find((stage) => stage.id === run.workflowStage)
            ?.label ?? null,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
        lastEventAt: run.lastEventAt,
      }));
    setStatusTrayRuns((current) => [
      ...current.filter((run) => run.projectId !== dashboard.project.id),
      ...projectRuns,
    ]);
  }, [briar.dashboard, projectWindowProjectId, runsOnMacDesktop]);
  useEffect(() => {
    if (!runsOnMacDesktop || projectWindowProjectId) return;
    const token = briar.token;
    const organizationId = briar.activeOrganizationId;
    if (!token || !organizationId) {
      setStatusTrayRuns([]);
      return;
    }
    setStatusTrayRuns([]);
    let cancelled = false;
    let timer: number | null = null;
    let request: AbortController | null = null;
    const refreshStatusTray = async () => {
      request = new AbortController();
      try {
        const result = await loadStatusTrayRuns(
          token,
          organizationId,
          request.signal,
        );
        if (!cancelled) setStatusTrayRuns(result.runs);
      } catch {
        // Keep the last known tray projection across transient network errors.
      } finally {
        request = null;
        if (!cancelled) {
          timer = window.setTimeout(
            () => void refreshStatusTray(),
            DASHBOARD_POLL_INTERVAL_MS,
          );
        }
      }
    };

    void refreshStatusTray();
    return () => {
      cancelled = true;
      request?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    briar.activeOrganizationId,
    briar.token,
    projectWindowProjectId,
    runsOnMacDesktop,
  ]);
  useEffect(() => {
    if (!runsOnMacDesktop || projectWindowProjectId) return;
    const items = buildStatusTrayItems(
      statusTrayRuns,
      {
        untitledTitle: t("statusTray.untitledIssue"),
        localizeStatus: (fallback, run) => {
          if (run.status === "running" && run.workflowStage) {
            const stageKey = `stage.${run.workflowStage}` as MessageKey;
            const localized = t(stageKey);
            if (localized && localized !== stageKey) return localized;
            return run.workflowStageLabel ?? fallback;
          }
          const statusKey = `status.${run.status}` as MessageKey;
          const localized = t(statusKey);
          return localized && localized !== statusKey ? localized : fallback;
        },
      },
    );
    const snapshot = buildStatusTraySnapshot(items, {
      runningLabel: t("statusTray.running"),
      emptyLabel: t("statusTray.empty"),
      openLabel: t("statusTray.openBriar"),
      quitLabel: t("statusTray.quitBriar"),
      moreLabel: t("statusTray.more"),
    });
    void syncStatusTray(snapshot).catch(() => {
      // Tray bridge may be unavailable outside the packaged macOS app.
    });
  }, [
    locale,
    projectWindowProjectId,
    runsOnMacDesktop,
    statusTrayRuns,
    t,
  ]);
  useEffect(() => {
    if (!runsOnDesktopTauri || projectWindowProjectId) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("sync_execution_worker_labels"))
      .catch(() => {
        // Offline startup must not block the rest of the desktop app.
      });
  }, [projectWindowProjectId, runsOnDesktopTauri]);
  // Preview changes the timing, not the macOS presentation surface.
  const usesNativeLaunchIntro = isMacDesktopTauri();
  const [isLaunchIntroVisible, setIsLaunchIntroVisible] = useState(
    () =>
      !runsOnWeb &&
      !projectWindowProjectId &&
      !usesNativeLaunchIntro &&
      (previewsLaunchIntro || shouldShowLaunchIntro()),
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] =
    useState("");
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] =
    useState(false);
  const [sequenceShortcutsEnabled, setSequenceShortcutsEnabled] = useState(
    () => loadKeyboardNavigationPreferences().sequenceShortcutsEnabled,
  );
  const {
    containerRef: inboxLayoutRef,
    effectiveWidth: inboxDetailPaneWidth,
    isResizing: isResizingInbox,
    separatorProps: inboxResizeProps,
  } = useHorizontalPaneResize({
    clamp: clampInboxPaneWidth,
    defaultWidth: inboxPaneWidthDefault,
    load: loadInboxPaneWidth,
    max: inboxPaneWidthMax,
    min: inboxPaneWidthMin,
    save: saveInboxPaneWidth,
  });
  const [settingsTarget, setSettingsTarget] =
    useState<UnifiedSettingsTarget>({
      scope: "application",
      section: "source-control",
    });
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    hasCompletedInitialOnboarding,
  );
  const [pendingFirstRunTutorialUserId, setPendingFirstRunTutorialUserId] =
    useState<string | null>(null);
  const [developerToolsProjectSetupRequested, setDeveloperToolsProjectSetupRequested] =
    useState(false);
  const {
    current: activeNavigationLocation,
    canGoBack,
    canGoForward,
    goBack,
    goBackTo,
    goForward,
    navigate: navigateToLocation,
    replace: replaceNavigationLocation,
    reset: resetNavigationLocation,
  } = useNavigationHistory<AppNavigationLocation>("lobby");
  const activePage = pageFromNavigationLocation(activeNavigationLocation);
  const selectedRunId = runIdFromNavigationLocation(activeNavigationLocation);
  const navigationProjectId = projectIdFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationOrganizationId = organizationIdFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationChannelId = channelIdFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationSettingsTarget = settingsTargetFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationHasChannelPageContext =
    (activePage === "channels" || activePage === "dms") &&
    navigationOrganizationId !== null;
  const desktopActiveChannelId = navigationHasChannelPageContext
    ? navigationChannelId
    : activeChannelId;
  const navigationActiveProjectIdRef = useRef(briar.activeProjectId);
  navigationActiveProjectIdRef.current = briar.activeProjectId;
  const navigateToPage = useCallback(
    (
      page: ActivePage,
      projectId = navigationActiveProjectIdRef.current,
    ) =>
      navigateToLocation(
        page === "inbox" && briar.activeOrganizationId
          ? organizationNavigationLocation(briar.activeOrganizationId)
          : (page === "channels" || page === "dms") &&
          briar.activeOrganizationId
          ? channelPageNavigationLocation(
              page,
              briar.activeOrganizationId,
              projectId,
            )
          : projectId && isProjectNavigationPage(page)
            ? projectNavigationLocation(page, projectId)
            : page,
      ),
    [briar.activeOrganizationId, navigateToLocation],
  );
  const closeSettings = useCallback(() => {
    const projectId = navigationActiveProjectIdRef.current;
    goBackTo(
      (location) => pageFromNavigationLocation(location) !== "settings",
      projectId ? projectNavigationLocation("issues", projectId) : "issues",
    );
  }, [goBackTo]);
  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      closeSettings: {
        isAvailable: () =>
          activePage === "settings" &&
          !briar.companionMode &&
          !hasOpenKeyboardShortcutOverlay(document),
        run: () => {
          closeSettings();
          return "handled";
        },
      },
    },
    id: "settings-page",
    priority: 100,
  });
  const navigateToIssue = useCallback(
    (runId: string, projectId = navigationActiveProjectIdRef.current) => {
      if (!projectId) return;
      navigateToLocation(issueNavigationLocation(projectId, runId));
    },
    [navigateToLocation],
  );
  const navigateToChannel = useCallback(
    (
      channelId: string,
      page: ChannelNavigationPage,
      organizationId = briar.activeOrganizationId,
      projectId = navigationActiveProjectIdRef.current,
    ) => {
      if (!organizationId) return;
      startDesktopChannelTransition(channelId);
      setActiveChannelId(channelId);
      markOrganizationChannelRead(channelId);
      navigateToLocation(
        channelNavigationLocation(
          page,
          organizationId,
          channelId,
          projectId,
        ),
      );
    },
    [
      briar.activeOrganizationId,
      markOrganizationChannelRead,
      navigateToLocation,
    ],
  );
  const replaceChannelDestination = useCallback(
    (
      channelId: string | null,
      page: ChannelNavigationPage,
      organizationId = briar.activeOrganizationId,
      projectId = navigationActiveProjectIdRef.current,
    ) => {
      setActiveChannelId(channelId);
      if (!channelId || !organizationId) {
        replaceNavigationLocation(
          organizationId
            ? channelPageNavigationLocation(page, organizationId, projectId)
            : page,
        );
        return;
      }
      startDesktopChannelTransition(channelId);
      markOrganizationChannelRead(channelId);
      replaceNavigationLocation(
        channelNavigationLocation(
          page,
          organizationId,
          channelId,
          projectId,
        ),
      );
    },
    [
      briar.activeOrganizationId,
      markOrganizationChannelRead,
      replaceNavigationLocation,
    ],
  );
  const handleDesktopChannelFallback = useCallback(
    (channelId: string | null, page: ChannelNavigationPage) => {
      if (
        navigationChannelId &&
        navigationOrganizationId !== briar.activeOrganizationId
      ) {
        return;
      }
      replaceChannelDestination(
        channelId,
        page,
        navigationOrganizationId ?? briar.activeOrganizationId,
        navigationProjectId ?? navigationActiveProjectIdRef.current,
      );
    },
    [
      briar.activeOrganizationId,
      navigationChannelId,
      navigationOrganizationId,
      navigationProjectId,
      replaceChannelDestination,
    ],
  );
  const resetNavigation = useCallback(
    (page: ActivePage) => resetNavigationLocation(page),
    [resetNavigationLocation],
  );
  const navigationUserIdRef = useRef<string | null | undefined>(undefined);
  const navigationUserId = briar.user?.id ?? null;
  const navigationUserBoundaryChanged =
    navigationUserIdRef.current !== undefined &&
    navigationUserIdRef.current !== navigationUserId;
  useEffect(() => {
    if (navigationUserIdRef.current === undefined) {
      navigationUserIdRef.current = navigationUserId;
      return;
    }
    if (navigationUserIdRef.current === navigationUserId) return;
    navigationUserIdRef.current = navigationUserId;
    resetNavigation("lobby");
  }, [navigationUserId, resetNavigation]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      briar.companionMode ||
      activePage !== "settings"
    ) {
      return;
    }
    if (navigationSettingsTarget) {
      setSettingsTarget((current) =>
        settingsNavigationLocation(current) === activeNavigationLocation
          ? current
          : navigationSettingsTarget,
      );
      return;
    }
    replaceNavigationLocation(settingsNavigationLocation(settingsTarget));
  }, [
    activeNavigationLocation,
    activePage,
    briar.companionMode,
    navigationSettingsTarget,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
    settingsTarget,
  ]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      briar.companionMode ||
      !briar.user ||
      navigationProjectId ||
      !briar.activeProjectId ||
      !isProjectNavigationPage(activePage)
    ) {
      return;
    }
    replaceNavigationLocation(
      projectNavigationLocation(activePage, briar.activeProjectId),
    );
  }, [
    activePage,
    briar.activeProjectId,
    briar.companionMode,
    briar.user,
    navigationProjectId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      briar.companionMode ||
      !navigationProjectId
    ) {
      return;
    }
    const navigationProjectExists = briar.projects.some(
      (project) => project.id === navigationProjectId,
    );
    if (navigationProjectExists) {
      if (navigationProjectId !== briar.activeProjectId) {
        briar.setActiveProjectId(navigationProjectId);
      }
      return;
    }
    if (briar.loading || !briar.user) return;

    if (
      (activePage === "channels" || activePage === "dms") &&
      navigationOrganizationId
    ) {
      const fallbackProject = briar.projects.find(
        (project) =>
          project.organizationId === navigationOrganizationId &&
          project.id === briar.activeProjectId,
      ) ?? briar.projects.find(
        (project) => project.organizationId === navigationOrganizationId,
      );
      replaceNavigationLocation(
        navigationChannelId
          ? channelNavigationLocation(
              activePage,
              navigationOrganizationId,
              navigationChannelId,
              fallbackProject?.id,
            )
          : channelPageNavigationLocation(
              activePage,
              navigationOrganizationId,
              fallbackProject?.id,
            ),
      );
      return;
    }
    if (activePage === "settings") {
      replaceNavigationLocation(
        settingsNavigationLocation({
          scope: "application",
          section: "account",
        }),
      );
      return;
    }
    const fallbackProject =
      briar.projects.find(
        (project) => project.id === briar.activeProjectId,
      ) ?? briar.projects[0];
    replaceNavigationLocation(
      fallbackProject && isProjectNavigationPage(activePage)
        ? projectNavigationLocation(activePage, fallbackProject.id)
        : "lobby",
    );
  }, [
    activePage,
    briar.activeProjectId,
    briar.companionMode,
    briar.loading,
    briar.projects,
    briar.setActiveProjectId,
    briar.user,
    navigationChannelId,
    navigationOrganizationId,
    navigationProjectId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      briar.companionMode ||
      !navigationOrganizationId
    ) return;
    const navigationOrganizationExists = briar.organizations.some(
      (organization) => organization.id === navigationOrganizationId,
    );
    if (!navigationOrganizationExists) {
      if (briar.loading || !briar.user) return;
      const fallbackOrganization =
        briar.organizations.find(
          (organization) => organization.id === briar.activeOrganizationId,
        ) ?? briar.organizations[0];
      if (!fallbackOrganization) {
        replaceNavigationLocation("lobby");
        return;
      }
      if (activePage === "channels" || activePage === "dms") {
        const fallbackProject = briar.projects.find(
          (project) =>
            project.organizationId === fallbackOrganization.id &&
            project.id === briar.activeProjectId,
        ) ?? briar.projects.find(
          (project) => project.organizationId === fallbackOrganization.id,
        );
        replaceNavigationLocation(
          channelPageNavigationLocation(
            activePage,
            fallbackOrganization.id,
            fallbackProject?.id,
          ),
        );
      } else if (activePage === "inbox") {
        replaceNavigationLocation(
          organizationNavigationLocation(fallbackOrganization.id),
        );
      } else {
        replaceNavigationLocation(
          settingsNavigationLocation({
            scope: "application",
            section: "account",
          }),
        );
      }
      return;
    }
    if (navigationOrganizationId !== briar.activeOrganizationId) {
      briar.setActiveOrganizationId(navigationOrganizationId);
      return;
    }
    if (!navigationChannelId) {
      if (navigationHasChannelPageContext && activeChannelId !== null) {
        setActiveChannelId(null);
      }
      return;
    }
    if (activeChannelId !== navigationChannelId) {
      startDesktopChannelTransition(navigationChannelId);
      setActiveChannelId(navigationChannelId);
    }
    markOrganizationChannelRead(navigationChannelId);
  }, [
    activeChannelId,
    briar.activeOrganizationId,
    briar.activeProjectId,
    briar.companionMode,
    briar.loading,
    briar.organizations,
    briar.projects,
    briar.setActiveOrganizationId,
    briar.user,
    activePage,
    markOrganizationChannelRead,
    navigationChannelId,
    navigationHasChannelPageContext,
    navigationOrganizationId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);
  const activeProjectForTabs = briar.projects.find(
    (project) =>
      project.id === (navigationProjectId ?? briar.activeProjectId),
  );
  useEffect(() => {
    if (
      !navigationUserBoundaryChanged &&
      activePage === "schedule" &&
      !isProjectScheduleTabEnabled(activeProjectForTabs)
    ) {
      replaceNavigationLocation(
        activeProjectForTabs
          ? projectNavigationLocation("issues", activeProjectForTabs.id)
          : "issues",
      );
    }
  }, [
    activePage,
    activeProjectForTabs,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      briar.companionMode ||
      !selectedRunId ||
      !navigationProjectId ||
      briar.dashboard?.project.id !== navigationProjectId ||
      briar.dashboard.runs.some((run) => run.id === selectedRunId)
    ) {
      return;
    }
    replaceNavigationLocation(
      projectNavigationLocation("issues", navigationProjectId),
    );
  }, [
    briar.companionMode,
    briar.dashboard,
    navigationProjectId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
    selectedRunId,
  ]);
  const createOrganizationChannel = useCallback(
    async (
      name: string,
      visibility: ChannelVisibility,
      defaultProjectId?: string | null,
    ) => {
      if (!briar.activeOrganizationId || !briar.token) {
        throw new Error("Organization is not available");
      }
      const result = await createChannel(
        briar.token,
        briar.activeOrganizationId,
        { name, visibility, defaultProjectId },
      );
      setOrganizationChannels((current) =>
        [
          ...current.filter((channel) => channel.id !== result.channel.id),
          result.channel,
        ].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setInitialChannelInviteId(result.channel.id);
      navigateToChannel(
        result.channel.id,
        "channels",
        briar.activeOrganizationId,
      );
    },
    [
      briar.activeOrganizationId,
      briar.token,
      navigateToChannel,
    ],
  );
  const openOrganizationChannel = useCallback(
    (channelId: string) => {
      if (!briar.activeOrganizationId) return;
      if (
        projectWindowProjectId &&
        organizationChannels.find((channel) => channel.id === channelId)
          ?.defaultProjectId !== projectWindowProjectId
      ) return;
      navigateToChannel(
        channelId,
        organizationChannels.find((channel) => channel.id === channelId)
          ?.kind === "dm"
          ? "dms"
          : "channels",
      );
    },
    [
      briar.activeOrganizationId,
      navigateToChannel,
      organizationChannels,
      projectWindowProjectId,
    ],
  );
  const openOrganizationChannelSettings = useCallback(
    (channelId: string) => {
      setRequestedChannelSettingsId(channelId);
      openOrganizationChannel(channelId);
    },
    [openOrganizationChannel],
  );
  const deleteOrganizationChannel = useCallback(
    async (channelId: string) => {
      if (!briar.activeOrganizationId || !briar.token) {
        throw new Error("Organization is not available");
      }
      await deleteChannel(briar.token, briar.activeOrganizationId, channelId);
      setOrganizationChannels((current) =>
        current.filter((channel) => channel.id !== channelId),
      );
      setRequestedChannelMessage((current) =>
        current?.channelId === channelId ? null : current,
      );
      setRequestedChannelSettingsId((current) =>
        current === channelId ? null : current,
      );
      if (activeChannelId === channelId) {
        setActiveChannelId(null);
        navigateToPage("lobby");
      }
    },
    [
      activeChannelId,
      briar.activeOrganizationId,
      briar.token,
      navigateToPage,
    ],
  );
  const [pendingBriarLink, setPendingBriarLink] =
    useState<BriarLinkTarget | null>(null);
  const [pendingInboxNotificationTarget, setPendingInboxNotificationTarget] =
    useState<InboxNotificationTarget | null>(null);
  const [inboxDetailTarget, setInboxDetailTarget] =
    useState<InboxNotificationTarget | null>(null);
  const handleInboxNotificationClick = useCallback(
    (target: InboxNotificationTarget) => {
      if (!projectWindowProjectId) setPendingInboxNotificationTarget(target);
    },
    [projectWindowProjectId],
  );
  useInboxNotificationClicks(handleInboxNotificationClick);
  const [requestedRunId, setRequestedRunId] = useState<string | null>(null);
  const [requestedRunInitialTab, setRequestedRunInitialTab] =
    useState<IssueDetailTab | null>(null);
  const clearRequestedChannelMessage = useCallback(
    () => setRequestedChannelMessage(null),
    [],
  );
  const [issueListRequestKey, setIssueListRequestKey] = useState(0);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(
    null,
  );
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [createIssueProjectId, setCreateIssueProjectId] = useState<string | null>(
    null,
  );
  const [quickStartingRunId, setQuickStartingRunId] = useState<string | null>(
    null,
  );
  const [quickProcessError, setQuickProcessError] = useState<string | null>(
    null,
  );
  const [completedDispatchRunId, setCompletedDispatchRunId] = useState<
    string | null
  >(null);
  const [dispatchRun, setDispatchRun] = useState<HuntRun | null>(null);
  const [companionPage, setCompanionPage] = useState<
    "issues" | "dms" | "home" | "inbox" | "settings"
  >("issues");
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatusFilter>("all");
  useEffect(
    () =>
      projectWindowProjectId
        ? undefined
        : listenForBriarLinks(setPendingBriarLink),
    [projectWindowProjectId],
  );
  useEffect(() => {
    if (!runsOnMacDesktop || projectWindowProjectId) return;
    return listenForStatusTrayOpenRun((payload) => {
      setPendingBriarLink({
        kind: "issue",
        projectId: payload.projectId,
        runId: payload.runId,
      });
    });
  }, [projectWindowProjectId, runsOnMacDesktop]);
  useEffect(() => {
    if (!pendingBriarLink || !briar.user || briar.loading) return;
    if (pendingBriarLink.kind === "channel") {
      if (
        !briar.organizations.some(
          (organization) => organization.id === pendingBriarLink.organizationId,
        )
      ) {
        return;
      }
      if (pendingBriarLink.organizationId !== briar.activeOrganizationId) {
        briar.setActiveOrganizationId(pendingBriarLink.organizationId);
        return;
      }
      if (
        channelsLoading ||
        channelCatalogSnapshot?.organizationId !==
          pendingBriarLink.organizationId
      ) {
        return;
      }
      setRequestedRunInitialTab(null);
      setRequestedRunId(null);
      setRequestedSessionId(null);
      setRequestedChannelMessage(
        pendingBriarLink.messageId && pendingBriarLink.rootMessageId
          ? {
              channelId: pendingBriarLink.channelId,
              messageId: pendingBriarLink.messageId,
              rootMessageId: pendingBriarLink.rootMessageId,
            }
          : null,
      );
      setRequestedChannelId(
        briar.companionMode &&
          !(pendingBriarLink.messageId && pendingBriarLink.rootMessageId)
          ? pendingBriarLink.channelId
          : null,
      );
      setActiveChannelId(pendingBriarLink.channelId);
      markOrganizationChannelRead(pendingBriarLink.channelId);
      if (briar.companionMode) {
        setCompanionPage(
          organizationChannels.find(
              (channel) => channel.id === pendingBriarLink.channelId,
            )?.kind === "dm"
            ? "dms"
            : "home",
        );
      } else {
        navigateToChannel(
          pendingBriarLink.channelId,
          organizationChannels.find(
            (channel) => channel.id === pendingBriarLink.channelId,
          )?.kind === "dm"
            ? "dms"
            : "channels",
          pendingBriarLink.organizationId,
        );
      }
      setPendingBriarLink(null);
      return;
    }
    if (
      !briar.projects.some(
        (project) => project.id === pendingBriarLink.projectId,
      )
    ) {
      return;
    }

    if (pendingBriarLink.projectId !== briar.activeProjectId) {
      briar.setActiveProjectId(pendingBriarLink.projectId);
    }
    if (pendingBriarLink.kind === "issue") {
      setRequestedSessionId(null);
      setRequestedRunInitialTab(null);
      setRequestedRunId(pendingBriarLink.runId);
      setCompanionPage("issues");
      setCompanionStatus("all");
      navigateToIssue(pendingBriarLink.runId, pendingBriarLink.projectId);
    } else {
      setRequestedRunInitialTab(null);
      setRequestedRunId(null);
      setRequestedSessionId(pendingBriarLink.sessionId);
      if (briar.companionMode) setCompanionPage("dms");
      else navigateToPage("agents", pendingBriarLink.projectId);
    }
    setPendingBriarLink(null);
  }, [
    briar.activeOrganizationId,
    briar.activeProjectId,
    briar.companionMode,
    briar.loading,
    briar.organizations,
    briar.projects,
    briar.setActiveOrganizationId,
    briar.setActiveProjectId,
    briar.user,
    channelCatalogSnapshot?.organizationId,
    channelsLoading,
    markOrganizationChannelRead,
    navigateToChannel,
    navigateToIssue,
    navigateToPage,
    organizationChannels,
    pendingBriarLink,
  ]);
  useEffect(() => {
    if (!pendingInboxNotificationTarget || !briar.user || briar.loading) return;
    const targetProject = briar.projects.find(
      (project) => project.id === pendingInboxNotificationTarget.projectId,
    );
    if (!targetProject) return;

    inbox.markRead(pendingInboxNotificationTarget.messageId);
    if (pendingInboxNotificationTarget.projectId !== briar.activeProjectId) {
      briar.setActiveProjectId(pendingInboxNotificationTarget.projectId);
      return;
    }
    if (
      pendingInboxNotificationTarget.kind === "channel" &&
      (channelsLoading ||
        channelCatalogSnapshot?.organizationId !== targetProject.organizationId)
    ) {
      return;
    }
    if (
      pendingInboxNotificationTarget.kind === "issue" ||
      pendingInboxNotificationTarget.kind === "conversation"
    ) {
      setRequestedSessionId(null);
      setRequestedRunInitialTab(
        pendingInboxNotificationTarget.kind === "conversation"
          ? "conversation"
          : null,
      );
      setRequestedRunId(pendingInboxNotificationTarget.targetId);
      if (briar.companionMode) {
        setCompanionStatus("all");
        setCompanionPage("issues");
      } else {
        navigateToIssue(
          pendingInboxNotificationTarget.targetId,
          pendingInboxNotificationTarget.projectId,
        );
      }
    } else if (pendingInboxNotificationTarget.kind === "channel") {
      const { channelMessageId, rootMessageId } = pendingInboxNotificationTarget;
      if (!channelMessageId || !rootMessageId) return;
      setRequestedRunInitialTab(null);
      setRequestedRunId(null);
      setRequestedSessionId(null);
      setRequestedChannelMessage({
        channelId: pendingInboxNotificationTarget.targetId,
        messageId: channelMessageId,
        rootMessageId,
      });
      setActiveChannelId(pendingInboxNotificationTarget.targetId);
      markOrganizationChannelRead(pendingInboxNotificationTarget.targetId);
      if (briar.companionMode) {
        setCompanionPage(
          organizationChannels.find(
              (channel) => channel.id === pendingInboxNotificationTarget.targetId,
            )?.kind === "dm"
            ? "dms"
            : "home",
        );
      } else {
        navigateToChannel(
          pendingInboxNotificationTarget.targetId,
          organizationChannels.find(
            (channel) => channel.id === pendingInboxNotificationTarget.targetId,
          )?.kind === "dm"
            ? "dms"
            : "channels",
          targetProject.organizationId,
          targetProject.id,
        );
      }
    } else {
      setRequestedRunInitialTab(null);
      setRequestedRunId(null);
      setRequestedSessionId(pendingInboxNotificationTarget.targetId);
      if (briar.companionMode) setCompanionPage("dms");
      else navigateToPage(
        "agents",
        pendingInboxNotificationTarget.projectId,
      );
    }
    setPendingInboxNotificationTarget(null);
  }, [
    briar.activeProjectId,
    briar.companionMode,
    briar.loading,
    briar.projects,
    briar.setActiveProjectId,
    briar.user,
    channelCatalogSnapshot?.organizationId,
    channelsLoading,
    inbox.markRead,
    markOrganizationChannelRead,
    navigateToChannel,
    navigateToIssue,
    navigateToPage,
    organizationChannels,
    pendingInboxNotificationTarget,
  ]);
  useMobileNavigationGestures(briar.companionMode);
  useMobileBackHandler(
    () => {
      if (briar.companionMode && requestedSessionId) {
        setRequestedSessionId(null);
        return true;
      }
      if (!briar.companionMode || companionPage === "issues") return false;
      setCompanionPage("issues");
      setRequestedRunId(null);
      setRequestedSessionId(null);
      return true;
    },
    { enabled: briar.companionMode },
  );
  const [repositorySetupProjectId, setRepositorySetupProjectId] =
    useState<string | null>(null);
  const hasCompactedWindowForOnboarding = useRef(false);
  const activeProject = briar.projects.find(
    (project) => project.id === briar.activeProjectId,
  );
  const projectWindowProject = projectWindowProjectId
    ? briar.projects.find((project) => project.id === projectWindowProjectId) ?? null
    : null;
  const activeOrganization = briar.organizations.find(
    (organization) => organization.id === briar.activeOrganizationId,
  );
  const visibleProjects = projectWindowProjectId
    ? projectWindowProject
      ? [projectWindowProject]
      : []
    : briar.projects;
  const activeOrganizationProjects = projectWindowProjectId
    ? visibleProjects
    : briar.projects.filter(
        (project) =>
          project.organizationId === briar.activeOrganizationId ||
          project.id === briar.activeProjectId,
      );
  const visibleOrganizationChannels = projectWindowProjectId
    ? organizationChannels.filter(
        (channel) =>
          channel.kind !== "dm" &&
          channel.defaultProjectId === projectWindowProjectId,
      )
    : organizationChannels.filter((channel) => channel.kind !== "dm");
  const organizationDirectMessages = projectWindowProjectId
    ? []
    : organizationChannels.filter((channel) => channel.kind === "dm");
  const unreadDirectMessageCount = organizationDirectMessages.filter(
    channelHasUnread,
  ).length;
  const visibleOrganizations = projectWindowProjectId
    ? projectWindowProject?.organizationId
      ? briar.organizations.filter(
          (organization) =>
            organization.id === projectWindowProject.organizationId,
        )
      : []
    : briar.organizations;
  const openProjectInNewWindow = useCallback(
    async (projectId: string) => {
      const project = briar.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error("Project is no longer available.");
      await openProjectWindow(project);
    },
    [briar.projects],
  );
  const requestedCompanionSession = briar.companionMode
    ? autoHunt.sessions.find(
        (session) => session.id === requestedSessionId,
      ) ?? null
    : null;
  const inboxDetailChannelId =
    inboxDetailTarget?.kind === "channel"
      ? inboxDetailTarget.targetId
      : null;
  const inboxDetailRun =
    inboxDetailTarget && isInboxRunDetailTarget(inboxDetailTarget)
      ? briar.dashboard?.runs.find(
          (run) => run.id === inboxDetailTarget.targetId,
        ) ?? null
      : null;
  const inboxDetailSession =
    inboxDetailTarget?.kind === "session"
      ? autoHunt.sessions.find(
          (session) => session.id === inboxDetailTarget.targetId,
        ) ?? null
      : null;
  const inboxDetailLabel =
    inboxDetailRun?.title ??
    (inboxDetailTarget
      ? inbox.messages.find(
          (message) => message.id === inboxDetailTarget.messageId,
        )?.title ?? t("inbox.messages")
      : t("inbox.messages"));
  const isInboxDetailLoading = Boolean(
    inboxDetailTarget &&
      isInboxRunDetailTarget(inboxDetailTarget) &&
      briar.dashboard?.project.id !== inboxDetailTarget.projectId,
  );
  const [issueAgents, setIssueAgents] = useState<ProjectAgent[]>([]);
  const activeProjectAgents = useMemo(
    () => issueAgents.filter((agent) => agent.projectId === activeProject?.id),
    [activeProject?.id, issueAgents],
  );
  useEffect(() => {
    if (!activeProject) {
      setIssueAgents([]);
      return;
    }

    let cancelled = false;
    const agents = briar.token
      ? loadProjectAgents(briar.token, activeProject.id, locale)
      : Promise.resolve(demoProjectAgents(activeProject.id, locale));
    void agents
      .then((loadedAgents) => {
        if (!cancelled) {
          setIssueAgents((current) => [
            ...current.filter(
              (agent) => agent.projectId !== activeProject.id,
            ),
            ...loadedAgents,
          ]);
        }
      })
      .catch(() => {
        // Keep previously loaded agents so their running sessions remain
        // identifiable while another project is active or temporarily offline.
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject, briar.token, locale]);
  const rememberIssueAgent = useCallback((agent: ProjectAgent) => {
    setIssueAgents((current) => {
      const index = current.findIndex((candidate) => candidate.id === agent.id);
      if (index < 0) return [...current, agent];
      if (current[index] === agent) return current;
      return current.map((candidate) =>
        candidate.id === agent.id ? agent : candidate
      );
    });
  }, []);
  const processingIssueIds = useMemo(() => {
    const runIds = new Set<string>();
    if (quickStartingRunId) runIds.add(quickStartingRunId);
    for (const session of autoHunt.sessions) {
      if (session.status !== "running") continue;
      for (const issue of session.issues) runIds.add(issue.runId);
    }
    return runIds;
  }, [autoHunt.sessions, quickStartingRunId]);
  const settingsOrganization =
    settingsTarget.scope === "organization"
      ? briar.organizations.find(
          (organization) =>
            organization.id === settingsTarget.organizationId,
        )
      : null;
  const shouldShowInitialOnboarding =
    !briar.remoteMode &&
    !briar.user &&
    !hasCompletedOnboarding;
  const shouldShowFirstOrganizationSetup =
    resolveShouldShowFirstOrganizationSetup({
    hasUser: briar.user !== null,
    organizationCount: briar.organizations.length,
    projectCount: briar.projects.length,
    remoteMode: briar.remoteMode,
  });
  const shouldShowFirstRunTutorial = Boolean(
    !briar.remoteMode &&
      briar.user &&
      briar.organizations.length > 0 &&
      !briar.isCreatingProject &&
      !briar.projectConnection &&
      !invitationToken &&
      (pendingFirstRunTutorialUserId === briar.user.id ||
        hasPendingFirstRunTutorial(briar.user.id)),
  );
  const sendIssueMessage = (
    runId: string,
    input: {
      body: string;
      clientMessageId?: string;
      parentMessageId: string | null;
      mentionedUserIds?: string[];
      mentionedAgentIds?: string[];
    },
  ) => briar.addIssueMessage(runId, input);
  const processIssueNow = (run: HuntRun) => {
    if (!activeProject) return;
    setQuickProcessError(null);
    setCompletedDispatchRunId(null);
    if (run.executionReadiness === "waiting") {
      setQuickProcessError(
        t("issue.waitingOnPrerequisites", {
          count: run.waitingOnPrerequisiteCount ?? 0,
        }),
      );
      return;
    }
    setDispatchRun(run);
  };
  const submitWorkerDispatch = async (input: {
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    workerId: string | null;
  }) => {
    if (
      !activeProject ||
      !briar.token ||
      !dispatchRun ||
      quickStartingRunId ||
      completedDispatchRunId
    ) return;
    setQuickStartingRunId(dispatchRun.id);
    setQuickProcessError(null);
    try {
      await dispatchHuntRun(
        briar.token,
        activeProject.id,
        dispatchRun.id,
        {
          ...input,
          workerId: input.workerId || null,
          persistPreferences: true,
          reassign: Boolean(dispatchRun.dispatchedAt || dispatchRun.workerId),
        },
      );
      setCompletedDispatchRunId(dispatchRun.id);
      try {
        await briar.refresh();
      } catch (caught) {
        setQuickProcessError(
          caught instanceof Error ? caught.message : String(caught),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      setDispatchRun(null);
      setCompletedDispatchRunId(null);
    } catch (caught) {
      setQuickProcessError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setQuickStartingRunId(null);
    }
  };

  const dispatchAgentAutoHunt = useCallback(async (
    projectId: string,
    agent: ProjectAgentRunInput["agent"],
    runs: HuntRun[],
    options?: AgentAutoHuntOptions,
  ) => {
    const token = briar.token;
    if (!token) throw new Error("로그인이 필요합니다.");
    const result = await dispatchAutoHuntToWorkers(
      {
        dispatch: (run, input) =>
          dispatchHuntRun(token, projectId, run.id, input),
        retry: (run, reason) =>
          retryHuntRun(token, projectId, run.id, reason),
      },
      {
        agent,
        runs,
        maxIssues: options?.maxIssues,
        targetRunIds: options?.targetRunIds,
        retryReason: options?.retryReason,
      },
    );
    autoHunt.startWorkerDispatchSession(projectId, agent, runs, {
      dispatchId: result.dispatchId,
      runIds: result.runIds,
      parentSessionId: options?.parentSessionId,
      coordinatorConversationId: options?.coordinatorConversationId,
    });
    if (activeProject?.id === projectId) await briar.refresh();
    return result.dispatchId;
  }, [
    activeProject?.id,
    autoHunt.startWorkerDispatchSession,
    briar.refresh,
    briar.token,
  ]);

  const startAgentAutoHunt = async (
    agent: ProjectAgent,
    runs: HuntRun[],
    options?: AgentAutoHuntOptions,
  ) => {
    if (!activeProject) throw new Error("프로젝트를 선택해 주세요.");
    rememberIssueAgent(agent);
    return dispatchAgentAutoHunt(activeProject.id, agent, runs, options);
  };

  const startProjectAgentTask = useCallback(async (
    agent: ProjectAgent,
    input: { request: string; workerId: string; skillId: string },
  ) => {
    if (!activeProject || !briar.token) {
      throw new Error("로그인이 필요합니다.");
    }
    const session = await runProjectAgentTaskOnWorker(
      briar.token,
      activeProject.id,
      {
        agentId: agent.id,
        request: input.request,
        workerId: input.workerId,
        skillId: input.skillId,
      },
    );
    autoHunt.adoptRemoteSession(session);
    if (activeProject.id === briar.activeProjectId) {
      await briar.refresh();
    }
    return session.id;
  }, [
    activeProject,
    autoHunt.adoptRemoteSession,
    briar.activeProjectId,
    briar.refresh,
    briar.token,
  ]);

  useEffect(() => {
    if (
      !runsOnDesktopTauri ||
      projectWindowProjectId ||
      !briar.token ||
      plannedUpdateRecoveryRef.current
    ) {
      return;
    }
    const token = briar.token;
    plannedUpdateRecoveryRef.current = (async () => {
      const recoveries = await takePlannedUpdateAgentRecoveries();
      for (const recovery of recoveries) {
        try {
          const dashboard = await loadDashboard(token, recovery.projectId);
          const agent = recoveryAgent(recovery);
          await executeProjectAgentTask(
            {
              runAgent: runProjectAgent,
              startSession: (session) =>
                autoHunt.startTaskSession(
                  recovery.projectId,
                  recovery.request.agentId,
                  { ...session, agentName: agent.name },
                ),
              settleSession: autoHunt.settleTaskSession,
              startAutoHunt: (runs, options) =>
                dispatchAgentAutoHunt(
                  recovery.projectId,
                  agent,
                  runs,
                  options,
                ),
            },
            {
              agent,
              dashboard,
              message: recovery.request.message,
              sessionId: recovery.request.sessionId,
              startedAt: recovery.startedAt,
              conversationId: recovery.request.conversationId,
              recoveringAfterUpdate: true,
            },
          );
        } catch (caught) {
          setQuickProcessError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      }
    })().catch((caught) => {
      setQuickProcessError(
        caught instanceof Error ? caught.message : String(caught),
      );
    });
  }, [
    autoHunt.settleTaskSession,
    autoHunt.startTaskSession,
    briar.token,
    dispatchAgentAutoHunt,
    projectWindowProjectId,
    runsOnDesktopTauri,
  ]);

  useEffect(() => {
    setQuickProcessError(null);
    setQuickStartingRunId(null);
    setCompletedDispatchRunId(null);
    setDispatchRun(null);
  }, [briar.activeProjectId]);

  useEffect(() => {
    if (!briar.user || hasCompletedOnboarding) return;
    markInitialOnboardingComplete();
    setHasCompletedOnboarding(true);
  }, [briar.user, hasCompletedOnboarding]);

  const acceptCurrentInvitation = useCallback(async () => {
    if (!invitationToken) return;
    setAcceptingInvitation(true);
    try {
      await briar.acceptInvitation(invitationToken);
      leaveOrganizationInvitationRoute();
      setInvitationToken(null);
      setRequestedRunId(null);
      setRequestedSessionId(null);
      setCreateIssueProjectId(null);
      setIsIssueDialogOpen(false);
      resetNavigation("lobby");
    } finally {
      setAcceptingInvitation(false);
    }
  }, [briar.acceptInvitation, invitationToken, resetNavigation]);

  useEffect(() => {
    if (!invitationToken || !briar.user || acceptingInvitation) return;
    const attemptKey = `${invitationToken}:${briar.user.id}`;
    if (invitationAcceptanceAttemptRef.current === attemptKey) return;
    invitationAcceptanceAttemptRef.current = attemptKey;
    void acceptCurrentInvitation();
  }, [
    acceptCurrentInvitation,
    acceptingInvitation,
    briar.user,
    invitationToken,
  ]);

  useEffect(() => {
    if (!runsOnDesktopTauri || projectWindowProjectId) return;
    let cancelled = false;

    void import("@tauri-apps/api/core").then(async ({ invoke }) => {
      if (cancelled) return;
      const shouldPrepareLaunchIntro =
        usesNativeLaunchIntro && shouldShowLaunchIntro();
      const command = shouldPrepareLaunchIntro
        ? "prepare_launch_intro"
        : "show_main_window";
      try {
        await invoke(command);
        if (shouldPrepareLaunchIntro) markLaunchIntroSeen();
      } catch (error) {
        console.error("Failed to prepare the native launch experience", error);
        await invoke("show_main_window").catch(() => undefined);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectWindowProjectId, runsOnDesktopTauri, usesNativeLaunchIntro]);

  useEffect(() => {
    if (
      !runsOnDesktopTauri ||
      projectWindowProjectId ||
      briar.companionMode ||
      briar.loading
    ) return;
    const compact = shouldShowInitialOnboarding;
    if (!compact && !hasCompactedWindowForOnboarding.current) return;
    hasCompactedWindowForOnboarding.current = compact;

    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("set_main_window_onboarding_mode", { compact }),
      )
      .catch((error) => {
        console.error("Failed to resize the Briar onboarding window", error);
      });
  }, [
    briar.companionMode,
    briar.loading,
    projectWindowProjectId,
    runsOnDesktopTauri,
    shouldShowInitialOnboarding,
  ]);

  const completeLaunchIntro = useCallback(() => {
    clearLaunchIntroPreview();
    markLaunchIntroSeen();
    setIsLaunchIntroVisible(false);
  }, []);

  const openAppSettings = useCallback(() => {
    setSettingsTarget({
      scope: "application",
      section: "account",
    });
    navigateToPage("settings");
  }, [navigateToPage]);

  useEffect(() => {
    if (!runsOnDesktopTauri) return;
    return listenForAppMenuSettings(openAppSettings);
  }, [openAppSettings, runsOnDesktopTauri]);

  const commandPaletteAvailable = Boolean(
    briar.user &&
      !briar.companionMode &&
      !briar.isCreatingProject &&
      !briar.projectConnection &&
      !invitationToken &&
      !shouldShowInitialOnboarding &&
      !shouldShowFirstOrganizationSetup &&
      !shouldShowFirstRunTutorial &&
      !isLaunchIntroVisible
  );

  const configuredKeybindings = loadKeybindings();
  const openCommandPalette = useCallback((initialQuery = "") => {
    setCommandPaletteInitialQuery(initialQuery);
    setIsCommandPaletteOpen(true);
  }, []);
  const handleCommandPaletteOpenChange = useCallback((open: boolean) => {
    setIsCommandPaletteOpen(open);
    if (!open) setCommandPaletteInitialQuery("");
  }, []);

  useEffect(
    () => subscribeKeyboardNavigationPreferences((preferences) => {
      setSequenceShortcutsEnabled(preferences.sequenceShortcutsEnabled);
    }),
    [],
  );

  useEffect(() => {
    if (commandPaletteAvailable) return;
    handleCommandPaletteOpenChange(false);
    setIsKeyboardShortcutsOpen(false);
  }, [commandPaletteAvailable, handleCommandPaletteOpenChange]);

  const keyboardShortcutTriggers = {
    createIssue: () => {
      if (!activeProject) return;
      setCreateIssueProjectId(activeProject.id);
      navigateToPage("issues");
      setIsIssueDialogOpen(true);
    },
    goAgents: () => navigateToPage("agents"),
    goChannels: () => navigateToPage("channels"),
    goDms: () => navigateToPage("dms"),
    goInbox: () => navigateToPage("inbox"),
    goIssues: () => {
      setRequestedRunId(null);
      setIssueListRequestKey((key) => key + 1);
      navigateToPage("issues");
    },
    goProjectHome: () => navigateToPage("lobby"),
    goSchedule: () => navigateToPage("schedule"),
    goSettings: openAppSettings,
    openChannel: () => openCommandPalette("c:"),
    openCommandPalette: () => openCommandPalette(),
    openDm: () => openCommandPalette("d:"),
    openIssue: () => openCommandPalette("i:"),
    openProject: () => openCommandPalette("p:"),
    openSession: () => openCommandPalette("s:"),
    showKeyboardShortcuts: () => setIsKeyboardShortcutsOpen(true),
    toggleSidebar: () => setIsSidebarOpen((open) => !open),
  } satisfies Record<AppKeyboardShortcutCommandId, () => void>;
  const keyboardShortcutDisabled = {
    createIssue: !activeProject,
    goAgents: !activeProject,
    goChannels: !briar.activeOrganizationId,
    goDms: !briar.activeOrganizationId || Boolean(projectWindowProjectId),
    goInbox: !briar.activeOrganizationId,
    goIssues: !activeProject,
    goProjectHome: !activeProject,
    goSchedule: !activeProject || !isProjectScheduleTabEnabled(activeProject),
    goSettings: false,
    openChannel: !briar.activeOrganizationId,
    openCommandPalette: false,
    openDm: !briar.activeOrganizationId || Boolean(projectWindowProjectId),
    openIssue: !activeProject,
    openProject: activeOrganizationProjects.length === 0,
    openSession: !activeProject,
    showKeyboardShortcuts: false,
    toggleSidebar: false,
  } satisfies Record<AppKeyboardShortcutCommandId, boolean>;
  const sequenceShortcutShellAvailable =
    commandPaletteAvailable &&
    sequenceShortcutsEnabled &&
    !isCommandPaletteOpen &&
    !isKeyboardShortcutsOpen;
  const sequenceCommandAvailable = (id: AppKeyboardShortcutCommandId) =>
    sequenceShortcutShellAvailable &&
    !keyboardShortcutDisabled[id] &&
    !hasOpenKeyboardShortcutOverlay(document);
  const sequenceHandler = (id: AppKeyboardShortcutCommandId) => ({
    isAvailable: () => sequenceCommandAvailable(id),
    run: () => {
      keyboardShortcutTriggers[id]();
      return "handled" as const;
    },
  });
  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      createIssue: sequenceHandler("createIssue"),
      goAgents: sequenceHandler("goAgents"),
      goChannels: sequenceHandler("goChannels"),
      goDms: sequenceHandler("goDms"),
      goInbox: sequenceHandler("goInbox"),
      goIssues: sequenceHandler("goIssues"),
      goProjectHome: sequenceHandler("goProjectHome"),
      goSchedule: sequenceHandler("goSchedule"),
      goSettings: sequenceHandler("goSettings"),
      historyBack: {
        isAvailable: () => commandPaletteAvailable,
        run: () => {
          if (canGoBack) goBack();
          return "consume";
        },
      },
      historyForward: {
        isAvailable: () => commandPaletteAvailable,
        run: () => {
          if (canGoForward) goForward();
          return "consume";
        },
      },
      openChannel: sequenceHandler("openChannel"),
      openCommandPalette: {
        run: ({ input }) => {
          const configured = Boolean(
            input.altKey ||
              input.controlKey ||
              input.ctrlKey ||
              input.metaKey,
          );
          if (!configured && !sequenceCommandAvailable("openCommandPalette")) {
            return "pass";
          }
          const anotherDialogOpen = !isCommandPaletteOpen &&
            hasOpenKeyboardShortcutOverlay(document);
          if (!commandPaletteAvailable || anotherDialogOpen) {
            return configured ? "consume" : "pass";
          }
          if (isCommandPaletteOpen) handleCommandPaletteOpenChange(false);
          else openCommandPalette();
          return "handled";
        },
      },
      openDm: sequenceHandler("openDm"),
      openIssue: sequenceHandler("openIssue"),
      openProject: sequenceHandler("openProject"),
      openSession: sequenceHandler("openSession"),
      openSettings: {
        isAvailable: () => commandPaletteAvailable,
        run: () => {
          openAppSettings();
          return "handled";
        },
      },
      showKeyboardShortcuts: {
        run: ({ input }) => {
          const primaryModifier =
            Boolean(input.metaKey) !==
              Boolean(input.controlKey || input.ctrlKey) &&
            Boolean(input.metaKey || input.controlKey || input.ctrlKey) &&
            !input.altKey &&
            !input.shiftKey;
          if (!primaryModifier) {
            if (!sequenceCommandAvailable("showKeyboardShortcuts")) {
              return "pass";
            }
            setIsKeyboardShortcutsOpen(true);
            return "handled";
          }
          const anotherDialogOpen = !isKeyboardShortcutsOpen &&
            hasOpenKeyboardShortcutOverlay(document);
          if (!commandPaletteAvailable || anotherDialogOpen) return "pass";
          setIsKeyboardShortcutsOpen((open) => !open);
          return "handled";
        },
      },
      toggleSidebar: {
        run: ({ input }) => {
          const configured = Boolean(
            input.altKey ||
              input.controlKey ||
              input.ctrlKey ||
              input.metaKey,
          );
          if (!configured && !sequenceCommandAvailable("toggleSidebar")) {
            return "pass";
          }
          if (hasOpenKeyboardShortcutOverlay(document)) {
            return configured ? "consume" : "pass";
          }
          setIsSidebarOpen((open) => !open);
          return "handled";
        },
      },
      ...(appZoomCommands
        ? {
            zoomIn: {
              run: () => {
                appZoomCommands.zoomIn();
                return "handled" as const;
              },
            },
            zoomOut: {
              run: () => {
                appZoomCommands.zoomOut();
                return "handled" as const;
              },
            },
          }
        : {}),
    },
    id: "app-global",
    priority: 0,
  });

  const keyboardCommandState = useAppKeyboardCommandState();
  const pendingShortcut = keyboardCommandState.pending;
  const pendingShortcutSpec = pendingShortcut
    ? appKeyboardShortcutSpecs.find(
        ({ id }) => id === pendingShortcut.candidateIds[0],
      )
    : undefined;
  const pendingShortcutPrefix = pendingShortcut
    ? pendingShortcutSpec?.sequence.slice(0, pendingShortcut.sequence.length) ??
      pendingShortcut.sequence
    : [];
  const pendingShortcutChoices = pendingShortcut
    ? pendingShortcut.candidateIds.flatMap((id) => {
        const shortcut = appKeyboardShortcutSpecs.find(
          (candidate) => candidate.id === id,
        );
        const key = shortcut?.sequence[pendingShortcut.sequence.length];
        return shortcut && key
          ? [{ id, key: key.toUpperCase(), label: t(shortcut.labelKey) }]
          : [];
      })
    : [];
  const keyboardShortcutsModifierLabel = isMacPlatform() ? "⌘/" : "Ctrl+/";
  const keyboardShortcutHelpSections = createKeyboardShortcutHelpSections({
    commandPaletteShortcut: formatShortcut(
      configuredKeybindings.commandPalette,
    ),
    keyboardShortcutsShortcut: keyboardShortcutsModifierLabel,
    sequenceShortcutsEnabled,
    sidebarShortcut: formatShortcut(configuredKeybindings.sidebarToggle),
    t,
  });

  const paletteSections = {
    actions: {
      id: "actions",
      label: t("commandPalette.groupActions"),
    },
    context: {
      id: "context",
      label: t("commandPalette.groupContext"),
    },
    channels: {
      id: "channels",
      label: t("commandPalette.groupChannels"),
    },
    continue: {
      id: "continue",
      label: t("commandPalette.groupContinue"),
    },
    directMessages: {
      id: "direct-messages",
      label: t("commandPalette.groupDirectMessages"),
    },
    issues: {
      id: "issues",
      label: t("commandPalette.groupIssues"),
    },
    navigation: {
      id: "navigation",
      label: t("commandPalette.groupNavigation"),
    },
    projects: {
      id: "projects",
      label: t("commandPalette.groupProjects"),
    },
  } as const;
  const commandPaletteItems: CommandPaletteItem[] = [];
  const addPaletteItem = (
    item: Omit<CommandPaletteItem, "section" | "sectionLabel">,
    section: (typeof paletteSections)[keyof typeof paletteSections],
  ) => {
    if (!commandPaletteAvailable || !isCommandPaletteOpen) return;
    commandPaletteItems.push({
      ...item,
      section: section.id,
      sectionLabel: section.label,
    });
  };
  const openPaletteIssue = (runId: string) => {
    setRequestedSessionId(null);
    setRequestedRunInitialTab(null);
    setRequestedRunId(runId);
    navigateToIssue(runId);
  };
  const currentPaletteRun = selectedRunId
    ? briar.dashboard?.runs.find((run) => run.id === selectedRunId) ?? null
    : null;
  const currentPaletteChannel = activeChannelId
    ? organizationChannels.find((channel) => channel.id === activeChannelId) ?? null
    : null;
  const commandPaletteContextLabel = currentPaletteRun && activeProject
    ? `${formatIssueKey(activeProject.issueKeyPrefix, currentPaletteRun.runNumber)} · ${currentPaletteRun.title}`
    : currentPaletteChannel && (activePage === "channels" || activePage === "dms")
      ? activePage === "dms"
        ? directMessageDisplayName(
            currentPaletteChannel,
            briar.user?.id ?? null,
          )
        : `#${currentPaletteChannel.name}`
      : activeProject?.name ?? activeOrganization?.name ?? null;

  if (visibleInboxUnreadCount > 0) {
    addPaletteItem({
      active: activePage === "inbox",
      description: t("commandPalette.unreadCount", {
        count: visibleInboxUnreadCount,
      }),
      icon: <InboxIcon />,
      id: "navigation:inbox",
      keywords: ["inbox", "notifications", "받은 편지함", "알림", "收件箱", "通知"],
      label: t("sidebar.inbox"),
      onSelect: () => navigateToPage("inbox"),
      priority: 180 + visibleInboxUnreadCount,
      scope: "navigation",
    }, paletteSections.continue);
  }

  const paletteProjectIds = new Set(
    activeOrganizationProjects.map((project) => project.id),
  );
  const runningPaletteSessions = isCommandPaletteOpen
    ? collapseLinkedAutoHuntSessions(autoHunt.sessions)
        .filter(
          (session) =>
            session.status === "running" &&
            paletteProjectIds.has(session.projectId),
        )
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    : [];
  for (const session of runningPaletteSessions) {
    const project = activeOrganizationProjects.find(
      (candidate) => candidate.id === session.projectId,
    );
    const label = session.request?.trim() || session.agentName?.trim() ||
      t("sidebar.untitledAgentSession");
    addPaletteItem({
      description: t("commandPalette.runningSession", {
        project: project?.name ?? t("sidebar.projects"),
      }),
      icon: <Bot />,
      id: `session:${session.id}`,
      keywords: [
        session.agentName ?? "",
        session.request ?? "",
        project?.name ?? "",
        "agent session",
        "에이전트 세션",
        "智能体会话",
      ],
      label,
      onSelect: () => {
        const changesProject = Boolean(
          project && project.id !== briar.activeProjectId,
        );
        if (changesProject && project) {
          navigationActiveProjectIdRef.current = project.id;
          briar.setActiveProjectId(project.id);
        }
        setRequestedRunId(null);
        setRequestedSessionId(session.id);
        navigateToPage("agents", project?.id ?? briar.activeProjectId);
      },
      priority: 160,
      scope: "sessions",
    }, paletteSections.continue);
  }

  if (activeProject) {
    addPaletteItem({
      description: t("commandPalette.createIssueDescription", {
        project: activeProject.name,
      }),
      icon: <Plus />,
      id: `action:create-issue:${activeProject.id}`,
      keywords: [
        "create issue",
        "new issue",
        "new task",
        "이슈 만들기",
        "새 이슈",
        "问题",
        "新建问题",
        activeProject.name,
      ],
      label: t("dashboard.createIssue"),
      onSelect: () => {
        setCreateIssueProjectId(activeProject.id);
        navigateToPage("issues");
        setIsIssueDialogOpen(true);
      },
      priority: 220,
      remember: false,
      restoreFocusOnSelect: false,
      scope: "actions",
    }, paletteSections.context);
    addPaletteItem({
      active:
        activePage === "settings" &&
        settingsTarget.scope === "project" &&
        settingsTarget.projectId === activeProject.id,
      description: t("commandPalette.projectSettingsDescription", {
        project: activeProject.name,
      }),
      icon: <Settings />,
      id: `action:project-settings:${activeProject.id}`,
      keywords: [
        "project settings",
        "프로젝트 설정",
        "项目设置",
        activeProject.name,
      ],
      label: t("sidebar.projectSettings"),
      onSelect: () => {
        setSettingsTarget({
          scope: "project",
          projectId: activeProject.id,
          section: "general",
        });
        navigateToPage("settings");
      },
      priority: 150,
      scope: "actions",
    }, paletteSections.context);
  }

  addPaletteItem({
    description: t("commandPalette.keyboardShortcutsDescription"),
    icon: <KeyboardIcon />,
    id: "action:keyboard-shortcuts",
    keywords: [
      "keyboard shortcuts",
      "hotkeys",
      "vim",
      "keyboard mode",
      "단축키",
      "키보드",
      "快捷键",
    ],
    label: t("keyboardShortcuts.title"),
    onSelect: () => setIsKeyboardShortcutsOpen(true),
    priority: 90,
    remember: false,
    restoreFocusOnSelect: false,
    scope: "actions",
    shortcut: keyboardShortcutsModifierLabel,
  }, paletteSections.actions);

  addPaletteItem({
    description: t(
      isSidebarOpen
        ? "commandPalette.hideSidebarDescription"
        : "commandPalette.showSidebarDescription",
    ),
    icon: <PanelLeft />,
    id: "action:toggle-sidebar",
    keywords: ["sidebar", "panel", "사이드바", "패널", "侧边栏"],
    label: t(
      isSidebarOpen ? "commandPalette.hideSidebar" : "commandPalette.showSidebar",
    ),
    onSelect: () => setIsSidebarOpen((open) => !open),
    priority: 80,
    remember: false,
    scope: "actions",
    shortcut: formatShortcut(configuredKeybindings.sidebarToggle),
  }, paletteSections.actions);

  if (!projectWindowProjectId) {
    addPaletteItem({
      icon: <FolderPlus />,
      id: "action:add-project",
      keywords: ["new project", "add project", "프로젝트 추가", "新建项目"],
      label: t("sidebar.addProject"),
      onSelect: briar.startProjectCreation,
      priority: 60,
      remember: false,
      restoreFocusOnSelect: false,
      scope: "actions",
    }, paletteSections.actions);
    if (activeOrganization) {
      addPaletteItem({
        active:
          activePage === "settings" &&
          settingsTarget.scope === "organization" &&
          settingsTarget.organizationId === activeOrganization.id,
        description: activeOrganization.name,
        icon: <Building2 />,
        id: `action:organization-settings:${activeOrganization.id}`,
        keywords: [
          "organization settings",
          "workspace settings",
          "조직 설정",
          "组织设置",
          activeOrganization.name,
        ],
        label: t("sidebar.organizationSettings"),
        onSelect: () => {
          setSettingsTarget({
            scope: "organization",
            organizationId: activeOrganization.id,
            section: "general",
          });
          navigateToPage("settings");
        },
        priority: 50,
        scope: "actions",
      }, paletteSections.actions);
    }
  }

  if (canGoBack) {
    addPaletteItem({
      icon: <ArrowLeft />,
      id: "navigation:back",
      keywords: ["back", "history", "뒤로", "이전", "后退"],
      label: t("navigation.back"),
      onSelect: goBack,
      priority: 200,
      remember: false,
      scope: "navigation",
      shortcut: "⌘[",
    }, paletteSections.navigation);
  }
  if (canGoForward) {
    addPaletteItem({
      icon: <ArrowRight />,
      id: "navigation:forward",
      keywords: ["forward", "history", "앞으로", "다음", "前进"],
      label: t("navigation.forward"),
      onSelect: goForward,
      priority: 190,
      remember: false,
      scope: "navigation",
      shortcut: "⌘]",
    }, paletteSections.navigation);
  }
  if (activeProject) {
    addPaletteItem({
      active: activePage === "lobby",
      description: activeProject.name,
      icon: <House />,
      id: `navigation:project-home:${activeProject.id}`,
      keywords: ["home", "overview", "project home", "홈", "项目主页", activeProject.name],
      label: t("lobby.eyebrow"),
      onSelect: () => navigateToPage("lobby"),
      priority: activePage === "lobby" ? 120 : 70,
      scope: "navigation",
    }, paletteSections.navigation);
    addPaletteItem({
      active: activePage === "issues",
      description: activeProject.name,
      icon: <Activity />,
      id: `navigation:issues:${activeProject.id}`,
      keywords: ["issues", "tasks", "이슈", "작업", "问题", activeProject.name],
      label: t("sidebar.issues"),
      onSelect: () => {
        setRequestedRunId(null);
        setIssueListRequestKey((key) => key + 1);
        navigateToPage("issues");
      },
      priority: activePage === "issues" ? 120 : 70,
      scope: "navigation",
    }, paletteSections.navigation);
    addPaletteItem({
      active: activePage === "agents",
      description: activeProject.name,
      icon: <Bot />,
      id: `navigation:agents:${activeProject.id}`,
      keywords: ["agents", "sessions", "에이전트", "세션", "智能体", activeProject.name],
      label: t("sidebar.agents"),
      onSelect: () => navigateToPage("agents"),
      priority: activePage === "agents" ? 120 : 60,
      scope: "navigation",
    }, paletteSections.navigation);
    if (isProjectScheduleTabEnabled(activeProject)) {
      addPaletteItem({
        active: activePage === "schedule",
        description: activeProject.name,
        icon: <CalendarDays />,
        id: `navigation:schedule:${activeProject.id}`,
        keywords: ["schedule", "calendar", "스케줄", "일정", "日程", activeProject.name],
        label: t("sidebar.schedule"),
        onSelect: () => navigateToPage("schedule"),
        priority: activePage === "schedule" ? 120 : 50,
        scope: "navigation",
      }, paletteSections.navigation);
    }
  }
  if (briar.activeOrganizationId && briar.token) {
    addPaletteItem({
      active: activePage === "channels",
      description: activeOrganization?.name,
      icon: <MessagesSquare />,
      id: `navigation:channels:${briar.activeOrganizationId}`,
      keywords: ["channels", "chat", "채널", "대화", "频道"],
      label: t("sidebar.channels"),
      onSelect: () => {
        const channel = visibleOrganizationChannels.find(
          (candidate) => candidate.id === activeChannelId,
        ) ?? visibleOrganizationChannels[0];
        if (channel) openOrganizationChannel(channel.id);
        else navigateToPage("channels");
      },
      priority: activePage === "channels" ? 120 : 50,
      scope: "navigation",
    }, paletteSections.navigation);
  }
  if (!projectWindowProjectId) {
    addPaletteItem({
      active: activePage === "dms",
      description: activeOrganization?.name,
      icon: <MessageCircle />,
      id: `navigation:dms:${briar.activeOrganizationId ?? "none"}`,
      keywords: ["direct messages", "dm", "messages", "다이렉트 메시지", "私信"],
      label: t("sidebar.dms"),
      onSelect: () => {
        const directMessage = organizationDirectMessages.find(
          (candidate) => candidate.id === activeChannelId,
        ) ?? organizationDirectMessages[0];
        if (directMessage) openOrganizationChannel(directMessage.id);
        else navigateToPage("dms");
      },
      priority: activePage === "dms" ? 120 : 50,
      scope: "navigation",
    }, paletteSections.navigation);
  }
  if (visibleInboxUnreadCount === 0) {
    addPaletteItem({
      active: activePage === "inbox",
      icon: <InboxIcon />,
      id: "navigation:inbox",
      keywords: ["inbox", "notifications", "받은 편지함", "알림", "收件箱", "通知"],
      label: t("sidebar.inbox"),
      onSelect: () => navigateToPage("inbox"),
      priority: activePage === "inbox" ? 120 : 45,
      scope: "navigation",
    }, paletteSections.navigation);
  }
  addPaletteItem({
    active: activePage === "settings" && settingsTarget.scope === "application",
    icon: <Settings />,
    id: "navigation:app-settings",
    keywords: ["settings", "preferences", "설정", "환경설정", "设置"],
    label: t("appSettings.title"),
    onSelect: openAppSettings,
    priority: activePage === "settings" ? 100 : 40,
    scope: "navigation",
    shortcut: "⌘,",
  }, paletteSections.navigation);

  for (const project of isCommandPaletteOpen ? activeOrganizationProjects : []) {
    const organizationName = briar.organizations.find(
      (organization) => organization.id === project.organizationId,
    )?.name ?? project.organizationName ?? "";
    addPaletteItem({
      active: project.id === briar.activeProjectId,
      description:
        project.id === briar.activeProjectId
          ? t("commandPalette.currentProject")
          : organizationName,
      icon: <ProjectIcon className="size-4" project={project} />,
      id: `project:${project.id}`,
      keywords: [
        project.name,
        organizationName,
        "project",
        "프로젝트",
        "项目",
      ],
      label: project.name,
      onSelect: () => {
        const changesProject = project.id !== briar.activeProjectId;
        if (changesProject) {
          navigationActiveProjectIdRef.current = project.id;
          briar.setActiveProjectId(project.id);
        }
        setRequestedRunId(null);
        setRequestedSessionId(null);
        navigateToPage("lobby", project.id);
      },
      priority: project.id === briar.activeProjectId ? 100 : 20,
      scope: "projects",
    }, paletteSections.projects);

    if (project.id !== activeProject?.id) {
      addPaletteItem({
        description: t("commandPalette.createIssueDescription", {
          project: project.name,
        }),
        icon: <Plus />,
        id: `action:create-issue:${project.id}`,
        keywords: [
          "create issue",
          "new issue",
          "이슈 만들기",
          "새 이슈",
          "新建问题",
          project.name,
        ],
        label: t("commandPalette.createIssueIn", { project: project.name }),
        onSelect: () => {
          navigationActiveProjectIdRef.current = project.id;
          briar.setActiveProjectId(project.id);
          setCreateIssueProjectId(project.id);
          navigateToPage("issues", project.id);
          setIsIssueDialogOpen(true);
        },
        priority: -50,
        remember: false,
        restoreFocusOnSelect: false,
        scope: "actions",
      }, paletteSections.actions);
    }
  }

  const paletteDashboard = isCommandPaletteOpen ? briar.dashboard : null;
  if (paletteDashboard && activeProject && paletteDashboard.project.id === activeProject.id) {
    const runs = [...paletteDashboard.runs].sort((left, right) => {
      if (left.id === selectedRunId) return -1;
      if (right.id === selectedRunId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    for (const run of runs) {
      const issueKey = formatIssueKey(activeProject.issueKeyPrefix, run.runNumber);
      const needsAttention = ["blocked", "failed", "paused"].includes(run.status);
      const isCurrent = run.id === selectedRunId;
      const section = isCurrent
        ? paletteSections.context
        : needsAttention || run.status === "running"
          ? paletteSections.continue
          : paletteSections.issues;
      addPaletteItem({
        active: isCurrent,
        description: t("commandPalette.issueDescription", {
          key: issueKey,
          status: t(`status.${run.status}` as MessageKey),
        }),
        icon: <Activity />,
        id: `issue:${run.id}`,
        keywords: [
          issueKey,
          run.sourceKey,
          run.title,
          t(`status.${run.status}` as MessageKey),
          activeProject.name,
          "issue",
          "task",
          "이슈",
          "작업",
          "问题",
        ],
        label: run.title,
        onSelect: () => openPaletteIssue(run.id),
        priority: isCurrent ? 190 : needsAttention ? 140 : run.status === "running" ? 120 : 0,
        scope: "issues",
      }, section);
    }
  }

  for (const channel of isCommandPaletteOpen ? visibleOrganizationChannels : []) {
    const isCurrent =
      channel.id === activeChannelId && activePage === "channels";
    const unread = channelHasUnread(channel);
    addPaletteItem({
      active: isCurrent,
      description: channel.topic?.trim() || `#${channel.slug}`,
      icon: <Hash />,
      id: `channel:${channel.id}`,
      keywords: [
        channel.name,
        channel.slug,
        channel.topic ?? "",
        activeOrganization?.name ?? "",
        "channel",
        "채널",
        "频道",
      ],
      label: channel.name,
      onSelect: () => openOrganizationChannel(channel.id),
      priority: isCurrent ? 180 : unread ? 130 : 0,
      scope: "channels",
    }, isCurrent
      ? paletteSections.context
      : unread
        ? paletteSections.continue
        : paletteSections.channels);
  }

  for (const directMessage of isCommandPaletteOpen ? organizationDirectMessages : []) {
    const name = directMessageDisplayName(
      directMessage,
      briar.user?.id ?? null,
    );
    const isCurrent =
      directMessage.id === activeChannelId && activePage === "dms";
    const unread = channelHasUnread(directMessage);
    const participantNames = (directMessage.dmParticipants ?? [])
      .map((participant) => participant.name);
    addPaletteItem({
      active: isCurrent,
      description: unread
        ? t("dm.unread")
        : t("commandPalette.directMessageDescription"),
      icon: <MessageCircle />,
      id: `direct-message:${directMessage.id}`,
      keywords: [
        name,
        ...participantNames,
        "direct message",
        "dm",
        "다이렉트 메시지",
        "私信",
      ],
      label: name,
      onSelect: () => openOrganizationChannel(directMessage.id),
      priority: isCurrent ? 180 : unread ? 130 : 0,
      scope: "direct-messages",
    }, isCurrent
      ? paletteSections.context
      : unread
        ? paletteSections.continue
        : paletteSections.directMessages);
  }

  const unifiedSettingsSidebar = (
    <UnifiedSettingsSidebar
      activeTarget={settingsTarget}
      isOpen={isSidebarOpen}
      onBack={closeSettings}
      onNavigate={(target) => {
        setSettingsTarget(target);
        navigateToLocation(settingsNavigationLocation(target));
        const selection = settingsAccountSelection(
          target,
          briar.activeOrganizationId,
          briar.activeProjectId,
        );
        if (selection?.scope === "organization") {
          briar.setActiveOrganizationId(selection.organizationId);
        } else if (selection?.scope === "project") {
          briar.setActiveProjectId(selection.projectId);
        }
      }}
      organizations={visibleOrganizations}
      projects={visibleProjects}
    />
  );

  const inboxDetailContent = inboxDetailTarget ? (
    inboxDetailRun ? (
      <RunPage
        availableProviders={
          briar.dashboard?.organizationProviders?.length
            ? briar.dashboard.organizationProviders
            : [
                ...new Set(
                  (briar.dashboard?.workers ?? []).flatMap(
                    (worker) => worker.providers ?? [],
                  ),
                ),
              ]
        }
        availableRuns={briar.dashboard?.runs ?? []}
        conversationInboxSyncSignal={conversationInboxSyncSignal}
        error={briar.recoveryError}
        initialDetailTab={
          inboxDetailTarget.kind === "conversation"
            ? "conversation"
            : undefined
        }
        isDeletingIssue={briar.deletingIssueId === inboxDetailRun.id}
        isProcessing={processingIssueIds.has(inboxDetailRun.id)}
        isRecovering={briar.recoveringRunId === inboxDetailRun.id}
        isSidebarOpen
        issueKeyPrefix={briar.dashboard?.project.issueKeyPrefix}
        isUpdatingIssue={briar.updatingIssueId === inboxDetailRun.id}
        mentionMembers={briar.dashboard?.members ?? []}
        mentionAgents={issueAgents.filter(
          (agent) => agent.projectId === inboxDetailTarget.projectId,
        )}
        currentUserId={briar.user?.id ?? null}
        onAddDependency={(prerequisiteRunId) =>
          briar.addIssueDependency(inboxDetailRun.id, prerequisiteRunId)}
        onAcceptIssueAction={(proposal) =>
          briar.acceptConversationIssueAction(inboxDetailRun.id, proposal)}
        onAcceptIssueExecution={(proposal, input) =>
          briar.acceptConversationIssueExecution(
            inboxDetailRun.id,
            proposal,
            input,
          )}
        executionPolicy={briar.dashboard?.executionPolicy}
        executionWorkers={briar.dashboard?.workers ?? []}
        onBack={() => setInboxDetailTarget(null)}
        onCancel={() => briar.cancelRun(inboxDetailRun.id)}
        onDelete={async () => {
          await briar.deleteIssue(inboxDetailRun.id);
          setInboxDetailTarget(null);
        }}
        onDependencyOpen={(runId) =>
          setInboxDetailTarget((current) =>
            current ? { ...current, kind: "issue", targetId: runId } : current,
          )}
        onLoadAttachment={briar.readIssueAttachment}
        onLoadIssueMessages={() => briar.readIssueMessages(inboxDetailRun.id)}
        onLoadRunEvents={() => briar.readRunEvents(inboxDetailRun.id)}
        onLoadRunEvidence={() => briar.readRunEvidence(inboxDetailRun.id)}
        onLoadRunEvidenceImage={briar.readRunEvidenceImage}
        onCompleteResultReview={() =>
          briar.completeResultReview(inboxDetailRun.id)}
        onMove={(placement) => briar.moveRun(inboxDetailRun.id, placement)}
        onOpenFullPage={() => {
          setInboxDetailTarget(null);
          setRequestedSessionId(null);
          setRequestedRunId(inboxDetailRun.id);
          setRequestedRunInitialTab(
            inboxDetailTarget.kind === "conversation"
              ? "conversation"
              : null,
          );
          navigateToIssue(inboxDetailRun.id, inboxDetailTarget.projectId);
        }}
        onProcessNow={() => {
          setInboxDetailTarget(null);
          processIssueNow(inboxDetailRun);
        }}
        onRemoveDependency={(prerequisiteRunId) =>
          briar.removeIssueDependency(inboxDetailRun.id, prerequisiteRunId)}
        onRetry={() => briar.retryRun(inboxDetailRun.id)}
        onRework={(input) => briar.reworkRun(inboxDetailRun.id, input)}
        onResume={() => briar.resumeRun(inboxDetailRun.id)}
        onSendIssueMessage={(input) =>
          sendIssueMessage(inboxDetailRun.id, input)}
        onUpdateIssue={(input) => briar.editIssue(inboxDetailRun.id, input)}
        onUpdateIssueSubscription={(subscribed) =>
          briar.editIssueSubscription(inboxDetailRun.id, subscribed)}
        onUpdateIssueCheckpoints={(checkpoints) =>
          briar.editIssueCheckpoints(inboxDetailRun.id, checkpoints)}
        onUpdateIssuePreferences={(input) =>
          briar.editIssueExecutionPreferences(inboxDetailRun.id, input)}
        onViewingIssueConversationChange={setViewingIssueConversationRunId}
        performedAgentName={
          issueAgents.find((agent) => agent.id === inboxDetailRun.agentId)
            ?.name ?? null
        }
        onAcceptSkillExecution={(proposal, input) =>
          briar.acceptConversationSkillExecution(
            inboxDetailRun.id,
            proposal,
            input,
          )}
        organizationId={
          briar.projects.find(
            (project) => project.id === inboxDetailTarget.projectId,
          )?.organizationId ?? null
        }
        projectId={inboxDetailTarget.projectId}
        run={inboxDetailRun}
        token={briar.token}
      />
    ) : inboxDetailSession ? (
      <ProjectAgentSessionDetail
        isSidebarOpen
        issueKeyPrefix={
          briar.projects.find(
            (project) => project.id === inboxDetailSession.projectId,
          )?.issueKeyPrefix
        }
        onBack={() => setInboxDetailTarget(null)}
        onIssueOpen={(runId) =>
          setInboxDetailTarget((current) =>
            current
              ? { ...current, kind: "issue", targetId: runId }
              : current,
          )}
        onStop={() => autoHunt.stopSession(inboxDetailSession.id)}
        session={inboxDetailSession}
        token={briar.token}
        workers={briar.dashboard?.workers ?? []}
      />
    ) : inboxDetailChannelId && briar.activeOrganizationId && briar.token ? (
      <Channels
        activeChannelId={inboxDetailChannelId}
        channelCatalogCursor={
          channelCatalogSnapshot?.organizationId === briar.activeOrganizationId
            ? channelCatalogSnapshot.cursor
            : null
        }
        channelInboxSyncSignal={channelInboxSyncSignal}
        channels={visibleOrganizationChannels}
        currentUserId={briar.user?.id ?? null}
        inboxDetail
        onChannelSelect={setActiveChannelId}
        onChannelsChange={setOrganizationChannels}
        onInboxDetailClose={() => {
          setRequestedChannelMessage(null);
          setInboxDetailTarget(null);
        }}
        onCreateAgent={() => {
          setSettingsTarget({
            scope: "organization",
            organizationId: briar.activeOrganizationId!,
            section: "agents",
          });
          setIsSidebarOpen(true);
          navigateToPage("settings");
        }}
        onIssueCreated={async (projectId, runId) => {
          await briar.ensureProjectSelected(projectId);
          setRequestedRunId(runId);
          setRequestedChannelMessage(null);
          setInboxDetailTarget(null);
          navigateToIssue(runId, projectId);
        }}
        onSkillSessionAccepted={autoHunt.adoptRemoteSession}
        onViewingChannelChange={handleViewingChannelChange}
        organizationId={briar.activeOrganizationId}
        organizationName={activeOrganization?.name}
        projects={activeOrganizationProjects}
        requestedMessage={requestedChannelMessage}
        token={briar.token}
      />
    ) : isInboxDetailLoading ? (
      <div className="inbox-detail-loading" role="status">
        <LoadingState label={t("inbox.detailLoading")} />
      </div>
    ) : (
      <div className="inbox-detail-unavailable" role="alert">
        <strong>{t("run.loadFailed")}</strong>
        <button onClick={() => setInboxDetailTarget(null)} type="button">
          {t("common.close")}
        </button>
      </div>
    )
  ) : null;

  let content: React.ReactNode;

  if (briar.restoringSession) {
    content = <SessionLoadingScreen />;
  } else if (shouldShowInitialOnboarding) {
    content = (
      <InitialOnboarding
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onCancelLogin={briar.cancelLogin}
        onLogin={(method) => void briar.login({ method, locale })}
      />
    );
  } else if (invitationToken) {
    content = (
      <InvitationOnboarding
        accepting={acceptingInvitation}
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onAccept={acceptCurrentInvitation}
        onCancelLogin={briar.cancelLogin}
        onLeave={() => {
          leaveOrganizationInvitationRoute();
          window.location.reload();
        }}
        onLogin={(method) => void briar.login({ method, locale })}
        onSwitchAccount={async () => {
          await briar.logout();
          await briar.login({ locale, switchAccount: true });
        }}
        token={invitationToken}
        user={briar.user}
      />
    );
  } else if (!briar.user) {
    content = (
      <LoginScreen
        companionMode={briar.companionMode}
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onCancel={briar.cancelLogin}
        onLogin={(method) => void briar.login({ method, locale })}
        webMode={briar.webMode}
      />
    );
  } else if (shouldShowFirstOrganizationSetup) {
    content = (
      <FirstOrganizationSetup
        onCheckHandle={briar.checkOrganizationHandle}
        onCreate={async (input) => {
          await briar.addOrganization(input);
          markFirstRunTutorialPending(briar.user!.id);
          setPendingFirstRunTutorialUserId(briar.user!.id);
          resetNavigation("lobby");
        }}
        onLogout={() => void briar.logout()}
        user={briar.user}
      />
    );
  } else {
    content = (
      <div className="desktop-app-frame">
        <div className="app-shell">
          <WindowNavigationControls
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            isSidebarOpen={isSidebarOpen}
            onBack={goBack}
            onForward={goForward}
            onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
          />
        {activePage !== "settings" ? (
          <Sidebar
            activeChannelId={desktopActiveChannelId}
            activePage={activePage}
            activeOrganizationId={briar.activeOrganizationId}
            activeProjectId={briar.activeProjectId}
            agents={issueAgents}
            channels={visibleOrganizationChannels}
            channelsLoading={channelsLoading}
            connectedProjectIds={briar.connectedProjectIds}
            isOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
            onAgentSessionOpen={(sessionId) => {
              setRequestedRunId(null);
              setRequestedSessionId(sessionId);
              navigateToPage("agents");
            }}
            onAgentsOpen={() => navigateToPage("agents")}
            onLobbyOpen={() => navigateToPage("lobby")}
            onScheduleOpen={() => navigateToPage("schedule")}
            onInboxOpen={() => navigateToPage("inbox")}
            onDmsOpen={() => {
              const directMessage = organizationDirectMessages.find(
                (channel) => channel.id === activeChannelId,
              ) ?? organizationDirectMessages[0];
              if (directMessage) openOrganizationChannel(directMessage.id);
              else navigateToPage("dms");
            }}
            onChannelCreate={
              briar.activeOrganizationId && briar.token
                ? createOrganizationChannel
                : undefined
            }
            onChannelDelete={
              briar.activeOrganizationId && briar.token
                ? deleteOrganizationChannel
                : undefined
            }
            onChannelOpen={briar.activeOrganizationId ? openOrganizationChannel : undefined}
            onChannelSettings={
              briar.activeOrganizationId
                ? openOrganizationChannelSettings
                : undefined
            }
            onIssuesOpen={() => {
              setRequestedRunId(null);
              setIssueListRequestKey((key) => key + 1);
              navigateToPage("issues");
            }}
            onCreateIssue={(projectId) => {
              setCreateIssueProjectId(projectId);
              navigateToPage("issues");
              setIsIssueDialogOpen(true);
            }}
            onAddOrganization={() => navigateToPage("organization-create")}
            onOrganizationChange={(organizationId) => {
              const project = briar.projects.find(
                (candidate) => candidate.organizationId === organizationId,
              );
              navigationActiveProjectIdRef.current = project?.id ?? null;
              briar.setActiveOrganizationId(organizationId);
              setRequestedRunId(null);
              setRequestedSessionId(null);
              navigateToPage("lobby", project?.id ?? null);
            }}
            onProjectChange={(projectId) => {
              navigationActiveProjectIdRef.current = projectId;
              briar.setActiveProjectId(projectId);
              setRequestedRunId(null);
              setRequestedSessionId(null);
            }}
            onProjectOpenInNewWindow={
              runsOnDesktopTauri && !projectWindowProjectId
                ? openProjectInNewWindow
                : undefined
            }
            onProjectReadinessOpen={setRepositorySetupProjectId}
            onProjectSettings={(projectId) => {
              briar.setActiveProjectId(projectId);
              setSettingsTarget({
                scope: "project",
                projectId,
                section: "general",
              });
              navigateToPage("settings");
            }}
            onSettings={openAppSettings}
            onLogout={() => void briar.logout()}
            organizations={briar.organizations}
            projects={visibleProjects}
            projectReadiness={briar.projectReadiness}
            projectWindowProjectId={projectWindowProjectId}
            sessions={autoHunt.sessions}
            token={briar.token}
            unreadInboxCount={visibleInboxUnreadCount}
            unreadDmCount={unreadDirectMessageCount}
            user={briar.user}
          />
        ) : null}
        <div className="app-content-surface">
        {repositorySetupProjectId ? (
          <ProjectRepositorySetupDialog
            error={briar.projectReadinessError[repositorySetupProjectId] ?? null}
            loading={
              briar.projectReadinessLoadingId === repositorySetupProjectId
            }
            onClose={() => {
              const projectId = repositorySetupProjectId;
              setRepositorySetupProjectId(null);
              window.requestAnimationFrame(() => {
                document
                  .querySelector<HTMLButtonElement>(
                    `[data-project-readiness="${projectId}"]`,
                  )
                  ?.focus();
              });
            }}
            onInstallGithub={() =>
              briar.installGithubForProject(repositorySetupProjectId)
            }
            onLoginGithub={() =>
              briar.loginGithubForProject(repositorySetupProjectId)
            }
            onRefresh={() =>
              briar.refreshProjectReadiness(repositorySetupProjectId)
            }
            projectName={
              briar.projects.find(
                (project) => project.id === repositorySetupProjectId,
              )?.name ?? ""
            }
            readiness={
              briar.projectReadiness[repositorySetupProjectId] ?? null
            }
          />
        ) : null}
        {activePage === "organization-create" ? (
          <OrganizationCreate
            onBack={() =>
              canGoBack ? goBack() : navigateToPage("issues")
            }
            onCheckHandle={briar.checkOrganizationHandle}
            onCreate={async (input) => {
              await briar.addOrganization(input);
              resetNavigation("issues");
            }}
          />
        ) : activePage === "settings" &&
          settingsTarget.scope === "application" &&
          briar.user ? (
          <AppSettings
            error={
              activeProject
                ? briar.projectReadinessError[activeProject.id] ?? null
                : null
            }
            initialSection={settingsTarget.section}
            isSidebarOpen={isSidebarOpen}
            loading={
              activeProject
                ? briar.projectReadinessLoadingId === activeProject.id
                : false
            }
            navigationSidebar={unifiedSettingsSidebar}
            onBack={closeSettings}
            onAccountDelete={
              briar.demoMode ? undefined : briar.deleteAccount
            }
            onAccountSave={briar.updateAccountProfile}
            onRefresh={() =>
              activeProject
                ? briar.refreshProjectReadiness(activeProject.id)
                : Promise.resolve(null)
            }
            onLoadUsageReport={loadUsageReport}
            onSectionChange={(section) => {
              const target = { scope: "application" as const, section };
              setSettingsTarget(target);
              navigateToLocation(settingsNavigationLocation(target));
            }}
            projectId={activeProject?.id ?? ""}
            projectName={activeProject?.name ?? ""}
            readiness={
              activeProject
                ? briar.projectReadiness[activeProject.id] ?? null
                : null
            }
            usageScopeKey={briar.activeOrganizationId ?? "none"}
            user={briar.user}
          />
        ) : activePage === "settings" &&
        settingsTarget.scope === "organization" &&
        settingsOrganization ? (
          <OrganizationSettings
            initialSection={settingsTarget.section}
            isSidebarOpen={isSidebarOpen}
            key={settingsOrganization.id}
            navigationSidebar={unifiedSettingsSidebar}
            onBack={closeSettings}
            organization={settingsOrganization}
            onLogoChange={briar.changeOrganizationLogo}
            onRename={briar.renameOrganization}
            connectedProjectIds={briar.connectedProjectIds}
            projects={visibleProjects}
            token={briar.token ?? ""}
            userId={briar.user.id}
          />
        ) : activePage === "dms" &&
          !projectWindowProjectId &&
          briar.activeOrganizationId &&
          briar.token ? (
          <DirectMessages
            activeChannelId={desktopActiveChannelId}
            channelCatalogCursor={
              channelCatalogSnapshot?.organizationId === briar.activeOrganizationId
                ? channelCatalogSnapshot.cursor
                : null
            }
            channelInboxSyncSignal={channelInboxSyncSignal}
            channels={organizationDirectMessages}
            currentUserId={briar.user?.id ?? null}
            key={`desktop-dms:${briar.activeOrganizationId}`}
            onChannelFallback={(channelId) =>
              handleDesktopChannelFallback(channelId, "dms")
            }
            onChannelSelect={(channelId) => {
              if (channelId) navigateToChannel(channelId, "dms");
              else {
                setActiveChannelId(null);
                navigateToPage("dms");
              }
            }}
            onChannelsChange={setOrganizationChannels}
            onCreateAgent={() => {
              setSettingsTarget({
                scope: "organization",
                organizationId: briar.activeOrganizationId!,
                section: "agents",
              });
              setIsSidebarOpen(true);
              navigateToPage("settings");
            }}
            onIssueCreated={async (projectId, runId) => {
              await briar.ensureProjectSelected(projectId);
              setRequestedRunId(runId);
              navigateToIssue(runId, projectId);
            }}
            onSkillSessionAccepted={autoHunt.adoptRemoteSession}
            onViewingChannelChange={handleViewingChannelChange}
            organizationId={briar.activeOrganizationId}
            organizationName={activeOrganization?.name}
            projects={activeOrganizationProjects}
            token={briar.token}
          />
        ) : activePage === "inbox" ? (
          <div
            className={`inbox-layout${isResizingInbox ? " is-resizing-inbox" : ""}`}
            ref={inboxLayoutRef}
            style={
              {
                "--inbox-detail-pane-width": `${inboxDetailPaneWidth}%`,
              } as CSSProperties
            }
          >
            <Inbox
              isSidebarOpen={isSidebarOpen}
              messages={visibleInboxMessages}
              onMarkAllRead={
                projectWindowProjectId
                  ? () => {
                      for (const message of visibleInboxMessages) {
                        if (message.isUnread) inbox.markRead(message.id);
                      }
                    }
                  : inbox.markAllRead
              }
              onMarkRead={inbox.markRead}
              onOpen={(message) => {
                const target = inboxNotificationTarget(message);
                inbox.markRead(message.id);
                if (target.projectId !== briar.activeProjectId) {
                  briar.setActiveProjectId(target.projectId);
                }
                if (isInboxChannelTarget(target)) {
                  setRequestedRunId(null);
                  setRequestedSessionId(null);
                  setRequestedChannelMessage({
                    channelId: target.targetId,
                    messageId: target.channelMessageId,
                    rootMessageId: target.rootMessageId,
                  });
                  setActiveChannelId(target.targetId);
                  markOrganizationChannelRead(target.targetId);
                } else {
                  setRequestedChannelMessage(null);
                }
                setInboxDetailTarget(target);
              }}
              projects={activeOrganizationProjects}
              selectedMessageId={inboxDetailTarget?.messageId ?? null}
              unreadCount={visibleInboxUnreadCount}
            />
            <div
              aria-label={t("inbox.resizeDetailPane")}
              aria-orientation="vertical"
              aria-valuemax={inboxPaneWidthMax}
              aria-valuemin={inboxPaneWidthMin}
              aria-valuenow={inboxDetailPaneWidth}
              className="inbox-pane-resizer"
              role="separator"
              tabIndex={0}
              {...inboxResizeProps}
            />
            <InboxDetailPanel
              label={
                inboxDetailTarget ? inboxDetailLabel : t("inbox.messages")
              }
            >
              {inboxDetailContent ?? (
                <div className="inbox-detail-empty" role="status">
                  <InboxIcon aria-hidden="true" size={56} strokeWidth={1.2} />
                  <p>{t("inbox.noNotificationSelected")}</p>
                </div>
              )}
            </InboxDetailPanel>
          </div>
        ) : activePage === "settings" &&
          settingsTarget.scope === "project" &&
          activeProject ? (
          <ProjectSettings
            dashboard={briar.dashboard}
            githubRepository={
              briar.dashboard?.settings.githubRepository ??
              briar.projectReadiness[activeProject.id]?.githubRepository ??
              null
            }
            health={briar.health}
            isDeleting={briar.deletingProjectId === briar.activeProjectId}
            isSidebarOpen={isSidebarOpen}
            initialSection={settingsTarget.section}
            key={activeProject.id}
            navigationSidebar={unifiedSettingsSidebar}
            onBack={closeSettings}
            onDelete={async () => {
              const fallbackProject = briar.projects.find(
                (project) => project.id !== activeProject.id,
              );
              await briar.deleteProject(activeProject.id);
              autoHunt.removeProjectSessions(activeProject.id);
              replaceNavigationLocation(
                fallbackProject
                  ? projectNavigationLocation("issues", fallbackProject.id)
                  : "lobby",
              );
            }}
            onRegenerateWorkflow={() => briar.regenerateWorkflow(activeProject.id)}
            onAnalyzeWorkflowRequirements={() =>
              briar.analyzeWorkflowRequirements(activeProject.id)
            }
            onReviseWorkflow={(requestedChange) =>
              briar.reviseWorkflow(activeProject.id, requestedChange)
            }
            onSaveCheckpointPolicy={(scope, checkpoints, expectedRevision) =>
              briar.saveCheckpointPolicy(
                activeProject.id,
                scope,
                checkpoints,
                expectedRevision,
              )
            }
            onUpdateVelenOrg={(org) =>
              briar.saveVelenIntegration(activeProject.id, org)
            }
            onConnectLinearImport={(apiKey) =>
              briar.connectLinearForImport(activeProject.id, apiKey)
            }
            onLoadLinearImportStates={(input) =>
              briar.loadLinearStatesForImport(activeProject.id, input)
            }
            onImportLinearIssues={(input) =>
              briar.runLinearIssueImport(activeProject.id, input)
            }
            onIconChange={briar.changeProjectIcon}
            onIssueKeyPrefixChange={briar.changeProjectIssueKeyPrefix}
            onScheduleTabChange={briar.changeProjectScheduleTab}
            onRefreshVelen={briar.refreshVelen}
            onRefreshHealth={briar.refreshHealth}
            project={activeProject}
            repositoryConnected={isRepositoryConnectedForImport({
              projectId: activeProject.id,
              connectedProjectIds: briar.connectedProjectIds,
              githubRepository: briar.dashboard?.settings.githubRepository,
              repositoryPath: briar.health?.repositoryPath,
            })}
            sessionToken={briar.token}
            velen={briar.velen}
          />
        ) : activePage === "lobby" && activeProject ? (
          <ProjectLobby
            dashboard={briar.dashboard}
            isSidebarOpen={isSidebarOpen}
            onLoadUsageSummary={loadProjectHomeUsage}
            onOpenAgents={() => navigateToPage("agents")}
            onOpenIssue={(runId) => {
              setRequestedSessionId(null);
              setRequestedRunId(runId);
              navigateToIssue(runId);
            }}
            onOpenIssues={() => {
              setRequestedRunId(null);
              navigateToPage("issues");
            }}
            onOpenRepository={() => {
              if (
                briar.projectReadiness[activeProject.id]?.githubRepository ||
                briar.dashboard?.settings.githubRepository
              ) {
                setSettingsTarget({
                  scope: "project",
                  projectId: activeProject.id,
                  section: "general",
                });
                navigateToPage("settings");
                return;
              }
              setRepositorySetupProjectId(activeProject.id);
            }}
            onOpenSettings={() => {
              setSettingsTarget({
                scope: "project",
                projectId: activeProject.id,
                section: "general",
              });
              navigateToPage("settings");
            }}
            project={activeProject}
            readiness={briar.projectReadiness[activeProject.id] ?? null}
          />
        ) : activePage === "agents" && activeProject ? (
          <ProjectAgents
            dashboard={briar.dashboard}
            error={briar.error}
            isSidebarOpen={isSidebarOpen}
            onIssueOpen={(runId) => {
              setRequestedSessionId(null);
              setRequestedRunId(runId);
              navigateToIssue(runId);
            }}
            onRequestedSessionOpen={() => setRequestedSessionId(null)}
            onSettleTaskSession={(sessionId, settlement) =>
              autoHunt.settleTaskSession(sessionId, settlement)}
            onStopSession={(sessionId) => autoHunt.stopSession(sessionId)}
            onStart={startAgentAutoHunt}
            onStartRemoteTask={briar.token ? startProjectAgentTask : undefined}
            onStartTaskSession={(agent, session) => {
              rememberIssueAgent(agent);
              autoHunt.startTaskSession(activeProject.id, agent.id, {
                ...session,
                agentName: agent.name,
              });
            }}
            project={activeProject}
            requestedSessionId={requestedSessionId}
            sessions={autoHunt.sessions}
            token={briar.token}
          />
        ) : activePage === "schedule" && activeProject ? (
          <ProjectSchedule
            isSidebarOpen={isSidebarOpen}
            project={activeProject}
            token={briar.token}
          />
        ) : activePage === "channels" &&
          briar.activeOrganizationId &&
          briar.token ? (
          <Channels
            activeChannelId={desktopActiveChannelId}
            channelCatalogCursor={
              channelCatalogSnapshot?.organizationId === briar.activeOrganizationId
                ? channelCatalogSnapshot.cursor
                : null
            }
            channelInboxSyncSignal={channelInboxSyncSignal}
            channels={visibleOrganizationChannels}
            projects={activeOrganizationProjects}
            currentUserId={briar.user?.id ?? null}
            key={`desktop-channels:${briar.activeOrganizationId}`}
            onChannelFallback={(channelId) =>
              handleDesktopChannelFallback(channelId, "channels")
            }
            onChannelSelect={(channelId) => {
              if (channelId) navigateToChannel(channelId, "channels");
              else {
                setActiveChannelId(null);
                navigateToPage("channels");
              }
            }}
            onChannelsChange={setOrganizationChannels}
            onSkillSessionAccepted={autoHunt.adoptRemoteSession}
            onViewingChannelChange={handleViewingChannelChange}
            organizationId={briar.activeOrganizationId}
            organizationName={activeOrganization?.name}
            initialInviteChannelId={initialChannelInviteId}
            onInitialInviteHandled={() => setInitialChannelInviteId(null)}
            initialSettingsChannelId={requestedChannelSettingsId}
            onInitialSettingsHandled={() => setRequestedChannelSettingsId(null)}
            token={briar.token}
            requestedMessage={requestedChannelMessage}
            onRequestedMessageOpen={clearRequestedChannelMessage}
            onCreateAgent={() => {
              setSettingsTarget({
                scope: "organization",
                organizationId: briar.activeOrganizationId!,
                section: "agents",
              });
              setIsSidebarOpen(true);
              navigateToPage("settings");
            }}
            onIssueCreated={async (projectId, runId) => {
              await briar.ensureProjectSelected(projectId);
              setRequestedRunId(runId);
              navigateToIssue(runId, projectId);
            }}
          />

        ) : (
          <HuntDashboard
            agents={activeProjectAgents}
            conversationInboxSyncSignal={conversationInboxSyncSignal}
            currentUserId={briar.user?.id ?? null}
            dashboard={briar.dashboard}
            error={quickProcessError ?? briar.error}
            isCreatingIssue={briar.isCreatingIssue}
            isIssueDialogOpen={isIssueDialogOpen}
            createIssueDefaultProjectId={createIssueProjectId}
            deletingIssueId={briar.deletingIssueId}
            updatingIssueId={briar.updatingIssueId}
            noProject={!activeProject}
            recoveringRunId={briar.recoveringRunId}
            recoveryError={briar.recoveryError}
            requestedRunId={requestedRunId}
            selectedRunId={selectedRunId}
            issueListRequestKey={issueListRequestKey}
            isSidebarOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
            onCreateIssue={briar.addIssue}
            onIssueDialogOpenChange={(isOpen) => {
              if (!isOpen) setCreateIssueProjectId(null);
              setIsIssueDialogOpen(isOpen);
            }}
            onIssueViewed={markInboxIssueRead}
            onViewingIssueConversationChange={setViewingIssueConversationRunId}
            onSelectedRunChange={(runId) => {
              if (runId) navigateToIssue(runId);
              else navigateToPage("issues");
            }}
            onDeleteIssue={async (runId) => {
              await briar.deleteIssue(runId);
              if (runId === selectedRunId && navigationProjectId) {
                replaceNavigationLocation(
                  projectNavigationLocation("issues", navigationProjectId),
                );
              }
            }}
            onTransferIssue={async (runId, targetProjectId) => {
              await briar.transferIssue(runId, targetProjectId);
              if (runId === selectedRunId && navigationProjectId) {
                replaceNavigationLocation(
                  projectNavigationLocation("issues", navigationProjectId),
                );
              }
            }}
            onAddIssueDependency={briar.addIssueDependency}
            onAcceptIssueAction={briar.acceptConversationIssueAction}
            onAcceptIssueExecution={briar.acceptConversationIssueExecution}
            onAcceptSkillExecution={briar.acceptConversationSkillExecution}
            onRemoveIssueDependency={briar.removeIssueDependency}
            onUpdateIssue={briar.editIssue}
            onUpdateIssueSubscription={briar.editIssueSubscription}
            onUpdateIssueCheckpoints={briar.editIssueCheckpoints}
            onUpdateIssuePreferences={briar.editIssueExecutionPreferences}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onLoadRunEvents={briar.readRunEvents}
            onLoadRunEvidence={briar.readRunEvidence}
            onLoadRunEvidenceImage={briar.readRunEvidenceImage}
            onCompleteResultReview={briar.completeResultReview}
            onMoveRun={briar.moveRun}
            onProcessIssueNow={processIssueNow}
            onRetryRun={briar.retryRun}
            onReworkRun={briar.reworkRun}
            onCancelRun={briar.cancelRun}
            onUnassignRun={(runId) => briar.unassignRun(activeProject?.id ?? "", runId)}
            onResumeRun={briar.resumeRun}
            onRequestedRunOpen={() => {
              setRequestedRunId(null);
              setRequestedRunInitialTab(null);
            }}
            onSendIssueMessage={sendIssueMessage}
            onEditIssueMessage={briar.updateIssueMessage}
            onDeleteIssueMessage={briar.removeIssueMessage}
            processingIssueIds={processingIssueIds}
            projects={activeOrganizationProjects}
            sessions={autoHunt.sessions}
            token={briar.token}
          />
          )}
        </div>
        </div>
        <div className="app-status-bar">
          <AgentUsageStatusBar
            onManageAccounts={() => {
              setSettingsTarget({
                scope: "application",
                section: "providers",
              });
              navigateToPage("settings");
            }}
            onOpenUsageDetails={() => {
              setSettingsTarget({
                scope: "application",
                section: "usage",
              });
              navigateToPage("settings");
            }}
          />
          <WorkerStatusBar
            onOpenSettings={() => {
              if (!briar.activeOrganizationId) return;
              setSettingsTarget({
                scope: "organization",
                organizationId: briar.activeOrganizationId,
                section: "workers",
              });
              setIsSidebarOpen(true);
              navigateToPage("settings");
            }}
            onRefresh={() => briar.refresh("snapshot")}
            organizationId={briar.activeOrganizationId}
            token={briar.token}
            userId={briar.user?.id ?? null}
            workers={briar.dashboard?.workers ?? []}
          />
          <AppVersionStatus />
          <ConnectionHealth
            error={briar.healthError}
            health={briar.health}
            loading={briar.healthLoading}
            onReconnect={briar.reconnectProject}
            onRefresh={() => void briar.refreshHealth()}
            onRepair={() => void briar.repairHealth()}
          />
        </div>
      </div>
    );
  }

  if (briar.companionMode) {
    if (!briar.user) return content;
    if (briar.projects.length === 0) {
      return <CompanionEmptyState onLogout={() => void briar.logout()} />;
    }
    return (
      <div
        className={`app-shell companion-shell platform-${mobilePlatform}`}
      >
        <CompanionHeader
          activeOrganizationId={briar.activeOrganizationId}
          activeProjectId={briar.activeProjectId}
          loading={briar.loading}
          onLogout={() => void briar.logout()}
          onMarkAllRead={
            companionPage === "inbox" && inbox.unreadCount > 0
              ? inbox.markAllRead
              : undefined
          }
          onOrganizationChange={(organizationId) => {
            briar.setActiveOrganizationId(organizationId);
            setCompanionPage("issues");
            setCompanionStatus("all");
            setRequestedRunId(null);
            setRequestedSessionId(null);
          }}
          onProjectChange={(projectId) => {
            briar.setActiveProjectId(projectId);
            setCompanionPage("issues");
            setCompanionStatus("all");
            setRequestedRunId(null);
            setRequestedSessionId(null);
          }}
          onRefresh={() => void briar.refresh()}
          onSettings={() => setCompanionPage("settings")}
          organizations={briar.organizations}
          pageTitle={
            companionPage === "issues" && !requestedCompanionSession
              ? t("companion.navTasks")
              : companionPage === "inbox"
                ? t("inbox.title")
                : companionPage === "dms"
                  ? t("sidebar.dms")
                  : null
          }
          projects={briar.projects}
          user={briar.user}
        />
        {requestedCompanionSession ? (
          <ProjectAgentSessionDetail
            isSidebarOpen
            issueKeyPrefix={
              briar.projects.find(
                (project) => project.id === requestedCompanionSession.projectId,
              )?.issueKeyPrefix
            }
            onBack={() => setRequestedSessionId(null)}
            onIssueOpen={(runId) => {
              setRequestedSessionId(null);
              setRequestedRunId(runId);
              setCompanionStatus("all");
              setCompanionPage("issues");
            }}
            onStop={() => autoHunt.stopSession(requestedCompanionSession.id)}
            session={requestedCompanionSession}
            token={briar.token}
            workers={briar.dashboard?.workers ?? []}
          />
        ) : companionPage === "settings" ? (
          <CompanionSettings
            onBack={() => setCompanionPage("issues")}
            onAccountDelete={briar.deleteAccount}
            onAccountSave={briar.updateAccountProfile}
            user={briar.user}
          />
        ) : companionPage === "home" && briar.activeOrganizationId && briar.token ? (
          <>
            <CompanionChannels
              activeProjectId={activeProject?.id ?? null}
              channelInboxSyncSignal={channelInboxSyncSignal}
              currentUserId={briar.user?.id ?? null}
              organizationId={briar.activeOrganizationId}
              projects={activeOrganizationProjects}
              onSkillSessionAccepted={autoHunt.adoptRemoteSession}
              onViewingChannelChange={handleViewingChannelChange}
              token={briar.token}
              channelCache={companionChannelCache.current}
              requestedMessage={requestedChannelMessage}
              requestedChannelId={requestedChannelId}
              onRequestedChannelOpen={() => setRequestedChannelId(null)}
              onRequestedMessageOpen={clearRequestedChannelMessage}
              onIssueOpen={async (projectId, runId) => {
                await briar.ensureProjectSelected(projectId);
                setRequestedRunId(runId);
                setIssueListRequestKey((key) => key + 1);
                setCompanionStatus("all");
                setCompanionPage("issues");
              }}
            />
            <CompanionBottomNavigation
              activeDestination="home"
              onDmsOpen={() => setCompanionPage("dms")}
              onInboxOpen={() => setCompanionPage("inbox")}
              onHomeOpen={() => {}}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadDmCount={unreadDirectMessageCount}
              unreadInboxCount={inbox.unreadCount}
            />
          </>
        ) : companionPage === "inbox" ? (
          <>
            <Inbox
              companionMode
              isSidebarOpen
              messages={inbox.messages}
              onMarkAllRead={inbox.markAllRead}
              onMarkRead={inbox.markRead}
              onOpen={(message) =>
                setPendingInboxNotificationTarget(
                  inboxNotificationTarget(message),
                )}
              projects={activeOrganizationProjects}
              unreadCount={inbox.unreadCount}
            />
            <CompanionBottomNavigation
              activeDestination="inbox"
              onDmsOpen={() => setCompanionPage("dms")}
              onInboxOpen={() => {}}
              onHomeOpen={() => setCompanionPage("home")}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadDmCount={unreadDirectMessageCount}
              unreadInboxCount={inbox.unreadCount}
            />
          </>
        ) : companionPage === "dms" && briar.activeOrganizationId && briar.token ? (
          <>
            <DirectMessages
              activeChannelId={activeChannelId}
              channelCatalogCursor={
                channelCatalogSnapshot?.organizationId === briar.activeOrganizationId
                  ? channelCatalogSnapshot.cursor
                  : null
              }
              channelInboxSyncSignal={channelInboxSyncSignal}
              channels={organizationDirectMessages}
              currentUserId={briar.user?.id ?? null}
              onChannelSelect={setActiveChannelId}
              onChannelsChange={setOrganizationChannels}
              onIssueCreated={async (projectId, runId) => {
                await briar.ensureProjectSelected(projectId);
                setRequestedRunId(runId);
                setCompanionStatus("all");
                setCompanionPage("issues");
              }}
              onSkillSessionAccepted={autoHunt.adoptRemoteSession}
              onViewingChannelChange={handleViewingChannelChange}
              organizationId={briar.activeOrganizationId}
              organizationName={activeOrganization?.name}
              projects={activeOrganizationProjects}
              token={briar.token}
            />
            <CompanionBottomNavigation
              activeDestination="dms"
              onDmsOpen={() => {}}
              onInboxOpen={() => setCompanionPage("inbox")}
              onHomeOpen={() => setCompanionPage("home")}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadDmCount={unreadDirectMessageCount}
              unreadInboxCount={inbox.unreadCount}
            />
          </>
        ) : (
          <HuntDashboard
            agents={activeProjectAgents}
            conversationInboxSyncSignal={conversationInboxSyncSignal}
            currentUserId={briar.user?.id ?? null}
            companionMode
            companionStatus={companionStatus}
            companionUnreadDmCount={unreadDirectMessageCount}
            companionUnreadInboxCount={inbox.unreadCount}
            dashboard={briar.dashboard}
            error={quickProcessError ?? briar.error}
            isCreatingIssue={briar.isCreatingIssue}
            isIssueDialogOpen={isIssueDialogOpen}
            deletingIssueId={briar.deletingIssueId}
            updatingIssueId={briar.updatingIssueId}
            recoveringRunId={briar.recoveringRunId}
            recoveryError={briar.recoveryError}
            requestedRunId={requestedRunId}
            requestedRunInitialTab={requestedRunInitialTab}
            isSidebarOpen
            onCompanionDmsOpen={() => setCompanionPage("dms")}
            onCompanionInboxOpen={() => setCompanionPage("inbox")}
            onCompanionHomeOpen={() => setCompanionPage("home")}
            onCompanionStatusChange={(status) => {
              setCompanionStatus(status);
              setCompanionPage("issues");
            }}
            onCreateIssue={briar.addIssue}
            onIssueDialogOpenChange={(isOpen) => {
              if (!isOpen) setCreateIssueProjectId(null);
              setIsIssueDialogOpen(isOpen);
            }}
            onIssueViewed={markInboxIssueRead}
            onViewingIssueConversationChange={setViewingIssueConversationRunId}
            onDeleteIssue={briar.deleteIssue}
            onTransferIssue={briar.transferIssue}
            onAddIssueDependency={briar.addIssueDependency}
            onAcceptIssueAction={briar.acceptConversationIssueAction}
            onAcceptIssueExecution={briar.acceptConversationIssueExecution}
            onAcceptSkillExecution={briar.acceptConversationSkillExecution}
            onRemoveIssueDependency={briar.removeIssueDependency}
            onUpdateIssue={briar.editIssue}
            onUpdateIssueSubscription={briar.editIssueSubscription}
            onUpdateIssueCheckpoints={briar.editIssueCheckpoints}
            onUpdateIssuePreferences={briar.editIssueExecutionPreferences}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onLoadRunEvents={briar.readRunEvents}
            onLoadRunEvidence={briar.readRunEvidence}
            onLoadRunEvidenceImage={briar.readRunEvidenceImage}
            onCompleteResultReview={briar.completeResultReview}
            onMoveRun={briar.moveRun}
            onProcessIssueNow={processIssueNow}
            onRequestedRunOpen={() => {
              setRequestedRunId(null);
              setRequestedRunInitialTab(null);
            }}
            onRetryRun={briar.retryRun}
            onReworkRun={briar.reworkRun}
            onCancelRun={briar.cancelRun}
            onUnassignRun={(runId) => briar.unassignRun(activeProject?.id ?? "", runId)}
            onResumeRun={briar.resumeRun}
            onSendIssueMessage={sendIssueMessage}
            onEditIssueMessage={briar.updateIssueMessage}
            onDeleteIssueMessage={briar.removeIssueMessage}
            processingIssueIds={processingIssueIds}
            projects={activeOrganizationProjects}
            sessions={autoHunt.sessions}
            token={briar.token}
          />
        )}
        <WorkerDispatchDialog
          didDispatchSuccessfully={completedDispatchRunId === dispatchRun?.id}
          error={quickProcessError}
          isDispatching={Boolean(quickStartingRunId)}
          onOpenChange={(open) => {
            if (!open && !quickStartingRunId && !completedDispatchRunId) {
              setDispatchRun(null);
            }
          }}
          onSubmit={(input) => void submitWorkerDispatch(input)}
          open={Boolean(dispatchRun)}
          policy={briar.dashboard?.executionPolicy}
          run={dispatchRun}
          workers={briar.dashboard?.workers ?? []}
        />
      </div>
    );
  }

  return (
    <>
      {content}
      {commandPaletteAvailable && isCommandPaletteOpen ? (
        <CommandPalette
          contextLabel={commandPaletteContextLabel}
          initialQuery={commandPaletteInitialQuery}
          items={commandPaletteItems}
          loading={briar.loading || channelsLoading}
          onOpenChange={handleCommandPaletteOpenChange}
          open={isCommandPaletteOpen}
          shortcutLabel={formatShortcut(configuredKeybindings.commandPalette)}
        />
      ) : null}
      {commandPaletteAvailable ? (
        <KeyboardShortcutsDialog
          onOpenChange={setIsKeyboardShortcutsOpen}
          open={isKeyboardShortcutsOpen}
          sections={keyboardShortcutHelpSections}
        />
      ) : null}
      {pendingShortcut ? (
        <KeyboardShortcutModeHint
          choices={pendingShortcutChoices}
          label={t(
            pendingShortcutPrefix[0] === "g"
              ? "keyboardShortcuts.section.go"
              : "keyboardShortcuts.section.open",
          )}
          prefix={pendingShortcutPrefix.join(" ").toUpperCase()}
        />
      ) : null}
      {!briar.remoteMode &&
      briar.user &&
      (briar.isCreatingProject || briar.projectConnection) ? (
        <ProjectOnboarding
          canCancel={briar.organizations.length > 0}
          connection={briar.projectConnection}
          error={briar.error}
          includeDeveloperTools={developerToolsProjectSetupRequested}
          loading={briar.loading}
          onCancel={() => {
            setDeveloperToolsProjectSetupRequested(false);
            briar.cancelProjectCreation();
          }}
          onAnalyzeRequirements={async (projectId, onProgress) => {
            const workflow = await briar.analyzeWorkflowRequirements(
              projectId,
              onProgress,
            );
            const health = await briar.refreshHealth();
            return {
              workflow,
              requirements: health?.requirements ?? [],
            };
          }}
          onCloneRepository={briar.cloneProjectRepository}
          onConnect={briar.connectProject}
          onCreate={briar.addProject}
          onFinish={() => {
            setDeveloperToolsProjectSetupRequested(false);
            briar.finishProjectCreation();
            setRequestedRunId(null);
            setRequestedSessionId(null);
            resetNavigation("lobby");
          }}
          onInspectLovableRepository={briar.inspectLovableProject}
          onReviseWorkflow={briar.reviseWorkflow}
          onRepositorySelect={briar.selectProjectRepository}
          onRepositoryInspect={briar.inspectProjectRepository}
        />
      ) : null}
      <WorkerDispatchDialog
        didDispatchSuccessfully={completedDispatchRunId === dispatchRun?.id}
        error={quickProcessError}
        isDispatching={Boolean(quickStartingRunId)}
        onOpenChange={(open) => {
          if (!open && !quickStartingRunId && !completedDispatchRunId) {
            setDispatchRun(null);
          }
        }}
        onSubmit={(input) => void submitWorkerDispatch(input)}
        open={Boolean(dispatchRun)}
        policy={briar.dashboard?.executionPolicy}
        run={dispatchRun}
        workers={briar.dashboard?.workers ?? []}
      />
      <FirstRunTutorial
        onCollaboratorComplete={() => {
          if (!briar.user) return;
          clearFirstRunTutorialPending(briar.user.id);
          setPendingFirstRunTutorialUserId(null);
          resetNavigation("lobby");
        }}
        onDeveloperSelect={() => {
          if (!briar.user) return;
          clearFirstRunTutorialPending(briar.user.id);
          setPendingFirstRunTutorialUserId(null);
          setDeveloperToolsProjectSetupRequested(true);
          briar.startProjectCreation();
        }}
        open={shouldShowFirstRunTutorial}
      />
      {isLaunchIntroVisible ? (
        <LaunchIntro
          onComplete={completeLaunchIntro}
          preview={previewsLaunchIntro}
        />
      ) : null}
    </>
  );
}
