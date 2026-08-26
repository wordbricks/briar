import type {
  MergeBatchCandidateState,
  MergeBatchState,
} from "./merge-batches";

export type MergeQueueStatusBatch = {
  id: string;
  state: MergeBatchState;
  candidateCount: number;
  quietUntil: string;
  frozenAt: string | null;
  mergeGroupSha: string | null;
  failureCode: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MergeQueueStatusCandidate = {
  id: string;
  batchId: string | null;
  runId: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  state: MergeBatchCandidateState;
  ordinal: number | null;
  readyAt: string;
  failureCode: string | null;
  updatedAt: string;
};

type BatchStatusRow = {
  id: string;
  state: MergeBatchState;
  candidate_count: number;
  quiet_until: string;
  frozen_at: string | null;
  merge_group_sha: string | null;
  failure_code: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type CandidateStatusRow = {
  id: string;
  batch_id: string | null;
  run_id: string;
  pull_request_number: number;
  pull_request_url: string;
  state: MergeBatchCandidateState;
  ordinal: number | null;
  ready_at: string;
  failure_code: string | null;
  updated_at: string;
};

const activeBatchStates = `
  'collecting', 'frozen', 'enqueueing', 'waiting_tail', 'validating',
  'publishing', 'awaiting_merge', 'blocked', 'draining'`;

export async function getMergeQueueStatus(
  db: D1Database,
  projectId: string,
): Promise<{
  batches: MergeQueueStatusBatch[];
  candidates: MergeQueueStatusCandidate[];
}> {
  const [batchResult, candidateResult] = await Promise.all([
    db.prepare(
      `select batch.id, batch.state, batch.quiet_until, batch.frozen_at,
              batch.merge_group_sha, batch.failure_code, batch.completed_at,
              batch.created_at, batch.updated_at,
              (
                select count(*) from briar_merge_batch_candidates candidate
                where candidate.batch_id = batch.id
                   or (
                     batch.state = 'collecting' and candidate.batch_id is null
                     and candidate.project_id = batch.project_id
                     and candidate.repository_id = batch.repository_id
                     and candidate.base_branch = batch.base_branch
                     and candidate.state = 'ready'
                   )
              ) as candidate_count
       from briar_merge_batches batch
       where batch.project_id = ?
       order by case when batch.state in (${activeBatchStates}) then 0 else 1 end,
                batch.updated_at desc, batch.id
       limit 5`,
    ).bind(projectId).all<BatchStatusRow>(),
    db.prepare(
      `select id, batch_id, run_id, pull_request_number, pull_request_url,
              state, ordinal, ready_at, failure_code, updated_at
       from briar_merge_batch_candidates
       where project_id = ?
       order by case when state in ('ready', 'frozen', 'enqueued') then 0 else 1 end,
                updated_at desc, id
       limit 12`,
    ).bind(projectId).all<CandidateStatusRow>(),
  ]);
  return {
    batches: batchResult.results.map((row) => ({
      id: row.id,
      state: row.state,
      candidateCount: row.candidate_count,
      quietUntil: row.quiet_until,
      frozenAt: row.frozen_at,
      mergeGroupSha: row.merge_group_sha,
      failureCode: row.failure_code,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    candidates: candidateResult.results.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      runId: row.run_id,
      pullRequestNumber: row.pull_request_number,
      pullRequestUrl: row.pull_request_url,
      state: row.state,
      ordinal: row.ordinal,
      readyAt: row.ready_at,
      failureCode: row.failure_code,
      updatedAt: row.updated_at,
    })),
  };
}
