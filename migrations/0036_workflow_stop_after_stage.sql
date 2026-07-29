update briar_project_settings
set workflow_json = json_set(
  json_remove(workflow_json, '$.release'),
  '$.execution',
  json_object(
    'stopAfterStage',
    coalesce(
      json_extract(workflow_json, '$.completion.requiredStages[#-1]'),
      json_extract(workflow_json, '$.stages[#-1].id')
    )
  )
);

update briar_hunt_runs
set workflow_snapshot_json = json_set(
  json_remove(workflow_snapshot_json, '$.release'),
  '$.execution',
  json_object(
    'stopAfterStage',
    coalesce(
      json_extract(workflow_snapshot_json, '$.completion.requiredStages[#-1]'),
      json_extract(workflow_snapshot_json, '$.stages[#-1].id')
    )
  )
);
