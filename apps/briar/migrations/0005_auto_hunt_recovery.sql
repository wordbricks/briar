alter table briar_hunt_runs add column current_attempt integer not null default 1
  check (current_attempt >= 1);

alter table briar_hunt_events add column attempt integer not null default 1
  check (attempt >= 1);

create index briar_hunt_events_run_attempt_idx
  on briar_hunt_events (run_id, attempt, occurred_at desc, id desc);
