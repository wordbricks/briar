import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  GitBranch,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  agentEfforts,
  agentModels,
  agentProviders,
  defaultAppProviderSettings,
  loadAppProviderSettings,
  loadProjectLlmSettings,
  updateProjectLlmSettings,
  type AgentProvider,
  type AppProviderSettings,
  type ApprovalPolicy,
  type ModelEffort,
} from "../lib/project-llm";
import type { DashboardPayload, Project, ProjectSettings as ProjectSettingsData } from "../types";
import { useI18n } from "../i18n";
import {
  defaultAutoHuntAutomation,
  normalizeAutoHuntAutomation,
  type AutoHuntAutomation,
} from "../lib/auto-hunt-automation";
import type { VelenInspection } from "../lib/project-connection";
import type {
  LinearImportConnectResult,
  LinearImportResult,
  LinearImportStatesResult,
} from "../lib/linear-import";
import { LinearIssueImport } from "./LinearIssueImport";
import { SelectMenu } from "./SelectMenu";

export function ProjectSettings({
  dashboard,
  githubRepository,
  isDeleting,
  isSidebarOpen,
  onBack,
  onDelete,
  onRegenerateWorkflow,
  onUpdateAutomation,
  onUpdateLinear,
  onConnectLinearImport,
  onLoadLinearImportStates,
  onImportLinearIssues,
  onRefreshVelen,
  project,
  repositoryConnected,
  velen,
}: {
  dashboard: DashboardPayload | null;
  githubRepository: string | null;
  isDeleting: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onDelete: () => Promise<unknown>;
  onRegenerateWorkflow: () => Promise<unknown>;
  onUpdateAutomation: (
    automation: AutoHuntAutomation,
  ) => Promise<AutoHuntAutomation>;
  onUpdateLinear: (
    linear: ProjectSettingsData["linear"],
  ) => Promise<ProjectSettingsData["linear"]>;
  onConnectLinearImport: (apiKey: string) => Promise<LinearImportConnectResult>;
  onLoadLinearImportStates: (input: {
    apiKey: string;
    teamIds: string[];
  }) => Promise<LinearImportStatesResult>;
  onImportLinearIssues: (input: {
    apiKey: string;
    teamIds: string[];
    statusMapping: Record<string, string>;
  }) => Promise<LinearImportResult>;
  onRefreshVelen: (org?: string | null) => Promise<VelenInspection | null>;
  project: Project;
  repositoryConnected: boolean;
  velen: VelenInspection | null;
}) {
  const { localeTag, t } = useI18n();
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("never");
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<ModelEffort | null>(null);
  const [providerAvailability, setProviderAvailability] =
    useState<AppProviderSettings>(defaultAppProviderSettings);
  const [savedApprovalPolicy, setSavedApprovalPolicy] =
    useState<ApprovalPolicy>("never");
  const [savedProvider, setSavedProvider] = useState<AgentProvider>("codex");
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [savedEffort, setSavedEffort] = useState<ModelEffort | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [workflowCopied, setWorkflowCopied] = useState(false);
  const [isRegeneratingWorkflow, setIsRegeneratingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowRegenerated, setWorkflowRegenerated] = useState(false);
  const [automation, setAutomation] = useState<AutoHuntAutomation>(
    () => normalizeAutoHuntAutomation(dashboard?.settings.automation),
  );
  const [savedAutomation, setSavedAutomation] = useState<AutoHuntAutomation>(
    () => normalizeAutoHuntAutomation(dashboard?.settings.automation),
  );
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [linear, setLinear] = useState<ProjectSettingsData["linear"]>(
    () => dashboard?.settings.linear ?? {
      enabled: false,
      source: null,
      teamKey: null,
    },
  );
  const [savedLinear, setSavedLinear] = useState<ProjectSettingsData["linear"]>(
    () => dashboard?.settings.linear ?? {
      enabled: false,
      source: null,
      teamKey: null,
    },
  );
  const [linearLoading, setLinearLoading] = useState(false);
  const [linearSaving, setLinearSaving] = useState(false);
  const [linearError, setLinearError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflow = dashboard?.settings.workflow ?? null;
  const workflowContract = workflow
    ? {
        version: workflow.version,
        stages: workflow.stages,
        completion: workflow.completion,
        release: workflow.release,
      }
    : null;
  const workflowJson = workflowContract
    ? JSON.stringify(workflowContract, null, 2)
    : "";
  const providerName =
    provider === "codex" ? "Codex" : provider === "grok" ? "Grok" : "Claude";
  const providerRuntimeName =
    provider === "codex"
      ? "Codex App Server"
      : provider === "grok"
        ? "Grok CLI (ACP)"
        : "Claude Agent SDK";

  useEffect(() => {
    let cancelled = false;
    setWorkflowError(null);
    setWorkflowRegenerated(false);
    setSettingsLoading(true);
    setSettingsError(null);
    void Promise.all([
      loadProjectLlmSettings(project.id),
      loadAppProviderSettings(),
    ])
      .then(([settings, availability]) => {
        if (cancelled) return;
        setProvider(settings.provider);
        setSavedProvider(settings.provider);
        setModel(settings.model);
        setSavedModel(settings.model);
        setEffort(settings.effort);
        setSavedEffort(settings.effort);
        setProviderAvailability(availability);
        setApprovalPolicy(settings.approvalPolicy);
        setSavedApprovalPolicy(settings.approvalPolicy);
      })
      .catch((caught) => {
        if (!cancelled) {
          setSettingsError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    const next = normalizeAutoHuntAutomation(
      dashboard?.settings.automation ?? defaultAutoHuntAutomation,
    );
    setAutomation(next);
    setSavedAutomation(next);
    setAutomationError(null);
  }, [dashboard?.settings.automation, project.id]);

  useEffect(() => {
    const next = dashboard?.settings.linear ?? {
      enabled: false,
      source: null,
      teamKey: null,
    };
    setLinear(next);
    setSavedLinear(next);
    setLinearError(null);
  }, [dashboard?.settings.linear, project.id]);

  useEffect(() => {
    const org = dashboard?.settings.velenOrg;
    if (!org) return;
    let cancelled = false;
    setLinearLoading(true);
    setLinearError(null);
    void onRefreshVelen(org)
      .then((inspection) => {
        if (!cancelled && !inspection) {
          setLinearError(t("settings.linearLoadFailed"));
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setLinearError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setLinearLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dashboard?.settings.velenOrg, onRefreshVelen, project.id, t]);

  useEffect(() => {
    if (!isConfirming) return;
    cancelButtonRef.current?.focus();
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) setIsConfirming(false);
    };
    document.addEventListener("keydown", closeWithKeyboard);
    return () => document.removeEventListener("keydown", closeWithKeyboard);
  }, [isConfirming, isDeleting]);

  const confirmDelete = async () => {
    setDeleteError(null);
    try {
      await onDelete();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const saveLlmSettings = async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const settings = await updateProjectLlmSettings(project.id, {
        provider,
        model,
        effort,
        approvalPolicy,
      });
      setProvider(settings.provider);
      setSavedProvider(settings.provider);
      setModel(settings.model);
      setSavedModel(settings.model);
      setEffort(settings.effort);
      setSavedEffort(settings.effort);
      setApprovalPolicy(settings.approvalPolicy);
      setSavedApprovalPolicy(settings.approvalPolicy);
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSettingsSaving(false);
    }
  };

  const regenerateWorkflow = async () => {
    setIsRegeneratingWorkflow(true);
    setWorkflowError(null);
    setWorkflowRegenerated(false);
    try {
      await onRegenerateWorkflow();
      setWorkflowRegenerated(true);
    } catch (caught) {
      setWorkflowError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRegeneratingWorkflow(false);
    }
  };

  const saveAutomation = async () => {
    setAutomationSaving(true);
    setAutomationError(null);
    try {
      const saved = await onUpdateAutomation(automation);
      setAutomation(saved);
      setSavedAutomation(saved);
    } catch (caught) {
      setAutomationError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAutomationSaving(false);
    }
  };
  const automationChanged =
    JSON.stringify(automation) !== JSON.stringify(savedAutomation);
  const linearSources = (velen?.sources ?? []).filter(
    (source) => source.provider === "linear" && source.status === "active",
  );
  const selectedLinearSourceAvailable = linearSources.some(
    (source) => source.sourceRef === linear.source,
  );
  const linearChanged = JSON.stringify(linear) !== JSON.stringify(savedLinear);
  const providerModels = agentModels[provider];
  const providerEfforts = agentEfforts[provider];
  const selectedModelKnown = providerModels.some(
    (option) => option.value === (model ?? ""),
  );
  const llmSettingsChanged =
    provider !== savedProvider ||
    model !== savedModel ||
    effort !== savedEffort ||
    approvalPolicy !== savedApprovalPolicy;

  const saveLinear = async () => {
    setLinearSaving(true);
    setLinearError(null);
    try {
      const saved = await onUpdateLinear(linear);
      setLinear(saved);
      setSavedLinear(saved);
    } catch (caught) {
      setLinearError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLinearSaving(false);
    }
  };

  return (
    <main className="main-content project-settings-page">
      <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region="deep">
        <button className="project-settings-back" onClick={onBack} type="button">
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>{t("settings.back")}</span>
        </button>
      </header>

      <div className="project-settings-scroll">
        <div className="project-settings-content">
          <header className="project-settings-heading">
            <p className="eyebrow">PROJECT SETTINGS</p>
            <h1>{t("settings.title")}</h1>
            <p>{t("settings.description", { name: project.name })}</p>
          </header>

          <section className="project-settings-card">
            <div>
              <span>{t("settings.projectName")}</span>
              <strong>{project.name}</strong>
            </div>
            <small>{t("settings.created", { date: new Date(project.createdAt).toLocaleDateString(localeTag) })}</small>
          </section>

          <section className="project-settings-linear">
            <header>
              <span className="project-settings-linear-icon">
                <Link2 size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("settings.linearTitle")}</strong>
                <small>{t("settings.linearDescription")}</small>
              </span>
              <div className="project-settings-linear-actions">
                <button
                  aria-label={t("settings.linearRefresh")}
                  disabled={linearLoading || linearSaving || !dashboard?.settings.velenOrg}
                  onClick={() => {
                    const org = dashboard?.settings.velenOrg;
                    if (!org) return;
                    setLinearLoading(true);
                    setLinearError(null);
                    void onRefreshVelen(org)
                      .then((inspection) => {
                        if (!inspection) setLinearError(t("settings.linearLoadFailed"));
                      })
                      .catch((caught) => {
                        setLinearError(
                          caught instanceof Error ? caught.message : String(caught),
                        );
                      })
                      .finally(() => setLinearLoading(false));
                  }}
                  type="button"
                >
                  <RefreshCw className={linearLoading ? "spin" : undefined} size={14} />
                </button>
                <label className="project-settings-toggle">
                  <input
                    checked={linear.enabled}
                    disabled={linearLoading || linearSaving}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setLinear((current) => {
                        const source = current.source ?? linearSources[0]?.sourceRef ?? null;
                        return { ...current, enabled, source };
                      });
                    }}
                    type="checkbox"
                  />
                  <span>
                    {t(linear.enabled ? "settings.linearOn" : "settings.linearOff")}
                  </span>
                </label>
              </div>
            </header>

            {linear.enabled ? (
              <div className="project-settings-linear-fields">
                <label>
                  <span>{t("settings.linearSource")}</span>
                  <SelectMenu
                    disabled={linearLoading || linearSaving}
                    label={t("settings.linearSource")}
                    onValueChange={(value) => {
                      const source = value || null;
                      setLinear((current) => ({ ...current, source }));
                    }}
                    options={[
                      {
                        label: t("settings.linearSelectSource"),
                        value: "",
                      },
                      ...(linear.source && !selectedLinearSourceAvailable
                        ? [{
                            disabled: true,
                            label: `${linear.source} · ${t("settings.linearUnavailable")}`,
                            value: linear.source,
                          }]
                        : []),
                      ...linearSources.map((source) => ({
                        label: source.sourceKey,
                        value: source.sourceRef,
                      })),
                    ]}
                    size="small"
                    value={linear.source ?? ""}
                  />
                </label>
                <label>
                  <span>
                    {t("settings.linearTeam")} <small>{t("common.optional")}</small>
                  </span>
                  <input
                    aria-label={t("settings.linearTeam")}
                    disabled={linearSaving}
                    onChange={(event) => {
                      const teamKey = event.currentTarget.value;
                      setLinear((current) => ({ ...current, teamKey }));
                    }}
                    placeholder={t("settings.linearTeamExample")}
                    value={linear.teamKey ?? ""}
                  />
                </label>
              </div>
            ) : (
              <p className="project-settings-linear-disabled">
                {t("settings.linearDisabledDescription")}
              </p>
            )}

            <footer>
              <p>
                {t("settings.linearVelenSource", {
                  org: dashboard?.settings.velenOrg ?? "—",
                })}
              </p>
              <button
                disabled={
                  linearLoading ||
                  linearSaving ||
                  !linearChanged ||
                  (linear.enabled && (!linear.source || !selectedLinearSourceAvailable))
                }
                onClick={() => void saveLinear()}
                type="button"
              >
                {linearSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : !linearChanged ? (
                  <Check size={14} />
                ) : null}
                {linearSaving
                  ? t("common.saving")
                  : !linearChanged
                    ? t("common.saved")
                    : t("common.save")}
              </button>
            </footer>
            {linearError ? (
              <p className="project-settings-linear-error" role="alert">
                {linearError}
              </p>
            ) : null}
          </section>

          <LinearIssueImport
            onConnect={onConnectLinearImport}
            onImport={onImportLinearIssues}
            onLoadStates={onLoadLinearImportStates}
            projectId={project.id}
            repositoryConnected={repositoryConnected}
            workflow={workflow}
          />

          <section className="project-settings-auto-run">
            <header>
              <span className="project-settings-auto-run-icon">
                <Zap size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("settings.autoRunTitle")}</strong>
                <small>{t("settings.autoRunDescription")}</small>
              </span>
              <label className="project-settings-toggle">
                <input
                  checked={automation.enabled}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    setAutomation((current) => ({
                      ...current,
                      enabled,
                    }));
                  }}
                  type="checkbox"
                />
                <span>{t(automation.enabled ? "settings.autoRunOn" : "settings.autoRunOff")}</span>
              </label>
            </header>

            <div className="project-settings-auto-run-rules">
              <label>
                <span>{t("settings.autoRunMaxIssues")}</span>
                <input
                  max={10}
                  min={1}
                  onChange={(event) => {
                    const maxIssuesPerSession = Number(event.currentTarget.value);
                    setAutomation((current) => ({
                      ...current,
                      maxIssuesPerSession,
                    }));
                  }}
                  type="number"
                  value={automation.maxIssuesPerSession}
                />
                <small>{t("settings.autoRunMaxIssuesDescription")}</small>
              </label>

              <div className="project-settings-auto-run-condition">
                <label className="project-settings-auto-run-condition-check">
                  <input
                    checked={automation.schedule.enabled}
                    disabled={!automation.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setAutomation((current) => ({
                        ...current,
                        schedule: {
                          ...current.schedule,
                          enabled,
                        },
                      }));
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{t("settings.autoRunSchedule")}</strong>
                    <small>{t("settings.autoRunScheduleDescription")}</small>
                  </span>
                </label>
                <input
                  aria-label={t("settings.autoRunIntervalHours")}
                  disabled={!automation.enabled || !automation.schedule.enabled}
                  max={168}
                  min={1}
                  onChange={(event) => {
                    const intervalHours = Number(event.currentTarget.value);
                    setAutomation((current) => ({
                      ...current,
                      schedule: {
                        ...current.schedule,
                        intervalHours,
                      },
                    }));
                  }}
                  type="number"
                  value={automation.schedule.intervalHours}
                />
                <em>{t("settings.hours")}</em>
              </div>

              <div className="project-settings-auto-run-condition">
                <label className="project-settings-auto-run-condition-check">
                  <input
                    checked={automation.queueThreshold.enabled}
                    disabled={!automation.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setAutomation((current) => ({
                        ...current,
                        queueThreshold: {
                          ...current.queueThreshold,
                          enabled,
                        },
                      }));
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{t("settings.autoRunQueue")}</strong>
                    <small>{t("settings.autoRunQueueDescription")}</small>
                  </span>
                </label>
                <input
                  aria-label={t("settings.autoRunQueueMinimum")}
                  disabled={!automation.enabled || !automation.queueThreshold.enabled}
                  max={100}
                  min={1}
                  onChange={(event) => {
                    const minimumIssues = Number(event.currentTarget.value);
                    setAutomation((current) => ({
                      ...current,
                      queueThreshold: {
                        ...current.queueThreshold,
                        minimumIssues,
                      },
                    }));
                  }}
                  type="number"
                  value={automation.queueThreshold.minimumIssues}
                />
                <em>{t("settings.issuesUnit")}</em>
              </div>

              <div className="project-settings-auto-run-condition">
                <label className="project-settings-auto-run-condition-check">
                  <input
                    checked={automation.urgentIssue.enabled}
                    disabled={!automation.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setAutomation((current) => ({
                        ...current,
                        urgentIssue: { enabled },
                      }));
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{t("settings.autoRunUrgent")}</strong>
                    <small>{t("settings.autoRunUrgentDescription")}</small>
                  </span>
                </label>
              </div>
            </div>
            <footer>
              <p>{t("settings.autoRunOrNotice")}</p>
              <button
                disabled={automationSaving || !automationChanged}
                onClick={() => void saveAutomation()}
                type="button"
              >
                {automationSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : !automationChanged ? (
                  <Check size={14} />
                ) : null}
                {automationSaving
                  ? t("common.saving")
                  : !automationChanged
                    ? t("common.saved")
                    : t("common.save")}
              </button>
            </footer>
            {automationError ? (
              <p className="project-settings-auto-run-error">{automationError}</p>
            ) : null}
          </section>

          <section className="project-settings-automation">
            <header>
              <span className="project-settings-automation-icon">
                <GitBranch size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("settings.workflowTitle")}</strong>
                <small>{t("settings.workflowDescription")}</small>
              </span>
              <div className="project-settings-automation-actions">
                <button
                  disabled={isRegeneratingWorkflow || !workflowContract}
                  onClick={() => void regenerateWorkflow()}
                  type="button"
                >
                  {isRegeneratingWorkflow ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {isRegeneratingWorkflow
                    ? t("settings.regeneratingWorkflow")
                    : t("settings.regenerateWorkflow")}
                </button>
                {workflowContract ? (
                  <button
                    aria-label={t("settings.copyWorkflow")}
                    onClick={() => {
                      void navigator.clipboard.writeText(workflowJson).then(() => {
                        setWorkflowCopied(true);
                        window.setTimeout(() => setWorkflowCopied(false), 1_500);
                      });
                    }}
                    type="button"
                  >
                    {workflowCopied ? <Check size={14} /> : <Copy size={14} />}
                    {workflowCopied ? t("settings.copied") : t("settings.copyJson")}
                  </button>
                ) : null}
              </div>
            </header>
            <p className="project-settings-workflow-ai-note">
              {t("settings.regenerateWorkflowDescription").replace(
                "Codex App Server",
                providerRuntimeName,
              )}
            </p>
            <div aria-live="polite">
              {workflowRegenerated ? (
                <p className="project-settings-workflow-success">
                  <Check size={13} />{t("settings.workflowRegenerated")}
                </p>
              ) : null}
              {workflowError ? (
                <p className="project-settings-workflow-error">{workflowError}</p>
              ) : null}
            </div>
            {workflowContract ? (
              <div className="project-workflow-contract">
                <div>
                  <span>{t("settings.repository")}</span>
                  <strong>{githubRepository ?? t("settings.noRepository")}</strong>
                </div>
                <pre aria-label={t("settings.workflowJson")}><code>{workflowJson}</code></pre>
              </div>
            ) : (
              <p className="project-settings-empty">{t("settings.loadingWorkflow")}</p>
            )}
          </section>

          <section className="project-settings-llm">
            <header>
              <span className="project-settings-llm-icon">
                <ShieldCheck size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("settings.agentTitle")}</strong>
                <small>{t("settings.agentDescription")}</small>
              </span>
            </header>
            <div className="project-settings-llm-control">
              <label htmlFor="project-agent-provider">{t("settings.provider")}</label>
              <SelectMenu
                disabled={settingsLoading || settingsSaving}
                id="project-agent-provider"
                label={t("settings.provider")}
                onValueChange={(value) => {
                  setProvider(value as AgentProvider);
                  setModel(null);
                  setEffort(null);
                }}
                options={agentProviders.map((candidate) => ({
                  description: !providerAvailability[candidate]
                    ? t("settings.providerDisabled")
                    : undefined,
                  disabled: !providerAvailability[candidate],
                  label: candidate === "codex" ? "Codex" : "Claude",
                  value: candidate,
                }))}
                size="small"
                value={provider}
              />
              <label htmlFor="project-agent-model">{t("settings.model")}</label>
              <SelectMenu
                disabled={settingsLoading || settingsSaving}
                id="project-agent-model"
                label={t("settings.model")}
                onValueChange={(value) => setModel(value || null)}
                options={[
                  ...(!selectedModelKnown && model
                    ? [{ label: model, value: model }]
                    : []),
                  ...providerModels.map((option) => ({
                    label: option.value
                      ? option.label
                      : t("settings.providerDefaultModel"),
                    value: option.value,
                  })),
                ]}
                size="small"
                value={model ?? ""}
              />
              <label htmlFor="project-agent-effort">{t("settings.effort")}</label>
              <SelectMenu
                disabled={settingsLoading || settingsSaving}
                id="project-agent-effort"
                label={t("settings.effort")}
                onValueChange={(value) =>
                  setEffort((value as ModelEffort) || null)}
                options={[
                  {
                    label: t("settings.providerDefaultEffort"),
                    value: "",
                  },
                  ...providerEfforts.map((candidate) => ({
                    label: candidate,
                    value: candidate,
                  })),
                ]}
                size="small"
                value={effort ?? ""}
              />
              <label htmlFor="project-approval-policy">{t("settings.approvalRequest")}</label>
              <SelectMenu
                disabled={settingsLoading || settingsSaving}
                id="project-approval-policy"
                label={t("settings.approvalRequest")}
                onValueChange={(value) =>
                  setApprovalPolicy(value as ApprovalPolicy)}
                options={[
                  {
                    description: t("settings.approvalUntrustedDescription"),
                    label: t("settings.approvalUntrusted"),
                    value: "untrusted",
                  },
                  {
                    description: t("settings.approvalOnRequestDescription"),
                    label: t("settings.approvalOnRequest"),
                    value: "on-request",
                  },
                  {
                    description: t("settings.approvalNeverDescription"),
                    label: t("settings.approvalNever"),
                    value: "never",
                  },
                ]}
                size="small"
                value={approvalPolicy}
              />
              <button
                disabled={
                  settingsLoading ||
                  settingsSaving ||
                  !providerAvailability[provider] ||
                  !llmSettingsChanged
                }
                onClick={() => void saveLlmSettings()}
                type="button"
              >
                {settingsSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : !llmSettingsChanged ? (
                  <Check size={14} />
                ) : null}
                {settingsSaving
                  ? t("common.saving")
                  : !llmSettingsChanged
                    ? t("common.saved")
                    : t("common.save")}
              </button>
            </div>
            <p>
              {t(
                approvalPolicy === "untrusted"
                  ? "settings.approvalUntrustedDescription"
                  : approvalPolicy === "on-request"
                    ? "settings.approvalOnRequestDescription"
                    : "settings.approvalNeverDescription",
              ).replace("Codex", providerName)}
            </p>
            {settingsError && <p className="project-settings-llm-error">{settingsError}</p>}
          </section>

          <section className="project-settings-danger">
            <div>
              <span className="danger-icon"><AlertTriangle size={18} strokeWidth={1.8} /></span>
              <span>
                <strong>{t("settings.danger")}</strong>
                <small>{t("settings.dangerDescription")}</small>
              </span>
            </div>
            <button onClick={() => setIsConfirming(true)} type="button">
              <Trash2 size={15} strokeWidth={1.8} />
              {t("settings.deleteProject")}
            </button>
          </section>
        </div>
      </div>

      {isConfirming && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-describedby="delete-project-description"
            aria-labelledby="delete-project-title"
            aria-modal="true"
            className="delete-project-dialog"
            role="dialog"
          >
            <span className="delete-project-dialog-icon"><Trash2 size={20} strokeWidth={1.8} /></span>
            <h2 id="delete-project-title">{t("settings.deleteTitle", { name: project.name })}</h2>
            <p id="delete-project-description">
              {t("settings.deleteDescription")}
            </p>
            {deleteError && <p className="delete-project-error">{deleteError}</p>}
            <footer>
              <button
                disabled={isDeleting}
                onClick={() => setIsConfirming(false)}
                ref={cancelButtonRef}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button
                className="delete-project-confirm"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {isDeleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                {t("settings.delete")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
