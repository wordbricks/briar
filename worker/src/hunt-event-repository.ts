import {
  isTerminalTrackerState,
  additionalWorkflowCheckpoints,
  isRepositoryWorkflowPending,
  requiredWorkflowStages,
  workflowWithAdditionalCheckpoints,
  type AutoHuntWorkflowCheckpoint,
} from "../../src/lib/auto-hunt-contract";
import { workflowSnapshotForRun } from "./workflow-policy";

import { attemptGithubMergeAutoResume } from "./github-merge-reconciliation";
import {
  type HuntEventInput,
  type HuntEventRow,
} from "./hunt-event-model";
import {
  normalizedUrls,
  parseUrls,
  parseWorkflow,
  stableJson,
} from "./hunt-run-codec";
import {
  EventKeyConflictError,
  HuntTransitionError,
} from "./hunt-run-errors";
import {
  dashboardStageFor,
  type HuntRunRow,
  statusForDashboardStage,
  workflowStageForDashboardStage,
} from "./hunt-run-model";
import { getProjectSettings } from "./project-settings-repository";
import {
  digestRunId,
  scopedRunKey,
} from "./run-identity";
import { loadStageRevisionRequirements } from "./run-stage-revision-repository";
import { assertWorkflowRunCompletion } from "./workflow-completion-repository";

const sameEvent = (row: HuntEventRow, input: HuntEventInput) =>
  row.stage === input.stage &&
  row.status === input.status &&
  row.workflow_stage === input.workflowStage &&
  row.detail === input.detail &&
  row.actor === input.actor &&
  row.branch === input.branch &&
  row.commit_sha === input.commitSha &&
  row.qa_status === input.qaStatus &&
  row.tracker_issue_state === (input.tracker?.state ?? null) &&
  row.pull_request_urls === stableJson(input.pullRequestUrls) &&
  row.target_sha === input.targetSha &&
  row.occurred_at === input.occurredAt;

const loadRunForIdentity = async (
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) => {
  if (input.tracker?.issueId) {
    const byTracker = await db
      .prepare(
        `select * from briar_hunt_runs
         where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
         limit 1`,
      )
      .bind(projectId, input.tracker.provider, input.tracker.issueId)
      .first<HuntRunRow>();
    if (byTracker) return byTracker;
  }
  return await db
    .prepare(
      `select * from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(projectId, input.source, input.sourceKey)
    .first<HuntRunRow>();
};

const assertRunCompletionEligible = async (
  db: D1Database,
  projectId: string,
  run: HuntRunRow,
  resultSummary: string | null,
  trackerProvider: string | null,
  trackerState: string | null,
) => {
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  await assertWorkflowRunCompletion(db, projectId, run.id);
  const requiredStages = requiredWorkflowStages(workflow);
  const revisionRequirements = await loadStageRevisionRequirements(db, run);
  const requiredEvidence = workflow.stages.flatMap((stage) =>
    requiredStages.includes(stage.id)
      ? (stage.evidence ?? []).map((type) => ({ stage: stage.id, type }))
      : [],
  );
  if (requiredEvidence.length > 0) {
    const evidence = await db
      .prepare(
        `select workflow_stage, evidence_type, revision from briar_run_evidence
         where run_id = ? and attempt = ? and status in ('passed', 'skipped')`,
      )
      .bind(run.id, run.current_attempt)
      .all<{
        workflow_stage: string;
        evidence_type: string;
        revision: number;
      }>();
    const accepted = new Set(
      evidence.results
        .filter(
          (item) =>
            item.revision >=
            (revisionRequirements.get(item.workflow_stage) ?? 1),
        )
        .map((item) => `${item.workflow_stage}:${item.evidence_type}`),
    );
    const missingEvidence = requiredEvidence
      .filter((item) => !accepted.has(`${item.stage}:${item.type}`))
      .map((item) => `${item.stage}:${item.type}`);
    if (missingEvidence.length > 0) {
      throw new HuntTransitionError(
        `Run completion requires evidence: ${missingEvidence.join(", ")}`,
      );
    }
  }
  if (!resultSummary?.trim()) {
    throw new HuntTransitionError("Run completion requires a result summary");
  }
  const settings = await getProjectSettings(db, projectId);
  if (
    settings?.linear_enabled === 1 &&
    trackerProvider === "linear" &&
    !isTerminalTrackerState(trackerState)
  ) {
    throw new HuntTransitionError(
      "Run completion requires a terminal Linear issue",
    );
  }
};

const assertCompletionEligible = async (
  db: D1Database,
  projectId: string,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (input.status !== "completed") return;
  if (!run) throw new HuntTransitionError("Run does not exist");
  await assertRunCompletionEligible(
    db,
    projectId,
    run,
    input.resultSummary ?? run.result_summary,
    input.tracker?.provider ?? run.tracker_provider,
    input.tracker?.state ?? run.tracker_issue_state,
  );
};

const assertStageTransition = async (
  _db: D1Database,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (!run || input.occurredAt < run.last_event_at) {
    return;
  }
  if (
    input.status === run.status &&
    (input.status !== "running" || input.workflowStage === run.workflow_stage)
  ) {
    return;
  }
  if (run.status === "completed" || run.status === "cancelled") {
    throw new HuntTransitionError(`Run is already ${run.status}`);
  }
  if (["blocked", "failed", "cancelled"].includes(input.status ?? "")) return;
  if (input.status !== "running" || !input.workflowStage) return;
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const nextRank = workflow.stages.findIndex(
    (stage) => stage.id === input.workflowStage,
  );
  if (nextRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.workflowStage}`,
    );
  }
  const currentRank = run.workflow_stage
    ? workflow.stages.findIndex((stage) => stage.id === run.workflow_stage)
    : -1;
  if (run.paused_at && nextRank !== currentRank) {
    throw new HuntTransitionError(
      "Run is paused; resume it before recording a later workflow stage",
    );
  }
  const floorRank = currentRank;
  if (nextRank < floorRank) {
    throw new HuntTransitionError(
      `Workflow cannot regress from rank ${floorRank} to ${nextRank}`,
    );
  }
};

export async function recordHuntEvent(
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) {
  const normalizedInput = {
    ...input,
    status: input.status ?? statusForDashboardStage(input.stage),
    workflowStage:
      input.workflowStage === undefined
        ? workflowStageForDashboardStage(input.stage)
        : input.workflowStage,
    pullRequestUrls: normalizedUrls(input.pullRequestUrls),
  };
  normalizedInput.stage = dashboardStageFor(
    normalizedInput.status,
    normalizedInput.workflowStage,
  );
  const existingRun = await loadRunForIdentity(db, projectId, normalizedInput);
  const baseWorkflowSnapshot = existingRun
    ? parseWorkflow(existingRun.workflow_snapshot_json)
    : await workflowSnapshotForRun(
        db,
        projectId,
        normalizedInput.createdByUserId,
        [],
        normalizedInput.fullAuto === true,
      );
  const issueCheckpointSnapshot = existingRun
    ? (JSON.parse(
        existingRun.issue_checkpoints_json || "[]",
      ) as AutoHuntWorkflowCheckpoint[])
    : normalizedInput.fullAuto
      ? []
      : additionalWorkflowCheckpoints(
          baseWorkflowSnapshot,
          normalizedInput.issueCheckpoints ?? [],
        );
  const workflowSnapshot = existingRun
    ? baseWorkflowSnapshot
    : workflowWithAdditionalCheckpoints(
        baseWorkflowSnapshot,
        issueCheckpointSnapshot,
      );
  if (!existingRun && isRepositoryWorkflowPending(workflowSnapshot)) {
    throw new HuntTransitionError(
      "Repository workflow has not been generated for this project",
    );
  }
  if (
    normalizedInput.status === "running" &&
    (!normalizedInput.workflowStage ||
      !workflowSnapshot.stages.some(
        (stage) => stage.id === normalizedInput.workflowStage,
      ))
  ) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${normalizedInput.workflowStage ?? "none"}`,
    );
  }
  const eventAttempt = existingRun?.current_attempt ?? 1;
  const eventRevision = existingRun?.current_revision ?? 1;
  const storedEventKey = await scopedRunKey(
    normalizedInput.eventKey,
    eventAttempt,
    eventRevision,
  );
  await assertStageTransition(db, existingRun, normalizedInput);
  await assertCompletionEligible(db, projectId, existingRun, normalizedInput);
  if (existingRun?.paused_at && normalizedInput.status === "completed") {
    throw new HuntTransitionError(
      "Run is paused; resume it before completing the workflow",
    );
  }

  if (existingRun) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(existingRun.id, storedEventKey)
      .first<HuntEventRow>();
    if (existingEvent) {
      if (!sameEvent(existingEvent, normalizedInput)) {
        throw new EventKeyConflictError();
      }
      if (
        normalizedInput.status === "running" &&
        normalizedInput.workflowStage === "pr_open"
      ) {
        await attemptGithubMergeAutoResume(db, projectId, existingRun.id);
      }
      return existingRun.id;
    }
  }

  const runId =
    existingRun?.id ??
    (await digestRunId(
      projectId,
      normalizedInput.source,
      normalizedInput.sourceKey,
    ));
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const completedAt = ["completed", "cancelled"].includes(
    normalizedInput.status,
  )
    ? normalizedInput.occurredAt
    : null;
  const mergedPullRequestUrls = normalizedUrls([
    ...parseUrls(existingRun?.pull_request_urls),
    ...normalizedInput.pullRequestUrls,
  ]);
  const qaStatus = normalizedInput.qaStatus;
  const stagingQaStatus =
    normalizedInput.stage === "staging_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const productionQaStatus =
    normalizedInput.stage === "production_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
           detail, priority,
           assignee_user_id, created_by_user_id,
           repository, branch, commit_sha, tracker_provider,
           tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
           tracker_issue_state, issue_description, result_summary,
           structured_result_json,
           pull_request_urls, target_sha, source_created_at,
           staging_qa_status, production_qa_status, staging_qa_detail,
           production_qa_detail, context_json, started_at, completed_at,
            last_event_at, created_at, updated_at,
            preferred_agent_provider, preferred_agent_model, preferred_agent_effort
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id, source, source_key) do nothing`,
      )
      .bind(
        runId,
        projectId,
        normalizedInput.source,
        normalizedInput.sourceKey,
        normalizedInput.title,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        stableJson(workflowSnapshot),
        stableJson(issueCheckpointSnapshot),
        normalizedInput.detail,
        normalizedInput.priority,
        normalizedInput.assigneeUserId ?? null,
        normalizedInput.createdByUserId ?? null,
        normalizedInput.repository,
        normalizedInput.branch,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.issueDescription,
        normalizedInput.resultSummary,
        normalizedInput.structuredResult
          ? stableJson(normalizedInput.structuredResult)
          : null,
        stableJson(mergedPullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        stagingQaStatus,
        productionQaStatus,
        normalizedInput.stagingQaDetail,
        normalizedInput.productionQaDetail,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        completedAt,
        normalizedInput.occurredAt,
        recordedAt,
        recordedAt,
        normalizedInput.preferredAgentProvider ?? null,
        normalizedInput.preferredAgentModel ?? null,
        normalizedInput.preferredAgentEffort ?? null,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
           detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        runId,
        storedEventKey,
        eventAttempt,
        eventRevision,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        normalizedInput.detail,
        normalizedInput.actor,
        normalizedInput.branch,
        normalizedInput.commitSha,
        qaStatus,
        normalizedInput.tracker?.state ?? null,
        stableJson(normalizedInput.pullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.occurredAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set title = case when ? >= last_event_at then ? else title end,
             stage = case
               when ? < last_event_at then stage
               when status = 'completed' and ? <> 'completed' then stage
               else ?
             end,
             status = case
               when ? < last_event_at then status
               when status = 'completed' and ? <> 'completed' then status
               else ?
             end,
             workflow_stage = case
               when ? >= last_event_at then coalesce(?, workflow_stage)
               else workflow_stage
             end,
             detail = case when ? >= last_event_at then ? else detail end,
             priority = case when ? >= last_event_at then coalesce(?, priority) else priority end,
             repository = case when ? >= last_event_at then ? else repository end,
             branch = case when ? >= last_event_at then coalesce(?, branch) else branch end,
             commit_sha = case when ? >= last_event_at then coalesce(?, commit_sha) else commit_sha end,
             tracker_provider = coalesce(?, tracker_provider),
             tracker_issue_id = coalesce(?, tracker_issue_id),
             tracker_issue_identifier = coalesce(?, tracker_issue_identifier),
             tracker_issue_url = coalesce(?, tracker_issue_url),
             tracker_issue_state = case when ? >= last_event_at then coalesce(?, tracker_issue_state) else tracker_issue_state end,
             issue_description = case when ? >= last_event_at then coalesce(?, issue_description) else issue_description end,
             result_summary = case when ? >= last_event_at then coalesce(?, result_summary) else result_summary end,
             structured_result_json = case when ? >= last_event_at then coalesce(?, structured_result_json) else structured_result_json end,
             pull_request_urls = ?,
             target_sha = case when ? >= last_event_at then coalesce(?, target_sha) else target_sha end,
             source_created_at = coalesce(source_created_at, ?),
             staging_qa_status = case
               when ? >= last_event_at and ? = 'staging_qa' and ? = 'pending' then 'pending'
               else staging_qa_status
             end,
             production_qa_status = case
               when ? >= last_event_at and ? = 'production_qa' and ? = 'pending' then 'pending'
               else production_qa_status
             end,
             staging_qa_detail = case when ? >= last_event_at then coalesce(?, staging_qa_detail) else staging_qa_detail end,
             production_qa_detail = case when ? >= last_event_at then coalesce(?, production_qa_detail) else production_qa_detail end,
             context_json = case when ? >= last_event_at then coalesce(?, context_json) else context_json end,
             resume_requested_at = case
               when ? >= last_event_at and paused_at is null then null
               else resume_requested_at
             end,
             completed_at = case
               when ? < last_event_at then completed_at
               when ? in ('completed', 'cancelled') then ?
               when status = 'completed' and ? <> 'completed' then completed_at
               else null
             end,
             last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ?
           and current_attempt = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        normalizedInput.occurredAt,
        normalizedInput.title,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.stage,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.workflowStage,
        normalizedInput.occurredAt,
        normalizedInput.detail,
        normalizedInput.occurredAt,
        normalizedInput.priority,
        normalizedInput.occurredAt,
        normalizedInput.repository,
        normalizedInput.occurredAt,
        normalizedInput.branch,
        normalizedInput.occurredAt,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.occurredAt,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.occurredAt,
        normalizedInput.issueDescription,
        normalizedInput.occurredAt,
        normalizedInput.resultSummary,
        normalizedInput.occurredAt,
        normalizedInput.structuredResult
          ? stableJson(normalizedInput.structuredResult)
          : null,
        stableJson(mergedPullRequestUrls),
        normalizedInput.occurredAt,
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stagingQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.productionQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        recordedAt,
        runId,
        eventAttempt,
        eventId,
      ),
    ...(normalizedInput.postInsertIssueDescription === undefined
      ? []
      : [
          db
            .prepare(
              `update briar_hunt_runs
               set issue_description = ?, updated_at = ?
               where id = ? and project_id = ?
               returning id, issue_description`,
            )
            .bind(
              normalizedInput.postInsertIssueDescription,
              recordedAt,
              runId,
              projectId,
            ),
        ]),
  ]);

  if (
    normalizedInput.postInsertIssueDescription !== undefined &&
    (results[3]?.results?.length ?? 0) !== 1
  ) {
    throw new Error("Post-insert issue description could not be persisted");
  }

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(runId, storedEventKey)
      .first<HuntEventRow>();
    if (!existingEvent || !sameEvent(existingEvent, normalizedInput)) {
      throw new EventKeyConflictError();
    }
  }

  // Reconcile signed merges after the event is durable. Retries also take this
  // path through the duplicate-event branch if reconciliation fails transiently.
  if (
    normalizedInput.status === "running" &&
    normalizedInput.workflowStage === "pr_open"
  ) {
    await attemptGithubMergeAutoResume(db, projectId, runId);
  }

  return runId;
}
