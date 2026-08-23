-- Organization chat channels. Channels hold the conversation that happens
-- before an issue exists: ideation, planning, and routing. Messages thread the
-- same way issue messages do, and Agents join a channel through a roster.
pragma defer_foreign_keys = on;

create table briar_channels (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  slug text not null check (
    length(slug) between 1 and 63 and slug not glob '*[^a-z0-9-]*'
  ),
  name text not null check (length(trim(name)) between 1 and 100),
  topic text check (topic is null or length(topic) <= 500),
  visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  -- Default target for issue and plan proposals. Never an execution target.
  default_project_id text references briar_projects (id) on delete set null,
  created_by_user_id text references "user" (id) on delete set null,
  archived_at text,
  created_at text not null,
  updated_at text not null
);

create unique index briar_channels_slug_idx
  on briar_channels (organization_id, slug);
create index briar_channels_organization_idx
  on briar_channels (organization_id, archived_at, name);

create table briar_channel_members (
  channel_id text not null references briar_channels (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at text not null,
  primary key (channel_id, user_id)
);

create index briar_channel_members_user_idx
  on briar_channel_members (user_id, channel_id);

create table briar_channel_agents (
  channel_id text not null references briar_channels (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  added_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (channel_id, agent_id)
);

create index briar_channel_agents_agent_idx
  on briar_channel_agents (agent_id, channel_id);

create table briar_channel_messages (
  id text primary key not null,
  channel_id text not null references briar_channels (id) on delete cascade,
  parent_message_id text
    references briar_channel_messages (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  -- Agent authorship keeps a snapshot of the name and provider so a deleted
  -- Agent does not collapse its past messages into anonymous rows.
  author_agent_id text
    references briar_project_agents (id) on delete set null,
  author_agent_name text check (
    author_agent_name is null
    or length(trim(author_agent_name)) between 1 and 100
  ),
  author_agent_provider text check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude', 'grok', 'opencode')
  ),
  body text not null check (
    body = trim(body) and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null,
  check (parent_message_id is null or parent_message_id <> id),
  check ((author_user_id is null) <> (author_agent_name is null))
);

create index briar_channel_messages_root_idx
  on briar_channel_messages (channel_id, created_at, id)
  where parent_message_id is null;
create index briar_channel_messages_thread_idx
  on briar_channel_messages (parent_message_id, created_at, id);
create index briar_channel_messages_channel_idx
  on briar_channel_messages (channel_id, created_at, id);

create table briar_channel_message_mentions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  primary key (message_id, user_id)
);

create index briar_channel_message_mentions_user_idx
  on briar_channel_message_mentions (user_id, created_at desc, message_id);

create table briar_channel_message_agent_mentions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  created_at text not null,
  primary key (message_id, agent_id)
);

-- Agent replies in a channel are conversation work. Organization Agents carry
-- no project, so the organization is the required axis and project_id is only
-- present when a project Agent answers.
create table briar_channel_agent_reply_jobs (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  project_id text references briar_projects (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  trigger_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  reply_message_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  agent_provider text check (
    agent_provider is null
    or agent_provider in ('codex', 'claude', 'grok', 'opencode')
  ),
  claimed_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or length(error) <= 4000),
  created_at text not null,
  updated_at text not null,
  completed_at text,
  unique (channel_id, trigger_message_id, agent_id)
);

create index briar_channel_agent_reply_jobs_queue_idx
  on briar_channel_agent_reply_jobs (
    organization_id, status, project_id, lease_expires_at, created_at
  );
create index briar_channel_agent_reply_jobs_channel_idx
  on briar_channel_agent_reply_jobs (channel_id, created_at desc);

-- A plan document lives in briar_ideas so it keeps versioning and the existing
-- plan-to-issues conversion. The message only points at it.
create table briar_channel_message_documents (
  message_id text primary key not null
    references briar_channel_messages (id) on delete cascade,
  idea_id text not null references briar_ideas (id) on delete cascade,
  created_at text not null
);

create index briar_channel_message_documents_idea_idx
  on briar_channel_message_documents (idea_id, created_at);

-- Agents propose issue writes; only an authenticated member acceptance applies
-- them. The target project comes from the artifact, not from the conversation.
create table briar_channel_action_proposals (
  id text primary key not null,
  channel_id text not null references briar_channels (id) on delete cascade,
  project_id text references briar_projects (id) on delete set null,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  action_type text not null check (
    action_type in ('request_issue_create', 'request_plan_document')
  ),
  payload_json text not null check (json_valid(payload_json)),
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  result_run_id text references briar_hunt_runs (id) on delete set null,
  result_idea_id text references briar_ideas (id) on delete set null,
  created_at text not null,
  updated_at text not null,
  unique (channel_id, trigger_message_id)
);

create index briar_channel_action_proposals_pending_idx
  on briar_channel_action_proposals (channel_id, status, created_at);

pragma defer_foreign_keys = off;
