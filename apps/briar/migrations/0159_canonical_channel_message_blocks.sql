pragma foreign_keys = on;

-- Imported Slack blocks are durable presentation data and previous writes
-- already passed the same Effect block schema. Preserve valid stored arrays;
-- only malformed or unbounded envelopes cannot cross the strict cutover.
update briar_channel_messages
set blocks_json = null
where blocks_json is not null
  and case
    when not json_valid(blocks_json) then 1
    when json_type(blocks_json) <> 'array' then 1
    when json_array_length(blocks_json) not between 1 and 50 then 1
    when length(cast(blocks_json as blob)) > 1048576 then 1
    else 0
  end;

-- Effect owns the field-level block contract. D1 only enforces the minimum
-- storage shape needed to keep JSON array traversal well-defined.
create trigger briar_channel_message_blocks_array_insert
before insert on briar_channel_messages
when new.blocks_json is not null
  and case
    when not json_valid(new.blocks_json) then 1
    when json_type(new.blocks_json) <> 'array' then 1
    when json_array_length(new.blocks_json) not between 1 and 50 then 1
    when length(cast(new.blocks_json as blob)) > 1048576 then 1
    else 0
  end
begin
  select raise(abort, 'channel message blocks must be a bounded JSON array');
end;

create trigger briar_channel_message_blocks_array_update
before update of blocks_json on briar_channel_messages
when new.blocks_json is not null
  and case
    when not json_valid(new.blocks_json) then 1
    when json_type(new.blocks_json) <> 'array' then 1
    when json_array_length(new.blocks_json) not between 1 and 50 then 1
    when length(cast(new.blocks_json as blob)) > 1048576 then 1
    else 0
  end
begin
  select raise(abort, 'channel message blocks must be a bounded JSON array');
end;
