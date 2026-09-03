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
  Palette,
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
  SettingsAlert,
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
  defaultTeamLlmSettings,
  defaultTeamSandboxSettings,
  loadAppProviderSettings,
  loadTeamLlmSettings,
  loadTeamSandboxSettings,
  updateTeamLlmSettings,
  updateTeamSandboxSettings,
  type AgentProvider,
  type ModelEffort,
} from "../lib/team-llm";
import { useAgentProviderModels } from "../hooks/useAgentProviderModels";
import type {
  AppProviderSettings,
  ApprovalPolicy,
  AutoHuntHealth,
  VelenInspection,
} from "../generated/tauri";
import { hasOrganizationCapability } from "../lib/organization-role";
import type {
  LinearImportConnectResult,
  LinearImportResult,
  LinearImportStatesResult,
  LinearStatusMapping,
} from "../lib/linear-import";
import { requiredWorkflowStages } from "../lib/auto-hunt-contract";
import {
  isIssueKeyPrefix,
  normalizeIssueKeyPrefix,
} from "../lib/issue-key";
import {
  teamIconAccept,
  teamIconFromFile,
} from "../lib/team-icon";
import { isTeamScheduleTabEnabled } from "../lib/team-tabs";
import type { TeamIconUpdate } from "../lib/api";
import { LinearIssueImport } from "./LinearIssueImport";
import { TeamExecutionSettings } from "./TeamExecutionSettings";
import { TeamIcon } from "./TeamIcon";
import { TeamIconPicker } from "./TeamIconPicker";
import { TeamMergeQueueSettings } from "./TeamMergeQueueSettings";
import { TeamTabsSettings } from "./TeamTabsSettings";
import { ProviderSelect } from "./ProviderSelect";
import { SelectMenu } from "./SelectMenu";
import type { ProjectSettingsSection as TeamSettingsSection } from "../lib/app-navigation";

export type { ProjectSettingsSection as TeamSettingsSection } from "../lib/app-navigation";

export function TeamSettings({
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
  initialSection?: TeamSettingsSection;
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
    >["teamMandatory"],
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
    statusMapping: LinearStatusMapping;
  }) => Promise<LinearImportResult>;
  onIconChange: (
    projectId: string,
    update: TeamIconUpdate,
  ) => Promise<unknown>;
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
  const canManageProject = hasOrganizationCapability(
    project.role,
    "projects:manage",
  );
  const canManageDevelopment = hasOrganizationCapability(
    project.role,
    "development:manage",
  );
  const providerModels = useAgentProviderModels();
  const [activeSection, setActiveSection] =
    useState<TeamSettingsSection>(initialSection ?? "general");
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
    defaultTeamLlmSettings.provider,
  );
  const [runtimeModel, setRuntimeModel] = useState<string | null>(
    defaultTeamLlmSettings.model,
  );
  const [runtimeEffort, setRuntimeEffort] = useState<ModelEffort | null>(
    defaultTeamLlmSettings.effort,
  );
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    defaultTeamLlmSettings.approvalPolicy,
  );
  const [savedRuntime, setSavedRuntime] = useState(defaultTeamLlmSettings);
  const [providerAvailability, setProviderAvailability] =
    useState<AppProviderSettings>(defaultAppProviderSettings);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(defaultTeamSandboxSettings);
  const [sandboxLoading, setSandboxLoading] = useState(true);
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [isIconSaving, setIsIconSaving] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [iconSaved, setIconSaved] = useState(false);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);

  const applyIconUpdate = (update: TeamIconUpdate) => {
    setIsIconSaving(true);
    setIconError(null);
    setIconSaved(false);
    return Promise.resolve(onIconChange(project.id, update))
      .then(() => setIconSaved(true))
      .catch(() => setIconError(t("settings.iconUploadFailed")))
      .finally(() => setIsIconSaving(false));
  };
  const [issueKeyPrefix, setIssueKeyPrefix] = useState(
    project.issueKeyPrefix,
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
    setIssueKeyPrefix(project.issueKeyPrefix);
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
  const projectMandatory = checkpointPolicy?.teamMandatory ??
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
      loadTeamLlmSettings(project.id),
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
    void loadTeamSandboxSettings(project.id)
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
      const saved = await updateTeamSandboxSettings(project.id, {
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
      const saved = await updateTeamLlmSettings(project.id, {
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
          ? checkpointPolicy.teamRevision
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
    <SettingsShell>
      {navigationSidebar || <SettingsSidebar
        isOpen={isSidebarOpen}
        label={t("settings.navigation")}
      >
        <SettingsBackButton onClick={onBack}>
          {t("settings.back")}
        </SettingsBackButton>

        <SettingsNav className="pt-1">
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
        className="bg-background"
        isSidebarOpen={isSidebarOpen}
      >
        <SettingsScroll>
          <SettingsPageHeader
            description={
              activeItem?.description ??
              t("settings.description", { name: project.name })
            }
            title={activeItem?.label ?? t("settings.title")}
          />

          {activeSection === "general" ? (
            <section className="mx-auto grid w-full max-w-[720px] gap-5 rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
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
                      disabled={!canManageProject || issueKeyPrefixSaving}
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
                        !canManageProject ||
                        issueKeyPrefixSaving ||
                        !isIssueKeyPrefix(issueKeyPrefix) ||
                        issueKeyPrefix === project.issueKeyPrefix
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
                    ) : project.iconName ? (
                      <TeamIcon
                        className="size-8 text-muted-foreground"
                        project={project}
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
                    {canManageProject ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          className={isIconSaving ? "pointer-events-none opacity-50" : undefined}
                          disabled={isIconSaving}
                          onClick={() => setIsIconPickerOpen(true)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Palette aria-hidden="true" size={15} strokeWidth={1.8} />
                          {t("settings.chooseIcon")}
                        </Button>
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
                              accept={teamIconAccept}
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
                                void teamIconFromFile(file)
                                  .then((icon) =>
                                    applyIconUpdate({ type: "image", dataUrl: icon }),
                                  )
                                  .catch(() => setIconError(t("settings.iconUploadFailed")))
                                  .finally(() => setIsIconSaving(false));
                              }}
                              type="file"
                            />
                          </label>
                        </Button>
                        {project.icon || project.iconName ? (
                          <Button
                            disabled={isIconSaving}
                            onClick={() => void applyIconUpdate({ type: "clear" })}
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

          <TeamIconPicker
            disabled={!canManageProject || isIconSaving}
            onOpenChange={setIsIconPickerOpen}
            open={isIconPickerOpen}
            selectedColor={project.iconColor}
            selectedName={project.iconName}
            onSelect={(icon) => applyIconUpdate({ type: "named", ...icon })}
          />

          {activeSection === "tabs" ? (
            <TeamTabsSettings
              canEdit={canManageProject}
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
              scheduleEnabled={isTeamScheduleTabEnabled(project)}
            />
          ) : null}

          <section
            className="mx-auto mt-4 w-full max-w-[720px] rounded-xl border border-border bg-card p-5 shadow-xs"
            data-project-integration="velen"
            hidden={activeSection !== "integrations"}
          >
            <header className="flex items-start gap-3 max-[760px]:flex-wrap">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                <Database size={18} strokeWidth={1.8} />
              </span>
              <span className="grid min-w-0 gap-1">
                <Typography as="strong" variant="bodySm">
                  {t("settings.velenTitle")}
                </Typography>
                <Typography as="small" tone="muted" variant="caption">
                  {t("settings.velenDescription")}
                </Typography>
              </span>
              <div className="ml-auto flex items-center gap-2 max-[760px]:ml-11 max-[760px]:w-full">
                <Button
                  aria-label={t("settings.velenRefresh")}
                  disabled={velenLoading || velenSaving}
                  onClick={() => void refreshVelen()}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <Spinner icon={RefreshCw} size={14} spinning={velenLoading} />
                </Button>
              </div>
            </header>

            <div className="mt-4 grid gap-2.5 min-[761px]:grid-cols-[minmax(0,1.5fr)_minmax(180px,1fr)]">
              <label className="grid min-w-0 gap-1.5">
                <Label>{t("settings.velenOrg")}</Label>
                <SelectMenu
                  className="[&_.select-menu-trigger]:h-9"
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
              <SettingsAlert className="mt-2.5">{velenError}</SettingsAlert>
            ) : null}

            <footer className="mt-3.5 flex items-center justify-between gap-4 max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:[&>button]:w-full">
              <Typography className="flex-1" tone="muted" variant="caption">
                {t("settings.velenOptional")}
              </Typography>
              <Button
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
              </Button>
            </footer>
          </section>

          <div
            className="mx-auto w-full max-w-[720px]"
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
            className="mx-auto mt-4 w-full max-w-[720px]"
            hidden={activeSection !== "agent-configuration"}
          >
            <section
              aria-busy={runtimeLoading || runtimeSaving}
              className="rounded-xl border border-border bg-card p-5 shadow-xs"
            >
              <header className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Bot size={18} strokeWidth={1.8} />
                </span>
                <span className="grid min-w-0 gap-1">
                  <Typography as="strong" variant="bodySm">
                    {t("settings.runtimeTitle")}
                  </Typography>
                  <Typography as="small" tone="muted" variant="caption">
                    {t("settings.runtimeDescription")}
                  </Typography>
                </span>
              </header>

              <div className="mt-4 grid items-center gap-2.5 min-[761px]:grid-cols-[minmax(110px,1fr)_minmax(210px,280px)] [&_.select-menu-trigger]:h-9">
                <Label htmlFor="project-runtime-provider">
                  {t("settings.provider")}
                </Label>
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

                <Label htmlFor="project-runtime-model">
                  {t("settings.model")}
                </Label>
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

                <Label htmlFor="project-runtime-effort">
                  {t("settings.effort")}
                </Label>
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

                <Label htmlFor="project-runtime-approval">
                  {t("settings.approvalRequest")}
                </Label>
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

              <Typography className="mt-3" tone="muted" variant="caption">
                {t(
                  approvalPolicy === "untrusted"
                    ? "settings.approvalUntrustedDescription"
                    : approvalPolicy === "on-request"
                      ? "settings.approvalOnRequestDescription"
                      : "settings.approvalNeverDescription",
                ).replace("Codex", agentProviderLabels[runtimeProvider])}
              </Typography>
              {runtimeError ? (
                <SettingsAlert className="mt-3">{runtimeError}</SettingsAlert>
              ) : null}
              <footer className="mt-4 flex justify-end border-t border-border pt-3.5 max-[760px]:[&>button]:w-full">
                <Button
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
                </Button>
              </footer>
            </section>

            <div
              className={`mt-3 flex items-center gap-2.5 rounded-xl border p-4 shadow-xs ${
                sandbox.fullAccess
                  ? "border-[var(--status-warning-border)] bg-[var(--status-warning-surface)]"
                  : "border-[var(--status-success-border)] bg-[var(--status-success-surface)]"
              }`}
            >
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                  sandbox.fullAccess
                    ? "bg-warning/15 text-[var(--status-warning-foreground)]"
                    : "bg-success/15 text-[var(--status-success-foreground)]"
                }`}
              >
                {sandbox.fullAccess ? (
                  <AlertTriangle size={17} strokeWidth={1.8} />
                ) : (
                  <ShieldCheck size={17} strokeWidth={1.8} />
                )}
              </span>
              <span className="grid min-w-0 gap-1">
                <Typography as="strong" variant="caption">
                  {t("settings.sandboxTitle")}
                </Typography>
                <Typography as="small" tone="muted" variant="caption">
                  {t(
                    sandbox.fullAccess
                      ? "settings.sandboxUnrestrictedDescription"
                      : "settings.sandboxWorkspaceDescription",
                  )}
                </Typography>
              </span>
              <label className="ml-auto flex cursor-pointer items-center gap-2">
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
              <SettingsAlert className="mt-2">{sandboxError}</SettingsAlert>
            ) : null}
          </section>

          <div hidden={activeSection !== "execution"}>
            <TeamExecutionSettings
              canManage={canManageDevelopment}
              initialPolicy={dashboard?.executionPolicy}
              project={project}
              token={sessionToken}
              workers={dashboard?.workers ?? []}
            />
          </div>

          <section
            className="mx-auto mt-4 w-full max-w-[720px] rounded-xl border border-border bg-card p-5 shadow-sm"
            hidden={activeSection !== "workflow"}
          >
            <header className="flex items-start gap-3 max-[760px]:flex-wrap">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                <GitBranch size={18} strokeWidth={1.8} />
              </span>
              <span className="grid min-w-0 gap-1">
                <Typography as="strong" variant="bodySm">
                  {t("settings.workflowTitle")}
                </Typography>
                <Typography as="small" tone="muted" variant="caption">
                  {t("settings.workflowDescription")}
                </Typography>
              </span>
              <div className="ml-auto flex items-center gap-2 max-[760px]:ml-11 max-[760px]:w-full max-[760px]:flex-wrap">
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
            <p className="ml-11 mt-3.5 text-2xs leading-relaxed text-muted-foreground max-[480px]:ml-0">
              {t("settings.workflowAgentDescription")}
            </p>
            <form
              className="ml-11 mt-3.5 grid gap-2 rounded-xl border border-border bg-muted p-3 max-[480px]:ml-0"
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
              <footer className="flex items-center justify-between gap-3 max-[480px]:flex-col max-[480px]:items-stretch">
                <Typography as="small" tone="muted" variant="caption">
                  {t("settings.workflowRevisionDescription")}
                </Typography>
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
                <p className="ml-11 mt-2.5 flex items-center gap-1.5 text-2xs text-[var(--status-success-foreground)] max-[480px]:ml-0">
                  <Check size={13} />{t("settings.workflowRegenerated")}
                </p>
              ) : null}
              {workflowRequirementsAnalyzed ? (
                <p className="ml-11 mt-2.5 flex items-center gap-1.5 text-2xs text-[var(--status-success-foreground)] max-[480px]:ml-0">
                  <Check size={13} />
                  {t("settings.workflowRequirementsAnalyzed")}
                </p>
              ) : null}
              {workflowRevised ? (
                <p className="ml-11 mt-2.5 flex items-center gap-1.5 text-2xs text-[var(--status-success-foreground)] max-[480px]:ml-0">
                  <Check size={13} />{t("settings.workflowRevised")}
                </p>
              ) : null}
              {workflowError ? (
                <p className="ml-11 mt-2.5 text-2xs text-[var(--status-destructive-foreground)] max-[480px]:ml-0">
                  {workflowError}
                </p>
              ) : null}
            </div>
            {workflowContract ? (
              <>
                <TeamMergeQueueSettings
                  githubRepositoryConnected={Boolean(githubRepository)}
                  onProfileChange={setMergeQueueProfile}
                  project={project}
                  stages={workflowContract.stages}
                  token={sessionToken}
                />
                <section className="mt-3.5 overflow-hidden rounded-xl border border-border bg-card">
                  <header className="border-b border-border bg-muted px-3.5 py-3">
                    <span className="flex items-start gap-2 text-accent-foreground">
                      <Flag size={16} strokeWidth={1.8} />
                      <span className="grid gap-1">
                        <Typography as="strong" variant="caption">
                          {t("settings.workflowCheckpoints")}
                        </Typography>
                        <Typography as="small" tone="muted" variant="micro">
                          {t("settings.workflowCheckpointsDescription")}
                        </Typography>
                      </span>
                    </span>
                  </header>
                  <div className="grid" role="table">
                    <div
                      className="grid min-h-8 grid-cols-[minmax(150px,1fr)_minmax(210px,1.2fr)_minmax(210px,1.2fr)] items-center bg-muted px-3.5 text-2xs text-muted-foreground max-[760px]:hidden"
                      role="row"
                    >
                      <strong role="columnheader">{t("settings.workflowStage")}</strong>
                      <strong role="columnheader">{t("settings.workflowProjectMandatory")}</strong>
                      <strong role="columnheader">{t("settings.workflowMyDefaults")}</strong>
                    </div>
                    {workflowContract.stages.map((stage) => (
                      <div
                        className="grid min-h-13 grid-cols-[minmax(150px,1fr)_minmax(210px,1.2fr)_minmax(210px,1.2fr)] items-center border-t border-border px-3.5 py-2 max-[760px]:grid-cols-1 max-[760px]:gap-2"
                        key={stage.id}
                        role="row"
                      >
                        <span className="grid gap-0.5" role="cell">
                          <Typography as="strong" variant="caption">
                            {stage.label}
                          </Typography>
                          <Typography as="small" tone="muted" variant="micro">
                            {stage.id}
                          </Typography>
                        </span>
                        {(["project", "user"] as const).map((scope) => (
                          <span className="flex flex-wrap gap-2" key={scope} role="cell">
                            <span className="w-[90px] text-2xs text-muted-foreground min-[761px]:hidden">
                              {scope === "project"
                                ? t("settings.workflowProjectMandatory")
                                : t("settings.workflowMyDefaults")}
                            </span>
                            {(["before", "after"] as const).map((position) => {
                              const mandatory = projectMandatory.some((checkpoint) =>
                                checkpoint.stage === stage.id && checkpoint.position === position);
                              const selected = (scope === "project" ? projectMandatory : userDefaults)
                                .some((checkpoint) => checkpoint.stage === stage.id && checkpoint.position === position);
                              const locked = scope === "user" && mandatory;
                              const checkboxId = `workflow-checkpoint-${project.id}-${scope}-${stage.id}-${position}`;
                              return (
                                <Label
                                  className={`inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-card px-2 py-1 text-2xs text-muted-foreground ${
                                    locked || selected
                                      ? "border-primary/40 bg-accent text-accent-foreground"
                                      : ""
                                  } ${locked ? "cursor-not-allowed border-dashed" : ""}`}
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
                                      (scope === "project" && !canManageDevelopment)
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
                  <footer className="border-t border-border bg-muted px-3.5 py-2.5 text-2xs text-muted-foreground">
                    {effectiveCheckpoints.length === 0
                      ? t("settings.workflowNoCheckpoints")
                      : t("settings.workflowCheckpointCount", {
                          count: effectiveCheckpoints.length,
                        })}
                  </footer>
                </section>
                <Card
                  aria-label={t("settings.workflowDiagram")}
                  className="mt-4 overflow-hidden"
                  role="group"
                >
                <div className="flex min-h-9 min-w-0 items-center gap-2 border-b border-border bg-muted px-3">
                  <Typography as="span" tone="muted" variant="micro">
                    {t("settings.repository")}
                  </Typography>
                  <code className="truncate font-mono text-2xs font-medium text-foreground">
                    {githubRepository ?? t("settings.noRepository")}
                  </code>
                  <span className="ml-auto shrink-0 font-mono text-2xs font-medium text-muted-foreground uppercase">
                    v{workflowContract.version}
                  </span>
                </div>
                <section className="border-b border-border bg-card p-3.5">
                  <header className="flex items-center justify-between gap-2.5">
                    <span className="flex items-center gap-2 text-accent-foreground">
                      <Cpu size={16} strokeWidth={1.8} />
                      <span className="grid gap-0.5">
                        <Typography as="strong" variant="caption">
                          {t("settings.workflowRequirements")}
                        </Typography>
                        <Typography as="small" tone="muted" variant="micro">
                          {t("settings.workflowRequirementsDescription")}
                        </Typography>
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
                    <ul className="mt-3 grid list-none gap-2 p-0 min-[761px]:grid-cols-2">
                      {workflowContract.requirements.map((requirement) => {
                        const status = requirementHealth.get(requirement.id);
                        return (
                          <li
                            className="grid min-w-0 grid-cols-[27px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-card p-2.5"
                            key={requirement.id}
                          >
                            <i
                              className={`grid size-7 place-items-center rounded-lg not-italic ${
                                status?.healthy
                                  ? "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]"
                                  : "bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]"
                              }`}
                            >
                              {status?.healthy ? (
                                <CheckCircle2 size={15} />
                              ) : (
                                <CircleAlert size={15} />
                              )}
                            </i>
                            <span className="grid min-w-0 gap-0.5">
                              <Typography as="strong" variant="micro">
                                {requirement.label}
                              </Typography>
                              <Typography as="small" tone="muted" variant="micro">
                                {requirement.reason}
                              </Typography>
                              <code className="font-mono text-2xs font-medium text-muted-foreground">
                                {requirement.tool}
                              </code>
                            </span>
                            <em
                              className={`whitespace-nowrap rounded-md px-1.5 py-1 text-2xs not-italic ${
                                status?.healthy
                                  ? "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]"
                                  : "bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]"
                              }`}
                            >
                              {status
                                ? status.healthy
                                  ? t("common.healthy")
                                  : t("common.checkNeeded")
                                : t("health.notChecked")}
                            </em>
                            {status?.detail ? (
                              <p className="col-[2/-1] m-0 text-2xs leading-snug text-muted-foreground">
                                {status.detail}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <Typography className="ml-6 mt-2.5" tone="muted" variant="micro">
                      {t("health.noWorkflowRequirements")}
                    </Typography>
                  )}
                </section>
                <div className="min-w-0 p-[18px]">
                  <ol className="scrollbar-subtle flex list-none items-stretch overflow-x-auto p-0 pb-1.5">
                    {workflowContract.stages.map((stage, index) => (
                      <li
                        className="flex min-w-0 shrink-0 items-center"
                        key={`${stage.id}-${index}`}
                      >
                        <article
                          className={`flex min-h-46 w-[190px] shrink-0 flex-col rounded-xl border border-border p-3 shadow-xs ${
                            stage.required
                              ? "bg-card"
                              : "border-dashed bg-muted"
                          }`}
                        >
                          <header className="flex items-center justify-between gap-2">
                            <span className="grid size-6 place-items-center rounded-lg bg-primary font-mono text-2xs font-semibold text-primary-foreground shadow-sm">
                              {index + 1}
                            </span>
                            <em className={`rounded-full px-2 py-1 text-2xs font-bold not-italic ${
                              stage.required
                                ? "bg-accent text-accent-foreground"
                                : "bg-secondary text-secondary-foreground"
                            }`}>
                              {t(
                                stage.required
                                  ? "common.required"
                                  : "common.optional",
                              )}
                            </em>
                          </header>
                          <strong className="mt-3 text-2xs leading-snug text-foreground">
                            {stage.label}
                          </strong>
                          <code className="mt-1 font-mono text-2xs font-medium text-muted-foreground">
                            {stage.id}
                          </code>
                          {effectiveCheckpoints
                            .filter((checkpoint) => checkpoint.stage === stage.id)
                            .map((checkpoint) => (
                              <span
                                className="mt-2 self-start rounded-full bg-primary px-1.5 py-1 text-2xs font-bold text-primary-foreground"
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
                              <span className="mt-2 inline-flex self-start items-center gap-1 rounded-full bg-[var(--status-success-surface)] px-1.5 py-1 text-2xs font-bold text-[var(--status-success-foreground)]">
                                <GitMerge size={12} strokeWidth={1.8} />
                                {t("settings.mergeQueueBoundaryBadge")}
                              </span>
                            )
                            : null}
                          {stage.evidence?.length ? (
                            <div className="mt-3 grid gap-1.5">
                              <span className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">
                                {t("settings.workflowEvidence")}
                              </span>
                              <ul className="flex list-none flex-wrap gap-1 p-0">
                                {stage.evidence.map((item) => (
                                  <li
                                    className="max-w-full truncate rounded-md border border-border bg-muted px-1.5 py-1 font-mono text-2xs font-medium text-muted-foreground"
                                    key={item}
                                  >
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {stage.checks?.length ? (
                            <div className="mt-3 grid gap-1.5">
                              <span className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">
                                {t("settings.workflowChecks")}
                              </span>
                              <ul className="grid list-none gap-1 p-0">
                                {stage.checks.map((check) => (
                                  <li
                                    className="max-w-full overflow-hidden rounded-md border border-border bg-muted px-1.5 py-1 font-mono text-2xs font-medium whitespace-normal text-muted-foreground [overflow-wrap:anywhere]"
                                    key={check}
                                  >
                                    {check}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                        {index < workflowContract.stages.length - 1 ? (
                          <span
                            aria-hidden="true"
                            className="grid w-[34px] shrink-0 place-items-center text-muted-foreground"
                          >
                            <ArrowRight size={17} strokeWidth={1.8} />
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <footer className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    <div className="flex min-h-12 min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-border bg-accent px-3 py-2 text-accent-foreground">
                      <CheckCircle2 size={18} strokeWidth={1.8} />
                      <span className="grid min-w-0 gap-0.5">
                        <Typography as="small" className="font-bold tracking-wide uppercase" tone="muted" variant="micro">
                          {t("settings.workflowCompletion")}
                        </Typography>
                        <Typography as="strong" className="truncate" variant="micro">
                          {t("settings.workflowRequiredStageCount", {
                            count:
                              requiredWorkflowStages(
                                workflowContract,
                              ).length,
                          })}
                        </Typography>
                      </span>
                    </div>
                    <div className="flex min-h-12 min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-border bg-accent px-3 py-2 text-accent-foreground">
                      <Flag size={18} strokeWidth={1.8} />
                      <span className="grid min-w-0 gap-0.5">
                        <Typography as="small" className="font-bold tracking-wide uppercase" tone="muted" variant="micro">
                          {t("settings.workflowCheckpoints")}
                        </Typography>
                        <Typography as="strong" className="truncate" variant="micro">
                          {effectiveCheckpoints.length === 0
                            ? t("settings.workflowNoCheckpoints")
                            : t("settings.workflowCheckpointCount", {
                                count: effectiveCheckpoints.length,
                              })}
                        </Typography>
                      </span>
                    </div>
                  </footer>
                </div>
                </Card>
              </>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-muted p-4 text-center text-2xs text-muted-foreground">
                {t("settings.loadingWorkflow")}
              </p>
            )}
          </section>

          <StatusPanel
            className="mx-auto mt-4 max-w-[720px] items-center max-[760px]:flex-col max-[760px]:items-start max-[760px]:[&_[data-slot=status-panel-action]]:ml-0 max-[760px]:[&_[data-slot=status-panel-action]]:w-full max-[760px]:[&_[data-slot=status-panel-action]>button]:w-full"
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
