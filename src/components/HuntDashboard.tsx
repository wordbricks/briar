import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FolderGit2,
  GitCommitHorizontal,
  GitFork,
  Image as ImageIcon,
  LoaderCircle,
  Paperclip,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Video,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JellySelect } from "./JellySelect";
import { eventMeta, runMeta } from "../lib/stages";
import {
  formatAttachmentBytes,
  issueAttachmentAccept,
  maxIssueAttachmentCount,
  validateIssueAttachments,
} from "../lib/issue-attachments";
import type { AutoHuntHealth } from "../lib/project-connection";
import type {
  CreateIssueInput,
  DashboardPayload,
  HuntRun,
  HuntSource,
  IssueAttachment,
} from "../types";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

type SourceFilter = "all" | HuntSource;
type StatusFilter = "active" | "attention" | "completed";

export function HuntDashboard({
  dashboard,
  demoMode,
  error,
  health,
  healthError,
  healthLoading,
  isCreatingIssue,
  recoveringRunId,
  recoveryError,
  isSidebarOpen,
  onCreateIssue,
  onHealthRefresh,
  onLoadAttachment,
  onReconnect,
  onRetryRun,
  onCancelRun,
  onRepair,
  onRefresh,
  onSidebarOpen,
}: {
  dashboard: DashboardPayload | null;
  demoMode: boolean;
  error: string | null;
  health: AutoHuntHealth | null;
  healthError: string | null;
  healthLoading: boolean;
  isCreatingIssue: boolean;
  recoveringRunId: string | null;
  recoveryError: string | null;
  isSidebarOpen: boolean;
  onCreateIssue: (input: CreateIssueInput) => Promise<unknown>;
  onHealthRefresh: () => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onReconnect: () => void;
  onRetryRun: (runId: string) => Promise<unknown>;
  onCancelRun: (runId: string) => Promise<unknown>;
  onRepair: () => void;
  onRefresh: () => void;
  onSidebarOpen: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);

  const runs = dashboard?.runs ?? [];
  const selected = runs.find((run) => run.id === selectedRunId) ?? null;
  const activeCount = runs.filter((run) => !["completed", "cancelled"].includes(run.status)).length;
  const attentionCount = runs.filter((run) => ["blocked", "failed"].includes(run.status)).length;
  const completedCount = runs.filter((run) => run.status === "completed").length;
  const average = activeCount
    ? Math.round(
        runs
          .filter((run) => !["completed", "cancelled"].includes(run.status))
          .reduce((sum, run) => sum + run.progress, 0) / activeCount,
      )
    : 0;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (source !== "all" && run.source !== source) return false;
      if (status === "active" && ["completed", "cancelled"].includes(run.status)) return false;
      if (status === "attention" && !["blocked", "failed"].includes(run.status)) return false;
      if (status === "completed" && run.status !== "completed") return false;
      return !normalized || `${run.title} ${run.sourceKey} ${run.repository}`.toLowerCase().includes(normalized);
    });
  }, [query, runs, source, status]);

  return (
    <main className="main-content" id="dashboard">
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
        <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
        <ConnectionHealth
          error={healthError}
          health={health}
          loading={healthLoading}
          onReconnect={onReconnect}
          onRefresh={onHealthRefresh}
          onRepair={onRepair}
        />
      </header>
      <div className="dashboard-scroll">
        <section className="page-heading">
          <div>
            <div className="heading-line">
              <p className="eyebrow">{t("dashboard.eyebrow")}</p>
              {demoMode && <span className="demo-badge">{t("dashboard.demo")}</span>}
            </div>
            <h1>{t("dashboard.title")}</h1>
            <p>{t("dashboard.description")}</p>
          </div>
          <jelly-button className="refresh-button" onClick={onRefresh} size="small" variant="white">
            <RefreshCw size={15} />{t("dashboard.refresh")}
          </jelly-button>
        </section>

        {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}

        <section className="metric-grid">
          <Metric label={t("dashboard.active")} value={activeCount} note={t("dashboard.autoHuntTasks")} icon={<LoaderCircle size={18} />} tone="violet" />
          <Metric label={t("dashboard.average")} value={`${average}%`} note={t("dashboard.activeBasis")} icon={<ActivityRing value={average} />} tone="blue" />
          <Metric label={t("dashboard.attention")} value={attentionCount} note={t("dashboard.blockedOrFailed")} icon={<CircleAlert size={18} />} tone="rose" />
          <Metric label={t("dashboard.completed")} value={completedCount} note={t("dashboard.criteriaMet")} icon={<Check size={18} />} tone="emerald" />
        </section>

        <jelly-card className="queue-panel">
          <div className="queue-header">
            <div>
              <h2>{t("dashboard.queue")}</h2>
              <span>{t("dashboard.taskCount", { count: filtered.length })}</span>
            </div>
            <div className="queue-tools">
              <button className="create-issue-button" onClick={() => setIsIssueDialogOpen(true)} type="button">
                <Plus size={14} />{t("dashboard.createIssue")}
              </button>
              <label className="search-box"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("dashboard.search")} /></label>
              <div className="source-filter">
                {(["all", "issue", "feedback", "error"] as const).map((value) => (
                  <button key={value} className={source === value ? "active" : ""} onClick={() => setSource(value)}>
                    {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="status-tabs">
            <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>{t("dashboard.active")} <span>{activeCount}</span></button>
            <button className={status === "attention" ? "active" : ""} onClick={() => setStatus("attention")}>{t("dashboard.attention")} <span>{attentionCount}</span></button>
            <button className={status === "completed" ? "active" : ""} onClick={() => setStatus("completed")}>{t("dashboard.completed")} <span>{completedCount}</span></button>
          </div>
          <div className="queue-table">
            <div className="queue-table-head"><span>{t("dashboard.task")}</span><span>{t("dashboard.status")}</span><span>{t("dashboard.progress")}</span><span>{t("dashboard.updated")}</span><span /></div>
            {filtered.length ? filtered.map((run) => <RunRow key={run.id} run={run} onOpen={() => setSelectedRunId(run.id)} />) : (
              <div className="empty-state"><Bot size={25} /><strong>{t("dashboard.emptyTitle")}</strong><span>{t("dashboard.emptyDescription")}</span></div>
            )}
          </div>
        </jelly-card>
      </div>
      {isIssueDialogOpen && (
        <CreateIssueDialog
          isSubmitting={isCreatingIssue}
          onClose={() => setIsIssueDialogOpen(false)}
          onCreate={async (input) => {
            await onCreateIssue(input);
            setIsIssueDialogOpen(false);
          }}
        />
      )}
      {selected && (
        <RunDialog
          error={recoveryError}
          isRecovering={recoveringRunId === selected.id}
          onCancel={() => onCancelRun(selected.id)}
          onClose={() => setSelectedRunId(null)}
          onLoadAttachment={onLoadAttachment}
          onRetry={() => onRetryRun(selected.id)}
          run={selected}
        />
      )}
    </main>
  );
}

export function ConnectionHealth({
  error,
  health,
  loading,
  onReconnect,
  onRefresh,
  onRepair,
}: {
  error: string | null;
  health: AutoHuntHealth | null;
  loading: boolean;
  onReconnect: () => void;
  onRefresh: () => void;
  onRepair: () => void;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const assetsNeedRepair =
    health && (!health.cliCurrent || !health.skillCurrent);
  const status = loading ? "loading" : health?.healthy ? "healthy" : "attention";
  const statusLabel = loading
    ? t("health.checking")
    : health?.healthy
      ? t("health.ready")
      : t("common.checkNeeded");

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="health-menu" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("health.connectionStatus", { status: statusLabel })}
        className={`health-trigger ${status}`}
        onClick={() => setIsOpen((open) => !open)}
        title={t("health.connectionStatus", { status: statusLabel })}
        type="button"
      >
        <span aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          aria-label={t("health.details")}
          className={`health-popover${health?.healthy ? " healthy" : ""}`}
          role="dialog"
        >
          <div className="health-header">
            <div>
              <span className="health-icon"><ShieldCheck size={16} /></span>
              <span><strong>{t("health.title")}</strong><small>{statusLabel}</small></span>
            </div>
            <div className="health-actions">
              {assetsNeedRepair && <button onClick={onRepair} type="button"><Wrench size={13} />{t("health.repair")}</button>}
              <button onClick={onReconnect} type="button"><FolderGit2 size={13} />{t("health.reconnect")}</button>
              <button aria-label={t("health.recheck")} disabled={loading} onClick={onRefresh} type="button"><RefreshCw className={loading ? "spin" : ""} size={13} /></button>
            </div>
          </div>
          {error && <div className="health-error"><CircleAlert size={14} />{error}</div>}
          {health ? (
            <div className="health-grid">
              <HealthItem healthy={health.repositoryHealthy} icon={<FolderGit2 size={15} />} label={t("health.repository")} value={health.repositoryPath ?? t("common.notConnected")} />
              <HealthItem healthy={health.cliCurrent} icon={<Terminal size={15} />} label="Briar CLI" value={health.cliVersion ? `v${health.cliVersion}` : t("common.notInstalled")} expected={`v${health.cliExpectedVersion}`} />
              <HealthItem healthy={health.skillCurrent} icon={<Bot size={15} />} label={t("health.skill")} value={health.skillVersion ? `v${health.skillVersion}` : t("common.notInstalled")} expected={`v${health.skillExpectedVersion}`} />
              <HealthItem healthy={health.velenHealthy} icon={<ShieldCheck size={15} />} label="Velen" value={health.velenOrg ?? t("health.orgUnset")} expected={health.velenEmail ?? undefined} />
            </div>
          ) : (
            <div className="health-empty">{loading ? t("health.inspecting") : t("health.desktopOnly")}</div>
          )}
          {health && !health.healthy && health.issues.length > 0 && (
            <div className="health-issues">{health.issues.map((issue) => <span key={issue}><CircleAlert size={12} />{issue}</span>)}</div>
          )}
        </div>
      )}
    </div>
  );
}

function HealthItem({
  expected,
  healthy,
  icon,
  label,
  value,
}: {
  expected?: string;
  healthy: boolean;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const { t } = useI18n();
  return <div className="health-item"><i className={healthy ? "ok" : "warning"}>{icon}</i><span><small>{label}</small><strong title={value}>{value}</strong>{expected && <em>{expected}</em>}</span><b>{healthy ? t("common.healthy") : t("common.checkNeeded")}</b></div>;
}

export function CreateIssueDialog({
  isSubmitting,
  onClose,
  onCreate,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (input: CreateIssueInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("2");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const addAttachments = (selected: File[]) => {
    if (selected.length === 0) return;
    const next = [...attachments, ...selected];
    const error = validateIssueAttachments(next);
    setAttachmentError(error);
    if (!error) setAttachments(next);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isSubmitting && onClose()}>
      <form
        className="issue-dialog"
        onPaste={(event) => {
          const items = Array.from(event.clipboardData.items);
          const pastedImages = items
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          const images = pastedImages.length > 0
            ? pastedImages
            : Array.from(event.clipboardData.files).filter((file) =>
                file.type.startsWith("image/"),
              );
          if (images.length === 0) return;
          event.preventDefault();
          addAttachments(images);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || isSubmitting) return;
          setSubmitError(null);
          void onCreate({
            title: title.trim(),
            description: description.trim() || null,
            priority: Number(priority),
            attachments,
          }).catch((error) =>
            setSubmitError(error instanceof Error ? error.message : String(error)),
          );
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t("issue.dialog")}
      >
        <header>
          <div><p className="eyebrow">AUTO HUNT ISSUE</p><h2>{t("dashboard.createIssue")}</h2></div>
          <button disabled={isSubmitting} onClick={onClose} type="button" aria-label={t("common.close")}><X size={18} /></button>
        </header>
        <div className="issue-form-body">
          <label>
            <span>{t("issue.title")} <em>{t("common.required")}</em></span>
            <input autoFocus maxLength={300} onChange={(event) => setTitle(event.target.value)} placeholder={t("issue.titlePlaceholder")} required value={title} />
          </label>
          <label>
            <span>{t("issue.description")}</span>
            <textarea maxLength={100000} onChange={(event) => setDescription(event.target.value)} placeholder={t("issue.descriptionPlaceholder")} rows={6} value={description} />
          </label>
          <div className="issue-attachment-field">
            <span>{t("issue.attachments")} <em>{t("issue.pasteHint")}</em></span>
            <label className="issue-attachment-button">
              <Paperclip size={15} />
              <span>{t("issue.chooseFile")}</span>
              <small>{t("issue.fileHint")}</small>
              <input
                accept={issueAttachmentAccept}
                aria-label={t("issue.attachmentLabel")}
                disabled={isSubmitting || attachments.length >= maxIssueAttachmentCount}
                multiple
                onChange={(event) => {
                  const selected = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  addAttachments(selected);
                }}
                type="file"
              />
            </label>
            {attachments.length > 0 && (
              <div className="issue-attachment-list">
                {attachments.map((file, index) => (
                  <SelectedAttachment
                    file={file}
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    onRemove={() => {
                      setAttachments((current) =>
                        current.filter((_, candidateIndex) => candidateIndex !== index),
                      );
                      setAttachmentError(null);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <JellySelect
            className="issue-priority-select"
            label={t("issue.priority")}
            onValueChange={setPriority}
            options={[
              { label: t("issue.priority1"), value: "1" },
              { label: t("issue.priority2"), value: "2" },
              { label: t("issue.priority3"), value: "3" },
              { label: t("issue.priority4"), value: "4" },
            ]}
            value={priority}
          />
          {(submitError || attachmentError) && <div className="issue-form-error"><CircleAlert size={14} />{submitError ?? attachmentError}</div>}
          <p>{t("issue.queuedHint")}</p>
        </div>
        <footer>
          <button disabled={isSubmitting} onClick={onClose} type="button">{t("common.cancel")}</button>
          <button className="issue-submit-button" disabled={isSubmitting || !title.trim()} type="submit">
            {isSubmitting ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
            {isSubmitting ? t("issue.submitting") : t("issue.submit")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function SelectedAttachment({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const isImage = file.type.startsWith("image/");
  return (
    <div className="issue-attachment-item">
      <span className="issue-attachment-preview">
        {previewUrl && isImage ? (
          <img alt="" src={previewUrl} />
        ) : (
          <Video size={17} />
        )}
      </span>
      <span><strong>{file.name}</strong><small>{formatAttachmentBytes(file.size)}</small></span>
      <button aria-label={t("issue.remove", { name: file.name })} onClick={onRemove} type="button"><Trash2 size={14} /></button>
    </div>
  );
}

function Metric({ label, value, note, icon, tone }: { label: string; value: string | number; note: string; icon: React.ReactNode; tone: string }) {
  return <jelly-card className={`metric-card ${tone}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></jelly-card>;
}

function ActivityRing({ value }: { value: number }) {
  return <span className="mini-ring" style={{ "--ring": `${value * 3.6}deg` } as React.CSSProperties} />;
}

function RunRow({ run, onOpen }: { run: HuntRun; onOpen: () => void }) {
  const { t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const isClaimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  return (
    <button className="run-row" onClick={onOpen}>
      <span className="run-title-cell"><i className={`source-dot ${run.source}`} /><span><strong>{run.title}</strong><small>AH-{run.runNumber} · {run.repository}{isClaimed && <> · <em>{t("run.assigned", { agent: run.claimedBy ?? "agent" })}</em></>}</small></span></span>
      <span><i className={`status-pill ${meta.tone}`}>{run.status === "running" && <LoaderCircle className="spin" size={12} />}{label}</i></span>
      <span className="progress-cell"><span><i style={{ width: `${run.progress}%` }} /></span><small>{run.progress}%</small></span>
      <span className="time-cell">{relativeTime(run.updatedAt, t)}</span>
      <span className="row-action"><ChevronRight size={16} /></span>
    </button>
  );
}

export function RunDialog({
  error,
  isRecovering,
  onCancel,
  onClose,
  onLoadAttachment,
  onRetry,
  run,
}: {
  error: string | null;
  isRecovering: boolean;
  onCancel: () => Promise<unknown>;
  onClose: () => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onRetry: () => Promise<unknown>;
  run: HuntRun;
}) {
  const { localeTag, t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const needsAttention = ["blocked", "failed"].includes(run.status);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setConfirmCancel(false);
    } catch {
      // The hook exposes the actionable error in this dialog.
    }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="run-dialog" role="dialog" aria-modal="true" aria-label={t("run.details", { title: run.title })}>
        <header><div><span className={`status-pill ${meta.tone}`}>{label}</span><small>AH-{run.runNumber} · {t("run.attempt", { count: run.currentAttempt })}</small></div><button onClick={onClose} aria-label={t("common.close")}><X size={18} /></button></header>
        <div className="dialog-body">
          <p className="eyebrow">{t(`source.${run.source}` as MessageKey).toUpperCase()} · {run.repository}</p>
          <h2>{run.title}</h2>
          <p className="run-detail">{run.detail}</p>
          {run.issueDescription && <p className="run-issue-description">{run.issueDescription}</p>}
          {(run.attachments ?? []).length > 0 && (
            <IssueAttachmentGallery
              attachments={run.attachments ?? []}
              onLoadAttachment={onLoadAttachment}
            />
          )}
          {needsAttention && (
            <div className="recovery-panel">
              <div><CircleAlert size={16} /><span><strong>{run.status === "failed" ? t("run.failed") : t("run.blocked")}</strong><small>{t("run.retryDescription", { count: run.currentAttempt + 1 })}</small></span></div>
              {error && <p><CircleAlert size={13} />{error}</p>}
              <div className="recovery-actions">
                <button disabled={isRecovering} onClick={() => void runAction(onRetry)} type="button"><RotateCcw className={isRecovering ? "spin" : ""} size={14} />{t("run.retry")}</button>
                {confirmCancel ? (
                  <><button className="danger" disabled={isRecovering} onClick={() => void runAction(onCancel)} type="button">{t("run.confirmCancel")}</button><button disabled={isRecovering} onClick={() => setConfirmCancel(false)} type="button">{t("run.back")}</button></>
                ) : (
                  <button className="danger-secondary" disabled={isRecovering} onClick={() => setConfirmCancel(true)} type="button">{t("run.cancel")}</button>
                )}
              </div>
            </div>
          )}
          <div className="large-progress"><div><span>{t("run.totalProgress")}</span><strong>{run.progress}%</strong></div><i><b style={{ width: `${run.progress}%` }} /></i></div>
          <div className="run-facts">
            <span><GitFork size={15} /><small>{t("run.branch")}</small><strong>{run.branch ?? "—"}</strong></span>
            <span><GitCommitHorizontal size={15} /><small>{t("run.commit")}</small><strong>{run.commitSha ?? "—"}</strong></span>
            <span><Clock3 size={15} /><small>{t("run.started")}</small><strong>{formatDate(run.startedAt, localeTag)}</strong></span>
          </div>
          <div className="timeline"><h3>{t("run.activity")}</h3>{run.events.map((event) => { const eventDisplay = eventMeta(event.status, event.workflowStage, run.workflow); return <div className="timeline-event" key={event.id}><i className={eventDisplay.tone} /><span><strong>{localizeEvent(t, event.status, event.workflowStage, eventDisplay.label)} <em>{t("run.attempt", { count: event.attempt })}</em></strong><p>{event.detail}</p><small>{event.actor} · {relativeTime(event.occurredAt, t)}</small></span></div>; })}</div>
        </div>
        <footer><span>{needsAttention ? t("run.preserveEvidence") : t("run.liveEvidence")}</span><button><ArrowUpRight size={14} />{t("run.openRepository")}</button></footer>
      </section>
    </div>
  );
}

function IssueAttachmentGallery({
  attachments,
  onLoadAttachment,
}: {
  attachments: IssueAttachment[];
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
}) {
  const { t } = useI18n();
  return (
    <section className="run-attachments">
      <h3><Paperclip size={14} />{t("run.attachments")} <span>{attachments.length}</span></h3>
      <div>
        {attachments.map((attachment) => (
          <IssueAttachmentPreview
            attachment={attachment}
            key={attachment.id}
            onLoadAttachment={onLoadAttachment}
          />
        ))}
      </div>
    </section>
  );
}

function IssueAttachmentPreview({
  attachment,
  onLoadAttachment,
}: {
  attachment: IssueAttachment;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    setFailed(false);
    void onLoadAttachment(attachment)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, onLoadAttachment]);
  const isImage = attachment.contentType.startsWith("image/");
  return (
    <article className="run-attachment">
      <div className="run-attachment-media">
        {source && isImage && <img alt={attachment.filename} src={source} />}
        {source && !isImage && <video controls preload="metadata" src={source} />}
        {!source && !failed && (isImage ? <ImageIcon size={22} /> : <Video size={22} />)}
        {failed && <CircleAlert size={20} />}
      </div>
      <span><strong>{attachment.filename}</strong><small>{failed ? t("run.loadFailed") : formatAttachmentBytes(attachment.byteSize)}</small></span>
      {source && <a download={attachment.filename} href={source}>{t("common.open")}</a>}
    </article>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];
const builtInStageIds = new Set(["analyzing", "planning", "implementing", "reviewing", "pr_open", "local_qa", "ci_qa", "staging_qa", "production_qa", "monitoring"]);

function localizeStatus(t: Translate, status: HuntRun["status"], workflowStage: string | null, fallback: string) {
  if (status === "running" && workflowStage && builtInStageIds.has(workflowStage)) return t(`stage.${workflowStage}` as MessageKey);
  return t(`status.${status}` as MessageKey) || fallback;
}

function localizeEvent(t: Translate, status: HuntRun["status"], workflowStage: string | null, fallback: string) {
  if (workflowStage && builtInStageIds.has(workflowStage)) return t(`stage.${workflowStage}` as MessageKey);
  return t(`status.${status}` as MessageKey) || fallback;
}

function relativeTime(value: string, t: Translate) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  if (minutes < 1_440) return t("time.hoursAgo", { count: Math.floor(minutes / 60) });
  return t("time.daysAgo", { count: Math.floor(minutes / 1_440) });
}

function formatDate(value: string, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
