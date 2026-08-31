import {
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
  type AutoHuntRunStatus,
} from "../../src/lib/auto-hunt-contract";
import { issueSubscribers } from "./issue-subscribers";
import {
  parseExecutionMetrics,
  parseJsonObject,
  parseStructuredResult,
} from "./agent-result-json";
import type {
  HuntEventRow,
  HuntRunRow,
  IssueAttachmentRow,
  IssueDependencyRow,
  IssueHierarchyRow,
  IssueRelationRow,
  IssueResultReviewRow,
  OrganizationStatusTrayRunRow,
} from "./db";
import { issueAttachmentJson } from "./issue-conversation-json";

const parseJsonArray = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

const parseRelatedMessageReference = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const reference = value as Record<string, unknown>;
  const organizationId = reference.organizationId;
  const channelId = reference.channelId;
  const messageId = reference.messageId;
  const rootMessageId = reference.rootMessageId;
  if (
    typeof organizationId !== "string" || !organizationId.trim() ||
    typeof channelId !== "string" || !channelId.trim() ||
    typeof messageId !== "string" || !messageId.trim() ||
    typeof rootMessageId !== "string" || !rootMessageId.trim()
  ) {
    return null;
  }
  return {
    organizationId: organizationId.trim(),
    channelId: channelId.trim(),
    messageId: messageId.trim(),
    rootMessageId: rootMessageId.trim(),
  };
};

export const dashboardEventJson = (
  event: HuntEventRow,
  actorNames: ReadonlyMap<string, string> = new Map(),
) => ({
  id: event.id,
  attempt: event.attempt,
  revision: event.revision,
  status: event.status,
  workflowStage: event.workflow_stage,
  detail: event.detail,
  actor: event.actor,
  actorName: actorNames.get(event.actor) ?? null,
  qaStatus: event.qa_status,
  trackerState: event.tracker_issue_state,
  pullRequestUrls: parseJsonArray(event.pull_request_urls),
  targetSha: event.target_sha,
  occurredAt: event.occurred_at,
  recordedAt: event.recorded_at,
});

export function dashboardRunJson(
  run: HuntRunRow,
  attachments: IssueAttachmentRow[],
  prerequisites: IssueDependencyRow[] = [],
  dependents: IssueDependencyRow[] = [],
  hierarchy: IssueHierarchyRow[] = [],
  relations: IssueRelationRow[] = [],
  resultReviews: IssueResultReviewRow[] = [],
) {
  const status = run.paused_at ? ("paused" as const) : run.status;
  const workflow = normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json));
  const context = parseJsonObject(run.context_json);
  const relatedMessage = parseRelatedMessageReference(
    context ? (context as Record<string, unknown>).relatedMessage : undefined,
  );
  const dependencyStatus = (
    rawStatus: AutoHuntRunStatus,
    pausedAt: string | null,
  ) => (pausedAt ? ("paused" as const) : rawStatus);
  const waitingOnPrerequisiteCount = prerequisites.filter(
    (dependency) => dependency.prerequisite_status !== "completed",
  ).length;
  const parent = hierarchy.find((link) => link.child_run_id === run.id);
  const subIssues = hierarchy.filter((link) => link.parent_run_id === run.id);
  const waitingCheckpoint = run.waiting_checkpoint_key
    ? workflow.execution.checkpoints.find(
        (checkpoint) => checkpoint.key === run.waiting_checkpoint_key,
      ) ?? null
    : null;
  const checkpointStageIndex = waitingCheckpoint
    ? workflow.stages.findIndex((stage) => stage.id === waitingCheckpoint.stage)
    : -1;
  const nextStage = waitingCheckpoint?.position === "before"
    ? workflow.stages[checkpointStageIndex]
    : workflow.stages[checkpointStageIndex + 1];
  const terminalReviewOnly = Boolean(
    waitingCheckpoint?.position === "after" &&
      checkpointStageIndex === workflow.stages.length - 1,
  );
  return {
    id: run.id,
    workspaceId: run.workspace_id ?? null,
    teamId: run.team_id ?? run.project_id,
    projectId: run.planning_project_id,
    projectName: run.planning_project_name ?? null,
    runNumber: run.run_number,
    currentAttempt: run.current_attempt,
    currentRevision: run.current_revision,
    source: run.source,
    sourceKey: run.source_key,
    title: run.title,
    status,
    workflowStage: run.workflow_stage,
    workflow,
    progress: progressForAutoHuntRun(
      status,
      run.workflow_stage,
      workflow,
    ),
    pausedAt: run.paused_at,
    resumeRequestedAt: run.resume_requested_at,
    waitingCheckpoint: run.waiting_checkpoint_key
      ? {
          key: run.waiting_checkpoint_key,
          revision: run.waiting_checkpoint_revision ?? run.current_revision,
        }
      : null,
    checkpoint: waitingCheckpoint
      ? {
          key: waitingCheckpoint.key,
          stage: waitingCheckpoint.stage,
          stageLabel:
            workflow.stages[checkpointStageIndex]?.label ?? waitingCheckpoint.stage,
          position: waitingCheckpoint.position,
          attempt: run.current_attempt,
          revision:
            run.waiting_checkpoint_revision ?? run.current_revision,
          reachedAt: run.paused_at,
          nextStage: nextStage?.id ?? null,
          nextStageLabel: nextStage?.label ?? null,
          terminalReviewOnly,
        }
      : null,
    issueCheckpoints: JSON.parse(run.issue_checkpoints_json || "[]"),
    fullAuto:
      context !== null &&
      (context as Record<string, unknown>).fullAuto === true,
    detail: run.detail,
    priority: run.priority,
    difficulty: run.difficulty,
    assigneeUserId: run.assignee_user_id,
    createdByUserId: run.created_by_user_id ?? null,
    subscribers: issueSubscribers(run),
    repository: run.repository,
    branch: run.branch,
    commitSha: run.commit_sha,
    tracker: run.tracker_provider
      ? {
          provider: run.tracker_provider,
          issueId: run.tracker_issue_id,
          identifier: run.tracker_issue_identifier,
          url: run.tracker_issue_url,
          state: run.tracker_issue_state,
        }
      : null,
    issueDescription: run.issue_description,
    relatedMessage,
    attachments: attachments.map(issueAttachmentJson),
    parent: parent
      ? {
          id: parent.parent_run_id,
          runNumber: parent.parent_run_number,
          title: parent.parent_title,
          status: dependencyStatus(
            parent.parent_status,
            parent.parent_paused_at,
          ),
        }
      : null,
    subIssues: subIssues.map((link) => ({
      id: link.child_run_id,
      runNumber: link.child_run_number,
      title: link.child_title,
      status: dependencyStatus(link.child_status, link.child_paused_at),
    })),
    relatedIssues: relations.map((relation) =>
      relation.first_run_id === run.id
        ? {
            id: relation.second_run_id,
            runNumber: relation.second_run_number,
            title: relation.second_title,
            status: dependencyStatus(
              relation.second_status,
              relation.second_paused_at,
            ),
          }
        : {
            id: relation.first_run_id,
            runNumber: relation.first_run_number,
            title: relation.first_title,
            status: dependencyStatus(
              relation.first_status,
              relation.first_paused_at,
            ),
          },
    ),
    prerequisites: prerequisites.map((dependency) => ({
      id: dependency.prerequisite_run_id,
      runNumber: dependency.prerequisite_run_number,
      title: dependency.prerequisite_title,
      status: dependencyStatus(
        dependency.prerequisite_status,
        dependency.prerequisite_paused_at,
      ),
    })),
    executionReadiness:
      waitingOnPrerequisiteCount > 0 ? "waiting" : "ready",
    waitingOnPrerequisiteCount,
    dependents: dependents.map((dependency) => ({
      id: dependency.dependent_run_id,
      runNumber: dependency.dependent_run_number,
      title: dependency.dependent_title,
      status: dependencyStatus(
        dependency.dependent_status,
        dependency.dependent_paused_at,
      ),
    })),
    resultSummary: run.result_summary,
    structuredResult: parseStructuredResult(run.structured_result_json),
    resultReviews: resultReviews.map((review) => ({
      userId: review.user_id,
      name: review.name,
      username: review.username,
      image: review.image,
      completedAt: review.completed_at,
    })),
    executionMetrics: parseExecutionMetrics(run.execution_metrics_json),
    pullRequestUrls: parseJsonArray(run.pull_request_urls),
    targetSha: run.target_sha,
    sourceCreatedAt: run.source_created_at,
    stagingQaStatus: run.staging_qa_status,
    productionQaStatus: run.production_qa_status,
    stagingQaDetail: run.staging_qa_detail,
    productionQaDetail: run.production_qa_detail,
    context,
    claimedBy: run.claimed_by,
    claimedAt: run.claimed_at,
    leaseExpiresAt: run.lease_expires_at,
    claimAttempts: run.claim_attempts,
    agentId: run.agent_id,
    preferredProvider: run.preferred_agent_provider,
    preferredModel: run.preferred_agent_model,
    preferredEffort: run.preferred_agent_effort,
    requestedProvider: run.requested_agent_provider,
    requestedModel: run.requested_agent_model,
    requestedEffort: run.requested_agent_effort,
    requestedWorkerId: run.requested_worker_id,
    requestedByUserId: run.requested_by_user_id,
    dispatchMode: run.dispatch_mode,
    dispatchedAt: run.dispatched_at,
    workerId: run.worker_id,
    startedAt: run.started_at,
    updatedAt: run.updated_at,
    completedAt: run.completed_at,
    lastEventAt: run.last_event_at,
    eventCount: run.event_count,
  };
}

export function statusTrayRunJson(run: OrganizationStatusTrayRunRow) {
  const workflow = normalizeAutoHuntWorkflow(
    JSON.parse(run.workflow_snapshot_json),
  );
  return {
    projectId: run.project_id,
    projectName: run.project_name,
    id: run.id,
    title: run.title,
    status: run.status,
    workflowStage: run.workflow_stage,
    workflowStageLabel:
      workflow.stages.find((stage) => stage.id === run.workflow_stage)?.label ??
      null,
    startedAt: run.started_at,
    updatedAt: run.updated_at,
    lastEventAt: run.last_event_at,
  };
}
