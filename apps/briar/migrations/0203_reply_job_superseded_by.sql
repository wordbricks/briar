pragma foreign_keys = on;

-- A person typing three short direct messages in a row used to get three
-- separate replies, because every DM root message enqueued its own reply job
-- and its own reply session. Reply sessions are now anchored per (DM, Agent),
-- so those three jobs land in one session, and the newest job absorbs the older
-- conversation turns that are still queued instead of answering them again.
--
-- "Absorbed" is not a new status: `status` is constrained to
-- ('queued','running','completed','failed'), the client status enum and the
-- shared protobuf enum carry exactly those four, and a `failed` reply raises a
-- toast in the web client. An absorbed turn is therefore recorded as
-- `completed` with no message of its own, plus this column naming the job that
-- answered on its behalf.
--
-- The column is deliberately a plain text column with no foreign key. Reply
-- jobs already sit at the bottom of several cascading delete chains, and D1
-- refuses a statement whose trigger/cascade walk exceeds depth 10 (see
-- 0184_cascade_trigger_depth.sql and 0187_cascade_trigger_depth_part4.sql).
-- Adding another self-referential cascade to this table would push channel and
-- organization deletion past that limit. A dangling id here is harmless: the
-- claim route reads it only to collect the trigger messages a live job still
-- has to answer.
alter table briar_channel_agent_reply_jobs
  add column superseded_by_reply_job_id text;

-- The claim route resolves "which messages has this job not answered yet" by
-- walking back from the surviving job to the turns it absorbed.
create index briar_channel_agent_reply_jobs_superseded_by_idx
  on briar_channel_agent_reply_jobs (superseded_by_reply_job_id);

-- Anchoring a DM session to the Agent's live session means the enqueue path
-- looks up "the newest live session for this channel and Agent" on every DM
-- root message.
create index briar_channel_reply_sessions_channel_agent_activity_idx
  on briar_channel_reply_sessions (channel_id, agent_id, last_activity_at desc);
