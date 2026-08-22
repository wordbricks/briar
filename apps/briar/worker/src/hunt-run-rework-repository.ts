import {
  type AutoHuntPersistedRunStatus,
  type DashboardStage,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";

import { isChannelApprovedIssue } from "./channel-issue-approval-repository";
import { type HuntEventRow } from "./hunt-event-model";
import { parseWorkflow } from "./hunt-run-codec";
import { HuntTransitionError } from "./hunt-run-errors";
import { getHuntRunForProject } from "./hunt-run-repository";

export type HuntReworkOutcome =
  | "reworked"
  | "already_reworked"
  | "not_found";

export async function reworkHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    workflowStage: AutoHuntWorkflowStageId;
    requestId: string;
    actor: string;
    reason: string;
    occurredAt: string;
    checkpoint?: {
      key: string;
      attempt: number;
      revision: number;
    };
    completed?: {
      expectedAttempt: number;
      expectedRevision: number;
    };
  },
): Promise<{
  outcome: HuntReworkOutcome;
  attempt: number | null;
  revision: number | null;
  workflowStage: AutoHuntWorkflowStageId | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return {
      outcome: "not_found",
      attempt: null,
      revision: null,
      workflowStage: null,
    };
  }

  const eventKey = `workflow:rework:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select attempt, revision, workflow_stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<
      Pick<HuntEventRow, "attempt" | "revision" | "workflow_stage">
    >();
  if (existingEvent) {
    return {
      outcome: "already_reworked",
      attempt: existingEvent.attempt,
      revision: existingEvent.revision,
      workflowStage: existingEvent.workflow_stage,
    };
  }

  if (
    input.checkpoint &&
    (!run.paused_at ||
      run.waiting_checkpoint_key !== input.checkpoint.key ||
      run.current_attempt !== input.checkpoint.attempt ||
      (run.waiting_checkpoint_revision ?? run.current_revision) !==
        input.checkpoint.revision)
  ) {
    throw new HuntTransitionError(
      "The paused checkpoint changed before rework could be requested",
    );
  }

  const completedRework = input.completed !== undefined;
  if (completedRework) {
    if (
      run.status !== "completed" ||
      run.current_attempt !== input.completed?.expectedAttempt ||
      run.current_revision !== input.completed?.expectedRevision
    ) {
      throw new HuntTransitionError(
        "The completed run changed before rework could be accepted",
      );
    }
    if (await isChannelApprovedIssue(db, run)) {
      throw new HuntTransitionError(
        "Approved issue execution requires fresh approval before rework",
      );
    }
  } else if (run.status !== "running" || !run.workflow_stage) {
    throw new HuntTransitionError("Only a running workflow stage can be reworked");
  }
  const isPaused = Boolean(run.paused_at);
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const currentRank = completedRework
    ? workflow.stages.length - 1
    : workflow.stages.findIndex((stage) => stage.id === run.workflow_stage);
  const targetRank = workflow.stages.findIndex(
    (stage) => stage.id === input.workflowStage,
  );
  if (targetRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.workflowStage}`,
    );
  }
  if (
    currentRank < 0 ||
    targetRank > currentRank ||
    (!completedRework && !isPaused && targetRank === currentRank)
  ) {
    throw new HuntTransitionError(
      `Rework target ${input.workflowStage} must not follow ${run.workflow_stage}`,
    );
  }

  const nextRevision = run.current_revision + 1;
  const targetStatus: AutoHuntPersistedRunStatus = "queued";
  const targetDashboardStage: DashboardStage = "queued";
  const claimReset = `claim_token_hash = null, claimed_by = null,
             claimed_at = null, lease_expires_at = null,`;
  const sourceStatus = completedRework ? "completed" : "running";
  const recordedAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const invalidatedStages = workflow.stages.slice(targetRank).map((stage) => stage.id);
  const results = await db.batch([
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = ?, workflow_stage = ?,
             detail = ?, current_revision = ?, commit_sha = null,
             target_sha = null, result_summary = null,
             structured_result_json = null,
             staging_qa_status = null, production_qa_status = null,
             staging_qa_detail = null, production_qa_detail = null,
             ${claimReset}
             paused_at = null, resume_requested_at = null,
             completed_at = null, last_event_at = ?, updated_at = ?
         where id = ? and project_id = ? and status = ?
           and current_attempt = ? and current_revision = ?
           and last_event_at = ?`,
      )
      .bind(
        targetDashboardStage,
        targetStatus,
        input.workflowStage,
        input.reason,
        nextRevision,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        sourceStatus,
        run.current_attempt,
        run.current_revision,
        run.last_event_at,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, current_attempt, current_revision, ?, ?,
                ?, ?, ?, branch, null, null, tracker_issue_state,
                pull_request_urls, null, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        targetDashboardStage,
        targetStatus,
        input.workflowStage,
        input.reason,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        nextRevision,
        input.occurredAt,
      ),
    ...invalidatedStages.map((stage) =>
      db
        .prepare(
          `insert into briar_run_stage_revisions (
             run_id, attempt, workflow_stage, required_revision
           )
           select id, current_attempt, ?, current_revision
           from briar_hunt_runs
           where id = ? and project_id = ? and current_attempt = ?
             and current_revision = ? and last_event_at = ?
           on conflict(run_id, attempt, workflow_stage)
           do update set required_revision = excluded.required_revision`,
        )
        .bind(
          stage,
          run.id,
          projectId,
          run.current_attempt,
          nextRevision,
          input.occurredAt,
        ),
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select attempt, revision, workflow_stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<
        Pick<HuntEventRow, "attempt" | "revision" | "workflow_stage">
      >();
    if (duplicate) {
      return {
        outcome: "already_reworked",
        attempt: duplicate.attempt,
        revision: duplicate.revision,
        workflowStage: duplicate.workflow_stage,
      };
    }
    throw new HuntTransitionError(
      "Issue processing run changed while rework was being recorded",
    );
  }

  await db
    .prepare(
      `update briar_run_checkpoint_progress
       set state = 'invalidated'
       where run_id = ? and attempt = ? and revision = ?
         and state in ('pending', 'waiting', 'approved')`,
    )
    .bind(run.id, run.current_attempt, run.current_revision)
    .run();
  await db
    .prepare(
      `update briar_hunt_runs
       set waiting_checkpoint_key = null,
           waiting_checkpoint_revision = null
       where id = ? and project_id = ?`,
    )
    .bind(run.id, projectId)
    .run();

  return {
    outcome: "reworked",
    attempt: run.current_attempt,
    revision: nextRevision,
    workflowStage: input.workflowStage,
  };
}
