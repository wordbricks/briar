import { HuntDashboard } from "./components/HuntDashboard";
import { LoginScreen } from "./components/LoginScreen";
import { ProjectOnboarding } from "./components/ProjectOnboarding";
import { Sidebar } from "./components/Sidebar";
import { useBriar } from "./hooks/useBriar";

export function App() {
  const briar = useBriar();

  if (!briar.user) {
    return (
      <LoginScreen
        error={briar.error}
        loading={briar.loading}
        loginCode={briar.loginCode}
        onLogin={() => void briar.login()}
      />
    );
  }

  if (briar.projects.length === 0 || briar.projectConnection) {
    return (
      <ProjectOnboarding
        connection={briar.projectConnection}
        error={briar.error}
        loading={briar.loading}
        onComplete={briar.finishProjectConnection}
        onCreate={briar.addProject}
        onLogout={() => void briar.logout()}
        user={briar.user}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeProjectId={briar.activeProjectId}
        onProjectChange={briar.setActiveProjectId}
        onLogout={() => void briar.logout()}
        projects={briar.projects}
        user={briar.user}
      />
      <HuntDashboard
        dashboard={briar.dashboard}
        demoMode={briar.demoMode}
        error={briar.error}
        onRefresh={() => void briar.refresh()}
      />
    </div>
  );
}
