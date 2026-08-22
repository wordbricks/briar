alter table briar_project_settings
  add column auto_hunt_automation_json text not null
  default '{"enabled":false,"maxIssuesPerSession":3,"schedule":{"enabled":false,"intervalHours":3},"queueThreshold":{"enabled":false,"minimumIssues":3},"urgentIssue":{"enabled":false}}'
  check (
    json_valid(auto_hunt_automation_json)
    and json_type(auto_hunt_automation_json) = 'object'
  );
