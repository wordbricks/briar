-- GitHub owns merge-queue membership, ordering, and the synthetic head. Briar
-- stores only execution and publication state for one immutable synthetic SHA.
create table merge_group_validation_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  installation_id integer not null check (installation_id > 0),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_ref text not null check (
    base_ref like 'refs/heads/%' and length(base_ref) between 12 and 300
  ),
  head_ref text not null check (
    head_ref like 'refs/heads/gh-readonly-queue/%'
    and length(head_ref) between 30 and 500
  ),
  head_sha text not null check (
    length(head_sha) = 40 and head_sha not glob '*[^0-9a-f]*'
  ),
  base_sha text not null check (
    length(base_sha) = 40 and base_sha not glob '*[^0-9a-f]*'
  ),
  state text not null default 'queued' check (state in (
    'queued', 'running', 'validated', 'published', 'failed', 'superseded'
  )),
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64 and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  error_detail text,
  queued_at text not null,
  started_at text,
  validated_at text,
  published_at text,
  failed_at text,
  superseded_at text,
  created_at text not null,
  updated_at text not null,
  unique (repository_id, base_ref, head_sha),
  check (
    (claimed_worker_id is null and claim_token_hash is null
      and claimed_at is null and lease_expires_at is null)
    or
    (claimed_worker_id is not null and claim_token_hash is not null
      and claimed_at is not null and lease_expires_at is not null)
  )
);

create index merge_group_validation_jobs_claim_idx
  on merge_group_validation_jobs (
    project_id, state, published_at, lease_expires_at, queued_at, id
  );

create index merge_group_validation_jobs_repository_idx
  on merge_group_validation_jobs (repository_id, base_ref, state, updated_at);
