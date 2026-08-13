-- Keep the user-visible work log small and queryable while raw provider
-- transcripts move to compressed immutable R2 segments.

-- This is an intentional cutover: old D1 transcript rows and archive objects
-- are not imported into the new work-log format. Queue old R2 objects for
-- deletion before dropping their metadata and D1 session rows.
insert or ignore into briar_archive_cleanup_queue (
  bucket, object_key, project_id, run_id, queued_at
)
select 'archives', object_key, project_id, run_id, datetime('now')
from briar_log_archives
where archive_kind = 'agent_transcript';

delete from briar_log_archives where archive_kind = 'agent_transcript';
delete from briar_agent_transcript_sessions;

create table briar_agent_worklog_entries (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  entry_id text not null check (
    entry_id = trim(entry_id) and length(entry_id) between 1 and 512
  ),
  sequence integer not null check (sequence > 0),
  updated_sequence integer not null check (updated_sequence >= sequence),
  entry_type text not null check (entry_type in ('message', 'activity')),
  activity_kind text check (
    activity_kind is null
    or activity_kind in ('command', 'fileChange', 'webSearch', 'tool')
  ),
  phase text,
  title text,
  body text not null default '',
  status text not null check (
    status in (
      'writing', 'completed', 'failed', 'cancelled', 'interrupted'
    )
  ),
  started_at text not null,
  updated_at text not null,
  completed_at text,
  primary key (session_id, entry_id)
);

create index briar_agent_worklog_entries_session_sequence_idx
  on briar_agent_worklog_entries (session_id, sequence, entry_id);

create index briar_agent_worklog_entries_session_updated_idx
  on briar_agent_worklog_entries (session_id, updated_sequence, entry_id);

create table briar_agent_transcript_segments (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  first_sequence integer not null check (first_sequence > 0),
  last_sequence integer not null check (last_sequence >= first_sequence),
  object_key text not null unique,
  event_count integer not null check (event_count > 0),
  uncompressed_bytes integer not null check (uncompressed_bytes > 0),
  compressed_bytes integer not null check (compressed_bytes > 0),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  recorded_at text not null,
  primary key (session_id, first_sequence, last_sequence)
);

create index briar_agent_transcript_segments_session_sequence_idx
  on briar_agent_transcript_segments (
    session_id, first_sequence, last_sequence
  );
