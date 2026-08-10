-- Keep device fan-out semantics while avoiding an aggregate over the complete
-- dashboard change history on every worker heartbeat.
drop trigger if exists briar_dashboard_worker_devices_update_sync;

create trigger briar_dashboard_worker_devices_update_sync
after update on briar_execution_worker_devices BEGIN
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
