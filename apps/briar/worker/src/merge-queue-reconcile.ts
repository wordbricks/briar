import {
  reconcileReadyMergeCandidates,
  registerReadyMergeCandidates,
} from "./merge-batches";

type ReadyRun = {
  project_id: string;
  run_id: string;
  current_attempt: number;
  current_revision: number;
};

async function registerRows(
  db: D1Database,
  rows: readonly ReadyRun[],
  observedAt: string,
) {
  let registered = 0;
  for (const row of rows) {
    registered += (await registerReadyMergeCandidates(db, {
      projectId: row.project_id,
      runId: row.run_id,
      attempt: row.current_attempt,
      revision: row.current_revision,
      readyAt: observedAt,
    })).length;
  }
  for (const projectId of new Set(rows.map((row) => row.project_id))) {
    await reconcileReadyMergeCandidates(db, { projectId, observedAt });
  }
  return { runs: rows.length, registered };
}

/**
 * The PR webhook may race the ci_qa completion response in either direction.
 * Re-reading canonical D1 state makes both callbacks safe and idempotent.
 */
export async function reconcileMergeQueuePullRequest(
  db: D1Database,
  input: {
    repositoryId: number;
    pullRequestNumber: number;
    observedAt: string;
  },
) {
  const result = await db.prepare(
    `select distinct run.project_id, run.id as run_id,
            run.current_attempt, run.current_revision
     from briar_hunt_runs run
     join briar_run_stage_progress progress
       on progress.run_id = run.id
      and progress.attempt = run.current_attempt
      and progress.revision = run.current_revision
      and progress.stage_id = 'ci_qa' and progress.state = 'completed'
     join briar_run_pull_requests link
       on link.project_id = run.project_id and link.run_id = run.id
      and link.attempt = run.current_attempt
      and link.revision = run.current_revision
     join briar_merge_queue_profiles profile
       on profile.project_id = run.project_id
      and profile.repository_id = link.repository_id
      and profile.repository = link.repository
      and profile.base_branch = coalesce(link.base_branch, 'main')
      and profile.enabled = 1
     where run.status = 'running' and link.repository_id = ?
       and link.pull_request_number = ?`,
  ).bind(
    input.repositoryId,
    input.pullRequestNumber,
  ).all<ReadyRun>();
  return registerRows(db, result.results, input.observedAt);
}

/** A bounded cron repair closes webhook/stage ordering gaps without polling GitHub. */
export async function reconcileEnabledMergeQueueRuns(
  db: D1Database,
  observedAt: string,
  limit = 100,
) {
  const result = await db.prepare(
    `select distinct run.project_id, run.id as run_id,
            run.current_attempt, run.current_revision
     from briar_hunt_runs run
     join briar_run_stage_progress progress
       on progress.run_id = run.id
      and progress.attempt = run.current_attempt
      and progress.revision = run.current_revision
      and progress.stage_id = 'ci_qa' and progress.state = 'completed'
     join briar_run_pull_requests link
       on link.project_id = run.project_id and link.run_id = run.id
      and link.attempt = run.current_attempt
      and link.revision = run.current_revision
     join briar_merge_queue_profiles profile
       on profile.project_id = run.project_id
      and profile.repository_id = link.repository_id
      and profile.repository = link.repository
      and profile.base_branch = coalesce(link.base_branch, 'main')
      and profile.enabled = 1
     where run.status = 'running'
     order by run.project_id, run.started_at, run.id
     limit ?`,
  ).bind(Math.max(1, Math.min(500, limit))).all<ReadyRun>();
  return registerRows(db, result.results, observedAt);
}
