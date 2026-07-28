import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentUsageStatusBar } from "./components/AgentUsageStatusBar";
import { AppVersionStatus } from "./components/AppVersionStatus";
import {
  AppSettings,
  type SettingsSection,
} from "./components/AppSettings";
import {
  CompanionBottomNavigation,
  type CompanionStatusFilter,
} from "./components/CompanionBottomNavigation";
import { CompanionEmptyState, CompanionHeader } from "./components/CompanionHeader";
import { CompanionSettings } from "./components/CompanionSettings";
import { ConnectionHealth } from "./components/ConnectionHealth";
import { HuntDashboard } from "./components/HuntDashboard";
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
import { Sidebar } from "./components/Sidebar";
import { WindowNavigationControls } from "./components/WindowNavigationControls";
import { useBriar, type UseBriarOptions } from "./hooks/useBriar";
import { useAutoHuntSessions } from "./hooks/useAutoHuntSessions";
import { useInbox } from "./hooks/useInbox";
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

type ActivePage =
  | "issues"
  | "agents"
  | "schedule"
  | "inbox"
  | "project-settings"
  | "organization-create"
  | "organization-settings"
  | "settings";

export function App() {
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
  const [appSettingsSection, setAppSettingsSection] =
    useState<SettingsSection>("source-control");
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
  const [companionPage, setCompanionPage] = useState<
    "issues" | "search" | "inbox" | "settings"
  >("issues");
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatusFilter>("all");
  const [organizationSettingsTarget, setOrganizationSettingsTarget] = useState<{
    id: string;
    section?: "members";
  } | null>(null);
  const [repositorySetupProjectId, setRepositorySetupProjectId] =
    useState<string | null>(null);
  const hasCompactedWindowForOnboarding = useRef(false);
  const activeProject = briar.projects.find(
    (project) => project.id === briar.activeProjectId,
  );
  const hasDeferredFirstProject =
    briar.user !== null &&
    (deferredProjectOnboardingUserId === briar.user.id ||
      hasDeferredProjectOnboarding(briar.user.id));
  const settingsOrganization = briar.organizations.find(
    (organization) => organization.id === organizationSettingsTarget?.id,
  );
  const shouldShowInitialOnboarding =
    !briar.companionMode &&
    !briar.loading &&
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
    setAppSettingsSection("source-control");
    navigateToPage("settings");
  }, [navigateToPage]);

  let content: React.ReactNode;

  if (shouldShowInitialOnboarding) {
    content = (
      <InitialOnboarding onComplete={() => setHasCompletedOnboarding(true)} />
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
        onConnect={async (settings, repositoryPath, executionHostId) => {
          const connected = await briar.connectProject(
            settings,
            repositoryPath,
            executionHostId,
          );
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
        {activePage !== "settings" &&
        activePage !== "organization-settings" ? (
          <Sidebar
            activePage={activePage}
            activeOrganizationId={briar.activeOrganizationId}
            activeProjectId={briar.activeProjectId}
            connectedProjectIds={briar.connectedProjectIds}
            isOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
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
              setOrganizationSettingsTarget({ id: organizationId, section });
              setIsSidebarOpen(true);
              navigateToPage("organization-settings");
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
              navigateToPage("project-settings");
            }}
            onSettings={openAppSettings}
            onLogout={() => void briar.logout()}
            organizations={briar.organizations}
            projects={briar.projects}
            projectReadiness={briar.projectReadiness}
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
        ) : activePage === "settings" && activeProject ? (
          <AppSettings
            error={briar.projectReadinessError[activeProject.id] ?? null}
            initialSection={appSettingsSection}
            isSidebarOpen={isSidebarOpen}
            loading={briar.projectReadinessLoadingId === activeProject.id}
            onBack={() => (canGoBack ? goBack() : navigateToPage("issues"))}
            onRefresh={() => briar.refreshProjectReadiness(activeProject.id)}
            projectId={activeProject.id}
            projectName={activeProject.name}
            readiness={briar.projectReadiness[activeProject.id] ?? null}
          />
        ) : activePage === "organization-settings" &&
        settingsOrganization ? (
          <OrganizationSettings
            initialSection={organizationSettingsTarget?.section}
            isSidebarOpen={isSidebarOpen}
            key={`${settingsOrganization.id}-${organizationSettingsTarget?.section ?? "settings"}`}
            onBack={() =>
              canGoBack ? goBack() : navigateToPage("issues")
            }
            organization={settingsOrganization}
            onRename={briar.renameOrganization}
            token={briar.token ?? ""}
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
        ) : activePage === "project-settings" && activeProject ? (
          <ProjectSettings
            dashboard={briar.dashboard}
            githubRepository={
              briar.dashboard?.settings.githubRepository ??
              briar.projectReadiness[activeProject.id]?.githubRepository ??
              null
            }
            isDeleting={briar.deletingProjectId === briar.activeProjectId}
            isSidebarOpen={isSidebarOpen}
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
            onStart={(agent, runs, options) =>
              autoHunt.startSession(
                activeProject.id,
                runs,
                () => void briar.refresh(),
                {
                  agent,
                  coordinatorConversationId:
                    options?.coordinatorConversationId,
                  maxIssues: options?.maxIssues,
                },
              )
            }
            onStartTaskSession={(agent, session) =>
              autoHunt.startTaskSession(activeProject.id, agent.id, session)}
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
            dashboard={briar.dashboard}
            error={briar.error}
            isCreatingIssue={briar.isCreatingIssue}
            isIssueDialogOpen={isIssueDialogOpen}
            deletingIssueId={briar.deletingIssueId}
            updatingIssueId={briar.updatingIssueId}
            needsLocalConnection={!briar.isActiveProjectConnectedLocally}
            noProject={!activeProject}
            recoveringRunId={briar.recoveringRunId}
            recoveryError={briar.recoveryError}
            requestedRunId={requestedRunId}
            isSidebarOpen={isSidebarOpen}
            onConnectRepository={briar.reconnectProject}
            onAddProject={briar.startProjectCreation}
            onCreateIssue={briar.addIssue}
            onIssueDialogOpenChange={setIsIssueDialogOpen}
            onDeleteIssue={briar.deleteIssue}
            onUpdateIssue={briar.editIssue}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onLoadRunEvidence={briar.readRunEvidence}
            onMoveRun={briar.moveRun}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onSendIssueMessage={sendIssueMessage}
          />
          )}
        </div>
        <div className="app-status-bar">
          <AgentUsageStatusBar
            onManageAccounts={() => {
              setAppSettingsSection("providers");
              navigateToPage("settings");
            }}
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
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onSendIssueMessage={sendIssueMessage}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {content}
      {isLaunchIntroVisible ? (
        <LaunchIntro
          onComplete={completeLaunchIntro}
          preview={previewsLaunchIntro}
        />
      ) : null}
    </>
  );
}
