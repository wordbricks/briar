import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { keyboardShortcutsModifierLabel } from "./components/app/AppDialogViews";
import { AppDialogs } from "./components/app/AppDialogs";
import { AppEffects } from "./components/app/AppEffects";
import { AuthGate } from "./components/app/AuthGate";
import { CompanionShell } from "./components/app/CompanionShell";
import { DesktopShell } from "./components/app/DesktopShell";
import { loadProjectMergeActivity } from "./lib/app-rpc/github";
import { useToast } from "./components/ui/toast";
import { useBriar, type UseBriarOptions } from "./hooks/useBriar";
import { useAutoHuntSessions } from "./hooks/useAutoHuntSessions";
import { useAgentDispatch } from "./hooks/useAgentDispatch";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useCommandPaletteItems } from "./hooks/useCommandPaletteItems";
import { useDeepLinks } from "./hooks/useDeepLinks";
import { useInbox } from "./hooks/useInbox";
import { useInvitationFlow } from "./hooks/useInvitationFlow";
import { useIssueAgents } from "./hooks/useIssueAgents";
import { useLaunchIntro } from "./hooks/useLaunchIntro";
import { useRepositorySetup } from "./hooks/useRepositorySetup";
import {
  inboxConversationSyncSignal,
  useInboxNotificationClicks,
  useInboxNotifications,
} from "./hooks/useInboxNotifications";
import {
  hasCompletedInitialOnboarding,
  markInitialOnboardingComplete,
} from "./lib/initial-onboarding";
import { syncAppBadgeCount } from "./lib/app-badge";
import { buildNavigationHistoryItems } from "./lib/navigation-history-items";
import { loadKeybindings } from "./lib/keybindings";
import type { InboxNotificationTarget } from "./generated/tauri";
import { activeDashboardAtom } from "./state/sync/view";
import {
  commandPaletteInitialQueryAtom,
  isCommandPaletteOpenAtom,
  isKeyboardShortcutsOpenAtom,
  isNavigationHistoryOpenAtom,
} from "./state/dialogs/atoms";
import {
  issueListRequestKeyAtom,
  pendingInboxNotificationTargetAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
  settingsTargetAtom,
} from "./state/navigation/atoms";
import {
  activeOrganizationChannelsAtom,
  viewingChannelIdAtom,
  viewingChannelThreadRootMessageIdAtom,
  viewingIssueConversationRunIdAtom,
} from "./state/channels/atoms";
import { useRegistry } from "./state/registry";
import {
  clearFirstRunTutorialPending,
  hasPendingFirstRunTutorial,
  markFirstRunTutorialPending,
  shouldShowFirstOrganizationSetup as resolveShouldShowFirstOrganizationSetup,
} from "./lib/team-onboarding";
import { isDesktopTauri } from "./lib/platform";
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
import { listenForAppMenuSettings } from "./lib/app-menu";
import type { AppZoomCommands } from "./lib/app-zoom";
import { useI18n } from "./i18n";

type AgentAutoHuntOptions = {
  coordinatorConversationId?: string | null;
  parentSessionId?: string;
  maxIssues?: number;
  targetRunIds?: string[];
  retryReason?: string | null;
};

export function App({
  appZoomCommands = null,
}: {
  readonly appZoomCommands?: AppZoomCommands | null;
}) {
  const { t } = useI18n();
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
    The views read it themselves now; what is left here is the inbox, which
    still derives its issue notifications from a team's runs, the worker
    dispatch reconciliation, and the navigation history's run labels.
  */
  const activeDashboard = useAtomValue(activeDashboardAtom);
  /*
    The channel catalog lives in `state/channels`, and the views read it there.
    What is left here is what the inbox needs for its "do not notify me about
    what is on screen" rule, plus the catalog the history labels channels from.
  */
  const organizationChannels = useAtomValue(activeOrganizationChannelsAtom);
  const viewingChannelId = useAtomValue(viewingChannelIdAtom);
  const viewingChannelThreadRootMessageId = useAtomValue(
    viewingChannelThreadRootMessageIdAtom,
  );
  const viewingIssueConversationRunId = useAtomValue(
    viewingIssueConversationRunIdAtom,
  );
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
  const runsOnDesktopTauri = isDesktopTauri();

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useAtom(
    isCommandPaletteOpenAtom,
  );
  const setIsNavigationHistoryOpen = useAtomSet(isNavigationHistoryOpenAtom);
  const setCommandPaletteInitialQuery = useAtomSet(
    commandPaletteInitialQueryAtom,
  );
  const isKeyboardShortcutsOpen = useAtomValue(isKeyboardShortcutsOpenAtom);
  const setSettingsTarget = useAtomSet(settingsTargetAtom);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    hasCompletedInitialOnboarding,
  );
  const [pendingFirstRunTutorialUserId, setPendingFirstRunTutorialUserId] =
    useState<string | null>(null);
  const navigation = useAppNavigation({
    selectTeam: briar.setActiveProjectId,
  });
  const {
    activePage,
    activeProjectForTabs,
    canGoBack,
    canGoForward,
    closeSettings,
    desktopActiveChannelId,
    goBack,
    goForward,
    goToNavigationHistory,
    handleDesktopChannelFallback,
    navigateToChannel,
    navigateToIssue,
    navigateToLocation,
    navigateToPage,
    navigationHistoryEntries,
    navigationHistoryIndex,
    navigationProjectId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
    resetNavigation,
    selectedRunId,
    setDefaultTeam,
  } = navigation;
  const setPendingInboxNotificationTarget = useAtomSet(
    pendingInboxNotificationTargetAtom,
  );
  const handleInboxNotificationClick = useCallback(
    (target: InboxNotificationTarget) => {
      if (!projectWindowProjectId) setPendingInboxNotificationTarget(target);
    },
    [projectWindowProjectId],
  );
  useInboxNotificationClicks(handleInboxNotificationClick);
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedRunMessageId = useAtomSet(requestedRunMessageIdAtom);
  const setRequestedRunInitialTab = useAtomSet(requestedRunInitialTabAtom);
  const setIssueListRequestKey = useAtomSet(issueListRequestKeyAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);
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
  const {
    activeTeamAgents: activeProjectAgents,
    agents: issueAgents,
    processingIssueIds,
    rememberAgent: rememberIssueAgent,
  } = useIssueAgents({
    activeTeam: activeProject,
    sessions: autoHunt.sessions,
  });
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
      setDefaultTeam(teamId);
      briar.setActiveProjectId(teamId);
    },
    [briar.setActiveProjectId, setDefaultTeam],
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
    <DesktopShell
      activeProject={activeProject}
      agents={{
        activeTeamAgents: activeProjectAgents,
        all: issueAgents,
        processingIssueIds,
        rememberAgent: rememberIssueAgent,
      }}
      autoHunt={{
        adoptRemoteSession: autoHunt.adoptRemoteSession,
        removeProjectSessions: autoHunt.removeProjectSessions,
        sessions: autoHunt.sessions,
        settleTaskSession: autoHunt.settleTaskSession,
        startTaskSession: autoHunt.startTaskSession,
        stopSession: autoHunt.stopSession,
      }}
      channelInboxSyncSignal={channelInboxSyncSignal}
      conversationInboxSyncSignal={conversationInboxSyncSignal}
      inbox={{
        allMessages: inbox.messages,
        markAllRead: inbox.markAllRead,
        markIssueRead: markInboxIssueRead,
        markRead: inbox.markRead,
        markUnread: inbox.markUnread,
        messages: visibleInboxMessages,
        unreadCount: visibleInboxUnreadCount,
      }}
      loadOrganizationProjectDashboard={loadOrganizationProjectDashboard}
      loadProjectHomeMerges={loadProjectHomeMerges}
      loadProjectHomeUsage={loadProjectHomeUsage}
      loadUsageReport={loadUsageReport}
      navigation={{
        activePage,
        activeProjectForTabs,
        canGoBack,
        canGoForward,
        closeSettings,
        desktopActiveChannelId,
        goBack,
        goForward,
        goToNavigationHistory,
        handleDesktopChannelFallback,
        navigateToChannel,
        navigateToIssue,
        navigateToLocation,
        navigateToPage,
        navigationHistoryIndex,
        navigationHistoryItems,
        navigationProjectId,
        replaceNavigationLocation,
        resetNavigation,
        selectedRunId,
        setDefaultTeam,
      }}
      openAppSettings={openAppSettings}
      openOrganizationIssue={openOrganizationIssue}
      openProjectInNewWindow={openProjectInNewWindow}
      repositorySetup={{
        beginTeamReconnect,
        closeRepositorySetup,
        openTeamRepository: openProjectRepository,
        repositorySetupTeamId,
      }}
      session={{
        deleteAccount: briar.deleteAccount,
        ensureTeamSelected: briar.ensureProjectSelected,
        logout: briar.logout,
        refresh: briar.refresh,
        selectTeam: briar.setActiveProjectId,
        updateAccountProfile: briar.updateAccountProfile,
      }}
      startAgentAutoHunt={startAgentAutoHunt}
      startProjectAgentTask={startProjectAgentTask}
    />
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
