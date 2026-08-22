pragma foreign_keys = on;

-- R2 holds immutable, compressed log batches. D1 keeps only the searchable
-- manifest needed to verify, retrieve, expire, and clean up each object.
create table briar_log_archives (
  id text primary key not null check (
    length(id) = 64 and id not glob '*[^0-9a-f]*'
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  scope_id text not null check (
    scope_id = trim(scope_id) and length(scope_id) between 1 and 128
  ),
  archive_kind text not null check (archive_kind in (
    'run_events', 'run_evidence', 'execution_audit',
    'agent_transcript', 'issue_messages', 'project_agent_sessions'
  )),
  object_key text not null unique check (
    object_key = trim(object_key) and length(object_key) between 1 and 1024
  ),
  format_version integer not null check (format_version = 1),
  status text not null check (status in ('failed', 'verified', 'complete')),
  row_count integer not null check (row_count > 0),
  byte_size integer not null check (byte_size >= 0),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  content_sha256 text not null check (
    length(content_sha256) = 64 and content_sha256 not glob '*[^0-9a-f]*'
  ),
  period_start text not null,
  period_end text not null,
  created_at text not null,
  verified_at text,
  completed_at text,
  expires_at text not null,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text,
  related_object_keys_json text not null default '[]' check (
    json_valid(related_object_keys_json)
    and json_type(related_object_keys_json) = 'array'
  )
);

create index briar_log_archives_project_kind_idx
  on briar_log_archives (project_id, archive_kind, period_end, id);

create index briar_log_archives_run_kind_idx
  on briar_log_archives (run_id, archive_kind, period_end, id)
  where run_id is not null;

create index briar_log_archives_status_idx
  on briar_log_archives (status, created_at, id);

create index briar_log_archives_expiry_idx
  on briar_log_archives (expires_at, id)
  where status = 'complete';

-- Object deletion is intentionally decoupled from foreign keys. A run/project
-- can disappear from D1 while cleanup remains retryable until R2 confirms it.
create table briar_archive_cleanup_queue (
  bucket text not null check (bucket in ('archives', 'attachments')),
  object_key text not null check (
    object_key = trim(object_key) and length(object_key) between 1 and 1024
  ),
  project_id text not null,
  run_id text,
  queued_at text not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at text,
  last_error text,
  primary key (bucket, object_key)
);

create index briar_archive_cleanup_queue_age_idx
  on briar_archive_cleanup_queue (queued_at, bucket, object_key);
