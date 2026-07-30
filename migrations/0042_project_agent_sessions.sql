create table briar_project_agent_sessions (
  project_id text not null references briar_projects (id) on delete cascade,
  id text not null,
  agent_id text,
  status text not null check (
    status in ('running', 'completed', 'failed', 'interrupted')
  ),
  session_type text not null check (session_type in ('task', 'dispatch')),
  payload_json text not null,
  started_at text not null,
  completed_at text,
  updated_at text not null,
  primary key (project_id, id)
);

create index briar_project_agent_sessions_recent_idx
  on briar_project_agent_sessions (project_id, updated_at desc, id);
