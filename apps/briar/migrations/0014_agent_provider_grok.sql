-- Expand agent_provider checks to include Grok.
-- SQLite cannot alter CHECK constraints in place, so rebuild affected tables.

pragma foreign_keys = off;

-- issue messages -------------------------------------------------------------
create table briar_issue_messages_new (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  parent_message_id text,
  author_user_id text references "user" (id) on delete set null,
  author_agent_provider text check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude', 'grok')
  ),
  body text not null check (
    body = trim(body)
    and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null,
  check (parent_message_id is null or parent_message_id <> id)
);

insert into briar_issue_messages_new (
  id, project_id, run_id, parent_message_id, author_user_id,
  author_agent_provider, body, created_at, updated_at
)
select
  id, project_id, run_id, parent_message_id, author_user_id,
  author_agent_provider, body, created_at, updated_at
from briar_issue_messages;

drop table briar_issue_messages;
alter table briar_issue_messages_new rename to briar_issue_messages;

create index briar_issue_messages_run_idx
  on briar_issue_messages (run_id, created_at, id);

create index briar_issue_messages_parent_idx
  on briar_issue_messages (parent_message_id, created_at, id);

-- execution workers ----------------------------------------------------------
create table briar_execution_workers_new (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 100),
  host_fingerprint text not null check (
    length(host_fingerprint) = 64
    and host_fingerprint not glob '*[^0-9a-f]*'
  ),
  agent_provider text not null check (agent_provider in ('codex', 'claude', 'grok')),
  versions_json text not null default '{}' check (
    json_valid(versions_json)
    and json_type(versions_json) = 'object'
  ),
  state text not null check (state in ('online', 'stale', 'disabled')),
  last_heartbeat_at text not null,
  created_at text not null,
  updated_at text not null,
  unique (project_id, host_fingerprint)
);

insert into briar_execution_workers_new (
  id, project_id, label, host_fingerprint, agent_provider,
  versions_json, state, last_heartbeat_at, created_at, updated_at
)
select
  id, project_id, label, host_fingerprint, agent_provider,
  versions_json, state, last_heartbeat_at, created_at, updated_at
from briar_execution_workers;

drop table briar_execution_workers;
alter table briar_execution_workers_new rename to briar_execution_workers;

create index briar_execution_workers_project_idx
  on briar_execution_workers (project_id, last_heartbeat_at desc);

-- transcript sessions --------------------------------------------------------
create table briar_agent_transcript_sessions_new (
  session_id text primary key not null check (
    session_id = trim(session_id)
    and length(session_id) between 1 and 128
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_provider text not null check (agent_provider in ('codex', 'claude', 'grok')),
  started_at text not null,
  last_event_at text not null,
  event_count integer not null default 0 check (event_count >= 0),
  byte_count integer not null default 0 check (byte_count >= 0)
);

insert into briar_agent_transcript_sessions_new (
  session_id, project_id, run_id, worker_id, agent_provider,
  started_at, last_event_at, event_count, byte_count
)
select
  session_id, project_id, run_id, worker_id, agent_provider,
  started_at, last_event_at, event_count, byte_count
from briar_agent_transcript_sessions;

drop table briar_agent_transcript_sessions;
alter table briar_agent_transcript_sessions_new rename to briar_agent_transcript_sessions;

pragma foreign_keys = on;
