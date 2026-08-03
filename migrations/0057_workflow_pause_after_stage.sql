-- A paused run keeps the persisted run status as `running` so existing
-- status/check constraints and worker recovery remain compatible. The API
-- derives the public `paused` status from this checkpoint timestamp.
alter table briar_hunt_runs add column paused_at text;

-- Canonicalize workflows written by migration 0037 while keeping the runtime
-- readers tolerant of older snapshots created before this migration.
update briar_project_settings
set workflow_json = json_set(
  json_remove(workflow_json, '$.execution.stopAfterStage'),
  '$.execution.pauseAfterStage',
  coalesce(
    json_extract(workflow_json, '$.execution.pauseAfterStage'),
    json_extract(workflow_json, '$.execution.stopAfterStage')
  )
)
where json_extract(workflow_json, '$.execution.stopAfterStage') is not null
   or json_extract(workflow_json, '$.execution.pauseAfterStage') is not null;

update briar_hunt_runs
set workflow_snapshot_json = json_set(
  json_remove(workflow_snapshot_json, '$.execution.stopAfterStage'),
  '$.execution.pauseAfterStage',
  coalesce(
    json_extract(workflow_snapshot_json, '$.execution.pauseAfterStage'),
    json_extract(workflow_snapshot_json, '$.execution.stopAfterStage')
  )
)
where json_extract(workflow_snapshot_json, '$.execution.stopAfterStage') is not null
   or json_extract(workflow_snapshot_json, '$.execution.pauseAfterStage') is not null;
