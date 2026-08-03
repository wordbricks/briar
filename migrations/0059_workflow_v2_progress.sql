-- Workflow v2 progress is additive. Existing v1 workflow snapshots and the
-- paused_at compatibility projection remain readable without an in-place
-- rewrite.
alter table briar_hunt_runs add column waiting_checkpoint_key text;
alter table briar_hunt_runs add column waiting_checkpoint_revision integer
  check (waiting_checkpoint_revision is null or waiting_checkpoint_revision >= 1);

create table briar_run_stage_progress (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  stage_id text not null check (
    length(stage_id) between 1 and 64
    and substr(stage_id, 1, 1) glob '[a-z]'
    and stage_id not glob '*[^a-z0-9_-]*'
  ),
  state text not null check (state in ('pending', 'running', 'completed', 'skipped')),
  started_at text,
  finished_at text,
  primary key (run_id, attempt, revision, stage_id),
  check (
    (state = 'pending' and started_at is null and finished_at is null)
    or (state = 'running' and started_at is not null and finished_at is null)
    or (state = 'completed' and started_at is not null and finished_at is not null)
    or (state = 'skipped' and finished_at is not null)
  )
);

create index briar_run_stage_progress_lookup_idx
  on briar_run_stage_progress (run_id, attempt, revision, stage_id);

create table briar_run_checkpoint_progress (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  checkpoint_key text not null check (
    length(checkpoint_key) between 1 and 64
    and substr(checkpoint_key, 1, 1) glob '[a-z]'
    and checkpoint_key not glob '*[^a-z0-9_-]*'
  ),
  stage_id text not null check (
    length(stage_id) between 1 and 64
    and substr(stage_id, 1, 1) glob '[a-z]'
    and stage_id not glob '*[^a-z0-9_-]*'
  ),
  position text not null check (position in ('before', 'after')),
  state text not null check (state in ('pending', 'waiting', 'approved', 'invalidated')),
  reached_at text,
  approved_at text,
  approved_by text,
  approved_request_id text,
  primary key (run_id, attempt, revision, checkpoint_key),
  check (
    (state = 'pending'
      and reached_at is null
      and approved_at is null
      and approved_by is null
      and approved_request_id is null)
    or (state = 'waiting'
      and reached_at is not null
      and approved_at is null
      and approved_by is null
      and approved_request_id is null)
    or (state = 'approved'
      and reached_at is not null
      and approved_at is not null
      and approved_by is not null
      and approved_request_id is not null)
    or (state = 'invalidated')
  )
);

create index briar_run_checkpoint_progress_lookup_idx
  on briar_run_checkpoint_progress (
    run_id, attempt, revision, stage_id, position
  );

-- The database is the final concurrency guard for a run/revision. A caller
-- that loses this unique-CAS race must leave the other waiting checkpoint
-- untouched and return a transition conflict.
create unique index briar_run_checkpoint_waiting_unique_idx
  on briar_run_checkpoint_progress (run_id, attempt, revision)
  where state = 'waiting';

create index briar_hunt_runs_waiting_checkpoint_idx
  on briar_hunt_runs (
    project_id, waiting_checkpoint_revision, waiting_checkpoint_key
  )
  where waiting_checkpoint_key is not null;
