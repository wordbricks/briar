pragma foreign_keys = on;

-- Migration 0149 reserves briar_issue_hierarchy for the canonical issue read
-- projection, so parent/child edges live in a dedicated link table.
create table briar_issue_parent_links (
  project_id text not null references briar_projects (id) on delete cascade,
  parent_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  child_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (child_run_id),
  check (parent_run_id <> child_run_id)
);

create index briar_issue_parent_links_parent_idx
  on briar_issue_parent_links (project_id, parent_run_id, created_at);

create index briar_issue_parent_links_child_idx
  on briar_issue_parent_links (project_id, child_run_id, created_at);

create table briar_issue_relations (
  project_id text not null references briar_projects (id) on delete cascade,
  first_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  second_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  relation_type text not null default 'related'
    check (relation_type = 'related'),
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (first_run_id, second_run_id),
  check (first_run_id < second_run_id)
);

create index briar_issue_relations_first_idx
  on briar_issue_relations (project_id, first_run_id, created_at);

create index briar_issue_relations_second_idx
  on briar_issue_relations (project_id, second_run_id, created_at);

-- Repository checks produce user-facing outcomes. Database checks remain the
-- final guard against cross-project links and hierarchy cycles from any writer.
create trigger briar_issue_hierarchy_validate_insert
before insert on briar_issue_parent_links BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs parent
    where parent.id = new.parent_run_id and parent.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs child
    where child.id = new.child_run_id and child.project_id = new.project_id
  ) then raise(abort, 'issue hierarchy endpoints must belong to the project') end;
  select case when exists (
    with recursive descendants(run_id) as (
      values (new.child_run_id)
      union
      select hierarchy.child_run_id
      from briar_issue_parent_links hierarchy
      join descendants on descendants.run_id = hierarchy.parent_run_id
      where hierarchy.project_id = new.project_id
    )
    select 1 from descendants where run_id = new.parent_run_id
  ) then raise(abort, 'issue hierarchy would create a cycle') end;
END;

create trigger briar_issue_hierarchy_validate_update
before update of project_id, parent_run_id, child_run_id
on briar_issue_parent_links BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs parent
    where parent.id = new.parent_run_id and parent.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs child
    where child.id = new.child_run_id and child.project_id = new.project_id
  ) then raise(abort, 'issue hierarchy endpoints must belong to the project') end;
  select case when exists (
    with recursive descendants(run_id) as (
      values (new.child_run_id)
      union
      select hierarchy.child_run_id
      from briar_issue_parent_links hierarchy
      join descendants on descendants.run_id = hierarchy.parent_run_id
      where hierarchy.project_id = new.project_id
        and hierarchy.child_run_id <> old.child_run_id
    )
    select 1 from descendants where run_id = new.parent_run_id
  ) then raise(abort, 'issue hierarchy would create a cycle') end;
END;

create trigger briar_issue_relations_validate_insert
before insert on briar_issue_relations BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs first_run
    where first_run.id = new.first_run_id
      and first_run.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs second_run
    where second_run.id = new.second_run_id
      and second_run.project_id = new.project_id
  ) then raise(abort, 'related issue endpoints must belong to the project') end;
END;

create trigger briar_issue_relations_validate_update
before update of project_id, first_run_id, second_run_id
on briar_issue_relations BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs first_run
    where first_run.id = new.first_run_id
      and first_run.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs second_run
    where second_run.id = new.second_run_id
      and second_run.project_id = new.project_id
  ) then raise(abort, 'related issue endpoints must belong to the project') end;
END;

create trigger briar_dashboard_hierarchy_insert_sync
after insert on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.parent_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_hierarchy_update_sync
after update on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.parent_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.child_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.parent_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_hierarchy_delete_sync
before delete on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.parent_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_relations_insert_sync
after insert on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.first_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_relations_update_sync
after update on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.first_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.second_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.first_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_relations_delete_sync
before delete on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.first_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
