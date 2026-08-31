import { type AutoHuntWorkflowStageId } from "../../src/lib/auto-hunt-contract";

import { parseWorkflow } from "./hunt-run-codec";
import { HuntTransitionError } from "./hunt-run-errors";
import { dashboardStageFor } from "./hunt-run-model";
import { getHuntRunForProject } from "./hunt-run-repository";
import {
  ensureWorkflowProgress,
  getWorkflowProgress,
  type WorkflowCheckpointProgressRow,
  workflowCheckpointRow,
  type WorkflowProgressInput,
  workflowStageRank,
  workflowStageRow,
} from "./workflow-progress-repository";

export type WorkflowCheckpointTransitionOutcome =
  | "waiting"
  | "already_waiting"
  | "approved"
  | "already_approved"
  | "invalidated"
  | "conflict"
  | "not_found";

type WorkflowCheckpointConflict = {
  outcome: "conflict";
  checkpointKey: string;
  attempt: number;
  revision: number;
};

const checkpointTransitionConflict = (
  checkpointKey: string,
  attempt: number,
  revision: number,
): WorkflowCheckpointConflict => ({
  outcome: "conflict",
  checkpointKey,
  attempt,
  revision,
});

export async function reachWorkflowCheckpoint(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    checkpointKey: string;
    reachedAt: string;
  },
): Promise<{
  outcome: WorkflowCheckpointTransitionOutcome;
  checkpointKey: string;
  attempt: number | null;
  revision: number | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return { outcome: "not_found", checkpointKey: input.checkpointKey, attempt: null, revision: null };
  }
  if (
    (input.attempt !== undefined && input.attempt !== run.current_attempt) ||
    (input.revision !== undefined && input.revision !== run.current_revision)
  ) {
    return checkpointTransitionConflict(input.checkpointKey, run.current_attempt, run.current_revision);
  }
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return { outcome: "not_found", checkpointKey: input.checkpointKey, attempt: null, revision: null };
  const { workflow, attempt, revision } = initialized;
  const configured = workflow.execution.checkpoints.find(
    (checkpoint) => checkpoint.key === input.checkpointKey,
  );
  if (!configured) throw new HuntTransitionError(`Unknown checkpoint: ${input.checkpointKey}`);
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const current = workflowCheckpointRow(progress, input.checkpointKey);
  if (!current) throw new HuntTransitionError(`Missing checkpoint progress: ${input.checkpointKey}`);
  if (current.state === "waiting") {
    return { outcome: "already_waiting", checkpointKey: current.checkpoint_key, attempt, revision };
  }
  if (current.state === "approved") {
    return { outcome: "already_approved", checkpointKey: current.checkpoint_key, attempt, revision };
  }
  if (current.state === "invalidated") {
    return checkpointTransitionConflict(input.checkpointKey, attempt, revision);
  }
  if (progress.waitingCheckpoint) {
    return checkpointTransitionConflict(
      progress.waitingCheckpoint.checkpoint_key,
      attempt,
      revision,
    );
  }
  const stage = workflowStageRow(progress, configured.stage);
  if (!stage) throw new HuntTransitionError(`Missing stage progress: ${configured.stage}`);
  if (configured.position === "before" && stage.state !== "pending") {
    throw new HuntTransitionError(
      `Before checkpoint ${configured.key} requires stage ${configured.stage} to be pending`,
    );
  }
  if (configured.position === "after" && stage.state !== "completed") {
    throw new HuntTransitionError(
      `After checkpoint ${configured.key} requires stage ${configured.stage} to be completed`,
    );
  }
  const checkpointIndex = workflow.execution.checkpoints.findIndex(
    (checkpoint) => checkpoint.key === configured.key,
  );
  const unresolvedEarlier = progress.checkpoints
    .slice(0, checkpointIndex)
    .some((checkpoint) => checkpoint.state !== "approved" && checkpoint.state !== "invalidated");
  if (unresolvedEarlier) {
    throw new HuntTransitionError(
      `Checkpoint ${configured.key} cannot be reached before earlier checkpoints are approved`,
    );
  }
  try {
    const results = await db.batch([
      db
        .prepare(
          `update briar_run_checkpoint_progress
           set state = 'waiting', reached_at = ?, approved_at = null,
               approved_by = null, approved_request_id = null
           where run_id = ? and attempt = ? and revision = ?
             and checkpoint_key = ? and state = 'pending'`,
        )
        .bind(input.reachedAt, run.id, attempt, revision, configured.key),
      db
      .prepare(
        `update briar_hunt_runs
           set paused_at = ?, workflow_stage = ?, stage = ?,
               waiting_checkpoint_key = ?,
               waiting_checkpoint_revision = ?, resume_requested_at = null,
               claim_token_hash = null,
               claimed_by = null, claimed_at = null, lease_expires_at = null,
               updated_at = max(updated_at, ?)
           where id = ? and project_id = ? and current_attempt = ?
             and current_revision = ? and paused_at is null
             and waiting_checkpoint_key is null`,
        )
        .bind(
          input.reachedAt,
          configured.stage,
          dashboardStageFor("running", configured.stage),
          configured.key,
          revision,
          input.reachedAt,
          run.id,
          projectId,
          attempt,
          revision,
        ),
    ]);
    if ((results[0]?.meta.changes ?? 0) === 0 || (results[1]?.meta.changes ?? 0) === 0) {
      return checkpointTransitionConflict(configured.key, attempt, revision);
    }
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      return checkpointTransitionConflict(configured.key, attempt, revision);
    }
    throw error;
  }
  return { outcome: "waiting", checkpointKey: configured.key, attempt, revision };
}

export async function resumeWorkflowCheckpoint(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    checkpointKey: string;
    requestId: string;
    actor: string;
    approvedAt: string;
    requireAllGithubPullRequestsMerged?: boolean;
  },
): Promise<{
  outcome: "approved" | "already_approved" | "conflict" | "not_found";
  checkpointKey: string;
  attempt: number | null;
  revision: number | null;
  nextStage: AutoHuntWorkflowStageId | null;
  terminalReviewOnly: boolean;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return {
      outcome: "not_found",
      checkpointKey: input.checkpointKey,
      attempt: null,
      revision: null,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const priorRequest = await db
    .prepare(
      `select checkpoint_key, attempt, revision, stage_id, position
       from briar_run_checkpoint_progress
       where run_id = ? and approved_request_id = ? limit 1`,
    )
    .bind(run.id, input.requestId)
    .first<WorkflowCheckpointProgressRow>();
  if (priorRequest) {
    const workflow = parseWorkflow(run.workflow_snapshot_json);
    const index = workflow.execution.checkpoints.findIndex(
      (checkpoint) => checkpoint.key === priorRequest.checkpoint_key,
    );
    const configured = index >= 0
      ? workflow.execution.checkpoints[index]
      : null;
    const terminalReviewOnly = configured?.position === "after" &&
      configured.stage === workflow.stages.at(-1)?.id;
    return {
      outcome:
        priorRequest.checkpoint_key === input.checkpointKey
          ? "already_approved"
          : "conflict",
      checkpointKey: priorRequest.checkpoint_key,
      attempt: priorRequest.attempt,
      revision: priorRequest.revision,
      nextStage: terminalReviewOnly
        ? null
        : configured?.position === "before"
          ? configured.stage
          : workflow.stages[workflowStageRank(workflow, priorRequest.stage_id) + 1]?.id ??
            null,
      terminalReviewOnly,
    };
  }
  if (
    input.attempt !== run.current_attempt ||
    input.revision !== run.current_revision
  ) {
    return {
      outcome: "conflict",
      checkpointKey: input.checkpointKey,
      attempt: run.current_attempt,
      revision: run.current_revision,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) {
    return {
      outcome: "not_found",
      checkpointKey: input.checkpointKey,
      attempt: null,
      revision: null,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const { workflow, attempt, revision } = initialized;
  const configured = workflow.execution.checkpoints.find(
    (checkpoint) => checkpoint.key === input.checkpointKey,
  );
  if (!configured) throw new HuntTransitionError(`Unknown checkpoint: ${input.checkpointKey}`);
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  const current = progress ? workflowCheckpointRow(progress, configured.key) : null;
  if (!current || current.state !== "waiting") {
    return {
      outcome: "conflict",
      checkpointKey: input.checkpointKey,
      attempt,
      revision,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  if (
    run.waiting_checkpoint_key !== configured.key ||
    run.waiting_checkpoint_revision !== revision
  ) {
    return {
      outcome: "conflict",
      checkpointKey: input.checkpointKey,
      attempt,
      revision,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const terminalReviewOnly = configured.position === "after" &&
    configured.stage === workflow.stages.at(-1)?.id;
  const nextStage = terminalReviewOnly
    ? null
    : configured.position === "before"
      ? configured.stage
      : workflow.stages[workflowStageRank(workflow, configured.stage) + 1]?.id ?? null;
  const resumedWorkflowStage = nextStage ?? configured.stage;
  const resumedStage = dashboardStageFor("running", resumedWorkflowStage);
  const approvalEventStage = dashboardStageFor("running", configured.stage);
  const approvedStageLabel = workflow.stages.find(
    (stage) => stage.id === configured.stage,
  )?.label ?? configured.stage;
  const approvalEventId = crypto.randomUUID();
  const approvalEventKey =
    `workflow:checkpoint-approved:${attempt}:${revision}:${configured.key}`;
  const recordedAt = new Date().toISOString();
  const githubCheckpointMergeGuard = input.requireAllGithubPullRequestsMerged
    ? `and exists (
         select 1 from briar_run_pull_requests link
         where link.run_id = briar_run_checkpoint_progress.run_id
           and link.attempt = briar_run_checkpoint_progress.attempt
           and link.revision = briar_run_checkpoint_progress.revision
       )
       and not exists (
         select 1 from briar_run_pull_requests link
         where link.run_id = briar_run_checkpoint_progress.run_id
           and link.attempt = briar_run_checkpoint_progress.attempt
           and link.revision = briar_run_checkpoint_progress.revision
           and (link.state <> 'merged' or link.last_delivery_id is null)
       )
       and not exists (
         select 1 from briar_run_evidence evidence
         where evidence.run_id = briar_run_checkpoint_progress.run_id
           and evidence.attempt = briar_run_checkpoint_progress.attempt
           and evidence.revision = briar_run_checkpoint_progress.revision
           and evidence.evidence_type = 'pull_request'
           and evidence.status in ('pending', 'passed')
           and not exists (
             select 1 from briar_run_evidence_pull_requests association
             where association.evidence_id = evidence.id
           )
       )`
    : "";
  const githubRunMergeGuard = input.requireAllGithubPullRequestsMerged
    ? `and exists (
         select 1 from briar_run_pull_requests link
         where link.project_id = briar_hunt_runs.project_id
           and link.run_id = briar_hunt_runs.id
           and link.attempt = briar_hunt_runs.current_attempt
           and link.revision = briar_hunt_runs.current_revision
       )
       and not exists (
         select 1 from briar_run_pull_requests link
         where link.project_id = briar_hunt_runs.project_id
           and link.run_id = briar_hunt_runs.id
           and link.attempt = briar_hunt_runs.current_attempt
           and link.revision = briar_hunt_runs.current_revision
           and (link.state <> 'merged' or link.last_delivery_id is null)
       )
       and not exists (
         select 1 from briar_run_evidence evidence
         where evidence.project_id = briar_hunt_runs.project_id
           and evidence.run_id = briar_hunt_runs.id
           and evidence.attempt = briar_hunt_runs.current_attempt
           and evidence.revision = briar_hunt_runs.current_revision
           and evidence.evidence_type = 'pull_request'
           and evidence.status in ('pending', 'passed')
           and not exists (
             select 1 from briar_run_evidence_pull_requests association
             where association.evidence_id = evidence.id
           )
       )`
    : "";
  const results = await db.batch([
    db
      .prepare(
        `update briar_run_checkpoint_progress
         set state = 'approved', approved_at = ?, approved_by = ?,
             approved_request_id = ?
         where run_id = ? and attempt = ? and revision = ?
           and checkpoint_key = ? and state = 'waiting'
           ${githubCheckpointMergeGuard}`,
      )
      .bind(
        input.approvedAt,
        input.actor,
        input.requestId,
        run.id,
        attempt,
        revision,
        configured.key,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set status = 'running', stage = ?, workflow_stage = ?,
             resume_requested_at = ?,
             waiting_checkpoint_key = null, waiting_checkpoint_revision = null,
             claim_token_hash = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, completed_at = null,
             last_event_at = max(last_event_at, ?),
             updated_at = max(updated_at, ?)
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and waiting_checkpoint_key = ?
           and waiting_checkpoint_revision = ? and paused_at is not null
           and resume_requested_at is null
           ${githubRunMergeGuard}`,
      )
      .bind(
        resumedStage,
        resumedWorkflowStage,
        input.approvedAt,
        input.approvedAt,
        input.approvedAt,
        run.id,
        projectId,
        attempt,
        revision,
        configured.key,
        revision,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, current_attempt, current_revision, ?, 'running',
                ?, ?, ?, branch, commit_sha, null, tracker_issue_state,
                pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and resume_requested_at = ?
           and exists (
             select 1 from briar_run_checkpoint_progress progress
             where progress.run_id = briar_hunt_runs.id
               and progress.attempt = briar_hunt_runs.current_attempt
               and progress.revision = briar_hunt_runs.current_revision
               and progress.checkpoint_key = ? and progress.state = 'approved'
           )
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        approvalEventId,
        approvalEventKey,
        approvalEventStage,
        configured.stage,
        `${approvedStageLabel} 단계의 검토를 승인했습니다.`,
        input.actor,
        input.approvedAt,
        recordedAt,
        run.id,
        projectId,
        attempt,
        revision,
        input.approvedAt,
        configured.key,
      ),
  ]);
  if (
    (results[0]?.meta.changes ?? 0) === 0 ||
    (results[1]?.meta.changes ?? 0) === 0 ||
    (results[2]?.meta.changes ?? 0) === 0
  ) {
    return {
      outcome: "conflict",
      checkpointKey: configured.key,
      attempt,
      revision,
      nextStage,
      terminalReviewOnly,
    };
  }
  return {
    outcome: "approved",
    checkpointKey: configured.key,
    attempt,
    revision,
    nextStage,
    terminalReviewOnly,
  };
}
