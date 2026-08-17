pragma foreign_keys = on;

-- Channel threads can be subscribed the same way issue conversations are.
-- A thread is the root message plus its one-level replies.
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

create index briar_channel_thread_subscriptions_user_idx
  on briar_channel_thread_subscriptions (
    organization_id, user_id, created_at desc
  );

create index briar_channel_thread_subscriptions_channel_idx
  on briar_channel_thread_subscriptions (channel_id, root_message_id);

-- Recreate the materialized inbox so subscription is a first-class reason.
-- Existing mention and thread_reply rows keep their stored reason.
drop trigger if exists briar_channel_notification_message_insert;
drop trigger if exists briar_channel_notification_mention_insert;
drop trigger if exists briar_channel_notification_mention_delete;

create table briar_channel_notification_inbox_new (
  user_id text not null references "user" (id) on delete cascade,
  organization_id text not null,
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  notification_reason text not null
    check (notification_reason in ('mention', 'thread_reply', 'subscription')),
  created_at text not null,
  primary key (user_id, message_id)
);

insert into briar_channel_notification_inbox_new (
  user_id, organization_id, message_id, notification_reason, created_at
)
select user_id, organization_id, message_id, notification_reason, created_at
from briar_channel_notification_inbox;

drop table briar_channel_notification_inbox;

alter table briar_channel_notification_inbox_new
  rename to briar_channel_notification_inbox;

create index briar_channel_notification_inbox_user_organization_created_idx
  on briar_channel_notification_inbox (
    user_id, organization_id, created_at desc, message_id desc
  );

-- Human authors of a root or reply become subscribers of that thread.
create trigger briar_channel_thread_subscriptions_author_insert
after insert on briar_channel_messages
when new.author_user_id is not null BEGIN
  insert into briar_channel_thread_subscriptions (
    root_message_id, channel_id, organization_id, user_id, created_at
  )
  select coalesce(new.parent_message_id, new.id), new.channel_id,
         channel.organization_id, new.author_user_id, new.created_at
  from briar_channels channel
  join briar_organization_members membership
    on membership.organization_id = channel.organization_id
   and membership.user_id = new.author_user_id
  where channel.id = new.channel_id
  on conflict (root_message_id, user_id) do nothing;
END;

-- Mentioned members join the thread they were pulled into.
create trigger briar_channel_thread_subscriptions_mention_insert
after insert on briar_channel_message_mentions BEGIN
  insert into briar_channel_thread_subscriptions (
    root_message_id, channel_id, organization_id, user_id, created_at
  )
  select coalesce(message.parent_message_id, message.id), message.channel_id,
         channel.organization_id, new.user_id, new.created_at
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  join briar_organization_members membership
    on membership.organization_id = channel.organization_id
   and membership.user_id = new.user_id
  where message.id = new.message_id
  on conflict (root_message_id, user_id) do nothing;
END;

-- A new reply notifies every current subscriber except its author.
-- The root author still receives thread_reply while subscribed. Other
-- subscribers receive subscription. Mentions continue to overwrite this row.
create trigger briar_channel_notification_message_insert
after insert on briar_channel_messages
when new.parent_message_id is not null BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, new.id,
         iif(root.author_user_id = subscription.user_id, 'thread_reply', 'subscription'),
         new.created_at
  from briar_channel_thread_subscriptions subscription
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = new.channel_id
  where subscription.root_message_id = new.parent_message_id
    and (new.author_user_id is null
         or new.author_user_id <> subscription.user_id)
    and julianday(new.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do nothing;
END;

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

-- Removing a mention restores the subscriber reason when the same message
-- is still a thread reply the member should hear about.
create trigger briar_channel_notification_mention_delete
after delete on briar_channel_message_mentions
BEGIN
  delete from briar_channel_notification_inbox
  where user_id = old.user_id and message_id = old.message_id;

  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, message.id,
         iif(root.author_user_id = subscription.user_id, 'thread_reply', 'subscription'),
         message.created_at
  from briar_channel_messages message
  join briar_channel_thread_subscriptions subscription
    on subscription.root_message_id = coalesce(
         message.parent_message_id, message.id
       )
   and subscription.user_id = old.user_id
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = message.channel_id
  where message.id = old.message_id
    and message.parent_message_id is not null
    and (message.author_user_id is null
         or message.author_user_id <> old.user_id)
    and julianday(message.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do nothing;
END;

-- Existing participants start receiving only future notifications.
insert into briar_channel_thread_subscriptions (
  root_message_id, channel_id, organization_id, user_id, created_at
)
select message.id, message.channel_id, channel.organization_id,
       message.author_user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_channel_messages message
join briar_channels channel on channel.id = message.channel_id
join briar_organization_members membership
  on membership.organization_id = channel.organization_id
 and membership.user_id = message.author_user_id
where message.parent_message_id is null
  and message.author_user_id is not null
on conflict (root_message_id, user_id) do nothing;

insert into briar_channel_thread_subscriptions (
  root_message_id, channel_id, organization_id, user_id, created_at
)
select distinct message.parent_message_id, message.channel_id,
       channel.organization_id, message.author_user_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_channel_messages message
join briar_channels channel on channel.id = message.channel_id
join briar_organization_members membership
  on membership.organization_id = channel.organization_id
 and membership.user_id = message.author_user_id
where message.parent_message_id is not null
  and message.author_user_id is not null
on conflict (root_message_id, user_id) do nothing;

insert into briar_channel_thread_subscriptions (
  root_message_id, channel_id, organization_id, user_id, created_at
)
select distinct coalesce(message.parent_message_id, message.id),
       message.channel_id, channel.organization_id, mention.user_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_channel_message_mentions mention
join briar_channel_messages message on message.id = mention.message_id
join briar_channels channel on channel.id = message.channel_id
join briar_organization_members membership
  on membership.organization_id = channel.organization_id
 and membership.user_id = mention.user_id
on conflict (root_message_id, user_id) do nothing;

-- Publish the root message so clients refresh subscriber avatars.
-- Created after backfill so historical rows do not flood the change feed.
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
