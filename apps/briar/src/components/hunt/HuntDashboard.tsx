import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { FolderGit2, FolderInput, Plus, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState, MainContent } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { CompanionBottomNavigation, type CompanionStatusFilter } from "@/components/CompanionBottomNavigation";
import { inboxIssueMessageVersion } from "@/state/inbox/model";
import { AppKeyboardCommandBoundary, useAppKeyboardCommandScope } from "@/hooks/appKeyboardCommands";
import { useMobileBackHandler } from "@/hooks/useMobileNavigation";
import { errorDiagnosticOccurrenceKey, errorDiagnosticsForMessage } from "@/lib/error-diagnostics";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { type IssueDetailTab } from "@/lib/issue-detail-tab";
import type { AgentSkillExecutionApprovalInput, AgentSkillExecutionProposal, CreateIssueInput, HuntEvent, HuntRun, HuntRunPlacement, IssueAttachment, IssueMessage, IssueMessageSendResult, IssueProposedAction, IssueExecutionApprovalInput, IssueExecutionProposal, IssueExecutionPreferences, PlanningProject, Project, ProjectAgent, RelatedMessageReference, RunEvidence, RunEvidenceImage, UpdateIssueInput } from "@/types";
import { sortAgentProviders, type AgentProvider } from "@/lib/team-llm";
import {
  boardLoadedAtom,
  boardRunAtom,
  boardRunKey,
  boardScopedRunIdsAtom,
  resetBoardPropertyFilters,
  resetBoardViewState,
} from "@/state/board/atoms";
import {
  runAgentAssociationAtom,
  runAssignedWorkerAtom,
} from "@/state/board/run-facts";
import { useBoardSources } from "@/state/board/useBoardSources";
import { teamMembersAtom } from "@/state/entities/members";
import { teamOrganizationProvidersAtom } from "@/state/entities/providers";
import { teamRunsAtom } from "@/state/entities/runs";
import { teamEntityAtom } from "@/state/entities/teams";
import { teamWorkersAtom } from "@/state/entities/workers";
import { companionStatusAtom } from "@/state/navigation/atoms";
import { useRegistry } from "@/state/registry";
import {
  activeTeamIdAtom,
  teamExecutionPolicyAtom,
  teamNotificationsAtom,
  teamSettingsAtom,
} from "@/state/team/atoms";
import { useI18n } from "@/i18n";
import { CompanionTaskBoard } from "./board/CompanionTaskBoard";
import type { BoardHandlers } from "./board/context";
import { BoardCreateIssueButton, HuntBoard } from "./board/HuntBoard";
import { CreateIssueDialog } from "./editor/CreateIssueDialog";
import { EditIssueDialog } from "./editor/EditIssueDialog";

/*
  The issues page: a board, an open issue, and the dialogs both need.

  It used to take the whole `DashboardPayload` and build the board out of it —
  filtering, kanban columns, agent associations and counts over a `HuntRun[]` —
  which is why one issue changing re-rendered everything below it. The runs are
  gone from this file. What it reads from the store are the parts a run edit
  cannot move (the team, its settings, members, workers, providers) plus the one
  run it has open; the board underneath draws itself from ids.
*/

// The issue detail page pulls the whole markdown rendering stack, so it loads
// from its own chunk the first time an issue is opened.
const RunPage = lazy(() => import("./detail/RunPage").then(m => ({
  default: m.RunPage
})));
const runPageFallback = <div className="lazy-view-placeholder h-full w-full" />;
function runIdFromCreateIssueResult(value: unknown) {
  if (typeof value !== "object" || value === null || !("runId" in value) || typeof value.runId !== "string") {
    return null;
  }
  return value.runId;
}

function HuntDashboardContent({
  agents = [],
  companionMode = false,
  companionUnreadDmCount = 0,
  companionUnreadInboxCount = 0,
  conversationInboxSyncSignal,
  currentUserId = null,
  createIssueDefaultProjectId,
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
  issueProjects = [],
  onIssueDialogOpenChange,
  onDeleteIssue,
  onTransferIssue,
  onMoveIssueProject,
  onAddIssueDependency,
  onAddRelatedIssue,
  onAcceptIssueAction,
  onAcceptIssueExecution,
  onAcceptSkillExecution,
  onRemoveIssueDependency,
  onRemoveRelatedIssue,
  onSetIssueParent,
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
  token = null
}: {
  agents?: ProjectAgent[];
  companionMode?: boolean;
  companionUnreadDmCount?: number;
  companionUnreadInboxCount?: number;
  conversationInboxSyncSignal?: string;
  currentUserId?: string | null;
  createIssueDefaultProjectId?: string | null;
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
  issueProjects?: PlanningProject[];
  onIssueDialogOpenChange?: (isOpen: boolean) => void;
  onDeleteIssue: (runId: string) => Promise<unknown>;
  onTransferIssue?: (runId: string, targetProjectId: string) => Promise<unknown>;
  onMoveIssueProject?: (
    runId: string,
    sourceProjectId: string,
    targetProjectId: string,
  ) => Promise<unknown>;
  onAddIssueDependency?: (dependentRunId: string, prerequisiteRunId: string) => Promise<unknown>;
  onAddRelatedIssue?: (runId: string, relatedRunId: string) => Promise<unknown>;
  onAcceptIssueAction?: (runId: string, proposal: IssueProposedAction) => Promise<IssueProposedAction>;
  onAcceptIssueExecution?: (runId: string, proposal: IssueExecutionProposal, input: IssueExecutionApprovalInput) => Promise<IssueExecutionProposal>;
  onAcceptSkillExecution?: (runId: string, proposal: AgentSkillExecutionProposal, input: AgentSkillExecutionApprovalInput) => Promise<AgentSkillExecutionProposal>;
  onRemoveIssueDependency?: (dependentRunId: string, prerequisiteRunId: string) => Promise<unknown>;
  onRemoveRelatedIssue?: (runId: string, relatedRunId: string) => Promise<unknown>;
  onSetIssueParent?: (childRunId: string, parentRunId: string | null) => Promise<unknown>;
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
  token?: string | null;
}) {
  const {
    t
  } = useI18n();
  const {
    toast
  } = useToast();
  const registry = useRegistry();
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  /*
    `Atom.family` needs a key even when no team is selected. The empty string is
    a team nothing ever wrote, so every family below reads as "not loaded" and
    subscribes to nothing that moves.
  */
  const teamId = activeTeamId ?? "";
  const team = useAtomValue(teamEntityAtom(teamId));
  const settings = useAtomValue(teamSettingsAtom(teamId));
  const members = useAtomValue(teamMembersAtom(teamId));
  const workers = useAtomValue(teamWorkersAtom(teamId));
  const organizationProviders = useAtomValue(teamOrganizationProvidersAtom(teamId));
  const executionPolicy = useAtomValue(teamExecutionPolicyAtom(teamId));
  const notifications = useAtomValue(teamNotificationsAtom(teamId));
  const dashboardLoaded = useAtomValue(boardLoadedAtom(teamId));
  const scopedRunIds = useAtomValue(boardScopedRunIdsAtom(teamId));
  const companionStatus = useAtomValue(companionStatusAtom);
  const setCompanionStatus = useAtomSet(companionStatusAtom);
  useBoardSources(agents);

  const [internalSelectedRunId, setInternalSelectedRunId] = useState<string | null>(null);
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
  const [createIssueParentRunId, setCreateIssueParentRunId] = useState<string | null>(null);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [transferringRunFromMenuId, setTransferringRunFromMenuId] = useState<string | null>(null);
  const [transferTargetProjectId, setTransferTargetProjectId] = useState("");
  const [contextTransferError, setContextTransferError] = useState<string | null>(null);
  const [deletingRunFromMenuId, setDeletingRunFromMenuId] = useState<string | null>(null);
  const [contextDeleteError, setContextDeleteError] = useState<string | null>(null);
  const kanbanScrollLeftRef = useRef<number | null>(null);

  /*
    Four run lookups, one per thing that can be open. A closed dialog reads the
    run of the empty id, which is the same `null` for every run in the store, so
    nothing here hears about an edit while the board is the only thing on screen.
  */
  const selected = useAtomValue(boardRunAtom(boardRunKey(teamId, selectedRunId ?? "")));
  const editingRun = useAtomValue(boardRunAtom(boardRunKey(teamId, editingRunId ?? "")));
  const deletingRunFromMenu = useAtomValue(boardRunAtom(boardRunKey(teamId, deletingRunFromMenuId ?? "")));
  const transferringRunFromMenu = useAtomValue(boardRunAtom(boardRunKey(teamId, transferringRunFromMenuId ?? "")));
  const selectedAgents = useAtomValue(runAgentAssociationAtom(boardRunKey(teamId, selectedRunId ?? "")));
  const selectedWorker = useAtomValue(runAssignedWorkerAtom(boardRunKey(teamId, selectedRunId ?? "")));
  /*
    The issue detail's pickers list every run of the team. Keyed on the empty
    team while the board is up, so the run list only reaches this component once
    an issue is open — which is exactly when the board is not rendered.
  */
  const availableRuns = useAtomValue(teamRunsAtom(selected ? teamId : ""));

  const setIsIssueDialogOpen = useCallback((isOpen: boolean) => {
    setInternalIsIssueDialogOpen(isOpen);
    onIssueDialogOpenChange?.(isOpen);
  }, [onIssueDialogOpenChange]);
  const openCreateIssueDialog = useCallback((placement: HuntRunPlacement | null = null) => {
    setCreateIssuePlacement(placement);
    setCreateIssueParentRunId(null);
    setIsIssueDialogOpen(true);
  }, [setIsIssueDialogOpen]);
  const openCreateSubIssueDialog = useCallback((parentRunId: string) => {
    setCreateIssuePlacement(null);
    setCreateIssueParentRunId(parentRunId);
    setIsIssueDialogOpen(true);
  }, [setIsIssueDialogOpen]);
  const openRun = useCallback((runId: string | null) => {
    setSelectedRunMessageId(null);
    setSelectedRunInitialTab(null);
    setSelectedRunId(runId);
  }, [setSelectedRunId]);

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
      setCreateIssuePlacement(null);
      setCreateIssueParentRunId(null);
      setIsIssueDialogOpen(false);
      return true;
    }
    if (selectedRunId) {
      openRun(null);
      return true;
    }
    return false;
  }, {
    enabled: companionMode,
    priority: 100
  });
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
  /*
    The board's view state is in atoms now, and this page is what scopes it.
    Mounting puts it back to its defaults, which is what unmounting the page did
    to the `useState` it replaced, and a team switch clears the property filters
    exactly as the effect keyed on the team id used to.
  */
  useEffect(() => {
    resetBoardViewState(registry);
  }, [registry]);
  useEffect(() => {
    resetBoardPropertyFilters(registry);
  }, [activeTeamId, registry]);

  const issuesLoading = !dashboardLoaded && !noProject && !error && !recoveryError;
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
  const selectedInboxVersion = selected ? [inboxIssueMessageVersion(selected), ...(notifications.conversation ?? []).filter(notification => notification.runId === selected.id).map(notification => notification.id).sort()].join(":") : null;
  const transferDestinationProjects = useMemo(() => {
    if (!team) return [];
    return projects.filter(project => project.id !== team.id && (!team.organizationId || project.organizationId === team.organizationId));
  }, [projects, team]);
  const transferDestinationOptions = useMemo(() => {
    const sourcePlanningProjectId = transferringRunFromMenu?.projectId;
    const planningOptions = team
      ? issueProjects
        .filter((project) =>
          project.teamId === team.id &&
          project.id !== sourcePlanningProjectId &&
          project.status !== "cancelled")
        .map((project) => ({
          label: `${project.name} · ${t("sidebar.projects")}`,
          value: `planning:${project.id}`,
        }))
      : [];
    return [
      ...planningOptions,
      ...transferDestinationProjects.map((project) => ({
        label: `${project.name} · ${t("sidebar.teams")}`,
        value: `team:${project.id}`,
      })),
    ];
  }, [
    issueProjects,
    team,
    transferDestinationProjects,
    transferringRunFromMenu?.projectId,
    t,
  ]);
  const availableProviders = useMemo<AgentProvider[]>(() => {
    if (organizationProviders?.length) {
      return sortAgentProviders(organizationProviders);
    }
    return sortAgentProviders([...new Set((workers ?? []).flatMap(worker => worker.providers))]);
  }, [organizationProviders, workers]);
  useEffect(() => {
    openRun(null);
  }, [issueListRequestKey]);
  useEffect(() => {
    if (!requestedRunId) return;
    if (!scopedRunIds.includes(requestedRunId)) return;
    setSelectedRunMessageId(requestedRunMessageId);
    setSelectedRunInitialTab(requestedRunInitialTab);
    setSelectedRunId(requestedRunId);
    onRequestedRunOpen?.();
  }, [onRequestedRunOpen, requestedRunId, requestedRunInitialTab, requestedRunMessageId, scopedRunIds]);
  useEffect(() => {
    if (!selected || !selectedInboxVersion) return;
    onIssueViewed?.(selected.id);
  }, [onIssueViewed, selected?.id, selectedInboxVersion]);

  const selectableIssueProjects = issueProjects.length > 0
    ? team
      ? issueProjects.filter(project => project.teamId === team.id)
      : issueProjects
    : (projects.length > 0 ? projects : team ? [team] : [])
      .map(project => ({ ...project, teamId: project.id, isDefault: true }));
  const defaultIssueProjectId = selectableIssueProjects.some(
    project => project.id === createIssueDefaultProjectId,
  )
    ? createIssueDefaultProjectId
    : selectableIssueProjects.find(project => project.isDefault)?.id ??
      selectableIssueProjects[0]?.id;
  const createIssueDialog = isIssueDialogOpen ? <CreateIssueDialog availableProviders={availableProviders} compactHeader={companionMode} currentUserId={currentUserId} defaultProjectId={defaultIssueProjectId ?? undefined} defaultStatus={createIssuePlacement?.status === "backlog" ? "backlog" : "queued"} isSubmitting={isCreatingIssue} onClose={() => {
    setCreateIssuePlacement(null);
    setCreateIssueParentRunId(null);
    setIsIssueDialogOpen(false);
  }} onCreate={async (projectId, input) => {
    const created = await onCreateIssue(projectId, {
      ...input,
      parentRunId: createIssueParentRunId,
    });
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
    setCreateIssueParentRunId(null);
    setIsIssueDialogOpen(false);
  }} projects={selectableIssueProjects} members={members ?? []} workflow={settings ? {
    ...settings.workflow,
    execution: {
      checkpoints: settings.checkpointPolicy?.effective ?? settings.workflow.execution.checkpoints
    }
  } : undefined} workflowTeamId={team?.id} /> : null;

  /*
    One handler bundle for every row on the board. Each takes the run it acts on
    instead of closing over it, so the bundle's identity survives a run edit and
    the memoised rows below keep their props.
  */
  const boardHandlers = useMemo<BoardHandlers>(() => ({
    changeCheckpoints: (run, checkpoints) => {
      void onUpdateIssueCheckpoints(run.id, checkpoints).catch(() => undefined);
    },
    changePreferences: (run, preferences) => {
      void onUpdateIssuePreferences(run.id, preferences).catch(() => undefined);
    },
    changePriority: (run, priority) => {
      void onUpdateIssue(run.id, {
        title: run.title,
        description: run.issueDescription,
        priority,
        difficulty: run.difficulty,
        attachments: []
      }).catch(() => undefined);
    },
    changeProject: onMoveIssueProject
      ? (run, targetProjectId) => {
        if (!run.projectId || run.projectId === targetProjectId) return;
        void onMoveIssueProject(run.id, run.projectId, targetProjectId).catch(() => undefined);
      }
      : undefined,
    changeTeam: onTransferIssue
      ? (run, targetTeamId) => {
        setContextTransferError(null);
        setTransferTargetProjectId(`team:${targetTeamId}`);
        setTransferringRunFromMenuId(run.id);
      }
      : undefined,
    createInColumn: openCreateIssueDialog,
    edit: (run) => setEditingRunId(run.id),
    move: (run, placement) => {
      void onMoveRun(run.id, placement).catch(() => undefined);
    },
    open: (run) => openRun(run.id),
    openById: (runId) => openRun(runId),
    processNow: onProcessIssueNow,
    remove: (run) => {
      setContextDeleteError(null);
      setDeletingRunFromMenuId(run.id);
    },
    transfer: onTransferIssue
      ? (run) => {
        setContextTransferError(null);
        setTransferTargetProjectId("");
        setTransferringRunFromMenuId(run.id);
      }
      : undefined,
  }), [
    onMoveIssueProject,
    onMoveRun,
    onProcessIssueNow,
    onTransferIssue,
    onUpdateIssue,
    onUpdateIssueCheckpoints,
    onUpdateIssuePreferences,
    openCreateIssueDialog,
    openRun,
  ]);

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
    return <Suspense fallback={runPageFallback}>
      <RunPage assignedWorker={selectedWorker} companionMode={companionMode} conversationInboxSyncSignal={conversationInboxSyncSignal} highlightedMessageId={selectedRunMessageId} initialDetailTab={selectedRunInitialTab ?? undefined} issueKeyPrefix={team?.issueKeyPrefix} currentUserId={currentUserId} error={displayedError} showErrorToast={false} isDeletingIssue={deletingIssueId === selected.id} isRecovering={recoveringRunId === selected.id} isUpdatingIssue={updatingIssueId === selected.id} isSidebarOpen={isSidebarOpen} issueProjects={issueProjects.filter(project => project.teamId === team?.id && project.status !== "cancelled")} onBack={() => openRun(null)} onCancel={() => onCancelRun(selected.id)} onDelete={async () => {
        await onDeleteIssue(selected.id);
        openRun(null);
      }} onTransfer={onTransferIssue ? async targetProjectId => {
        await onTransferIssue(selected.id, targetProjectId);
        openRun(null);
      } : undefined} transferProjects={transferDestinationProjects} teams={projects} currentTeam={team} onAddDependency={onAddIssueDependency ? prerequisiteRunId => onAddIssueDependency(selected.id, prerequisiteRunId) : undefined} onAddRelated={onAddRelatedIssue ? relatedRunId => onAddRelatedIssue(selected.id, relatedRunId) : undefined} onCreateSubIssue={() => openCreateSubIssueDialog(selected.id)} onLinkSubIssue={onSetIssueParent ? childRunId => onSetIssueParent(childRunId, selected.id) : undefined} onSetParent={onSetIssueParent ? parentRunId => onSetIssueParent(selected.id, parentRunId) : undefined} onUnlinkSubIssue={onSetIssueParent ? childRunId => onSetIssueParent(childRunId, null) : undefined} onAcceptIssueAction={onAcceptIssueAction ? proposal => onAcceptIssueAction(selected.id, proposal) : undefined} onAcceptIssueExecution={onAcceptIssueExecution ? (proposal, input) => onAcceptIssueExecution(selected.id, proposal, input) : undefined} onAcceptSkillExecution={onAcceptSkillExecution ? (proposal, input) => onAcceptSkillExecution(selected.id, proposal, input) : undefined} onRemoveDependency={onRemoveIssueDependency ? prerequisiteRunId => onRemoveIssueDependency(selected.id, prerequisiteRunId) : undefined} onRemoveRelated={onRemoveRelatedIssue ? relatedRunId => onRemoveRelatedIssue(selected.id, relatedRunId) : undefined} onRelatedMessageOpen={onRelatedMessageOpen} onDependencyOpen={runId => openRun(runId)} onLoadAttachment={onLoadAttachment} onLoadIssueMessages={() => onLoadIssueMessages(selected.id)} onLoadRunEvents={() => onLoadRunEvents(selected.id)} onLoadRunEvidence={() => onLoadRunEvidence(selected.id)} onLoadRunEvidenceImage={onLoadRunEvidenceImage} onViewingIssueConversationChange={onViewingIssueConversationChange} onCompleteResultReview={onCompleteResultReview ? () => onCompleteResultReview(selected.id) : undefined} mentionMembers={members ?? []} mentionAgents={agents.filter(agent => agent.teamId === team?.id)} onMove={placement => onMoveRun(selected.id, placement)} onMoveIssueProject={onMoveIssueProject && selected.projectId ? targetProjectId => onMoveIssueProject(selected.id, selected.projectId!, targetProjectId) : undefined} onProcessNow={onProcessIssueNow ? () => onProcessIssueNow(selected) : undefined} onRetry={() => onRetryRun(selected.id)} onRework={onReworkRun ? input => onReworkRun(selected.id, input) : undefined} onResume={() => onResumeRun(selected.id)} onSendIssueMessage={input => onSendIssueMessage(selected.id, input)} onEditIssueMessage={(messageId, input) => onEditIssueMessage(selected.id, messageId, input)} onDeleteIssueMessage={messageId => onDeleteIssueMessage(selected.id, messageId)} onUpdateIssue={input => onUpdateIssue(selected.id, input)} onUpdateIssueCheckpoints={checkpoints => onUpdateIssueCheckpoints(selected.id, checkpoints)} onUpdateIssuePreferences={input => onUpdateIssuePreferences(selected.id, input)} onUpdateIssueSubscription={onUpdateIssueSubscription ? subscribed => onUpdateIssueSubscription(selected.id, subscribed) : undefined} availableProviders={availableProviders} executionPolicy={executionPolicy ?? undefined} executionWorkers={workers ?? []} performedAgentName={selectedAgents.performed?.name ?? null} performedAgentProvider={selectedAgents.performed?.provider ?? null} performedAgentModel={selectedAgents.performed?.model ?? null} organizationId={team?.organizationId ?? ""} projectId={team?.id ?? ""} run={selected} isProcessing={processingIssueIds.has(selected.id)} availableRuns={availableRuns ?? []} token={token} />
        {createIssueDialog}
      </Suspense>;
  }
  return <MainContent id="issues">
      {!companionMode ? <HuntBoard
        agents={agents}
        availableProviders={availableProviders}
        currentUserId={currentUserId}
        deletingIssueId={deletingIssueId}
        handlers={boardHandlers}
        headerTrailing={<BoardCreateIssueButton onCreate={() => openCreateIssueDialog()} />}
        isLoading={issuesLoading}
        isSidebarOpen={isSidebarOpen}
        issueKeyPrefix={team?.issueKeyPrefix}
        members={members ?? []}
        planningProjects={issueProjects}
        processingIssueIds={processingIssueIds}
        recoveringRunId={recoveringRunId}
        scrollLeftRef={kanbanScrollLeftRef}
        teamId={teamId}
        teams={projects}
        token={token}
        updatingIssueId={updatingIssueId}
      /> : null}
      {companionMode ? <CompanionTaskBoard
        availableProviders={availableProviders}
        deletingIssueId={deletingIssueId}
        handlers={boardHandlers}
        isLoading={issuesLoading}
        issueKeyPrefix={team?.issueKeyPrefix}
        planningProjects={issueProjects}
        processingIssueIds={processingIssueIds}
        recoveringRunId={recoveringRunId}
        scrollLeftRef={kanbanScrollLeftRef}
        teamId={teamId}
        teams={projects}
        token={token}
        updatingIssueId={updatingIssueId}
      /> : null}
      {companionMode && <CompanionBottomNavigation activeDestination={companionStatus} onCreate={() => setIsIssueDialogOpen(true)} onDmsOpen={() => onCompanionDmsOpen?.()} onInboxOpen={() => onCompanionInboxOpen?.()} onHomeOpen={() => onCompanionHomeOpen?.()} onStatusChange={onCompanionStatusChange ?? setCompanionStatus} unreadDmCount={companionUnreadDmCount} unreadInboxCount={companionUnreadInboxCount} workers={workers ?? []} />}
      {createIssueDialog}
      {editingRun && <EditIssueDialog isSubmitting={updatingIssueId === editingRun.id} onClose={() => setEditingRunId(null)} onLoadAttachment={onLoadAttachment} onUpdate={async input => {
      await onUpdateIssue(editingRun.id, input);
      setEditingRunId(null);
    }} run={editingRun} members={members ?? []} />}
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
          {transferDestinationOptions.length === 0 ? <p className="text-sm text-muted-foreground">
              {t("issue.transferNoProjects")}
            </p> : <NativeSelect disabled={Boolean(deletingIssueId)} label={t("issue.transferTarget")} onValueChange={setTransferTargetProjectId} options={transferDestinationOptions} placeholder={t("issue.transferTargetPlaceholder")} value={transferTargetProjectId} />}
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
            <Button disabled={Boolean(deletingIssueId) || !transferTargetProjectId || transferDestinationOptions.length === 0} onClick={() => {
            if (!transferringRunFromMenu) return;
            setContextTransferError(null);
            const [scope, targetId] = transferTargetProjectId.split(":", 2);
            const move = scope === "planning" && transferringRunFromMenu.projectId && onMoveIssueProject
              ? onMoveIssueProject(
                transferringRunFromMenu.id,
                transferringRunFromMenu.projectId,
                targetId,
              )
              : scope === "team" && onTransferIssue
                ? onTransferIssue(transferringRunFromMenu.id, targetId)
                : Promise.reject(new Error("이슈 이동 기능을 사용할 수 없습니다."));
            void move.then(() => {
              setTransferringRunFromMenuId(null);
              if (selectedRunId === transferringRunFromMenu.id) {
                openRun(null);
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

export function HuntDashboard(
  props: ComponentProps<typeof HuntDashboardContent>,
) {
  return (
    <AppKeyboardCommandBoundary>
      <HuntDashboardContent {...props} />
    </AppKeyboardCommandBoundary>
  );
}
