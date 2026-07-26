create table briar_project_agents (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  provider text not null check (provider in ('codex', 'claude', 'grok')),
  model text check (
    model is null
    or (
      model = trim(model)
      and length(model) between 1 and 100
    )
  ),
  responsibility text not null check (
    responsibility = trim(responsibility)
    and length(responsibility) between 1 and 2000
  ),
  created_at text not null,
  updated_at text not null
);

create index briar_project_agents_project_idx
  on briar_project_agents (project_id, created_at, id);
