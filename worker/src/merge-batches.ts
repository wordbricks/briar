import {
  MERGE_GROUP_CI_CONTEXTS,
  type MergeGroupCiContext,
} from "../../src/lib/merge-group-validation-contract";

export const DEFAULT_MERGE_BATCH_QUIET_WINDOW_MS = 30_000;
export const MAX_MERGE_BATCH_SIZE = 5;

export type MergeBatchState =
  | "collecting"
  | "frozen"
  | "enqueueing"
  | "waiting_tail"
  | "validating"
  | "publishing"
  | "awaiting_merge"
  | "blocked"
  | "draining"
  | "completed"
  | "failed";

export type MergeBatchRow = {
  id: string;
  project_id: string;
  repository_id: number;
  repository: string;
  base_branch: string;
  state: MergeBatchState;
  quiet_until: string;
  frozen_at: string | null;
  final_delivery_id: string | null;
  merge_group_ref: string | null;
  merge_group_sha: string | null;
  merge_group_base_sha: string | null;
  validation_results_json: string | null;
  validated_at: string | null;
  published_at: string | null;
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

export type MergeBatchCandidateState =
  | "ready"
  | "frozen"
  | "enqueued"
  | "merged"
  | "dequeued"
  | "failed";

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
  frozen_base_sha: string;
  priority: number | null;
  ready_at: string;
  ordinal: number | null;
  state: MergeBatchCandidateState;
  queue_entry_id: string | null;
  enqueued_at: string | null;
  merged_delivery_id: string | null;
  merged_at: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string;
  updated_at: string;
};

export type MergeGroupHeadRow = {
  delivery_id: string;
  batch_id: string | null;
  repository_id: number;
  repository: string;
  base_branch: string;
  head_ref: string;
  head_sha: string;
  base_sha: string;
  tail_pull_request_number: number;
  state: "pending" | "selected" | "superseded" | "orphaned";
  received_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MergeBatchWithMembers = {
  batch: MergeBatchRow;
  members: MergeBatchCandidateRow[];
};

export type MergeBatchClaimPhase =
  | "enqueue"
  | "tail_authority"
  | "validate"
  | "publish"
  | "drain";

export type ClaimedMergeBatch = MergeBatchWithMembers & {
  phase: MergeBatchClaimPhase;
  pendingHeads: MergeGroupHeadRow[];
};

export type MergeQueueAuthorityEntry = {
  queueEntryId: string;
  pullRequestNumber: number;
};

export type MergeBatchValidationResult = {
  context: MergeGroupCiContext;
  passed: boolean;
  exitCode: number;
  failureCode: "ci_failed" | "output_limit" | null;
  log: string;
  logSha256: string;
  logTruncated: boolean;
};

const activeBatchStatesSql = `
  'collecting', 'frozen', 'enqueueing', 'waiting_tail', 'validating',
  'publishing', 'awaiting_merge', 'blocked', 'draining'`;

const claimableBatchStatesSql = `
  'frozen', 'enqueueing', 'waiting_tail', 'validating', 'publishing', 'draining'`;

const liveLeaseFence = `
  id = ? and project_id = ? and claimed_worker_id = ?
  and claim_token_hash = ? and lease_expires_at > ?`;

function validationProofPassed(results: readonly unknown[]) {
  if (results.length !== MERGE_GROUP_CI_CONTEXTS.length) return null;
  const contexts = new Set<string>();
  let allPassed = true;
  for (const result of results) {
    if (
      typeof result !== "object" || result === null ||
      !("context" in result) || typeof result.context !== "string" ||
      !("passed" in result) || typeof result.passed !== "boolean" ||
      !("exitCode" in result) || !Number.isInteger(result.exitCode) ||
      !("failureCode" in result) || ![
        null,
        "ci_failed",
        "output_limit",
      ].includes(result.failureCode as null | string) ||
      !("log" in result) || typeof result.log !== "string" ||
      !("logSha256" in result) || typeof result.logSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(result.logSha256) ||
      !("logTruncated" in result) || typeof result.logTruncated !== "boolean" ||
      (result.passed &&
        (result.exitCode !== 0 || result.failureCode !== null)) ||
      (!result.passed && result.failureCode === null)
    ) return null;
    contexts.add(result.context);
    if (!result.passed) allPassed = false;
  }
  if (
    contexts.size !== results.length ||
    !MERGE_GROUP_CI_CONTEXTS.every((context) => contexts.has(context))
  ) return null;
  return allPassed;
}

/**
 * A candidate is mutable only before sealing. This predicate deliberately
 * repeats every durable readiness fence so a late force-push or revision
 * change cannot cross the seal transaction.
 */
const currentReadyCandidate = (
  candidate: string,
  acceptedStates = "'open'",
  options: { requireFrozenBaseSha?: boolean; requireSignedMerge?: boolean } =
    {},
) => `
  exists (
    select 1
    from briar_hunt_runs run
    join briar_run_stage_progress progress
      on progress.run_id = run.id
     and progress.attempt = run.current_attempt
     and progress.revision = run.current_revision
     and progress.stage_id = 'ci_qa'
     and progress.state = 'completed'
    join briar_run_pull_requests link
      on link.project_id = run.project_id and link.run_id = run.id
     and link.attempt = run.current_attempt
     and link.revision = run.current_revision
     and link.repository_id = ${candidate}.repository_id
     and link.pull_request_number = ${candidate}.pull_request_number
    join briar_merge_queue_profiles profile
      on profile.project_id = run.project_id
     and profile.repository_id = link.repository_id
     and profile.repository = link.repository
     and profile.base_branch = coalesce(link.base_branch, 'main')
     and profile.enabled = 1
    where run.id = ${candidate}.run_id
      and run.project_id = ${candidate}.project_id
      and run.current_attempt = ${candidate}.attempt
      and run.current_revision = ${candidate}.revision
      and run.status = 'running'
      and run.commit_sha = ${candidate}.frozen_head_sha
      and link.state in (${acceptedStates}) and link.draft = 0
      and link.pull_request_id = ${candidate}.pull_request_id
      and link.pull_request_node_id = ${candidate}.pull_request_node_id
      and link.url = ${candidate}.pull_request_url
      and link.repository = ${candidate}.repository
      and coalesce(link.base_branch, 'main') = ${candidate}.base_branch
      and link.head_sha = ${candidate}.frozen_head_sha
      ${
  options.requireFrozenBaseSha === false
    ? ""
    : `and link.base_sha = ${candidate}.frozen_base_sha`
}
      ${
  options.requireSignedMerge
    ? `and link.merged_at is not null and link.last_delivery_id is not null
      and exists (
        select 1 from briar_github_deliveries delivery
        where delivery.delivery_id = link.last_delivery_id
          and delivery.event_name = 'pull_request' and delivery.action = 'closed'
          and delivery.status in ('processing', 'completed')
      )`
    : ""
}
  )`;

const completeRunCandidateSet = (candidate: string) => `
  (
    select count(*) from briar_run_pull_requests current_link
    where current_link.project_id = ${candidate}.project_id
      and current_link.run_id = ${candidate}.run_id
      and current_link.attempt = ${candidate}.attempt
      and current_link.revision = ${candidate}.revision
      and current_link.repository_id = ${candidate}.repository_id
      and coalesce(current_link.base_branch, 'main') = ${candidate}.base_branch
      and not (
        current_link.state = 'merged'
        and current_link.merged_at is not null
        and current_link.last_delivery_id is not null
        and (
          ${candidate}.batch_id is null
          or exists (
            select 1 from briar_merge_batches current_batch
            where current_batch.id = ${candidate}.batch_id
              and current_batch.frozen_at is not null
              and current_link.created_at <= current_batch.frozen_at
              and current_link.merged_at <= current_batch.frozen_at
          )
        )
      )
  ) = (
    select count(*) from briar_merge_batch_candidates sibling
    where sibling.project_id = ${candidate}.project_id
      and sibling.run_id = ${candidate}.run_id
      and sibling.attempt = ${candidate}.attempt
      and sibling.revision = ${candidate}.revision
      and sibling.repository_id = ${candidate}.repository_id
      and sibling.base_branch = ${candidate}.base_branch
      and (
        (
          ${candidate}.batch_id is null and sibling.batch_id is null
          and sibling.state = 'ready'
        )
        or (
          ${candidate}.batch_id is not null
          and sibling.batch_id = ${candidate}.batch_id
          and sibling.state not in ('failed', 'dequeued')
        )
      )
  )`;

const completeBatchRunSets = (batch: string) => `
  not exists (
    select 1 from briar_merge_batch_candidates member
    where member.batch_id = ${batch}.id
    group by member.project_id, member.run_id, member.attempt, member.revision,
             member.repository_id, member.base_branch
    having count(*) <> (
      select count(*) from briar_run_pull_requests current_link
      where current_link.project_id = member.project_id
        and current_link.run_id = member.run_id
        and current_link.attempt = member.attempt
        and current_link.revision = member.revision
        and current_link.repository_id = member.repository_id
        and coalesce(current_link.base_branch, 'main') = member.base_branch
        and not (
          current_link.state = 'merged'
          and current_link.merged_at is not null
          and current_link.last_delivery_id is not null
          and ${batch}.frozen_at is not null
          and current_link.created_at <= ${batch}.frozen_at
          and current_link.merged_at <= ${batch}.frozen_at
        )
    )
  )`;

const pendingFinalHead = (batch: string) => `
  exists (
    select 1 from briar_merge_group_heads head
    where head.batch_id = ${batch}.id and head.state = 'pending'
      and head.tail_pull_request_number = (
        select candidate.pull_request_number
        from briar_merge_batch_candidates candidate
        where candidate.batch_id = ${batch}.id
        order by candidate.ordinal desc limit 1
      )
  )`;

function addMilliseconds(timestamp: string, milliseconds: number) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new RangeError("Invalid coordinator timestamp");
  }
  return new Date(parsed + milliseconds).toISOString();
}

function mergeGroupTailFromRef(headRef: string) {
  const match = /^refs\/heads\/gh-readonly-queue\/main\/pr-([1-9][0-9]*)-/u
    .exec(
      headRef,
    );
  if (!match) return null;
  const pullRequestNumber = Number(match[1]);
  return Number.isSafeInteger(pullRequestNumber) ? pullRequestNumber : null;
}

function retireDuplicateReadyCandidatesStatement(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  return db.prepare(
    `update briar_merge_batch_candidates as candidate
     set state = 'dequeued', failure_code = 'duplicate_pull_request',
         failure_detail = 'This signed pull request is represented once in its repository lane',
         updated_at = ?
     where candidate.project_id = ? and candidate.batch_id is null
       and candidate.state = 'ready'
       and exists (
         select 1 from briar_merge_batch_candidates other
         where other.id <> candidate.id
           and other.project_id = candidate.project_id
           and other.repository_id = candidate.repository_id
           and other.base_branch = candidate.base_branch
           and other.pull_request_number = candidate.pull_request_number
           and (
             (
               other.batch_id is not null
               and other.state in ('frozen', 'enqueued', 'merged')
             )
             or (
               other.batch_id is null and other.state = 'ready'
               and (
                 other.ready_at < candidate.ready_at
                 or (other.ready_at = candidate.ready_at and other.run_id < candidate.run_id)
                 or (
                   other.ready_at = candidate.ready_at
                   and other.run_id = candidate.run_id and other.id < candidate.id
                 )
               )
             )
           )
       )`,
  ).bind(observedAt, projectId);
}

async function retireDuplicateReadyCandidates(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const retired = await retireDuplicateReadyCandidatesStatement(
    db,
    projectId,
    observedAt,
  ).run();
  return retired.meta.changes ?? 0;
}

async function ensureCollectingBatch(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const lane = await db.prepare(
    `select candidate.project_id, candidate.repository_id,
            candidate.repository, candidate.base_branch,
            candidate.ready_at, profile.quiet_window_ms
     from briar_merge_batch_candidates candidate
     join briar_merge_queue_profiles profile
       on profile.project_id = candidate.project_id
      and profile.repository_id = candidate.repository_id
      and profile.repository = candidate.repository
      and profile.base_branch = candidate.base_branch
      and profile.enabled = 1
     where candidate.project_id = ? and candidate.batch_id is null
       and candidate.state = 'ready'
       and ${currentReadyCandidate("candidate")}
       and ${completeRunCandidateSet("candidate")}
       and not exists (
         select 1 from briar_merge_batches active
         where active.repository_id = candidate.repository_id
           and active.base_branch = candidate.base_branch
           and active.state in (${activeBatchStatesSql})
       )
     order by case when candidate.priority is null then 1 else 0 end,
              candidate.priority, candidate.ready_at, candidate.run_id,
              candidate.pull_request_number, candidate.id
     limit 1`,
  ).bind(projectId).first<{
    project_id: string;
    repository_id: number;
    repository: string;
    base_branch: string;
    ready_at: string;
    quiet_window_ms: number;
  }>();
  if (!lane) return null;

  const id = crypto.randomUUID();
  const quietUntil = addMilliseconds(lane.ready_at, lane.quiet_window_ms);
  await db.prepare(
    `insert or ignore into briar_merge_batches (
       id, project_id, repository_id, repository, base_branch, state,
       quiet_until, created_at, updated_at
     ) values (?, ?, ?, ?, ?, 'collecting', ?, ?, ?)`,
  ).bind(
    id,
    lane.project_id,
    lane.repository_id,
    lane.repository,
    lane.base_branch,
    quietUntil,
    observedAt,
    observedAt,
  ).run();

  return db.prepare(
    `select * from briar_merge_batches
     where repository_id = ? and base_branch = ?
       and state in (${activeBatchStatesSql})
     limit 1`,
  ).bind(lane.repository_id, lane.base_branch).first<MergeBatchRow>();
}

/**
 * Invalidates mutable candidates and blocks immutable cohorts on generation
 * drift. A blocked cohort intentionally retains the global repository lane.
 */
export async function reconcileReadyMergeCandidates(
  db: D1Database,
  input: { projectId: string; observedAt: string; runId?: string },
) {
  const retiredDuplicates = await retireDuplicateReadyCandidates(
    db,
    input.projectId,
    input.observedAt,
  );
  const runScope = input.runId ? "and candidate.run_id = ?" : "";
  const scopeBindings = input.runId
    ? [input.projectId, input.runId]
    : [input.projectId];
  const results = await db.batch([
    db.prepare(
      `update briar_merge_batch_candidates as candidate
       set state = 'failed', failure_code = 'run_set_too_large',
           failure_detail = 'A current run has more pull requests than one cohort can seal',
           updated_at = ?
       where candidate.project_id = ? ${runScope}
         and candidate.batch_id is null and candidate.state = 'ready'
         and (
           select count(*) from briar_run_pull_requests current_link
           where current_link.project_id = candidate.project_id
             and current_link.run_id = candidate.run_id
             and current_link.attempt = candidate.attempt
             and current_link.revision = candidate.revision
             and current_link.repository_id = candidate.repository_id
             and coalesce(current_link.base_branch, 'main') = candidate.base_branch
             and not (
               current_link.state = 'merged'
               and current_link.merged_at is not null
               and current_link.last_delivery_id is not null
             )
         ) > (
           select min(profile.max_batch_size, ?)
           from briar_merge_queue_profiles profile
           where profile.project_id = candidate.project_id
             and profile.repository_id = candidate.repository_id
             and profile.base_branch = candidate.base_branch
         )`,
    ).bind(input.observedAt, ...scopeBindings, MAX_MERGE_BATCH_SIZE),
    db.prepare(
      `update briar_merge_batch_candidates as candidate
       set state = 'failed', failure_code = 'readiness_changed',
           failure_detail = 'Current ci_qa, revision, or exact pull request head changed',
           updated_at = ?
       where candidate.project_id = ? ${runScope}
         and candidate.batch_id is null and candidate.state = 'ready'
         and (
           not (${currentReadyCandidate("candidate")})
           or not (${completeRunCandidateSet("candidate")})
         )`,
    ).bind(input.observedAt, ...scopeBindings),
    db.prepare(
      `update briar_merge_batch_candidates as candidate
       set state = 'failed', failure_code = 'sealed_identity_changed',
           failure_detail = 'A sealed pull request no longer matches its exact identity',
           updated_at = ?
       where candidate.project_id = ? ${runScope}
         and candidate.batch_id is not null
         and candidate.state in ('frozen', 'enqueued')
         and not (
           (${currentReadyCandidate("candidate")}
             and ${completeRunCandidateSet("candidate")})
           or (
             exists (
               select 1 from briar_merge_batches batch
               where batch.id = candidate.batch_id
                 and batch.state in ('awaiting_merge', 'draining')
             )
             and ${
        currentReadyCandidate("candidate", "'merged'", {
          requireFrozenBaseSha: false,
          requireSignedMerge: true,
        })
      }
             and ${completeRunCandidateSet("candidate")}
           )
         )`,
    ).bind(input.observedAt, ...scopeBindings),
    db.prepare(
      `update briar_merge_batches as batch
       set state = 'blocked', failure_code = 'sealed_identity_changed',
           failure_detail = 'At least one sealed pull request changed generation',
           claim_token_hash = null, claimed_worker_id = null,
           claimed_by = null, claimed_at = null, lease_expires_at = null,
           updated_at = ?
       where batch.project_id = ?
         and batch.state in (
           'frozen', 'enqueueing', 'waiting_tail', 'validating',
           'publishing', 'awaiting_merge', 'draining'
         )
         and exists (
           select 1 from briar_merge_batch_candidates candidate
           where candidate.batch_id = batch.id and candidate.state = 'failed'
         )`,
    ).bind(input.observedAt, input.projectId),
    db.prepare(
      `update briar_merge_batches as batch
       set state = 'failed', failure_code = 'empty_collection',
           failure_detail = 'No current exact-SHA candidate remains in the collection',
           updated_at = ?
       where batch.project_id = ? and batch.state = 'collecting'
         and not exists (
           select 1 from briar_merge_batch_candidates candidate
           where candidate.project_id = batch.project_id
             and candidate.repository_id = batch.repository_id
             and candidate.base_branch = batch.base_branch
             and candidate.batch_id is null and candidate.state = 'ready'
             and ${currentReadyCandidate("candidate")}
             and ${completeRunCandidateSet("candidate")}
         )`,
    ).bind(input.observedAt, input.projectId),
  ]);
  return {
    retiredDuplicates,
    oversizedRunSets: results[0]?.meta.changes ?? 0,
    invalidatedReady: results[1]?.meta.changes ?? 0,
    invalidatedSealed: results[2]?.meta.changes ?? 0,
    blockedBatches: results[3]?.meta.changes ?? 0,
    emptyCollections: results[4]?.meta.changes ?? 0,
  };
}

/** Registers every current PR link for the run; one run may own many PRs. */
export async function registerReadyMergeCandidates(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    attempt: number;
    revision: number;
    readyAt: string;
  },
) {
  await reconcileReadyMergeCandidates(db, {
    projectId: input.projectId,
    runId: input.runId,
    observedAt: input.readyAt,
  });

  const insertCandidates = db.prepare(
    `insert into briar_merge_batch_candidates (
       id, project_id, batch_id, run_id, attempt, revision,
       repository_id, repository, base_branch, pull_request_id,
       pull_request_node_id, pull_request_number, pull_request_url,
       frozen_head_sha, frozen_base_sha, priority, ready_at, ordinal,
       state, created_at, updated_at
     )
     select lower(hex(randomblob(16))), run.project_id, null, run.id,
            run.current_attempt, run.current_revision, link.repository_id,
            link.repository, profile.base_branch, link.pull_request_id,
            link.pull_request_node_id, link.pull_request_number, link.url,
            link.head_sha, link.base_sha, run.priority, ?, null,
            'ready', ?, ?
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
     where run.project_id = ? and run.id = ?
       and run.current_attempt = ? and run.current_revision = ?
       and run.status = 'running' and run.commit_sha = link.head_sha
       and link.state = 'open' and link.draft = 0
       and length(link.head_sha) = 40
       and link.head_sha not glob '*[^0-9a-f]*'
       and length(link.base_sha) = 40
       and link.base_sha not glob '*[^0-9a-f]*'
       and not exists (
         select 1 from briar_run_pull_requests current_link
         where current_link.project_id = run.project_id
           and current_link.run_id = run.id
           and current_link.attempt = run.current_attempt
           and current_link.revision = run.current_revision
           and current_link.repository_id = link.repository_id
           and coalesce(current_link.base_branch, 'main') = profile.base_branch
           and (
             current_link.repository <> profile.repository
             or not (
               (current_link.state = 'open' and current_link.draft is 0)
               or (
                 current_link.state = 'merged'
                 and current_link.merged_at is not null
                 and current_link.last_delivery_id is not null
               )
             )
             or current_link.head_sha is null
             or length(current_link.head_sha) <> 40
             or current_link.head_sha glob '*[^0-9a-f]*'
             or current_link.head_sha <> run.commit_sha
             or current_link.base_sha is null
             or length(current_link.base_sha) <> 40
             or current_link.base_sha glob '*[^0-9a-f]*'
           )
       )
     on conflict(
       run_id, attempt, revision, repository_id, pull_request_number
     ) do update set
       repository = excluded.repository,
       base_branch = excluded.base_branch,
       pull_request_id = excluded.pull_request_id,
       pull_request_node_id = excluded.pull_request_node_id,
       pull_request_url = excluded.pull_request_url,
       frozen_head_sha = excluded.frozen_head_sha,
       frozen_base_sha = excluded.frozen_base_sha,
       priority = excluded.priority,
       ready_at = case
         when briar_merge_batch_candidates.state = 'ready'
          and briar_merge_batch_candidates.frozen_head_sha = excluded.frozen_head_sha
          and briar_merge_batch_candidates.frozen_base_sha = excluded.frozen_base_sha
         then min(briar_merge_batch_candidates.ready_at, excluded.ready_at)
         else excluded.ready_at
       end,
       ordinal = null, state = 'ready', queue_entry_id = null,
       enqueued_at = null, merged_delivery_id = null, merged_at = null,
       failure_code = null, failure_detail = null, updated_at = excluded.updated_at
     where briar_merge_batch_candidates.batch_id is null
       and briar_merge_batch_candidates.state in ('ready', 'failed', 'dequeued')
     returning *`,
  ).bind(
    input.readyAt,
    input.readyAt,
    input.readyAt,
    input.projectId,
    input.runId,
    input.attempt,
    input.revision,
  );

  // Registration and duplicate retirement are one D1 transaction. A sealer
  // can therefore observe neither the newly inserted duplicate nor its loser,
  // or the fully reconciled representation, but never the gap between them.
  await db.batch([
    insertCandidates,
    retireDuplicateReadyCandidatesStatement(db, input.projectId, input.readyAt),
  ]);
  await ensureCollectingBatch(db, input.projectId, input.readyAt);
  const registered = await db.prepare(
    `select * from briar_merge_batch_candidates
     where project_id = ? and run_id = ? and attempt = ? and revision = ?
     order by repository_id, pull_request_number`,
  ).bind(
    input.projectId,
    input.runId,
    input.attempt,
    input.revision,
  ).all<MergeBatchCandidateRow>();
  return registered.results;
}

/** Atomically freezes at most five deterministic members from one lane. */
export async function sealNextMergeBatch(
  db: D1Database,
  input: { projectId: string; observedAt: string },
): Promise<MergeBatchWithMembers | null> {
  await reconcileReadyMergeCandidates(db, input);
  await ensureCollectingBatch(db, input.projectId, input.observedAt);

  const collecting = await db.prepare(
    `select batch.*, min(profile.max_batch_size, ?) as seal_limit
     from briar_merge_batches batch
     join briar_merge_queue_profiles profile
       on profile.project_id = batch.project_id
      and profile.repository_id = batch.repository_id
      and profile.repository = batch.repository
      and profile.base_branch = batch.base_branch
      and profile.enabled = 1
     where batch.project_id = ? and batch.state = 'collecting'
       and (
         batch.quiet_until <= ?
         or (
           select count(*) from briar_merge_batch_candidates candidate
           where candidate.project_id = batch.project_id
             and candidate.repository_id = batch.repository_id
             and candidate.base_branch = batch.base_branch
             and candidate.batch_id is null and candidate.state = 'ready'
             and ${currentReadyCandidate("candidate")}
             and ${completeRunCandidateSet("candidate")}
         ) >= min(profile.max_batch_size, ?)
       )
     order by batch.quiet_until, batch.created_at, batch.id
     limit 1`,
  ).bind(
    MAX_MERGE_BATCH_SIZE,
    input.projectId,
    input.observedAt,
    MAX_MERGE_BATCH_SIZE,
  ).first<MergeBatchRow & { seal_limit: number }>();
  if (!collecting) return null;

  const results = await db.batch([
    db.prepare(
      `with eligible_ranked as materialized (
         select candidate.*,
                row_number() over (
                  partition by candidate.repository_id, candidate.base_branch,
                               candidate.pull_request_number
                  order by candidate.ready_at, candidate.run_id, candidate.id
                ) as duplicate_rank
         from briar_merge_batch_candidates candidate
         where candidate.project_id = ?
           and candidate.repository_id = ? and candidate.base_branch = ?
           and candidate.batch_id is null and candidate.state = 'ready'
           and ${currentReadyCandidate("candidate")}
           and ${completeRunCandidateSet("candidate")}
           and exists (
             select 1 from briar_merge_batches batch
             where batch.id = ? and batch.state = 'collecting'
           )
       ), eligible as materialized (
         select * from eligible_ranked where duplicate_rank = 1
       ), run_groups as materialized (
         select project_id, run_id, attempt, revision,
                repository_id, base_branch, count(*) as member_count,
                min(case when priority is null then 1 else 0 end) as priority_missing,
                min(priority) as priority, min(ready_at) as ready_at
         from eligible
         group by project_id, run_id, attempt, revision,
                  repository_id, base_branch
       ), ordered_runs as materialized (
         select run_groups.*,
                sum(member_count) over (
                  order by priority_missing, priority, ready_at, run_id
                ) as cumulative_size
         from run_groups
       ), ranked as materialized (
         select candidate.id,
                row_number() over (
                  order by ordered.priority_missing, ordered.priority,
                           ordered.ready_at, ordered.run_id,
                           candidate.pull_request_number, candidate.id
                ) as ordinal
         from eligible candidate
         join ordered_runs ordered
           on ordered.project_id = candidate.project_id
          and ordered.run_id = candidate.run_id
          and ordered.attempt = candidate.attempt
          and ordered.revision = candidate.revision
          and ordered.repository_id = candidate.repository_id
          and ordered.base_branch = candidate.base_branch
         where ordered.cumulative_size <= ?
       )
       update briar_merge_batch_candidates as candidate
       set batch_id = ?, ordinal = (
             select ranked.ordinal from ranked where ranked.id = candidate.id
           ),
           state = 'frozen', updated_at = ?
       where candidate.id in (select ranked.id from ranked)
         and candidate.batch_id is null and candidate.state = 'ready'
       returning *`,
    ).bind(
      collecting.project_id,
      collecting.repository_id,
      collecting.base_branch,
      collecting.id,
      collecting.seal_limit,
      collecting.id,
      input.observedAt,
    ),
    db.prepare(
      `update briar_merge_batches
       set state = 'frozen', frozen_at = ?, updated_at = ?
       where id = ? and project_id = ? and state = 'collecting'
         and exists (
           select 1 from briar_merge_batch_candidates candidate
           where candidate.batch_id = briar_merge_batches.id
             and candidate.state = 'frozen' and candidate.ordinal is not null
         )
       returning *`,
    ).bind(
      input.observedAt,
      input.observedAt,
      collecting.id,
      input.projectId,
    ),
  ]);
  const batch = (results[1]?.results?.[0] ?? null) as MergeBatchRow | null;
  if (!batch) return null;
  const members = await db.prepare(
    `select * from briar_merge_batch_candidates
     where batch_id = ? order by ordinal`,
  ).bind(batch.id).all<MergeBatchCandidateRow>();
  return { batch, members: members.results };
}

/** One CAS claims or reclaims one unit of coordinator work. */
export async function claimNextMergeBatch(
  db: D1Database,
  projectId: string,
  input: {
    deviceId: string;
    workerId: string;
    claimedBy: string;
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
): Promise<ClaimedMergeBatch | null> {
  if (input.leaseExpiresAt <= input.claimedAt) {
    throw new RangeError("Merge batch lease must expire after it is claimed");
  }
  await sealNextMergeBatch(db, { projectId, observedAt: input.claimedAt });
  const claimed = await db.prepare(
    `update briar_merge_batches
     set claim_token_hash = ?, claimed_worker_id = ?, claimed_by = ?,
         claimed_at = ?, lease_expires_at = ?,
         claim_attempts = claim_attempts + 1,
         state = case when state = 'frozen' then 'enqueueing' else state end,
         updated_at = ?
     where id = (
       select batch.id from briar_merge_batches batch
       where batch.project_id = ? and batch.state in (${claimableBatchStatesSql})
         and (batch.lease_expires_at is null or batch.lease_expires_at <= ?)
         and (batch.state <> 'waiting_tail' or ${pendingFinalHead("batch")})
         and exists (
           select 1
           from briar_execution_workers selected_worker
           join briar_execution_worker_devices selected_device
             on selected_device.id = selected_worker.device_id
           where selected_worker.id = ? and selected_worker.device_id = ?
             and selected_worker.project_id = batch.project_id
             and (
               (select count(*)
                from briar_hunt_runs active
                join briar_execution_workers holder on holder.id = active.worker_id
                where holder.device_id = selected_device.id
                  and active.claim_token_hash is not null
                  and active.lease_expires_at is not null
                  and active.lease_expires_at > ?
                  and active.status not in (
                    'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                  ))
               +
               (select count(*)
                from briar_project_agent_task_jobs task
                join briar_execution_workers holder
                  on holder.id = task.claimed_worker_id
                where holder.device_id = selected_device.id
                  and task.status = 'running' and task.lease_expires_at > ?)
               +
               (select count(*)
                from briar_issue_agent_reply_jobs reply
                join briar_execution_workers holder
                  on holder.id = reply.claimed_worker_id
                where holder.device_id = selected_device.id
                  and reply.status = 'running' and reply.lease_expires_at > ?)
               +
               (select count(*)
                from briar_channel_agent_reply_jobs reply
                join briar_execution_workers holder
                  on holder.id = reply.claimed_worker_id
                where holder.device_id = selected_device.id
                  and reply.status = 'running' and reply.lease_expires_at > ?)
               +
               (select count(*)
                from briar_merge_batches active_batch
                join briar_execution_workers holder
                  on holder.id = active_batch.claimed_worker_id
                where holder.device_id = selected_device.id
                  and active_batch.claim_token_hash is not null
                  and active_batch.lease_expires_at > ?
                  and active_batch.state in (
                    'enqueueing', 'waiting_tail', 'validating',
                    'publishing', 'draining'
                  ))
             ) < selected_device.max_concurrent_sessions
         )
       order by case state
                  when 'validating' then 0 when 'publishing' then 1
                  when 'frozen' then 2 when 'enqueueing' then 3
                  when 'waiting_tail' then 4 else 5 end,
                coalesce(frozen_at, created_at), id
       limit 1
     )
       and project_id = ? and state in (${claimableBatchStatesSql})
       and (lease_expires_at is null or lease_expires_at <= ?)
       and (state <> 'waiting_tail' or ${
      pendingFinalHead("briar_merge_batches")
    })
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
    input.workerId,
    input.deviceId,
    input.claimedAt,
    input.claimedAt,
    input.claimedAt,
    input.claimedAt,
    input.claimedAt,
    projectId,
    input.claimedAt,
  ).first<MergeBatchRow>();
  if (!claimed) return null;
  const members = await db.prepare(
    `select * from briar_merge_batch_candidates
     where batch_id = ? order by ordinal`,
  ).bind(claimed.id).all<MergeBatchCandidateRow>();
  const pendingHeads = await db.prepare(
    `select * from briar_merge_group_heads
     where batch_id = ? and state = 'pending'
     order by tail_pull_request_number desc, received_at, delivery_id`,
  ).bind(claimed.id).all<MergeGroupHeadRow>();
  const phase: MergeBatchClaimPhase = claimed.state === "validating"
    ? "validate"
    : claimed.state === "publishing"
    ? "publish"
    : claimed.state === "waiting_tail"
    ? "tail_authority"
    : claimed.state === "draining"
    ? "drain"
    : "enqueue";
  return {
    phase,
    batch: claimed,
    members: members.results,
    pendingHeads: pendingHeads.results,
  };
}

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
  if (input.leaseExpiresAt <= input.authenticatedAt) return null;
  const renewed = await db.prepare(
    `update briar_merge_batches
     set lease_expires_at = max(lease_expires_at, ?), updated_at = ?
     where ${liveLeaseFence} and state in (${claimableBatchStatesSql})
     returning lease_expires_at`,
  ).bind(
    input.leaseExpiresAt,
    input.authenticatedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
  ).first<{ lease_expires_at: string }>();
  return renewed?.lease_expires_at ?? null;
}

export async function releaseMergeBatchLease(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
  },
) {
  const released = await db.prepare(
    `update briar_merge_batches
     set claim_token_hash = null, claimed_worker_id = null,
         claimed_by = null, claimed_at = null, lease_expires_at = null,
         updated_at = ?
     where ${liveLeaseFence} and state in (${claimableBatchStatesSql})
     returning id`,
  ).bind(
    input.authenticatedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
  ).first<{ id: string }>();
  return Boolean(released);
}

/** Records one idempotent, in-order exact-SHA GitHub merge-queue enqueue. */
export async function recordMergeBatchCandidateEnqueued(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    candidateId: string;
    expectedHeadSha: string;
    expectedBaseSha: string;
    queueEntryId: string;
    observedAt: string;
  },
) {
  const results = await db.batch([
    db.prepare(
      `update briar_merge_batch_candidates as candidate
       set state = 'enqueued', queue_entry_id = ?,
           enqueued_at = coalesce(enqueued_at, ?), updated_at = ?
       where candidate.id = ? and candidate.batch_id = ?
         and candidate.frozen_head_sha = ? and candidate.frozen_base_sha = ?
         and candidate.state in ('frozen', 'enqueued')
         and (candidate.queue_entry_id is null or candidate.queue_entry_id = ?)
         and ${currentReadyCandidate("candidate")}
         and ${completeRunCandidateSet("candidate")}
         and not exists (
           select 1 from briar_merge_batch_candidates earlier
           where earlier.batch_id = candidate.batch_id
             and earlier.ordinal < candidate.ordinal
             and earlier.state <> 'enqueued'
         )
         and exists (
           select 1 from briar_merge_batches batch
           where batch.id = candidate.batch_id and batch.project_id = ?
             and batch.state in ('enqueueing', 'waiting_tail')
             and batch.claimed_worker_id = ? and batch.claim_token_hash = ?
             and batch.lease_expires_at > ?
         )
       returning *`,
    ).bind(
      input.queueEntryId,
      input.observedAt,
      input.observedAt,
      input.candidateId,
      input.batchId,
      input.expectedHeadSha,
      input.expectedBaseSha,
      input.queueEntryId,
      input.projectId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    ),
    db.prepare(
      `update briar_merge_batches
       set state = 'waiting_tail', updated_at = ?
       where ${liveLeaseFence} and state = 'enqueueing'
         and not exists (
           select 1 from briar_merge_batch_candidates candidate
           where candidate.batch_id = briar_merge_batches.id
             and (candidate.state <> 'enqueued' or candidate.queue_entry_id is null)
         )
       returning *`,
    ).bind(
      input.observedAt,
      input.batchId,
      input.projectId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    ),
  ]);
  const candidate = (results[0]?.results?.[0] ?? null) as
    | MergeBatchCandidateRow
    | null;
  if (!candidate) return null;
  const batch = await db.prepare(
    "select * from briar_merge_batches where id = ?",
  ).bind(input.batchId).first<MergeBatchRow>();
  return { candidate, batch: batch! };
}

/**
 * Persists a verified webhook delivery. Arrival order is never authority:
 * every head remains neutral until an exact GraphQL queue-set proof selects it.
 */
export async function recordSignedMergeGroupHead(
  db: D1Database,
  input: {
    deliveryId: string;
    repositoryId: number;
    repository: string;
    baseBranch: string;
    headRef: string;
    headSha: string;
    baseSha: string;
    tailPullRequestNumber: number;
    receivedAt: string;
  },
) {
  if (mergeGroupTailFromRef(input.headRef) !== input.tailPullRequestNumber) {
    return null;
  }
  const active = await db.prepare(
    `select id, final_delivery_id
     from briar_merge_batches
     where repository_id = ? and repository = ? and base_branch = ?
       and state in (
         'frozen', 'enqueueing', 'waiting_tail', 'validating',
         'publishing', 'awaiting_merge', 'blocked', 'draining'
       )
     limit 1`,
  ).bind(
    input.repositoryId,
    input.repository.toLowerCase(),
    input.baseBranch,
  ).first<{ id: string; final_delivery_id: string | null }>();
  const state = active
    ? active.final_delivery_id ? "superseded" : "pending"
    : "orphaned";
  const resolvedAt = state === "pending" ? null : input.receivedAt;
  await db.batch([
    db.prepare(
      `insert into briar_merge_group_heads (
         delivery_id, batch_id, repository_id, repository, base_branch,
         head_ref, head_sha, base_sha, tail_pull_request_number, state,
         received_at, resolved_at, created_at, updated_at
       )
       select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       from briar_github_deliveries delivery
       where delivery.delivery_id = ? and delivery.event_name = 'merge_group'
         and delivery.action = 'checks_requested'
       on conflict(delivery_id) do nothing`,
    ).bind(
      input.deliveryId,
      active?.id ?? null,
      input.repositoryId,
      input.repository.toLowerCase(),
      input.baseBranch,
      input.headRef,
      input.headSha,
      input.baseSha,
      input.tailPullRequestNumber,
      state,
      input.receivedAt,
      resolvedAt,
      input.receivedAt,
      input.receivedAt,
      input.deliveryId,
    ),
    db.prepare(
      `update briar_merge_group_heads as head
       set state = 'superseded', resolved_at = coalesce(resolved_at, ?),
           updated_at = ?
       where head.delivery_id = ? and head.state = 'pending'
         and exists (
           select 1 from briar_merge_batches batch
           where batch.id = head.batch_id and batch.final_delivery_id is not null
         )`,
    ).bind(input.receivedAt, input.receivedAt, input.deliveryId),
  ]);
  const stored = await db.prepare(
    "select * from briar_merge_group_heads where delivery_id = ?",
  ).bind(input.deliveryId).first<MergeGroupHeadRow>();
  if (!stored) return null;
  const sameIdentity = stored.repository_id === input.repositoryId &&
    stored.repository === input.repository.toLowerCase() &&
    stored.base_branch === input.baseBranch &&
    stored.head_ref === input.headRef && stored.head_sha === input.headSha &&
    stored.base_sha === input.baseSha &&
    stored.tail_pull_request_number === input.tailPullRequestNumber;
  if (!sameIdentity) {
    throw new Error("Signed merge-group delivery identity conflict");
  }
  return stored;
}

/** Selects only the signed cumulative head whose authority set is exact. */
export async function selectAuthoritativeMergeGroupHead(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    deliveryId: string;
    authorityEntries: readonly MergeQueueAuthorityEntry[];
    observedAt: string;
  },
) {
  if (input.authorityEntries.length === 0) return null;
  const authorityKeys = new Set(
    input.authorityEntries.map((entry) =>
      `${entry.queueEntryId}:${entry.pullRequestNumber}`
    ),
  );
  if (authorityKeys.size !== input.authorityEntries.length) return null;

  const head = await db.prepare(
    `select head.*
     from briar_merge_group_heads head
     join briar_merge_batches batch on batch.id = head.batch_id
     where head.delivery_id = ? and head.batch_id = ? and head.state = 'pending'
       and batch.id = ? and batch.project_id = ? and batch.state = 'waiting_tail'
       and batch.claimed_worker_id = ? and batch.claim_token_hash = ?
       and batch.lease_expires_at > ?`,
  ).bind(
    input.deliveryId,
    input.batchId,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.observedAt,
  ).first<MergeGroupHeadRow>();
  if (!head) return null;
  const members = await db.prepare(
    `select * from briar_merge_batch_candidates
     where batch_id = ? order by ordinal`,
  ).bind(input.batchId).all<MergeBatchCandidateRow>();
  if (members.results.length !== input.authorityEntries.length) return null;
  const exact = members.results.every((member, index) => {
    const entry = input.authorityEntries[index];
    return member.ordinal === index + 1 && member.state === "enqueued" &&
      member.queue_entry_id === entry?.queueEntryId &&
      member.pull_request_number === entry.pullRequestNumber;
  });
  const tail = members.results.at(-1);
  if (!exact || tail?.pull_request_number !== head.tail_pull_request_number) {
    return null;
  }

  const results = await db.batch([
    db.prepare(
      `update briar_merge_batches as batch
       set state = 'validating', final_delivery_id = ?,
           merge_group_ref = ?, merge_group_sha = ?,
           merge_group_base_sha = ?, updated_at = ?
       where ${liveLeaseFence} and batch.state = 'waiting_tail'
         and batch.final_delivery_id is null
         and ${completeBatchRunSets("batch")}
         and exists (
           select 1 from briar_merge_group_heads head
           where head.delivery_id = ? and head.batch_id = batch.id
             and head.state = 'pending'
             and head.tail_pull_request_number = (
               select candidate.pull_request_number
               from briar_merge_batch_candidates candidate
               where candidate.batch_id = batch.id
               order by candidate.ordinal desc limit 1
             )
         )
         and not exists (
           select 1 from briar_merge_batch_candidates candidate
           where candidate.batch_id = batch.id
             and (
               candidate.state <> 'enqueued'
               or candidate.queue_entry_id is null
               or not (${currentReadyCandidate("candidate")})
             )
         )
       returning *`,
    ).bind(
      head.delivery_id,
      head.head_ref,
      head.head_sha,
      head.base_sha,
      input.observedAt,
      input.batchId,
      input.projectId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
      head.delivery_id,
    ),
    db.prepare(
      `update briar_merge_group_heads as head
       set state = 'selected', resolved_at = ?, updated_at = ?
       where head.delivery_id = ? and head.batch_id = ? and head.state = 'pending'
         and exists (
           select 1 from briar_merge_batches batch
           where batch.id = head.batch_id and batch.state = 'validating'
             and batch.final_delivery_id = head.delivery_id
             and batch.claimed_worker_id = ? and batch.claim_token_hash = ?
             and batch.lease_expires_at > ?
         )
       returning *`,
    ).bind(
      input.observedAt,
      input.observedAt,
      head.delivery_id,
      input.batchId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    ),
    db.prepare(
      `update briar_merge_group_heads as head
       set state = 'superseded', resolved_at = ?, updated_at = ?
       where head.batch_id = ? and head.delivery_id <> ? and head.state = 'pending'
         and exists (
           select 1 from briar_merge_batches batch
           where batch.id = head.batch_id and batch.state = 'validating'
             and batch.final_delivery_id = ?
         )`,
    ).bind(
      input.observedAt,
      input.observedAt,
      input.batchId,
      head.delivery_id,
      head.delivery_id,
    ),
  ]);
  const batch = (results[0]?.results?.[0] ?? null) as MergeBatchRow | null;
  const selected = (results[1]?.results?.[0] ?? null) as
    | MergeGroupHeadRow
    | null;
  return batch && selected ? { batch, head: selected } : null;
}

/** A durable proof prevents a publication retry from rerunning validation. */
export async function recordMergeBatchValidationProof(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    mergeGroupSha: string;
    validationResults: readonly MergeBatchValidationResult[];
    validatedAt: string;
  },
) {
  const allPassed = validationProofPassed(input.validationResults);
  if (allPassed === null) return null;
  const canonicalResults = MERGE_GROUP_CI_CONTEXTS.map((context) =>
    input.validationResults.find((result) =>
      typeof result === "object" && result !== null &&
      "context" in result && result.context === context
    )
  );
  const resultsJson = JSON.stringify(canonicalResults);
  return db.prepare(
    `update briar_merge_batches as batch
     set state = 'publishing',
         validation_results_json = coalesce(validation_results_json, ?),
         validated_at = coalesce(validated_at, ?), updated_at = ?
     where ${liveLeaseFence} and batch.state in ('validating', 'publishing')
       and batch.merge_group_sha = ?
       and ${completeBatchRunSets("batch")}
       and (
         batch.validation_results_json is null
         or batch.validation_results_json = ?
       )
       and not exists (
         select 1 from briar_merge_batch_candidates candidate
         where candidate.batch_id = batch.id
           and (candidate.state <> 'enqueued' or not (${
      currentReadyCandidate("candidate")
    }))
       )
     returning *`,
  ).bind(
    resultsJson,
    input.validatedAt,
    input.validatedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.validatedAt,
    input.mergeGroupSha,
    resultsJson,
  ).first<MergeBatchRow>();
}

export async function blockMergeBatch(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    code: string;
    detail: string;
    observedAt: string;
    validationResults?: readonly unknown[];
  },
) {
  const resultsJson = input.validationResults
    ? JSON.stringify(input.validationResults)
    : null;
  return db.prepare(
    `update briar_merge_batches
     set state = 'blocked', failure_code = ?, failure_detail = ?,
         validation_results_json = coalesce(validation_results_json, ?),
         validated_at = case
           when ? is null then validated_at else coalesce(validated_at, ?) end,
         claim_token_hash = null, claimed_worker_id = null,
         claimed_by = null, claimed_at = null, lease_expires_at = null,
         updated_at = ?
     where ${liveLeaseFence}
       and state in (${claimableBatchStatesSql})
     returning *`,
  ).bind(
    input.code,
    input.detail.slice(0, 4_000),
    resultsJson,
    resultsJson,
    input.observedAt,
    input.observedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.observedAt,
  ).first<MergeBatchRow>();
}

export async function completeMergeBatchPublication(
  db: D1Database,
  input: {
    batchId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    mergeGroupSha: string;
    publishedAt: string;
  },
) {
  return db.prepare(
    `update briar_merge_batches
     set state = case
           when not exists (
             select 1 from json_each(validation_results_json) result
             where json_extract(result.value, '$.passed') is not 1
           ) then 'awaiting_merge'
           else 'draining'
         end,
         published_at = ?,
         failure_code = case
           when not exists (
             select 1 from json_each(validation_results_json) result
             where json_extract(result.value, '$.passed') is not 1
           ) then null else 'validation_failed'
         end,
         failure_detail = case
           when not exists (
             select 1 from json_each(validation_results_json) result
             where json_extract(result.value, '$.passed') is not 1
           ) then null else 'One or more required validation contexts failed'
         end,
         claim_token_hash = null, claimed_worker_id = null,
         claimed_by = null, claimed_at = null, lease_expires_at = null,
         updated_at = ?
     where ${liveLeaseFence} and state = 'publishing'
       and merge_group_sha = ? and validation_results_json is not null
       and validated_at is not null
       and ${completeBatchRunSets("briar_merge_batches")}
       and not exists (
         select 1 from briar_merge_batch_candidates candidate
         where candidate.batch_id = briar_merge_batches.id
           and (candidate.state <> 'enqueued' or not (${
      currentReadyCandidate("candidate")
    }))
       )
     returning *`,
  ).bind(
    input.publishedAt,
    input.publishedAt,
    input.batchId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.publishedAt,
    input.mergeGroupSha,
  ).first<MergeBatchRow>();
}

/**
 * Accepts only the signed `pull_request/closed` delivery reflected by the
 * canonical current link. It never resumes a run; existing workflow code does
 * that only after all canonical links are merged.
 */
export async function observeSignedMergedBatchPullRequest(
  db: D1Database,
  input: {
    deliveryId: string;
    repositoryId: number;
    pullRequestNumber: number;
    headSha: string;
    mergedAt: string;
  },
) {
  const candidate = await db.prepare(
    `select candidate.*
     from briar_merge_batch_candidates candidate
     join briar_merge_batches batch on batch.id = candidate.batch_id
     where candidate.repository_id = ? and candidate.pull_request_number = ?
       and candidate.frozen_head_sha = ?
       and candidate.state in ('enqueued', 'merged')
       and batch.state in ('awaiting_merge', 'completed')
     order by batch.created_at desc limit 1`,
  ).bind(
    input.repositoryId,
    input.pullRequestNumber,
    input.headSha,
  ).first<MergeBatchCandidateRow>();
  if (!candidate?.batch_id) return null;

  const results = await db.batch([
    db.prepare(
      `update briar_merge_batch_candidates as candidate
       set state = 'merged', merged_delivery_id = ?,
           merged_at = coalesce(merged_at, ?), updated_at = ?
       where candidate.id = ? and candidate.batch_id = ?
         and candidate.repository_id = ? and candidate.pull_request_number = ?
         and candidate.frozen_head_sha = ?
         and candidate.state in ('enqueued', 'merged')
         and (candidate.merged_delivery_id is null or candidate.merged_delivery_id = ?)
         and exists (
           select 1 from briar_github_deliveries delivery
           where delivery.delivery_id = ? and delivery.event_name = 'pull_request'
             and delivery.action = 'closed'
             and delivery.status in ('processing', 'completed')
         )
         and exists (
           select 1
           from briar_hunt_runs run
           join briar_run_pull_requests link
             on link.project_id = run.project_id and link.run_id = run.id
            and link.attempt = run.current_attempt
            and link.revision = run.current_revision
            and link.repository_id = candidate.repository_id
            and link.pull_request_number = candidate.pull_request_number
           where run.id = candidate.run_id and run.project_id = candidate.project_id
             and run.current_attempt = candidate.attempt
             and run.current_revision = candidate.revision
             and link.pull_request_id = candidate.pull_request_id
             and link.pull_request_node_id = candidate.pull_request_node_id
             and link.state = 'merged' and link.head_sha = candidate.frozen_head_sha
             and link.last_delivery_id = ? and link.merged_at = ?
         )
         and exists (
           select 1 from briar_merge_batches batch
           where batch.id = candidate.batch_id
             and batch.state in ('awaiting_merge', 'completed')
         )
       returning *`,
    ).bind(
      input.deliveryId,
      input.mergedAt,
      input.mergedAt,
      candidate.id,
      candidate.batch_id,
      input.repositoryId,
      input.pullRequestNumber,
      input.headSha,
      input.deliveryId,
      input.deliveryId,
      input.deliveryId,
      input.mergedAt,
    ),
    db.prepare(
      `update briar_merge_batches as batch
       set state = 'completed', completed_at = ?, updated_at = ?,
           claim_token_hash = null, claimed_worker_id = null,
           claimed_by = null, claimed_at = null, lease_expires_at = null
       where batch.id = ? and batch.state = 'awaiting_merge'
         and ${completeBatchRunSets("batch")}
         and not exists (
           select 1 from briar_merge_batch_candidates candidate
           where candidate.batch_id = batch.id
             and (candidate.state <> 'merged' or candidate.merged_delivery_id is null)
         )
         and not exists (
           select 1 from briar_merge_batch_candidates candidate
           where candidate.batch_id = batch.id
             and not exists (
               select 1
               from briar_hunt_runs run
               join briar_run_pull_requests link
                 on link.project_id = run.project_id and link.run_id = run.id
                and link.attempt = run.current_attempt
                and link.revision = run.current_revision
                and link.repository_id = candidate.repository_id
                and link.pull_request_number = candidate.pull_request_number
               where run.id = candidate.run_id
                 and run.project_id = candidate.project_id
                 and run.current_attempt = candidate.attempt
                 and run.current_revision = candidate.revision
                 and link.pull_request_id = candidate.pull_request_id
                 and link.pull_request_node_id = candidate.pull_request_node_id
                 and link.state = 'merged'
                 and link.head_sha = candidate.frozen_head_sha
                 and link.last_delivery_id = candidate.merged_delivery_id
                 and link.merged_at = candidate.merged_at
             )
         )
       returning *`,
    ).bind(input.mergedAt, input.mergedAt, candidate.batch_id),
  ]);
  const merged = (results[0]?.results?.[0] ?? null) as
    | MergeBatchCandidateRow
    | null;
  if (!merged) return null;
  const completed = (results[1]?.results?.[0] ?? null) as MergeBatchRow | null;
  const batch = completed ?? await db.prepare(
    "select * from briar_merge_batches where id = ?",
  ).bind(candidate.batch_id).first<MergeBatchRow>();
  return { candidate: merged, batch: batch! };
}
