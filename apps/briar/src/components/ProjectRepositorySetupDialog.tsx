import {
  Check,
  CircleAlert,
  Download,
  FolderGit2,
  Github,
  LogIn,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import type { RepositoryReadiness } from "../lib/project-connection";
import {
  isLocalProjectRepositoryReady,
  localProjectReadiness,
  type LocalProjectConnectionState,
} from "../lib/local-project-connection";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";

export function ProjectRepositorySetupDialog({
  connectionState,
  error,
  loading,
  onClose,
  onInstallGithub,
  onLoginGithub,
  onReconnect,
  onRefresh,
  projectName,
  readiness,
}: {
  connectionState: LocalProjectConnectionState;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onInstallGithub: () => Promise<unknown>;
  onLoginGithub: () => Promise<unknown>;
  onReconnect: () => void;
  onRefresh: () => Promise<unknown>;
  projectName: string;
  readiness: RepositoryReadiness | null;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(loading);
  const onCloseRef = useRef(onClose);
  loadingRef.current = loading;
  onCloseRef.current = onClose;
  const inspectedReadiness = localProjectReadiness(connectionState, readiness);
  const requiresGithub = inspectedReadiness?.requiresGithub === true;
  const repositoryReady = isLocalProjectRepositoryReady(inspectedReadiness);
  const unresolvedDetail = connectionState === "disconnected"
    ? t("common.notConnected")
    : t("common.checkNeeded");

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loadingRef.current) {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

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
            {requiresGithub ? <Github size={20} /> : <FolderGit2 size={20} />}
          </span>
          <div>
            <p className="eyebrow">
              {t(
                requiresGithub
                  ? "repositorySetup.eyebrow"
                  : "repositorySetup.inspectEyebrow",
              )}
            </p>
            <h2 id="repository-setup-title">
              {t(
                requiresGithub
                  ? "repositorySetup.title"
                  : "repositorySetup.inspectTitle",
                { name: projectName },
              )}
            </h2>
            <p>
              {t(
                requiresGithub
                  ? "repositorySetup.description"
                  : "repositorySetup.inspectDescription",
              )}
            </p>
          </div>
          <button
            aria-label={t("common.close")}
            className="repository-setup-close"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="repository-setup-checks">
          <ReadinessRow
            detail={
              inspectedReadiness
                ? inspectedReadiness.gitVersion ?? t("common.notInstalled")
                : unresolvedDetail
            }
            healthy={inspectedReadiness?.gitReady ?? false}
            icon={<FolderGit2 size={16} />}
            label="Git"
          />
          {!inspectedReadiness || requiresGithub ? (
            <ReadinessRow
              detail={
                inspectedReadiness
                  ? inspectedReadiness.pushAccess
                    ? inspectedReadiness.remote ?? t("repositorySetup.origin")
                    : t("repositorySetup.pushUnavailable")
                  : unresolvedDetail
              }
              healthy={Boolean(
                inspectedReadiness?.remoteReachable &&
                  inspectedReadiness.pushAccess,
              )}
              icon={<UploadCloud size={16} />}
              label={t("repositorySetup.pushAccess")}
            />
          ) : null}
          {!inspectedReadiness || requiresGithub ? (
            <>
              <ReadinessRow
                detail={
                  inspectedReadiness
                    ? inspectedReadiness.ghVersion ?? t("common.notInstalled")
                    : unresolvedDetail
                }
                healthy={inspectedReadiness?.ghInstalled ?? false}
                icon={<Github size={16} />}
                label="GitHub CLI"
              />
              <ReadinessRow
                detail={
                  inspectedReadiness
                    ? inspectedReadiness.ghAccount
                      ? `@${inspectedReadiness.ghAccount}`
                      : t("repositorySetup.loginRequired")
                    : unresolvedDetail
                }
                healthy={Boolean(
                  inspectedReadiness?.ghAuthenticated &&
                    inspectedReadiness.githubWriteAccess,
                )}
                icon={<LogIn size={16} />}
                label={t("repositorySetup.githubLogin")}
              />
            </>
          ) : null}
        </div>

        {inspectedReadiness?.issues.length ? (
          <div className="repository-setup-issues">
            {inspectedReadiness.issues.map((issue) => (
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
            <Spinner icon={RefreshCw} size={15} spinning={loading} />
            {t("repositorySetup.recheck")}
          </button>
          {connectionState === "disconnected" ? (
            <button
              className="repository-setup-primary"
              disabled={loading}
              onClick={onReconnect}
              type="button"
            >
              <FolderGit2 size={15} />
              {t("dashboard.connectRepository")}
            </button>
          ) : requiresGithub &&
            !inspectedReadiness.ghInstalled ? (
            <button
              className="repository-setup-primary"
              disabled={loading}
              onClick={() => void onInstallGithub()}
              type="button"
            >
              {loading ? <Spinner size={15} /> : <Download size={15} />}
              {t("repositorySetup.installGh")}
            </button>
          ) : requiresGithub &&
            !inspectedReadiness.prReady ? (
            <button
              className="repository-setup-primary"
              disabled={loading}
              onClick={() => void onLoginGithub()}
              type="button"
            >
              {loading ? <Spinner size={15} /> : <LogIn size={15} />}
              {t(
                loading && !inspectedReadiness.ghAuthenticated
                  ? "repositorySetup.completeLoginGithub"
                  : inspectedReadiness.ghAuthenticated
                    ? "repositorySetup.configureGit"
                    : "repositorySetup.loginGithub",
              )}
            </button>
          ) : repositoryReady ? (
            <span className="repository-setup-ready">
              <Check size={15} />
              {t("repositorySetup.ready")}
            </span>
          ) : null}
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
