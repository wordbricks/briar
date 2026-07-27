alter table briar_project_agents
  add column calendar_color text not null default '#3275d5'
  check (length(calendar_color) = 7 and substr(calendar_color, 1, 1) = '#');
