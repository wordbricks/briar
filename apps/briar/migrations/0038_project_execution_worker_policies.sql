pragma foreign_keys = on;

-- Worker registration belongs to an organization device. Projects only keep
-- a policy describing which project bindings may execute their runs.
create table briar_project_execution_worker_policies (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  selection_mode text not null default 'any'
    check (selection_mode in ('any', 'allowlist')),
  default_worker_id text
    references briar_execution_workers (id) on delete set null,
  updated_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  updated_at text not null
);

create table briar_project_execution_worker_allowlist (
  project_id text not null references briar_projects (id) on delete cascade,
  worker_id text not null
    references briar_execution_workers (id) on delete cascade,
  created_at text not null,
  primary key (project_id, worker_id)
);

create index briar_project_execution_worker_allowlist_worker_idx
  on briar_project_execution_worker_allowlist (worker_id, project_id);
