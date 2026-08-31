-- Schedule recurrence is one wire/domain concept. Replace the transitional
-- constrained recurrence + nullable frequency pair with one canonical column.
pragma foreign_keys = off;
pragma legacy_alter_table = on;

drop trigger if exists briar_project_agent_schedule_creator_immutable;

alter table briar_project_agent_schedule_runs
  rename to briar_project_agent_schedule_runs_legacy;

alter table briar_project_agent_schedules
  rename to briar_project_agent_schedules_legacy;

create table briar_project_agent_schedules (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name)
    and length(name) between 1 and 120
  ),
  recurrence text not null check (
    recurrence in ('interval', 'daily', 'weekdays', 'weekly', 'custom')
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
  updated_at text not null,
  next_run_at text,
  interval_value integer not null default 1
    check (interval_value between 1 and 999),
  interval_unit text not null default 'day'
    check (interval_unit in ('minute', 'hour', 'day', 'week')),
  days_of_week text,
  notification_level text not null default 'important_updates'
    check (notification_level in ('important_updates', 'none')),
  created_by_user_id text references "user" (id) on delete set null
);

create table briar_project_agent_schedule_runs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  schedule_id text not null
    references briar_project_agent_schedules (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  scheduled_for text not null,
  claim_token_hash text,
  lease_expires_at text,
  started_at text not null,
  completed_at text,
  result_summary text,
  error text,
  created_at text not null,
  updated_at text not null,
  structured_result_json text,
  unique (schedule_id, scheduled_for)
);

insert into briar_project_agent_schedules (
  id, project_id, agent_id, name, recurrence, time_of_day, day_of_week,
  time_zone, enabled, created_at, updated_at, next_run_at, interval_value,
  interval_unit, days_of_week, notification_level, created_by_user_id
)
select id, project_id, agent_id, name, coalesce(frequency, recurrence),
       time_of_day, day_of_week, time_zone, enabled, created_at, updated_at,
       next_run_at, interval_value, interval_unit, days_of_week,
       notification_level, created_by_user_id
from briar_project_agent_schedules_legacy;

insert into briar_project_agent_schedule_runs (
  id, project_id, schedule_id, agent_id, status, scheduled_for,
  claim_token_hash, lease_expires_at, started_at, completed_at, result_summary,
  error, created_at, updated_at, structured_result_json
)
select id, project_id, schedule_id, agent_id, status, scheduled_for,
       claim_token_hash, lease_expires_at, started_at, completed_at,
       result_summary, error, created_at, updated_at, structured_result_json
from briar_project_agent_schedule_runs_legacy;

drop table briar_project_agent_schedule_runs_legacy;
drop table briar_project_agent_schedules_legacy;

create index briar_project_agent_schedules_project_idx
  on briar_project_agent_schedules (project_id, created_at, id);

create index briar_project_agent_schedules_agent_idx
  on briar_project_agent_schedules (agent_id, created_at, id);

create index briar_project_agent_schedules_due_idx
  on briar_project_agent_schedules (project_id, enabled, next_run_at, id);

create index briar_project_agent_schedule_runs_project_idx
  on briar_project_agent_schedule_runs (project_id, scheduled_for desc, id);

create index briar_project_agent_schedule_runs_lease_idx
  on briar_project_agent_schedule_runs (
    project_id, status, lease_expires_at, scheduled_for, id
  );

create trigger briar_project_agent_schedule_creator_immutable
before update of created_by_user_id on briar_project_agent_schedules
when new.created_by_user_id is not old.created_by_user_id
  and not (
    old.created_by_user_id is not null
    and new.created_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.created_by_user_id
    )
  )
begin
  select raise(abort, 'Agent schedule creator is immutable');
end;

pragma legacy_alter_table = off;
pragma foreign_keys = on;
