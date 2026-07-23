import {
  Check,
  CircleAlert,
  Download,
  FolderGit2,
  Github,
  LoaderCircle,
  LogIn,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import type { RepositoryReadiness } from "../lib/project-connection";

export function ProjectRepositorySetupDialog({
  error,
  loading,
  onClose,
  onInstallGithub,
  onLoginGithub,
  onRefresh,
  projectName,
  readiness,
}: {
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onInstallGithub: () => Promise<unknown>;
  onLoginGithub: () => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  projectName: string;
  readiness: RepositoryReadiness | null;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [loading, onClose]);

  return (
    <div
      className="dialog-backdrop repository-setup-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section
        aria-labelledby="repository-setup-title"
        aria-modal="true"
        className="repository-setup-dialog"
        role="dialog"
      >
        <header>
          <span className="repository-setup-dialog-icon">
            <Github size={20} />
          </span>
          <div>
            <p className="eyebrow">{t("repositorySetup.eyebrow")}</p>
            <h2 id="repository-setup-title">
              {t("repositorySetup.title", { name: projectName })}
            </h2>
            <p>{t("repositorySetup.description")}</p>
          </div>
          <button
            aria-label={t("common.close")}
            className="repository-setup-close"
            disabled={loading}
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="repository-setup-checks">
          <ReadinessRow
            detail={readiness?.gitVersion ?? t("common.notInstalled")}
            healthy={readiness?.gitReady ?? false}
            icon={<FolderGit2 size={16} />}
            label="Git"
          />
          <ReadinessRow
            detail={
              readiness?.pushAccess
                ? readiness.remote ?? t("repositorySetup.origin")
                : t("repositorySetup.pushUnavailable")
            }
            healthy={Boolean(readiness?.remoteReachable && readiness.pushAccess)}
            icon={<UploadCloud size={16} />}
            label={t("repositorySetup.pushAccess")}
          />
          <ReadinessRow
            detail={readiness?.ghVersion ?? t("common.notInstalled")}
            healthy={readiness?.ghInstalled ?? false}
            icon={<Github size={16} />}
            label="GitHub CLI"
          />
          <ReadinessRow
            detail={
              readiness?.ghAccount
                ? `@${readiness.ghAccount}`
                : t("repositorySetup.loginRequired")
            }
            healthy={
              Boolean(
                readiness?.ghAuthenticated && readiness.githubWriteAccess,
              )
            }
            icon={<LogIn size={16} />}
            label={t("repositorySetup.githubLogin")}
          />
        </div>

        {readiness?.issues.length ? (
          <div className="repository-setup-issues">
            {readiness.issues.map((issue) => (
              <span key={issue}>
                <CircleAlert size={13} />
                {issue}
              </span>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="repository-setup-error" role="alert">
            <CircleAlert size={14} />
            {error}
          </p>
        ) : null}

        <footer>
          <button
            className="repository-setup-refresh"
            disabled={loading}
            onClick={() => void onRefresh()}
            type="button"
          >
            <RefreshCw className={loading ? "spin" : ""} size={15} />
            {t("repositorySetup.recheck")}
          </button>
          {!readiness?.ghInstalled ? (
            <button
              className="repository-setup-primary"
              disabled={loading}
              onClick={() => void onInstallGithub()}
              type="button"
            >
              {loading ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
              {t("repositorySetup.installGh")}
            </button>
          ) : !readiness.prReady ? (
            <button
              className="repository-setup-primary"
              disabled={loading}
              onClick={() => void onLoginGithub()}
              type="button"
            >
              {loading ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />}
              {t(
                readiness.ghAuthenticated
                  ? "repositorySetup.configureGit"
                  : "repositorySetup.loginGithub",
              )}
            </button>
          ) : (
            <span className="repository-setup-ready">
              <Check size={15} />
              {t("repositorySetup.ready")}
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}

function ReadinessRow({
  detail,
  healthy,
  icon,
  label,
}: {
  detail: string;
  healthy: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div className={`repository-setup-check${healthy ? " ready" : ""}`}>
      <i>{icon}</i>
      <span>
        <strong>{label}</strong>
        <small title={detail}>{detail}</small>
      </span>
      <em>
        {healthy ? <Check size={13} /> : <CircleAlert size={13} />}
        {healthy ? t("common.healthy") : t("common.checkNeeded")}
      </em>
    </div>
  );
}
