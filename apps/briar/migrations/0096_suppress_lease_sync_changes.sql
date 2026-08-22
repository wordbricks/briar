-- Lease extension is liveness bookkeeping, not a user-visible entity change.
-- Renewal queries update only lease_expires_at; claims and all semantic writes
-- still update updated_at and therefore continue to publish deltas.
drop trigger if exists briar_dashboard_runs_update_sync;

create trigger briar_dashboard_runs_update_sync
after update on briar_hunt_runs
when old.lease_expires_at is new.lease_expires_at
  or old.updated_at is not new.updated_at
BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

drop trigger if exists briar_channel_changes_reply_jobs_update_sync;

create trigger briar_channel_changes_reply_jobs_update_sync
after update on briar_channel_agent_reply_jobs
when old.lease_expires_at is new.lease_expires_at
  or old.updated_at is not new.updated_at
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'reply_job', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
