update briar_project_settings
set workflow_json = '{"version":1,"stages":[{"id":"repository_workflow_pending","label":"Repository workflow pending","required":true}],"completion":{"requiredStages":["repository_workflow_pending"]},"release":{"enabled":false}}'
where json_type(workflow_json, '$.preset') is not null;

update briar_hunt_runs
set workflow_snapshot_json = json_remove(workflow_snapshot_json, '$.preset')
where json_type(workflow_snapshot_json, '$.preset') is not null;
