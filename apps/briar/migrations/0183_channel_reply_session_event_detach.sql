-- Let the reply-job foreign key detach itself from an immutable session event.
--
-- briar_channel_reply_session_events.reply_job_id is declared
-- `references briar_channel_agent_reply_jobs (id) on delete set null`, but
-- migration 0133 also guards the table with an unconditional
-- `before update ... raise(abort)`. Deleting a reply job therefore aborts
-- whenever one of its events is still present: the SET NULL action is an
-- UPDATE, and the guard rejects every UPDATE.
--
-- Until now that never fired, purely by accident. Deleting a channel cascades
-- into both briar_channel_reply_sessions and briar_channel_agent_reply_jobs,
-- and SQLite runs a parent's foreign key actions in reverse sqlite_schema
-- order, which happened to delete the sessions (and with them, by cascade, the
-- events) before the jobs. Any migration that rebuilds one of those two tables
-- flips that order and the delete starts failing with
-- "Channel reply session events are immutable".
--
-- The guard is meant to keep the audit rows append-only, so it now permits
-- exactly the transition the foreign key performs -- reply_job_id going from a
-- value to NULL with every other column untouched -- and keeps rejecting
-- everything else.

drop trigger if exists briar_channel_reply_session_events_immutable_update;

create trigger briar_channel_reply_session_events_immutable_update
before update on briar_channel_reply_session_events
when not (
  old.reply_job_id is not null
  and new.reply_job_id is null
  and new.id is old.id
  and new.session_id is old.session_id
  and new.event_type is old.event_type
  and new.reason is old.reason
  and new.from_worker_id is old.from_worker_id
  and new.to_worker_id is old.to_worker_id
  and new.retained_until is old.retained_until
  and new.detail_json is old.detail_json
  and new.occurred_at is old.occurred_at
)
begin
  select raise(abort, 'Channel reply session events are immutable');
end;
