pragma foreign_keys = on;

-- Direct saved-Agent runs are independent of the issue queue. The selected
-- Worker is part of the durable job so a mobile request cannot silently move
-- to another host while it is waiting.
create table briar_project_agent_task_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  request text not null,
  request_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text not null
    references briar_execution_workers (id) on delete cascade,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  unique (project_id, request_id)
);

create index briar_project_agent_task_jobs_queue_idx
  on briar_project_agent_task_jobs (
    project_id, preferred_worker_id, status, lease_expires_at, created_at
  );

create index briar_project_agent_task_jobs_session_idx
  on briar_project_agent_task_jobs (project_id, updated_at desc, id);
