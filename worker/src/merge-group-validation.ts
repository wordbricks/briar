import { MERGE_GROUP_STATUS_CONTEXTS } from "../../src/lib/merge-group-validation-contract";
import { workerDeviceCapacityGuardSql } from "./worker-capacity";

export const MAX_MERGE_GROUP_INFRA_ATTEMPTS = 3;
export const MAX_MERGE_GROUP_PUBLICATION_ATTEMPTS = 8;

export type MergeGroupValidationState =
  | "queued"
  | "running"
  | "validated"
  | "published"
  | "failed"
  | "superseded";

export type MergeGroupValidationJobRow = {
  id: string;
  project_id: string;
  installation_id: number;
  repository_id: number;
  repository: string;
  base_ref: string;
  head_ref: string;
  head_sha: string;
  base_sha: string;
  tail_pull_request_number: number;
  tail_position: number;
  authority_checked_at: string;
  eligible_worker_id: string;
  state: MergeGroupValidationState;
  validation_outcome: "passed" | "failed" | null;
  claimed_worker_id: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  publication_attempts: number;
  published_contexts_json: string;
  publication_receipts_json: string;
  next_publication_at: string | null;
  error_code: string | null;
  error_detail: string | null;
  queued_at: string;
  started_at: string | null;
  validated_at: string | null;
  published_at: string | null;
  failed_at: string | null;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
};

const clearClaim = `
  claimed_worker_id = null,
  claim_token_hash = null,
  claimed_at = null,
  lease_expires_at = null`;

export function mergeGroupWorkerCapabilitySql(workerSql: string) {
  const image =
    `json_extract(${workerSql}.capabilities_json, '$.merge_group_ci.image')`;
  const digest = `substr(${image}, instr(${image}, '@sha256:') + 8)`;
  return `
    json_extract(${workerSql}.capabilities_json, '$.merge_group_ci.protocol') = 2
    and json_extract(${workerSql}.capabilities_json, '$.merge_group_ci.isolation') = 'container'
    and json_extract(${workerSql}.capabilities_json, '$.merge_group_ci.network') = 'none'
    and json_extract(${workerSql}.capabilities_json, '$.merge_group_ci.uid') = 65532
    and ${image} = lower(${image})
    and instr(${image}, '@sha256:') > 1
    and length(${digest}) = 64
    and ${digest} not glob '*[^0-9a-f]*'`;
}

export async function getMergeGroupCiProfile(
  db: D1Database,
  projectId: string,
) {
  return db.prepare(
    `select settings.merge_group_ci_enabled, settings.merge_group_ci_base_ref,
            settings.merge_group_ci_worker_id, settings.github_repository,
            worker.capabilities_json, worker.state as worker_state,
            worker.accepting_work, worker.readiness_state,
            worker.last_heartbeat_at
     from briar_project_settings settings
     left join briar_execution_workers worker
       on worker.id = settings.merge_group_ci_worker_id
      and worker.project_id = settings.project_id
     where settings.project_id = ?`,
  ).bind(projectId).first<{
    merge_group_ci_enabled: number;
    merge_group_ci_base_ref: string;
    merge_group_ci_worker_id: string | null;
    github_repository: string | null;
    capabilities_json: string | null;
    worker_state: string | null;
    accepting_work: number | null;
    readiness_state: string | null;
    last_heartbeat_at: string | null;
  }>();
}

export async function updateMergeGroupCiProfile(
  db: D1Database,
  projectId: string,
  input: {
    enabled: boolean;
    baseRef: "refs/heads/main";
    workerId: string | null;
    updatedAt: string;
    workerHeartbeatAfter: string;
  },
) {
  return db.prepare(
    `update briar_project_settings
     set merge_group_ci_enabled = ?, merge_group_ci_base_ref = ?,
         merge_group_ci_worker_id = ?, updated_at = ?
     where project_id = ?
       and (? = 0 or (
         github_repository is not null and ? is not null
         and exists (
           select 1 from briar_execution_workers worker
           where worker.id = ? and worker.project_id = ?
             and worker.state = 'online' and worker.accepting_work = 1
             and worker.last_heartbeat_at > ?
             and worker.readiness_state != 'needs_attention'
             and ${mergeGroupWorkerCapabilitySql("worker")}
         )
       ))
     returning *`,
  ).bind(
    input.enabled ? 1 : 0,
    input.baseRef,
    input.workerId,
    input.updatedAt,
    projectId,
    input.enabled ? 1 : 0,
    input.workerId,
    input.workerId,
    projectId,
    input.workerHeartbeatAfter,
  ).first<Record<string, unknown>>();
}

export async function mergeGroupValidationProject(
  db: D1Database,
  input: {
    installationId: number;
    repositoryId: number;
    repository: string;
    baseRef: string;
    workerHeartbeatAfter: string;
  },
) {
  return db.prepare(
    `select project.id, settings.merge_group_ci_worker_id
     from briar_github_connections connection
     join briar_github_connection_repositories repository
       on repository.installation_id = connection.installation_id
      and repository.repository_id = ?
      and lower(repository.full_name) = ?
     join briar_projects project
       on project.organization_id = connection.organization_id
     join briar_project_settings settings on settings.project_id = project.id
     join briar_execution_workers worker
       on worker.id = settings.merge_group_ci_worker_id
      and worker.project_id = project.id
     where connection.installation_id = ? and connection.status = 'connected'
       and lower(settings.github_repository) = ?
       and settings.merge_group_ci_enabled = 1
       and settings.merge_group_ci_base_ref = ?
       and worker.state = 'online' and worker.accepting_work = 1
       and worker.last_heartbeat_at > ?
       and worker.readiness_state != 'needs_attention'
       and ${mergeGroupWorkerCapabilitySql("worker")}
     order by project.id
     limit 1`,
  ).bind(
    input.repositoryId,
    input.repository.toLowerCase(),
    input.installationId,
    input.repository.toLowerCase(),
    input.baseRef,
    input.workerHeartbeatAfter,
  ).first<{ id: string; merge_group_ci_worker_id: string }>();
}

export async function enqueueMergeGroupValidationJob(
  db: D1Database,
  input: {
    projectId: string;
    installationId: number;
    repositoryId: number;
    repository: string;
    baseRef: string;
    headRef: string;
    headSha: string;
    baseSha: string;
    tailPullRequestNumber: number;
    tailPosition: number;
    authorityCheckedAt: string;
    eligibleWorkerId: string;
    queuedAt: string;
  },
) {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `insert into merge_group_validation_jobs (
         id, project_id, installation_id, repository_id, repository,
         base_ref, head_ref, head_sha, base_sha, tail_pull_request_number,
         tail_position, authority_checked_at, eligible_worker_id, state,
         queued_at, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
       on conflict(repository_id, base_ref, head_sha) do update set
         head_ref = excluded.head_ref,
         base_sha = excluded.base_sha,
         tail_pull_request_number = excluded.tail_pull_request_number,
         tail_position = excluded.tail_position,
         authority_checked_at = excluded.authority_checked_at,
         eligible_worker_id = excluded.eligible_worker_id,
         state = case when merge_group_validation_jobs.state = 'superseded'
           then 'queued' else merge_group_validation_jobs.state end,
         superseded_at = case when merge_group_validation_jobs.state = 'superseded'
           then null else merge_group_validation_jobs.superseded_at end,
         error_code = case when merge_group_validation_jobs.state = 'superseded'
           then null else merge_group_validation_jobs.error_code end,
         error_detail = case when merge_group_validation_jobs.state = 'superseded'
           then null else merge_group_validation_jobs.error_detail end,
         updated_at = excluded.updated_at
       where (
         excluded.base_sha = merge_group_validation_jobs.base_sha
         and excluded.tail_position >= merge_group_validation_jobs.tail_position
         and excluded.authority_checked_at >=
           merge_group_validation_jobs.authority_checked_at
       ) or (
         excluded.base_sha <> merge_group_validation_jobs.base_sha
         and excluded.authority_checked_at >=
           merge_group_validation_jobs.authority_checked_at
       )`,
    ).bind(
      id,
      input.projectId,
      input.installationId,
      input.repositoryId,
      input.repository.toLowerCase(),
      input.baseRef,
      input.headRef,
      input.headSha,
      input.baseSha,
      input.tailPullRequestNumber,
      input.tailPosition,
      input.authorityCheckedAt,
      input.eligibleWorkerId,
      input.queuedAt,
      input.queuedAt,
      input.queuedAt,
    ),
    db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', error_code = 'queue_tail_replaced',
           error_detail = 'A newer GitHub-authoritative cumulative head replaced this job',
           superseded_at = ?, ${clearClaim}, updated_at = ?
       where repository_id = ? and base_ref = ? and head_sha <> ?
         and (
           (base_sha = ? and tail_position <= ?)
           or (base_sha <> ? and authority_checked_at <= ?)
         )
         and state not in ('published', 'superseded')`,
    ).bind(
      input.queuedAt,
      input.queuedAt,
      input.repositoryId,
      input.baseRef,
      input.headSha,
      input.baseSha,
      input.tailPosition,
      input.baseSha,
      input.authorityCheckedAt,
    ),
    db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', error_code = 'stale_queue_snapshot',
           error_detail = 'A later GitHub queue-tail observation already exists',
           superseded_at = ?, ${clearClaim}, updated_at = ?
       where repository_id = ? and base_ref = ? and head_sha = ?
         and exists (
           select 1 from merge_group_validation_jobs newer
           where newer.repository_id = merge_group_validation_jobs.repository_id
             and newer.base_ref = merge_group_validation_jobs.base_ref
             and newer.head_sha <> merge_group_validation_jobs.head_sha
             and newer.state not in ('published', 'superseded')
             and (
               (newer.base_sha = merge_group_validation_jobs.base_sha
                 and newer.tail_position > merge_group_validation_jobs.tail_position)
               or (newer.base_sha <> merge_group_validation_jobs.base_sha
                 and newer.authority_checked_at > ?)
             )
         )`,
    ).bind(
      input.queuedAt,
      input.queuedAt,
      input.repositoryId,
      input.baseRef,
      input.headSha,
      input.authorityCheckedAt,
    ),
  ]);
  return db.prepare(
    `select * from merge_group_validation_jobs
     where repository_id = ? and base_ref = ? and head_sha = ?`,
  ).bind(input.repositoryId, input.baseRef, input.headSha)
    .first<MergeGroupValidationJobRow>();
}

export async function claimNextMergeGroupValidationJob(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  const capacityGuard = workerDeviceCapacityGuardSql("?");
  await db.prepare(
    `update merge_group_validation_jobs
     set state = case
           when state = 'running' and attempts >= ? then 'failed'
           when state = 'running' then 'queued'
           else state
         end,
         error_code = case
           when state = 'running' and attempts >= ? then 'lease_exhausted'
           else error_code
         end,
         error_detail = case
           when state = 'running' and attempts >= ?
             then 'Worker lease expired after the bounded retry limit'
           else error_detail
         end,
         validation_outcome = case
           when state = 'running' and attempts >= ? then 'failed'
           else validation_outcome end,
         validated_at = case
           when state = 'running' and attempts >= ? then ?
           else validated_at end,
         failed_at = case
           when state = 'running' and attempts >= ? then ? else failed_at end,
         ${clearClaim}, updated_at = ?
     where project_id = ? and lease_expires_at is not null
       and lease_expires_at <= ?
       and (
         state = 'running'
         or (state in ('validated', 'failed') and validated_at is not null
             and published_at is null)
       )`,
  ).bind(
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    input.claimedAt,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    input.claimedAt,
    input.claimedAt,
    projectId,
    input.claimedAt,
  ).run();

  return db.prepare(
    `with claim_clock(observed_at) as (values (?))
     update merge_group_validation_jobs
     set state = case when state = 'queued' then 'running' else state end,
         claimed_worker_id = ?, claim_token_hash = ?, claimed_at = ?,
         lease_expires_at = ?,
         attempts = case when state = 'queued' then attempts + 1 else attempts end,
         started_at = case when state = 'queued' then coalesce(started_at, ?)
                           else started_at end,
         updated_at = ?
     where id = (
       select id from merge_group_validation_jobs
       where project_id = ?
         and eligible_worker_id = ?
         and (
           state = 'queued'
           or (state in ('validated', 'failed') and validated_at is not null
               and published_at is null)
         )
         and claimed_worker_id is null and claim_token_hash is null
         and publication_attempts < ?
         and (next_publication_at is null or next_publication_at <= ?)
         and ${capacityGuard}
       order by case when validated_at is not null then 0 else 1 end,
                queued_at, id
       limit 1
     )
       and claimed_worker_id is null and claim_token_hash is null
     returning *`,
  ).bind(
    input.claimedAt,
    input.workerId,
    input.claimTokenHash,
    input.claimedAt,
    input.leaseExpiresAt,
    input.claimedAt,
    input.claimedAt,
    projectId,
    input.workerId,
    MAX_MERGE_GROUP_PUBLICATION_ATTEMPTS,
    input.claimedAt,
    input.workerId,
  ).first<MergeGroupValidationJobRow>();
}

const liveFence = `
  id = ? and project_id = ? and claimed_worker_id = ?
  and claim_token_hash = ? and lease_expires_at > ?
  and state not in ('published', 'superseded')`;

export async function renewMergeGroupValidationLease(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    leaseExpiresAt: string;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set lease_expires_at = ?, updated_at = ?
     where ${liveFence}
     returning *`,
  ).bind(
    input.leaseExpiresAt,
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
  ).first<MergeGroupValidationJobRow>();
}

export async function recordMergeGroupValidation(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    headSha: string;
    passed: boolean;
    detail?: string | null;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set state = ?, validation_outcome = ?, validated_at = ?,
         error_code = ?, error_detail = ?, failed_at = ?, updated_at = ?
     where ${liveFence} and state = 'running' and head_sha = ?
     returning *`,
  ).bind(
    input.passed ? "validated" : "failed",
    input.passed ? "passed" : "failed",
    input.authenticatedAt,
    input.passed ? null : "ci_failed",
    input.passed ? null : (input.detail ?? "bun run ci:local failed").slice(0, 4_000),
    input.passed ? null : input.authenticatedAt,
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
    input.headSha,
  ).first<MergeGroupValidationJobRow>();
}

export async function fenceMergeGroupStatusPublication(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    leaseExpiresAt: string;
    headSha: string;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set lease_expires_at = ?, publication_attempts = publication_attempts + 1,
         next_publication_at = null, updated_at = ?
     where ${liveFence} and head_sha = ? and validated_at is not null
       and published_at is null and state in ('validated', 'failed')
     returning *`,
  ).bind(
    input.leaseExpiresAt,
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
    input.headSha,
  ).first<MergeGroupValidationJobRow>();
}

export function nextMergeGroupStatusContext(
  job: Pick<MergeGroupValidationJobRow, "published_contexts_json">,
) {
  let published: unknown;
  try {
    published = JSON.parse(job.published_contexts_json);
  } catch {
    throw new Error("Stored merge-group publication progress is invalid");
  }
  if (
    !Array.isArray(published) ||
    !published.every((value) => typeof value === "string")
  ) {
    throw new Error("Stored merge-group publication progress is invalid");
  }
  return MERGE_GROUP_STATUS_CONTEXTS.find((context) =>
    !published.includes(context)
  ) ?? null;
}

export async function recordMergeGroupStatusReceipt(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    headSha: string;
    context: (typeof MERGE_GROUP_STATUS_CONTEXTS)[number];
    receipt: unknown;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set published_contexts_json = json_insert(
           published_contexts_json, '$[#]', ?
         ),
         publication_receipts_json = json_insert(
           publication_receipts_json, '$[#]', json(?)
         ),
         error_code = case when error_code = 'publication_retry'
           then null else error_code end,
         error_detail = case when error_code = 'publication_retry'
           then null else error_detail end,
         next_publication_at = null,
         updated_at = ?
     where ${liveFence} and head_sha = ? and validated_at is not null
       and published_at is null and state in ('validated', 'failed')
       and not exists (
         select 1 from json_each(published_contexts_json) where value = ?
       )
     returning *`,
  ).bind(
    input.context,
    JSON.stringify({ context: input.context, receipt: input.receipt }),
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
    input.headSha,
    input.context,
  ).first<MergeGroupValidationJobRow>();
}

export async function recordMergeGroupPublicationFailure(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    nextPublicationAt: string;
    detail: string;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set error_code = case when publication_attempts >= ?
           then 'publication_exhausted' else 'publication_retry' end,
         error_detail = ?,
         next_publication_at = case when publication_attempts >= ?
           then null else ? end,
         ${clearClaim}, updated_at = ?
     where ${liveFence} and validated_at is not null and published_at is null
       and state in ('validated', 'failed')
     returning *`,
  ).bind(
    MAX_MERGE_GROUP_PUBLICATION_ATTEMPTS,
    input.detail.slice(0, 4_000),
    MAX_MERGE_GROUP_PUBLICATION_ATTEMPTS,
    input.nextPublicationAt,
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
  ).first<MergeGroupValidationJobRow>();
}

export async function retryMergeGroupValidationJob(
  db: D1Database,
  input: { projectId: string; jobId: string; requestedAt: string },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set state = case when error_code in ('infra_exhausted', 'lease_exhausted')
                        then 'queued'
                      when validation_outcome is null then 'queued'
                      when validation_outcome = 'passed' then 'validated'
                      else 'failed' end,
         validation_outcome = case
           when error_code in ('infra_exhausted', 'lease_exhausted') then null
           else validation_outcome end,
         attempts = case
           when error_code in ('infra_exhausted', 'lease_exhausted') then 0
           else attempts end,
         publication_attempts = 0,
         published_contexts_json = case
           when error_code in ('infra_exhausted', 'lease_exhausted') then '[]'
           else published_contexts_json end,
         publication_receipts_json = case
           when error_code in ('infra_exhausted', 'lease_exhausted') then '[]'
           else publication_receipts_json end,
         validated_at = case
           when error_code in ('infra_exhausted', 'lease_exhausted') then null
           else validated_at end,
         published_at = case
           when error_code in ('infra_exhausted', 'lease_exhausted') then null
           else published_at end,
         next_publication_at = null,
         error_code = null, error_detail = null,
         failed_at = case
           when error_code in ('infra_exhausted', 'lease_exhausted') then null
           when validation_outcome = 'failed' then failed_at else null end,
         superseded_at = null, ${clearClaim},
         queued_at = ?, updated_at = ?
     where id = ? and project_id = ? and state in ('validated', 'failed')
       and error_code in (
         'infra_exhausted', 'lease_exhausted', 'publication_exhausted'
       )
     returning *`,
  ).bind(
    input.requestedAt,
    input.requestedAt,
    input.jobId,
    input.projectId,
  ).first<MergeGroupValidationJobRow>();
}

export async function listMergeGroupValidationJobs(
  db: D1Database,
  projectId: string,
) {
  const result = await db.prepare(
    `select id, repository, base_ref, head_ref, head_sha, base_sha,
            tail_pull_request_number, tail_position, state,
            validation_outcome, eligible_worker_id, claimed_worker_id,
            attempts, publication_attempts, published_contexts_json,
            publication_receipts_json, next_publication_at,
            error_code, error_detail, queued_at, started_at, validated_at,
            published_at, failed_at, superseded_at, updated_at
     from merge_group_validation_jobs
     where project_id = ?
     order by updated_at desc, id desc
     limit 100`,
  ).bind(projectId).all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function completeMergeGroupStatusPublication(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    headSha: string;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set state = case when state = 'validated' then 'published' else state end,
         published_at = ?, ${clearClaim}, updated_at = ?
     where ${liveFence} and head_sha = ? and validated_at is not null
       and published_at is null and state in ('validated', 'failed')
       and json_array_length(published_contexts_json) = ?
     returning *`,
  ).bind(
    input.authenticatedAt,
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
    input.headSha,
    MERGE_GROUP_STATUS_CONTEXTS.length,
  ).first<MergeGroupValidationJobRow>();
}

export async function releaseMergeGroupValidationClaim(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    reason: "planned_update" | "infra_error";
    detail?: string | null;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set state = case
           when state = 'running' and ? = 'infra_error' and attempts >= ?
             then 'failed'
           when state = 'running' then 'queued'
           else state
         end,
         validation_outcome = case
           when state = 'running' and ? = 'infra_error' and attempts >= ?
             then 'failed'
           else validation_outcome
         end,
         validated_at = case
           when state = 'running' and ? = 'infra_error' and attempts >= ?
             then ? else validated_at end,
         attempts = case
           when state = 'running' and ? = 'planned_update' and attempts > 0
             then attempts - 1 else attempts end,
         error_code = case
           when ? = 'planned_update' then null
           when state = 'running' and attempts >= ? then 'infra_exhausted'
           else 'infra_retry'
         end,
         error_detail = case when ? = 'planned_update' then null else ? end,
         failed_at = case
           when state = 'running' and ? = 'infra_error' and attempts >= ?
             then ? else failed_at end,
         ${clearClaim}, updated_at = ?
     where ${liveFence}
     returning *`,
  ).bind(
    input.reason,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    input.reason,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    input.reason,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    input.authenticatedAt,
    input.reason,
    input.reason,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    input.reason,
    input.detail?.slice(0, 4_000) ?? "Merge-group infrastructure error",
    input.reason,
    MAX_MERGE_GROUP_INFRA_ATTEMPTS,
    input.authenticatedAt,
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
  ).first<MergeGroupValidationJobRow>();
}

export async function supersedeMergeGroupValidationJob(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workerId: string;
    claimTokenHash: string;
    authenticatedAt: string;
    detail: string;
  },
) {
  return db.prepare(
    `update merge_group_validation_jobs
     set state = 'superseded', error_code = 'queue_head_changed',
         error_detail = ?, superseded_at = ?, ${clearClaim}, updated_at = ?
     where ${liveFence}
     returning *`,
  ).bind(
    input.detail.slice(0, 4_000),
    input.authenticatedAt,
    input.authenticatedAt,
    input.jobId,
    input.projectId,
    input.workerId,
    input.claimTokenHash,
    input.authenticatedAt,
  ).first<MergeGroupValidationJobRow>();
}
