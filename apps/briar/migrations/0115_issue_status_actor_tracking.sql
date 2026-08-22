-- Checkpoint approvals already retained their actor in normalized workflow
-- progress, but older approvals were absent from the issue Status history.
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
  'workflow:checkpoint-approved:' || progress.attempt || ':' ||
    progress.revision || ':' || progress.checkpoint_key,
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
  coalesce(
    json_extract(stage.value, '$.label'),
    progress.stage_id
  ) || ' 단계의 검토를 승인했습니다.',
  progress.approved_by,
  run.branch,
  run.commit_sha,
  null,
  run.tracker_issue_state,
  run.pull_request_urls,
  run.target_sha,
  progress.approved_at,
  progress.approved_at
from briar_run_checkpoint_progress progress
join briar_hunt_runs run on run.id = progress.run_id
left join json_each(run.workflow_snapshot_json, '$.stages') stage
  on json_extract(stage.value, '$.id') = progress.stage_id
where progress.state = 'approved'
  and progress.approved_at is not null
  and length(trim(progress.approved_by)) > 0
on conflict(run_id, event_key) do nothing;

update briar_hunt_runs
set last_event_at = max(
  last_event_at,
  coalesce(
    (
      select max(progress.approved_at)
      from briar_run_checkpoint_progress progress
      where progress.run_id = briar_hunt_runs.id
        and progress.state = 'approved'
    ),
    last_event_at
  )
)
where exists (
  select 1
  from briar_run_checkpoint_progress progress
  where progress.run_id = briar_hunt_runs.id
    and progress.state = 'approved'
);
