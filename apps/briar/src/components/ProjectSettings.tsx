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
  Flag,
  FolderGit2,
  GitBranch,
  GitMerge,
  ImagePlus,
  LayoutList,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  StatusPanel,
  StatusPanelAction,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelIcon,
  StatusPanelTitle,
} from "@/components/ui/status-panel";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";
import type {
  DashboardPayload,
  MergeQueueProfile,
  Project,
  ProjectSettings as ProjectSettingsData,
} from "../types";
import { useI18n } from "../i18n";
import {
  agentEffortOptions,
  agentModelOptions,
  agentProviderLabels,
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
import { useAgentProviderModels } from "../hooks/useAgentProviderModels";
import type { AutoHuntHealth, VelenInspection } from "../lib/project-connection";
import type {
  LinearImportConnectResult,
  LinearImportResult,
  LinearImportStatesResult,
} from "../lib/linear-import";
import { requiredWorkflowStages } from "../lib/auto-hunt-contract";
import {
  defaultIssueKeyPrefix,
  isIssueKeyPrefix,
  normalizeIssueKeyPrefix,
} from "../lib/issue-key";
import {
  projectIconAccept,
  projectIconFromFile,
} from "../lib/project-icon";
import { isProjectScheduleTabEnabled } from "../lib/project-tabs";
import { LinearIssueImport } from "./LinearIssueImport";
import { ProjectExecutionSettings } from "./ProjectExecutionSettings";
import { ProjectMergeQueueSettings } from "./ProjectMergeQueueSettings";
import { ProjectTabsSettings } from "./ProjectTabsSettings";
import { ProviderSelect } from "./ProviderSelect";
import { SelectMenu } from "./SelectMenu";
import type { ProjectSettingsSection } from "../lib/app-navigation";

export type { ProjectSettingsSection } from "../lib/app-navigation";

export function ProjectSettings({
  dashboard,
  githubRepository,
  health,
  isDeleting,
  isSidebarOpen,
  initialSection,
  navigationSidebar,
  onBack,
  onAnalyzeWorkflowRequirements,
  onDelete,
  onRegenerateWorkflow,
  onReviseWorkflow,
  onSaveCheckpointPolicy,
  onUpdateVelenOrg,
  onConnectLinearImport,
  onLoadLinearImportStates,
  onImportLinearIssues,
  onIconChange,
  onIssueKeyPrefixChange,
  onScheduleTabChange,
  onRefreshVelen,
  onRefreshHealth,
  project,
  repositoryConnected,
  sessionToken = null,
  velen,
}: {
  dashboard: DashboardPayload | null;
  githubRepository: string | null;
  health?: AutoHuntHealth | null;
  isDeleting: boolean;
  isSidebarOpen: boolean;
  initialSection?: ProjectSettingsSection;
  navigationSidebar?: ReactNode;
  onBack: () => void;
  onAnalyzeWorkflowRequirements: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onRegenerateWorkflow: () => Promise<unknown>;
  onReviseWorkflow: (requestedChange: string) => Promise<unknown>;
  onSaveCheckpointPolicy?: (
    scope: "project" | "user",
    checkpoints: NonNullable<
      ProjectSettingsData["checkpointPolicy"]
    >["projectMandatory"],
    expectedRevision: number,
  ) => Promise<unknown>;
  onUpdateVelenOrg: (org: string | null) => Promise<string | null>;
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
  onIconChange: (projectId: string, icon: string | null) => Promise<unknown>;
  onIssueKeyPrefixChange: (
    projectId: string,
    issueKeyPrefix: string,
  ) => Promise<unknown>;
  onScheduleTabChange: (
    projectId: string,
    scheduleTabEnabled: boolean,
  ) => Promise<unknown>;
  onRefreshVelen: (org?: string | null) => Promise<VelenInspection | null>;
  onRefreshHealth?: () => Promise<AutoHuntHealth | null>;
  project: Project;
  repositoryConnected: boolean;
  sessionToken?: string | null;
  velen: VelenInspection | null;
}) {
  const { localeTag, t } = useI18n();
  const providerModels = useAgentProviderModels();
  const [activeSection, setActiveSection] =
    useState<ProjectSettingsSection>(initialSection ?? "general");
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [workflowCopied, setWorkflowCopied] = useState(false);
  const [isAnalyzingWorkflowRequirements, setIsAnalyzingWorkflowRequirements] =
    useState(false);
  const [isRegeneratingWorkflow, setIsRegeneratingWorkflow] = useState(false);
  const [isRevisingWorkflow, setIsRevisingWorkflow] = useState(false);
  const [isUpdatingWorkflowPause, setIsUpdatingWorkflowPause] =
    useState(false);
  const [workflowRevisionRequest, setWorkflowRevisionRequest] = useState("");
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowRegenerated, setWorkflowRegenerated] = useState(false);
  const [workflowRequirementsAnalyzed, setWorkflowRequirementsAnalyzed] =
    useState(false);
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
  const [isIconSaving, setIsIconSaving] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [iconSaved, setIconSaved] = useState(false);
  const [issueKeyPrefix, setIssueKeyPrefix] = useState(
    project.issueKeyPrefix ?? defaultIssueKeyPrefix,
  );
  const [issueKeyPrefixSaving, setIssueKeyPrefixSaving] = useState(false);
  const [issueKeyPrefixError, setIssueKeyPrefixError] = useState<string | null>(null);
  const [issueKeyPrefixSaved, setIssueKeyPrefixSaved] = useState(false);
  const [scheduleTabSaving, setScheduleTabSaving] = useState(false);
  const [scheduleTabError, setScheduleTabError] = useState<string | null>(null);
  const [scheduleTabSaved, setScheduleTabSaved] = useState(false);
  const [mergeQueueProfile, setMergeQueueProfile] =
    useState<MergeQueueProfile | null>(null);
  useEffect(() => {
    if (initialSection) setActiveSection(initialSection);
  }, [initialSection]);
  useEffect(() => {
    setIssueKeyPrefix(project.issueKeyPrefix ?? defaultIssueKeyPrefix);
    setIssueKeyPrefixError(null);
    setIssueKeyPrefixSaved(false);
  }, [project.id, project.issueKeyPrefix]);
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
        requirements: workflow.requirements ?? [],
        stages: workflow.stages,
        execution: workflow.execution,
        completion: workflow.completion,
      }
    : null;
  const workflowJson = workflowContract
    ? JSON.stringify(workflowContract, null, 2)
    : "";
  const checkpointPolicy = dashboard?.settings.checkpointPolicy;
  const projectMandatory = checkpointPolicy?.projectMandatory ??
    workflowContract?.execution.checkpoints ?? [];
  const userDefaults = checkpointPolicy?.userDefaults ?? [];
  const effectiveCheckpoints = checkpointPolicy?.effective ?? projectMandatory;
  const requirementHealth = new Map(
    (health?.requirements ?? []).map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  const runtimeChanged =
    runtimeProvider !== savedRuntime.provider ||
    runtimeModel !== savedRuntime.model ||
    runtimeEffort !== savedRuntime.effort ||
    approvalPolicy !== savedRuntime.approvalPolicy;
  const runtimeModels = agentModelOptions(
    providerModels,
    runtimeProvider,
    t("settings.providerDefaultModel"),
    runtimeModel,
  );
  const runtimeEfforts = agentEffortOptions(
    providerModels,
    runtimeProvider,
    runtimeModel,
    runtimeEffort,
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
    setWorkflowRequirementsAnalyzed(false);
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

  const analyzeWorkflowRequirements = async () => {
    setIsAnalyzingWorkflowRequirements(true);
    setWorkflowError(null);
    setWorkflowRegenerated(false);
    setWorkflowRequirementsAnalyzed(false);
    setWorkflowRevised(false);
    try {
      await onAnalyzeWorkflowRequirements();
      setWorkflowRequirementsAnalyzed(true);
    } catch (caught) {
      setWorkflowError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsAnalyzingWorkflowRequirements(false);
    }
  };

  const reviseWorkflow = async () => {
    const requestedChange = workflowRevisionRequest.trim();
    if (!requestedChange) return;
    setIsRevisingWorkflow(true);
    setWorkflowError(null);
    setWorkflowRegenerated(false);
    setWorkflowRequirementsAnalyzed(false);
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

  const updateCheckpointBoundary = async (
    scope: "project" | "user",
    stage: string,
    position: "before" | "after",
    enabled: boolean,
  ) => {
    if (!onSaveCheckpointPolicy || !checkpointPolicy) return;
    const current = scope === "project" ? projectMandatory : userDefaults;
    const boundary = (checkpoint: { stage: string; position: string }) =>
      checkpoint.stage === stage && checkpoint.position === position;
    const next = enabled
      ? [
          ...current,
          {
            key: `${scope}-${position}-${stage}`,
            stage,
            position,
          },
        ]
      : current.filter((checkpoint) => !boundary(checkpoint));
    setIsUpdatingWorkflowPause(true);
    setWorkflowError(null);
    try {
      await onSaveCheckpointPolicy(
        scope,
        next,
        scope === "project"
          ? checkpointPolicy.projectRevision
          : checkpointPolicy.userRevision,
      );
    } catch (caught) {
      setWorkflowError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsUpdatingWorkflowPause(false);
    }
  };

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
  const navigationItems = [
    {
      id: "general" as const,
      icon: <SlidersHorizontal size={16} strokeWidth={1.75} />,
      label: t("settings.navGeneral"),
      description: t("settings.navGeneralDescription"),
    },
    {
      id: "tabs" as const,
      icon: <LayoutList size={16} strokeWidth={1.75} />,
      label: t("settings.navTabs"),
      description: t("settings.navTabsDescription"),
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
      id: "execution" as const,
      icon: <Cpu size={16} strokeWidth={1.75} />,
      label: t("settings.navExecution"),
      description: t("settings.navExecutionDescription"),
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
      {navigationSidebar || <SettingsSidebar
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
      </SettingsSidebar>}

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
            <section className="project-settings-card mx-auto grid w-full max-w-[720px] gap-5 rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
              <div className="flex min-h-12 items-center justify-between gap-4">
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
              </div>
              <div className="border-t border-border pt-5">
                <div className="grid gap-2">
                  <div>
                    <Typography as="strong" variant="body">
                      {t("settings.issueKeyPrefix")}
                    </Typography>
                    <Typography className="mt-1" tone="muted" variant="caption">
                      {t("settings.issueKeyPrefixDescription")}
                    </Typography>
                  </div>
                  <div className="flex max-w-sm items-center gap-2">
                    <Input
                      aria-label={t("settings.issueKeyPrefix")}
                      disabled={project.role === "member" || issueKeyPrefixSaving}
                      maxLength={3}
                      onChange={(event) => {
                        setIssueKeyPrefix(
                          normalizeIssueKeyPrefix(event.currentTarget.value),
                        );
                        setIssueKeyPrefixError(null);
                        setIssueKeyPrefixSaved(false);
                      }}
                      value={issueKeyPrefix}
                    />
                    <Button
                      disabled={
                        project.role === "member" ||
                        issueKeyPrefixSaving ||
                        !isIssueKeyPrefix(issueKeyPrefix) ||
                        issueKeyPrefix ===
                          (project.issueKeyPrefix ?? defaultIssueKeyPrefix)
                      }
                      onClick={() => {
                        setIssueKeyPrefixSaving(true);
                        setIssueKeyPrefixError(null);
                        setIssueKeyPrefixSaved(false);
                        void onIssueKeyPrefixChange(project.id, issueKeyPrefix)
                          .then(() => setIssueKeyPrefixSaved(true))
                          .catch(() =>
                            setIssueKeyPrefixError(
                              t("settings.issueKeyPrefixSaveFailed"),
                            ),
                          )
                          .finally(() => setIssueKeyPrefixSaving(false));
                      }}
                      type="button"
                      variant="outline"
                    >
                      {issueKeyPrefixSaving
                        ? t("common.saving")
                        : t("common.save")}
                    </Button>
                  </div>
                  <Typography tone="muted" variant="micro">
                    {t("settings.issueKeyPrefixHint")}
                  </Typography>
                  {issueKeyPrefixError ? (
                    <Typography className="text-destructive" role="alert" variant="caption">
                      {issueKeyPrefixError}
                    </Typography>
                  ) : issueKeyPrefixSaved ? (
                    <Typography className="text-success" role="status" variant="caption">
                      {t("settings.issueKeyPrefixSaved")}
                    </Typography>
                  ) : null}
                </div>
              </div>
              <div className="border-t border-border pt-5">
                <div className="flex items-start gap-4">
                  <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted/40">
                    {project.icon ? (
                      <img
                        alt={t("settings.iconPreview", { name: project.name })}
                        className="size-full object-contain"
                        src={project.icon}
                      />
                    ) : (
                      <FolderGit2
                        aria-hidden="true"
                        className="text-muted-foreground"
                        size={28}
                        strokeWidth={1.6}
                      />
                    )}
                  </div>
                  <div className="grid min-w-0 flex-1 gap-2">
                    <div>
                      <Typography as="strong" variant="body">
                        {t("settings.projectIcon")}
                      </Typography>
                      <Typography className="mt-1" tone="muted" variant="caption">
                        {t("settings.projectIconDescription")}
                      </Typography>
                    </div>
                    {project.role !== "member" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          className={isIconSaving ? "pointer-events-none opacity-50" : undefined}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <label>
                            <ImagePlus aria-hidden="true" size={15} strokeWidth={1.8} />
                            {t(project.icon ? "settings.replaceIcon" : "settings.uploadIcon")}
                            <input
                              accept={projectIconAccept}
                              aria-label={t("settings.uploadIcon")}
                              className="sr-only"
                              disabled={isIconSaving}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (!file) return;
                                setIsIconSaving(true);
                                setIconError(null);
                                setIconSaved(false);
                                void projectIconFromFile(file)
                                  .then((icon) => onIconChange(project.id, icon))
                                  .then(() => setIconSaved(true))
                                  .catch(() => setIconError(t("settings.iconUploadFailed")))
                                  .finally(() => setIsIconSaving(false));
                              }}
                              type="file"
                            />
                          </label>
                        </Button>
                        {project.icon ? (
                          <Button
                            disabled={isIconSaving}
                            onClick={() => {
                              setIsIconSaving(true);
                              setIconError(null);
                              setIconSaved(false);
                              void onIconChange(project.id, null)
                                .then(() => setIconSaved(true))
                                .catch(() => setIconError(t("settings.iconUploadFailed")))
                                .finally(() => setIsIconSaving(false));
                            }}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                            {t("settings.removeIcon")}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <Typography tone="muted" variant="caption">
                        {t("settings.iconPermission")}
                      </Typography>
                    )}
                    <Typography tone="muted" variant="micro">
                      {t("settings.iconHint")}
                    </Typography>
                    {iconError ? (
                      <Typography className="text-destructive" role="alert" variant="caption">
                        {iconError}
                      </Typography>
                    ) : iconSaved ? (
                      <Typography className="text-success" role="status" variant="caption">
                        {t("settings.iconSaved")}
                      </Typography>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activeSection === "tabs" ? (
            <ProjectTabsSettings
              canEdit={project.role !== "member"}
              error={scheduleTabError}
              onScheduleChange={(enabled) => {
                if (scheduleTabSaving) return;
                setScheduleTabSaving(true);
                setScheduleTabError(null);
                setScheduleTabSaved(false);
                void onScheduleTabChange(project.id, enabled)
                  .then(() => setScheduleTabSaved(true))
                  .catch(() =>
                    setScheduleTabError(t("settings.tabsSaveFailed")),
                  )
                  .finally(() => setScheduleTabSaving(false));
              }}
              saved={scheduleTabSaved}
              saving={scheduleTabSaving}
              scheduleEnabled={isProjectScheduleTabEnabled(project)}
            />
          ) : null}

          <section
            className="project-settings-integration"
            data-project-integration="velen"
            hidden={activeSection !== "integrations"}
          >
            <header>
              <span className="project-settings-integration-icon">
                <Database size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("settings.velenTitle")}</strong>
                <small>{t("settings.velenDescription")}</small>
              </span>
              <div className="project-settings-integration-actions">
                <button
                  aria-label={t("settings.velenRefresh")}
                  disabled={velenLoading || velenSaving}
                  onClick={() => void refreshVelen()}
                  type="button"
                >
                  <Spinner icon={RefreshCw} size={14} spinning={velenLoading} />
                </button>
              </div>
            </header>

            <div className="project-settings-integration-fields">
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
              <p className="project-settings-velen-error" role="alert">
                <AlertTriangle size={13} /> {velenError}
              </p>
            ) : null}

            <footer>
              <p>
                {t("settings.velenOptional")}
              </p>
              <button
                disabled={
                  velenLoading ||
                  velenSaving ||
                  !velenChanged
                }
                onClick={() => void saveVelen()}
                type="button"
              >
                {velenSaving ? (
                  <Spinner size={14} />
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

          <div
            className="project-settings-import-panel"
            hidden={activeSection !== "issue-import"}
          >
            <LinearIssueImport
              active={activeSection === "issue-import"}
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
                <ProviderSelect
                  disabled={runtimeLoading || runtimeSaving}
                  id="project-runtime-provider"
                  label={t("settings.provider")}
                  onValueChange={(value) => {
                    setRuntimeProvider(value as AgentProvider);
                    setRuntimeModel(null);
                    setRuntimeEffort(null);
                  }}
                  optionExtras={(candidate) => ({
                    description: !providerAvailability[candidate]
                      ? t("settings.providerDisabled")
                      : undefined,
                    disabled: !providerAvailability[candidate],
                  })}
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
                  onValueChange={(value) => {
                    setRuntimeModel(value || null);
                    setRuntimeEffort(null);
                  }}
                  options={runtimeModels}
                  searchEmptyMessage={t("issue.noModelsFound")}
                  searchPlaceholder={t("issue.searchModels")}
                  searchable={runtimeProvider === "opencode" || runtimeProvider === "agy"}
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
                    ...runtimeEfforts,
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
                ).replace("Codex", agentProviderLabels[runtimeProvider])}
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
                    <Spinner size={14} />
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

          <div hidden={activeSection !== "execution"}>
            <ProjectExecutionSettings
              canManage={project.role === "owner" || project.role === "admin"}
              initialPolicy={dashboard?.executionPolicy}
              project={project}
              token={sessionToken}
              workers={dashboard?.workers ?? []}
            />
          </div>

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
                <Button
                  disabled={
                    isAnalyzingWorkflowRequirements ||
                    isRegeneratingWorkflow ||
                    isRevisingWorkflow ||
                    !workflowContract
                  }
                  size="sm"
                  onClick={() => void analyzeWorkflowRequirements()}
                  type="button"
                  variant="outline"
                >
                  {isAnalyzingWorkflowRequirements ? (
                    <Spinner size={14} />
                  ) : (
                    <Cpu size={14} />
                  )}
                  {isAnalyzingWorkflowRequirements
                    ? t("settings.analyzingWorkflowRequirements")
                    : t("settings.analyzeWorkflowRequirements")}
                </Button>
                <Button
                  disabled={
                    isAnalyzingWorkflowRequirements ||
                    isRegeneratingWorkflow ||
                    isRevisingWorkflow ||
                    !workflowContract
                  }
                  size="sm"
                  onClick={() => void regenerateWorkflow()}
                  type="button"
                  variant="outline"
                >
                  {isRegeneratingWorkflow ? (
                    <Spinner size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {isRegeneratingWorkflow
                    ? t("settings.regeneratingWorkflow")
                    : t("settings.regenerateWorkflow")}
                </Button>
                {workflowContract ? (
                  <Button
                    aria-label={t("settings.copyWorkflow")}
                    onClick={() => {
                      void navigator.clipboard.writeText(workflowJson).then(() => {
                        setWorkflowCopied(true);
                        window.setTimeout(() => setWorkflowCopied(false), 1_500);
                      });
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {workflowCopied ? <Check size={14} /> : <Copy size={14} />}
                    {workflowCopied ? t("settings.copied") : t("settings.copyJson")}
                  </Button>
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
              <Label htmlFor={`workflow-revision-${project.id}`}>
                {t("settings.workflowRevisionLabel")}
              </Label>
              <Textarea
                aria-label={t("settings.workflowRevisionLabel")}
                disabled={
                  isAnalyzingWorkflowRequirements ||
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
                <Button
                  disabled={
                    isAnalyzingWorkflowRequirements ||
                    isRegeneratingWorkflow ||
                    isRevisingWorkflow ||
                    !workflowContract ||
                    !workflowRevisionRequest.trim()
                  }
                  size="sm"
                  type="submit"
                >
                  {isRevisingWorkflow ? (
                    <Spinner size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {isRevisingWorkflow
                    ? t("settings.workflowRevising")
                    : t("settings.workflowRevise")}
                </Button>
              </footer>
            </form>
            <div aria-live="polite">
              {workflowRegenerated ? (
                <p className="project-settings-workflow-success">
                  <Check size={13} />{t("settings.workflowRegenerated")}
                </p>
              ) : null}
              {workflowRequirementsAnalyzed ? (
                <p className="project-settings-workflow-success">
                  <Check size={13} />
                  {t("settings.workflowRequirementsAnalyzed")}
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
              <>
                <ProjectMergeQueueSettings
                  githubRepositoryConnected={Boolean(githubRepository)}
                  onProfileChange={setMergeQueueProfile}
                  project={project}
                  stages={workflowContract.stages}
                  token={sessionToken}
                />
                <section className="project-settings-checkpoints">
                  <header>
                    <span>
                      <Flag size={16} strokeWidth={1.8} />
                      <span>
                        <strong>{t("settings.workflowCheckpoints")}</strong>
                        <small>{t("settings.workflowCheckpointsDescription")}</small>
                      </span>
                    </span>
                  </header>
                  <div className="project-settings-checkpoint-grid" role="table">
                    <div className="checkpoint-grid-header" role="row">
                      <strong role="columnheader">{t("settings.workflowStage")}</strong>
                      <strong role="columnheader">{t("settings.workflowProjectMandatory")}</strong>
                      <strong role="columnheader">{t("settings.workflowMyDefaults")}</strong>
                    </div>
                    {workflowContract.stages.map((stage) => (
                      <div className="checkpoint-grid-row" key={stage.id} role="row">
                        <span className="checkpoint-stage" role="cell">
                          <strong>{stage.label}</strong>
                          <small>{stage.id}</small>
                        </span>
                        {(["project", "user"] as const).map((scope) => (
                          <span className="checkpoint-options" key={scope} role="cell">
                            {(["before", "after"] as const).map((position) => {
                              const mandatory = projectMandatory.some((checkpoint) =>
                                checkpoint.stage === stage.id && checkpoint.position === position);
                              const selected = (scope === "project" ? projectMandatory : userDefaults)
                                .some((checkpoint) => checkpoint.stage === stage.id && checkpoint.position === position);
                              const locked = scope === "user" && mandatory;
                              const checkboxId = `workflow-checkpoint-${project.id}-${scope}-${stage.id}-${position}`;
                              return (
                                <Label
                                  className={locked ? "locked" : ""}
                                  htmlFor={checkboxId}
                                  key={position}
                                >
                                  <Checkbox
                                    aria-label={`${stage.label} ${position} ${scope}`}
                                    checked={locked || selected}
                                    disabled={
                                      isUpdatingWorkflowPause ||
                                      !onSaveCheckpointPolicy ||
                                      !checkpointPolicy ||
                                      locked ||
                                      (scope === "project" && project.role === "member")
                                    }
                                    id={checkboxId}
                                    onCheckedChange={(checked) => {
                                      if (checked === "indeterminate") return;
                                      void updateCheckpointBoundary(
                                        scope,
                                        stage.id,
                                        position,
                                        checked,
                                      );
                                    }}
                                  />
                                  {position === "before"
                                    ? t("settings.workflowBefore")
                                    : t("settings.workflowAfter")}
                                  {locked ? <ShieldCheck aria-hidden="true" size={12} /> : null}
                                </Label>
                              );
                            })}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                  <footer>
                    {effectiveCheckpoints.length === 0
                      ? t("settings.workflowNoCheckpoints")
                      : t("settings.workflowCheckpointCount", {
                          count: effectiveCheckpoints.length,
                        })}
                  </footer>
                </section>
                <Card
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
                <section className="project-workflow-requirements">
                  <header>
                    <span>
                      <Cpu size={16} strokeWidth={1.8} />
                      <span>
                        <strong>{t("settings.workflowRequirements")}</strong>
                        <small>{t("settings.workflowRequirementsDescription")}</small>
                      </span>
                    </span>
                    {onRefreshHealth ? (
                      <Button
                        aria-label={t("health.recheck")}
                        onClick={() => void onRefreshHealth()}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <RefreshCw size={13} />
                      </Button>
                    ) : null}
                  </header>
                  {workflowContract.requirements.length ? (
                    <ul>
                      {workflowContract.requirements.map((requirement) => {
                        const status = requirementHealth.get(requirement.id);
                        return (
                          <li key={requirement.id}>
                            <i className={status?.healthy ? "ok" : "warning"}>
                              {status?.healthy ? (
                                <CheckCircle2 size={15} />
                              ) : (
                                <CircleAlert size={15} />
                              )}
                            </i>
                            <span>
                              <strong>{requirement.label}</strong>
                              <small>{requirement.reason}</small>
                              <code>{requirement.tool}</code>
                            </span>
                            <em>
                              {status
                                ? status.healthy
                                  ? t("common.healthy")
                                  : t("common.checkNeeded")
                                : t("health.notChecked")}
                            </em>
                            {status?.detail ? <p>{status.detail}</p> : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p>{t("health.noWorkflowRequirements")}</p>
                  )}
                </section>
                <div className="project-workflow-diagram">
                  <ol className="project-workflow-stages">
                    {workflowContract.stages.map((stage, index) => (
                      <li key={`${stage.id}-${index}`}>
                        <article
                          className={`project-workflow-stage ${stage.required ? "required" : "optional"}`}
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
                          {effectiveCheckpoints
                            .filter((checkpoint) => checkpoint.stage === stage.id)
                            .map((checkpoint) => (
                              <span
                                className="project-workflow-pause-badge"
                                key={checkpoint.key}
                              >
                                {checkpoint.position === "before"
                                  ? t("settings.workflowBefore")
                                  : t("settings.workflowAfter")}
                              </span>
                            ))}
                          {mergeQueueProfile?.enabled &&
                              mergeQueueProfile.readinessStageId === stage.id
                            ? (
                              <span className="project-workflow-merge-queue-badge">
                                <GitMerge size={12} strokeWidth={1.8} />
                                {t("settings.mergeQueueBoundaryBadge")}
                              </span>
                            )
                            : null}
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
                            count:
                              requiredWorkflowStages(
                                workflowContract,
                              ).length,
                          })}
                        </strong>
                      </span>
                    </div>
                    <div className="project-workflow-pause-summary">
                      <Flag size={18} strokeWidth={1.8} />
                      <span>
                        <small>{t("settings.workflowCheckpoints")}</small>
                        <strong>
                          {effectiveCheckpoints.length === 0
                            ? t("settings.workflowNoCheckpoints")
                            : t("settings.workflowCheckpointCount", {
                                count: effectiveCheckpoints.length,
                              })}
                        </strong>
                      </span>
                    </div>
                  </footer>
                </div>
                </Card>
              </>
            ) : (
              <p className="project-settings-empty">{t("settings.loadingWorkflow")}</p>
            )}
          </section>

          <StatusPanel
            className="project-settings-danger mx-auto mt-4 max-w-[720px] items-center"
            density="spacious"
            hidden={activeSection !== "general"}
            tone="destructive"
          >
            <StatusPanelIcon className="bg-destructive/10 text-destructive">
              <AlertTriangle size={18} strokeWidth={1.8} />
            </StatusPanelIcon>
            <StatusPanelContent>
              <StatusPanelTitle>{t("settings.danger")}</StatusPanelTitle>
              <StatusPanelDescription>{t("settings.dangerDescription")}</StatusPanelDescription>
            </StatusPanelContent>
            <StatusPanelAction>
              <Button
                onClick={() => setIsConfirming(true)}
                type="button"
                variant="destructive"
              >
                <Trash2 size={15} strokeWidth={1.8} />
                {t("settings.deleteProject")}
              </Button>
            </StatusPanelAction>
          </StatusPanel>
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
                <Spinner size={15} />
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
