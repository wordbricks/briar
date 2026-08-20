export const DEFAULT_MERGE_BATCH_QUIET_WINDOW_MS = 30_000;

export type MergeBatchState =
  | "collecting"
  | "frozen"
  | "enqueueing"
  | "validating"
  | "awaiting_merge"
  | "completed"
  | "failed"
  | "blocked";

export type MergeBatchRow = {
  id: string;
  project_id: string;
  repository_id: number;
  repository: string;
  base_branch: string;
  state: MergeBatchState;
  quiet_until: string;
  frozen_at: string | null;
  merge_group_ref: string | null;
  merge_group_sha: string | null;
  claim_token_hash: string | null;
  claimed_worker_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  claim_attempts: number;
  failure_code: string | null;
  failure_detail: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MergeBatchCandidateRow = {
  id: string;
  project_id: string;
  batch_id: string | null;
  run_id: string;
  attempt: number;
  revision: number;
  repository_id: number;
  repository: string;
  base_branch: string;
  pull_request_id: number;
  pull_request_node_id: string;
  pull_request_number: number;
  pull_request_url: string;
  frozen_head_sha: string;
  priority: number | null;
  ready_at: string;
  state: "ready" | "frozen" | "enqueued" | "merged" | "dequeued" | "failed";
  queue_entry_id: string | null;
  enqueued_at: string | null;
  merged_at: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string;
  updated_at: string;
};

export type ClaimedMergeBatch = {
  batch: MergeBatchRow;
  members: MergeBatchCandidateRow[];
};

const activeBatchStates = [
  "collecting",
  "frozen",
  "enqueueing",
  "validating",
  "awaiting_merge",
] as const;

const activeBatchSql = activeBatchStates.map(() => "?").join(", ");

export async function registerReadyMergeCandidate(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    readyAt: string;
    baseBranch?: string;
    quietWindowMs?: number;
  },
) {
  const baseBranch = input.baseBranch?.trim() || "main";
  const quietWindowMs = Math.max(
    1,
    Math.trunc(input.quietWindowMs ?? DEFAULT_MERGE_BATCH_QUIET_WINDOW_MS),
  );
  const quietUntil = new Date(Date.parse(input.readyAt) + quietWindowMs).toISOString();
  const candidateId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `insert into briar_merge_batch_candidates (
         id, project_id, batch_id, run_id, attempt, revision,
         repository_id, repository, base_branch, pull_request_id,
         pull_request_node_id, pull_request_number, pull_request_url,
         frozen_head_sha, priority, ready_at, state, created_at, updated_at
       )
       select ?, run.project_id, null, run.id, run.current_attempt,
              run.current_revision, link.repository_id, link.repository, ?,
              link.pull_request_id, link.pull_request_node_id,
              link.pull_request_number, link.url, link.head_sha, run.priority,
              ?, 'ready', ?, ?
       from briar_hunt_runs run
       join briar_run_pull_requests link
         on link.project_id = run.project_id and link.run_id = run.id
        and link.attempt = run.current_attempt
        and link.revision = run.current_revision
       where run.project_id = ? and run.id = ? and run.status = 'running'
         and link.state = 'open' and link.draft = 0 and link.head_sha is not null
         and not exists (
           select 1 from briar_merge_batch_candidates existing
           where existing.run_id = run.id
             and existing.attempt = run.current_attempt
             and existing.revision = run.current_revision
         )
       returning *`,
    ).bind(
      candidateId,
      baseBranch,
      input.readyAt,
      input.readyAt,
      input.readyAt,
      input.projectId,
      input.runId,
    ),
    db.prepare(
      `insert into briar_merge_batches (
         id, project_id, repository_id, repository, base_branch, state,
         quiet_until, created_at, updated_at
       )
       select ?, candidate.project_id, candidate.repository_id,
              candidate.repository, candidate.base_branch, 'collecting', ?, ?, ?
       from briar_merge_batch_candidates candidate
       where candidate.id = ?
         and not exists (
           select 1 from briar_merge_batches active
           where active.project_id = candidate.project_id
             and active.repository_id = candidate.repository_id
             and active.base_branch = candidate.base_branch
             and active.state in (${activeBatchSql})
         )
       returning *`,
    ).bind(
      batchId,
      quietUntil,
      input.readyAt,
      input.readyAt,
      candidateId,
      ...activeBatchStates,
    ),
    db.prepare(
      `update briar_merge_batch_candidates
       set batch_id = (
         select batch.id from briar_merge_batches batch
         where batch.project_id = briar_merge_batch_candidates.project_id
           and batch.repository_id = briar_merge_batch_candidates.repository_id
           and batch.base_branch = briar_merge_batch_candidates.base_branch
           and batch.state = 'collecting'
         order by batch.created_at, batch.id limit 1
       ), updated_at = ?
       where id = ? and batch_id is null
         and exists (
           select 1 from briar_merge_batches batch
           where batch.project_id = briar_merge_batch_candidates.project_id
             and batch.repository_id = briar_merge_batch_candidates.repository_id
             and batch.base_branch = briar_merge_batch_candidates.base_branch
             and batch.state = 'collecting' and ? <= batch.quiet_until
         )
       returning *`,
    ).bind(input.readyAt, candidateId, input.readyAt),
  ]);
  return (results[2]?.results?.[0] ?? results[0]?.results?.[0] ?? null) as
    | MergeBatchCandidateRow
    | null;
}

async function ensureNextCollectingBatch(
  db: D1Database,
  projectId: string,
  now: string,
  quietWindowMs: number,
) {
  const candidate = await db.prepare(
    `select * from briar_merge_batch_candidates candidate
     where candidate.project_id = ? and candidate.batch_id is null
       and candidate.state = 'ready'
       and not exists (
         select 1 from briar_merge_batches active
         where active.project_id = candidate.project_id
           and active.repository_id = candidate.repository_id
           and active.base_branch = candidate.base_branch
           and active.state in (${activeBatchSql})
       )
     order by case when priority is null then 1 else 0 end,
              priority, ready_at, run_id
     limit 1`,
  ).bind(projectId, ...activeBatchStates).first<MergeBatchCandidateRow>();
  if (!candidate) return;
  const quietUntil = new Date(Date.parse(now) + quietWindowMs).toISOString();
  const batchId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(
        `insert into briar_merge_batches (
           id, project_id, repository_id, repository, base_branch, state,
           quiet_until, created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'collecting', ?, ?, ?)`,
      ).bind(
        batchId,
        projectId,
        candidate.repository_id,
        candidate.repository,
        candidate.base_branch,
        quietUntil,
        now,
        now,
      ),
      db.prepare(
        `update briar_merge_batch_candidates set batch_id = ?, updated_at = ?
         where project_id = ? and repository_id = ? and base_branch = ?
           and batch_id is null and state = 'ready' and ready_at <= ?`,
      ).bind(
        batchId,
        now,
        projectId,
        candidate.repository_id,
        candidate.base_branch,
        quietUntil,
      ),
    ]);
  } catch (error) {
    if (!String(error).toLowerCase().includes("unique")) throw error;
  }
}

export async function claimNextMergeBatch(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    claimedBy: string;
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
    quietWindowMs?: number;
  },
): Promise<ClaimedMergeBatch | null> {
  await db.prepare(
    `update briar_merge_batches
     set claim_token_hash = null, claimed_worker_id = null, claimed_by = null,
         claimed_at = null, lease_expires_at = null, updated_at = ?
     where project_id = ? and lease_expires_at is not null
       and lease_expires_at <= ? and state in (${activeBatchSql})`,
  ).bind(
    input.claimedAt,
    projectId,
    input.claimedAt,
    ...activeBatchStates,
  ).run();

  await ensureNextCollectingBatch(
    db,
    projectId,
    input.claimedAt,
    Math.max(1, Math.trunc(
      input.quietWindowMs ?? DEFAULT_MERGE_BATCH_QUIET_WINDOW_MS,
    )),
  );

  const collecting = await db.prepare(
    `select id from briar_merge_batches
     where project_id = ? and state = 'collecting' and quiet_until <= ?
     order by quiet_until, id limit 1`,
  ).bind(projectId, input.claimedAt).first<{ id: string }>();
  if (collecting) {
    await db.batch([
      db.prepare(
        `update briar_merge_batch_candidates
         set state = 'frozen', updated_at = ?
         where batch_id = ? and state = 'ready'`,
      ).bind(input.claimedAt, collecting.id),
      db.prepare(
        `update briar_merge_batches
         set state = 'frozen', frozen_at = ?, updated_at = ?
         where id = ? and project_id = ? and state = 'collecting'`,
      ).bind(input.claimedAt, input.claimedAt, collecting.id, projectId),
    ]);
  }

  const claimed = await db.prepare(
    `update briar_merge_batches
     set claim_token_hash = ?, claimed_worker_id = ?, claimed_by = ?,
         claimed_at = ?, lease_expires_at = ?, claim_attempts = claim_attempts + 1,
         state = case when state = 'frozen' then 'enqueueing' else state end,
         updated_at = ?
     where id = (
       select id from briar_merge_batches
       where project_id = ? and state in (
         'frozen', 'enqueueing', 'validating', 'awaiting_merge'
       )
         and (lease_expires_at is null or lease_expires_at <= ?)
       order by frozen_at, id limit 1
     )
       and (lease_expires_at is null or lease_expires_at <= ?)
     returning *`,
  ).bind(
    input.claimTokenHash,
    input.workerId,
    input.claimedBy,
    input.claimedAt,
    input.leaseExpiresAt,
    input.claimedAt,
    projectId,
    input.claimedAt,
    input.claimedAt,
  ).first<MergeBatchRow>();
  if (!claimed) return null;
  const members = await db.prepare(
    `select * from briar_merge_batch_candidates
     where batch_id = ?
     order by case when priority is null then 1 else 0 end,
              priority, ready_at, run_id`,
  ).bind(claimed.id).all<MergeBatchCandidateRow>();
  return { batch: claimed, members: members.results };
}

const batchLeaseFence = `
  id = ? and project_id = ? and claimed_worker_id = ?
  and claim_token_hash = ? and lease_expires_at > ?`;

export async function renewMergeBatchLease(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    leaseExpiresAt: string;
  },
) {
  const result = await db.prepare(
    `update briar_merge_batches set lease_expires_at = ?, updated_at = ?
     where ${batchLeaseFence} returning lease_expires_at`,
  ).bind(
    input.leaseExpiresAt,
    input.authenticatedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
  ).first<{ lease_expires_at: string }>();
  return result?.lease_expires_at ?? null;
}

export async function recordMergeBatchMemberEnqueued(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    candidateId: string;
    expectedHeadSha: string;
    queueEntryId: string;
    observedAt: string;
  },
) {
  const result = await db.prepare(
    `update briar_merge_batch_candidates
     set state = 'enqueued', queue_entry_id = ?, enqueued_at = ?, updated_at = ?
     where id = ? and batch_id = ? and frozen_head_sha = ?
       and state in ('frozen', 'enqueued')
       and (queue_entry_id is null or queue_entry_id = ?)
       and exists (
         select 1 from briar_merge_batches batch
         where batch.id = briar_merge_batch_candidates.batch_id
           and batch.project_id = ? and batch.claimed_worker_id = ?
           and batch.claim_token_hash = ? and batch.lease_expires_at > ?
       )
     returning *`,
  ).bind(
    input.queueEntryId,
    input.observedAt,
    input.observedAt,
    input.candidateId,
    input.batchId,
    input.expectedHeadSha,
    input.queueEntryId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.observedAt,
  ).first<MergeBatchCandidateRow>();
  return result ?? null;
}

export async function recordMergeGroup(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    mergeGroupRef: string;
    mergeGroupSha: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_merge_batches
     set state = 'validating', merge_group_ref = ?, merge_group_sha = ?,
         updated_at = ?
     where ${batchLeaseFence}
       and state in ('enqueueing', 'validating')
       and not exists (
         select 1 from briar_merge_batch_candidates candidate
         where candidate.batch_id = briar_merge_batches.id
           and candidate.state <> 'enqueued'
       )
       and (merge_group_sha is null or merge_group_sha = ?)
     returning *`,
  ).bind(
    input.mergeGroupRef,
    input.mergeGroupSha,
    input.observedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.observedAt,
    input.mergeGroupSha,
  ).first<MergeBatchRow>();
}

export async function completeMergeBatchValidation(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    mergeGroupSha: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_merge_batches
     set state = 'awaiting_merge', updated_at = ?
     where ${batchLeaseFence} and state in ('validating', 'awaiting_merge')
       and merge_group_sha = ?
     returning *`,
  ).bind(
    input.observedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.observedAt,
    input.mergeGroupSha,
  ).first<MergeBatchRow>();
}

export async function failMergeBatch(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    outcome: "failed" | "blocked";
    code: string;
    detail: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_merge_batches
     set state = ?, failure_code = ?, failure_detail = ?,
         claim_token_hash = null, claimed_worker_id = null, claimed_by = null,
         claimed_at = null, lease_expires_at = null, updated_at = ?
     where ${batchLeaseFence}
       and state not in ('completed', 'failed', 'blocked')
     returning *`,
  ).bind(
    input.outcome,
    input.code,
    input.detail.slice(0, 4_000),
    input.observedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.observedAt,
  ).first<MergeBatchRow>();
}

export async function observeMergedBatchPullRequest(
  db: D1Database,
  input: {
    repositoryId: number;
    pullRequestNumber: number;
    headSha: string;
    mergedAt: string;
  },
) {
  const candidates = await db.prepare(
    `update briar_merge_batch_candidates
     set state = 'merged', merged_at = ?, updated_at = ?
     where repository_id = ? and pull_request_number = ?
       and frozen_head_sha = ? and state = 'enqueued'
     returning *`,
  ).bind(
    input.mergedAt,
    input.mergedAt,
    input.repositoryId,
    input.pullRequestNumber,
    input.headSha,
  ).all<MergeBatchCandidateRow>();
  for (const candidate of candidates.results) {
    const completed = await db.prepare(
      `update briar_merge_batches
       set state = 'completed', completed_at = ?, updated_at = ?,
           claim_token_hash = null, claimed_worker_id = null,
           claimed_by = null, claimed_at = null, lease_expires_at = null
       where id = ? and state = 'awaiting_merge'
         and not exists (
           select 1 from briar_merge_batch_candidates member
           where member.batch_id = briar_merge_batches.id
             and member.state <> 'merged'
         )
       returning id`,
    ).bind(input.mergedAt, input.mergedAt, candidate.batch_id).first<{ id: string }>();
    if (completed) {
      await db.prepare(
        `update briar_hunt_runs
         set resume_requested_at = ?, updated_at = max(updated_at, ?)
         where id in (
           select run_id from briar_merge_batch_candidates where batch_id = ?
         ) and current_attempt = (
           select attempt from briar_merge_batch_candidates member
           where member.run_id = briar_hunt_runs.id and member.batch_id = ?
         ) and current_revision = (
           select revision from briar_merge_batch_candidates member
           where member.run_id = briar_hunt_runs.id and member.batch_id = ?
         ) and status = 'running' and paused_at is not null`,
      ).bind(input.mergedAt, input.mergedAt, completed.id, completed.id, completed.id).run();
    }
  }
  return candidates.results;
}

export async function suspendRunForMergeBatch(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    attempt: number;
    revision: number;
    observedAt: string;
  },
) {
  const result = await db.prepare(
    `update briar_hunt_runs
     set workflow_stage = 'merged', paused_at = ?, resume_requested_at = null,
         claim_token_hash = null, claimed_by = null, claimed_at = null,
         lease_expires_at = null, worker_id = null, updated_at = ?
     where project_id = ? and id = ? and current_attempt = ?
       and current_revision = ? and status = 'running' and paused_at is null
     returning id`,
  ).bind(
    input.observedAt,
    input.observedAt,
    input.projectId,
    input.runId,
    input.attempt,
    input.revision,
  ).first<{ id: string }>();
  return Boolean(result);
}
