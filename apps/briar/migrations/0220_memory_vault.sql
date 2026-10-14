-- Memory vault on Cloudflare Artifacts (docs/plans/memory-vault-spec.md §12).
--
-- New tables only: no table rebuild, no backfill, no existing row touched.
-- Rows written by this migration: the 22 lookup rows below (3 scope kinds,
-- 2 vault states, 17 record types).
--
-- Scope kinds, vault states and record types are lookup tables referenced by
-- foreign keys, never CHECK lists, so adding a value later is one insert.
--
-- Markdown and its history live only in the Artifacts repo. Everything here is
-- either derived from the repo (records, revisions, requests: rebuilt from
-- commit trailers and frontmatter) or control data the repo never held
-- (ownership, protection, purge bookkeeping, claim reads).

create table briar_memory_vault_scope_kinds (
  scope_kind text primary key not null
    check (scope_kind = lower(trim(scope_kind)) and length(scope_kind) between 1 and 32)
) strict;

insert into briar_memory_vault_scope_kinds (scope_kind) values ('dm');

insert into briar_memory_vault_scope_kinds (scope_kind) values ('group');

insert into briar_memory_vault_scope_kinds (scope_kind) values ('project');

create table briar_memory_vault_states (
  state text primary key not null
    check (state = lower(trim(state)) and length(state) between 1 and 32)
) strict;

insert into briar_memory_vault_states (state) values ('active');

insert into briar_memory_vault_states (state) values ('purging');

-- path_template mirrors RECORD_TYPES in worker/src/memory-vault/records.ts;
-- memory-vault-records.test.ts fails when the two drift.
create table briar_memory_record_types (
  record_type text primary key not null
    check (record_type = lower(trim(record_type)) and length(record_type) between 1 and 32),
  path_template text not null unique
    check (length(path_template) between 4 and 100 and path_template glob '*.md')
) strict;

insert into briar_memory_record_types (record_type, path_template)
values ('person', 'entities/people/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('org', 'entities/orgs/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('tool', 'entities/tools/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('project', 'entities/projects/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('infrastructure', 'entities/infrastructure/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('comms', 'comms/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('workstream', 'workstreams/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('fact', 'knowledge/facts/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('procedure', 'knowledge/procedures/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('preference', 'knowledge/preferences/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('decision', 'knowledge/decisions/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('lesson', 'knowledge/lessons/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('playbook', 'playbook.md');

insert into briar_memory_record_types (record_type, path_template)
values ('timeline-weekly', 'timeline/weekly/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('timeline-monthly', 'timeline/monthly/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('browser-guidance', 'browser-guidance/attempts/{id}.md');

insert into briar_memory_record_types (record_type, path_template)
values ('timeline-daily', 'timeline/daily/{id}.md');

-- One Artifacts repo per vault: `mv-<id without dashes>-g<generation>`.
-- owner_user_id is a copy of the DM space owner and deliberately has no foreign
-- key of its own: erasing the user already reaches this row through the space,
-- and `delete "user"` sits on D1's trigger-depth limit (cascade-trigger-depth).
create table briar_memory_vaults (
  id text primary key not null check (length(id) = 36),
  organization_id text not null references briar_organizations (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  scope_kind text not null references briar_memory_vault_scope_kinds (scope_kind),
  scope_key text not null check (length(scope_key) between 1 and 200),
  owner_user_id text check (owner_user_id is null or length(owner_user_id) between 1 and 200),
  dm_space_id text references briar_dm_memory_spaces (id) on delete cascade,
  repo_name text not null unique check (length(repo_name) between 1 and 100),
  generation integer not null default 1 check (generation >= 1),
  head_commit text check (
    head_commit is null
    or (length(head_commit) = 40 and head_commit not glob '*[^0-9a-f]*')
  ),
  synced_at text,
  state text not null default 'active' references briar_memory_vault_states (state),
  created_at text not null,
  updated_at text not null,
  unique (organization_id, agent_id, scope_kind, scope_key),
  check ((dm_space_id is null) = (owner_user_id is null)),
  check (dm_space_id is null or scope_key = dm_space_id)
) strict;

create index briar_memory_vaults_dm_space on briar_memory_vaults (dm_space_id)
where dm_space_id is not null;

create table briar_memory_vault_records (
  vault_id text not null references briar_memory_vaults (id) on delete cascade,
  record_id text not null check (length(record_id) between 1 and 63),
  record_type text not null references briar_memory_record_types (record_type),
  path text not null check (length(path) between 4 and 200 and path glob '*.md'),
  status text check (status is null or length(status) between 1 and 32),
  aliases_json text not null default '[]'
    check (json_valid(aliases_json) and json_type(aliases_json) = 'array'),
  revision integer not null check (revision >= 1),
  commit_sha text not null check (length(commit_sha) = 40),
  protected_by_user integer not null default 0 check (protected_by_user in (0, 1)),
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  primary key (vault_id, record_id)
) strict;

create unique index briar_memory_vault_records_live_path
on briar_memory_vault_records (vault_id, path)
where deleted_at is null;

create index briar_memory_vault_records_recent
on briar_memory_vault_records (vault_id, updated_at desc, record_id)
where deleted_at is null;

create table briar_memory_vault_revisions (
  vault_id text not null references briar_memory_vaults (id) on delete cascade,
  record_id text not null check (length(record_id) between 1 and 63),
  revision integer not null check (revision >= 1),
  commit_sha text not null check (length(commit_sha) = 40),
  path text not null check (length(path) between 4 and 200),
  actor text not null check (length(actor) between 1 and 200),
  created_at text not null,
  primary key (vault_id, record_id, revision)
) strict;

create index briar_memory_vault_revisions_commit
on briar_memory_vault_revisions (vault_id, commit_sha);

-- Idempotency for `journal` and `save`: one row per (vault, CLI request id).
create table briar_memory_vault_requests (
  vault_id text not null references briar_memory_vaults (id) on delete cascade,
  request_id text not null check (length(request_id) between 1 and 200),
  payload_hash text not null
    check (length(payload_hash) = 64 and payload_hash not glob '*[^0-9a-f]*'),
  commit_sha text check (commit_sha is null or length(commit_sha) = 40),
  result_json text not null check (json_valid(result_json)),
  created_at text not null,
  primary key (vault_id, request_id)
) strict;

-- Records a claim has read, for completion-time citation validation (§8).
create table briar_memory_vault_claim_reads (
  claim_token_hash text not null
    check (length(claim_token_hash) = 64 and claim_token_hash not glob '*[^0-9a-f]*'),
  vault_id text not null references briar_memory_vaults (id) on delete cascade,
  record_id text not null check (length(record_id) between 1 and 63),
  revision integer not null check (revision >= 1),
  work_id text not null check (length(work_id) between 1 and 200),
  read_at text not null,
  primary key (claim_token_hash, vault_id, record_id, revision)
) strict;

create index briar_memory_vault_claim_reads_age
on briar_memory_vault_claim_reads (read_at);

-- Forget purge jobs (§10). One per source generation; a second forget before
-- the job starts merges its paths into the same row.
create table briar_memory_vault_purges (
  vault_id text not null references briar_memory_vaults (id) on delete cascade,
  source_generation integer not null check (source_generation >= 1),
  paths_json text not null
    check (json_valid(paths_json) and json_type(paths_json) = 'array'),
  requested_at text not null,
  started_at text,
  lease_token text check (lease_token is null or length(lease_token) = 36),
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or length(last_error) <= 2000),
  switched_at text,
  completed_at text,
  updated_at text not null,
  primary key (vault_id, source_generation)
) strict;

create index briar_memory_vault_purges_open
on briar_memory_vault_purges (lease_expires_at)
where completed_at is null;

-- Legacy D1 memory → vault migration ledger (§11).
create table briar_memory_vault_legacy_map (
  vault_id text not null references briar_memory_vaults (id) on delete cascade,
  document_id text not null check (length(document_id) between 1 and 200),
  document_version integer not null check (document_version >= 1),
  record_id text not null check (length(record_id) between 1 and 63),
  revision integer not null check (revision >= 1),
  commit_sha text not null check (length(commit_sha) = 40),
  body_hash text not null
    check (length(body_hash) = 64 and body_hash not glob '*[^0-9a-f]*'),
  created_at text not null,
  primary key (vault_id, document_id, document_version)
) strict;

create index briar_memory_vault_legacy_map_record
on briar_memory_vault_legacy_map (vault_id, record_id);
