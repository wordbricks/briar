import {
  Check,
  Bot,
  CircleAlert,
  FolderGit2,
  Github,
  RefreshCw,
  X,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import type { RepositoryReadiness } from "../generated/tauri";
import {
  isLocalTeamRepositoryReady,
  localTeamReadiness,
  type LocalTeamConnectionState,
} from "../lib/local-team-connection";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";

export function TeamRepositorySetupDialog({
  connectionState,
  error,
  loading,
  onClose,
  onStartWorking,
  onRefresh,
  projectName,
  readiness,
}: {
  connectionState: LocalTeamConnectionState;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onStartWorking: () => Promise<unknown>;
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
  const inspectedReadiness = localTeamReadiness(connectionState, readiness);
  const repositoryReady = isLocalTeamRepositoryReady(inspectedReadiness);
  const unresolvedDetail = connectionState === "disconnected"
    ? t("common.notConnected")
    : t("common.checkNeeded");
  const visibleIssues = inspectedReadiness?.issues.filter(
    (issue) => !issue.includes("GitHub CLI"),
  ) ?? [];

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
            <Github size={20} />
          </span>
          <div>
            <p className="eyebrow">
              {t("repositorySetup.eyebrow")}
            </p>
            <h2 id="repository-setup-title">
              {t("repositorySetup.title", { name: projectName })}
            </h2>
            <p>
              {t("repositorySetup.description")}
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
                : connectionState === "disconnected"
                  ? t("repositorySetup.gitAutomatic")
                  : unresolvedDetail
            }
            healthy={inspectedReadiness?.gitReady ?? false}
            icon={<FolderGit2 size={16} />}
            label="Git"
          />
          <ReadinessRow
            detail={t("repositorySetup.appCredentialDetail")}
            healthy
            icon={<Github size={16} />}
            label={t("repositorySetup.appCredential")}
          />
          <ReadinessRow
            detail={t("repositorySetup.managedFolderDetail")}
            healthy={connectionState === "connected"}
            icon={<FolderGit2 size={16} />}
            label={t("repositorySetup.managedFolder")}
          />
          <ReadinessRow
            detail={t("repositorySetup.workerDetail")}
            healthy={connectionState === "connected"}
            icon={<Bot size={16} />}
            label={t("repositorySetup.worker")}
          />
        </div>

        {visibleIssues.length ? (
          <div className="repository-setup-issues">
            {visibleIssues.map((issue) => (
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
              onClick={() => void onStartWorking()}
              type="button"
            >
              {loading ? <Spinner size={15} /> : <FolderGit2 size={15} />}
              {t("repositorySetup.startWorking")}
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
