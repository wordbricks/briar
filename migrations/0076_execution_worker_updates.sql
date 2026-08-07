pragma foreign_keys = on;

create table briar_execution_worker_update_requests (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  device_id text not null
    references briar_execution_worker_devices (id) on delete cascade,
  requested_by_user_id text not null references "user" (id) on delete cascade,
  target_version text not null check (target_version glob '[0-9]*.[0-9]*.[0-9]*'),
  status text not null default 'requested'
    check (status in ('requested', 'completed', 'cancelled')),
  requested_at text not null,
  updated_at text not null,
  completed_at text
);

create unique index briar_execution_worker_update_requests_pending_idx
  on briar_execution_worker_update_requests (device_id)
  where status = 'requested';

create index briar_execution_worker_update_requests_org_idx
  on briar_execution_worker_update_requests
    (organization_id, status, requested_at desc);
