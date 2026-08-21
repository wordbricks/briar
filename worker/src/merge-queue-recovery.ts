import { MERGE_WAIT_CHECKPOINT_KEYS } from "../../src/lib/merge-group-validation-contract";
import { reworkHuntRun } from "./db";
import {
  generationMembers,
  type MergeQueueGenerationRow,
} from "./merge-queue-coordinator";

type PausedGenerationRun = {
  id: string;
  project_id: string;
  current_attempt: number;
  current_revision: number;
  status: string;
  workflow_stage: string | null;
  paused_at: string | null;
  waiting_checkpoint_key: string | null;
};

/**
 * A terminal native-queue failure cannot resume a run as merged. It instead
 * invalidates ci_qa for each exact sealed member and puts a new revision back
 * in the actionable queue. The normal signed pull_request merged webhook is
 * still the only path that advances a successful member past merge wait.
 */
export async function reworkTerminalMergeQueueGeneration(
  db: D1Database,
  input: {
    generationId: string;
    jobId: string;
    code: string;
    detail: string;
    observedAt: string;
    superseded?: boolean;
  },
) {
  const generation = await db.prepare(
    `select * from merge_queue_generations where id = ?`,
  ).bind(input.generationId).first<MergeQueueGenerationRow>();
  if (!generation) return { generation: false, reworked: 0 };

  await db.prepare(
    `update merge_queue_generations
     set state = ?, error_code = ?, error_detail = ?, updated_at = ?
     where id = ? and state in (
       'collecting', 'sealing', 'enqueuing', 'awaiting_tail', 'validating'
     )`,
  ).bind(
    input.superseded ? "superseded" : "failed",
    input.code,
    input.detail.slice(0, 4_000),
    input.observedAt,
    input.generationId,
  ).run();

  let reworked = 0;
  for (const member of generationMembers(generation)) {
    const run = await db.prepare(
      `select id, project_id, current_attempt, current_revision, status,
              workflow_stage, paused_at, waiting_checkpoint_key
       from briar_hunt_runs where id = ? and project_id = ?`,
    ).bind(member.runId, member.projectId).first<PausedGenerationRun>();
    if (
      !run || run.status !== "running" || run.workflow_stage !== "merged" ||
      !run.paused_at || !run.waiting_checkpoint_key ||
      !MERGE_WAIT_CHECKPOINT_KEYS.includes(
        run.waiting_checkpoint_key as (typeof MERGE_WAIT_CHECKPOINT_KEYS)[number],
      ) ||
      run.current_attempt !== member.attempt ||
      run.current_revision !== member.revision
    ) {
      continue;
    }
    const result = await reworkHuntRun(db, member.projectId, {
      runId: member.runId,
      workflowStage: "ci_qa",
      requestId: `merge-group:${input.jobId}:${input.code}`,
      actor: "merge-group-coordinator",
      reason:
        `Merge-group job ${input.jobId} requires rework (${input.code}). ` +
        `${input.detail.slice(0, 2_000)} Retry from ci_qa; merged resume still ` +
        "requires the signed pull_request merged webhook.",
      occurredAt: input.observedAt,
      checkpoint: {
        key: run.waiting_checkpoint_key,
        attempt: member.attempt,
        revision: member.revision,
      },
    });
    if (result.outcome === "reworked") reworked += 1;
  }
  return { generation: true, reworked };
}
