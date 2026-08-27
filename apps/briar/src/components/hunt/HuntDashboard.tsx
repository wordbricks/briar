import { Bot, Check, ChevronDown, ChevronRight, Columns3, FolderGit2, FolderInput, List, ListFilter, Plus, Search, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState, MainContent, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { CompanionBottomNavigation, type CompanionStatusFilter } from "@/components/CompanionBottomNavigation";
import type { AutoHuntSession } from "@/hooks/useAutoHuntSessions";
import { inboxIssueMessageVersion } from "@/hooks/useInbox";
import { useAppKeyboardCommandScope } from "@/hooks/appKeyboardCommands";
import { useAppCollectionKeyboardCommandScope } from "@/hooks/useAppCollectionKeyboardCommandScope";
import {
  useControlledCollectionNavigation,
  type CollectionNavigationDirection,
} from "@/hooks/useControlledCollectionNavigation";
import { useMobileBackHandler } from "@/hooks/useMobileNavigation";
import { errorDiagnosticOccurrenceKey, errorDiagnosticsForMessage } from "@/lib/error-diagnostics";
import { runMeta } from "@/lib/stages";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { type IssueDetailTab } from "@/lib/issue-detail-tab";
import { readKanbanCollapsedColumnIds, toggleKanbanCollapsedColumnId, writeKanbanCollapsedColumnIds } from "@/lib/kanban-column-collapse";
import { readKanbanHiddenColumnIds, toggleKanbanHiddenColumnId, writeKanbanHiddenColumnIds } from "@/lib/kanban-column-hide";
import { formatIssueKey } from "@/lib/issue-key";
import type { AgentSkillExecutionApprovalInput, AgentSkillExecutionProposal, CreateIssueInput, DashboardPayload, HuntEvent, HuntRun, HuntRunPlacement, IssueAttachment, IssueMessage, IssueMessageSendResult, IssueProposedAction, IssueExecutionApprovalInput, IssueExecutionProposal, IssueExecutionPreferences, Project, ProjectAgent, RelatedMessageReference, RunEvidence, RunEvidenceImage, UpdateIssueInput } from "@/types";
import { sortAgentProviders, type AgentProvider } from "@/lib/project-llm";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { CompanionTaskSwipeAction } from "./board/CompanionTaskSwipeAction";
import { IssueList } from "./board/IssueList";
import { IssuePropertyFilterMenu } from "./board/IssuePropertyFilterMenu";
import { KanbanCard } from "./board/KanbanCard";
import { KanbanColumnMenu } from "./board/KanbanColumnMenu";
import { RunPage } from "./detail/RunPage";
import { CreateIssueDialog } from "./editor/CreateIssueDialog";
import { EditIssueDialog } from "./editor/EditIssueDialog";
import { DashboardView, IssuePropertyFilters, SourceFilter, StatusFilter, emptyIssuePropertyFilters, runMatchesIssuePropertyFilters } from "./model/filters";
import { localizeWorkflowStage } from "./model/formatters";
import { KanbanColumn, KanbanPointerDrag, kanbanAutoScrollEdge, kanbanAutoScrollInterval, kanbanColumnForRun, kanbanPointerDragThreshold, placementMatchesRun } from "./model/kanban";
function runIdFromCreateIssueResult(value: unknown) {
  if (typeof value !== "object" || value === null || !("runId" in value) || typeof value.runId !== "string") {
    return null;
  }
  return value.runId;
}

type KeyboardKanbanColumn = {
  readonly id: string;
  readonly runIds: readonly string[];
};

function resolveKeyboardKanbanRunId(
  columns: readonly KeyboardKanbanColumn[],
  currentRunId: string | null,
  direction: CollectionNavigationDirection,
): string | null {
  const runIds = columns.flatMap(column => column.runIds);
  if (runIds.length === 0) return null;
  if (currentRunId === null) {
    return direction === "up" || direction === "left"
      ? runIds.at(-1) ?? null
      : runIds[0] ?? null;
  }

  const columnIndex = columns.findIndex(column =>
    column.runIds.includes(currentRunId)
  );
  if (columnIndex < 0) return runIds[0] ?? null;
  const column = columns[columnIndex]!;
  const rowIndex = column.runIds.indexOf(currentRunId);

  if (direction === "up" || direction === "down") {
    const nextRowIndex = Math.min(
      column.runIds.length - 1,
      Math.max(0, rowIndex + (direction === "up" ? -1 : 1)),
    );
    return column.runIds[nextRowIndex] ?? currentRunId;
  }
  if (direction !== "left" && direction !== "right") return null;

  const targetColumn = columns[
    columnIndex + (direction === "left" ? -1 : 1)
  ];
  if (!targetColumn) return currentRunId;
  return targetColumn.runIds[
    Math.min(rowIndex, targetColumn.runIds.length - 1)
  ] ?? currentRunId;
}

export function HuntDashboard({
  agents = [],
  companionMode = false,
  companionStatus,
  companionUnreadDmCount = 0,
  companionUnreadInboxCount = 0,
  conversationInboxSyncSignal,
  currentUserId = null,
  createIssueDefaultProjectId,
  dashboard,
  error,
  isCreatingIssue,
  isIssueDialogOpen: controlledIsIssueDialogOpen,
  deletingIssueId,
  updatingIssueId,
  noProject = false,
  recoveringRunId,
  recoveryError,
  isSidebarOpen,
  onAddProject,
  onCreateIssue,
  projects = [],
  onIssueDialogOpenChange,
  onDeleteIssue,
  onTransferIssue,
  onAddIssueDependency,
  onAcceptIssueAction,
  onAcceptIssueExecution,
  onAcceptSkillExecution,
  onRemoveIssueDependency,
  onRelatedMessageOpen,
  onUpdateIssue,
  onUpdateIssueCheckpoints = async () => undefined,
  onUpdateIssuePreferences = async () => undefined,
  onUpdateIssueSubscription,
  onLoadAttachment,
  onLoadIssueMessages,
  onLoadRunEvents = async () => [],
  onLoadRunEvidence,
  onLoadRunEvidenceImage,
  onCompleteResultReview,
  onMoveRun,
  onProcessIssueNow,
  onRetryRun,
  onReworkRun,
  onCancelRun,
  onUnassignRun,
  onResumeRun = async () => undefined,
  onCompanionDmsOpen,
  onCompanionInboxOpen,
  onCompanionHomeOpen,
  onCompanionStatusChange,
  onIssueViewed,
  onViewingIssueConversationChange,
  onSelectedRunChange,
  onRequestedRunOpen,
  onSendIssueMessage,
  onEditIssueMessage = async () => {
    throw new Error("메시지 수정 기능을 사용할 수 없습니다.");
  },
  onDeleteIssueMessage = async () => undefined,
  requestedRunId = null,
  requestedRunMessageId = null,
  requestedRunInitialTab = null,
  selectedRunId: controlledSelectedRunId,
  issueListRequestKey = 0,
  processingIssueIds = new Set<string>(),
  sessions = [],
  token = null
}: {
  agents?: ProjectAgent[];
  companionMode?: boolean;
  companionStatus?: CompanionStatusFilter;
  companionUnreadDmCount?: number;
  companionUnreadInboxCount?: number;
  conversationInboxSyncSignal?: string;
  currentUserId?: string | null;
  createIssueDefaultProjectId?: string | null;
  dashboard: DashboardPayload | null;
  error: string | null;
  isCreatingIssue: boolean;
  isIssueDialogOpen?: boolean;
  deletingIssueId: string | null;
  updatingIssueId: string | null;
  noProject?: boolean;
  recoveringRunId: string | null;
  recoveryError: string | null;
  isSidebarOpen: boolean;
  onAddProject?: () => void;
  onCreateIssue: (projectId: string, input: CreateIssueInput) => Promise<unknown>;
  projects?: Project[];
  onIssueDialogOpenChange?: (isOpen: boolean) => void;
  onDeleteIssue: (runId: string) => Promise<unknown>;
  onTransferIssue?: (runId: string, targetProjectId: string) => Promise<unknown>;
  onAddIssueDependency?: (dependentRunId: string, prerequisiteRunId: string) => Promise<unknown>;
  onAcceptIssueAction?: (runId: string, proposal: IssueProposedAction) => Promise<IssueProposedAction>;
  onAcceptIssueExecution?: (runId: string, proposal: IssueExecutionProposal, input: IssueExecutionApprovalInput) => Promise<IssueExecutionProposal>;
  onAcceptSkillExecution?: (runId: string, proposal: AgentSkillExecutionProposal, input: AgentSkillExecutionApprovalInput) => Promise<AgentSkillExecutionProposal>;
  onRemoveIssueDependency?: (dependentRunId: string, prerequisiteRunId: string) => Promise<unknown>;
  onRelatedMessageOpen?: (relatedMessage: RelatedMessageReference) => void;
  onUpdateIssue: (runId: string, input: UpdateIssueInput) => Promise<unknown>;
  onUpdateIssueCheckpoints?: (runId: string, checkpoints: AutoHuntWorkflowCheckpoint[]) => Promise<unknown>;
  onUpdateIssuePreferences?: (runId: string, input: IssueExecutionPreferences) => Promise<unknown>;
  onUpdateIssueSubscription?: (runId: string, subscribed: boolean) => Promise<unknown>;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: (runId: string) => Promise<IssueMessage[]>;
  onLoadRunEvents?: (runId: string) => Promise<HuntEvent[]>;
  onLoadRunEvidence: (runId: string) => Promise<RunEvidence[]>;
  onLoadRunEvidenceImage?: (image: RunEvidenceImage) => Promise<Blob>;
  onCompleteResultReview?: (runId: string) => Promise<unknown>;
  onMoveRun: (runId: string, placement: HuntRunPlacement) => Promise<unknown>;
  onProcessIssueNow?: (run: HuntRun) => void;
  onRetryRun: (runId: string) => Promise<unknown>;
  onReworkRun?: (runId: string, input: {
    workflowStage: string;
    reason: string;
  }) => Promise<unknown>;
  onCancelRun: (runId: string) => Promise<unknown>;
  onUnassignRun?: (runId: string) => Promise<unknown>;
  onResumeRun?: (runId: string) => Promise<unknown>;
  onCompanionDmsOpen?: () => void;
  onCompanionInboxOpen?: () => void;
  onCompanionHomeOpen?: () => void;
  onCompanionStatusChange?: (status: CompanionStatusFilter) => void;
  onIssueViewed?: (runId: string) => void;
  onViewingIssueConversationChange?: (runId: string | null) => void;
  onSelectedRunChange?: (runId: string | null) => void;
  onRequestedRunOpen?: () => void;
  onSendIssueMessage: (runId: string, input: {
    body: string;
    clientMessageId?: string;
    parentMessageId: string | null;
    mentionedUserIds?: string[];
    mentionedAgentIds?: string[];
    attachments?: File[];
    attachmentReferences?: string[];
  }) => Promise<IssueMessageSendResult>;
  onEditIssueMessage?: (runId: string, messageId: string, input: {
    body: string;
    mentionedUserIds?: string[];
  }) => Promise<IssueMessage>;
  onDeleteIssueMessage?: (runId: string, messageId: string) => Promise<unknown>;
  requestedRunId?: string | null;
  requestedRunMessageId?: string | null;
  requestedRunInitialTab?: IssueDetailTab | null;
  selectedRunId?: string | null;
  issueListRequestKey?: number;
  processingIssueIds?: ReadonlySet<string>;
  sessions?: AutoHuntSession[];
  token?: string | null;
}) {
  const {
    t
  } = useI18n();
  const {
    toast
  } = useToast();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [propertyFilters, setPropertyFilters] = useState<IssuePropertyFilters>(emptyIssuePropertyFilters);
  const [isSourceFilterOpen, setIsSourceFilterOpen] = useState(false);
  const sourceFilterRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<DashboardView>("kanban");
  const [collapsedColumnIds, setCollapsedColumnIds] = useState<string[]>([]);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);
  const [hiddenColumnsExpanded, setHiddenColumnsExpanded] = useState(true);
  const [internalStatus, setInternalStatus] = useState<StatusFilter>("all");
  const status = companionMode && companionStatus ? companionStatus : internalStatus;
  const setStatus = companionMode && onCompanionStatusChange ? onCompanionStatusChange : setInternalStatus;
  const [internalSelectedRunId, setInternalSelectedRunId] = useState<string | null>(null);
  const [kanbanCursorRunId, setKanbanCursorRunId] = useState<string | null>(null);
  const selectedRunId = controlledSelectedRunId === undefined ? internalSelectedRunId : controlledSelectedRunId;
  const setSelectedRunId = useCallback((runId: string | null) => {
    if (controlledSelectedRunId === undefined) {
      setInternalSelectedRunId(runId);
    }
    onSelectedRunChange?.(runId);
  }, [controlledSelectedRunId, onSelectedRunChange]);
  const [selectedRunInitialTab, setSelectedRunInitialTab] = useState<IssueDetailTab | null>(null);
  const [selectedRunMessageId, setSelectedRunMessageId] = useState<string | null>(null);
  const [internalIsIssueDialogOpen, setInternalIsIssueDialogOpen] = useState(false);
  const isIssueDialogOpen = controlledIsIssueDialogOpen ?? internalIsIssueDialogOpen;
  const [createIssuePlacement, setCreateIssuePlacement] = useState<HuntRunPlacement | null>(null);
  const setIsIssueDialogOpen = useCallback((isOpen: boolean) => {
    setInternalIsIssueDialogOpen(isOpen);
    onIssueDialogOpenChange?.(isOpen);
  }, [onIssueDialogOpenChange]);
  const openCreateIssueDialog = useCallback((placement: HuntRunPlacement | null = null) => {
    setCreateIssuePlacement(placement);
    setIsIssueDialogOpen(true);
  }, [setIsIssueDialogOpen]);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [transferringRunFromMenuId, setTransferringRunFromMenuId] = useState<string | null>(null);
  const [transferTargetProjectId, setTransferTargetProjectId] = useState("");
  const [contextTransferError, setContextTransferError] = useState<string | null>(null);
  const [deletingRunFromMenuId, setDeletingRunFromMenuId] = useState<string | null>(null);
  const [contextDeleteError, setContextDeleteError] = useState<string | null>(null);
  useMobileBackHandler(() => {
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
      setSelectedRunMessageId(null);
      setSelectedRunInitialTab(null);
      setSelectedRunId(null);
      return true;
    }
    return false;
  }, {
    enabled: companionMode,
    priority: 100
  });
  const [draggedRunId, setDraggedRunId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const suppressCardClickRef = useRef(false);
  const kanbanBoardRef = useRef<HTMLDivElement>(null);
  const kanbanScrollLeftRef = useRef<number | null>(null);
  const pointerDragRef = useRef<KanbanPointerDrag | null>(null);
  const pointerDragPositionRef = useRef({
    x: 0,
    y: 0
  });
  const pointerDragPreviewRef = useRef<HTMLElement | null>(null);
  const pointerAutoScrollRef = useRef<number | null>(null);
  const rememberKanbanScrollPosition = useCallback(() => {
    const board = kanbanBoardRef.current;
    if (!board) return;
    kanbanScrollLeftRef.current = board.scrollLeft;
  }, []);
  const stopKanbanAutoScroll = useCallback(() => {
    if (pointerAutoScrollRef.current === null) return;
    window.clearInterval(pointerAutoScrollRef.current);
    pointerAutoScrollRef.current = null;
  }, []);
  const clearKanbanDragState = useCallback(() => {
    stopKanbanAutoScroll();
    pointerDragRef.current = null;
    pointerDragPreviewRef.current?.remove();
    pointerDragPreviewRef.current = null;
    setDraggedRunId(null);
    setDragOverColumnId(null);
  }, [stopKanbanAutoScroll]);
  const kanbanColumnIdAtPoint = useCallback((clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY);
    return target?.closest<HTMLElement>("[data-kanban-column-id]")?.dataset.kanbanColumnId ?? null;
  }, []);
  const updateKanbanPointerDrag = useCallback((clientX: number, clientY: number) => {
    pointerDragPositionRef.current = {
      x: clientX,
      y: clientY
    };
    if (pointerDragPreviewRef.current) {
      pointerDragPreviewRef.current.style.transform = `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
    }
    const columnId = kanbanColumnIdAtPoint(clientX, clientY);
    setDragOverColumnId(columnId);
  }, [kanbanColumnIdAtPoint]);
  const startKanbanAutoScroll = useCallback(() => {
    if (pointerAutoScrollRef.current !== null) return;
    pointerAutoScrollRef.current = window.setInterval(() => {
      const board = kanbanBoardRef.current;
      const drag = pointerDragRef.current;
      if (!board || !drag?.active) return;
      const rect = board.getBoundingClientRect();
      const {
        x,
        y
      } = pointerDragPositionRef.current;
      if (y < rect.top || y > rect.bottom) return;
      const edge = Math.min(kanbanAutoScrollEdge, rect.width / 4);
      const leftDistance = x - rect.left;
      const rightDistance = rect.right - x;
      const delta = leftDistance < edge ? -Math.ceil((edge - Math.max(0, leftDistance)) / 5) : rightDistance < edge ? Math.ceil((edge - Math.max(0, rightDistance)) / 5) : 0;
      if (!delta) return;
      const previousScrollLeft = board.scrollLeft;
      board.scrollLeft += delta;
      if (board.scrollLeft !== previousScrollLeft) {
        updateKanbanPointerDrag(x, y);
      }
    }, kanbanAutoScrollInterval);
  }, [updateKanbanPointerDrag]);
  useEffect(() => () => {
    stopKanbanAutoScroll();
    pointerDragPreviewRef.current?.remove();
  }, [stopKanbanAutoScroll]);
  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: noProject
      ? {}
      : {
          createIssueFromSystemShortcut: {
            run: () => {
              openCreateIssueDialog();
              return "handled";
            },
          },
        },
    id: "hunt-dashboard-page",
    priority: 50,
  });
  useEffect(() => {
    setPropertyFilters(emptyIssuePropertyFilters());
  }, [dashboard?.project.id]);
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
  const issuesLoading = dashboard === null && !noProject && !error && !recoveryError;
  const selected = runs.find(run => run.id === selectedRunId) ?? null;
  const displayedError = error ?? recoveryError;
  const lastDisplayedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!displayedError) {
      lastDisplayedErrorRef.current = null;
      return;
    }
    if (lastDisplayedErrorRef.current === displayedError) return;
    lastDisplayedErrorRef.current = displayedError;
    toast(displayedError, {
      dedupeKey: errorDiagnosticOccurrenceKey(displayedError) ?? undefined,
      details: errorDiagnosticsForMessage(displayedError),
      tone: "error"
    });
  }, [displayedError, toast]);
  const selectedInboxVersion = selected ? [inboxIssueMessageVersion(selected), ...(dashboard?.conversationNotifications ?? []).filter(notification => notification.runId === selected.id).map(notification => notification.id).sort()].join(":") : null;
  const editingRun = runs.find(run => run.id === editingRunId) ?? null;
  const deletingRunFromMenu = runs.find(run => run.id === deletingRunFromMenuId) ?? null;
  const transferringRunFromMenu = runs.find(run => run.id === transferringRunFromMenuId) ?? null;
  const transferDestinationProjects = useMemo(() => {
    const activeProjectId = dashboard?.project.id;
    const organizationId = dashboard?.project.organizationId;
    if (!activeProjectId) return [];
    return projects.filter(project => project.id !== activeProjectId && (!organizationId || project.organizationId === organizationId));
  }, [dashboard?.project.id, dashboard?.project.organizationId, projects]);
  const activeCount = runs.filter(run => !["completed", "cancelled"].includes(run.status)).length;
  const attentionCount = runs.filter(run => ["paused", "blocked", "failed"].includes(run.status)).length;
  const completedCount = runs.filter(run => ["completed", "cancelled"].includes(run.status)).length;
  const filtered = useMemo(() => {
    const normalized = companionMode ? "" : query.trim().toLowerCase();
    const next = runs.filter(run => {
      if (source !== "all" && run.source !== source) return false;
      if (!runMatchesIssuePropertyFilters(run, propertyFilters)) return false;
      if (status === "active" && ["completed", "cancelled"].includes(run.status)) return false;
      if (status === "attention" && !["paused", "blocked", "failed"].includes(run.status)) return false;
      if (status === "completed" && !["completed", "cancelled"].includes(run.status)) return false;
      return !normalized || [run.title, run.sourceKey, run.repository, formatIssueKey(dashboard?.project.issueKeyPrefix, run.runNumber)].join(" ").toLowerCase().includes(normalized);
    });
    // Mobile companion Tasks list: newest updated first (iOS native parity).
    if (!companionMode) return next;
    return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [companionMode, dashboard?.project.issueKeyPrefix, query, propertyFilters, runs, source, status]);
  const agentAssociationsByRunId = useMemo(() => {
    const agentById = new Map(agents.map(agent => [agent.id, agent]));
    const activeAgents = new Map<string, ProjectAgent>();
    const performedAgents = new Map<string, ProjectAgent>();
    for (const run of runs) {
      const agent = run.agentId ? agentById.get(run.agentId) : null;
      if (!agent) continue;
      performedAgents.set(run.id, agent);
      if (!["backlog", "queued", "completed", "cancelled", "paused", "blocked", "failed"].includes(run.status)) {
        activeAgents.set(run.id, agent);
      }
    }
    const recentSessions = [...sessions].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
    for (const session of recentSessions) {
      if (session.projectId !== dashboard?.project.id || !session.agentId) continue;
      const agent = agentById.get(session.agentId);
      if (!agent) continue;
      for (const issue of session.issues) {
        if (!performedAgents.has(issue.runId)) {
          performedAgents.set(issue.runId, agent);
        }
        if (session.status === "running" && issue.outcome === "pending" && !activeAgents.has(issue.runId)) {
          activeAgents.set(issue.runId, agent);
        }
      }
    }
    return {
      activeAgents,
      performedAgents
    };
  }, [agents, dashboard?.project.id, runs, sessions]);
  const workerById = useMemo(() => new Map((dashboard?.workers ?? []).map(worker => [worker.id, worker])), [dashboard?.workers]);
  const availableProviders = useMemo<AgentProvider[]>(() => {
    if (dashboard?.organizationProviders?.length) {
      return sortAgentProviders(dashboard.organizationProviders);
    }
    return sortAgentProviders([...new Set((dashboard?.workers ?? []).flatMap(worker => worker.providers ?? []))]);
  }, [dashboard?.organizationProviders, dashboard?.workers]);
  useEffect(() => {
    setSelectedRunMessageId(null);
    setSelectedRunInitialTab(null);
    setSelectedRunId(null);
  }, [issueListRequestKey]);
  useEffect(() => {
    if (!requestedRunId) return;
    if (!runs.some(run => run.id === requestedRunId)) return;
    setSelectedRunMessageId(requestedRunMessageId);
    setSelectedRunInitialTab(requestedRunInitialTab);
    setSelectedRunId(requestedRunId);
    onRequestedRunOpen?.();
  }, [onRequestedRunOpen, requestedRunId, requestedRunInitialTab, requestedRunMessageId, runs]);
  useEffect(() => {
    if (!selected || !selectedInboxVersion) return;
    onIssueViewed?.(selected.id);
  }, [onIssueViewed, selected?.id, selectedInboxVersion]);
  const projectId = dashboard?.project.id ?? null;
  useEffect(() => {
    setCollapsedColumnIds(readKanbanCollapsedColumnIds(currentUserId, projectId));
    setHiddenColumnIds(readKanbanHiddenColumnIds(currentUserId, projectId));
  }, [currentUserId, projectId]);
  const collapsedColumnIdSet = useMemo(() => new Set(collapsedColumnIds), [collapsedColumnIds]);
  const hiddenColumnIdSet = useMemo(() => new Set(hiddenColumnIds), [hiddenColumnIds]);
  const toggleKanbanColumnCollapsed = useCallback((columnId: string) => {
    setCollapsedColumnIds(current => {
      const next = toggleKanbanCollapsedColumnId(current, columnId);
      writeKanbanCollapsedColumnIds(currentUserId, projectId, next);
      return next;
    });
  }, [currentUserId, projectId]);
  const toggleKanbanColumnHidden = useCallback((columnId: string) => {
    setHiddenColumnIds(current => {
      const next = toggleKanbanHiddenColumnId(current, columnId);
      writeKanbanHiddenColumnIds(currentUserId, projectId, next);
      return next;
    });
  }, [currentUserId, projectId]);
  const kanbanColumns = useMemo<KanbanColumn[]>(() => {
    const workflow = dashboard?.settings.workflow;
    const workflowStages = workflow?.stages ?? [];
    const stageLabels = new Map(workflowStages.map(stage => [stage.id, localizeWorkflowStage(t, stage.id, stage.label)]));
    const definitions = [{
      id: "status:backlog",
      label: t("status.backlog"),
      tone: "slate",
      placement: {
        status: "backlog" as const,
        workflowStage: null
      }
    }, {
      id: "status:queued",
      label: t("status.queued"),
      tone: "slate",
      placement: {
        status: "queued" as const,
        workflowStage: null
      }
    }, ...workflowStages.map(stage => ({
      id: `stage:${stage.id}`,
      label: stageLabels.get(stage.id) ?? stage.label,
      tone: runMeta("running", stage.id, workflow).tone,
      placement: {
        status: "running" as const,
        workflowStage: stage.id
      }
    })), {
      id: "status:blocked",
      label: t("status.blocked"),
      tone: "rose",
      placement: {
        status: "blocked" as const,
        workflowStage: null
      }
    }, {
      id: "status:failed",
      label: t("status.failed"),
      tone: "red",
      placement: {
        status: "failed" as const,
        workflowStage: null
      }
    }, {
      id: "status:completed",
      label: t("status.completed"),
      tone: "emerald",
      placement: {
        status: "completed" as const,
        workflowStage: null
      }
    }, {
      id: "status:cancelled",
      label: t("status.cancelled"),
      tone: "slate",
      placement: {
        status: "cancelled" as const,
        workflowStage: null
      }
    }];
    const checkpointsByBoundary = new Map<string, string[]>();
    const checkpointPolicy = dashboard?.settings.checkpointPolicy;
    const effectiveCheckpoints = checkpointPolicy ? checkpointPolicy.effective : workflow?.execution.checkpoints ?? [];
    for (const checkpoint of effectiveCheckpoints) {
      const stageColumnIndex = definitions.findIndex(column => column.id === `stage:${checkpoint.stage}`);
      if (stageColumnIndex < 0) continue;
      const nextColumn = definitions[stageColumnIndex + (checkpoint.position === "after" ? 1 : 0)];
      // After the last workflow stage there is no review column anymore.
      // Keep the marker on that stage instead of the following status column.
      const boundaryColumn = checkpoint.position === "after" && nextColumn && !nextColumn.id.startsWith("stage:") ? definitions[stageColumnIndex] : nextColumn;
      const stageLabel = stageLabels.get(checkpoint.stage) ?? checkpoint.stage;
      const label = checkpoint.position === "before" ? t("run.checkpointBefore", {
        stage: stageLabel
      }) : t("run.checkpointAfter", {
        stage: stageLabel
      });
      if (!boundaryColumn) continue;
      checkpointsByBoundary.set(boundaryColumn.id, [...(checkpointsByBoundary.get(boundaryColumn.id) ?? []), label]);
    }
    const visibleDefinitions = definitions.filter(column => {
      if (status === "active") {
        return !["status:completed", "status:cancelled"].includes(column.id);
      }
      if (status === "attention") {
        return column.id.startsWith("stage:") || ["status:blocked", "status:failed"].includes(column.id);
      }
      if (status === "completed") {
        return ["status:completed", "status:cancelled"].includes(column.id);
      }
      return true;
    });
    const showsWorkflowStages = visibleDefinitions.some(column => column.id.startsWith("stage:"));
    const grouped = new Map(visibleDefinitions.map(column => [column.id, [] as HuntRun[]]));
    for (const run of filtered) {
      const columnId = kanbanColumnForRun(run, workflowStages.map(stage => stage.id));
      grouped.get(columnId)?.push(run);
    }
    const columns = visibleDefinitions.map(column => ({
      ...column,
      runs: grouped.get(column.id) ?? [],
      checkpointsBefore: showsWorkflowStages ? checkpointsByBoundary.get(column.id) ?? [] : []
    }));
    const boardColumns = status === "attention" ? columns.filter(column => !column.id.startsWith("stage:") || column.runs.length > 0) : columns;
    // Mobile companion Tasks: one newest-updated-first stream (iOS TaskListView parity),
    // not status/stage columns.
    if (companionMode) {
      return filtered.length > 0 ? [{
        id: "companion-tasks",
        label: t("companion.navTasks"),
        tone: "slate",
        placement: {
          status: "queued" as const,
          workflowStage: null
        },
        runs: filtered,
        checkpointsBefore: []
      }] : [];
    }
    return boardColumns;
  }, [companionMode, dashboard?.settings.checkpointPolicy, dashboard?.settings.workflow, filtered, status, t]);
  useLayoutEffect(() => {
    if (companionMode || issuesLoading || selectedRunId !== null || view !== "kanban") return;
    const board = kanbanBoardRef.current;
    const scrollLeft = kanbanScrollLeftRef.current;
    if (!board || scrollLeft === null) return;
    board.scrollLeft = scrollLeft;
    kanbanScrollLeftRef.current = null;
  }, [companionMode, dashboard, issuesLoading, selectedRunId, view]);
  const visibleKanbanColumns = useMemo(() => companionMode ? kanbanColumns : kanbanColumns.filter(column => !hiddenColumnIdSet.has(column.id)), [companionMode, hiddenColumnIdSet, kanbanColumns]);
  const hiddenKanbanColumns = useMemo(() => companionMode ? [] : kanbanColumns.filter(column => hiddenColumnIdSet.has(column.id)), [companionMode, hiddenColumnIdSet, kanbanColumns]);
  const keyboardKanbanColumns = useMemo<KeyboardKanbanColumn[]>(() =>
    visibleKanbanColumns.flatMap(column => {
      const isCollapsed = !companionMode && collapsedColumnIdSet.has(column.id);
      if (isCollapsed || column.runs.length === 0) return [];
      return [{
        id: column.id,
        runIds: column.runs.map(run => run.id),
      }];
    }), [collapsedColumnIdSet, companionMode, visibleKanbanColumns]);
  const keyboardKanbanRunIds = useMemo(
    () => keyboardKanbanColumns.flatMap(column => column.runIds),
    [keyboardKanbanColumns],
  );
  const kanbanNavigation = useControlledCollectionNavigation<string, HTMLDivElement>({
    cursorId: kanbanCursorRunId,
    itemIds: keyboardKanbanRunIds,
    onCursorIdChange: setKanbanCursorRunId,
    orientation: "both",
    resolveNextId: ({ currentId, direction }) =>
      resolveKeyboardKanbanRunId(
        keyboardKanbanColumns,
        currentId,
        direction,
      ),
    selectedId: null,
    selectionBehavior: "manual",
  });
  useAppCollectionKeyboardCommandScope({
    enabled: !companionMode &&
      view === "kanban" &&
      selected === null &&
      !issuesLoading &&
      keyboardKanbanRunIds.length > 0,
    id: "hunt-kanban-board",
    move: kanbanNavigation.move,
    orientation: "both",
    rootRef: kanbanBoardRef,
  });
  useEffect(() => {
    setKanbanCursorRunId(current =>
      current !== null && !keyboardKanbanRunIds.includes(current)
        ? null
        : current
    );
  }, [keyboardKanbanRunIds]);
  const createIssueDialog = isIssueDialogOpen ? <CreateIssueDialog availableProviders={availableProviders} compactHeader={companionMode} defaultProjectId={createIssueDefaultProjectId ?? dashboard?.project.id} defaultStatus={createIssuePlacement?.status === "backlog" ? "backlog" : "queued"} isSubmitting={isCreatingIssue} onClose={() => {
    setCreateIssuePlacement(null);
    setIsIssueDialogOpen(false);
  }} onCreate={async (projectId, input) => {
    const created = await onCreateIssue(projectId, input);
    const createdRunId = runIdFromCreateIssueResult(created);
    const placement = createIssuePlacement;
    if (createdRunId && placement && (placement.status !== input.status || placement.workflowStage !== null)) {
      try {
        await onMoveRun(createdRunId, placement);
      } catch {
        // The issue has already been created. The move handler reports its own error.
      }
    }
    setCreateIssuePlacement(null);
    setIsIssueDialogOpen(false);
  }} projects={projects.length > 0 ? projects : dashboard ? [dashboard.project] : []} members={dashboard?.members ?? []} workflow={dashboard ? {
    ...dashboard.settings.workflow,
    execution: {
      checkpoints: dashboard.settings.checkpointPolicy?.effective ?? dashboard.settings.workflow.execution.checkpoints
    }
  } : undefined} workflowProjectId={dashboard?.project.id} /> : null;
  if (noProject) {
    return <MainContent id="issues">
        {!companionMode && <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region="deep" />}
        <EmptyState action={<Button onClick={onAddProject} type="button">
              <Plus size={15} />
              {t("projectEmpty.createProject")}
            </Button>} className="project-empty h-full" description={t("projectEmpty.description")} icon={<FolderGit2 size={24} />} title={<>
              <Typography as="p" className="eyebrow mb-2" tone="primary" variant="micro">
                {t("projectEmpty.eyebrow")}
              </Typography>
              {t("projectEmpty.title")}
            </>} />
      </MainContent>;
  }
  if (selected) {
    return <>
      <RunPage assignedWorker={workerById.get(selected.workerId ?? "") ?? workerById.get(selected.requestedWorkerId ?? "") ?? null} companionMode={companionMode} conversationInboxSyncSignal={conversationInboxSyncSignal} highlightedMessageId={selectedRunMessageId} initialDetailTab={selectedRunInitialTab ?? undefined} issueKeyPrefix={dashboard?.project.issueKeyPrefix} currentUserId={currentUserId} error={displayedError} showErrorToast={false} isDeletingIssue={deletingIssueId === selected.id} isRecovering={recoveringRunId === selected.id} isUpdatingIssue={updatingIssueId === selected.id} isSidebarOpen={isSidebarOpen} onBack={() => {
        setSelectedRunMessageId(null);
        setSelectedRunInitialTab(null);
        setSelectedRunId(null);
      }} onCancel={() => onCancelRun(selected.id)} onDelete={async () => {
        await onDeleteIssue(selected.id);
        setSelectedRunMessageId(null);
        setSelectedRunInitialTab(null);
        setSelectedRunId(null);
      }} onTransfer={onTransferIssue ? async targetProjectId => {
        await onTransferIssue(selected.id, targetProjectId);
        setSelectedRunMessageId(null);
        setSelectedRunInitialTab(null);
        setSelectedRunId(null);
      } : undefined} transferProjects={transferDestinationProjects} onAddDependency={onAddIssueDependency ? prerequisiteRunId => onAddIssueDependency(selected.id, prerequisiteRunId) : undefined} onAcceptIssueAction={onAcceptIssueAction ? proposal => onAcceptIssueAction(selected.id, proposal) : undefined} onAcceptIssueExecution={onAcceptIssueExecution ? (proposal, input) => onAcceptIssueExecution(selected.id, proposal, input) : undefined} onAcceptSkillExecution={onAcceptSkillExecution ? (proposal, input) => onAcceptSkillExecution(selected.id, proposal, input) : undefined} onRemoveDependency={onRemoveIssueDependency ? prerequisiteRunId => onRemoveIssueDependency(selected.id, prerequisiteRunId) : undefined} onRelatedMessageOpen={onRelatedMessageOpen} onDependencyOpen={runId => {
        setSelectedRunMessageId(null);
        setSelectedRunInitialTab(null);
        setSelectedRunId(runId);
      }} onLoadAttachment={onLoadAttachment} onLoadIssueMessages={() => onLoadIssueMessages(selected.id)} onLoadRunEvents={() => onLoadRunEvents(selected.id)} onLoadRunEvidence={() => onLoadRunEvidence(selected.id)} onLoadRunEvidenceImage={onLoadRunEvidenceImage} onViewingIssueConversationChange={onViewingIssueConversationChange} onCompleteResultReview={onCompleteResultReview ? () => onCompleteResultReview(selected.id) : undefined} mentionMembers={dashboard?.members ?? []} mentionAgents={agents.filter(agent => agent.projectId === dashboard?.project.id)} onMove={placement => onMoveRun(selected.id, placement)} onProcessNow={onProcessIssueNow ? () => onProcessIssueNow(selected) : undefined} onRetry={() => onRetryRun(selected.id)} onRework={onReworkRun ? input => onReworkRun(selected.id, input) : undefined} onResume={() => onResumeRun(selected.id)} onSendIssueMessage={input => onSendIssueMessage(selected.id, input)} onEditIssueMessage={(messageId, input) => onEditIssueMessage(selected.id, messageId, input)} onDeleteIssueMessage={messageId => onDeleteIssueMessage(selected.id, messageId)} onUpdateIssue={input => onUpdateIssue(selected.id, input)} onUpdateIssueCheckpoints={checkpoints => onUpdateIssueCheckpoints(selected.id, checkpoints)} onUpdateIssuePreferences={input => onUpdateIssuePreferences(selected.id, input)} onUpdateIssueSubscription={onUpdateIssueSubscription ? subscribed => onUpdateIssueSubscription(selected.id, subscribed) : undefined} availableProviders={availableProviders} executionPolicy={dashboard?.executionPolicy} executionWorkers={dashboard?.workers ?? []} performedAgentName={agentAssociationsByRunId.performedAgents.get(selected.id)?.name ?? null} performedAgentProvider={agentAssociationsByRunId.performedAgents.get(selected.id)?.provider ?? null} performedAgentModel={agentAssociationsByRunId.performedAgents.get(selected.id)?.model ?? null} organizationId={dashboard!.project.organizationId} projectId={dashboard!.project.id} run={selected} isProcessing={processingIssueIds.has(selected.id)} availableRuns={dashboard!.runs} token={token} />
        {createIssueDialog}
      </>;
  }
  return <MainContent id="issues">
      {!companionMode ? <PageHeader action={<div className="queue-tools">
              <label className="search-box">
                <Input className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" onChange={e => setQuery(e.target.value)} placeholder={t("dashboard.search")} value={query} />
                <Search aria-hidden="true" size={15} />
              </label>
              <IssuePropertyFilterMenu agents={agents} filters={propertyFilters} members={dashboard?.members ?? []} onChange={setPropertyFilters} />
              <div aria-label={t("dashboard.viewMode")} className="view-switch" role="group">
                <button aria-label={t("dashboard.kanbanView")} aria-pressed={view === "kanban"} className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")} title={t("dashboard.kanbanView")} type="button">
                  <Columns3 size={14} />
                  <span>{t("dashboard.kanban")}</span>
                </button>
                <button aria-label={t("dashboard.listView")} aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")} title={t("dashboard.listView")} type="button">
                  <List size={14} />
                  <span>{t("dashboard.list")}</span>
                </button>
              </div>
              <Button aria-keyshortcuts="Meta+N" aria-label={t("dashboard.createIssue")} className="create-issue-button" onClick={() => openCreateIssueDialog()} type="button">
                <Plus size={16} />
                {t("issue.newIssue")}
              </Button>
            </div>} className={`app-page-header queue-header${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region="deep" title={<span className="queue-heading-copy">
              <span>{t("dashboard.queue")}</span>
              <Typography as="span" className="queue-task-count" tone="muted" variant="caption">
                {t("dashboard.taskCount", {
          count: runs.length
        })}
              </Typography>
            </span>} /> : null}
      <div className="dashboard-scroll">
        {companionMode ? <div className="queue-header">
            <div className="queue-heading">
              <div className="queue-heading-copy">
                <Typography as="span" tone="muted" variant="caption">
                  {t("dashboard.taskCount", {
                count: filtered.length
              })}
                </Typography>
              </div>
              <div className="companion-source-filter" ref={sourceFilterRef}>
                <button aria-controls="companion-source-filter-menu" aria-expanded={isSourceFilterOpen} aria-haspopup="menu" aria-label={t("dashboard.filter")} className={`companion-filter-trigger${source !== "all" ? " active" : ""}`} onClick={() => setIsSourceFilterOpen(current => !current)} type="button">
                  <ListFilter size={18} />
                </button>
                {isSourceFilterOpen && <div aria-label={t("dashboard.filter")} className="companion-filter-menu" id="companion-source-filter-menu" role="menu">
                    {(["all", "issue", "feedback", "error"] as const).map(value => <button aria-checked={source === value} className={source === value ? "active" : ""} key={value} onClick={() => {
                setSource(value);
                setIsSourceFilterOpen(false);
              }} role="menuitemradio" type="button">
                          <span>
                            {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
                          </span>
                          {source === value && <Check size={15} />}
                        </button>)}
                  </div>}
              </div>
            </div>
          </div> : null}
        {!companionMode && <div className="queue-filter-bar">
            <div className="status-tabs">
              <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>{t("dashboard.all")} <span>{runs.length}</span></button>
              <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>{t("dashboard.active")} <span>{activeCount}</span></button>
              <button className={status === "attention" ? "active" : ""} onClick={() => setStatus("attention")}>{t("dashboard.attention")} <span>{attentionCount}</span></button>
              <button className={status === "completed" ? "active" : ""} onClick={() => setStatus("completed")}>{t("dashboard.completed")} <span>{completedCount}</span></button>
            </div>
            <div className="source-filter-group">
              <span>{t("dashboard.type")}</span>
              <div className="source-filter">
                {(["all", "issue", "feedback", "error"] as const).map(value => <button key={value} className={source === value ? "active" : ""} onClick={() => setSource(value)}>
                    {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
                  </button>)}
              </div>
            </div>
          </div>}
        {issuesLoading ? <div aria-live="polite" aria-busy="true" className="issues-loading-overlay" role="status">
            <LoadingState label={t("dashboard.loadingIssues")} />
          </div> : view === "list" && !companionMode ? <IssueList availableProviders={availableProviders} issueKeyPrefix={dashboard?.project.issueKeyPrefix} deletingIssueId={deletingIssueId} onDelete={runId => {
        setContextDeleteError(null);
        setDeletingRunFromMenuId(runId);
      }} onEdit={setEditingRunId} onTransfer={onTransferIssue ? runId => {
        setContextTransferError(null);
        setTransferTargetProjectId(transferDestinationProjects[0]?.id ?? "");
        setTransferringRunFromMenuId(runId);
      } : undefined} onMove={(run, placement) => onMoveRun(run.id, placement).catch(() => undefined)} onOpen={runId => {
        setSelectedRunMessageId(null);
        setSelectedRunInitialTab(null);
        setSelectedRunId(runId);
      }} onProcessIssueNow={onProcessIssueNow} onPriorityChange={(run, priority) => onUpdateIssue(run.id, {
        title: run.title,
        description: run.issueDescription,
        priority,
        difficulty: run.difficulty,
        attachments: []
      }).catch(() => undefined)} onPreferencesChange={(run, preferences) => onUpdateIssuePreferences(run.id, preferences).catch(() => undefined)} onCheckpointsChange={(run, checkpoints) => onUpdateIssueCheckpoints(run.id, checkpoints).catch(() => undefined)} runs={filtered} members={dashboard?.members ?? []} processingIssueIds={processingIssueIds} updatingIssueId={updatingIssueId} /> : <div aria-label={t("dashboard.kanbanBoard")} className="kanban-board" data-keyboard-list="" ref={kanbanBoardRef}>
          {kanbanColumns.length === 0 ? <div className="companion-no-runs">
              <Bot size={22} />
              <strong>{t("dashboard.emptyTitle")}</strong>
              <span>{t("dashboard.emptyDescription")}</span>
            </div> : <>
            {visibleKanbanColumns.map(column => {
            const isCollapsed = !companionMode && collapsedColumnIdSet.has(column.id);
            return <div className={`kanban-column-shell${isCollapsed ? " is-collapsed" : ""}`} key={column.id}>
              {!companionMode && column.checkpointsBefore.length > 0 ? <span aria-label={`${t("settings.workflowCheckpoints")}: ${column.checkpointsBefore.join(", ")}`} className="kanban-checkpoint-marker" data-checkpoint-count={column.checkpointsBefore.length} role="img" tabIndex={0} title={column.checkpointsBefore.join(" · ")}>
                  <svg aria-hidden="true" viewBox="0 0 12 10">
                    <path d="M2 0C1.2 0 .7.8 1.1 1.5l4.1 7.4c.35.65 1.25.65 1.6 0l4.1-7.4C11.3.8 10.8 0 10 0Z" />
                  </svg>
                  {column.checkpointsBefore.length > 1 ? <strong aria-hidden="true">
                      {column.checkpointsBefore.length}
                    </strong> : null}
                </span> : null}
              <section aria-label={column.label} className={`kanban-column ${column.tone}${dragOverColumnId === column.id ? " drag-over" : ""}${companionMode ? " companion-task-stream" : ""}${isCollapsed ? " is-collapsed" : ""}`} data-kanban-column-id={column.id} data-kanban-column-collapsed={isCollapsed ? "true" : "false"}>
              {!companionMode ? <header>
                  <span><i aria-hidden="true" />{column.label}</span>
                  <div className="kanban-column-header-actions">
                    <strong>{column.runs.length}</strong>
                    <button aria-expanded={!isCollapsed} aria-label={isCollapsed ? t("dashboard.expandColumn", {
                      label: column.label
                    }) : t("dashboard.collapseColumn", {
                      label: column.label
                    })} className="kanban-column-collapse" onClick={() => toggleKanbanColumnCollapsed(column.id)} title={isCollapsed ? t("dashboard.expandColumn", {
                      label: column.label
                    }) : t("dashboard.collapseColumn", {
                      label: column.label
                    })} type="button">
                      {isCollapsed ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
                    </button>
                    <KanbanColumnMenu label={column.label} onHide={() => toggleKanbanColumnHidden(column.id)} />
                  </div>
                </header> : null}
              {isCollapsed ? null : <div className="kanban-column-content">
                {column.runs.length ? column.runs.map(run => <CompanionTaskSwipeAction disabled={!onProcessIssueNow || run.executionReadiness === "waiting" || run.status === "queued" && Boolean(run.leaseExpiresAt) && Date.parse(run.leaseExpiresAt!) > Date.now() || processingIssueIds.has(run.id)} enabled={companionMode && (run.status === "backlog" || run.status === "queued")} key={run.id} onProcessNow={() => onProcessIssueNow?.(run)}>
                    <KanbanCard availableProviders={availableProviders} issueKeyPrefix={dashboard?.project.issueKeyPrefix} activeAgent={agentAssociationsByRunId.activeAgents.get(run.id) ?? null} assignee={dashboard?.members?.find(member => member.userId === run.assigneeUserId) ?? null} assignedWorker={workerById.get(run.workerId ?? "") ?? workerById.get(run.requestedWorkerId ?? "") ?? null} cardRef={kanbanNavigation.getItemRef(run.id)} hideAssignmentBadges={!companionMode && ["completed", "cancelled", "paused", "blocked", "failed"].includes(run.status)} contextMenuDisabled={companionMode} deletingIssueId={deletingIssueId} isDragging={draggedRunId === run.id} isKeyboardCursor={kanbanCursorRunId === run.id} isMoving={recoveringRunId === run.id} onDelete={() => {
                      setContextDeleteError(null);
                      setDeletingRunFromMenuId(run.id);
                    }} onTransfer={onTransferIssue ? () => {
                      setContextTransferError(null);
                      setTransferTargetProjectId(transferDestinationProjects[0]?.id ?? "");
                      setTransferringRunFromMenuId(run.id);
                    } : undefined} onPointerCancel={event => {
                      if (pointerDragRef.current?.pointerId === event.pointerId) {
                        clearKanbanDragState();
                      }
                    }} onPointerDown={event => {
                      if (companionMode || recoveringRunId === run.id || run.status === "paused" || event.pointerType === "touch" || !event.isPrimary || event.button !== 0 || (event.target as Element).closest?.("a, button, input, select, textarea")) return;
                      pointerDragRef.current = {
                        active: false,
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY
                      };
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                    }} onPointerMove={event => {
                      const drag = pointerDragRef.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      if (!drag.active) {
                        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
                        if (distance < kanbanPointerDragThreshold) return;
                        drag.active = true;
                        suppressCardClickRef.current = false;
                        const preview = event.currentTarget.cloneNode(true) as HTMLElement;
                        preview.setAttribute("aria-hidden", "true");
                        preview.classList.add("kanban-card-drag-preview", "dragging");
                        preview.removeAttribute("draggable");
                        preview.style.width = `${event.currentTarget.getBoundingClientRect().width}px`;
                        document.body.append(preview);
                        pointerDragPreviewRef.current = preview;
                        setDraggedRunId(run.id);
                        startKanbanAutoScroll();
                      }
                      event.preventDefault();
                      updateKanbanPointerDrag(event.clientX, event.clientY);
                    }} onPointerUp={event => {
                      const drag = pointerDragRef.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      if (!drag.active) {
                        pointerDragRef.current = null;
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      suppressCardClickRef.current = true;
                      const columnId = kanbanColumnIdAtPoint(event.clientX, event.clientY);
                      const targetColumn = kanbanColumns.find(candidate => candidate.id === columnId);
                      clearKanbanDragState();
                      if (!targetColumn || placementMatchesRun(run, targetColumn.placement)) return;
                      void onMoveRun(run.id, targetColumn.placement).catch(() => undefined);
                    }} onEdit={() => setEditingRunId(run.id)} onFocus={() => setKanbanCursorRunId(run.id)} onMove={placement => onMoveRun(run.id, placement).catch(() => undefined)} onOpen={() => {
                      if (suppressCardClickRef.current) {
                        suppressCardClickRef.current = false;
                        return;
                      }
                      setKanbanCursorRunId(run.id);
                      rememberKanbanScrollPosition();
                      setSelectedRunMessageId(null);
                      setSelectedRunInitialTab(null);
                      setSelectedRunId(run.id);
                    }} onProcessNow={onProcessIssueNow ? () => onProcessIssueNow(run) : undefined} onPriorityChange={priority => onUpdateIssue(run.id, {
                      title: run.title,
                      description: run.issueDescription,
                      priority,
                      difficulty: run.difficulty,
                      attachments: []
                    }).catch(() => undefined)} onPreferencesChange={preferences => onUpdateIssuePreferences(run.id, preferences).catch(() => undefined)} onCheckpointsChange={checkpoints => onUpdateIssueCheckpoints(run.id, checkpoints).catch(() => undefined)} run={run} isProcessing={processingIssueIds.has(run.id)} token={token} updatingIssueId={updatingIssueId} />
                  </CompanionTaskSwipeAction>) : <div className="kanban-column-empty">
                    <Bot size={18} />
                    <span>{t("dashboard.columnEmpty")}</span>
                  </div>}
                {!companionMode && <button aria-label={t("dashboard.createIssueInColumn", {
                  label: column.label
                })} className="kanban-column-add" data-kanban-column-add="" onClick={() => openCreateIssueDialog(column.placement)} title={t("dashboard.createIssueInColumn", {
                  label: column.label
                })} type="button">
                    <Plus aria-hidden="true" size={15} />
                    <span>{t("dashboard.createIssue")}</span>
                  </button>}
              </div>}
              </section>
            </div>;
          })}
            {hiddenKanbanColumns.length > 0 ? <aside aria-label={t("dashboard.hiddenColumns")} className={`kanban-hidden-columns${hiddenColumnsExpanded ? "" : " is-collapsed"}`} data-kanban-hidden-columns="">
                <button aria-expanded={hiddenColumnsExpanded} aria-label={hiddenColumnsExpanded ? t("dashboard.collapseHiddenColumns") : t("dashboard.expandHiddenColumns")} className="kanban-hidden-columns-toggle" onClick={() => setHiddenColumnsExpanded(current => !current)} type="button">
                  {hiddenColumnsExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
                  <span>{t("dashboard.hiddenColumns")}</span>
                </button>
                {hiddenColumnsExpanded ? <ul className="kanban-hidden-column-list">
                    {hiddenKanbanColumns.map(column => <li className={`kanban-hidden-column ${column.tone}`} data-kanban-hidden-column-id={column.id} key={column.id}>
                        <span>
                          <i aria-hidden="true" />
                          {column.label}
                        </span>
                        <strong>{column.runs.length}</strong>
                        <KanbanColumnMenu hidden label={column.label} onShow={() => toggleKanbanColumnHidden(column.id)} />
                      </li>)}
                  </ul> : null}
              </aside> : null}
          </>}
        </div>}
      </div>
      {companionMode && <CompanionBottomNavigation activeDestination={status} onCreate={() => setIsIssueDialogOpen(true)} onDmsOpen={() => onCompanionDmsOpen?.()} onInboxOpen={() => onCompanionInboxOpen?.()} onHomeOpen={() => onCompanionHomeOpen?.()} onStatusChange={setStatus} unreadDmCount={companionUnreadDmCount} unreadInboxCount={companionUnreadInboxCount} />}
      {createIssueDialog}
      {editingRun && <EditIssueDialog isSubmitting={updatingIssueId === editingRun.id} onClose={() => setEditingRunId(null)} onLoadAttachment={onLoadAttachment} onUpdate={async input => {
      await onUpdateIssue(editingRun.id, input);
      setEditingRunId(null);
    }} run={editingRun} members={dashboard?.members ?? []} />}
      <Dialog onOpenChange={open => {
      if (deletingIssueId) return;
      if (!open) {
        setDeletingRunFromMenuId(null);
        setContextDeleteError(null);
      }
    }} open={Boolean(deletingRunFromMenu)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {t("issue.deleteTitle", {
              title: deletingRunFromMenu?.title ?? ""
            })}
            </DialogTitle>
            <DialogDescription>
              {t("issue.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {contextDeleteError ? <p className="text-xs text-destructive" role="alert">
              {contextDeleteError}
            </p> : null}
          <DialogFooter>
            <Button disabled={Boolean(deletingIssueId)} onClick={() => {
            setDeletingRunFromMenuId(null);
            setContextDeleteError(null);
          }} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={Boolean(deletingIssueId)} onClick={() => {
            if (!deletingRunFromMenu) return;
            setContextDeleteError(null);
            void onDeleteIssue(deletingRunFromMenu.id).then(() => setDeletingRunFromMenuId(null)).catch(caught => {
              setContextDeleteError(caught instanceof Error ? caught.message : String(caught));
            });
          }} type="button" variant="destructive">
              {deletingIssueId ? <Spinner size={15} /> : <Trash2 size={15} />}
              {deletingIssueId ? t("issue.deleting") : t("issue.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={open => {
      if (deletingIssueId) return;
      if (!open) {
        setTransferringRunFromMenuId(null);
        setContextTransferError(null);
      }
    }} open={Boolean(transferringRunFromMenu)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <FolderInput size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {t("issue.transferTitle", {
              title: transferringRunFromMenu?.title ?? ""
            })}
            </DialogTitle>
            <DialogDescription>
              {t("issue.transferDescription")}
            </DialogDescription>
          </DialogHeader>
          {transferDestinationProjects.length === 0 ? <p className="text-sm text-muted-foreground">
              {t("issue.transferNoProjects")}
            </p> : <NativeSelect disabled={Boolean(deletingIssueId)} label={t("issue.transferTarget")} onValueChange={setTransferTargetProjectId} options={transferDestinationProjects.map(project => ({
          label: project.name,
          value: project.id
        }))} placeholder={t("issue.transferTargetPlaceholder")} value={transferTargetProjectId} />}
          {contextTransferError ? <p className="text-xs text-destructive" role="alert">
              {contextTransferError}
            </p> : null}
          <DialogFooter>
            <Button disabled={Boolean(deletingIssueId)} onClick={() => {
            setTransferringRunFromMenuId(null);
            setContextTransferError(null);
          }} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={Boolean(deletingIssueId) || !onTransferIssue || !transferTargetProjectId || transferDestinationProjects.length === 0} onClick={() => {
            if (!transferringRunFromMenu || !onTransferIssue) return;
            setContextTransferError(null);
            void onTransferIssue(transferringRunFromMenu.id, transferTargetProjectId).then(() => {
              setTransferringRunFromMenuId(null);
              if (selectedRunId === transferringRunFromMenu.id) {
                setSelectedRunMessageId(null);
                setSelectedRunInitialTab(null);
                setSelectedRunId(null);
              }
            }).catch(caught => {
              setContextTransferError(caught instanceof Error ? caught.message : String(caught));
            });
          }} type="button">
              {deletingIssueId ? <Spinner size={15} /> : <FolderInput size={15} />}
              {deletingIssueId ? t("issue.transferring") : t("issue.transferConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>;
}
