update briar_project_agents
set skill_markdown =
  '# ' || name || char(10) || char(10) ||
  '## Responsibility' || char(10) || char(10) ||
  responsibility || char(10) || char(10) ||
  '## Execution' || char(10) || char(10) ||
  '- Read the attached project workflow before acting.' || char(10) ||
  '- Follow its required stages, checks, evidence, and completion rules when they apply.' || char(10) ||
  '- Follow the invocation''s workspace and execution-mode instructions; do not infer queue work.' || char(10) ||
  '- Report only results that were actually observed.' || char(10);

alter table briar_project_agents drop column kind;
alter table briar_project_settings drop column auto_hunt_automation_json;
