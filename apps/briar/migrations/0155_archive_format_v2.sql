-- Archive format v2 is a wire/storage cutover, not a metadata backfill. A v1
-- manifest cannot describe v2 bytes, so retire every v1 object through the
-- retryable R2 cleanup queue before replacing the authoritative metadata.
pragma foreign_keys = off;

insert into briar_archive_cleanup_queue (
  bucket, object_key, project_id, run_id, queued_at
)
select 'archives', archive.object_key, archive.project_id, archive.run_id,
       datetime('now')
from briar_log_archives archive
where archive.format_version = 1
on conflict (bucket, object_key) do update set
  project_id = excluded.project_id,
  run_id = excluded.run_id,
  queued_at = excluded.queued_at,
  attempts = 0,
  last_attempt_at = null,
  last_error = null,
  generation = briar_archive_cleanup_queue.generation + 1,
  next_attempt_at = null,
  dead_lettered_at = null,
  alert_state = 'none',
  alert_detail_json = null;

insert into briar_archive_cleanup_queue (
  bucket, object_key, project_id, run_id, queued_at
)
select 'attachments', related.value, archive.project_id, archive.run_id,
       datetime('now')
from briar_log_archives archive
join json_each(archive.related_object_keys_json) related
  on related.type = 'text'
where archive.format_version = 1
  and related.value = trim(related.value)
  and length(related.value) between 1 and 1024
on conflict (bucket, object_key) do update set
  project_id = excluded.project_id,
  run_id = excluded.run_id,
  queued_at = excluded.queued_at,
  attempts = 0,
  last_attempt_at = null,
  last_error = null,
  generation = briar_archive_cleanup_queue.generation + 1,
  next_attempt_at = null,
  dead_lettered_at = null,
  alert_state = 'none',
  alert_detail_json = null;

-- Archive quarantine rows have no meaning once their v1 manifest is gone.
delete from briar_channel_issue_transfer_quarantine
where entity_kind = 'agent_transcript_archive';

drop table briar_log_archives;

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
  format_version integer not null check (format_version = 2),
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

create index briar_log_archives_project_sessions_idx
  on briar_log_archives (project_id, scope_id, period_end, id)
  where archive_kind = 'project_agent_sessions'
    and status in ('verified', 'complete');

create trigger briar_quarantined_transcript_archive_project_guard
before update of project_id on briar_log_archives
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_archive'
      and quarantine.entity_id = old.id
  )
begin
  select raise(abort, 'quarantined transcript ownership is immutable');
end;

create trigger briar_mismatched_transcript_archive_quarantine
after insert on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
begin
  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_archive', new.id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_session', new.scope_id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  update briar_log_archives
  set status = 'failed',
      failure_count = failure_count + 1,
      last_error = 'Transcript archive ownership requires remediation'
  where id = new.id and status in ('verified', 'complete');
end;

create trigger briar_mismatched_transcript_archive_verify_guard
before update of status on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.status in ('verified', 'complete')
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
begin
  select raise(abort, 'transcript archive ownership requires remediation');
end;

create trigger briar_mismatched_run_archive_insert_guard
before insert on briar_log_archives
when new.archive_kind not in ('execution_audit', 'agent_transcript')
  and new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
begin
  select raise(abort, 'run archive project does not match current run');
end;

pragma foreign_keys = on;

-- Related object keys are cleanup identities. The v2 cutover above retires
-- every pre-contract archive, so only future writes need to be guarded.
create trigger briar_archive_related_object_keys_insert_guard
before insert on briar_log_archives
when exists (
  select 1 from json_each(new.related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
)
begin
  select raise(abort, 'invalid archive related object key');
end;

create trigger briar_archive_related_object_keys_update_guard
before update of related_object_keys_json on briar_log_archives
when exists (
  select 1 from json_each(new.related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
)
begin
  select raise(abort, 'invalid archive related object key');
end;
