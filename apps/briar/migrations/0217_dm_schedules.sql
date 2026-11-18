-- Empty table and nullable provenance only; no existing-row rewrite or backfill.
create table briar_dm_schedules (
  id text primary key not null,
  organization_id text not null references briar_organizations(id) on delete cascade,
  channel_id text not null references briar_channels(id) on delete cascade,
  owner_user_id text not null references "user"(id) on delete cascade,
  agent_id text not null references briar_project_agents(id) on delete cascade,
  source_message_id text not null references briar_channel_messages(id) on delete cascade,
  source_version integer not null,
  roster_epoch integer not null,
  request_key text not null,
  payload_hash text not null,
  instruction text not null check (length(instruction) between 1 and 8000),
  previous_job_id text,
  next_run_at text not null,
  interval_seconds integer check (interval_seconds is null or interval_seconds between 300 and 31536000),
  time_zone text not null,
  enabled integer not null default 1 check (enabled in (0, 1)),
  revision integer not null default 1,
  current_job_id text,
  cancelled_at text,
  created_at text not null,
  updated_at text not null,
  unique (channel_id, owner_user_id, agent_id, source_message_id, request_key)
);
create index briar_dm_schedules_due on briar_dm_schedules(enabled, next_run_at);
create index briar_dm_schedules_scope on briar_dm_schedules(channel_id, owner_user_id, agent_id, created_at);
alter table briar_channel_agent_reply_jobs add column dm_schedule_id text;
