alter table briar_hunt_runs add column current_revision integer not null default 1
  check (current_revision >= 1);

alter table briar_hunt_events add column revision integer not null default 1
  check (revision >= 1);

alter table briar_run_evidence add column revision integer not null default 1
  check (revision >= 1);

create table briar_run_stage_revisions (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  workflow_stage text not null,
  required_revision integer not null check (required_revision >= 1),
  primary key (run_id, attempt, workflow_stage)
);

create index briar_run_stage_revisions_run_attempt
  on briar_run_stage_revisions (run_id, attempt, required_revision);
