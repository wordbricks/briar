-- Retire the Ideas feature. Channels were the only remaining consumer: an
-- Agent's plan document was stored as an organization idea and pointed at by
-- briar_channel_message_documents. Documents now live on the channel table
-- itself, so the channel keeps its plan cards while briar_ideas goes away.
pragma defer_foreign_keys = on;

create table briar_channel_message_documents_new (
  message_id text primary key not null
    references briar_channel_messages (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  -- Target project for the plan, chosen by the Agent. Null keeps it
  -- organization-wide until a member decides where the work belongs.
  project_id text references briar_projects (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 300),
  markdown text not null check (length(markdown) <= 200000),
  created_at text not null,
  updated_at text not null
);

insert into briar_channel_message_documents_new (
  message_id, channel_id, project_id, title, markdown, created_at, updated_at
)
select document.message_id, message.channel_id, idea.project_id, idea.title,
       idea.document_markdown, document.created_at, idea.updated_at
from briar_channel_message_documents document
join briar_channel_messages message on message.id = document.message_id
join briar_ideas idea on idea.id = document.idea_id;

drop table briar_channel_message_documents;
alter table briar_channel_message_documents_new
  rename to briar_channel_message_documents;

create index briar_channel_message_documents_channel_idx
  on briar_channel_message_documents (channel_id, created_at);

-- The proposal table referenced briar_ideas for a result that was never
-- produced: only issue-create proposals are ever stored.
create table briar_channel_action_proposals_new (
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
  created_at text not null,
  updated_at text not null,
  unique (channel_id, trigger_message_id)
);

insert into briar_channel_action_proposals_new (
  id, channel_id, project_id, trigger_message_id, reply_message_id,
  action_type, payload_json, status, accepted_by_user_id, accepted_at,
  result_run_id, created_at, updated_at
)
select id, channel_id, project_id, trigger_message_id, reply_message_id,
       action_type, payload_json, status, accepted_by_user_id, accepted_at,
       result_run_id, created_at, updated_at
from briar_channel_action_proposals;

drop table briar_channel_action_proposals;
alter table briar_channel_action_proposals_new
  rename to briar_channel_action_proposals;

create index briar_channel_action_proposals_pending_idx
  on briar_channel_action_proposals (channel_id, status, created_at);

drop table if exists briar_idea_generated_issues;
drop table if exists briar_idea_issue_plans;
drop table if exists briar_idea_jobs;
drop table if exists briar_idea_messages;
drop table if exists briar_ideas;

pragma defer_foreign_keys = off;
