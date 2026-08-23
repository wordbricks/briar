alter table briar_projects
  add column schedule_tab_enabled integer not null default 1
  check (schedule_tab_enabled in (0, 1));
