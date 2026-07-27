import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  GitBranch,
  Link2,
  LoaderCircle,
  Plug,
  RefreshCw,
  Rocket,
  SlidersHorizontal,
  Trash2,
  Zap,
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
import { Typography } from "@/components/ui/typography";
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

type ProjectSettingsSection =
  | "general"
  | "integrations"
  | "issue-import"
  | "auto-hunt"
  | "workflow";

export function ProjectSettings({
  dashboard,
  githubRepository,
  isDeleting,
  isSidebarOpen,
  onBack,
  onDelete,
  onRegenerateWorkflow,
  onUpdateAutomation,
  onUpdateVelenOrg,
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
  velen: VelenInspection | null;
}) {
  const { localeTag, t } = useI18n();
  const [activeSection, setActiveSection] =
    useState<ProjectSettingsSection>("general");
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
      id: "auto-hunt" as const,
      icon: <Zap size={16} strokeWidth={1.75} />,
      label: t("settings.navAutoHunt"),
      description: t("settings.navAutoHuntDescription"),
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
            className="project-settings-auto-run"
            hidden={activeSection !== "auto-hunt"}
          >
            <header>
              <span className="project-settings-auto-run-icon">
                <Zap size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{t("settings.autoRunTitle")}</strong>
                <small>{t("settings.autoRunDescription")}</small>
              </span>
              <label className="project-settings-toggle flex items-center gap-2">
                <Switch
                  checked={automation.enabled}
                  onCheckedChange={(enabled) => {
                    setAutomation((current) => ({
                      ...current,
                      enabled,
                    }));
                  }}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {t(automation.enabled ? "settings.autoRunOn" : "settings.autoRunOff")}
                </span>
              </label>
            </header>

            <div className="project-settings-auto-run-rules">
              <label>
                <span>{t("settings.autoRunMaxIssues")}</span>
                <Input
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
              {t("settings.workflowAgentDescription")}
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
