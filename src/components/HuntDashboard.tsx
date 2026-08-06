import {
  Activity,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Columns3,
  Copy,
  CornerUpLeft,
  FolderGit2,
  FolderInput,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Image as ImageIcon,
  Link2,
  ListChecks,
  List,
  ListFilter,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Signal,
  Trash2,
  UserRound,
  Video,
  Waypoints,
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
import { useToast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Typography } from "@/components/ui/typography";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { NativeSelect } from "./NativeSelect";
import { SelectMenu } from "./SelectMenu";
import { AgentProviderIcon } from "./AgentIcons";
import { WorkerIcon } from "./WorkerIcon";
import {
  CompanionBottomNavigation,
  type CompanionStatusFilter,
} from "./CompanionBottomNavigation";
import { ProjectAgentAvatar } from "./ProjectAgentAvatar";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { inboxIssueMessageVersion } from "../hooks/useInbox";
import { useMobileBackHandler } from "../hooks/useMobileNavigation";
import { useProjectAgentWorkerEvents } from "../hooks/useProjectAgentWorkerEvents";
import {
  agentMessagesFromAppServerEvents,
  naturalLanguageFromAgentMessage,
  type AutoHuntAgentMessage,
} from "../lib/auto-hunt-agent";
import { eventMeta, runMeta } from "../lib/stages";
import {
  checkpointKeyForBoundary,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowCheckpointPosition,
} from "../lib/auto-hunt-contract";
import {
  formatExecutionDuration,
  formatExecutionTokens,
} from "../lib/agent-execution-metrics";
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
  formatAttachmentBytes,
  issueAttachmentAccept,
  isIssueAttachmentImage,
  maxIssueAttachmentCount,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "../lib/issue-attachments";
import {
  defaultIssueDetailTab,
  type IssueDetailTab,
} from "../lib/issue-detail-tab";
import {
  clearCreateIssueDraft,
  loadCreateIssueDraft,
  saveCreateIssueDraft,
} from "../lib/create-issue-draft";
import {
  issueAttachmentMarkdown,
  issueAttachmentReference,
  issueAttachmentReferences,
  removeIssueAttachmentMarkdown,
} from "../lib/issue-markdown";
import {
  issueMentionAtCaret,
  issueMentionHandle,
  mentionsIssueHandle,
} from "../lib/issue-agent-reply";
import {
  copyIssueId,
  copyIssueShareLink,
  shareIssueLink,
} from "../lib/issue-links";
import type {
  CreateIssueInput,
  DashboardPayload,
  ExecutionWorker,
  HuntEvent,
  HuntRun,
  HuntRunPlacement,
  HuntSource,
  IssueAttachment,
  IssueMessage,
  IssueMessageSendResult,
  IssueProposedAction,
  IssueExecutionPreferences,
  IssueResultReview,
  OrganizationMember,
  Project,
  ProjectAgent,
  RunEvidence,
  RunEvidenceImage,
  UpdateIssueInput,
} from "../types";
import {
  agentEfforts,
  agentModels,
  agentProviders,
  type AgentProvider,
  type ModelEffort,
} from "../lib/project-llm";
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
  checkpointsBefore: string[];
};

type KanbanPointerDrag = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};

const checkpointBoundaryKey = (
  checkpoint: Pick<AutoHuntWorkflowCheckpoint, "stage" | "position">,
) => `${checkpoint.stage}:${checkpoint.position}`;

const issueCheckpoint = (
  stage: string,
  position: AutoHuntWorkflowCheckpointPosition,
): AutoHuntWorkflowCheckpoint => ({
  key: checkpointKeyForBoundary("issue", { stage, position }),
  stage,
  position,
});

function toggleIssueCheckpoint(
  checkpoints: AutoHuntWorkflowCheckpoint[],
  stage: string,
  position: AutoHuntWorkflowCheckpointPosition,
) {
  const boundary = `${stage}:${position}`;
  return checkpoints.some(
      (checkpoint) => checkpointBoundaryKey(checkpoint) === boundary,
    )
    ? checkpoints.filter(
        (checkpoint) => checkpointBoundaryKey(checkpoint) !== boundary,
      )
    : [...checkpoints, issueCheckpoint(stage, position)];
}

function inheritedCheckpointBoundaries(
  workflow: AutoHuntWorkflow,
  issueCheckpoints: AutoHuntWorkflowCheckpoint[],
) {
  const issueBoundaries = new Set(issueCheckpoints.map(checkpointBoundaryKey));
  return new Set(
    workflow.execution.checkpoints
      .filter((checkpoint) => !issueBoundaries.has(checkpointBoundaryKey(checkpoint)))
      .map(checkpointBoundaryKey),
  );
}

function canEditIssueCheckpoints(run: HuntRun) {
  return (
    ["backlog", "queued"].includes(run.status) &&
    !run.claimedAt &&
    !(run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now())
  );
}

const kanbanPointerDragThreshold = 6;
const kanbanAutoScrollEdge = 72;
const kanbanAutoScrollInterval = 16;
const companionSwipeActionWidth = 72;
const companionSwipeOpenThreshold = 44;

function CompanionTaskSwipeAction({
  children,
  disabled,
  enabled,
  onProcessNow,
}: {
  children: ReactElement;
  disabled: boolean;
  enabled: boolean;
  onProcessNow: () => void;
}) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef<{
    axis: "pending" | "horizontal" | "vertical";
    origin: number;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!enabled) setOffset(0);
  }, [enabled]);

  if (!enabled) return children;

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setIsDragging(false);
    if (gesture.axis !== "horizontal") return;
    event.preventDefault();
    suppressClickRef.current = true;
    setOffset((current) =>
      current >= companionSwipeOpenThreshold ? companionSwipeActionWidth : 0
    );
  };

  const cancelGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setIsDragging(false);
    setOffset(gesture.origin);
  };

  return (
    <div
      className={`companion-task-swipe${offset > 0 ? " open" : ""}${isDragging ? " dragging" : ""}`}
      onClickCapture={(event) => {
        if ((event.target as Element).closest(".companion-task-swipe-action")) {
          suppressClickRef.current = false;
          return;
        }
        if (!suppressClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = false;
      }}
      onPointerCancel={cancelGesture}
      onPointerDown={(event) => {
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          (event.target as Element).closest(".companion-task-swipe-action")
        ) return;
        gestureRef.current = {
          axis: "pending",
          origin: offset,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - gesture.x;
        const deltaY = event.clientY - gesture.y;
        if (gesture.axis === "pending" && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
          gesture.axis = Math.abs(deltaX) > Math.abs(deltaY)
            ? "horizontal"
            : "vertical";
        }
        if (gesture.axis !== "horizontal") return;
        event.preventDefault();
        setIsDragging(true);
        setOffset(Math.min(
          companionSwipeActionWidth,
          Math.max(0, gesture.origin - deltaX),
        ));
      }}
      onPointerUp={finishGesture}
    >
      <button
        aria-hidden={offset < companionSwipeOpenThreshold}
        aria-label={t("issue.processNow")}
        className="companion-task-swipe-action"
        disabled={disabled}
        onClick={() => {
          setOffset(0);
          onProcessNow();
        }}
        tabIndex={offset >= companionSwipeOpenThreshold ? 0 : -1}
        type="button"
      >
        <Play aria-hidden="true" fill="currentColor" size={22} />
      </button>
      <div
        className="companion-task-swipe-content"
        style={{ transform: `translateX(${-offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}

export function HuntDashboard({
  agents = [],
  companionMode = false,
  companionSearchMode = false,
  companionStatus,
  companionUnreadInboxCount = 0,
  currentUserId = null,
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
  onRemoveIssueDependency,
  onUpdateIssue,
  onUpdateIssueCheckpoints = async () => undefined,
  onUpdateIssuePreferences = async () => undefined,
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
  onCompanionAgentsOpen,
  onCompanionIdeasOpen,
  onCompanionInboxOpen,
  onCompanionSearchOpen,
  onCompanionStatusChange,
  onIssueViewed,
  onRequestedRunOpen,
  onSendIssueMessage,
  requestedRunId = null,
  issueListRequestKey = 0,
  processingIssueIds = new Set<string>(),
  sessions = [],
  token = null,
}: {
  agents?: ProjectAgent[];
  companionMode?: boolean;
  companionSearchMode?: boolean;
  companionStatus?: CompanionStatusFilter;
  companionUnreadInboxCount?: number;
  currentUserId?: string | null;
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
  onCreateIssue: (
    projectId: string,
    input: CreateIssueInput,
  ) => Promise<unknown>;
  projects?: Project[];
  onIssueDialogOpenChange?: (isOpen: boolean) => void;
  onDeleteIssue: (runId: string) => Promise<unknown>;
  onTransferIssue?: (
    runId: string,
    targetProjectId: string,
  ) => Promise<unknown>;
  onAddIssueDependency?: (
    dependentRunId: string,
    prerequisiteRunId: string,
  ) => Promise<unknown>;
  onAcceptIssueAction?: (
    runId: string,
    proposal: IssueProposedAction,
  ) => Promise<IssueProposedAction>;
  onRemoveIssueDependency?: (
    dependentRunId: string,
    prerequisiteRunId: string,
  ) => Promise<unknown>;
  onUpdateIssue: (runId: string, input: UpdateIssueInput) => Promise<unknown>;
  onUpdateIssueCheckpoints?: (
    runId: string,
    checkpoints: AutoHuntWorkflowCheckpoint[],
  ) => Promise<unknown>;
  onUpdateIssuePreferences?: (
    runId: string,
    input: IssueExecutionPreferences,
  ) => Promise<unknown>;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: (runId: string) => Promise<IssueMessage[]>;
  onLoadRunEvents?: (runId: string) => Promise<HuntEvent[]>;
  onLoadRunEvidence: (runId: string) => Promise<RunEvidence[]>;
  onLoadRunEvidenceImage?: (image: RunEvidenceImage) => Promise<Blob>;
  onCompleteResultReview?: (runId: string) => Promise<unknown>;
  onMoveRun: (runId: string, placement: HuntRunPlacement) => Promise<unknown>;
  onProcessIssueNow?: (run: HuntRun) => void;
  onRetryRun: (runId: string) => Promise<unknown>;
  onReworkRun?: (
    runId: string,
    input: { workflowStage: string; reason: string },
  ) => Promise<unknown>;
  onCancelRun: (runId: string) => Promise<unknown>;
  onUnassignRun?: (runId: string) => Promise<unknown>;
  onResumeRun?: (runId: string) => Promise<unknown>;
  onCompanionAgentsOpen?: () => void;
  onCompanionIdeasOpen?: () => void;
  onCompanionInboxOpen?: () => void;
  onCompanionSearchOpen?: () => void;
  onCompanionStatusChange?: (status: CompanionStatusFilter) => void;
  onIssueViewed?: (runId: string) => void;
  onRequestedRunOpen?: () => void;
  onSendIssueMessage: (
    runId: string,
    input: {
      body: string;
      parentMessageId: string | null;
      mentionedUserIds?: string[];
      attachments?: File[];
      attachmentReferences?: string[];
    },
  ) => Promise<IssueMessageSendResult>;
  requestedRunId?: string | null;
  issueListRequestKey?: number;
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
  const [transferringRunFromMenuId, setTransferringRunFromMenuId] =
    useState<string | null>(null);
  const [transferTargetProjectId, setTransferTargetProjectId] = useState("");
  const [contextTransferError, setContextTransferError] = useState<string | null>(
    null,
  );
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
  const suppressCardClickRef = useRef(false);
  const kanbanBoardRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<KanbanPointerDrag | null>(null);
  const pointerDragPositionRef = useRef({ x: 0, y: 0 });
  const pointerDragPreviewRef = useRef<HTMLElement | null>(null);
  const pointerAutoScrollRef = useRef<number | null>(null);

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

  const kanbanColumnIdAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY);
      return (
        target
          ?.closest<HTMLElement>("[data-kanban-column-id]")
          ?.dataset.kanbanColumnId ?? null
      );
    },
    [],
  );

  const updateKanbanPointerDrag = useCallback(
    (clientX: number, clientY: number) => {
      pointerDragPositionRef.current = { x: clientX, y: clientY };
      if (pointerDragPreviewRef.current) {
        pointerDragPreviewRef.current.style.transform =
          `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
      }
      const columnId = kanbanColumnIdAtPoint(clientX, clientY);
      setDragOverColumnId(columnId === "status:paused" ? null : columnId);
    },
    [kanbanColumnIdAtPoint],
  );

  const startKanbanAutoScroll = useCallback(() => {
    if (pointerAutoScrollRef.current !== null) return;
    pointerAutoScrollRef.current = window.setInterval(() => {
      const board = kanbanBoardRef.current;
      const drag = pointerDragRef.current;
      if (!board || !drag?.active) return;
      const rect = board.getBoundingClientRect();
      const { x, y } = pointerDragPositionRef.current;
      if (y < rect.top || y > rect.bottom) return;
      const edge = Math.min(kanbanAutoScrollEdge, rect.width / 4);
      const leftDistance = x - rect.left;
      const rightDistance = rect.right - x;
      const delta = leftDistance < edge
        ? -Math.ceil((edge - Math.max(0, leftDistance)) / 5)
        : rightDistance < edge
          ? Math.ceil((edge - Math.max(0, rightDistance)) / 5)
          : 0;
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
  const selectedInboxVersion = selected
    ? inboxIssueMessageVersion(selected)
    : null;
  const editingRun = runs.find((run) => run.id === editingRunId) ?? null;
  const deletingRunFromMenu =
    runs.find((run) => run.id === deletingRunFromMenuId) ?? null;
  const transferringRunFromMenu =
    runs.find((run) => run.id === transferringRunFromMenuId) ?? null;
  const transferDestinationProjects = useMemo(() => {
    const activeProjectId = dashboard?.project.id;
    const organizationId = dashboard?.project.organizationId;
    if (!activeProjectId) return [];
    return projects.filter(
      (project) =>
        project.id !== activeProjectId &&
        (!organizationId || project.organizationId === organizationId),
    );
  }, [dashboard?.project.id, dashboard?.project.organizationId, projects]);
  const activeCount = runs.filter((run) => !["completed", "cancelled"].includes(run.status)).length;
  const attentionCount = runs.filter((run) => ["paused", "blocked", "failed"].includes(run.status)).length;
  const completedCount = runs.filter((run) =>
    ["completed", "cancelled"].includes(run.status)
  ).length;
  const filtered = useMemo(() => {
    const normalized =
      !companionMode || companionSearchMode
        ? query.trim().toLowerCase()
        : "";
    const next = runs.filter((run) => {
      if (source !== "all" && run.source !== source) return false;
      if (status === "active" && ["completed", "cancelled"].includes(run.status)) return false;
      if (status === "attention" && !["paused", "blocked", "failed"].includes(run.status)) return false;
      if (
        status === "completed" &&
        !["completed", "cancelled"].includes(run.status)
      ) return false;
      return !normalized || `${run.title} ${run.sourceKey} ${run.repository}`.toLowerCase().includes(normalized);
    });
    // Mobile companion Tasks list: newest updated first (iOS native parity).
    if (!companionMode) return next;
    return [...next].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [companionMode, companionSearchMode, query, runs, source, status]);
  const agentAssociationsByRunId = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
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
  const workerById = useMemo(
    () =>
      new Map(
        (dashboard?.workers ?? []).map((worker) => [worker.id, worker]),
      ),
    [dashboard?.workers],
  );
  const availableProviders = useMemo<AgentProvider[]>(() => {
    if (dashboard?.organizationProviders?.length) {
      return dashboard.organizationProviders;
    }
    return [
      ...new Set(
        (dashboard?.workers ?? []).flatMap((worker) => worker.providers ?? []),
      ),
    ];
  }, [dashboard?.organizationProviders, dashboard?.workers]);

  useEffect(() => {
    setSelectedRunId(null);
  }, [issueListRequestKey]);

  useEffect(() => {
    if (!requestedRunId) return;
    if (!runs.some((run) => run.id === requestedRunId)) return;
    setSelectedRunId(requestedRunId);
    onRequestedRunOpen?.();
  }, [onRequestedRunOpen, requestedRunId, runs]);

  useEffect(() => {
    if (!selected || !selectedInboxVersion) return;
    onIssueViewed?.(selected.id);
  }, [onIssueViewed, selected?.id, selectedInboxVersion]);

  const kanbanColumns = useMemo<KanbanColumn[]>(() => {
    const workflow = dashboard?.settings.workflow;
    const workflowStages = workflow?.stages ?? [];
    const stageLabels = new Map(
      workflowStages.map((stage) => [
        stage.id,
        localizeWorkflowStage(t, stage.id, stage.label),
      ]),
    );
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
        label: stageLabels.get(stage.id) ?? stage.label,
        tone: runMeta("running", stage.id, workflow).tone,
        placement: { status: "running" as const, workflowStage: stage.id },
      })),
      {
        id: "status:paused",
        label: t("status.paused"),
        tone: "amber",
        // Paused runs are resumed from the detail page, not moved by drag/drop.
        placement: { status: "queued" as const, workflowStage: null },
      },
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
    const checkpointsByBoundary = new Map<string, string[]>();
    const checkpointPolicy = dashboard?.settings.checkpointPolicy;
    const effectiveCheckpoints = checkpointPolicy
      ? checkpointPolicy.effective
      : workflow?.execution.checkpoints ?? [];
    for (const checkpoint of effectiveCheckpoints) {
      const stageColumnIndex = definitions.findIndex(
        (column) => column.id === `stage:${checkpoint.stage}`,
      );
      if (stageColumnIndex < 0) continue;
      const boundaryColumn = definitions[
        stageColumnIndex + (checkpoint.position === "after" ? 1 : 0)
      ];
      const stageLabel = stageLabels.get(checkpoint.stage) ?? checkpoint.stage;
      const label = checkpoint.position === "before"
        ? t("run.checkpointBefore", { stage: stageLabel })
        : t("run.checkpointAfter", { stage: stageLabel });
      if (!boundaryColumn) continue;
      checkpointsByBoundary.set(boundaryColumn.id, [
        ...(checkpointsByBoundary.get(boundaryColumn.id) ?? []),
        label,
      ]);
    }
    const visibleDefinitions = definitions.filter((column) => {
      if (status === "active") {
        return !["status:completed", "status:cancelled"].includes(column.id);
      }
      if (status === "attention") {
        return ["status:paused", "status:blocked", "status:failed"].includes(column.id);
      }
      if (status === "completed") {
        return ["status:completed", "status:cancelled"].includes(column.id);
      }
      return true;
    });
    const showsWorkflowStages = visibleDefinitions.some((column) =>
      column.id.startsWith("stage:")
    );
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
      checkpointsBefore: showsWorkflowStages
        ? checkpointsByBoundary.get(column.id) ?? []
        : [],
    }));
    // Mobile companion Tasks: one newest-updated-first stream (iOS TaskListView parity),
    // not status/stage columns.
    if (companionMode) {
      return filtered.length > 0
        ? [{
            id: "companion-tasks",
            label: t("companion.navTasks"),
            tone: "slate",
            placement: { status: "queued" as const, workflowStage: null },
            runs: filtered,
            checkpointsBefore: [],
          }]
        : [];
    }
    return columns;
  }, [
    companionMode,
    dashboard?.settings.checkpointPolicy,
    dashboard?.settings.workflow,
    filtered,
    status,
    t,
  ]);
  const createIssueDialog = isIssueDialogOpen ? (
    <CreateIssueDialog
      availableProviders={availableProviders}
      compactHeader={companionMode}
      defaultProjectId={dashboard?.project.id}
      isSubmitting={isCreatingIssue}
      onClose={() => setIsIssueDialogOpen(false)}
      onCreate={async (projectId, input) => {
        await onCreateIssue(projectId, input);
        setIsIssueDialogOpen(false);
      }}
      projects={
        projects.length > 0
          ? projects
          : dashboard
            ? [dashboard.project]
            : []
      }
      members={dashboard?.members ?? []}
      workflow={dashboard
        ? {
            ...dashboard.settings.workflow,
            execution: {
              checkpoints:
                dashboard.settings.checkpointPolicy?.effective ??
                dashboard.settings.workflow.execution.checkpoints,
            },
          }
        : undefined}
      workflowProjectId={dashboard?.project.id}
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
          assignedWorker={
            workerById.get(selected.workerId ?? "") ??
            workerById.get(selected.requestedWorkerId ?? "") ??
            null
          }
          companionMode={companionMode}
          currentUserId={currentUserId}
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
          onTransfer={
            onTransferIssue
              ? async (targetProjectId) => {
                  await onTransferIssue(selected.id, targetProjectId);
                  setSelectedRunId(null);
                }
              : undefined
          }
          transferProjects={transferDestinationProjects}
          onAddDependency={onAddIssueDependency
            ? (prerequisiteRunId) =>
                onAddIssueDependency(selected.id, prerequisiteRunId)
            : undefined}
          onAcceptIssueAction={onAcceptIssueAction
            ? (proposal) =>
                onAcceptIssueAction(selected.id, proposal)
            : undefined}
          onRemoveDependency={onRemoveIssueDependency
            ? (prerequisiteRunId) =>
                onRemoveIssueDependency(selected.id, prerequisiteRunId)
            : undefined}
          onDependencyOpen={setSelectedRunId}
          onLoadAttachment={onLoadAttachment}
          onLoadIssueMessages={() => onLoadIssueMessages(selected.id)}
          onLoadRunEvents={() => onLoadRunEvents(selected.id)}
          onLoadRunEvidence={() => onLoadRunEvidence(selected.id)}
          onLoadRunEvidenceImage={onLoadRunEvidenceImage}
          onCompleteResultReview={onCompleteResultReview
            ? () => onCompleteResultReview(selected.id)
            : undefined}
          mentionMembers={dashboard?.members ?? []}
          onMove={(placement) => onMoveRun(selected.id, placement)}
          onProcessNow={
            onProcessIssueNow ? () => onProcessIssueNow(selected) : undefined
          }
          onRetry={() => onRetryRun(selected.id)}
          onRework={
            onReworkRun
              ? (input) => onReworkRun(selected.id, input)
              : undefined
          }
          onResume={() => onResumeRun(selected.id)}
          onSendIssueMessage={(input) => onSendIssueMessage(selected.id, input)}
          onUpdateIssue={(input) => onUpdateIssue(selected.id, input)}
          onUpdateIssueCheckpoints={(checkpoints) =>
            onUpdateIssueCheckpoints(selected.id, checkpoints)}
          onUpdateIssuePreferences={(input) =>
            onUpdateIssuePreferences(selected.id, input)}
          availableProviders={availableProviders}
          performedAgentName={
            agentAssociationsByRunId.performedAgents.get(selected.id)?.name ??
            null
          }
          performedAgentProvider={
            agentAssociationsByRunId.performedAgents.get(selected.id)?.provider ??
            null
          }
          performedAgentModel={
            agentAssociationsByRunId.performedAgents.get(selected.id)?.model ??
            null
          }
          projectId={dashboard!.project.id}
          run={selected}
          isProcessing={processingIssueIds.has(selected.id)}
          availableRuns={dashboard!.runs}
          token={token}
        />
        {createIssueDialog}
      </>
    );
  }

  return (
    <MainContent id="issues">
      {!companionMode ? (
        <PageHeader
          action={
            <div className="queue-tools">
              <label className="search-box">
                <Input
                  className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("dashboard.search")}
                  value={query}
                />
                <Search aria-hidden="true" size={15} />
              </label>
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
              <Button
                aria-keyshortcuts="Meta+N"
                aria-label={t("dashboard.createIssue")}
                className="create-issue-button"
                onClick={() => setIsIssueDialogOpen(true)}
                type="button"
              >
                <Plus size={16} />
                {t("issue.newIssue")}
              </Button>
            </div>
          }
          className={`app-page-header queue-header${isSidebarOpen ? "" : " sidebar-closed"}`}
          data-tauri-drag-region="deep"
          title={
            <span className="queue-heading-copy">
              <span>{t("dashboard.queue")}</span>
              <Typography
                as="span"
                className="queue-task-count"
                tone="muted"
                variant="caption"
              >
                {t("dashboard.taskCount", { count: runs.length })}
              </Typography>
            </span>
          }
        />
      ) : null}
      <div className="dashboard-scroll">
        {error || recoveryError ? (
          <ErrorBanner className="error-banner" icon={<CircleAlert size={16} />}>
            {error ?? recoveryError}
          </ErrorBanner>
        ) : null}
        {companionMode ? (
          <div className="queue-header">
            <div className="queue-heading">
              <div className="queue-heading-copy">
                {companionSearchMode ? (
                  <Typography as="h2" variant="heading">
                    {t("companion.navSearch")}
                  </Typography>
                ) : null}
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
        ) : null}
        {!companionMode && (
          <div className="queue-filter-bar">
            <div className="status-tabs">
              <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>{t("dashboard.all")} <span>{runs.length}</span></button>
              <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>{t("dashboard.active")} <span>{activeCount}</span></button>
              <button className={status === "attention" ? "active" : ""} onClick={() => setStatus("attention")}>{t("dashboard.attention")} <span>{attentionCount}</span></button>
              <button className={status === "completed" ? "active" : ""} onClick={() => setStatus("completed")}>{t("dashboard.completed")} <span>{completedCount}</span></button>
            </div>
            <div className="source-filter-group">
              <span>{t("dashboard.type")}</span>
              <div className="source-filter">
                {(["all", "issue", "feedback", "error"] as const).map((value) => (
                  <button
                    key={value}
                    className={source === value ? "active" : ""}
                    onClick={() => setSource(value)}
                  >
                    {value === "all"
                      ? t("dashboard.all")
                      : t(`source.${value}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {view === "list" && !companionMode ? (
          <IssueList
            availableProviders={availableProviders}
            deletingIssueId={deletingIssueId}
            onDelete={(runId) => {
              setContextDeleteError(null);
              setDeletingRunFromMenuId(runId);
            }}
            onEdit={setEditingRunId}
            onTransfer={
              onTransferIssue
                ? (runId) => {
                    setContextTransferError(null);
                    setTransferTargetProjectId(
                      transferDestinationProjects[0]?.id ?? "",
                    );
                    setTransferringRunFromMenuId(runId);
                  }
                : undefined
            }
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
            onPreferencesChange={(run, preferences) =>
              onUpdateIssuePreferences(run.id, preferences).catch(
                () => undefined,
              )
            }
            onCheckpointsChange={(run, checkpoints) =>
              onUpdateIssueCheckpoints(run.id, checkpoints).catch(
                () => undefined,
              )
            }
            runs={filtered}
            members={dashboard?.members ?? []}
            processingIssueIds={processingIssueIds}
            updatingIssueId={updatingIssueId}
          />
        ) : <div
          aria-label={t("dashboard.kanbanBoard")}
          className="kanban-board"
          ref={kanbanBoardRef}
        >
          {kanbanColumns.length === 0 ? (
            <div className="companion-no-runs">
              <Bot size={22} />
              <strong>{t("dashboard.emptyTitle")}</strong>
              <span>{t("dashboard.emptyDescription")}</span>
            </div>
          ) : kanbanColumns.map((column) => (
            <div className="kanban-column-shell" key={column.id}>
              {!companionMode && column.checkpointsBefore.length > 0 ? (
                <span
                  aria-label={`${t("settings.workflowCheckpoints")}: ${column.checkpointsBefore.join(", ")}`}
                  className="kanban-checkpoint-marker"
                  data-checkpoint-count={column.checkpointsBefore.length}
                  role="img"
                  tabIndex={0}
                  title={column.checkpointsBefore.join(" · ")}
                >
                  <svg aria-hidden="true" viewBox="0 0 12 10">
                    <path d="M2 0C1.2 0 .7.8 1.1 1.5l4.1 7.4c.35.65 1.25.65 1.6 0l4.1-7.4C11.3.8 10.8 0 10 0Z" />
                  </svg>
                  {column.checkpointsBefore.length > 1 ? (
                    <strong aria-hidden="true">
                      {column.checkpointsBefore.length}
                    </strong>
                  ) : null}
                </span>
              ) : null}
              <section
                aria-label={column.label}
                className={`kanban-column ${column.tone}${dragOverColumnId === column.id ? " drag-over" : ""}${companionMode ? " companion-task-stream" : ""}`}
                data-kanban-column-id={column.id}
              >
              {!companionMode ? (
                <header>
                  <span><i aria-hidden="true" />{column.label}</span>
                  <strong>{column.runs.length}</strong>
                </header>
              ) : null}
              <div>
                {column.runs.length ? column.runs.map((run) => (
                  <CompanionTaskSwipeAction
                    disabled={
                      !onProcessIssueNow ||
                      run.executionReadiness === "waiting" ||
                      (run.status === "queued" &&
                        Boolean(run.leaseExpiresAt) &&
                        Date.parse(run.leaseExpiresAt!) > Date.now()) ||
                      processingIssueIds.has(run.id)
                    }
                    enabled={
                      companionMode &&
                      (run.status === "backlog" || run.status === "queued")
                    }
                    key={run.id}
                    onProcessNow={() => onProcessIssueNow?.(run)}
                  >
                    <KanbanCard
                      availableProviders={availableProviders}
                      activeAgent={
                        agentAssociationsByRunId.activeAgents.get(run.id) ?? null
                      }
                    assignee={
                      dashboard?.members?.find(
                        (member) => member.userId === run.assigneeUserId,
                      ) ?? null
                    }
                    assignedWorker={
                      ["completed", "cancelled", "paused", "blocked", "failed"].includes(
                        run.status,
                      )
                        ? null
                        : workerById.get(run.workerId ?? "") ??
                          workerById.get(run.requestedWorkerId ?? "") ??
                          null
                    }
                    contextMenuDisabled={companionMode}
                    deletingIssueId={deletingIssueId}
                    isDragging={draggedRunId === run.id}
                    isMoving={recoveringRunId === run.id}
                    onDelete={() => {
                      setContextDeleteError(null);
                      setDeletingRunFromMenuId(run.id);
                    }}
                    onTransfer={
                      onTransferIssue
                        ? () => {
                            setContextTransferError(null);
                            setTransferTargetProjectId(
                              transferDestinationProjects[0]?.id ?? "",
                            );
                            setTransferringRunFromMenuId(run.id);
                          }
                        : undefined
                    }
                    onPointerCancel={(event) => {
                      if (
                        pointerDragRef.current?.pointerId === event.pointerId
                      ) {
                        clearKanbanDragState();
                      }
                    }}
                    onPointerDown={(event) => {
                      if (
                        companionMode ||
                        recoveringRunId === run.id ||
                        event.pointerType === "touch" ||
                        !event.isPrimary ||
                        event.button !== 0 ||
                        (event.target as Element).closest?.(
                          "a, button, input, select, textarea",
                        )
                      ) return;
                      pointerDragRef.current = {
                        active: false,
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                      };
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const drag = pointerDragRef.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      if (!drag.active) {
                        const distance = Math.hypot(
                          event.clientX - drag.startX,
                          event.clientY - drag.startY,
                        );
                        if (distance < kanbanPointerDragThreshold) return;
                        drag.active = true;
                        suppressCardClickRef.current = false;
                        const preview = event.currentTarget.cloneNode(
                          true,
                        ) as HTMLElement;
                        preview.setAttribute("aria-hidden", "true");
                        preview.classList.add(
                          "kanban-card-drag-preview",
                          "dragging",
                        );
                        preview.removeAttribute("draggable");
                        preview.style.width =
                          `${event.currentTarget.getBoundingClientRect().width}px`;
                        document.body.append(preview);
                        pointerDragPreviewRef.current = preview;
                        setDraggedRunId(run.id);
                        startKanbanAutoScroll();
                      }
                      event.preventDefault();
                      updateKanbanPointerDrag(event.clientX, event.clientY);
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
                      const columnId = kanbanColumnIdAtPoint(
                        event.clientX,
                        event.clientY,
                      );
                      const targetColumn = kanbanColumns.find(
                        (candidate) => candidate.id === columnId,
                      );
                      clearKanbanDragState();
                      if (
                        !targetColumn ||
                        targetColumn.id === "status:paused" ||
                        placementMatchesRun(run, targetColumn.placement)
                      ) return;
                      void onMoveRun(run.id, targetColumn.placement).catch(
                        () => undefined,
                      );
                    }}
                    onEdit={() => setEditingRunId(run.id)}
                    onMove={(placement) =>
                      onMoveRun(run.id, placement).catch(() => undefined)
                    }
                    onOpen={() => {
                      if (suppressCardClickRef.current) {
                        suppressCardClickRef.current = false;
                        return;
                      }
                      setSelectedRunId(run.id);
                    }}
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
                    onPreferencesChange={(preferences) =>
                      onUpdateIssuePreferences(run.id, preferences).catch(
                        () => undefined,
                      )
                    }
                    onCheckpointsChange={(checkpoints) =>
                      onUpdateIssueCheckpoints(run.id, checkpoints).catch(
                        () => undefined,
                      )
                    }
                    run={run}
                    isProcessing={processingIssueIds.has(run.id)}
                    token={token}
                    updatingIssueId={updatingIssueId}
                    />
                  </CompanionTaskSwipeAction>
                )) : (
                  <div className="kanban-column-empty">
                    <Bot size={18} />
                    <span>{t("dashboard.columnEmpty")}</span>
                  </div>
                )}
              </div>
              </section>
            </div>
          ))}
        </div>}
      </div>
      {companionMode && (
        <CompanionBottomNavigation
          activeDestination={companionSearchMode ? "search" : status}
          onCreate={() => setIsIssueDialogOpen(true)}
          onAgentsOpen={() => onCompanionAgentsOpen?.()}
          onIdeasOpen={() => onCompanionIdeasOpen?.()}
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
          members={dashboard?.members ?? []}
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
      <Dialog
        onOpenChange={(open) => {
          if (deletingIssueId) return;
          if (!open) {
            setTransferringRunFromMenuId(null);
            setContextTransferError(null);
          }
        }}
        open={Boolean(transferringRunFromMenu)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <FolderInput size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {t("issue.transferTitle", {
                title: transferringRunFromMenu?.title ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("issue.transferDescription")}
            </DialogDescription>
          </DialogHeader>
          {transferDestinationProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("issue.transferNoProjects")}
            </p>
          ) : (
            <NativeSelect
              disabled={Boolean(deletingIssueId)}
              label={t("issue.transferTarget")}
              onValueChange={setTransferTargetProjectId}
              options={transferDestinationProjects.map((project) => ({
                label: project.name,
                value: project.id,
              }))}
              placeholder={t("issue.transferTargetPlaceholder")}
              value={transferTargetProjectId}
            />
          )}
          {contextTransferError ? (
            <p className="text-xs text-destructive" role="alert">
              {contextTransferError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={Boolean(deletingIssueId)}
              onClick={() => {
                setTransferringRunFromMenuId(null);
                setContextTransferError(null);
              }}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                Boolean(deletingIssueId) ||
                !onTransferIssue ||
                !transferTargetProjectId ||
                transferDestinationProjects.length === 0
              }
              onClick={() => {
                if (!transferringRunFromMenu || !onTransferIssue) return;
                setContextTransferError(null);
                void onTransferIssue(
                  transferringRunFromMenu.id,
                  transferTargetProjectId,
                )
                  .then(() => {
                    setTransferringRunFromMenuId(null);
                    if (selectedRunId === transferringRunFromMenu.id) {
                      setSelectedRunId(null);
                    }
                  })
                  .catch((caught) => {
                    setContextTransferError(
                      caught instanceof Error
                        ? caught.message
                        : String(caught),
                    );
                  });
              }}
              type="button"
            >
              {deletingIssueId ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <FolderInput size={15} />
              )}
              {deletingIssueId
                ? t("issue.transferring")
                : t("issue.transferConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}

export function EditIssueDialog({
  isSubmitting,
  members = [],
  onClose,
  onUpdate,
  run,
}: {
  isSubmitting: boolean;
  members?: OrganizationMember[];
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
  const [assigneeUserId, setAssigneeUserId] = useState(
    run.assigneeUserId ?? "",
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
            assigneeUserId: assigneeUserId || null,
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
              className="issue-assignee-select"
              label={t("issue.assignee")}
              onValueChange={setAssigneeUserId}
              options={[
                { label: t("run.unassigned"), value: "" },
                ...members.map((member) => ({
                  label: member.name,
                  value: member.userId,
                })),
              ]}
              value={assigneeUserId}
            />
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

function IssueCheckpointDropdown({
  checkpoints,
  disabled = false,
  onChange,
  workflow,
}: {
  checkpoints: AutoHuntWorkflowCheckpoint[];
  disabled?: boolean;
  onChange: (checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
  workflow: AutoHuntWorkflow;
}) {
  const { t } = useI18n();
  const inherited = new Set(
    workflow.execution.checkpoints.map(checkpointBoundaryKey),
  );
  const selected = new Set(checkpoints.map(checkpointBoundaryKey));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="issue-checkpoint-trigger"
          disabled={disabled}
          type="button"
        >
          <Clock3 aria-hidden="true" size={13} />
          <span>{t("issue.checkpoints")}</span>
          {(checkpoints.length > 0 || inherited.size > 0) && (
            <strong>{checkpoints.length + inherited.size}</strong>
          )}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="issue-checkpoint-menu"
          collisionPadding={10}
          sideOffset={6}
        >
          <DropdownMenu.Label className="issue-checkpoint-menu-heading">
            {t("issue.checkpointsDescription")}
          </DropdownMenu.Label>
          {workflow.stages.flatMap((stage) =>
            (["before", "after"] as const).map((position) => {
              const boundary = `${stage.id}:${position}`;
              const locked = inherited.has(boundary);
              const checked = locked || selected.has(boundary);
              const stageLabel = localizeWorkflowStage(t, stage.id, stage.label);
              return (
                <DropdownMenu.CheckboxItem
                  checked={checked}
                  className="issue-checkpoint-menu-item"
                  disabled={locked}
                  key={boundary}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (locked) return;
                    onChange(toggleIssueCheckpoint(
                      checkpoints,
                      stage.id,
                      position,
                    ));
                  }}
                >
                  <DropdownMenu.ItemIndicator className="issue-checkpoint-menu-check">
                    <Check aria-hidden="true" size={13} />
                  </DropdownMenu.ItemIndicator>
                  <span>
                    {position === "before"
                      ? t("run.checkpointBefore", { stage: stageLabel })
                      : t("run.checkpointAfter", { stage: stageLabel })}
                  </span>
                  {locked && <small>{t("issue.checkpointRequired")}</small>}
                </DropdownMenu.CheckboxItem>
              );
            }),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function CreateIssueDialog({
  availableProviders = agentProviders,
  compactHeader = false,
  defaultProjectId,
  isSubmitting,
  onClose,
  onCreate,
  members = [],
  projects,
  workflow,
  workflowProjectId,
}: {
  availableProviders?: readonly AgentProvider[];
  compactHeader?: boolean;
  defaultProjectId?: string;
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (projectId: string, input: CreateIssueInput) => Promise<void>;
  members?: OrganizationMember[];
  projects: Project[];
  workflow?: AutoHuntWorkflow;
  workflowProjectId?: string;
}) {
  const { t } = useI18n();
  const [initialDraft] = useState(() => {
    const draft = loadCreateIssueDraft();
    return draft && projects.some((project) => project.id === draft.projectId)
      ? draft
      : null;
  });
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [description, setDescription] = useState(
    initialDraft?.description ?? "",
  );
  const [status, setStatus] = useState<"backlog" | "queued">(
    initialDraft?.status ?? "queued",
  );
  const [priority, setPriority] = useState(initialDraft?.priority ?? "2");
  const [assigneeUserId, setAssigneeUserId] = useState(
    initialDraft?.assigneeUserId ?? "",
  );
  const [preferredProvider, setPreferredProvider] = useState(
    initialDraft?.preferredProvider ?? "",
  );
  const [preferredModel, setPreferredModel] = useState(
    initialDraft?.preferredModel ?? "",
  );
  const [projectId, setProjectId] = useState(() =>
    projects.some((project) => project.id === initialDraft?.projectId)
      ? initialDraft!.projectId
      : projects.some((project) => project.id === defaultProjectId)
        ? defaultProjectId!
        : projects[0]?.id ?? ""
  );
  const [checkpoints, setCheckpoints] = useState<AutoHuntWorkflowCheckpoint[]>(
    initialDraft && initialDraft.projectId === workflowProjectId
      ? initialDraft.checkpoints ?? []
      : [],
  );
  const [attachments, setAttachments] = useState<
    Array<{ file: File; reference: string }>
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
  const attachmentDragDepthRef = useRef(0);
  const descriptionEditorRef = useRef<HTMLDivElement>(null);

  const persistDraft = useCallback(() => {
    const draftDescription = attachments.reduce(
      (current, { reference }) =>
        removeIssueAttachmentMarkdown(current, reference),
      description,
    );
    saveCreateIssueDraft({
      description: draftDescription,
      priority,
      projectId,
      status,
      title,
      assigneeUserId: assigneeUserId || null,
      preferredProvider: preferredProvider || null,
      preferredModel: preferredModel || null,
      ...(checkpoints.length > 0 ? { checkpoints } : {}),
    });
  }, [
    assigneeUserId,
    attachments,
    description,
    preferredModel,
    preferredProvider,
    checkpoints,
    priority,
    projectId,
    status,
    title,
  ]);

  const closeWithDraft = useCallback(() => {
    persistDraft();
    onClose();
  }, [onClose, persistDraft]);

  const focusDescriptionAt = (offset: number) => {
    const inputs = Array.from(
      descriptionEditorRef.current?.querySelectorAll<HTMLTextAreaElement>(
        ".issue-description-input",
      ) ?? [],
    );
    const input =
      inputs.find((candidate) => {
        const start = Number(candidate.dataset.descriptionStart ?? 0);
        const end = Number(candidate.dataset.descriptionEnd ?? start);
        return offset >= start && offset <= end;
      }) ?? inputs.at(-1);
    if (!input) return;
    const start = Number(input.dataset.descriptionStart ?? 0);
    const caret = Math.max(0, Math.min(input.value.length, offset - start));
    input.focus();
    input.setSelectionRange(caret, caret);
  };

  const addAttachments = (
    selected: File[],
    insertImages = false,
    selection?: { start: number; end: number },
  ) => {
    if (selected.length === 0) return;
    const added = selected.map((file) => ({
      file: normalizeIssueAttachmentFile(file),
      reference: crypto.randomUUID(),
    }));
    const next = [...attachments, ...added];
    const error = validateIssueAttachments(next.map(({ file }) => file));
    setAttachmentError(error);
    if (error) return;
    setAttachments(next);

    const inlineImages = insertImages
      ? added.filter(({ file }) => file.type.startsWith("image/"))
      : [];
    if (inlineImages.length === 0) return;
    const start = selection?.start ?? description.length;
    const end = selection?.end ?? start;
    const before = description.slice(0, start);
    const after = description.slice(end);
    const markdown = inlineImages
      .map(({ file, reference }) => issueAttachmentMarkdown(reference, file.name))
      .join("\n\n");
    const prefix = before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
    const suffix = after.length === 0 || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
    const insertion = `${prefix}${markdown}${suffix}`;
    setDescription(`${before}${insertion}${after}`);
    requestAnimationFrame(() => {
      const caret = start + insertion.length;
      focusDescriptionAt(caret);
    });
  };

  const removeAttachment = (index: number, reference: string) => {
    setAttachments((current) =>
      current.filter((_, candidateIndex) => candidateIndex !== index),
    );
    setDescription((current) =>
      removeIssueAttachmentMarkdown(current, reference),
    );
    setAttachmentError(null);
  };

  const inlineAttachmentReferences = issueAttachmentReferences(description);
  const remainingAttachments = attachments.filter(
    ({ file, reference }) =>
      !file.type.startsWith("image/") ||
      !inlineAttachmentReferences.has(reference),
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) closeWithDraft();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeWithDraft, isSubmitting]);

  useEffect(() => {
    persistDraft();
  }, [persistDraft]);

  useEffect(() => {
    if (!isSubmitting) return;
    attachmentDragDepthRef.current = 0;
    setIsDraggingAttachments(false);
  }, [isSubmitting]);

  return (
    <div
      className="dialog-backdrop issue-dialog-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !isSubmitting && closeWithDraft()
      }
    >
      <form
        className={`issue-dialog${
          isDraggingAttachments ? " is-dragging-attachments" : ""
        }`}
        onDragEnter={(event) => {
          if (!dataTransferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          attachmentDragDepthRef.current += 1;
          if (!isSubmitting) setIsDraggingAttachments(true);
        }}
        onDragLeave={(event) => {
          if (!dataTransferHasFiles(event.dataTransfer)) return;
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
          if (!dataTransferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          if (!isSubmitting) event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (!dataTransferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          attachmentDragDepthRef.current = 0;
          setIsDraggingAttachments(false);
          if (!isSubmitting) {
            addAttachments(filesFromDataTransfer(event.dataTransfer), true);
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
          const target = event.target instanceof HTMLTextAreaElement
            ? event.target
            : null;
          const segmentStart = Number(
            target?.dataset.descriptionStart ?? description.length,
          );
          addAttachments(
            images,
            true,
            target
              ? {
                  start: segmentStart + target.selectionStart,
                  end: segmentStart + target.selectionEnd,
                }
              : undefined,
          );
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || isSubmitting) return;
          setSubmitError(null);
          if (!projectId) return;
          void onCreate(
            projectId,
            {
              title: title.trim(),
              description: description.trim() || null,
              priority: Number(priority),
              assigneeUserId: assigneeUserId || null,
              status,
              preferredProvider: (preferredProvider || null) as
                | AgentProvider
                | null,
              preferredModel: preferredModel || null,
              ...(checkpoints.length > 0 ? { checkpoints } : {}),
              attachments: attachments.map(({ file }) => file),
              ...(attachments.length > 0
                ? {
                    attachmentReferences: attachments.map(
                      ({ reference }) => reference,
                    ),
                  }
                : {}),
            },
          )
            .then(clearCreateIssueDraft)
            .catch((error) =>
              setSubmitError(error instanceof Error ? error.message : String(error)),
            );
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t("issue.dialog")}
      >
        <header>
          <div className="issue-dialog-context">
            {!compactHeader && <strong>{t("issue.newIssue")}</strong>}
            {projects.length > 0 && (
              <>
                {!compactHeader && <span aria-hidden="true">/</span>}
                <SelectMenu
                  className="issue-project-context"
                  disabled={isSubmitting}
                  label={t("issue.project")}
                  onValueChange={(nextProjectId) => {
                    setProjectId(nextProjectId);
                    if (nextProjectId !== workflowProjectId) {
                      setCheckpoints([]);
                    }
                  }}
                  options={projects.map((project) => ({
                    label: project.name,
                    value: project.id,
                  }))}
                  size="small"
                  value={projectId}
                />
              </>
            )}
          </div>
          <button
            className="issue-dialog-close"
            disabled={isSubmitting}
            onClick={closeWithDraft}
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
            <DraftIssueDescriptionEditor
              attachments={attachments}
              description={description}
              editorRef={descriptionEditorRef}
              label={t("issue.description")}
              onChange={setDescription}
              onRemoveAttachment={(reference) => {
                const index = attachments.findIndex(
                  (attachment) => attachment.reference === reference,
                );
                if (index >= 0) removeAttachment(index, reference);
              }}
              placeholder={t("issue.descriptionPlaceholder")}
              removeLabel={(name) => t("issue.remove", { name })}
            />
            {remainingAttachments.length > 0 && (
              <div
                aria-label={t("issue.attachments")}
                className="issue-attachment-list"
              >
                {remainingAttachments.map(({ file, reference }) => (
                  <SelectedAttachment
                    file={file}
                    key={reference}
                    onRemove={() => {
                      const index = attachments.findIndex(
                        (attachment) => attachment.reference === reference,
                      );
                      if (index >= 0) removeAttachment(index, reference);
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
            {workflow && projectId === workflowProjectId ? (
              <IssueCheckpointDropdown
                checkpoints={checkpoints}
                disabled={isSubmitting}
                onChange={setCheckpoints}
                workflow={workflow}
              />
            ) : null}
            <NativeSelect
              className="issue-assignee-select"
              label={t("issue.assignee")}
              onValueChange={setAssigneeUserId}
              options={[
                { label: t("run.unassigned"), value: "" },
                ...members.map((member) => ({
                  label: member.name,
                  value: member.userId,
                })),
              ]}
              value={assigneeUserId}
            />
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
            <NativeSelect
              className="issue-priority-select"
              label={t("issue.priority")}
              onValueChange={(value) =>
                setPriority(value as "1" | "2" | "3" | "4")
              }
              options={[
                { label: t("issue.priority1"), value: "1" },
                { label: t("issue.priority2"), value: "2" },
                { label: t("issue.priority3"), value: "3" },
                { label: t("issue.priority4"), value: "4" },
              ]}
              value={priority}
            />
            <NativeSelect
              className="issue-provider-select"
              label={t("issue.preferredProvider")}
              onValueChange={(value) => {
                setPreferredProvider(value);
                if (preferredModel) setPreferredModel("");
              }}
              options={[
                { label: t("issue.agentDefault"), value: "" },
                ...availableProviders.map((provider) => ({
                  label: providerDisplayName(provider),
                  value: provider,
                })),
              ]}
              value={preferredProvider}
            />
            <NativeSelect
              className="issue-model-select"
              disabled={!preferredProvider}
              label={t("issue.preferredModel")}
              onValueChange={setPreferredModel}
              options={
                preferredProvider &&
                preferredProvider in agentModels
                  ? agentModels[preferredProvider as AgentProvider].map(
                      (option) => ({
                        ...option,
                        label: option.value
                          ? option.label
                          : t("settings.providerDefaultModel"),
                      }),
                    )
                  : []
              }
              placeholder={t("issue.selectProviderFirst")}
              value={preferredModel}
            />
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
                  addAttachments(selected, true);
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
              onClick={closeWithDraft}
              type="button"
            >
              {t("common.cancel")}
            </button>
            <button
              className="issue-submit-button"
              disabled={isSubmitting || !title.trim() || !projectId}
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

type DraftIssueAttachment = { file: File; reference: string };

type DraftIssueDescriptionPart =
  | { type: "text"; start: number; end: number; value: string }
  | {
      type: "attachment";
      start: number;
      end: number;
      attachment: DraftIssueAttachment;
    };

function draftIssueDescriptionParts(
  description: string,
  attachments: DraftIssueAttachment[],
): DraftIssueDescriptionPart[] {
  const ranges = attachments
    .filter(({ file }) => file.type.startsWith("image/"))
    .flatMap((attachment) => {
      const target = `briar-attachment://${attachment.reference}`;
      const matches: Array<{
        start: number;
        end: number;
        attachment: DraftIssueAttachment;
      }> = [];
      let targetIndex = description.indexOf(target);
      while (targetIndex >= 0) {
        const start = description.lastIndexOf("![", targetIndex);
        const destinationStart = description.lastIndexOf("](", targetIndex);
        const end = description.indexOf(")", targetIndex + target.length);
        if (
          start >= 0 &&
          destinationStart > start &&
          destinationStart < targetIndex &&
          end >= 0
        ) {
          matches.push({ attachment, end: end + 1, start });
        }
        targetIndex = description.indexOf(target, targetIndex + target.length);
      }
      return matches;
    })
    .sort((left, right) => left.start - right.start)
    .filter((range, index, all) => index === 0 || range.start >= all[index - 1]!.end);

  if (ranges.length === 0) {
    return [{ end: description.length, start: 0, type: "text", value: description }];
  }

  const parts: DraftIssueDescriptionPart[] = [];
  let offset = 0;
  for (const range of ranges) {
    parts.push({
      end: range.start,
      start: offset,
      type: "text",
      value: description.slice(offset, range.start),
    });
    parts.push({ ...range, type: "attachment" });
    offset = range.end;
  }
  parts.push({
    end: description.length,
    start: offset,
    type: "text",
    value: description.slice(offset),
  });
  return parts;
}

function DraftIssueDescriptionEditor({
  attachments,
  description,
  editorRef,
  label,
  onChange,
  onRemoveAttachment,
  placeholder,
  removeLabel,
}: {
  attachments: DraftIssueAttachment[];
  description: string;
  editorRef: RefObject<HTMLDivElement | null>;
  label: string;
  onChange: (value: string) => void;
  onRemoveAttachment: (reference: string) => void;
  placeholder: string;
  removeLabel: (name: string) => string;
}) {
  const parts = useMemo(
    () => draftIssueDescriptionParts(description, attachments),
    [attachments, description],
  );
  const hasInlineAttachments = parts.some((part) => part.type === "attachment");

  return (
    <div
      className={`issue-description-editor${
        hasInlineAttachments ? " has-inline-attachments" : ""
      }`}
      ref={editorRef}
    >
      {parts.map((part, index) =>
        part.type === "text" ? (
          <textarea
            aria-label={label}
            className="issue-description-input"
            data-description-end={part.end}
            data-description-start={part.start}
            key={`text-${index}`}
            maxLength={Math.max(
              0,
              100000 - (description.length - part.value.length),
            )}
            onChange={(event) =>
              onChange(
                `${description.slice(0, part.start)}${event.target.value}${description.slice(part.end)}`,
              )
            }
            placeholder={parts.length === 1 ? placeholder : undefined}
            rows={Math.max(1, part.value.split("\n").length)}
            value={part.value}
          />
        ) : (
          <DraftInlineAttachment
            file={part.attachment.file}
            key={`attachment-${part.attachment.reference}`}
            onRemove={() => onRemoveAttachment(part.attachment.reference)}
            removeLabel={removeLabel(part.attachment.file.name)}
          />
        ),
      )}
    </div>
  );
}

function DraftInlineAttachment({
  file,
  onRemove,
  removeLabel,
}: {
  file: File;
  onRemove: () => void;
  removeLabel: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <figure className="issue-inline-attachment">
      {previewUrl && <img alt={file.name} src={previewUrl} />}
      <button aria-label={removeLabel} onClick={onRemove} type="button">
        <Trash2 size={14} />
      </button>
    </figure>
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
  availableProviders,
  activeAgent,
  assignee,
  assignedWorker,
  contextMenuDisabled,
  deletingIssueId,
  isDragging = false,
  isMoving,
  isProcessing,
  onDelete,
  onTransfer,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onEdit,
  onMove,
  run,
  onOpen,
  onProcessNow,
  onPriorityChange,
  onPreferencesChange,
  onCheckpointsChange,
  token,
  updatingIssueId,
}: {
  availableProviders: AgentProvider[];
  activeAgent: ProjectAgent | null;
  assignee: OrganizationMember | null;
  assignedWorker: ExecutionWorker | null;
  contextMenuDisabled: boolean;
  deletingIssueId: string | null;
  isDragging?: boolean;
  isMoving: boolean;
  isProcessing: boolean;
  onDelete: () => void;
  onTransfer?: () => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onEdit: () => void;
  onMove: (placement: HuntRunPlacement) => void;
  run: HuntRun;
  onOpen: () => void;
  onProcessNow?: () => void;
  onPriorityChange: (priority: number | null) => void;
  onPreferencesChange: (preferences: IssueExecutionPreferences) => void;
  onCheckpointsChange: (checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
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
      availableProviders={availableProviders}
      disabled={
        contextMenuDisabled ||
        isMoving ||
        isDragging ||
        deletingIssueId === run.id ||
        updatingIssueId === run.id
      }
      onDelete={onDelete}
      onTransfer={onTransfer}
      onEdit={onEdit}
      onMove={onMove}
      onOpen={onOpen}
      onProcessNow={onProcessNow}
      onPriorityChange={onPriorityChange}
      onPreferencesChange={onPreferencesChange}
      onCheckpointsChange={onCheckpointsChange}
      run={run}
      isProcessing={isProcessing}
    >
      <div
        aria-label={t("run.details", { title: run.title })}
        aria-disabled={isMoving}
        className={`kanban-card ${meta.tone}${isMoving ? " moving" : ""}${isDragging ? " dragging" : ""}${activeAgent || assignedWorker ? " has-assignees" : ""}${[activeAgent, assignedWorker].filter(Boolean).length > 1 ? " has-multiple-assignees" : ""}`}
        draggable={false}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpen();
        }}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="button"
        tabIndex={0}
      >
        {(activeAgent || assignedWorker) && (
          <span className="kanban-card-assignee-badges">
            {assignedWorker && (
              <span
                aria-label={t("run.workerAssigned", {
                  worker: assignedWorker.label,
                })}
                className="kanban-card-worker-badge"
                title={t("run.workerAssigned", {
                  worker: assignedWorker.label,
                })}
              >
                <WorkerIcon icon={assignedWorker.icon} size={18} />
              </span>
            )}
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
                <span
                  aria-hidden="true"
                  className={`kanban-card-provider-badge ${activeAgent.provider}`}
                >
                  <AgentProviderIcon
                    provider={activeAgent.provider}
                    size={11}
                  />
                </span>
              </span>
            )}
          </span>
        )}
        <span className="kanban-card-kicker">
          <small>AH-{run.runNumber}</small>
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
          <RunStatusPill
            label={label}
            reviewed={hasResultReviews(run)}
            status={run.status}
            tone={meta.tone}
          />
          <i className="kanban-source">
            <span className={`source-dot ${run.source}`} />
            {t(`source.${run.source}` as MessageKey)}
          </i>
          {run.executionReadiness === "waiting" && (
            <i>{t("issue.waitingOnPrerequisites", {
              count: run.waitingOnPrerequisiteCount ?? 0,
            })}</i>
          )}
          {run.priority !== null && <i className="kanban-priority">P{run.priority}</i>}
          {assignee && (
            <i
              aria-label={`${t("issue.assignee")}: ${assignee.name}`}
              className="kanban-assignee"
              title={`${t("issue.assignee")}: ${assignee.name}`}
            >
              <IssueAssigneeAvatar member={assignee} />
            </i>
          )}
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

function providerDisplayName(provider: AgentProvider) {
  return provider === "codex"
    ? "Codex"
    : provider === "claude"
      ? "Claude"
      : provider === "grok"
        ? "Grok"
        : "OpenCode";
}

function modelDisplayName(provider: AgentProvider, model: string) {
  return (
    agentModels[provider].find((option) => option.value === model)?.label ??
    model
  );
}

function IssueContextMenu({
  availableProviders,
  children,
  disabled,
  onDelete,
  onTransfer,
  onEdit,
  onMove,
  onOpen,
  onProcessNow,
  onPriorityChange,
  onPreferencesChange,
  onCheckpointsChange,
  run,
  isProcessing,
}: {
  availableProviders: AgentProvider[];
  children: ReactElement;
  disabled: boolean;
  onDelete: () => void;
  onTransfer?: () => void;
  onEdit: () => void;
  onMove: (placement: HuntRunPlacement) => void;
  onOpen: () => void;
  onProcessNow?: () => void;
  onPriorityChange: (priority: number | null) => void;
  onPreferencesChange: (preferences: IssueExecutionPreferences) => void;
  onCheckpointsChange: (checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
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
  const currentProvider = run.preferredProvider ?? "none";
  const currentProviderLabel = run.preferredProvider
    ? providerDisplayName(run.preferredProvider)
    : t("issue.agentDefault");
  const currentModelLabel = run.preferredProvider
    ? run.preferredModel
      ? `${modelDisplayName(run.preferredProvider, run.preferredModel)}${
          run.preferredEffort ? ` · ${run.preferredEffort}` : ""
        }`
      : t("settings.providerDefaultModel")
    : t("run.notSet");
  const issueCheckpoints = run.issueCheckpoints ?? [];
  const inheritedBoundaries = inheritedCheckpointBoundaries(
    run.workflow,
    issueCheckpoints,
  );
  const selectedIssueBoundaries = new Set(
    issueCheckpoints.map(checkpointBoundaryKey),
  );
  const checkpointsEditable = canEditIssueCheckpoints(run);
  const isClaimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  const canReassign =
    Boolean(run.workerId || run.requestedWorkerId) &&
    !["completed", "cancelled", "paused"].includes(run.status);
  const processNowDisabled =
    !onProcessNow ||
    run.executionReadiness === "waiting" ||
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
            ) : run.executionReadiness === "waiting" ? (
              <small>{t("issue.waitingOnPrerequisites", {
                count: run.waitingOnPrerequisiteCount ?? 0,
              })}</small>
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

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item">
              <Clock3 aria-hidden="true" size={17} />
              <span>{t("issue.checkpoints")}</span>
              <small>
                {checkpointsEditable
                  ? t("issue.checkpointCount", { count: issueCheckpoints.length })
                  : t("issue.checkpointsLocked")}
              </small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="issue-context-menu issue-context-submenu issue-checkpoint-context-menu"
                collisionPadding={10}
                sideOffset={7}
              >
                {run.workflow.stages.flatMap((stage) =>
                  (["before", "after"] as const).map((position) => {
                    const boundary = `${stage.id}:${position}`;
                    const inherited = inheritedBoundaries.has(boundary);
                    const checked =
                      inherited || selectedIssueBoundaries.has(boundary);
                    const stageLabel = localizeWorkflowStage(
                      t,
                      stage.id,
                      stage.label,
                    );
                    return (
                      <ContextMenu.CheckboxItem
                        checked={checked}
                        className="issue-context-item issue-context-choice"
                        disabled={inherited || !checkpointsEditable}
                        key={boundary}
                        onSelect={() => {
                          if (inherited || !checkpointsEditable) return;
                          onCheckpointsChange(toggleIssueCheckpoint(
                            issueCheckpoints,
                            stage.id,
                            position,
                          ));
                        }}
                      >
                        <ContextMenu.ItemIndicator
                          className="issue-context-check"
                          forceMount
                        >
                          {checked ? <Check aria-hidden="true" size={14} /> : null}
                        </ContextMenu.ItemIndicator>
                        <span>
                          {position === "before"
                            ? t("run.checkpointBefore", { stage: stageLabel })
                            : t("run.checkpointAfter", { stage: stageLabel })}
                        </span>
                        {inherited ? (
                          <small>{t("issue.checkpointRequired")}</small>
                        ) : null}
                      </ContextMenu.CheckboxItem>
                    );
                  }),
                )}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="issue-context-item">
              <Waypoints aria-hidden="true" size={17} />
              <span>{t("issue.preferredProvider")}</span>
              <small>{currentProviderLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="issue-context-menu issue-context-submenu"
                collisionPadding={10}
                sideOffset={7}
              >
                <ContextMenu.RadioGroup value={currentProvider}>
                  <ContextMenu.RadioItem
                    className="issue-context-item issue-context-choice"
                    onSelect={() => {
                      if (!run.preferredProvider) return;
                      onPreferencesChange({
                        provider: null,
                        model: null,
                        effort: null,
                      });
                    }}
                    value="none"
                  >
                    <ContextMenu.ItemIndicator
                      className="issue-context-check"
                      forceMount
                    >
                      {!run.preferredProvider ? (
                        <Check aria-hidden="true" size={14} />
                      ) : null}
                    </ContextMenu.ItemIndicator>
                    <span>{t("issue.agentDefault")}</span>
                  </ContextMenu.RadioItem>
                  {availableProviders.map((provider) => (
                    <ContextMenu.RadioItem
                      className="issue-context-item issue-context-choice"
                      key={provider}
                      onSelect={() => {
                        if (provider === run.preferredProvider) return;
                        onPreferencesChange({
                          provider,
                          model: null,
                          effort: null,
                        });
                      }}
                      value={provider}
                    >
                      <ContextMenu.ItemIndicator
                        className="issue-context-check"
                        forceMount
                      >
                        {provider === run.preferredProvider ? (
                          <Check aria-hidden="true" size={14} />
                        ) : null}
                      </ContextMenu.ItemIndicator>
                      <span>{providerDisplayName(provider)}</span>
                    </ContextMenu.RadioItem>
                  ))}
                  {availableProviders.length === 0 ? (
                    <ContextMenu.Item
                      className="issue-context-item"
                      disabled
                    >
                      <span>{t("issue.noProviders")}</span>
                    </ContextMenu.Item>
                  ) : null}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger
              className="issue-context-item"
              disabled={!run.preferredProvider}
            >
              <BrainCircuit aria-hidden="true" size={17} />
              <span>{t("issue.preferredModel")}</span>
              <small>{currentModelLabel}</small>
              <ChevronRight aria-hidden="true" size={14} />
            </ContextMenu.SubTrigger>
            {run.preferredProvider ? (
              <ContextMenu.Portal>
                <ContextMenu.SubContent
                  className="issue-context-menu issue-context-submenu"
                  collisionPadding={10}
                  sideOffset={7}
                >
                  <ContextMenu.Label className="issue-context-label">
                    {t("settings.model")}
                  </ContextMenu.Label>
                  <ContextMenu.RadioGroup value={run.preferredModel ?? ""}>
                    {agentModels[run.preferredProvider].map((option) => (
                      <ContextMenu.RadioItem
                        className="issue-context-item issue-context-choice"
                        key={option.value || "default"}
                        onSelect={() => {
                          if ((run.preferredModel ?? "") === option.value) {
                            return;
                          }
                          onPreferencesChange({
                            provider: run.preferredProvider!,
                            model: option.value || null,
                            effort: null,
                          });
                        }}
                        value={option.value}
                      >
                        <ContextMenu.ItemIndicator
                          className="issue-context-check"
                          forceMount
                        >
                          {(run.preferredModel ?? "") === option.value ? (
                            <Check aria-hidden="true" size={14} />
                          ) : null}
                        </ContextMenu.ItemIndicator>
                        <span>
                          {option.value
                            ? option.label
                            : t("settings.providerDefaultModel")}
                        </span>
                      </ContextMenu.RadioItem>
                    ))}
                  </ContextMenu.RadioGroup>
                  {run.preferredModel ? (
                    <>
                      <ContextMenu.Separator className="issue-context-separator" />
                      <ContextMenu.Label className="issue-context-label">
                        {t("settings.effort")}
                      </ContextMenu.Label>
                      <ContextMenu.RadioGroup
                        value={run.preferredEffort ?? ""}
                      >
                        {[
                          null,
                          ...agentEfforts[run.preferredProvider],
                        ].map((effort) => (
                          <ContextMenu.RadioItem
                            className="issue-context-item issue-context-choice"
                            key={effort ?? "default"}
                            onSelect={() =>
                              onPreferencesChange({
                                provider: run.preferredProvider!,
                                model: run.preferredModel!,
                                effort,
                              })
                            }
                            value={effort ?? ""}
                          >
                            <ContextMenu.ItemIndicator
                              className="issue-context-check"
                              forceMount
                            >
                              {(run.preferredEffort ?? null) === effort ? (
                                <Check aria-hidden="true" size={14} />
                              ) : null}
                            </ContextMenu.ItemIndicator>
                            <span>
                              {effort ??
                                t("settings.providerDefaultEffort")}
                            </span>
                          </ContextMenu.RadioItem>
                        ))}
                      </ContextMenu.RadioGroup>
                    </>
                  ) : null}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            ) : null}
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
          {onTransfer ? (
            <ContextMenu.Item
              className="issue-context-item"
              onSelect={onTransfer}
            >
              <FolderInput aria-hidden="true" size={17} />
              <span>{t("issue.transfer")}</span>
            </ContextMenu.Item>
          ) : null}

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
  availableProviders,
  deletingIssueId,
  onDelete,
  onTransfer,
  onEdit,
  onMove,
  onOpen,
  onProcessIssueNow,
  onPriorityChange,
  onPreferencesChange,
  onCheckpointsChange,
  members,
  runs,
  processingIssueIds,
  updatingIssueId,
}: {
  availableProviders: AgentProvider[];
  deletingIssueId: string | null;
  onDelete: (runId: string) => void;
  onTransfer?: (runId: string) => void;
  onEdit: (runId: string) => void;
  onMove: (run: HuntRun, placement: HuntRunPlacement) => void;
  onOpen: (runId: string) => void;
  onProcessIssueNow?: (run: HuntRun) => void;
  onPriorityChange: (run: HuntRun, priority: number | null) => void;
  onPreferencesChange: (
    run: HuntRun,
    preferences: IssueExecutionPreferences,
  ) => void;
  onCheckpointsChange: (
    run: HuntRun,
    checkpoints: AutoHuntWorkflowCheckpoint[],
  ) => void;
  members: OrganizationMember[];
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
          const assignee = members.find(
            (member) => member.userId === run.assigneeUserId,
          );
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
              availableProviders={availableProviders}
              disabled={
                deletingIssueId === run.id ||
                updatingIssueId === run.id
              }
              key={run.id}
              onDelete={() => onDelete(run.id)}
              onTransfer={
                onTransfer ? () => onTransfer(run.id) : undefined
              }
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
              onPreferencesChange={(preferences) =>
                onPreferencesChange(run, preferences)
              }
              onCheckpointsChange={(checkpoints) =>
                onCheckpointsChange(run, checkpoints)
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
                    <small>
                      AH-{run.runNumber} · {run.sourceKey}
                      {assignee ? ` · ${assignee.name}` : ""}
                    </small>
                    <PullRequestIconLink urls={run.pullRequestUrls} />
                  </span>
                  <strong>{run.title}</strong>
                  {(run.detail || run.issueDescription) && (
                    <span>{run.detail || run.issueDescription}</span>
                  )}
                </span>
                <span className="issue-list-status" role="cell">
                  <RunStatusPill
                    label={label}
                    reviewed={hasResultReviews(run)}
                    status={run.status}
                    tone={meta.tone}
                  />
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
  assignedWorker = null,
  availableProviders = [],
  availableRuns = [],
  companionMode = false,
  currentUserId = null,
  error,
  isDeletingIssue = false,
  isProcessing = false,
  isRecovering,
  isUpdatingIssue = false,
  isSidebarOpen,
  onBack,
  onAddDependency,
  onAcceptIssueAction,
  onCancel,
  onUnassignRun,
  onDelete,
  onTransfer,
  transferProjects = [],
  onDependencyOpen,
  onLoadAttachment,
  onLoadIssueMessages,
  onLoadRunEvents = async () => [],
  onLoadRunEvidence,
  onLoadRunEvidenceImage,
  onCompleteResultReview,
  mentionMembers = [],
  onMove,
  onOpenFullPage,
  onProcessNow,
  onRetry,
  onRework,
  onResume = async () => undefined,
  onRemoveDependency,
  onSendIssueMessage,
  onUpdateIssue,
  onUpdateIssueCheckpoints,
  onUpdateIssuePreferences = async () => undefined,
  performedAgentName = null,
  performedAgentProvider = null,
  performedAgentModel = null,
  projectId = "",
  run,
  token = null,
}: {
  assignedWorker?: ExecutionWorker | null;
  availableProviders?: AgentProvider[];
  availableRuns?: HuntRun[];
  companionMode?: boolean;
  currentUserId?: string | null;
  error: string | null;
  isDeletingIssue?: boolean;
  isProcessing?: boolean;
  isRecovering: boolean;
  isUpdatingIssue?: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onAddDependency?: (prerequisiteRunId: string) => Promise<unknown>;
  onAcceptIssueAction?: (
    proposal: IssueProposedAction,
  ) => Promise<IssueProposedAction>;
  onCancel: () => Promise<unknown>;
  onUnassignRun?: (runId: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onTransfer?: (targetProjectId: string) => Promise<unknown>;
  transferProjects?: Project[];
  onDependencyOpen?: (runId: string) => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: () => Promise<IssueMessage[]>;
  onLoadRunEvents?: () => Promise<HuntEvent[]>;
  onLoadRunEvidence: () => Promise<RunEvidence[]>;
  onLoadRunEvidenceImage?: (image: RunEvidenceImage) => Promise<Blob>;
  onCompleteResultReview?: () => Promise<unknown>;
  mentionMembers?: OrganizationMember[];
  onMove: (placement: HuntRunPlacement) => Promise<unknown>;
  onOpenFullPage?: () => void;
  onProcessNow?: () => void;
  onRetry: () => Promise<unknown>;
  onRework?: (input: {
    workflowStage: string;
    reason: string;
  }) => Promise<unknown>;
  onResume?: () => Promise<unknown>;
  onRemoveDependency?: (prerequisiteRunId: string) => Promise<unknown>;
  onSendIssueMessage: (input: {
    body: string;
    parentMessageId: string | null;
    mentionedUserIds?: string[];
    attachments?: File[];
    attachmentReferences?: string[];
  }) => Promise<IssueMessageSendResult>;
  onUpdateIssue?: (input: UpdateIssueInput) => Promise<unknown>;
  onUpdateIssueCheckpoints?: (
    checkpoints: AutoHuntWorkflowCheckpoint[],
  ) => Promise<unknown>;
  onUpdateIssuePreferences?: (
    input: IssueExecutionPreferences,
  ) => Promise<unknown>;
  performedAgentName?: string | null;
  performedAgentProvider?: AgentProvider | null;
  performedAgentModel?: string | null;
  projectId?: string;
  run: HuntRun;
  token?: string | null;
}) {
  const { localeTag, t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const needsAttention = ["paused", "blocked", "failed"].includes(run.status);
  const canCancelRemoteExecution =
    Boolean(run.workerId) &&
    !["completed", "cancelled", "paused", "blocked", "failed"].includes(run.status);
  const canUnassign = Boolean(onUnassignRun && (run.workerId || run.requestedWorkerId)) &&
    !["completed", "cancelled"].includes(run.status);
  const isClaimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  const canReassign =
    Boolean(run.workerId || run.requestedWorkerId) &&
    !["completed", "cancelled", "paused"].includes(run.status);
  const processNowDisabled =
    !onProcessNow ||
    run.executionReadiness === "waiting" ||
    (run.status !== "queued" && !canReassign) ||
    (isClaimed && !canReassign) ||
    isProcessing;
  const priorityLabel = run.priority === null
    ? t("run.notSet")
    : t(`issue.priority${run.priority}` as MessageKey);
  const assignee = mentionMembers.find(
    (member) => member.userId === run.assigneeUserId,
  ) ?? null;
  const { toast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [transferTargetProjectId, setTransferTargetProjectId] = useState(
    () => transferProjects[0]?.id ?? "",
  );
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [isCompletingResultReview, setIsCompletingResultReview] =
    useState(false);
  const [isResumePending, setIsResumePending] = useState(false);
  const [resultReviewError, setResultReviewError] = useState<string | null>(
    null,
  );
  const [isReworkFormOpen, setIsReworkFormOpen] = useState(false);
  const [reworkStage, setReworkStage] = useState("");
  const [reworkFeedback, setReworkFeedback] = useState("");
  const [reworkError, setReworkError] = useState<string | null>(null);
  const [isSubmittingRework, setIsSubmittingRework] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<IssueDetailTab>(() =>
    defaultIssueDetailTab(run.status),
  );
  const hasWorkerExecution = Boolean(run.workerId);
  const workerExecutionIsLive = ![
    "completed",
    "cancelled",
    "paused",
    "blocked",
    "failed",
  ].includes(run.status);
  const workerEvents = useProjectAgentWorkerEvents(
    token,
    projectId,
    hasWorkerExecution ? [run.id] : [],
    workerExecutionIsLive,
  );
  const agentActivity = useMemo(
    () => agentMessagesFromAppServerEvents(workerEvents.events),
    [workerEvents.events],
  );
  const activityProvider = workerEvents.events.find((event) => event.provider)
    ?.provider ?? run.requestedProvider ?? run.preferredProvider ?? null;
  const [runEvents, setRunEvents] = useState<HuntEvent[]>([]);
  const [runEventsLoading, setRunEventsLoading] = useState(true);
  const [runEventsLoadError, setRunEventsLoadError] = useState<string | null>(
    null,
  );
  const onLoadRunEventsRef = useRef(onLoadRunEvents);
  const runEventsRequest = useRef(0);
  onLoadRunEventsRef.current = onLoadRunEvents;
  const loadRunEvents = useCallback(async () => {
    const request = ++runEventsRequest.current;
    setRunEventsLoading(true);
    setRunEventsLoadError(null);
    try {
      const events = await onLoadRunEventsRef.current();
      if (request === runEventsRequest.current) setRunEvents(events);
    } catch (caught) {
      if (request !== runEventsRequest.current) return;
      setRunEventsLoadError(
        caught instanceof Error ? caught.message : t("run.activityLoadFailed"),
      );
    } finally {
      if (request === runEventsRequest.current) setRunEventsLoading(false);
    }
  }, [t]);
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
      if (isPropertiesOpen) {
        setIsPropertiesOpen(false);
        return true;
      }
      onBack();
      return true;
    },
    { enabled: companionMode, priority: 200 },
  );
  const detailTabsId = useId();
  useEffect(() => {
    setActiveDetailTab(defaultIssueDetailTab(run.status));
    setIsPropertiesOpen(false);
    setRunEvents([]);
    setIsCompletingResultReview(false);
    setIsResumePending(false);
    setResultReviewError(null);
    setIsReworkFormOpen(false);
    setReworkStage("");
    setReworkFeedback("");
    setReworkError(null);
    setIsSubmittingRework(false);
  }, [run.id, run.status]);
  useEffect(() => {
    void loadRunEvents();
  }, [loadRunEvents, run.eventCount, run.id]);
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
  const issueAttachmentsRef = useRef(run.attachments ?? []);
  issueAttachmentsRef.current = run.attachments ?? [];
  const renderIssueMarkdownImage = useCallback(
    ({ alt, src }: ComponentProps<"img">) => (
      <IssueMarkdownImage
        alt={alt ?? ""}
        attachments={issueAttachmentsRef.current}
        onLoadAttachment={onLoadAttachment}
        src={src}
      />
    ),
    [onLoadAttachment],
  );
  const embeddedAttachmentReferences = issueAttachmentReferences(issueContent);
  const remainingAttachments = (run.attachments ?? []).filter(
    (attachment) => !embeddedAttachmentReferences.has(attachment.id),
  );
  const completionSummary =
    run.structuredResult?.summary?.trim() ||
    run.resultSummary?.trim() ||
    (run.status === "completed" ? run.detail?.trim() : null) ||
    null;
  const pausedResultItems =
    run.status === "paused"
      ? Array.from(
          new Set(
            [
              run.detail?.trim() || null,
              run.checkpoint
                ? t(
                    run.checkpoint.position === "before"
                      ? "run.checkpointBefore"
                      : "run.checkpointAfter",
                    { stage: run.checkpoint.stageLabel },
                  )
                : t("run.pausedDescription"),
              run.checkpoint
                ? run.checkpoint.terminalReviewOnly
                  ? t("run.checkpointTerminalReview")
                  : t("run.checkpointNextStage", {
                      stage:
                        run.checkpoint.nextStageLabel ??
                        run.checkpoint.nextStage ??
                        run.checkpoint.stageLabel,
                    })
                : null,
            ].filter((item): item is string => Boolean(item)),
          ),
        )
      : [];
  const pausedPartialSummary =
    run.status === "paused" && run.structuredResult?.outcome === "partial"
      ? completionSummary
      : null;
  const pausedReviewEvents = (() => {
    if (run.status !== "paused") return [];
    const reviewAttempt = run.checkpoint?.attempt ?? run.currentAttempt;
    const reviewRevision = run.checkpoint?.revision ?? run.currentRevision;
    const eventsBeforePause = runEvents.filter((event) => event.status !== "paused");
    const currentReviewEvents = eventsBeforePause.filter(
      (event) =>
        event.attempt === reviewAttempt && event.revision === reviewRevision,
    );
    return [...(currentReviewEvents.length > 0
      ? currentReviewEvents
      : eventsBeforePause)].sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    );
  })();
  const currentWorkflowStageIndex = run.workflow.stages.findIndex(
    (stage) => stage.id === run.workflowStage,
  );
  const reworkStageOptions = currentWorkflowStageIndex >= 0
    ? run.workflow.stages
        .slice(0, currentWorkflowStageIndex + 1)
        .map((stage) => ({
          label: localizeWorkflowStage(t, stage.id, stage.label),
          value: stage.id,
        }))
    : [];
  const resultReviews = run.resultReviews ?? [];
  const currentUserHasReviewed = Boolean(
    currentUserId &&
    resultReviews.some((review) => review.userId === currentUserId),
  );
  const executionMetrics = run.executionMetrics ?? null;
  const cacheTokens = executionMetrics
    ? (executionMetrics.cacheReadTokens ?? 0) +
      (executionMetrics.cacheWriteTokens ?? 0)
    : 0;
  // Mirror claim-time execution selection: preferred → requested → agent → live activity.
  const executionProvider =
    run.preferredProvider ??
    run.requestedProvider ??
    performedAgentProvider ??
    activityProvider ??
    null;
  const executionModel =
    run.preferredProvider != null
      ? run.preferredModel ?? null
      : run.requestedProvider != null
        ? run.requestedModel ?? null
        : performedAgentModel ?? null;
  const executionWorker = assignedWorker ?? null;
  const executionIdentityParts = [
    executionProvider ? providerDisplayName(executionProvider) : null,
    executionProvider && executionModel
      ? modelDisplayName(executionProvider, executionModel)
      : null,
    executionWorker?.label ?? null,
  ].filter((part): part is string => Boolean(part));
  const executionIdentityText = executionIdentityParts.join(" · ");
  const executionIdentity = executionIdentityParts.length > 0 ? (
    <span
      className="run-execution-identity"
      title={executionIdentityText}
    >
      {executionProvider ? (
        <AgentProviderIcon provider={executionProvider} size={12} />
      ) : null}
      {executionWorker ? <WorkerIcon icon={executionWorker.icon} size={14} /> : null}
      <span>{executionIdentityText}</span>
    </span>
  ) : null;
  const executionMetricsPanel =
    executionMetrics || executionProvider || executionWorker ? (
    <dl className="run-result-metrics" aria-label={t("run.resultMetrics")}>
      {executionMetrics ? (
        <div>
          <dt>{t("run.metricsDuration")}</dt>
          <dd>{formatExecutionDuration(executionMetrics.durationMs)}</dd>
        </div>
      ) : null}
      {executionProvider ? (
        <div>
          <dt>{t("run.metricsProvider")}</dt>
          <dd className="run-result-metrics-provider">
            <AgentProviderIcon provider={executionProvider} size={13} />
            <span>{providerDisplayName(executionProvider)}</span>
          </dd>
        </div>
      ) : null}
      {executionProvider && executionModel ? (
        <div>
          <dt>{t("run.metricsModel")}</dt>
          <dd title={executionModel}>
            {modelDisplayName(executionProvider, executionModel)}
          </dd>
        </div>
      ) : null}
      {executionWorker ? (
        <div>
          <dt>{t("run.metricsWorker")}</dt>
          <dd className="run-result-metrics-provider">
            <WorkerIcon icon={executionWorker.icon} size={14} />
            <span>{executionWorker.label}</span>
          </dd>
        </div>
      ) : null}
      {executionMetrics ? (
        executionMetrics.totalTokens === null ? (
          <div>
            <dt>{t("run.metricsTotalTokens")}</dt>
            <dd>{t("run.metricsTokensUnavailable")}</dd>
          </div>
        ) : (
          <div>
            <dt>{t("run.metricsTotalTokens")}</dt>
            <dd title={new Intl.NumberFormat(localeTag).format(executionMetrics.totalTokens)}>
              {formatExecutionTokens(executionMetrics.totalTokens, localeTag)}
            </dd>
          </div>
        )
      ) : null}
      {executionMetrics?.inputTokens != null ? (
        <div>
          <dt>{t("run.metricsInputTokens")}</dt>
          <dd>{formatExecutionTokens(executionMetrics.inputTokens, localeTag)}</dd>
        </div>
      ) : null}
      {executionMetrics?.outputTokens != null ? (
        <div>
          <dt>{t("run.metricsOutputTokens")}</dt>
          <dd>{formatExecutionTokens(executionMetrics.outputTokens, localeTag)}</dd>
        </div>
      ) : null}
      {executionMetrics && cacheTokens > 0 ? (
        <div>
          <dt>{t("run.metricsCacheTokens")}</dt>
          <dd>{formatExecutionTokens(cacheTokens, localeTag)}</dd>
        </div>
      ) : null}
      {executionMetrics && (executionMetrics.reasoningOutputTokens ?? 0) > 0 ? (
        <div>
          <dt>{t("run.metricsReasoningTokens")}</dt>
          <dd>
            {formatExecutionTokens(
              executionMetrics.reasoningOutputTokens!,
              localeTag,
            )}
          </dd>
        </div>
      ) : null}
    </dl>
  ) : null;
  const blockerReason =
    run.structuredResult?.summary?.trim() ||
    run.detail?.trim() ||
    t("run.blockedReasonUnknown");
  const blockerDetails =
    run.structuredResult && run.detail?.trim() !== blockerReason
      ? run.detail?.trim() || null
      : null;
  const unblockAction =
    run.structuredResult?.nextAction?.trim() ||
    t("run.blockedResolutionDefault", {
      count: run.currentAttempt + 1,
    });
  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setConfirmCancel(false);
    } catch {
      // The hook exposes the actionable error on this page.
    }
  };
  const resumePausedRun = async () => {
    if (isResumePending || isRecovering || run.resumeRequestedAt) return;
    setIsResumePending(true);
    try {
      await onResume();
      setConfirmCancel(false);
    } catch {
      setIsResumePending(false);
      // The hook exposes the actionable error on this page.
    }
  };
  const resumeIsPending =
    isResumePending || isRecovering || Boolean(run.resumeRequestedAt);
  const completeResultReview = async () => {
    if (!onCompleteResultReview || currentUserHasReviewed) return;
    setIsCompletingResultReview(true);
    setResultReviewError(null);
    try {
      await onCompleteResultReview();
    } catch {
      setResultReviewError(t("run.resultReviewFailed"));
    } finally {
      setIsCompletingResultReview(false);
    }
  };
  const openReworkForm = () => {
    setReworkStage(
      reworkStageOptions.at(-1)?.value ?? reworkStageOptions[0]?.value ?? "",
    );
    setReworkFeedback("");
    setReworkError(null);
    setIsReworkFormOpen(true);
  };
  const submitRework = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = reworkFeedback.trim();
    if (!onRework || !reworkStage || !reason) return;
    setIsSubmittingRework(true);
    setReworkError(null);
    try {
      await onRework({ workflowStage: reworkStage, reason });
      setIsReworkFormOpen(false);
    } catch (caught) {
      setReworkError(
        caught instanceof Error ? caught.message : t("run.reworkFailed"),
      );
    } finally {
      setIsSubmittingRework(false);
    }
  };
  const shareIssue = async () => {
    try {
      const result = await shareIssueLink({
        projectId,
        runId: run.id,
        title: run.title,
      });
      if (result === "copied") {
        toast(t("issue.linkCopied"), { tone: "success" });
      }
    } catch {
      toast(t("issue.shareFailed"), { tone: "error" });
    }
  };
  const copyIssueLink = async () => {
    try {
      await copyIssueShareLink({
        projectId,
        runId: run.id,
      });
      toast(t("issue.linkCopied"), { tone: "success" });
    } catch {
      toast(t("issue.shareFailed"), { tone: "error" });
    }
  };
  const copyId = async () => {
    try {
      await copyIssueId(run.runNumber);
      toast(t("issue.idCopied"), { tone: "success" });
    } catch {
      toast(t("issue.copyIdFailed"), { tone: "error" });
    }
  };
  const reviewed = hasResultReviews(run);
  const compactProperties = (
    <div className="run-page-property-badges" aria-label={t("run.properties")}>
      <span
        className={`run-page-property-badge ${meta.tone}${reviewed ? " reviewed" : ""}`}
        title={
          reviewed
            ? `${t("dashboard.status")}: ${t("run.resultReviewed")}`
            : t("dashboard.status")
        }
      >
        {reviewed ? (
          <BadgeCheck aria-hidden="true" className="status-pill-review-icon" size={13} />
        ) : (
          <Activity aria-hidden="true" size={13} />
        )}
        {label}
      </span>
      <span className="run-page-property-badge priority" title={t("issue.priority")}>
        <Signal aria-hidden="true" size={13} />
        {priorityLabel}
      </span>
      <span className="run-page-property-badge worker" title={t("run.assignee")}>
        <UserRound aria-hidden="true" size={13} />
        {assignee?.name ?? t("run.unassigned")}
      </span>
      <span className="run-page-property-badge agent" title={t("run.agent")}>
        <Bot aria-hidden="true" size={13} />
        {performedAgentName ?? t("run.unassigned")}
      </span>
    </div>
  );
  const processNowButton = (
    <Button
      className="run-page-process-now"
      disabled={processNowDisabled}
      onClick={onProcessNow}
      size="sm"
      type="button"
    >
      {isProcessing ? (
        <LoaderCircle aria-hidden="true" className="spin" size={15} />
      ) : (
        <Bot aria-hidden="true" size={15} />
      )}
      {t(
        isProcessing
          ? "issue.processNowRunning"
          : canReassign
            ? "worker.reassign"
            : "issue.processNow",
      )}
    </Button>
  );
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
          <div className="run-page-titlebar-actions">
            {compactProperties}
            {processNowButton}
            {onOpenFullPage ? (
              <button
                aria-label={t("inbox.openFullPage")}
                className="run-page-link-copy run-page-open-full-page"
                onClick={onOpenFullPage}
                title={t("inbox.openFullPage")}
                type="button"
              >
                <Maximize2 aria-hidden="true" size={16} />
              </button>
            ) : null}
            <button
              aria-controls="run-properties-panel"
              aria-expanded={isPropertiesOpen}
              className="run-page-properties-toggle"
              onClick={() => setIsPropertiesOpen((open) => !open)}
              type="button"
            >
              <Columns3 aria-hidden="true" size={15} />
              {t("run.properties")}
              <ChevronDown aria-hidden="true" size={13} />
            </button>
            <button
              aria-label={t("issue.copyId")}
              className="run-page-link-copy run-page-id-copy"
              onClick={() => void copyId()}
              title={t("issue.copyId")}
              type="button"
            >
              <Copy aria-hidden="true" size={16} />
            </button>
            <button
              aria-label={t("issue.copyLink")}
              className="run-page-link-copy run-page-share-copy"
              disabled={!projectId}
              onClick={() => void copyIssueLink()}
              title={t("issue.copyLink")}
              type="button"
            >
              <Link2 aria-hidden="true" size={16} />
            </button>
            <IssueActionsMenu
              disabled={isUpdatingIssue || isDeletingIssue || isRecovering}
              onCancel={
                canCancelRemoteExecution
                  ? () => void runAction(onCancel)
                  : undefined
              }
              onUnassign={
                canUnassign
                  ? () => void runAction(() => onUnassignRun!(run.id))
                  : undefined
              }
              onDelete={onDelete ? () => setIsDeleteDialogOpen(true) : undefined}
              onTransfer={
                onTransfer
                  ? () => {
                      setTransferError(null);
                      setTransferTargetProjectId(
                        transferProjects[0]?.id ?? "",
                      );
                      setIsTransferDialogOpen(true);
                    }
                  : undefined
              }
              onEdit={onUpdateIssue ? () => setIsEditDialogOpen(true) : undefined}
            />
          </div>
        </header>
      )}
      <div className="run-page-scroll">
        <article
          aria-labelledby="run-page-title"
          className="run-page"
        >
          {companionMode ? (
            <header>
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
                    <IssueActionsMenu
                      disabled={isUpdatingIssue || isDeletingIssue || isRecovering}
                      onCancel={
                        canCancelRemoteExecution
                          ? () => void runAction(onCancel)
                          : undefined
                      }
                      onUnassign={
                        canUnassign
                          ? () => void runAction(() => onUnassignRun!(run.id))
                          : undefined
                      }
                      onDelete={
                        onDelete ? () => setIsDeleteDialogOpen(true) : undefined
                      }
                      onTransfer={
                        onTransfer
                          ? () => {
                              setTransferError(null);
                              setTransferTargetProjectId(
                                transferProjects[0]?.id ?? "",
                              );
                              setIsTransferDialogOpen(true);
                            }
                          : undefined
                      }
                      onEdit={
                        onUpdateIssue
                          ? () => setIsEditDialogOpen(true)
                          : undefined
                      }
                      onShare={() => void shareIssue()}
                    />
                  </div>
                </div>
                <div className="run-page-companion-actions">
                  {compactProperties}
                  {processNowButton}
                  <button
                    aria-controls="run-properties-panel"
                    aria-expanded={isPropertiesOpen}
                    className="run-page-properties-toggle"
                    onClick={() => setIsPropertiesOpen((open) => !open)}
                    type="button"
                  >
                    <Columns3 aria-hidden="true" size={15} />
                    {t("run.properties")}
                    <ChevronDown aria-hidden="true" size={13} />
                  </button>
                </div>
              </div>
            </header>
          ) : null}
          <div className="run-page-body">
            <div className="run-page-layout">
              <div className="run-page-main">
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
                    {t("run.issue")}
                  </button>
                  <button
                    aria-controls={`${detailTabsId}-result-panel`}
                    aria-selected={activeDetailTab === "result"}
                    id={`${detailTabsId}-result-tab`}
                    onClick={() => setActiveDetailTab("result")}
                    role="tab"
                    type="button"
                  >
                    {t("run.resultTab")}
                  </button>
                  <button
                    aria-controls={`${detailTabsId}-evidence-panel`}
                    aria-selected={activeDetailTab === "evidence"}
                    id={`${detailTabsId}-evidence-tab`}
                    onClick={() => setActiveDetailTab("evidence")}
                    role="tab"
                    type="button"
                  >
                    {t("run.evidence")}
                  </button>
                  <button
                    aria-controls={`${detailTabsId}-agent-activity-panel`}
                    aria-selected={activeDetailTab === "agentActivity"}
                    id={`${detailTabsId}-agent-activity-tab`}
                    onClick={() => setActiveDetailTab("agentActivity")}
                    role="tab"
                    type="button"
                  >
                    {t("run.agentActivity")}
                  </button>
                  <button
                    aria-controls={`${detailTabsId}-status-history-panel`}
                    aria-selected={activeDetailTab === "statusHistory"}
                    id={`${detailTabsId}-status-history-tab`}
                    onClick={() => setActiveDetailTab("statusHistory")}
                    role="tab"
                    type="button"
                  >
                    {t("run.status")}
                  </button>
                  {companionMode ? (
                    <button
                      aria-controls={`${detailTabsId}-conversation-panel`}
                      aria-selected={activeDetailTab === "conversation"}
                      id={`${detailTabsId}-conversation-tab`}
                      onClick={() => setActiveDetailTab("conversation")}
                      role="tab"
                      type="button"
                    >
                      {t("run.messages")}
                    </button>
                  ) : null}
                </div>
                <div className="run-page-content">
                <section
                  aria-label={t(
                    activeDetailTab === "description"
                      ? "run.issue"
                      : activeDetailTab === "result"
                        ? "run.result"
                      : activeDetailTab === "agentActivity"
                        ? "run.agentActivity"
                      : activeDetailTab === "statusHistory"
                          ? "run.status"
                          : "run.evidence",
                  )}
                  className="issue-description-pane"
                  hidden={activeDetailTab === "conversation"}
                >
                  {activeDetailTab === "description" ? (
                    <div
                      aria-labelledby={`${detailTabsId}-description-tab`}
                      className="issue-description-scroll"
                      id={`${detailTabsId}-description-panel`}
                      role="tabpanel"
                    >
                      {run.status === "blocked" ? (
                        <section
                          aria-labelledby={`${detailTabsId}-blocked-title`}
                          className="blocked-issue-card"
                          role="alert"
                        >
                          <div className="blocked-issue-card-heading">
                            <CircleAlert aria-hidden="true" size={18} />
                            <strong id={`${detailTabsId}-blocked-title`}>
                              {t("run.blocked")}
                            </strong>
                          </div>
                          <dl>
                            <div>
                              <dt>{t("run.blockedReason")}</dt>
                              <dd>{blockerReason}</dd>
                            </div>
                            <div>
                              <dt>{t("run.blockedResolution")}</dt>
                              <dd>{unblockAction}</dd>
                            </div>
                          </dl>
                          {blockerDetails ? (
                            <details className="blocked-issue-details">
                              <summary>
                                <ChevronRight aria-hidden="true" size={14} />
                                {t("run.blockedDetails")}
                              </summary>
                              <p>{blockerDetails}</p>
                            </details>
                          ) : null}
                          <div className="recovery-actions">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  aria-description={t("run.retryWorkerTooltip")}
                                  disabled={isRecovering}
                                  onClick={() => void runAction(onRetry)}
                                  type="button"
                                >
                                  <RotateCcw
                                    className={isRecovering ? "spin" : ""}
                                    size={14}
                                  />
                                  {t("run.retry")}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                className="max-w-72 text-center leading-relaxed"
                                side="top"
                              >
                                {t("run.retryWorkerTooltip")}
                              </TooltipContent>
                            </Tooltip>
                            {confirmCancel ? (
                              <>
                                <button
                                  className="danger"
                                  disabled={isRecovering}
                                  onClick={() => void runAction(onCancel)}
                                  type="button"
                                >
                                  {t("run.confirmCancel")}
                                </button>
                                <button
                                  disabled={isRecovering}
                                  onClick={() => setConfirmCancel(false)}
                                  type="button"
                                >
                                  {t("run.back")}
                                </button>
                              </>
                            ) : (
                              <button
                                className="danger-secondary"
                                disabled={isRecovering}
                                onClick={() => setConfirmCancel(true)}
                                type="button"
                              >
                                {t("run.cancel")}
                              </button>
                            )}
                          </div>
                        </section>
                      ) : null}
                      {issueContent ? (
                        <div className="issue-description-markdown">
                          <ReactMarkdown
                            components={{
                              img: renderIssueMarkdownImage,
                            }}
                            remarkPlugins={[remarkGfm]}
                            skipHtml
                            urlTransform={(url, key) =>
                              key === "src" && issueAttachmentReference(url)
                                ? url
                                : defaultUrlTransform(url)
                            }
                          >
                            {issueContent}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="issue-description-empty">{t("run.notSet")}</p>
                      )}
                      {remainingAttachments.length > 0 && (
                        <IssueAttachmentGallery
                          attachments={remainingAttachments}
                          onLoadAttachment={onLoadAttachment}
                        />
                      )}
                      {needsAttention && !["blocked", "paused"].includes(run.status) ? (
                        <div className="recovery-panel">
                          <div>
                            <CircleAlert size={16} />
                            <span>
                              <strong>{t("run.failed")}</strong>
                              <small>
                                {t("run.retryDescription", {
                                  count: run.currentAttempt + 1,
                                })}
                              </small>
                            </span>
                          </div>
                          <div className="recovery-actions">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  aria-description={t("run.retryWorkerTooltip")}
                                  disabled={isRecovering}
                                  onClick={() => void runAction(onRetry)}
                                  type="button"
                                >
                                  <RotateCcw
                                    className={isRecovering ? "spin" : ""}
                                    size={14}
                                  />
                                  {t("run.retry")}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                className="max-w-72 text-center leading-relaxed"
                                side="top"
                              >
                                {t("run.retryWorkerTooltip")}
                              </TooltipContent>
                            </Tooltip>
                            {confirmCancel ? (
                              <>
                                <button
                                  className="danger"
                                  disabled={isRecovering}
                                  onClick={() => void runAction(onCancel)}
                                  type="button"
                                >
                                  {t("run.confirmCancel")}
                                </button>
                                <button
                                  disabled={isRecovering}
                                  onClick={() => setConfirmCancel(false)}
                                  type="button"
                                >
                                  {t("run.back")}
                                </button>
                              </>
                            ) : (
                              <button
                                className="danger-secondary"
                                disabled={isRecovering}
                                onClick={() => setConfirmCancel(true)}
                                type="button"
                              >
                                {t("run.cancel")}
                              </button>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : activeDetailTab === "result" ? (
                    <div
                      aria-labelledby={`${detailTabsId}-result-tab`}
                      className="run-result-panel"
                      id={`${detailTabsId}-result-panel`}
                      role="tabpanel"
                    >
                      {run.status === "paused" ? (
                        <section
                          aria-labelledby={`${detailTabsId}-paused-result-title`}
                          className="completed-issue-card paused-result-card"
                          role="status"
                        >
                          <div className="completed-issue-card-heading">
                            <RunStatusPill
                              as="span"
                              label={label}
                              reviewed={hasResultReviews(run)}
                              status={run.status}
                              tone={meta.tone}
                            />
                            <strong id={`${detailTabsId}-paused-result-title`}>
                              {t("run.partialResult")}
                            </strong>
                            <small>
                              {t("run.attempt", { count: run.currentAttempt })} ·{" "}
                              {run.checkpoint
                                ? t("run.checkpointRevision", {
                                    revision: run.checkpoint.revision,
                                  })
                                : t("run.revision", {
                                    count: run.currentRevision,
                                  })}
                              {executionIdentity ? (
                                <>
                                  {" "}· {executionIdentity}
                                </>
                              ) : null}
                            </small>
                          </div>
                          {executionMetricsPanel}
                          <div className="paused-review-content">
                            <section
                              aria-busy={runEventsLoading}
                              className="paused-review-section paused-review-work"
                            >
                              <header>
                                <div>
                                  <strong>{t("run.reviewWorkHistory")}</strong>
                                  <p>{t("run.reviewWorkHistoryDescription")}</p>
                                </div>
                                {!runEventsLoading && !runEventsLoadError ? (
                                  <small>
                                    {t("run.activityCount", {
                                      count: pausedReviewEvents.length,
                                    })}
                                  </small>
                                ) : null}
                              </header>
                              {runEventsLoading ? (
                                <div className="paused-review-state">
                                  <LoaderCircle className="spin" size={15} />
                                  {t("run.activityLoading")}
                                </div>
                              ) : runEventsLoadError ? (
                                <button
                                  className="paused-review-state error"
                                  onClick={() => void loadRunEvents()}
                                  type="button"
                                >
                                  <CircleAlert size={14} />
                                  <span>{runEventsLoadError}</span>
                                  <RefreshCw size={13} />
                                </button>
                              ) : pausedReviewEvents.length > 0 ? (
                                <div className="paused-review-timeline">
                                  {pausedReviewEvents.map((event) => {
                                    const display = eventMeta(
                                      event.status,
                                      event.workflowStage,
                                      run.workflow,
                                    );
                                    return (
                                      <div className="paused-review-event" key={event.id}>
                                        <i className={display.tone} />
                                        <div>
                                          <strong>
                                            {localizeEvent(
                                              t,
                                              event.status,
                                              event.workflowStage,
                                              display.label,
                                            )}
                                          </strong>
                                          {event.detail ? <p>{event.detail}</p> : null}
                                          <small>
                                            {event.actor} · {relativeTime(event.occurredAt, t)}
                                          </small>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="paused-review-empty">
                                  {t("run.activityEmpty")}
                                </p>
                              )}
                            </section>
                            <section className="paused-review-section paused-review-result">
                              <header>
                                <div>
                                  <strong>{t("run.reviewWorkResult")}</strong>
                                  <p>{t("run.reviewWorkResultDescription")}</p>
                                </div>
                              </header>
                              <div className="completed-issue-summary paused-result-summary">
                                {pausedPartialSummary ? (
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    skipHtml
                                  >
                                    {pausedPartialSummary}
                                  </ReactMarkdown>
                                ) : (
                                  <ul>
                                    {pausedResultItems.map((item) => (
                                      <li key={item}>{item}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              {run.structuredResult?.nextAction ? (
                                <div className="completed-issue-next-action">
                                  <strong>{t("run.resultNextAction")}</strong>
                                  <span>{run.structuredResult.nextAction}</span>
                                </div>
                              ) : null}
                            </section>
                          </div>
                          {run.pullRequestUrls.length > 0 ? (
                            <div className="run-result-links">
                              {run.pullRequestUrls.map((url, index) => {
                                const pullRequestLabel = pullRequestDisplayName(url, index);
                                return (
                                  <a
                                    href={url}
                                    key={url}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    <GitPullRequest aria-hidden="true" size={14} />
                                    {pullRequestLabel}
                                    <ArrowUp aria-hidden="true" size={13} />
                                  </a>
                                );
                              })}
                            </div>
                          ) : null}
                          <div className="paused-result-actions">
                            <button
                              className="paused-result-resume"
                              disabled={resumeIsPending}
                              onClick={() => void resumePausedRun()}
                              type="button"
                            >
                              {resumeIsPending ? (
                                <LoaderCircle
                                  aria-hidden="true"
                                  className="spin"
                                  size={14}
                                />
                              ) : (
                                <RotateCcw aria-hidden="true" size={14} />
                              )}
                              {t("run.resume")}
                            </button>
                            {onRework && reworkStageOptions.length > 0 ? (
                              <button
                                aria-expanded={isReworkFormOpen}
                                className="paused-result-rework"
                                disabled={isRecovering || isSubmittingRework}
                                onClick={() =>
                                  isReworkFormOpen
                                    ? setIsReworkFormOpen(false)
                                    : openReworkForm()}
                                type="button"
                              >
                                <GitFork aria-hidden="true" size={14} />
                                {t("run.requestRework")}
                              </button>
                            ) : null}
                            <button
                              onClick={() => setActiveDetailTab("evidence")}
                              type="button"
                            >
                              <ImageIcon aria-hidden="true" size={14} />
                              {t("run.viewResultEvidence")}
                            </button>
                          </div>
                          {isReworkFormOpen ? (
                            <form
                              className="paused-rework-form"
                              onSubmit={(event) => void submitRework(event)}
                            >
                              <div className="paused-rework-heading">
                                <strong>{t("run.reworkTitle")}</strong>
                                <p>{t("run.reworkDescription")}</p>
                              </div>
                              <label>
                                <span>{t("run.reworkStage")}</span>
                                <SelectMenu
                                  disabled={isSubmittingRework}
                                  label={t("run.reworkStage")}
                                  onValueChange={setReworkStage}
                                  options={reworkStageOptions}
                                  size="small"
                                  value={reworkStage}
                                />
                              </label>
                              <label>
                                <span>{t("run.reworkFeedback")}</span>
                                <textarea
                                  autoFocus
                                  disabled={isSubmittingRework}
                                  maxLength={4_000}
                                  onChange={(event) =>
                                    setReworkFeedback(event.target.value)}
                                  placeholder={t("run.reworkFeedbackPlaceholder")}
                                  rows={4}
                                  value={reworkFeedback}
                                />
                              </label>
                              {reworkError ? (
                                <p className="paused-rework-error" role="alert">
                                  {reworkError}
                                </p>
                              ) : null}
                              <div className="paused-rework-submit-actions">
                                <button
                                  disabled={isSubmittingRework}
                                  onClick={() => setIsReworkFormOpen(false)}
                                  type="button"
                                >
                                  {t("common.cancel")}
                                </button>
                                <button
                                  disabled={
                                    isSubmittingRework ||
                                    !reworkStage ||
                                    !reworkFeedback.trim()
                                  }
                                  type="submit"
                                >
                                  {isSubmittingRework ? (
                                    <LoaderCircle
                                      aria-hidden="true"
                                      className="spin"
                                      size={14}
                                    />
                                  ) : (
                                    <GitFork aria-hidden="true" size={14} />
                                  )}
                                  {t(
                                    isSubmittingRework
                                      ? "run.reworkSubmitting"
                                      : "run.reworkSubmit",
                                  )}
                                </button>
                              </div>
                            </form>
                          ) : null}
                        </section>
                      ) : completionSummary ? (
                        <section
                          aria-labelledby={`${detailTabsId}-result-title`}
                          className="completed-issue-card"
                        >
                          <div className="completed-issue-card-heading">
                            <RunStatusPill
                              as="span"
                              label={label}
                              reviewed={hasResultReviews(run)}
                              status={run.status}
                              tone={meta.tone}
                            />
                            <strong id={`${detailTabsId}-result-title`}>
                              {t("run.result")}
                            </strong>
                            <small>
                              {t("run.attempt", { count: run.currentAttempt })} ·{" "}
                              {t("run.revision", { count: run.currentRevision })}
                              {executionIdentity ? (
                                <>
                                  {" "}· {executionIdentity}
                                </>
                              ) : null}
                            </small>
                          </div>
                          {executionMetricsPanel}
                          <div className="completed-issue-summary">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              skipHtml
                            >
                              {completionSummary}
                            </ReactMarkdown>
                          </div>
                          {run.structuredResult?.humanActionRequired &&
                          run.structuredResult.nextAction ? (
                            <div className="completed-issue-next-action">
                              <strong>{t("run.resultNextAction")}</strong>
                              <span>{run.structuredResult.nextAction}</span>
                            </div>
                          ) : null}
                          {run.pullRequestUrls.length > 0 ? (
                            <div className="run-result-links">
                              {run.pullRequestUrls.map((url, index) => {
                                const pullRequestLabel = pullRequestDisplayName(url, index);
                                return (
                                  <a
                                    href={url}
                                    key={url}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    <GitPullRequest aria-hidden="true" size={14} />
                                    {pullRequestLabel}
                                    <ArrowUp aria-hidden="true" size={13} />
                                  </a>
                                );
                              })}
                            </div>
                          ) : null}
                          <div className="run-result-review">
                            <div className="run-result-review-heading">
                              <span>
                                <BadgeCheck aria-hidden="true" size={17} />
                                <strong>{t("run.resultReview")}</strong>
                              </span>
                              <small>
                                {t("run.resultReviewerCount", {
                                  count: resultReviews.length,
                                })}
                              </small>
                            </div>
                            <IssueResultReviewers
                              emptyLabel={t("run.resultReviewEmpty")}
                              reviews={resultReviews}
                            />
                            {currentUserId && onCompleteResultReview ? (
                              <button
                                className="run-result-review-complete"
                                disabled={
                                  currentUserHasReviewed ||
                                  isCompletingResultReview
                                }
                                onClick={() => void completeResultReview()}
                                type="button"
                              >
                                {isCompletingResultReview ? (
                                  <LoaderCircle
                                    aria-hidden="true"
                                    className="spin"
                                    size={15}
                                  />
                                ) : (
                                  <Check aria-hidden="true" size={15} />
                                )}
                                {t(
                                  isCompletingResultReview
                                    ? "run.resultReviewSaving"
                                    : currentUserHasReviewed
                                      ? "run.resultReviewed"
                                      : "run.resultReviewComplete",
                                )}
                              </button>
                            ) : null}
                            {resultReviewError ? (
                              <p className="run-result-review-error" role="alert">
                                {resultReviewError}
                              </p>
                            ) : null}
                          </div>
                          <button
                            onClick={() => setActiveDetailTab("evidence")}
                            type="button"
                          >
                            <ImageIcon aria-hidden="true" size={14} />
                            {t("run.viewResultEvidence")}
                          </button>
                        </section>
                      ) : (
                        <div className="run-result-empty">
                          <ListChecks aria-hidden="true" size={20} />
                          <strong>{t("run.result")}</strong>
                          <p>{run.detail?.trim() || t("run.resultEmpty")}</p>
                          {executionMetricsPanel}
                        </div>
                      )}
                      <RunResultScreenshots
                        onLoad={onLoadRunEvidence}
                        onLoadImage={onLoadRunEvidenceImage}
                      />
                    </div>
                  ) : activeDetailTab === "agentActivity" ? (
                    <IssueAgentActivityPanel
                      activity={agentActivity}
                      error={workerEvents.error}
                      id={`${detailTabsId}-agent-activity-panel`}
                      isLive={workerExecutionIsLive && hasWorkerExecution}
                      labelledBy={`${detailTabsId}-agent-activity-tab`}
                      loading={workerEvents.isLoading}
                      provider={activityProvider}
                    />
                  ) : activeDetailTab === "statusHistory" ? (
                    <IssueStatusHistoryPanel
                      events={runEvents}
                      id={`${detailTabsId}-status-history-panel`}
                      labelledBy={`${detailTabsId}-status-history-tab`}
                      loadError={runEventsLoadError}
                      loading={runEventsLoading}
                      onRetry={() => void loadRunEvents()}
                      workflow={run.workflow}
                    />
                  ) : (
                    <RunEvidencePanel
                      id={`${detailTabsId}-evidence-panel`}
                      labelledBy={`${detailTabsId}-evidence-tab`}
                      onLoad={onLoadRunEvidence}
                      onLoadImage={onLoadRunEvidenceImage}
                      run={run}
                    />
                  )}
                </section>
                {companionMode ? (
                  <div
                    aria-labelledby={`${detailTabsId}-conversation-tab`}
                    className="issue-conversation-tab-panel"
                    hidden={activeDetailTab !== "conversation"}
                    id={`${detailTabsId}-conversation-panel`}
                    role="tabpanel"
                  >
                    <IssueConversation
                      mentionMembers={mentionMembers}
                      onAcceptIssueAction={onAcceptIssueAction}
                      onLoadAttachment={onLoadAttachment}
                      onLoad={onLoadIssueMessages}
                      onSend={onSendIssueMessage}
                      run={run}
                    />
                  </div>
                ) : null}
                </div>
                <IssueWorkflowProgress
                  onCheckpointsChange={onUpdateIssueCheckpoints}
                  run={run}
                />
              </div>
              {!companionMode ? (
                <IssueConversation
                  mentionMembers={mentionMembers}
                  onAcceptIssueAction={onAcceptIssueAction}
                  onLoadAttachment={onLoadAttachment}
                  onLoad={onLoadIssueMessages}
                  onSend={onSendIssueMessage}
                  run={run}
                />
              ) : null}
              {isPropertiesOpen ? (
              <div
                className="run-properties-layer"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    setIsPropertiesOpen(false);
                  }
                }}
              >
                <aside
                  aria-label={t("run.properties")}
                  className="run-properties"
                  id="run-properties-panel"
                >
                  <header className="run-properties-header">
                    <h2>{t("run.properties")}</h2>
                    <button
                      aria-label={t("common.close")}
                      onClick={() => setIsPropertiesOpen(false)}
                      type="button"
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  </header>
                  <section>
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
                  <label className="run-property">
                    <span className="run-property-icon provider">
                      <Waypoints size={15} />
                    </span>
                    <span className="run-property-copy">
                      <SelectMenu
                        align="end"
                        disabled={isUpdatingIssue}
                        label={t("issue.preferredProvider")}
                        onValueChange={(value) => {
                          void onUpdateIssuePreferences({
                            provider: (value || null) as AgentProvider | null,
                            model: null,
                            effort: null,
                          }).catch(() => undefined);
                        }}
                        options={[
                          {
                            label: t("issue.agentDefault"),
                            value: "",
                          },
                          ...availableProviders.map((provider) => ({
                            label: providerDisplayName(provider),
                            value: provider,
                          })),
                        ]}
                        size="small"
                        value={run.preferredProvider ?? ""}
                      />
                    </span>
                  </label>
                  <label className="run-property">
                    <span className="run-property-icon model">
                      <BrainCircuit size={15} />
                    </span>
                    <span className="run-property-copy">
                      <SelectMenu
                        align="end"
                        disabled={
                          isUpdatingIssue || !run.preferredProvider
                        }
                        label={t("issue.preferredModel")}
                        onValueChange={(value) => {
                          if (!run.preferredProvider) return;
                          void onUpdateIssuePreferences({
                            provider: run.preferredProvider,
                            model: value || null,
                            effort: null,
                          }).catch(() => undefined);
                        }}
                        options={
                          run.preferredProvider
                            ? agentModels[run.preferredProvider].map(
                                (option) => ({
                                  ...option,
                                  label: option.value
                                    ? option.label
                                    : t("settings.providerDefaultModel"),
                                }),
                              )
                            : []
                        }
                        placeholder={t("issue.selectProviderFirst")}
                        size="small"
                        value={run.preferredModel ?? ""}
                      />
                    </span>
                  </label>
                  <label className="run-property">
                    <span className="run-property-icon effort">
                      <BrainCircuit size={15} />
                    </span>
                    <span className="run-property-copy">
                      <SelectMenu
                        align="end"
                        disabled={
                          isUpdatingIssue ||
                          !run.preferredProvider ||
                          !run.preferredModel
                        }
                        label={t("settings.effort")}
                        onValueChange={(value) => {
                          if (
                            !run.preferredProvider ||
                            !run.preferredModel
                          ) {
                            return;
                          }
                          void onUpdateIssuePreferences({
                            provider: run.preferredProvider,
                            model: run.preferredModel,
                            effort: (value || null) as ModelEffort | null,
                          }).catch(() => undefined);
                        }}
                        options={[
                          {
                            label: t("settings.providerDefaultEffort"),
                            value: "",
                          },
                          ...(run.preferredProvider
                            ? agentEfforts[run.preferredProvider].map(
                                (effort) => ({
                                  label: effort,
                                  value: effort,
                                }),
                              )
                            : []),
                        ]}
                        placeholder={t("issue.selectModelFirst")}
                        size="small"
                        value={run.preferredEffort ?? ""}
                      />
                    </span>
                  </label>
                  <div
                    aria-label={`${t("issue.assignee")}: ${assignee?.name ?? t("run.unassigned")}`}
                    className="run-property"
                    title={t("issue.assignee")}
                  >
                    <span className="run-property-icon assignee"><UserRound size={15} /></span>
                    <span className="run-property-copy"><strong>{assignee?.name ?? t("run.unassigned")}</strong></span>
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
                    aria-label={`${t("run.resultReview")}: ${resultReviews.length > 0 ? resultReviews.map((review) => review.username ? `@${review.username}` : review.name).join(", ") : t("run.resultReviewEmpty")}`}
                    className="run-property run-result-review-property"
                    title={t("run.resultReview")}
                  >
                    <span className="run-property-icon result-review"><BadgeCheck size={16} /></span>
                    <div className="run-property-copy">
                      <strong>{t("run.resultReview")}</strong>
                      <IssueResultReviewers
                        compact
                        emptyLabel={t("run.resultReviewEmpty")}
                        reviews={resultReviews}
                      />
                    </div>
                  </div>
                  <div
                    aria-label={`${t("run.currentAttempt")} · ${t("run.currentRevision")}: ${t("run.attempt", { count: run.currentAttempt })} · ${t("run.revision", { count: run.currentRevision })}${executionIdentityText ? ` · ${executionIdentityText}` : ""}`}
                    className="run-property"
                    title={`${t("run.currentAttempt")} · ${t("run.currentRevision")}${executionIdentityText ? ` · ${executionIdentityText}` : ""}`}
                  >
                    <span className="run-property-icon attempt"><RotateCcw size={15} /></span>
                    <span className="run-property-copy">
                      <strong>{t("run.attempt", { count: run.currentAttempt })} · {t("run.revision", { count: run.currentRevision })}</strong>
                      {executionIdentity}
                    </span>
                  </div>
                </section>
                <IssueDependenciesPanel
                  availableRuns={availableRuns}
                  isUpdating={isUpdatingIssue}
                  onAdd={onAddDependency}
                  onOpen={onDependencyOpen}
                  onRemove={onRemoveDependency}
                  run={run}
                />
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
              ) : null}
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
          members={mentionMembers}
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
      <Dialog
        onOpenChange={(open) => {
          if (isDeletingIssue) return;
          setIsTransferDialogOpen(open);
          if (!open) setTransferError(null);
        }}
        open={isTransferDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <FolderInput size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {t("issue.transferTitle", { title: run.title })}
            </DialogTitle>
            <DialogDescription>
              {t("issue.transferDescription")}
            </DialogDescription>
          </DialogHeader>
          {transferProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("issue.transferNoProjects")}
            </p>
          ) : (
            <NativeSelect
              disabled={isDeletingIssue}
              label={t("issue.transferTarget")}
              onValueChange={setTransferTargetProjectId}
              options={transferProjects.map((project) => ({
                label: project.name,
                value: project.id,
              }))}
              placeholder={t("issue.transferTargetPlaceholder")}
              value={transferTargetProjectId}
            />
          )}
          {transferError ? (
            <p className="text-xs text-destructive" role="alert">
              {transferError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isDeletingIssue}
              onClick={() => setIsTransferDialogOpen(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                isDeletingIssue ||
                !onTransfer ||
                !transferTargetProjectId ||
                transferProjects.length === 0
              }
              onClick={() => {
                if (!onTransfer || !transferTargetProjectId) return;
                setTransferError(null);
                void onTransfer(transferTargetProjectId).catch((caught) => {
                  setTransferError(
                    caught instanceof Error ? caught.message : String(caught),
                  );
                });
              }}
              type="button"
            >
              {isDeletingIssue ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <FolderInput size={15} />
              )}
              {isDeletingIssue
                ? t("issue.transferring")
                : t("issue.transferConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}

function IssueActionsMenu({
  disabled,
  onCancel,
  onUnassign,
  onDelete,
  onTransfer,
  onEdit,
  onShare,
}: {
  disabled: boolean;
  onCancel?: () => void;
  onUnassign?: () => void;
  onDelete?: () => void;
  onTransfer?: () => void;
  onEdit?: () => void;
  onShare?: () => void;
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
          {onShare ? (
            <DropdownMenu.Item
              className="run-page-actions-item"
              onSelect={onShare}
            >
              <Share2 size={14} />
              {t("issue.share")}
            </DropdownMenu.Item>
          ) : null}
          {onEdit ? (
            <DropdownMenu.Item
              className="run-page-actions-item"
              onSelect={onEdit}
            >
              <Pencil size={14} />
              {t("issue.edit")}
            </DropdownMenu.Item>
          ) : null}
          {onTransfer ? (
            <DropdownMenu.Item
              className="run-page-actions-item"
              onSelect={onTransfer}
            >
              <FolderInput size={14} />
              {t("issue.transfer")}
            </DropdownMenu.Item>
          ) : null}
          {onCancel ? (
            <DropdownMenu.Item
              className="run-page-actions-item danger"
              onSelect={onCancel}
            >
              <X size={14} />
              {t("run.cancel")}
            </DropdownMenu.Item>
          ) : null}
          {onUnassign ? (
            <DropdownMenu.Item
              className="run-page-actions-item"
              onSelect={onUnassign}
            >
              <X size={14} />
              {t("worker.unassign")}
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

function IssueDependenciesPanel({
  availableRuns,
  isUpdating,
  onAdd,
  onOpen,
  onRemove,
  run,
}: {
  availableRuns: HuntRun[];
  isUpdating: boolean;
  onAdd?: (prerequisiteRunId: string) => Promise<unknown>;
  onOpen?: (runId: string) => void;
  onRemove?: (prerequisiteRunId: string) => Promise<unknown>;
  run: HuntRun;
}) {
  const { t } = useI18n();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const prerequisiteIds = new Set(
    (run.prerequisites ?? []).map((dependency) => dependency.id),
  );
  const candidates = availableRuns
    .filter(
      (candidate) =>
        candidate.id !== run.id && !prerequisiteIds.has(candidate.id),
    )
    .sort((left, right) => left.runNumber - right.runNumber);

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredCandidates = normalizedSearchQuery
    ? candidates.filter((candidate) =>
        [
          candidate.title,
          `AH-${candidate.runNumber}`,
          candidate.status,
        ].some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery)),
      )
    : candidates;

  const mutate = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const relationList = (
    dependencies: NonNullable<HuntRun["prerequisites"]>,
    removable: boolean,
  ) => (
    <ul className="issue-dependency-list">
      {dependencies.map((dependency) => (
        <li key={dependency.id}>
          <button
            className="issue-dependency-link"
            disabled={!onOpen}
            onClick={() => onOpen?.(dependency.id)}
            type="button"
          >
            <span>AH-{dependency.runNumber}</span>
            <strong>{dependency.title}</strong>
            <small>{t(`status.${dependency.status}` as MessageKey)}</small>
          </button>
          {removable && onRemove ? (
            <button
              aria-label={t("issue.dependencyRemove", {
                title: dependency.title,
              })}
              className="issue-dependency-remove"
              disabled={isUpdating}
              onClick={() => void mutate(() => onRemove(dependency.id))}
              type="button"
            >
              {isUpdating ? (
                <LoaderCircle className="spin" size={13} />
              ) : (
                <X size={13} />
              )}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <section className="issue-dependencies" aria-label={t("issue.dependencies")}>
      <header>
        <span><Waypoints aria-hidden="true" size={16} /></span>
        <div>
          <strong>{t("issue.dependencies")}</strong>
          <small>{t("issue.dependenciesDescription")}</small>
        </div>
      </header>
      <div className="issue-dependency-group">
        <strong>{t("issue.prerequisites")}</strong>
        {(run.prerequisites ?? []).length > 0 ? (
          relationList(run.prerequisites ?? [], true)
        ) : (
          <p>{t("issue.prerequisitesEmpty")}</p>
        )}
      </div>
      {onAdd ? (
        <div className="issue-dependency-add">
          <button
            aria-label={t("issue.dependencyAdd")}
            className="issue-dependency-add-button"
            disabled={isUpdating || candidates.length === 0}
            onClick={() => {
              setError(null);
              setSearchQuery("");
              setIsPickerOpen(true);
            }}
            type="button"
          >
            {isUpdating ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />}
            {t("issue.dependencyAdd")}
          </button>
        </div>
      ) : null}
      <div className="issue-dependency-group">
        <strong>{t("issue.dependents")}</strong>
        {(run.dependents ?? []).length > 0 ? (
          relationList(run.dependents ?? [], false)
        ) : (
          <p>{t("issue.dependentsEmpty")}</p>
        )}
      </div>
      {error ? <p className="issue-dependency-error" role="alert">{error}</p> : null}
      <Dialog
        onOpenChange={(open) => {
          if (isUpdating) return;
          setIsPickerOpen(open);
          if (!open) {
            setSearchQuery("");
            setError(null);
          }
        }}
        open={isPickerOpen}
      >
        <DialogContent className="dependency-picker-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("issue.dependencyPickerTitle")}</DialogTitle>
            <DialogDescription>{t("issue.dependenciesDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            aria-label={t("issue.dependencySearch")}
            autoFocus
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("issue.dependencySearch")}
            value={searchQuery}
          />
          <div
            aria-label={t("issue.prerequisites")}
            className="issue-dependency-picker-list"
            role="listbox"
          >
            {filteredCandidates.length > 0 ? (
              filteredCandidates.map((candidate) => (
                <button
                  className="issue-dependency-picker-item"
                  disabled={isUpdating}
                  key={candidate.id}
                  onClick={() => onAdd && void mutate(() => onAdd(candidate.id))}
                  type="button"
                >
                  <span className="issue-dependency-picker-copy">
                    <span>
                      AH-{candidate.runNumber} · {t(`status.${candidate.status}` as MessageKey)}
                    </span>
                    <strong>{candidate.title}</strong>
                  </span>
                  {isUpdating ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Plus size={15} />
                  )}
                </button>
              ))
            ) : (
              <p className="issue-dependency-picker-empty">
                {normalizedSearchQuery
                  ? t("issue.dependencyNoSearchResults")
                  : t("issue.dependencyNoCandidates")}
              </p>
            )}
          </div>
          {error ? <p className="issue-dependency-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button
              disabled={isUpdating}
              onClick={() => setIsPickerOpen(false)}
              type="button"
              variant="outline"
            >
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type IssueWorkflowProgressState =
  | "complete"
  | "active"
  | "paused"
  | "blocked"
  | "failed"
  | "cancelled"
  | "upcoming";

function issueWorkflowProgressState(
  run: HuntRun,
  stageIndex: number,
): IssueWorkflowProgressState {
  if (run.status === "completed") return "complete";

  const currentStageId = run.status === "paused"
    ? run.checkpoint?.stage ?? run.workflowStage
    : run.workflowStage;
  const currentStageIndex = run.workflow.stages.findIndex(
    (stage) => stage.id === currentStageId,
  );

  if (currentStageIndex < 0 || stageIndex > currentStageIndex) {
    return "upcoming";
  }
  if (stageIndex < currentStageIndex) return "complete";

  if (run.status === "running") return "active";
  if (run.status === "paused") return "paused";
  if (run.status === "blocked") return "blocked";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  return "upcoming";
}

function IssueWorkflowProgress({
  onCheckpointsChange,
  run,
}: {
  onCheckpointsChange?: (
    checkpoints: AutoHuntWorkflowCheckpoint[],
  ) => Promise<unknown>;
  run: HuntRun;
}) {
  const { t } = useI18n();
  const [savingBoundary, setSavingBoundary] = useState<string | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const issueCheckpoints = run.issueCheckpoints ?? [];
  const issueBoundaries = new Set(issueCheckpoints.map(checkpointBoundaryKey));
  const effectiveBoundaries = new Set(
    run.workflow.execution.checkpoints.map(checkpointBoundaryKey),
  );
  const editable = Boolean(onCheckpointsChange) && canEditIssueCheckpoints(run);
  const stateLabels: Record<IssueWorkflowProgressState, string> = {
    complete: t("status.completed"),
    active: t("status.running"),
    paused: t("status.paused"),
    blocked: t("status.blocked"),
    failed: t("status.failed"),
    cancelled: t("status.cancelled"),
    upcoming: t("status.queued"),
  };

  return (
    <div className="issue-workflow-progress">
      <ol aria-label={t("run.totalProgress")} aria-live="polite">
        {run.workflow.stages.map((stage, index) => {
          const state = issueWorkflowProgressState(run, index);
          const label = localizeWorkflowStage(t, stage.id, stage.label);
          const isCurrent = !["complete", "upcoming"].includes(state);
          const renderCheckpoint = (
            position: AutoHuntWorkflowCheckpointPosition,
          ) => {
            const boundary = `${stage.id}:${position}`;
            const issueSpecific = issueBoundaries.has(boundary);
            const configured = effectiveBoundaries.has(boundary);
            const inherited = configured && !issueSpecific;
            if (!editable && !configured) return null;
            const action = issueSpecific
              ? t("issue.checkpointRemove")
              : t("issue.checkpointAdd");
            return (
              <button
                aria-label={inherited
                  ? t("issue.checkpointRequiredAt", { stage: label })
                  : `${action}: ${position === "before"
                      ? t("run.checkpointBefore", { stage: label })
                      : t("run.checkpointAfter", { stage: label })}`}
                className="issue-workflow-checkpoint"
                data-active={configured}
                data-inherited={inherited}
                data-position={position}
                disabled={inherited || !editable || savingBoundary !== null}
                onClick={() => {
                  if (!onCheckpointsChange || inherited || !editable) return;
                  setCheckpointError(null);
                  setSavingBoundary(boundary);
                  void onCheckpointsChange(toggleIssueCheckpoint(
                    issueCheckpoints,
                    stage.id,
                    position,
                  ))
                    .catch((error) => setCheckpointError(
                      error instanceof Error ? error.message : String(error),
                    ))
                    .finally(() => setSavingBoundary(null));
                }}
                title={inherited ? t("issue.checkpointRequired") : action}
                type="button"
              >
                {savingBoundary === boundary ? (
                  <LoaderCircle aria-hidden="true" className="spin" size={10} />
                ) : (
                  <Clock3 aria-hidden="true" size={10} />
                )}
              </button>
            );
          };
          return (
            <li
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`${label}: ${stateLabels[state]}`}
              data-reached={state !== "upcoming"}
              data-state={state}
              key={stage.id}
            >
              {renderCheckpoint("before")}
              <span aria-hidden="true" className="issue-workflow-marker">
                {state === "complete" ? <Check size={11} strokeWidth={3} /> : <i />}
              </span>
              <span aria-hidden="true" className="issue-workflow-label">
                {label}
              </span>
              {renderCheckpoint("after")}
            </li>
          );
        })}
      </ol>
      {checkpointError ? (
        <span className="issue-workflow-checkpoint-error" role="alert">
          {checkpointError}
        </span>
      ) : null}
    </div>
  );
}

function IssueStatusHistoryPanel({
  events,
  id,
  labelledBy,
  loadError,
  loading,
  onRetry,
  workflow,
}: {
  events: HuntEvent[];
  id: string;
  labelledBy: string;
  loadError: string | null;
  loading: boolean;
  onRetry: () => void;
  workflow: HuntRun["workflow"];
}) {
  const { t } = useI18n();

  return (
    <div
      aria-labelledby={labelledBy}
      className="issue-status-history-panel"
      id={id}
      role="tabpanel"
    >
      {loading ? (
        <div className="run-evidence-state">
          <LoaderCircle className="spin" size={16} />
          {t("run.activityLoading")}
        </div>
      ) : loadError ? (
        <button
          className="run-evidence-state error"
          onClick={onRetry}
          type="button"
        >
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button>
      ) : events.length > 0 ? (
        <div className="issue-activity-history">
          {events.map((event) => {
            const display = eventMeta(
              event.status,
              event.workflowStage,
              workflow,
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
          })}
        </div>
      ) : (
        <p className="issue-activity-empty">{t("run.activityEmpty")}</p>
      )}
    </div>
  );
}

function IssueAgentActivityPanel({
  activity,
  error,
  id,
  isLive,
  labelledBy,
  loading,
  provider,
}: {
  activity: AutoHuntAgentMessage[];
  error: string | null;
  id: string;
  isLive: boolean;
  labelledBy: string;
  loading: boolean;
  provider: AgentProvider | null;
}) {
  const { t } = useI18n();

  return (
    <div
      aria-labelledby={labelledBy}
      className="issue-agent-activity-panel"
      id={id}
      role="tabpanel"
    >
      <header>
        <div>
          <strong>{t("run.agentActivity")}</strong>
          <p>{t("run.agentActivityDescription")}</p>
        </div>
        <span className="auto-hunt-event-count">
          {isLive ? (
            <i>
              <span />
              {t("autoHunt.live")}
            </i>
          ) : null}
          {provider ? providerDisplayName(provider) : null}
          {t("autoHunt.eventCount", { count: activity.length })}
        </span>
      </header>
      {error ? (
        <div className="auto-hunt-event-state error" role="alert">
          <CircleAlert size={14} />
          {t("run.agentActivityLoadFailed")}
        </div>
      ) : loading ? (
        <div className="auto-hunt-event-state">
          <LoaderCircle className="spin" size={14} />
          {t("run.agentActivityLoading")}
        </div>
      ) : activity.length === 0 ? (
        <div className="auto-hunt-event-state">
          {t("run.agentActivityEmpty")}
        </div>
      ) : (
        <div
          aria-live="polite"
          className="auto-hunt-agent-messages"
          role="log"
        >
          {activity.map((message) => (
            <article
              className={`auto-hunt-agent-message${message.isComplete ? "" : " running"}`}
              key={message.id}
            >
              <header>
                <span aria-hidden="true">
                  {provider
                    ? <AgentProviderIcon provider={provider} size={14} />
                    : <Bot size={14} />}
                </span>
                <strong>
                  {provider
                    ? providerDisplayName(provider)
                    : message.phase === "final_answer" || message.phase === "final"
                      ? t("autoHunt.agentMessage.final")
                      : t("autoHunt.agentMessage.commentary")}
                </strong>
                {!message.isComplete ? (
                  <small className="auto-hunt-message-streaming">
                    <LoaderCircle className="spin" size={11} />
                    {t("autoHunt.agentMessage.streaming")}
                  </small>
                ) : null}
                <time dateTime={new Date(message.updatedAtMs).toISOString()}>
                  {relativeTime(new Date(message.updatedAtMs).toISOString(), t)}
                </time>
              </header>
              <p>
                {message.text
                  ? naturalLanguageFromAgentMessage(message.text)
                  : t("autoHunt.agentMessage.writing")}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function RunEvidencePanel({
  id,
  labelledBy,
  onLoad,
  onLoadImage,
  run,
}: {
  id: string;
  labelledBy: string;
  onLoad: () => Promise<RunEvidence[]>;
  onLoadImage?: (image: RunEvidenceImage) => Promise<Blob>;
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
                      {(item.images?.length ?? 0) > 0 && onLoadImage ? (
                        <RunEvidenceImageGallery
                          images={item.images ?? []}
                          onLoadImage={onLoadImage}
                        />
                      ) : null}
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

function IssueAssigneeAvatar({ member }: { member: OrganizationMember }) {
  return member.image ? (
    <img alt="" className="issue-assignee-avatar" src={member.image} />
  ) : (
    <span aria-hidden="true" className="issue-assignee-avatar fallback">
      {member.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function IssueResultReviewers({
  compact = false,
  emptyLabel,
  reviews,
}: {
  compact?: boolean;
  emptyLabel: string;
  reviews: IssueResultReview[];
}) {
  if (reviews.length === 0) {
    return <span className="issue-result-reviewers-empty">{emptyLabel}</span>;
  }
  return (
    <div className={`issue-result-reviewers${compact ? " compact" : ""}`}>
      {reviews.map((review) => {
        const displayName = review.username
          ? `@${review.username}`
          : review.name;
        return (
          <span
            className="issue-result-reviewer"
            key={review.userId}
            title={`${review.name} · ${review.completedAt}`}
          >
            <span className="issue-result-reviewer-avatar">
              {review.image ? (
                <img alt="" src={review.image} />
              ) : (
                review.name.slice(0, 1).toUpperCase()
              )}
            </span>
            <strong>{displayName}</strong>
            <Check aria-hidden="true" size={13} />
          </span>
        );
      })}
    </div>
  );
}

function RunResultScreenshots({
  onLoad,
  onLoadImage,
}: {
  onLoad: () => Promise<RunEvidence[]>;
  onLoadImage?: (image: RunEvidenceImage) => Promise<Blob>;
}) {
  const { t } = useI18n();
  const [evidence, setEvidence] = useState<RunEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const loadScreenshots = useCallback(async () => {
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
    if (!onLoadImage) return;
    void loadScreenshots();
  }, [loadScreenshots, onLoadImage]);

  const images = useMemo(
    () => evidence
      .filter((item) => item.canonical && item.status === "passed")
      .flatMap((item) => item.images ?? []),
    [evidence],
  );

  if (!onLoadImage) return null;
  if (!loading && !loadError && images.length === 0) return null;

  return (
    <section
      aria-label={t("run.resultScreenshots")}
      className="run-result-screenshots"
    >
      {loading ? (
        <div className="run-evidence-state">
          <LoaderCircle className="spin" size={16} />
          {t("run.evidenceLoading")}
        </div>
      ) : loadError ? (
        <button
          className="run-evidence-state error"
          onClick={() => void loadScreenshots()}
          type="button"
        >
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button>
      ) : (
        <RunEvidenceImageGallery images={images} onLoadImage={onLoadImage} />
      )}
    </section>
  );
}

function RunEvidenceImageGallery({
  images,
  onLoadImage,
}: {
  images: RunEvidenceImage[];
  onLoadImage: (image: RunEvidenceImage) => Promise<Blob>;
}) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t("run.resultScreenshots")}
      className="run-evidence-images"
    >
      <strong>
        <ImageIcon aria-hidden="true" size={14} />
        {t("run.resultScreenshots")}
        <span>{images.length}</span>
      </strong>
      <div>
        {images.map((image) => (
          <RunEvidenceImagePreview
            image={image}
            key={image.id}
            onLoadImage={onLoadImage}
          />
        ))}
      </div>
    </section>
  );
}

function RunEvidenceImagePreview({
  image,
  onLoadImage,
}: {
  image: RunEvidenceImage;
  onLoadImage: (image: RunEvidenceImage) => Promise<Blob>;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    setFailed(false);
    void onLoadImage(image)
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
  }, [image, onLoadImage]);

  return (
    <>
      <figure className="run-evidence-image">
        <button
          aria-label={t("run.enlargeScreenshot", { name: image.filename })}
          className="run-evidence-image-trigger"
          disabled={!source}
          onClick={() => setPreviewOpen(true)}
          type="button"
        >
          {source ? <img alt={image.filename} src={source} /> : null}
          {!source && !failed ? <LoaderCircle className="spin" size={20} /> : null}
          {failed ? <CircleAlert size={20} /> : null}
        </button>
        <figcaption>
          <span>{image.filename}</span>
          {failed ? <small>{t("run.loadFailed")}</small> : null}
        </figcaption>
      </figure>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="run-evidence-image-dialog"
        >
          <DialogTitle className="run-evidence-image-dialog-title">
            {image.filename}
          </DialogTitle>
          {source ? <img alt={image.filename} src={source} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function IssueConversation({
  mentionMembers,
  onAcceptIssueAction,
  onLoadAttachment,
  onLoad,
  onSend,
  run,
}: {
  mentionMembers: OrganizationMember[];
  onAcceptIssueAction?: (
    proposal: IssueProposedAction,
  ) => Promise<IssueProposedAction>;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoad: () => Promise<IssueMessage[]>;
  onSend: (input: {
    body: string;
    parentMessageId: string | null;
    mentionedUserIds?: string[];
    attachments?: File[];
    attachmentReferences?: string[];
  }) => Promise<IssueMessageSendResult>;
  run: HuntRun;
}) {
  const { localeTag, t } = useI18n();
  const [messages, setMessages] = useState<IssueMessage[]>([]);
  const [activeReplyMessageId, setActiveReplyMessageId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentReplyStates, setAgentReplyStates] = useState<
    Record<string, { pending: number; error: string | null }>
  >({});
  const [actionProposalStates, setActionProposalStates] = useState<
    Record<string, { accepting: boolean; error: string | null }>
  >({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
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

  const messagesById = useMemo(() => {
    const byId = new Map<string, IssueMessage>();
    for (const message of messages) byId.set(message.id, message);
    return byId;
  }, [messages]);
  const orderedMessages = useMemo(
    () =>
      [...messages].sort((left, right) => {
        const byTime = left.createdAt.localeCompare(right.createdAt);
        if (byTime !== 0) return byTime;
        return left.id.localeCompare(right.id);
      }),
    [messages],
  );
  const pendingAgentReplyCount = Object.values(agentReplyStates).reduce(
    (total, state) => total + state.pending,
    0,
  );

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [loading, messages.length, pendingAgentReplyCount]);

  const sendMessage = async (
    body: string,
    parentMessageId: string | null,
    mentionedUserIds: string[],
    attachments: File[],
    attachmentReferences: string[],
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
    const result = await onSend({
      body,
      parentMessageId,
      mentionedUserIds,
      ...(attachments.length > 0
        ? { attachments, attachmentReferences }
        : {}),
    });
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

  const acceptIssueAction = async (proposal: IssueProposedAction) => {
    if (!onAcceptIssueAction) return;
    setActionProposalStates((current) => ({
      ...current,
      [proposal.id]: { accepting: true, error: null },
    }));
    try {
      const accepted = await onAcceptIssueAction(proposal);
      setMessages((current) =>
        current.map((message) =>
          message.proposedAction?.id === proposal.id
            ? { ...message, proposedAction: accepted }
            : message,
        )
      );
      setActionProposalStates((current) => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });
    } catch (caught) {
      setActionProposalStates((current) => ({
        ...current,
        [proposal.id]: {
          accepting: false,
          error: caught instanceof Error ? caught.message : String(caught),
        },
      }));
    }
  };

  return (
    <section className="issue-conversation" aria-label={t("run.messages")}>
      <header className="issue-conversation-header">
        <strong>
          {t("run.messages")}
          {!loading && <span>{messages.length}</span>}
        </strong>
        <small>{t("run.agentRepliesHere")}</small>
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
        ) : orderedMessages.length === 0 ? (
          <p className="issue-message-empty">{t("run.messagesEmpty")}</p>
        ) : (
          orderedMessages.map((message) => {
            const replyComposerId = `issue-reply-composer-${message.id}`;
            const isReplying = activeReplyMessageId === message.id;
            const parentMessage = message.parentMessageId
              ? messagesById.get(message.parentMessageId) ?? null
              : null;
            return (
              <div className="issue-message-group" key={message.id}>
                <IssueMessageItem
                  isReplying={isReplying}
                  localeTag={localeTag}
                  message={message}
                  onAcceptIssueAction={onAcceptIssueAction && message.proposedAction
                    ? () => void acceptIssueAction(message.proposedAction!)
                    : undefined}
                  onLoadAttachment={onLoadAttachment}
                  onReply={() =>
                    setActiveReplyMessageId((current) =>
                      current === message.id ? null : message.id,
                    )
                  }
                  parentMessage={parentMessage}
                  replyComposerId={replyComposerId}
                  actionProposalState={message.proposedAction
                    ? actionProposalStates[message.proposedAction.id]
                    : undefined}
                  reworkStageLabel={message.proposedAction?.type === "request_issue_rework"
                    ? localizeWorkflowStage(
                        t,
                        message.proposedAction.workflowStage,
                        run.workflow.stages.find(
                          (stage) =>
                            message.proposedAction?.type === "request_issue_rework" &&
                            stage.id === message.proposedAction.workflowStage,
                        )?.label ?? message.proposedAction.workflowStage,
                      )
                    : null}
                />
                <AgentReplyState state={agentReplyStates[message.id]} />
                {isReplying && (
                  <div
                    className="issue-inline-reply-composer"
                    id={replyComposerId}
                  >
                    <MessageComposer
                      autoFocus
                      compact
                      mentionMembers={mentionMembers}
                      onSubmit={(body, mentionedUserIds, attachments, references) =>
                        sendMessage(body, message.id, mentionedUserIds, attachments, references)
                      }
                      placeholder={t("run.threadPlaceholder")}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <MessageComposer
        mentionMembers={mentionMembers}
        onSubmit={(body, mentionedUserIds, attachments, references) =>
          sendMessage(body, null, mentionedUserIds, attachments, references)
        }
        placeholder={t("run.messagePlaceholder", { title: run.title })}
      />
    </section>
  );
}

function IssueMessageItem({
  isReplying = false,
  localeTag,
  message,
  onAcceptIssueAction,
  onLoadAttachment,
  onReply,
  parentMessage = null,
  replyComposerId,
  actionProposalState,
  reworkStageLabel,
}: {
  isReplying?: boolean;
  localeTag: string;
  message: IssueMessage;
  onAcceptIssueAction?: () => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onReply?: () => void;
  parentMessage?: IssueMessage | null;
  replyComposerId?: string;
  actionProposalState?: { accepting: boolean; error: string | null };
  reworkStageLabel?: string | null;
}) {
  const { t } = useI18n();
  const proposal = message.proposedAction;
  const proposalTitle = proposal?.type === "request_issue_update"
    ? t("run.issueUpdateProposalTitle")
    : proposal?.type === "request_issue_create"
      ? t("run.issueCreateProposalTitle")
      : t("run.reworkProposalTitle");
  const proposalAcceptLabel = proposal?.type === "request_issue_update"
    ? t("run.issueUpdateProposalAccept")
    : proposal?.type === "request_issue_create"
      ? t("run.issueCreateProposalAccept")
      : t("run.reworkProposalAccept");
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
        {parentMessage ? (
          <blockquote className="issue-message-parent-quote">
            <CornerUpLeft aria-hidden="true" size={13} />
            <span>{parentMessage.body}</span>
          </blockquote>
        ) : null}
        <div className="issue-message-body">
          <ReactMarkdown
            components={{
              img: ({ alt = "", src }) => (
                <IssueMarkdownImage
                  alt={alt}
                  attachments={message.attachments ?? []}
                  onLoadAttachment={onLoadAttachment}
                  src={src}
                />
              ),
            }}
            remarkPlugins={[remarkGfm]}
            skipHtml
            urlTransform={(url) =>
              issueAttachmentReference(url) ? url : defaultUrlTransform(url)
            }
          >
            {message.body}
          </ReactMarkdown>
        </div>
        {proposal ? (
          <section className="issue-rework-proposal">
            <header>
              <strong>{proposalTitle}</strong>
              {proposal.type === "request_issue_rework" ? (
                <small>
                  {t("run.reworkProposalStage", {
                    stage: reworkStageLabel ?? proposal.workflowStage,
                  })}
                </small>
              ) : proposal.type === "request_issue_create" ? (
                <small>
                  {t("run.issueProposalStatus", { status: proposal.issue.status })}
                </small>
              ) : null}
            </header>
            {proposal.type === "request_issue_rework" ? (
              <p>{proposal.reason}</p>
            ) : proposal.type === "request_issue_update" ? (
              <dl className="issue-action-proposal-fields">
                {proposal.changes.title !== undefined ? (
                  <div><dt>{t("run.issueProposalTitleField")}</dt><dd>{proposal.changes.title}</dd></div>
                ) : null}
                {proposal.changes.description !== undefined ? (
                  <div><dt>{t("run.issueProposalDescriptionField")}</dt><dd>{proposal.changes.description || t("run.issueProposalClearValue")}</dd></div>
                ) : null}
                {proposal.changes.priority !== undefined ? (
                  <div><dt>{t("run.issueProposalPriorityField")}</dt><dd>{proposal.changes.priority ? `P${proposal.changes.priority}` : t("run.issueProposalClearValue")}</dd></div>
                ) : null}
              </dl>
            ) : (
              <div className="issue-action-proposal-create">
                <strong>{proposal.issue.title}</strong>
                {proposal.issue.description ? <p>{proposal.issue.description}</p> : null}
                <small>
                  {t("run.issueProposalPriorityField")}: {proposal.issue.priority ? `P${proposal.issue.priority}` : t("run.issueProposalClearValue")}
                </small>
              </div>
            )}
            {proposal.status === "accepted" ? (
              <div className="issue-rework-proposal-accepted">
                <BadgeCheck aria-hidden="true" size={15} />
                {proposal.type === "request_issue_rework"
                  ? t("run.reworkProposalAccepted", {
                      revision: proposal.appliedRevision ?? "",
                    })
                  : proposal.type === "request_issue_create"
                    ? t("run.issueCreateProposalAccepted")
                    : t("run.issueUpdateProposalAccepted")}
              </div>
            ) : onAcceptIssueAction ? (
              <button
                className="issue-rework-proposal-accept"
                disabled={actionProposalState?.accepting}
                onClick={onAcceptIssueAction}
                type="button"
              >
                {actionProposalState?.accepting ? (
                  <LoaderCircle aria-hidden="true" className="spin" size={15} />
                ) : (
                  <Play aria-hidden="true" size={15} />
                )}
                {actionProposalState?.accepting
                  ? t("run.reworkProposalAccepting")
                  : proposalAcceptLabel}
              </button>
            ) : null}
            {actionProposalState?.error ? (
              <p className="issue-rework-proposal-error">
                <CircleAlert aria-hidden="true" size={14} />
                {actionProposalState.error}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
      {onReply && (
        <div
          aria-label={t("run.replyInThread")}
          className="issue-message-actions"
          role="toolbar"
        >
          <button
            aria-controls={replyComposerId}
            aria-expanded={isReplying}
            aria-label={t("run.replyInThread")}
            className="issue-reply-trigger"
            onClick={onReply}
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
  autoFocus = false,
  compact = false,
  mentionMembers,
  onSubmit,
  placeholder,
}: {
  autoFocus?: boolean;
  compact?: boolean;
  mentionMembers: OrganizationMember[];
  onSubmit: (
    body: string,
    mentionedUserIds: string[],
    attachments: File[],
    attachmentReferences: string[],
  ) => Promise<void>;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<
    Record<string, string>
  >({});
  const [attachments, setAttachments] = useState<
    Array<{ file: File; reference: string }>
  >([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const mentionListId = useId();
  const activeMention = issueMentionAtCaret(body, caret);
  const mentionSuggestions = activeMention
    ? [
        ...("briar".startsWith(activeMention.query.toLowerCase())
          ? [
              {
                handle: "briar",
                image: null,
                name: "Briar",
                userId: null,
              },
            ]
          : []),
        ...mentionMembers
          .map((member) => ({
            handle: issueMentionHandle(member),
            image: member.image,
            name: member.name,
            userId: member.userId,
          }))
          .filter((member) =>
            member.handle.startsWith(activeMention.query.toLowerCase()),
          ),
      ]
    : [];
  const showsMentionSuggestion =
    composerFocused &&
    !mentionDismissed &&
    activeMention !== null &&
    mentionSuggestions.length > 0;
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const textBody = body.trim();
    if ((!textBody && attachments.length === 0) || sending) return;
    const attachmentMarkdown = attachments
      .map(({ file, reference }) =>
        issueAttachmentMarkdown(reference, file.name),
      )
      .join("\n\n");
    const nextBody = [textBody, attachmentMarkdown].filter(Boolean).join("\n\n");
    const nextMentionedUserIds = Object.entries(selectedMentions)
      .filter(([, handle]) => mentionsIssueHandle(nextBody, handle))
      .map(([userId]) => userId);
    const previousMentions = selectedMentions;
    const previousAttachments = attachments;
    setSending(true);
    setError(null);
    setBody("");
    setCaret(0);
    setMentionDismissed(false);
    setSelectedMentions({});
    setAttachments([]);
    try {
      await onSubmit(
        nextBody,
        nextMentionedUserIds,
        previousAttachments.map(({ file }) => file),
        previousAttachments.map(({ reference }) => reference),
      );
    } catch (caught) {
      setBody(nextBody);
      setCaret(nextBody.length);
      setSelectedMentions(previousMentions);
      setAttachments(previousAttachments);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  };
  const addImages = (selected: File[]) => {
    if (selected.length === 0) return;
    const normalized = selected.map(normalizeIssueAttachmentFile);
    if (normalized.some((file) => !file.type.startsWith("image/"))) {
      setError("대화에는 이미지만 첨부할 수 있습니다.");
      return;
    }
    const next = [
      ...attachments,
      ...normalized.map((file) => ({ file, reference: crypto.randomUUID() })),
    ];
    const validationError = validateIssueAttachments(
      next.map(({ file }) => file),
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    setAttachments(next);
    setError(null);
  };
  const completeMention = (suggestion: (typeof mentionSuggestions)[number]) => {
    const textarea = textareaRef.current;
    if (!textarea || !activeMention) return;
    const insertedMention = `@${suggestion.handle} `;
    const nextBody = `${body.slice(
      0,
      activeMention.start,
    )}${insertedMention}${body.slice(activeMention.end)}`;
    const nextCaret = activeMention.start + insertedMention.length;
    setBody(nextBody);
    setCaret(nextCaret);
    setMentionDismissed(false);
    if (suggestion.userId) {
      const userId = suggestion.userId;
      setSelectedMentions((current) => ({
        ...current,
        [userId]: suggestion.handle,
      }));
    }
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
      onDragOver={(event) => {
        if (dataTransferHasFiles(event.dataTransfer)) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        addImages(filesFromDataTransfer(event.dataTransfer));
      }}
      onSubmit={(event) => void submit(event)}
    >
      {showsMentionSuggestion && (
        <div
          aria-label={t("run.mention")}
          className="issue-composer-mention-menu"
          id={mentionListId}
          role="listbox"
        >
          {mentionSuggestions.map((suggestion, index) => (
            <button
              aria-selected={index === 0}
              key={suggestion.userId ?? "briar"}
              onClick={() => completeMention(suggestion)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span aria-hidden="true">
                {suggestion.userId ? (
                  suggestion.image ? (
                    <img alt="" src={suggestion.image} />
                  ) : (
                    suggestion.name.trim().charAt(0).toUpperCase() || "?"
                  )
                ) : (
                  <Bot size={14} />
                )}
              </span>
              <strong>@{suggestion.handle}</strong>
              {suggestion.userId ? <small>{suggestion.name}</small> : null}
            </button>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="issue-composer-attachments">
          {attachments.map(({ file, reference }) => (
            <MessageAttachmentPreview
              file={file}
              key={reference}
              onRemove={() =>
                setAttachments((current) =>
                  current.filter((attachment) =>
                    attachment.reference !== reference,
                  ),
                )
              }
            />
          ))}
        </div>
      )}
      <textarea
        autoFocus={autoFocus}
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
            completeMention(mentionSuggestions[0]);
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
        onPaste={(event) => {
          const images = filesFromDataTransfer(event.clipboardData).filter(
            (file) => file.type.startsWith("image/"),
          );
          if (images.length === 0) return;
          event.preventDefault();
          addImages(images);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        placeholder={placeholder}
        ref={textareaRef}
        rows={2}
        value={body}
      />
      <footer>
        <button
          aria-label={t("issue.attachmentLabel")}
          className="issue-composer-link"
          disabled={sending || attachments.length >= maxIssueAttachmentCount}
          onClick={() => attachmentInputRef.current?.click()}
          type="button"
        >
          <Paperclip size={18} />
        </button>
        <input
          accept="image/*"
          className="issue-composer-file-input"
          disabled={sending || attachments.length >= maxIssueAttachmentCount}
          multiple
          onChange={(event) => {
            addImages(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
          ref={attachmentInputRef}
          type="file"
        />
        <button
          aria-label={sending ? t("run.sendingMessage") : t("run.sendMessage")}
          className="issue-message-send"
          disabled={(!body.trim() && attachments.length === 0) || sending}
          type="submit"
        >
          {sending ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ArrowUp size={19} strokeWidth={2.2} />
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

function MessageAttachmentPreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [source, setSource] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <div className="issue-composer-attachment">
      {source ? <img alt="" src={source} /> : null}
      <span>{file.name}</span>
      <button aria-label={`Remove ${file.name}`} onClick={onRemove} type="button">
        <X aria-hidden="true" size={13} />
      </button>
    </div>
  );
}

function IssueMarkdownImage({
  alt,
  attachments,
  onLoadAttachment,
  src,
}: {
  alt: string;
  attachments: IssueAttachment[];
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  src?: string;
}) {
  const { t } = useI18n();
  const reference = issueAttachmentReference(src);
  const attachment = reference
    ? attachments.find((candidate) => candidate.id === reference) ?? null
    : null;
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!reference || !attachment) return;
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
  }, [attachment?.url, onLoadAttachment, reference]);

  if (!reference) {
    return src ? <img alt={alt} loading="lazy" src={src} /> : null;
  }
  if (!attachment || failed) {
    return (
      <span className="issue-markdown-image-state" role="img" aria-label={alt}>
        <CircleAlert aria-hidden="true" size={16} />
        {failed ? t("run.loadFailed") : alt}
      </span>
    );
  }
  if (!source) {
    return (
      <span className="issue-markdown-image-state" role="img" aria-label={alt}>
        <LoaderCircle aria-hidden="true" className="spin" size={16} />
        {alt}
      </span>
    );
  }
  return <img alt={alt || attachment.filename} loading="lazy" src={source} />;
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
  }, [attachment.url, onLoadAttachment]);
  const isImage = isIssueAttachmentImage(
    attachment.contentType,
    attachment.filename,
  );
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
    status: status as HuntRunPlacement["status"],
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

function hasResultReviews(run: Pick<HuntRun, "resultReviews">) {
  return (run.resultReviews?.length ?? 0) > 0;
}

function RunStatusPill({
  as = "i",
  label,
  reviewed = false,
  status,
  tone,
}: {
  as?: "i" | "span";
  label: string;
  reviewed?: boolean;
  status: HuntRun["status"];
  tone: string;
}) {
  const { t } = useI18n();
  const Tag = as;
  return (
    <Tag
      aria-label={reviewed ? `${label} · ${t("run.resultReviewed")}` : undefined}
      className={`status-pill ${tone}${reviewed ? " reviewed" : ""}`}
      title={reviewed ? t("run.resultReviewed") : undefined}
    >
      {status === "running" && <LoaderCircle className="spin" size={11} />}
      {reviewed && (
        <BadgeCheck
          aria-hidden="true"
          className="status-pill-review-icon"
          size={11}
        />
      )}
      {label}
    </Tag>
  );
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
