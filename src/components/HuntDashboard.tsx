import {
  Activity,
  ArrowLeft,
  AtSign,
  Bold,
  Bot,
  ChevronRight,
  CircleAlert,
  Clock3,
  Code2,
  Columns3,
  FolderGit2,
  GitCommitHorizontal,
  GitFork,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Signal,
  Smile,
  Terminal,
  Trash2,
  UserRound,
  Video,
  Wrench,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { JellySelect } from "./JellySelect";
import {
  CompanionBottomNavigation,
  type CompanionStatusFilter,
} from "./CompanionBottomNavigation";
import { eventMeta, runMeta } from "../lib/stages";
import {
  formatAttachmentBytes,
  issueAttachmentAccept,
  maxIssueAttachmentCount,
  validateIssueAttachments,
} from "../lib/issue-attachments";
import { briarMentionAtCaret } from "../lib/issue-agent-reply";
import type { AutoHuntHealth } from "../lib/project-connection";
import type {
  CreateIssueInput,
  DashboardPayload,
  HuntRun,
  HuntRunPlacement,
  HuntSource,
  IssueAttachment,
  IssueMessage,
  IssueMessageSendResult,
} from "../types";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

type SourceFilter = "all" | HuntSource;
type StatusFilter = CompanionStatusFilter;
type DashboardView = "kanban" | "list";
type KanbanColumn = {
  id: string;
  label: string;
  tone: string;
  placement: HuntRunPlacement;
  runs: HuntRun[];
};

export function HuntDashboard({
  companionMode = false,
  companionStatus,
  companionUnreadInboxCount = 0,
  dashboard,
  error,
  health,
  healthError,
  healthLoading,
  isCreatingIssue,
  needsLocalConnection = false,
  recoveringRunId,
  recoveryError,
  isSidebarOpen,
  onConnectRepository,
  onCreateIssue,
  onHealthRefresh,
  onLoadAttachment,
  onLoadIssueMessages,
  onMoveRun,
  onReconnect,
  onRetryRun,
  onCancelRun,
  onCompanionInboxOpen,
  onCompanionStatusChange,
  onRepair,
  onRequestedRunOpen,
  onSendIssueMessage,
  requestedRunId = null,
}: {
  companionMode?: boolean;
  companionStatus?: CompanionStatusFilter;
  companionUnreadInboxCount?: number;
  dashboard: DashboardPayload | null;
  error: string | null;
  health: AutoHuntHealth | null;
  healthError: string | null;
  healthLoading: boolean;
  isCreatingIssue: boolean;
  needsLocalConnection?: boolean;
  recoveringRunId: string | null;
  recoveryError: string | null;
  isSidebarOpen: boolean;
  onConnectRepository?: () => void;
  onCreateIssue: (input: CreateIssueInput) => Promise<unknown>;
  onHealthRefresh: () => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: (runId: string) => Promise<IssueMessage[]>;
  onMoveRun: (runId: string, placement: HuntRunPlacement) => Promise<unknown>;
  onReconnect: () => void;
  onRetryRun: (runId: string) => Promise<unknown>;
  onCancelRun: (runId: string) => Promise<unknown>;
  onCompanionInboxOpen?: () => void;
  onCompanionStatusChange?: (status: CompanionStatusFilter) => void;
  onRepair: () => void;
  onRequestedRunOpen?: () => void;
  onSendIssueMessage: (
    runId: string,
    input: { body: string; parentMessageId: string | null },
  ) => Promise<IssueMessageSendResult>;
  requestedRunId?: string | null;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [view, setView] = useState<DashboardView>("kanban");
  const [internalStatus, setInternalStatus] = useState<StatusFilter>("all");
  const status = companionMode && companionStatus
    ? companionStatus
    : internalStatus;
  const setStatus = companionMode && onCompanionStatusChange
    ? onCompanionStatusChange
    : setInternalStatus;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [draggedRunId, setDraggedRunId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const runs = dashboard?.runs ?? [];
  const selected = runs.find((run) => run.id === selectedRunId) ?? null;
  const activeCount = runs.filter((run) => !["completed", "cancelled"].includes(run.status)).length;
  const attentionCount = runs.filter((run) => ["blocked", "failed"].includes(run.status)).length;
  const completedCount = runs.filter((run) =>
    ["completed", "cancelled"].includes(run.status)
  ).length;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (source !== "all" && run.source !== source) return false;
      if (status === "active" && ["completed", "cancelled"].includes(run.status)) return false;
      if (status === "attention" && !["blocked", "failed"].includes(run.status)) return false;
      if (
        status === "completed" &&
        !["completed", "cancelled"].includes(run.status)
      ) return false;
      return !normalized || `${run.title} ${run.sourceKey} ${run.repository}`.toLowerCase().includes(normalized);
    });
  }, [query, runs, source, status]);

  useEffect(() => {
    if (!requestedRunId) return;
    if (!runs.some((run) => run.id === requestedRunId)) return;
    setSelectedRunId(requestedRunId);
    onRequestedRunOpen?.();
  }, [onRequestedRunOpen, requestedRunId, runs]);

  const kanbanColumns = useMemo<KanbanColumn[]>(() => {
    const workflow = dashboard?.settings.workflow;
    const workflowStages = workflow?.stages ?? [];
    const definitions = [
      {
        id: "status:queued",
        label: t("status.queued"),
        tone: "slate",
        placement: { status: "queued" as const, workflowStage: null },
      },
      ...workflowStages.map((stage) => ({
        id: `stage:${stage.id}`,
        label: localizeWorkflowStage(t, stage.id, stage.label),
        tone: runMeta("running", stage.id, workflow).tone,
        placement: { status: "running" as const, workflowStage: stage.id },
      })),
      {
        id: "status:blocked",
        label: t("status.blocked"),
        tone: "rose",
        placement: { status: "blocked" as const, workflowStage: null },
      },
      {
        id: "status:failed",
        label: t("status.failed"),
        tone: "red",
        placement: { status: "failed" as const, workflowStage: null },
      },
      {
        id: "status:completed",
        label: t("status.completed"),
        tone: "emerald",
        placement: { status: "completed" as const, workflowStage: null },
      },
      {
        id: "status:cancelled",
        label: t("status.cancelled"),
        tone: "slate",
        placement: { status: "cancelled" as const, workflowStage: null },
      },
    ];
    const visibleDefinitions = definitions.filter((column) => {
      if (status === "active") {
        return !["status:completed", "status:cancelled"].includes(column.id);
      }
      if (status === "attention") {
        return ["status:blocked", "status:failed"].includes(column.id);
      }
      if (status === "completed") {
        return ["status:completed", "status:cancelled"].includes(column.id);
      }
      return true;
    });
    const grouped = new Map(
      visibleDefinitions.map((column) => [column.id, [] as HuntRun[]]),
    );
    for (const run of filtered) {
      const columnId = kanbanColumnForRun(run, workflowStages.map((stage) => stage.id));
      grouped.get(columnId)?.push(run);
    }
    const columns = visibleDefinitions.map((column) => ({
      ...column,
      runs: grouped.get(column.id) ?? [],
    }));
    return companionMode
      ? columns.filter((column) => column.runs.length > 0)
      : columns;
  }, [companionMode, dashboard?.settings.workflow, filtered, status, t]);

  if (selected) {
    return (
      <RunPage
        companionMode={companionMode}
        error={recoveryError}
        isRecovering={recoveringRunId === selected.id}
        isSidebarOpen={isSidebarOpen}
        onBack={() => setSelectedRunId(null)}
        onCancel={() => onCancelRun(selected.id)}
        onLoadAttachment={onLoadAttachment}
        onLoadIssueMessages={() => onLoadIssueMessages(selected.id)}
        onMove={(placement) => onMoveRun(selected.id, placement)}
        onRetry={() => onRetryRun(selected.id)}
        onSendIssueMessage={(input) => onSendIssueMessage(selected.id, input)}
        run={selected}
      />
    );
  }

  return (
    <main className="main-content" id="issues">
      {!companionMode && <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region>
        <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
        <ConnectionHealth
          error={healthError}
          health={health}
          loading={healthLoading}
          onReconnect={onReconnect}
          onRefresh={onHealthRefresh}
          onRepair={onRepair}
        />
      </header>}
      <div className="dashboard-scroll">
        {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
        {needsLocalConnection && (
          <div className="connect-banner">
            <span aria-hidden="true"><FolderGit2 size={16} /></span>
            <div>
              <strong>{t("dashboard.connectRepositoryTitle")}</strong>
              <small>{t("dashboard.connectRepositoryDescription")}</small>
            </div>
            <button onClick={onConnectRepository} type="button">
              <FolderGit2 size={13} />{t("dashboard.connectRepository")}
            </button>
          </div>
        )}

        <div className="queue-header">
          <div>
            <h2>{t("dashboard.queue")}</h2>
            <span>{t("dashboard.taskCount", { count: filtered.length })}</span>
          </div>
          <div className="queue-tools">
            {!companionMode && (
              <button
                aria-label={t("dashboard.createIssue")}
                className="create-issue-button"
                onClick={() => setIsIssueDialogOpen(true)}
                type="button"
              >
                <Plus size={14} />{t("dashboard.createIssue")}
              </button>
            )}
            <label className="search-box"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("dashboard.search")} /></label>
            <div className="source-filter">
              {(["all", "issue", "feedback", "error"] as const).map((value) => (
                <button key={value} className={source === value ? "active" : ""} onClick={() => setSource(value)}>
                  {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
                </button>
              ))}
            </div>
            {!companionMode && (
              <div
                aria-label={t("dashboard.viewMode")}
                className="view-switch"
                role="group"
              >
                <button
                  aria-label={t("dashboard.kanbanView")}
                  aria-pressed={view === "kanban"}
                  className={view === "kanban" ? "active" : ""}
                  onClick={() => setView("kanban")}
                  title={t("dashboard.kanbanView")}
                  type="button"
                >
                  <Columns3 size={14} />
                  <span>{t("dashboard.kanban")}</span>
                </button>
                <button
                  aria-label={t("dashboard.listView")}
                  aria-pressed={view === "list"}
                  className={view === "list" ? "active" : ""}
                  onClick={() => setView("list")}
                  title={t("dashboard.listView")}
                  type="button"
                >
                  <List size={14} />
                  <span>{t("dashboard.list")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
        {!companionMode && <div className="status-tabs">
          <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>{t("dashboard.all")} <span>{runs.length}</span></button>
          <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>{t("dashboard.active")} <span>{activeCount}</span></button>
          <button className={status === "attention" ? "active" : ""} onClick={() => setStatus("attention")}>{t("dashboard.attention")} <span>{attentionCount}</span></button>
          <button className={status === "completed" ? "active" : ""} onClick={() => setStatus("completed")}>{t("dashboard.completed")} <span>{completedCount}</span></button>
        </div>}
        {view === "list" && !companionMode ? (
          <IssueList
            onOpen={(runId) => setSelectedRunId(runId)}
            runs={filtered}
          />
        ) : <div aria-label={t("dashboard.kanbanBoard")} className="kanban-board">
          {kanbanColumns.length === 0 ? (
            <div className="companion-no-runs">
              <Bot size={22} />
              <strong>{t("dashboard.emptyTitle")}</strong>
              <span>{t("dashboard.emptyDescription")}</span>
            </div>
          ) : kanbanColumns.map((column) => (
            <section
              aria-label={column.label}
              className={`kanban-column ${column.tone}${dragOverColumnId === column.id ? " drag-over" : ""}`}
              key={column.id}
              onDragEnter={(event) => {
                if (!draggedRunId) return;
                event.preventDefault();
                setDragOverColumnId(column.id);
              }}
              onDragOver={(event) => {
                if (!draggedRunId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragLeave={(event) => {
                if (
                  event.currentTarget.contains(event.relatedTarget as Node | null)
                ) return;
                setDragOverColumnId((current) =>
                  current === column.id ? null : current
                );
              }}
              onDrop={(event) => {
                event.preventDefault();
                const runId =
                  draggedRunId || event.dataTransfer.getData("text/plain");
                setDraggedRunId(null);
                setDragOverColumnId(null);
                const run = runs.find((candidate) => candidate.id === runId);
                if (!run || placementMatchesRun(run, column.placement)) return;
                void onMoveRun(run.id, column.placement).catch(() => undefined);
              }}
            >
              <header>
                <span><i aria-hidden="true" />{column.label}</span>
                <strong>{column.runs.length}</strong>
              </header>
              <div>
                {column.runs.length ? column.runs.map((run) => (
                  <KanbanCard
                    isMoving={recoveringRunId === run.id}
                    key={run.id}
                    onDragEnd={() => {
                      setDraggedRunId(null);
                      setDragOverColumnId(null);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", run.id);
                      setDraggedRunId(run.id);
                    }}
                    onOpen={() => setSelectedRunId(run.id)}
                    run={run}
                  />
                )) : (
                  <div className="kanban-column-empty">
                    <Bot size={18} />
                    <span>{t("dashboard.columnEmpty")}</span>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>}
      </div>
      {companionMode && (
        <CompanionBottomNavigation
          activeDestination={status}
          onCreate={() => setIsIssueDialogOpen(true)}
          onInboxOpen={() => onCompanionInboxOpen?.()}
          onStatusChange={setStatus}
          unreadInboxCount={companionUnreadInboxCount}
        />
      )}
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

function KanbanCard({
  isMoving,
  onDragEnd,
  onDragStart,
  run,
  onOpen,
}: {
  isMoving: boolean;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  run: HuntRun;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const isClaimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  return (
    <button
      aria-label={t("run.details", { title: run.title })}
      aria-disabled={isMoving}
      className={`kanban-card ${meta.tone}${isMoving ? " moving" : ""}`}
      draggable={!isMoving}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      onClick={onOpen}
      type="button"
    >
      <span className="kanban-card-kicker">
        <small>AH-{run.runNumber}</small>
        <i><span className={`source-dot ${run.source}`} />{t(`source.${run.source}` as MessageKey)}</i>
      </span>
      <span className="kanban-card-copy">
        <strong>{run.title}</strong>
        {(run.detail || run.issueDescription) && (
          <span>{run.detail || run.issueDescription}</span>
        )}
      </span>
      <span className="kanban-card-badges">
        <i className={`status-pill ${meta.tone}`}>{run.status === "running" && <LoaderCircle className="spin" size={11} />}{label}</i>
        <i className="kanban-progress">{run.progress}%</i>
        {run.priority !== null && <i className="kanban-priority">P{run.priority}</i>}
        {(run.attachments ?? []).length > 0 && <i><Paperclip size={11} />{run.attachments.length}</i>}
      </span>
      <span className="kanban-card-footer">
        <small>{isClaimed ? t("run.assigned", { agent: run.claimedBy ?? "agent" }) : relativeTime(run.updatedAt, t)}</small>
        <ChevronRight size={14} />
      </span>
    </button>
  );
}

function IssueList({
  onOpen,
  runs,
}: {
  onOpen: (runId: string) => void;
  runs: HuntRun[];
}) {
  const { t } = useI18n();

  return (
    <div
      aria-label={t("dashboard.issueList")}
      className="issue-list"
      role="table"
    >
      <div className="issue-list-grid issue-list-header" role="row">
        <span role="columnheader">{t("dashboard.task")}</span>
        <span role="columnheader">{t("dashboard.status")}</span>
        <span role="columnheader">{t("issue.priority")}</span>
        <span role="columnheader">{t("dashboard.progress")}</span>
        <span role="columnheader">{t("dashboard.updated")}</span>
        <span aria-hidden="true" />
      </div>
      <div className="issue-list-body" role="rowgroup">
        {runs.length === 0 ? (
          <div className="issue-list-empty">
            <Bot size={22} />
            <strong>{t("dashboard.emptyTitle")}</strong>
            <span>{t("dashboard.emptyDescription")}</span>
          </div>
        ) : runs.map((run) => {
          const meta = runMeta(
            run.status,
            run.workflowStage,
            run.workflow,
          );
          const label = localizeStatus(
            t,
            run.status,
            run.workflowStage,
            meta.label,
          );
          const isClaimed =
            run.status === "queued" &&
            Boolean(run.leaseExpiresAt) &&
            Date.parse(run.leaseExpiresAt!) > Date.now();

          return (
            <div
              aria-label={t("run.details", { title: run.title })}
              className="issue-list-grid issue-list-row"
              key={run.id}
              onClick={() => onOpen(run.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpen(run.id);
              }}
              role="row"
              tabIndex={0}
            >
              <span className="issue-list-task" role="cell">
                <small>AH-{run.runNumber} · {run.sourceKey}</small>
                <strong>{run.title}</strong>
                {(run.detail || run.issueDescription) && (
                  <span>{run.detail || run.issueDescription}</span>
                )}
              </span>
              <span className="issue-list-status" role="cell">
                <i className={`status-pill ${meta.tone}`}>
                  {run.status === "running" && (
                    <LoaderCircle className="spin" size={11} />
                  )}
                  {label}
                </i>
                <small>
                  <i className={`source-dot ${run.source}`} />
                  {t(`source.${run.source}` as MessageKey)}
                </small>
              </span>
              <span className="issue-list-priority" role="cell">
                {run.priority === null ? "—" : `P${run.priority}`}
              </span>
              <span className="issue-list-progress" role="cell">
                <span aria-hidden="true">
                  <i style={{ width: `${run.progress}%` }} />
                </span>
                <strong>{run.progress}%</strong>
              </span>
              <span className="issue-list-updated" role="cell">
                {isClaimed
                  ? t("run.assigned", { agent: run.claimedBy ?? "agent" })
                  : relativeTime(run.updatedAt, t)}
              </span>
              <ChevronRight aria-hidden="true" size={15} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RunPage({
  companionMode = false,
  error,
  isRecovering,
  isSidebarOpen,
  onBack,
  onCancel,
  onLoadAttachment,
  onLoadIssueMessages,
  onMove,
  onRetry,
  onSendIssueMessage,
  run,
}: {
  companionMode?: boolean;
  error: string | null;
  isRecovering: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onCancel: () => Promise<unknown>;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: () => Promise<IssueMessage[]>;
  onMove: (placement: HuntRunPlacement) => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  onSendIssueMessage: (input: {
    body: string;
    parentMessageId: string | null;
  }) => Promise<IssueMessageSendResult>;
  run: HuntRun;
}) {
  const { localeTag, t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const needsAttention = ["blocked", "failed"].includes(run.status);
  const priorityLabel = run.priority === null
    ? t("run.notSet")
    : t(`issue.priority${run.priority}` as MessageKey);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [contentSplit, setContentSplit] = useState(50);
  const [isResizingContent, setIsResizingContent] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeResizePointerRef = useRef<number | null>(null);
  const resizeGrabOffsetRef = useRef(0);
  const placementOptions = [
    { label: t("status.queued"), value: "status:queued" },
    ...run.workflow.stages.map((stage) => ({
      label: localizeWorkflowStage(t, stage.id, stage.label),
      value: `stage:${stage.id}`,
    })),
    { label: t("status.blocked"), value: "status:blocked" },
    { label: t("status.failed"), value: "status:failed" },
    { label: t("status.completed"), value: "status:completed" },
    { label: t("status.cancelled"), value: "status:cancelled" },
  ];
  const placementValue = placementIdForRun(run);
  const issueContent = run.issueDescription || run.detail;
  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setConfirmCancel(false);
    } catch {
      // The hook exposes the actionable error on this page.
    }
  };
  const clampContentSplit = (value: number) =>
    Math.min(80, Math.max(20, value));
  const updateContentSplitFromPointer = (clientY: number) => {
    const content = contentRef.current;
    if (!content) return;
    const bounds = content.getBoundingClientRect();
    const availableHeight = Math.max(1, bounds.height - 12);
    const dividerTop =
      clientY - bounds.top - resizeGrabOffsetRef.current;
    setContentSplit(
      clampContentSplit(Math.round((dividerTop / availableHeight) * 100)),
    );
  };
  const startContentResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const dividerBounds = event.currentTarget.getBoundingClientRect();
    activeResizePointerRef.current = event.pointerId;
    resizeGrabOffsetRef.current = event.clientY - dividerBounds.top;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingContent(true);
    event.preventDefault();
  };
  const moveContentResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activeResizePointerRef.current !== event.pointerId) return;
    updateContentSplitFromPointer(event.clientY);
  };
  const finishContentResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activeResizePointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeResizePointerRef.current = null;
    setIsResizingContent(false);
  };
  const resizeContentWithKeyboard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    let nextSplit: number | null = null;
    if (event.key === "ArrowUp") nextSplit = contentSplit - 5;
    if (event.key === "ArrowDown") nextSplit = contentSplit + 5;
    if (event.key === "Home") nextSplit = 20;
    if (event.key === "End") nextSplit = 80;
    if (nextSplit === null) return;
    event.preventDefault();
    setContentSplit(clampContentSplit(nextSplit));
  };
  return (
    <main className="main-content run-page-shell" id="issue-detail">
      {!companionMode && (
        <header
          className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
          data-tauri-drag-region
        >
          <button
            aria-label={t("run.back")}
            className="run-page-titlebar-back"
            onClick={onBack}
            title={t("run.back")}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={16} />
          </button>
          <small
            className="run-page-window-number"
            data-tauri-drag-region
          >
            AH-{run.runNumber}
          </small>
          <strong
            className="run-page-window-title"
            data-tauri-drag-region
            id="run-page-title"
            title={run.title}
          >
            {run.title}
          </strong>
        </header>
      )}
      <div className="run-page-scroll">
        <article
          aria-labelledby="run-page-title"
          className="run-page"
        >
          <header>
            {companionMode ? (
              <>
                <div className="run-page-heading">
                  <button
                    className="run-page-back"
                    onClick={onBack}
                    type="button"
                  >
                    <ArrowLeft size={16} />
                    {t("run.back")}
                  </button>
                  <div className="run-page-overview">
                    <div className="run-page-title-row">
                      <small>AH-{run.runNumber}</small>
                      <h1 id="run-page-title">{run.title}</h1>
                    </div>
                  </div>
                  <div className="run-page-meta">
                    <span className={`status-pill ${meta.tone}`}>{label}</span>
                    <small>
                      {t("run.attempt", { count: run.currentAttempt })}
                    </small>
                  </div>
                </div>
                <div className="run-page-summary">
                  <IssueActivity run={run} />
                </div>
              </>
            ) : (
              <div className="run-page-summary">
                <IssueActivity run={run} />
                <div className="run-page-meta">
                  <span className={`status-pill ${meta.tone}`}>{label}</span>
                  <small>
                    {t("run.attempt", { count: run.currentAttempt })}
                  </small>
                </div>
              </div>
            )}
          </header>
          <div className="run-page-body">
            <div className="run-page-layout">
              <div
                className={`run-page-content${isResizingContent ? " is-resizing" : ""}`}
                ref={contentRef}
                style={{
                  gridTemplateRows: `minmax(96px,${contentSplit}fr) 12px minmax(220px,${100 - contentSplit}fr)`,
                }}
              >
                <section
                  aria-label={t("issue.description")}
                  className="issue-description-pane"
                >
                  <div className="issue-description-scroll">
                    {issueContent ? (
                      <div className="issue-description-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          skipHtml
                        >
                          {issueContent}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="issue-description-empty">{t("run.notSet")}</p>
                    )}
                    {(run.attachments ?? []).length > 0 && (
                      <IssueAttachmentGallery
                        attachments={run.attachments ?? []}
                        onLoadAttachment={onLoadAttachment}
                      />
                    )}
                    {needsAttention && (
                      <div className="recovery-panel">
                        <div><CircleAlert size={16} /><span><strong>{run.status === "failed" ? t("run.failed") : t("run.blocked")}</strong><small>{t("run.retryDescription", { count: run.currentAttempt + 1 })}</small></span></div>
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
                  </div>
                </section>
                <div
                  aria-label={t("run.resizeContentPanels")}
                  aria-orientation="horizontal"
                  aria-valuemax={80}
                  aria-valuemin={20}
                  aria-valuenow={contentSplit}
                  className="issue-content-divider"
                  onKeyDown={resizeContentWithKeyboard}
                  onPointerCancel={finishContentResize}
                  onPointerDown={startContentResize}
                  onPointerMove={moveContentResize}
                  onPointerUp={finishContentResize}
                  role="separator"
                  tabIndex={0}
                />
                <IssueConversation
                  onLoad={onLoadIssueMessages}
                  onSend={onSendIssueMessage}
                  run={run}
                />
              </div>
              <aside aria-label={t("run.properties")} className="run-properties">
                <section>
                  <h2>{t("run.properties")}</h2>
                  <label className="run-property run-status-control">
                    <span className={`run-property-icon ${meta.tone}`}><Activity size={15} /></span>
                    <span className="run-property-copy">
                      <small>{t("dashboard.status")}</small>
                      <select
                        aria-label={t("dashboard.status")}
                        disabled={isRecovering}
                        onChange={(event) => {
                          const placement = placementForId(event.currentTarget.value);
                          if (!placement || placementMatchesRun(run, placement)) return;
                          void runAction(() => onMove(placement));
                        }}
                        value={placementValue}
                      >
                        {placementOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </span>
                    {isRecovering && <LoaderCircle className="spin" size={14} />}
                  </label>
                  {error && <p className="run-status-error"><CircleAlert size={13} />{error}</p>}
                  <div className="run-property">
                    <span className="run-property-icon priority"><Signal size={15} /></span>
                    <span className="run-property-copy"><small>{t("issue.priority")}</small><strong>{priorityLabel}</strong></span>
                  </div>
                  <div className="run-property">
                    <span className="run-property-icon assignee"><UserRound size={15} /></span>
                    <span className="run-property-copy"><small>{t("run.assignee")}</small><strong>{run.claimedBy ?? t("run.unassigned")}</strong></span>
                  </div>
                  <div className="run-property">
                    <span className="run-property-icon agent"><Bot size={15} /></span>
                    <span className="run-property-copy"><small>{t("run.agent")}</small><strong>Agent backend</strong></span>
                  </div>
                  <div className="run-property">
                    <span className="run-property-icon attempt"><RotateCcw size={15} /></span>
                    <span className="run-property-copy"><small>{t("run.currentAttempt")}</small><strong>{t("run.attempt", { count: run.currentAttempt })}</strong></span>
                  </div>
                </section>
                <section>
                  <h2>{t("run.repository")}</h2>
                  <div className="run-property">
                    <span className="run-property-icon repository"><FolderGit2 size={15} /></span>
                    <span className="run-property-copy"><small>{t("run.repository")}</small><strong title={run.repository}>{run.repository}</strong></span>
                  </div>
                  <div className="run-property">
                    <span className="run-property-icon source"><span className={`source-dot ${run.source}`} /></span>
                    <span className="run-property-copy"><small>{t("run.source")}</small><strong>{t(`source.${run.source}` as MessageKey)}</strong></span>
                  </div>
                  <div className="run-property">
                    <span className="run-property-icon"><GitFork size={15} /></span>
                    <span className="run-property-copy"><small>{t("run.branch")}</small><strong title={run.branch ?? undefined}>{run.branch ?? "—"}</strong></span>
                  </div>
                  <div className="run-property">
                    <span className="run-property-icon"><GitCommitHorizontal size={15} /></span>
                    <span className="run-property-copy"><small>{t("run.commit")}</small><strong title={run.commitSha ?? undefined}>{run.commitSha ?? "—"}</strong></span>
                  </div>
                  <div className="run-property">
                    <span className="run-property-icon"><Clock3 size={15} /></span>
                    <span className="run-property-copy"><small>{t("run.started")}</small><strong>{formatDate(run.startedAt, localeTag)}</strong></span>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}

function IssueActivity({ run }: { run: HuntRun }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const latestEvent = run.events[0] ?? null;
  const latestDisplay = latestEvent
    ? eventMeta(latestEvent.status, latestEvent.workflowStage, run.workflow)
    : runMeta(run.status, run.workflowStage, run.workflow);
  const latestLabel = latestEvent
    ? localizeEvent(
        t,
        latestEvent.status,
        latestEvent.workflowStage,
        latestDisplay.label,
      )
    : localizeStatus(t, run.status, run.workflowStage, latestDisplay.label);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      triggerRef.current?.focus();
    };
  }, [isOpen]);

  return (
    <div className="issue-activity">
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("run.openStatusHistory")}
        className="issue-activity-trigger"
        onClick={() => setIsOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <span className={`issue-activity-dot ${latestDisplay.tone}`} />
        <span className="issue-activity-latest">
          <strong>{latestLabel}</strong>
          <small>
            {latestEvent
              ? `${t("run.attempt", { count: latestEvent.attempt })} · ${relativeTime(latestEvent.occurredAt, t)}`
              : t("run.notSet")}
          </small>
        </span>
        <ChevronRight aria-hidden="true" size={15} />
      </button>
      {isOpen && (
        <div
          className="dialog-backdrop issue-activity-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="issue-activity-dialog-title"
            aria-modal="true"
            className="issue-activity-dialog"
            role="dialog"
          >
            <header>
              <div>
                <span className="issue-activity-dialog-icon">
                  <Activity aria-hidden="true" size={16} />
                </span>
                <span>
                  <h2 id="issue-activity-dialog-title">
                    {t("run.statusHistory")}
                  </h2>
                  <small>
                    {t("run.activityCount", { count: run.events.length })}
                  </small>
                </span>
              </div>
              <button
                aria-label={t("common.close")}
                onClick={() => setIsOpen(false)}
                ref={closeRef}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </header>
            <div className="issue-activity-history">
              {run.events.length > 0 ? (
                run.events.map((event) => {
                  const display = eventMeta(
                    event.status,
                    event.workflowStage,
                    run.workflow,
                  );
                  return (
                    <div className="timeline-event" key={event.id}>
                      <i className={display.tone} />
                      <span>
                        <strong>
                          {localizeEvent(
                            t,
                            event.status,
                            event.workflowStage,
                            display.label,
                          )}{" "}
                          <em>
                            {t("run.attempt", { count: event.attempt })}
                          </em>
                        </strong>
                        {event.detail && <p>{event.detail}</p>}
                        <small>
                          {event.actor} · {relativeTime(event.occurredAt, t)}
                        </small>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="issue-activity-empty">{t("run.activityEmpty")}</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function IssueConversation({
  onLoad,
  onSend,
  run,
}: {
  onLoad: () => Promise<IssueMessage[]>;
  onSend: (input: {
    body: string;
    parentMessageId: string | null;
  }) => Promise<IssueMessageSendResult>;
  run: HuntRun;
}) {
  const { localeTag, t } = useI18n();
  const [messages, setMessages] = useState<IssueMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentReplyError, setAgentReplyError] = useState<string | null>(null);
  const [agentReplying, setAgentReplying] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const threadContentRef = useRef<HTMLDivElement | null>(null);
  const threadTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMessages(await onLoad());
    } catch {
      setLoadError(t("run.messagesLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [onLoad, t]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!activeThreadId) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActiveThreadId(null);
      threadTriggerRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeThreadId]);

  const roots = messages.filter((message) => message.parentMessageId === null);
  const repliesByRootId = useMemo(() => {
    const grouped = new Map<string, IssueMessage[]>();
    for (const message of messages) {
      if (!message.parentMessageId) continue;
      const threadReplies = grouped.get(message.parentMessageId) ?? [];
      threadReplies.push(message);
      grouped.set(message.parentMessageId, threadReplies);
    }
    return grouped;
  }, [messages]);
  const activeThread =
    roots.find((message) => message.id === activeThreadId) ?? null;
  const replies = activeThread
    ? repliesByRootId.get(activeThread.id) ?? []
    : [];

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [agentReplying, loading, messages.length]);

  useLayoutEffect(() => {
    const threadContent = threadContentRef.current;
    if (activeThread && threadContent) {
      threadContent.scrollTop = threadContent.scrollHeight;
    }
  }, [activeThreadId, replies.length]);

  const openThread = (messageId: string, trigger: HTMLButtonElement) => {
    threadTriggerRef.current = trigger;
    setActiveThreadId(messageId);
  };
  const closeThread = () => {
    setActiveThreadId(null);
    threadTriggerRef.current?.focus();
  };
  const sendMessage = async (
    body: string,
    parentMessageId: string | null,
  ) => {
    const appendMessage = (message: IssueMessage) =>
      setMessages((current) => [
        ...current.map((candidate) =>
          candidate.id === message.parentMessageId
            ? { ...candidate, replyCount: candidate.replyCount + 1 }
            : candidate,
        ),
        message,
      ]);
    setAgentReplyError(null);
    const result = await onSend({ body, parentMessageId });
    appendMessage(result.message);
    if (!result.agentReply) return;
    setAgentReplying(true);
    void result.agentReply
      .then(appendMessage)
      .catch((caught: unknown) => {
        setAgentReplyError(
          caught instanceof Error ? caught.message : String(caught),
        );
      })
      .finally(() => setAgentReplying(false));
  };

  return (
    <section className="issue-conversation" aria-labelledby="issue-messages-title">
      <header>
        <span>
          <MessageCircle aria-hidden="true" size={16} />
          <h2 id="issue-messages-title">{t("run.messages")}</h2>
        </span>
        {roots.length > 0 && <small>{roots.length}</small>}
      </header>
      <div className="issue-message-list" ref={messageListRef}>
        {loading ? (
          <div className="issue-message-state">
            <LoaderCircle className="spin" size={16} />
            {t("run.messagesLoading")}
          </div>
        ) : loadError ? (
          <button
            className="issue-message-state error"
            onClick={() => void loadMessages()}
            type="button"
          >
            <CircleAlert size={15} />
            {loadError}
          </button>
        ) : roots.length === 0 ? (
          <p className="issue-message-empty">{t("run.messagesEmpty")}</p>
        ) : (
          roots.map((message) => (
            <IssueMessageItem
              key={message.id}
              localeTag={localeTag}
              message={message}
              onOpenThread={openThread}
              threadReplies={repliesByRootId.get(message.id) ?? []}
            />
          ))
        )}
        {agentReplying && (
          <div className="issue-agent-reply-state">
            <LoaderCircle className="spin" size={14} />
            {t("run.briarReplying")}
          </div>
        )}
        {agentReplyError && (
          <div className="issue-agent-reply-state error">
            <CircleAlert size={14} />
            {t("run.briarReplyFailed", { error: agentReplyError })}
          </div>
        )}
      </div>
      <MessageComposer
        onSubmit={(body) => sendMessage(body, null)}
        placeholder={t("run.messagePlaceholder", { title: run.title })}
      />
      <div
        aria-hidden={activeThread === null}
        className={`issue-thread-layer${activeThread ? " open" : ""}`}
      >
        <aside
          aria-label={t("run.thread")}
          className="issue-thread-drawer"
          role={activeThread ? "dialog" : undefined}
        >
          <header>
            <div>
              <strong>{t("run.thread")}</strong>
              {activeThread && (
                <small>{t("run.replies", { count: replies.length })}</small>
              )}
            </div>
            <button
              aria-label={t("common.close")}
              onClick={closeThread}
              ref={closeButtonRef}
              type="button"
            >
              <X size={18} />
            </button>
          </header>
          <div className="issue-thread-content" ref={threadContentRef}>
            {activeThread && (
              <>
                <IssueMessageItem
                  localeTag={localeTag}
                  message={activeThread}
                />
                <div className="issue-thread-divider">
                  <span>{t("run.replies", { count: replies.length })}</span>
                </div>
                {replies.map((message) => (
                  <IssueMessageItem
                    key={message.id}
                    localeTag={localeTag}
                    message={message}
                  />
                ))}
              </>
            )}
          </div>
          {activeThread && (
            <MessageComposer
              compact
              onSubmit={(body) => sendMessage(body, activeThread.id)}
              placeholder={t("run.threadPlaceholder")}
            />
          )}
        </aside>
      </div>
    </section>
  );
}

function IssueMessageItem({
  localeTag,
  message,
  onOpenThread,
  threadReplies = [],
}: {
  localeTag: string;
  message: IssueMessage;
  onOpenThread?: (messageId: string, trigger: HTMLButtonElement) => void;
  threadReplies?: IssueMessage[];
}) {
  const { t } = useI18n();
  const threadParticipants = uniqueThreadParticipants(threadReplies);
  return (
    <article className="issue-message">
      <MessageAvatar message={message} />
      <div>
        <header>
          <strong>{message.author.name}</strong>
          <time dateTime={message.createdAt}>
            {formatDate(message.createdAt, localeTag)}
          </time>
        </header>
        <p>{message.body}</p>
        {onOpenThread && message.replyCount > 0 && (
          <button
            className="issue-thread-summary"
            onClick={(event) =>
              onOpenThread(message.id, event.currentTarget)
            }
            title={t("run.replyInThread")}
            type="button"
          >
            <span aria-hidden="true" className="issue-thread-participants">
              {threadParticipants.map((participant) => (
                <ThreadParticipantAvatar
                  author={participant}
                  key={`${participant.provider ?? "user"}:${participant.id ?? participant.name}`}
                />
              ))}
            </span>
            <strong>{t("run.replies", { count: message.replyCount })}</strong>
            <span>{t("run.viewThread")}</span>
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        )}
      </div>
      {onOpenThread && message.replyCount === 0 && (
        <div
          aria-label={t("run.replyInThread")}
          className="issue-message-actions"
          role="toolbar"
        >
          <button
            aria-label={t("run.replyInThread")}
            className="issue-thread-trigger"
            onClick={(event) =>
              onOpenThread(message.id, event.currentTarget)
            }
            title={t("run.replyInThread")}
            type="button"
          >
            <MessageCircle aria-hidden="true" size={16} />
          </button>
        </div>
      )}
    </article>
  );
}

function uniqueThreadParticipants(replies: IssueMessage[]) {
  const participants: IssueMessage["author"][] = [];
  const seen = new Set<string>();
  for (let index = replies.length - 1; index >= 0; index -= 1) {
    const author = replies[index].author;
    const key = `${author.provider ?? "user"}:${author.id ?? author.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push(author);
    if (participants.length === 3) break;
  }
  return participants;
}

function ThreadParticipantAvatar({
  author,
}: {
  author: IssueMessage["author"];
}) {
  return (
    <span
      className={`issue-thread-participant${author.provider ? " agent" : ""}`}
      title={author.name}
    >
      {author.image ? (
        <img alt="" src={author.image} />
      ) : author.provider ? (
        <Bot aria-hidden="true" size={13} />
      ) : (
        author.name.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}

function MessageAvatar({ message }: { message: IssueMessage }) {
  if (message.author.provider) {
    return (
      <span
        aria-label={message.author.name}
        className="issue-message-avatar agent"
      >
        <Bot size={17} />
      </span>
    );
  }
  if (message.author.image) {
    return (
      <img
        alt=""
        className="issue-message-avatar"
        src={message.author.image}
      />
    );
  }
  return (
    <span aria-hidden="true" className="issue-message-avatar">
      {message.author.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function MessageComposer({
  compact = false,
  onSubmit,
  placeholder,
}: {
  compact?: boolean;
  onSubmit: (body: string) => Promise<void>;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionListId = useId();
  const activeMention = briarMentionAtCaret(body, caret);
  const showsMentionSuggestion =
    composerFocused && !mentionDismissed && activeMention !== null;
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const nextBody = body.trim();
    if (!nextBody || sending) return;
    setSending(true);
    setError(null);
    setBody("");
    setCaret(0);
    setMentionDismissed(false);
    try {
      await onSubmit(nextBody);
    } catch (caught) {
      setBody(nextBody);
      setCaret(nextBody.length);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  };
  const wrapSelection = (before: string, after = before) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    setBody(
      `${body.slice(0, selectionStart)}${before}${body.slice(
        selectionStart,
        selectionEnd,
      )}${after}${body.slice(selectionEnd)}`,
    );
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = selectionEnd + before.length + after.length;
      textarea.setSelectionRange(cursor, cursor);
      setCaret(cursor);
    });
  };
  const completeBriarMention = () => {
    const textarea = textareaRef.current;
    if (!textarea || !activeMention) return;
    const nextBody = `${body.slice(0, activeMention.start)}@briar ${body.slice(
      activeMention.end,
    )}`;
    const nextCaret = activeMention.start + "@briar ".length;
    setBody(nextBody);
    setCaret(nextCaret);
    setMentionDismissed(false);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };
  return (
    <form
      className={`issue-message-composer${compact ? " compact" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setComposerFocused(false);
        }
      }}
      onFocus={() => setComposerFocused(true)}
      onSubmit={(event) => void submit(event)}
    >
      <div className="issue-composer-formatting">
        <button
          aria-label={t("run.formatBold")}
          onClick={() => wrapSelection("**")}
          type="button"
        >
          <Bold size={15} />
        </button>
        <button
          aria-label={t("run.formatItalic")}
          onClick={() => wrapSelection("_")}
          type="button"
        >
          <Italic size={15} />
        </button>
        <button
          aria-label={t("run.formatLink")}
          onClick={() => wrapSelection("[", "](https://)")}
          type="button"
        >
          <Link2 size={15} />
        </button>
        <button
          aria-label={t("run.formatCode")}
          onClick={() => wrapSelection("`")}
          type="button"
        >
          <Code2 size={15} />
        </button>
      </div>
      {showsMentionSuggestion && (
        <div
          aria-label={t("run.mention")}
          className="issue-composer-mention-menu"
          id={mentionListId}
          role="listbox"
        >
          <button
            aria-selected="true"
            onClick={completeBriarMention}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
            type="button"
          >
            <span aria-hidden="true">
              <Bot size={14} />
            </span>
            <strong>@briar</strong>
          </button>
        </div>
      )}
      <textarea
        aria-autocomplete="list"
        aria-controls={showsMentionSuggestion ? mentionListId : undefined}
        aria-expanded={showsMentionSuggestion}
        aria-label={placeholder}
        disabled={sending}
        maxLength={10_000}
        onChange={(event) => {
          setBody(event.currentTarget.value);
          setCaret(event.currentTarget.selectionStart);
          setMentionDismissed(false);
        }}
        onKeyDown={(event) => {
          if (
            showsMentionSuggestion &&
            (event.key === "Tab" ||
              (event.key === "Enter" && !event.metaKey && !event.ctrlKey))
          ) {
            event.preventDefault();
            completeBriarMention();
            return;
          }
          if (showsMentionSuggestion && event.key === "Escape") {
            event.preventDefault();
            setMentionDismissed(true);
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void submit();
          }
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        placeholder={placeholder}
        ref={textareaRef}
        rows={compact ? 2 : 3}
        value={body}
      />
      <footer>
        <div>
          <button
            aria-label={t("run.emoji")}
            onClick={() => wrapSelection("🙂", "")}
            type="button"
          >
            <Smile size={16} />
          </button>
          <button
            aria-label={t("run.mention")}
            onClick={() => wrapSelection("@briar ", "")}
            type="button"
          >
            <AtSign size={16} />
          </button>
        </div>
        <button
          aria-label={sending ? t("run.sendingMessage") : t("run.sendMessage")}
          className="issue-message-send"
          disabled={!body.trim() || sending}
          type="submit"
        >
          {sending ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Send size={16} />
          )}
        </button>
      </footer>
      {error && (
        <p className="issue-composer-error">
          <CircleAlert size={13} />
          {error}
        </p>
      )}
    </form>
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

function kanbanColumnForRun(run: HuntRun, workflowStageIds: string[]) {
  if (run.status !== "running") return `status:${run.status}`;
  if (run.workflowStage && workflowStageIds.includes(run.workflowStage)) {
    return `stage:${run.workflowStage}`;
  }
  return workflowStageIds[0]
    ? `stage:${workflowStageIds[0]}`
    : "status:queued";
}

function placementIdForRun(run: HuntRun) {
  return run.status === "running" && run.workflowStage
    ? `stage:${run.workflowStage}`
    : `status:${run.status}`;
}

function placementForId(value: string): HuntRunPlacement | null {
  if (value.startsWith("stage:")) {
    const workflowStage = value.slice("stage:".length);
    return workflowStage
      ? { status: "running", workflowStage }
      : null;
  }
  if (!value.startsWith("status:")) return null;
  const status = value.slice("status:".length);
  if (
    !["queued", "blocked", "failed", "completed", "cancelled"].includes(status)
  ) return null;
  return {
    status: status as Exclude<HuntRun["status"], "running">,
    workflowStage: null,
  };
}

function placementMatchesRun(run: HuntRun, placement: HuntRunPlacement) {
  return (
    run.status === placement.status &&
    (placement.status !== "running" ||
      run.workflowStage === placement.workflowStage)
  );
}

function localizeWorkflowStage(t: Translate, stageId: string, fallback: string) {
  return builtInStageIds.has(stageId)
    ? t(`stage.${stageId}` as MessageKey)
    : fallback;
}

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
