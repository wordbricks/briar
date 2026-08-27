import { ChevronRight, Rocket } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { AgentProviderIcon } from "@/components/AgentIcons";
import { WorkerIcon } from "@/components/WorkerIcon";
import { ProjectAgentAvatar } from "@/components/ProjectAgentAvatar";
import { runMeta } from "@/lib/stages";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { formatIssueKey } from "@/lib/issue-key";
import type { ExecutionWorker, HuntRun, HuntRunPlacement, IssueExecutionPreferences, OrganizationMember, ProjectAgent } from "@/types";
import { agentProviderLabels, type AgentProvider } from "@/lib/project-llm";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { IssueContextMenu } from "./IssueContextMenu";
import { PullRequestIconLink } from "./PullRequestIconLink";
import { IssueAssigneeAvatar } from "../detail/IssueAssigneeAvatar";
import { RunStatusPill } from "../detail/RunStatusPill";
import { localizeStatus, relativeTime } from "../model/formatters";
import { hasResultReviews } from "../results/model";
import { IssueDifficultyIcon } from "../IssueDifficultyIcon";
import { cn } from "@/lib/utils";

const sourceDotClasses = {
  error: "bg-[#dd687a]",
  feedback: "bg-[#58a0d1]",
  issue: "bg-[#8167d6]",
} as const;
export function KanbanCard({
  availableProviders,
  activeAgent,
  assignee,
  assignedWorker,
  cardRef,
  hideAssignmentBadges = false,
  contextMenuDisabled,
  deletingIssueId,
  isDragging = false,
  isKeyboardCursor = false,
  isMoving,
  isProcessing,
  issueKeyPrefix,
  onDelete,
  onTransfer,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onEdit,
  onFocus,
  onMove,
  run,
  onOpen,
  onProcessNow,
  onPriorityChange,
  onPreferencesChange,
  onCheckpointsChange,
  token,
  updatingIssueId
}: {
  availableProviders: AgentProvider[];
  activeAgent: ProjectAgent | null;
  assignee: OrganizationMember | null;
  assignedWorker: ExecutionWorker | null;
  cardRef?: Ref<HTMLDivElement>;
  hideAssignmentBadges?: boolean;
  contextMenuDisabled: boolean;
  deletingIssueId: string | null;
  isDragging?: boolean;
  isKeyboardCursor?: boolean;
  isMoving: boolean;
  isProcessing: boolean;
  issueKeyPrefix?: string;
  onDelete: () => void;
  onTransfer?: () => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onEdit: () => void;
  onFocus?: () => void;
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
  const {
    t
  } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const isClaimed = run.status === "queued" && Boolean(run.leaseExpiresAt) && Date.parse(run.leaseExpiresAt!) > Date.now();
  const assignedProvider = activeAgent || assignedWorker ? run.preferredProvider ?? run.requestedProvider ?? assignedWorker?.agentProvider ?? activeAgent?.provider ?? null : null;
  const showFullAutoBadge = Boolean(run.fullAuto);
  const assignmentBadgeCount = hideAssignmentBadges ? Number(showFullAutoBadge) : [activeAgent, assignedProvider, assignedWorker, showFullAutoBadge || null].filter(Boolean).length;
  return <IssueContextMenu availableProviders={availableProviders} disabled={contextMenuDisabled || isMoving || isDragging || deletingIssueId === run.id || updatingIssueId === run.id} onDelete={onDelete} onTransfer={onTransfer} onEdit={onEdit} onMove={onMove} onOpen={onOpen} onProcessNow={onProcessNow} onPriorityChange={onPriorityChange} onPreferencesChange={onPreferencesChange} onCheckpointsChange={onCheckpointsChange} run={run} isProcessing={isProcessing}>
      <div aria-label={t("run.details", {
      title: run.title
    })} aria-disabled={isMoving} className={cn("kanban-card group relative flex min-h-0 w-full min-w-0 select-none flex-col items-stretch gap-2 overflow-visible rounded-[11px] border border-border bg-card p-3 text-left text-foreground shadow-sm transition-[border-color,box-shadow,transform,opacity] duration-150 hover:-translate-y-px hover:border-input hover:shadow-md active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", meta.tone, run.status === "paused" && "awaiting-review cursor-pointer", isMoving && "moving cursor-wait opacity-55", isDragging && "dragging scale-[1.01] cursor-grabbing border-[#b7a8e4] opacity-70 shadow-lg", assignmentBadgeCount > 0 && "has-assignees", assignmentBadgeCount > 1 && "has-multiple-assignees", assignmentBadgeCount > 2 && "has-three-assignees", assignmentBadgeCount > 3 && "has-four-assignees")} data-keyboard-list-current={isKeyboardCursor ? "" : undefined} data-keyboard-list-item="" data-run-id={run.id} draggable={false} onClick={onOpen} onFocus={onFocus} onKeyDown={event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onOpen();
    }} onPointerCancel={onPointerCancel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} ref={cardRef} role="button" tabIndex={0}>
        {assignmentBadgeCount > 0 && <span className="kanban-card-assignee-badges absolute right-1.5 top-1.5 z-[1] flex items-center [&>span]:grid [&>span]:size-[22px] [&>span]:place-items-center [&>span]:overflow-hidden [&>span]:rounded-full [&>span]:border [&>span]:border-border [&>span]:bg-card [&>span+span]:-ml-1">
            {!hideAssignmentBadges && activeAgent && <span aria-label={t("run.assigned", {
          agent: activeAgent.name
        })} className="kanban-card-agent-badge" title={t("run.assigned", {
          agent: activeAgent.name
        })}>
                <ProjectAgentAvatar agent={activeAgent} isRunning token={token} />
              </span>}
            {!hideAssignmentBadges && assignedProvider && <span aria-label={`${t("run.metricsProvider")}: ${agentProviderLabels[assignedProvider]}`} className={`kanban-card-provider-badge ${assignedProvider}`} title={`${t("run.metricsProvider")}: ${agentProviderLabels[assignedProvider]}`}>
                <AgentProviderIcon provider={assignedProvider} size={13} />
              </span>}
            {!hideAssignmentBadges && assignedWorker && <span aria-label={t("run.workerAssigned", {
          worker: assignedWorker.label
        })} className="kanban-card-worker-badge" title={t("run.workerAssigned", {
          worker: assignedWorker.label
        })}>
                <WorkerIcon glyphSize={16} icon={assignedWorker.icon} size={20} />
              </span>}
            {showFullAutoBadge && <span aria-label={`${t("issue.fullAuto")}: ${t("issue.fullAutoDescription")}`} className="kanban-card-full-auto-badge" title={t("issue.fullAutoDescription")}>
                <Rocket aria-hidden="true" size={12} strokeWidth={2.2} />
              </span>}
          </span>}
        <span className={cn("kanban-card-kicker flex shrink-0 items-center justify-between gap-2", assignmentBadgeCount > 0 && "pr-[22px]", assignmentBadgeCount > 1 && "pr-[39px]", assignmentBadgeCount > 2 && "pr-[56px]", assignmentBadgeCount > 3 && "pr-[73px]")}>
          <small className="font-mono text-2xs font-medium text-muted-foreground">{formatIssueKey(issueKeyPrefix, run.runNumber)}</small>
        </span>
        <span className="kanban-card-copy grid min-w-0 shrink-0 gap-0.5">
          <strong className="break-words whitespace-pre-wrap text-xs leading-[1.45]">{run.title}</strong>
          {run.issueDescription && <span className="kanban-card-description line-clamp-3 break-words whitespace-pre-wrap text-2xs leading-[1.45] text-muted-foreground">
              {run.issueDescription}
            </span>}
        </span>
        <span className="kanban-card-badges mt-auto flex shrink-0 flex-wrap items-center gap-1.5 [&>i:not(.status-pill)]:inline-flex [&>i:not(.status-pill)]:min-h-[22px] [&>i:not(.status-pill)]:items-center [&>i:not(.status-pill)]:gap-1 [&>i:not(.status-pill)]:rounded-md [&>i:not(.status-pill)]:border [&>i:not(.status-pill)]:border-border [&>i:not(.status-pill)]:bg-muted [&>i:not(.status-pill)]:px-1.5 [&>i:not(.status-pill)]:font-mono [&>i:not(.status-pill)]:text-2xs [&>i:not(.status-pill)]:font-medium [&>i:not(.status-pill)]:not-italic">
          <RunStatusPill label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
          <i className="kanban-source inline-flex min-h-[22px] items-center gap-1 rounded-md border border-border bg-muted px-1.5 font-mono text-2xs font-medium not-italic">
            <span className={cn("source-dot size-2 shrink-0 rounded-full", sourceDotClasses[run.source])} />
            {t(`source.${run.source}` as MessageKey)}
          </i>
          {assignee && <i aria-label={`${t("issue.assignee")}: ${assignee.name}`} className="kanban-assignee inline-flex size-[22px] min-h-[22px] min-w-[22px] items-center justify-center overflow-hidden rounded-full border border-border bg-muted p-0 not-italic" title={`${t("issue.assignee")}: ${assignee.name}`}>
              <IssueAssigneeAvatar member={assignee} />
            </i>}
          {run.executionReadiness === "waiting" && <i className="not-italic">{t("issue.waitingOnPrerequisites", {
            count: run.waitingOnPrerequisiteCount ?? 0
          })}</i>}
          {run.priority !== null && <i className="kanban-priority border-[#f0d9b6]! bg-[#fff7e9]! text-[#a2632d]!">P{run.priority}</i>}
          <IssueDifficultyIcon difficulty={run.difficulty} />
        </span>
        <span className="kanban-card-footer flex shrink-0 min-w-0 items-center justify-between gap-2 pt-0.5 text-muted-foreground">
          <small className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs font-medium">{isClaimed ? t("run.assigned", {
            agent: run.claimedBy ?? "agent"
          }) : relativeTime(run.updatedAt, t)}</small>
          <span className="kanban-card-footer-actions flex shrink-0 items-center gap-1.5">
            <PullRequestIconLink urls={run.pullRequestUrls} />
            <ChevronRight size={14} />
          </span>
        </span>
        {run.status === "paused" ? <span className="kanban-card-review-banner -mx-3 -mb-3 mt-1 flex shrink-0 items-center gap-1.5 rounded-b-[10px] border-t border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-1.5 text-2xs font-semibold leading-[1.35] text-[var(--status-warning-foreground)]" role="status">
            <i aria-hidden="true" className="size-2 shrink-0 rounded-full border-2 border-[var(--warning)]" />
            {t("run.awaitingReviewBanner")}
          </span> : null}
      </div>
    </IssueContextMenu>;
}
