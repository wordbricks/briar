-- Account-scoped inbox read state so desktop, iOS, and Android share
-- the same read/unread versions for a signed-in user.
create table briar_inbox_read_states (
  user_id text not null references "user"(id) on delete cascade,
  message_id text not null,
  version text not null,
  updated_at text not null,
  primary key (user_id, message_id)
);

create index briar_inbox_read_states_user_updated_idx
  on briar_inbox_read_states (user_id, updated_at desc);
