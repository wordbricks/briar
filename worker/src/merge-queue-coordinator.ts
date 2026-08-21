import * as Schema from "effect/Schema";
import { MERGE_GROUP_MAX_ENTRIES_TO_BUILD } from "../../src/lib/merge-group-validation-contract";
import { schemaDecodeOptions } from "./schema-codecs";

export const MERGE_QUEUE_COLLECTION_WINDOW_MS = 5 * 60_000;
export const MAX_MERGE_QUEUE_ADMISSION_ATTEMPTS = 8;
export const MAX_MERGE_GROUP_AUTHORITY_ATTEMPTS = 8;

const GitObjectSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const MergeQueueMember = Schema.Struct({
  projectId: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  attempt: PositiveInteger,
  revision: PositiveInteger,
  installationId: PositiveInteger,
  repositoryId: PositiveInteger,
  repository: Schema.NonEmptyString,
  pullRequestId: PositiveInteger,
  pullRequestNodeId: Schema.NonEmptyString,
  pullRequestNumber: PositiveInteger,
  headSha: GitObjectSha,
  baseSha: GitObjectSha,
  readyAt: Schema.NonEmptyString,
});
const MergeQueueMembers = Schema.Array(MergeQueueMember);
const decodeMergeQueueMembers = Schema.decodeUnknownSync(
  MergeQueueMembers,
  schemaDecodeOptions,
);

export type MergeQueueMember = typeof MergeQueueMember.Type;

export type MergeQueueAdmissionRow = {
  project_id: string;
  run_id: string;
  attempt: number;
  revision: number;
  installation_id: number;
  repository_id: number;
  repository: string;
  pull_request_id: number;
  pull_request_node_id: string;
  pull_request_number: number;
  head_sha: string;
  base_sha: string;
  merge_queue_admission_attempts: number;
  merge_queue_admission_contexts_json: string;
  merge_queue_admission_receipts_json: string;
};

export type MergeQueueGenerationRow = {
  id: string;
  project_id: string;
  installation_id: number;
  repository_id: number;
  repository: string;
  base_ref: string;
  owner_worker_id: string;
  state:
    | "collecting"
    | "sealing"
    | "enqueuing"
    | "awaiting_tail"
    | "validating"
    | "published"
    | "failed"
    | "superseded";
  expected_members_json: string;
  enqueue_cursor: number;
  collection_started_at: string;
  collection_deadline_at: string;
  sealed_at: string | null;
  enqueued_at: string | null;
  matched_head_ref: string | null;
  matched_head_sha: string | null;
  validation_job_id: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
};

export function generationMembers(
  generation: Pick<MergeQueueGenerationRow, "expected_members_json">,
) {
  return decodeMergeQueueMembers(JSON.parse(generation.expected_members_json));
}

/**
 * Registers current-revision PR links only after ci_qa evidence is complete.
 * The immutable run commit is the claim-fenced proof SHA; a later GitHub
 * readback must match it before the row can become ready.
 */
export async function registerRunMergeQueueAdmission(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    attempt: number;
    revision: number;
    requestedAt: string;
  },
) {
  const result = await db.prepare(
    `update briar_run_pull_requests as link
     set merge_queue_admission_state = case
           when merge_queue_admission_state in ('none', 'failed')
             then 'pending' else merge_queue_admission_state end,
         merge_queue_admission_attempts = case
           when merge_queue_admission_state = 'failed' then 0
           else merge_queue_admission_attempts end,
         merge_queue_admission_next_at = case
           when merge_queue_admission_state in ('none', 'failed') then ?
           else merge_queue_admission_next_at end,
         merge_queue_error_code = case
           when merge_queue_admission_state in ('none', 'failed') then null
           else merge_queue_error_code end,
         merge_queue_error_detail = case
           when merge_queue_admission_state in ('none', 'failed') then null
           else merge_queue_error_detail end,
         updated_at = max(updated_at, ?)
     where link.project_id = ? and link.run_id = ?
       and link.attempt = ? and link.revision = ?
       and link.state = 'open' and link.draft = 0
       and link.installation_id is not null
       and length(link.head_sha) = 40 and length(link.base_sha) = 40
       and exists (
         select 1 from briar_hunt_runs run
         join briar_project_settings settings on settings.project_id = run.project_id
         where run.id = link.run_id and run.project_id = link.project_id
           and run.current_attempt = link.attempt
           and run.current_revision = link.revision
           and run.commit_sha = link.head_sha
           and settings.merge_group_ci_enabled = 1
           and settings.merge_group_ci_base_ref = 'refs/heads/main'
           and settings.merge_group_ci_worker_id is not null
           and lower(settings.github_repository) = link.repository
           and (
             select count(distinct evidence.evidence_type)
             from briar_run_evidence evidence
             where evidence.run_id = run.id
               and evidence.attempt = run.current_attempt
               and evidence.revision = run.current_revision
               and evidence.workflow_stage = 'ci_qa'
               and evidence.status in ('passed', 'skipped')
               and evidence.evidence_type in (
                 'signoff/app-worker', 'signoff/d1-migrations',
                 'signoff/rust', 'signoff/security'
               )
           ) = 4
       )`,
  ).bind(
    input.requestedAt,
    input.requestedAt,
    input.projectId,
    input.runId,
    input.attempt,
    input.revision,
  ).run();
  return result.meta.changes;
}

export async function claimNextMergeQueueAdmission(
  db: D1Database,
  observedAt: string,
) {
  await db.prepare(
    `update briar_run_pull_requests
     set merge_queue_admission_state = 'pending',
         merge_queue_admission_next_at = ?, updated_at = ?
     where merge_queue_admission_state = 'publishing'
       and merge_queue_admission_next_at <= ?`,
  ).bind(observedAt, observedAt, observedAt).run();
  return db.prepare(
    `update briar_run_pull_requests
     set merge_queue_admission_state = 'publishing',
         merge_queue_admission_attempts = merge_queue_admission_attempts + 1,
         merge_queue_admission_next_at = ?, updated_at = ?
     where rowid = (
       select link.rowid
       from briar_run_pull_requests link
       join briar_hunt_runs run
         on run.id = link.run_id and run.project_id = link.project_id
        and run.current_attempt = link.attempt
        and run.current_revision = link.revision
       join briar_project_settings settings on settings.project_id = link.project_id
       join briar_github_connections connection
         on connection.installation_id = link.installation_id
        and connection.status = 'connected'
       where link.merge_queue_admission_state = 'pending'
         and link.merge_queue_admission_attempts < ?
         and link.merge_queue_admission_next_at <= ?
         and settings.merge_group_ci_enabled = 1
         and settings.merge_group_ci_worker_id is not null
       order by link.merge_queue_admission_next_at, link.created_at,
                link.run_id, link.pull_request_number
       limit 1
     )
       and merge_queue_admission_state = 'pending'
     returning project_id, run_id, attempt, revision, installation_id,
               repository_id, repository, pull_request_id,
               pull_request_node_id, pull_request_number, head_sha, base_sha,
               merge_queue_admission_attempts,
               merge_queue_admission_contexts_json,
               merge_queue_admission_receipts_json`,
  ).bind(
    new Date(Date.parse(observedAt) + 60_000).toISOString(),
    observedAt,
    MAX_MERGE_QUEUE_ADMISSION_ATTEMPTS,
    observedAt,
  ).first<MergeQueueAdmissionRow>();
}

export function nextAdmissionContext(
  row: Pick<MergeQueueAdmissionRow, "merge_queue_admission_contexts_json">,
  contexts: readonly string[],
) {
  const published = Schema.decodeUnknownSync(
    Schema.Array(Schema.String),
    schemaDecodeOptions,
  )(JSON.parse(row.merge_queue_admission_contexts_json));
  return contexts.find((context) => !published.includes(context)) ?? null;
}

export async function recordMergeQueueAdmissionReceipt(
  db: D1Database,
  input: {
    row: MergeQueueAdmissionRow;
    context: string;
    receipt: unknown;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_run_pull_requests
     set merge_queue_admission_contexts_json = json_insert(
           merge_queue_admission_contexts_json, '$[#]', ?
         ),
         merge_queue_admission_receipts_json = json_insert(
           merge_queue_admission_receipts_json, '$[#]', json(?)
         ),
         merge_queue_admission_next_at = ?, updated_at = ?
     where project_id = ? and run_id = ? and attempt = ? and revision = ?
       and repository_id = ? and pull_request_number = ?
       and pull_request_id = ? and pull_request_node_id = ?
       and head_sha = ? and base_sha = ?
       and merge_queue_admission_state = 'publishing'
       and not exists (
         select 1 from json_each(merge_queue_admission_contexts_json)
         where value = ?
       )
     returning *`,
  ).bind(
    input.context,
    JSON.stringify({ context: input.context, receipt: input.receipt }),
    input.observedAt,
    input.observedAt,
    input.row.project_id,
    input.row.run_id,
    input.row.attempt,
    input.row.revision,
    input.row.repository_id,
    input.row.pull_request_number,
    input.row.pull_request_id,
    input.row.pull_request_node_id,
    input.row.head_sha,
    input.row.base_sha,
    input.context,
  ).first<MergeQueueAdmissionRow>();
}

export async function completeMergeQueueAdmission(
  db: D1Database,
  input: { row: MergeQueueAdmissionRow; observedAt: string; contextCount: number },
) {
  return db.prepare(
    `update briar_run_pull_requests
     set merge_queue_admission_state = 'ready',
         merge_queue_ready_at = coalesce(merge_queue_ready_at, ?),
         merge_queue_admission_next_at = null,
         merge_queue_error_code = null, merge_queue_error_detail = null,
         updated_at = ?
     where project_id = ? and run_id = ? and attempt = ? and revision = ?
       and repository_id = ? and pull_request_number = ?
       and pull_request_id = ? and pull_request_node_id = ?
       and head_sha = ? and base_sha = ?
       and merge_queue_admission_state = 'publishing'
       and json_array_length(merge_queue_admission_contexts_json) = ?
     returning *`,
  ).bind(
    input.observedAt,
    input.observedAt,
    input.row.project_id,
    input.row.run_id,
    input.row.attempt,
    input.row.revision,
    input.row.repository_id,
    input.row.pull_request_number,
    input.row.pull_request_id,
    input.row.pull_request_node_id,
    input.row.head_sha,
    input.row.base_sha,
    input.contextCount,
  ).first<MergeQueueAdmissionRow>();
}

export async function releaseMergeQueueAdmission(
  db: D1Database,
  input: {
    row: MergeQueueAdmissionRow;
    observedAt: string;
    nextAttemptAt: string;
    terminal: boolean;
    code: string;
    detail: string;
  },
) {
  return db.prepare(
    `update briar_run_pull_requests
     set merge_queue_admission_state = ?,
         merge_queue_admission_next_at = ?,
         merge_queue_error_code = ?, merge_queue_error_detail = ?,
         updated_at = ?
     where project_id = ? and run_id = ? and attempt = ? and revision = ?
       and repository_id = ? and pull_request_number = ?
       and head_sha = ? and base_sha = ?
       and merge_queue_admission_state = 'publishing'
     returning *`,
  ).bind(
    input.terminal ? "failed" : "pending",
    input.terminal ? null : input.nextAttemptAt,
    input.code,
    input.detail.slice(0, 4_000),
    input.observedAt,
    input.row.project_id,
    input.row.run_id,
    input.row.attempt,
    input.row.revision,
    input.row.repository_id,
    input.row.pull_request_number,
    input.row.head_sha,
    input.row.base_sha,
  ).first<MergeQueueAdmissionRow>();
}

async function collectingGeneration(
  db: D1Database,
  repositoryId: number,
  baseRef: string,
) {
  return db.prepare(
    `select * from merge_queue_generations
     where repository_id = ? and base_ref = ?
       and state in (
         'collecting', 'sealing', 'enqueuing', 'awaiting_tail', 'validating'
       )
     limit 1`,
  ).bind(repositoryId, baseRef).first<MergeQueueGenerationRow>();
}

/** Creates the lane mutex row and fills only its still-open collection. */
export async function collectReadyMergeQueueGeneration(
  db: D1Database,
  input: {
    projectId: string;
    repositoryId: number;
    observedAt: string;
  },
) {
  let generation = await collectingGeneration(
    db,
    input.repositoryId,
    "refs/heads/main",
  );
  if (!generation) {
    const lane = await db.prepare(
      `select link.installation_id, link.repository,
              settings.merge_group_ci_worker_id as owner_worker_id,
              min(link.merge_queue_ready_at) as first_ready_at
       from briar_run_pull_requests link
       join briar_project_settings settings on settings.project_id = link.project_id
       where link.project_id = ? and link.repository_id = ?
         and link.merge_queue_admission_state = 'ready'
         and link.merge_queue_generation_id is null
         and settings.merge_group_ci_enabled = 1
         and settings.merge_group_ci_worker_id is not null
         and lower(settings.github_repository) = link.repository
       group by link.installation_id, link.repository,
                settings.merge_group_ci_worker_id
       order by first_ready_at
       limit 1`,
    ).bind(input.projectId, input.repositoryId).first<{
      installation_id: number;
      repository: string;
      owner_worker_id: string;
      first_ready_at: string;
    }>();
    if (!lane) return null;
    const id = crypto.randomUUID();
    try {
      generation = await db.prepare(
        `insert into merge_queue_generations (
           id, project_id, installation_id, repository_id, repository,
           base_ref, owner_worker_id, state, expected_members_json,
           collection_started_at, collection_deadline_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'refs/heads/main', ?, 'collecting', '[]',
                   ?, ?, ?, ?)
         returning *`,
      ).bind(
        id,
        input.projectId,
        lane.installation_id,
        input.repositoryId,
        lane.repository,
        lane.owner_worker_id,
        lane.first_ready_at,
        new Date(
          Date.parse(lane.first_ready_at) + MERGE_QUEUE_COLLECTION_WINDOW_MS,
        ).toISOString(),
        input.observedAt,
        input.observedAt,
      ).first<MergeQueueGenerationRow>();
    } catch {
      generation = await collectingGeneration(
        db,
        input.repositoryId,
        "refs/heads/main",
      );
    }
  }
  if (!generation || generation.state !== "collecting") return generation;
  const assigned = await db.prepare(
    `select count(*) as count from briar_run_pull_requests
     where merge_queue_generation_id = ?`,
  ).bind(generation.id).first<number>("count") ?? 0;
  const capacity = Math.max(0, MERGE_GROUP_MAX_ENTRIES_TO_BUILD - assigned);
  if (capacity > 0) {
    await db.prepare(
      `update briar_run_pull_requests
       set merge_queue_generation_id = ?, updated_at = max(updated_at, ?)
       where rowid in (
         select link.rowid
         from briar_run_pull_requests link
         join briar_hunt_runs run
           on run.id = link.run_id and run.project_id = link.project_id
          and run.current_attempt = link.attempt
          and run.current_revision = link.revision
         where link.project_id = ? and link.repository_id = ?
           and link.installation_id = ? and link.repository = ?
           and exists (
             select 1 from briar_project_settings settings
             where settings.project_id = link.project_id
               and lower(settings.github_repository) = link.repository
               and settings.merge_group_ci_enabled = 1
               and settings.merge_group_ci_worker_id = ?
           )
           and link.merge_queue_admission_state = 'ready'
           and link.merge_queue_generation_id is null
           and link.merge_queue_ready_at <= ?
         order by link.merge_queue_ready_at, link.run_id,
                  link.pull_request_number
         limit ?
       ) and merge_queue_generation_id is null`,
    ).bind(
      generation.id,
      input.observedAt,
      generation.project_id,
      generation.repository_id,
      generation.installation_id,
      generation.repository,
      generation.owner_worker_id,
      generation.collection_deadline_at,
      capacity,
    ).run();
  }
  const rows = await db.prepare(
    `select link.project_id, link.run_id, link.attempt, link.revision,
            link.installation_id, link.repository_id, link.repository,
            link.pull_request_id, link.pull_request_node_id,
            link.pull_request_number, link.head_sha, link.base_sha,
            link.merge_queue_ready_at
     from briar_run_pull_requests link
     join briar_hunt_runs run
       on run.id = link.run_id and run.project_id = link.project_id
      and run.current_attempt = link.attempt
      and run.current_revision = link.revision
     where link.merge_queue_generation_id = ?
       and link.merge_queue_admission_state = 'ready'
     order by link.merge_queue_ready_at, link.run_id,
              link.pull_request_number`,
  ).bind(generation.id).all<{
    project_id: string;
    run_id: string;
    attempt: number;
    revision: number;
    installation_id: number;
    repository_id: number;
    repository: string;
    pull_request_id: number;
    pull_request_node_id: string;
    pull_request_number: number;
    head_sha: string;
    base_sha: string;
    merge_queue_ready_at: string;
  }>();
  const shouldSeal = rows.results.length >= MERGE_GROUP_MAX_ENTRIES_TO_BUILD ||
    input.observedAt >= generation.collection_deadline_at;
  if (!shouldSeal || rows.results.length === 0) {
    return collectingGeneration(db, input.repositoryId, "refs/heads/main");
  }
  const members = rows.results.map((row): MergeQueueMember => ({
    projectId: row.project_id,
    runId: row.run_id,
    attempt: row.attempt,
    revision: row.revision,
    installationId: row.installation_id,
    repositoryId: row.repository_id,
    repository: row.repository,
    pullRequestId: row.pull_request_id,
    pullRequestNodeId: row.pull_request_node_id,
    pullRequestNumber: row.pull_request_number,
    headSha: row.head_sha,
    baseSha: row.base_sha,
    readyAt: row.merge_queue_ready_at,
  }));
  return db.prepare(
    `update merge_queue_generations
     set state = 'enqueuing', expected_members_json = ?, sealed_at = ?,
         updated_at = ?
     where id = ? and state = 'collecting'
     returning *`,
  ).bind(
    JSON.stringify(members),
    input.observedAt,
    input.observedAt,
    generation.id,
  ).first<MergeQueueGenerationRow>();
}

export async function recordMergeQueueGenerationEnqueue(
  db: D1Database,
  input: {
    generationId: string;
    member: MergeQueueMember;
    cursor: number;
    queueEntryId: string;
    observedAt: string;
    complete: boolean;
  },
) {
  const nextState = input.complete ? "awaiting_tail" : "enqueuing";
  const results = await db.batch([
    db.prepare(
      `update briar_run_pull_requests
       set merge_queue_entry_id = ?, merge_queue_enqueued_at = ?, updated_at = ?
       where project_id = ? and run_id = ? and attempt = ? and revision = ?
         and repository_id = ? and pull_request_number = ?
         and head_sha = ? and base_sha = ?
         and merge_queue_generation_id = ?`,
    ).bind(
      input.queueEntryId,
      input.observedAt,
      input.observedAt,
      input.member.projectId,
      input.member.runId,
      input.member.attempt,
      input.member.revision,
      input.member.repositoryId,
      input.member.pullRequestNumber,
      input.member.headSha,
      input.member.baseSha,
      input.generationId,
    ),
    db.prepare(
      `update merge_queue_generations
       set enqueue_cursor = ?, state = ?,
           enqueued_at = case when ? then ? else enqueued_at end,
           updated_at = ?
       where id = ? and state = 'enqueuing' and enqueue_cursor = ?
       returning *`,
    ).bind(
      input.cursor + 1,
      nextState,
      input.complete ? 1 : 0,
      input.observedAt,
      input.observedAt,
      input.generationId,
      input.cursor,
    ),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 ||
      (results[1]?.meta.changes ?? 0) !== 1) {
    throw new Error("Merge queue generation enqueue fence changed");
  }
  return db.prepare(
    "select * from merge_queue_generations where id = ?",
  ).bind(input.generationId).first<MergeQueueGenerationRow>();
}

export async function failMergeQueueGeneration(
  db: D1Database,
  input: {
    generationId: string;
    observedAt: string;
    code: string;
    detail: string;
    superseded?: boolean;
  },
) {
  return db.prepare(
    `update merge_queue_generations
     set state = ?, error_code = ?, error_detail = ?, updated_at = ?
     where id = ? and state in (
       'collecting', 'sealing', 'enqueuing', 'awaiting_tail', 'validating'
     )
     returning *`,
  ).bind(
    input.superseded ? "superseded" : "failed",
    input.code,
    input.detail.slice(0, 4_000),
    input.observedAt,
    input.generationId,
  ).first<MergeQueueGenerationRow>();
}

export async function listDueMergeQueueGenerations(
  db: D1Database,
  limit = 25,
) {
  const result = await db.prepare(
    `select * from merge_queue_generations
     where state in ('collecting', 'enqueuing', 'awaiting_tail')
     order by case state when 'awaiting_tail' then 0
                         when 'enqueuing' then 1 else 2 end,
              collection_deadline_at, updated_at, id
     limit ?`,
  ).bind(limit).all<MergeQueueGenerationRow>();
  return result.results;
}
