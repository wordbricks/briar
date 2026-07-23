import { ChevronDown, RefreshCw } from "lucide-react";
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
  const avatarInitial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <header className="companion-header">
      <div className="companion-workspace">
        <div className="companion-workspace-mark">
          <Logo compact />
        </div>
        <label className="companion-project-picker">
          <span className="visually-hidden">{t("companion.project")}</span>
          <select
            aria-label={t("companion.project")}
            onChange={(event) => onProjectChange(event.target.value)}
            value={activeProjectId ?? ""}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={19} />
        </label>
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
          className="companion-account-button"
          onClick={onLogout}
          title={user.email}
          type="button"
        >
          {user.image ? <img alt="" src={user.image} /> : <span>{avatarInitial}</span>}
          <i aria-hidden="true" />
        </button>
      </div>
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
