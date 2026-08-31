import {
  Bot,
  ChevronDown,
  ChevronRight,
  Columns3,
  List,
  Plus,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { Typography } from "@/components/ui/typography";
import { useAppCollectionKeyboardCommandScope } from "@/hooks/useAppCollectionKeyboardCommandScope";
import {
  useControlledCollectionNavigation,
  type CollectionNavigationDirection,
} from "@/hooks/useControlledCollectionNavigation";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import type { AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import {
  readKanbanColumnIds,
  toggleKanbanColumnId,
  writeKanbanColumnIds,
} from "@/lib/kanban-column-storage";
import { formatIssueKey } from "@/lib/issue-key";
import { runMeta } from "@/lib/stages";
import type {
  ExecutionWorker,
  HuntRun,
  HuntRunPlacement,
  IssueExecutionPreferences,
  OrganizationMember,
  Project,
  ProjectAgent,
  ProjectSettings,
} from "@/types";
import type { AgentProvider } from "@/lib/project-llm";
import { PageHeader } from "../../layout";
import { IssueList } from "./IssueList";
import { IssuePropertyFilterMenu } from "./IssuePropertyFilterMenu";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumnMenu } from "./KanbanColumnMenu";
import {
  type DashboardView,
  type IssuePropertyFilters,
  type SourceFilter,
  type StatusFilter,
  runMatchesIssuePropertyFilters,
} from "../model/filters";
import { localizeWorkflowStage } from "../model/formatters";
import { placementMatchesRun } from "../model/kanban";

export type IssueCollectionState = {
  propertyFilters: IssuePropertyFilters;
  query: string;
  source: SourceFilter;
  status: StatusFilter;
  view: DashboardView;
  setPropertyFilters: (filters: IssuePropertyFilters) => void;
  setQuery: (query: string) => void;
  setSource: (source: SourceFilter) => void;
  setStatus: (status: StatusFilter) => void;
  setView: (view: DashboardView) => void;
};

export type IssueWorkflowContext = {
  id: string;
  label?: string;
  settings: Pick<ProjectSettings, "checkpointPolicy" | "workflow">;
};

type CollectionColumn = {
  checkpointsBefore: string[];
  id: string;
  label: string;
  placement: HuntRunPlacement;
  runs: HuntRun[];
  tone: string;
};

type KeyboardColumn = {
  id: string;
  runIds: string[];
};

function resolveKeyboardRunId(
  columns: readonly KeyboardColumn[],
  currentRunId: string | null,
  direction: CollectionNavigationDirection,
) {
  const runIds = columns.flatMap((column) => column.runIds);
  if (runIds.length === 0) return null;
  if (currentRunId === null) {
    return direction === "up" || direction === "left"
      ? runIds.at(-1) ?? null
      : runIds[0] ?? null;
  }
  const columnIndex = columns.findIndex((column) =>
    column.runIds.includes(currentRunId),
  );
  if (columnIndex < 0) return runIds[0] ?? null;
  const column = columns[columnIndex]!;
  const rowIndex = column.runIds.indexOf(currentRunId);
  if (direction === "up" || direction === "down") {
    return column.runIds[
      Math.min(
        column.runIds.length - 1,
        Math.max(0, rowIndex + (direction === "up" ? -1 : 1)),
      )
    ] ?? currentRunId;
  }
  if (direction !== "left" && direction !== "right") return null;
  const target = columns[columnIndex + (direction === "left" ? -1 : 1)];
  return target?.runIds[Math.min(rowIndex, target.runIds.length - 1)] ?? currentRunId;
}

function statusMatches(run: HuntRun, status: StatusFilter) {
  if (status === "active") return !["completed", "cancelled"].includes(run.status);
  if (status === "attention") return ["paused", "blocked", "failed"].includes(run.status);
  if (status === "completed") return ["completed", "cancelled"].includes(run.status);
  return true;
}

export function IssueCollection({
  activeAgentForRun,
  agents,
  assignedWorkerForRun,
  availableProviders,
  bodyBefore,
  countLabel,
  currentUserId,
  deletingIssueId,
  emptyContent,
  filteredEmptyContent,
  getSearchText,
  headerDescription,
  headerEyebrow,
  headerTrailing,
  isLoading,
  isSidebarOpen,
  issueKeyPrefixForRun,
  loadingLabel,
  members,
  onCheckpointsChange,
  onCreateInColumn,
  onDelete,
  onEdit,
  onMove,
  onOpen,
  onPreferencesChange,
  onPriorityChange,
  onProcessNow,
  onTransfer,
  processingIssueIds,
  projectForRun,
  readOnly = false,
  recoveringRunId,
  runs,
  scrollLeftRef,
  scrollClassName = "",
  searchPlaceholder,
  state,
  storageScopeId,
  title,
  token,
  toolbarAfterSearch,
  updatingIssueId,
  workflowForRun,
  workflowContexts = [],
}: {
  activeAgentForRun?: (run: HuntRun) => ProjectAgent | null;
  agents: ProjectAgent[];
  assignedWorkerForRun?: (run: HuntRun) => ExecutionWorker | null;
  availableProviders: AgentProvider[];
  bodyBefore?: ReactNode;
  countLabel: (count: number) => ReactNode;
  currentUserId?: string | null;
  deletingIssueId: string | null;
  emptyContent?: ReactNode;
  filteredEmptyContent?: ReactNode;
  getSearchText?: (run: HuntRun) => string;
  headerDescription?: ReactNode;
  headerEyebrow?: ReactNode;
  headerTrailing?: ReactNode;
  isLoading: boolean;
  isSidebarOpen: boolean;
  issueKeyPrefixForRun?: (run: HuntRun) => string | undefined;
  loadingLabel?: string;
  members: OrganizationMember[];
  onCheckpointsChange?: (run: HuntRun, checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
  onCreateInColumn?: (placement: HuntRunPlacement) => void;
  onDelete?: (run: HuntRun) => void;
  onEdit?: (run: HuntRun) => void;
  onMove?: (run: HuntRun, placement: HuntRunPlacement) => void;
  onOpen: (run: HuntRun) => void;
  onPreferencesChange?: (run: HuntRun, preferences: IssueExecutionPreferences) => void;
  onPriorityChange?: (run: HuntRun, priority: number | null) => void;
  onProcessNow?: (run: HuntRun) => void;
  onTransfer?: (run: HuntRun) => void;
  processingIssueIds: ReadonlySet<string>;
  projectForRun?: (run: HuntRun) => Pick<Project, "icon" | "name"> | undefined;
  readOnly?: boolean;
  recoveringRunId: string | null;
  runs: HuntRun[];
  scrollLeftRef?: MutableRefObject<number | null>;
  scrollClassName?: string;
  searchPlaceholder: string;
  state: IssueCollectionState;
  storageScopeId?: string | null;
  title: ReactNode;
  token?: string | null;
  toolbarAfterSearch?: ReactNode;
  updatingIssueId: string | null;
  workflowForRun: (run: HuntRun) => IssueWorkflowContext | undefined;
  workflowContexts?: IssueWorkflowContext[];
}) {
  const { t } = useI18n();
  const [collapsedColumnIds, setCollapsedColumnIds] = useState<string[]>([]);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);
  const [hiddenColumnsExpanded, setHiddenColumnsExpanded] = useState(true);
  const [cursorRunId, setCursorRunId] = useState<string | null>(null);
  const [draggedRunId, setDraggedRunId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const pointerDragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pointerDragPreviewRef = useRef<HTMLElement | null>(null);
  const suppressCardClickRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsedColumnIds(readKanbanColumnIds("collapse", currentUserId, storageScopeId));
    setHiddenColumnIds(readKanbanColumnIds("hide", currentUserId, storageScopeId));
  }, [currentUserId, storageScopeId]);
  useEffect(() => () => pointerDragPreviewRef.current?.remove(), []);

  const activeCount = runs.filter((run) => statusMatches(run, "active")).length;
  const attentionCount = runs.filter((run) => statusMatches(run, "attention")).length;
  const completedCount = runs.filter((run) => statusMatches(run, "completed")).length;
  const normalizedQuery = state.query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      runs.filter((run) => {
        if (state.source !== "all" && run.source !== state.source) return false;
        if (!runMatchesIssuePropertyFilters(run, state.propertyFilters)) return false;
        if (!statusMatches(run, state.status)) return false;
        if (!normalizedQuery) return true;
        const searchText = getSearchText?.(run) ??
          [
            run.title,
            run.detail,
            run.issueDescription,
            run.sourceKey,
            run.repository,
            formatIssueKey(issueKeyPrefixForRun?.(run), run.runNumber),
          ]
            .filter(Boolean)
            .join(" ");
        return searchText.toLocaleLowerCase().includes(normalizedQuery);
      }),
    [
      getSearchText,
      issueKeyPrefixForRun,
      normalizedQuery,
      runs,
      state.propertyFilters,
      state.source,
      state.status,
    ],
  );

  const columns = useMemo<CollectionColumn[]>(() => {
    const contexts = new Map(
      workflowContexts.map((context) => [context.id, context]),
    );
    for (const run of filtered) {
      const context = workflowForRun(run);
      if (context) contexts.set(context.id, context);
    }
    const resolvedContexts = [...contexts.values()];
    const multipleWorkflows = resolvedContexts.length > 1;
    const stageColumnId = (contextId: string, stageId: string) =>
      multipleWorkflows
        ? `stage:${encodeURIComponent(contextId)}:${stageId}`
        : `stage:${stageId}`;
    const definitions: Omit<CollectionColumn, "runs">[] = [
      {
        id: "status:backlog",
        label: t("status.backlog"),
        tone: "slate",
        placement: { status: "backlog", workflowStage: null },
        checkpointsBefore: [],
      },
      {
        id: "status:queued",
        label: t("status.queued"),
        tone: "slate",
        placement: { status: "queued", workflowStage: null },
        checkpointsBefore: [],
      },
    ];
    for (const context of resolvedContexts) {
      const workflow = context.settings.workflow;
      const labels = new Map(
        workflow.stages.map((stage) => [
          stage.id,
          localizeWorkflowStage(t, stage.id, stage.label),
        ]),
      );
      const stageDefinitions = workflow.stages.map((stage) => ({
        id: stageColumnId(context.id, stage.id),
        label: multipleWorkflows
          ? `${context.label ?? context.id} · ${labels.get(stage.id) ?? stage.label}`
          : labels.get(stage.id) ?? stage.label,
        tone: runMeta("running", stage.id, workflow).tone,
        placement: { status: "running" as const, workflowStage: stage.id },
        checkpointsBefore: [] as string[],
      }));
      const effectiveCheckpoints =
        context.settings.checkpointPolicy?.effective ?? workflow.execution.checkpoints;
      for (const checkpoint of effectiveCheckpoints) {
        const index = stageDefinitions.findIndex(
          (column) => column.placement.workflowStage === checkpoint.stage,
        );
        if (index < 0) continue;
        const boundary = stageDefinitions[index + (checkpoint.position === "after" ? 1 : 0)] ??
          stageDefinitions[index];
        if (!boundary) continue;
        const stageLabel = labels.get(checkpoint.stage) ?? checkpoint.stage;
        boundary.checkpointsBefore.push(
          checkpoint.position === "before"
            ? t("run.checkpointBefore", { stage: stageLabel })
            : t("run.checkpointAfter", { stage: stageLabel }),
        );
      }
      definitions.push(...stageDefinitions);
    }
    definitions.push(
      {
        id: "status:blocked",
        label: t("status.blocked"),
        tone: "rose",
        placement: { status: "blocked", workflowStage: null },
        checkpointsBefore: [],
      },
      {
        id: "status:failed",
        label: t("status.failed"),
        tone: "red",
        placement: { status: "failed", workflowStage: null },
        checkpointsBefore: [],
      },
      {
        id: "status:completed",
        label: t("status.completed"),
        tone: "emerald",
        placement: { status: "completed", workflowStage: null },
        checkpointsBefore: [],
      },
      {
        id: "status:cancelled",
        label: t("status.cancelled"),
        tone: "slate",
        placement: { status: "cancelled", workflowStage: null },
        checkpointsBefore: [],
      },
    );
    const visibleDefinitions = definitions.filter((column) => {
      if (state.status === "active") {
        return !["status:completed", "status:cancelled"].includes(column.id);
      }
      if (state.status === "attention") {
        return column.id.startsWith("stage:") ||
          ["status:blocked", "status:failed"].includes(column.id);
      }
      if (state.status === "completed") {
        return ["status:completed", "status:cancelled"].includes(column.id);
      }
      return true;
    });
    const grouped = new Map(
      visibleDefinitions.map((column) => [column.id, [] as HuntRun[]]),
    );
    for (const run of filtered) {
      let columnId = `status:${run.status}`;
      if (run.status === "running" || run.status === "paused") {
        const context = workflowForRun(run);
        const stages = context?.settings.workflow.stages ?? [];
        const stageId = stages.some((stage) => stage.id === run.workflowStage)
          ? run.workflowStage
          : stages[0]?.id;
        columnId = context && stageId
          ? stageColumnId(context.id, stageId)
          : "status:queued";
      }
      grouped.get(columnId)?.push(run);
    }
    const result = visibleDefinitions.map((column) => ({
      ...column,
      runs: grouped.get(column.id) ?? [],
    }));
    return state.status === "attention"
      ? result.filter(
          (column) => !column.id.startsWith("stage:") || column.runs.length > 0,
        )
      : result;
  }, [filtered, state.status, t, workflowContexts, workflowForRun]);

  const collapsed = useMemo(() => new Set(collapsedColumnIds), [collapsedColumnIds]);
  const hidden = useMemo(() => new Set(hiddenColumnIds), [hiddenColumnIds]);
  const visibleColumns = columns.filter((column) => !hidden.has(column.id));
  const hiddenColumns = columns.filter((column) => hidden.has(column.id));
  const keyboardColumns = useMemo(
    () =>
      visibleColumns.flatMap((column) =>
        collapsed.has(column.id) || column.runs.length === 0
          ? []
          : [{ id: column.id, runIds: column.runs.map((run) => run.id) }],
      ),
    [collapsed, visibleColumns],
  );
  const keyboardRunIds = useMemo(
    () => keyboardColumns.flatMap((column) => column.runIds),
    [keyboardColumns],
  );
  const navigation = useControlledCollectionNavigation<string, HTMLDivElement>({
    cursorId: cursorRunId,
    itemIds: keyboardRunIds,
    onCursorIdChange: setCursorRunId,
    orientation: "both",
    resolveNextId: ({ currentId, direction }) =>
      resolveKeyboardRunId(keyboardColumns, currentId, direction),
    selectedId: null,
    selectionBehavior: "manual",
  });
  useAppCollectionKeyboardCommandScope({
    enabled: state.view === "kanban" && !isLoading && keyboardRunIds.length > 0,
    id: "issue-kanban-board",
    move: navigation.move,
    orientation: "both",
    rootRef: boardRef,
  });
  useEffect(() => {
    setCursorRunId((current) =>
      current !== null && !keyboardRunIds.includes(current) ? null : current,
    );
  }, [keyboardRunIds]);
  useLayoutEffect(() => {
    if (isLoading || state.view !== "kanban" || !scrollLeftRef) return;
    const scrollLeft = scrollLeftRef.current;
    if (scrollLeft === null || !boardRef.current) return;
    boardRef.current.scrollLeft = scrollLeft;
    scrollLeftRef.current = null;
  }, [isLoading, scrollLeftRef, state.view]);

  const toggleCollapsed = useCallback(
    (columnId: string) => {
      setCollapsedColumnIds((current) => {
        const next = toggleKanbanColumnId(current, columnId);
        writeKanbanColumnIds("collapse", currentUserId, storageScopeId, next);
        return next;
      });
    },
    [currentUserId, storageScopeId],
  );
  const toggleHidden = useCallback(
    (columnId: string) => {
      setHiddenColumnIds((current) => {
        const next = toggleKanbanColumnId(current, columnId);
        writeKanbanColumnIds("hide", currentUserId, storageScopeId, next);
        return next;
      });
    },
    [currentUserId, storageScopeId],
  );
  const clearDrag = useCallback(() => {
    pointerDragPreviewRef.current?.remove();
    pointerDragPreviewRef.current = null;
    pointerDragRef.current = null;
    setDraggedRunId(null);
    setDragOverColumnId(null);
  }, []);
  const columnAtPoint = (x: number, y: number) =>
    document.elementFromPoint?.(x, y)?.closest<HTMLElement>("[data-kanban-column-id]")
      ?.dataset.kanbanColumnId ?? null;

  const noOp = () => undefined;
  return (
    <>
      <PageHeader
        action={
          <div className="queue-tools">
            <label className="search-box">
              <Input
                aria-label={searchPlaceholder}
                className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => state.setQuery(event.currentTarget.value)}
                placeholder={searchPlaceholder}
                value={state.query}
              />
              <Search aria-hidden="true" size={15} />
            </label>
            {toolbarAfterSearch}
            <IssuePropertyFilterMenu
              agents={agents}
              filters={state.propertyFilters}
              members={members}
              onChange={state.setPropertyFilters}
            />
            <div aria-label={t("dashboard.viewMode")} className="view-switch" role="group">
              <button
                aria-label={t("dashboard.kanbanView")}
                aria-pressed={state.view === "kanban"}
                className={state.view === "kanban" ? "active" : ""}
                onClick={() => state.setView("kanban")}
                title={t("dashboard.kanbanView")}
                type="button"
              >
                <Columns3 size={14} />
                <span>{t("dashboard.kanban")}</span>
              </button>
              <button
                aria-label={t("dashboard.listView")}
                aria-pressed={state.view === "list"}
                className={state.view === "list" ? "active" : ""}
                onClick={() => state.setView("list")}
                title={t("dashboard.listView")}
                type="button"
              >
                <List size={14} />
                <span>{t("dashboard.list")}</span>
              </button>
            </div>
            {headerTrailing}
          </div>
        }
        className={`app-page-header queue-header${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region="deep"
        description={headerDescription}
        eyebrow={headerEyebrow}
        title={
          <span className="queue-heading-copy">
            <span>{title}</span>
            <Typography as="span" className="queue-task-count" tone="muted" variant="caption">
              {countLabel(filtered.length)}
            </Typography>
          </span>
        }
      />
      <div className={`dashboard-scroll${scrollClassName ? ` ${scrollClassName}` : ""}`}>
        <div className="queue-filter-bar">
          <div className="status-tabs">
            <button className={state.status === "all" ? "active" : ""} onClick={() => state.setStatus("all")} type="button">
              {t("dashboard.all")} <span>{runs.length}</span>
            </button>
            <button className={state.status === "active" ? "active" : ""} onClick={() => state.setStatus("active")} type="button">
              {t("dashboard.active")} <span>{activeCount}</span>
            </button>
            <button className={state.status === "attention" ? "active" : ""} onClick={() => state.setStatus("attention")} type="button">
              {t("dashboard.attention")} <span>{attentionCount}</span>
            </button>
            <button className={state.status === "completed" ? "active" : ""} onClick={() => state.setStatus("completed")} type="button">
              {t("dashboard.completed")} <span>{completedCount}</span>
            </button>
          </div>
          <div className="source-filter-group">
            <span>{t("dashboard.type")}</span>
            <div className="source-filter">
              {(["all", "issue", "feedback", "error"] as const).map((value) => (
                <button className={state.source === value ? "active" : ""} key={value} onClick={() => state.setSource(value)} type="button">
                  {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {bodyBefore}
        {isLoading ? (
          <div aria-busy="true" aria-live="polite" className="issues-loading-overlay" role="status">
            <LoadingState label={loadingLabel ?? t("dashboard.loadingIssues")} />
          </div>
        ) : runs.length === 0 && emptyContent ? (
          emptyContent
        ) : filtered.length === 0 && filteredEmptyContent ? (
          filteredEmptyContent
        ) : state.view === "list" ? (
          <IssueList
            availableProviders={availableProviders}
            deletingIssueId={deletingIssueId}
            issueKeyPrefixForRun={issueKeyPrefixForRun}
            members={members}
            onCheckpointsChange={onCheckpointsChange ?? noOp}
            onDelete={(runId) => {
              const run = runs.find((candidate) => candidate.id === runId);
              if (run) onDelete?.(run);
            }}
            onEdit={(runId) => {
              const run = runs.find((candidate) => candidate.id === runId);
              if (run) onEdit?.(run);
            }}
            onMove={(run, placement) => onMove?.(run, placement)}
            onOpen={(runId) => {
              const run = runs.find((candidate) => candidate.id === runId);
              if (run) onOpen(run);
            }}
            onPreferencesChange={onPreferencesChange ?? noOp}
            onPriorityChange={onPriorityChange ?? noOp}
            onProcessIssueNow={onProcessNow}
            onTransfer={onTransfer ? (runId) => {
              const run = runs.find((candidate) => candidate.id === runId);
              if (run) onTransfer(run);
            } : undefined}
            processingIssueIds={processingIssueIds}
            projectForRun={projectForRun}
            readOnly={readOnly}
            runs={filtered}
            updatingIssueId={updatingIssueId}
          />
        ) : (
          <div aria-label={t("dashboard.kanbanBoard")} className="kanban-board" data-keyboard-list="" ref={boardRef}>
            {columns.length === 0 ? (
              <div className="companion-no-runs">
                <Bot size={22} />
                <strong>{t("dashboard.emptyTitle")}</strong>
                <span>{t("dashboard.emptyDescription")}</span>
              </div>
            ) : (
              <>
                {visibleColumns.map((column) => {
                  const isCollapsed = collapsed.has(column.id);
                  return (
                    <div className={`kanban-column-shell${isCollapsed ? " is-collapsed" : ""}`} key={column.id}>
                      {column.checkpointsBefore.length > 0 ? (
                        <span aria-label={`${t("settings.workflowCheckpoints")}: ${column.checkpointsBefore.join(", ")}`} className="kanban-checkpoint-marker" data-checkpoint-count={column.checkpointsBefore.length} role="img" tabIndex={0} title={column.checkpointsBefore.join(" · ")}>
                          <svg aria-hidden="true" viewBox="0 0 12 10"><path d="M2 0C1.2 0 .7.8 1.1 1.5l4.1 7.4c.35.65 1.25.65 1.6 0l4.1-7.4C11.3.8 10.8 0 10 0Z" /></svg>
                        </span>
                      ) : null}
                      <section aria-label={column.label} className={`kanban-column ${column.tone}${dragOverColumnId === column.id ? " drag-over" : ""}${isCollapsed ? " is-collapsed" : ""}`} data-kanban-column-collapsed={isCollapsed ? "true" : "false"} data-kanban-column-id={column.id}>
                        <header>
                          <span><i aria-hidden="true" />{column.label}</span>
                          <div className="kanban-column-header-actions">
                            <strong>{column.runs.length}</strong>
                            <button aria-expanded={!isCollapsed} aria-label={isCollapsed ? t("dashboard.expandColumn", { label: column.label }) : t("dashboard.collapseColumn", { label: column.label })} className="kanban-column-collapse" onClick={() => toggleCollapsed(column.id)} type="button">
                              {isCollapsed ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
                            </button>
                            <KanbanColumnMenu label={column.label} onHide={() => toggleHidden(column.id)} />
                          </div>
                        </header>
                        {isCollapsed ? null : (
                          <div className="kanban-column-content">
                            {column.runs.length > 0 ? column.runs.map((run) => (
                              <KanbanCard
                                activeAgent={activeAgentForRun?.(run) ?? null}
                                assignee={members.find((member) => member.userId === run.assigneeUserId) ?? null}
                                assignedWorker={assignedWorkerForRun?.(run) ?? null}
                                availableProviders={availableProviders}
                                cardRef={navigation.getItemRef(run.id)}
                                contextMenuDisabled={readOnly}
                                deletingIssueId={deletingIssueId}
                                hideAssignmentBadges={["completed", "cancelled", "paused", "blocked", "failed"].includes(run.status)}
                                isDragging={draggedRunId === run.id}
                                isKeyboardCursor={cursorRunId === run.id}
                                isMoving={recoveringRunId === run.id}
                                isProcessing={processingIssueIds.has(run.id)}
                                issueKeyPrefix={issueKeyPrefixForRun?.(run)}
                                key={run.id}
                                onCheckpointsChange={(checkpoints) => onCheckpointsChange?.(run, checkpoints)}
                                onDelete={() => onDelete?.(run)}
                                onEdit={() => onEdit?.(run)}
                                onFocus={() => setCursorRunId(run.id)}
                                onMove={(placement) => onMove?.(run, placement)}
                                onOpen={() => {
                                  if (suppressCardClickRef.current) {
                                    suppressCardClickRef.current = false;
                                    return;
                                  }
                                  setCursorRunId(run.id);
                                  if (scrollLeftRef && boardRef.current) {
                                    scrollLeftRef.current = boardRef.current.scrollLeft;
                                  }
                                  onOpen(run);
                                }}
                                onPointerCancel={(event) => {
                                  if (pointerDragRef.current?.pointerId === event.pointerId) clearDrag();
                                }}
                                onPointerDown={(event) => {
                                  if (readOnly || !onMove || run.status === "paused" || event.pointerType === "touch" || !event.isPrimary || event.button !== 0 || (event.target as Element).closest?.("a, button, input, select, textarea")) return;
                                  pointerDragRef.current = { active: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
                                  event.currentTarget.setPointerCapture?.(event.pointerId);
                                }}
                                onPointerMove={(event) => {
                                  const drag = pointerDragRef.current;
                                  if (!drag || drag.pointerId !== event.pointerId) return;
                                  if (!drag.active) {
                                    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
                                    drag.active = true;
                                    const preview = event.currentTarget.cloneNode(true) as HTMLElement;
                                    preview.setAttribute("aria-hidden", "true");
                                    preview.classList.add("kanban-card-drag-preview", "dragging");
                                    preview.style.width = `${event.currentTarget.getBoundingClientRect().width}px`;
                                    document.body.append(preview);
                                    pointerDragPreviewRef.current = preview;
                                    setDraggedRunId(run.id);
                                  }
                                  event.preventDefault();
                                  setDragOverColumnId(columnAtPoint(event.clientX, event.clientY));
                                }}
                                onPointerUp={(event) => {
                                  const drag = pointerDragRef.current;
                                  if (!drag || drag.pointerId !== event.pointerId) return;
                                  if (!drag.active) {
                                    pointerDragRef.current = null;
                                    return;
                                  }
                                  event.preventDefault();
                                  event.stopPropagation();
                                  suppressCardClickRef.current = true;
                                  const target = columns.find((candidate) => candidate.id === columnAtPoint(event.clientX, event.clientY));
                                  clearDrag();
                                  if (target && !placementMatchesRun(run, target.placement)) onMove?.(run, target.placement);
                                }}
                                onPreferencesChange={(preferences) => onPreferencesChange?.(run, preferences)}
                                onPriorityChange={(priority) => onPriorityChange?.(run, priority)}
                                onProcessNow={onProcessNow ? () => onProcessNow(run) : undefined}
                                onTransfer={onTransfer ? () => onTransfer(run) : undefined}
                                project={projectForRun?.(run)}
                                readOnly={readOnly}
                                run={run}
                                token={token ?? null}
                                updatingIssueId={updatingIssueId}
                              />
                            )) : (
                              <div className="kanban-column-empty"><Bot size={18} /><span>{t("dashboard.columnEmpty")}</span></div>
                            )}
                            {onCreateInColumn ? (
                              <button aria-label={t("dashboard.createIssueInColumn", { label: column.label })} className="kanban-column-add" data-kanban-column-add="" onClick={() => onCreateInColumn(column.placement)} type="button">
                                <Plus aria-hidden="true" size={15} /><span>{t("dashboard.createIssue")}</span>
                              </button>
                            ) : null}
                          </div>
                        )}
                      </section>
                    </div>
                  );
                })}
                {hiddenColumns.length > 0 ? (
                  <aside aria-label={t("dashboard.hiddenColumns")} className={`kanban-hidden-columns${hiddenColumnsExpanded ? "" : " is-collapsed"}`} data-kanban-hidden-columns="">
                    <button aria-expanded={hiddenColumnsExpanded} aria-label={hiddenColumnsExpanded ? t("dashboard.collapseHiddenColumns") : t("dashboard.expandHiddenColumns")} className="kanban-hidden-columns-toggle" onClick={() => setHiddenColumnsExpanded((current) => !current)} type="button">
                      {hiddenColumnsExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}<span>{t("dashboard.hiddenColumns")}</span>
                    </button>
                    {hiddenColumnsExpanded ? (
                      <ul className="kanban-hidden-column-list">
                        {hiddenColumns.map((column) => <li className={`kanban-hidden-column ${column.tone}`} data-kanban-hidden-column-id={column.id} key={column.id}><span><i aria-hidden="true" />{column.label}</span><strong>{column.runs.length}</strong><KanbanColumnMenu hidden label={column.label} onShow={() => toggleHidden(column.id)} /></li>)}
                      </ul>
                    ) : null}
                  </aside>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
