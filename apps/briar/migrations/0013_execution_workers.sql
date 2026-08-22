create table briar_execution_workers (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 100),
  -- Opaque per-machine identity supplied by the worker. No hostname, no path:
  -- repository locations stay in each machine's own Briar config.
  host_fingerprint text not null check (
    length(host_fingerprint) = 64
    and host_fingerprint not glob '*[^0-9a-f]*'
  ),
  agent_provider text not null check (agent_provider in ('codex', 'claude')),
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

create index briar_execution_workers_project_idx
  on briar_execution_workers (project_id, last_heartbeat_at desc);

-- Attribute a run to the machine that claimed it so a stuck host is visible in
-- the dashboard without reading remote logs.
alter table briar_hunt_runs add column worker_id text
  references briar_execution_workers (id) on delete set null;

create index briar_hunt_runs_worker_idx
  on briar_hunt_runs (worker_id, last_event_at desc);

-- Session summary, kept separate so retention can prune whole sessions without
-- scanning the event table.
create table briar_agent_transcript_sessions (
  session_id text primary key not null check (
    session_id = trim(session_id)
    and length(session_id) between 1 and 128
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_provider text not null check (agent_provider in ('codex', 'claude')),
  started_at text not null,
  last_event_at text not null,
  event_count integer not null default 0 check (event_count >= 0),
  byte_count integer not null default 0 check (byte_count >= 0)
);

create index briar_agent_transcript_sessions_project_idx
  on briar_agent_transcript_sessions (project_id, last_event_at desc);

-- Server-side counterpart of the desktop's local JSONL transcript.
create table briar_agent_transcripts (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  sequence integer not null check (sequence > 0),
  direction text not null check (direction in ('client', 'server')),
  payload_json text not null check (
    json_valid(payload_json)
    and length(payload_json) <= 32768
  ),
  recorded_at text not null,
  primary key (session_id, sequence)
);
