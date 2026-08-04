import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Compass,
  Cpu,
  FolderGit2,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  LogOut,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectConnection } from "../hooks/useBriar";
import { ApiError, apiErrorIssueMessages } from "../lib/api";
import type {
  LocalAutoHuntConfig,
  RepositoryReadiness,
  WorkflowRequirementHealth,
} from "../lib/project-connection";
import {
  isRepositoryWorkflowPending,
  repositoryWorkflowBootstrap,
  type AutoHuntWorkflow,
} from "../lib/auto-hunt-contract";
import { repositoryProjectName } from "../lib/project-workspace";
import type { SessionUser } from "../types";
import { useI18n } from "../i18n";
import { Logo } from "./Logo";

type PreparedProjectConnection = {
  repositoryPath: string;
  workflow: AutoHuntWorkflow;
};

type RequirementAnalysis = {
  workflow: AutoHuntWorkflow;
  requirements: WorkflowRequirementHealth[];
};

type WorkflowFailure = {
  message: string;
  issues: string[];
};

type Props = {
  canCancel?: boolean;
  connection: ProjectConnection | null;
  error: string | null;
  loading: boolean;
  onAnalyzeRequirements: (projectId: string) => Promise<RequirementAnalysis>;
  onCancel: () => void;
  onConnect: (
    settings: LocalAutoHuntConfig,
    repositoryPath: string,
  ) => Promise<PreparedProjectConnection>;
  onCreate: (input: { name: string }) => Promise<unknown>;
  onFinish: () => void;
  onLogout: () => void;
  onReviseWorkflow: (
    projectId: string,
    requestedChange: string,
  ) => Promise<AutoHuntWorkflow>;
  onSkip: () => void;
  onRepositorySelect: () => Promise<string | null>;
  onRepositoryInspect: (
    repositoryPath: string,
    workflow: LocalAutoHuntConfig["workflow"],
  ) => Promise<RepositoryReadiness>;
  user: SessionUser;
};

type OnboardingPhase =
  | "purpose"
  | "repository"
  | "workflow-loading"
  | "workflow-review"
  | "tools-loading"
  | "tools-review";

function Progress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div aria-hidden="true" className="project-onboarding-progress">
      {[1, 2, 3].map((step) => (
        <span className={step <= current ? "active" : ""} key={step} />
      ))}
    </div>
  );
}

function WorkflowPreview({ workflow }: { workflow: AutoHuntWorkflow }) {
  const { t } = useI18n();
  return (
    <ol aria-label={t("onboarding.workflowPreview")} className="onboarding-workflow-stages">
      {workflow.stages.map((stage, index) => (
        <li key={stage.id}>
          <span>{index + 1}</span>
          <div>
            <strong>{stage.label}</strong>
            <small>
              {stage.required
                ? t("onboarding.workflowRequiredStage")
                : t("onboarding.workflowOptionalStage")}
            </small>
            {stage.checks?.length ? (
              <code>{stage.checks.join(" · ")}</code>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ProjectOnboarding({
  canCancel = false,
  connection,
  error,
  loading,
  onAnalyzeRequirements,
  onCancel,
  onConnect,
  onCreate,
  onFinish,
  onLogout,
  onRepositoryInspect,
  onRepositorySelect,
  onReviseWorkflow,
  onSkip,
  user,
}: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<OnboardingPhase>(
    canCancel || connection ? "repository" : "purpose",
  );
  const [name, setName] = useState(connection?.project.name ?? "");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repositoryReadiness, setRepositoryReadiness] =
    useState<RepositoryReadiness | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [selectingRepository, setSelectingRepository] = useState(false);
  const [workflow, setWorkflow] = useState<AutoHuntWorkflow | null>(null);
  const [workflowError, setWorkflowError] = useState<WorkflowFailure | null>(null);
  const [workflowRevision, setWorkflowRevision] = useState("");
  const [revisingWorkflow, setRevisingWorkflow] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const generationRequest = useRef<{
    key: string;
    promise: Promise<PreparedProjectConnection>;
  } | null>(null);
  const [requirementHealth, setRequirementHealth] = useState<
    WorkflowRequirementHealth[]
  >([]);
  const [toolsError, setToolsError] = useState<string | null>(null);

  useEffect(() => {
    if (connection && !name) setName(connection.project.name);
  }, [connection, name]);

  useEffect(() => {
    if (
      phase !== "workflow-loading" ||
      !connection ||
      !repositoryPath
    ) {
      return;
    }
    const key = `${connection.project.id}:${generationAttempt}`;
    const settings: LocalAutoHuntConfig = {
      velenOrg: null,
      linearEnabled: false,
      linearSource: null,
      linearTeam: null,
      githubRepository: repositoryReadiness?.githubRepository ?? null,
      workflow: connection.workflow ?? repositoryWorkflowBootstrap,
    };
    if (generationRequest.current?.key !== key) {
      generationRequest.current = {
        key,
        promise: onConnect(settings, repositoryPath),
      };
    }
    let active = true;
    setWorkflowError(null);
    void generationRequest.current.promise
      .then((result) => {
        if (!active) return;
        setRepositoryPath(result.repositoryPath);
        setWorkflow(result.workflow);
        setPhase("workflow-review");
      })
      .catch((caught) => {
        if (!active) return;
        setWorkflowError({
          message:
            caught instanceof ApiError &&
              caught.code === "INVALID_PROJECT_WORKFLOW"
              ? t("onboarding.workflowValidationFailed")
              : caught instanceof Error
                ? caught.message
                : String(caught),
          issues: apiErrorIssueMessages(caught),
        });
      });
    return () => {
      active = false;
    };
  }, [
    connection,
    generationAttempt,
    onConnect,
    phase,
    repositoryPath,
    repositoryReadiness?.githubRepository,
    t,
  ]);

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
        connection?.workflow ?? repositoryWorkflowBootstrap,
      );
      setRepositoryPath(readiness.repositoryPath);
      setRepositoryReadiness(readiness);
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

  const continueFromRepository = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!repositoryReadiness?.gitReady) return;
    const projectName = (connection?.project.name ?? name).trim();
    if (!projectName) return;
    if (!connection) {
      try {
        await onCreate({ name: projectName });
      } catch {
        return;
      }
    }
    if (
      connection?.workflow &&
      !isRepositoryWorkflowPending(connection.workflow)
    ) {
      const settings: LocalAutoHuntConfig = {
        velenOrg: null,
        linearEnabled: false,
        linearSource: null,
        linearTeam: null,
        githubRepository: repositoryReadiness.githubRepository ?? null,
        workflow: connection.workflow,
      };
      try {
        await onConnect(settings, repositoryPath);
        onFinish();
      } catch {
        // The connection error is surfaced by the parent on this repository step.
      }
      return;
    }
    setWorkflowError(null);
    setPhase("workflow-loading");
  };

  const retryWorkflowGeneration = () => {
    generationRequest.current = null;
    setWorkflowError(null);
    setGenerationAttempt((current) => current + 1);
  };

  const returnToRepository = () => {
    generationRequest.current = null;
    setWorkflowError(null);
    setGenerationAttempt((current) => current + 1);
    setPhase("repository");
  };

  const reviseWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    const requestedChange = workflowRevision.trim();
    if (!connection || !workflow || !requestedChange) return;
    setRevisingWorkflow(true);
    setRevisionError(null);
    try {
      const revised = await onReviseWorkflow(
        connection.project.id,
        requestedChange,
      );
      setWorkflow(revised);
      setWorkflowRevision("");
    } catch (caught) {
      setRevisionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRevisingWorkflow(false);
    }
  };

  const analyzeRequirements = async () => {
    if (!connection || !workflow) return;
    setPhase("tools-loading");
    setToolsError(null);
    try {
      const result = await onAnalyzeRequirements(connection.project.id);
      setWorkflow(result.workflow);
      setRequirementHealth(result.requirements);
      setPhase("tools-review");
    } catch (caught) {
      setToolsError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const workflowRequirements = workflow?.requirements ?? [];
  const healthById = new Map(
    requirementHealth.map((requirement) => [requirement.id, requirement]),
  );
  const hasMissingTools = workflowRequirements.some(
    (requirement) => !healthById.get(requirement.id)?.healthy,
  );
  const currentStep: 1 | 2 | 3 =
    phase === "repository" ? 1 : phase.startsWith("workflow") ? 2 : 3;

  return (
    <div className="onboarding-shell project-onboarding-shell">
      <header className="onboarding-topbar">
        <Logo />
        <div className="onboarding-topbar-actions">
          {phase === "repository" ? (
            <button
              onClick={
                !canCancel && !connection
                  ? () => setPhase("purpose")
                  : onCancel
              }
              type="button"
            >
              <ArrowLeft size={14} />
              {!canCancel && !connection
                ? t("onboarding.purposeBack")
                : t("onboarding.back")}
            </button>
          ) : phase !== "purpose" ? (
            <button onClick={onCancel} type="button">
              <ArrowLeft size={14} /> {t("onboarding.back")}
            </button>
          ) : null}
          <button onClick={onLogout} type="button">
            <LogOut size={14} /> {user.email}
          </button>
        </div>
      </header>

      <main
        className={`onboarding-card${phase === "purpose" ? " project-purpose-card" : " project-onboarding-card"}`}
      >
        {phase === "purpose" ? (
          <>
            <div className="onboarding-icon"><Compass size={24} /></div>
            <p className="eyebrow">{t("onboarding.purposeEyebrow")}</p>
            <h1>{t("onboarding.purposeTitle")}</h1>
            <p className="onboarding-copy">{t("onboarding.purposeDescription")}</p>
            <div className="project-purpose-options">
              <button
                aria-label={t("onboarding.purposeBuildAction")}
                className="project-purpose-option"
                onClick={() => setPhase("repository")}
                type="button"
              >
                <span className="project-purpose-option-icon"><FolderGit2 size={22} /></span>
                <span className="project-purpose-option-copy">
                  <strong>{t("onboarding.purposeBuildTitle")}</strong>
                  <span>{t("onboarding.purposeBuildDescription")}</span>
                </span>
                <span className="project-purpose-option-action">
                  {t("onboarding.purposeBuildAction")}<ArrowRight size={17} />
                </span>
              </button>
              <button
                aria-label={t("onboarding.purposeObserveAction")}
                className="project-purpose-option"
                onClick={onSkip}
                type="button"
              >
                <span className="project-purpose-option-icon"><Compass size={22} /></span>
                <span className="project-purpose-option-copy">
                  <strong>{t("onboarding.purposeObserveTitle")}</strong>
                  <span>{t("onboarding.purposeObserveDescription")}</span>
                </span>
                <span className="project-purpose-option-action">
                  {t("onboarding.purposeObserveAction")}<ArrowRight size={17} />
                </span>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">{t("onboarding.setupProgress", { step: currentStep })}</p>
            <Progress current={currentStep} />

            {phase === "repository" ? (
              <>
                <div className="onboarding-icon"><FolderGit2 size={24} /></div>
                <h1>
                  {connection
                    ? t("onboarding.repositoryReconnectTitle", { name: connection.project.name })
                    : canCancel
                      ? t("onboarding.addProject")
                      : t("onboarding.createProject")}
                </h1>
                <p className="onboarding-copy">{t("onboarding.repositoryRequiredDescription")}</p>
                <form className="project-form" onSubmit={(event) => void continueFromRepository(event)}>
                  <section className={`setup-section repository-setup${repositoryPath ? " connected" : ""}`}>
                    <div className="setup-section-heading">
                      {repositoryReadiness?.gitReady ? <Check size={18} /> : <FolderOpen size={18} />}
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
                        {selectingRepository ? <LoaderCircle className="spin" size={14} /> : <FolderOpen size={14} />}
                        {selectingRepository
                          ? t("onboarding.repositorySelecting")
                          : repositoryPath
                            ? t("onboarding.repositoryChange")
                            : t("onboarding.repositorySelect")}
                      </button>
                    </div>
                    {repositoryPath ? (
                      <div aria-label={t("onboarding.gitReadiness")} className="repository-readiness">
                        <span className={repositoryReadiness?.gitReady ? "ready" : "warning"}>
                          {repositoryReadiness?.gitReady ? <Check size={13} /> : <CircleAlert size={13} />}
                          <i><strong>Git</strong><small>{repositoryReadiness?.gitVersion ?? t("common.checkNeeded")}</small></i>
                        </span>
                        <span className={repositoryReadiness?.remoteReachable ? "ready" : "warning"}>
                          {repositoryReadiness?.remoteReachable ? <Check size={13} /> : <GitBranch size={13} />}
                          <i><strong>origin</strong><small>{repositoryReadiness?.remote ?? t("onboarding.remoteMissing")}</small></i>
                        </span>
                        <span className={repositoryReadiness?.pushAccess ? "ready" : "warning"}>
                          {repositoryReadiness?.pushAccess ? <Check size={13} /> : <CircleAlert size={13} />}
                          <i><strong>push</strong><small>{repositoryReadiness?.pushAccess ? t("onboarding.pushReady") : t("onboarding.pushCheckNeeded")}</small></i>
                        </span>
                      </div>
                    ) : null}
                    {repositoryError ? <p className="repository-readiness-error" role="alert"><CircleAlert size={13} />{repositoryError}</p> : null}
                  </section>
                  {!connection ? (
                    <label>
                      <span>{t("onboarding.projectName")}<small>{name ? t("onboarding.nameFromRepository") : null}</small></span>
                      <input
                        aria-label={t("onboarding.projectName")}
                        className="native-input"
                        onChange={(event) => setName(event.currentTarget.value)}
                        placeholder="wordbricks"
                        value={name}
                      />
                    </label>
                  ) : null}
                  {error ? <div className="login-error" role="alert">{error}</div> : null}
                  {repositoryReadiness?.gitReady ? (
                    <button
                      className="onboarding-primary-action"
                      disabled={loading || selectingRepository || (!connection && !name.trim())}
                      type="submit"
                    >
                      {loading ? t("onboarding.creating") : t("onboarding.next")}<ArrowRight size={17} />
                    </button>
                  ) : null}
                </form>
              </>
            ) : null}

            {phase === "workflow-loading" ? (
              <section className="onboarding-process" aria-live="polite">
                {workflowError ? (
                  <>
                    <span className="onboarding-process-icon error"><CircleAlert size={25} /></span>
                    <h1>{t("onboarding.workflowGenerationFailed")}</h1>
                    <div className="onboarding-process-error" role="alert">
                      <p>{workflowError.message}</p>
                      {workflowError.issues.length > 0 ? (
                        <ul>
                          {workflowError.issues.map((issue, index) => (
                            <li key={`${index}:${issue}`}>{issue}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="onboarding-secondary-actions">
                      <button onClick={retryWorkflowGeneration} type="button">{t("onboarding.retry")}<ArrowRight size={15} /></button>
                      <button onClick={returnToRepository} type="button"><ArrowLeft size={15} />{t("onboarding.returnToRepository")}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="onboarding-process-icon"><LoaderCircle className="spin" size={27} /></span>
                    <h1>{t("onboarding.generatingWorkflowTitle")}</h1>
                    <p>{t("onboarding.generatingWorkflowDescription")}</p>
                  </>
                )}
              </section>
            ) : null}

            {phase === "workflow-review" && workflow ? (
              <section className="onboarding-review">
                <div className="onboarding-icon"><Sparkles size={24} /></div>
                <h1>{t("onboarding.workflowReviewTitle")}</h1>
                <p className="onboarding-copy">{t("onboarding.workflowReviewDescription")}</p>
                <WorkflowPreview workflow={workflow} />
                <form className="onboarding-workflow-revision" onSubmit={(event) => void reviseWorkflow(event)}>
                  <label htmlFor="onboarding-workflow-revision">{t("onboarding.workflowRevisionLabel")}</label>
                  <textarea
                    disabled={revisingWorkflow}
                    id="onboarding-workflow-revision"
                    maxLength={4_000}
                    onChange={(event) => setWorkflowRevision(event.currentTarget.value)}
                    placeholder={t("onboarding.workflowRevisionPlaceholder")}
                    rows={3}
                    value={workflowRevision}
                  />
                  <button disabled={revisingWorkflow || !workflowRevision.trim()} type="submit">
                    {revisingWorkflow ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
                    {revisingWorkflow ? t("onboarding.workflowRevising") : t("onboarding.workflowRevise")}
                  </button>
                </form>
                {revisionError ? <p className="onboarding-inline-error" role="alert">{revisionError}</p> : null}
                <button className="onboarding-primary-action" disabled={revisingWorkflow} onClick={() => void analyzeRequirements()} type="button">
                  {t("onboarding.next")}<ArrowRight size={17} />
                </button>
                <p className="onboarding-dimmed-note">{t("onboarding.workflowEditableLater")}</p>
              </section>
            ) : null}

            {phase === "tools-loading" ? (
              <section className="onboarding-process" aria-live="polite">
                {toolsError ? (
                  <>
                    <span className="onboarding-process-icon error"><CircleAlert size={25} /></span>
                    <h1>{t("onboarding.toolAnalysisFailed")}</h1>
                    <p className="onboarding-process-error" role="alert">{toolsError}</p>
                    <div className="onboarding-secondary-actions">
                      <button onClick={() => void analyzeRequirements()} type="button">{t("onboarding.retry")}<ArrowRight size={15} /></button>
                      <button onClick={() => setPhase("workflow-review")} type="button"><ArrowLeft size={15} />{t("onboarding.returnToWorkflow")}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="onboarding-process-icon"><Cpu className="pulse" size={27} /></span>
                    <h1>{t("onboarding.analyzingToolsTitle")}</h1>
                    <p>{t("onboarding.analyzingToolsDescription")}</p>
                  </>
                )}
              </section>
            ) : null}

            {phase === "tools-review" && workflow ? (
              <section className="onboarding-review">
                <div className="onboarding-icon"><Wrench size={24} /></div>
                <h1>{t("onboarding.toolsReviewTitle")}</h1>
                <p className="onboarding-copy">{t("onboarding.toolsReviewDescription")}</p>
                {workflowRequirements.length ? (
                  <ul className="onboarding-tool-list">
                    {workflowRequirements.map((requirement) => {
                      const status = healthById.get(requirement.id);
                      return (
                        <li key={requirement.id}>
                          <i className={status?.healthy ? "ready" : "warning"}>
                            {status?.healthy ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
                          </i>
                          <span><strong>{requirement.label}</strong><small>{requirement.reason}</small><code>{requirement.tool}</code></span>
                          <em>{status?.healthy ? t("onboarding.installed") : t("onboarding.notInstalled")}</em>
                          {status?.detail ? <p>{status.detail}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="onboarding-no-tools"><CheckCircle2 size={18} />{t("onboarding.noAdditionalTools")}</div>
                )}
                {hasMissingTools ? <p className="onboarding-tool-warning"><CircleAlert size={15} />{t("onboarding.missingToolsWarning")}</p> : null}
                <button className="onboarding-primary-action" onClick={onFinish} type="button">
                  {t("onboarding.confirm")}<ArrowRight size={17} />
                </button>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
