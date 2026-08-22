pragma foreign_keys = on;

-- Conversation agents can suggest issue writes, but only an authenticated
-- user acceptance applies them. The payload remains durable after message
-- archival and the expected run timestamp prevents stale edits.
create table briar_issue_action_proposals (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  conversation_run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  action_type text not null
    check (action_type in ('request_issue_update', 'request_issue_create')),
  payload_json text not null check (json_valid(payload_json)),
  expected_run_updated_at text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  result_run_id text references briar_hunt_runs (id) on delete set null,
  created_at text not null,
  updated_at text not null,
  unique (project_id, trigger_message_id)
);

create index briar_issue_action_proposals_run_idx
  on briar_issue_action_proposals (conversation_run_id, created_at, id);

create index briar_issue_action_proposals_pending_idx
  on briar_issue_action_proposals (project_id, status, created_at);
