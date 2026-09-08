-- Nullable metadata only. No row rewrite, table rebuild or historical backfill.
alter table briar_channel_agent_reply_jobs add column routing_action text;
alter table briar_channel_agent_reply_jobs add column routing_target_job_id text;
alter table briar_channel_agent_reply_jobs add column routing_response text;
alter table briar_channel_agent_reply_jobs add column stop_requested_at text;
alter table briar_channel_agent_reply_jobs add column stop_confirmed_at text;
alter table briar_channel_agent_reply_jobs add column routing_receipt_id text;
alter table briar_channel_agent_reply_jobs add column routing_decision_action text;
