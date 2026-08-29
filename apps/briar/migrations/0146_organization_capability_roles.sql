-- Replace the coarse admin/member model without reducing existing access.
-- Existing admins become co-owners. Existing members become developers because
-- members could already write and execute issues in assigned projects.
pragma foreign_keys = off;
pragma legacy_alter_table = on;

-- These tables have composite foreign keys to organization membership. Move
-- them out of the way before rebuilding the parent so SQLite cannot retain a
-- reference to the temporary legacy table name.
alter table briar_project_members
  rename to briar_project_members_role_legacy;
alter table briar_issue_subscriptions
  rename to briar_issue_subscriptions_role_legacy;
alter table briar_channel_thread_subscriptions
  rename to briar_channel_thread_subscriptions_role_legacy;

alter table briar_organization_members
  rename to briar_organization_members_legacy;

create table briar_organization_members (
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  role text not null check (
    role in ('owner', 'co-owner', 'developer', 'editor', 'viewer')
  ),
  created_at text not null,
  updated_at text not null,
  primary key (organization_id, user_id)
);

insert into briar_organization_members (
  organization_id, user_id, role, created_at, updated_at
)
select organization_id, user_id,
       case role
         when 'admin' then 'co-owner'
         when 'member' then 'developer'
         else role
       end,
       created_at, updated_at
from briar_organization_members_legacy;

drop table briar_organization_members_legacy;

create index briar_organization_members_user_idx
  on briar_organization_members (user_id, organization_id);

create trigger briar_dashboard_members_insert_sync
after insert on briar_organization_members BEGIN
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
END;

create trigger briar_dashboard_members_update_sync
after update on briar_organization_members BEGIN
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
END;

create trigger briar_dashboard_members_delete_sync
after delete on briar_organization_members BEGIN
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
END;

create trigger briar_issue_execution_org_member_remove_invalidate
after delete on briar_organization_members
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where organization_id = old.organization_id and status = 'pending'
    and approval_reserved_by_user_id = old.user_id;
END;

create trigger briar_agent_skill_execution_worker_membership_reconcile
before delete on briar_organization_members
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker owner lost organization access.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select worker.id
      from briar_execution_workers worker
      join briar_execution_worker_devices device on device.id = worker.device_id
      where device.organization_id = old.organization_id
        and device.owner_user_id = old.user_id
    );
END;

create table briar_project_members (
  project_id text not null,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  updated_at text not null,
  primary key (project_id, user_id),
  foreign key (project_id, organization_id)
    references briar_projects (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);

insert into briar_project_members
select * from briar_project_members_role_legacy;

drop table briar_project_members_role_legacy;

create index briar_project_members_user_idx
  on briar_project_members (user_id, project_id);

create trigger briar_project_members_insert_sync
after insert on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;

create trigger briar_project_members_delete_sync
before delete on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;

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

insert into briar_issue_subscriptions
select * from briar_issue_subscriptions_role_legacy;

drop table briar_issue_subscriptions_role_legacy;

create index briar_issue_subscriptions_user_idx
  on briar_issue_subscriptions (organization_id, user_id, created_at desc);

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

create table briar_channel_thread_subscriptions (
  root_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  channel_id text not null
    references briar_channels (id) on delete cascade,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  primary key (root_message_id, user_id),
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);

insert into briar_channel_thread_subscriptions
select * from briar_channel_thread_subscriptions_role_legacy;

drop table briar_channel_thread_subscriptions_role_legacy;

create index briar_channel_thread_subscriptions_user_idx
  on briar_channel_thread_subscriptions (
    organization_id, user_id, created_at desc
  );

create index briar_channel_thread_subscriptions_channel_idx
  on briar_channel_thread_subscriptions (channel_id, root_message_id);

create trigger briar_channel_thread_subscriptions_insert_sync
after insert on briar_channel_thread_subscriptions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'message', new.root_message_id,
    'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;

create trigger briar_channel_thread_subscriptions_delete_sync
before delete on briar_channel_thread_subscriptions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    old.organization_id, old.channel_id, 'message', old.root_message_id,
    'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (old.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;

alter table briar_organization_invitations
  rename to briar_organization_invitations_legacy;

create table briar_organization_invitations (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  initial_project_id text not null
    references briar_projects (id) on delete cascade,
  email_normalized text not null
    check (
      length(email_normalized) between 3 and 320
      and email_normalized = lower(trim(email_normalized))
    ),
  role text not null check (
    role in ('co-owner', 'developer', 'editor', 'viewer')
  ),
  token_hash text not null unique check (
    length(token_hash) = 64
    and token_hash not glob '*[^0-9a-f]*'
  ),
  invited_by_user_id text references "user" (id) on delete set null,
  expires_at text not null,
  accepted_at text,
  accepted_by_user_id text references "user" (id) on delete set null,
  revoked_at text,
  created_at text not null,
  updated_at text not null,
  check (accepted_at is null or revoked_at is null)
);

insert into briar_organization_invitations (
  id, organization_id, initial_project_id, email_normalized, role,
  token_hash, invited_by_user_id, expires_at, accepted_at,
  accepted_by_user_id, revoked_at, created_at, updated_at
)
select id, organization_id, initial_project_id, email_normalized,
       case role
         when 'admin' then 'co-owner'
         when 'member' then 'developer'
         else role
       end,
       token_hash, invited_by_user_id, expires_at, accepted_at,
       accepted_by_user_id, revoked_at, created_at, updated_at
from briar_organization_invitations_legacy;

drop table briar_organization_invitations_legacy;

create index briar_organization_invitations_org_idx
  on briar_organization_invitations (
    organization_id, accepted_at, revoked_at, created_at desc
  );

create index briar_organization_invitations_email_idx
  on briar_organization_invitations (
    email_normalized, accepted_at, revoked_at, expires_at
  );

create unique index briar_organization_invitations_pending_idx
  on briar_organization_invitations (organization_id, email_normalized)
  where accepted_at is null and revoked_at is null;

pragma legacy_alter_table = off;
pragma foreign_keys = on;
