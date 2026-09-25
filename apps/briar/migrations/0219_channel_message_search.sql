-- Index only new/changed messages. Historical rows require a separately approved
-- backfill after measuring production D1 row counts. Never use the FTS rebuild
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
