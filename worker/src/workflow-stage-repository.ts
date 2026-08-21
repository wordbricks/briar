import {
  workflowCheckpointAt,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowCheckpointPosition,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";

import { HuntTransitionError } from "./hunt-run-errors";
import { dashboardStageFor } from "./hunt-run-model";
import { reachWorkflowCheckpoint } from "./workflow-checkpoint-repository";
import {
  assertEarlierWorkflowCheckpointsResolved,
  assertStageBeforeCheckpointApproved,
  ensureWorkflowProgress,
  getWorkflowProgress,
  workflowCheckpointRow,
  type WorkflowProgressInput,
  type WorkflowStageProgressRow,
  workflowStageRank,
  workflowStageRow,
} from "./workflow-progress-repository";

export type WorkflowStageTransitionOutcome =
  | "started"
  | "already_running"
  | "completed"
  | "skipped"
  | "not_found";

export async function startWorkflowStage(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    startedAt: string;
    actor?: string;
  },
): Promise<{
  outcome: WorkflowStageTransitionOutcome;
  stage: WorkflowStageProgressRow | null;
}> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return { outcome: "not_found", stage: null };
  const { run, workflow, attempt, revision } = initialized;
  const rank = workflowStageRank(workflow, input.stageId);
  if (rank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.stageId}`,
    );
  }
  const progress = await getWorkflowProgress(db, projectId, run.id, {
    attempt,
    revision,
  });
  if (!progress) return { outcome: "not_found", stage: null };
  const row = workflowStageRow(progress, input.stageId);
  if (!row) throw new HuntTransitionError(`Missing stage progress: ${input.stageId}`);
  if (row.state === "completed") return { outcome: "completed", stage: row };
  if (row.state === "skipped") return { outcome: "skipped", stage: row };
  if (row.state === "running") return { outcome: "already_running", stage: row };
  const currentRank = run.workflow_stage
    ? workflowStageRank(workflow, run.workflow_stage)
    : -1;
  if (currentRank > rank) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot start after the run moved to a later stage`,
    );
  }
  if (progress.waitingCheckpoint) {
    throw new HuntTransitionError(
      `Run is waiting for checkpoint ${progress.waitingCheckpoint.checkpoint_key}`,
    );
  }
  if (run.paused_at) {
    throw new HuntTransitionError("Run is paused; resume it before starting a stage");
  }
  assertStageBeforeCheckpointApproved(progress, workflow, input.stageId);
  assertEarlierWorkflowCheckpointsResolved(progress, workflow, input.stageId);

  const previousStages = progress.stages.filter(
    (stage) => workflowStageRank(workflow, stage.stage_id) < rank,
  );
  const hasIncompletePreviousStage = previousStages.some(
    (stage) => stage.state !== "completed" && stage.state !== "skipped",
  );
  // A reworked run is deliberately positioned at its target stage by
  // reworkHuntRun. It must not revisit earlier stage/checkpoint boundaries.
  if (hasIncompletePreviousStage) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot start before earlier stages are complete`,
    );
  }
  const eventId = crypto.randomUUID();
  const eventKey = `workflow:stage-start:${attempt}:${revision}:${input.stageId}`;
  const stageLabel = workflow.stages[rank]?.label ?? input.stageId;
  const recordedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `update briar_run_stage_progress
         set state = 'running', started_at = ?, finished_at = null
         where run_id = ? and attempt = ? and revision = ? and stage_id = ?
           and state = 'pending'`,
      )
      .bind(input.startedAt, run.id, attempt, revision, input.stageId),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, 'running', ?, ?, ?, branch, commit_sha,
                null, tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and paused_at is null
           and exists (
             select 1 from briar_run_stage_progress
             where run_id = briar_hunt_runs.id and attempt = ? and revision = ?
               and stage_id = ? and state = 'running'
           )
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        attempt,
        revision,
        dashboardStageFor("running", input.stageId),
        input.stageId,
        `${stageLabel} 단계를 시작했습니다.`,
        input.actor ?? "briar-workflow",
        input.startedAt,
        recordedAt,
        run.id,
        projectId,
        attempt,
        revision,
        attempt,
        revision,
        input.stageId,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = 'running', workflow_stage = ?,
             resume_requested_at = null, last_event_at = max(last_event_at, ?),
             updated_at = max(updated_at, ?)
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and paused_at is null`,
      )
      .bind(
        dashboardStageFor("running", input.stageId),
        input.stageId,
        input.startedAt,
        input.startedAt,
        run.id,
        projectId,
        attempt,
        revision,
      ),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    const current = await getWorkflowProgress(db, projectId, run.id, {
      attempt,
      revision,
    });
    const currentRow = current ? workflowStageRow(current, input.stageId) : null;
    if (currentRow?.state === "running") return { outcome: "already_running", stage: currentRow };
    if (currentRow?.state === "completed") return { outcome: "completed", stage: currentRow };
    throw new HuntTransitionError("Stage progress changed while starting the stage");
  }
  if ((results[2]?.meta.changes ?? 0) === 0) {
    throw new HuntTransitionError("Run changed while starting the stage");
  }
  const updated = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  return {
    outcome: "started",
    stage: updated ? workflowStageRow(updated, input.stageId) : null,
  };
}

export async function completeWorkflowStage(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    finishedAt: string;
  },
): Promise<{
  outcome: WorkflowStageTransitionOutcome;
  stage: WorkflowStageProgressRow | null;
}> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return { outcome: "not_found", stage: null };
  const { run, workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const row = progress ? workflowStageRow(progress, input.stageId) : null;
  if (!row) throw new HuntTransitionError(`Missing stage progress: ${input.stageId}`);
  if (row.state === "completed") return { outcome: "completed", stage: row };
  const rank = workflowStageRank(workflow, input.stageId);
  if (rank < 0) throw new HuntTransitionError(`Missing stage: ${input.stageId}`);
  const currentRank = run.workflow_stage
    ? workflowStageRank(workflow, run.workflow_stage)
    : -1;
  if (currentRank > rank) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot complete after the run moved to a later stage`,
    );
  }
  assertStageBeforeCheckpointApproved(progress, workflow, input.stageId);
  assertEarlierWorkflowCheckpointsResolved(progress, workflow, input.stageId);
  const previousStages = progress.stages.filter(
    (stage) => workflowStageRank(workflow, stage.stage_id) < rank,
  );
  if (previousStages.some((stage) => stage.state !== "completed" && stage.state !== "skipped")) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot complete before earlier stages are complete`,
    );
  }
  if (row.state !== "running") {
    throw new HuntTransitionError(
      `Stage ${input.stageId} must be running before it can complete`,
    );
  }
  const result = await db
    .prepare(
      `update briar_run_stage_progress
       set state = 'completed', finished_at = ?
       where run_id = ? and attempt = ? and revision = ? and stage_id = ?
         and state = 'running'`,
    )
    .bind(input.finishedAt, run.id, attempt, revision, input.stageId)
    .run();
  if (result.meta.changes === 0) {
    throw new HuntTransitionError("Stage progress changed while completing the stage");
  }
  const updated = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  return {
    outcome: "completed",
    stage: updated ? workflowStageRow(updated, input.stageId) : null,
  };
}

export type WorkflowStageLifecycleCheckpoint = {
  key: string;
  stage: AutoHuntWorkflowStageId;
  position: AutoHuntWorkflowCheckpointPosition;
  revision: number;
};

export type WorkflowStageLifecycleResult = {
  outcome:
    | "started"
    | "completed"
    | "already_started"
    | "already_completed"
    | "paused"
    | "not_found";
  attempt: number | null;
  revision: number | null;
  stage: AutoHuntWorkflowStageId;
  checkpoint: WorkflowStageLifecycleCheckpoint | null;
};

const lifecycleCheckpoint = (
  checkpoint: AutoHuntWorkflowCheckpoint,
  revision: number,
): WorkflowStageLifecycleCheckpoint => ({
  key: checkpoint.key,
  stage: checkpoint.stage,
  position: checkpoint.position,
  revision,
});

const pauseAtWorkflowCheckpoint = async (
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    checkpoint: AutoHuntWorkflowCheckpoint;
    reachedAt: string;
  },
) => {
  const reached = await reachWorkflowCheckpoint(db, projectId, {
    runId: input.runId,
    attempt: input.attempt,
    revision: input.revision,
    checkpointKey: input.checkpoint.key,
    reachedAt: input.reachedAt,
  });
  if (!["waiting", "already_waiting"].includes(reached.outcome)) {
    throw new HuntTransitionError(
      `Checkpoint ${input.checkpoint.key} changed while pausing the workflow`,
    );
  }
  return lifecycleCheckpoint(input.checkpoint, reached.revision!);
};

export async function assertWorkflowStageEvidence(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & { stageId: AutoHuntWorkflowStageId },
) {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) throw new HuntTransitionError("Run does not exist");
  const { run, workflow, attempt, revision } = initialized;
  const stage = workflow.stages.find((candidate) => candidate.id === input.stageId);
  if (!stage) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.stageId}`,
    );
  }
  const requiredEvidence = stage.evidence ?? [];
  if (requiredEvidence.length === 0) return;
  const requirement = await db
    .prepare(
      `select required_revision from briar_run_stage_revisions
       where run_id = ? and attempt = ? and workflow_stage = ?`,
    )
    .bind(run.id, attempt, input.stageId)
    .first<{ required_revision: number }>();
  const minimumRevision = requirement?.required_revision ?? 1;
  const result = await db
    .prepare(
      `select evidence_type from briar_run_evidence
       where run_id = ? and attempt = ? and workflow_stage = ?
         and revision >= ? and revision <= ?
         and status in ('passed', 'skipped')`,
    )
    .bind(run.id, attempt, input.stageId, minimumRevision, revision)
    .all<{ evidence_type: string }>();
  const accepted = new Set(result.results.map((item) => item.evidence_type));
  const missing = requiredEvidence.filter((type) => !accepted.has(type));
  if (missing.length > 0) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} requires evidence: ${missing.join(", ")}`,
    );
  }
}

export async function startWorkflowStageLifecycle(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    startedAt: string;
    actor?: string;
  },
): Promise<WorkflowStageLifecycleResult> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) {
    return {
      outcome: "not_found",
      attempt: null,
      revision: null,
      stage: input.stageId,
      checkpoint: null,
    };
  }
  const { workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, input.runId, {
    attempt,
    revision,
  });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const stageRank = workflowStageRank(workflow, input.stageId);
  const blockingCheckpoint = workflow.execution.checkpoints.find((checkpoint) => {
    const row = workflowCheckpointRow(progress, checkpoint.key);
    const checkpointRank = workflowStageRank(workflow, checkpoint.stage);
    return row && ["pending", "waiting"].includes(row.state) &&
      (checkpointRank < stageRank ||
        (checkpointRank === stageRank && checkpoint.position === "before"));
  });
  const blockingProgress = blockingCheckpoint
    ? workflowCheckpointRow(progress, blockingCheckpoint.key)
    : null;
  if (blockingCheckpoint && blockingProgress) {
    const checkpoint = blockingProgress.state === "waiting"
      ? lifecycleCheckpoint(blockingCheckpoint, revision)
      : await pauseAtWorkflowCheckpoint(db, projectId, {
          runId: input.runId,
          attempt,
          revision,
          checkpoint: blockingCheckpoint,
          reachedAt: input.startedAt,
        });
    return {
      outcome: "paused",
      attempt,
      revision,
      stage: input.stageId,
      checkpoint,
    };
  }
  const prior = workflowStageRow(progress, input.stageId);
  const started = await startWorkflowStage(db, projectId, {
    ...input,
    attempt,
    revision,
  });
  return {
    outcome: prior?.state === "completed" || prior?.state === "skipped"
      ? "already_completed"
      : started.outcome === "already_running"
        ? "already_started"
        : started.outcome === "not_found"
          ? "not_found"
          : "started",
    attempt,
    revision,
    stage: input.stageId,
    checkpoint: null,
  };
}

export async function completeWorkflowStageLifecycle(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    finishedAt: string;
  },
): Promise<WorkflowStageLifecycleResult> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) {
    return {
      outcome: "not_found",
      attempt: null,
      revision: null,
      stage: input.stageId,
      checkpoint: null,
    };
  }
  const { workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, input.runId, {
    attempt,
    revision,
  });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const prior = workflowStageRow(progress, input.stageId);
  if (prior?.state !== "completed" && prior?.state !== "skipped") {
    await assertWorkflowStageEvidence(db, projectId, {
      runId: input.runId,
      attempt,
      revision,
      stageId: input.stageId,
    });
  }
  const completed = await completeWorkflowStage(db, projectId, {
    ...input,
    attempt,
    revision,
  });
  const updated = await getWorkflowProgress(db, projectId, input.runId, {
    attempt,
    revision,
  });
  const after = workflowCheckpointAt(workflow, input.stageId, "after");
  const afterProgress = after && updated
    ? workflowCheckpointRow(updated, after.key)
    : null;
  if (after && afterProgress && ["pending", "waiting"].includes(afterProgress.state)) {
    const checkpoint = afterProgress.state === "waiting"
      ? lifecycleCheckpoint(after, revision)
      : await pauseAtWorkflowCheckpoint(db, projectId, {
          runId: input.runId,
          attempt,
          revision,
          checkpoint: after,
          reachedAt: input.finishedAt,
        });
    return {
      outcome: "paused",
      attempt,
      revision,
      stage: input.stageId,
      checkpoint,
    };
  }
  return {
    outcome: prior?.state === "completed" || prior?.state === "skipped"
      ? "already_completed"
      : completed.outcome === "not_found"
        ? "not_found"
        : "completed",
    attempt,
    revision,
    stage: input.stageId,
    checkpoint: null,
  };
}
