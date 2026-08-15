-- Preserve Slack-compatible presentation blocks on incoming webhook messages.
-- `body` remains the searchable/accessibility fallback for old clients.
alter table briar_channel_messages
  add column blocks_json text check (
    blocks_json is null
    or (json_valid(blocks_json) and length(blocks_json) <= 65536)
  );
