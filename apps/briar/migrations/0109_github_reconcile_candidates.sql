-- Keep the scheduled GitHub merge reconciliation bounded to runs that can
-- actually resume, in the same order the reconciler consumes them.
create index briar_hunt_runs_github_reconcile_idx
  on briar_hunt_runs (paused_at, id)
  where status = 'running'
    and paused_at is not null
    and resume_requested_at is null
    and workflow_stage = 'pr_open';
