-- Widen channel/DM attachment types while retaining every existing row.
-- This leaf table has no foreign-key descendants or attached triggers.
-- Keep its name stable so the scoped upload ownership trigger remains intact.
pragma defer_foreign_keys = on;

create table briar_channel_text_attachment_backup as
select * from briar_channel_message_attachments;

drop table briar_channel_message_attachments;

CREATE TABLE briar_channel_message_attachments (
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
    'image/svg+xml', 'text/html', 'application/pdf', 'text/markdown', 'text/plain'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
, image_width integer check (
  image_width is null or (typeof(image_width) = 'integer' and image_width > 0)
), image_height integer check (
  image_height is null or (typeof(image_height) = 'integer' and image_height > 0)
));

insert into briar_channel_message_attachments
select * from briar_channel_text_attachment_backup;
drop table briar_channel_text_attachment_backup;

CREATE INDEX briar_channel_message_attachments_message_idx
  on briar_channel_message_attachments (message_id, created_at, id);
CREATE INDEX briar_channel_message_attachments_channel_idx
  on briar_channel_message_attachments (organization_id, channel_id, message_id);

pragma defer_foreign_keys = off;
