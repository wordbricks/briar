-- Direct messages reuse the channel message, realtime, attachment, and Agent
-- reply infrastructure while remaining a distinct, private conversation kind.
alter table briar_channels add column kind text not null default 'channel'
  check (kind in ('channel', 'dm'));

-- One-to-one conversations use a canonical participant key so retries and
-- concurrent creates resolve to the same durable conversation. Group DMs keep
-- this null because the roster may evolve after creation.
alter table briar_channels add column dm_key text;

create unique index briar_channels_direct_message_key_idx
  on briar_channels (organization_id, dm_key)
  where kind = 'dm' and dm_key is not null;

create index briar_channels_kind_idx
  on briar_channels (organization_id, kind, archived_at, updated_at desc);
