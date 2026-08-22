create table briar_issue_message_mentions (
  message_id text not null references briar_issue_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  primary key (message_id, user_id)
);

create index briar_issue_message_mentions_user_idx
  on briar_issue_message_mentions (user_id, created_at desc, message_id);
