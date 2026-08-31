import { Activity, ArrowLeft, ArrowUp, BadgeCheck, Bot, BrainCircuit, Check, ChevronRight, CircleAlert, Clock3, Columns3, FolderGit2, FolderInput, Gauge, GitCommitHorizontal, GitFork, GitPullRequest, Image as ImageIcon, ListChecks, Maximize2, MessageSquare, Play, RefreshCw, RotateCcw, Signal, Trash2, UserRound, Waypoints, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { MainContent } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { ProviderSelect } from "@/components/ProviderSelect";
import { SelectMenu } from "@/components/SelectMenu";
import { AgentProviderIcon } from "@/components/AgentIcons";
import { MarkdownContent, defaultMarkdownUrlTransform } from "@/components/MarkdownContent";
import { WorkerIcon } from "@/components/WorkerIcon";
import { useMobileBackHandler } from "@/hooks/useMobileNavigation";
import { useProjectAgentWorkerEvents } from "@/hooks/useProjectAgentWorkerEvents";
import { useHorizontalPaneResize } from "@/hooks/useHorizontalPaneResize";
import { errorDiagnosticOccurrenceKey, errorDiagnosticsForMessage } from "@/lib/error-diagnostics";
import { agentMessagesFromAppServerEvents } from "@/lib/auto-hunt-agent";
import { eventMeta, runMeta } from "@/lib/stages";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { formatExecutionDuration, formatExecutionTokens } from "@/lib/agent-execution-metrics";
import { issueTitleInputMaxLength, isIssueTitleWithinLimit } from "@/lib/issue-title";
import { isKeyboardShortcutEditableTarget, keyboardShortcutEventIsComposing } from "@/lib/keyboard-shortcuts";
import { defaultIssueDetailTab, type IssueDetailTab } from "@/lib/issue-detail-tab";
import { issueAttachmentReference, issueAttachmentReferences, removeIssueAttachmentMarkdown } from "@/lib/issue-markdown";
import { clampConversationPaneWidth, conversationPaneWidthDefault, conversationPaneWidthMax, conversationPaneWidthMin, loadConversationPaneWidth, saveConversationPaneWidth } from "@/lib/conversation-pane-width";
import { loadRunCostEstimate } from "@/lib/api";
import { copyIssueId, copyIssueShareLink, shareIssueLink } from "@/lib/issue-links";
import { formatIssueKey } from "@/lib/issue-key";
import type { AgentSkillExecutionApprovalInput, AgentSkillExecutionProposal, AgentExecutionCostEstimate, ExecutionWorker, HuntEvent, HuntRun, HuntRunPlacement, IssueAttachment, IssueMessage, IssueMessageSendResult, IssueProposedAction, IssueExecutionApprovalInput, IssueExecutionProposal, IssueExecutionPreferences, OrganizationMember, PlanningProject, Project, ProjectAgent, ProjectExecutionWorkerPolicy, RelatedMessageReference, RunEvidence, RunEvidenceImage, UpdateIssueInput } from "@/types";
import { agentEffortOptions, agentModelDisplayName, agentModelOptions, agentProviderLabels, type AgentProvider, type ModelEffort } from "@/lib/project-llm";
import { useAgentProviderModels } from "@/hooks/useAgentProviderModels";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { pullRequestDisplayName } from "../board/PullRequestIconLink";
import { IssueAttachmentGallery } from "../conversation/IssueAttachmentGallery";
import { IssueConversation } from "../conversation/IssueConversation";
import { IssueMarkdownImage } from "../conversation/IssueMarkdownImage";
import { issueConversationTabBreakpoint } from "../conversation/model";
import { IssueActionsMenu } from "./IssueActionsMenu";
import { IssueAgentActivityPanel } from "./IssueAgentActivityPanel";
import { IssueAssigneeAvatar } from "./IssueAssigneeAvatar";
import { IssueDependenciesPanel } from "./IssueDependenciesPanel";
import { IssueDifficultyIcon } from "../IssueDifficultyIcon";
import { IssueStatusHistoryPanel } from "./IssueStatusHistoryPanel";
import { IssueWorkflowProgress } from "./IssueWorkflowProgress";
import { RunStatusPill } from "./RunStatusPill";
import { ProjectIcon } from "../../ProjectIcon";
import { DraftIssueDescriptionEditor } from "../editor/DraftIssueDescriptionEditor";
import { formatDate, formatExecutionUsdTicks, formatRatePerMillion, localizeEvent, localizeStatus, localizeWorkflowStage, relativeTime } from "../model/formatters";
import { placementForId, placementIdForRun, placementMatchesRun } from "../model/kanban";
import { IssueResultReviewers } from "../results/IssueResultReviewers";
import { RunEvidencePanel } from "../results/RunEvidencePanel";
import { RunResultScreenshots } from "../results/RunResultScreenshots";
import { hasResultReviews } from "../results/model";
export function RunPage({
  assignedWorker = null,
  availableProviders = [],
  availableRuns = [],
  companionMode = false,
  conversationInboxSyncSignal,
  currentUserId = null,
  error,
  executionPolicy,
  executionWorkers = [],
  executionCostEstimate: providedExecutionCostEstimate = null,
  highlightedMessageId = null,
  initialDetailTab,
  isDeletingIssue = false,
  isProcessing = false,
  isRecovering,
  isUpdatingIssue = false,
  isSidebarOpen,
  issueKeyPrefix,
  onBack,
  onAddDependency,
  onAcceptIssueAction,
  onAcceptIssueExecution,
  onAcceptSkillExecution,
  onCancel,
  onUnassignRun,
  onDelete,
  onTransfer,
  transferProjects = [],
  onDependencyOpen,
  onRelatedMessageOpen,
  onLoadAttachment,
  onLoadIssueMessages,
  onLoadRunEvents = async () => [],
  onLoadRunEvidence,
  onLoadRunEvidenceImage,
  onCompleteResultReview,
  issueProjects = [],
  mentionMembers = [],
  mentionAgents = [],
  onMove,
  onMoveIssueProject,
  onOpenFullPage,
  onProcessNow,
  onRetry,
  onRework,
  onResume = async () => undefined,
  onRemoveDependency,
  onSendIssueMessage,
  onEditIssueMessage = async () => {
    throw new Error("메시지 수정 기능을 사용할 수 없습니다.");
  },
  onDeleteIssueMessage = async () => undefined,
  onUpdateIssue,
  onUpdateIssueCheckpoints,
  onUpdateIssuePreferences = async () => undefined,
  onUpdateIssueSubscription,
  onViewingIssueConversationChange,
  organizationId = null,
  performedAgentName = null,
  performedAgentProvider = null,
  performedAgentModel = null,
  projectId = "",
  run,
  showErrorToast = true,
  token = null
}: {
  assignedWorker?: ExecutionWorker | null;
  availableProviders?: AgentProvider[];
  availableRuns?: HuntRun[];
  companionMode?: boolean;
  conversationInboxSyncSignal?: string;
  currentUserId?: string | null;
  error: string | null;
  executionPolicy?: ProjectExecutionWorkerPolicy;
  executionWorkers?: ExecutionWorker[];
  executionCostEstimate?: AgentExecutionCostEstimate | null;
  highlightedMessageId?: string | null;
  initialDetailTab?: IssueDetailTab;
  isDeletingIssue?: boolean;
  isProcessing?: boolean;
  isRecovering: boolean;
  isUpdatingIssue?: boolean;
  isSidebarOpen: boolean;
  issueKeyPrefix?: string;
  onBack: () => void;
  onAddDependency?: (prerequisiteRunId: string) => Promise<unknown>;
  onAcceptIssueAction?: (proposal: IssueProposedAction) => Promise<IssueProposedAction>;
  onAcceptIssueExecution?: (proposal: IssueExecutionProposal, input: IssueExecutionApprovalInput) => Promise<IssueExecutionProposal>;
  onAcceptSkillExecution?: (proposal: AgentSkillExecutionProposal, input: AgentSkillExecutionApprovalInput) => Promise<AgentSkillExecutionProposal>;
  onCancel: () => Promise<unknown>;
  onUnassignRun?: (runId: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onTransfer?: (targetProjectId: string) => Promise<unknown>;
  transferProjects?: Project[];
  onDependencyOpen?: (runId: string) => void;
  onRelatedMessageOpen?: (relatedMessage: RelatedMessageReference) => void;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  onLoadIssueMessages: () => Promise<IssueMessage[]>;
  onLoadRunEvents?: () => Promise<HuntEvent[]>;
  onLoadRunEvidence: () => Promise<RunEvidence[]>;
  onLoadRunEvidenceImage?: (image: RunEvidenceImage) => Promise<Blob>;
  onCompleteResultReview?: () => Promise<unknown>;
  issueProjects?: PlanningProject[];
  mentionMembers?: OrganizationMember[];
  mentionAgents?: ProjectAgent[];
  onMove: (placement: HuntRunPlacement) => Promise<unknown>;
  onMoveIssueProject?: (targetProjectId: string) => Promise<unknown>;
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
    clientMessageId?: string;
    parentMessageId: string | null;
    mentionedUserIds?: string[];
    mentionedAgentIds?: string[];
    attachments?: File[];
    attachmentReferences?: string[];
  }) => Promise<IssueMessageSendResult>;
  onEditIssueMessage?: (messageId: string, input: {
    body: string;
    mentionedUserIds?: string[];
  }) => Promise<IssueMessage>;
  onDeleteIssueMessage?: (messageId: string) => Promise<unknown>;
  onUpdateIssue?: (input: UpdateIssueInput) => Promise<unknown>;
  onUpdateIssueCheckpoints?: (checkpoints: AutoHuntWorkflowCheckpoint[]) => Promise<unknown>;
  onUpdateIssuePreferences?: (input: IssueExecutionPreferences) => Promise<unknown>;
  onUpdateIssueSubscription?: (subscribed: boolean) => Promise<unknown>;
  onViewingIssueConversationChange?: (runId: string | null) => void;
  organizationId?: string | null;
  performedAgentName?: string | null;
  performedAgentProvider?: AgentProvider | null;
  performedAgentModel?: string | null;
  projectId?: string;
  run: HuntRun;
  showErrorToast?: boolean;
  token?: string | null;
}) {
  const {
    locale,
    localeTag,
    t
  } = useI18n();
  const providerModels = useAgentProviderModels();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const needsAttention = ["paused", "blocked", "failed"].includes(run.status);
  const canCancelRemoteExecution = Boolean(run.workerId) && !["completed", "cancelled", "paused", "blocked", "failed"].includes(run.status);
  const canUnassign = Boolean(onUnassignRun && (run.workerId || run.requestedWorkerId)) && !["completed", "cancelled"].includes(run.status);
  const isClaimed = run.status === "queued" && Boolean(run.leaseExpiresAt) && Date.parse(run.leaseExpiresAt!) > Date.now();
  const canReassign = Boolean(run.workerId || run.requestedWorkerId) && !["completed", "cancelled", "paused"].includes(run.status);
  const processNowDisabled = !onProcessNow || run.executionReadiness === "waiting" || run.status !== "queued" && !canReassign || isClaimed && !canReassign || isProcessing;
  const assignee = mentionMembers.find(member => member.userId === run.assigneeUserId) ?? null;
  const creator = mentionMembers.find(member => member.userId === run.createdByUserId) ?? null;
  const {
    toast
  } = useToast();
  const lastErrorToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showErrorToast || !error) {
      lastErrorToastRef.current = null;
      return;
    }
    if (lastErrorToastRef.current === error) return;
    lastErrorToastRef.current = error;
    toast(error, {
      dedupeKey: errorDiagnosticOccurrenceKey(error) ?? undefined,
      details: errorDiagnosticsForMessage(error),
      tone: "error"
    });
  }, [error, showErrorToast, toast]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [transferTargetProjectId, setTransferTargetProjectId] = useState(() => transferProjects[0]?.id ?? "");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const {
    containerRef: runPageLayoutRef,
    effectiveWidth: effectiveConversationPaneWidth,
    isResizing: isResizingConversation,
    separatorProps: conversationResizeProps,
    width: conversationPaneWidth
  } = useHorizontalPaneResize({
    clamp: clampConversationPaneWidth,
    defaultWidth: conversationPaneWidthDefault,
    load: loadConversationPaneWidth,
    max: conversationPaneWidthMax,
    min: conversationPaneWidthMin,
    save: saveConversationPaneWidth
  });
  const [isConversationLayoutCompact, setIsConversationLayoutCompact] = useState(() => Boolean(initialDetailTab === "conversation"));
  useLayoutEffect(() => {
    if (companionMode) return;
    const layout = runPageLayoutRef.current;
    if (!layout) return;
    const update = (width: number) => {
      if (width <= 0) return;
      setIsConversationLayoutCompact(width < issueConversationTabBreakpoint);
    };
    update(layout.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const entry = entries.find(({
        target
      }) => target === layout);
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, [companionMode, runPageLayoutRef]);
  const usesConversationTab = companionMode || isConversationLayoutCompact;
  const [isCompletingResultReview, setIsCompletingResultReview] = useState(false);
  const [isResumePending, setIsResumePending] = useState(false);
  const resumeCheckpointIdentity = run.checkpoint ? `${run.checkpoint.key}:${run.checkpoint.attempt}:${run.checkpoint.revision}` : null;
  const [resultReviewError, setResultReviewError] = useState<string | null>(null);
  const [isReworkFormOpen, setIsReworkFormOpen] = useState(false);
  const [reworkStage, setReworkStage] = useState("");
  const [reworkFeedback, setReworkFeedback] = useState("");
  const [reworkError, setReworkError] = useState<string | null>(null);
  const [isSubmittingRework, setIsSubmittingRework] = useState(false);
  const [inlineTitle, setInlineTitle] = useState(run.title);
  const [inlineDescription, setInlineDescription] = useState(run.issueDescription ?? "");
  const [inlineKeptAttachmentIds, setInlineKeptAttachmentIds] = useState<string[]>(() => (run.attachments ?? []).map(attachment => attachment.id));
  const [inlineSaveStatus, setInlineSaveStatus] = useState<"saved" | "saving" | "failed">("saved");
  const inlineSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineSaveTaskRef = useRef<(() => void) | null>(null);
  const inlineSaveSequenceRef = useRef(0);
  const inlineSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const inlineSavePendingRef = useRef({
    runId: run.id,
    count: 0
  });
  const inlineUpdateIssueRef = useRef(onUpdateIssue);
  const inlineDescriptionEditorRef = useRef<HTMLDivElement>(null);
  const canEditIssueInline = Boolean(onUpdateIssue);
  const flushInlineSave = useCallback(() => {
    const save = inlineSaveTaskRef.current;
    if (!save) return;
    if (inlineSaveTimerRef.current) {
      clearTimeout(inlineSaveTimerRef.current);
      inlineSaveTimerRef.current = null;
    }
    inlineSaveTaskRef.current = null;
    save();
  }, []);
  const leaveInlineEditing = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.key !== "Escape" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      keyboardShortcutEventIsComposing(event.nativeEvent) ||
      !isKeyboardShortcutEditableTarget(event.target) ||
      !(event.target instanceof HTMLElement)
    ) {
      return;
    }
    event.preventDefault();
    flushInlineSave();
    event.target.blur();
  }, [flushInlineSave]);
  const lastSavedInlineIssueRef = useRef({
    runId: run.id,
    title: run.title.trim(),
    description: run.issueDescription?.trim() || null,
    keptAttachmentIds: (run.attachments ?? []).map(attachment => attachment.id)
  });
  inlineUpdateIssueRef.current = onUpdateIssue;
  const [activeDetailTab, setActiveDetailTab] = useState<IssueDetailTab>(() => initialDetailTab ?? defaultIssueDetailTab(run.status));
  const lastContentDetailTabRef = useRef<Exclude<IssueDetailTab, "conversation">>(initialDetailTab && initialDetailTab !== "conversation" ? initialDetailTab : defaultIssueDetailTab(run.status));
  const selectDetailTab = (tab: IssueDetailTab) => {
    if (tab !== "conversation") lastContentDetailTabRef.current = tab;
    setActiveDetailTab(tab);
  };
  const hasWorkerExecution = Boolean(run.workerId);
  const workerExecutionIsLive = !["completed", "cancelled", "paused", "blocked", "failed"].includes(run.status);
  const workerEvents = useProjectAgentWorkerEvents(token, projectId, hasWorkerExecution ? [run.id] : [], workerExecutionIsLive);
  const agentActivity = useMemo(() => agentMessagesFromAppServerEvents(workerEvents.events), [workerEvents.events]);
  const activityProvider = workerEvents.events.find(event => event.provider)?.provider ?? run.requestedProvider ?? run.preferredProvider ?? null;
  const [runEvents, setRunEvents] = useState<HuntEvent[]>([]);
  const [runEventsLoading, setRunEventsLoading] = useState(true);
  const [runEventsLoadError, setRunEventsLoadError] = useState<string | null>(null);
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
      setRunEventsLoadError(caught instanceof Error ? caught.message : t("run.activityLoadFailed"));
    } finally {
      if (request === runEventsRequest.current) setRunEventsLoading(false);
    }
  }, [t]);
  useMobileBackHandler(() => {
    if (!companionMode) return false;
    if (isDeleteDialogOpen) {
      setIsDeleteDialogOpen(false);
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
  }, {
    enabled: companionMode,
    priority: 200
  });
  const detailTabsId = useId();
  useEffect(() => {
    const nextDetailTab = initialDetailTab ?? defaultIssueDetailTab(run.status);
    setActiveDetailTab(nextDetailTab);
    if (nextDetailTab !== "conversation") {
      lastContentDetailTabRef.current = nextDetailTab;
    }
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
  }, [initialDetailTab, run.id, run.status]);
  useEffect(() => {
    setIsResumePending(false);
  }, [resumeCheckpointIdentity]);
  useLayoutEffect(() => {
    if (companionMode || isConversationLayoutCompact || activeDetailTab !== "conversation") {
      return;
    }
    setActiveDetailTab(lastContentDetailTabRef.current);
  }, [activeDetailTab, companionMode, isConversationLayoutCompact]);
  useEffect(() => {
    onViewingIssueConversationChange?.(!usesConversationTab || activeDetailTab === "conversation" ? run.id : null);
    return () => onViewingIssueConversationChange?.(null);
  }, [activeDetailTab, onViewingIssueConversationChange, run.id, usesConversationTab]);
  useEffect(() => {
    inlineSaveSequenceRef.current += 1;
    if (inlineSaveTimerRef.current) {
      clearTimeout(inlineSaveTimerRef.current);
      inlineSaveTimerRef.current = null;
    }
    inlineSaveTaskRef.current = null;
    setInlineTitle(run.title);
    setInlineDescription(run.issueDescription ?? "");
    setInlineKeptAttachmentIds((run.attachments ?? []).map(attachment => attachment.id));
    setInlineSaveStatus("saved");
    lastSavedInlineIssueRef.current = {
      runId: run.id,
      title: run.title.trim(),
      description: run.issueDescription?.trim() || null,
      keptAttachmentIds: (run.attachments ?? []).map(attachment => attachment.id)
    };
    inlineSavePendingRef.current = {
      runId: run.id,
      count: 0
    };
  }, [run.id]);
  useEffect(() => {
    const lastSaved = lastSavedInlineIssueRef.current;
    // Autosave canonicalizes these values with trim(), but whitespace-only
    // edits are still part of the active draft and must not be overwritten
    // while the user is typing after a save completes.
    const currentTitle = inlineTitle;
    const currentDescription = inlineDescription;
    const lastSavedDescription = lastSaved.description ?? "";
    const currentKeptAttachmentIds = inlineKeptAttachmentIds;
    if (lastSaved.runId !== run.id || currentTitle !== lastSaved.title || currentDescription !== lastSavedDescription || currentKeptAttachmentIds.length !== lastSaved.keptAttachmentIds.length || currentKeptAttachmentIds.some((attachmentId, index) => attachmentId !== lastSaved.keptAttachmentIds[index])) {
      return;
    }
    const nextTitle = run.title.trim();
    const nextDescription = run.issueDescription?.trim() || null;
    const nextKeptAttachmentIds = (run.attachments ?? []).map(attachment => attachment.id);
    lastSavedInlineIssueRef.current = {
      runId: run.id,
      title: nextTitle,
      description: nextDescription,
      keptAttachmentIds: nextKeptAttachmentIds
    };
    setInlineTitle(run.title);
    setInlineDescription(run.issueDescription ?? "");
    setInlineKeptAttachmentIds(current => current.length === nextKeptAttachmentIds.length && current.every((attachmentId, index) => attachmentId === nextKeptAttachmentIds[index]) ? current : nextKeptAttachmentIds);
  }, [inlineDescription, inlineKeptAttachmentIds, inlineTitle, run.attachments, run.id, run.issueDescription, run.title]);
  useEffect(() => {
    if (inlineSaveTimerRef.current) {
      clearTimeout(inlineSaveTimerRef.current);
      inlineSaveTimerRef.current = null;
    }
    inlineSaveTaskRef.current = null;
    if (!canEditIssueInline) return;
    const title = inlineTitle.trim();
    const description = inlineDescription.trim() || null;
    const keptAttachmentIds = inlineKeptAttachmentIds;
    const lastSaved = lastSavedInlineIssueRef.current;
    if (lastSaved.runId === run.id && title === lastSaved.title && description === lastSaved.description && keptAttachmentIds.length === lastSaved.keptAttachmentIds.length && keptAttachmentIds.every((attachmentId, index) => attachmentId === lastSaved.keptAttachmentIds[index]) && inlineSavePendingRef.current.runId === run.id && inlineSavePendingRef.current.count === 0) {
      setInlineSaveStatus("saved");
      return;
    }
    if (!title || !isIssueTitleWithinLimit(title)) {
      setInlineSaveStatus("failed");
      return;
    }
    setInlineSaveStatus("saving");
    const sequence = ++inlineSaveSequenceRef.current;
    const saveInlineIssue = () => {
      inlineSaveTimerRef.current = null;
      if (inlineSaveTaskRef.current === saveInlineIssue) {
        inlineSaveTaskRef.current = null;
      }
      const update = inlineUpdateIssueRef.current;
      if (!update) return;
      const runAttachmentIds = (run.attachments ?? []).map(attachment => attachment.id);
      const attachmentsChanged = keptAttachmentIds.length !== runAttachmentIds.length || keptAttachmentIds.some((attachmentId, index) => attachmentId !== runAttachmentIds[index]);
      if (inlineSavePendingRef.current.runId === run.id) {
        inlineSavePendingRef.current.count += 1;
      }
      const save = inlineSaveQueueRef.current.catch(() => undefined).then(() => update({
        title,
        description,
        priority: run.priority,
        difficulty: run.difficulty,
        attachments: [],
        ...(attachmentsChanged ? {
          keptAttachmentIds
        } : {})
      }));
      inlineSaveQueueRef.current = save;
      void save.then(() => {
        if (lastSavedInlineIssueRef.current.runId === run.id) {
          lastSavedInlineIssueRef.current = {
            runId: run.id,
            title,
            description,
            keptAttachmentIds
          };
        }
        if (inlineSavePendingRef.current.runId === run.id) {
          inlineSavePendingRef.current.count = Math.max(0, inlineSavePendingRef.current.count - 1);
        }
        if (sequence === inlineSaveSequenceRef.current) {
          setInlineSaveStatus("saved");
        }
      }, () => {
        if (inlineSavePendingRef.current.runId === run.id) {
          inlineSavePendingRef.current.count = Math.max(0, inlineSavePendingRef.current.count - 1);
        }
        if (sequence === inlineSaveSequenceRef.current) {
          setInlineSaveStatus("failed");
        }
      });
    };
    inlineSaveTaskRef.current = saveInlineIssue;
    inlineSaveTimerRef.current = setTimeout(saveInlineIssue, 600);
    return () => {
      if (inlineSaveTimerRef.current) {
        clearTimeout(inlineSaveTimerRef.current);
        inlineSaveTimerRef.current = null;
      }
      if (inlineSaveTaskRef.current === saveInlineIssue) {
        inlineSaveTaskRef.current = null;
      }
    };
  }, [canEditIssueInline, inlineDescription, inlineKeptAttachmentIds, inlineTitle, run.difficulty, run.id, run.priority]);
  useEffect(() => {
    void loadRunEvents();
  }, [loadRunEvents, run.eventCount, run.id]);
  const placementOptions = [{
    label: t("status.backlog"),
    value: "status:backlog"
  }, {
    label: t("status.queued"),
    value: "status:queued"
  }, ...run.workflow.stages.map(stage => ({
    label: localizeWorkflowStage(t, stage.id, stage.label),
    value: `stage:${stage.id}`
  })), {
    label: t("status.blocked"),
    value: "status:blocked"
  }, {
    label: t("status.failed"),
    value: "status:failed"
  }, {
    label: t("status.completed"),
    value: "status:completed"
  }, {
    label: t("status.cancelled"),
    value: "status:cancelled"
  }];
  const placementValue = placementIdForRun(run);
  const statusSelectOptions = placementOptions.some(option => option.value === placementValue) ? placementOptions : [{
    label,
    value: placementValue
  }, ...placementOptions];
  const priorityOptions = [{
    label: t("run.notSet"),
    value: "none"
  }, {
    label: t("issue.priority1"),
    value: "1"
  }, {
    label: t("issue.priority2"),
    value: "2"
  }, {
    label: t("issue.priority3"),
    value: "3"
  }, {
    label: t("issue.priority4"),
    value: "4"
  }];
  const priorityValue = run.priority === null ? "none" : String(run.priority);
  const difficultyOptions = [{
    label: t("run.notSet"),
    value: "none"
  }, ...(["easy", "normal", "hard"] as const).map(value => ({
    label: t(`issue.difficulty.${value}` as MessageKey),
    value,
    leading: <IssueDifficultyIcon difficulty={value} size={14} />
  }))];
  const difficultyValue = run.difficulty ?? "none";
  const assigneeOptions = [{
    label: t("run.unassigned"),
    value: ""
  }, ...mentionMembers.map(member => ({
    label: member.name,
    value: member.userId,
    leading: <IssueAssigneeAvatar member={member} />
  }))];
  const currentProject = issueProjects.find(project => project.id === run.projectId) ??
    (run.projectId && run.projectName ? {
      id: run.projectId,
      name: run.projectName,
      icon: null
    } : null);
  const projectOptions = issueProjects
    .filter(project => !run.teamId || project.teamId === run.teamId)
    .filter(project => project.status !== "cancelled")
    .map(project => ({
      label: project.name,
      value: project.id,
      leading: <ProjectIcon project={project} className="run-project-option-icon" />
    }));
  if (currentProject && !projectOptions.some(option => option.value === currentProject.id)) {
    projectOptions.unshift({
      label: currentProject.name,
      value: currentProject.id,
      leading: <ProjectIcon project={currentProject} className="run-project-option-icon" />
    });
  }
  const projectValue = currentProject?.id ?? "";
  const projectLabel = currentProject?.name ?? run.projectName ?? t("run.notSet");
  const canEditProject = Boolean(onMoveIssueProject && run.projectId && projectOptions.length > 1);
  const issueContent = run.issueDescription?.trim() || null;
  const editableIssueAttachments = (run.attachments ?? []).filter(attachment => inlineKeptAttachmentIds.includes(attachment.id)).map(attachment => ({
    attachment,
    reference: attachment.id,
    type: "existing" as const
  }));
  const issueAttachmentsRef = useRef(run.attachments ?? []);
  issueAttachmentsRef.current = run.attachments ?? [];
  const renderIssueMarkdownImage = useCallback(({
    alt,
    src
  }: ComponentProps<"img">) => <IssueMarkdownImage alt={alt ?? ""} attachments={issueAttachmentsRef.current} onLoadAttachment={onLoadAttachment} src={src} />, [onLoadAttachment]);
  const embeddedAttachmentReferences = issueAttachmentReferences(onUpdateIssue ? inlineDescription : issueContent);
  const remainingAttachments = editableIssueAttachments.map(({
    attachment
  }) => attachment).filter(attachment => !embeddedAttachmentReferences.has(attachment.id));
  const completionSummary = run.structuredResult?.summary?.trim() || run.resultSummary?.trim() || (run.status === "completed" ? run.detail?.trim() : null) || null;
  const pausedResultItems = run.status === "paused" ? Array.from(new Set([run.detail?.trim() || null, run.checkpoint ? t(run.checkpoint.position === "before" ? "run.checkpointBefore" : "run.checkpointAfter", {
    stage: run.checkpoint.stageLabel
  }) : t("run.pausedDescription"), run.checkpoint ? run.checkpoint.terminalReviewOnly ? t("run.checkpointTerminalReview") : t("run.checkpointNextStage", {
    stage: run.checkpoint.nextStageLabel ?? run.checkpoint.nextStage ?? run.checkpoint.stageLabel
  }) : null].filter((item): item is string => Boolean(item)))) : [];
  const pausedPartialSummary = run.status === "paused" && run.structuredResult?.outcome === "partial" ? completionSummary : null;
  const pausedReviewEvents = (() => {
    if (run.status !== "paused") return [];
    const reviewAttempt = run.checkpoint?.attempt ?? run.currentAttempt;
    const reviewRevision = run.checkpoint?.revision ?? run.currentRevision;
    const eventsBeforePause = runEvents.filter(event => event.status !== "paused");
    const currentReviewEvents = eventsBeforePause.filter(event => event.attempt === reviewAttempt && event.revision === reviewRevision);
    return [...(currentReviewEvents.length > 0 ? currentReviewEvents : eventsBeforePause)].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  })();
  const currentWorkflowStageIndex = run.workflow.stages.findIndex(stage => stage.id === run.workflowStage);
  const reworkStageOptions = currentWorkflowStageIndex >= 0 ? run.workflow.stages.slice(0, currentWorkflowStageIndex + 1).map(stage => ({
    label: localizeWorkflowStage(t, stage.id, stage.label),
    value: stage.id
  })) : [];
  const resultReviews = run.resultReviews ?? [];
  const currentUserHasReviewed = Boolean(currentUserId && resultReviews.some(review => review.userId === currentUserId));
  const executionMetrics = run.executionMetrics ?? null;
  const executionCostEstimateRequestKey = [run.id, executionMetrics?.inputTokens, executionMetrics?.outputTokens, executionMetrics?.cacheReadTokens, executionMetrics?.cacheWriteTokens].join(":");
  const [loadedExecutionCostEstimate, setLoadedExecutionCostEstimate] = useState<{
    requestKey: string;
    value: AgentExecutionCostEstimate;
  } | null>(null);
  useEffect(() => {
    if (providedExecutionCostEstimate || !executionMetrics || !token || !projectId) {
      return;
    }
    const controller = new AbortController();
    void loadRunCostEstimate(token, projectId, run.id, controller.signal).then(value => setLoadedExecutionCostEstimate({
      requestKey: executionCostEstimateRequestKey,
      value
    })).catch(() => undefined);
    return () => controller.abort();
  }, [executionMetrics?.cacheReadTokens, executionMetrics?.cacheWriteTokens, executionMetrics?.inputTokens, executionMetrics?.outputTokens, executionCostEstimateRequestKey, projectId, providedExecutionCostEstimate, run.id, token]);
  const executionCostEstimate = providedExecutionCostEstimate ?? (loadedExecutionCostEstimate?.requestKey === executionCostEstimateRequestKey ? loadedExecutionCostEstimate.value : null);
  const cacheTokens = executionMetrics ? (executionMetrics.cacheReadTokens ?? 0) + (executionMetrics.cacheWriteTokens ?? 0) : 0;
  // Mirror claim-time execution selection: preferred → requested → agent → live activity.
  const executionProvider = run.preferredProvider ?? run.requestedProvider ?? performedAgentProvider ?? activityProvider ?? null;
  const configuredExecutionModel = run.preferredProvider != null ? run.preferredModel ?? null : run.requestedProvider != null ? run.requestedModel ?? null : performedAgentModel ?? null;
  const executionModels = configuredExecutionModel ? [configuredExecutionModel] : executionCostEstimate?.providerReportedModels ?? [];
  const executionModelText = executionProvider ? executionModels.map(model => agentModelDisplayName(providerModels, executionProvider, model)).join(" · ") : "";
  const executionWorker = assignedWorker ?? null;
  const executionIdentityParts = [executionProvider ? agentProviderLabels[executionProvider] : null, executionModelText || null, executionWorker?.label ?? null].filter((part): part is string => Boolean(part));
  const executionIdentityText = executionIdentityParts.join(" · ");
  const executionIdentity = executionIdentityParts.length > 0 ? <span className="run-execution-identity" title={executionIdentityText}>
      {executionProvider ? <AgentProviderIcon provider={executionProvider} size={12} /> : null}
      {executionWorker ? <WorkerIcon icon={executionWorker.icon} size={14} /> : null}
      <span>{executionIdentityText}</span>
    </span> : null;
  const executionCostModels = executionCostEstimate?.models ?? [];
  const executionTokenBreakdownRows = executionMetrics ? ([executionMetrics.inputTokens != null ? {
    key: "input",
    label: t("run.metricsInputTokens"),
    value: formatExecutionTokens(executionMetrics.inputTokens, localeTag)
  } : null, executionMetrics.outputTokens != null ? {
    key: "output",
    label: t("run.metricsOutputTokens"),
    value: formatExecutionTokens(executionMetrics.outputTokens, localeTag)
  } : null, cacheTokens > 0 ? {
    key: "cache",
    label: t("run.metricsCacheTokens"),
    value: formatExecutionTokens(cacheTokens, localeTag)
  } : null, (executionMetrics.reasoningOutputTokens ?? 0) > 0 ? {
    key: "reasoning",
    label: t("run.metricsReasoningTokens"),
    value: formatExecutionTokens(executionMetrics.reasoningOutputTokens!, localeTag)
  } : null] as const).filter((row): row is NonNullable<typeof row> => row !== null) : [];
  const executionMetricsPanel = executionMetrics || executionProvider || executionWorker ? <TooltipProvider delayDuration={200}>
    <dl className="run-result-metrics" aria-label={t("run.resultMetrics")}>
      {executionMetrics ? <div className="run-metric">
          <dt>{t("run.metricsDuration")}</dt>
          <dd>{formatExecutionDuration(executionMetrics.durationMs)}</dd>
        </div> : null}
      {executionProvider ? <div className="run-metric">
          <dt>{t("run.metricsProvider")}</dt>
          <dd className="run-result-metrics-provider">
            <AgentProviderIcon provider={executionProvider} size={13} />
            <span>{agentProviderLabels[executionProvider]}</span>
          </dd>
        </div> : null}
      {executionProvider && executionModelText ? <div className="run-metric">
          <dt>{t("run.metricsModel")}</dt>
          <dd title={executionModels.join(" · ")}>
            {executionModelText}
          </dd>
        </div> : null}
      {executionWorker ? <div className="run-metric">
          <dt>{t("run.metricsWorker")}</dt>
          <dd className="run-result-metrics-provider">
            <WorkerIcon icon={executionWorker.icon} size={14} />
            <span>{executionWorker.label}</span>
          </dd>
        </div> : null}
      {executionMetrics ? executionMetrics.totalTokens === null ? <div className="run-metric">
            <dt>{t("run.metricsTotalTokens")}</dt>
            <dd>{t("run.metricsTokensUnavailable")}</dd>
          </div> : <Tooltip>
            <TooltipTrigger asChild>
              <div aria-label={`${t("run.metricsTotalTokens")} ${formatExecutionTokens(executionMetrics.totalTokens, localeTag)}`} className="run-metric run-metric-hover" tabIndex={0}>
                <dt>{t("run.metricsTotalTokens")}</dt>
                <dd>
                  {formatExecutionTokens(executionMetrics.totalTokens, localeTag)}
                </dd>
              </div>
            </TooltipTrigger>
            <TooltipContent className="run-result-metrics-tooltip">
              <ul>
                {executionTokenBreakdownRows.map(row => <li key={row.key}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </li>)}
              </ul>
            </TooltipContent>
          </Tooltip> : null}
      {executionCostEstimate && executionCostEstimate.pricedUsageRecords > 0 ? (() => {
        const costChip = <div className={`run-metric run-result-metrics-cost${executionCostModels.length > 0 ? " run-metric-hover" : ""}`} tabIndex={executionCostModels.length > 0 ? 0 : undefined}>
              <dt>
                {executionCostEstimate.status === "estimated" ? t("run.metricsEstimatedCost") : t("run.metricsPartialEstimatedCost")}
              </dt>
              <dd>
                {executionCostEstimate.status === "partial" ? "≥ " : ""}
                {formatExecutionUsdTicks(executionCostEstimate.estimatedUsdTicks ?? executionCostEstimate.pricedUsdTicks, localeTag)}
              </dd>
            </div>;
        if (executionCostModels.length === 0) return costChip;
        return <Tooltip>
              <TooltipTrigger asChild>{costChip}</TooltipTrigger>
              <TooltipContent className="run-result-metrics-tooltip">
                {executionCostModels.map(model => <div className="run-result-metrics-tooltip-model" key={`${model.pricingKey}:${model.model}`} title={model.pricingKey}>
                    <span className="run-result-metrics-tooltip-model-name">
                      {model.model}
                    </span>
                    <span className="run-result-metrics-tooltip-model-rates">
                      <span>
                        {t("run.inputRate")}{" "}
                        <strong>
                          {t("run.ratePerMillion", {
                      price: formatRatePerMillion(model.inputCostPerToken, localeTag)
                    })}
                        </strong>
                      </span>
                      <span>
                        {t("run.outputRate")}{" "}
                        <strong>
                          {t("run.ratePerMillion", {
                      price: formatRatePerMillion(model.outputCostPerToken, localeTag)
                    })}
                        </strong>
                      </span>
                    </span>
                  </div>)}
              </TooltipContent>
            </Tooltip>;
      })() : null}
    </dl>
    </TooltipProvider> : null;
  const blockerReason = run.structuredResult?.summary?.trim() || run.detail?.trim() || t("run.blockedReasonUnknown");
  const blockerDetails = run.structuredResult && run.detail?.trim() !== blockerReason ? run.detail?.trim() || null : null;
  const unblockAction = run.structuredResult?.nextAction?.trim() || t("run.blockedResolutionDefault", {
    count: run.currentAttempt + 1
  });
  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setConfirmCancel(false);
    } catch {
      // The hook exposes the actionable error on this page.
    }
  };
  const updateIssuePriority = (value: string) => {
    if (!onUpdateIssue) return;
    const nextPriority = value === "none" ? null : Number(value);
    if (nextPriority === run.priority) return;
    void runAction(() => onUpdateIssue({
      title: run.title,
      description: run.issueDescription,
      priority: nextPriority,
      difficulty: run.difficulty,
      attachments: []
    }));
  };
  const updateIssueDifficulty = (value: string) => {
    if (!onUpdateIssue) return;
    const nextDifficulty = value === "none" ? null : value as NonNullable<HuntRun["difficulty"]>;
    if (nextDifficulty === run.difficulty) return;
    void runAction(() => onUpdateIssue({
      title: run.title,
      description: run.issueDescription,
      priority: run.priority,
      difficulty: nextDifficulty,
      attachments: []
    }));
  };
  const updateIssueAssignee = (value: string) => {
    if (!onUpdateIssue) return;
    const nextAssigneeUserId = value || null;
    if (nextAssigneeUserId === (run.assigneeUserId ?? null)) return;
    void runAction(() => onUpdateIssue({
      title: run.title,
      description: run.issueDescription,
      priority: run.priority,
      difficulty: run.difficulty,
      assigneeUserId: nextAssigneeUserId,
      attachments: []
    }));
  };
  const updateIssueProject = (value: string) => {
    if (!onMoveIssueProject || !run.projectId || value === run.projectId) return;
    void runAction(() => onMoveIssueProject(value));
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
  const resumeIsPending = isResumePending || isRecovering || Boolean(run.resumeRequestedAt);
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
    setReworkStage(reworkStageOptions.at(-1)?.value ?? reworkStageOptions[0]?.value ?? "");
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
      await onRework({
        workflowStage: reworkStage,
        reason
      });
      setIsReworkFormOpen(false);
    } catch (caught) {
      setReworkError(caught instanceof Error ? caught.message : t("run.reworkFailed"));
    } finally {
      setIsSubmittingRework(false);
    }
  };
  const shareIssue = async () => {
    try {
      const result = await shareIssueLink({
        projectId,
        runId: run.id,
        title: run.title
      });
      if (result === "copied") {
        toast(t("issue.linkCopied"), {
          tone: "success"
        });
      }
    } catch {
      toast(t("issue.shareFailed"), {
        tone: "error"
      });
    }
  };
  const copyIssueLink = async () => {
    try {
      await copyIssueShareLink({
        projectId,
        runId: run.id
      });
      toast(t("issue.linkCopied"), {
        tone: "success"
      });
    } catch {
      toast(t("issue.shareFailed"), {
        tone: "error"
      });
    }
  };
  const copyId = async () => {
    try {
      await copyIssueId(run.runNumber, issueKeyPrefix);
      toast(t("issue.idCopied"), {
        tone: "success"
      });
    } catch {
      toast(t("issue.copyIdFailed"), {
        tone: "error"
      });
    }
  };
  const reviewed = hasResultReviews(run);
  const statusBadgeTitle = reviewed ? `${t("dashboard.status")}: ${t("run.resultReviewed")}` : t("dashboard.status");
  const compactProperties = <div aria-label={t("run.properties")} className="run-page-property-badges" role="group">
      <SelectMenu align="start" className={`run-page-property-select status ${meta.tone}${reviewed ? " reviewed" : ""}`} disabled={isRecovering} hideChevron label={t("dashboard.status")} leadingIcon={reviewed ? <BadgeCheck aria-hidden="true" className="status-pill-review-icon" size={13} /> : <Activity aria-hidden="true" size={13} />} onValueChange={value => {
      const placement = placementForId(value);
      if (!placement || placementMatchesRun(run, placement)) return;
      void runAction(() => onMove(placement));
    }} options={statusSelectOptions} searchable searchPlaceholder={t("dashboard.status")} size="small" title={statusBadgeTitle} value={placementValue} />
      <SelectMenu align="start" className="run-page-property-select priority" disabled={isUpdatingIssue || !onUpdateIssue} hideChevron label={t("issue.priority")} leadingIcon={<Signal aria-hidden="true" size={13} />} onValueChange={updateIssuePriority} options={priorityOptions} size="small" title={t("issue.priority")} value={priorityValue} />
      {assignee && <span aria-label={`${t("issue.assignee")}: ${assignee.name}`} className="run-page-property-badge assignee" title={`${t("issue.assignee")}: ${assignee.name}`}>
          <IssueAssigneeAvatar member={assignee} />
        </span>}
      {executionWorker && <span aria-label={t("run.workerAssigned", {
      worker: executionWorker.label
    })} className="run-page-property-badge worker" title={t("run.workerAssigned", {
      worker: executionWorker.label
    })}>
          <WorkerIcon icon={executionWorker.icon} size={18} />
        </span>}
      {performedAgentName ? <span aria-label={`${t("run.agent")}: ${performedAgentName}`} className="run-page-property-badge agent" title={`${t("run.agent")}: ${performedAgentName}`}>
          <Bot aria-hidden="true" size={13} />
          {performedAgentName}
        </span> : null}
    </div>;
  const processNowLabel = t(isProcessing ? "issue.processNowRunning" : canReassign ? "worker.reassign" : "issue.processNow");
  const processNowButton = <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label={processNowLabel} className="run-page-process-now" disabled={processNowDisabled} onClick={onProcessNow} size="icon-sm" type="button">
            {isProcessing ? <Spinner aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{processNowLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>;
  const inlineSaveLabel = t(inlineSaveStatus === "saving" ? "common.saving" : inlineSaveStatus === "failed" ? "issue.saveFailed" : "common.saved");
  const inlineSaveIndicator = onUpdateIssue ? <span aria-label={inlineSaveLabel} aria-live="polite" className={`run-page-save-status ${inlineSaveStatus}`} role="status" title={inlineSaveLabel}>
      {inlineSaveStatus === "saving" ? <Spinner aria-hidden="true" size={13} /> : inlineSaveStatus === "failed" ? <CircleAlert aria-hidden="true" size={13} /> : <Check aria-hidden="true" size={13} />}
      {inlineSaveStatus === "saved" ? null : <span>{inlineSaveLabel}</span>}
    </span> : null;
  return <MainContent className="run-page-shell" id="issue-detail">
      {!companionMode && <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region="deep">
          <Button aria-label={t("run.back")} className="run-page-titlebar-back" onClick={onBack} size="icon-sm" title={t("run.back")} type="button" variant="ghost">
            <ArrowLeft aria-hidden="true" size={16} />
          </Button>
          <small className="run-page-window-number">
            {formatIssueKey(issueKeyPrefix, run.runNumber)}
          </small>
          <input aria-label={t("issue.title")} className="run-page-window-title run-page-inline-title" id="run-page-title" maxLength={issueTitleInputMaxLength(inlineTitle, locale)} onChange={event => setInlineTitle(event.currentTarget.value)} onKeyDown={leaveInlineEditing} readOnly={!onUpdateIssue} title={inlineTitle} value={inlineTitle} />
          {inlineSaveIndicator}
          <div className="run-page-titlebar-actions">
            {compactProperties}
            <span aria-hidden="true" className="run-page-titlebar-divider" />
            <div className="run-page-titlebar-tools">
              {processNowButton}
              {onOpenFullPage ? <button aria-label={t("inbox.openFullPage")} className="run-page-tool-button run-page-open-full-page" onClick={onOpenFullPage} title={t("inbox.openFullPage")} type="button">
                  <Maximize2 aria-hidden="true" size={15} />
                </button> : null}
              <button aria-controls="run-properties-panel" aria-expanded={isPropertiesOpen} aria-label={t("run.properties")} className="run-page-tool-button run-page-properties-toggle" onClick={() => setIsPropertiesOpen(open => !open)} title={t("run.properties")} type="button">
                <Columns3 aria-hidden="true" size={15} />
              </button>
              <IssueActionsMenu disabled={isDeletingIssue || isRecovering} mutatingDisabled={isUpdatingIssue} onCancel={canCancelRemoteExecution ? () => void runAction(onCancel) : undefined} onCopyId={() => void copyId()} onCopyLink={projectId ? () => void copyIssueLink() : undefined} onUnassign={canUnassign ? () => void runAction(() => onUnassignRun!(run.id)) : undefined} onDelete={onDelete ? () => setIsDeleteDialogOpen(true) : undefined} onTransfer={onTransfer ? () => {
            setTransferError(null);
            setTransferTargetProjectId(transferProjects[0]?.id ?? "");
            setIsTransferDialogOpen(true);
          } : undefined} />
            </div>
          </div>
        </header>}
      <div className="run-page-scroll">
        <article aria-labelledby="run-page-title" className="run-page">
          {companionMode ? <header>
              <div className="run-page-heading">
                <button className="run-page-back" onClick={onBack} type="button">
                  <ArrowLeft size={16} />
                  {t("run.back")}
                </button>
                <div className="run-page-overview">
                  <div className="run-page-title-row">
                    <small>{formatIssueKey(issueKeyPrefix, run.runNumber)}</small>
                    <input aria-label={t("issue.title")} className="run-page-inline-title" id="run-page-title" maxLength={issueTitleInputMaxLength(inlineTitle, locale)} onChange={event => setInlineTitle(event.currentTarget.value)} onKeyDown={leaveInlineEditing} readOnly={!onUpdateIssue} value={inlineTitle} />
                    {inlineSaveIndicator}
                    <IssueActionsMenu disabled={isDeletingIssue || isRecovering} mutatingDisabled={isUpdatingIssue} onCancel={canCancelRemoteExecution ? () => void runAction(onCancel) : undefined} onUnassign={canUnassign ? () => void runAction(() => onUnassignRun!(run.id)) : undefined} onDelete={onDelete ? () => setIsDeleteDialogOpen(true) : undefined} onTransfer={onTransfer ? () => {
                  setTransferError(null);
                  setTransferTargetProjectId(transferProjects[0]?.id ?? "");
                  setIsTransferDialogOpen(true);
                } : undefined} onShare={() => void shareIssue()} />
                  </div>
                </div>
                <div className="run-page-companion-actions">
                  {compactProperties}
                  <span aria-hidden="true" className="run-page-titlebar-divider" />
                  <div className="run-page-titlebar-tools">
                    {processNowButton}
                    <button aria-controls="run-properties-panel" aria-expanded={isPropertiesOpen} aria-label={t("run.properties")} className="run-page-tool-button run-page-properties-toggle" onClick={() => setIsPropertiesOpen(open => !open)} title={t("run.properties")} type="button">
                      <Columns3 aria-hidden="true" size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </header> : null}
          <div className="run-page-body">
            <div className={`run-page-layout${usesConversationTab ? " is-conversation-tabbed" : ""}${isResizingConversation ? " is-resizing-conversation" : ""}`} ref={runPageLayoutRef} style={conversationPaneWidth === null || usesConversationTab ? undefined : {
            "--run-conversation-pane-width": `${conversationPaneWidth}%`
          } as React.CSSProperties}>
              <div className="run-page-main">
                <div aria-label={t("run.detailTabs")} className="issue-detail-tabs" role="tablist">
                  <button aria-controls={`${detailTabsId}-description-panel`} aria-selected={activeDetailTab === "description"} id={`${detailTabsId}-description-tab`} onClick={() => selectDetailTab("description")} role="tab" type="button">
                    {t("run.issue")}
                  </button>
                  <button aria-controls={`${detailTabsId}-result-panel`} aria-selected={activeDetailTab === "result"} id={`${detailTabsId}-result-tab`} onClick={() => selectDetailTab("result")} role="tab" type="button">
                    {t("run.resultTab")}
                  </button>
                  <button aria-controls={`${detailTabsId}-evidence-panel`} aria-selected={activeDetailTab === "evidence"} id={`${detailTabsId}-evidence-tab`} onClick={() => selectDetailTab("evidence")} role="tab" type="button">
                    {t("run.evidence")}
                  </button>
                  <button aria-controls={`${detailTabsId}-agent-activity-panel`} aria-selected={activeDetailTab === "agentActivity"} id={`${detailTabsId}-agent-activity-tab`} onClick={() => selectDetailTab("agentActivity")} role="tab" type="button">
                    {t("run.agentActivity")}
                  </button>
                  <button aria-controls={`${detailTabsId}-status-history-panel`} aria-selected={activeDetailTab === "statusHistory"} id={`${detailTabsId}-status-history-tab`} onClick={() => selectDetailTab("statusHistory")} role="tab" type="button">
                    {t("run.status")}
                  </button>
                  {usesConversationTab ? <button aria-controls={`${detailTabsId}-conversation-panel`} aria-selected={activeDetailTab === "conversation"} id={`${detailTabsId}-conversation-tab`} onClick={() => selectDetailTab("conversation")} role="tab" type="button">
                      {t("run.messages")}
                    </button> : null}
                </div>
                <div className="run-page-content">
                <section aria-label={t(activeDetailTab === "description" ? "run.issue" : activeDetailTab === "result" ? "run.result" : activeDetailTab === "agentActivity" ? "run.agentActivity" : activeDetailTab === "statusHistory" ? "run.status" : "run.evidence")} className="issue-description-pane" hidden={activeDetailTab === "conversation"}>
                  {activeDetailTab === "description" ? <div aria-labelledby={`${detailTabsId}-description-tab`} className="issue-description-scroll" id={`${detailTabsId}-description-panel`} role="tabpanel">
                      {run.status === "blocked" ? <section aria-labelledby={`${detailTabsId}-blocked-title`} className="blocked-issue-card" role="alert">
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
                          {blockerDetails ? <details className="blocked-issue-details">
                              <summary>
                                <ChevronRight aria-hidden="true" size={14} />
                                {t("run.blockedDetails")}
                              </summary>
                              <p>{blockerDetails}</p>
                            </details> : null}
                          <div className="recovery-actions">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button aria-description={t("run.retryWorkerTooltip")} disabled={isRecovering} onClick={() => void runAction(onRetry)} type="button">
                                  <Spinner icon={RotateCcw} size={14} spinning={isRecovering} />
                                  {t("run.retry")}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-72 text-center leading-relaxed" side="top">
                                {t("run.retryWorkerTooltip")}
                              </TooltipContent>
                            </Tooltip>
                            {confirmCancel ? <>
                                <button className="danger" disabled={isRecovering} onClick={() => void runAction(onCancel)} type="button">
                                  {t("run.confirmCancel")}
                                </button>
                                <button disabled={isRecovering} onClick={() => setConfirmCancel(false)} type="button">
                                  {t("run.back")}
                                </button>
                              </> : <button className="danger-secondary" disabled={isRecovering} onClick={() => setConfirmCancel(true)} type="button">
                                {t("run.cancel")}
                              </button>}
                          </div>
                        </section> : null}
                      {onUpdateIssue ? <DraftIssueDescriptionEditor attachments={editableIssueAttachments} autoSizeTextFields className="issue-description-inline-editor" description={inlineDescription} editorRef={inlineDescriptionEditorRef} label={t("issue.description")} onChange={setInlineDescription} onKeyDown={leaveInlineEditing} onLoadAttachment={onLoadAttachment} onRemoveAttachment={reference => {
                      setInlineKeptAttachmentIds(current => current.filter(attachmentId => attachmentId !== reference));
                      setInlineDescription(current => removeIssueAttachmentMarkdown(current, reference));
                    }} placeholder={t("issue.descriptionPlaceholder")} removeLabel={name => t("issue.remove", {
                      name
                    })} /> : issueContent ? <MarkdownContent className="issue-description-markdown" components={{
                      img: renderIssueMarkdownImage
                    }} urlTransform={(url, key) => key === "src" && issueAttachmentReference(url) ? url : defaultMarkdownUrlTransform(url)}>
                          {issueContent}
                        </MarkdownContent> : <p className="issue-description-empty">{t("run.notSet")}</p>}
                      {remainingAttachments.length > 0 && <IssueAttachmentGallery attachments={remainingAttachments} onLoadAttachment={onLoadAttachment} />}
                      {needsAttention && !["blocked", "paused"].includes(run.status) ? <div className="recovery-panel">
                          <div>
                            <CircleAlert size={16} />
                            <span>
                              <strong>{t("run.failed")}</strong>
                              <small>
                                {t("run.retryDescription", {
                              count: run.currentAttempt + 1
                            })}
                              </small>
                            </span>
                          </div>
                          <div className="recovery-actions">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button aria-description={t("run.retryWorkerTooltip")} disabled={isRecovering} onClick={() => void runAction(onRetry)} type="button">
                                  <Spinner icon={RotateCcw} size={14} spinning={isRecovering} />
                                  {t("run.retry")}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-72 text-center leading-relaxed" side="top">
                                {t("run.retryWorkerTooltip")}
                              </TooltipContent>
                            </Tooltip>
                            {confirmCancel ? <>
                                <button className="danger" disabled={isRecovering} onClick={() => void runAction(onCancel)} type="button">
                                  {t("run.confirmCancel")}
                                </button>
                                <button disabled={isRecovering} onClick={() => setConfirmCancel(false)} type="button">
                                  {t("run.back")}
                                </button>
                              </> : <button className="danger-secondary" disabled={isRecovering} onClick={() => setConfirmCancel(true)} type="button">
                                {t("run.cancel")}
                              </button>}
                          </div>
                        </div> : null}
                    </div> : activeDetailTab === "result" ? <div aria-labelledby={`${detailTabsId}-result-tab`} className="run-result-panel" id={`${detailTabsId}-result-panel`} role="tabpanel">
                      {run.status === "paused" ? <section aria-labelledby={`${detailTabsId}-paused-result-title`} className="completed-issue-card paused-result-card" role="status">
                          <div className="completed-issue-card-heading">
                            <RunStatusPill as="span" label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
                            <strong id={`${detailTabsId}-paused-result-title`}>
                              {t("run.partialResult")}
                            </strong>
                            <small>
                              {t("run.attempt", {
                            count: run.currentAttempt
                          })} ·{" "}
                              {run.checkpoint ? t("run.checkpointRevision", {
                            revision: run.checkpoint.revision
                          }) : t("run.revision", {
                            count: run.currentRevision
                          })}
                              {executionIdentity ? <>
                                  {" "}· {executionIdentity}
                                </> : null}
                            </small>
                          </div>
                          {executionMetricsPanel}
                          <div className="paused-review-content">
                            <section className="paused-review-section paused-review-result">
                              <header>
                                <div>
                                  <strong>{t("run.reviewWorkResult")}</strong>
                                  <p>{t("run.reviewWorkResultDescription")}</p>
                                </div>
                              </header>
                              {pausedPartialSummary ? <MarkdownContent className="completed-issue-summary paused-result-summary">
                                  {pausedPartialSummary}
                                </MarkdownContent> : <div className="completed-issue-summary paused-result-summary">
                                  <ul>
                                    {pausedResultItems.map(item => <li key={item}>{item}</li>)}
                                  </ul>
                                </div>}
                              {run.structuredResult?.nextAction ? <div className="completed-issue-next-action">
                                  <strong>{t("run.resultNextAction")}</strong>
                                  <span>{run.structuredResult.nextAction}</span>
                                </div> : null}
                              <RunResultScreenshots onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} runId={run.id} />
                            </section>
                          </div>
                          {run.pullRequestUrls.length > 0 ? <div className="run-result-links">
                              {run.pullRequestUrls.map((url, index) => {
                          const pullRequestLabel = pullRequestDisplayName(url, index);
                          return <a href={url} key={url} rel="noreferrer" target="_blank">
                                    <GitPullRequest aria-hidden="true" size={14} />
                                    {pullRequestLabel}
                                    <ArrowUp aria-hidden="true" size={13} />
                                  </a>;
                        })}
                            </div> : null}
                          <div className="paused-result-actions">
                            <button className="paused-result-resume" disabled={resumeIsPending} onClick={() => void resumePausedRun()} type="button">
                              {resumeIsPending ? <Spinner aria-hidden="true" size={14} /> : <RotateCcw aria-hidden="true" size={14} />}
                              {t("run.resume")}
                            </button>
                            {onRework && reworkStageOptions.length > 0 ? <button aria-expanded={isReworkFormOpen} className="paused-result-rework" disabled={isRecovering || isSubmittingRework} onClick={() => isReworkFormOpen ? setIsReworkFormOpen(false) : openReworkForm()} type="button">
                                <GitFork aria-hidden="true" size={14} />
                                {t("run.requestRework")}
                              </button> : null}
                            <button onClick={() => setActiveDetailTab("evidence")} type="button">
                              <ImageIcon aria-hidden="true" size={14} />
                              {t("run.viewResultEvidence")}
                            </button>
                          </div>
                          {isReworkFormOpen ? <form className="paused-rework-form" onSubmit={event => void submitRework(event)}>
                              <div className="paused-rework-heading">
                                <strong>{t("run.reworkTitle")}</strong>
                                <p>{t("run.reworkDescription")}</p>
                              </div>
                              <label>
                                <span>{t("run.reworkStage")}</span>
                                <SelectMenu disabled={isSubmittingRework} label={t("run.reworkStage")} onValueChange={setReworkStage} options={reworkStageOptions} size="small" value={reworkStage} />
                              </label>
                              <label>
                                <span>{t("run.reworkFeedback")}</span>
                                <textarea autoFocus disabled={isSubmittingRework} maxLength={4_000} onChange={event => setReworkFeedback(event.target.value)} placeholder={t("run.reworkFeedbackPlaceholder")} rows={4} value={reworkFeedback} />
                              </label>
                              {reworkError ? <p className="paused-rework-error" role="alert">
                                  {reworkError}
                                </p> : null}
                              <div className="paused-rework-submit-actions">
                                <button disabled={isSubmittingRework} onClick={() => setIsReworkFormOpen(false)} type="button">
                                  {t("common.cancel")}
                                </button>
                                <button disabled={isSubmittingRework || !reworkStage || !reworkFeedback.trim()} type="submit">
                                  {isSubmittingRework ? <Spinner aria-hidden="true" size={14} /> : <GitFork aria-hidden="true" size={14} />}
                                  {t(isSubmittingRework ? "run.reworkSubmitting" : "run.reworkSubmit")}
                                </button>
                              </div>
                            </form> : null}
                          <div className="paused-review-content">
                            <section aria-busy={runEventsLoading} className="paused-review-section paused-review-work">
                              <header>
                                <div>
                                  <strong>{t("run.reviewWorkHistory")}</strong>
                                  <p>{t("run.reviewWorkHistoryDescription")}</p>
                                </div>
                                {!runEventsLoading && !runEventsLoadError ? <small>
                                    {t("run.activityCount", {
                                count: pausedReviewEvents.length
                              })}
                                  </small> : null}
                              </header>
                              {runEventsLoading ? <div className="paused-review-state">
                                  <Spinner size={15} />
                                  {t("run.activityLoading")}
                                </div> : runEventsLoadError ? <button className="paused-review-state error" onClick={() => void loadRunEvents()} type="button">
                                  <CircleAlert size={14} />
                                  <span>{runEventsLoadError}</span>
                                  <RefreshCw size={13} />
                                </button> : pausedReviewEvents.length > 0 ? <div className="paused-review-timeline">
                                  {pausedReviewEvents.map(event => {
                              const display = eventMeta(event.status, event.workflowStage, run.workflow);
                              return <div className="paused-review-event" key={event.id}>
                                        <i className={display.tone} />
                                        <div>
                                          <strong>
                                            {localizeEvent(t, event.status, event.workflowStage, display.label)}
                                          </strong>
                                          {event.detail ? <p>{event.detail}</p> : null}
                                          <small>
                                            {event.actorName ?? event.actor} · {relativeTime(event.occurredAt, t)}
                                          </small>
                                        </div>
                                      </div>;
                            })}
                                </div> : <p className="paused-review-empty">
                                  {t("run.activityEmpty")}
                                </p>}
                            </section>
                          </div>
                        </section> : completionSummary ? <section aria-labelledby={`${detailTabsId}-result-title`} className="completed-issue-card">
                          <div className="completed-issue-card-heading">
                            <RunStatusPill as="span" label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
                            <strong id={`${detailTabsId}-result-title`}>
                              {t("run.result")}
                            </strong>
                            <small>
                              {t("run.attempt", {
                            count: run.currentAttempt
                          })} ·{" "}
                              {t("run.revision", {
                            count: run.currentRevision
                          })}
                              {executionIdentity ? <>
                                  {" "}· {executionIdentity}
                                </> : null}
                            </small>
                          </div>
                          {executionMetricsPanel}
                          <MarkdownContent className="completed-issue-summary">
                            {completionSummary}
                          </MarkdownContent>
                          {run.structuredResult?.humanActionRequired && run.structuredResult.nextAction ? <div className="completed-issue-next-action">
                              <strong>{t("run.resultNextAction")}</strong>
                              <span>{run.structuredResult.nextAction}</span>
                            </div> : null}
                          <RunResultScreenshots onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} runId={run.id} />
                          {run.pullRequestUrls.length > 0 ? <div className="run-result-links">
                              {run.pullRequestUrls.map((url, index) => {
                          const pullRequestLabel = pullRequestDisplayName(url, index);
                          return <a href={url} key={url} rel="noreferrer" target="_blank">
                                    <GitPullRequest aria-hidden="true" size={14} />
                                    {pullRequestLabel}
                                    <ArrowUp aria-hidden="true" size={13} />
                                  </a>;
                        })}
                            </div> : null}
                          <div className="run-result-review">
                            <div className="run-result-review-heading">
                              <span>
                                <BadgeCheck aria-hidden="true" size={17} />
                                <strong>{t("run.resultReview")}</strong>
                              </span>
                              <small>
                                {t("run.resultReviewerCount", {
                              count: resultReviews.length
                            })}
                              </small>
                            </div>
                            <IssueResultReviewers emptyLabel={t("run.resultReviewEmpty")} reviews={resultReviews} />
                            {currentUserId && onCompleteResultReview ? <button className="run-result-review-complete" disabled={currentUserHasReviewed || isCompletingResultReview} onClick={() => void completeResultReview()} type="button">
                                {isCompletingResultReview ? <Spinner aria-hidden="true" size={15} /> : <Check aria-hidden="true" size={15} />}
                                {t(isCompletingResultReview ? "run.resultReviewSaving" : currentUserHasReviewed ? "run.resultReviewed" : "run.resultReviewComplete")}
                              </button> : null}
                            {resultReviewError ? <p className="run-result-review-error" role="alert">
                                {resultReviewError}
                              </p> : null}
                          </div>
                          <button onClick={() => setActiveDetailTab("evidence")} type="button">
                            <ImageIcon aria-hidden="true" size={14} />
                            {t("run.viewResultEvidence")}
                          </button>
                        </section> : <div className="run-result-empty">
                          <ListChecks aria-hidden="true" size={20} />
                          <strong>{t("run.result")}</strong>
                          <p>{run.detail?.trim() || t("run.resultEmpty")}</p>
                          {executionMetricsPanel}
                        </div>}
                      {run.status !== "paused" && !completionSummary ? <RunResultScreenshots onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} runId={run.id} /> : null}
                    </div> : activeDetailTab === "agentActivity" ? <IssueAgentActivityPanel activity={agentActivity} error={workerEvents.error} id={`${detailTabsId}-agent-activity-panel`} isLive={workerExecutionIsLive && hasWorkerExecution} labelledBy={`${detailTabsId}-agent-activity-tab`} loading={workerEvents.isLoading} provider={activityProvider} /> : activeDetailTab === "statusHistory" ? <IssueStatusHistoryPanel events={runEvents} id={`${detailTabsId}-status-history-panel`} labelledBy={`${detailTabsId}-status-history-tab`} loadError={runEventsLoadError} loading={runEventsLoading} onRetry={() => void loadRunEvents()} workflow={run.workflow} /> : <RunEvidencePanel id={`${detailTabsId}-evidence-panel`} labelledBy={`${detailTabsId}-evidence-tab`} onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} run={run} />}
                </section>
                {usesConversationTab ? <div aria-labelledby={`${detailTabsId}-conversation-tab`} className="issue-conversation-tab-panel" hidden={activeDetailTab !== "conversation"} id={`${detailTabsId}-conversation-panel`} role="tabpanel">
                    <IssueConversation currentUserId={currentUserId} executionRuns={availableRuns} highlightedMessageId={highlightedMessageId} inboxSyncSignal={conversationInboxSyncSignal} mentionMembers={mentionMembers} mentionAgents={mentionAgents} onAcceptIssueAction={onAcceptIssueAction} onAcceptIssueExecution={onAcceptIssueExecution} onAcceptSkillExecution={onAcceptSkillExecution} executionPolicy={executionPolicy} executionWorkers={executionWorkers} onDelete={onDeleteIssueMessage} onEdit={onEditIssueMessage} onIssueOpen={onDependencyOpen} onLoadAttachment={onLoadAttachment} onLoad={onLoadIssueMessages} onSend={onSendIssueMessage} onUpdateSubscription={onUpdateIssueSubscription} organizationId={organizationId} run={run} projectId={projectId} token={token} showsScrollToLatest={companionMode} />
                  </div> : null}
                </div>
                <IssueWorkflowProgress onCheckpointsChange={onUpdateIssueCheckpoints} run={run} />
              </div>
              {!usesConversationTab ? <>
                  <div aria-label={t("run.resizeContentPanels")} aria-orientation="vertical" aria-valuemax={conversationPaneWidthMax} aria-valuemin={conversationPaneWidthMin} aria-valuenow={effectiveConversationPaneWidth} className="run-page-conversation-resizer" role="separator" tabIndex={0} {...conversationResizeProps} />
                  <IssueConversation currentUserId={currentUserId} executionRuns={availableRuns} highlightedMessageId={highlightedMessageId} inboxSyncSignal={conversationInboxSyncSignal} mentionMembers={mentionMembers} mentionAgents={mentionAgents} onAcceptIssueAction={onAcceptIssueAction} onAcceptIssueExecution={onAcceptIssueExecution} onAcceptSkillExecution={onAcceptSkillExecution} executionPolicy={executionPolicy} executionWorkers={executionWorkers} onDelete={onDeleteIssueMessage} onEdit={onEditIssueMessage} onIssueOpen={onDependencyOpen} onLoadAttachment={onLoadAttachment} onLoad={onLoadIssueMessages} onSend={onSendIssueMessage} onUpdateSubscription={onUpdateIssueSubscription} organizationId={organizationId} run={run} projectId={projectId} token={token} showsScrollToLatest={companionMode} />
                </> : null}
              {isPropertiesOpen ? <div className="run-properties-layer" onClick={event => {
              if (event.target === event.currentTarget) {
                setIsPropertiesOpen(false);
              }
            }}>
                <aside aria-label={t("run.properties")} className="run-properties" id="run-properties-panel">
                  <header className="run-properties-header">
                    <h2>{t("run.properties")}</h2>
                    <button aria-label={t("common.close")} onClick={() => setIsPropertiesOpen(false)} type="button">
                      <X aria-hidden="true" size={16} />
                    </button>
                  </header>
                  <section>
                  <label className="run-property run-property-editable run-status-control">
                    <span className={`run-property-icon ${meta.tone}`}><Activity size={15} /></span>
                    <span className="run-property-copy">
                      <SelectMenu align="end" className="run-status-select" disabled={isRecovering} label={t("dashboard.status")} onValueChange={value => {
                        const placement = placementForId(value);
                        if (!placement || placementMatchesRun(run, placement)) return;
                        void runAction(() => onMove(placement));
                      }} options={statusSelectOptions} searchable searchPlaceholder={t("dashboard.status")} size="small" value={placementValue} />
                    </span>
                    {isRecovering && <Spinner size={14} />}
                  </label>
                  <label className="run-property run-property-editable">
                    <span className="run-property-icon priority"><Signal size={15} /></span>
                    <span className="run-property-copy">
                      <SelectMenu align="end" className="run-priority-select" disabled={isUpdatingIssue || !onUpdateIssue} label={t("issue.priority")} onValueChange={updateIssuePriority} options={priorityOptions} size="small" value={priorityValue} />
                    </span>
                  </label>
                  <label className="run-property run-property-editable">
                    <span className="run-property-icon difficulty">{run.difficulty ? <IssueDifficultyIcon difficulty={run.difficulty} size={16} /> : <Gauge aria-hidden="true" size={16} />}</span>
                    <span className="run-property-copy">
                      <SelectMenu align="end" className="run-difficulty-select" disabled={isUpdatingIssue || !onUpdateIssue} label={t("issue.difficulty")} onValueChange={updateIssueDifficulty} options={difficultyOptions} size="small" value={difficultyValue} />
                    </span>
                  </label>
                  <label className="run-property run-property-editable">
                    <span className="run-property-icon provider">
                      <Waypoints size={15} />
                    </span>
                    <span className="run-property-copy">
                      <ProviderSelect align="end" disabled={isUpdatingIssue} emptyOption={{
                        label: t("issue.agentDefault"),
                        value: ""
                      }} label={t("issue.preferredProvider")} onValueChange={value => {
                        void onUpdateIssuePreferences({
                          provider: (value || null) as AgentProvider | null,
                          model: null,
                          effort: null
                        }).catch(() => undefined);
                      }} providers={availableProviders} size="small" value={run.preferredProvider ?? ""} />
                    </span>
                  </label>
                  <label className="run-property run-property-editable">
                    <span className="run-property-icon model">
                      <BrainCircuit size={15} />
                    </span>
                    <span className="run-property-copy">
                      <SelectMenu align="end" disabled={isUpdatingIssue || !run.preferredProvider} label={t("issue.preferredModel")} onValueChange={value => {
                        if (!run.preferredProvider) return;
                        void onUpdateIssuePreferences({
                          provider: run.preferredProvider,
                          model: value || null,
                          effort: null
                        }).catch(() => undefined);
                      }} options={run.preferredProvider ? agentModelOptions(providerModels, run.preferredProvider, t("settings.providerDefaultModel"), run.preferredModel) : []} placeholder={t("issue.selectProviderFirst")} searchEmptyMessage={t("issue.noModelsFound")} searchPlaceholder={t("issue.searchModels")} searchable={run.preferredProvider === "opencode" || run.preferredProvider === "agy"} size="small" value={run.preferredModel ?? ""} />
                    </span>
                  </label>
                  <label className="run-property run-property-editable">
                    <span className="run-property-icon effort">
                      <BrainCircuit size={15} />
                    </span>
                    <span className="run-property-copy">
                      <SelectMenu align="end" disabled={isUpdatingIssue || !run.preferredProvider || !run.preferredModel} label={t("settings.effort")} onValueChange={value => {
                        if (!run.preferredProvider || !run.preferredModel) {
                          return;
                        }
                        void onUpdateIssuePreferences({
                          provider: run.preferredProvider,
                          model: run.preferredModel,
                          effort: (value || null) as ModelEffort | null
                        }).catch(() => undefined);
                      }} options={[{
                        label: t("settings.providerDefaultEffort"),
                        value: ""
                      }, ...(run.preferredProvider ? agentEffortOptions(providerModels, run.preferredProvider, run.preferredModel, run.preferredEffort) : [])]} placeholder={t("issue.selectModelFirst")} size="small" value={run.preferredEffort ?? ""} />
                    </span>
                  </label>
                  {run.fullAuto ? <div aria-label={`${t("issue.fullAuto")}: ${t("issue.fullAutoDescription")}`} className="run-property" title={t("issue.fullAutoDescription")}>
                      <span className="run-property-icon agent">
                        <Bot size={15} />
                      </span>
                      <span className="run-property-copy">
                        <strong>{t("issue.fullAuto")}</strong>
                      </span>
                    </div> : null}
                  <label aria-label={`${t("issue.assignee")}: ${assignee?.name ?? t("run.unassigned")}`} className="run-property run-property-editable" title={t("issue.assignee")}>
                    <span className="run-property-icon assignee"><UserRound size={15} /></span>
                    <span className="run-property-copy">
                      <SelectMenu align="end" className="run-assignee-select" disabled={isUpdatingIssue || !onUpdateIssue} label={t("issue.assignee")} onValueChange={updateIssueAssignee} options={assigneeOptions} searchEmptyMessage={t("organization.noResults")} searchPlaceholder={t("organization.search")} searchable={assigneeOptions.length > 8} size="small" value={run.assigneeUserId ?? ""} />
                    </span>
                  </label>
                  <div aria-label={`${t("run.creator")}: ${creator?.name ?? t("run.creatorUnknown")}`} className="run-property" title={t("run.creator")}>
                    <span className="run-property-icon assignee"><UserRound size={15} /></span>
                    <span className="run-property-copy"><strong>{creator?.name ?? t("run.creatorUnknown")}</strong></span>
                  </div>
                  {run.relatedMessage && onRelatedMessageOpen ? <button aria-label={t("run.openRelatedMessage")} className="run-property run-property-button run-related-message-property" onClick={() => onRelatedMessageOpen(run.relatedMessage!)} title={t("run.openRelatedMessage")} type="button">
                      <span className="run-property-icon related-message"><MessageSquare size={15} /></span>
                      <span className="run-property-copy">
                        <strong>{t("run.relatedMessage")}</strong>
                        <small>{t("run.openRelatedMessage")}</small>
                      </span>
                    </button> : null}
                  <div aria-label={`${t("run.agent")}: ${performedAgentName ?? t("run.unassigned")}`} className="run-property" title={t("run.agent")}>
                    <span className="run-property-icon agent"><Bot size={15} /></span>
                    <span className="run-property-copy"><strong>{performedAgentName ?? t("run.unassigned")}</strong></span>
                  </div>
                  <div aria-label={`${t("run.resultReview")}: ${resultReviews.length > 0 ? resultReviews.map(review => review.username ? `@${review.username}` : review.name).join(", ") : t("run.resultReviewEmpty")}`} className="run-property run-result-review-property" title={t("run.resultReview")}>
                    <span className="run-property-icon result-review"><BadgeCheck size={16} /></span>
                    <div className="run-property-copy">
                      <strong>{t("run.resultReview")}</strong>
                      <IssueResultReviewers compact emptyLabel={t("run.resultReviewEmpty")} reviews={resultReviews} />
                    </div>
                  </div>
                  <div aria-label={`${t("run.currentAttempt")} · ${t("run.currentRevision")}: ${t("run.attempt", {
                    count: run.currentAttempt
                  })} · ${t("run.revision", {
                    count: run.currentRevision
                  })}${executionIdentityText ? ` · ${executionIdentityText}` : ""}`} className="run-property" title={`${t("run.currentAttempt")} · ${t("run.currentRevision")}${executionIdentityText ? ` · ${executionIdentityText}` : ""}`}>
                    <span className="run-property-icon attempt"><RotateCcw size={15} /></span>
                    <span className="run-property-copy">
                      <strong>{t("run.attempt", {
                          count: run.currentAttempt
                        })} · {t("run.revision", {
                          count: run.currentRevision
                        })}</strong>
                      {executionIdentity}
                    </span>
                  </div>
                </section>
                <section>
                  <h2>{t("issue.project")}</h2>
                  {canEditProject ? <label aria-label={`${t("issue.project")}: ${projectLabel}`} className="run-property run-property-editable" title={t("issue.project")}>
                      <span className="run-property-icon project"><ProjectIcon className="run-property-project-icon" project={currentProject ?? { name: projectLabel, icon: null }} /></span>
                      <span className="run-property-copy">
                        <SelectMenu align="end" className="run-project-select" disabled={isUpdatingIssue} label={t("issue.project")} onValueChange={updateIssueProject} options={projectOptions} searchEmptyMessage={t("organization.noResults")} searchPlaceholder={t("organization.search")} searchable={projectOptions.length > 8} size="small" value={projectValue} />
                      </span>
                    </label> : <div aria-label={`${t("issue.project")}: ${projectLabel}`} className="run-property" title={t("issue.project")}>
                      <span className="run-property-icon project"><ProjectIcon className="run-property-project-icon" project={currentProject ?? { name: projectLabel, icon: null }} /></span>
                      <span className="run-property-copy"><strong>{projectLabel}</strong></span>
                    </div>}
                </section>
                <IssueDependenciesPanel availableRuns={availableRuns} issueKeyPrefix={issueKeyPrefix} isUpdating={isUpdatingIssue} onAdd={onAddDependency} onOpen={onDependencyOpen} onRemove={onRemoveDependency} run={run} />
                <section>
                  <h2>{t("run.repository")}</h2>
                  <div aria-label={`${t("run.repository")}: ${run.repository}`} className="run-property" title={t("run.repository")}>
                    <span className="run-property-icon repository"><FolderGit2 size={15} /></span>
                    <span className="run-property-copy"><strong title={run.repository}>{run.repository}</strong></span>
                  </div>
                  <div aria-label={`${t("run.source")}: ${t(`source.${run.source}` as MessageKey)}`} className="run-property" title={t("run.source")}>
                    <span className="run-property-icon source"><span className={`source-dot ${run.source}`} /></span>
                    <span className="run-property-copy"><strong>{t(`source.${run.source}` as MessageKey)}</strong></span>
                  </div>
                  <div aria-label={`${t("run.branch")}: ${run.branch ?? "—"}`} className="run-property" title={t("run.branch")}>
                    <span className="run-property-icon"><GitFork size={15} /></span>
                    <span className="run-property-copy"><strong title={run.branch ?? undefined}>{run.branch ?? "—"}</strong></span>
                  </div>
                  <div aria-label={`${t("run.commit")}: ${run.commitSha ?? "—"}`} className="run-property" title={t("run.commit")}>
                    <span className="run-property-icon"><GitCommitHorizontal size={15} /></span>
                    <span className="run-property-copy"><strong title={run.commitSha ?? undefined}>{run.commitSha ?? "—"}</strong></span>
                  </div>
                  {run.pullRequestUrls.map((url, index) => {
                    const label = pullRequestDisplayName(url, index);
                    return <a aria-label={t("run.openPullRequest", {
                      label
                    })} className="run-property run-property-link" href={url} key={url} rel="noreferrer" target="_blank" title={t("run.openPullRequest", {
                      label
                    })}>
                        <span className="run-property-icon pull-request">
                          <GitPullRequest size={15} />
                        </span>
                        <span className="run-property-copy">
                          <strong>{label}</strong>
                        </span>
                      </a>;
                  })}
                  <div aria-label={`${t("run.started")}: ${formatDate(run.startedAt, localeTag)}`} className="run-property" title={t("run.started")}>
                    <span className="run-property-icon"><Clock3 size={15} /></span>
                    <span className="run-property-copy"><strong>{formatDate(run.startedAt, localeTag)}</strong></span>
                  </div>
                  </section>
                </aside>
              </div> : null}
            </div>
          </div>
        </article>
      </div>
      <Dialog onOpenChange={open => {
      if (isDeletingIssue) return;
      setIsDeleteDialogOpen(open);
      if (!open) setDeleteError(null);
    }} open={isDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>{t("issue.deleteTitle", {
              title: run.title
            })}</DialogTitle>
            <DialogDescription>
              {t("issue.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? <p className="text-xs text-destructive" role="alert">
              {deleteError}
            </p> : null}
          <DialogFooter>
            <Button disabled={isDeletingIssue} onClick={() => setIsDeleteDialogOpen(false)} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={isDeletingIssue || !onDelete} onClick={() => {
            if (!onDelete) return;
            setDeleteError(null);
            void onDelete().catch(caught => {
              setDeleteError(caught instanceof Error ? caught.message : String(caught));
            });
          }} type="button" variant="destructive">
              {isDeletingIssue ? <Spinner size={15} /> : <Trash2 size={15} />}
              {isDeletingIssue ? t("issue.deleting") : t("issue.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={open => {
      if (isDeletingIssue) return;
      setIsTransferDialogOpen(open);
      if (!open) setTransferError(null);
    }} open={isTransferDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <FolderInput size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {t("issue.transferTitle", {
              title: run.title
            })}
            </DialogTitle>
            <DialogDescription>
              {t("issue.transferDescription")}
            </DialogDescription>
          </DialogHeader>
          {transferProjects.length === 0 ? <p className="text-sm text-muted-foreground">
              {t("issue.transferNoProjects")}
            </p> : <NativeSelect disabled={isDeletingIssue} label={t("issue.transferTarget")} onValueChange={setTransferTargetProjectId} options={transferProjects.map(project => ({
          label: project.name,
          value: project.id
        }))} placeholder={t("issue.transferTargetPlaceholder")} value={transferTargetProjectId} />}
          {transferError ? <p className="text-xs text-destructive" role="alert">
              {transferError}
            </p> : null}
          <DialogFooter>
            <Button disabled={isDeletingIssue} onClick={() => setIsTransferDialogOpen(false)} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button disabled={isDeletingIssue || !onTransfer || !transferTargetProjectId || transferProjects.length === 0} onClick={() => {
            if (!onTransfer || !transferTargetProjectId) return;
            setTransferError(null);
            void onTransfer(transferTargetProjectId).catch(caught => {
              setTransferError(caught instanceof Error ? caught.message : String(caught));
            });
          }} type="button">
              {isDeletingIssue ? <Spinner size={15} /> : <FolderInput size={15} />}
              {isDeletingIssue ? t("issue.transferring") : t("issue.transferConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>;
}
