import { LogOut, RefreshCw } from "lucide-react";
import { Logo } from "./Logo";
import { useI18n } from "../i18n";
import type { Project, SessionUser } from "../types";

export function CompanionHeader({
  activeProjectId,
  loading,
  onLogout,
  onProjectChange,
  onRefresh,
  projects,
  user,
}: {
  activeProjectId: string | null;
  loading: boolean;
  onLogout: () => void;
  onProjectChange: (projectId: string) => void;
  onRefresh: () => void;
  projects: Project[];
  user: SessionUser;
}) {
  const { t } = useI18n();

  return (
    <header className="companion-header">
      <div className="companion-brand">
        <Logo />
        <span>{t("companion.badge")}</span>
      </div>
      <div className="companion-header-actions">
        <button
          aria-label={t("dashboard.refresh")}
          disabled={loading}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw className={loading ? "spin" : ""} size={19} />
        </button>
        <button
          aria-label={t("account.logout")}
          onClick={onLogout}
          title={user.email}
          type="button"
        >
          <LogOut size={19} />
        </button>
      </div>
      <label className="companion-project-picker">
        <span>{t("companion.project")}</span>
        <select
          onChange={(event) => onProjectChange(event.target.value)}
          value={activeProjectId ?? ""}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}

export function CompanionEmptyState({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();

  return (
    <main className="companion-empty">
      <Logo />
      <span>{t("companion.badge")}</span>
      <h1>{t("companion.emptyTitle")}</h1>
      <p>{t("companion.emptyDescription")}</p>
      <button onClick={onLogout} type="button">
        {t("account.logout")}
      </button>
    </main>
  );
}
