create table briar_log_archives (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  object_key text not null unique,
  format_version integer not null check (format_version = 1),
  content_encoding text not null check (content_encoding = 'gzip'),
  row_count integer not null check (row_count > 0),
  byte_count integer not null check (byte_count > 0),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  period_start text not null,
  period_end text not null,
  created_at text not null,
  verified_at text not null,
  check (period_start <= period_end)
);

create index briar_log_archives_run_idx
  on briar_log_archives (project_id, run_id, period_start, id);
create index briar_log_archives_retention_idx
  on briar_log_archives (period_end, id);

-- event_count is the durable timeline total. Archival removes hot rows but must
-- not make the issue summary claim that historical events never happened.
drop trigger briar_hunt_events_decrement_run_event_count;
