import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  GitBranch,
  LoaderCircle,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  loadProjectLlmSettings,
  updateProjectLlmSettings,
  type ApprovalPolicy,
} from "../lib/project-llm";
import type { DashboardPayload, Project } from "../types";
import { useI18n } from "../i18n";

export function ProjectSettings({
  dashboard,
  isDeleting,
  isSidebarOpen,
  onBack,
  onDelete,
  onRegenerateWorkflow,
  onSidebarOpen,
  project,
}: {
  dashboard: DashboardPayload | null;
  isDeleting: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onDelete: () => Promise<unknown>;
  onRegenerateWorkflow: () => Promise<unknown>;
  onSidebarOpen: () => void;
  project: Project;
}) {
  const { localeTag, t } = useI18n();
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("never");
  const [savedApprovalPolicy, setSavedApprovalPolicy] =
    useState<ApprovalPolicy>("never");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [workflowCopied, setWorkflowCopied] = useState(false);
  const [isRegeneratingWorkflow, setIsRegeneratingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowRegenerated, setWorkflowRegenerated] = useState(false);
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
    let cancelled = false;
    setWorkflowError(null);
    setWorkflowRegenerated(false);
    setSettingsLoading(true);
    setSettingsError(null);
    void loadProjectLlmSettings(project.id)
      .then((settings) => {
        if (cancelled) return;
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
      const settings = await updateProjectLlmSettings(project.id, { approvalPolicy });
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

  return (
    <main className="main-content project-settings-page">
      <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region>
        {!isSidebarOpen && (
          <button
            aria-controls="app-sidebar"
            aria-expanded="false"
            aria-label={t("sidebar.open")}
            className="sidebar-toggle"
            onClick={onSidebarOpen}
            title={t("sidebar.open")}
            type="button"
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
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
              {t("settings.regenerateWorkflowDescription")}
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
                  <strong>{dashboard?.settings.githubRepository ?? t("settings.noRepository")}</strong>
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
                <strong>{t("settings.llmTitle")}</strong>
                <small>{t("settings.llmDescription")}</small>
              </span>
            </header>
            <div className="project-settings-llm-control">
              <label htmlFor="project-approval-policy">{t("settings.approvalRequest")}</label>
              <select
                disabled={settingsLoading || settingsSaving}
                id="project-approval-policy"
                onChange={(event) =>
                  setApprovalPolicy(event.currentTarget.value as ApprovalPolicy)
                }
                value={approvalPolicy}
              >
                <option value="untrusted">{t("settings.approvalUntrusted")}</option>
                <option value="on-request">{t("settings.approvalOnRequest")}</option>
                <option value="never">{t("settings.approvalNever")}</option>
              </select>
              <button
                disabled={
                  settingsLoading ||
                  settingsSaving ||
                  approvalPolicy === savedApprovalPolicy
                }
                onClick={() => void saveLlmSettings()}
                type="button"
              >
                {settingsSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : approvalPolicy === savedApprovalPolicy ? (
                  <Check size={14} />
                ) : null}
                {settingsSaving
                  ? t("common.saving")
                  : approvalPolicy === savedApprovalPolicy
                    ? t("common.saved")
                    : t("common.save")}
              </button>
            </div>
            <p>{t(approvalPolicy === "untrusted" ? "settings.approvalUntrustedDescription" : approvalPolicy === "on-request" ? "settings.approvalOnRequestDescription" : "settings.approvalNeverDescription")}</p>
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
