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

-- A current run revision becomes queue-ready only after the API has re-read
-- its immutable PR identity/head/base and published the fixed admission
-- contexts with the Briar App. These columns are deliberately attached to the
-- existing immutable run/attempt/revision PR link instead of creating a second
-- shadow PR queue.
alter table briar_run_pull_requests
  add column merge_queue_admission_state text not null default 'none'
  check (merge_queue_admission_state in (
    'none', 'pending', 'publishing', 'ready', 'failed'
  ));
alter table briar_run_pull_requests
  add column merge_queue_admission_attempts integer not null default 0
  check (merge_queue_admission_attempts >= 0);
alter table briar_run_pull_requests
  add column merge_queue_admission_contexts_json text not null default '[]'
  check (
    json_valid(merge_queue_admission_contexts_json)
    and json_type(merge_queue_admission_contexts_json) = 'array'
  );
alter table briar_run_pull_requests
  add column merge_queue_admission_receipts_json text not null default '[]'
  check (
    json_valid(merge_queue_admission_receipts_json)
    and json_type(merge_queue_admission_receipts_json) = 'array'
  );
alter table briar_run_pull_requests add column merge_queue_admission_next_at text;
alter table briar_run_pull_requests add column merge_queue_ready_at text;
alter table briar_run_pull_requests add column merge_queue_generation_id text;
alter table briar_run_pull_requests add column merge_queue_entry_id text;
alter table briar_run_pull_requests add column merge_queue_enqueued_at text;
alter table briar_run_pull_requests add column merge_queue_error_code text;
alter table briar_run_pull_requests add column merge_queue_error_detail text;

create table merge_queue_generations (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  installation_id integer not null check (installation_id > 0),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_ref text not null check (base_ref = 'refs/heads/main'),
  owner_worker_id text not null,
  state text not null check (state in (
    'collecting', 'sealing', 'enqueuing', 'awaiting_tail', 'validating',
    'published', 'failed', 'superseded'
  )),
  expected_members_json text not null default '[]' check (
    json_valid(expected_members_json)
    and json_type(expected_members_json) = 'array'
  ),
  enqueue_cursor integer not null default 0 check (enqueue_cursor >= 0),
  collection_started_at text not null,
  collection_deadline_at text not null,
  sealed_at text,
  enqueued_at text,
  matched_head_ref text,
  matched_head_sha text check (
    matched_head_sha is null or (
      length(matched_head_sha) = 40
      and matched_head_sha not glob '*[^0-9a-f]*'
    )
  ),
  validation_job_id text,
  error_code text,
  error_detail text,
  created_at text not null,
  updated_at text not null
);

-- SQLite partial uniqueness is the repository/base lane mutex. It prevents
-- concurrent ready registrations or scheduled coordinator passes from
-- creating two active generations or assigning two owners.
create unique index merge_queue_generations_active_lane_idx
  on merge_queue_generations (repository_id, base_ref)
  where state in (
    'collecting', 'sealing', 'enqueuing', 'awaiting_tail', 'validating'
  );
create index merge_queue_generations_due_idx
  on merge_queue_generations (state, collection_deadline_at, updated_at, id);
create index briar_run_pull_requests_merge_queue_ready_idx
  on briar_run_pull_requests (
    repository_id, merge_queue_admission_state, merge_queue_generation_id,
    merge_queue_ready_at, run_id
  );

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
  generation_id text references merge_queue_generations (id) on delete set null,
  delivery_id text not null check (
    length(trim(delivery_id)) between 1 and 128
  ),
  tail_pull_request_number integer check (
    tail_pull_request_number is null or tail_pull_request_number > 0
  ),
  tail_position integer check (tail_position is null or tail_position >= 0),
  authority_checked_at text,
  authority_attempts integer not null default 0 check (authority_attempts >= 0),
  next_authority_at text,
  eligible_worker_id text not null,
  state text not null default 'authority_pending' check (state in (
    'authority_pending', 'authority_retry', 'queued', 'running', 'validated',
    'published', 'failed', 'superseded'
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
  validation_artifact_json text not null default '{}' check (
    json_valid(validation_artifact_json)
    and json_type(validation_artifact_json) = 'object'
  ),
  validation_log text,
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
create index merge_group_validation_jobs_authority_idx
  on merge_group_validation_jobs (
    state, next_authority_at, repository_id, base_ref, created_at, id
  );
