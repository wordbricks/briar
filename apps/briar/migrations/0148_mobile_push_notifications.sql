pragma foreign_keys = on;

-- A registration belongs to an account rather than a selected project so one
-- device receives the same organization-wide Inbox updates as the app feed.
create table briar_mobile_push_registrations (
  id text primary key,
  user_id text not null references "user"(id) on delete cascade,
  platform text not null check (platform in ('apns', 'fcm')),
  token text not null,
  environment text not null check (environment in ('development', 'production')),
  topic text not null,
  locale text not null check (locale in ('ko', 'en', 'zh')),
  play_sound integer not null check (play_sound in (0, 1)),
  notify_urgent integer not null check (notify_urgent in (0, 1)),
  notify_action_required integer not null check (notify_action_required in (0, 1)),
  notify_important integer not null check (notify_important in (0, 1)),
  notify_activity integer not null check (notify_activity in (0, 1)),
  registered_at text not null,
  updated_at text not null,
  unique (platform, token)
);

create index briar_mobile_push_registrations_user_idx
  on briar_mobile_push_registrations (user_id, updated_at desc);

create table briar_mobile_push_registration_scopes (
  registration_id text not null
    references briar_mobile_push_registrations(id) on delete cascade,
  organization_id text not null
    references briar_organizations(id) on delete cascade,
  baseline_version integer not null check (baseline_version >= 0),
  registered_at text not null,
  updated_at text not null,
  primary key (registration_id, organization_id)
);

create index briar_mobile_push_registration_scopes_organization_idx
  on briar_mobile_push_registration_scopes (
    organization_id, baseline_version, registration_id
  );

create table briar_mobile_push_deliveries (
  registration_id text not null
    references briar_mobile_push_registrations(id) on delete cascade,
  message_id text not null,
  message_version text not null,
  delivered_at text not null,
  primary key (registration_id, message_id, message_version)
);

create index briar_mobile_push_deliveries_delivered_idx
  on briar_mobile_push_deliveries (delivered_at);

-- Push delivery retries independently from websocket fan-out. A single row per
-- organization coalesces bursts while preserving the newest Inbox revision.
create table briar_mobile_push_outbox (
  -- Match the Inbox sync-state lifecycle: child-table delete triggers may
  -- advance this derived state while an organization cascade is in flight.
  -- The sync-state delete trigger below performs the final cleanup.
  organization_id text primary key,
  version integer not null check (version >= 0),
  updated_at text not null
);

create trigger briar_mobile_push_outbox_sync_insert
after insert on briar_organization_inbox_sync_state BEGIN
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  values (new.organization_id, new.current_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
END;

create trigger briar_mobile_push_outbox_sync_update
after update of current_version on briar_organization_inbox_sync_state
when new.current_version > old.current_version BEGIN
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  values (new.organization_id, new.current_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
END;

create trigger briar_mobile_push_outbox_sync_delete
after delete on briar_organization_inbox_sync_state BEGIN
  delete from briar_mobile_push_outbox
  where organization_id = old.organization_id;
END;
