import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Ideas } from "./components/Ideas";
import { InitialOnboarding } from "./components/InitialOnboarding";
import { InvitationOnboarding } from "./components/InvitationOnboarding";
import { LaunchIntro } from "./components/LaunchIntro";
import { LoginScreen } from "./components/LoginScreen";
import { OrganizationSettings } from "./components/OrganizationSettings";
import { OrganizationCreate } from "./components/OrganizationCreate";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { ProjectAgents } from "./components/ProjectAgents";
import { ProjectAgentSessionDetail } from "./components/ProjectAgentSessionDetail";
import { ProjectSchedule } from "./components/ProjectSchedule";
import { ProjectRepositorySetupDialog } from "./components/ProjectRepositorySetupDialog";
import { ProjectSettings } from "./components/ProjectSettings";
import { SessionLoadingScreen } from "./components/SessionLoadingScreen";
import { Sidebar } from "./components/Sidebar";
import {
  UnifiedSettingsSidebar,
  type UnifiedSettingsTarget,
} from "./components/UnifiedSettingsSidebar";
import { WindowNavigationControls } from "./components/WindowNavigationControls";
import { useBriar, type UseBriarOptions } from "./hooks/useBriar";
import { useAutoHuntSessions } from "./hooks/useAutoHuntSessions";
import { useInbox } from "./hooks/useInbox";
import {
  useInboxNotificationClicks,
  useInboxNotifications,
} from "./hooks/useInboxNotifications";
import {
  useMobileBackHandler,
  useMobileNavigationGestures,
} from "./hooks/useMobileNavigation";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
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
import { DASHBOARD_POLL_INTERVAL_MS } from "./lib/dashboard-polling";
import { featureFlags } from "./lib/feature-flags";
import {
  buildStatusTrayItems,
  buildStatusTraySnapshot,
  listenForStatusTrayOpenRun,
  syncStatusTray,
} from "./lib/status-tray";
import type { MessageKey } from "./i18n/messages";
import {
  inboxNotificationTarget,
  type InboxNotificationTarget,
} from "./lib/inbox-notifications";
import {
  hasDeferredProjectOnboarding,
  markProjectOnboardingDeferred,
} from "./lib/project-onboarding";
import {
  getMobilePlatform,
  isDesktopTauri,
  isMacDesktopTauri,
  isWebApp,
} from "./lib/platform";
import {
  listenForBriarLinks,
  type BriarLinkTarget,
} from "./lib/issue-links";
import { isRepositoryConnectedForImport } from "./lib/linear-import";
import { settingsAccountSelection } from "./lib/settings-account-selection";
import {
  dispatchHuntRun,
  loadDashboard,
  loadProjectAgents,
  retryHuntRun,
} from "./lib/api";
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
import { useI18n } from "./i18n";
import type { HuntRun, ProjectAgent } from "./types";

type ActivePage =
  | "issues"
  | "agents"
  | "ideas"
  | "schedule"
  | "inbox"
  | "organization-create"
  | "settings";

type AgentAutoHuntOptions = {
  coordinatorConversationId?: string | null;
  parentSessionId?: string;
  maxIssues?: number;
  targetRunIds?: string[];
  retryReason?: string | null;
};

export function App() {
  const { locale, t } = useI18n();
  const autoHunt = useAutoHuntSessions();
  const [invitationToken, setInvitationToken] = useState(
    loadOrganizationInvitationToken,
  );
  const [acceptingInvitation, setAcceptingInvitation] = useState(false);
  const plannedUpdateRecoveryRef = useRef<Promise<void> | null>(null);
  const scheduleSessionOptions = useMemo<UseBriarOptions>(() => ({
    deferDefaultOrganization: invitationToken !== null,
    startScheduledAgentSession: (run) =>
      autoHunt.startTaskSession(run.projectId, run.agent.id, {
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
    autoHunt.settleTaskSession,
    autoHunt.startTaskSession,
    autoHunt.startWorkerDispatchSession,
    invitationToken,
  ]);
  const briar = useBriar(scheduleSessionOptions);
  const [statusTrayRunsByProject, setStatusTrayRunsByProject] = useState<
    Record<string, readonly HuntRun[]>
  >({});
  useEffect(() => {
    autoHunt.configureSync(
      briar.token,
      briar.projects.map((project) => project.id),
    );
  }, [autoHunt.configureSync, briar.projects, briar.token]);
  useEffect(() => {
    if (!briar.dashboard) return;
    autoHunt.reconcileWorkerDispatches(
      briar.dashboard.project.id,
      briar.dashboard.runs,
    );
  }, [autoHunt.reconcileWorkerDispatches, briar.dashboard]);
  const inbox = useInbox(
    briar.user?.id ?? null,
    briar.activeOrganizationId,
    briar.dashboard,
    autoHunt.sessions,
    briar.projects,
  );
  useInboxNotifications(
    briar.user?.id ?? null,
    briar.activeOrganizationId,
    inbox.messages,
  );
  useEffect(() => {
    void syncAppBadgeCount(inbox.unreadCount).catch(() => {
      // An unsupported desktop environment or Android launcher must not block the app.
    });
  }, [inbox.unreadCount]);
  const mobilePlatform = getMobilePlatform() ?? "android";
  const previewsLaunchIntro = isLaunchIntroPreview();
  const runsOnDesktopTauri = isDesktopTauri();
  const runsOnMacDesktop = isMacDesktopTauri();
  const runsOnWeb = isWebApp();
  useEffect(() => {
    if (!runsOnMacDesktop) return;
    const dashboard = briar.dashboard;
    if (!dashboard) return;
    setStatusTrayRunsByProject((current) => ({
      ...current,
      [dashboard.project.id]: dashboard.runs,
    }));
  }, [briar.dashboard, runsOnMacDesktop]);
  useEffect(() => {
    if (!runsOnMacDesktop) return;
    const projects = briar.projects;
    const token = briar.token;
    if (!token || projects.length === 0) {
      setStatusTrayRunsByProject({});
      return;
    }
    const projectIds = new Set(projects.map((project) => project.id));
    setStatusTrayRunsByProject((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectId]) =>
          projectIds.has(projectId),
        ),
      ),
    );
    let cancelled = false;
    let refreshInFlight = false;
    const refreshAllProjects = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      const results = await Promise.allSettled(
        projects.map((project) => loadDashboard(token, project.id)),
      );
      refreshInFlight = false;
      if (cancelled) return;
      setStatusTrayRunsByProject((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            next[projects[index].id] = result.value.runs;
          }
        });
        return next;
      });
    };

    void refreshAllProjects();
    const intervalId = window.setInterval(
      () => void refreshAllProjects(),
      DASHBOARD_POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [briar.projects, briar.token, runsOnMacDesktop]);
  useEffect(() => {
    if (!runsOnMacDesktop) return;
    const items = buildStatusTrayItems(
      briar.projects.map((project) => ({
        project: { id: project.id, name: project.name },
        runs: statusTrayRunsByProject[project.id] ?? [],
      })),
      {
        untitledTitle: t("statusTray.untitledIssue"),
        localizeStatus: (fallback, run) => {
          if (run.status === "running" && run.workflowStage) {
            const stageKey = `stage.${run.workflowStage}` as MessageKey;
            const localized = t(stageKey);
            if (localized && localized !== stageKey) return localized;
            const configured = run.workflow.stages.find(
              (stage) => stage.id === run.workflowStage,
            );
            return configured?.label ?? fallback;
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
    briar.projects,
    locale,
    runsOnMacDesktop,
    statusTrayRunsByProject,
    t,
  ]);
  useEffect(() => {
    if (!runsOnDesktopTauri) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("sync_execution_worker_labels"))
      .catch(() => {
        // Offline startup must not block the rest of the desktop app.
      });
  }, [runsOnDesktopTauri]);
  // Preview changes the timing, not the macOS presentation surface.
  const usesNativeLaunchIntro = isMacDesktopTauri();
  const [isLaunchIntroVisible, setIsLaunchIntroVisible] = useState(
    () =>
      !runsOnWeb &&
      !usesNativeLaunchIntro &&
      (previewsLaunchIntro || shouldShowLaunchIntro()),
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [settingsTarget, setSettingsTarget] =
    useState<UnifiedSettingsTarget>({
      scope: "application",
      section: "source-control",
    });
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    hasCompletedInitialOnboarding,
  );
  const [
    deferredProjectOnboardingUserId,
    setDeferredProjectOnboardingUserId,
  ] = useState<string | null>(null);
  const {
    current: activePage,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    navigate: navigateToPage,
    reset: resetNavigation,
  } = useNavigationHistory<ActivePage>("issues");
  const [pendingBriarLink, setPendingBriarLink] =
    useState<BriarLinkTarget | null>(null);
  const [pendingInboxNotificationTarget, setPendingInboxNotificationTarget] =
    useState<InboxNotificationTarget | null>(null);
  const [inboxDetailTarget, setInboxDetailTarget] =
    useState<InboxNotificationTarget | null>(null);
  useInboxNotificationClicks(setPendingInboxNotificationTarget);
  const [requestedRunId, setRequestedRunId] = useState<string | null>(null);
  const [issueListRequestKey, setIssueListRequestKey] = useState(0);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(
    null,
  );
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [quickStartingRunId, setQuickStartingRunId] = useState<string | null>(
    null,
  );
  const [quickProcessError, setQuickProcessError] = useState<string | null>(
    null,
  );
  const [dispatchRun, setDispatchRun] = useState<HuntRun | null>(null);
  const [companionPage, setCompanionPage] = useState<
    "issues" | "agents" | "ideas" | "search" | "inbox" | "settings"
  >("issues");
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatusFilter>("all");
  useEffect(
    () => listenForBriarLinks(setPendingBriarLink),
    [],
  );
  useEffect(() => {
    if (!runsOnMacDesktop) return;
    return listenForStatusTrayOpenRun((payload) => {
      setPendingBriarLink({
        kind: "issue",
        projectId: payload.projectId,
        runId: payload.runId,
      });
    });
  }, [runsOnMacDesktop]);
  useEffect(() => {
    if (!pendingBriarLink || !briar.user || briar.loading) return;
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
      setRequestedRunId(pendingBriarLink.runId);
      setCompanionPage("issues");
      setCompanionStatus("all");
      navigateToPage("issues");
    } else {
      setRequestedRunId(null);
      setRequestedSessionId(pendingBriarLink.sessionId);
      setCompanionPage("agents");
      navigateToPage("agents");
    }
    setPendingBriarLink(null);
  }, [
    briar.activeProjectId,
    briar.loading,
    briar.projects,
    briar.setActiveProjectId,
    briar.user,
    navigateToPage,
    pendingBriarLink,
  ]);
  useEffect(() => {
    if (!pendingInboxNotificationTarget || !briar.user || briar.loading) return;
    if (
      !briar.projects.some(
        (project) => project.id === pendingInboxNotificationTarget.projectId,
      )
    ) {
      return;
    }

    inbox.markRead(pendingInboxNotificationTarget.messageId);
    if (pendingInboxNotificationTarget.projectId !== briar.activeProjectId) {
      briar.setActiveProjectId(pendingInboxNotificationTarget.projectId);
    }
    if (
      pendingInboxNotificationTarget.kind === "issue" ||
      pendingInboxNotificationTarget.kind === "conversation"
    ) {
      setRequestedSessionId(null);
      setRequestedRunId(pendingInboxNotificationTarget.targetId);
      if (briar.companionMode) {
        setCompanionStatus("all");
        setCompanionPage("issues");
      } else {
        navigateToPage("issues");
      }
    } else {
      setRequestedRunId(null);
      setRequestedSessionId(pendingInboxNotificationTarget.targetId);
      if (!briar.companionMode) navigateToPage("agents");
    }
    setPendingInboxNotificationTarget(null);
  }, [
    briar.activeProjectId,
    briar.companionMode,
    briar.loading,
    briar.projects,
    briar.setActiveProjectId,
    briar.user,
    inbox.markRead,
    navigateToPage,
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
  const activeOrganizationProjects = briar.projects.filter(
    (project) =>
      project.organizationId === briar.activeOrganizationId ||
      project.id === briar.activeProjectId,
  );
  const requestedCompanionSession = briar.companionMode
    ? autoHunt.sessions.find(
        (session) => session.id === requestedSessionId,
      ) ?? null
    : null;
  const inboxDetailRun =
    inboxDetailTarget && inboxDetailTarget.kind !== "session"
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
  const inboxDetailLabel = inboxDetailRun?.title ?? (inboxDetailTarget
    ? inbox.messages.find(
        (message) => message.id === inboxDetailTarget.messageId,
      )?.title ?? t("inbox.messages")
    : t("inbox.messages"));
  const isInboxDetailLoading = Boolean(
    inboxDetailTarget &&
      inboxDetailTarget.kind !== "session" &&
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
  }, [activePage, activeProject, briar.token, locale]);
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
  const hasDeferredFirstProject =
    briar.user !== null &&
    (deferredProjectOnboardingUserId === briar.user.id ||
      hasDeferredProjectOnboarding(briar.user.id));
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
  const sendIssueMessage = (
    runId: string,
    input: {
      body: string;
      parentMessageId: string | null;
      mentionedUserIds?: string[];
    },
  ) => briar.addIssueMessage(runId, input);
  const processIssueNow = (run: HuntRun) => {
    if (!activeProject) return;
    setQuickProcessError(null);
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
    workerId: string;
  }) => {
    if (!activeProject || !briar.token || !dispatchRun) return;
    setQuickStartingRunId(dispatchRun.id);
    setQuickProcessError(null);
    try {
      await dispatchHuntRun(
        briar.token,
        activeProject.id,
        dispatchRun.id,
        {
          ...input,
          persistPreferences: true,
          reassign: Boolean(dispatchRun.dispatchedAt || dispatchRun.workerId),
        },
      );
      setDispatchRun(null);
      await briar.refresh();
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

  useEffect(() => {
    if (!runsOnDesktopTauri || !briar.token || plannedUpdateRecoveryRef.current) {
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
                  session,
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
    runsOnDesktopTauri,
  ]);

  useEffect(() => {
    setQuickProcessError(null);
    setQuickStartingRunId(null);
    setDispatchRun(null);
  }, [briar.activeProjectId]);

  useEffect(() => {
    if (!briar.user || hasCompletedOnboarding) return;
    markInitialOnboardingComplete();
    setHasCompletedOnboarding(true);
  }, [briar.user, hasCompletedOnboarding]);

  useEffect(() => {
    if (!runsOnDesktopTauri) return;
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
  }, [runsOnDesktopTauri, usesNativeLaunchIntro]);

  useEffect(() => {
    if (!runsOnDesktopTauri || briar.companionMode || briar.loading) return;
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

  const unifiedSettingsSidebar = (
    <UnifiedSettingsSidebar
      activeTarget={settingsTarget}
      isOpen={isSidebarOpen}
      onBack={() => (canGoBack ? goBack() : navigateToPage("issues"))}
      onNavigate={(target) => {
        setSettingsTarget(target);
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
      organizations={briar.organizations}
      projects={briar.projects}
    />
  );

  let content: React.ReactNode;

  if (briar.restoringSession) {
    content = <SessionLoadingScreen />;
  } else if (invitationToken) {
    content = (
      <InvitationOnboarding
        accepting={acceptingInvitation}
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onAccept={async () => {
          setAcceptingInvitation(true);
          try {
            await briar.acceptInvitation(invitationToken);
            leaveOrganizationInvitationRoute();
            setInvitationToken(null);
            setRequestedRunId(null);
            setRequestedSessionId(null);
            resetNavigation("issues");
            setIsIssueDialogOpen(true);
          } finally {
            setAcceptingInvitation(false);
          }
        }}
        onCancelLogin={briar.cancelLogin}
        onLeave={() => {
          leaveOrganizationInvitationRoute();
          window.location.reload();
        }}
        onLogin={() => void briar.login()}
        onSwitchAccount={async () => {
          await briar.logout();
          await briar.login({ forceAccountSelection: true });
        }}
        token={invitationToken}
        user={briar.user}
      />
    );
  } else if (shouldShowInitialOnboarding) {
    content = (
      <InitialOnboarding
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onCancelLogin={briar.cancelLogin}
        onLogin={() => void briar.login()}
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
        onLogin={() => void briar.login()}
        webMode={briar.webMode}
      />
    );
  } else if (
    !briar.remoteMode &&
    ((briar.projects.length === 0 && !hasDeferredFirstProject) ||
      briar.isCreatingProject ||
      briar.projectConnection)
  ) {
    content = (
      <ProjectOnboarding
        canCancel={briar.projects.length > 0 || hasDeferredFirstProject}
        connection={briar.projectConnection}
        error={briar.error}
        loading={briar.loading}
        onCancel={briar.cancelProjectCreation}
        onConnect={async (settings, repositoryPath) => {
          const connected = await briar.connectProject(settings, repositoryPath);
          if (connected) {
            setRequestedRunId(null);
            setRequestedSessionId(null);
            resetNavigation("issues");
          }
          return connected;
        }}
        onCreate={briar.addProject}
        onLogout={() => void briar.logout()}
        onSkip={() => {
          markProjectOnboardingDeferred(briar.user!.id);
          setDeferredProjectOnboardingUserId(briar.user!.id);
          briar.cancelProjectCreation();
          resetNavigation("issues");
        }}
        onRepositorySelect={briar.selectProjectRepository}
        onRepositoryInspect={briar.inspectProjectRepository}
        onWorkspaceCreate={briar.createProjectRepository}
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
            onSettings={openAppSettings}
            onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
          />
        {activePage !== "settings" ? (
          <Sidebar
            activePage={activePage}
            activeOrganizationId={briar.activeOrganizationId}
            activeProjectId={briar.activeProjectId}
            agents={issueAgents}
            connectedProjectIds={briar.connectedProjectIds}
            isOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
            onAgentSessionOpen={(sessionId) => {
              setRequestedRunId(null);
              setRequestedSessionId(sessionId);
              navigateToPage("agents");
            }}
            onAgentsOpen={() => navigateToPage("agents")}
            onIdeasOpen={() => navigateToPage("ideas")}
            onScheduleOpen={() => navigateToPage("schedule")}
            onInboxOpen={() => navigateToPage("inbox")}
            onIssuesOpen={() => {
              setRequestedRunId(null);
              setIssueListRequestKey((key) => key + 1);
              navigateToPage("issues");
            }}
            onCreateIssue={() => {
              navigateToPage("issues");
              setIsIssueDialogOpen(true);
            }}
            onAddOrganization={() => navigateToPage("organization-create")}
            onOrganizationChange={(organizationId) => {
              briar.setActiveOrganizationId(organizationId);
              setRequestedRunId(null);
              setRequestedSessionId(null);
              resetNavigation("issues");
            }}
            onOrganizationSettings={(organizationId, section) => {
              setSettingsTarget({
                scope: "organization",
                organizationId,
                section: section ?? "general",
              });
              setIsSidebarOpen(true);
              navigateToPage("settings");
            }}
            onProjectChange={(projectId) => {
              briar.setActiveProjectId(projectId);
              setRequestedRunId(null);
              setRequestedSessionId(null);
              resetNavigation("issues");
            }}
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
            projects={briar.projects}
            projectReadiness={briar.projectReadiness}
            sessions={autoHunt.sessions}
            token={briar.token}
            unreadInboxCount={inbox.unreadCount}
            user={briar.user}
          />
        ) : null}
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
            onBack={() => (canGoBack ? goBack() : navigateToPage("issues"))}
            onAccountDelete={
              briar.demoMode ? undefined : briar.deleteAccount
            }
            onAccountSave={briar.updateAccountProfile}
            onRefresh={() =>
              activeProject
                ? briar.refreshProjectReadiness(activeProject.id)
                : Promise.resolve(null)
            }
            projectId={activeProject?.id ?? ""}
            projectName={activeProject?.name ?? ""}
            readiness={
              activeProject
                ? briar.projectReadiness[activeProject.id] ?? null
                : null
            }
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
            onBack={() =>
              canGoBack ? goBack() : navigateToPage("issues")
            }
            organization={settingsOrganization}
            onLogoChange={briar.changeOrganizationLogo}
            onRename={briar.renameOrganization}
            connectedProjectIds={briar.connectedProjectIds}
            projects={briar.projects}
            token={briar.token ?? ""}
            userId={briar.user.id}
          />
        ) : activePage === "inbox" ? (
          <Inbox
            isSidebarOpen={isSidebarOpen}
            messages={inbox.messages}
            onMarkAllRead={inbox.markAllRead}
            onMarkRead={inbox.markRead}
            onOpen={(message) => {
              const target = inboxNotificationTarget(message);
              inbox.markRead(message.id);
              if (target.projectId !== briar.activeProjectId) {
                briar.setActiveProjectId(target.projectId);
              }
              setInboxDetailTarget(target);
            }}
            projects={activeOrganizationProjects}
            unreadCount={inbox.unreadCount}
          />
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
            onBack={() =>
              canGoBack ? goBack() : navigateToPage("issues")
            }
            onDelete={async () => {
              await briar.deleteProject(activeProject.id);
              autoHunt.removeProjectSessions(activeProject.id);
              resetNavigation("issues");
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
        ) : activePage === "agents" && activeProject ? (
          <ProjectAgents
            dashboard={briar.dashboard}
            error={briar.error}
            isSidebarOpen={isSidebarOpen}
            onIssueOpen={(runId) => {
              setRequestedSessionId(null);
              setRequestedRunId(runId);
              navigateToPage("issues");
            }}
            onRequestedSessionOpen={() => setRequestedSessionId(null)}
            onSettleTaskSession={(sessionId, settlement) =>
              autoHunt.settleTaskSession(sessionId, settlement)}
            onStopSession={(sessionId) => autoHunt.stopSession(sessionId)}
            onStart={startAgentAutoHunt}
            onStartTaskSession={(agent, session) => {
              rememberIssueAgent(agent);
              autoHunt.startTaskSession(activeProject.id, agent.id, session);
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
        ) : activePage === "ideas" && featureFlags.ideas && activeProject ? (
          <Ideas
            isSidebarOpen={isSidebarOpen}
            onIssuesCreated={(runIds) => {
              setRequestedRunId(runIds[0] ?? null);
              setIssueListRequestKey((key) => key + 1);
              navigateToPage("issues");
            }}
            projectId={activeProject.id}
            token={briar.token}
          />
        ) : (
          <HuntDashboard
            agents={activeProjectAgents}
            currentUserId={briar.user?.id ?? null}
            dashboard={briar.dashboard}
            error={quickProcessError ?? briar.error}
            isCreatingIssue={briar.isCreatingIssue}
            isIssueDialogOpen={isIssueDialogOpen}
            deletingIssueId={briar.deletingIssueId}
            updatingIssueId={briar.updatingIssueId}
            noProject={!activeProject}
            recoveringRunId={briar.recoveringRunId}
            recoveryError={briar.recoveryError}
            requestedRunId={requestedRunId}
            issueListRequestKey={issueListRequestKey}
            isSidebarOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
            onCreateIssue={briar.addIssue}
            onIssueDialogOpenChange={setIsIssueDialogOpen}
            onDeleteIssue={briar.deleteIssue}
            onAddIssueDependency={briar.addIssueDependency}
            onRemoveIssueDependency={briar.removeIssueDependency}
            onUpdateIssue={briar.editIssue}
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
            onResumeRun={briar.resumeRun}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onSendIssueMessage={sendIssueMessage}
            processingIssueIds={processingIssueIds}
            projects={activeOrganizationProjects}
            sessions={autoHunt.sessions}
            token={briar.token}
          />
          )}
          {inboxDetailTarget ? (
            <InboxDetailPanel
              label={inboxDetailLabel}
              onClose={() => setInboxDetailTarget(null)}
            >
              {inboxDetailRun ? (
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
                  error={briar.recoveryError}
                  isDeletingIssue={
                    briar.deletingIssueId === inboxDetailRun.id
                  }
                  isProcessing={processingIssueIds.has(inboxDetailRun.id)}
                  isRecovering={briar.recoveringRunId === inboxDetailRun.id}
                  isSidebarOpen
                  isUpdatingIssue={
                    briar.updatingIssueId === inboxDetailRun.id
                  }
                  mentionMembers={briar.dashboard?.members ?? []}
                  currentUserId={briar.user?.id ?? null}
                  onAddDependency={(prerequisiteRunId) =>
                    briar.addIssueDependency(
                      inboxDetailRun.id,
                      prerequisiteRunId,
                    )}
                  onBack={() => setInboxDetailTarget(null)}
                  onCancel={() => briar.cancelRun(inboxDetailRun.id)}
                  onDelete={async () => {
                    await briar.deleteIssue(inboxDetailRun.id);
                    setInboxDetailTarget(null);
                  }}
                  onDependencyOpen={(runId) =>
                    setInboxDetailTarget((current) =>
                      current ? { ...current, targetId: runId } : current
                    )}
                  onLoadAttachment={briar.readIssueAttachment}
                  onLoadIssueMessages={() =>
                    briar.readIssueMessages(inboxDetailRun.id)}
                  onLoadRunEvents={() =>
                    briar.readRunEvents(inboxDetailRun.id)}
                  onLoadRunEvidence={() =>
                    briar.readRunEvidence(inboxDetailRun.id)}
                  onLoadRunEvidenceImage={briar.readRunEvidenceImage}
                  onCompleteResultReview={() =>
                    briar.completeResultReview(inboxDetailRun.id)}
                  onMove={(placement) =>
                    briar.moveRun(inboxDetailRun.id, placement)}
                  onOpenFullPage={() => {
                    setInboxDetailTarget(null);
                    setRequestedSessionId(null);
                    setRequestedRunId(inboxDetailRun.id);
                    navigateToPage("issues");
                  }}
                  onProcessNow={() => {
                    setInboxDetailTarget(null);
                    processIssueNow(inboxDetailRun);
                  }}
                  onRemoveDependency={(prerequisiteRunId) =>
                    briar.removeIssueDependency(
                      inboxDetailRun.id,
                      prerequisiteRunId,
                    )}
                  onRetry={() => briar.retryRun(inboxDetailRun.id)}
                  onRework={(input) =>
                    briar.reworkRun(inboxDetailRun.id, input)}
                  onResume={() => briar.resumeRun(inboxDetailRun.id)}
                  onSendIssueMessage={(input) =>
                    sendIssueMessage(inboxDetailRun.id, input)}
                  onUpdateIssue={(input) =>
                    briar.editIssue(inboxDetailRun.id, input)}
                  onUpdateIssuePreferences={(input) =>
                    briar.editIssueExecutionPreferences(
                      inboxDetailRun.id,
                      input,
                    )}
                  performedAgentName={
                    issueAgents.find(
                      (agent) => agent.id === inboxDetailRun.agentId,
                    )?.name ?? null
                  }
                  projectId={inboxDetailTarget.projectId}
                  run={inboxDetailRun}
                  token={briar.token}
                />
              ) : inboxDetailSession ? (
                <ProjectAgentSessionDetail
                  isSidebarOpen
                  onBack={() => setInboxDetailTarget(null)}
                  onIssueOpen={(runId) =>
                    setInboxDetailTarget((current) =>
                      current
                        ? { ...current, kind: "issue", targetId: runId }
                        : current
                    )}
                  onStop={() => autoHunt.stopSession(inboxDetailSession.id)}
                  session={inboxDetailSession}
                  token={briar.token}
                />
              ) : isInboxDetailLoading ? (
                <div className="inbox-detail-loading" role="status">
                  {t("inbox.detailLoading")}
                </div>
              ) : (
                <div className="inbox-detail-unavailable" role="alert">
                  <strong>{t("run.loadFailed")}</strong>
                  <button
                    onClick={() => setInboxDetailTarget(null)}
                    type="button"
                  >
                    {t("common.close")}
                  </button>
                </div>
              )}
            </InboxDetailPanel>
          ) : null}
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
          projects={briar.projects}
          user={briar.user}
        />
        {requestedCompanionSession ? (
          <ProjectAgentSessionDetail
            isSidebarOpen
            onBack={() => setRequestedSessionId(null)}
            onIssueOpen={(runId) => {
              setRequestedSessionId(null);
              setRequestedRunId(runId);
              setCompanionStatus("all");
              setCompanionPage("issues");
            }}
            onStop={() => autoHunt.stopSession(requestedCompanionSession.id)}
            session={requestedCompanionSession}
          />
        ) : companionPage === "settings" ? (
          <CompanionSettings
            onBack={() => setCompanionPage("issues")}
            onAccountDelete={briar.deleteAccount}
            onAccountSave={briar.updateAccountProfile}
            user={briar.user}
          />
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
              onAgentsOpen={() => setCompanionPage("agents")}
              onIdeasOpen={() => setCompanionPage("ideas")}
              onInboxOpen={() => {}}
              onSearchOpen={() => setCompanionPage("search")}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadInboxCount={inbox.unreadCount}
            />
          </>
        ) : companionPage === "ideas" && featureFlags.ideas && activeProject ? (
          <>
            <Ideas
              isSidebarOpen
              onIssuesCreated={(runIds) => {
                setRequestedRunId(runIds[0] ?? null);
                setCompanionStatus("all");
                setCompanionPage("issues");
              }}
              projectId={activeProject.id}
              token={briar.token}
            />
            <CompanionBottomNavigation
              activeDestination="ideas"
              onAgentsOpen={() => setCompanionPage("agents")}
              onIdeasOpen={() => {}}
              onInboxOpen={() => setCompanionPage("inbox")}
              onSearchOpen={() => setCompanionPage("search")}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadInboxCount={inbox.unreadCount}
            />
          </>
        ) : companionPage === "agents" && activeProject ? (
          <>
            <ProjectAgents
              companionMode
              dashboard={briar.dashboard}
              error={briar.error}
              isSidebarOpen
              onIssueOpen={(runId) => {
                setRequestedSessionId(null);
                setRequestedRunId(runId);
                setCompanionStatus("all");
                setCompanionPage("issues");
              }}
              onRequestedSessionOpen={() => setRequestedSessionId(null)}
              onSettleTaskSession={(sessionId, settlement) =>
                autoHunt.settleTaskSession(sessionId, settlement)}
              onStopSession={(sessionId) => autoHunt.stopSession(sessionId)}
              onStart={startAgentAutoHunt}
              onStartTaskSession={(agent, session) => {
                rememberIssueAgent(agent);
                autoHunt.startTaskSession(activeProject.id, agent.id, session);
              }}
              project={activeProject}
              requestedSessionId={requestedSessionId}
              sessions={autoHunt.sessions}
              token={briar.token}
            />
            <CompanionBottomNavigation
              activeDestination="agents"
              onAgentsOpen={() => {}}
              onIdeasOpen={() => setCompanionPage("ideas")}
              onInboxOpen={() => setCompanionPage("inbox")}
              onSearchOpen={() => setCompanionPage("search")}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadInboxCount={inbox.unreadCount}
            />
          </>
        ) : (
          <HuntDashboard
            agents={activeProjectAgents}
            currentUserId={briar.user?.id ?? null}
            companionMode
            companionSearchMode={companionPage === "search"}
            companionStatus={companionStatus}
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
            isSidebarOpen
            onCompanionAgentsOpen={() => setCompanionPage("agents")}
            onCompanionIdeasOpen={() => setCompanionPage("ideas")}
            onCompanionInboxOpen={() => setCompanionPage("inbox")}
            onCompanionSearchOpen={() => setCompanionPage("search")}
            onCompanionStatusChange={(status) => {
              setCompanionStatus(status);
              setCompanionPage("issues");
            }}
            onCreateIssue={briar.addIssue}
            onIssueDialogOpenChange={setIsIssueDialogOpen}
            onDeleteIssue={briar.deleteIssue}
            onAddIssueDependency={briar.addIssueDependency}
            onRemoveIssueDependency={briar.removeIssueDependency}
            onUpdateIssue={briar.editIssue}
            onUpdateIssuePreferences={briar.editIssueExecutionPreferences}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onLoadRunEvents={briar.readRunEvents}
            onLoadRunEvidence={briar.readRunEvidence}
            onLoadRunEvidenceImage={briar.readRunEvidenceImage}
            onCompleteResultReview={briar.completeResultReview}
            onMoveRun={briar.moveRun}
            onProcessIssueNow={processIssueNow}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onRetryRun={briar.retryRun}
            onReworkRun={briar.reworkRun}
            onCancelRun={briar.cancelRun}
            onResumeRun={briar.resumeRun}
            onSendIssueMessage={sendIssueMessage}
            processingIssueIds={processingIssueIds}
            projects={activeOrganizationProjects}
            sessions={autoHunt.sessions}
            token={briar.token}
          />
        )}
        <WorkerDispatchDialog
          error={quickProcessError}
          isDispatching={Boolean(quickStartingRunId)}
          onOpenChange={(open) => {
            if (!open && !quickStartingRunId) setDispatchRun(null);
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
      <WorkerDispatchDialog
        error={quickProcessError}
        isDispatching={Boolean(quickStartingRunId)}
        onOpenChange={(open) => {
          if (!open && !quickStartingRunId) setDispatchRun(null);
        }}
        onSubmit={(input) => void submitWorkerDispatch(input)}
        open={Boolean(dispatchRun)}
        policy={briar.dashboard?.executionPolicy}
        run={dispatchRun}
        workers={briar.dashboard?.workers ?? []}
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
