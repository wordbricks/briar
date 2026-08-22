import {
  type AutoHuntPersistedRunStatus,
  type AutoHuntRunStatus,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";

import { isChannelApprovedIssue } from "./channel-issue-approval-repository";
import { type HuntEventRow } from "./hunt-event-model";
import { parseWorkflow } from "./hunt-run-codec";
import { HuntTransitionError } from "./hunt-run-errors";
import { dashboardStageFor } from "./hunt-run-model";
import { getHuntRunForProject } from "./hunt-run-repository";

export type HuntMoveOutcome =
  "moved" | "unchanged" | "already_moved" | "not_found";

export async function moveHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    status: AutoHuntPersistedRunStatus;
    workflowStage: AutoHuntWorkflowStageId | null;
    requestId: string;
    actor: string;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntMoveOutcome;
  status: AutoHuntRunStatus | null;
  workflowStage: AutoHuntWorkflowStageId | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return { outcome: "not_found", status: null, workflowStage: null };
  }

  const workflow = parseWorkflow(run.workflow_snapshot_json);
  if (input.status === "running") {
    const targetRank = workflow.stages.findIndex(
      (stage) => stage.id === input.workflowStage,
    );
    if (
      !input.workflowStage ||
      targetRank < 0
    ) {
      throw new HuntTransitionError(
        `Workflow stage is not configured for this run: ${input.workflowStage ?? "none"}`,
      );
    }
    if (run.paused_at) {
      throw new HuntTransitionError(
        "Run is paused; resume it before moving to another workflow stage",
      );
    }
  } else if (input.workflowStage !== null) {
    throw new HuntTransitionError(
      "Only running status can select a workflow stage",
    );
  }

  const targetWorkflowStage =
    input.status === "backlog" || input.status === "queued"
      ? null
      : input.status === "running"
        ? input.workflowStage
        : run.workflow_stage;
  const eventKey = `admin:move:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select status, workflow_stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
  if (existingEvent) {
    return {
      outcome: "already_moved",
      status: existingEvent.status,
      workflowStage: existingEvent.workflow_stage,
    };
  }
  if (
    run.status === input.status &&
    (input.status !== "running" || run.workflow_stage === targetWorkflowStage)
  ) {
    return {
      outcome: "unchanged",
      status: run.status,
      workflowStage: run.workflow_stage,
    };
  }
  if (
    ["completed", "cancelled"].includes(run.status) &&
    !["completed", "cancelled"].includes(input.status) &&
    await isChannelApprovedIssue(db, run)
  ) {
    throw new HuntTransitionError(
      "Approved issue execution requires fresh approval before reactivation",
    );
  }

  if (run.paused_at && input.status === "completed") {
    throw new HuntTransitionError(
      "Run is paused; resume it before completing the workflow",
    );
  }
  // Manual board/list moves are an operator override. They must not apply the
  // agent completion gate (required stages, evidence, result summary, Linear).
  // That gate still applies to `recordHuntEvent` / `briar run complete`, which
  // is the path workers use. Applying it to drag-and-drop left a raw English
  // error banner on the issue list when `merged:merge_commit` (or other
  // evidence) was missing.

  const targetStage = dashboardStageFor(input.status, targetWorkflowStage);
  const currentRank = run.workflow_stage
    ? workflow.stages.findIndex((stage) => stage.id === run.workflow_stage)
    : -1;
  const targetRank = targetWorkflowStage
    ? workflow.stages.findIndex((stage) => stage.id === targetWorkflowStage)
    : -1;
  const isRegression =
    input.status === "running" &&
    currentRank >= 0 &&
    targetRank >= 0 &&
    targetRank < currentRank;
  const targetLabel =
    input.status === "running"
      ? workflow.stages.find((stage) => stage.id === targetWorkflowStage)?.label
      : {
          backlog: "백로그",
          queued: "대기",
          blocked: "차단",
          failed: "실패",
          completed: "완료",
          cancelled: "취소",
        }[input.status];
  const detail = `사용자가 작업을 ${targetLabel ?? input.status} 상태로 이동했습니다.`;
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const targetAttempt =
    input.status === "queued" ? run.current_attempt + 1 : run.current_attempt;
  const targetRevision =
    input.status === "queued"
      ? 1
      : isRegression
        ? run.current_revision + 1
        : run.current_revision;
  const invalidatedStages = isRegression
    ? workflow.stages.slice(targetRank).map((stage) => stage.id)
    : [];
  const completedAt = ["completed", "cancelled"].includes(input.status)
    ? input.occurredAt
    : null;

  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
           detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
           pull_request_urls, target_sha, occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, ?, ?, ?, ?, branch, commit_sha,
                null, tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        targetAttempt,
        targetRevision,
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = ?, workflow_stage = ?, detail = ?,
             current_attempt = ?, current_revision = ?,
             commit_sha = case when ? then null else commit_sha end,
             target_sha = case when ? then null else target_sha end,
             result_summary = case when ? then null else result_summary end,
             structured_result_json = case when ? then null else structured_result_json end,
             staging_qa_status = case when ? then null else staging_qa_status end,
             production_qa_status = case when ? then null else production_qa_status end,
             staging_qa_detail = case when ? then null else staging_qa_detail end,
             production_qa_detail = case when ? then null else production_qa_detail end,
             claim_token_hash = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, paused_at = null,
             resume_requested_at = null, completed_at = ?, last_event_at = ?,
             updated_at = ?
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        targetAttempt,
        targetRevision,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        completedAt,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
        eventId,
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
          targetAttempt,
          targetRevision,
          input.occurredAt,
        ),
    ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select status, workflow_stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
    if (duplicate) {
      return {
        outcome: "already_moved",
        status: duplicate.status,
        workflowStage: duplicate.workflow_stage,
      };
    }
    throw new HuntTransitionError(
      "Issue processing run changed while its status was being moved",
    );
  }

  return {
    outcome: "moved",
    status: input.status,
    workflowStage: targetWorkflowStage,
  };
}
