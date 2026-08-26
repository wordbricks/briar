import { ChevronRight, Rocket } from "lucide-react";
import { type PointerEvent as ReactPointerEvent } from "react";
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
export function KanbanCard({
  availableProviders,
  activeAgent,
  assignee,
  assignedWorker,
  hideAssignmentBadges = false,
  contextMenuDisabled,
  deletingIssueId,
  isDragging = false,
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
  hideAssignmentBadges?: boolean;
  contextMenuDisabled: boolean;
  deletingIssueId: string | null;
  isDragging?: boolean;
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
    })} aria-disabled={isMoving} className={`kanban-card ${meta.tone}${run.status === "paused" ? " awaiting-review" : ""}${isMoving ? " moving" : ""}${isDragging ? " dragging" : ""}${assignmentBadgeCount > 0 ? " has-assignees" : ""}${assignmentBadgeCount > 1 ? " has-multiple-assignees" : ""}${assignmentBadgeCount > 2 ? " has-three-assignees" : ""}${assignmentBadgeCount > 3 ? " has-four-assignees" : ""}`} data-keyboard-list-item="" draggable={false} onClick={onOpen} onKeyDown={event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onOpen();
    }} onPointerCancel={onPointerCancel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="button" tabIndex={0}>
        {assignmentBadgeCount > 0 && <span className="kanban-card-assignee-badges">
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
        <span className="kanban-card-kicker">
          <small>{formatIssueKey(issueKeyPrefix, run.runNumber)}</small>
        </span>
        <span className="kanban-card-copy">
          <strong>{run.title}</strong>
          {run.issueDescription && <span className="kanban-card-description">
              {run.issueDescription}
            </span>}
        </span>
        <span className="kanban-card-badges">
          <RunStatusPill label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
          <i className="kanban-source">
            <span className={`source-dot ${run.source}`} />
            {t(`source.${run.source}` as MessageKey)}
          </i>
          {assignee && <i aria-label={`${t("issue.assignee")}: ${assignee.name}`} className="kanban-assignee" title={`${t("issue.assignee")}: ${assignee.name}`}>
              <IssueAssigneeAvatar member={assignee} />
            </i>}
          {run.executionReadiness === "waiting" && <i>{t("issue.waitingOnPrerequisites", {
            count: run.waitingOnPrerequisiteCount ?? 0
          })}</i>}
          {run.priority !== null && <i className="kanban-priority">P{run.priority}</i>}
          <IssueDifficultyIcon difficulty={run.difficulty} />
        </span>
        <span className="kanban-card-footer">
          <small>{isClaimed ? t("run.assigned", {
            agent: run.claimedBy ?? "agent"
          }) : relativeTime(run.updatedAt, t)}</small>
          <span className="kanban-card-footer-actions">
            <PullRequestIconLink urls={run.pullRequestUrls} />
            <ChevronRight size={14} />
          </span>
        </span>
        {run.status === "paused" ? <span className="kanban-card-review-banner" role="status">
            <i aria-hidden="true" />
            {t("run.awaitingReviewBanner")}
          </span> : null}
      </div>
    </IssueContextMenu>;
}
