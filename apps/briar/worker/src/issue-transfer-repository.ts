import {
  workflowWithAdditionalCheckpoints,
  type AutoHuntRunStatus,
  type AutoHuntWorkflowCheckpoint,
} from "../../src/lib/auto-hunt-contract";

import {
  isChannelApprovedIssue,
} from "./channel-issue-approval-repository";
import {
  parseWorkflow,
  runIsFullAuto,
  stableJson,
} from "./hunt-run-codec";
import { type HuntRunRow } from "./hunt-run-model";
import { getHuntRunForProject } from "./hunt-run-repository";
import {
  transferredIssueRelationStatements,
} from "./issue-transfer-relations";
import { getProjectSettings } from "./project-settings-repository";

export type TransferIssueOutcome =
  | "transferred"
  | "not_found"
  | "active"
  | "same_project"
  | "source_key_conflict"
  | "archive_in_progress"
  | "proposal_approval_in_progress"
  | "execution_approval_boundary";

const isActivelyClaimedRun = (run: HuntRunRow, observedAt: string) =>
  run.status === "running" ||
  (
    run.status === "queued" &&
    run.lease_expires_at != null &&
    run.lease_expires_at > observedAt
  );

const completedChannelIssueTransferExists = async (
  db: D1Database,
  input: {
    sourceProjectId: string;
    run: Pick<HuntRunRow, "id" | "source_key">;
  },
) => Boolean(await db
    .prepare(
      `select 1 as transferred
       from briar_channel_issue_approval_audit approval
       where approval.run_id = ? and approval.issue_source_key = ?
         and approval.project_id = ?
         and approval.result_verification in ('atomic', 'legacy_authorized')
         and exists (
           select 1 from briar_dashboard_changes tombstone
           where tombstone.project_id = ? and tombstone.entity_type = 'run'
             and tombstone.entity_id = approval.run_id
             and tombstone.operation = 'delete'
         )
       limit 1`,
    )
    .bind(
      input.run.id,
      input.run.source_key,
      input.sourceProjectId,
      input.sourceProjectId,
    )
    .first<{ transferred: number }>());

/**
 * Move an issue (hunt run) and its project-scoped children to another project
 * in the same organization. Active/leased runs cannot transfer. Source-project
 * dashboard clients receive an explicit delete tombstone; the run UPDATE trigger
 * upserts the issue into the target project.
 */
export async function transferIssue(
  db: D1Database,
  input: {
    sourceProjectId: string;
    targetProjectId: string;
    targetProjectName: string;
    runId: string;
    observedAt: string;
  },
): Promise<TransferIssueOutcome> {
  if (input.sourceProjectId === input.targetProjectId) {
    return "same_project";
  }

  const run = await getHuntRunForProject(
    db,
    input.sourceProjectId,
    input.runId,
  );
  if (!run) {
    const alreadyMoved = await getHuntRunForProject(
      db,
      input.targetProjectId,
      input.runId,
    );
    if (!alreadyMoved) return "not_found";
    // A target row alone is not transfer provenance: it may have always
    // belonged to that project. The source tombstone proves an atomic transfer
    // committed before a retry lost its response.
    const completedTransfer = await completedChannelIssueTransferExists(db, {
      sourceProjectId: input.sourceProjectId,
      run: alreadyMoved,
    });
    return completedTransfer ? "transferred" : "not_found";
  }
  if (isActivelyClaimedRun(run, input.observedAt)) return "active";
  const verifiedArchive = await db
    .prepare(
      `select 1 as archiving from briar_log_archives
       where run_id = ? and status = 'verified'
         and archive_kind <> 'execution_audit'
       limit 1`,
    )
    .bind(input.runId)
    .first<{ archiving: number }>();
  if (verifiedArchive) return "archive_in_progress";
  const channelApprovedIssue = await isChannelApprovedIssue(db, run);
  const conversationalExecutionApproved = Boolean(
    run.dispatch_request_id && await db
      .prepare(
        `select 1 as approved
         where exists (
           select 1 from briar_issue_execution_proposals proposal
           where proposal.target_run_id = ? and proposal.project_id = ?
             and proposal.dispatch_request_id = ?
         ) or exists (
           select 1 from briar_issue_execution_approval_audit approval
           where approval.run_id = ? and approval.project_id = ?
             and approval.dispatch_request_id = ?
         )`,
      )
      .bind(
        run.id,
        input.sourceProjectId,
        run.dispatch_request_id,
        run.id,
        input.sourceProjectId,
        run.dispatch_request_id,
      )
      .first<{ approved: number }>(),
  );
  const executionApprovedIssue =
    channelApprovedIssue || conversationalExecutionApproved;
  // A terminal result is historical state, so do not silently turn it into a
  // target-project execution candidate. Rework needs a separate approval-aware
  // flow instead of carrying the source project's execution authority across.
  if (
    executionApprovedIssue &&
    (["completed", "cancelled"] as AutoHuntRunStatus[]).includes(run.status)
  ) {
    return "execution_approval_boundary";
  }

  const conflict = await db
    .prepare(
      `select id from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(input.targetProjectId, run.source, run.source_key)
    .first<{ id: string }>();
  if (conflict) return "source_key_conflict";

  const resetExecutionApproval =
    (["queued", "blocked", "failed"] as AutoHuntRunStatus[]).includes(
      run.status,
    ) && executionApprovedIssue;
  const targetSettings = await getProjectSettings(db, input.targetProjectId);
  const adoptTargetWorkflow =
    run.status === "backlog" || run.status === "queued" ||
    resetExecutionApproval;
  const fullAuto = runIsFullAuto(run);
  const targetBaseWorkflow = parseWorkflow(targetSettings?.workflow_json ?? null);
  const targetStageIds = new Set(targetBaseWorkflow.stages.map((stage) => stage.id));
  const targetBoundaries = new Set(
    targetBaseWorkflow.execution.checkpoints.map(
      (checkpoint) => `${checkpoint.stage}:${checkpoint.position}`,
    ),
  );
  const compatibleIssueCheckpoints = adoptTargetWorkflow && !fullAuto
    ? (JSON.parse(run.issue_checkpoints_json || "[]") as AutoHuntWorkflowCheckpoint[])
        .filter(
          (checkpoint) =>
            targetStageIds.has(checkpoint.stage) &&
            !targetBoundaries.has(`${checkpoint.stage}:${checkpoint.position}`),
        )
    : [];
  const targetWorkflowJson = adoptTargetWorkflow
    ? stableJson(
        fullAuto
          ? { ...targetBaseWorkflow, execution: { checkpoints: [] } }
          : workflowWithAdditionalCheckpoints(
              targetBaseWorkflow,
              compatibleIssueCheckpoints,
            ),
      )
    : run.workflow_snapshot_json;
  const targetRepository = adoptTargetWorkflow
    ? (targetSettings?.github_repository ?? input.targetProjectName)
    : run.repository;
  const refreshWorkflow = adoptTargetWorkflow ? 1 : 0;
  // Move the run, every project-scoped child, proposal, and the source
  // dashboard tombstone in one D1 batch transaction. The target-project
  // predicates on each relation also make a raced no-op update harmless.
  const moveStatement = db
    .prepare(
      `update briar_hunt_runs
       set project_id = ?,
           status = case
             when ? = 1 and status in ('queued', 'blocked', 'failed')
               then 'backlog' else status end,
           stage = case
             when ? = 1 and status in ('queued', 'blocked', 'failed')
               then 'queued' else stage end,
           workflow_stage = case
             when ? = 1 and status in ('queued', 'blocked', 'failed')
               then null else workflow_stage end,
           repository = case when ? = 1 then ? else repository end,
           workflow_snapshot_json = case when ? = 1 then ? else workflow_snapshot_json end,
           issue_checkpoints_json = case when ? = 1 then ? else issue_checkpoints_json end,
           agent_id = null,
           worker_id = null,
           requested_worker_id = null,
           claim_token_hash = null,
           claimed_by = null,
           claimed_at = null,
           lease_expires_at = null,
           claim_attempts = 0,
           last_execution_id = null,
           dispatch_mode = null,
           dispatch_request_id = null,
           dispatched_at = null,
           requested_by_user_id = null,
           requested_agent_provider = null,
           requested_agent_model = null,
           requested_agent_effort = null,
           paused_at = case when ? = 1 then null else paused_at end,
           resume_requested_at = case
             when ? = 1 then null else resume_requested_at end,
           completed_at = case when ? = 1 then null else completed_at end,
           updated_at = ?
       where id = ? and project_id = ?
         and status <> 'running'
         and not (
           status = 'queued'
           and lease_expires_at is not null
           and lease_expires_at > ?
         )
       returning id`,
    )
    .bind(
      input.targetProjectId,
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      refreshWorkflow,
      targetRepository,
      refreshWorkflow,
      targetWorkflowJson,
      refreshWorkflow,
      stableJson(compatibleIssueCheckpoints),
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      input.observedAt,
      input.runId,
      input.sourceProjectId,
      input.observedAt,
    );
  let transferResults: D1Result<unknown>[];
  try {
    transferResults = await db.batch([
      moveStatement,
      ...transferredIssueRelationStatements(db, input),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("verified run archive prevents transfer")
    ) {
      return "archive_in_progress";
    }
    if (
      error instanceof Error &&
      error.message.includes("conversation proposal acceptance in progress")
    ) {
      return "proposal_approval_in_progress";
    }
    throw error;
  }
  const movedRun = transferResults[0].results?.[0] as
    | { id: string }
    | undefined;

  if (!movedRun) {
    const stillThere = await getHuntRunForProject(
      db,
      input.sourceProjectId,
      input.runId,
    );
    if (!stillThere) {
      const alreadyMoved = await getHuntRunForProject(
        db,
        input.targetProjectId,
        input.runId,
      );
      if (!alreadyMoved) return "not_found";
      // This invocation observed the run in the source before another caller
      // atomically completed the same transfer.
    } else {
      return isActivelyClaimedRun(stillThere, input.observedAt)
        ? "active"
        : "not_found";
    }
  }

  return "transferred";
}
