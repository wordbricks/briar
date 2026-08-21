import {
  workflowCheckpointAt,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpointPosition,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";

import { parseWorkflow } from "./hunt-run-codec";
import { HuntTransitionError } from "./hunt-run-errors";
import { type HuntRunRow } from "./hunt-run-model";
import { getHuntRunForProject } from "./hunt-run-repository";

export type WorkflowStageProgressState =
  | "pending"
  | "running"
  | "completed"
  | "skipped";

export type WorkflowCheckpointProgressState =
  | "pending"
  | "waiting"
  | "approved"
  | "invalidated";

export type WorkflowStageProgressRow = {
  run_id: string;
  attempt: number;
  revision: number;
  stage_id: AutoHuntWorkflowStageId;
  state: WorkflowStageProgressState;
  started_at: string | null;
  finished_at: string | null;
};

export type WorkflowCheckpointProgressRow = {
  run_id: string;
  attempt: number;
  revision: number;
  checkpoint_key: string;
  stage_id: AutoHuntWorkflowStageId;
  position: AutoHuntWorkflowCheckpointPosition;
  state: WorkflowCheckpointProgressState;
  reached_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_request_id: string | null;
};

export type WorkflowProgress = {
  runId: string;
  attempt: number;
  revision: number;
  stages: WorkflowStageProgressRow[];
  checkpoints: WorkflowCheckpointProgressRow[];
  waitingCheckpoint: WorkflowCheckpointProgressRow | null;
};

type WorkflowProgressIdentity = {
  attempt?: number;
  revision?: number;
};

export type WorkflowProgressInput = WorkflowProgressIdentity & {
  runId: string;
};

const resolveWorkflowProgressIdentity = (
  run: HuntRunRow,
  input: WorkflowProgressIdentity,
) => {
  const attempt = input.attempt ?? run.current_attempt;
  const revision = input.revision ?? run.current_revision;
  if (attempt !== run.current_attempt || revision !== run.current_revision) {
    throw new HuntTransitionError(
      `Workflow progress identity is stale (current attempt ${run.current_attempt}, revision ${run.current_revision})`,
    );
  }
  return { attempt, revision };
};

const workflowProgressRows = async (
  db: D1Database,
  run: HuntRunRow,
  attempt: number,
  revision: number,
) => {
  const [stageResult, checkpointResult] = await Promise.all([
    db
      .prepare(
        `select run_id, attempt, revision, stage_id, state, started_at, finished_at
         from briar_run_stage_progress
         where run_id = ? and attempt = ? and revision = ?`,
      )
      .bind(run.id, attempt, revision)
      .all<WorkflowStageProgressRow>(),
    db
      .prepare(
        `select run_id, attempt, revision, checkpoint_key, stage_id, position,
                state, reached_at, approved_at, approved_by, approved_request_id
         from briar_run_checkpoint_progress
         where run_id = ? and attempt = ? and revision = ?`,
      )
      .bind(run.id, attempt, revision)
      .all<WorkflowCheckpointProgressRow>(),
  ]);
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const stageOrder = new Map(workflow.stages.map((stage, index) => [stage.id, index]));
  const checkpointOrder = new Map(
    workflow.execution.checkpoints.map((checkpoint, index) => [checkpoint.key, index]),
  );
  const stages = [...stageResult.results].sort(
    (left, right) =>
      (stageOrder.get(left.stage_id) ?? Number.MAX_SAFE_INTEGER) -
      (stageOrder.get(right.stage_id) ?? Number.MAX_SAFE_INTEGER),
  );
  const checkpoints = [...checkpointResult.results].sort(
    (left, right) =>
      (checkpointOrder.get(left.checkpoint_key) ?? Number.MAX_SAFE_INTEGER) -
      (checkpointOrder.get(right.checkpoint_key) ?? Number.MAX_SAFE_INTEGER),
  );
  return { stages, checkpoints };
};

export const ensureWorkflowProgress = async (
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput,
) => {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return null;
  const { attempt, revision } = resolveWorkflowProgressIdentity(run, input);
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const targetRank = run.workflow_stage
    ? workflowStageRank(workflow, run.workflow_stage)
    : -1;
  let previousRevision: number | null = null;
  if (revision > 1 && targetRank >= 0) {
    const previous = await db
      .prepare(
        `select max(revision) as revision
         from briar_run_stage_progress
         where run_id = ? and attempt = ? and revision < ?`,
      )
      .bind(run.id, attempt, revision)
      .first<{ revision: number | null }>();
    previousRevision = previous?.revision ?? null;
  }
  const statements = [
    ...(previousRevision === null
      ? []
      : workflow.stages
          .slice(0, targetRank)
          .map((stage) =>
            db
              .prepare(
                `insert into briar_run_stage_progress (
                   run_id, attempt, revision, stage_id, state, started_at, finished_at
                 )
                 select run_id, attempt, ?, stage_id, state, started_at, finished_at
                 from briar_run_stage_progress
                 where run_id = ? and attempt = ? and revision = ?
                   and stage_id = ? and state in ('completed', 'skipped')
                 on conflict(run_id, attempt, revision, stage_id) do nothing`,
              )
              .bind(revision, run.id, attempt, previousRevision, stage.id),
          )),
    ...workflow.stages.map((stage) =>
      db
        .prepare(
          `insert into briar_run_stage_progress (
             run_id, attempt, revision, stage_id, state, started_at, finished_at
           ) values (?, ?, ?, ?, 'pending', null, null)
           on conflict(run_id, attempt, revision, stage_id) do nothing`,
        )
        .bind(run.id, attempt, revision, stage.id),
    ),
    ...workflow.execution.checkpoints.map((checkpoint) =>
      db
        .prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id, position,
             state, reached_at, approved_at, approved_by, approved_request_id
           ) values (?, ?, ?, ?, ?, ?, ?, null, null, null, null)
           on conflict(run_id, attempt, revision, checkpoint_key) do nothing`,
        )
        .bind(
          run.id,
          attempt,
          revision,
          checkpoint.key,
          checkpoint.stage,
          checkpoint.position,
          targetRank >= 0 && workflowStageRank(workflow, checkpoint.stage) < targetRank
            ? "invalidated"
            : "pending",
        ),
    ),
  ];
  if (statements.length > 0) await db.batch(statements);
  return { run, workflow, attempt, revision };
};

export async function initializeWorkflowProgress(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput,
) {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return null;
  return getWorkflowProgress(db, projectId, input.runId, {
    attempt: initialized.attempt,
    revision: initialized.revision,
  });
}

export async function getWorkflowProgress(
  db: D1Database,
  projectId: string,
  runId: string,
  identity: WorkflowProgressIdentity = {},
): Promise<WorkflowProgress | null> {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const { attempt, revision } = resolveWorkflowProgressIdentity(run, identity);
  const rows = await workflowProgressRows(db, run, attempt, revision);
  return {
    runId: run.id,
    attempt,
    revision,
    stages: rows.stages,
    checkpoints: rows.checkpoints,
    waitingCheckpoint:
      rows.checkpoints.find((checkpoint) => checkpoint.state === "waiting") ?? null,
  };
}

export const workflowStageRow = (
  progress: WorkflowProgress,
  stageId: AutoHuntWorkflowStageId,
) => progress.stages.find((stage) => stage.stage_id === stageId) ?? null;

export const workflowCheckpointRow = (
  progress: WorkflowProgress,
  checkpointKey: string,
) => progress.checkpoints.find((checkpoint) => checkpoint.checkpoint_key === checkpointKey) ?? null;

export const workflowStageRank = (
  workflow: AutoHuntWorkflow,
  stageId: AutoHuntWorkflowStageId,
) => workflow.stages.findIndex((stage) => stage.id === stageId);

export const assertStageBeforeCheckpointApproved = (
  progress: WorkflowProgress,
  workflow: AutoHuntWorkflow,
  stageId: AutoHuntWorkflowStageId,
) => {
  const checkpoint = workflowCheckpointAt(workflow, stageId, "before");
  if (!checkpoint) return;
  const row = workflowCheckpointRow(progress, checkpoint.key);
  if (!row || row.state !== "approved") {
    throw new HuntTransitionError(
      `Stage ${stageId} is waiting for before checkpoint ${checkpoint.key}`,
    );
  }
};

export const assertEarlierWorkflowCheckpointsResolved = (
  progress: WorkflowProgress,
  workflow: AutoHuntWorkflow,
  stageId: AutoHuntWorkflowStageId,
) => {
  const stageRank = workflowStageRank(workflow, stageId);
  const unresolved = progress.checkpoints.find((checkpoint) => {
    const checkpointRank = workflowStageRank(workflow, checkpoint.stage_id);
    const isBeforeCurrentStage =
      checkpointRank < stageRank ||
      (checkpointRank === stageRank && checkpoint.position === "before");
    return isBeforeCurrentStage &&
      checkpoint.state !== "approved" &&
      checkpoint.state !== "invalidated";
  });
  if (unresolved) {
    throw new HuntTransitionError(
      `Stage ${stageId} is blocked by checkpoint ${unresolved.checkpoint_key}`,
    );
  }
};
