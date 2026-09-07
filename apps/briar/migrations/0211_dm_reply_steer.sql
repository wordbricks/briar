alter table briar_channel_agent_reply_jobs add column steer_revision integer not null default 0;
alter table briar_channel_agent_reply_jobs add column applied_steer_revision integer not null default 0;
alter table briar_channel_agent_reply_jobs add column last_input_at text;
alter table briar_channel_agent_reply_jobs add column steer_restart_count integer not null default 0;
