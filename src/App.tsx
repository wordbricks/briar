import { useCallback, useEffect, useRef, useState } from "react";
import { AutoHuntSessions } from "./components/AutoHuntSessions";
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
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { ProjectSettings } from "./components/ProjectSettings";
import { Sidebar } from "./components/Sidebar";
import { useBriar } from "./hooks/useBriar";
import { useAutoHuntSessions } from "./hooks/useAutoHuntSessions";
import { useInbox } from "./hooks/useInbox";
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
  const [activePage, setActivePage] = useState<
    | "issues"
    | "auto-hunt"
    | "inbox"
    | "project-settings"
  >("issues");
  const [requestedRunId, setRequestedRunId] = useState<string | null>(null);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(
    null,
  );
  const [companionPage, setCompanionPage] = useState<
    "issues" | "inbox" | "session"
  >("issues");
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatusFilter>("all");
  const hasCompactedWindowForOnboarding = useRef(false);
  const activeProject = briar.projects.find(
    (project) => project.id === briar.activeProjectId,
  );
  const shouldShowInitialOnboarding =
    !briar.companionMode &&
    !briar.loading &&
    !briar.user &&
    !hasCompletedOnboarding;

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
            setActivePage("issues");
          }
          return connected;
        }}
        onCreate={briar.addProject}
        onLogout={() => void briar.logout()}
        onRepositorySelect={briar.selectProjectRepository}
        onVelenOrgChange={briar.refreshVelen}
        user={briar.user}
        velen={briar.velen}
      />
    );
  } else {
    content = (
      <jelly-theme mode="light" className="app-shell">
        <Sidebar
          activePage={activePage}
          activeOrganizationId={briar.activeOrganizationId}
          activeProjectId={briar.activeProjectId}
          isOpen={isSidebarOpen}
          onAddProject={briar.startProjectCreation}
          onAutoHuntOpen={() => setActivePage("auto-hunt")}
          onInboxOpen={() => setActivePage("inbox")}
          onIssuesOpen={() => setActivePage("issues")}
          onOrganizationChange={(organizationId) => {
            briar.setActiveOrganizationId(organizationId);
            setRequestedRunId(null);
            setRequestedSessionId(null);
            setActivePage("issues");
          }}
          onProjectChange={(projectId) => {
            briar.setActiveProjectId(projectId);
            setRequestedRunId(null);
            setRequestedSessionId(null);
            setActivePage("issues");
          }}
          onProjectSettings={(projectId) => {
            briar.setActiveProjectId(projectId);
            setActivePage("project-settings");
          }}
          onLogout={() => void briar.logout()}
          onToggle={() => setIsSidebarOpen(false)}
          organizations={briar.organizations}
          projects={briar.projects}
          unreadInboxCount={inbox.unreadCount}
          user={briar.user}
        />
        {activePage === "inbox" ? (
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
                setActivePage("issues");
              } else {
                setRequestedRunId(null);
                setRequestedSessionId(message.targetId);
                setActivePage("auto-hunt");
              }
            }}
            onSidebarOpen={() => setIsSidebarOpen(true)}
            unreadCount={inbox.unreadCount}
          />
        ) : activePage === "project-settings" && activeProject ? (
          <ProjectSettings
            dashboard={briar.dashboard}
            isDeleting={briar.deletingProjectId === briar.activeProjectId}
            isSidebarOpen={isSidebarOpen}
            onBack={() => setActivePage("issues")}
            onDelete={async () => {
              await briar.deleteProject(activeProject.id);
              autoHunt.removeProjectSessions(activeProject.id);
              setActivePage("issues");
            }}
            onRegenerateWorkflow={() => briar.regenerateWorkflow(activeProject.id)}
            onSidebarOpen={() => setIsSidebarOpen(true)}
            project={activeProject}
          />
        ) : activePage === "auto-hunt" && activeProject ? (
          <AutoHuntSessions
            dashboard={briar.dashboard}
            error={briar.error}
            isSidebarOpen={isSidebarOpen}
            onSidebarOpen={() => setIsSidebarOpen(true)}
            requestedSessionId={requestedSessionId}
            onRequestedSessionOpen={() => setRequestedSessionId(null)}
            onStart={(runs) =>
              autoHunt.startSession(activeProject.id, runs, () =>
                void briar.refresh()
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
            onReconnect={briar.reconnectProject}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onRepair={() => void briar.repairHealth()}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onSidebarOpen={() => setIsSidebarOpen(true)}
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
              onSidebarOpen={() => {}}
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
              onSidebarOpen={() => {}}
              onStart={(runs) =>
                autoHunt.startSession(briar.activeProjectId!, runs, () =>
                  void briar.refresh()
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
            onReconnect={() => {}}
            onRequestedRunOpen={() => setRequestedRunId(null)}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onRepair={() => {}}
            onSidebarOpen={() => {}}
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
