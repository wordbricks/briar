alter table briar_project_agent_schedules add column frequency text
  check (
    frequency is null
    or frequency in ('interval', 'daily', 'weekdays', 'weekly', 'custom')
  );

alter table briar_project_agent_schedules add column interval_value integer
  not null default 1 check (interval_value between 1 and 999);

alter table briar_project_agent_schedules add column interval_unit text
  not null default 'day'
  check (interval_unit in ('minute', 'hour', 'day', 'week'));

alter table briar_project_agent_schedules add column days_of_week text;

alter table briar_project_agent_schedules add column notification_level text
  not null default 'important_updates'
  check (notification_level in ('important_updates', 'none'));
