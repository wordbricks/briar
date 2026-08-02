pragma foreign_keys = on;

create table briar_issue_result_reviews (
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  reviewer_user_id text not null references "user" (id) on delete cascade,
  completed_at text not null,
  primary key (run_id, reviewer_user_id)
);

create index briar_issue_result_reviews_completed_idx
  on briar_issue_result_reviews (completed_at desc);

create trigger briar_issue_result_reviews_insert_sync
after insert on briar_issue_result_reviews BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
      from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid()
    from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_issue_result_reviews_delete_sync
after delete on briar_issue_result_reviews BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', old.run_id, 'upsert', datetime('now')
      from briar_hunt_runs where id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid()
    from briar_hunt_runs where id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
