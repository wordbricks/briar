-- Heartbeats update timestamps every minute. Publish dashboard deltas only
-- when a device or project binding value visible to clients actually changes.
drop trigger if exists briar_dashboard_workers_update_sync;

create trigger briar_dashboard_workers_update_sync
after update on briar_execution_workers
when old.project_id is not new.project_id
  or old.device_id is not new.device_id
  or old.label is not new.label
  or old.host_fingerprint is not new.host_fingerprint
  or old.agent_provider is not new.agent_provider
  or old.versions_json is not new.versions_json
  or old.capabilities_json is not new.capabilities_json
  or old.state is not new.state
  or old.accepting_work is not new.accepting_work
  or old.readiness_state is not new.readiness_state
  or old.readiness_detail is not new.readiness_detail
BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

drop trigger if exists briar_dashboard_worker_devices_update_sync;

-- Preserve the indexed, per-project latest-version lookup introduced in 0081.
create trigger briar_dashboard_worker_devices_update_sync
after update on briar_execution_worker_devices
when old.organization_id is not new.organization_id
  or old.owner_user_id is not new.owner_user_id
  or old.label is not new.label
  or old.device_identity_hash is not new.device_identity_hash
  or old.state is not new.state
  or old.max_concurrent_sessions is not new.max_concurrent_sessions
  or old.icon_type is not new.icon_type
  or old.icon_value is not new.icon_value
BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'worker', id, 'upsert', datetime('now')
    from briar_execution_workers where device_id = new.id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select worker.project_id, (
      select change.version
        from briar_dashboard_changes change
       where change.project_id = worker.project_id
       order by change.version desc
       limit 1
    )
    from briar_execution_workers worker
   where worker.device_id = new.id
  on conflict (project_id) do update set current_version =
    max(briar_dashboard_sync_state.current_version, excluded.current_version);
END;
