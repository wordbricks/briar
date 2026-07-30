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
import { HuntDashboard } from "./components/HuntDashboard";
import { WorkerDispatchDialog } from "./components/WorkerDispatchDialog";
import { Inbox } from "./components/Inbox";
import { InitialOnboarding } from "./components/InitialOnboarding";
import { LaunchIntro } from "./components/LaunchIntro";
import { LoginScreen } from "./components/LoginScreen";
import { OrganizationSettings } from "./components/OrganizationSettings";
import { OrganizationCreate } from "./components/OrganizationCreate";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { ProjectAgents } from "./components/ProjectAgents";
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
import { useInboxNotifications } from "./hooks/useInboxNotifications";
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
import { syncAppBadgeCount } from "./lib/app-badge";
import {
  hasDeferredProjectOnboarding,
  markProjectOnboardingDeferred,
} from "./lib/project-onboarding";
import {
  getMobilePlatform,
  isDesktopTauri,
  isMacDesktopTauri,
} from "./lib/platform";
import { issueAgentConversation } from "./lib/issue-agent-reply";
import { isRepositoryConnectedForImport } from "./lib/linear-import";
import { dispatchHuntRun, loadProjectAgents } from "./lib/api";
import { demoProjectAgents } from "./lib/demo-project-agents";
import { useI18n } from "./i18n";
import type { HuntRun, ProjectAgent } from "./types";

type ActivePage =
  | "issues"
  | "agents"
  | "schedule"
  | "inbox"
  | "organization-create"
  | "settings";

export function App() {
  const { locale, t } = useI18n();
  const autoHunt = useAutoHuntSessions();
  const scheduleSessionOptions = useMemo<UseBriarOptions>(() => ({
    startScheduledAgentSession: (run) =>
      autoHunt.startTaskSession(run.projectId, run.agent.id, {
        request: run.scheduleName,
        startedAt: run.startedAt,
        trigger: "scheduled",
        scheduleId: run.scheduleId,
        scheduleRunId: run.id,
      }),
    settleScheduledAgentSession: autoHunt.settleTaskSession,
  }), [autoHunt.settleTaskSession, autoHunt.startTaskSession]);
  const briar = useBriar(scheduleSessionOptions);
  const inbox = useInbox(
    briar.user?.id ?? null,
    briar.dashboard,
    autoHunt.sessions,
    briar.projects,
  );
  useInboxNotifications(briar.user?.id ?? null, inbox.messages);
  useEffect(() => {
    void syncAppBadgeCount(inbox.unreadCount).catch(() => {
      // An unsupported desktop environment or Android launcher must not block the app.
    });
  }, [inbox.unreadCount]);
  const mobilePlatform = getMobilePlatform() ?? "android";
  const previewsLaunchIntro = isLaunchIntroPreview();
  const runsOnDesktopTauri = isDesktopTauri();
  // Preview changes the timing, not the macOS presentation surface.
  const usesNativeLaunchIntro = isMacDesktopTauri();
  const [isLaunchIntroVisible, setIsLaunchIntroVisible] = useState(
    () =>
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
  const [requestedRunId, setRequestedRunId] = useState<string | null>(null);
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
    "issues" | "search" | "inbox" | "settings"
  >("issues");
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatusFilter>("all");
  useMobileNavigationGestures(briar.companionMode);
  useMobileBackHandler(
    () => {
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
  const [issueAgents, setIssueAgents] = useState<ProjectAgent[]>([]);
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
        if (!cancelled) setIssueAgents(loadedAgents);
      })
      .catch(() => {
        if (!cancelled) setIssueAgents([]);
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
    !briar.companionMode &&
    !briar.user &&
    !hasCompletedOnboarding;
  const sendIssueMessage = (
    runId: string,
    input: { body: string; parentMessageId: string | null },
  ) => {
    const agentConversation =
      briar.activeProjectId
        ? issueAgentConversation(
            autoHunt.sessions,
            briar.activeProjectId,
            runId,
          )
        : null;
    return briar.addIssueMessage(runId, input, agentConversation);
  };
  const processIssueNow = (run: HuntRun) => {
    if (!activeProject || issueAgents.length === 0) {
      setQuickProcessError(t("issue.processNowNoAgent"));
      return;
    }
    setQuickProcessError(null);
    setDispatchRun(run);
  };
  const submitWorkerDispatch = async (input: {
    agentId: string;
    workerId: string | null;
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
      section: "source-control",
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
        if (target.scope === "organization") {
          briar.setActiveOrganizationId(target.organizationId);
        } else if (target.scope === "project") {
          briar.setActiveProjectId(target.projectId);
        }
      }}
      organizations={briar.organizations}
      projects={briar.projects}
    />
  );

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
      />
    );
  } else if (
    !briar.companionMode &&
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
            onScheduleOpen={() => navigateToPage("schedule")}
            onInboxOpen={() => navigateToPage("inbox")}
            onIssuesOpen={() => navigateToPage("issues")}
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
          activeProject ? (
          <AppSettings
            error={briar.projectReadinessError[activeProject.id] ?? null}
            initialSection={settingsTarget.section}
            isSidebarOpen={isSidebarOpen}
            loading={briar.projectReadinessLoadingId === activeProject.id}
            navigationSidebar={unifiedSettingsSidebar}
            onBack={() => (canGoBack ? goBack() : navigateToPage("issues"))}
            onRefresh={() => briar.refreshProjectReadiness(activeProject.id)}
            projectId={activeProject.id}
            projectName={activeProject.name}
            readiness={briar.projectReadiness[activeProject.id] ?? null}
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
            onOpen={(message) => {
              inbox.markRead(message.id);
              if (message.projectId !== briar.activeProjectId) {
                briar.setActiveProjectId(message.projectId);
              }
              if (message.kind === "issue") {
                setRequestedSessionId(null);
                setRequestedRunId(message.targetId);
                navigateToPage("issues");
              } else {
                setRequestedRunId(null);
                setRequestedSessionId(message.targetId);
                navigateToPage("agents");
              }
            }}
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
            onReviseWorkflow={(requestedChange) =>
              briar.reviseWorkflow(activeProject.id, requestedChange)
            }
            onUpdateWorkflowStopAfterStage={(stopAfterStage) =>
              briar.updateWorkflowStopAfterStage(
                activeProject.id,
                stopAfterStage,
              )
            }
            onUpdateVelenOrg={(org) =>
              briar.saveVelenIntegration(activeProject.id, org)
            }
            onUpdateLinear={(linear) =>
              briar.saveLinearIntegration(activeProject.id, linear)
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
            onRefreshVelen={briar.refreshVelen}
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
            onRequestedSessionOpen={() => setRequestedSessionId(null)}
            onSettleTaskSession={(sessionId, settlement) =>
              autoHunt.settleTaskSession(sessionId, settlement)}
            onStopSession={(sessionId) => autoHunt.stopSession(sessionId)}
            onStart={(agent, runs, options) => {
              rememberIssueAgent(agent);
              return autoHunt.startSession(
                activeProject.id,
                runs,
                () => void briar.refresh(),
                {
                  agent,
                  coordinatorConversationId:
                    options?.coordinatorConversationId,
                  parentSessionId: options?.parentSessionId,
                  maxIssues: options?.maxIssues,
                },
              );
            }}
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
        ) : (
          <HuntDashboard
            agents={issueAgents}
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
            isSidebarOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
            onCreateIssue={briar.addIssue}
            onIssueDialogOpenChange={setIsIssueDialogOpen}
            onDeleteIssue={briar.deleteIssue}
            onUpdateIssue={briar.editIssue}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onLoadRunEvidence={briar.readRunEvidence}
            onMoveRun={briar.moveRun}
            onProcessIssueNow={processIssueNow}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onSendIssueMessage={sendIssueMessage}
            processingIssueIds={processingIssueIds}
            sessions={autoHunt.sessions}
            token={briar.token}
          />
          )}
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
          />
          <WorkerStatusBar workers={briar.dashboard?.workers ?? []} />
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
        {companionPage === "settings" ? (
          <CompanionSettings
            onBack={() => setCompanionPage("issues")}
            user={briar.user}
          />
        ) : companionPage === "inbox" ? (
          <>
            <Inbox
              companionMode
              isSidebarOpen
              messages={inbox.messages}
              onMarkAllRead={inbox.markAllRead}
              onOpen={(message) => {
                inbox.markRead(message.id);
                if (message.projectId !== briar.activeProjectId) {
                  briar.setActiveProjectId(message.projectId);
                }
                if (message.kind === "issue") {
                  setRequestedRunId(message.targetId);
                  setCompanionStatus("all");
                  setCompanionPage("issues");
                } else {
                  setRequestedSessionId(message.targetId);
                }
              }}
              unreadCount={inbox.unreadCount}
            />
            <CompanionBottomNavigation
              activeDestination="inbox"
              onInboxOpen={() => {}}
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
            agents={issueAgents}
            companionMode
            companionSearchMode={companionPage === "search"}
            companionStatus={companionStatus}
            companionUnreadInboxCount={inbox.unreadCount}
            dashboard={briar.dashboard}
            error={briar.error}
            isCreatingIssue={briar.isCreatingIssue}
            isIssueDialogOpen={isIssueDialogOpen}
            deletingIssueId={briar.deletingIssueId}
            updatingIssueId={briar.updatingIssueId}
            recoveringRunId={briar.recoveringRunId}
            recoveryError={briar.recoveryError}
            requestedRunId={requestedRunId}
            isSidebarOpen
            onCompanionInboxOpen={() => setCompanionPage("inbox")}
            onCompanionSearchOpen={() => setCompanionPage("search")}
            onCompanionStatusChange={(status) => {
              setCompanionStatus(status);
              setCompanionPage("issues");
            }}
            onCreateIssue={briar.addIssue}
            onIssueDialogOpenChange={setIsIssueDialogOpen}
            onDeleteIssue={briar.deleteIssue}
            onUpdateIssue={briar.editIssue}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onLoadRunEvidence={briar.readRunEvidence}
            onMoveRun={briar.moveRun}
            onProcessIssueNow={processIssueNow}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onSendIssueMessage={sendIssueMessage}
            processingIssueIds={processingIssueIds}
            sessions={autoHunt.sessions}
            token={briar.token}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {content}
      <WorkerDispatchDialog
        agents={issueAgents}
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
