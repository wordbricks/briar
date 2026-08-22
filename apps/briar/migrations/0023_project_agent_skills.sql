alter table briar_project_agents
  add column skill_markdown text not null default ''
  check (length(skill_markdown) <= 10000);

update briar_project_agents
set skill_markdown =
  '# ' || name || char(10) || char(10) ||
  '## Responsibility' || char(10) || char(10) ||
  responsibility || char(10) || char(10) ||
  '## Execution' || char(10) || char(10) ||
  case kind
    when 'auto_hunt' then
      '- Load the installed `briar-workflow` guide with `briar skills get briar-workflow`.' || char(10) ||
      '- Read the attached project workflow before claiming work.' || char(10) ||
      '- Claim queued issues only through `briar queue claim` and follow each run''s workflow snapshot in order.' || char(10) ||
      '- Record every required stage and its evidence before completing a run.'
    else
      '- Read the attached project workflow before acting.' || char(10) ||
      '- Follow its required stages, checks, evidence, and completion rules when they apply.' || char(10) ||
      '- Work only in the connected repository and report the observed result.'
  end || char(10);
