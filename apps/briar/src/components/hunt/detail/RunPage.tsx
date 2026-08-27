import { Activity, ArrowLeft, ArrowUp, BadgeCheck, Bot, BrainCircuit, Check, ChevronRight, CircleAlert, Clock3, Columns3, FolderGit2, FolderInput, GitCommitHorizontal, GitFork, GitPullRequest, Image as ImageIcon, ListChecks, Maximize2, MessageSquare, Play, RefreshCw, RotateCcw, Signal, Trash2, UserRound, Waypoints, X } from "lucide-react";
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
import type { AgentSkillExecutionApprovalInput, AgentSkillExecutionProposal, AgentExecutionCostEstimate, ExecutionWorker, HuntEvent, HuntRun, HuntRunPlacement, IssueAttachment, IssueMessage, IssueMessageSendResult, IssueProposedAction, IssueExecutionApprovalInput, IssueExecutionProposal, IssueExecutionPreferences, OrganizationMember, Project, ProjectAgent, ProjectExecutionWorkerPolicy, RelatedMessageReference, RunEvidence, RunEvidenceImage, UpdateIssueInput } from "@/types";
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
import { IssueStatusHistoryPanel } from "./IssueStatusHistoryPanel";
import { IssueWorkflowProgress } from "./IssueWorkflowProgress";
import { RunStatusPill } from "./RunStatusPill";
import { DraftIssueDescriptionEditor } from "../editor/DraftIssueDescriptionEditor";
import { formatDate, formatExecutionUsdTicks, formatRatePerMillion, localizeEvent, localizeStatus, localizeWorkflowStage, relativeTime } from "../model/formatters";
import { placementForId, placementIdForRun, placementMatchesRun } from "../model/kanban";
import { IssueResultReviewers } from "../results/IssueResultReviewers";
import { RunEvidencePanel } from "../results/RunEvidencePanel";
import { RunResultScreenshots } from "../results/RunResultScreenshots";
import { hasResultReviews } from "../results/model";
import { cn } from "@/lib/utils";
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
  mentionMembers = [],
  mentionAgents = [],
  onMove,
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
  mentionMembers?: OrganizationMember[];
  mentionAgents?: ProjectAgent[];
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
  const executionIdentity = executionIdentityParts.length > 0 ? <span className="run-execution-identity inline-flex max-w-[34ch] min-w-0 items-center gap-1 overflow-hidden truncate align-middle text-2xs font-medium text-muted-foreground" title={executionIdentityText}>
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
    <dl className="run-result-metrics flex max-w-full items-center gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t("run.resultMetrics")}>
      {executionMetrics ? <div className="run-metric inline-flex min-w-max items-center gap-1.5 px-3 first:pl-0 [&+div]:border-l [&+div]:border-border">
          <dt className="text-3xs font-semibold text-muted-foreground">{t("run.metricsDuration")}</dt>
          <dd className="text-2xs font-medium text-foreground">{formatExecutionDuration(executionMetrics.durationMs)}</dd>
        </div> : null}
      {executionProvider ? <div className="run-metric inline-flex min-w-max items-center gap-1.5 px-3 first:pl-0 [&+div]:border-l [&+div]:border-border">
          <dt className="text-3xs font-semibold text-muted-foreground">{t("run.metricsProvider")}</dt>
          <dd className="run-result-metrics-provider inline-flex items-center gap-1.5 text-2xs font-medium text-foreground">
            <AgentProviderIcon provider={executionProvider} size={13} />
            <span>{agentProviderLabels[executionProvider]}</span>
          </dd>
        </div> : null}
      {executionProvider && executionModelText ? <div className="run-metric inline-flex min-w-max items-center gap-1.5 px-3 first:pl-0 [&+div]:border-l [&+div]:border-border">
          <dt className="text-3xs font-semibold text-muted-foreground">{t("run.metricsModel")}</dt>
          <dd className="max-w-48 truncate text-2xs font-medium text-foreground" title={executionModels.join(" · ")}>
            {executionModelText}
          </dd>
        </div> : null}
      {executionWorker ? <div className="run-metric inline-flex min-w-max items-center gap-1.5 px-3 first:pl-0 [&+div]:border-l [&+div]:border-border">
          <dt className="text-3xs font-semibold text-muted-foreground">{t("run.metricsWorker")}</dt>
          <dd className="run-result-metrics-provider inline-flex items-center gap-1.5 text-2xs font-medium text-foreground">
            <WorkerIcon icon={executionWorker.icon} size={14} />
            <span>{executionWorker.label}</span>
          </dd>
        </div> : null}
      {executionMetrics ? executionMetrics.totalTokens === null ? <div className="run-metric inline-flex min-w-max items-center gap-1.5 px-3 first:pl-0 [&+div]:border-l [&+div]:border-border">
            <dt className="text-3xs font-semibold text-muted-foreground">{t("run.metricsTotalTokens")}</dt>
            <dd className="text-2xs font-medium text-foreground">{t("run.metricsTokensUnavailable")}</dd>
          </div> : <Tooltip>
            <TooltipTrigger asChild>
              <div aria-label={`${t("run.metricsTotalTokens")} ${formatExecutionTokens(executionMetrics.totalTokens, localeTag)}`} className="run-metric run-metric-hover inline-flex min-w-max items-center gap-1.5 px-3 first:pl-0 [&+div]:border-l [&+div]:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0}>
                <dt className="text-3xs font-semibold text-muted-foreground">{t("run.metricsTotalTokens")}</dt>
                <dd className="text-2xs font-medium text-foreground">
                  {formatExecutionTokens(executionMetrics.totalTokens, localeTag)}
                </dd>
              </div>
            </TooltipTrigger>
            <TooltipContent className="run-result-metrics-tooltip text-xs">
              <ul className="grid gap-1.5">
                {executionTokenBreakdownRows.map(row => <li key={row.key}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </li>)}
              </ul>
            </TooltipContent>
          </Tooltip> : null}
      {executionCostEstimate && executionCostEstimate.pricedUsageRecords > 0 ? (() => {
        const costChip = <div className={cn("run-metric run-result-metrics-cost inline-flex min-w-max items-center gap-1.5 px-3 first:pl-0 [&+div]:border-l [&+div]:border-border", executionCostModels.length > 0 && "run-metric-hover cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} tabIndex={executionCostModels.length > 0 ? 0 : undefined}>
              <dt className="text-3xs font-semibold text-muted-foreground">
                {executionCostEstimate.status === "estimated" ? t("run.metricsEstimatedCost") : t("run.metricsPartialEstimatedCost")}
              </dt>
              <dd className="text-2xs font-medium text-foreground">
                {executionCostEstimate.status === "partial" ? "≥ " : ""}
                {formatExecutionUsdTicks(executionCostEstimate.estimatedUsdTicks ?? executionCostEstimate.pricedUsdTicks, localeTag)}
              </dd>
            </div>;
        if (executionCostModels.length === 0) return costChip;
        return <Tooltip>
              <TooltipTrigger asChild>{costChip}</TooltipTrigger>
              <TooltipContent className="run-result-metrics-tooltip text-xs">
                {executionCostModels.map(model => <div className="run-result-metrics-tooltip-model grid gap-1.5" key={`${model.pricingKey}:${model.model}`} title={model.pricingKey}>
                    <span className="run-result-metrics-tooltip-model-name font-semibold">
                      {model.model}
                    </span>
                    <span className="run-result-metrics-tooltip-model-rates grid gap-1 text-2xs text-muted-foreground">
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
  const compactProperties = <div aria-label={t("run.properties")} className="run-page-property-badges flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden" role="group">
      <SelectMenu align="start" className={cn(`run-page-property-select status ${meta.tone}`, "w-auto max-w-32 flex-none [&_.select-menu-trigger]:h-7 [&_.select-menu-trigger]:rounded-full [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:px-2.5 [&_.select-menu-trigger]:text-2xs", reviewed && "reviewed")} disabled={isRecovering} hideChevron label={t("dashboard.status")} leadingIcon={reviewed ? <BadgeCheck aria-hidden="true" className="status-pill-review-icon" size={13} /> : <Activity aria-hidden="true" size={13} />} onValueChange={value => {
      const placement = placementForId(value);
      if (!placement || placementMatchesRun(run, placement)) return;
      void runAction(() => onMove(placement));
    }} options={statusSelectOptions} size="small" title={statusBadgeTitle} value={placementValue} />
      <SelectMenu align="start" className="run-page-property-select priority w-auto max-w-32 flex-none [&_.select-menu-trigger]:h-7 [&_.select-menu-trigger]:rounded-full [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:px-2.5 [&_.select-menu-trigger]:text-2xs" disabled={isUpdatingIssue || !onUpdateIssue} hideChevron label={t("issue.priority")} leadingIcon={<Signal aria-hidden="true" size={13} />} onValueChange={updateIssuePriority} options={priorityOptions} size="small" title={t("issue.priority")} value={priorityValue} />
      {assignee && <span aria-label={`${t("issue.assignee")}: ${assignee.name}`} className="run-page-property-badge assignee inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card" title={`${t("issue.assignee")}: ${assignee.name}`}>
          <IssueAssigneeAvatar member={assignee} />
        </span>}
      {executionWorker && <span aria-label={t("run.workerAssigned", {
      worker: executionWorker.label
    })} className="run-page-property-badge worker inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card" title={t("run.workerAssigned", {
      worker: executionWorker.label
    })}>
          <WorkerIcon icon={executionWorker.icon} size={18} />
        </span>}
      {performedAgentName ? <span aria-label={`${t("run.agent")}: ${performedAgentName}`} className="run-page-property-badge agent inline-flex max-w-32 shrink-0 items-center gap-1 overflow-hidden rounded-full border border-border bg-card px-2.5 py-1 text-2xs font-semibold text-foreground" title={`${t("run.agent")}: ${performedAgentName}`}>
          <Bot aria-hidden="true" size={13} />
          {performedAgentName}
        </span> : null}
    </div>;
  const processNowLabel = t(isProcessing ? "issue.processNowRunning" : canReassign ? "worker.reassign" : "issue.processNow");
  const processNowButton = <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label={processNowLabel} className="run-page-process-now inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-primary bg-primary px-2.5 text-2xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={processNowDisabled} onClick={onProcessNow} size="icon-sm" type="button">
            {isProcessing ? <Spinner aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{processNowLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>;
  const inlineSaveLabel = t(inlineSaveStatus === "saving" ? "common.saving" : inlineSaveStatus === "failed" ? "issue.saveFailed" : "common.saved");
  const inlineSaveIndicator = onUpdateIssue ? <span aria-label={inlineSaveLabel} aria-live="polite" className={cn("run-page-save-status inline-flex min-w-max shrink-0 items-center gap-1 text-2xs font-semibold", inlineSaveStatus, inlineSaveStatus === "failed" ? "text-destructive" : inlineSaveStatus === "saving" ? "text-muted-foreground" : "text-emerald-600")} role="status" title={inlineSaveLabel}>
      {inlineSaveStatus === "saving" ? <Spinner aria-hidden="true" size={13} /> : inlineSaveStatus === "failed" ? <CircleAlert aria-hidden="true" size={13} /> : <Check aria-hidden="true" size={13} />}
      {inlineSaveStatus === "saved" ? null : <span>{inlineSaveLabel}</span>}
    </span> : null;
  return <MainContent className="run-page-shell flex min-h-0 flex-1 flex-col overflow-hidden" id="issue-detail">
      {!companionMode && <header className={cn("topbar flex min-h-12 items-center gap-2 border-b border-border bg-card px-[18px]", !isSidebarOpen && "sidebar-closed")} data-tauri-drag-region="deep">
          <Button aria-label={t("run.back")} className="run-page-titlebar-back inline-grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={onBack} size="icon-sm" title={t("run.back")} type="button" variant="ghost">
            <ArrowLeft aria-hidden="true" size={16} />
          </Button>
          <small className="run-page-window-number shrink-0 font-mono text-sm font-medium text-primary">
            {formatIssueKey(issueKeyPrefix, run.runNumber)}
          </small>
          <input aria-label={t("issue.title")} className="run-page-window-title run-page-inline-title min-w-0 flex-1 overflow-hidden rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold leading-tight tracking-tight text-foreground outline-none transition-colors hover:border-border hover:bg-card focus:border-primary/50 focus:bg-card focus:ring-2 focus:ring-primary/15 read-only:pointer-events-none" id="run-page-title" maxLength={issueTitleInputMaxLength(inlineTitle, locale)} onChange={event => setInlineTitle(event.currentTarget.value)} onKeyDown={leaveInlineEditing} readOnly={!onUpdateIssue} title={inlineTitle} value={inlineTitle} />
          {inlineSaveIndicator}
          <div className="run-page-titlebar-actions ml-auto flex min-w-0 items-center justify-end gap-2">
            {compactProperties}
            <span aria-hidden="true" className="run-page-titlebar-divider h-[18px] w-px shrink-0 bg-border" />
            <div className="run-page-titlebar-tools flex shrink-0 items-center gap-1">
              {processNowButton}
              {onOpenFullPage ? <button aria-label={t("inbox.openFullPage")} className="run-page-tool-button run-page-open-full-page inline-grid size-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpenFullPage} title={t("inbox.openFullPage")} type="button">
                  <Maximize2 aria-hidden="true" size={15} />
                </button> : null}
              <button aria-controls="run-properties-panel" aria-expanded={isPropertiesOpen} aria-label={t("run.properties")} className="run-page-tool-button run-page-properties-toggle inline-grid size-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setIsPropertiesOpen(open => !open)} title={t("run.properties")} type="button">
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
      <div className="run-page-scroll min-h-0 flex-1 overflow-hidden bg-background">
        <article aria-labelledby="run-page-title" className="run-page flex h-full min-h-0 w-full flex-col bg-card">
          {companionMode ? <header className="border-b border-border px-3 py-2">
              <div className="run-page-heading grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                <button className="run-page-back inline-flex w-max items-center gap-1 rounded-lg px-1.5 py-1 text-2xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onBack} type="button">
                  <ArrowLeft size={16} />
                  {t("run.back")}
                </button>
                <div className="run-page-overview grid min-w-0 gap-1.5">
                  <div className="run-page-title-row flex min-w-0 items-baseline gap-2.5">
                    <small className="shrink-0 font-mono text-2xs font-medium text-primary">{formatIssueKey(issueKeyPrefix, run.runNumber)}</small>
                    <input aria-label={t("issue.title")} className="run-page-inline-title min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold leading-tight tracking-tight text-foreground outline-none transition-colors hover:border-border hover:bg-card focus:border-primary/50 focus:bg-card focus:ring-2 focus:ring-primary/15 read-only:pointer-events-none" id="run-page-title" maxLength={issueTitleInputMaxLength(inlineTitle, locale)} onChange={event => setInlineTitle(event.currentTarget.value)} onKeyDown={leaveInlineEditing} readOnly={!onUpdateIssue} value={inlineTitle} />
                    {inlineSaveIndicator}
                    <IssueActionsMenu disabled={isDeletingIssue || isRecovering} mutatingDisabled={isUpdatingIssue} onCancel={canCancelRemoteExecution ? () => void runAction(onCancel) : undefined} onUnassign={canUnassign ? () => void runAction(() => onUnassignRun!(run.id)) : undefined} onDelete={onDelete ? () => setIsDeleteDialogOpen(true) : undefined} onTransfer={onTransfer ? () => {
                  setTransferError(null);
                  setTransferTargetProjectId(transferProjects[0]?.id ?? "");
                  setIsTransferDialogOpen(true);
                } : undefined} onShare={() => void shareIssue()} />
                  </div>
                </div>
                <div className="run-page-companion-actions col-span-2 flex min-w-0 items-center gap-2">
                  {compactProperties}
                  <span aria-hidden="true" className="run-page-titlebar-divider h-[18px] w-px shrink-0 bg-border" />
                  <div className="run-page-titlebar-tools flex shrink-0 items-center gap-1">
                    {processNowButton}
                    <button aria-controls="run-properties-panel" aria-expanded={isPropertiesOpen} aria-label={t("run.properties")} className="run-page-tool-button run-page-properties-toggle inline-grid size-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setIsPropertiesOpen(open => !open)} title={t("run.properties")} type="button">
                      <Columns3 aria-hidden="true" size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </header> : null}
          <div className="run-page-body min-h-0 w-full flex-1 overflow-hidden">
            <div className={cn("run-page-layout relative grid h-full min-h-0 grid-cols-[minmax(0,2fr)_6px_var(--run-conversation-pane-width,minmax(340px,1fr))] items-stretch", usesConversationTab && "is-conversation-tabbed grid-cols-[minmax(0,1fr)]", isResizingConversation && "is-resizing-conversation cursor-col-resize select-none")} ref={runPageLayoutRef} style={conversationPaneWidth === null || usesConversationTab ? undefined : {
            "--run-conversation-pane-width": `${conversationPaneWidth}%`
          } as React.CSSProperties}>
              <div className="run-page-main flex min-h-0 min-w-0 flex-col overflow-hidden">
                <div aria-label={t("run.detailTabs")} className="issue-detail-tabs flex min-h-12 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
                  <button aria-controls={`${detailTabsId}-description-panel`} aria-selected={activeDetailTab === "description"} className="relative flex h-12 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:text-accent-foreground aria-selected:after:bg-primary" id={`${detailTabsId}-description-tab`} onClick={() => selectDetailTab("description")} role="tab" type="button">
                    {t("run.issue")}
                  </button>
                  <button aria-controls={`${detailTabsId}-result-panel`} aria-selected={activeDetailTab === "result"} className="relative flex h-12 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:text-accent-foreground aria-selected:after:bg-primary" id={`${detailTabsId}-result-tab`} onClick={() => selectDetailTab("result")} role="tab" type="button">
                    {t("run.resultTab")}
                  </button>
                  <button aria-controls={`${detailTabsId}-evidence-panel`} aria-selected={activeDetailTab === "evidence"} className="relative flex h-12 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:text-accent-foreground aria-selected:after:bg-primary" id={`${detailTabsId}-evidence-tab`} onClick={() => selectDetailTab("evidence")} role="tab" type="button">
                    {t("run.evidence")}
                  </button>
                  <button aria-controls={`${detailTabsId}-agent-activity-panel`} aria-selected={activeDetailTab === "agentActivity"} className="relative flex h-12 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:text-accent-foreground aria-selected:after:bg-primary" id={`${detailTabsId}-agent-activity-tab`} onClick={() => selectDetailTab("agentActivity")} role="tab" type="button">
                    {t("run.agentActivity")}
                  </button>
                  <button aria-controls={`${detailTabsId}-status-history-panel`} aria-selected={activeDetailTab === "statusHistory"} className="relative flex h-12 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:text-accent-foreground aria-selected:after:bg-primary" id={`${detailTabsId}-status-history-tab`} onClick={() => selectDetailTab("statusHistory")} role="tab" type="button">
                    {t("run.status")}
                  </button>
                  {usesConversationTab ? <button aria-controls={`${detailTabsId}-conversation-panel`} aria-selected={activeDetailTab === "conversation"} className="relative flex h-12 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-transparent hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:text-accent-foreground aria-selected:after:bg-primary" id={`${detailTabsId}-conversation-tab`} onClick={() => selectDetailTab("conversation")} role="tab" type="button">
                      {t("run.messages")}
                    </button> : null}
                </div>
                <div className="run-page-content flex min-h-0 w-full flex-1 flex-col overflow-hidden px-5 pb-[22px] pl-6 pt-4 max-[760px]:px-3">
                <section aria-label={t(activeDetailTab === "description" ? "run.issue" : activeDetailTab === "result" ? "run.result" : activeDetailTab === "agentActivity" ? "run.agentActivity" : activeDetailTab === "statusHistory" ? "run.status" : "run.evidence")} className="issue-description-pane flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden" hidden={activeDetailTab === "conversation"}>
                  {activeDetailTab === "description" ? <div aria-labelledby={`${detailTabsId}-description-tab`} className="issue-description-scroll scrollbar-subtle flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain pb-2 pl-0 pr-1.5 pt-2" id={`${detailTabsId}-description-panel`} role="tabpanel">
                      {run.status === "blocked" ? <section aria-labelledby={`${detailTabsId}-blocked-title`} className="blocked-issue-card mb-3.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 shadow-sm" role="alert">
                          <div className="blocked-issue-card-heading flex items-center gap-2 text-destructive">
                            <CircleAlert aria-hidden="true" size={18} />
                            <strong id={`${detailTabsId}-blocked-title`}>
                              {t("run.blocked")}
                            </strong>
                          </div>
                          <dl className="mt-3 grid gap-2.5">
                            <div className="grid grid-cols-[minmax(86px,auto)_minmax(0,1fr)] items-start gap-2.5">
                              <dt className="text-2xs font-bold text-destructive">{t("run.blockedReason")}</dt>
                              <dd className="m-0 min-w-0 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">{blockerReason}</dd>
                            </div>
                            <div className="grid grid-cols-[minmax(86px,auto)_minmax(0,1fr)] items-start gap-2.5">
                              <dt className="text-2xs font-bold text-destructive">{t("run.blockedResolution")}</dt>
                              <dd className="m-0 min-w-0 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">{unblockAction}</dd>
                            </div>
                          </dl>
                          {blockerDetails ? <details className="blocked-issue-details mt-3 border-t border-destructive/20 pt-2.5">
                              <summary className="flex w-max max-w-full cursor-pointer list-none items-center gap-1 text-2xs font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <ChevronRight aria-hidden="true" size={14} />
                                {t("run.blockedDetails")}
                              </summary>
                              <p className="mt-2 rounded-lg bg-muted/70 p-2.5 font-mono text-2xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{blockerDetails}</p>
                            </details> : null}
                          <div className="recovery-actions mt-3 flex justify-end gap-1.5">
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
                                <button className="danger inline-flex min-h-8 items-center gap-1.5 rounded-md border border-destructive bg-destructive px-2.5 text-2xs font-semibold text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isRecovering} onClick={() => void runAction(onCancel)} type="button">
                                  {t("run.confirmCancel")}
                                </button>
                                <button className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isRecovering} onClick={() => setConfirmCancel(false)} type="button">
                                  {t("run.back")}
                                </button>
                              </> : <button className="danger-secondary inline-flex min-h-8 items-center gap-1.5 rounded-md border border-destructive/50 bg-card px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isRecovering} onClick={() => setConfirmCancel(true)} type="button">
                                {t("run.cancel")}
                              </button>}
                          </div>
                        </section> : null}
                      {onUpdateIssue ? <DraftIssueDescriptionEditor attachments={editableIssueAttachments} autoSizeTextFields className="issue-description-inline-editor" description={inlineDescription} editorRef={inlineDescriptionEditorRef} label={t("issue.description")} onChange={setInlineDescription} onKeyDown={leaveInlineEditing} onLoadAttachment={onLoadAttachment} onRemoveAttachment={reference => {
                      setInlineKeptAttachmentIds(current => current.filter(attachmentId => attachmentId !== reference));
                      setInlineDescription(current => removeIssueAttachmentMarkdown(current, reference));
                    }} placeholder={t("issue.descriptionPlaceholder")} removeLabel={name => t("issue.remove", {
                      name
                      })} /> : issueContent ? <MarkdownContent className="issue-description-markdown markdown-content min-w-0 text-xs leading-[1.7] text-foreground [overflow-wrap:anywhere]" components={{
                      img: renderIssueMarkdownImage
                    }} urlTransform={(url, key) => key === "src" && issueAttachmentReference(url) ? url : defaultMarkdownUrlTransform(url)}>
                          {issueContent}
                        </MarkdownContent> : <p className="issue-description-empty m-0 text-2xs text-muted-foreground">{t("run.notSet")}</p>}
                      {remainingAttachments.length > 0 && <IssueAttachmentGallery attachments={remainingAttachments} onLoadAttachment={onLoadAttachment} />}
                      {needsAttention && !["blocked", "paused"].includes(run.status) ? <div className="recovery-panel mt-[18px] rounded-xl border border-destructive/40 bg-destructive/10 p-3.5">
                          <div className="flex items-start gap-2 text-destructive">
                            <CircleAlert size={16} />
                            <span className="grid gap-0.5">
                              <strong className="text-xs text-foreground">{t("run.failed")}</strong>
                              <small className="text-2xs leading-relaxed text-muted-foreground">
                                {t("run.retryDescription", {
                              count: run.currentAttempt + 1
                            })}
                              </small>
                            </span>
                          </div>
                          <div className="recovery-actions mt-3 flex justify-end gap-1.5">
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
                                <button className="danger inline-flex min-h-8 items-center gap-1.5 rounded-md border border-destructive bg-destructive px-2.5 text-2xs font-semibold text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isRecovering} onClick={() => void runAction(onCancel)} type="button">
                                  {t("run.confirmCancel")}
                                </button>
                                <button className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isRecovering} onClick={() => setConfirmCancel(false)} type="button">
                                  {t("run.back")}
                                </button>
                              </> : <button className="danger-secondary inline-flex min-h-8 items-center gap-1.5 rounded-md border border-destructive/50 bg-card px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isRecovering} onClick={() => setConfirmCancel(true)} type="button">
                                {t("run.cancel")}
                              </button>}
                          </div>
                        </div> : null}
                    </div> : activeDetailTab === "result" ? <div aria-labelledby={`${detailTabsId}-result-tab`} className="run-result-panel scrollbar-subtle min-h-0 w-full flex-1 overflow-y-auto overscroll-contain p-1.5" id={`${detailTabsId}-result-panel`} role="tabpanel">
                      {run.status === "paused" ? <section aria-labelledby={`${detailTabsId}-paused-result-title`} className="completed-issue-card paused-result-card mb-3.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 shadow-sm" role="status">
                          <div className="completed-issue-card-heading flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                            <RunStatusPill as="span" label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
                            <strong id={`${detailTabsId}-paused-result-title`}>
                              {t("run.partialResult")}
                            </strong>
                            <small className="ml-auto min-w-0 truncate font-mono text-2xs font-medium text-muted-foreground">
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
                          <div className="paused-review-content grid gap-3">
                            <section className="paused-review-section paused-review-result grid gap-2.5">
                              <header className="flex items-start justify-between gap-3">
                                <div>
                                  <strong className="text-xs font-semibold text-foreground">{t("run.reviewWorkResult")}</strong>
                                  <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.reviewWorkResultDescription")}</p>
                                </div>
                              </header>
                              {pausedPartialSummary ? <MarkdownContent className="completed-issue-summary paused-result-summary markdown-content min-w-0 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
                                  {pausedPartialSummary}
                                </MarkdownContent> : <div className="completed-issue-summary paused-result-summary">
                                  <ul>
                                    {pausedResultItems.map(item => <li key={item}>{item}</li>)}
                                  </ul>
                                </div>}
                              {run.structuredResult?.nextAction ? <div className="completed-issue-next-action grid gap-1 border-t border-primary/20 pt-2.5">
                                  <strong className="text-2xs font-semibold text-foreground">{t("run.resultNextAction")}</strong>
                                  <span className="text-2xs leading-relaxed text-foreground">{run.structuredResult.nextAction}</span>
                                </div> : null}
                              <RunResultScreenshots onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} runId={run.id} />
                            </section>
                          </div>
                          {run.pullRequestUrls.length > 0 ? <div className="run-result-links mt-3 flex flex-wrap gap-2">
                              {run.pullRequestUrls.map((url, index) => {
                          const pullRequestLabel = pullRequestDisplayName(url, index);
                          return <a href={url} key={url} rel="noreferrer" target="_blank">
                                    <GitPullRequest aria-hidden="true" size={14} />
                                    {pullRequestLabel}
                                    <ArrowUp aria-hidden="true" size={13} />
                                  </a>;
                        })}
                            </div> : null}
                          <div className="paused-result-actions flex flex-wrap gap-2">
                            <button className="paused-result-resume inline-flex min-h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-2xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={resumeIsPending} onClick={() => void resumePausedRun()} type="button">
                              {resumeIsPending ? <Spinner aria-hidden="true" size={14} /> : <RotateCcw aria-hidden="true" size={14} />}
                              {t("run.resume")}
                            </button>
                            {onRework && reworkStageOptions.length > 0 ? <button aria-expanded={isReworkFormOpen} className="paused-result-rework inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isRecovering || isSubmittingRework} onClick={() => isReworkFormOpen ? setIsReworkFormOpen(false) : openReworkForm()} type="button">
                                <GitFork aria-hidden="true" size={14} />
                                {t("run.requestRework")}
                              </button> : null}
                            <button className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setActiveDetailTab("evidence")} type="button">
                              <ImageIcon aria-hidden="true" size={14} />
                              {t("run.viewResultEvidence")}
                            </button>
                          </div>
                          {isReworkFormOpen ? <form className="paused-rework-form grid gap-3 rounded-lg border border-border bg-muted/40 p-3" onSubmit={event => void submitRework(event)}>
                              <div className="paused-rework-heading">
                                <strong className="text-xs font-semibold text-foreground">{t("run.reworkTitle")}</strong>
                                <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.reworkDescription")}</p>
                              </div>
                              <label className="grid gap-1.5 text-2xs font-semibold text-foreground">
                                <span>{t("run.reworkStage")}</span>
                                <SelectMenu disabled={isSubmittingRework} label={t("run.reworkStage")} onValueChange={setReworkStage} options={reworkStageOptions} size="small" value={reworkStage} />
                              </label>
                              <label className="grid gap-1.5 text-2xs font-semibold text-foreground">
                                <span>{t("run.reworkFeedback")}</span>
                                <textarea className="min-h-20 resize-y rounded-md border border-border bg-card px-2.5 py-2 text-xs font-normal text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15" autoFocus disabled={isSubmittingRework} maxLength={4_000} onChange={event => setReworkFeedback(event.target.value)} placeholder={t("run.reworkFeedbackPlaceholder")} rows={4} value={reworkFeedback} />
                              </label>
                              {reworkError ? <p className="paused-rework-error m-0 text-2xs text-destructive" role="alert">
                                  {reworkError}
                                </p> : null}
                              <div className="paused-rework-submit-actions flex justify-end gap-2">
                                <button className="inline-flex min-h-8 items-center rounded-md border border-border bg-card px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isSubmittingRework} onClick={() => setIsReworkFormOpen(false)} type="button">
                                  {t("common.cancel")}
                                </button>
                                <button className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-2xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={isSubmittingRework || !reworkStage || !reworkFeedback.trim()} type="submit">
                                  {isSubmittingRework ? <Spinner aria-hidden="true" size={14} /> : <GitFork aria-hidden="true" size={14} />}
                                  {t(isSubmittingRework ? "run.reworkSubmitting" : "run.reworkSubmit")}
                                </button>
                              </div>
                            </form> : null}
                          <div className="paused-review-content grid gap-3">
                            <section aria-busy={runEventsLoading} className="paused-review-section paused-review-work grid gap-2.5">
                              <header className="flex items-start justify-between gap-3">
                                <div>
                                  <strong className="text-xs font-semibold text-foreground">{t("run.reviewWorkHistory")}</strong>
                                  <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.reviewWorkHistoryDescription")}</p>
                                </div>
                                {!runEventsLoading && !runEventsLoadError ? <small className="shrink-0 text-2xs text-muted-foreground">
                                    {t("run.activityCount", {
                                count: pausedReviewEvents.length
                              })}
                                  </small> : null}
                              </header>
                              {runEventsLoading ? <div className="paused-review-state flex min-h-20 items-center justify-center gap-2 text-2xs text-muted-foreground">
                                  <Spinner size={15} />
                                  {t("run.activityLoading")}
                                </div> : runEventsLoadError ? <button className="paused-review-state error flex min-h-20 w-full items-center justify-center gap-2 rounded-lg border-0 bg-destructive/10 text-2xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void loadRunEvents()} type="button">
                                  <CircleAlert size={14} />
                                  <span>{runEventsLoadError}</span>
                                  <RefreshCw size={13} />
                                </button> : pausedReviewEvents.length > 0 ? <div className="paused-review-timeline grid gap-3">
                                  {pausedReviewEvents.map(event => {
                              const display = eventMeta(event.status, event.workflowStage, run.workflow);
                              return <div className="paused-review-event flex items-start gap-2.5" key={event.id}>
                                        <i className={cn("mt-1.5 size-2 shrink-0 rounded-full", display.tone === "emerald" ? "bg-emerald-500" : display.tone === "rose" || display.tone === "red" ? "bg-rose-500" : display.tone === "amber" || display.tone === "orange" ? "bg-amber-500" : "bg-primary")} />
                                        <div className="min-w-0">
                                          <strong className="text-2xs font-semibold text-foreground">
                                            {localizeEvent(t, event.status, event.workflowStage, display.label)}
                                          </strong>
                                          {event.detail ? <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{event.detail}</p> : null}
                                          <small className="font-mono text-2xs text-muted-foreground">
                                            {event.actorName ?? event.actor} · {relativeTime(event.occurredAt, t)}
                                          </small>
                                        </div>
                                      </div>;
                            })}
                                </div> : <p className="paused-review-empty m-0 py-5 text-center text-2xs text-muted-foreground">
                                  {t("run.activityEmpty")}
                                </p>}
                            </section>
                          </div>
                        </section> : completionSummary ? <section aria-labelledby={`${detailTabsId}-result-title`} className="completed-issue-card mb-3.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 shadow-sm">
                          <div className="completed-issue-card-heading flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                            <RunStatusPill as="span" label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
                            <strong id={`${detailTabsId}-result-title`}>
                              {t("run.result")}
                            </strong>
                            <small className="ml-auto min-w-0 truncate font-mono text-2xs font-medium text-muted-foreground">
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
                          <MarkdownContent className="completed-issue-summary markdown-content min-w-0 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
                            {completionSummary}
                          </MarkdownContent>
                          {run.structuredResult?.humanActionRequired && run.structuredResult.nextAction ? <div className="completed-issue-next-action grid gap-1 border-t border-primary/20 pt-2.5">
                              <strong className="text-2xs font-semibold text-foreground">{t("run.resultNextAction")}</strong>
                              <span className="text-2xs leading-relaxed text-foreground">{run.structuredResult.nextAction}</span>
                            </div> : null}
                          <RunResultScreenshots onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} runId={run.id} />
                          {run.pullRequestUrls.length > 0 ? <div className="run-result-links mt-3 flex flex-wrap gap-2">
                              {run.pullRequestUrls.map((url, index) => {
                          const pullRequestLabel = pullRequestDisplayName(url, index);
                          return <a href={url} key={url} rel="noreferrer" target="_blank">
                                    <GitPullRequest aria-hidden="true" size={14} />
                                    {pullRequestLabel}
                                    <ArrowUp aria-hidden="true" size={13} />
                                  </a>;
                        })}
                            </div> : null}
                          <div className="run-result-review mt-3 border-t border-border pt-3">
                            <div className="run-result-review-heading flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-2xs font-semibold text-foreground">
                                <BadgeCheck aria-hidden="true" size={17} />
                                <strong>{t("run.resultReview")}</strong>
                              </span>
                              <small className="text-2xs text-muted-foreground">
                                {t("run.resultReviewerCount", {
                              count: resultReviews.length
                            })}
                              </small>
                            </div>
                            <IssueResultReviewers emptyLabel={t("run.resultReviewEmpty")} reviews={resultReviews} />
                            {currentUserId && onCompleteResultReview ? <button className="run-result-review-complete mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-2xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={currentUserHasReviewed || isCompletingResultReview} onClick={() => void completeResultReview()} type="button">
                                {isCompletingResultReview ? <Spinner aria-hidden="true" size={15} /> : <Check aria-hidden="true" size={15} />}
                                {t(isCompletingResultReview ? "run.resultReviewSaving" : currentUserHasReviewed ? "run.resultReviewed" : "run.resultReviewComplete")}
                              </button> : null}
                            {resultReviewError ? <p className="run-result-review-error mt-2 text-2xs text-destructive" role="alert">
                                {resultReviewError}
                              </p> : null}
                          </div>
                          <button className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-2xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setActiveDetailTab("evidence")} type="button">
                            <ImageIcon aria-hidden="true" size={14} />
                            {t("run.viewResultEvidence")}
                          </button>
                        </section> : <div className="run-result-empty flex min-h-56 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                          <ListChecks aria-hidden="true" size={20} />
                          <strong className="text-sm text-foreground">{t("run.result")}</strong>
                          <p className="m-0 max-w-[420px] text-xs leading-relaxed">{run.detail?.trim() || t("run.resultEmpty")}</p>
                          {executionMetricsPanel}
                        </div>}
                      {run.status !== "paused" && !completionSummary ? <RunResultScreenshots onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} runId={run.id} /> : null}
                    </div> : activeDetailTab === "agentActivity" ? <IssueAgentActivityPanel activity={agentActivity} error={workerEvents.error} id={`${detailTabsId}-agent-activity-panel`} isLive={workerExecutionIsLive && hasWorkerExecution} labelledBy={`${detailTabsId}-agent-activity-tab`} loading={workerEvents.isLoading} provider={activityProvider} /> : activeDetailTab === "statusHistory" ? <IssueStatusHistoryPanel events={runEvents} id={`${detailTabsId}-status-history-panel`} labelledBy={`${detailTabsId}-status-history-tab`} loadError={runEventsLoadError} loading={runEventsLoading} onRetry={() => void loadRunEvents()} workflow={run.workflow} /> : <RunEvidencePanel id={`${detailTabsId}-evidence-panel`} labelledBy={`${detailTabsId}-evidence-tab`} onLoad={onLoadRunEvidence} onLoadImage={onLoadRunEvidenceImage} run={run} />}
                </section>
                {usesConversationTab ? <div aria-labelledby={`${detailTabsId}-conversation-tab`} className="issue-conversation-tab-panel min-h-0 flex-1 overflow-hidden" hidden={activeDetailTab !== "conversation"} id={`${detailTabsId}-conversation-panel`} role="tabpanel">
                    <IssueConversation currentUserId={currentUserId} executionRuns={availableRuns} inboxSyncSignal={conversationInboxSyncSignal} mentionMembers={mentionMembers} mentionAgents={mentionAgents} onAcceptIssueAction={onAcceptIssueAction} onAcceptIssueExecution={onAcceptIssueExecution} onAcceptSkillExecution={onAcceptSkillExecution} executionPolicy={executionPolicy} executionWorkers={executionWorkers} onDelete={onDeleteIssueMessage} onEdit={onEditIssueMessage} onIssueOpen={onDependencyOpen} onLoadAttachment={onLoadAttachment} onLoad={onLoadIssueMessages} onSend={onSendIssueMessage} onUpdateSubscription={onUpdateIssueSubscription} organizationId={organizationId} run={run} projectId={projectId} token={token} showsScrollToLatest={companionMode} />
                  </div> : null}
                </div>
                <IssueWorkflowProgress onCheckpointsChange={onUpdateIssueCheckpoints} run={run} />
              </div>
              {!usesConversationTab ? <>
                  <div aria-label={t("run.resizeContentPanels")} aria-orientation="vertical" aria-valuemax={conversationPaneWidthMax} aria-valuemin={conversationPaneWidthMin} aria-valuenow={effectiveConversationPaneWidth} className="run-page-conversation-resizer relative z-[1] min-h-0 w-[6px] cursor-col-resize touch-none bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring" role="separator" tabIndex={0} {...conversationResizeProps} />
                  <IssueConversation currentUserId={currentUserId} executionRuns={availableRuns} inboxSyncSignal={conversationInboxSyncSignal} mentionMembers={mentionMembers} mentionAgents={mentionAgents} onAcceptIssueAction={onAcceptIssueAction} onAcceptIssueExecution={onAcceptIssueExecution} onAcceptSkillExecution={onAcceptSkillExecution} executionPolicy={executionPolicy} executionWorkers={executionWorkers} onDelete={onDeleteIssueMessage} onEdit={onEditIssueMessage} onIssueOpen={onDependencyOpen} onLoadAttachment={onLoadAttachment} onLoad={onLoadIssueMessages} onSend={onSendIssueMessage} onUpdateSubscription={onUpdateIssueSubscription} organizationId={organizationId} run={run} projectId={projectId} token={token} showsScrollToLatest={companionMode} />
                </> : null}
              {isPropertiesOpen ? <div className="run-properties-layer absolute inset-0 z-10" onClick={event => {
              if (event.target === event.currentTarget) {
                setIsPropertiesOpen(false);
              }
            }}>
                <aside aria-label={t("run.properties")} className="run-properties absolute right-0 top-0 z-10 grid h-full min-h-0 w-[min(310px,100%)] min-w-0 content-start gap-6 overflow-y-auto overscroll-contain border-l border-border bg-card px-4 pb-5 shadow-[-16px_0_40px_rgba(0,0,0,0.12)]" id="run-properties-panel">
                  <header className="run-properties-header sticky top-0 z-[1] flex min-h-12 items-center justify-between border-b border-border bg-card">
                    <h2 className="m-0 text-base font-semibold tracking-tight text-foreground">{t("run.properties")}</h2>
                    <button aria-label={t("common.close")} className="inline-grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setIsPropertiesOpen(false)} type="button">
                      <X aria-hidden="true" size={16} />
                    </button>
                  </header>
                  <section>
                  <label className="run-property run-status-control grid min-h-10 grid-cols-[24px_minmax(0,1fr)_14px] items-center gap-2.5 rounded-lg">
                    <span className={cn("run-property-icon grid size-6 place-items-center text-muted-foreground", meta.tone === "emerald" ? "text-emerald-600" : meta.tone === "rose" || meta.tone === "red" ? "text-destructive" : meta.tone === "amber" || meta.tone === "orange" ? "text-amber-600" : meta.tone === "violet" ? "text-primary" : "text-muted-foreground")}><Activity size={15} /></span>
                    <span className="run-property-copy grid min-w-0">
                      <SelectMenu align="end" className="run-status-select" disabled={isRecovering} label={t("dashboard.status")} onValueChange={value => {
                        const placement = placementForId(value);
                        if (!placement || placementMatchesRun(run, placement)) return;
                        void runAction(() => onMove(placement));
                      }} options={statusSelectOptions} size="small" value={placementValue} />
                    </span>
                    {isRecovering && <Spinner size={14} />}
                  </label>
                  <label className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg">
                    <span className="run-property-icon priority grid size-6 place-items-center text-amber-600"><Signal size={15} /></span>
                    <span className="run-property-copy grid min-w-0 flex-1">
                      <SelectMenu align="end" className="run-priority-select [&_.select-menu-trigger]:w-full" disabled={isUpdatingIssue || !onUpdateIssue} label={t("issue.priority")} onValueChange={updateIssuePriority} options={priorityOptions} size="small" value={priorityValue} />
                    </span>
                  </label>
                  <label className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg">
                    <span className="run-property-icon provider grid size-6 place-items-center text-primary">
                      <Waypoints size={15} />
                    </span>
                    <span className="run-property-copy grid min-w-0 flex-1">
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
                  <label className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg">
                    <span className="run-property-icon model grid size-6 place-items-center text-primary">
                      <BrainCircuit size={15} />
                    </span>
                    <span className="run-property-copy grid min-w-0 flex-1">
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
                  <label className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg">
                    <span className="run-property-icon effort grid size-6 place-items-center text-primary">
                      <BrainCircuit size={15} />
                    </span>
                    <span className="run-property-copy grid min-w-0 flex-1">
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
                  {run.fullAuto ? <div aria-label={`${t("issue.fullAuto")}: ${t("issue.fullAutoDescription")}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("issue.fullAutoDescription")}>
                      <span className="run-property-icon agent grid size-6 place-items-center text-primary">
                        <Bot size={15} />
                      </span>
                      <span className="run-property-copy grid min-w-0">
                        <strong className="truncate text-sm font-medium text-foreground">{t("issue.fullAuto")}</strong>
                      </span>
                    </div> : null}
                  <div aria-label={`${t("issue.assignee")}: ${assignee?.name ?? t("run.unassigned")}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("issue.assignee")}>
                    <span className="run-property-icon assignee grid size-6 place-items-center text-muted-foreground"><UserRound size={15} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground">{assignee?.name ?? t("run.unassigned")}</strong></span>
                  </div>
                  <div aria-label={`${t("run.creator")}: ${creator?.name ?? t("run.creatorUnknown")}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("run.creator")}>
                    <span className="run-property-icon assignee grid size-6 place-items-center text-muted-foreground"><UserRound size={15} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground">{creator?.name ?? t("run.creatorUnknown")}</strong></span>
                  </div>
                  {run.relatedMessage && onRelatedMessageOpen ? <button aria-label={t("run.openRelatedMessage")} className="run-property run-property-button run-related-message-property grid min-h-10 min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 rounded-lg border-0 bg-transparent p-0 text-left" onClick={() => onRelatedMessageOpen(run.relatedMessage!)} title={t("run.openRelatedMessage")} type="button">
                      <span className="run-property-icon related-message grid size-6 place-items-center text-emerald-600"><MessageSquare size={15} /></span>
                      <span className="run-property-copy grid min-w-0 gap-0.5">
                        <strong className="truncate text-sm font-medium text-foreground">{t("run.relatedMessage")}</strong>
                        <small className="truncate text-2xs text-muted-foreground">{t("run.openRelatedMessage")}</small>
                      </span>
                    </button> : null}
                  <div aria-label={`${t("run.agent")}: ${performedAgentName ?? t("run.unassigned")}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("run.agent")}>
                    <span className="run-property-icon agent grid size-6 place-items-center text-primary"><Bot size={15} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground">{performedAgentName ?? t("run.unassigned")}</strong></span>
                  </div>
                  <div aria-label={`${t("run.resultReview")}: ${resultReviews.length > 0 ? resultReviews.map(review => review.username ? `@${review.username}` : review.name).join(", ") : t("run.resultReviewEmpty")}`} className="run-property run-result-review-property flex min-w-0 items-start gap-2.5 rounded-lg py-1.5" title={t("run.resultReview")}>
                    <span className="run-property-icon result-review mt-0.5 grid size-6 place-items-center text-emerald-600"><BadgeCheck size={16} /></span>
                    <div className="run-property-copy grid min-w-0 gap-1.5">
                      <strong className="text-sm font-medium text-foreground">{t("run.resultReview")}</strong>
                      <IssueResultReviewers compact emptyLabel={t("run.resultReviewEmpty")} reviews={resultReviews} />
                    </div>
                  </div>
                  <div aria-label={`${t("run.currentAttempt")} · ${t("run.currentRevision")}: ${t("run.attempt", {
                    count: run.currentAttempt
                  })} · ${t("run.revision", {
                    count: run.currentRevision
                  })}${executionIdentityText ? ` · ${executionIdentityText}` : ""}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={`${t("run.currentAttempt")} · ${t("run.currentRevision")}${executionIdentityText ? ` · ${executionIdentityText}` : ""}`}>
                    <span className="run-property-icon attempt grid size-6 place-items-center text-muted-foreground"><RotateCcw size={15} /></span>
                    <span className="run-property-copy grid min-w-0">
                      <strong className="text-sm font-medium text-foreground">{t("run.attempt", {
                          count: run.currentAttempt
                        })} · {t("run.revision", {
                          count: run.currentRevision
                        })}</strong>
                      {executionIdentity}
                    </span>
                  </div>
                </section>
                <IssueDependenciesPanel availableRuns={availableRuns} issueKeyPrefix={issueKeyPrefix} isUpdating={isUpdatingIssue} onAdd={onAddDependency} onOpen={onDependencyOpen} onRemove={onRemoveDependency} run={run} />
                <section className="grid min-w-0 gap-0.5">
                  <h2 className="m-0 text-base font-semibold tracking-tight text-foreground">{t("run.repository")}</h2>
                  <div aria-label={`${t("run.repository")}: ${run.repository}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("run.repository")}>
                    <span className="run-property-icon repository grid size-6 place-items-center text-primary"><FolderGit2 size={15} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground" title={run.repository}>{run.repository}</strong></span>
                  </div>
                  <div aria-label={`${t("run.source")}: ${t(`source.${run.source}` as MessageKey)}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("run.source")}>
                    <span className="run-property-icon source grid size-6 place-items-center"><span className={cn("source-dot size-2 shrink-0 rounded-full", run.source === "issue" ? "bg-primary" : run.source === "feedback" ? "bg-sky-500" : "bg-rose-500")} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground">{t(`source.${run.source}` as MessageKey)}</strong></span>
                  </div>
                  <div aria-label={`${t("run.branch")}: ${run.branch ?? "—"}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("run.branch")}>
                    <span className="run-property-icon grid size-6 place-items-center text-muted-foreground"><GitFork size={15} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground" title={run.branch ?? undefined}>{run.branch ?? "—"}</strong></span>
                  </div>
                  <div aria-label={`${t("run.commit")}: ${run.commitSha ?? "—"}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("run.commit")}>
                    <span className="run-property-icon grid size-6 place-items-center text-muted-foreground"><GitCommitHorizontal size={15} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground" title={run.commitSha ?? undefined}>{run.commitSha ?? "—"}</strong></span>
                  </div>
                  {run.pullRequestUrls.map((url, index) => {
                    const label = pullRequestDisplayName(url, index);
                    return <a aria-label={t("run.openPullRequest", {
                      label
                    })} className="run-property run-property-link flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg no-underline hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={url} key={url} rel="noreferrer" target="_blank" title={t("run.openPullRequest", {
                      label
                    })}>
                        <span className="run-property-icon pull-request grid size-6 place-items-center text-primary">
                          <GitPullRequest size={15} />
                        </span>
                        <span className="run-property-copy grid min-w-0">
                          <strong className="truncate text-sm font-medium text-foreground">{label}</strong>
                        </span>
                      </a>;
                  })}
                  <div aria-label={`${t("run.started")}: ${formatDate(run.startedAt, localeTag)}`} className="run-property flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg" title={t("run.started")}>
                    <span className="run-property-icon grid size-6 place-items-center text-muted-foreground"><Clock3 size={15} /></span>
                    <span className="run-property-copy grid min-w-0"><strong className="truncate text-sm font-medium text-foreground">{formatDate(run.startedAt, localeTag)}</strong></span>
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
