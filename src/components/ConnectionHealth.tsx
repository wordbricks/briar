import {
  Bot,
  CircleAlert,
  FolderGit2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { AutoHuntHealth } from "../lib/project-connection";

export function ConnectionHealth({
  error,
  health,
  loading,
  onReconnect,
  onRefresh,
  onRepair,
}: {
  error: string | null;
  health: AutoHuntHealth | null;
  loading: boolean;
  onReconnect: () => void;
  onRefresh: () => void;
  onRepair: () => void;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const assetsNeedRepair =
    health && (!health.cliCurrent || !health.skillCurrent);
  const status = loading ? "loading" : health?.healthy ? "healthy" : "attention";
  const statusLabel = loading
    ? t("health.checking")
    : health?.healthy
      ? t("health.ready")
      : t("common.checkNeeded");

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="health-menu" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("health.connectionStatus", { status: statusLabel })}
        className={`health-trigger ${status}`}
        onClick={() => setIsOpen((open) => !open)}
        title={t("health.connectionStatus", { status: statusLabel })}
        type="button"
      >
        <span aria-hidden="true" />
        <small>{statusLabel}</small>
      </button>
      {isOpen && (
        <div
          aria-label={t("health.details")}
          className={`health-popover${health?.healthy ? " healthy" : ""}`}
          role="dialog"
        >
          <div className="health-header">
            <div>
              <span className="health-icon">
                <ShieldCheck size={16} />
              </span>
              <span>
                <strong>{t("health.title")}</strong>
                <small>{statusLabel}</small>
              </span>
            </div>
            <div className="health-actions">
              {assetsNeedRepair && (
                <button onClick={onRepair} type="button">
                  <Wrench size={13} />
                  {t("health.repair")}
                </button>
              )}
              <button onClick={onReconnect} type="button">
                <FolderGit2 size={13} />
                {t("health.reconnect")}
              </button>
              <button
                aria-label={t("health.recheck")}
                disabled={loading}
                onClick={onRefresh}
                type="button"
              >
                <RefreshCw className={loading ? "spin" : ""} size={13} />
              </button>
            </div>
          </div>
          {error && (
            <div className="health-error">
              <CircleAlert size={14} />
              {error}
            </div>
          )}
          {health ? (
            <>
            <div className="health-grid">
              <HealthItem
                healthy={health.repositoryHealthy}
                icon={<FolderGit2 size={15} />}
                label={t("health.repository")}
                value={health.repositoryPath ?? t("common.notConnected")}
              />
              <HealthItem
                healthy={health.cliCurrent}
                icon={<Terminal size={15} />}
                label="Briar CLI"
                value={
                  health.cliVersion
                    ? `v${health.cliVersion}`
                    : t("common.notInstalled")
                }
                expected={`v${health.cliExpectedVersion}`}
              />
              <HealthItem
                healthy={health.skillCurrent}
                icon={<Bot size={15} />}
                label={t("health.skill")}
                value={
                  health.skillVersion
                    ? `v${health.skillVersion}`
                    : t("common.notInstalled")
                }
                expected={`v${health.skillExpectedVersion}`}
              />
              {health.velenOrg ? (
                <HealthItem
                  healthy={health.velenHealthy}
                  icon={<ShieldCheck size={15} />}
                  label="Velen"
                  value={health.velenOrg}
                  expected={health.velenEmail ?? undefined}
                />
              ) : null}
            </div>
            <div className="health-requirements">
              <header>
                <strong>{t("health.workflowRequirements")}</strong>
                <small>{t("health.workflowRequirementsDescription")}</small>
              </header>
              {(health.requirements ?? []).length ? (
                <div className="health-grid">
                  {(health.requirements ?? []).map((requirement) => (
                    <HealthItem
                      expected={requirement.reason}
                      healthy={requirement.healthy}
                      icon={<Wrench size={15} />}
                      key={requirement.id}
                      label={requirement.label}
                      value={requirement.detail}
                    />
                  ))}
                </div>
              ) : (
                <p>{t("health.noWorkflowRequirements")}</p>
              )}
            </div>
            </>
          ) : (
            <div className="health-empty">
              {loading ? t("health.inspecting") : t("health.desktopOnly")}
            </div>
          )}
          {health && !health.healthy && health.issues.length > 0 && (
            <div className="health-issues">
              {health.issues.map((issue) => (
                <span key={issue}>
                  <CircleAlert size={12} />
                  {issue}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HealthItem({
  expected,
  healthy,
  icon,
  label,
  value,
}: {
  expected?: string;
  healthy: boolean;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <div className="health-item">
      <i className={healthy ? "ok" : "warning"}>{icon}</i>
      <span>
        <small>{label}</small>
        <strong title={value}>{value}</strong>
        {expected && <em>{expected}</em>}
      </span>
      <b>{healthy ? t("common.healthy") : t("common.checkNeeded")}</b>
    </div>
  );
}
