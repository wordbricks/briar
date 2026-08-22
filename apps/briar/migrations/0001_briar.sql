create table "user" (
  "id" text primary key not null,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null check ("emailVerified" in (0, 1)),
  "image" text,
  "createdAt" text not null,
  "updatedAt" text not null
);

create table "session" (
  "id" text primary key not null,
  "expiresAt" text not null,
  "token" text not null unique,
  "createdAt" text not null,
  "updatedAt" text not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text primary key not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" text,
  "refreshTokenExpiresAt" text,
  "scope" text,
  "password" text,
  "createdAt" text not null,
  "updatedAt" text not null
);

create table "verification" (
  "id" text primary key not null,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" text not null,
  "createdAt" text not null,
  "updatedAt" text not null
);

create table "deviceCode" (
  "id" text primary key not null,
  "deviceCode" text not null,
  "userCode" text not null,
  "userId" text,
  "expiresAt" text not null,
  "status" text not null,
  "lastPolledAt" text,
  "pollingInterval" integer,
  "clientId" text,
  "scope" text
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
create index "deviceCode_deviceCode_idx" on "deviceCode" ("deviceCode");
create index "deviceCode_userCode_idx" on "deviceCode" ("userCode");

create table briar_projects (
  id text primary key not null,
  owner_user_id text not null references "user" (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  repository_path text not null check (
    repository_path = trim(repository_path)
    and length(repository_path) between 1 and 1000
  ),
  agent_token_hash text not null unique check (
    length(agent_token_hash) = 64
    and agent_token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null,
  updated_at text not null,
  unique (owner_user_id, repository_path)
);

create table briar_hunt_runs (
  run_number integer primary key autoincrement,
  id text not null unique,
  project_id text not null references briar_projects (id) on delete cascade,
  source text not null check (source in ('issue', 'error', 'feedback')),
  source_key text not null check (
    source_key = trim(source_key)
    and length(source_key) between 1 and 200
  ),
  title text not null check (length(trim(title)) between 1 and 300),
  stage text not null check (stage in (
    'queued', 'analyzing', 'implementing', 'pr_open', 'staging_qa',
    'production_qa', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  detail text check (detail is null or length(detail) <= 4000),
  repository text not null check (length(trim(repository)) between 1 and 500),
  branch text check (
    branch is null or length(trim(branch)) between 1 and 500
  ),
  commit_sha text check (
    commit_sha is null or (
      length(commit_sha) between 7 and 64
      and commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  started_at text not null,
  completed_at text,
  last_event_at text not null,
  created_at text not null,
  updated_at text not null,
  unique (project_id, source, source_key),
  check (
    (stage in ('completed', 'cancelled') and completed_at is not null)
    or (stage not in ('completed', 'cancelled') and completed_at is null)
  )
);

create table briar_hunt_events (
  id text primary key not null,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  event_key text not null check (
    event_key = trim(event_key)
    and length(event_key) between 1 and 300
  ),
  stage text not null check (stage in (
    'queued', 'analyzing', 'implementing', 'pr_open', 'staging_qa',
    'production_qa', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  detail text check (detail is null or length(detail) <= 4000),
  actor text not null check (length(trim(actor)) between 1 and 128),
  branch text,
  commit_sha text check (
    commit_sha is null or (
      length(commit_sha) between 7 and 64
      and commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  occurred_at text not null,
  recorded_at text not null,
  unique (run_id, event_key)
);

create index briar_projects_owner_idx
  on briar_projects (owner_user_id, created_at);
create index briar_hunt_runs_project_idx
  on briar_hunt_runs (project_id, last_event_at desc);
create index briar_hunt_events_run_idx
  on briar_hunt_events (run_id, occurred_at desc, id desc);
