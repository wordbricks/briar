create table briar_project_agent_schedules (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name)
    and length(name) between 1 and 120
  ),
  recurrence text not null check (
    recurrence in ('daily', 'weekdays', 'weekly')
  ),
  time_of_day text not null check (
    length(time_of_day) = 5
    and substr(time_of_day, 3, 1) = ':'
    and substr(time_of_day, 1, 2) between '00' and '23'
    and substr(time_of_day, 4, 2) between '00' and '59'
  ),
  day_of_week integer check (
    (recurrence = 'weekly' and day_of_week between 0 and 6)
    or (recurrence != 'weekly' and day_of_week is null)
  ),
  time_zone text not null check (
    time_zone = trim(time_zone)
    and length(time_zone) between 1 and 100
  ),
  enabled integer not null default 1 check (enabled in (0, 1)),
  created_at text not null,
  updated_at text not null
);

create index briar_project_agent_schedules_project_idx
  on briar_project_agent_schedules (project_id, created_at, id);

create index briar_project_agent_schedules_agent_idx
  on briar_project_agent_schedules (agent_id, created_at, id);
