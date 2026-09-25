-- Index new/changed messages only, per the owner's chosen scope. The initial
-- historical corpus is intentionally not indexed. Never use the FTS rebuild
-- command during migration: it would rewrite every historical message.
-- @statement
create virtual table briar_channel_message_search using fts5(
  body,
  tokenize='trigram'
);

-- @statement
create trigger briar_channel_message_search_insert
  after insert on briar_channel_messages when new.deleted_at is null
begin
  insert into briar_channel_message_search(rowid, body)
  values (new.rowid, new.body);
end;

-- @statement
create trigger briar_channel_message_search_delete
  after delete on briar_channel_messages when old.deleted_at is null
begin
  delete from briar_channel_message_search where rowid = old.rowid;
end;

-- @statement
create trigger briar_channel_message_search_update
  after update of body, deleted_at on briar_channel_messages
begin
  delete from briar_channel_message_search where rowid = old.rowid;
  insert into briar_channel_message_search(rowid, body)
  select new.rowid, new.body where new.deleted_at is null;
end;

-- @statement
create table briar_channel_message_bigrams (
  message_rowid integer not null,
  gram text not null,
  primary key (gram, message_rowid)
) without rowid;

-- @statement
create trigger briar_channel_message_bigrams_insert
  after insert on briar_channel_messages when new.deleted_at is null
begin
  insert or ignore into briar_channel_message_bigrams(message_rowid, gram)
  select new.rowid, lower(substr(new.body, positions.value, 2))
  from json_each('[' || (select group_concat(value) from (
    with recursive positions(value) as (
      select 1 union all select value + 1 from positions
      where value < length(new.body) - 1 and value < 50000
    ) select value from positions
  )) || ']') positions
  where length(lower(substr(new.body, positions.value, 2))) = 2;
end;

-- @statement
create trigger briar_channel_message_bigrams_delete
  after delete on briar_channel_messages
begin
  delete from briar_channel_message_bigrams where message_rowid = old.rowid;
end;

-- @statement
create trigger briar_channel_message_bigrams_update
  after update of body, deleted_at on briar_channel_messages
begin
  delete from briar_channel_message_bigrams where message_rowid = old.rowid;
  insert or ignore into briar_channel_message_bigrams(message_rowid, gram)
  select new.rowid, lower(substr(new.body, positions.value, 2))
  from json_each('[' || (select group_concat(value) from (
    with recursive positions(value) as (
      select 1 union all select value + 1 from positions
      where value < length(new.body) - 1 and value < 50000
    ) select value from positions
  )) || ']') positions
  where new.deleted_at is null and length(lower(substr(new.body, positions.value, 2))) = 2;
end;
