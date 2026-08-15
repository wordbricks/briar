pragma foreign_keys = on;

-- Materialize only notification targeting. Message, author, and channel fields
-- remain authoritative in their source tables so edits and visibility changes
-- are reflected without rewriting this projection.
create table briar_channel_notification_inbox (
  user_id text not null references "user" (id) on delete cascade,
  organization_id text not null,
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  notification_reason text not null
    check (notification_reason in ('mention', 'thread_reply')),
  created_at text not null,
  primary key (user_id, message_id)
);

create index briar_channel_notification_inbox_user_organization_created_idx
  on briar_channel_notification_inbox (
    user_id, organization_id, created_at desc, message_id desc
  );

-- Preserve existing notifications. Insert thread replies first so an explicit
-- mention can take precedence when the same message qualifies for both.
insert into briar_channel_notification_inbox (
  user_id, organization_id, message_id, notification_reason, created_at
)
select root.author_user_id, channel.organization_id, message.id,
       'thread_reply', message.created_at
from briar_channel_messages message
join briar_channel_messages root
  on root.id = message.parent_message_id
 and root.channel_id = message.channel_id
join briar_channels channel on channel.id = message.channel_id
where root.author_user_id is not null
  and (message.author_user_id is null
       or message.author_user_id <> root.author_user_id)
on conflict (user_id, message_id) do nothing;

insert into briar_channel_notification_inbox (
  user_id, organization_id, message_id, notification_reason, created_at
)
select mention.user_id, channel.organization_id, message.id,
       'mention', message.created_at
from briar_channel_message_mentions mention
join briar_channel_messages message on message.id = mention.message_id
join briar_channels channel on channel.id = message.channel_id
where message.author_user_id is null
   or message.author_user_id <> mention.user_id
on conflict (user_id, message_id) do update set
  organization_id = excluded.organization_id,
  notification_reason = 'mention',
  created_at = excluded.created_at;

-- Every message producer writes through briar_channel_messages, including
-- agent and webhook replies, so this trigger covers all future thread replies.
create trigger briar_channel_notification_message_insert
after insert on briar_channel_messages
when new.parent_message_id is not null
BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select root.author_user_id, channel.organization_id, new.id,
         'thread_reply', new.created_at
  from briar_channel_messages root
  join briar_channels channel on channel.id = new.channel_id
  where root.id = new.parent_message_id
    and root.channel_id = new.channel_id
    and root.author_user_id is not null
    and (new.author_user_id is null
         or new.author_user_id <> root.author_user_id)
  on conflict (user_id, message_id) do nothing;
END;

-- Mention rows are written after their message. An explicit mention wins over
-- the thread-reply reason, matching the previous CASE expression.
create trigger briar_channel_notification_mention_insert
after insert on briar_channel_message_mentions
BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select new.user_id, channel.organization_id, message.id,
         'mention', message.created_at
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
    and (message.author_user_id is null
         or message.author_user_id <> new.user_id)
  on conflict (user_id, message_id) do update set
    organization_id = excluded.organization_id,
    notification_reason = 'mention',
    created_at = excluded.created_at;
END;

-- Future mention-edit APIs may delete and recreate mention rows. Remove the
-- mention projection and restore the thread-reply reason when it still applies.
create trigger briar_channel_notification_mention_delete
after delete on briar_channel_message_mentions
BEGIN
  delete from briar_channel_notification_inbox
  where user_id = old.user_id and message_id = old.message_id;

  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select root.author_user_id, channel.organization_id, message.id,
         'thread_reply', message.created_at
  from briar_channel_messages message
  join briar_channel_messages root
    on root.id = message.parent_message_id
   and root.channel_id = message.channel_id
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
    and root.author_user_id = old.user_id
    and (message.author_user_id is null
         or message.author_user_id <> old.user_id)
  on conflict (user_id, message_id) do nothing;
END;
