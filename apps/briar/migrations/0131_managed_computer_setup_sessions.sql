pragma foreign_keys = on;

-- A signed-in owner requests a short-lived ticket, then the already-enrolled
-- managed computer consumes it with its machine credential. Only the hash is
-- persisted so a database read cannot recover the bearer ticket.
create table briar_managed_computer_setup_sessions (
  id text primary key not null,
  managed_computer_id text not null
    references briar_managed_computers (id) on delete cascade,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  requested_by_user_id text not null references "user" (id) on delete restrict,
  request_id text not null check (length(trim(request_id)) between 1 and 200),
  token_hash text not null unique check (
    length(token_hash) = 64
    and token_hash not glob '*[^0-9a-f]*'
  ),
  status text not null default 'pending'
    check (status in ('pending', 'consumed')),
  expires_at text not null,
  consumed_at text,
  worker_id text references briar_execution_workers (id) on delete set null,
  created_at text not null,
  updated_at text not null,
  unique (managed_computer_id, request_id)
);

create index briar_managed_computer_setup_sessions_expiry_idx
  on briar_managed_computer_setup_sessions (status, expires_at);

create index briar_managed_computer_setup_sessions_computer_idx
  on briar_managed_computer_setup_sessions
    (managed_computer_id, created_at desc);

create index briar_managed_computer_setup_sessions_project_idx
  on briar_managed_computer_setup_sessions (project_id, created_at desc);
