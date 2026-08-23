alter table briar_hunt_runs add column structured_result_json text;

alter table briar_project_agent_schedule_runs
  add column structured_result_json text;
