alter table briar_project_agent_schedules add column next_run_at text;

create index briar_project_agent_schedules_due_idx
  on briar_project_agent_schedules (project_id, enabled, next_run_at, id);

create table briar_project_agent_schedule_runs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  schedule_id text not null
    references briar_project_agent_schedules (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  scheduled_for text not null,
  claim_token_hash text,
  lease_expires_at text,
  started_at text not null,
  completed_at text,
  result_summary text,
  error text,
  created_at text not null,
  updated_at text not null,
  unique (schedule_id, scheduled_for)
);

create index briar_project_agent_schedule_runs_project_idx
  on briar_project_agent_schedule_runs (project_id, scheduled_for desc, id);

create index briar_project_agent_schedule_runs_lease_idx
  on briar_project_agent_schedule_runs (
    project_id, status, lease_expires_at, scheduled_for, id
  );
