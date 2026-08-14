pragma foreign_keys = on;

-- D1 cannot call the realtime Durable Object from a trigger. Persist the
-- newest organization Inbox revision transactionally, then let the Worker
-- publish and acknowledge it after the originating mutation commits.
create table briar_organization_inbox_realtime_outbox (
  organization_id text primary key not null,
  version integer not null check (version >= 0),
  updated_at text not null
);

create trigger briar_inbox_realtime_state_insert
after insert on briar_organization_inbox_sync_state BEGIN
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  ) values (new.organization_id, new.current_version, datetime('now'))
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

create trigger briar_inbox_realtime_state_update
after update of current_version on briar_organization_inbox_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  ) values (new.organization_id, new.current_version, datetime('now'))
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

create trigger briar_inbox_realtime_state_delete
after delete on briar_organization_inbox_sync_state BEGIN
  delete from briar_organization_inbox_realtime_outbox
  where organization_id = old.organization_id;
END;
