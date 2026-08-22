-- GitHub webhook deliveries are an inbox. GitHub redeliveries reuse the same
-- X-GitHub-Delivery value, so completed work must remain idempotent while a
-- failed processing claim can be released and retried.
alter table briar_run_evidence
  add column github_association_started_at text;

create table briar_github_deliveries (
  delivery_id text primary key not null check (
    delivery_id = trim(delivery_id)
    and length(delivery_id) between 1 and 128
  ),
  event_name text not null check (
    event_name = trim(event_name)
    and length(event_name) between 1 and 64
  ),
  action text check (
    action is null or (
      action = trim(action)
      and length(action) between 1 and 100
    )
  ),
  status text not null check (status in ('processing', 'completed')),
  claimed_at text not null,
  completed_at text,
  check (
    (status = 'processing' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create index briar_github_deliveries_status_idx
  on briar_github_deliveries (status, claimed_at);

-- Provider snapshots retain signed state, including the Briar issue links that
-- were present in the PR body when GitHub produced the delivery. A run link may
-- consume a snapshot only when its independently recorded immutable identity
-- and exact project/run association both match the signed payload.
create table briar_github_pull_requests (
  repository_id integer not null check (repository_id > 0),
  pull_request_number integer not null check (pull_request_number > 0),
  installation_id integer check (installation_id is null or installation_id > 0),
  repository text not null check (
    repository = lower(trim(repository))
    and length(repository) between 3 and 300
  ),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  url text not null check (
    url = trim(url)
    and length(url) between 1 and 1000
    and url like 'https://%'
  ),
  state text not null check (state in ('open', 'closed', 'merged')),
  draft integer not null check (draft in (0, 1)),
  head_sha text not null check (
    length(head_sha) between 7 and 64
    and head_sha not glob '*[^0-9a-f]*'
  ),
  base_sha text not null check (
    length(base_sha) between 7 and 64
    and base_sha not glob '*[^0-9a-f]*'
  ),
  merge_commit_sha text check (
    merge_commit_sha is null or (
      length(merge_commit_sha) between 7 and 64
      and merge_commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  opened_at text not null,
  closed_at text,
  merged_at text,
  provider_updated_at text not null,
  last_delivery_id text not null,
  briar_issue_links_json text not null check (
    json_valid(briar_issue_links_json)
    and json_type(briar_issue_links_json) = 'array'
    and length(briar_issue_links_json) <= 4000
  ),
  created_at text not null,
  updated_at text not null,
  primary key (repository_id, pull_request_number)
);

create index briar_github_pull_requests_repository_idx
  on briar_github_pull_requests (repository, pull_request_number);

create index briar_github_pull_requests_url_idx
  on briar_github_pull_requests (url);

-- A run may replace its PR during rework or intentionally use more than one
-- PR. Keep the attempt/revision identity so a merge from stale work cannot
-- approve the current checkpoint.
create table briar_run_pull_requests (
  project_id text not null
    references briar_projects (id) on delete cascade,
  run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  revision_started_at text not null,
  url text not null check (
    url = trim(url)
    and length(url) between 1 and 1000
    and url like 'https://%'
  ),
  installation_id integer check (installation_id is null or installation_id > 0),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository))
    and length(repository) between 3 and 300
  ),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  pull_request_number integer not null check (pull_request_number > 0),
  state text not null default 'unknown'
    check (state in ('unknown', 'open', 'closed', 'merged')),
  draft integer check (draft is null or draft in (0, 1)),
  head_sha text check (
    head_sha is null or (
      length(head_sha) between 7 and 64
      and head_sha not glob '*[^0-9a-f]*'
    )
  ),
  base_sha text check (
    base_sha is null or (
      length(base_sha) between 7 and 64
      and base_sha not glob '*[^0-9a-f]*'
    )
  ),
  merge_commit_sha text check (
    merge_commit_sha is null or (
      length(merge_commit_sha) between 7 and 64
      and merge_commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  opened_at text,
  closed_at text,
  merged_at text,
  provider_updated_at text,
  last_delivery_id text,
  created_at text not null,
  updated_at text not null,
  primary key (
    run_id, attempt, revision, repository_id, pull_request_number
  )
);

create index briar_run_pull_requests_current_idx
  on briar_run_pull_requests (run_id, attempt, revision, state);

create index briar_run_pull_requests_url_idx
  on briar_run_pull_requests (url, run_id, attempt, revision);

-- Existing URL-only evidence is deliberately not backfilled. Immutable
-- repository and PR IDs are required to distinguish a current repository from
-- a deleted repository whose owner/name was later reused.
create index briar_run_pull_requests_identity_idx
  on briar_run_pull_requests (
    repository_id, pull_request_number, run_id, attempt, revision
  );
