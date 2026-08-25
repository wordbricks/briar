-- Keep transcript session totals in sync with segment mutations without
-- rescanning every segment after each ingest. The one-time recalculation
-- repairs any existing drift before the incremental triggers take over.
update briar_agent_transcript_sessions
set event_count = coalesce((
      select sum(segment.event_count)
      from briar_agent_transcript_segments segment
      where segment.session_id = briar_agent_transcript_sessions.session_id
    ), 0),
    byte_count = coalesce((
      select sum(segment.uncompressed_bytes)
      from briar_agent_transcript_segments segment
      where segment.session_id = briar_agent_transcript_sessions.session_id
    ), 0);

create trigger briar_agent_transcript_segments_totals_after_insert
after insert on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count,
      byte_count = byte_count + new.uncompressed_bytes
  where session_id = new.session_id;
end;

create trigger briar_agent_transcript_segments_totals_after_delete
after delete on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count - old.event_count,
      byte_count = byte_count - old.uncompressed_bytes
  where session_id = old.session_id;
end;

create trigger briar_agent_transcript_segments_totals_after_update
after update of session_id, event_count, uncompressed_bytes
on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count - old.event_count,
      byte_count = byte_count + new.uncompressed_bytes - old.uncompressed_bytes
  where session_id = new.session_id
    and old.session_id = new.session_id;

  update briar_agent_transcript_sessions
  set event_count = event_count - old.event_count,
      byte_count = byte_count - old.uncompressed_bytes
  where session_id = old.session_id
    and old.session_id <> new.session_id;

  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count,
      byte_count = byte_count + new.uncompressed_bytes
  where session_id = new.session_id
    and old.session_id <> new.session_id;
end;
