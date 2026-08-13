-- Keep the user-visible work log small and queryable while raw provider
-- transcripts move to compressed immutable R2 segments.

alter table briar_agent_transcript_sessions
  add column worklog_projection_version integer not null default 0
  check (worklog_projection_version between 0 and 1);

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
