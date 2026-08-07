pragma foreign_keys = on;

-- Channel images live in the same private R2 bucket as issue attachments, but
-- their metadata is scoped to an organization, channel, and message so the
-- download endpoint can re-check channel membership on every request.
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
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);

create index briar_channel_message_attachments_message_idx
  on briar_channel_message_attachments (message_id, created_at, id);

create index briar_channel_message_attachments_channel_idx
  on briar_channel_message_attachments (organization_id, channel_id, message_id);
