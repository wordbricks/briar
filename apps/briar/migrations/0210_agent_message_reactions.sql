-- Allow a channel reaction to be authored by a Briar Agent as well as a user.
-- Existing user reactions are copied unchanged. Partial unique indexes keep the
-- old (message, user, emoji) identity and add the corresponding Agent identity.

pragma defer_foreign_keys = on;

drop trigger if exists "briar_channel_changes_reactions_insert_sync";
drop trigger if exists "briar_channel_changes_reactions_delete_sync";

create table "briar_agent_reaction_backup" as
  select message_id, user_id, emoji, created_at
  from briar_channel_message_reactions;

drop table "briar_channel_message_reactions";

CREATE TABLE briar_channel_message_reactions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  user_id text references "user" (id) on delete cascade,
  agent_id text references briar_project_agents (id) on delete cascade,
  emoji text not null check (
    emoji = trim(emoji)
    and length(emoji) between 1 and 32
  ),
  created_at text not null,
  check ((user_id is not null) + (agent_id is not null) = 1)
);

insert into briar_channel_message_reactions (
  message_id, user_id, agent_id, emoji, created_at
)
select message_id, user_id, null, emoji, created_at
from briar_agent_reaction_backup;

drop table "briar_agent_reaction_backup";

CREATE UNIQUE INDEX briar_channel_message_reactions_user_idx
  on briar_channel_message_reactions (message_id, user_id, emoji)
  where user_id is not null;

CREATE UNIQUE INDEX briar_channel_message_reactions_agent_idx
  on briar_channel_message_reactions (message_id, agent_id, emoji)
  where agent_id is not null;

CREATE INDEX briar_channel_message_reactions_message_idx
  on briar_channel_message_reactions (message_id, created_at, emoji);

CREATE TRIGGER briar_channel_changes_reactions_insert_sync
after insert on briar_channel_message_reactions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, message.channel_id, 'message', new.message_id,
           'upsert', datetime('now')
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_changes_reactions_delete_sync
after delete on briar_channel_message_reactions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, message.channel_id, 'message', old.message_id,
           'upsert', datetime('now')
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;
