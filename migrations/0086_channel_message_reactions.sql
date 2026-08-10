-- Emoji reactions on channel messages. One user can leave many distinct emoji
-- on a single message; repeating the same emoji is a no-op at the API layer
-- (toggle off) because the primary key is (message_id, user_id, emoji).
-- Reaction changes re-emit a message upsert on the channel delta feed so
-- clients refresh the whole message payload without a separate entity type.
pragma defer_foreign_keys = on;

create table briar_channel_message_reactions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  emoji text not null check (
    emoji = trim(emoji)
    and length(emoji) between 1 and 32
  ),
  created_at text not null,
  primary key (message_id, user_id, emoji)
);

create index briar_channel_message_reactions_message_idx
  on briar_channel_message_reactions (message_id, created_at, emoji);

create trigger briar_channel_changes_reactions_insert_sync
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
END;

create trigger briar_channel_changes_reactions_delete_sync
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
END;

pragma defer_foreign_keys = off;
