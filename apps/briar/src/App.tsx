import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import {
  Inbox as InboxIcon,
  MessageCircle,
} from "lucide-react";
import { AgentUsageStatusBar } from "./components/AgentUsageStatusBar";
import { WindowNavigationControls } from "./components/WindowNavigationControls";
import { AppVersionStatus } from "./components/AppVersionStatus";
import { HuntDashboardWithTeam } from "./components/app/HuntDashboardWithTeam";
import {
  TeamAgentsWithDashboard,
  TeamLobbyWithDashboard,
  TeamSettingsWithDashboard,
} from "./components/app/TeamViewsWithDashboard";
import {
  AppSettingsWithWorkspace,
  ConnectionHealthWithWorkspace,
  TeamRepositorySetupDialogWithWorkspace,
  WorkerStatusBarWithTeam,
} from "./components/app/WorkspaceViews";
import { InboxDetailPanel } from "./components/InboxDetailPanel";
import {
  InboxDetailTargetBoundary,
  InboxWithSelection,
} from "./components/InboxSelectionBoundary";
import {
  ChannelsWithCatalog,
  DirectMessagesWithCatalog,
} from "./components/app/ChannelViews";
import { keyboardShortcutsModifierLabel } from "./components/app/AppDialogViews";
import { AppDialogs } from "./components/app/AppDialogs";
import { AppEffects } from "./components/app/AppEffects";
import { AppSettingsSidebar } from "./components/app/AppSettingsSidebar";
import { AuthGate } from "./components/app/AuthGate";
import { CompanionShell } from "./components/app/CompanionShell";
import { InboxDetailContent } from "./components/app/InboxDetailContent";
import { loadProjectMergeActivity } from "./lib/app-rpc/github";
import { EmptyState, MainContent, PageHeader } from "./components/layout";
import { useToast } from "./components/ui/toast";
import { SidebarWithSession } from "./components/app/SidebarWithSession";
import { useBriar, type UseBriarOptions } from "./hooks/useBriar";
import { useAutoHuntSessions } from "./hooks/useAutoHuntSessions";
import { useAgentDispatch } from "./hooks/useAgentDispatch";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useCommandPaletteItems } from "./hooks/useCommandPaletteItems";
import { useDeepLinks } from "./hooks/useDeepLinks";
import { useInbox } from "./hooks/useInbox";
import { useInvitationFlow } from "./hooks/useInvitationFlow";
import { useIssueAgents } from "./hooks/useIssueAgents";
import { useLaunchIntro } from "./hooks/useLaunchIntro";
import { useRepositorySetup } from "./hooks/useRepositorySetup";
import { useWorkerDispatch } from "./hooks/useWorkerDispatch";
import {
  inboxConversationSyncSignal,
  useInboxNotificationClicks,
  useInboxNotifications,
} from "./hooks/useInboxNotifications";
import { useHorizontalPaneResize } from "./hooks/useHorizontalPaneResize";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
import {
  useAppKeyboardCommandScope,
} from "./hooks/appKeyboardCommands";
import { isTeamScheduleTabEnabled } from "./lib/team-tabs";
import {
  hasCompletedInitialOnboarding,
  markInitialOnboardingComplete,
} from "./lib/initial-onboarding";
import { syncAppBadgeCount } from "./lib/app-badge";
import { buildNavigationHistoryItems } from "./lib/navigation-history-items";
import { loadKeybindings } from "./lib/keybindings";
import { activeOrganizationTeams } from "./lib/team-window-scope";
import { inboxDetailLabel } from "./lib/inbox-detail-label";
import {
  clampInboxPaneWidth,
  inboxPaneWidthDefault,
  inboxPaneWidthMax,
  inboxPaneWidthMin,
  loadInboxPaneWidth,
  saveInboxPaneWidth,
} from "./lib/inbox-pane-width";
import {
  inboxNotificationTarget,
  isInboxChannelTarget,
} from "./lib/inbox-notifications";
import type { InboxNotificationTarget } from "./generated/tauri";
import { activeDashboardAtom } from "./state/sync/view";
import { inboxDetailTargetAtom } from "./state/inbox-selection";
import {
  activePlanningProjectIdAtom,
  commandPaletteInitialQueryAtom,
  createIssueTeamIdAtom,
  isCommandPaletteOpenAtom,
  isIssueDialogOpenAtom,
  isKeyboardShortcutsOpenAtom,
  isNavigationHistoryOpenAtom,
  isSidebarOpenAtom,
  planningProjectEditIdAtom,
  planningProjectTeamIdAtom,
  quickProcessErrorAtom,
  quickStartingRunIdAtom,
} from "./state/dialogs/atoms";
import {
  agentListRequestKeyAtom,
  companionPageAtom,
  companionStatusAtom,
  issueListRequestKeyAtom,
  pendingBriarLinkAtom,
  pendingInboxNotificationTargetAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
  settingsTargetAtom,
} from "./state/navigation/atoms";
import {
  setChannelNavigationBridge,
  useChannelActions,
} from "./state/channels/actions";
import {
  activeChannelIdAtom,
  activeOrganizationChannelsAtom,
  channelCatalogCursorAtom,
  channelsLoadingAtom,
  organizationDirectMessagesAtom,
  requestedChannelIdAtom,
  requestedChannelMessageAtom,
  unreadDirectMessageCountAtom,
  viewingChannelIdAtom,
  viewingChannelThreadRootMessageIdAtom,
  viewingIssueConversationRunIdAtom,
  visibleOrganizationChannelsAtom,
} from "./state/channels/atoms";
import { useRegistry } from "./state/registry";
import {
  clearFirstRunTutorialPending,
  hasPendingFirstRunTutorial,
  markFirstRunTutorialPending,
  shouldShowFirstOrganizationSetup as resolveShouldShowFirstOrganizationSetup,
} from "./lib/team-onboarding";
import { getMobilePlatform, isDesktopTauri } from "./lib/platform";
import {
  openTeamWindow,
  readTeamWindowProjectId,
} from "./lib/team-window";
import { LITELLM_MAIN_PRICING_SOURCE } from "./lib/agent-usage-pricing";
import { createCachedTeamUsageSummaryLoader } from "./lib/team-usage-summary";
import {
  loadAgentUsageReport,
  loadDashboard,
  loadProjectUsageSummary,
} from "./lib/api";
import { createInboxRealtimeTransport } from "./lib/channel-realtime";
import { startDesktopChannelTransition } from "./lib/channel-performance";
import { cn } from "./lib/utils";
import { hasOpenKeyboardShortcutOverlay } from "./lib/keyboard-shortcuts";
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

type AgentAutoHuntOptions = {
  coordinatorConversationId?: string | null;
  parentSessionId?: string;
  maxIssues?: number;
  targetRunIds?: string[];
  retryReason?: string | null;
};

// Pages that never show on the first screen load come from their own chunk.
// Each is behind a `<Suspense>` boundary whose fallback is an empty surface: a
// local chunk resolves in a few milliseconds, so a spinner would flash rather
// than inform.
const MyIssues = lazy(() =>
  import("./components/MyIssues").then((m) => ({ default: m.MyIssues })),
);
const OrganizationCreate = lazy(() =>
  import("./components/OrganizationCreate").then((m) => ({
    default: m.OrganizationCreate,
  })),
);
const OrganizationSettings = lazy(() =>
  import("./components/app/OrganizationSettingsWithSession").then((m) => ({
    default: m.OrganizationSettingsWithSession,
  })),
);
const TeamSchedule = lazy(() =>
  import("./components/TeamSchedule").then((m) => ({
    default: m.TeamSchedule,
  })),
);
const Teams = lazy(() =>
  import("./components/app/TeamsWithPlanningProjects").then((m) => ({
    default: m.TeamsWithPlanningProjects,
  })),
);

/** Neutral placeholder that fills the slot a lazy view is about to occupy. */
const lazyViewFallback = <div className="lazy-view-placeholder h-full w-full" />;

export function App({
  appZoomCommands = null,
}: {
  readonly appZoomCommands?: AppZoomCommands | null;
}) {
  const { locale, t } = useI18n();
  const { toast } = useToast();
  const [projectWindowProjectId] = useState(readTeamWindowProjectId);
  const autoHunt = useAutoHuntSessions();
  const scheduleSessionOptions = useMemo<UseBriarOptions>(() => ({
    adoptRemoteAgentSession: autoHunt.adoptRemoteSession,
    deferDefaultOrganization: true,
    lockedProjectId: projectWindowProjectId,
    startScheduledAgentSession: (run) =>
      autoHunt.startTaskSession(run.teamId, run.agent.id, {
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
      run.teamId,
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
  const registry = useRegistry();
  /*
    The payload on screen, read from the store rather than through the facade.
    Everything left in the shell that touches it — the inbox detail renderer and
    the two dispatch reconciliations — reads this one subscription.
  */
  const activeDashboard = useAtomValue(activeDashboardAtom);
  /*
    The channel catalog and everything selected inside it live in
    `state/channels` now. The shell reads the few values its own navigation and
    keyboard handlers need; the conversation views subscribe on their own.
  */
  const organizationChannels = useAtomValue(activeOrganizationChannelsAtom);
  const visibleOrganizationChannels = useAtomValue(
    visibleOrganizationChannelsAtom,
  );
  const organizationDirectMessages = useAtomValue(
    organizationDirectMessagesAtom,
  );
  const unreadDirectMessageCount = useAtomValue(unreadDirectMessageCountAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const channelsLoading = useAtomValue(channelsLoadingAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const setRequestedChannelMessage = useAtomSet(requestedChannelMessageAtom);
  const setRequestedChannelId = useAtomSet(requestedChannelIdAtom);
  const viewingChannelId = useAtomValue(viewingChannelIdAtom);
  const viewingChannelThreadRootMessageId = useAtomValue(
    viewingChannelThreadRootMessageIdAtom,
  );
  const [viewingIssueConversationRunId, setViewingIssueConversationRunId] =
    useAtom(viewingIssueConversationRunIdAtom);
  const {
    clearRequestedChannelMessage,
    createOrganizationChannel,
    deleteOrganizationChannel,
    markOrganizationChannelRead,
    openOrganizationChannel,
    openOrganizationChannelSettings,
    selectChannel,
    setViewingChannel,
  } = useChannelActions();
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
  const loadProjectHomeMerges = useCallback(
    (projectId: string, signal: AbortSignal) => {
      if (!briar.token) return Promise.reject(new Error("Sign in to load merge activity"));
      return loadProjectMergeActivity(briar.token, projectId, signal);
    },
    [briar.token],
  );
  const loadProjectHomeUsage = useMemo(
    () => createCachedTeamUsageSummaryLoader(async (projectId, period, range) => {
      if (!briar.token) return null;
      return loadProjectUsageSummary(briar.token, projectId, period, range);
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
    if (!activeDashboard) return;
    autoHunt.reconcileWorkerDispatches(
      activeDashboard.team.id,
      activeDashboard.runs,
    );
  }, [autoHunt.reconcileWorkerDispatches, activeDashboard]);
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
    activeDashboard,
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
    briar.token,
  );
  useEffect(() => {
    if (projectWindowProjectId) return;
    void syncAppBadgeCount(inbox.unreadCount).catch(() => {
      // An unsupported desktop environment or Android launcher must not block the app.
    });
  }, [inbox.unreadCount, projectWindowProjectId]);
  const mobilePlatform = getMobilePlatform() ?? "android";
  const runsOnDesktopTauri = isDesktopTauri();

  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useAtom(
    isCommandPaletteOpenAtom,
  );
  const [isNavigationHistoryOpen, setIsNavigationHistoryOpen] = useAtom(
    isNavigationHistoryOpenAtom,
  );
  const commandPaletteInitialQuery = useAtomValue(
    commandPaletteInitialQueryAtom,
  );
  const setCommandPaletteInitialQuery = useAtomSet(
    commandPaletteInitialQueryAtom,
  );
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useAtom(
    isKeyboardShortcutsOpenAtom,
  );
  const {
    containerRef: inboxLayoutRef,
    effectiveWidth: inboxDetailPaneWidth,
    isResizing: isResizingInbox,
    separatorProps: inboxResizeProps,
  } = useHorizontalPaneResize({
    clamp: clampInboxPaneWidth,
    cssVariable: "--inbox-detail-pane-width",
    defaultWidth: inboxPaneWidthDefault,
    load: loadInboxPaneWidth,
    max: inboxPaneWidthMax,
    min: inboxPaneWidthMin,
    save: saveInboxPaneWidth,
  });
  const [settingsTarget, setSettingsTarget] = useAtom(settingsTargetAtom);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    hasCompletedInitialOnboarding,
  );
  const [pendingFirstRunTutorialUserId, setPendingFirstRunTutorialUserId] =
    useState<string | null>(null);
  const {
    current: activeNavigationLocation,
    entries: navigationHistoryEntries,
    index: navigationHistoryIndex,
    canGoBack,
    canGoForward,
    goBack,
    goBackTo,
    goForward,
    goTo: goToNavigationHistory,
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
        (page === "inbox" || page === "my-issues") &&
        briar.activeOrganizationId
          ? organizationNavigationLocation(briar.activeOrganizationId, page)
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
      selectChannel(channelId);
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
      selectChannel,
    ],
  );
  const replaceChannelDestination = useCallback(
    (
      channelId: string | null,
      page: ChannelNavigationPage,
      organizationId = briar.activeOrganizationId,
      projectId = navigationActiveProjectIdRef.current,
    ) => {
      selectChannel(channelId);
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
      selectChannel,
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
      } else if (activePage === "inbox" || activePage === "my-issues") {
        replaceNavigationLocation(
          organizationNavigationLocation(fallbackOrganization.id, activePage),
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
        selectChannel(null);
      }
      return;
    }
    if (activeChannelId !== navigationChannelId) {
      startDesktopChannelTransition(navigationChannelId);
      selectChannel(navigationChannelId);
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
    // The catalog kept this effect re-running while the read marker was a
    // callback rebuilt from it, which is what re-marks the open channel when a
    // message lands in it. The action is stable now, so the list is the
    // dependency.
    organizationChannels,
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
      !isTeamScheduleTabEnabled(activeProjectForTabs)
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
  /*
    The channel actions navigate, and navigation is still the shell's. They ask
    for it through the registry rather than through hook dependencies, so
    `useChannelActions()` keeps returning the same object to every view that
    took it while these closures keep tracking the latest render.
  */
  useEffect(() => {
    setChannelNavigationBridge(registry, { navigateToChannel, navigateToPage });
  }, [navigateToChannel, navigateToPage, registry]);
  const [pendingBriarLink, setPendingBriarLink] = useAtom(pendingBriarLinkAtom);
  const [pendingInboxNotificationTarget, setPendingInboxNotificationTarget] =
    useAtom(pendingInboxNotificationTargetAtom);
  const setInboxDetailTarget = useAtomSet(inboxDetailTargetAtom);
  const handleInboxNotificationClick = useCallback(
    (target: InboxNotificationTarget) => {
      if (!projectWindowProjectId) setPendingInboxNotificationTarget(target);
    },
    [projectWindowProjectId],
  );
  useInboxNotificationClicks(handleInboxNotificationClick);
  const [requestedRunId, setRequestedRunId] = useAtom(requestedRunIdAtom);
  const [requestedRunMessageId, setRequestedRunMessageId] = useAtom(
    requestedRunMessageIdAtom,
  );
  const [requestedRunInitialTab, setRequestedRunInitialTab] = useAtom(
    requestedRunInitialTabAtom,
  );
  const [issueListRequestKey, setIssueListRequestKey] = useAtom(
    issueListRequestKeyAtom,
  );
  const [agentListRequestKey, setAgentListRequestKey] = useAtom(
    agentListRequestKeyAtom,
  );
  const [requestedSessionId, setRequestedSessionId] = useAtom(
    requestedSessionIdAtom,
  );
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useAtom(
    isIssueDialogOpenAtom,
  );
  const [createIssueProjectId, setCreateIssueProjectId] = useAtom(
    createIssueTeamIdAtom,
  );
  const [planningProjectTeamId, setPlanningProjectTeamId] = useAtom(
    planningProjectTeamIdAtom,
  );
  const [planningProjectEditId, setPlanningProjectEditId] = useAtom(
    planningProjectEditIdAtom,
  );
  const [activePlanningProjectId, setActivePlanningProjectId] = useAtom(
    activePlanningProjectIdAtom,
  );
  const quickStartingRunId = useAtomValue(quickStartingRunIdAtom);
  const [quickProcessError, setQuickProcessError] = useAtom(
    quickProcessErrorAtom,
  );
  const [companionPage, setCompanionPage] = useAtom(companionPageAtom);
  const [companionStatus, setCompanionStatus] = useAtom(companionStatusAtom);
  useDeepLinks({
    navigation: {
      navigateToChannel,
      navigateToIssue,
      navigateToPage,
      replaceNavigationLocation,
    },
    navigationTeamId: navigationProjectId,
    navigationUserBoundaryChanged,
    selectedRunId,
    session: {
      ensureTeamSelected: briar.ensureProjectSelected,
      markInboxRead: inbox.markRead,
      selectOrganization: briar.setActiveOrganizationId,
      selectTeam: briar.setActiveProjectId,
    },
  });
  const {
    beginTeamReconnect,
    clearTrigger: clearRepositorySetupTrigger,
    closeRepositorySetup,
    openTeamRepository: openProjectRepository,
    repositorySetupTeamId,
    restoreTrigger: restoreRepositorySetupTrigger,
  } = useRepositorySetup({
    navigateToPage,
    reconnectTeam: briar.reconnectProject,
    selectTeam: briar.setActiveProjectId,
  });
  const invitation = useInvitationFlow({
    acceptInvitation: briar.acceptInvitation,
    onInitialOnboardingComplete: () => setHasCompletedOnboarding(true),
    reconnectTeam: briar.reconnectProject,
    resetNavigation,
  });
  const activeProject = briar.projects.find(
    (project) => project.id === briar.activeProjectId,
  );
  const activeOrganization = briar.organizations.find(
    (organization) => organization.id === briar.activeOrganizationId,
  );
  const activeOrganizationProjects = activeOrganizationTeams(
    briar.projects,
    projectWindowProjectId,
    briar.activeOrganizationId,
    briar.activeProjectId,
  );
  const loadOrganizationProjectDashboard = useCallback(
    (projectId: string, signal: AbortSignal) => {
      // Read at call time from the store, which is what the render phase ref
      // assignment this replaces was working around.
      const openDashboard = registry.get(activeDashboardAtom);
      if (openDashboard?.team.id === projectId) {
        return Promise.resolve(openDashboard);
      }
      if (!briar.token) return Promise.resolve(null);
      return loadDashboard(briar.token, projectId, signal);
    },
    [briar.token, registry],
  );
  const openOrganizationIssue = useCallback(
    (projectId: string, runId: string) => {
      void (async () => {
        setRequestedSessionId(null);
        setRequestedRunMessageId(null);
        setRequestedRunInitialTab(null);
        setRequestedRunId(runId);
        setIssueListRequestKey((key) => key + 1);
        if (projectId !== briar.activeProjectId) {
          await briar.ensureProjectSelected(projectId);
        }
        navigateToIssue(runId, projectId);
      })().catch((caught) => {
        toast(caught instanceof Error ? caught.message : String(caught), {
          tone: "error",
        });
      });
    },
    [
      briar.activeProjectId,
      briar.ensureProjectSelected,
      navigateToIssue,
      toast,
    ],
  );
  const navigationHistoryItems = useMemo(
    () =>
      buildNavigationHistoryItems({
        channels: organizationChannels,
        currentUserId: briar.user?.id ?? null,
        dashboard: activeDashboard,
        entries: navigationHistoryEntries,
        organizations: briar.organizations,
        t,
        teams: briar.projects,
      }),
    [
      activeDashboard,
      briar.organizations,
      briar.projects,
      briar.user?.id,
      navigationHistoryEntries,
      organizationChannels,
      t,
    ],
  );
  const openProjectInNewWindow = useCallback(
    async (projectId: string) => {
      const project = briar.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error("Project is no longer available.");
      await openTeamWindow(project);
    },
    [briar.projects],
  );
  const requestedCompanionSession = briar.companionMode
    ? autoHunt.sessions.find(
        (session) => session.id === requestedSessionId,
      ) ?? null
    : null;
  const {
    activeTeamAgents: activeProjectAgents,
    agents: issueAgents,
    processingIssueIds,
    rememberAgent: rememberIssueAgent,
  } = useIssueAgents({
    activeTeam: activeProject,
    sessions: autoHunt.sessions,
  });
  const settingsOrganization =
    settingsTarget.scope === "organization"
      ? briar.organizations.find(
          (organization) =>
            organization.id === settingsTarget.organizationId,
        )
      : null;
  const shouldShowInitialOnboarding =
    !briar.remoteMode &&
    !hasCompletedOnboarding &&
    !invitation.hasCurrentUserInvitationProgress;
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
      !invitation.invitationToken &&
      !invitation.hasCurrentUserInvitationProgress &&
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
  const { processIssueNow, submitWorkerDispatch } = useWorkerDispatch();

  const {
    startAgentAutoHunt,
    startTeamAgentTask: startProjectAgentTask,
  } = useAgentDispatch({
    activeTeam: activeProject,
    refresh: briar.refresh,
    rememberAgent: rememberIssueAgent,
    sessions: autoHunt,
    teamWindowTeamId: projectWindowProjectId,
  });

  const {
    completeLaunchIntro,
    isLaunchIntroVisible,
    previewsLaunchIntro,
  } = useLaunchIntro({
    companionMode: briar.companionMode,
    loading: briar.loading,
    restoringSession: briar.restoringSession,
    showsInitialOnboarding: shouldShowInitialOnboarding,
    teamWindowTeamId: projectWindowProjectId,
  });

  /**
   * Selecting a team from the palette, including the "where am I" ref the
   * navigation helpers default their team id from.
   */
  const selectPaletteTeam = useCallback(
    (teamId: string) => {
      navigationActiveProjectIdRef.current = teamId;
      briar.setActiveProjectId(teamId);
    },
    [briar.setActiveProjectId],
  );

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
      !invitation.invitationToken &&
      !shouldShowInitialOnboarding &&
      !shouldShowFirstOrganizationSetup &&
      !shouldShowFirstRunTutorial &&
      !isLaunchIntroVisible
  );

  useEffect(() => {
    if (!commandPaletteAvailable || isCommandPaletteOpen || isKeyboardShortcutsOpen) {
      setIsNavigationHistoryOpen(false);
    }
  }, [
    commandPaletteAvailable,
    isCommandPaletteOpen,
    isKeyboardShortcutsOpen,
  ]);

  const configuredKeybindings = loadKeybindings();
  const openCommandPalette = useCallback((initialQuery = "") => {
    setCommandPaletteInitialQuery(initialQuery);
    setIsCommandPaletteOpen(true);
  }, []);
  const handleCommandPaletteOpenChange = useCallback((open: boolean) => {
    setIsCommandPaletteOpen(open);
    if (!open) setCommandPaletteInitialQuery("");
  }, []);
  const closeCommandPalette = useCallback(
    () => handleCommandPaletteOpenChange(false),
    [handleCommandPaletteOpenChange],
  );

  useAppShortcuts({
    activePage,
    appZoomCommands,
    canGoBack,
    canGoForward,
    closeCommandPalette,
    commandPaletteAvailable,
    goBack,
    goForward,
    navigateToPage,
    openAppSettings,
    openCommandPalette,
  });

  const commandPaletteItems = useCommandPaletteItems({
    activePage,
    canGoBack,
    canGoForward,
    commandPaletteAvailable,
    goBack,
    goForward,
    keybindings: configuredKeybindings,
    keyboardShortcutsShortcut: keyboardShortcutsModifierLabel(),
    navigateToIssue,
    navigateToPage,
    openAppSettings,
    selectTeam: selectPaletteTeam,
    selectedRunId,
    sessions: autoHunt.sessions,
    startTeamCreation: briar.startProjectCreation,
    unreadInboxCount: visibleInboxUnreadCount,
  });

  const unifiedSettingsSidebar = (
    <AppSettingsSidebar
      onBack={closeSettings}
      onNavigate={navigateToLocation}
      onSelectOrganization={briar.setActiveOrganizationId}
      onSelectTeam={briar.setActiveProjectId}
    />
  );

  const renderInboxDetailContent = (
    inboxDetailTarget: InboxNotificationTarget,
  ) => (
    <InboxDetailContent
      agents={issueAgents}
      channelInboxSyncSignal={channelInboxSyncSignal}
      conversationInboxSyncSignal={conversationInboxSyncSignal}
      onEnsureTeamSelected={briar.ensureProjectSelected}
      onNavigateToIssue={navigateToIssue}
      onNavigateToPage={navigateToPage}
      onSkillSessionAccepted={autoHunt.adoptRemoteSession}
      onStopSession={autoHunt.stopSession}
      processingIssueIds={processingIssueIds}
      sessions={autoHunt.sessions}
      target={inboxDetailTarget}
    />
  );

  const shell = briar.companionMode ? (
    <CompanionShell
      activeTeam={activeProject}
      agents={activeProjectAgents}
      channelInboxSyncSignal={channelInboxSyncSignal}
      conversationInboxSyncSignal={conversationInboxSyncSignal}
      inbox={{
        markAllRead: inbox.markAllRead,
        markIssueRead: markInboxIssueRead,
        markRead: inbox.markRead,
        markUnread: inbox.markUnread,
        messages: inbox.messages,
        unreadCount: inbox.unreadCount,
      }}
      loadProjectHomeUsage={loadProjectHomeUsage}
      processingIssueIds={processingIssueIds}
      session={{
        deleteAccount: briar.deleteAccount,
        ensureTeamSelected: briar.ensureProjectSelected,
        logout: briar.logout,
        refresh: briar.refresh,
        selectOrganization: briar.setActiveOrganizationId,
        selectTeam: briar.setActiveProjectId,
        updateAccountProfile: briar.updateAccountProfile,
      }}
      sessions={{
        adoptRemoteSession: autoHunt.adoptRemoteSession,
        list: autoHunt.sessions,
        stopSession: autoHunt.stopSession,
      }}
    />
  ) : (
      <div className="desktop-app-frame">
        <div className="app-shell">
          <WindowNavigationControls
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            historyIndex={navigationHistoryIndex}
            historyItems={navigationHistoryItems}
            isHistoryOpen={isNavigationHistoryOpen}
            isSidebarOpen={isSidebarOpen}
            onBack={goBack}
            onForward={goForward}
            onHistoryOpenChange={setIsNavigationHistoryOpen}
            onHistorySelect={goToNavigationHistory}
            onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
          />
        {activePage !== "settings" ? (
          <SidebarWithSession
            activeChannelId={desktopActiveChannelId}
            activePage={activePage}
            agents={issueAgents}
            onAddProject={briar.startProjectCreation}
            onAddPlanningProject={(teamId) => {
              setPlanningProjectEditId(null);
              setPlanningProjectTeamId(teamId);
            }}
            onPlanningProjectEdit={(projectId) => {
              setPlanningProjectTeamId(null);
              setPlanningProjectEditId(projectId);
            }}
            onPlanningProjectOpen={(planningProjectId, teamId) => {
              setActivePlanningProjectId(planningProjectId);
              navigationActiveProjectIdRef.current = teamId;
              briar.setActiveProjectId(teamId);
              setRequestedRunId(null);
              setIssueListRequestKey((key) => key + 1);
              navigateToPage("issues");
            }}
            onAgentSessionOpen={(sessionId) => {
              setRequestedRunId(null);
              setRequestedSessionId(sessionId);
              navigateToPage("agents");
            }}
            onAgentsOpen={() => {
              setRequestedSessionId(null);
              setAgentListRequestKey((key) => key + 1);
              navigateToPage("agents");
            }}
            onLobbyOpen={() => navigateToPage("lobby")}
            onScheduleOpen={() => navigateToPage("schedule")}
            onInboxOpen={() => navigateToPage("inbox")}
            onMyIssuesOpen={
              briar.activeOrganizationId
                ? () => navigateToPage("my-issues")
                : undefined
            }
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
              setActivePlanningProjectId(null);
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
              setActivePlanningProjectId(null);
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
            onProjectRepositoryOpen={openProjectRepository}
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
            sessions={autoHunt.sessions}
            unreadInboxCount={visibleInboxUnreadCount}
          />
        ) : null}
        <div className="app-content-surface">
        <Suspense fallback={null}>
        <TeamRepositorySetupDialogWithWorkspace
          onClose={closeRepositorySetup}
          teamId={repositorySetupTeamId}
        />
        </Suspense>
        <Suspense fallback={lazyViewFallback}>
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
          <AppSettingsWithWorkspace
            initialSection={settingsTarget.section}
            navigationSidebar={unifiedSettingsSidebar}
            onBack={closeSettings}
            onAccountDelete={briar.demoMode ? undefined : briar.deleteAccount}
            onAccountSave={briar.updateAccountProfile}
            onLoadUsageReport={loadUsageReport}
            onSectionChange={(section) => {
              const target = { scope: "application" as const, section };
              setSettingsTarget(target);
              navigateToLocation(settingsNavigationLocation(target));
            }}
          />
        ) : activePage === "settings" &&
        settingsTarget.scope === "organization" &&
        settingsOrganization ? (
          <OrganizationSettings
            initialSection={settingsTarget.section}
            key={settingsOrganization.id}
            navigationSidebar={unifiedSettingsSidebar}
            onBack={closeSettings}
            organization={settingsOrganization}
          />
        ) : activePage === "dms" &&
          !projectWindowProjectId &&
          briar.activeOrganizationId &&
          briar.token ? (
          <DirectMessagesWithCatalog
            activeChannelId={desktopActiveChannelId}
            channelInboxSyncSignal={channelInboxSyncSignal}
            isSidebarOpen={isSidebarOpen}
            key={`desktop-dms:${briar.activeOrganizationId}`}
            onChannelFallback={(channelId) =>
              handleDesktopChannelFallback(channelId, "dms")
            }
            onChannelSelect={(channelId) => {
              if (channelId) navigateToChannel(channelId, "dms");
              else {
                selectChannel(null);
                navigateToPage("dms");
              }
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
              navigateToIssue(runId, projectId);
            }}
            onSkillSessionAccepted={autoHunt.adoptRemoteSession}
          />
        ) : activePage === "dms" &&
          !projectWindowProjectId &&
          briar.activeOrganizationId ? (
          <MainContent id="dms">
            <PageHeader title={t("sidebar.dms")} />
            <EmptyState
              description={t("dm.composeDescription")}
              icon={<MessageCircle aria-hidden="true" size={20} />}
              title={t("dm.empty")}
            />
          </MainContent>
        ) : activePage === "projects" && activeProjectForTabs ? (
          <Teams
            isSidebarOpen={isSidebarOpen}
            onCreate={() => {
              setPlanningProjectEditId(null);
              setPlanningProjectTeamId(activeProjectForTabs.id);
            }}
            onOpen={(planningProjectId, teamId) => {
              setActivePlanningProjectId(planningProjectId);
              navigationActiveProjectIdRef.current = teamId;
              briar.setActiveProjectId(teamId);
              setRequestedRunId(null);
              setIssueListRequestKey((key) => key + 1);
              navigateToPage("issues", teamId);
            }}
            onSettings={(planningProjectId) => {
              setPlanningProjectTeamId(null);
              setPlanningProjectEditId(planningProjectId);
            }}
            teamId={activeProjectForTabs.id}
            teamName={activeProjectForTabs.name}
          />
        ) : activePage === "my-issues" && briar.activeOrganizationId ? (
          <MyIssues
            currentUserId={briar.user?.id ?? null}
            isSidebarOpen={isSidebarOpen}
            loadProjectDashboard={loadOrganizationProjectDashboard}
            onOpenIssue={openOrganizationIssue}
            organizationId={briar.activeOrganizationId}
            organizationName={activeOrganization?.name}
            projects={activeOrganizationProjects}
          />
        ) : activePage === "inbox" ? (
          <main
            aria-label={`${t("inbox.title")} · ${t("inbox.messages")}`}
            className={cn(
              "inbox-layout grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(280px,1fr)_var(--inbox-resizer-width,6px)_minmax(320px,var(--inbox-detail-pane-width,50%))] grid-rows-[minmax(0,1fr)] bg-card",
              isResizingInbox && "is-resizing-inbox cursor-col-resize select-none",
            )}
            ref={inboxLayoutRef}
          >
            <InboxWithSelection
              desktopEmbedded
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
              onMarkUnread={inbox.markUnread}
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
                  selectChannel(target.targetId);
                  markOrganizationChannelRead(target.targetId);
                } else {
                  setRequestedChannelMessage(null);
                }
                setInboxDetailTarget(target);
              }}
              projects={activeOrganizationProjects}
              unreadCount={visibleInboxUnreadCount}
            />
            <div
              aria-label={t("inbox.resizeDetailPane")}
              aria-orientation="vertical"
              aria-valuemax={inboxPaneWidthMax}
              aria-valuemin={inboxPaneWidthMin}
              aria-valuenow={inboxDetailPaneWidth}
              className={cn(
                "inbox-pane-resizer relative z-[1] h-full min-h-0 min-w-0 cursor-col-resize touch-none bg-transparent outline-none before:absolute before:bottom-0 before:left-1/2 before:top-0 before:w-px before:-translate-x-1/2 before:bg-border before:opacity-0 before:shadow-none before:transition-[opacity,background-color,box-shadow] before:duration-150 after:absolute after:left-1/2 after:top-1/2 after:h-[34px] after:w-[5px] after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:border after:border-border after:bg-card after:opacity-0 after:transition-[opacity,border-color,background-color] after:duration-150 motion-reduce:before:transition-none motion-reduce:after:transition-none hover:before:bg-primary/60 hover:before:opacity-100 hover:before:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] hover:after:border-primary/60 hover:after:bg-accent hover:after:opacity-100 focus-visible:before:bg-primary/60 focus-visible:before:opacity-100 focus-visible:before:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] focus-visible:after:border-primary/60 focus-visible:after:bg-accent focus-visible:after:opacity-100",
                isResizingInbox &&
                  "before:bg-primary/60 before:opacity-100 before:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] after:border-primary/60 after:bg-accent after:opacity-100",
              )}
              role="separator"
              tabIndex={0}
              {...inboxResizeProps}
            />
            <InboxDetailTargetBoundary>
              {(target) => (
                <InboxDetailPanel
                  label={
                    target
                      ? inboxDetailLabel({
                          fallback: t("inbox.messages"),
                          messages: inbox.messages,
                          runs: activeDashboard?.runs,
                          target,
                        })
                      : t("inbox.noNotificationSelected")
                  }
                >
                  {target ? renderInboxDetailContent(target) : (
                    <div
                      className="inbox-detail-empty flex h-full w-full flex-col items-center justify-center gap-[18px] bg-card text-center text-muted-foreground [&>svg]:text-muted-foreground/60 [&>p]:m-0 [&>p]:text-sm"
                      role="status"
                    >
                      <InboxIcon aria-hidden="true" size={56} strokeWidth={1.2} />
                      <p>{t("inbox.noNotificationSelected")}</p>
                    </div>
                  )}
                </InboxDetailPanel>
              )}
            </InboxDetailTargetBoundary>
          </main>
        ) : activePage === "settings" &&
          settingsTarget.scope === "project" &&
          activeProject ? (
          <TeamSettingsWithDashboard
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
              await briar.deleteTeam(activeProject.id);
              autoHunt.removeProjectSessions(activeProject.id);
              replaceNavigationLocation(
                fallbackProject
                  ? projectNavigationLocation("issues", fallbackProject.id)
                  : "lobby",
              );
            }}
            onIconChange={briar.changeProjectIcon}
            onIssueKeyPrefixChange={briar.changeProjectIssueKeyPrefix}
            onScheduleTabChange={briar.changeProjectScheduleTab}
            project={activeProject}
            sessionToken={briar.token}
          />
        ) : activePage === "lobby" && activeProject ? (
          <TeamLobbyWithDashboard
            isSidebarOpen={isSidebarOpen}
            onLoadUsageSummary={loadProjectHomeUsage}
            onLoadMergeActivity={loadProjectHomeMerges}
            onOpenAgents={() => {
              setRequestedSessionId(null);
              setAgentListRequestKey((key) => key + 1);
              navigateToPage("agents");
            }}
            onOpenIssue={(runId) => {
              setRequestedSessionId(null);
              setRequestedRunId(runId);
              navigateToIssue(runId);
            }}
            onOpenIssues={() => {
              setRequestedRunId(null);
              navigateToPage("issues");
            }}
            onOpenRepository={() => openProjectRepository(activeProject.id)}
            onOpenSettings={() => {
              setSettingsTarget({
                scope: "project",
                projectId: activeProject.id,
                section: "general",
              });
              navigateToPage("settings");
            }}
            project={activeProject}
          />
        ) : activePage === "agents" && activeProject ? (
          <TeamAgentsWithDashboard
            agentListRequestKey={agentListRequestKey}
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
          <TeamSchedule
            isSidebarOpen={isSidebarOpen}
            project={activeProject}
            token={briar.token}
          />
        ) : activePage === "channels" &&
          briar.activeOrganizationId &&
          briar.token ? (
          <ChannelsWithCatalog
            activeChannelId={desktopActiveChannelId}
            channelInboxSyncSignal={channelInboxSyncSignal}
            key={`desktop-channels:${briar.activeOrganizationId}`}
            onChannelFallback={(channelId) =>
              handleDesktopChannelFallback(channelId, "channels")
            }
            onChannelSelect={(channelId) => {
              if (channelId) navigateToChannel(channelId, "channels");
              else {
                selectChannel(null);
                navigateToPage("channels");
              }
            }}
            onSkillSessionAccepted={autoHunt.adoptRemoteSession}
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
          <HuntDashboardWithTeam
            agents={activeProjectAgents}
            conversationInboxSyncSignal={conversationInboxSyncSignal}
            error={quickProcessError ?? briar.error}
            isIssueDialogOpen={isIssueDialogOpen}
            createIssueDefaultProjectId={createIssueProjectId}
            noProject={!activeProject}
            requestedRunId={requestedRunId}
            requestedRunMessageId={requestedRunMessageId}
            requestedRunInitialTab={requestedRunInitialTab}
            selectedRunId={selectedRunId}
            issueListRequestKey={issueListRequestKey}
            isSidebarOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
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
            onRelatedMessageOpen={(relatedMessage) => {
              setPendingBriarLink({ kind: "channel", ...relatedMessage });
            }}
            onProcessIssueNow={processIssueNow}
            onRequestedRunOpen={() => {
              setRequestedRunId(null);
              setRequestedRunMessageId(null);
              setRequestedRunInitialTab(null);
            }}
            onSendIssueMessage={sendIssueMessage}
            processingIssueIds={processingIssueIds}
            projects={activeOrganizationProjects}
            activeIssueProjectId={activePlanningProjectId}
            sessions={autoHunt.sessions}
          />
          )}
        </Suspense>
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
          <WorkerStatusBarWithTeam
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
          />
          <AppVersionStatus />
          <ConnectionHealthWithWorkspace
            onReconnect={() => {
              if (briar.activeProjectId) {
                beginTeamReconnect(briar.activeProjectId);
              }
            }}
          />
        </div>
      </div>
  );

  return (
    <>
      <AppEffects />
      <AuthGate
        acceptingInvitation={invitation.acceptingInvitation}
        invitationToken={invitation.invitationToken}
        onAcceptInvitation={invitation.acceptCurrentInvitation}
        onInitialOnboardingComplete={() => {
          markInitialOnboardingComplete();
          setHasCompletedOnboarding(true);
        }}
        onJoinOrganization={invitation.beginInvitation}
        onOrganizationCreated={(userId) => {
          markFirstRunTutorialPending(userId);
          setPendingFirstRunTutorialUserId(userId);
          resetNavigation("lobby");
        }}
        session={{
          cancelLogin: briar.cancelLogin,
          login: briar.login,
          logout: briar.logout,
          sendLoginEmailCode: briar.sendLoginEmailCode,
          verifyLoginEmailCode: briar.verifyLoginEmailCode,
        }}
        showsFirstOrganizationSetup={shouldShowFirstOrganizationSetup}
        showsInitialOnboarding={shouldShowInitialOnboarding}
      >
        {shell}
      </AuthGate>
      <AppDialogs
        activePage={activePage}
        commandPaletteAvailable={commandPaletteAvailable}
        commandPaletteItems={commandPaletteItems}
        firstRunTutorial={{
          collaborator: invitation.showsCollaboratorTutorial,
          onCollaboratorComplete: () => {
            if (invitation.showsCollaboratorTutorial) {
              invitation.clearInvitationProgress();
              resetNavigation("lobby");
              return;
            }
            if (!briar.user) return;
            clearFirstRunTutorialPending(briar.user.id);
            setPendingFirstRunTutorialUserId(null);
            resetNavigation("lobby");
          },
          onDeveloperSelect: () => {
            if (!briar.user) return;
            clearFirstRunTutorialPending(briar.user.id);
            setPendingFirstRunTutorialUserId(null);
            invitation.setDeveloperToolsSetupRequested(true);
            briar.startProjectCreation();
          },
          open:
            shouldShowFirstRunTutorial || invitation.showsCollaboratorTutorial,
        }}
        launchIntro={{
          onComplete: completeLaunchIntro,
          preview: previewsLaunchIntro,
          visible: isLaunchIntroVisible,
        }}
        selectedRunId={selectedRunId}
        teamOnboarding={{
          includeDeveloperTools: invitation.developerToolsSetupRequested,
          onCancel: () => {
            if (invitation.invitationProgress?.nextStep === "developer") {
              invitation.clearInvitationProgress();
              invitation.clearDeveloperSetupRequest();
            }
            invitation.setDeveloperToolsSetupRequested(false);
            briar.cancelProjectCreation();
            restoreRepositorySetupTrigger();
          },
          onFinish: () => {
            if (invitation.invitationProgress?.nextStep === "developer") {
              invitation.clearInvitationProgress();
              invitation.clearDeveloperSetupRequest();
            }
            clearRepositorySetupTrigger();
            invitation.setDeveloperToolsSetupRequested(false);
            briar.finishProjectCreation();
            setRequestedRunId(null);
            setRequestedSessionId(null);
            resetNavigation("lobby");
          },
          requireDeveloperAgent:
            invitation.invitationProgress?.nextStep === "developer",
          startWithDeveloperTools: Boolean(
            invitation.invitationProgress?.nextStep === "developer" &&
              invitation.invitationProgress.initialProjectId ===
                briar.projectConnection?.project.id,
          ),
        }}
      />
    </>
  );
}
