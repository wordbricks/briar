-- Workflow v2 lifecycle commands originally updated only stage progress, so
-- issue status history contained the intake event but omitted every stage.
-- Backfill one durable status event for each stage that actually started.
insert into briar_hunt_events (
  id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
  detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
  pull_request_urls, target_sha, occurred_at, recorded_at
)
select
  lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  progress.run_id,
  'workflow:stage-start:' || progress.attempt || ':' || progress.revision || ':' || progress.stage_id,
  progress.attempt,
  progress.revision,
  case
    when progress.stage_id in (
      'analyzing', 'implementing', 'pr_open', 'staging_qa', 'production_qa'
    ) then progress.stage_id
    else 'implementing'
  end,
  'running',
  progress.stage_id,
  '워크플로 단계를 시작했습니다.',
  'briar-workflow',
  run.branch,
  run.commit_sha,
  null,
  run.tracker_issue_state,
  run.pull_request_urls,
  run.target_sha,
  progress.started_at,
  progress.started_at
from briar_run_stage_progress progress
join briar_hunt_runs run on run.id = progress.run_id
where progress.started_at is not null
on conflict(run_id, event_key) do nothing;

update briar_hunt_runs
set last_event_at = max(
  last_event_at,
  coalesce(
    (
      select max(progress.started_at)
      from briar_run_stage_progress progress
      where progress.run_id = briar_hunt_runs.id
    ),
    last_event_at
  )
)
where exists (
  select 1
  from briar_run_stage_progress progress
  where progress.run_id = briar_hunt_runs.id and progress.started_at is not null
);
