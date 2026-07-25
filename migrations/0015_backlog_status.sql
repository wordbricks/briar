-- Backlog is a universal issue status, not a workflow stage. Keep the legacy
-- stage column at `queued` for compatibility while status distinguishes work
-- that Auto Hunt may claim from work that is only being tracked.
--
-- SQLite cannot alter a column CHECK constraint in place. Replacing just the
-- status columns preserves the run/event tables and all child foreign keys.

drop index briar_hunt_runs_status_idx;
drop index briar_hunt_runs_queue_claim_idx;

alter table briar_hunt_runs add column status_with_backlog text not null
  default 'queued'
  check (status_with_backlog in (
    'backlog', 'queued', 'running', 'blocked', 'failed', 'completed',
    'cancelled'
  ));
update briar_hunt_runs set status_with_backlog = status;
alter table briar_hunt_runs drop column status;
alter table briar_hunt_runs rename column status_with_backlog to status;

alter table briar_hunt_events add column status_with_backlog text not null
  default 'queued'
  check (status_with_backlog in (
    'backlog', 'queued', 'running', 'blocked', 'failed', 'completed',
    'cancelled'
  ));
update briar_hunt_events set status_with_backlog = status;
alter table briar_hunt_events drop column status;
alter table briar_hunt_events rename column status_with_backlog to status;

create index briar_hunt_runs_status_idx
  on briar_hunt_runs (project_id, status, last_event_at desc);
create index briar_hunt_runs_queue_claim_idx
  on briar_hunt_runs (
    project_id,
    priority,
    source_created_at,
    lease_expires_at
  )
  where status = 'queued';
