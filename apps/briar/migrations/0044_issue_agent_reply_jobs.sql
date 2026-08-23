pragma foreign_keys = on;

-- @briar replies are execution work, but they must not reopen or mutate the
-- issue's workflow run. Keep their lease and retry lifecycle separate.
create table briar_issue_agent_reply_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  reply_message_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text
    references briar_execution_workers (id) on delete set null,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  preferred_provider text
    check (preferred_provider in ('codex', 'claude', 'grok')),
  agent_provider text
    check (agent_provider in ('codex', 'claude', 'grok')),
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  unique (project_id, trigger_message_id)
);

create index briar_issue_agent_reply_jobs_queue_idx
  on briar_issue_agent_reply_jobs (
    project_id, status, preferred_worker_id, lease_expires_at, created_at
  );

create index briar_issue_agent_reply_jobs_run_idx
  on briar_issue_agent_reply_jobs (run_id, created_at desc);
