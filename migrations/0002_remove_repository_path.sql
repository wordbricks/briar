pragma foreign_keys = on;

create table briar_projects_v2 (
  id text primary key not null,
  owner_user_id text not null references "user" (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  agent_token_hash text not null unique check (
    length(agent_token_hash) = 64
    and agent_token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null,
  updated_at text not null
);

create table briar_hunt_runs_v2 (
  run_number integer primary key autoincrement,
  id text not null unique,
  project_id text not null references briar_projects_v2 (id) on delete cascade,
  source text not null check (source in ('issue', 'error', 'feedback')),
  source_key text not null check (
    source_key = trim(source_key)
    and length(source_key) between 1 and 200
  ),
  title text not null check (length(trim(title)) between 1 and 300),
  stage text not null check (stage in (
    'queued', 'analyzing', 'implementing', 'pr_open', 'staging_qa',
    'production_qa', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  detail text check (detail is null or length(detail) <= 4000),
  repository text not null check (length(trim(repository)) between 1 and 500),
  branch text check (
    branch is null or length(trim(branch)) between 1 and 500
  ),
  commit_sha text check (
    commit_sha is null or (
      length(commit_sha) between 7 and 64
      and commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  started_at text not null,
  completed_at text,
  last_event_at text not null,
  created_at text not null,
  updated_at text not null,
  unique (project_id, source, source_key),
  check (
    (stage in ('completed', 'cancelled') and completed_at is not null)
    or (stage not in ('completed', 'cancelled') and completed_at is null)
  )
);

create table briar_hunt_events_v2 (
  id text primary key not null,
  run_id text not null references briar_hunt_runs_v2 (id) on delete cascade,
  event_key text not null check (
    event_key = trim(event_key)
    and length(event_key) between 1 and 300
  ),
  stage text not null check (stage in (
    'queued', 'analyzing', 'implementing', 'pr_open', 'staging_qa',
    'production_qa', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  detail text check (detail is null or length(detail) <= 4000),
  actor text not null check (length(trim(actor)) between 1 and 128),
  branch text,
  commit_sha text check (
    commit_sha is null or (
      length(commit_sha) between 7 and 64
      and commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  occurred_at text not null,
  recorded_at text not null,
  unique (run_id, event_key)
);

insert into briar_projects_v2 (
  id, owner_user_id, name, agent_token_hash, created_at, updated_at
)
select id, owner_user_id, name, agent_token_hash, created_at, updated_at
from briar_projects;

insert into briar_hunt_runs_v2 (
  run_number, id, project_id, source, source_key, title, stage, detail,
  repository, branch, commit_sha, started_at, completed_at, last_event_at,
  created_at, updated_at
)
select
  run_number, id, project_id, source, source_key, title, stage, detail,
  repository, branch, commit_sha, started_at, completed_at, last_event_at,
  created_at, updated_at
from briar_hunt_runs;

insert into briar_hunt_events_v2 (
  id, run_id, event_key, stage, detail, actor, branch, commit_sha,
  occurred_at, recorded_at
)
select
  id, run_id, event_key, stage, detail, actor, branch, commit_sha,
  occurred_at, recorded_at
from briar_hunt_events;

drop table briar_hunt_events;
drop table briar_hunt_runs;
drop table briar_projects;

alter table briar_projects_v2 rename to briar_projects;
alter table briar_hunt_runs_v2 rename to briar_hunt_runs;
alter table briar_hunt_events_v2 rename to briar_hunt_events;

create index briar_projects_owner_idx
  on briar_projects (owner_user_id, created_at);
create index briar_hunt_runs_project_idx
  on briar_hunt_runs (project_id, last_event_at desc);
create index briar_hunt_events_run_idx
  on briar_hunt_events (run_id, occurred_at desc, id desc);
