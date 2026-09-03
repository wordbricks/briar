-- User-authored channel and DM messages may attach PDFs. Keep the existing
-- private object storage and metadata bounds, and extend only the persisted
-- channel attachment content-type allowlist.
pragma defer_foreign_keys = on;
pragma legacy_alter_table = on;

alter table briar_channel_message_attachments
  rename to briar_channel_message_attachments_legacy;

create table briar_channel_message_attachments (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'application/pdf'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);

insert into briar_channel_message_attachments
select * from briar_channel_message_attachments_legacy;

drop table briar_channel_message_attachments_legacy;

create index briar_channel_message_attachments_message_idx
  on briar_channel_message_attachments (message_id, created_at, id);
create index briar_channel_message_attachments_channel_idx
  on briar_channel_message_attachments (organization_id, channel_id, message_id);

pragma legacy_alter_table = off;
pragma defer_foreign_keys = off;
pragma foreign_keys = on;
