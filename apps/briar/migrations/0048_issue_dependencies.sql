create table briar_issue_dependencies (
  project_id text not null references briar_projects (id) on delete cascade,
  prerequisite_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  dependent_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (prerequisite_run_id, dependent_run_id),
  check (prerequisite_run_id <> dependent_run_id)
);

create index briar_issue_dependencies_dependent_idx
  on briar_issue_dependencies (project_id, dependent_run_id, created_at);

create index briar_issue_dependencies_prerequisite_idx
  on briar_issue_dependencies (project_id, prerequisite_run_id, created_at);
