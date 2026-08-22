create table briar_issue_messages (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  parent_message_id text references briar_issue_messages (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  body text not null check (
    body = trim(body)
    and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null,
  check (parent_message_id is null or parent_message_id <> id)
);

create index briar_issue_messages_run_idx
  on briar_issue_messages (run_id, created_at, id);

create index briar_issue_messages_parent_idx
  on briar_issue_messages (parent_message_id, created_at, id);
