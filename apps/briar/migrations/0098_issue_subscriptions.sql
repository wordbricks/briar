pragma foreign_keys = on;

create table briar_issue_subscriptions (
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  primary key (run_id, user_id),
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);

create index briar_issue_subscriptions_user_idx
  on briar_issue_subscriptions (organization_id, user_id, created_at desc);

create trigger briar_issue_subscriptions_run_insert
after insert on briar_hunt_runs
when new.assignee_user_id is not null BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.assignee_user_id, new.started_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.assignee_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;

create trigger briar_issue_subscriptions_assignee_update
after update of assignee_user_id on briar_hunt_runs
when new.assignee_user_id is not null
  and new.assignee_user_id is not old.assignee_user_id BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.assignee_user_id, new.updated_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.assignee_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;

create trigger briar_issue_subscriptions_insert_sync
after insert on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_issue_subscriptions_delete_sync
before delete on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

-- Existing assignees begin receiving only future notifications when this
-- migration lands. The sync trigger also publishes their subscriber avatars
-- to clients that already hold a dashboard cursor.
insert into briar_issue_subscriptions (
  run_id, organization_id, user_id, created_at
)
select run.id, project.organization_id, run.assignee_user_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_hunt_runs run
join briar_projects project on project.id = run.project_id
join briar_organization_members membership
  on membership.organization_id = project.organization_id
 and membership.user_id = run.assignee_user_id
where run.assignee_user_id is not null
on conflict (run_id, user_id) do nothing;
