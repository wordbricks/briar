pragma foreign_keys = on;

create table briar_ideas (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  author_user_id text not null references "user" (id) on delete cascade,
  title text not null default 'New idea'
    check (length(trim(title)) between 1 and 300),
  title_is_auto integer not null default 1 check (title_is_auto in (0, 1)),
  document_markdown text not null default ''
    check (length(document_markdown) <= 200000),
  status text not null default 'draft' check (status in (
    'draft', 'refining', 'ready', 'issues_created', 'archived'
  )),
  provider text not null check (provider in (
    'codex', 'claude', 'grok', 'opencode'
  )),
  model text check (
    model is null or length(trim(model)) between 1 and 100
  ),
  version integer not null default 1 check (version >= 1),
  replacement_lock_until text,
  created_at text not null,
  updated_at text not null
);

create index briar_ideas_project_idx
  on briar_ideas (project_id, updated_at desc, id);
create index briar_ideas_author_idx
  on briar_ideas (author_user_id, updated_at desc);

create table briar_idea_messages (
  id text primary key not null,
  idea_id text not null references briar_ideas (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null check (length(trim(body)) between 1 and 100000),
  job_id text,
  created_at text not null
);

create index briar_idea_messages_idea_idx
  on briar_idea_messages (idea_id, created_at, id);

create table briar_idea_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  idea_id text not null references briar_ideas (id) on delete cascade,
  kind text not null check (kind in ('chat', 'issue_plan')),
  trigger_message_id text references briar_idea_messages (id) on delete cascade,
  reply_message_id text,
  expected_version integer not null check (expected_version >= 1),
  provider text not null check (provider in (
    'codex', 'claude', 'grok', 'opencode'
  )),
  model text check (model is null or length(trim(model)) between 1 and 100),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'completed', 'failed'
  )),
  claimed_worker_id text references briar_execution_workers (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or length(error) <= 4000),
  created_at text not null,
  updated_at text not null,
  completed_at text
);

create unique index briar_idea_jobs_active_idx
  on briar_idea_jobs (idea_id)
  where status in ('queued', 'running');
create index briar_idea_jobs_claim_idx
  on briar_idea_jobs (project_id, status, created_at);

create table briar_idea_issue_plans (
  id text primary key not null,
  idea_id text not null unique references briar_ideas (id) on delete cascade,
  document_version integer not null check (document_version >= 1),
  version integer not null default 1 check (version >= 1),
  items_json text not null check (
    json_valid(items_json) and json_type(items_json) = 'array'
  ),
  created_at text not null,
  updated_at text not null
);

create table briar_idea_generated_issues (
  idea_id text not null references briar_ideas (id) on delete cascade,
  generation integer not null check (generation >= 1),
  run_id text not null unique references briar_hunt_runs (id) on delete cascade,
  position integer not null check (position >= 0),
  created_at text not null,
  primary key (idea_id, generation, position)
);

create index briar_idea_generated_issues_idea_idx
  on briar_idea_generated_issues (idea_id, generation, position);
