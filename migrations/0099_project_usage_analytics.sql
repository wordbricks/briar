alter table briar_hunt_runs add column created_by_user_id text
  references "user" (id) on delete set null;

create index briar_hunt_runs_project_created_idx
  on briar_hunt_runs (project_id, source_created_at, created_by_user_id);
