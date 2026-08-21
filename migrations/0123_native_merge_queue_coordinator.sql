-- Briar keeps issue development parallel and serializes only repository
-- delivery. GitHub's Require merge queue rule is the authoritative main gate;
-- these rows provide one durable Briar coordinator lane per repository/base.
create table briar_merge_queue_profiles (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null default 'main' check (base_branch = 'main'),
  enabled integer not null default 0 check (enabled in (0, 1)),
  quiet_window_ms integer not null default 30000 check (
    quiet_window_ms between 1000 and 300000
  ),
  max_batch_size integer not null default 5 check (
    max_batch_size between 2 and 5
  ),
  created_at text not null,
  updated_at text not null
);

create unique index briar_merge_queue_profiles_enabled_lane_idx
  on briar_merge_queue_profiles (repository_id, base_branch)
  where enabled = 1;

create table briar_merge_batches (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (base_branch = 'main'),
  state text not null check (state in (
    'collecting', 'frozen', 'enqueueing', 'waiting_tail', 'validating',
    'publishing', 'awaiting_merge', 'blocked', 'draining', 'completed', 'failed'
  )),
  quiet_until text not null,
  frozen_at text,
  -- Keep the signed delivery identity after the generic 30-day webhook inbox
  -- is pruned. Only the verified webhook handler may populate this value.
  final_delivery_id text unique,
  merge_group_ref text,
  merge_group_sha text check (
    merge_group_sha is null or (
      length(merge_group_sha) = 40
      and merge_group_sha not glob '*[^0-9a-f]*'
    )
  ),
  merge_group_base_sha text check (
    merge_group_base_sha is null or (
      length(merge_group_base_sha) = 40
      and merge_group_base_sha not glob '*[^0-9a-f]*'
    )
  ),
  validation_results_json text check (
    validation_results_json is null or (
      json_valid(validation_results_json)
      and json_type(validation_results_json) = 'array'
    )
  ),
  validated_at text,
  published_at text,
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64
      and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  claimed_worker_id text,
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
    (validated_at is null and validation_results_json is null)
    or (validated_at is not null and validation_results_json is not null)
  ),
  check (published_at is null or validated_at is not null),
  check (
    (final_delivery_id is null and merge_group_ref is null
      and merge_group_sha is null and merge_group_base_sha is null)
    or
    (final_delivery_id is not null and merge_group_ref is not null
      and merge_group_sha is not null and merge_group_base_sha is not null)
  )
);

create unique index briar_merge_batches_active_lane_idx
  on briar_merge_batches (repository_id, base_branch)
  where state in (
    'collecting', 'frozen', 'enqueueing', 'waiting_tail', 'validating',
    'publishing', 'awaiting_merge', 'blocked', 'draining'
  );

create index briar_merge_batches_claim_idx
  on briar_merge_batches (project_id, state, quiet_until, lease_expires_at);

create table briar_merge_batch_candidates (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  batch_id text references briar_merge_batches (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (base_branch = 'main'),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  pull_request_number integer not null check (pull_request_number > 0),
  pull_request_url text not null check (
    pull_request_url = trim(pull_request_url) and pull_request_url like 'https://%'
  ),
  frozen_head_sha text not null check (
    length(frozen_head_sha) = 40
    and frozen_head_sha not glob '*[^0-9a-f]*'
  ),
  frozen_base_sha text not null check (
    length(frozen_base_sha) = 40
    and frozen_base_sha not glob '*[^0-9a-f]*'
  ),
  priority integer check (priority between 1 and 4),
  ready_at text not null,
  ordinal integer check (ordinal is null or ordinal between 1 and 5),
  state text not null default 'ready' check (state in (
    'ready', 'frozen', 'enqueued', 'merged', 'dequeued', 'failed'
  )),
  queue_entry_id text,
  enqueued_at text,
  -- This is immutable signed authority, not a foreign key into the prunable
  -- generic delivery inbox.
  merged_delivery_id text,
  merged_at text,
  failure_code text,
  failure_detail text,
  created_at text not null,
  updated_at text not null,
  unique (
    run_id, attempt, revision, repository_id, pull_request_number
  ),
  unique (batch_id, ordinal),
  unique (batch_id, repository_id, pull_request_number),
  unique (queue_entry_id)
);

create index briar_merge_batch_candidates_ready_idx
  on briar_merge_batch_candidates (
    repository_id, base_branch, state, batch_id,
    priority, ready_at, run_id, pull_request_number
  );

-- Reconciliation walks a project's durable candidate history, while signed
-- webhooks and shared-PR resume fences begin from immutable GitHub identity.
-- Keep both paths bounded after many completed cohorts accumulate.
create index briar_merge_batch_candidates_project_state_idx
  on briar_merge_batch_candidates (
    project_id, state, batch_id, repository_id, base_branch
  );

create index briar_merge_batch_candidates_pull_request_head_idx
  on briar_merge_batch_candidates (
    repository_id, pull_request_number, frozen_head_sha, state
  );

-- Signed PR identity changes are append-only across the disabled rollout
-- phase. A force-push may return to the same object ID and webhook delivery
-- order is not authoritative, so the canonical mutable PR snapshot alone
-- cannot fence reuse of a ci_qa result completed before that generation.
create table briar_merge_queue_pull_request_observations (
  delivery_id text primary key not null,
  repository_id integer not null check (repository_id > 0),
  pull_request_number integer not null check (pull_request_number > 0),
  action text not null check (
    action = trim(action) and length(action) between 1 and 100
  ),
  identity_changed integer not null check (identity_changed in (0, 1)),
  head_sha text not null check (
    length(head_sha) = 40 and head_sha not glob '*[^0-9a-f]*'
  ),
  base_branch text not null check (
    base_branch = trim(base_branch) and length(base_branch) between 1 and 255
  ),
  received_at text not null
);

create index briar_merge_queue_pull_request_observations_identity_idx
  on briar_merge_queue_pull_request_observations (
    repository_id, pull_request_number, received_at
  );

create table briar_merge_group_heads (
  -- Append-only copy of the signed authority. It deliberately outlives the
  -- generic webhook inbox retention window.
  delivery_id text primary key not null,
  batch_id text references briar_merge_batches (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (base_branch = 'main'),
  head_ref text not null check (
    head_ref = trim(head_ref)
    and head_ref like 'refs/heads/gh-readonly-queue/main/pr-%'
  ),
  head_sha text not null check (
    length(head_sha) = 40 and head_sha not glob '*[^0-9a-f]*'
  ),
  base_sha text not null check (
    length(base_sha) = 40 and base_sha not glob '*[^0-9a-f]*'
  ),
  tail_pull_request_number integer not null check (tail_pull_request_number > 0),
  state text not null check (state in (
    'pending', 'selected', 'superseded', 'orphaned'
  )),
  received_at text not null,
  resolved_at text,
  created_at text not null,
  updated_at text not null
);

create unique index briar_merge_group_heads_selected_batch_idx
  on briar_merge_group_heads (batch_id)
  where state = 'selected';

create index briar_merge_group_heads_pending_idx
  on briar_merge_group_heads (
    repository_id, base_branch, tail_pull_request_number, state, received_at
  );
