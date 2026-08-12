pragma foreign_keys = on;

create table briar_issue_subscriptions (
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  primary key (run_id, user_id)
);

create index briar_issue_subscriptions_user_run_idx
  on briar_issue_subscriptions (user_id, run_id);

-- Subscription changes affect both the issue-header avatars and the
-- user-specific Inbox projection. Publishing a run delta also advances the
-- organization Inbox revision through the existing dashboard-state bridge.
create trigger briar_dashboard_issue_subscriptions_insert_sync
after insert on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;

create trigger briar_dashboard_issue_subscriptions_delete_sync
before delete on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = old.run_id
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;

-- Leaving an organization removes manual subscriptions to its issues. The
-- assignee relationship is cleared by the existing member-removal flow.
create trigger briar_issue_subscriptions_member_delete_cleanup
before delete on briar_organization_members BEGIN
  delete from briar_issue_subscriptions
  where user_id = old.user_id
    and run_id in (
      select run.id
      from briar_hunt_runs run
      join briar_projects project on project.id = run.project_id
      where project.organization_id = old.organization_id
    );
END;
