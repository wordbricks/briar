-- Deleted thread roots stay addressable while their replies remain. Messages
-- without replies are removed entirely, so only tombstones need persisted
-- deletion state.
alter table briar_channel_messages add column deleted_at text;

create index briar_channel_messages_deleted_idx
  on briar_channel_messages (channel_id, deleted_at)
  where deleted_at is not null;
