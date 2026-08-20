-- Forward-only cleanup for installations that may already have applied 0121.
-- The unsafe policy fields and shadow queue are removed before the replacement
-- exact-SHA executor is introduced.
drop table if exists briar_merge_batch_candidates;
drop table if exists briar_merge_batches;
drop table if exists briar_repository_merge_policies;

alter table briar_project_settings
  add column merge_group_ci_enabled integer not null default 0
  check (merge_group_ci_enabled in (0, 1));
alter table briar_project_settings
  add column merge_group_ci_base_ref text not null default 'refs/heads/main'
  check (merge_group_ci_base_ref = 'refs/heads/main');
alter table briar_project_settings
  add column merge_group_ci_worker_id text
  references briar_execution_workers (id) on delete set null;

create table merge_group_validation_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  installation_id integer not null check (installation_id > 0),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_ref text not null check (base_ref = 'refs/heads/main'),
  head_ref text not null check (
    head_ref like 'refs/heads/gh-readonly-queue/main/pr-%'
    and length(head_ref) between 40 and 500
  ),
  head_sha text not null check (
    length(head_sha) = 40 and head_sha not glob '*[^0-9a-f]*'
  ),
  base_sha text not null check (
    length(base_sha) = 40 and base_sha not glob '*[^0-9a-f]*'
  ),
  tail_pull_request_number integer not null check (tail_pull_request_number > 0),
  tail_position integer not null check (tail_position >= 0),
  authority_checked_at text not null,
  eligible_worker_id text not null
    references briar_execution_workers (id) on delete restrict,
  state text not null default 'queued' check (state in (
    'queued', 'running', 'validated', 'published', 'failed', 'superseded'
  )),
  validation_outcome text check (
    validation_outcome is null or validation_outcome in ('passed', 'failed')
  ),
  claimed_worker_id text
    references briar_execution_workers (id) on delete restrict,
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64 and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  publication_attempts integer not null default 0 check (publication_attempts >= 0),
  published_contexts_json text not null default '[]' check (
    json_valid(published_contexts_json) and json_type(published_contexts_json) = 'array'
  ),
  publication_receipts_json text not null default '[]' check (
    json_valid(publication_receipts_json) and json_type(publication_receipts_json) = 'array'
  ),
  next_publication_at text,
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
      and claimed_at is not null and lease_expires_at is not null
      and claimed_worker_id = eligible_worker_id)
  )
);

create index merge_group_validation_jobs_claim_idx
  on merge_group_validation_jobs (
    project_id, eligible_worker_id, state, next_publication_at,
    lease_expires_at, queued_at, id
  );
create index merge_group_validation_jobs_repository_idx
  on merge_group_validation_jobs (
    repository_id, base_ref, authority_checked_at, state, updated_at
  );
