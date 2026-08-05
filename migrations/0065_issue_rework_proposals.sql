pragma foreign_keys = on;

-- @briar may propose a completed-run revision, but only an authenticated user
-- can accept it. Keep proposals separate from messages so message archiving
-- does not erase the approval record or its audit identity.
create table briar_issue_rework_proposals (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  workflow_stage text not null,
  reason text not null,
  expected_attempt integer not null check (expected_attempt > 0),
  expected_revision integer not null check (expected_revision > 0),
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  applied_revision integer check (applied_revision is null or applied_revision > 0),
  created_at text not null,
  updated_at text not null,
  unique (project_id, trigger_message_id)
);

create index briar_issue_rework_proposals_run_idx
  on briar_issue_rework_proposals (run_id, created_at, id);

create index briar_issue_rework_proposals_pending_idx
  on briar_issue_rework_proposals (project_id, status, created_at);
