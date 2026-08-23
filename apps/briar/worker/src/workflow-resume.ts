import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import {
  getHuntRunForProject,
  initializeWorkflowProgress,
  resumeWorkflowCheckpoint,
} from "./db";
import type { ResumeUserInput } from "./run-request-contract";

export async function claimWorkflowContext(
  db: D1Database,
  projectId: string,
  run: NonNullable<Awaited<ReturnType<typeof getHuntRunForProject>>>,
) {
  const workflow = normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json));
  const terminalStage = workflow.stages.at(-1)?.id ?? null;
  const progress = await initializeWorkflowProgress(db, projectId, {
    runId: run.id,
    attempt: run.current_attempt,
    revision: run.current_revision,
  });
  if (!progress) return { startStage: null, resumeContext: null };
  const latestApproval = [...progress.checkpoints]
    .filter((checkpoint) => checkpoint.state === "approved" && checkpoint.approved_at)
    .sort((left, right) =>
      (right.approved_at ?? "").localeCompare(left.approved_at ?? "")
    )[0] ?? null;
  const terminalReviewOnly = latestApproval?.position === "after" &&
    latestApproval.stage_id === terminalStage &&
    progress.stages.every((stage) =>
      stage.state === "completed" || stage.state === "skipped"
    );
  const startStage = terminalReviewOnly
    ? null
    : progress.stages.find((stage) => stage.state === "running")?.stage_id ??
      progress.stages.find((stage) => stage.state === "pending")?.stage_id ??
      null;
  return {
    startStage,
    resumeContext: latestApproval
      ? {
          checkpointKey: latestApproval.checkpoint_key,
          position: latestApproval.position,
          revision: latestApproval.revision,
          terminalReviewOnly,
        }
      : null,
  };
}

export async function resumeRunWithCheckpointIdentity(
  db: D1Database,
  projectId: string,
  runId: string,
  input: ResumeUserInput,
  actor: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) {
    return {
      outcome: "not_found" as const,
      checkpointKey: null,
      attempt: null,
      revision: null,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  return resumeWorkflowCheckpoint(db, projectId, {
    runId,
    checkpointKey: input.checkpointKey,
    attempt: input.attempt,
    revision: input.revision,
    requestId: input.requestId,
    actor,
    approvedAt: new Date().toISOString(),
  });
}

