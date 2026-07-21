import { useState } from "react";
import { HuntDashboard } from "./components/HuntDashboard";
import { LoginScreen } from "./components/LoginScreen";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { Sidebar } from "./components/Sidebar";
import { useBriar } from "./hooks/useBriar";

export function App() {
  const briar = useBriar();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
        activeProjectId={briar.activeProjectId}
        isOpen={isSidebarOpen}
        onAddProject={briar.startProjectCreation}
        onProjectChange={briar.setActiveProjectId}
        onLogout={() => void briar.logout()}
        onToggle={() => setIsSidebarOpen(false)}
        projects={briar.projects}
        user={briar.user}
      />
      <HuntDashboard
        dashboard={briar.dashboard}
        demoMode={briar.demoMode}
        error={briar.error}
        health={briar.health}
        healthError={briar.healthError}
        healthLoading={briar.healthLoading}
        isCreatingIssue={briar.isCreatingIssue}
        isSidebarOpen={isSidebarOpen}
        onCreateIssue={briar.addIssue}
        onHealthRefresh={() => void briar.refreshHealth()}
        onReconnect={briar.reconnectProject}
        onRepair={() => void briar.repairHealth()}
        onRefresh={() => void briar.refresh()}
        onSidebarOpen={() => setIsSidebarOpen(true)}
      />
    </jelly-theme>
  );
}
