import {
  requiredWorkflowStages,
  workflowCheckpointAt,
} from "../../src/lib/auto-hunt-contract";

import { HuntTransitionError } from "./hunt-run-errors";
import { loadStageRevisionRequirements } from "./run-stage-revision-repository";
import {
  ensureWorkflowProgress,
  getWorkflowProgress,
  workflowCheckpointRow,
  workflowStageRow,
} from "./workflow-progress-repository";

export async function assertWorkflowRunCompletion(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const initialized = await ensureWorkflowProgress(db, projectId, { runId });
  if (!initialized) throw new HuntTransitionError("Run does not exist");
  const { run, workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  if (progress.waitingCheckpoint) {
    throw new HuntTransitionError(
      `Run is waiting for checkpoint ${progress.waitingCheckpoint.checkpoint_key}; resume it before completion`,
    );
  }
  const terminal = workflow.stages.at(-1);
  const terminalProgress = terminal ? workflowStageRow(progress, terminal.id) : null;
  if (!terminal || terminalProgress?.state !== "completed") {
    throw new HuntTransitionError(
      `Run completion requires the terminal stage ${terminal?.id ?? "none"} to be completed`,
    );
  }
  const terminalAfterCheckpoint = terminal
    ? workflowCheckpointAt(workflow, terminal.id, "after")
    : null;
  if (terminalAfterCheckpoint) {
    const checkpoint = workflowCheckpointRow(progress, terminalAfterCheckpoint.key);
    if (checkpoint?.state !== "approved") {
      throw new HuntTransitionError(
        `Run completion requires terminal checkpoint ${terminalAfterCheckpoint.key} to be approved`,
      );
    }
  }
  const requiredStages = requiredWorkflowStages(workflow);
  const missingStages = requiredStages.filter(
    (stageId) => workflowStageRow(progress, stageId)?.state !== "completed",
  );
  if (missingStages.length > 0) {
    throw new HuntTransitionError(
      `Run completion requires workflow stages: ${missingStages.join(", ")}`,
    );
  }
  const requiredEvidence = workflow.stages.flatMap((stage) =>
    requiredStages.includes(stage.id)
      ? (stage.evidence ?? []).map((type) => ({ stage: stage.id, type }))
      : [],
  );
  if (requiredEvidence.length > 0) {
    const revisionRequirements = await loadStageRevisionRequirements(db, run);
    const evidence = await db
      .prepare(
        `select workflow_stage, evidence_type, revision
         from briar_run_evidence
         where run_id = ? and attempt = ? and revision <= ?
           and status in ('passed', 'skipped')`,
      )
      .bind(run.id, attempt, revision)
      .all<{ workflow_stage: string; evidence_type: string; revision: number }>();
    const accepted = new Set(
      evidence.results
        .filter((item) =>
          item.revision >= (revisionRequirements.get(item.workflow_stage) ?? 1)
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
  return progress;
}
