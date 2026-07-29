import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Code2,
  Compass,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LogOut,
  UploadCloud,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectConnection } from "../hooks/useBriar";
import type {
  CreatedProjectWorkspace,
  LocalAutoHuntConfig,
  RepositoryReadiness,
} from "../lib/project-connection";
import { projectWorkspaceRoot } from "../lib/project-connection";
import {
  projectWorkspacePath,
  repositoryProjectName,
  type ProjectStartMode,
} from "../lib/project-workspace";
import type { SessionUser } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Typography } from "@/components/ui/typography";
import { Logo } from "./Logo";
import {
  normalizeAutoHuntWorkflow,
} from "../lib/auto-hunt-contract";
import { useI18n } from "../i18n";

type Props = {
  canCancel?: boolean;
  connection: ProjectConnection | null;
  error: string | null;
  loading: boolean;
  onCancel: () => void;
  onConnect: (
    settings: LocalAutoHuntConfig,
    repositoryPath: string,
  ) => Promise<unknown>;
  onCreate: (input: { name: string }) => Promise<unknown>;
  onLogout: () => void;
  onSkip: () => void;
  onRepositorySelect: () => Promise<string | null>;
  onRepositoryInspect: (
    repositoryPath: string,
    workflow: LocalAutoHuntConfig["workflow"],
  ) => Promise<RepositoryReadiness>;
  onWorkspaceCreate: (name: string) => Promise<CreatedProjectWorkspace>;
  user: SessionUser;
};

type FirstProjectStep = "purpose" | "create";

export function ProjectOnboarding({
  canCancel = false,
  connection,
  error,
  loading,
  onCancel,
  onConnect,
  onCreate,
  onLogout,
  onSkip,
  onRepositorySelect,
  onRepositoryInspect,
  onWorkspaceCreate,
  user,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repositoryReadiness, setRepositoryReadiness] =
    useState<RepositoryReadiness | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [selectingRepository, setSelectingRepository] = useState(false);
  const [startMode, setStartMode] = useState<ProjectStartMode>("existing");
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [firstProjectStep, setFirstProjectStep] =
    useState<FirstProjectStep>("purpose");
  const initialWorkflow = normalizeAutoHuntWorkflow(connection?.workflow);
  const showPurposeStep =
    !canCancel && !connection && firstProjectStep === "purpose";

  useEffect(() => {
    if (connection || workspaceRoot) return;
    let cancelled = false;
    void projectWorkspaceRoot()
      .then((root) => {
        if (!cancelled && root) setWorkspaceRoot(root);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection, workspaceRoot]);

  const newProjectPreviewPath = projectWorkspacePath(workspaceRoot, name);

  const chooseStartMode = (mode: ProjectStartMode) => {
    if (mode === startMode) return;
    setStartMode(mode);
    setName("");
    setRepositoryPath("");
    setRepositoryReadiness(null);
    setRepositoryError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName) return;
    if (startMode === "existing") {
      if (!repositoryPath) return;
      await onCreate({ name: projectName }).catch(() => undefined);
      return;
    }
    // Briar owns the folder for a from-scratch project, so create it before the project.
    setCreatingWorkspace(true);
    setRepositoryError(null);
    try {
      const workspace = await onWorkspaceCreate(projectName);
      setRepositoryPath(workspace.repositoryPath);
      const readiness = await onRepositoryInspect(
        workspace.repositoryPath,
        initialWorkflow,
      );
      setRepositoryPath(readiness.repositoryPath);
      setRepositoryReadiness(readiness);
      await onCreate({ name: projectName }).catch(() => undefined);
    } catch (caught) {
      setRepositoryError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const connect = async () => {
    if (!repositoryPath) return;
    await onConnect({
      velenOrg: null,
      linearEnabled: false,
      linearSource: null,
      linearTeam: null,
      githubRepository: repositoryReadiness?.githubRepository ?? null,
      workflow: initialWorkflow,
    }, repositoryPath).catch(() => undefined);
  };

  const selectRepository = async () => {
    setSelectingRepository(true);
    setRepositoryError(null);
    try {
      const selected = await onRepositorySelect();
      if (!selected) return;
      setRepositoryPath(selected);
      setRepositoryReadiness(null);
      const readiness = await onRepositoryInspect(
        selected,
        initialWorkflow,
      );
      setRepositoryPath(readiness.repositoryPath);
      setRepositoryReadiness(readiness);
      // A project created from an existing repository is named after that repository.
      if (!connection) setName(repositoryProjectName(readiness.repositoryPath));
    } catch (caught) {
      setRepositoryReadiness(null);
      setRepositoryError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setSelectingRepository(false);
    }
  };

  return (
    <div className="onboarding-shell">
      <header className="onboarding-topbar">
        <Logo />
        <div className="onboarding-topbar-actions">
          {canCancel ? (
            <button onClick={onCancel} type="button">
              <ArrowLeft size={14} /> {t("onboarding.back")}
            </button>
          ) : !connection && firstProjectStep === "create" ? (
            <button
              onClick={() => setFirstProjectStep("purpose")}
              type="button"
            >
              <ArrowLeft size={14} /> {t("onboarding.purposeBack")}
            </button>
          ) : null}
          <button onClick={onLogout} type="button">
            <LogOut size={14} /> {user.email}
          </button>
        </div>
      </header>
      <main
        className={`onboarding-card${showPurposeStep ? " project-purpose-card" : ""}`}
      >
        {showPurposeStep ? (
          <>
            <div className="onboarding-icon">
              <Compass size={24} />
            </div>
            <p className="eyebrow">{t("onboarding.purposeEyebrow")}</p>
            <h1>{t("onboarding.purposeTitle")}</h1>
            <p className="onboarding-copy">
              {t("onboarding.purposeDescription")}
            </p>
            <div className="project-purpose-options">
              <button
                aria-label={t("onboarding.purposeBuildAction")}
                className="project-purpose-option"
                onClick={() => setFirstProjectStep("create")}
                type="button"
              >
                <span className="project-purpose-option-icon">
                  <Code2 aria-hidden="true" size={22} />
                </span>
                <span className="project-purpose-option-copy">
                  <strong>{t("onboarding.purposeBuildTitle")}</strong>
                  <span>{t("onboarding.purposeBuildDescription")}</span>
                </span>
                <span className="project-purpose-option-action">
                  {t("onboarding.purposeBuildAction")}
                  <ArrowRight aria-hidden="true" size={17} />
                </span>
              </button>
              <button
                aria-label={t("onboarding.purposeObserveAction")}
                className="project-purpose-option"
                onClick={onSkip}
                type="button"
              >
                <span className="project-purpose-option-icon">
                  <LayoutDashboard aria-hidden="true" size={22} />
                </span>
                <span className="project-purpose-option-copy">
                  <strong>{t("onboarding.purposeObserveTitle")}</strong>
                  <span>{t("onboarding.purposeObserveDescription")}</span>
                </span>
                <span className="project-purpose-option-action">
                  {t("onboarding.purposeObserveAction")}
                  <ArrowRight aria-hidden="true" size={17} />
                </span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="onboarding-icon">
              {connection ? <Check size={24} /> : <FolderGit2 size={24} />}
            </div>
            {connection ? (
              <>
                <p className="eyebrow">AUTO HUNT CONNECTION</p>
                <h1>{t("onboarding.connectTitle", { name: connection.project.name })}</h1>
                <p className="onboarding-copy">
                  {t("onboarding.repositoryConnectDescription")}
                </p>

                <div className="setup-grid">
                  <section className="setup-section">
                    <div className="setup-section-heading">
                      <ListChecks size={18} />
                      <div>
                        <strong>{t("onboarding.workflow")}</strong>
                        <span>
                          {t("onboarding.workflowDescription").replace(
                            "Codex App Server",
                            "Agent backend",
                          )}
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className={`setup-section repository-setup${repositoryPath ? " connected" : ""}`}>
                    <div className="setup-section-heading">
                      {repositoryPath ? <Check size={18} /> : <FolderOpen size={18} />}
                      <div>
                        <strong>{t("onboarding.localRepository")}</strong>
                        <span className={repositoryPath ? "repository-path" : undefined} title={repositoryPath || undefined}>
                          {repositoryPath || t("onboarding.folderPicker")}
                        </span>
                      </div>
                      <button
                        className="setup-repository-action"
                        disabled={loading || selectingRepository}
                        onClick={() => void selectRepository()}
                        type="button"
                      >
                        {selectingRepository ? (
                          <LoaderCircle aria-hidden="true" className="spin" size={14} />
                        ) : (
                          <FolderOpen aria-hidden="true" size={14} />
                        )}
                        {selectingRepository
                          ? t("onboarding.repositorySelecting")
                          : repositoryPath
                            ? t("onboarding.repositoryChange")
                            : t("onboarding.repositorySelect")}
                      </button>
                    </div>
                    {repositoryPath ? (
                      <div
                        aria-label={t("onboarding.gitReadiness")}
                        className="repository-readiness"
                      >
                        <span className={repositoryReadiness?.gitReady ? "ready" : "warning"}>
                          {repositoryReadiness?.gitReady ? <Check size={13} /> : <CircleAlert size={13} />}
                          <i><strong>Git</strong><small>{repositoryReadiness?.gitVersion ?? t("common.checkNeeded")}</small></i>
                        </span>
                        <span className={repositoryReadiness?.remoteReachable ? "ready" : "warning"}>
                          {repositoryReadiness?.remoteReachable ? <Check size={13} /> : <GitBranch size={13} />}
                          <i><strong>origin</strong><small>{repositoryReadiness?.remote ?? t("onboarding.remoteMissing")}</small></i>
                        </span>
                        <span className={repositoryReadiness?.pushAccess ? "ready" : "warning"}>
                          {repositoryReadiness?.pushAccess ? <Check size={13} /> : <UploadCloud size={13} />}
                          <i><strong>push</strong><small>{repositoryReadiness?.pushAccess ? t("onboarding.pushReady") : t("onboarding.pushCheckNeeded")}</small></i>
                        </span>
                      </div>
                    ) : null}
                    {repositoryError ? (
                      <p className="repository-readiness-error" role="alert">
                        <CircleAlert size={13} />
                        {repositoryError}
                      </p>
                    ) : null}
                  </section>

                </div>

                {error ? <div className="login-error" role="alert">{error}</div> : null}
                <button
                  className="onboarding-primary-action"
                  disabled={loading || selectingRepository || !repositoryReadiness?.gitReady}
                  onClick={() => void connect()}
                  type="button"
                >
                  {loading ? t("onboarding.connecting") : t("onboarding.connect")} <ArrowRight size={17} />
                </button>
                <p className="token-warning">
                  {t("onboarding.localStorageNotice")}
                </p>
              </>
            ) : (
              <>
                <p className="eyebrow">{canCancel ? "NEW PROJECT" : "FIRST PROJECT"}</p>
                <h1>{canCancel ? t("onboarding.addProject") : t("onboarding.createProject")}</h1>
                <p className="onboarding-copy">
                  {canCancel
                    ? t("onboarding.addDescription")
                    : t("onboarding.createDescription")}
                </p>
                <form className="project-form" onSubmit={(event) => void submit(event)}>
                  <div
                    aria-label={t("onboarding.startMode")}
                    className="project-start-modes"
                    role="radiogroup"
                  >
                    <button
                      aria-checked={startMode === "existing"}
                      className={`project-start-mode${startMode === "existing" ? " selected" : ""}`}
                      onClick={() => chooseStartMode("existing")}
                      role="radio"
                      type="button"
                    >
                      <FolderGit2 aria-hidden="true" size={17} />
                      <strong>{t("onboarding.modeExisting")}</strong>
                      <span>{t("onboarding.modeExistingDescription")}</span>
                    </button>
                    <button
                      aria-checked={startMode === "new"}
                      className={`project-start-mode${startMode === "new" ? " selected" : ""}`}
                      onClick={() => chooseStartMode("new")}
                      role="radio"
                      type="button"
                    >
                      <FolderPlus aria-hidden="true" size={17} />
                      <strong>{t("onboarding.modeNew")}</strong>
                      <span>{t("onboarding.modeNewDescription")}</span>
                    </button>
                  </div>

                  {startMode === "existing" ? (
                    <section className={`setup-section repository-setup${repositoryPath ? " connected" : ""}`}>
                      <div className="setup-section-heading">
                        {repositoryPath ? <Check size={18} /> : <FolderOpen size={18} />}
                        <div>
                          <strong>{t("onboarding.localRepository")}</strong>
                          <span
                            className={repositoryPath ? "repository-path" : undefined}
                            title={repositoryPath || undefined}
                          >
                            {repositoryPath || t("onboarding.folderPicker")}
                          </span>
                        </div>
                        <button
                          className="setup-repository-action"
                          disabled={loading || selectingRepository}
                          onClick={() => void selectRepository()}
                          type="button"
                        >
                          {selectingRepository ? (
                            <LoaderCircle aria-hidden="true" className="spin" size={14} />
                          ) : (
                            <FolderOpen aria-hidden="true" size={14} />
                          )}
                          {selectingRepository
                            ? t("onboarding.repositorySelecting")
                            : repositoryPath
                            ? t("onboarding.repositoryChange")
                            : t("onboarding.repositorySelect")}
                        </button>
                      </div>
                      {repositoryPath ? (
                        <div
                          aria-label={t("onboarding.gitReadiness")}
                          className="repository-readiness compact"
                        >
                          <span className={repositoryReadiness?.gitReady ? "ready" : "warning"}>
                            {repositoryReadiness?.gitReady ? <Check size={13} /> : <CircleAlert size={13} />}
                            <i><strong>Git</strong><small>{repositoryReadiness?.gitVersion ?? t("common.checkNeeded")}</small></i>
                          </span>
                          <span className={repositoryReadiness?.remoteReachable ? "ready" : "warning"}>
                            {repositoryReadiness?.remoteReachable ? <Check size={13} /> : <GitBranch size={13} />}
                            <i><strong>origin</strong><small>{repositoryReadiness?.remote ?? t("onboarding.remoteMissing")}</small></i>
                          </span>
                        </div>
                      ) : null}
                      {repositoryError ? (
                        <p className="repository-readiness-error" role="alert">
                          <CircleAlert size={13} />
                          {repositoryError}
                        </p>
                      ) : null}
                    </section>
                  ) : null}

                  <label>
                    <span>
                      {t("onboarding.projectName")}
                      {startMode === "existing" && name ? (
                        <small>{t("onboarding.nameFromRepository")}</small>
                      ) : null}
                    </span>
                    <input
                      aria-label={t("onboarding.projectName")}
                      className="native-input"
                      onChange={(event) => setName(event.currentTarget.value)}
                      placeholder="wordbricks"
                      value={name}
                    />
                  </label>

                  {startMode === "new" ? (
                    <p className="project-workspace-hint">
                      {newProjectPreviewPath
                        ? t("onboarding.workspacePreview", { path: newProjectPreviewPath })
                        : t("onboarding.workspaceDescription")}
                    </p>
                  ) : null}
                  {startMode === "new" && repositoryError ? (
                    <p className="repository-readiness-error" role="alert">
                      <CircleAlert size={13} />
                      {repositoryError}
                    </p>
                  ) : null}

                  {error ? <div className="login-error" role="alert">{error}</div> : null}
                  <button
                    className="onboarding-primary-action"
                    disabled={
                      loading ||
                      creatingWorkspace ||
                      selectingRepository ||
                      !name.trim() ||
                      (startMode === "existing" && !repositoryPath)
                    }
                    type="submit"
                  >
                    {creatingWorkspace
                      ? t("onboarding.workspaceCreating")
                      : loading
                      ? t("onboarding.creating")
                      : t("onboarding.createProject")} <ArrowRight size={17} />
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
