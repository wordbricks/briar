-- Attribute expensive Worker binding deletion cascades to an explicit
-- lifecycle request. Identifiers and D1 query counters are sufficient for
-- diagnosis; credentials, tokens, request bodies, and free-form errors do not
-- belong in this table.
create table briar_execution_worker_lifecycle_events (
  request_id text primary key not null check (
    request_id = trim(request_id) and length(request_id) between 1 and 200
  ),
  organization_id text not null,
  project_id text,
  device_id text not null,
  worker_id text,
  operation text not null check (
    operation in ('binding_delete', 'device_delete', 'binding_preserved')
  ),
  reason text not null check (
    reason in (
      'explicit_user_unlink', 'explicit_user_deprovision',
      'managed_deprovision', 'restart', 'update'
    )
  ),
  outcome text not null check (
    outcome in ('started', 'deleted', 'preserved', 'blocked', 'failed')
  ),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  hard_delete_rows_read integer not null default 0
    check (hard_delete_rows_read >= 0),
  hard_delete_rows_written integer not null default 0
    check (hard_delete_rows_written >= 0),
  detail_json text not null default '{}' check (
    json_valid(detail_json) and json_type(detail_json) = 'object'
  ),
  created_at text not null,
  updated_at text not null,
  completed_at text
);

create index briar_execution_worker_lifecycle_reason_idx
  on briar_execution_worker_lifecycle_events (
    reason, operation, created_at desc
  );

create index briar_execution_worker_lifecycle_device_idx
  on briar_execution_worker_lifecycle_events (device_id, created_at desc);
