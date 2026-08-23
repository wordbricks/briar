pragma foreign_keys = on;

-- Organization-scoped machine identity. The existing
-- briar_execution_workers table remains the project binding referenced by
-- runs and transcripts.
create table briar_execution_worker_devices (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  owner_user_id text not null references "user" (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 100),
  device_identity_hash text not null check (
    length(device_identity_hash) = 64
    and device_identity_hash not glob '*[^0-9a-f]*'
  ),
  state text not null check (state in ('online', 'stale', 'disabled')),
  last_heartbeat_at text not null,
  created_at text not null,
  updated_at text not null,
  unique (organization_id, device_identity_hash)
);

create index briar_execution_worker_devices_owner_idx
  on briar_execution_worker_devices
    (owner_user_id, organization_id, last_heartbeat_at desc);

alter table briar_execution_workers add column device_id text
  references briar_execution_worker_devices (id) on delete cascade;

-- Preserve registrations created before device-scoped credentials existed.
-- They must be explicitly re-enrolled before they receive a credential.
insert into briar_execution_worker_devices (
  id, organization_id, owner_user_id, label, device_identity_hash, state,
  last_heartbeat_at, created_at, updated_at
)
select worker.id, project.organization_id, project.owner_user_id, worker.label,
       worker.host_fingerprint, worker.state, worker.last_heartbeat_at,
       worker.created_at, worker.updated_at
from briar_execution_workers worker
join briar_projects project on project.id = worker.project_id;

update briar_execution_workers
set device_id = id
where device_id is null;

create unique index briar_execution_workers_project_device_idx
  on briar_execution_workers (project_id, device_id);

create index briar_execution_workers_device_idx
  on briar_execution_workers (device_id, project_id);

-- One active credential per physical worker. Re-enrollment rotates it
-- atomically; only the hash is stored.
create table briar_execution_worker_credentials (
  device_id text primary key not null
    references briar_execution_worker_devices (id) on delete cascade,
  token_hash text not null unique check (
    length(token_hash) = 64
    and token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null,
  last_used_at text,
  expires_at text,
  revoked_at text
);

create index briar_execution_worker_credentials_expiry_idx
  on briar_execution_worker_credentials (expires_at, revoked_at);
