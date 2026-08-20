export const MAX_MERGE_GROUP_INFRA_ATTEMPTS = 3;

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
  state: MergeGroupValidationState;
  claimed_worker_id: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
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

export async function mergeGroupValidationProject(
  db: D1Database,
  input: {
    installationId: number;
    repositoryId: number;
    repository: string;
  },
) {
  return db.prepare(
    `select project.id
     from briar_github_connections connection
     join briar_github_connection_repositories repository
       on repository.installation_id = connection.installation_id
      and repository.repository_id = ?
      and lower(repository.full_name) = ?
     join briar_projects project
       on project.organization_id = connection.organization_id
     join briar_project_settings settings on settings.project_id = project.id
     where connection.installation_id = ? and connection.status = 'connected'
       and lower(settings.github_repository) = ?
     order by project.id
     limit 1`,
  ).bind(
    input.repositoryId,
    input.repository.toLowerCase(),
    input.installationId,
    input.repository.toLowerCase(),
  ).first<{ id: string }>();
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
    queuedAt: string;
  },
) {
  const id = crypto.randomUUID();
  await db.prepare(
    `insert into merge_group_validation_jobs (
       id, project_id, installation_id, repository_id, repository,
       base_ref, head_ref, head_sha, base_sha, state, queued_at,
       created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
     on conflict(repository_id, base_ref, head_sha) do nothing`,
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
    input.queuedAt,
    input.queuedAt,
    input.queuedAt,
  ).run();
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
    input.claimedAt,
    input.claimedAt,
    projectId,
    input.claimedAt,
  ).run();

  return db.prepare(
    `update merge_group_validation_jobs
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
         and (
           state = 'queued'
           or (state in ('validated', 'failed') and validated_at is not null
               and published_at is null)
         )
         and claimed_worker_id is null and claim_token_hash is null
       order by case when validated_at is not null then 0 else 1 end,
                queued_at, id
       limit 1
     )
       and claimed_worker_id is null and claim_token_hash is null
     returning *`,
  ).bind(
    input.workerId,
    input.claimTokenHash,
    input.claimedAt,
    input.leaseExpiresAt,
    input.claimedAt,
    input.claimedAt,
    projectId,
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
     set state = ?, validated_at = ?,
         error_code = ?, error_detail = ?, failed_at = ?, updated_at = ?
     where ${liveFence} and state = 'running' and head_sha = ?
     returning *`,
  ).bind(
    input.passed ? "validated" : "failed",
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
     set lease_expires_at = ?, updated_at = ?
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
