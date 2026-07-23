import { useCallback, useState } from "react";
import { AutoHuntSessions } from "./components/AutoHuntSessions";
import { HuntDashboard } from "./components/HuntDashboard";
import { LaunchIntro } from "./components/LaunchIntro";
import { LoginScreen } from "./components/LoginScreen";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { ProjectSettings } from "./components/ProjectSettings";
import { Sidebar } from "./components/Sidebar";
import { useBriar } from "./hooks/useBriar";
import { useAutoHuntSessions } from "./hooks/useAutoHuntSessions";

const launchIntroStorageKey = "briar.launch-intro.seen.v1";

function shouldShowLaunchIntro() {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("intro")) return true;
  try {
    return window.localStorage.getItem(launchIntroStorageKey) !== "true";
  } catch {
    return true;
  }
}

export function App() {
  const briar = useBriar();
  const autoHunt = useAutoHuntSessions();
  const [isLaunchIntroVisible, setIsLaunchIntroVisible] = useState(
    shouldShowLaunchIntro,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activePage, setActivePage] = useState<"issues" | "auto-hunt" | "project-settings">(
    "issues",
  );
  const activeProject = briar.projects.find(
    (project) => project.id === briar.activeProjectId,
  );

  const completeLaunchIntro = useCallback(() => {
    try {
      window.localStorage.setItem(launchIntroStorageKey, "true");
    } catch {
      // The intro still completes when persistence is unavailable.
    }
    setIsLaunchIntroVisible(false);
  }, []);

  let content: React.ReactNode;

  if (!briar.user) {
    content = (
      <LoginScreen
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onCancel={briar.cancelLogin}
        onLogin={() => void briar.login()}
      />
    );
  } else if (
    briar.projects.length === 0 ||
    briar.isCreatingProject ||
    briar.projectConnection
  ) {
    content = (
      <ProjectOnboarding
        canCancel={briar.projects.length > 0 && briar.isCreatingProject}
        connection={briar.projectConnection}
        error={briar.error}
        loading={briar.loading}
        onCancel={briar.cancelProjectCreation}
        onConnect={briar.connectProject}
        onCreate={briar.addProject}
        onLogout={() => void briar.logout()}
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
          activeProjectId={briar.activeProjectId}
          isOpen={isSidebarOpen}
          onAddProject={briar.startProjectCreation}
          onAutoHuntOpen={() => setActivePage("auto-hunt")}
          onIssuesOpen={() => setActivePage("issues")}
          onProjectChange={(projectId) => {
            briar.setActiveProjectId(projectId);
            setActivePage("issues");
          }}
          onProjectSettings={(projectId) => {
            briar.setActiveProjectId(projectId);
            setActivePage("project-settings");
          }}
          onLogout={() => void briar.logout()}
          onToggle={() => setIsSidebarOpen(false)}
          projects={briar.projects}
          user={briar.user}
        />
        {activePage === "project-settings" && activeProject ? (
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
            isSidebarOpen={isSidebarOpen}
            onCreateIssue={briar.addIssue}
            onHealthRefresh={() => void briar.refreshHealth()}
            onLoadAttachment={briar.readIssueAttachment}
            onReconnect={briar.reconnectProject}
            onRetryRun={briar.retryRun}
            onCancelRun={briar.cancelRun}
            onRepair={() => void briar.repairHealth()}
            onSidebarOpen={() => setIsSidebarOpen(true)}
          />
        )}
      </jelly-theme>
    );
  }

  return (
    <>
      {content}
      {isLaunchIntroVisible ? (
        <LaunchIntro onComplete={completeLaunchIntro} />
      ) : null}
    </>
  );
}
