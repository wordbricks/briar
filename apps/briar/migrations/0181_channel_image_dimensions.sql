pragma foreign_keys = on;

-- Add optional image dimensions to upload rows so they can be propagated
-- to channel message attachment records for layout-shift prevention.
alter table briar_uploads add column image_width integer check (
  image_width is null or (typeof(image_width) = 'integer' and image_width > 0)
);
alter table briar_uploads add column image_height integer check (
  image_height is null or (typeof(image_height) = 'integer' and image_height > 0)
);

-- Add optional image dimensions to stored channel message attachments.
-- Populated for image attachments uploaded after this migration.
alter table briar_channel_message_attachments add column image_width integer check (
  image_width is null or (typeof(image_width) = 'integer' and image_width > 0)
);
alter table briar_channel_message_attachments add column image_height integer check (
  image_height is null or (typeof(image_height) = 'integer' and image_height > 0)
);
