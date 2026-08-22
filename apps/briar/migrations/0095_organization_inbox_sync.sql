pragma foreign_keys = on;

-- A single organization revision lets the Inbox hot path reject unchanged
-- conditional requests before it fans out across every project. The revision
-- is deliberately organization-scoped: it never contains user data, while
-- user-specific notification filtering remains in the authoritative snapshot.
create table briar_organization_inbox_sync_state (
  organization_id text primary key not null,
  current_version integer not null default 0 check (current_version >= 0)
);

-- Keep this derived state outside the organization FK cascade. Child-table
-- delete triggers may advance the revision while an organization deletion is
-- cascading; an FK here would reject those transient writes. The parent's
-- AFTER DELETE trigger removes the final derived row in the same transaction.
create trigger briar_inbox_organizations_delete_sync
after delete on briar_organizations BEGIN
  delete from briar_organization_inbox_sync_state
  where organization_id = old.id;
END;

create trigger briar_inbox_projects_insert_sync
after insert on briar_projects BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_projects_delete_sync
before delete on briar_projects BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (old.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

-- Runs, issue messages, mentions, project metadata, and their derived UI
-- projections already advance the dashboard cursor. Reuse that semantic
-- invalidation instead of attaching another trigger to every source table.
create trigger briar_inbox_dashboard_state_insert_sync
after insert on briar_dashboard_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_dashboard_state_update_sync
after update of current_version on briar_dashboard_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_agent_session_state_insert_sync
after insert on briar_project_agent_session_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_agent_session_state_update_sync
after update of current_version on briar_project_agent_session_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_channel_state_insert_sync
after insert on briar_channel_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_channel_state_update_sync
after update of current_version on briar_channel_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

-- Private-channel membership changes which notifications are visible even
-- when no channel message changes, so invalidate them explicitly.
create trigger briar_inbox_channel_members_insert_sync
after insert on briar_channel_members BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel
  where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_channel_members_delete_sync
before delete on briar_channel_members BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel
  where channel.id = old.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

-- Mention rows are normally written in the same transaction as their message.
-- Tracking them directly also keeps future mention-edit APIs correct.
create trigger briar_inbox_channel_mentions_insert_sync
after insert on briar_channel_message_mentions BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

create trigger briar_inbox_channel_mentions_delete_sync
before delete on briar_channel_message_mentions BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;

-- Inbox notification author names are snapshots of current account names.
create trigger briar_inbox_user_name_update_sync
after update of name on "user"
when new.name <> old.name BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select membership.organization_id, 1
  from briar_organization_members membership
  where membership.user_id = new.id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
