pragma foreign_keys = on;

create table briar_dashboard_sync_state (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  current_version integer not null default 0 check (current_version >= 0)
);

create table briar_dashboard_changes (
  version integer primary key autoincrement,
  project_id text not null references briar_projects (id) on delete cascade,
  entity_type text not null check (entity_type in (
    'run', 'worker', 'notifications', 'metadata'
  )),
  entity_id text,
  operation text not null check (operation in ('upsert', 'delete', 'replace')),
  created_at text not null
);

create index briar_dashboard_changes_project_version_idx
  on briar_dashboard_changes (project_id, version);
create index briar_dashboard_changes_created_idx
  on briar_dashboard_changes (created_at);

create trigger briar_dashboard_runs_insert_sync
after insert on briar_hunt_runs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_runs_update_sync
after update on briar_hunt_runs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_runs_delete_sync
before delete on briar_hunt_runs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_events_insert_sync
after insert on briar_hunt_events begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_events_update_sync
after update on briar_hunt_events begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_events_delete_sync
after delete on briar_hunt_events begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', old.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_attachments_insert_sync
after insert on briar_issue_attachments begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_attachments_delete_sync
after delete on briar_issue_attachments begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_workers_insert_sync
after insert on briar_execution_workers begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_workers_update_sync
after update on briar_execution_workers begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_workers_delete_sync
before delete on briar_execution_workers begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'worker', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_worker_devices_update_sync
after update on briar_execution_worker_devices begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'worker', id, 'upsert', datetime('now')
    from briar_execution_workers where device_id = new.id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, max(version)
    from briar_dashboard_changes
   where entity_type = 'worker'
     and entity_id in (select id from briar_execution_workers where device_id = new.id)
   group by project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_settings_update_sync
after update on briar_project_settings begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_projects_update_sync
after update on briar_projects begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.id, 'metadata', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_worker_policy_insert_sync
after insert on briar_project_execution_worker_policies begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_worker_policy_update_sync
after update on briar_project_execution_worker_policies begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_worker_allowlist_insert_sync
after insert on briar_project_execution_worker_allowlist begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_worker_allowlist_delete_sync
after delete on briar_project_execution_worker_allowlist begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'metadata', old.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_messages_insert_sync
after insert on briar_issue_messages begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_messages_update_sync
after update on briar_issue_messages begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_messages_delete_sync
before delete on briar_issue_messages begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'notifications', old.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_mentions_insert_sync
after insert on briar_issue_message_mentions begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select message.project_id, 'notifications', new.message_id, 'replace', datetime('now')
    from briar_issue_messages message where message.id = new.message_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select message.project_id, last_insert_rowid()
    from briar_issue_messages message where message.id = new.message_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_mentions_delete_sync
after delete on briar_issue_message_mentions begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select message.project_id, 'notifications', old.message_id, 'replace', datetime('now')
    from briar_issue_messages message where message.id = old.message_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select message.project_id, last_insert_rowid()
    from briar_issue_messages message where message.id = old.message_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_dependencies_insert_sync
after insert on briar_issue_dependencies begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.prerequisite_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.dependent_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_dependencies_delete_sync
before delete on briar_issue_dependencies begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.prerequisite_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.dependent_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_members_insert_sync
after insert on briar_organization_members begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', new.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = new.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = new.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_members_update_sync
after update on briar_organization_members begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', new.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = new.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = new.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;

create trigger briar_dashboard_members_delete_sync
after delete on briar_organization_members begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', old.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = old.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = old.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
end;
