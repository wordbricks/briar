-- HTML artifacts are persisted through the same attachment tables as images.
-- Rebuild both tables so the application allowlist and D1 content-type checks
-- accept the text/html files produced by agent replies.
pragma defer_foreign_keys = on;
pragma legacy_alter_table = on;

alter table briar_issue_attachments rename to briar_issue_attachments_legacy;

create table briar_issue_attachments (
  id text primary key not null,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'video/mp4', 'video/webm', 'video/quicktime'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);

insert into briar_issue_attachments
select * from briar_issue_attachments_legacy;

drop table briar_issue_attachments_legacy;

create index briar_issue_attachments_run_idx
  on briar_issue_attachments (run_id, created_at, id);
create index briar_issue_attachments_project_idx
  on briar_issue_attachments (project_id, run_id);

create trigger briar_dashboard_attachments_insert_sync
after insert on briar_issue_attachments BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_attachments_delete_sync
after delete on briar_issue_attachments BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

alter table briar_channel_message_attachments
  rename to briar_channel_message_attachments_legacy;

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
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);

insert into briar_channel_message_attachments
select * from briar_channel_message_attachments_legacy;

drop table briar_channel_message_attachments_legacy;

create index briar_channel_message_attachments_message_idx
  on briar_channel_message_attachments (message_id, created_at, id);
create index briar_channel_message_attachments_channel_idx
  on briar_channel_message_attachments (organization_id, channel_id, message_id);

pragma legacy_alter_table = off;
pragma defer_foreign_keys = off;
