import { ChevronRight } from "lucide-react";
import { Fragment, type Ref } from "react";

import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { formatIssueKey } from "@/lib/issue-key";
import { runMeta } from "@/lib/stages";
import { type AgentProvider } from "@/lib/team-llm";
import type {
  HuntRun,
  HuntRunPlacement,
  IssueExecutionPreferences,
  OrganizationMember,
  PlanningProject,
  Project,
} from "@/types";
import { IssueContextMenu } from "./IssueContextMenu";
import { PullRequestIconLink } from "./PullRequestIconLink";
import { RunStatusPill } from "../detail/RunStatusPill";
import { IssueDifficultyIcon } from "../IssueDifficultyIcon";
import { localizeStatus, relativeTime } from "../model/formatters";
import { hasResultReviews } from "../results/model";
import { TeamIcon } from "../../TeamIcon";

/*
  One row of the issue list, and the context menu around it.

  It was inline in `IssueList`, which meant the list had to hold every run to
  draw a row. The board's list mode now renders one of these per id from a
  component that subscribes to that run alone, while `IssueList` keeps rendering
  them from the array `MyIssues` hands it. The markup below is what both show.
*/
export function IssueListRow({
  assignee,
  availableProviders,
  currentTeamId = null,
  deletingIssueId,
  isCursor,
  isProcessing,
  issueKeyPrefix,
  itemRef,
  onActivate,
  onCheckpointsChange,
  onCursor,
  onDelete,
  onEdit,
  onMove,
  onOpen,
  onPreferencesChange,
  onPriorityChange,
  onProcessNow,
  onProjectChange,
  onSelect,
  onTeamChange,
  onTransfer,
  planningProjects = [],
  project,
  readOnly = false,
  run,
  teams = [],
  updatingIssueId,
}: {
  assignee: OrganizationMember | null;
  availableProviders: AgentProvider[];
  currentTeamId?: string | null;
  deletingIssueId: string | null;
  isCursor: boolean;
  isProcessing: boolean;
  issueKeyPrefix?: string;
  itemRef?: Ref<HTMLDivElement>;
  onActivate: (repeat: boolean) => void;
  onCheckpointsChange: (run: HuntRun, checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
  onCursor: () => void;
  onDelete: (runId: string) => void;
  onEdit: (runId: string) => void;
  onMove: (run: HuntRun, placement: HuntRunPlacement) => void;
  onOpen: (runId: string) => void;
  onPreferencesChange: (run: HuntRun, preferences: IssueExecutionPreferences) => void;
  onPriorityChange: (run: HuntRun, priority: number | null) => void;
  onProcessNow?: (run: HuntRun) => void;
  onProjectChange?: (run: HuntRun, projectId: string) => void;
  onSelect: () => void;
  onTeamChange?: (run: HuntRun, teamId: string) => void;
  onTransfer?: (runId: string) => void;
  planningProjects?: Array<Pick<PlanningProject, "id" | "name" | "teamId">>;
  project?: Pick<Project, "icon" | "name">;
  readOnly?: boolean;
  run: HuntRun;
  teams?: Array<Pick<Project, "id" | "name">>;
  updatingIssueId: string | null;
}) {
  const { t } = useI18n();
  const meta = runMeta(run.status, run.workflowStage, run.workflow);
  const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
  const isClaimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  const teamIdForRun = run.teamId ?? currentTeamId;
  const planningProjectsForRun = teamIdForRun
    ? planningProjects.filter((candidate) => candidate.teamId === teamIdForRun)
    : planningProjects;
  const row = <div aria-label={t("run.details", {
      title: run.title
    })} className="issue-list-grid issue-list-row" data-keyboard-list-current={isCursor ? "" : undefined} data-keyboard-list-item="" data-run-id={run.id} onClick={() => {
      onSelect();
      onOpen(run.id);
    }} onFocus={onCursor} onKeyDown={event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate(event.repeat);
    }} onPointerDown={onCursor} ref={itemRef} role="row" tabIndex={0}>
          <span className="issue-list-task" role="cell">
            <span className="issue-list-task-kicker">
              {project ? <TeamIcon className="issue-list-project-icon" project={project} /> : null}
              <small>
                {formatIssueKey(issueKeyPrefix, run.runNumber)} · {run.sourceKey}
                {assignee ? ` · ${assignee.name}` : ""}
              </small>
              <PullRequestIconLink urls={run.pullRequestUrls} />
              <IssueDifficultyIcon difficulty={run.difficulty} size={12} />
            </span>
            <strong>{run.title}</strong>
            {(run.detail || run.issueDescription) && <span>{run.detail || run.issueDescription}</span>}
          </span>
          <span className="issue-list-status" role="cell">
            <RunStatusPill label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
            <small>
              <i className={`source-dot ${run.source}`} />
              {t(`source.${run.source}` as MessageKey)}
            </small>
          </span>
          <span className="issue-list-priority" role="cell">
            {run.priority === null ? "—" : `P${run.priority}`}
          </span>
          <span className="issue-list-updated" role="cell">
            {isClaimed ? t("run.assigned", {
          agent: run.claimedBy ?? "agent"
        }) : relativeTime(run.updatedAt, t)}
          </span>
          <ChevronRight aria-hidden="true" size={15} />
        </div>;
  return readOnly ? <Fragment>{row}</Fragment> : <IssueContextMenu availableProviders={availableProviders} disabled={deletingIssueId === run.id || updatingIssueId === run.id} onDelete={() => onDelete(run.id)} onTransfer={onTransfer ? () => onTransfer(run.id) : undefined} onTeamChange={onTeamChange ? teamId => onTeamChange(run, teamId) : undefined} onProjectChange={onProjectChange ? projectId => onProjectChange(run, projectId) : undefined} teams={teams} currentTeamId={currentTeamId} planningProjects={planningProjectsForRun} onEdit={() => onEdit(run.id)} onMove={placement => onMove(run, placement)} onOpen={() => onOpen(run.id)} onProcessNow={onProcessNow ? () => onProcessNow(run) : undefined} onPriorityChange={priority => onPriorityChange(run, priority)} onPreferencesChange={preferences => onPreferencesChange(run, preferences)} onCheckpointsChange={checkpoints => onCheckpointsChange(run, checkpoints)} run={run} isProcessing={isProcessing}>
      {row}
    </IssueContextMenu>;
}
