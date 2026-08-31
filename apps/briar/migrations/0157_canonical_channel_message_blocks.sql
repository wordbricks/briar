pragma foreign_keys = on;

-- Imported Slack blocks predate Briar's current block contract. The durable
-- plain-text body already contains their readable content, so remove the
-- parallel historical representation instead of carrying a legacy decoder.
update briar_channel_messages
set blocks_json = null
where blocks_json is not null;

-- Effect owns the field-level block contract. D1 only enforces the minimum
-- storage shape needed to keep JSON array traversal well-defined.
create trigger briar_channel_message_blocks_array_insert
before insert on briar_channel_messages
when new.blocks_json is not null
  and json_type(new.blocks_json) <> 'array'
begin
  select raise(abort, 'channel message blocks must be a JSON array');
end;

create trigger briar_channel_message_blocks_array_update
before update of blocks_json on briar_channel_messages
when new.blocks_json is not null
  and json_type(new.blocks_json) <> 'array'
begin
  select raise(abort, 'channel message blocks must be a JSON array');
end;
