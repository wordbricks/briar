-- Keep a resumed run visibly paused until a Worker atomically reclaims it.
alter table briar_hunt_runs add column resume_requested_at text;

create index briar_hunt_runs_resume_requested_idx
  on briar_hunt_runs(project_id, resume_requested_at, run_number)
  where resume_requested_at is not null;
