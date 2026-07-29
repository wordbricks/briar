import {
  Activity,
  ArrowLeft,
  AtSign,
  Bold,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Code2,
  Columns3,
  Cpu,
  FolderKanban,
  FolderGit2,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Image as ImageIcon,
  Italic,
  Link2,
  ListChecks,
  List,
  ListFilter,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Signal,
  Smile,
  Tag,
  Trash2,
  UserRound,
  Video,
  X,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  EmptyState,
  ErrorBanner,
  MainContent,
  PageHeader,
} from "@/components/layout";
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
import { Typography } from "@/components/ui/typography";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NativeSelect } from "./NativeSelect";
import { SelectMenu } from "./SelectMenu";
import {
  CompanionBottomNavigation,
  type CompanionStatusFilter,
} from "./CompanionBottomNavigation";
import { ProjectAgentAvatar } from "./ProjectAgentAvatar";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { useMobileBackHandler } from "../hooks/useMobileNavigation";
import { eventMeta, runMeta } from "../lib/stages";
import {
  formatAttachmentBytes,
  issueAttachmentAccept,
  maxIssueAttachmentCount,
  validateIssueAttachments,
} from "../lib/issue-attachments";
import { briarMentionAtCaret } from "../lib/issue-agent-reply";
import type {
  CreateIssueInput,
  DashboardPayload,
  HuntRun,
  HuntRunPlacement,
  HuntSource,
  IssueAttachment,
  IssueMessage,
  IssueMessageSendResult,
  ProjectAgent,
  RunEvidence,
  UpdateIssueInput,
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
  agents = [],
  companionMode = false,
  companionSearchMode = false,
  companionStatus,
  companionUnreadInboxCount = 0,
  dashboard,
  error,
  isCreatingIssue,
  isIssueDialogOpen: controlledIsIssueDialogOpen,
  deletingIssueId,
  updatingIssueId,
  needsLocalConnection = false,
  noProject = false,
  recoveringRunId,
  recoveryError,
  isSidebarOpen,
  onConnectRepository,
  onAddProject,
  onCreateIssue,
  onIssueDialogOpenChange,
  onDeleteIssue,
  onUpdateIssue,
  onLoadAttachment,
  onLoadIssueMessages,
  onLoadRunEvidence,
  onMoveRun,
  onProcessIssueNow,
  onRetryRun,
  onCancelRun,
  onCompanionInboxOpen,
  onCompanionSearchOpen,
  onCompanionStatusChange,
  onRequestedRunOpen,
  onSendIssueMessage,
  requestedRunId = null,
  processingIssueIds = new Set<string>(),
  sessions = [],
  token = null,
}: {
  agents?: ProjectAgent[];
  companionMode?: boolean;
  companionSearchMode?: boolean;
  companionStatus?: CompanionStatusFilter;
  companionUnreadInboxCount?: number;
  dashboard: DashboardPayload | null;
  error: string | null;
  isCreatingIssue: boolean;
  isIssueDialogOpen?: boolean;
  deletingIssueId: string | null;
  updatingIssueId: string | null;
  needsLocalConnection?: boolean;
  noProject?: boolean;
  recoveringRunId: string | null;
  recoveryError: string | null;
  isSidebarOpen: boolean;
  onConnectRepository?: () => void;
  onAddProject?: () => void;
  onCreateIssue: (input: CreateIssueInput) => Promise<unknown>;
  onIssueDialogOpenChange?: (isOpen: boolean) => void;
  onDeleteIssue: (runId: string) => Promise<unknown>;
  onUpdateIssue: (runId: string, input: UpdateIssueInput) => Promise<unknown>;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: (runId: string) => Promise<IssueMessage[]>;
  onLoadRunEvidence: (runId: string) => Promise<RunEvidence[]>;
  onMoveRun: (runId: string, placement: HuntRunPlacement) => Promise<unknown>;
  onProcessIssueNow?: (run: HuntRun) => void;
  onRetryRun: (runId: string) => Promise<unknown>;
  onCancelRun: (runId: string) => Promise<unknown>;
  onCompanionInboxOpen?: () => void;
  onCompanionSearchOpen?: () => void;
  onCompanionStatusChange?: (status: CompanionStatusFilter) => void;
  onRequestedRunOpen?: () => void;
  onSendIssueMessage: (
    runId: string,
    input: { body: string; parentMessageId: string | null },
  ) => Promise<IssueMessageSendResult>;
  requestedRunId?: string | null;
  processingIssueIds?: ReadonlySet<string>;
  sessions?: AutoHuntSession[];
  token?: string | null;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [isSourceFilterOpen, setIsSourceFilterOpen] = useState(false);
  const sourceFilterRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<DashboardView>("kanban");
  const [internalStatus, setInternalStatus] = useState<StatusFilter>("all");
  const status = companionMode && companionStatus
    ? companionStatus
    : internalStatus;
  const setStatus = companionMode && onCompanionStatusChange
    ? onCompanionStatusChange
    : setInternalStatus;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [internalIsIssueDialogOpen, setInternalIsIssueDialogOpen] =
    useState(false);
  const isIssueDialogOpen =
    controlledIsIssueDialogOpen ?? internalIsIssueDialogOpen;
  const setIsIssueDialogOpen = useCallback(
    (isOpen: boolean) => {
      setInternalIsIssueDialogOpen(isOpen);
      onIssueDialogOpenChange?.(isOpen);
    },
    [onIssueDialogOpenChange],
  );
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [deletingRunFromMenuId, setDeletingRunFromMenuId] =
    useState<string | null>(null);
  const [contextDeleteError, setContextDeleteError] = useState<string | null>(
    null,
  );
  useMobileBackHandler(
    () => {
      if (!companionMode) return false;
      if (deletingRunFromMenuId) {
        setDeletingRunFromMenuId(null);
        return true;
      }
      if (editingRunId) {
        setEditingRunId(null);
        return true;
      }
      if (isIssueDialogOpen) {
        setIsIssueDialogOpen(false);
        return true;
      }
      if (selectedRunId) {
        setSelectedRunId(null);
        return true;
      }
      return false;
    },
    { enabled: companionMode, priority: 100 },
  );
  const [draggedRunId, setDraggedRunId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  useEffect(() => {
    if (noProject) return;

    const openIssueCreation = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        (event.code !== "KeyN" && event.key.toLowerCase() !== "n")
      ) {
        return;
      }

      event.preventDefault();
      setIsIssueDialogOpen(true);
    };

    window.addEventListener("keydown", openIssueCreation);
    return () => window.removeEventListener("keydown", openIssueCreation);
  }, [noProject, setIsIssueDialogOpen]);

  useEffect(() => {
    if (!isSourceFilterOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!sourceFilterRef.current?.contains(event.target as Node)) {
        setIsSourceFilterOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSourceFilterOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isSourceFilterOpen]);

  const runs = dashboard?.runs ?? [];
  const selected = runs.find((run) => run.id === selectedRunId) ?? null;
  const editingRun = runs.find((run) => run.id === editingRunId) ?? null;
  const deletingRunFromMenu =
    runs.find((run) => run.id === deletingRunFromMenuId) ?? null;
  const activeCount = runs.filter((run) => !["completed", "cancelled"].includes(run.status)).length;
  const attentionCount = runs.filter((run) => ["blocked", "failed"].includes(run.status)).length;
  const completedCount = runs.filter((run) =>
    ["completed", "cancelled"].includes(run.status)
  ).length;
  const filtered = useMemo(() => {
    const normalized =
      !companionMode || companionSearchMode
        ? query.trim().toLowerCase()
        : "";
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
  }, [companionMode, companionSearchMode, query, runs, source, status]);
  const agentAssociationsByRunId = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const activeAgents = new Map<string, ProjectAgent>();
    const performedAgents = new Map<string, ProjectAgent>();
    for (const run of runs) {
      const agent = run.agentId ? agentById.get(run.agentId) : null;
      if (!agent) continue;
      performedAgents.set(run.id, agent);
      if (!["backlog", "queued", "completed", "cancelled", "blocked", "failed"].includes(run.status)) {
        activeAgents.set(run.id, agent);
      }
    }
    const recentSessions = [...sessions].sort(
      (left, right) =>
        Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );
    for (const session of recentSessions) {
      if (
        session.projectId !== dashboard?.project.id ||
        !session.agentId
      ) continue;
      const agent = agentById.get(session.agentId);
      if (!agent) continue;
      for (const issue of session.issues) {
        if (!performedAgents.has(issue.runId)) {
          performedAgents.set(issue.runId, agent);
        }
        if (
          session.status === "running" &&
          issue.outcome === "pending" &&
          !activeAgents.has(issue.runId)
        ) {
          activeAgents.set(issue.runId, agent);
        }
      }
    }
    return { activeAgents, performedAgents };
  }, [agents, dashboard?.project.id, runs, sessions]);

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
        id: "status:backlog",
        label: t("status.backlog"),
        tone: "slate",
        placement: { status: "backlog" as const, workflowStage: null },
      },
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
  const createIssueDialog = isIssueDialogOpen ? (
    <CreateIssueDialog
      isSubmitting={isCreatingIssue}
      onClose={() => setIsIssueDialogOpen(false)}
      onCreate={async (input) => {
        await onCreateIssue(input);
        setIsIssueDialogOpen(false);
      }}
      projectName={dashboard?.project.name}
    />
  ) : null;

  if (noProject) {
    return (
      <MainContent id="issues">
        {!companionMode && (
          <header
            className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
            data-tauri-drag-region="deep"
          />
        )}
        <EmptyState
          action={
            <Button onClick={onAddProject} type="button">
              <Plus size={15} />
              {t("projectEmpty.createProject")}
            </Button>
          }
          className="project-empty h-full"
          description={t("projectEmpty.description")}
          icon={<FolderGit2 size={24} />}
          title={
            <>
              <Typography as="p" className="eyebrow mb-2" tone="primary" variant="micro">
                {t("projectEmpty.eyebrow")}
              </Typography>
              {t("projectEmpty.title")}
            </>
          }
        />
      </MainContent>
    );
  }

  if (selected) {
    return (
      <>
        <RunPage
          companionMode={companionMode}
          error={recoveryError}
          isDeletingIssue={deletingIssueId === selected.id}
          isRecovering={recoveringRunId === selected.id}
          isUpdatingIssue={updatingIssueId === selected.id}
          isSidebarOpen={isSidebarOpen}
          onBack={() => setSelectedRunId(null)}
          onCancel={() => onCancelRun(selected.id)}
          onDelete={async () => {
            await onDeleteIssue(selected.id);
            setSelectedRunId(null);
          }}
          onLoadAttachment={onLoadAttachment}
          onLoadIssueMessages={() => onLoadIssueMessages(selected.id)}
          onLoadRunEvidence={() => onLoadRunEvidence(selected.id)}
          onMove={(placement) => onMoveRun(selected.id, placement)}
          onRetry={() => onRetryRun(selected.id)}
          onSendIssueMessage={(input) => onSendIssueMessage(selected.id, input)}
          onUpdateIssue={(input) => onUpdateIssue(selected.id, input)}
          performedAgentName={
            agentAssociationsByRunId.performedAgents.get(selected.id)?.name ??
            null
          }
          run={selected}
        />
        {createIssueDialog}
      </>
    );
  }

  return (
    <MainContent id="issues">
      {!companionMode && (
        <header
          className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
          data-tauri-drag-region="deep"
        />
      )}
      <div className="dashboard-scroll">
        {error ? (
          <ErrorBanner className="error-banner" icon={<CircleAlert size={16} />}>
            {error}
          </ErrorBanner>
        ) : null}
        {needsLocalConnection && (
          <div className="connect-banner">
            <span aria-hidden="true"><FolderGit2 size={16} /></span>
            <div>
              <Typography as="strong" variant="bodySm">
                {t("dashboard.connectRepositoryTitle")}
              </Typography>
              <Typography as="small" tone="muted" variant="caption">
                {t("dashboard.connectRepositoryDescription")}
              </Typography>
            </div>
            <Button onClick={onConnectRepository} type="button" variant="soft">
              <FolderGit2 size={13} />{t("dashboard.connectRepository")}
            </Button>
          </div>
        )}

        {companionMode ? (
          <div className="queue-header">
            <div className="queue-heading">
              <div className="queue-heading-copy">
                <Typography as="h2" variant="heading">
                  {companionSearchMode
                    ? t("companion.navSearch")
                    : t("dashboard.queue")}
                </Typography>
                <Typography as="span" tone="muted" variant="caption">
                  {t("dashboard.taskCount", { count: filtered.length })}
                </Typography>
              </div>
              <div className="companion-source-filter" ref={sourceFilterRef}>
                <button
                  aria-controls="companion-source-filter-menu"
                  aria-expanded={isSourceFilterOpen}
                  aria-haspopup="menu"
                  aria-label={t("dashboard.filter")}
                  className={`companion-filter-trigger${source !== "all" ? " active" : ""}`}
                  onClick={() => setIsSourceFilterOpen((current) => !current)}
                  type="button"
                >
                  <ListFilter size={18} />
                </button>
                {isSourceFilterOpen && (
                  <div
                    aria-label={t("dashboard.filter")}
                    className="companion-filter-menu"
                    id="companion-source-filter-menu"
                    role="menu"
                  >
                    {(["all", "issue", "feedback", "error"] as const).map(
                      (value) => (
                        <button
                          aria-checked={source === value}
                          className={source === value ? "active" : ""}
                          key={value}
                          onClick={() => {
                            setSource(value);
                            setIsSourceFilterOpen(false);
                          }}
                          role="menuitemradio"
                          type="button"
                        >
                          <span>
                            {value === "all"
                              ? t("dashboard.all")
                              : t(`source.${value}` as MessageKey)}
                          </span>
                          {source === value && <Check size={15} />}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
            {companionSearchMode && (
              <div className="queue-tools">
                <label className="search-box">
                  <Search size={15} />
                  <Input
                    autoFocus
                    className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("dashboard.search")}
                    value={query}
                  />
                </label>
              </div>
            )}
          </div>
        ) : (
          <PageHeader
            action={
              <div className="queue-tools">
              <Button
                aria-keyshortcuts="Meta+N"
                aria-label={t("dashboard.createIssue")}
                className="create-issue-button"
                onClick={() => setIsIssueDialogOpen(true)}
                type="button"
              >
                <Plus size={14} />{t("dashboard.createIssue")}
              </Button>
              <label className="search-box">
                <Search size={15} />
                <Input
                  className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("dashboard.search")}
                  value={query}
                />
              </label>
              <div className="source-filter">
                {(["all", "issue", "feedback", "error"] as const).map((value) => (
                  <button key={value} className={source === value ? "active" : ""} onClick={() => setSource(value)}>
                    {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
                  </button>
                ))}
              </div>
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
              </div>
            }
            className="app-page-header queue-header"
            description={t("dashboard.description")}
            title={
              <span className="queue-heading-copy">
                <span>{t("dashboard.queue")}</span>
                <Typography
                  as="span"
                  className="queue-task-count"
                  tone="muted"
                  variant="caption"
                >
                  {t("dashboard.taskCount", { count: filtered.length })}
                </Typography>
              </span>
            }
          />
        )}
        {!companionMode && (dashboard?.workers?.length ?? 0) > 0 && (
          <div className="worker-readiness-strip" aria-label={t("worker.executionEnvironment")}>
            <Cpu size={15} />
            {dashboard!.workers!.map((worker) => (
              <span className={`worker-readiness-chip ${worker.readiness}`} key={worker.id}>
                <i />
                <strong>{worker.label}</strong>
                <small>{t(`worker.readiness.${worker.readiness}` as MessageKey)}</small>
              </span>
            ))}
          </div>
        )}
        {!companionMode && <div className="status-tabs">
          <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>{t("dashboard.all")} <span>{runs.length}</span></button>
          <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>{t("dashboard.active")} <span>{activeCount}</span></button>
          <button className={status === "attention" ? "active" : ""} onClick={() => setStatus("attention")}>{t("dashboard.attention")} <span>{attentionCount}</span></button>
          <button className={status === "completed" ? "active" : ""} onClick={() => setStatus("completed")}>{t("dashboard.completed")} <span>{completedCount}</span></button>
        </div>}
        {view === "list" && !companionMode ? (
          <IssueList
            deletingIssueId={deletingIssueId}
            onDelete={(runId) => {
              setContextDeleteError(null);
              setDeletingRunFromMenuId(runId);
            }}
            onEdit={setEditingRunId}
            onMove={(run, placement) =>
              onMoveRun(run.id, placement).catch(() => undefined)
            }
            onOpen={(runId) => setSelectedRunId(runId)}
            onProcessIssueNow={onProcessIssueNow}
            onPriorityChange={(run, priority) =>
              onUpdateIssue(run.id, {
                title: run.title,
                description: run.issueDescription,
                priority,
              }).catch(() => undefined)
            }
            runs={filtered}
            processingIssueIds={processingIssueIds}
            updatingIssueId={updatingIssueId}
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
                    activeAgent={
                      agentAssociationsByRunId.activeAgents.get(run.id) ?? null
                    }
                    contextMenuDisabled={companionMode}
                    deletingIssueId={deletingIssueId}
                    isMoving={recoveringRunId === run.id}
                    key={run.id}
                    onDelete={() => {
                      setContextDeleteError(null);
                      setDeletingRunFromMenuId(run.id);
                    }}
                    onDragEnd={() => {
                      setDraggedRunId(null);
                      setDragOverColumnId(null);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", run.id);
                      setDraggedRunId(run.id);
                    }}
                    onEdit={() => setEditingRunId(run.id)}
                    onMove={(placement) =>
                      onMoveRun(run.id, placement).catch(() => undefined)
                    }
                    onOpen={() => setSelectedRunId(run.id)}
                    onProcessNow={
                      onProcessIssueNow
                        ? () => onProcessIssueNow(run)
                        : undefined
                    }
                    onPriorityChange={(priority) =>
                      onUpdateIssue(run.id, {
                        title: run.title,
                        description: run.issueDescription,
                        priority,
                      }).catch(() => undefined)
                    }
                    run={run}
                    isProcessing={processingIssueIds.has(run.id)}
                    token={token}
                    updatingIssueId={updatingIssueId}
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
          activeDestination={companionSearchMode ? "search" : status}
          onCreate={() => setIsIssueDialogOpen(true)}
          onInboxOpen={() => onCompanionInboxOpen?.()}
          onSearchOpen={() => onCompanionSearchOpen?.()}
          onStatusChange={setStatus}
          unreadInboxCount={companionUnreadInboxCount}
        />
      )}
      {createIssueDialog}
      {editingRun && (
        <EditIssueDialog
          isSubmitting={updatingIssueId === editingRun.id}
          onClose={() => setEditingRunId(null)}
          onUpdate={async (input) => {
            await onUpdateIssue(editingRun.id, input);
            setEditingRunId(null);
          }}
          run={editingRun}
        />
      )}
      <Dialog
        onOpenChange={(open) => {
          if (deletingIssueId) return;
          if (!open) {
            setDeletingRunFromMenuId(null);
            setContextDeleteError(null);
          }
        }}
        open={Boolean(deletingRunFromMenu)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {t("issue.deleteTitle", {
                title: deletingRunFromMenu?.title ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("issue.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {contextDeleteError ? (
            <p className="text-xs text-destructive" role="alert">
              {contextDeleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={Boolean(deletingIssueId)}
              onClick={() => {
                setDeletingRunFromMenuId(null);
                setContextDeleteError(null);
              }}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={Boolean(deletingIssueId)}
              onClick={() => {
                if (!deletingRunFromMenu) return;
                setContextDeleteError(null);
                void onDeleteIssue(deletingRunFromMenu.id)
                  .then(() => setDeletingRunFromMenuId(null))
                  .catch((caught) => {
                    setContextDeleteError(
                      caught instanceof Error
                        ? caught.message
                        : String(caught),
                    );
                  });
              }}
              type="button"
              variant="destructive"
            >
              {deletingIssueId ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
              {deletingIssueId ? t("issue.deleting") : t("issue.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}

export function EditIssueDialog({
  isSubmitting,
  onClose,
  onUpdate,
  run,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onUpdate: (input: UpdateIssueInput) => Promise<unknown>;
  run: HuntRun;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(run.title);
  const [description, setDescription] = useState(run.issueDescription ?? "");
  const [priority, setPriority] = useState(
    run.priority === null ? "" : String(run.priority),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onClose]);

  return (
    <div
      className="dialog-backdrop issue-dialog-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !isSubmitting && onClose()
      }
    >
      <form
        aria-label={t("issue.editDialog")}
        aria-modal="true"
        className="issue-dialog edit-issue-dialog"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !isSubmitting
          ) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || isSubmitting) return;
          setSubmitError(null);
          void onUpdate({
            title: title.trim(),
            description: description.trim() || null,
            priority: priority ? Number(priority) : null,
          }).catch((error) =>
            setSubmitError(error instanceof Error ? error.message : String(error)),
          );
        }}
        role="dialog"
      >
        <header>
          <div className="issue-dialog-context">
            <strong>{t("issue.editIssue")}</strong>
          </div>
          <button
            aria-label={t("common.close")}
            className="issue-dialog-close"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </header>
        <div className="issue-form-body">
          <div className="issue-editor-content">
            <input
              aria-label={t("issue.title")}
              autoFocus
              className="issue-title-input"
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("issue.titlePlaceholder")}
              required
              value={title}
            />
            <textarea
              aria-label={t("issue.description")}
              className="issue-description-input"
              maxLength={100000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("issue.descriptionPlaceholder")}
              value={description}
            />
            {submitError && (
              <div className="issue-form-error">
                <CircleAlert size={14} />
                {submitError}
              </div>
            )}
          </div>
          <div className="issue-metadata-bar">
            <NativeSelect
              className="issue-priority-select"
              label={t("issue.priority")}
              onValueChange={setPriority}
              options={[
                { label: t("run.notSet"), value: "" },
                { label: t("issue.priority1"), value: "1" },
                { label: t("issue.priority2"), value: "2" },
                { label: t("issue.priority3"), value: "3" },
                { label: t("issue.priority4"), value: "4" },
              ]}
              value={priority}
            />
          </div>
        </div>
        <footer>
          <span />
          <div>
            <button
              className="issue-cancel-button"
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              {t("common.cancel")}
            </button>
            <button
              className="issue-submit-button"
              disabled={isSubmitting || !title.trim()}
              type="submit"
            >
              {isSubmitting && <LoaderCircle className="spin" size={13} />}
              {isSubmitting ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

export function CreateIssueDialog({
  isSubmitting,
  onClose,
  onCreate,
  projectName,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (input: CreateIssueInput) => Promise<void>;
  projectName?: string;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"backlog" | "queued">("queued");
  const [priority, setPriority] = useState("2");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
  const attachmentDragDepthRef = useRef(0);

  const addAttachments = (selected: File[]) => {
    if (selected.length === 0) return;
    const next = [...attachments, ...selected];
    const error = validateIssueAttachments(next);
    setAttachmentError(error);
    if (!error) setAttachments(next);
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onClose]);

  useEffect(() => {
    if (!isSubmitting) return;
    attachmentDragDepthRef.current = 0;
    setIsDraggingAttachments(false);
  }, [isSubmitting]);

  return (
    <div
      className="dialog-backdrop issue-dialog-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !isSubmitting && onClose()
      }
    >
      <form
        className={`issue-dialog${
          isDraggingAttachments ? " is-dragging-attachments" : ""
        }`}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          attachmentDragDepthRef.current += 1;
          if (!isSubmitting) setIsDraggingAttachments(true);
        }}
        onDragLeave={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          attachmentDragDepthRef.current = Math.max(
            0,
            attachmentDragDepthRef.current - 1,
          );
          if (attachmentDragDepthRef.current === 0) {
            setIsDraggingAttachments(false);
          }
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          if (!isSubmitting) event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          attachmentDragDepthRef.current = 0;
          setIsDraggingAttachments(false);
          if (!isSubmitting) {
            addAttachments(Array.from(event.dataTransfer.files));
          }
        }}
        onKeyDown={(event) => {
          const isTitleEnter =
            event.target instanceof HTMLInputElement &&
            event.target.classList.contains("issue-title-input") &&
            !event.metaKey &&
            !event.ctrlKey;
          if (
            event.key !== "Enter" ||
            event.nativeEvent.isComposing ||
            isSubmitting
          ) {
            return;
          }
          if (isTitleEnter) {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLTextAreaElement>(".issue-description-input")
              ?.focus();
            return;
          }
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
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
            status,
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
          <div className="issue-dialog-context">
            <strong>{t("issue.newIssue")}</strong>
            {projectName && (
              <>
                <span aria-hidden="true">/</span>
                <button
                  aria-disabled="true"
                  className="issue-project-context"
                  disabled
                  type="button"
                >
                  {projectName}
                  <ChevronDown size={12} />
                </button>
              </>
            )}
          </div>
          <button
            className="issue-dialog-close"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </header>
        <div className="issue-form-body">
          <div
            className={`issue-editor-content${
              attachments.length > 0 ? " has-attachments" : ""
            }`}
          >
            <input
              aria-label={t("issue.title")}
              autoFocus
              className="issue-title-input"
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("issue.titlePlaceholder")}
              required
              value={title}
            />
            <textarea
              aria-label={t("issue.description")}
              className="issue-description-input"
              maxLength={100000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("issue.descriptionPlaceholder")}
              value={description}
            />
            {attachments.length > 0 && (
              <div
                aria-label={t("issue.attachments")}
                className="issue-attachment-list"
              >
                {attachments.map((file, index) => (
                  <SelectedAttachment
                    file={file}
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    onRemove={() => {
                      setAttachments((current) =>
                        current.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      );
                      setAttachmentError(null);
                    }}
                  />
                ))}
              </div>
            )}
            {(submitError || attachmentError) && (
              <div className="issue-form-error">
                <CircleAlert size={14} />
                {submitError ?? attachmentError}
              </div>
            )}
          </div>
          <div className="issue-metadata-bar">
            <NativeSelect
              className="issue-status-select"
              label={t("dashboard.status")}
              onValueChange={(value) =>
                setStatus(value === "backlog" ? "backlog" : "queued")
              }
              options={[
                { label: t("status.backlog"), value: "backlog" },
                { label: t("status.queued"), value: "queued" },
              ]}
              value={status}
            />
            <button
              aria-disabled="true"
              className="issue-metadata-chip"
              disabled
              type="button"
            >
              <UserRound size={13} />
              {t("issue.assignee")}
              <ChevronDown size={12} />
            </button>
            <NativeSelect
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
            <button
              aria-disabled="true"
              className="issue-metadata-chip"
              disabled
              type="button"
            >
              <FolderKanban size={13} />
              {t("issue.project")}
              <ChevronDown size={12} />
            </button>
            <button
              aria-disabled="true"
              className="issue-metadata-chip"
              disabled
              type="button"
            >
              <Tag size={13} />
              {t("issue.labels")}
              <ChevronDown size={12} />
            </button>
            <label className="issue-attachment-trigger">
              <Paperclip size={13} />
              <span>
                {attachments.length > 0
                  ? t("issue.attachmentCount", {
                      count: attachments.length,
                    })
                  : t("issue.attachments")}
              </span>
              <input
                accept={issueAttachmentAccept}
                aria-label={t("issue.attachmentLabel")}
                disabled={
                  isSubmitting ||
                  attachments.length >= maxIssueAttachmentCount
                }
                multiple
                onChange={(event) => {
                  const selected = Array.from(
                    event.currentTarget.files ?? [],
                  );
                  event.currentTarget.value = "";
                  addAttachments(selected);
                }}
                type="file"
              />
            </label>
          </div>
        </div>
        <footer>
          <span className="issue-submit-hint">
            <kbd>⌘</kbd>
            {t("issue.submitHint")}
          </span>
          <div>
            <button
              className="issue-cancel-button"
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              {t("common.cancel")}
            </button>
            <button
              className="issue-submit-button"
              disabled={isSubmitting || !title.trim()}
              type="submit"
            >
              {isSubmitting && <LoaderCircle className="spin" size={13} />}
              {isSubmitting ? t("issue.submitting") : t("issue.submit")}
            </button>
          </div>
        </footer>
        {isDraggingAttachments && (
          <div
            aria-live="polite"
            className="issue-attachment-drop-overlay"
            role="status"
          >
            <ImageIcon aria-hidden="true" size={28} />
            <strong>{t("issue.dropHint")}</strong>
          </div>
        )}
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
    <figure className="issue-attachment-item">
      <div className="issue-attachment-preview">
        {previewUrl && isImage ? (
          <img alt={file.name} src={previewUrl} />
        ) : previewUrl ? (
          <video controls muted playsInline preload="metadata" src={previewUrl} />
        ) : (
          <Video size={22} />
        )}
      </div>
      <figcaption>
        <span>
          <strong>{file.name}</strong>
          <small>{formatAttachmentBytes(file.size)}</small>
        </span>
        <button
          aria-label={t("issue.remove", { name: file.name })}
          onClick={onRemove}
          type="button"
        >
          <Trash2 size={14} />
        </button>
      </figcaption>
    </figure>
  );
}

function KanbanCard({
  activeAgent,
  contextMenuDisabled,
  deletingIssueId,
  isMoving,
  isProcessing,
  onDelete,
  onDragEnd,
  onDragStart,
  onEdit,
  onMove,
  run,
  onOpen,
  onProcessNow,
  onPriorityChange,
  token,
  updatingIssueId,
}: {
  activeAgent: ProjectAgent | null;
  contextMenuDisabled: boolean;
  deletingIssueId: string | null;
  isMoving: boolean;
  isProcessing: boolean;
  onDelete: () => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onEdit: () => void;
  onMove: (placement: HuntRunPlacement) => void;
  run: HuntRun;
  onOpen: () => void;
  onProcessNow?: () => void;
  onPriorityChange: (priority: number | null) => void;
  token: string | null;
  updatingIssueId: string | null;
}) {
  const { t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const isClaimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  return (
    <IssueContextMenu
      disabled={
        contextMenuDisabled ||
        isMoving ||
        deletingIssueId === run.id ||
        updatingIssueId === run.id
      }
      onDelete={onDelete}
      onEdit={onEdit}
      onMove={onMove}
      onOpen={onOpen}
      onProcessNow={onProcessNow}
      onPriorityChange={onPriorityChange}
      run={run}
      isProcessing={isProcessing}
    >
      <div
        aria-label={t("run.details", { title: run.title })}
        aria-disabled={isMoving}
        className={`kanban-card ${meta.tone}${isMoving ? " moving" : ""}${activeAgent ? " has-agent" : ""}`}
        draggable={!isMoving}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpen();
        }}
        role="button"
        tabIndex={0}
      >
        {activeAgent && (
          <span
            aria-label={t("run.assigned", { agent: activeAgent.name })}
            className="kanban-card-agent-badge"
            title={t("run.assigned", { agent: activeAgent.name })}
          >
            <ProjectAgentAvatar
              agent={activeAgent}
              isRunning
              token={token}
            />
          </span>
        )}
        <span className="kanban-card-kicker">
          <small>AH-{run.runNumber}</small>
          <i><span className={`source-dot ${run.source}`} />{t(`source.${run.source}` as MessageKey)}</i>
        </span>
        <span className="kanban-card-copy">
          <strong>{run.title}</strong>
          {run.issueDescription && (
            <span className="kanban-card-description">
              {run.issueDescription}
            </span>
          )}
        </span>
        <span className="kanban-card-badges">
          <i className={`status-pill ${meta.tone}`}>{run.status === "running" && <LoaderCircle className="spin" size={11} />}{label}</i>
          {run.priority !== null && <i className="kanban-priority">P{run.priority}</i>}
          {(run.attachments ?? []).length > 0 && <i><Paperclip size={11} />{run.attachments.length}</i>}
        </span>
        <span className="kanban-card-footer">
          <small>{isClaimed ? t("run.assigned", { agent: run.claimedBy ?? "agent" }) : relativeTime(run.updatedAt, t)}</small>
          <span className="kanban-card-footer-actions">
            <PullRequestIconLink urls={run.pullRequestUrls} />
            <ChevronRight size={14} />
          </span>
        </span>
      </div>
    </IssueContextMenu>
  );
}

function PullRequestIconLink({
  className = "",
  urls,
}: {
  className?: string;
  urls: string[];
}) {
  const { t } = useI18n();
  const url = urls.at(-1);
  if (!url) return null;
  const label = pullRequestDisplayName(url, urls.length - 1);
  return (
    <a
      aria-label={t("run.openPullRequest", { label })}
      className={`pull-request-icon-link ${className}`.trim()}
      href={url}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      rel="noreferrer"
      target="_blank"
      title={t("run.openPullRequest", { label })}
    >
      <GitPullRequest aria-hidden="true" size={13} />
      {urls.length > 1 && <span>{urls.length}</span>}
    </a>
  );
}

function pullRequestDisplayName(url: string, index: number) {
  try {
    const match = new URL(url).pathname.match(/\/pull\/(\d+)\/?$/u);
    if (match) return `PR #${match[1]}`;
  } catch {
    // URLs are validated by the API; keep a safe fallback for historical data.
  }
  return index === 0 ? "PR" : `PR ${index + 1}`;
}

function IssueContextMenu({
  children,
  disabled,
  onDelete,
  onEdit,
  onMove,
  onOpen,
  onProcessNow,
  onPriorityChange,
  run,
  isProcessing,
}: {
  children: ReactElement;
  disabled: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onMove: (placement: HuntRunPlacement) => void;
  onOpen: () => void;
  onProcessNow?: () => void;
  onPriorityChange: (priority: number | null) => void;
  run: HuntRun;
  isProcessing: boolean;
}) {
  const { t } = useI18n();
  const statusOptions = [
    { label: t("status.backlog"), value: "status:backlog" },
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
  const currentStatus = placementIdForRun(run);
  const currentStatusLabel =
    statusOptions.find((option) => option.value === currentStatus)?.label ??
    t(`status.${run.status}` as MessageKey);
  const currentPriority =
    run.priority === null ? "none" : String(run.priority);
  const priorityOptions = [
    { label: t("run.notSet"), value: "none" },
    { label: t("issue.priority1"), value: "1" },
    { label: t("issue.priority2"), value: "2" },
    { label: t("issue.priority3"), value: "3" },
    { label: t("issue.priority4"), value: "4" },
  ];
  const currentPriorityLabel =
    priorityOptions.find((option) => option.value === currentPriority)?.label ??
    t("run.notSet");
  const isClaimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  const canReassign =
    Boolean(run.workerId || run.requestedWorkerId) &&
    !["completed", "cancelled"].includes(run.status);
  const processNowDisabled =
    !onProcessNow ||
    (run.status !== "queued" && !canReassign) ||
    (isClaimed && !canReassign) ||
    isProcessing;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild disabled={disabled}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label={t("issue.actions")}
          className="issue-context-menu"
          collisionPadding={10}
        >
          <ContextMenu.Item
            className="issue-context-item"
            disabled={processNowDisabled}
            onSelect={() => onProcessNow?.()}
          >
            {isProcessing ? (
              <LoaderCircle aria-hidden="true" className="spin" size={17} />
            ) : (
              <Bot aria-hidden="true" size={17} />
            )}
            <span>{t(canReassign ? "worker.reassign" : "issue.processNow")}</span>
            {isProcessing ? (
              <small>{t("issue.processNowRunning")}</small>
            ) : run.status !== "queued" ? (
              <small>{t("issue.processNowQueuedOnly")}</small>
            ) : isClaimed ? (
              <small>{t("issue.processNowClaimed")}</small>
            ) : null}
          </ContextMenu.Item>

          <ContextMenu.Separator className="issue-context-separator" />

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item">
              <Activity aria-hidden="true" size={17} />
              <span>{t("dashboard.status")}</span>
              <small>{currentStatusLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="issue-context-menu issue-context-submenu"
                collisionPadding={10}
                sideOffset={7}
              >
                <ContextMenu.RadioGroup value={currentStatus}>
                  {statusOptions.map((option) => (
                    <ContextMenu.RadioItem
                      className="issue-context-item issue-context-choice"
                      key={option.value}
                      onSelect={() => {
                        const placement = placementForId(option.value);
                        if (!placement || placementMatchesRun(run, placement)) {
                          return;
                        }
                        onMove(placement);
                      }}
                      value={option.value}
                    >
                      <ContextMenu.ItemIndicator
                        className="issue-context-check"
                        forceMount
                      >
                        {option.value === currentStatus ? (
                          <Check aria-hidden="true" size={14} />
                        ) : null}
                      </ContextMenu.ItemIndicator>
                      <span>{option.label}</span>
                    </ContextMenu.RadioItem>
                  ))}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item">
              <Signal aria-hidden="true" size={17} />
              <span>{t("issue.priority")}</span>
              <small>{currentPriorityLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="issue-context-menu issue-context-submenu"
                collisionPadding={10}
                sideOffset={7}
              >
                <ContextMenu.RadioGroup value={currentPriority}>
                  {priorityOptions.map((option) => (
                    <ContextMenu.RadioItem
                      className="issue-context-item issue-context-choice"
                      key={option.value}
                      onSelect={() => {
                        if (option.value === currentPriority) return;
                        onPriorityChange(
                          option.value === "none"
                            ? null
                            : Number(option.value),
                        );
                      }}
                      value={option.value}
                    >
                      <ContextMenu.ItemIndicator
                        className="issue-context-check"
                        forceMount
                      >
                        {option.value === currentPriority ? (
                          <Check aria-hidden="true" size={14} />
                        ) : null}
                      </ContextMenu.ItemIndicator>
                      <span>{option.label}</span>
                    </ContextMenu.RadioItem>
                  ))}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className="issue-context-separator" />

          <ContextMenu.Item
            className="issue-context-item"
            onSelect={onOpen}
          >
            <ChevronRight aria-hidden="true" size={17} />
            <span>{t("common.open")}</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="issue-context-item"
            onSelect={onEdit}
          >
            <Pencil aria-hidden="true" size={17} />
            <span>{t("issue.edit")}</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="issue-context-separator" />

          <ContextMenu.Item
            className="issue-context-item danger"
            onSelect={onDelete}
          >
            <Trash2 aria-hidden="true" size={17} />
            <span>{t("issue.delete")}</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function IssueList({
  deletingIssueId,
  onDelete,
  onEdit,
  onMove,
  onOpen,
  onProcessIssueNow,
  onPriorityChange,
  runs,
  processingIssueIds,
  updatingIssueId,
}: {
  deletingIssueId: string | null;
  onDelete: (runId: string) => void;
  onEdit: (runId: string) => void;
  onMove: (run: HuntRun, placement: HuntRunPlacement) => void;
  onOpen: (runId: string) => void;
  onProcessIssueNow?: (run: HuntRun) => void;
  onPriorityChange: (run: HuntRun, priority: number | null) => void;
  runs: HuntRun[];
  processingIssueIds: ReadonlySet<string>;
  updatingIssueId: string | null;
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
            <IssueContextMenu
              disabled={
                deletingIssueId === run.id ||
                updatingIssueId === run.id
              }
              key={run.id}
              onDelete={() => onDelete(run.id)}
              onEdit={() => onEdit(run.id)}
              onMove={(placement) => onMove(run, placement)}
              onOpen={() => onOpen(run.id)}
              onProcessNow={
                onProcessIssueNow
                  ? () => onProcessIssueNow(run)
                  : undefined
              }
              onPriorityChange={(priority) =>
                onPriorityChange(run, priority)
              }
              run={run}
              isProcessing={processingIssueIds.has(run.id)}
            >
              <div
                aria-label={t("run.details", { title: run.title })}
                className="issue-list-grid issue-list-row"
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
                  <span className="issue-list-task-kicker">
                    <small>AH-{run.runNumber} · {run.sourceKey}</small>
                    <PullRequestIconLink urls={run.pullRequestUrls} />
                  </span>
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
                <span className="issue-list-updated" role="cell">
                  {isClaimed
                    ? t("run.assigned", { agent: run.claimedBy ?? "agent" })
                    : relativeTime(run.updatedAt, t)}
                </span>
                <ChevronRight aria-hidden="true" size={15} />
              </div>
            </IssueContextMenu>
          );
        })}
      </div>
    </div>
  );
}

export function RunPage({
  companionMode = false,
  error,
  isDeletingIssue = false,
  isRecovering,
  isUpdatingIssue = false,
  isSidebarOpen,
  onBack,
  onCancel,
  onDelete,
  onLoadAttachment,
  onLoadIssueMessages,
  onLoadRunEvidence,
  onMove,
  onRetry,
  onSendIssueMessage,
  onUpdateIssue,
  performedAgentName = null,
  run,
}: {
  companionMode?: boolean;
  error: string | null;
  isDeletingIssue?: boolean;
  isRecovering: boolean;
  isUpdatingIssue?: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onCancel: () => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: () => Promise<IssueMessage[]>;
  onLoadRunEvidence: () => Promise<RunEvidence[]>;
  onMove: (placement: HuntRunPlacement) => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  onSendIssueMessage: (input: {
    body: string;
    parentMessageId: string | null;
  }) => Promise<IssueMessageSendResult>;
  onUpdateIssue?: (input: UpdateIssueInput) => Promise<unknown>;
  performedAgentName?: string | null;
  run: HuntRun;
}) {
  const { localeTag, t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const needsAttention = ["blocked", "failed"].includes(run.status);
  const canCancelRemoteExecution =
    Boolean(run.workerId) &&
    !["completed", "cancelled", "blocked", "failed"].includes(run.status);
  const priorityLabel = run.priority === null
    ? t("run.notSet")
    : t(`issue.priority${run.priority}` as MessageKey);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [contentSplit, setContentSplit] = useState(50);
  const [isResizingContent, setIsResizingContent] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<
    "description" | "evidence"
  >("description");
  useMobileBackHandler(
    () => {
      if (!companionMode) return false;
      if (isDeleteDialogOpen) {
        setIsDeleteDialogOpen(false);
        return true;
      }
      if (isEditDialogOpen) {
        setIsEditDialogOpen(false);
        return true;
      }
      if (confirmCancel) {
        setConfirmCancel(false);
        return true;
      }
      onBack();
      return true;
    },
    { enabled: companionMode, priority: 200 },
  );
  const detailTabsId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeResizePointerRef = useRef<number | null>(null);
  const resizeGrabOffsetRef = useRef(0);
  const placementOptions = [
    { label: t("status.backlog"), value: "status:backlog" },
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
  const issueContent = run.issueDescription?.trim() || null;
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
    <MainContent className="run-page-shell" id="issue-detail">
      {!companionMode && (
        <header
          className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
          data-tauri-drag-region="deep"
        >
          <Button
            aria-label={t("run.back")}
            className="run-page-titlebar-back"
            onClick={onBack}
            size="icon-sm"
            title={t("run.back")}
            type="button"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" size={16} />
          </Button>
          <small className="run-page-window-number">
            AH-{run.runNumber}
          </small>
          <strong
            className="run-page-window-title"
            id="run-page-title"
            title={run.title}
          >
            {run.title}
          </strong>
          {(onUpdateIssue || onDelete) && (
            <IssueActionsMenu
              disabled={isUpdatingIssue || isDeletingIssue}
              onDelete={onDelete ? () => setIsDeleteDialogOpen(true) : undefined}
              onEdit={onUpdateIssue ? () => setIsEditDialogOpen(true) : undefined}
            />
          )}
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
                      {(onUpdateIssue || onDelete) && (
                        <IssueActionsMenu
                          disabled={isUpdatingIssue || isDeletingIssue}
                          onDelete={
                            onDelete ? () => setIsDeleteDialogOpen(true) : undefined
                          }
                          onEdit={
                            onUpdateIssue
                              ? () => setIsEditDialogOpen(true)
                              : undefined
                          }
                        />
                      )}
                    </div>
                  </div>
                  <div className="run-page-meta">
                    <span className={`status-pill ${meta.tone}`}>{label}</span>
                    <small>
                      {t("run.attempt", { count: run.currentAttempt })} ·{" "}
                      {t("run.revision", { count: run.currentRevision })}
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
                    {t("run.attempt", { count: run.currentAttempt })} ·{" "}
                    {t("run.revision", { count: run.currentRevision })}
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
                  aria-label={t(
                    activeDetailTab === "description"
                      ? "issue.description"
                      : "run.evidence",
                  )}
                  className="issue-description-pane"
                >
                  <div
                    aria-label={t("run.detailTabs")}
                    className="issue-detail-tabs"
                    role="tablist"
                  >
                    <button
                      aria-controls={`${detailTabsId}-description-panel`}
                      aria-selected={activeDetailTab === "description"}
                      id={`${detailTabsId}-description-tab`}
                      onClick={() => setActiveDetailTab("description")}
                      role="tab"
                      type="button"
                    >
                      {t("issue.description")}
                    </button>
                    <button
                      aria-controls={`${detailTabsId}-evidence-panel`}
                      aria-selected={activeDetailTab === "evidence"}
                      id={`${detailTabsId}-evidence-tab`}
                      onClick={() => setActiveDetailTab("evidence")}
                      role="tab"
                      type="button"
                    >
                      <ListChecks aria-hidden="true" size={14} />
                      {t("run.evidence")}
                    </button>
                  </div>
                  {activeDetailTab === "description" ? (
                    <div
                      aria-labelledby={`${detailTabsId}-description-tab`}
                      className="issue-description-scroll"
                      id={`${detailTabsId}-description-panel`}
                      role="tabpanel"
                    >
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
                      {(needsAttention || canCancelRemoteExecution) && (
                        <div className="recovery-panel">
                          <div><CircleAlert size={16} /><span><strong>{needsAttention ? (run.status === "failed" ? t("run.failed") : t("run.blocked")) : label}</strong><small>{needsAttention ? t("run.retryDescription", { count: run.currentAttempt + 1 }) : (run.detail ?? t("worker.sharingDescriptionOn"))}</small></span></div>
                          <div className="recovery-actions">
                            {needsAttention && <button disabled={isRecovering} onClick={() => void runAction(onRetry)} type="button"><RotateCcw className={isRecovering ? "spin" : ""} size={14} />{t("run.retry")}</button>}
                            {confirmCancel ? (
                              <><button className="danger" disabled={isRecovering} onClick={() => void runAction(onCancel)} type="button">{t("run.confirmCancel")}</button><button disabled={isRecovering} onClick={() => setConfirmCancel(false)} type="button">{t("run.back")}</button></>
                            ) : (
                              <button className="danger-secondary" disabled={isRecovering} onClick={() => setConfirmCancel(true)} type="button">{t("run.cancel")}</button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <RunEvidencePanel
                      id={`${detailTabsId}-evidence-panel`}
                      labelledBy={`${detailTabsId}-evidence-tab`}
                      onLoad={onLoadRunEvidence}
                      run={run}
                    />
                  )}
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
                      <SelectMenu
                        align="end"
                        className="run-status-select"
                        disabled={isRecovering}
                        label={t("dashboard.status")}
                        onValueChange={(value) => {
                          const placement = placementForId(value);
                          if (!placement || placementMatchesRun(run, placement)) return;
                          void runAction(() => onMove(placement));
                        }}
                        options={placementOptions}
                        size="small"
                        value={placementValue}
                      />
                    </span>
                    {isRecovering && <LoaderCircle className="spin" size={14} />}
                  </label>
                  {error && <p className="run-status-error"><CircleAlert size={13} />{error}</p>}
                  <div
                    aria-label={`${t("issue.priority")}: ${priorityLabel}`}
                    className="run-property"
                    title={t("issue.priority")}
                  >
                    <span className="run-property-icon priority"><Signal size={15} /></span>
                    <span className="run-property-copy"><strong>{priorityLabel}</strong></span>
                  </div>
                  <div
                    aria-label={`${t("run.assignee")}: ${run.claimedBy ?? t("run.unassigned")}`}
                    className="run-property"
                    title={t("run.assignee")}
                  >
                    <span className="run-property-icon assignee"><UserRound size={15} /></span>
                    <span className="run-property-copy"><strong>{run.claimedBy ?? t("run.unassigned")}</strong></span>
                  </div>
                  <div
                    aria-label={`${t("run.agent")}: ${performedAgentName ?? t("run.unassigned")}`}
                    className="run-property"
                    title={t("run.agent")}
                  >
                    <span className="run-property-icon agent"><Bot size={15} /></span>
                    <span className="run-property-copy"><strong>{performedAgentName ?? t("run.unassigned")}</strong></span>
                  </div>
                  <div
                    aria-label={`${t("run.currentAttempt")} · ${t("run.currentRevision")}: ${t("run.attempt", { count: run.currentAttempt })} · ${t("run.revision", { count: run.currentRevision })}`}
                    className="run-property"
                    title={`${t("run.currentAttempt")} · ${t("run.currentRevision")}`}
                  >
                    <span className="run-property-icon attempt"><RotateCcw size={15} /></span>
                    <span className="run-property-copy"><strong>{t("run.attempt", { count: run.currentAttempt })} · {t("run.revision", { count: run.currentRevision })}</strong></span>
                  </div>
                </section>
                <section>
                  <h2>{t("run.repository")}</h2>
                  <div
                    aria-label={`${t("run.repository")}: ${run.repository}`}
                    className="run-property"
                    title={t("run.repository")}
                  >
                    <span className="run-property-icon repository"><FolderGit2 size={15} /></span>
                    <span className="run-property-copy"><strong title={run.repository}>{run.repository}</strong></span>
                  </div>
                  <div
                    aria-label={`${t("run.source")}: ${t(`source.${run.source}` as MessageKey)}`}
                    className="run-property"
                    title={t("run.source")}
                  >
                    <span className="run-property-icon source"><span className={`source-dot ${run.source}`} /></span>
                    <span className="run-property-copy"><strong>{t(`source.${run.source}` as MessageKey)}</strong></span>
                  </div>
                  <div
                    aria-label={`${t("run.branch")}: ${run.branch ?? "—"}`}
                    className="run-property"
                    title={t("run.branch")}
                  >
                    <span className="run-property-icon"><GitFork size={15} /></span>
                    <span className="run-property-copy"><strong title={run.branch ?? undefined}>{run.branch ?? "—"}</strong></span>
                  </div>
                  <div
                    aria-label={`${t("run.commit")}: ${run.commitSha ?? "—"}`}
                    className="run-property"
                    title={t("run.commit")}
                  >
                    <span className="run-property-icon"><GitCommitHorizontal size={15} /></span>
                    <span className="run-property-copy"><strong title={run.commitSha ?? undefined}>{run.commitSha ?? "—"}</strong></span>
                  </div>
                  {run.pullRequestUrls.map((url, index) => {
                    const label = pullRequestDisplayName(url, index);
                    return (
                      <a
                        aria-label={t("run.openPullRequest", { label })}
                        className="run-property run-property-link"
                        href={url}
                        key={url}
                        rel="noreferrer"
                        target="_blank"
                        title={t("run.openPullRequest", { label })}
                      >
                        <span className="run-property-icon pull-request">
                          <GitPullRequest size={15} />
                        </span>
                        <span className="run-property-copy">
                          <strong>{label}</strong>
                        </span>
                      </a>
                    );
                  })}
                  <div
                    aria-label={`${t("run.started")}: ${formatDate(run.startedAt, localeTag)}`}
                    className="run-property"
                    title={t("run.started")}
                  >
                    <span className="run-property-icon"><Clock3 size={15} /></span>
                    <span className="run-property-copy"><strong>{formatDate(run.startedAt, localeTag)}</strong></span>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </article>
      </div>
      {isEditDialogOpen && onUpdateIssue && (
        <EditIssueDialog
          isSubmitting={isUpdatingIssue}
          onClose={() => setIsEditDialogOpen(false)}
          onUpdate={async (input) => {
            await onUpdateIssue(input);
            setIsEditDialogOpen(false);
          }}
          run={run}
        />
      )}
      <Dialog
        onOpenChange={(open) => {
          if (isDeletingIssue) return;
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteError(null);
        }}
        open={isDeleteDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>{t("issue.deleteTitle", { title: run.title })}</DialogTitle>
            <DialogDescription>
              {t("issue.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-xs text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isDeletingIssue}
              onClick={() => setIsDeleteDialogOpen(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={isDeletingIssue || !onDelete}
              onClick={() => {
                if (!onDelete) return;
                setDeleteError(null);
                void onDelete().catch((caught) => {
                  setDeleteError(
                    caught instanceof Error ? caught.message : String(caught),
                  );
                });
              }}
              type="button"
              variant="destructive"
            >
              {isDeletingIssue ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
              {isDeletingIssue ? t("issue.deleting") : t("issue.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}

function IssueActionsMenu({
  disabled,
  onDelete,
  onEdit,
}: {
  disabled: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={t("issue.actions")}
          className="run-page-actions-trigger"
          disabled={disabled}
          type="button"
        >
          {disabled ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <MoreHorizontal size={17} />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="run-page-actions-menu"
          sideOffset={6}
        >
          {onEdit ? (
            <DropdownMenu.Item
              className="run-page-actions-item"
              onSelect={onEdit}
            >
              <Pencil size={14} />
              {t("issue.edit")}
            </DropdownMenu.Item>
          ) : null}
          {onDelete ? (
            <DropdownMenu.Item
              className="run-page-actions-item danger"
              onSelect={onDelete}
            >
              <Trash2 size={14} />
              {t("issue.delete")}
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  const latestMessage =
    latestEvent?.detail?.trim() || run.detail?.trim() || latestLabel;

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
          <strong>{latestMessage}</strong>
          <small>
            {latestEvent
              ? `${t("run.attempt", { count: latestEvent.attempt })} · ${t("run.revision", { count: latestEvent.revision })} · ${relativeTime(latestEvent.occurredAt, t)}`
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
                            {t("run.attempt", { count: event.attempt })} ·{" "}
                            {t("run.revision", { count: event.revision })}
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

function RunEvidencePanel({
  id,
  labelledBy,
  onLoad,
  run,
}: {
  id: string;
  labelledBy: string;
  onLoad: () => Promise<RunEvidence[]>;
  run: HuntRun;
}) {
  const { localeTag, t } = useI18n();
  const [evidence, setEvidence] = useState<RunEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEvidence(await onLoadRef.current());
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : t("run.evidenceLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadEvidence();
  }, [loadEvidence]);

  const stageGroups = useMemo(() => {
    const knownStageIds = new Set(run.workflow.stages.map((stage) => stage.id));
    const configured = run.workflow.stages
      .map((stage) => ({
        id: stage.id,
        label: localizeWorkflowStage(t, stage.id, stage.label),
        requirements: stage.evidence ?? [],
        evidence: evidence.filter((item) => item.stage === stage.id),
      }))
      .filter(
        (stage) => stage.requirements.length > 0 || stage.evidence.length > 0,
      );
    const unknownStageIds = Array.from(
      new Set(
        evidence
          .filter((item) => !knownStageIds.has(item.stage))
          .map((item) => item.stage),
      ),
    );
    return [
      ...configured,
      ...unknownStageIds.map((stageId) => ({
        id: stageId,
        label: stageId,
        requirements: [] as string[],
        evidence: evidence.filter((item) => item.stage === stageId),
      })),
    ];
  }, [evidence, run.workflow.stages, t]);

  return (
    <div
      aria-labelledby={labelledBy}
      className="run-evidence-panel"
      id={id}
      role="tabpanel"
    >
      {loading ? (
        <div className="run-evidence-state">
          <LoaderCircle className="spin" size={16} />
          {t("run.evidenceLoading")}
        </div>
      ) : loadError ? (
        <button
          className="run-evidence-state error"
          onClick={() => void loadEvidence()}
          type="button"
        >
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button>
      ) : stageGroups.length === 0 ? (
        <div className="run-evidence-empty">
          <ListChecks aria-hidden="true" size={22} />
          <strong>{t("run.evidenceEmpty")}</strong>
        </div>
      ) : (
        <div className="run-evidence-groups">
          {stageGroups.map((stage) => {
            const satisfiedTypes = new Set(
              stage.evidence
                .filter(
                  (item) =>
                    item.canonical &&
                    (item.status === "passed" || item.status === "skipped"),
                )
                .map((item) => item.type),
            );
            const unrecorded = stage.requirements.filter(
              (type) => !stage.evidence.some((item) => item.type === type),
            );
            return (
              <section className="run-evidence-stage" key={stage.id}>
                <header>
                  <span>
                    <strong>{stage.label}</strong>
                    <code>{stage.id}</code>
                  </span>
                  <small>
                    {stage.requirements.length > 0
                      ? `${satisfiedTypes.size}/${stage.requirements.length}`
                      : stage.evidence.length}
                  </small>
                </header>
                <div>
                  {stage.evidence.map((item) => (
                    <article
                      className={`run-evidence-item ${item.status}${
                        item.canonical ? "" : " stale"
                      }`}
                      key={`${item.attempt}:${item.key}`}
                    >
                      <header>
                        <strong>{item.type}</strong>
                        <span>
                          {!item.canonical && (
                            <em>{t("run.evidenceStale")}</em>
                          )}
                          <i className={item.status}>
                            {t(
                              `run.evidenceStatus.${item.status}` as MessageKey,
                            )}
                          </i>
                        </span>
                      </header>
                      {item.detail && <p>{item.detail}</p>}
                      {item.command && (
                        <div className="run-evidence-command">
                          <small>{t("run.evidenceCommand")}</small>
                          <code>{item.command}</code>
                        </div>
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <Link2 aria-hidden="true" size={13} />
                          {t("common.open")}
                        </a>
                      )}
                      {item.metadata && (
                        <details className="run-evidence-metadata">
                          <summary>{t("run.evidenceMetadata")}</summary>
                          <pre>{JSON.stringify(item.metadata, null, 2)}</pre>
                        </details>
                      )}
                      <footer>
                        <span>
                          {t("run.attempt", { count: item.attempt })} ·{" "}
                          {t("run.revision", { count: item.revision })}
                        </span>
                        <span>
                          {item.actor} · {formatDate(item.observedAt, localeTag)}
                        </span>
                      </footer>
                    </article>
                  ))}
                  {unrecorded.map((type) => (
                    <article
                      className="run-evidence-item unrecorded"
                      key={`unrecorded:${type}`}
                    >
                      <header>
                        <strong>{type}</strong>
                        <span>
                          <i>{t("run.evidenceNotRecorded")}</i>
                        </span>
                      </header>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
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
  const [agentReplyStates, setAgentReplyStates] = useState<
    Record<string, { pending: number; error: string | null }>
  >({});
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const threadContentRef = useRef<HTMLDivElement | null>(null);
  const threadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMessages(await onLoadRef.current());
    } catch {
      setLoadError(t("run.messagesLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages, run.id]);

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
  const pendingAgentReplyCount = Object.values(agentReplyStates).reduce(
    (total, state) => total + state.pending,
    0,
  );

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [loading, messages.length, pendingAgentReplyCount]);

  useLayoutEffect(() => {
    const threadContent = threadContentRef.current;
    if (activeThread && threadContent) {
      threadContent.scrollTop = threadContent.scrollHeight;
    }
  }, [activeThreadId, pendingAgentReplyCount, replies.length]);

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
    const result = await onSend({ body, parentMessageId });
    appendMessage(result.message);
    if (!result.agentReply) return;
    const replyThreadId =
      result.message.parentMessageId ?? result.message.id;
    setAgentReplyStates((current) => ({
      ...current,
      [replyThreadId]: {
        pending: (current[replyThreadId]?.pending ?? 0) + 1,
        error: null,
      },
    }));
    void result.agentReply
      .then((message) => {
        appendMessage(message);
        setAgentReplyStates((current) => {
          const state = current[replyThreadId];
          if (!state) return current;
          const pending = Math.max(state.pending - 1, 0);
          if (pending === 0) {
            const next = { ...current };
            delete next[replyThreadId];
            return next;
          }
          return {
            ...current,
            [replyThreadId]: { ...state, pending },
          };
        });
      })
      .catch((caught: unknown) => {
        const error =
          caught instanceof Error ? caught.message : String(caught);
        setAgentReplyStates((current) => ({
          ...current,
          [replyThreadId]: {
            pending: Math.max(
              (current[replyThreadId]?.pending ?? 1) - 1,
              0,
            ),
            error,
          },
        }));
      });
  };

  return (
    <section className="issue-conversation" aria-label={t("run.messages")}>
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
              replyState={
                message.id === activeThreadId
                  ? undefined
                  : agentReplyStates[message.id]
              }
              threadReplies={repliesByRootId.get(message.id) ?? []}
            />
          ))
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
                <AgentReplyState
                  state={agentReplyStates[activeThread.id]}
                />
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
  replyState,
  threadReplies = [],
}: {
  localeTag: string;
  message: IssueMessage;
  onOpenThread?: (messageId: string, trigger: HTMLButtonElement) => void;
  replyState?: { pending: number; error: string | null };
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
        <AgentReplyState state={replyState} />
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

function AgentReplyState({
  state,
}: {
  state?: { pending: number; error: string | null };
}) {
  const { t } = useI18n();
  if (!state) return null;
  if (state.pending > 0) {
    return (
      <div className="issue-agent-reply-state">
        <LoaderCircle className="spin" size={14} />
        {t("run.briarReplying")}
      </div>
    );
  }
  if (!state.error) return null;
  return (
    <div className="issue-agent-reply-state error">
      <CircleAlert size={14} />
      {t("run.briarReplyFailed", { error: state.error })}
    </div>
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
    ![
      "backlog",
      "queued",
      "blocked",
      "failed",
      "completed",
      "cancelled",
    ].includes(status)
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
