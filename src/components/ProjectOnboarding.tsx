import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  CloudDownload,
  Cpu,
  ExternalLink,
  FilePlus2,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Github,
  HeartHandshake,
  Info,
  LoaderCircle,
  PlayCircle,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
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
import {
  githubSshRepositoryName,
  repositoryProjectName,
} from "../lib/project-workspace";
import {
  agentProviderLabels,
  type ProjectLlmProgress,
} from "../lib/project-llm";
import { formatExecutionDuration } from "../lib/agent-execution-metrics";
import { useI18n } from "../i18n";
import { DeveloperToolsSetup } from "./DeveloperToolsSetup";

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
  includeDeveloperTools?: boolean;
  loading: boolean;
  onAnalyzeRequirements: (
    projectId: string,
    onProgress?: (progress: ProjectLlmProgress) => void,
  ) => Promise<RequirementAnalysis>;
  onCancel: () => void;
  onCloneRepository: (repositoryUrl: string) => Promise<{
    repositoryPath: string;
    repositoryName: string;
  }>;
  onConnect: (
    settings: LocalAutoHuntConfig,
    repositoryPath: string,
    onProgress?: (progress: ProjectLlmProgress) => void,
  ) => Promise<PreparedProjectConnection>;
  onCreate: (input: { name: string }) => Promise<unknown>;
  onFinish: () => void;
  onReviseWorkflow: (
    projectId: string,
    requestedChange: string,
  ) => Promise<AutoHuntWorkflow>;
  onRepositorySelect: () => Promise<string | null>;
  onRepositoryInspect: (
    repositoryPath: string,
    workflow: LocalAutoHuntConfig["workflow"],
  ) => Promise<RepositoryReadiness>;
};

type OnboardingPhase =
  | "choose-method"
  | "developer-tools"
  | "repository"
  | "lovable-tutorial"
  | "lovable-repository"
  | "workflow-loading"
  | "workflow-review"
  | "tools-loading"
  | "tools-review";

function Progress({ current, total }: { current: number; total: 3 | 4 }) {
  return (
    <div
      aria-hidden="true"
      className={`project-onboarding-progress total-${total}`}
    >
      {Array.from({ length: total }, (_, index) => index + 1).map((step) => (
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

function OnboardingProviderProgress({
  progress,
  progressMessageRef,
}: {
  progress: ProjectLlmProgress | null;
  progressMessageRef: RefObject<HTMLParagraphElement | null>;
}) {
  const { t } = useI18n();
  const startedAt = useRef(Date.now());
  const [lastActivityAt, setLastActivityAt] = useState(startedAt.current);
  const [now, setNow] = useState(startedAt.current);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const activityAt = Date.now();
    setLastActivityAt(activityAt);
    setNow(activityAt);
  }, [progress?.message, progress?.messageId]);

  const elapsed = formatExecutionDuration(now - startedAt.current);
  const quietDuration = Math.max(0, now - lastActivityAt);
  const isQuiet = quietDuration >= 60_000;
  const displayedMessage = providerProgressMessage(progress, t);

  return (
    <div
      aria-label={t("onboarding.workflowProviderProgress")}
      className={`onboarding-provider-progress${isQuiet ? " quiet" : ""}`}
      role="group"
    >
      <div className="onboarding-provider-progress-heading">
        <span>
          <i aria-hidden="true" />
          {progress
            ? agentProviderLabels[progress.provider]
            : t("onboarding.workflowProviderProgress")}
        </span>
        <small>{t("onboarding.workflowElapsed", { duration: elapsed })}</small>
      </div>
      <p
        aria-atomic="true"
        aria-live="polite"
        ref={progressMessageRef}
        role="status"
      >
        {displayedMessage}
      </p>
      <div className="onboarding-provider-progress-meta">
        <span>
          {isQuiet
            ? t("onboarding.workflowQuietFor", {
                duration: formatExecutionDuration(quietDuration),
              })
            : t("onboarding.workflowUpdatedNow")}
        </span>
      </div>
      {isQuiet ? (
        <div className="onboarding-provider-progress-notice">
          <Info aria-hidden="true" size={14} />
          <span>{t("onboarding.workflowStillWorking")}</span>
        </div>
      ) : null}
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function structuredProgressDetail(message: string) {
  try {
    const parsed = JSON.parse(message) as {
      stages?: Array<{ evidence?: unknown }>;
    };
    const details = parsed.stages
      ?.flatMap((stage) =>
        Array.isArray(stage.evidence)
          ? stage.evidence.filter(
              (detail): detail is string =>
                typeof detail === "string" && Boolean(detail.trim()),
            )
          : [],
      );
    return details?.at(-1)?.trim() || null;
  } catch {
    return null;
  }
}

function providerProgressMessage(
  progress: ProjectLlmProgress | null,
  t: Translate,
) {
  if (!progress) return t("onboarding.workflowProviderWaiting");
  if (progress.phase === "final" || progress.phase === "final_answer") {
    return t("onboarding.workflowProviderFinalizing");
  }
  if (progress.activityKind) {
    const activityKey = {
      command: "onboarding.workflowActivityCommand",
      fileChange: "onboarding.workflowActivityFiles",
      webSearch: "onboarding.workflowActivityWeb",
      tool: "onboarding.workflowActivityTool",
    }[progress.activityKind] as
      | "onboarding.workflowActivityCommand"
      | "onboarding.workflowActivityFiles"
      | "onboarding.workflowActivityWeb"
      | "onboarding.workflowActivityTool";
    return t(activityKey);
  }
  const message = progress.message.trim();
  const structuredDetail = structuredProgressDetail(message);
  if (structuredDetail) return structuredDetail;
  if (message.startsWith("{") || message.startsWith("[")) {
    return t("onboarding.workflowInspecting");
  }
  return message || t("onboarding.workflowInspecting");
}

export function ProjectOnboarding({
  canCancel = false,
  connection,
  error,
  includeDeveloperTools = false,
  loading,
  onAnalyzeRequirements,
  onCancel,
  onCloneRepository,
  onConnect,
  onCreate,
  onFinish,
  onRepositoryInspect,
  onRepositorySelect,
  onReviseWorkflow,
}: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<OnboardingPhase>(
    connection ? "repository" : "choose-method",
  );
  const [name, setName] = useState(connection?.project.name ?? "");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repositoryReadiness, setRepositoryReadiness] =
    useState<RepositoryReadiness | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [selectingRepository, setSelectingRepository] = useState(false);
  const [workflow, setWorkflow] = useState<AutoHuntWorkflow | null>(null);
  const [workflowError, setWorkflowError] = useState<WorkflowFailure | null>(null);
  const [workflowProgress, setWorkflowProgress] =
    useState<ProjectLlmProgress | null>(null);
  const [workflowRevision, setWorkflowRevision] = useState("");
  const [revisingWorkflow, setRevisingWorkflow] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const generationRequest = useRef<{
    key: string;
    promise: Promise<PreparedProjectConnection>;
  } | null>(null);
  const generationProgressKey = useRef<string | null>(null);
  const workflowProgressMessage = useRef<HTMLParagraphElement | null>(null);
  const [requirementHealth, setRequirementHealth] = useState<
    WorkflowRequirementHealth[]
  >([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [lovableRepositoryUrl, setLovableRepositoryUrl] = useState("");
  const [lovableImporting, setLovableImporting] = useState(false);
  const [lovableError, setLovableError] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading && !lovableImporting) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [loading, lovableImporting, onCancel]);

  useEffect(() => {
    if (connection && !name) setName(connection.project.name);
  }, [connection, name]);

  useEffect(() => {
    const message = workflowProgressMessage.current;
    if (message) message.scrollTop = message.scrollHeight;
  }, [workflowProgress?.message]);

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
      generationProgressKey.current = key;
      setWorkflowProgress(null);
      generationRequest.current = {
        key,
        promise: onConnect(settings, repositoryPath, (progress) => {
          if (generationProgressKey.current === key) {
            setWorkflowProgress(progress);
          }
        }),
      };
    }
    let active = true;
    setWorkflowError(null);
    void generationRequest.current.promise
      .then((result) => {
        if (!active) return;
        setRepositoryPath(result.repositoryPath);
        setWorkflow(result.workflow);
        generationProgressKey.current = null;
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

  const startLocalRepositoryFlow = () => {
    setPhase(includeDeveloperTools ? "developer-tools" : "repository");
  };

  const importLovableRepository = async (event: React.FormEvent) => {
    event.preventDefault();
    const repositoryUrl = lovableRepositoryUrl.trim();
    const repositoryName = githubSshRepositoryName(repositoryUrl);
    if (!repositoryName) {
      setLovableError(t("onboarding.lovableSshInvalid"));
      return;
    }
    setLovableImporting(true);
    setLovableError(null);
    try {
      const cloned = await onCloneRepository(repositoryUrl);
      const readiness = await onRepositoryInspect(
        cloned.repositoryPath,
        repositoryWorkflowBootstrap,
      );
      if (!readiness.gitReady) {
        throw new Error(
          readiness.issues[0] ?? t("onboarding.lovableRepositoryNotReady"),
        );
      }
      setRepositoryPath(readiness.repositoryPath);
      setRepositoryReadiness(readiness);
      setName(cloned.repositoryName || repositoryName);
      await onCreate({ name: cloned.repositoryName || repositoryName });
      setWorkflowError(null);
      setPhase("workflow-loading");
    } catch (caught) {
      setLovableError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLovableImporting(false);
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
    generationProgressKey.current = null;
    generationRequest.current = null;
    setWorkflowError(null);
    setWorkflowProgress(null);
    setGenerationAttempt((current) => current + 1);
  };

  const returnToRepository = () => {
    generationProgressKey.current = null;
    generationRequest.current = null;
    setWorkflowError(null);
    setWorkflowProgress(null);
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
    setWorkflowProgress(null);
    setPhase("tools-loading");
    setToolsError(null);
    try {
      const result = await onAnalyzeRequirements(
        connection.project.id,
        setWorkflowProgress,
      );
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
  const reconnectingExistingWorkflow = Boolean(
    connection?.workflow &&
    !isRepositoryWorkflowPending(connection.workflow),
  );
  const totalSteps: 3 | 4 = includeDeveloperTools ? 4 : 3;
  const currentStep = phase === "developer-tools"
    ? 1
    : phase === "repository"
      ? includeDeveloperTools ? 2 : 1
      : phase.startsWith("workflow")
        ? includeDeveloperTools ? 3 : 2
        : includeDeveloperTools ? 4 : 3;
  const backAction = phase === "developer-tools"
    ? () => setPhase("choose-method")
    : phase === "repository" && !connection
      ? includeDeveloperTools
        ? () => setPhase("developer-tools")
        : () => setPhase("choose-method")
      : phase === "lovable-tutorial"
        ? () => setPhase("choose-method")
        : phase === "lovable-repository"
          ? () => setPhase("lovable-tutorial")
          : null;
  const showsSetupProgress =
    phase === "developer-tools" ||
    phase === "repository" ||
    phase.startsWith("workflow") ||
    phase.startsWith("tools");
  const lovableRepositoryName = githubSshRepositoryName(lovableRepositoryUrl);

  return (
    <div
      className="dialog-backdrop project-onboarding-modal-backdrop"
      onMouseDown={(event) => {
        if (
          event.currentTarget === event.target &&
          !loading &&
          !lovableImporting
        ) onCancel();
      }}
    >
      <section
        aria-label={t("onboarding.addProject")}
        aria-modal="true"
        className="onboarding-card project-onboarding-card project-onboarding-dialog"
        role="dialog"
      >
        <header className="project-onboarding-dialog-toolbar">
          <span>
            {backAction ? (
              <button onClick={backAction} type="button">
                <ArrowLeft size={15} /> {t("onboarding.previous")}
              </button>
            ) : null}
          </span>
          <button
            aria-label={t("common.close")}
            className="project-onboarding-dialog-close"
            disabled={loading || lovableImporting}
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <div className="project-onboarding-dialog-body">
            {showsSetupProgress && reconnectingExistingWorkflow ? (
              <p className="eyebrow">{t("health.reconnect")}</p>
            ) : showsSetupProgress ? (
              <>
                <p className="eyebrow">
                  {t("onboarding.setupProgress", {
                    step: currentStep,
                    total: totalSteps,
                  })}
                </p>
                <Progress current={currentStep} total={totalSteps} />
              </>
            ) : null}

            {phase === "choose-method" ? (
              <section className="project-start-choice">
                <p className="eyebrow">{t("onboarding.addProject")}</p>
                <h1>{t("onboarding.chooseMethodTitle")}</h1>
                <p className="onboarding-copy">{t("onboarding.chooseMethodDescription")}</p>
                <div className="project-start-choice-grid">
                  <button onClick={startLocalRepositoryFlow} type="button">
                    <i><FolderGit2 size={24} /></i>
                    <span>
                      <strong>{t("onboarding.connectLocalTitle")}</strong>
                      <small>{t("onboarding.connectLocalDescription")}</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                  <button aria-disabled="true" disabled type="button">
                    <i><FilePlus2 size={24} /></i>
                    <span>
                      <strong>{t("onboarding.createScratchTitle")}</strong>
                      <small>{t("onboarding.createScratchDescription")}</small>
                    </span>
                    <em>{t("onboarding.comingSoon")}</em>
                  </button>
                  <button onClick={() => setPhase("lovable-tutorial")} type="button">
                    <i className="lovable"><HeartHandshake size={24} /></i>
                    <span>
                      <strong>{t("onboarding.migrateLovableTitle")}</strong>
                      <small>{t("onboarding.migrateLovableDescription")}</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                </div>
              </section>
            ) : null}

            {phase === "lovable-tutorial" ? (
              <section className="lovable-tutorial">
                <p className="eyebrow">{t("onboarding.lovableStepVideo")}</p>
                <div className="onboarding-icon lovable"><PlayCircle size={24} /></div>
                <h1>{t("onboarding.lovableTutorialTitle")}</h1>
                <p className="onboarding-copy">{t("onboarding.lovableTutorialDescription")}</p>
                <div className="lovable-video-frame">
                  <iframe
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    src="https://www.youtube-nocookie.com/embed/zgNkhU4SYgQ?rel=0"
                    title={t("onboarding.lovableVideoTitle")}
                  />
                </div>
                <div className="lovable-tutorial-note">
                  <Github size={18} />
                  <span>
                    <strong>{t("onboarding.lovableSyncResultTitle")}</strong>
                    <small>{t("onboarding.lovableSyncResultDescription")}</small>
                  </span>
                </div>
                <a
                  className="lovable-docs-link"
                  href="https://docs.lovable.dev/integrations/github"
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("onboarding.lovableOpenDocs")} <ExternalLink size={14} />
                </a>
                <button
                  className="onboarding-primary-action"
                  onClick={() => setPhase("lovable-repository")}
                  type="button"
                >
                  {t("onboarding.lovableVideoComplete")}<ArrowRight size={17} />
                </button>
              </section>
            ) : null}

            {phase === "lovable-repository" ? (
              <section className="lovable-repository-step">
                <p className="eyebrow">{t("onboarding.lovableStepRepository")}</p>
                <div className="onboarding-icon lovable"><CloudDownload size={24} /></div>
                <h1>{t("onboarding.lovableRepositoryTitle")}</h1>
                <p className="onboarding-copy">{t("onboarding.lovableRepositoryDescription")}</p>
                <ol className="lovable-copy-steps">
                  <li><span>1</span><p>{t("onboarding.lovableCopyStepOne")}</p></li>
                  <li><span>2</span><p>{t("onboarding.lovableCopyStepTwo")}</p></li>
                  <li><span>3</span><p>{t("onboarding.lovableCopyStepThree")}</p></li>
                </ol>
                <form className="lovable-repository-form" onSubmit={(event) => void importLovableRepository(event)}>
                  <label htmlFor="lovable-github-ssh-url">{t("onboarding.lovableSshLabel")}</label>
                  <div className="lovable-repository-input">
                    <Github size={18} />
                    <input
                      autoCapitalize="none"
                      autoComplete="off"
                      disabled={lovableImporting}
                      id="lovable-github-ssh-url"
                      onChange={(event) => {
                        setLovableRepositoryUrl(event.currentTarget.value);
                        setLovableError(null);
                      }}
                      placeholder="git@github.com:your-account/your-project.git"
                      spellCheck={false}
                      value={lovableRepositoryUrl}
                    />
                  </div>
                  {lovableRepositoryName ? (
                    <p className="lovable-destination-preview">
                      <Check size={14} />
                      {t("onboarding.lovableDestinationPreview", {
                        name: lovableRepositoryName,
                      })}
                    </p>
                  ) : null}
                  {lovableError || error ? (
                    <p className="repository-readiness-error" role="alert">
                      <CircleAlert size={14} />{lovableError || error}
                    </p>
                  ) : null}
                  <button
                    className="onboarding-primary-action"
                    disabled={lovableImporting || !lovableRepositoryName}
                    type="submit"
                  >
                    {lovableImporting ? (
                      <><LoaderCircle className="spin" size={17} />{t("onboarding.lovableCloning")}</>
                    ) : (
                      <>{t("onboarding.confirm")}<ArrowRight size={17} /></>
                    )}
                  </button>
                </form>
                <p className="onboarding-dimmed-note">{t("onboarding.lovableCloneNotice")}</p>
              </section>
            ) : null}

            {phase === "developer-tools" ? (
              <DeveloperToolsSetup onContinue={() => setPhase("repository")} />
            ) : null}

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
                <p className="onboarding-copy">
                  {reconnectingExistingWorkflow
                    ? t("onboarding.repositoryConnectAccountDescription")
                    : t("onboarding.repositoryRequiredDescription")}
                </p>
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
                      {loading
                        ? reconnectingExistingWorkflow
                          ? t("onboarding.repositoryConnecting")
                          : t("onboarding.creating")
                        : reconnectingExistingWorkflow
                          ? t("dashboard.connectRepository")
                          : t("onboarding.next")}
                      <ArrowRight size={17} />
                    </button>
                  ) : null}
                </form>
              </>
            ) : null}

            {phase === "workflow-loading" ? (
              <section className="onboarding-process">
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
                    <OnboardingProviderProgress
                      progress={workflowProgress}
                      progressMessageRef={workflowProgressMessage}
                    />
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
              <section className="onboarding-process">
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
                    <OnboardingProviderProgress
                      progress={workflowProgress}
                      progressMessageRef={workflowProgressMessage}
                    />
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
        </div>
      </section>
    </div>
  );
}
