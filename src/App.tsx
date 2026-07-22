import { useState } from "react";
import { HuntDashboard } from "./components/HuntDashboard";
import { LoginScreen } from "./components/LoginScreen";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { ProjectSettings } from "./components/ProjectSettings";
import { Sidebar } from "./components/Sidebar";
import { useBriar } from "./hooks/useBriar";

export function App() {
  const briar = useBriar();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activePage, setActivePage] = useState<"dashboard" | "project-settings">(
    "dashboard",
  );
  const activeProject = briar.projects.find(
    (project) => project.id === briar.activeProjectId,
  );

  if (!briar.user) {
    return (
      <LoginScreen
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onCancel={briar.cancelLogin}
        onLogin={() => void briar.login()}
      />
    );
  }

  if (
    briar.projects.length === 0 ||
    briar.isCreatingProject ||
    briar.projectConnection
  ) {
    return (
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
  }

  return (
    <jelly-theme mode="light" className="app-shell">
      <Sidebar
        activePage={activePage}
        activeProjectId={briar.activeProjectId}
        isOpen={isSidebarOpen}
        onAddProject={briar.startProjectCreation}
        onDashboardOpen={() => setActivePage("dashboard")}
        onProjectChange={(projectId) => {
          briar.setActiveProjectId(projectId);
          setActivePage("dashboard");
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
          onBack={() => setActivePage("dashboard")}
          onDelete={async () => {
            await briar.deleteProject(activeProject.id);
            setActivePage("dashboard");
          }}
          onRegenerateWorkflow={() => briar.regenerateWorkflow(activeProject.id)}
          onSidebarOpen={() => setIsSidebarOpen(true)}
          project={activeProject}
        />
      ) : (
        <HuntDashboard
        dashboard={briar.dashboard}
        demoMode={briar.demoMode}
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
        onRefresh={() => void briar.refresh()}
        onSidebarOpen={() => setIsSidebarOpen(true)}
        />
      )}
    </jelly-theme>
  );
}
