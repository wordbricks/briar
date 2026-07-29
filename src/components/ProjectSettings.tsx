import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  Cpu,
  Database,
  Download,
  GitBranch,
  Link2,
  LoaderCircle,
  Plug,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  SettingsBackButton,
  SettingsMain,
  SettingsNav,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPageHeader,
  SettingsScroll,
  SettingsShell,
  SettingsSidebar,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";
import type { DashboardPayload, Project, ProjectSettings as ProjectSettingsData } from "../types";
import { useI18n } from "../i18n";
import {
  agentEfforts,
  agentModels,
  agentProviders,
  defaultAppProviderSettings,
  defaultProjectLlmSettings,
  defaultProjectSandboxSettings,
  loadAppProviderSettings,
  loadProjectLlmSettings,
  loadProjectSandboxSettings,
  updateProjectLlmSettings,
  updateProjectSandboxSettings,
  type AgentProvider,
  type AppProviderSettings,
  type ApprovalPolicy,
  type ModelEffort,
} from "../lib/project-llm";
import type { VelenInspection } from "../lib/project-connection";
import type {
  LinearImportConnectResult,
  LinearImportResult,
  LinearImportStatesResult,
} from "../lib/linear-import";
import { LinearIssueImport } from "./LinearIssueImport";
import { SelectMenu } from "./SelectMenu";

const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
};

type ProjectSettingsSection =
  | "general"
  | "integrations"
  | "issue-import"
  | "agent-configuration"
  | "workflow";

export function ProjectSettings({
  dashboard,
  githubRepository,
  isDeleting,
  isSidebarOpen,
  onBack,
  onDelete,
  onRegenerateWorkflow,
  onReviseWorkflow,
  onUpdateVelenOrg,
  onUpdateLinear,
  onConnectLinearImport,
  onLoadLinearImportStates,
  onImportLinearIssues,
  onRefreshVelen,
  project,
  repositoryConnected,
  sessionToken = null,
  userId = null,
  velen,
}: {
  dashboard: DashboardPayload | null;
  githubRepository: string | null;
  isDeleting: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onDelete: () => Promise<unknown>;
  onRegenerateWorkflow: () => Promise<unknown>;
  onReviseWorkflow: (requestedChange: string) => Promise<unknown>;
  onUpdateVelenOrg: (org: string | null) => Promise<string | null>;
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
  sessionToken?: string | null;
  userId?: string | null;
  velen: VelenInspection | null;
}) {
  const { localeTag, t } = useI18n();
  const [activeSection, setActiveSection] =
    useState<ProjectSettingsSection>("general");
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [workflowCopied, setWorkflowCopied] = useState(false);
  const [isRegeneratingWorkflow, setIsRegeneratingWorkflow] = useState(false);
  const [isRevisingWorkflow, setIsRevisingWorkflow] = useState(false);
  const [workflowRevisionRequest, setWorkflowRevisionRequest] = useState("");
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowRegenerated, setWorkflowRegenerated] = useState(false);
  const [workflowRevised, setWorkflowRevised] = useState(false);
  const [runtimeProvider, setRuntimeProvider] = useState<AgentProvider>(
    defaultProjectLlmSettings.provider,
  );
  const [runtimeModel, setRuntimeModel] = useState<string | null>(
    defaultProjectLlmSettings.model,
  );
  const [runtimeEffort, setRuntimeEffort] = useState<ModelEffort | null>(
    defaultProjectLlmSettings.effort,
  );
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    defaultProjectLlmSettings.approvalPolicy,
  );
  const [savedRuntime, setSavedRuntime] = useState(defaultProjectLlmSettings);
  const [providerAvailability, setProviderAvailability] =
    useState<AppProviderSettings>(defaultAppProviderSettings);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(defaultProjectSandboxSettings);
  const [sandboxLoading, setSandboxLoading] = useState(true);
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [workerSharingSaving, setWorkerSharingSaving] = useState(false);
  const [workerSharingError, setWorkerSharingError] = useState<string | null>(null);
  const [workerSharingOverride, setWorkerSharingOverride] = useState<boolean | null>(
    null,
  );
  const ownedWorker = dashboard?.workers?.find(
    (worker) => worker.ownerUserId === userId,
  );
  const workerSharingEnabled =
    workerSharingOverride ??
    Boolean(ownedWorker && ownedWorker.readiness !== "disabled");
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
  const [velenOrg, setVelenOrg] = useState(
    () => dashboard?.settings.velenOrg ?? "",
  );
  const [velenLoading, setVelenLoading] = useState(false);
  const [velenSaving, setVelenSaving] = useState(false);
  const [velenError, setVelenError] = useState<string | null>(null);
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
  const runtimeChanged =
    runtimeProvider !== savedRuntime.provider ||
    runtimeModel !== savedRuntime.model ||
    runtimeEffort !== savedRuntime.effort ||
    approvalPolicy !== savedRuntime.approvalPolicy;
  const runtimeModels = agentModels[runtimeProvider];
  const runtimeEfforts = agentEfforts[runtimeProvider];
  const selectedRuntimeModelKnown = runtimeModels.some(
    (option) => option.value === (runtimeModel ?? ""),
  );

  useEffect(() => {
    let cancelled = false;
    setRuntimeLoading(true);
    setRuntimeError(null);
    void Promise.all([
      loadProjectLlmSettings(project.id),
      loadAppProviderSettings(),
    ])
      .then(([settings, availability]) => {
        if (cancelled) return;
        setRuntimeProvider(settings.provider);
        setRuntimeModel(settings.model);
        setRuntimeEffort(settings.effort);
        setApprovalPolicy(settings.approvalPolicy);
        setSavedRuntime(settings);
        setProviderAvailability(availability);
      })
      .catch((caught) => {
        if (!cancelled) {
          setRuntimeError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setSandboxLoading(true);
    setSandboxError(null);
    void loadProjectSandboxSettings(project.id)
      .then((settings) => {
        if (!cancelled) setSandbox(settings);
      })
      .catch((caught) => {
        if (!cancelled) {
          setSandboxError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSandboxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const saveSandbox = async (fullAccess: boolean) => {
    if (sandboxSaving) return;
    setSandboxSaving(true);
    setSandboxError(null);
    try {
      const saved = await updateProjectSandboxSettings(project.id, {
        fullAccess,
      });
      setSandbox(saved);
    } catch (caught) {
      setSandboxError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setSandboxSaving(false);
    }
  };

  const saveRuntime = async () => {
    if (runtimeSaving) return;
    setRuntimeSaving(true);
    setRuntimeError(null);
    try {
      const saved = await updateProjectLlmSettings(project.id, {
        provider: runtimeProvider,
        model: runtimeModel,
        effort: runtimeEffort,
        approvalPolicy,
      });
      setRuntimeProvider(saved.provider);
      setRuntimeModel(saved.model);
      setRuntimeEffort(saved.effort);
      setApprovalPolicy(saved.approvalPolicy);
      setSavedRuntime(saved);
    } catch (caught) {
      setRuntimeError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setRuntimeSaving(false);
    }
  };

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
    setVelenOrg(dashboard?.settings.velenOrg ?? "");
    setVelenError(null);
  }, [dashboard?.settings.velenOrg, project.id]);

  useEffect(() => {
    const org = dashboard?.settings.velenOrg;
    if (!org) return;
    let cancelled = false;
    setVelenLoading(true);
    setVelenError(null);
    void onRefreshVelen(org)
      .then((inspection) => {
        if (!cancelled && !inspection) {
          setVelenError(t("settings.velenLoadFailed"));
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setVelenError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setVelenLoading(false);
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

  const regenerateWorkflow = async () => {
    setIsRegeneratingWorkflow(true);
    setWorkflowError(null);
    setWorkflowRegenerated(false);
    setWorkflowRevised(false);
    try {
      await onRegenerateWorkflow();
      setWorkflowRegenerated(true);
    } catch (caught) {
      setWorkflowError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRegeneratingWorkflow(false);
    }
  };

  const reviseWorkflow = async () => {
    const requestedChange = workflowRevisionRequest.trim();
    if (!requestedChange) return;
    setIsRevisingWorkflow(true);
    setWorkflowError(null);
    setWorkflowRegenerated(false);
    setWorkflowRevised(false);
    try {
      await onReviseWorkflow(requestedChange);
      setWorkflowRevisionRequest("");
      setWorkflowRevised(true);
    } catch (caught) {
      setWorkflowError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRevisingWorkflow(false);
    }
  };

  const linearSources = (velen?.sources ?? []).filter(
    (source) => source.provider === "linear" && source.status === "active",
  );
  const selectedLinearSourceAvailable = linearSources.some(
    (source) => source.sourceRef === linear.source,
  );
  const linearChanged = JSON.stringify(linear) !== JSON.stringify(savedLinear);
  const savedVelenOrg = dashboard?.settings.velenOrg ?? "";
  const velenChanged = velenOrg !== savedVelenOrg;
  const refreshVelen = async () => {
    setVelenLoading(true);
    setVelenError(null);
    try {
      const inspection = await onRefreshVelen(velenOrg || null);
      if (!inspection) {
        setVelenError(t("settings.velenLoadFailed"));
        return;
      }
      if (!velenOrg) {
        setVelenOrg(
          inspection.currentOrg ?? inspection.organizations[0]?.slug ?? "",
        );
      }
    } catch (caught) {
      setVelenError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVelenLoading(false);
    }
  };
  const saveVelen = async () => {
    setVelenSaving(true);
    setVelenError(null);
    try {
      const saved = await onUpdateVelenOrg(velenOrg || null);
      setVelenOrg(saved ?? "");
    } catch (caught) {
      setVelenError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVelenSaving(false);
    }
  };
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
  const updateWorkerSharing = async (enabled: boolean) => {
    if (!sessionToken) {
      setWorkerSharingError(t("worker.loginRequired"));
      return;
    }
    if (enabled && !repositoryConnected) {
      setWorkerSharingError(t("worker.repositoryRequired"));
      return;
    }
    setWorkerSharingSaving(true);
    setWorkerSharingError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("configure_execution_worker", {
        projectId: project.id,
        userToken: sessionToken,
        enabled,
      });
      setWorkerSharingOverride(enabled);
    } catch (caught) {
      setWorkerSharingError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setWorkerSharingSaving(false);
    }
  };
  const navigationItems = [
    {
      id: "general" as const,
      icon: <SlidersHorizontal size={16} strokeWidth={1.75} />,
      label: t("settings.navGeneral"),
      description: t("settings.navGeneralDescription"),
    },
    {
      id: "integrations" as const,
      icon: <Plug size={16} strokeWidth={1.75} />,
      label: t("settings.navIntegrations"),
      description: t("settings.navIntegrationsDescription"),
    },
    {
      id: "issue-import" as const,
      icon: <Download size={16} strokeWidth={1.75} />,
      label: t("settings.navIssueImport"),
      description: t("settings.navIssueImportDescription"),
    },
    {
      id: "agent-configuration" as const,
      icon: <ShieldCheck size={16} strokeWidth={1.75} />,
      label: t("settings.navAgent"),
      description: t("settings.navAgentDescription"),
    },
    {
      id: "workflow" as const,
      icon: <GitBranch size={16} strokeWidth={1.75} />,
      label: t("settings.navWorkflow"),
      description: t("settings.navWorkflowDescription"),
    },
  ];
  const activeItem = navigationItems.find((item) => item.id === activeSection);

  return (
    <SettingsShell className="project-settings-page">
      <SettingsSidebar
        className="project-settings-sidebar"
        isOpen={isSidebarOpen}
        label={t("settings.navigation")}
      >
        <SettingsBackButton onClick={onBack}>
          {t("settings.back")}
        </SettingsBackButton>

        <SettingsNav className="project-settings-nav">
          <SettingsNavGroup label={t("settings.title")}>
            {navigationItems.map((item) => (
              <SettingsNavItem
                active={activeSection === item.id}
                data-project-settings-section={item.id}
                icon={item.icon}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
              >
                {item.label}
              </SettingsNavItem>
            ))}
          </SettingsNavGroup>
        </SettingsNav>
      </SettingsSidebar>

      <SettingsMain
        className="project-settings-main"
        isSidebarOpen={isSidebarOpen}
      >
        <SettingsScroll className="project-settings-scroll">
          <SettingsPageHeader
            description={
              activeItem?.description ??
              t("settings.description", { name: project.name })
            }
            title={activeItem?.label ?? t("settings.title")}
          />

          {activeSection === "general" ? (
            <section className="project-settings-card mx-auto flex min-h-[84px] w-full max-w-[720px] items-center justify-between rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
              <div className="grid gap-1">
                <Typography tone="muted" variant="caption">
                  {t("settings.projectName")}
                </Typography>
                <Typography as="strong" variant="body">
                  {project.name}
                </Typography>
              </div>
              <Typography as="small" tone="muted" variant="caption">
                {t("settings.created", {
                  date: new Date(project.createdAt).toLocaleDateString(localeTag),
                })}
              </Typography>
            </section>
          ) : null}


          <section
            className="project-settings-linear"
            data-project-integration="velen"
            hidden={activeSection !== "integrations"}
          >
            <header>
              <span className="project-settings-linear-icon">
                <Database size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("settings.velenTitle")}</strong>
                <small>{t("settings.velenDescription")}</small>
              </span>
              <div className="project-settings-linear-actions">
                <button
                  aria-label={t("settings.velenRefresh")}
                  disabled={velenLoading || velenSaving}
                  onClick={() => void refreshVelen()}
                  type="button"
                >
                  <RefreshCw className={velenLoading ? "spin" : undefined} size={14} />
                </button>
              </div>
            </header>

            <div className="project-settings-linear-fields">
              <label>
                <span>{t("settings.velenOrg")}</span>
                <SelectMenu
                  disabled={velenLoading || velenSaving}
                  label={t("settings.velenOrg")}
                  onValueChange={setVelenOrg}
                  options={[
                    { label: t("settings.velenDisconnected"), value: "" },
                    ...(velenOrg &&
                    !(velen?.organizations ?? []).some(
                      (organization) => organization.slug === velenOrg,
                    )
                      ? [{
                          disabled: true,
                          label: `${velenOrg} · ${t("settings.velenUnavailable")}`,
                          value: velenOrg,
                        }]
                      : []),
                    ...(velen?.organizations ?? []).map((organization) => ({
                      label: organization.name,
                      value: organization.slug,
                    })),
                  ]}
                  size="small"
                  value={velenOrg}
                />
              </label>
            </div>

            {velenError ? (
              <p className="project-settings-linear-error" role="alert">
                <AlertTriangle size={13} /> {velenError}
              </p>
            ) : null}

            <footer>
              <p>
                {!velenOrg && linear.enabled
                  ? t("settings.velenDisconnectLinearFirst")
                  : t("settings.velenOptional")}
              </p>
              <button
                disabled={
                  velenLoading ||
                  velenSaving ||
                  !velenChanged ||
                  (!velenOrg && linear.enabled)
                }
                onClick={() => void saveVelen()}
                type="button"
              >
                {velenSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : !velenChanged ? (
                  <Check size={14} />
                ) : null}
                {velenSaving
                  ? t("common.saving")
                  : !velenChanged
                    ? t("common.saved")
                    : t("common.save")}
              </button>
            </footer>
          </section>

          <section
            className="project-settings-linear"
            data-project-integration="linear"
            hidden={activeSection !== "issue-import"}
          >
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
                <label className="project-settings-toggle flex items-center gap-2">
                  <Switch
                    checked={linear.enabled}
                    disabled={
                      linearLoading ||
                      linearSaving ||
                      !dashboard?.settings.velenOrg
                    }
                    onCheckedChange={(enabled) => {
                      setLinear((current) => {
                        const source = current.source ?? linearSources[0]?.sourceRef ?? null;
                        return { ...current, enabled, source };
                      });
                    }}
                  />
                  <span className="text-xs font-medium text-muted-foreground">
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
                  <Input
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

          <div
            className="project-settings-import-panel"
            hidden={activeSection !== "issue-import"}
          >
            <LinearIssueImport
              onConnect={onConnectLinearImport}
              onImport={onImportLinearIssues}
              onLoadStates={onLoadLinearImportStates}
              projectId={project.id}
              repositoryConnected={repositoryConnected}
              workflow={workflow}
            />
          </div>

          <section
            className="project-settings-agent-configuration"
            hidden={activeSection !== "agent-configuration"}
          >
            <section
              aria-busy={runtimeLoading || runtimeSaving}
              className="project-settings-runtime"
            >
              <header>
                <span className="project-settings-runtime-icon">
                  <Bot size={18} strokeWidth={1.8} />
                </span>
                <span>
                  <strong>{t("settings.runtimeTitle")}</strong>
                  <small>{t("settings.runtimeDescription")}</small>
                </span>
              </header>

              <div className="project-settings-runtime-controls">
                <label htmlFor="project-runtime-provider">
                  {t("settings.provider")}
                </label>
                <SelectMenu
                  disabled={runtimeLoading || runtimeSaving}
                  id="project-runtime-provider"
                  label={t("settings.provider")}
                  onValueChange={(value) => {
                    setRuntimeProvider(value as AgentProvider);
                    setRuntimeModel(null);
                    setRuntimeEffort(null);
                  }}
                  options={agentProviders.map((candidate) => ({
                    description: !providerAvailability[candidate]
                      ? t("settings.providerDisabled")
                      : undefined,
                    disabled: !providerAvailability[candidate],
                    label: providerLabels[candidate],
                    value: candidate,
                  }))}
                  size="small"
                  value={runtimeProvider}
                />

                <label htmlFor="project-runtime-model">
                  {t("settings.model")}
                </label>
                <SelectMenu
                  disabled={runtimeLoading || runtimeSaving}
                  id="project-runtime-model"
                  label={t("settings.model")}
                  onValueChange={(value) => setRuntimeModel(value || null)}
                  options={[
                    ...(!selectedRuntimeModelKnown && runtimeModel
                      ? [{ label: runtimeModel, value: runtimeModel }]
                      : []),
                    ...runtimeModels.map((option) => ({
                      label: option.value
                        ? option.label
                        : t("settings.providerDefaultModel"),
                      value: option.value,
                    })),
                  ]}
                  size="small"
                  value={runtimeModel ?? ""}
                />

                <label htmlFor="project-runtime-effort">
                  {t("settings.effort")}
                </label>
                <SelectMenu
                  disabled={runtimeLoading || runtimeSaving}
                  id="project-runtime-effort"
                  label={t("settings.effort")}
                  onValueChange={(value) =>
                    setRuntimeEffort((value as ModelEffort) || null)
                  }
                  options={[
                    {
                      label: t("settings.providerDefaultEffort"),
                      value: "",
                    },
                    ...runtimeEfforts.map((candidate) => ({
                      label: candidate,
                      value: candidate,
                    })),
                  ]}
                  size="small"
                  value={runtimeEffort ?? ""}
                />

                <label htmlFor="project-runtime-approval">
                  {t("settings.approvalRequest")}
                </label>
                <SelectMenu
                  disabled={runtimeLoading || runtimeSaving}
                  id="project-runtime-approval"
                  label={t("settings.approvalRequest")}
                  onValueChange={(value) =>
                    setApprovalPolicy(value as ApprovalPolicy)
                  }
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
              </div>

              <p className="project-settings-runtime-note">
                {t(
                  approvalPolicy === "untrusted"
                    ? "settings.approvalUntrustedDescription"
                    : approvalPolicy === "on-request"
                      ? "settings.approvalOnRequestDescription"
                      : "settings.approvalNeverDescription",
                ).replace("Codex", providerLabels[runtimeProvider])}
              </p>
              {runtimeError ? (
                <p className="project-settings-runtime-error" role="alert">
                  <CircleAlert size={14} />
                  {runtimeError}
                </p>
              ) : null}
              <footer>
                <button
                  disabled={
                    runtimeLoading ||
                    runtimeSaving ||
                    !providerAvailability[runtimeProvider] ||
                    !runtimeChanged
                  }
                  onClick={() => void saveRuntime()}
                  type="button"
                >
                  {runtimeSaving ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : !runtimeChanged ? (
                    <Check size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {runtimeSaving
                    ? t("common.saving")
                    : !runtimeChanged
                      ? t("common.saved")
                      : t("settings.saveRuntime")}
                </button>
              </footer>
            </section>

            <div className="project-settings-worker-sharing">
              <span className="project-settings-sandbox-icon">
                <Cpu size={17} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("worker.shareThisComputer")}</strong>
                <small>
                  {ownedWorker?.readinessDetail ??
                    t(
                      workerSharingEnabled
                        ? "worker.sharingDescriptionOn"
                        : "worker.sharingDescriptionOff",
                    )}
                </small>
              </span>
              <label className="project-settings-toggle flex items-center gap-2">
                <Switch
                  aria-label={t("worker.shareThisComputer")}
                  checked={workerSharingEnabled}
                  disabled={workerSharingSaving}
                  onCheckedChange={(enabled) => {
                    void updateWorkerSharing(enabled);
                  }}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {workerSharingSaving
                    ? t("common.saving")
                    : workerSharingEnabled
                      ? t("worker.sharingOn")
                      : t("worker.sharingOff")}
                </span>
              </label>
            </div>
            {workerSharingError ? (
              <p className="project-settings-sandbox-error" role="alert">
                {workerSharingError}
              </p>
            ) : null}

            <div
              className={`project-settings-sandbox${
                sandbox.fullAccess ? " unrestricted" : ""
              }`}
            >
              <span className="project-settings-sandbox-icon">
                {sandbox.fullAccess ? (
                  <AlertTriangle size={17} strokeWidth={1.8} />
                ) : (
                  <ShieldCheck size={17} strokeWidth={1.8} />
                )}
              </span>
              <span>
                <strong>{t("settings.sandboxTitle")}</strong>
                <small>
                  {t(
                    sandbox.fullAccess
                      ? "settings.sandboxUnrestrictedDescription"
                      : "settings.sandboxWorkspaceDescription",
                  )}
                </small>
              </span>
              <label className="project-settings-toggle flex items-center gap-2">
                <Switch
                  aria-label={t("settings.sandboxTitle")}
                  checked={sandbox.fullAccess}
                  disabled={sandboxLoading || sandboxSaving}
                  onCheckedChange={(fullAccess) => {
                    void saveSandbox(fullAccess);
                  }}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {t(
                    sandbox.fullAccess
                      ? "settings.sandboxUnrestricted"
                      : "settings.sandboxWorkspace",
                  )}
                </span>
              </label>
            </div>
            {sandboxError ? (
              <p className="project-settings-sandbox-error" role="alert">
                {sandboxError}
              </p>
            ) : null}
          </section>

          <section
            className="project-settings-automation"
            hidden={activeSection !== "workflow"}
          >
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
                  disabled={
                    isRegeneratingWorkflow ||
                    isRevisingWorkflow ||
                    !workflowContract
                  }
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
              {t("settings.workflowAgentDescription")}
            </p>
            <form
              className="project-settings-workflow-revision"
              onSubmit={(event) => {
                event.preventDefault();
                void reviseWorkflow();
              }}
            >
              <label htmlFor={`workflow-revision-${project.id}`}>
                {t("settings.workflowRevisionLabel")}
              </label>
              <Textarea
                aria-label={t("settings.workflowRevisionLabel")}
                disabled={
                  isRegeneratingWorkflow ||
                  isRevisingWorkflow ||
                  !workflowContract
                }
                id={`workflow-revision-${project.id}`}
                maxLength={4_000}
                onChange={(event) =>
                  setWorkflowRevisionRequest(event.currentTarget.value)
                }
                placeholder={t("settings.workflowRevisionPlaceholder")}
                rows={3}
                value={workflowRevisionRequest}
              />
              <footer>
                <small>{t("settings.workflowRevisionDescription")}</small>
                <button
                  disabled={
                    isRegeneratingWorkflow ||
                    isRevisingWorkflow ||
                    !workflowContract ||
                    !workflowRevisionRequest.trim()
                  }
                  type="submit"
                >
                  {isRevisingWorkflow ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {isRevisingWorkflow
                    ? t("settings.workflowRevising")
                    : t("settings.workflowRevise")}
                </button>
              </footer>
            </form>
            <div aria-live="polite">
              {workflowRegenerated ? (
                <p className="project-settings-workflow-success">
                  <Check size={13} />{t("settings.workflowRegenerated")}
                </p>
              ) : null}
              {workflowRevised ? (
                <p className="project-settings-workflow-success">
                  <Check size={13} />{t("settings.workflowRevised")}
                </p>
              ) : null}
              {workflowError ? (
                <p className="project-settings-workflow-error">{workflowError}</p>
              ) : null}
            </div>
            {workflowContract ? (
              <div
                aria-label={t("settings.workflowDiagram")}
                className="project-workflow-contract"
                role="group"
              >
                <div className="project-workflow-repository">
                  <span>{t("settings.repository")}</span>
                  <strong>{githubRepository ?? t("settings.noRepository")}</strong>
                  <span className="project-workflow-version">
                    v{workflowContract.version}
                  </span>
                </div>
                <div className="project-workflow-diagram">
                  <ol className="project-workflow-stages">
                    {workflowContract.stages.map((stage, index) => (
                      <li key={`${stage.id}-${index}`}>
                        <article
                          className={`project-workflow-stage ${
                            stage.required ? "required" : "optional"
                          }`}
                        >
                          <header>
                            <span>{index + 1}</span>
                            <em>
                              {t(
                                stage.required
                                  ? "common.required"
                                  : "common.optional",
                              )}
                            </em>
                          </header>
                          <strong>{stage.label}</strong>
                          <code>{stage.id}</code>
                          {stage.evidence?.length ? (
                            <div className="project-workflow-stage-detail">
                              <span>{t("settings.workflowEvidence")}</span>
                              <ul>
                                {stage.evidence.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {stage.checks?.length ? (
                            <div className="project-workflow-stage-detail">
                              <span>{t("settings.workflowChecks")}</span>
                              <ul className="project-workflow-checks">
                                {stage.checks.map((check) => (
                                  <li key={check}>{check}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                        {index < workflowContract.stages.length - 1 ? (
                          <span
                            aria-hidden="true"
                            className="project-workflow-connector"
                          >
                            <ArrowRight size={17} strokeWidth={1.8} />
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <footer className="project-workflow-summary">
                    <div>
                      <CheckCircle2 size={18} strokeWidth={1.8} />
                      <span>
                        <small>{t("settings.workflowCompletion")}</small>
                        <strong>
                          {t("settings.workflowRequiredStageCount", {
                            count: workflowContract.completion.requiredStages.length,
                          })}
                        </strong>
                      </span>
                    </div>
                    <div
                      className={
                        workflowContract.release.enabled
                          ? "project-workflow-release enabled"
                          : "project-workflow-release"
                      }
                    >
                      <Rocket size={18} strokeWidth={1.8} />
                      <span>
                        <small>{t("settings.workflowRelease")}</small>
                        <strong>
                          {t(
                            workflowContract.release.enabled
                              ? "settings.workflowReleaseEnabled"
                              : "settings.workflowReleaseDisabled",
                          )}
                        </strong>
                      </span>
                    </div>
                  </footer>
                </div>
              </div>
            ) : (
              <p className="project-settings-empty">{t("settings.loadingWorkflow")}</p>
            )}
          </section>

          <section
            className="project-settings-danger mx-auto mt-4 flex w-full max-w-[720px] items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4"
            hidden={activeSection !== "general"}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="danger-icon grid size-9 place-items-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle size={18} strokeWidth={1.8} />
              </span>
              <span className="grid min-w-0 gap-1">
                <Typography as="strong" variant="body">
                  {t("settings.danger")}
                </Typography>
                <Typography as="small" tone="muted" variant="caption">
                  {t("settings.dangerDescription")}
                </Typography>
              </span>
            </div>
            <Button
              onClick={() => setIsConfirming(true)}
              type="button"
              variant="destructive"
            >
              <Trash2 size={15} strokeWidth={1.8} />
              {t("settings.deleteProject")}
            </Button>
          </section>
        </SettingsScroll>
      </SettingsMain>

      <Dialog
        onOpenChange={(open) => {
          if (!isDeleting) setIsConfirming(open);
        }}
        open={isConfirming}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle id="delete-project-title">
              {t("settings.deleteTitle", { name: project.name })}
            </DialogTitle>
            <DialogDescription id="delete-project-description">
              {t("settings.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-xs text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isDeleting}
              onClick={() => setIsConfirming(false)}
              ref={cancelButtonRef}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="delete-project-confirm"
              disabled={isDeleting}
              onClick={() => void confirmDelete()}
              type="button"
              variant="destructive"
            >
              {isDeleting ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
              {t("settings.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
