-- Canonicalize every stored workflow to v2 before the application drops v1
-- parsing support. Project definitions preserve their effective checkpoint
-- policy, while run snapshots preserve the single checkpoint encoded by their
-- v1 execution boundary.
--
-- A non-null mandatory_checkpoints_json is an explicitly saved project policy,
-- including an empty array for uninterrupted execution. A null value is the
-- lazy-upgrade sentinel introduced by migration 0060, so those projects retain
-- the single legacy after-stage checkpoint represented by v1 pauseAfterStage
-- or stopAfterStage.
update briar_project_settings
set workflow_json = json_set(
  json_remove(
    json_set(
      workflow_json,
      '$.execution',
      json(coalesce(json_extract(workflow_json, '$.execution'), '{}'))
    ),
    '$.execution.pauseAfterStage',
    '$.execution.stopAfterStage'
  ),
  '$.version',
  2,
  '$.requirements',
  json(coalesce(json_extract(workflow_json, '$.requirements'), '[]')),
  '$.execution.checkpoints',
  json(
    case
      when mandatory_checkpoints_json is not null
        then mandatory_checkpoints_json
      else json_array(
        json_object(
          'key',
          'legacy-after-' || coalesce(
            nullif(trim(json_extract(
              workflow_json,
              '$.execution.pauseAfterStage'
            )), ''),
            nullif(trim(json_extract(
              workflow_json,
              '$.execution.stopAfterStage'
            )), ''),
            json_extract(
              workflow_json,
              '$.completion.requiredStages[#-1]'
            ),
            json_extract(workflow_json, '$.stages[#-1].id')
          ),
          'stage',
          coalesce(
            nullif(trim(json_extract(
              workflow_json,
              '$.execution.pauseAfterStage'
            )), ''),
            nullif(trim(json_extract(
              workflow_json,
              '$.execution.stopAfterStage'
            )), ''),
            json_extract(
              workflow_json,
              '$.completion.requiredStages[#-1]'
            ),
            json_extract(workflow_json, '$.stages[#-1].id')
          ),
          'position',
          'after'
        )
      )
    end
  )
)
where json_extract(workflow_json, '$.version') = 1;

update briar_hunt_runs
set workflow_snapshot_json = json_set(
  json_remove(
    json_set(
      workflow_snapshot_json,
      '$.execution',
      json(coalesce(json_extract(workflow_snapshot_json, '$.execution'), '{}'))
    ),
    '$.execution.pauseAfterStage',
    '$.execution.stopAfterStage'
  ),
  '$.version',
  2,
  '$.requirements',
  json(coalesce(json_extract(workflow_snapshot_json, '$.requirements'), '[]')),
  '$.execution.checkpoints',
  json_array(
    json_object(
      'key',
      'legacy-after-' || coalesce(
        nullif(trim(json_extract(
          workflow_snapshot_json,
          '$.execution.pauseAfterStage'
        )), ''),
        nullif(trim(json_extract(
          workflow_snapshot_json,
          '$.execution.stopAfterStage'
        )), ''),
        json_extract(
          workflow_snapshot_json,
          '$.completion.requiredStages[#-1]'
        ),
        json_extract(workflow_snapshot_json, '$.stages[#-1].id')
      ),
      'stage',
      coalesce(
        nullif(trim(json_extract(
          workflow_snapshot_json,
          '$.execution.pauseAfterStage'
        )), ''),
        nullif(trim(json_extract(
          workflow_snapshot_json,
          '$.execution.stopAfterStage'
        )), ''),
        json_extract(
          workflow_snapshot_json,
          '$.completion.requiredStages[#-1]'
        ),
        json_extract(workflow_snapshot_json, '$.stages[#-1].id')
      ),
      'position',
      'after'
    )
  )
)
where json_extract(workflow_snapshot_json, '$.version') = 1;
