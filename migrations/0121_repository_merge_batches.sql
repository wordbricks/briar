-- Repository delivery is serialized by GitHub's native merge queue. Briar's
-- lease only prevents two coordinators from operating the same frozen cohort;
-- it is never represented as the authoritative lock on the protected branch.
alter table briar_github_pull_requests add column base_branch text;
alter table briar_run_pull_requests add column base_branch text;

create table briar_repository_merge_policies (
  project_id text not null references briar_projects (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (
    base_branch = trim(base_branch) and length(base_branch) between 1 and 255
  ),
  enabled integer not null default 0 check (enabled in (0, 1)),
  quiet_window_ms integer not null default 30000 check (
    quiet_window_ms between 1000 and 300000
  ),
  validation_command text not null default 'bun run ci:local' check (
    validation_command = trim(validation_command)
    and length(validation_command) between 1 and 500
  ),
  status_contexts_json text not null default
    '["signoff/app-worker","signoff/d1-migrations","signoff/rust","signoff/security"]'
    check (
      json_valid(status_contexts_json)
      and json_type(status_contexts_json) = 'array'
    ),
  created_at text not null,
  updated_at text not null,
  primary key (project_id, repository_id, base_branch)
);

create table briar_merge_batches (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (
    base_branch = trim(base_branch) and length(base_branch) between 1 and 255
  ),
  state text not null check (state in (
    'collecting', 'frozen', 'enqueueing', 'validating', 'awaiting_merge',
    'completed', 'failed', 'blocked'
  )),
  quiet_until text not null,
  frozen_at text,
  merge_group_ref text,
  merge_group_sha text check (
    merge_group_sha is null or (
      length(merge_group_sha) between 7 and 64
      and merge_group_sha not glob '*[^0-9a-f]*'
    )
  ),
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64
      and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  claimed_worker_id text references briar_execution_workers (id) on delete set null,
  claimed_by text,
  claimed_at text,
  lease_expires_at text,
  claim_attempts integer not null default 0 check (claim_attempts >= 0),
  failure_code text,
  failure_detail text,
  completed_at text,
  created_at text not null,
  updated_at text not null,
  check (
    (claim_token_hash is null and claimed_worker_id is null
      and claimed_by is null and claimed_at is null and lease_expires_at is null)
    or
    (claim_token_hash is not null and claimed_worker_id is not null
      and claimed_by is not null and claimed_at is not null and lease_expires_at is not null)
  ),
  check (
    (state = 'collecting' and frozen_at is null)
    or (state <> 'collecting' and frozen_at is not null)
  )
);

-- SQLite partial uniqueness is the durable single-coordinator invariant.
create unique index briar_merge_batches_active_repository_idx
  on briar_merge_batches (project_id, repository_id, base_branch)
  where state in (
    'collecting', 'frozen', 'enqueueing', 'validating', 'awaiting_merge'
  );
create index briar_merge_batches_claim_idx
  on briar_merge_batches (project_id, state, quiet_until, lease_expires_at);

create table briar_merge_batch_candidates (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  batch_id text references briar_merge_batches (id) on delete set null,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (
    base_branch = trim(base_branch) and length(base_branch) between 1 and 255
  ),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  pull_request_number integer not null check (pull_request_number > 0),
  pull_request_url text not null check (
    pull_request_url = trim(pull_request_url)
    and pull_request_url like 'https://%'
  ),
  frozen_head_sha text not null check (
    length(frozen_head_sha) between 7 and 64
    and frozen_head_sha not glob '*[^0-9a-f]*'
  ),
  priority integer check (priority between 1 and 4),
  ready_at text not null,
  state text not null default 'ready' check (state in (
    'ready', 'frozen', 'enqueued', 'merged', 'dequeued', 'failed'
  )),
  queue_entry_id text,
  enqueued_at text,
  merged_at text,
  failure_code text,
  failure_detail text,
  created_at text not null,
  updated_at text not null,
  unique (run_id, attempt, revision),
  unique (batch_id, repository_id, pull_request_number)
);

create index briar_merge_batch_candidates_ready_idx
  on briar_merge_batch_candidates (
    project_id, repository_id, base_branch, batch_id, state,
    priority, ready_at, run_id
  );
create index briar_merge_batch_candidates_pr_idx
  on briar_merge_batch_candidates (
    repository_id, pull_request_number, attempt, revision
  );
