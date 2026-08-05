-- A GitHub App installation can be connected to one Briar organization at a
-- time. Disconnected rows are retained as tombstones so signed deliveries from
-- an App that remains installed on GitHub cannot keep moving Briar workflows.
create table briar_github_connections (
  installation_id integer primary key not null check (installation_id > 0),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  installation_account_id integer not null check (installation_account_id > 0),
  account_login text not null check (
    account_login = trim(account_login)
    and length(account_login) between 1 and 100
  ),
  account_avatar_url text not null check (
    account_avatar_url = trim(account_avatar_url)
    and length(account_avatar_url) between 1 and 1000
    and account_avatar_url like 'https://%'
  ),
  authorized_github_user_id integer not null
    check (authorized_github_user_id > 0),
  authorized_github_user_login text not null check (
    authorized_github_user_login = trim(authorized_github_user_login)
    and length(authorized_github_user_login) between 1 and 100
  ),
  connected_by_user_id text
    references "user" (id) on delete set null,
  status text not null check (status in ('connected', 'disconnected')),
  connected_at text not null,
  disconnected_at text,
  updated_at text not null,
  check (
    (status = 'connected' and disconnected_at is null)
    or (status = 'disconnected' and disconnected_at is not null)
  )
);

create unique index briar_github_connections_active_organization_idx
  on briar_github_connections (organization_id)
  where status = 'connected';

create index briar_github_connections_organization_idx
  on briar_github_connections (organization_id, status, updated_at);

-- Repository access is snapshotted only after a GitHub user access token has
-- proved that the authorizing user can access the installation. No GitHub user
-- or installation token is persisted by Briar.
create table briar_github_connection_repositories (
  installation_id integer not null
    references briar_github_connections (installation_id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  owner text not null check (
    owner = trim(owner) and length(owner) between 1 and 100
  ),
  name text not null check (
    name = trim(name) and length(name) between 1 and 100
  ),
  full_name text not null check (
    full_name = trim(full_name)
    and length(full_name) between 3 and 300
  ),
  created_at text not null,
  updated_at text not null,
  primary key (installation_id, repository_id)
);

create index briar_github_connection_repositories_name_idx
  on briar_github_connection_repositories (installation_id, full_name);

-- The raw CSRF state is returned to the browser but only its SHA-256 hash is
-- stored. The PKCE verifier stays server-side and is deleted when consumed.
create table briar_github_oauth_states (
  state_hash text primary key not null check (
    length(state_hash) = 64 and state_hash not glob '*[^0-9a-f]*'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  pkce_verifier text not null check (
    length(pkce_verifier) between 43 and 128
    and pkce_verifier not glob '*[^A-Za-z0-9._~-]*'
  ),
  installation_id integer check (installation_id is null or installation_id > 0),
  expires_at text not null,
  created_at text not null,
  updated_at text not null
);

create index briar_github_oauth_states_expiry_idx
  on briar_github_oauth_states (expires_at);
