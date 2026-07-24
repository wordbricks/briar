import { useCallback, useEffect, useRef, useState } from "react";
import { AutoHuntSessions } from "./components/AutoHuntSessions";
import { AppSettings } from "./components/AppSettings";
import {
  CompanionBottomNavigation,
  type CompanionStatusFilter,
} from "./components/CompanionBottomNavigation";
import { CompanionEmptyState, CompanionHeader } from "./components/CompanionHeader";
import { HuntDashboard } from "./components/HuntDashboard";
import { Inbox } from "./components/Inbox";
import { InitialOnboarding } from "./components/InitialOnboarding";
import { LaunchIntro } from "./components/LaunchIntro";
import { LoginScreen } from "./components/LoginScreen";
import { OrganizationSettings } from "./components/OrganizationSettings";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { ProjectRepositorySetupDialog } from "./components/ProjectRepositorySetupDialog";
import { ProjectSettings } from "./components/ProjectSettings";
import { Sidebar } from "./components/Sidebar";
import { WindowNavigationControls } from "./components/WindowNavigationControls";
import { useBriar } from "./hooks/useBriar";
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
  getMobilePlatform,
  isDesktopTauri,
  isMacDesktopTauri,
} from "./lib/platform";
import { automaticTriggersFor } from "./lib/auto-hunt-automation";
import {
  issueAgentConversation,
  mentionsBriar,
} from "./lib/issue-agent-reply";

type ActivePage =
  | "issues"
  | "auto-hunt"
  | "inbox"
  | "project-settings"
  | "organization-settings"
  | "settings";

export function App() {
  const briar = useBriar();
  const autoHunt = useAutoHuntSessions();
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
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    hasCompletedInitialOnboarding,
  );
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
  const [companionPage, setCompanionPage] = useState<
    "issues" | "inbox" | "session"
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
      briar.activeProjectId && mentionsBriar(input.body)
        ? issueAgentConversation(
            autoHunt.sessions,
            briar.activeProjectId,
            runId,
          )
        : null;
    return briar.addIssueMessage(runId, input, agentConversation);
  };

  useEffect(() => {
    const dashboard = briar.dashboard;
    if (
      !runsOnDesktopTauri ||
      briar.companionMode ||
      !dashboard?.settings.automation.enabled
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void briar.refresh();
    }, 15_000);
    return () => window.clearInterval(intervalId);
  }, [
    briar.companionMode,
    briar.dashboard?.project.id,
    briar.dashboard?.settings.automation.enabled,
    briar.refresh,
    runsOnDesktopTauri,
  ]);

  useEffect(() => {
    const dashboard = briar.dashboard;
    if (
      !runsOnDesktopTauri ||
      briar.companionMode ||
      !dashboard?.settings.automation.enabled ||
      autoHunt.sessions.some(
        (session) =>
          session.projectId === dashboard.project.id &&
          session.status === "running",
      )
    ) {
      return;
    }
    const lastAutomaticStartAt =
      autoHunt.sessions.find(
        (session) =>
          session.projectId === dashboard.project.id &&
          session.trigger?.type === "automatic",
      )?.startedAt ?? null;
    const reasons = automaticTriggersFor(
      dashboard.settings.automation,
      dashboard.runs,
      Date.now(),
      lastAutomaticStartAt,
    );
    if (reasons.length === 0) return;
    try {
      autoHunt.startSession(
        dashboard.project.id,
        dashboard.runs,
        () => void briar.refresh(),
        {
          maxIssues: dashboard.settings.automation.maxIssuesPerSession,
          trigger: { type: "automatic", reasons },
        },
      );
    } catch (error) {
      console.error("Failed to start automatic Auto Hunt session", error);
    }
  }, [
    autoHunt.sessions,
    autoHunt.startSession,
    briar.companionMode,
    briar.dashboard,
    briar.refresh,
    runsOnDesktopTauri,
  ]);

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
    (briar.projects.length === 0 ||
      briar.isCreatingProject ||
      briar.projectConnection)
  ) {
    content = (
      <ProjectOnboarding
        canCancel={briar.projects.length > 0 && briar.isCreatingProject}
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
        onRepositorySelect={briar.selectProjectRepository}
        onRepositoryInspect={briar.inspectProjectRepository}
        onVelenOrgChange={briar.refreshVelen}
        user={briar.user}
        velen={briar.velen}
      />
    );
  } else {
    content = (
      <jelly-theme mode="light" className="app-shell">
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
            activePage={activePage}
            activeOrganizationId={briar.activeOrganizationId}
            activeProjectId={briar.activeProjectId}
            isOpen={isSidebarOpen}
            onAddProject={briar.startProjectCreation}
            onAutoHuntOpen={() => navigateToPage("auto-hunt")}
            onInboxOpen={() => navigateToPage("inbox")}
            onIssuesOpen={() => navigateToPage("issues")}
            onOrganizationChange={(organizationId) => {
              briar.setActiveOrganizationId(organizationId);
              setRequestedRunId(null);
              setRequestedSessionId(null);
              resetNavigation("issues");
            }}
            onOrganizationSettings={(organizationId, section) => {
              setOrganizationSettingsTarget({ id: organizationId, section });
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
            onSettings={() => navigateToPage("settings")}
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
        {activePage === "settings" && activeProject ? (
          <AppSettings
            error={briar.projectReadinessError[activeProject.id] ?? null}
            isSidebarOpen={isSidebarOpen}
            loading={briar.projectReadinessLoadingId === activeProject.id}
            onBack={() => (canGoBack ? goBack() : navigateToPage("issues"))}
            onRefresh={() => briar.refreshProjectReadiness(activeProject.id)}
            projectId={activeProject.id}
            projectName={activeProject.name}
            readiness={briar.projectReadiness[activeProject.id] ?? null}
          />
        ) : activePage === "organization-settings" &&
        settingsOrganization &&
        briar.token ? (
          <OrganizationSettings
            initialSection={organizationSettingsTarget?.section}
            key={`${settingsOrganization.id}-${organizationSettingsTarget?.section ?? "settings"}`}
            onBack={() =>
              canGoBack ? goBack() : navigateToPage("issues")
            }
            organization={settingsOrganization}
            token={briar.token}
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
                navigateToPage("auto-hunt");
              }
            }}
            unreadCount={inbox.unreadCount}
          />
        ) : activePage === "project-settings" && activeProject ? (
          <ProjectSettings
            dashboard={briar.dashboard}
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
            onUpdateAutomation={(automation) =>
              briar.saveAutoHuntAutomation(activeProject.id, automation)
            }
            onUpdateLinear={(linear) =>
              briar.saveLinearIntegration(activeProject.id, linear)
            }
            onRefreshVelen={briar.refreshVelen}
            project={activeProject}
            velen={briar.velen}
          />
        ) : activePage === "auto-hunt" && activeProject ? (
          <AutoHuntSessions
            dashboard={briar.dashboard}
            error={briar.error}
            isSidebarOpen={isSidebarOpen}
            requestedSessionId={requestedSessionId}
            onRequestedSessionOpen={() => setRequestedSessionId(null)}
            onStart={(runs) =>
              autoHunt.startSession(
                activeProject.id,
                runs,
                () => void briar.refresh(),
                {
                  maxIssues:
                    briar.dashboard?.settings.automation.maxIssuesPerSession,
                },
              )
            }
            sessions={autoHunt.sessions}
          />
        ) : (
          <HuntDashboard
            dashboard={briar.dashboard}
            error={briar.error}
            health={briar.health}
            healthError={briar.healthError}
            healthLoading={briar.healthLoading}
            isCreatingIssue={briar.isCreatingIssue}
            recoveringRunId={briar.recoveringRunId}
            recoveryError={briar.recoveryError}
            requestedRunId={requestedRunId}
            isSidebarOpen={isSidebarOpen}
            onCreateIssue={briar.addIssue}
            onHealthRefresh={() => void briar.refreshHealth()}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onMoveRun={briar.moveRun}
            onReconnect={briar.reconnectProject}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onRepair={() => void briar.repairHealth()}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onSendIssueMessage={sendIssueMessage}
          />
        )}
      </jelly-theme>
    );
  }

  if (briar.companionMode) {
    if (!briar.user) return content;
    if (briar.projects.length === 0) {
      return <CompanionEmptyState onLogout={() => void briar.logout()} />;
    }
    return (
      <jelly-theme
        mode="light"
        className={`app-shell companion-shell platform-${mobilePlatform}`}
      >
        <CompanionHeader
          activeProjectId={briar.activeProjectId}
          loading={briar.loading}
          onLogout={() => void briar.logout()}
          onProjectChange={(projectId) => {
            briar.setActiveProjectId(projectId);
            setCompanionPage("issues");
            setCompanionStatus("all");
            setRequestedRunId(null);
            setRequestedSessionId(null);
          }}
          onRefresh={() => void briar.refresh()}
          projects={briar.projects}
          user={briar.user}
        />
        {companionPage === "inbox" ? (
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
                  setCompanionPage("session");
                }
              }}
              unreadCount={inbox.unreadCount}
            />
            <CompanionBottomNavigation
              activeDestination="inbox"
              onInboxOpen={() => {}}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadInboxCount={inbox.unreadCount}
            />
          </>
        ) : companionPage === "session" ? (
          <>
            <AutoHuntSessions
              companionMode
              dashboard={briar.dashboard}
              error={briar.error}
              isSidebarOpen
              onBack={() => setCompanionPage("inbox")}
              onRequestedSessionOpen={() => setRequestedSessionId(null)}
              onStart={(runs) =>
                autoHunt.startSession(
                  briar.activeProjectId!,
                  runs,
                  () => void briar.refresh(),
                  {
                    maxIssues:
                      briar.dashboard?.settings.automation.maxIssuesPerSession,
                  },
                )
              }
              requestedSessionId={requestedSessionId}
              sessions={autoHunt.sessions}
            />
            <CompanionBottomNavigation
              activeDestination="inbox"
              onInboxOpen={() => setCompanionPage("inbox")}
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
            companionStatus={companionStatus}
            companionUnreadInboxCount={inbox.unreadCount}
            dashboard={briar.dashboard}
            error={briar.error}
            health={null}
            healthError={null}
            healthLoading={false}
            isCreatingIssue={briar.isCreatingIssue}
            recoveringRunId={briar.recoveringRunId}
            recoveryError={briar.recoveryError}
            requestedRunId={requestedRunId}
            isSidebarOpen
            onCompanionInboxOpen={() => setCompanionPage("inbox")}
            onCompanionStatusChange={setCompanionStatus}
            onCreateIssue={briar.addIssue}
            onHealthRefresh={() => {}}
            onLoadAttachment={briar.readIssueAttachment}
            onLoadIssueMessages={briar.readIssueMessages}
            onMoveRun={briar.moveRun}
            onReconnect={() => {}}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onRepair={() => {}}
            onSendIssueMessage={sendIssueMessage}
          />
        )}
      </jelly-theme>
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
