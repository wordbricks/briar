create table briar_managed_computer_remote_sessions (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  managed_computer_id text not null
    references briar_managed_computers (id) on delete cascade,
  controller_user_id text not null references "user" (id) on delete restrict,
  request_id text not null check (length(trim(request_id)) between 1 and 200),
  state text not null default 'created' check (state in (
    'created', 'connecting', 'connected', 'disconnected', 'ended', 'expired',
    'rejected'
  )),
  client_token_hash text not null check (
    length(client_token_hash) = 64
    and client_token_hash not glob '*[^0-9a-f]*'
  ),
  token_expires_at text not null,
  token_consumed_at text,
  connection_generation integer not null default 1
    check (connection_generation between 1 and 10000),
  max_expires_at text not null,
  connected_at text,
  disconnected_at text,
  ended_at text,
  end_reason text check (
    end_reason is null or length(trim(end_reason)) between 1 and 120
  ),
  controller_bytes integer not null default 0 check (controller_bytes >= 0),
  screen_bytes integer not null default 0 check (screen_bytes >= 0),
  created_at text not null,
  updated_at text not null,
  unique (organization_id, controller_user_id, request_id)
);

create unique index briar_managed_computer_remote_sessions_controller_idx
  on briar_managed_computer_remote_sessions (managed_computer_id)
  where state in ('created', 'connecting', 'connected', 'disconnected');

create index briar_managed_computer_remote_sessions_organization_idx
  on briar_managed_computer_remote_sessions (organization_id, created_at desc);

create index briar_managed_computer_remote_sessions_user_rate_idx
  on briar_managed_computer_remote_sessions
    (controller_user_id, created_at desc);

create index briar_managed_computer_remote_sessions_expiry_idx
  on briar_managed_computer_remote_sessions (state, max_expires_at);

create table briar_managed_computer_remote_audit_events (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  managed_computer_id text not null
    references briar_managed_computers (id) on delete cascade,
  remote_session_id text
    references briar_managed_computer_remote_sessions (id) on delete set null,
  actor_user_id text references "user" (id) on delete set null,
  action text not null check (action in (
    'session_created', 'reconnect_issued', 'client_connected',
    'client_disconnected', 'session_ended', 'session_expired',
    'connection_rejected'
  )),
  reason_code text check (
    reason_code is null or length(trim(reason_code)) between 1 and 120
  ),
  controller_bytes integer not null default 0 check (controller_bytes >= 0),
  screen_bytes integer not null default 0 check (screen_bytes >= 0),
  occurred_at text not null
);

create index briar_managed_computer_remote_audit_computer_idx
  on briar_managed_computer_remote_audit_events
    (managed_computer_id, occurred_at desc);

create index briar_managed_computer_remote_audit_session_idx
  on briar_managed_computer_remote_audit_events
    (remote_session_id, occurred_at desc);
