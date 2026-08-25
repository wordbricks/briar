-- Keep one durable execution session for each channel thread and Agent. The
-- server owns Worker affinity and provider conversation state; the Worker uses
-- the opaque session ID as its local workspace key.
create table briar_channel_reply_sessions (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  thread_root_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  project_id text references briar_projects (id) on delete set null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  provider text not null check (
    provider in (
      'codex', 'claude', 'cursor', 'grok', 'agy', 'opencode', 'openrouter'
    )
  ),
  model text,
  effort text,
  owner_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  owner_worker_id text
    references briar_execution_workers (id) on delete set null,
  conversation_id text check (
    conversation_id is null or length(conversation_id) between 1 and 1024
  ),
  last_activity_at text not null,
  retained_until text not null,
  created_at text not null,
  updated_at text not null,
  unique (channel_id, thread_root_message_id, agent_id),
  check (retained_until >= last_activity_at),
  check (
    (owner_device_id is null and owner_worker_id is null)
    or (owner_device_id is not null and owner_worker_id is not null)
  )
);

create index briar_channel_reply_sessions_owner_idx
  on briar_channel_reply_sessions (
    owner_worker_id, retained_until, updated_at
  );
create index briar_channel_reply_sessions_expiry_idx
  on briar_channel_reply_sessions (retained_until, updated_at);

alter table briar_channel_agent_reply_jobs add column session_id text
  references briar_channel_reply_sessions (id) on delete cascade;

-- Existing queued/running replies become reusable without needing a deployment
-- compatibility branch. min(id) is only an opaque stable identity here.
insert into briar_channel_reply_sessions (
  id, organization_id, channel_id, thread_root_message_id, project_id,
  agent_id, provider, model, effort, last_activity_at, retained_until,
  created_at, updated_at
)
select min(job.id), job.organization_id, job.channel_id, job.parent_message_id,
       job.project_id, job.agent_id, coalesce(job.agent_provider, agent.provider),
       agent.model, agent.effort, max(job.updated_at),
       strftime('%Y-%m-%dT%H:%M:%fZ', max(job.updated_at), '+6 hours'),
       min(job.created_at),
       max(job.updated_at)
from briar_channel_agent_reply_jobs job
join briar_project_agents agent on agent.id = job.agent_id
group by job.organization_id, job.channel_id, job.parent_message_id,
         job.project_id, job.agent_id;

update briar_channel_agent_reply_jobs
set session_id = (
  select session.id
  from briar_channel_reply_sessions session
  where session.channel_id = briar_channel_agent_reply_jobs.channel_id
    and session.thread_root_message_id =
      briar_channel_agent_reply_jobs.parent_message_id
    and session.agent_id = briar_channel_agent_reply_jobs.agent_id
);

create index briar_channel_agent_reply_jobs_session_idx
  on briar_channel_agent_reply_jobs (
    session_id, status, lease_expires_at, created_at, id
  );

-- Small immutable operational records make reuse, failover, renewal and
-- expiration decisions queryable without relying on free-form process logs.
create table briar_channel_reply_session_events (
  id text primary key not null,
  session_id text not null
    references briar_channel_reply_sessions (id) on delete cascade,
  reply_job_id text
    references briar_channel_agent_reply_jobs (id) on delete set null,
  event_type text not null check (
    event_type in ('claimed', 'checkpointed', 'ttl_renewed', 'cleaned')
  ),
  reason text not null check (length(reason) between 1 and 100),
  from_worker_id text,
  to_worker_id text,
  retained_until text,
  detail_json text not null default '{}'
    check (json_valid(detail_json) and json_type(detail_json) = 'object'),
  occurred_at text not null
);

create index briar_channel_reply_session_events_session_idx
  on briar_channel_reply_session_events (session_id, occurred_at desc, id);

create trigger briar_channel_reply_session_events_immutable_update
before update on briar_channel_reply_session_events
begin
  select raise(abort, 'Channel reply session events are immutable');
end;
