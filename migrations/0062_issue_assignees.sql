alter table briar_hunt_runs
  add column assignee_user_id text references "user" (id) on delete set null;

create index briar_hunt_runs_assignee_idx
  on briar_hunt_runs (project_id, assignee_user_id, updated_at desc);
