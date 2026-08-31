pragma foreign_keys = on;

-- The former Project remains the legacy repository/execution boundary during
-- the rolling-deploy compatibility window. Copy it additively to the canonical
-- Team store with the same stable ID; older Workers may keep using
-- briar_projects while hierarchy-aware Workers use briar_teams.
create table briar_teams (
  id text primary key not null,
  owner_user_id text not null references "user" (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  agent_token_hash text not null unique check (
    length(agent_token_hash) = 64
    and agent_token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null,
  updated_at text not null,
  organization_id text references briar_organizations (id) on delete cascade,
  icon_data_url text check (
    icon_data_url is null
    or (
      length(icon_data_url) <= 400000
      and substr(icon_data_url, 1, 23) = 'data:image/webp;base64,'
    )
  ),
  icon_data_url_browser text check (
    icon_data_url_browser is null
    or (
      length(icon_data_url_browser) <= 400000
      and (
        substr(icon_data_url_browser, 1, 22) = 'data:image/png;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/jpeg;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/webp;base64,'
      )
    )
  ),
  issue_key_prefix text not null default 'AH' check (
    issue_key_prefix = upper(trim(issue_key_prefix))
    and length(issue_key_prefix) between 1 and 3
    and issue_key_prefix not glob '*[^A-Z0-9]*'
  ),
  schedule_tab_enabled integer not null default 1
    check (schedule_tab_enabled in (0, 1))
);

insert into briar_teams (
  id, owner_user_id, name, agent_token_hash, created_at, updated_at,
  organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
  schedule_tab_enabled
)
select id, owner_user_id, name, agent_token_hash, created_at, updated_at,
       organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
       schedule_tab_enabled
from briar_projects;

create index briar_teams_owner_idx
  on briar_teams (owner_user_id, created_at);
create index briar_teams_organization_idx
  on briar_teams (organization_id, created_at);
create index briar_teams_organization_context_idx
  on briar_teams (organization_id, id, name, created_at);
create unique index briar_teams_id_organization_unique
  on briar_teams (id, organization_id);

-- Keep both execution-boundary names writable throughout the compatibility
-- period. Null-safe, difference-guarded updates stop recursive trigger loops.
create trigger briar_projects_sync_team_after_insert
after insert on briar_projects BEGIN
  insert or ignore into briar_teams (
    id, owner_user_id, name, agent_token_hash, created_at, updated_at,
    organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
    schedule_tab_enabled
  ) values (
    new.id, new.owner_user_id, new.name, new.agent_token_hash,
    new.created_at, new.updated_at, new.organization_id, new.icon_data_url,
    new.icon_data_url_browser, new.issue_key_prefix, new.schedule_tab_enabled
  );
  update briar_teams
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

create trigger briar_projects_sync_team_after_update
after update on briar_projects BEGIN
  update briar_teams
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

create trigger briar_projects_sync_team_after_delete
after delete on briar_projects BEGIN
  delete from briar_teams where id = old.id;
END;

create trigger briar_teams_sync_legacy_after_insert
after insert on briar_teams BEGIN
  insert or ignore into briar_projects (
    id, owner_user_id, name, agent_token_hash, created_at, updated_at,
    organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
    schedule_tab_enabled
  ) values (
    new.id, new.owner_user_id, new.name, new.agent_token_hash,
    new.created_at, new.updated_at, new.organization_id, new.icon_data_url,
    new.icon_data_url_browser, new.issue_key_prefix, new.schedule_tab_enabled
  );
  update briar_projects
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

create trigger briar_teams_sync_legacy_after_update
after update on briar_teams BEGIN
  update briar_projects
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;

create trigger briar_teams_sync_legacy_after_delete
after delete on briar_teams BEGIN
  delete from briar_projects where id = old.id;
END;

-- A Project is now a lightweight planning container inside exactly one Team.
-- A later cleanup migration may rename this store to briar_projects after old
-- Workers have aged out; doing so now would make rolling deployments unsafe.
create table briar_planning_projects (
  id text primary key not null,
  team_id text not null references briar_teams (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 10000),
  status text not null default 'planned'
    check (status in ('planned', 'active', 'completed', 'cancelled')),
  lead_user_id text references "user" (id) on delete set null,
  start_date text check (
    start_date is null or (
      start_date = date(start_date) and length(start_date) = 10
    )
  ),
  target_date text check (
    target_date is null or (
      target_date = date(target_date) and length(target_date) = 10
    )
  ),
  icon text check (icon is null or length(icon) <= 200),
  color text check (
    color is null or (
      length(color) = 7
      and substr(color, 1, 1) = '#'
      and substr(color, 2) not glob '*[^0-9A-Fa-f]*'
    )
  ),
  sort_order integer not null default 0,
  is_default integer not null default 0 check (is_default in (0, 1)),
  created_at text not null,
  updated_at text not null,
  unique (id, team_id)
);

create index briar_planning_projects_team_sort_idx
  on briar_planning_projects (team_id, sort_order, created_at, id);
create unique index briar_planning_projects_team_default_unique
  on briar_planning_projects (team_id) where is_default = 1;

-- Generate one stable General Project per promoted Team. Existing Issue IDs,
-- keys, source keys, branches, claims, worktrees and execution children are not
-- rewritten by this backfill.
insert into briar_planning_projects (
  id, team_id, name, description, status, sort_order, is_default,
  created_at, updated_at
)
select
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-' ||
    '4' || substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + abs(random()) % 4, 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  team.id,
  'General',
  '',
  'active',
  0,
  1,
  team.created_at,
  team.updated_at
from briar_teams team;

-- During the compatibility window project_id on existing execution tables is
-- the promoted Team ID. planning_project_id is the new Issue classification;
-- API responses expose it as projectId and expose the legacy value as teamId.
alter table briar_hunt_runs add column team_id text
  references briar_teams (id) on delete cascade;

update briar_hunt_runs set team_id = project_id;

alter table briar_hunt_runs add column planning_project_id text
  references briar_planning_projects (id) on delete restrict;

update briar_hunt_runs
set planning_project_id = (
  select project.id
  from briar_planning_projects project
  where project.team_id = briar_hunt_runs.project_id
    and project.is_default = 1
);

create index briar_hunt_runs_planning_project_idx
  on briar_hunt_runs (planning_project_id, last_event_at desc, id);
create index briar_hunt_runs_team_hierarchy_idx
  on briar_hunt_runs (team_id, last_event_at desc, id);

-- planning_project_id intentionally restricts standalone physical Project
-- deletion so an Issue can never be orphaned. A Team/Workspace deletion is a
-- different lifecycle: remove its Issues first, then let the existing Team
-- cascade remove planning Projects and execution-owned data.
create trigger briar_teams_delete_issues_before_projects
before delete on briar_teams BEGIN
  delete from briar_hunt_runs where project_id = old.id;
END;

-- Compatibility writers that still create an Issue by Team are assigned to
-- General atomically before the statement finishes.
create trigger briar_hunt_runs_assign_default_project
after insert on briar_hunt_runs
when new.planning_project_id is null BEGIN
  update briar_hunt_runs
  set team_id = coalesce(new.team_id, new.project_id),
      planning_project_id = (
    select project.id
    from briar_planning_projects project
    where project.team_id = new.project_id and project.is_default = 1
  )
  where id = new.id;
END;

create trigger briar_hunt_runs_validate_team_insert
before insert on briar_hunt_runs
when new.team_id is not null and new.team_id <> new.project_id BEGIN
  select raise(abort, 'legacy project id must match issue team');
END;

create trigger briar_hunt_runs_sync_team_after_insert
after insert on briar_hunt_runs
when new.team_id is null BEGIN
  update briar_hunt_runs set team_id = new.project_id where id = new.id;
END;

create trigger briar_hunt_runs_validate_team_update
before update of team_id on briar_hunt_runs
when new.team_id is null or new.team_id <> new.project_id BEGIN
  select raise(abort, 'legacy project id must match issue team');
END;

create trigger briar_hunt_runs_validate_project_insert
before insert on briar_hunt_runs
when new.planning_project_id is not null BEGIN
  select case when not exists (
    select 1 from briar_planning_projects project
    where project.id = new.planning_project_id
      and project.team_id = new.project_id
  ) then raise(abort, 'issue project must belong to its team') end;
END;

create trigger briar_hunt_runs_validate_project_update
before update of planning_project_id on briar_hunt_runs BEGIN
  select case when new.planning_project_id is null or not exists (
    select 1 from briar_planning_projects project
    where project.id = new.planning_project_id
      and project.team_id = new.project_id
  ) then raise(abort, 'issue project must belong to its team') end;
END;

-- A legacy Team transfer adopts the target Team's General Project. The
-- transfer service can subsequently select another Project in that Team.
create trigger briar_hunt_runs_reclassify_after_team_transfer
after update of project_id on briar_hunt_runs
when old.project_id <> new.project_id BEGIN
  update briar_hunt_runs
  set team_id = new.project_id,
      planning_project_id = (
    select project.id
    from briar_planning_projects project
    where project.team_id = new.project_id and project.is_default = 1
  )
  where id = new.id;
END;

-- Canonical read surface for new code while legacy writers continue using
-- briar_hunt_runs.project_id as the Team compatibility alias.
create view briar_issue_hierarchy as
select run.id,
       team.organization_id as workspace_id,
       run.team_id,
       run.planning_project_id as project_id,
       run.run_number,
       run.source,
       run.source_key,
       run.title,
       run.status,
       run.repository,
       run.created_at,
       run.updated_at
from briar_hunt_runs run
join briar_teams team on team.id = run.team_id
join briar_planning_projects project
  on project.id = run.planning_project_id
 and project.team_id = run.team_id;

-- Team moves issue a new key but retain the former key as a durable alias for
-- old deep links and external references.
create table briar_issue_key_aliases (
  team_id text not null references briar_teams (id) on delete cascade,
  issue_key text not null check (length(trim(issue_key)) between 3 and 32),
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  created_at text not null,
  primary key (team_id, issue_key)
);
create index briar_issue_key_aliases_run_idx
  on briar_issue_key_aliases (run_id, created_at, team_id);

-- Every newly created Team gets one default Project, including Teams created
-- through the legacy execution-boundary write path and copied by sync.
create trigger briar_teams_create_default_project_after_insert
after insert on briar_teams BEGIN
  insert into briar_planning_projects (
    id, team_id, name, description, status, sort_order, is_default,
    created_at, updated_at
  ) values (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
      '4' || substr(hex(randomblob(2)), 2) || '-' ||
      substr('89ab', 1 + abs(random()) % 4, 1) ||
      substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    ),
    new.id, 'General', '', 'active', 0, 1, new.created_at, new.updated_at
  );
END;

-- A Project lead is planning metadata, but it must still name a member of the
-- parent Team (Workspace owners/co-owners are Team-authorized globally).
create trigger briar_planning_projects_validate_lead_insert
before insert on briar_planning_projects
when new.lead_user_id is not null BEGIN
  select case when not exists (
    select 1
    from briar_teams team
    join briar_organization_members membership
      on membership.organization_id = team.organization_id
     and membership.user_id = new.lead_user_id
    left join briar_project_members team_membership
      on team_membership.project_id = team.id
     and team_membership.user_id = membership.user_id
    where team.id = new.team_id
      and (
        membership.role in ('owner', 'co-owner')
        or team_membership.user_id is not null
      )
  ) then raise(abort, 'project lead must have access to its team') end;
END;

create trigger briar_planning_projects_validate_lead_update
before update of lead_user_id, team_id on briar_planning_projects
when new.lead_user_id is not null BEGIN
  select case when not exists (
    select 1
    from briar_teams team
    join briar_organization_members membership
      on membership.organization_id = team.organization_id
     and membership.user_id = new.lead_user_id
    left join briar_project_members team_membership
      on team_membership.project_id = team.id
     and team_membership.user_id = membership.user_id
    where team.id = new.team_id
      and (
        membership.role in ('owner', 'co-owner')
        or team_membership.user_id is not null
      )
  ) then raise(abort, 'project lead must have access to its team') end;
END;
