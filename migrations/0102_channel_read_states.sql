-- Account-scoped channel last-read so desktop, iOS, and Android share
-- the same unread channel names for a signed-in user.
create table briar_channel_read_states (
  user_id text not null references "user"(id) on delete cascade,
  channel_id text not null references briar_channels(id) on delete cascade,
  last_read_at text not null,
  updated_at text not null,
  primary key (user_id, channel_id)
);

create index briar_channel_read_states_channel_idx
  on briar_channel_read_states (channel_id);
