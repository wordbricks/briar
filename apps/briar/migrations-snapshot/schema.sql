-- GENERATED FILE - DO NOT EDIT BY HAND.
-- Produced by scripts/generate-d1-schema-snapshot.ts from apps/briar/migrations
-- (excluding 0142_restore_cvs_slack_history.sql).
-- Loaded by the worker-d1 Vitest project in place of replaying migrations.
-- Whenever a migration changes the schema or seeds rows, run
-- `bun run d1:snapshot` and commit the result; `bun run d1:snapshot:check`
-- fails in CI otherwise.
-- migrations-digest: 10deea3b8a4aeb7fcd56c613682343da19abf73fd08c6bff61fd9bfdc99bc97c
-- snapshot-digest: 711dd4d1be8b54e92cecbc33c84d4e14be24fcd43439468018366b73816d7acb
-- @statement
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
-- @statement
CREATE TABLE IF NOT EXISTS "user" (
  "id" text primary key not null,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null check ("emailVerified" in (0, 1)),
  "image" text,
  "createdAt" text not null,
  "updatedAt" text not null
, "username" text);
-- @statement
CREATE TABLE IF NOT EXISTS "session" (
  "id" text primary key not null,
  "expiresAt" text not null,
  "token" text not null unique,
  "createdAt" text not null,
  "updatedAt" text not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
-- @statement
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text primary key not null,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" text not null,
  "createdAt" text not null,
  "updatedAt" text not null
);
-- @statement
CREATE TABLE IF NOT EXISTS "deviceCode" (
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
-- @statement
CREATE TABLE IF NOT EXISTS "briar_projects" (
  id text primary key not null,
  owner_user_id text not null references "user" (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  agent_token_hash text not null unique check (
    length(agent_token_hash) = 64
    and agent_token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null,
  updated_at text not null
, organization_id text
  references briar_organizations (id) on delete cascade, icon_data_url text
  check (
    icon_data_url is null
    or (
      length(icon_data_url) <= 400000
      and substr(icon_data_url, 1, 23) = 'data:image/webp;base64,'
    )
  ), icon_data_url_browser text
  check (
    icon_data_url_browser is null
    or (
      length(icon_data_url_browser) <= 400000
      and (
        substr(icon_data_url_browser, 1, 22) = 'data:image/png;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/jpeg;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/webp;base64,'
      )
    )
  ), issue_key_prefix text not null default 'AH'
  check (
    issue_key_prefix = upper(trim(issue_key_prefix))
    and length(issue_key_prefix) between 1 and 3
    and issue_key_prefix not glob '*[^A-Z0-9]*'
  ), schedule_tab_enabled integer not null default 1
  check (schedule_tab_enabled in (0, 1)));
-- @statement
CREATE TABLE briar_project_settings (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  velen_org text check (
    velen_org is null or (
      velen_org = trim(velen_org)
      and length(velen_org) between 1 and 100
    )
  ),
  data_source text check (
    data_source is null or (
      data_source = trim(data_source)
      and length(data_source) between 1 and 300
    )
  ),
  linear_enabled integer not null default 0
    check (linear_enabled in (0, 1)),
  linear_source text check (
    linear_source is null or (
      linear_source like 'linear://%'
      and length(linear_source) between 10 and 300
    )
  ),
  linear_team_key text check (
    linear_team_key is null or (
      linear_team_key = trim(linear_team_key)
      and length(linear_team_key) between 1 and 100
    )
  ),
  github_repository text check (
    github_repository is null or (
      github_repository = trim(github_repository)
      and length(github_repository) between 1 and 300
    )
  ),
  created_at text not null,
  updated_at text not null, workflow_json text not null
  default '{"version":1,"stages":[{"id":"repository_workflow_pending","label":"Repository workflow pending","required":true}],"completion":{"requiredStages":["repository_workflow_pending"]},"release":{"enabled":false}}'
  check (json_valid(workflow_json) and json_type(workflow_json) = 'object'), mandatory_checkpoints_json text, checkpoint_policy_revision integer
  not null default 1 check (checkpoint_policy_revision >= 1), github_repository_id integer
    check (github_repository_id is null or github_repository_id > 0),
  check (
    linear_enabled = 0
    or (linear_source is not null and velen_org is not null)
  )
);
-- @statement
CREATE TABLE briar_organizations (
  id text primary key not null,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at text not null,
  updated_at text not null
, handle text not null
  default 'organization-pending'
  check (
    length(handle) between 1 and 63
    and handle not glob '*[^a-z0-9-]*'
  ), logo text
  check (
    logo is null
    or (
      length(logo) <= 400000
      and substr(logo, 1, 23) = 'data:image/webp;base64,'
    )
  ), logo_data_url text
  check (
    logo_data_url is null
    or (
      length(logo_data_url) <= 400000
      and (
        substr(logo_data_url, 1, 22) = 'data:image/png;base64,'
        or substr(logo_data_url, 1, 23) = 'data:image/jpeg;base64,'
        or substr(logo_data_url, 1, 23) = 'data:image/webp;base64,'
      )
    )
  ));
-- @statement
CREATE TABLE briar_slack_installations (
  team_id text primary key not null check (
    team_id = trim(team_id) and length(team_id) between 1 and 64
  ),
  team_name text not null check (
    team_name = trim(team_name) and length(team_name) between 1 and 200
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  default_project_id text
    references briar_projects (id) on delete set null,
  bot_user_id text not null check (
    bot_user_id = trim(bot_user_id) and length(bot_user_id) between 1 and 64
  ),
  encrypted_bot_token text not null,
  token_iv text not null,
  installed_by_user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_slack_oauth_states (
  state_hash text primary key not null check (
    length(state_hash) = 64 and state_hash not glob '*[^0-9a-f]*'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  default_project_id text not null
    references briar_projects (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  expires_at text not null,
  created_at text not null
);
-- @statement
CREATE TABLE briar_slack_events (
  team_id text not null,
  event_id text not null,
  status text not null check (status in ('processing', 'completed')),
  claimed_at text not null,
  completed_at text,
  primary key (team_id, event_id)
);
-- @statement
CREATE TABLE briar_execution_worker_devices (
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
  updated_at text not null, max_concurrent_sessions integer not null default 1
  check (max_concurrent_sessions between 1 and 16), icon_type text
  check (icon_type is null or icon_type in ('emoji', 'image')), icon_value text
  check (icon_value is null or length(icon_value) <= 400000),
  unique (organization_id, device_identity_hash)
);
-- @statement
CREATE TABLE briar_execution_worker_credentials (
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
-- @statement
CREATE TABLE briar_project_agent_tokens (
  token_hash text primary key not null check (
    length(token_hash) = 64
    and token_hash not glob '*[^0-9a-f]*'
  ),
  project_id text not null
    references briar_projects (id) on delete cascade,
  issued_to_user_id text
    references "user" (id) on delete set null,
  created_at text not null
);
-- @statement
CREATE TABLE briar_project_agent_sessions (
  project_id text not null references briar_projects (id) on delete cascade,
  id text not null,
  agent_id text,
  session_type text not null check (session_type in ('task', 'dispatch')),
  payload_json text not null,
  started_at text not null,
  completed_at text,
  updated_at text not null, status text
  not null default 'running'
  check (status in (
    'running', 'completed', 'failed', 'skipped', 'interrupted'
  )), requested_by_user_id text
  references "user" (id) on delete set null,
  primary key (project_id, id)
);
-- @statement
CREATE TABLE briar_dashboard_sync_state (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  current_version integer not null default 0 check (current_version >= 0)
);
-- @statement
CREATE TABLE briar_dashboard_changes (
  version integer primary key autoincrement,
  project_id text not null references briar_projects (id) on delete cascade,
  entity_type text not null check (entity_type in (
    'run', 'worker', 'notifications', 'metadata'
  )),
  entity_id text,
  operation text not null check (operation in ('upsert', 'delete', 'replace')),
  created_at text not null
);
-- @statement
CREATE TABLE briar_archive_cleanup_queue (
  bucket text not null check (bucket in ('archives', 'attachments')),
  object_key text not null check (
    object_key = trim(object_key) and length(object_key) between 1 and 1024
  ),
  project_id text not null,
  run_id text,
  queued_at text not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at text,
  last_error text, generation integer not null default 1 check (generation >= 1), next_attempt_at text, dead_lettered_at text, alert_state text not null default 'none'
    check (alert_state in ('none', 'pending', 'acknowledged')), alert_detail_json text
    check (alert_detail_json is null or json_valid(alert_detail_json)),
  primary key (bucket, object_key)
);
-- @statement
CREATE TABLE briar_user_workflow_checkpoint_defaults (
  project_id text not null references briar_projects(id) on delete cascade,
  user_id text not null references user(id) on delete cascade,
  checkpoints_json text not null default '[]',
  revision integer not null default 1 check (revision >= 1),
  created_at text not null,
  updated_at text not null,
  primary key (project_id, user_id)
);
-- @statement
CREATE TABLE briar_github_deliveries (
  delivery_id text primary key not null check (
    delivery_id = trim(delivery_id)
    and length(delivery_id) between 1 and 128
  ),
  event_name text not null check (
    event_name = trim(event_name)
    and length(event_name) between 1 and 64
  ),
  action text check (
    action is null or (
      action = trim(action)
      and length(action) between 1 and 100
    )
  ),
  status text not null check (status in ('processing', 'completed')),
  claimed_at text not null,
  completed_at text,
  check (
    (status = 'processing' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);
-- @statement
CREATE TABLE briar_github_pull_requests (
  repository_id integer not null check (repository_id > 0),
  pull_request_number integer not null check (pull_request_number > 0),
  installation_id integer check (installation_id is null or installation_id > 0),
  repository text not null check (
    repository = lower(trim(repository))
    and length(repository) between 3 and 300
  ),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  url text not null check (
    url = trim(url)
    and length(url) between 1 and 1000
    and url like 'https://%'
  ),
  state text not null check (state in ('open', 'closed', 'merged')),
  draft integer not null check (draft in (0, 1)),
  head_sha text not null check (
    length(head_sha) between 7 and 64
    and head_sha not glob '*[^0-9a-f]*'
  ),
  base_sha text not null check (
    length(base_sha) between 7 and 64
    and base_sha not glob '*[^0-9a-f]*'
  ),
  merge_commit_sha text check (
    merge_commit_sha is null or (
      length(merge_commit_sha) between 7 and 64
      and merge_commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  opened_at text not null,
  closed_at text,
  merged_at text,
  provider_updated_at text not null,
  last_delivery_id text not null,
  briar_issue_links_json text not null check (
    json_valid(briar_issue_links_json)
    and json_type(briar_issue_links_json) = 'array'
    and length(briar_issue_links_json) <= 4000
  ),
  created_at text not null,
  updated_at text not null, base_branch text,
  primary key (repository_id, pull_request_number)
);
-- @statement
CREATE TABLE briar_inbox_read_states (
  user_id text not null references "user"(id) on delete cascade,
  message_id text not null,
  version text not null,
  updated_at text not null,
  primary key (user_id, message_id)
);
-- @statement
CREATE TABLE briar_github_connections (
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
-- @statement
CREATE TABLE briar_github_connection_repositories (
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
-- @statement
CREATE TABLE briar_github_oauth_states (
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
-- @statement
CREATE TABLE briar_channels (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  slug text not null check (
    length(slug) between 1 and 63 and slug not glob '*[^a-z0-9-]*'
  ),
  name text not null check (length(trim(name)) between 1 and 100),
  topic text check (topic is null or length(topic) <= 500),
  visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  
  default_project_id text references briar_projects (id) on delete set null,
  created_by_user_id text references "user" (id) on delete set null,
  archived_at text,
  created_at text not null,
  updated_at text not null
, kind text not null default 'channel'
  check (kind in ('channel', 'dm')), dm_key text, memory_roster_epoch integer not null default 0);
-- @statement
CREATE TABLE briar_channel_members (
  channel_id text not null references briar_channels (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at text not null,
  primary key (channel_id, user_id)
);
-- @statement
CREATE TABLE briar_channel_sync_state (
  organization_id text primary key not null
    references briar_organizations (id) on delete cascade,
  current_version integer not null default 0 check (current_version >= 0)
);
-- @statement
CREATE TABLE briar_channel_changes (
  version integer primary key autoincrement,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null,
  entity_type text not null check (entity_type in (
    'channel', 'message', 'reply_job', 'proposal'
  )),
  entity_id text,
  operation text not null check (operation in ('upsert', 'delete')),
  created_at text not null
);
-- @statement
CREATE TABLE briar_execution_worker_update_requests (
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
, handoff_state text not null default 'idle'
  check (handoff_state in ('idle', 'draining', 'ready', 'failed')), handoff_started_at text, handoff_completed_at text, handoff_error text);
-- @statement
CREATE TABLE briar_project_agent_session_context_membership (
  project_id text not null
    references briar_projects (id) on delete cascade,
  session_id text not null,
  visible_at text not null,
  primary key (project_id, session_id)
);
-- @statement
CREATE TABLE briar_channel_issue_approval_audit (
  id text primary key not null,
  proposal_id text not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null,
  project_id text,
  run_id text,
  approved_by_user_id text
    references "user" (id) on delete set null,
  approved_at text not null,
  issue_source_key text,
  result_verification text not null check (
    result_verification in (
      'atomic', 'legacy_authorized', 'missing', 'unverifiable'
    )
  ),
  payload_json text not null check (json_valid(payload_json)),
  created_at text not null
);
-- @statement
CREATE TABLE briar_channel_issue_transfer_quarantine (
  entity_kind text not null check (
    entity_kind in ('agent_transcript_session', 'agent_transcript_archive')
  ),
  entity_id text not null,
  run_id text not null,
  source_project_id text not null,
  target_project_id text not null,
  reason text not null check (reason = 'unverified_transcript_ownership'),
  detected_at text not null,
  primary key (entity_kind, entity_id)
);
-- @statement
CREATE TABLE briar_account_deletion_jobs (
  id text primary key not null,
  user_id text not null unique,
  email text not null,
  created_at text not null
);
-- @statement
CREATE TABLE briar_account_deletion_job_organizations (
  job_id text not null
    references briar_account_deletion_jobs (id) on delete cascade,
  organization_id text not null,
  primary key (job_id, organization_id)
);
-- @statement
CREATE TABLE briar_slack_revocation_queue (
  id text primary key not null check (
    length(id) = 64 and id not glob '*[^0-9a-f]*'
  ),
  team_id text not null,
  encrypted_bot_token text not null,
  token_iv text not null,
  queued_at text not null,
  next_attempt_at text not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at text,
  last_error text,
  dead_lettered_at text,
  dead_letter_reason text,
  check (
    (dead_lettered_at is null and dead_letter_reason is null)
    or (dead_lettered_at is not null and dead_letter_reason is not null)
  )
);
-- @statement
CREATE TABLE briar_project_agent_task_completion_receipts (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  task_id text not null,
  skill_execution_proposal_id text,
  worker_id text not null,
  claim_token_hash text not null check (length(claim_token_hash) = 64),
  outcome_status text not null
    check (outcome_status in ('queued', 'completed', 'failed')),
  summary text,
  conversation_id text,
  error text,
  completed_at text not null,
  created_at text not null,
  check (
    (outcome_status = 'completed' and error is null
      and (skill_execution_proposal_id is null or summary is not null))
    or
    (outcome_status in ('queued', 'failed')
      and summary is null and error is not null)
  ),
  unique (project_id, task_id, worker_id, claim_token_hash)
);
-- @statement
CREATE TABLE briar_project_agent_session_summaries (
  project_id text not null references briar_projects (id) on delete cascade,
  session_id text not null,
  summary_json text not null check (
    json_valid(summary_json) and json_type(summary_json) = 'object'
  ),
  updated_at text not null,
  archived integer not null default 0 check (archived in (0, 1)),
  primary key (project_id, session_id)
);
-- @statement
CREATE TABLE briar_project_agent_session_sync_state (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  current_version integer not null default 0 check (current_version >= 0)
);
-- @statement
CREATE TABLE briar_project_agent_session_changes (
  version integer primary key autoincrement,
  project_id text not null references briar_projects (id) on delete cascade,
  session_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  created_at text not null
);
-- @statement
CREATE TABLE briar_organization_inbox_sync_state (
  organization_id text primary key not null,
  current_version integer not null default 0 check (current_version >= 0)
);
-- @statement
CREATE TABLE briar_channel_webhooks (
  id text primary key not null,
  channel_id text not null references briar_channels (id) on delete cascade,
  name text not null check (
    name = trim(name) and length(name) between 1 and 100
  ),
  secret_hash text not null unique check (
    length(secret_hash) = 64 and secret_hash not glob '*[^0-9a-f]*'
  ),
  created_by_user_id text references "user" (id) on delete set null,
  last_used_at text,
  revoked_at text,
  created_at text not null,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_channel_webhook_rate_limits (
  webhook_id text primary key not null
    references briar_channel_webhooks (id) on delete cascade,
  window_started_at text not null,
  request_count integer not null check (request_count >= 1)
);
-- @statement
CREATE TABLE briar_channel_read_states (
  user_id text not null references "user"(id) on delete cascade,
  channel_id text not null references briar_channels(id) on delete cascade,
  last_read_at text not null,
  updated_at text not null,
  primary key (user_id, channel_id)
);
-- @statement
CREATE TABLE briar_organization_inbox_realtime_outbox (
  organization_id text primary key not null,
  version integer not null check (version >= 0),
  updated_at text not null
);
-- @statement
CREATE TABLE briar_agent_skill_execution_approval_audit (
  id text primary key not null,
  proposal_id text not null unique,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  trigger_message_id text not null,
  reply_message_id text not null,
  source_reply_job_id text not null,
  delegated_by_reply_job_id text,
  agent_id text not null,
  agent_name text not null,
  agent_responsibility text not null,
  skill_id text not null,
  skill_name text not null,
  skill_instructions text not null,
  skill_kind text not null check (skill_kind in ('issue_processing', 'custom')),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')),
  model text,
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  request text not null,
  worker_id text not null,
  worker_label text not null,
  result_session_id text not null unique,
  approved_by_user_id text references "user" (id) on delete set null,
  approved_at text not null,
  delegated_by_agent_id text,
  delegated_by_agent_name text,
  created_at text not null
, execution_mode text not null default 'task'
  check (execution_mode in ('conversation', 'task')), approval_policy text not null default 'explicit'
  check (approval_policy in ('invoke_is_consent', 'explicit')), thread_root_message_id text, result_reply_job_id text, result_message_id text);
-- @statement
CREATE TABLE briar_agent_skill_execution_proposals (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  source_reply_job_id text not null,
  delegated_by_reply_job_id text,
  agent_id text not null,
  agent_name text not null check (
    length(trim(agent_name)) between 1 and 100
  ),
  agent_responsibility text not null check (
    length(trim(agent_responsibility)) between 1 and 20000
  ),
  skill_id text not null,
  skill_name text not null check (
    length(trim(skill_name)) between 1 and 100
  ),
  skill_instructions text not null check (length(skill_instructions) <= 20000),
  skill_kind text not null check (skill_kind in ('issue_processing', 'custom')),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')),
  model text check (
    model is null or length(trim(model)) between 1 and 100
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  request text not null check (length(trim(request)) between 1 and 10000),
  delegated_by_agent_id text,
  delegated_by_agent_name text check (
    delegated_by_agent_name is null
    or length(trim(delegated_by_agent_name)) between 1 and 100
  ),
  generation integer not null default 1 check (generation >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'invalidated')),
  requested_worker_id text,
  requested_worker_label text,
  result_session_id text unique,
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  created_at text not null,
  updated_at text not null, execution_mode text not null default 'task'
  check (execution_mode in ('conversation', 'task')), approval_policy text not null default 'explicit'
  check (approval_policy in ('invoke_is_consent', 'explicit')), thread_root_message_id text, result_reply_job_id text, result_message_id text, materialized_session_payload_json text,
  check (
    (source_kind = 'channel' and channel_id is not null
      and conversation_run_id is null)
    or
    (source_kind = 'issue' and channel_id is null
      and conversation_run_id is not null)
  ),
  check (
    (status = 'pending' and requested_worker_id is null
      and requested_worker_label is null and result_session_id is null
      and accepted_by_user_id is null and accepted_at is null)
    or
    (status = 'accepted' and requested_worker_id is not null
      and requested_worker_label is not null and result_session_id is not null
      and accepted_at is not null)
    or status = 'invalidated'
  )
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_project_agents" (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,

  project_id text references briar_projects (id) on delete cascade,

  handle text check (
    handle is null
    or (
      length(handle) between 1 and 63
      and handle not glob '*[^a-z0-9-]*'
    )
  ),
  name text not null check (length(trim(name)) between 1 and 100),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')),
  model text check (
    model is null or (model = trim(model) and length(model) between 1 and 100)
  ),
  responsibility text not null check (
    responsibility = trim(responsibility)
    and length(responsibility) between 1 and 20000
  ),
  created_at text not null,
  updated_at text not null,
  calendar_color text not null default '#3275d5'
    check (length(calendar_color) = 7 and substr(calendar_color, 1, 1) = '#'),
  skill_markdown text not null default '' check (length(skill_markdown) <= 25000),
  avatar text check (
    avatar is null or (
      length(avatar) <= 400000 and (
        substr(avatar, 1, 22) = 'data:image/png;base64,'
        or substr(avatar, 1, 23) = 'data:image/jpeg;base64,'
        or substr(avatar, 1, 23) = 'data:image/webp;base64,'
      )
    )
  ),
  avatar_pet_json text check (
    avatar_pet_json is null or (
      length(avatar_pet_json) <= 4000 and json_valid(avatar_pet_json)
    )
  ),
  avatar_spritesheet_object_key text check (
    avatar_spritesheet_object_key is null or (
      length(avatar_spritesheet_object_key) <= 1000
      and avatar_spritesheet_object_key like 'project-agent-spritesheets/%'
    )
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  )
, description text not null default '' check (
  description = trim(description)
  and length(description) <= 500
), designated_worker_id text
  references briar_execution_workers (id) on delete restrict, designated_worker_label text
  check (
    designated_worker_label is null
    or length(trim(designated_worker_label)) between 1 and 100
  ), computer_use_policy text not null default 'disabled'
check (computer_use_policy in ('disabled', 'unattended')));
-- @statement
CREATE TABLE briar_agent_skills (
  id text primary key not null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name) and length(name) between 1 and 100
  ),
  body text not null default '' check (length(body) <= 20000),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')),
  model text check (
    model is null or (model = trim(model) and length(model) between 1 and 100)
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  kind text not null default 'custom'
    check (kind in ('issue_processing', 'custom')),
  is_default integer not null default 0 check (is_default in (0, 1)),
  position integer not null default 0 check (position >= 0),
  created_at text not null,
  updated_at text not null
, description text not null default ''
  check (length(description) <= 1000), execution_mode text not null
  default 'task' check (execution_mode in ('conversation', 'task')), approval_policy text not null
  default 'explicit' check (approval_policy in ('invoke_is_consent', 'explicit')));
-- @statement
CREATE TABLE IF NOT EXISTS "briar_execution_workers" (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 100),
  host_fingerprint text not null check (
    length(host_fingerprint) = 64
    and host_fingerprint not glob '*[^0-9a-f]*'
  ),
  state text not null check (state in ('online', 'stale', 'disabled')),
  last_heartbeat_at text not null,
  created_at text not null,
  updated_at text not null,
  device_id text references briar_execution_worker_devices (id) on delete cascade,
  accepting_work integer not null default 1 check (accepting_work in (0, 1)),
  readiness_state text not null default 'ready'
    check (readiness_state in ('ready', 'busy', 'needs_attention')),
  readiness_detail text,
  runtime_proto_json text not null default '{}' check (
    json_valid(runtime_proto_json) and json_type(runtime_proto_json) = 'object'
  ),
  unique (project_id, host_fingerprint)
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_hunt_runs" (
  run_number integer primary key autoincrement,
  id text not null unique,
  project_id text not null references briar_projects (id) on delete cascade,
  source text not null check (source in ('issue', 'error', 'feedback')),
  source_key text not null check (
    source_key = trim(source_key) and length(source_key) between 1 and 200
  ),
  title text not null check (length(trim(title)) between 1 and 300),
  stage text not null check (stage in (
    'queued', 'analyzing', 'implementing', 'pr_open', 'staging_qa',
    'production_qa', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  detail text check (detail is null or length(detail) <= 4000),
  repository text not null check (length(trim(repository)) between 1 and 500),
  branch text check (branch is null or length(trim(branch)) between 1 and 500),
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
  priority integer check (priority is null or priority between 1 and 4),
  tracker_provider text
    check (tracker_provider is null or length(trim(tracker_provider)) between 1 and 50),
  tracker_issue_id text
    check (tracker_issue_id is null or length(trim(tracker_issue_id)) between 1 and 200),
  tracker_issue_identifier text
    check (tracker_issue_identifier is null or length(trim(tracker_issue_identifier)) between 1 and 100),
  tracker_issue_url text
    check (tracker_issue_url is null or length(trim(tracker_issue_url)) between 1 and 1000),
  tracker_issue_state text
    check (tracker_issue_state is null or length(trim(tracker_issue_state)) between 1 and 100),
  issue_description text
    check (issue_description is null or length(issue_description) <= 100000),
  result_summary text
    check (result_summary is null or length(result_summary) <= 100000),
  pull_request_urls text not null default '[]'
    check (json_valid(pull_request_urls) and json_type(pull_request_urls) = 'array'),
  target_sha text check (
    target_sha is null or (
      length(target_sha) between 7 and 64
      and target_sha not glob '*[^0-9a-f]*'
    )
  ),
  source_created_at text,
  staging_qa_status text
    check (staging_qa_status is null or staging_qa_status in ('pending', 'passed', 'skipped')),
  production_qa_status text
    check (production_qa_status is null or production_qa_status in ('pending', 'passed', 'skipped')),
  staging_qa_detail text
    check (staging_qa_detail is null or length(staging_qa_detail) <= 100000),
  production_qa_detail text
    check (production_qa_detail is null or length(production_qa_detail) <= 100000),
  context_json text check (
    context_json is null or (
      json_valid(context_json) and json_type(context_json) = 'object'
    )
  ),
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64
      and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  claimed_by text
    check (claimed_by is null or length(trim(claimed_by)) between 1 and 128),
  claimed_at text,
  lease_expires_at text,
  claim_attempts integer not null default 0 check (claim_attempts >= 0),
  current_attempt integer not null default 1 check (current_attempt >= 1),
  workflow_stage text,
  workflow_snapshot_json text not null
    default '{"version":1,"stages":[{"id":"repository_workflow_pending","label":"Repository workflow pending","required":true}],"completion":{"requiredStages":["repository_workflow_pending"]},"release":{"enabled":false}}'
    check (
      json_valid(workflow_snapshot_json)
      and json_type(workflow_snapshot_json) = 'object'
    ),
  worker_id text references briar_execution_workers (id) on delete set null,
  status text not null default 'queued' check (status in (
    'backlog', 'queued', 'running', 'blocked', 'failed', 'completed', 'cancelled'
  )),
  current_revision integer not null default 1 check (current_revision >= 1),
  structured_result_json text,
  agent_id text references briar_project_agents (id) on delete set null,
  requested_worker_id text
    references briar_execution_workers (id) on delete set null,
  requested_by_user_id text references "user" (id) on delete set null,
  dispatch_mode text check (dispatch_mode in ('any', 'specific')),
  dispatch_request_id text,
  dispatched_at text,
  requested_agent_provider text check (
    requested_agent_provider is null
    or requested_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  preferred_agent_provider text check (
    preferred_agent_provider is null
    or preferred_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  preferred_agent_model text check (
    preferred_agent_model is null
    or length(trim(preferred_agent_model)) between 1 and 100
  ),
  preferred_agent_effort text check (
    preferred_agent_effort is null
    or preferred_agent_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  requested_agent_model text check (
    requested_agent_model is null
    or length(trim(requested_agent_model)) between 1 and 100
  ),
  requested_agent_effort text check (
    requested_agent_effort is null
    or requested_agent_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  event_count integer not null default 0 check (event_count >= 0),
  execution_metrics_json text, paused_at text, waiting_checkpoint_key text, waiting_checkpoint_revision integer
  check (waiting_checkpoint_revision is null or waiting_checkpoint_revision >= 1), resume_requested_at text, assignee_user_id text references "user" (id) on delete set null, issue_checkpoints_json text
  not null default '[]' check (
    json_valid(issue_checkpoints_json)
    and json_type(issue_checkpoints_json) = 'array'
  ), last_execution_id text, created_by_user_id text
  references "user" (id) on delete set null, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)), difficulty text
  check (difficulty in ('easy', 'normal', 'hard')), team_id text
  references briar_teams (id) on delete cascade, planning_project_id text
  references briar_planning_projects (id) on delete restrict, full_auto integer not null default 0
  check (full_auto in (0, 1)), requires_claim_token integer not null default 0
  check (requires_claim_token in (0, 1)),
  unique (project_id, source, source_key),
  check (
    (stage in ('completed', 'cancelled') and completed_at is not null)
    or (stage not in ('completed', 'cancelled') and completed_at is null)
  )
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_agent_transcript_sessions" (
  session_id text primary key not null check (
    session_id = trim(session_id) and length(session_id) between 1 and 128
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_provider text not null
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')),
  started_at text not null,
  last_event_at text not null,
  event_count integer not null default 0 check (event_count >= 0),
  byte_count integer not null default 0 check (byte_count >= 0)
);
-- @statement
CREATE TABLE briar_agent_transcript_segments (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  first_sequence integer not null check (first_sequence > 0),
  last_sequence integer not null check (last_sequence >= first_sequence),
  object_key text not null unique,
  event_count integer not null check (event_count > 0),
  uncompressed_bytes integer not null check (uncompressed_bytes > 0),
  compressed_bytes integer not null check (compressed_bytes > 0),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  recorded_at text not null,
  primary key (session_id, first_sequence, last_sequence)
);
-- @statement
CREATE TABLE briar_agent_transcripts (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  sequence integer not null check (sequence > 0),
  direction text not null check (direction in ('client', 'server')),
  payload_json text not null check (
    json_valid(payload_json)
    and length(payload_json) <= 32768
  ),
  recorded_at text not null,
  primary key (session_id, sequence)
);
-- @statement
CREATE TABLE briar_agent_worklog_entries (
  session_id text not null
    references briar_agent_transcript_sessions (session_id) on delete cascade,
  entry_id text not null check (
    entry_id = trim(entry_id) and length(entry_id) between 1 and 512
  ),
  sequence integer not null check (sequence > 0),
  updated_sequence integer not null check (updated_sequence >= sequence),
  entry_type text not null check (entry_type in ('message', 'activity')),
  activity_kind text check (
    activity_kind is null
    or activity_kind in ('command', 'fileChange', 'webSearch', 'tool')
  ),
  phase text,
  title text,
  body text not null default '',
  status text not null check (
    status in (
      'writing', 'completed', 'failed', 'cancelled', 'interrupted'
    )
  ),
  started_at text not null,
  updated_at text not null,
  completed_at text,
  primary key (session_id, entry_id)
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_channel_action_proposals" (
  id text primary key not null,
  channel_id text not null references briar_channels (id) on delete cascade,
  project_id text references briar_projects (id) on delete set null,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  action_type text not null check (
    action_type in ('request_issue_create', 'request_plan_document')
  ),
  payload_json text not null check (json_valid(payload_json)),
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  result_run_id text references briar_hunt_runs (id) on delete set null,
  created_at text not null,
  updated_at text not null, issue_source_key text, execute_after_create integer not null default 0
    check (execute_after_create in (0, 1)), execution_proposal_id text, declined_by_user_id text, declined_at text,
  unique (channel_id, trigger_message_id)
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_channel_messages" (
  id text primary key not null,
  channel_id text not null references briar_channels (id) on delete cascade,
  parent_message_id text
    references "briar_channel_messages" (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  author_agent_id text
    references briar_project_agents (id) on delete set null,
  author_agent_name text check (
    author_agent_name is null
    or length(trim(author_agent_name)) between 1 and 100
  ),
  author_agent_provider text check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  author_webhook_id text
    references briar_channel_webhooks (id) on delete set null,
  author_webhook_name text check (
    author_webhook_name is null
    or length(trim(author_webhook_name)) between 1 and 100
  ),
  webhook_event_id text check (
    webhook_event_id is null
    or (webhook_event_id = trim(webhook_event_id)
      and length(webhook_event_id) between 1 and 200)
  ),
  body text not null check (
    body = trim(body) and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null, blocks_json text check (
    blocks_json is null
    or (json_valid(blocks_json) and length(blocks_json) <= 65536)
  ), deleted_at text, memory_source_version integer not null default 1,
  check (parent_message_id is null or parent_message_id <> id),
  check (
    author_agent_name is not null
    or (author_agent_id is null and author_agent_provider is null)
  ),
  check (author_webhook_name is not null or author_webhook_id is null),
  check (
    (author_user_id is not null)
    + (author_agent_name is not null)
    + (author_webhook_name is not null) = 1
  ),
  check (
    (author_webhook_name is null and webhook_event_id is null)
    or author_webhook_name is not null
  )
);
-- @statement
CREATE TABLE briar_channel_agent_reply_jobs (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  project_id text references briar_projects (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  trigger_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  reply_message_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  agent_provider text check (
    agent_provider is null
    or agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  claimed_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or length(error) <= 4000),
  created_at text not null,
  updated_at text not null,
  completed_at text, skill_id text
    references briar_agent_skills (id) on delete set null, claimed_worker_id text
  references briar_execution_workers (id) on delete set null, delegated_by_reply_job_id text
    references briar_channel_agent_reply_jobs (id) on delete cascade, delegation_request text check (
    (delegated_by_reply_job_id is null and delegation_request is null)
    or (
      delegated_by_reply_job_id is not null
      and delegation_request is not null
      and length(delegation_request) between 1 and 10000
    )
  ), selected_skill_id_snapshot text check (
    selected_skill_id_snapshot is null
    or length(selected_skill_id_snapshot) = 36
  ), execution_target_ids_json text not null default '[]'
    check (
      json_valid(execution_target_ids_json)
      and json_type(execution_target_ids_json) = 'array'
    ), selected_agent_name_snapshot text, selected_agent_responsibility_snapshot text, selected_skill_name_snapshot text, selected_skill_instructions_snapshot text, selected_skill_provider_snapshot text, selected_skill_kind_snapshot text, selected_skill_model_snapshot text, selected_skill_effort_snapshot text, skill_execution_request_snapshot text, preferred_device_id text
  references briar_execution_worker_devices (id) on delete set null, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)), session_id text
  references briar_channel_reply_sessions (id) on delete cascade, approved_skill_execution_proposal_id text, memory_restart_count integer not null default 0,
  unique (channel_id, trigger_message_id, agent_id)
);
-- @statement
CREATE TABLE briar_channel_agents (
  channel_id text not null references briar_channels (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  added_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (channel_id, agent_id)
);
-- @statement
CREATE TABLE briar_channel_message_agent_mentions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  created_at text not null,
  primary key (message_id, agent_id)
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_channel_message_documents" (
  message_id text primary key not null
    references briar_channel_messages (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,


  project_id text references briar_projects (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 300),
  markdown text not null check (length(markdown) <= 200000),
  created_at text not null,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_channel_message_mentions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  primary key (message_id, user_id)
);
-- @statement
CREATE TABLE briar_channel_message_reactions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  emoji text not null check (
    emoji = trim(emoji)
    and length(emoji) between 1 and 32
  ),
  created_at text not null,
  primary key (message_id, user_id, emoji)
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_channel_notification_inbox" (
  user_id text not null references "user" (id) on delete cascade,
  organization_id text not null,
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  notification_reason text not null
    check (notification_reason in ('mention', 'thread_reply', 'subscription')),
  created_at text not null,
  primary key (user_id, message_id)
);
-- @statement
CREATE TABLE briar_execution_audit_events (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_id text references briar_project_agents (id) on delete set null,
  actor_user_id text references "user" (id) on delete set null,
  actor_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  action text not null check (
    action in (
      'dispatched', 'reassigned', 'claimed', 'lease_lost', 'cancelled',
      'requeued', 'blocked', 'completed', 'worker_readiness_changed'
    )
  ),
  request_id text,
  detail_json text not null default '{}' check (
    json_valid(detail_json) and json_type(detail_json) = 'object'
  ),
  occurred_at text not null
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_hunt_events" (
  id text primary key not null,
  run_id text not null references "briar_hunt_runs" (id) on delete cascade,
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
  recorded_at text not null, qa_status text
  check (qa_status is null or qa_status in ('pending', 'passed', 'skipped')), tracker_issue_state text
  check (tracker_issue_state is null or length(trim(tracker_issue_state)) between 1 and 100), pull_request_urls text not null default '[]'
  check (json_valid(pull_request_urls) and json_type(pull_request_urls) = 'array'), target_sha text
  check (target_sha is null or (
    length(target_sha) between 7 and 64
    and target_sha not glob '*[^0-9a-f]*'
  )), attempt integer not null default 1
  check (attempt >= 1), workflow_stage text, status text not null
  default 'queued'
  check (status in (
    'backlog', 'queued', 'running', 'blocked', 'failed', 'completed',
    'cancelled'
  )), revision integer not null default 1
  check (revision >= 1),
  unique (run_id, event_key)
);
-- @statement
CREATE TABLE briar_issue_action_proposals (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  conversation_run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  action_type text not null
    check (action_type in ('request_issue_update', 'request_issue_create')),
  payload_json text not null check (json_valid(payload_json)),
  expected_run_updated_at text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  result_run_id text references briar_hunt_runs (id) on delete set null,
  created_at text not null,
  updated_at text not null, approval_reserved_by_user_id text
    references "user" (id) on delete set null, approval_reserved_at text, issue_source_key text, execute_after_create integer not null default 0
    check (execute_after_create in (0, 1)), execution_proposal_id text,
  unique (project_id, trigger_message_id)
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_issue_messages" (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  parent_message_id text,
  author_user_id text references "user" (id) on delete set null,
  author_agent_provider text check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  body text not null check (
    body = trim(body) and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null, author_agent_id text
  references briar_project_agents (id) on delete set null, author_agent_name text,
  check (parent_message_id is null or parent_message_id <> id)
);
-- @statement
CREATE TABLE briar_issue_dependencies (
  project_id text not null references briar_projects (id) on delete cascade,
  prerequisite_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  dependent_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (prerequisite_run_id, dependent_run_id),
  check (prerequisite_run_id <> dependent_run_id)
);
-- @statement
CREATE TABLE briar_issue_execution_approval_audit (
  id text primary key not null,
  proposal_id text not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text,
  conversation_run_id text,
  run_id text not null,
  generation integer not null,
  approved_by_user_id text references "user" (id) on delete set null,
  approved_at text not null,
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')),
  model text,
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  worker_id text,
  dispatch_request_id text not null unique,
  proposed_by_agent_id text,
  delegated_by_agent_id text,
  created_at text not null
);
-- @statement
CREATE TABLE briar_issue_execution_proposals (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_id text references briar_channels (id) on delete set null,
  conversation_run_id text references briar_hunt_runs (id) on delete set null,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  target_run_id text not null references briar_hunt_runs (id) on delete cascade,
  target_title text not null check (length(trim(target_title)) between 1 and 300),
  target_run_updated_at text not null,
  proposed_by_agent_id text
    references briar_project_agents (id) on delete set null,
  delegated_by_agent_id text
    references briar_project_agents (id) on delete set null,
  delegated_by_agent_name text
    check (
      delegated_by_agent_name is null
      or length(trim(delegated_by_agent_name)) between 1 and 100
    ),
  origin_create_proposal_id text,
  generation integer not null default 1 check (generation >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'invalidated')),
  approval_reserved_by_user_id text
    references "user" (id) on delete set null,
  approval_reserved_at text,
  requested_provider text check (
    requested_provider is null
    or requested_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  requested_model text check (
    requested_model is null
    or length(trim(requested_model)) between 1 and 100
  ),
  requested_effort text check (
    requested_effort is null
    or requested_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  requested_worker_id text
    references briar_execution_workers (id) on delete set null,
  dispatch_request_id text unique,
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  created_at text not null,
  updated_at text not null,
  check (
    status = 'invalidated'
    or (
      source_kind = 'channel' and channel_id is not null
      and conversation_run_id is null
    )
    or (
      source_kind = 'issue' and channel_id is null
      and conversation_run_id is not null
    )
  ),
  check (
    (approval_reserved_at is null
      and requested_provider is null
      and requested_model is null
      and requested_effort is null
      and requested_worker_id is null
      and dispatch_request_id is null)
    or
    (approval_reserved_at is not null
      and requested_provider is not null
      and dispatch_request_id is not null)
  )
);
-- @statement
CREATE TABLE briar_issue_message_mentions (
  message_id text not null references briar_issue_messages (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  created_at text not null,
  primary key (message_id, user_id)
);
-- @statement
CREATE TABLE briar_issue_result_reviews (
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  reviewer_user_id text not null references "user" (id) on delete cascade,
  completed_at text not null,
  primary key (run_id, reviewer_user_id)
);
-- @statement
CREATE TABLE briar_issue_rework_proposals (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null,
  reply_message_id text not null unique,
  workflow_stage text not null,
  reason text not null,
  expected_attempt integer not null check (expected_attempt > 0),
  expected_revision integer not null check (expected_revision > 0),
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  accepted_by_user_id text references "user" (id) on delete set null,
  accepted_at text,
  applied_revision integer check (applied_revision is null or applied_revision > 0),
  created_at text not null,
  updated_at text not null,
  unique (project_id, trigger_message_id)
);
-- @statement
CREATE TABLE briar_log_archives (
  id text primary key not null check (
    length(id) = 64 and id not glob '*[^0-9a-f]*'
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  scope_id text not null check (
    scope_id = trim(scope_id) and length(scope_id) between 1 and 128
  ),
  archive_kind text not null check (archive_kind in (
    'run_events', 'run_evidence', 'execution_audit',
    'agent_transcript', 'issue_messages', 'project_agent_sessions'
  )),
  object_key text not null unique check (
    object_key = trim(object_key) and length(object_key) between 1 and 1024
  ),
  format_version integer not null check (format_version = 1),
  status text not null check (status in ('failed', 'verified', 'complete')),
  row_count integer not null check (row_count > 0),
  byte_size integer not null check (byte_size >= 0),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  content_sha256 text not null check (
    length(content_sha256) = 64 and content_sha256 not glob '*[^0-9a-f]*'
  ),
  period_start text not null,
  period_end text not null,
  created_at text not null,
  verified_at text,
  completed_at text,
  expires_at text not null,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text,
  related_object_keys_json text not null default '[]' check (
    json_valid(related_object_keys_json)
    and json_type(related_object_keys_json) = 'array'
  )
);
-- @statement
CREATE TABLE briar_project_agent_task_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  request text not null,
  request_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text not null
    references briar_execution_workers (id) on delete cascade,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text, skill_id text
    references briar_agent_skills (id) on delete set null, skill_execution_proposal_id text, result_summary text, result_conversation_id text, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)), cancel_requested_at text, cancelled_by_user_id text, resume_count integer not null default 0 check (resume_count >= 0),
  unique (project_id, request_id)
);
-- @statement
CREATE TABLE briar_project_execution_worker_allowlist (
  project_id text not null references briar_projects (id) on delete cascade,
  worker_id text not null
    references briar_execution_workers (id) on delete cascade,
  created_at text not null,
  primary key (project_id, worker_id)
);
-- @statement
CREATE TABLE briar_project_execution_worker_policies (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  selection_mode text not null default 'any'
    check (selection_mode in ('any', 'allowlist')),
  default_worker_id text
    references briar_execution_workers (id) on delete set null,
  updated_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_run_checkpoint_progress (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  checkpoint_key text not null check (
    length(checkpoint_key) between 1 and 64
    and substr(checkpoint_key, 1, 1) glob '[a-z]'
    and checkpoint_key not glob '*[^a-z0-9_-]*'
  ),
  stage_id text not null check (
    length(stage_id) between 1 and 64
    and substr(stage_id, 1, 1) glob '[a-z]'
    and stage_id not glob '*[^a-z0-9_-]*'
  ),
  position text not null check (position in ('before', 'after')),
  state text not null check (state in ('pending', 'waiting', 'approved', 'invalidated')),
  reached_at text,
  approved_at text,
  approved_by text,
  approved_request_id text,
  primary key (run_id, attempt, revision, checkpoint_key),
  check (
    (state = 'pending'
      and reached_at is null
      and approved_at is null
      and approved_by is null
      and approved_request_id is null)
    or (state = 'waiting'
      and reached_at is not null
      and approved_at is null
      and approved_by is null
      and approved_request_id is null)
    or (state = 'approved'
      and reached_at is not null
      and approved_at is not null
      and approved_by is not null
      and approved_request_id is not null)
    or (state = 'invalidated')
  )
);
-- @statement
CREATE TABLE briar_run_execution_attempts (
  id text primary key not null check (
    length(id) = 36
    and substr(id, 9, 1) = '-'
    and substr(id, 14, 1) = '-'
    and substr(id, 19, 1) = '-'
    and substr(id, 24, 1) = '-'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,


  project_id text not null,
  run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  run_attempt integer not null check (run_attempt > 0),
  claim_attempt integer not null check (claim_attempt > 0),
  worker_id text,
  claimed_by text,
  claimed_at text not null,
  recorded_at text not null
);
-- @statement
CREATE TABLE briar_run_cost_records (
  execution_id text not null
    references briar_run_execution_attempts (id) on delete cascade,
  cost_key text not null check (length(trim(cost_key)) between 1 and 512),
  usage_key text check (
    usage_key is null or length(trim(usage_key)) between 1 and 512
  ),
  session_id text check (
    session_id is null or length(trim(session_id)) between 1 and 512
  ),
  turn_id text check (
    turn_id is null or length(trim(turn_id)) between 1 and 512
  ),
  scope_id text check (
    scope_id is null or length(trim(scope_id)) between 1 and 512
  ),
  agent_provider text not null check (
    agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  model_provider text check (
    model_provider is null or length(trim(model_provider)) between 1 and 256
  ),
  model text check (
    model is null or length(trim(model)) between 1 and 512
  ),
  canonical_model text check (
    canonical_model is null or length(trim(canonical_model)) between 1 and 512
  ),
  model_source text not null check (
    model_source in (
      'providerReported', 'providerConfig', 'configuredFallback', 'unknown'
    )
  ),
  source text not null check (length(trim(source)) between 1 and 128),
  amount_usd_ticks integer not null check (
    typeof(amount_usd_ticks) = 'integer'
    and amount_usd_ticks >= 0
    and amount_usd_ticks <= 9007199254740991
  ),
  observed_at text not null,
  recorded_at text not null,
  primary key (execution_id, cost_key)
);
-- @statement
CREATE TABLE briar_run_evidence (
  id text primary key,
  project_id text not null references briar_projects(id) on delete cascade,
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null,
  evidence_key text not null,
  workflow_stage text not null,
  evidence_type text not null,
  status text not null check (status in ('pending', 'passed', 'failed', 'skipped')),
  detail text,
  command text,
  url text,
  metadata_json text check (
    metadata_json is null or (
      json_valid(metadata_json) and json_type(metadata_json) = 'object'
    )
  ),
  actor text not null,
  observed_at text not null,
  recorded_at text not null, revision integer not null default 1
  check (revision >= 1), github_association_started_at text, image_upload_ids_json text not null default '[]'
  check (
    json_valid(image_upload_ids_json)
    and json_type(image_upload_ids_json) = 'array'
  ),
  unique (run_id, attempt, evidence_key)
);
-- @statement
CREATE TABLE briar_run_pull_requests (
  project_id text not null
    references briar_projects (id) on delete cascade,
  run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  revision_started_at text not null,
  url text not null check (
    url = trim(url)
    and length(url) between 1 and 1000
    and url like 'https://%'
  ),
  installation_id integer check (installation_id is null or installation_id > 0),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository))
    and length(repository) between 3 and 300
  ),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  pull_request_number integer not null check (pull_request_number > 0),
  state text not null default 'unknown'
    check (state in ('unknown', 'open', 'closed', 'merged')),
  draft integer check (draft is null or draft in (0, 1)),
  head_sha text check (
    head_sha is null or (
      length(head_sha) between 7 and 64
      and head_sha not glob '*[^0-9a-f]*'
    )
  ),
  base_sha text check (
    base_sha is null or (
      length(base_sha) between 7 and 64
      and base_sha not glob '*[^0-9a-f]*'
    )
  ),
  merge_commit_sha text check (
    merge_commit_sha is null or (
      length(merge_commit_sha) between 7 and 64
      and merge_commit_sha not glob '*[^0-9a-f]*'
    )
  ),
  opened_at text,
  closed_at text,
  merged_at text,
  provider_updated_at text,
  last_delivery_id text,
  created_at text not null,
  updated_at text not null, base_branch text,
  primary key (
    run_id, attempt, revision, repository_id, pull_request_number
  )
);
-- @statement
CREATE TABLE briar_run_stage_progress (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  stage_id text not null check (
    length(stage_id) between 1 and 64
    and substr(stage_id, 1, 1) glob '[a-z]'
    and stage_id not glob '*[^a-z0-9_-]*'
  ),
  state text not null check (state in ('pending', 'running', 'completed', 'skipped')),
  started_at text,
  finished_at text,
  primary key (run_id, attempt, revision, stage_id),
  check (
    (state = 'pending' and started_at is null and finished_at is null)
    or (state = 'running' and started_at is not null and finished_at is null)
    or (state = 'completed' and started_at is not null and finished_at is not null)
    or (state = 'skipped' and finished_at is not null)
  )
);
-- @statement
CREATE TABLE briar_run_stage_revisions (
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  workflow_stage text not null,
  required_revision integer not null check (required_revision >= 1),
  primary key (run_id, attempt, workflow_stage)
);
-- @statement
CREATE TABLE briar_run_usage_records (
  execution_id text not null
    references briar_run_execution_attempts (id) on delete cascade,
  usage_key text not null check (length(trim(usage_key)) between 1 and 512),
  session_id text,
  turn_id text,
  scope_id text,
  agent_provider text not null check (
    agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor', 'openrouter')
  ),
  model_provider text,
  model text,
  canonical_model text,
  model_source text not null check (
    model_source in (
      'providerReported', 'providerConfig', 'configuredFallback', 'unknown'
    )
  ),
  source text not null check (length(trim(source)) between 1 and 128),
  uncached_input_tokens integer check (
    uncached_input_tokens is null or uncached_input_tokens >= 0
  ),
  cache_read_tokens integer check (
    cache_read_tokens is null or cache_read_tokens >= 0
  ),
  cache_write_tokens integer check (
    cache_write_tokens is null or cache_write_tokens >= 0
  ),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  reasoning_output_tokens integer check (
    reasoning_output_tokens is null or reasoning_output_tokens >= 0
  ),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  observed_at text not null,
  recorded_at text not null,
  check (
    uncached_input_tokens is not null
    or cache_read_tokens is not null
    or cache_write_tokens is not null
    or output_tokens is not null
    or reasoning_output_tokens is not null
    or total_tokens is not null
  ),
  check (
    reasoning_output_tokens is null
    or (
      output_tokens is not null
      and reasoning_output_tokens <= output_tokens
    )
  ),

  primary key (execution_id, usage_key)
);
-- @statement
CREATE TABLE briar_issue_agent_reply_jobs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  reply_message_id text not null unique,
  agent_id text references briar_project_agents (id) on delete set null,
  requires_preferred_worker integer not null default 0
    check (requires_preferred_worker in (0, 1)),
  agent_name_snapshot text,
  agent_responsibility_snapshot text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text
    references briar_execution_workers (id) on delete set null,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  preferred_provider text
    check (preferred_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')),
  agent_provider text
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')),
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  skill_id text references briar_agent_skills (id) on delete set null,
  selected_skill_id_snapshot text,
  selected_agent_name_snapshot text,
  selected_agent_responsibility_snapshot text,
  selected_skill_name_snapshot text,
  selected_skill_instructions_snapshot text,
  selected_skill_provider_snapshot text,
  selected_skill_kind_snapshot text,
  selected_skill_model_snapshot text,
  selected_skill_effort_snapshot text,
  skill_execution_request_snapshot text, planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1)),
  unique (project_id, trigger_message_id, agent_id)
);
-- @statement
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" text primary key not null,
  "key" text not null unique,
  "count" integer not null,
  "lastRequest" integer not null
);
-- @statement
CREATE TABLE briar_auth_email_rate_limits (
  identifier_hash text primary key not null check (
    length(identifier_hash) = 64
    and identifier_hash not glob '*[^0-9a-f]*'
  ),
  window_started_at integer not null,
  count integer not null check (count between 1 and 5),
  last_sent_at integer not null,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_execution_worker_update_handoffs (
  id text primary key not null,
  update_request_id text not null
    references briar_execution_worker_update_requests (id) on delete cascade,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  device_id text not null
    references briar_execution_worker_devices (id) on delete cascade,
  project_id text not null
    references briar_projects (id) on delete cascade,
  worker_id text
    references briar_execution_workers (id) on delete set null,
  work_type text not null check (
    work_type in ('issue', 'projectAgentTask', 'issueReply', 'channelReply')
  ),
  work_id text not null,
  run_id text,
  claim_token_hash text not null check (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ),
  metadata_json text not null default '{}'
    check (json_valid(metadata_json) and json_type(metadata_json) = 'object'),
  status text not null default 'handed_off'
    check (status in ('handed_off', 'failed')),
  created_at text not null,
  updated_at text not null,
  unique (update_request_id, work_type, work_id)
);
-- @statement
CREATE TABLE briar_merge_queue_profiles (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null default 'main' check (base_branch = 'main'),
  enabled integer not null default 0 check (enabled in (0, 1)),
  quiet_window_ms integer not null default 30000 check (
    quiet_window_ms between 1000 and 300000
  ),
  max_batch_size integer not null default 5 check (
    max_batch_size between 2 and 5
  ),
  created_at text not null,
  updated_at text not null
, readiness_stage_id text not null default 'ci_qa' check (
  readiness_stage_id = trim(readiness_stage_id)
  and length(readiness_stage_id) between 1 and 64
  and readiness_stage_id glob '[a-z]*'
  and readiness_stage_id not glob '*[^a-z0-9_-]*'
), validation_commands_json text not null default '[]' check (
  json_valid(validation_commands_json)
  and json_type(validation_commands_json) = 'array'
));
-- @statement
CREATE TABLE briar_merge_batches (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (base_branch = 'main'),
  state text not null check (state in (
    'collecting', 'frozen', 'enqueueing', 'waiting_tail', 'validating',
    'publishing', 'awaiting_merge', 'blocked', 'draining', 'completed', 'failed'
  )),
  quiet_until text not null,
  frozen_at text,
  
  
  final_delivery_id text unique,
  merge_group_ref text,
  merge_group_sha text check (
    merge_group_sha is null or (
      length(merge_group_sha) = 40
      and merge_group_sha not glob '*[^0-9a-f]*'
    )
  ),
  merge_group_base_sha text check (
    merge_group_base_sha is null or (
      length(merge_group_base_sha) = 40
      and merge_group_base_sha not glob '*[^0-9a-f]*'
    )
  ),
  validation_results_json text check (
    validation_results_json is null or (
      json_valid(validation_results_json)
      and json_type(validation_results_json) = 'array'
    )
  ),
  validated_at text,
  published_at text,
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64
      and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  claimed_worker_id text,
  claimed_by text,
  claimed_at text,
  lease_expires_at text,
  claim_attempts integer not null default 0 check (claim_attempts >= 0),
  failure_code text,
  failure_detail text,
  completed_at text,
  created_at text not null,
  updated_at text not null, validation_commands_json text not null default '[]' check (
  json_valid(validation_commands_json)
  and json_type(validation_commands_json) = 'array'
),
  check (
    (claim_token_hash is null and claimed_worker_id is null
      and claimed_by is null and claimed_at is null and lease_expires_at is null)
    or
    (claim_token_hash is not null and claimed_worker_id is not null
      and claimed_by is not null and claimed_at is not null and lease_expires_at is not null)
  ),
  check (
    (validated_at is null and validation_results_json is null)
    or (validated_at is not null and validation_results_json is not null)
  ),
  check (published_at is null or validated_at is not null),
  check (
    (final_delivery_id is null and merge_group_ref is null
      and merge_group_sha is null and merge_group_base_sha is null)
    or
    (final_delivery_id is not null and merge_group_ref is not null
      and merge_group_sha is not null and merge_group_base_sha is not null)
  )
);
-- @statement
CREATE TABLE briar_merge_batch_candidates (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  batch_id text references briar_merge_batches (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (base_branch = 'main'),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  pull_request_number integer not null check (pull_request_number > 0),
  pull_request_url text not null check (
    pull_request_url = trim(pull_request_url) and pull_request_url like 'https://%'
  ),
  frozen_head_sha text not null check (
    length(frozen_head_sha) = 40
    and frozen_head_sha not glob '*[^0-9a-f]*'
  ),
  frozen_base_sha text not null check (
    length(frozen_base_sha) = 40
    and frozen_base_sha not glob '*[^0-9a-f]*'
  ),
  priority integer check (priority between 1 and 4),
  ready_at text not null,
  ordinal integer check (ordinal is null or ordinal between 1 and 5),
  state text not null default 'ready' check (state in (
    'ready', 'frozen', 'enqueued', 'merged', 'dequeued', 'failed'
  )),
  queue_entry_id text,
  enqueued_at text,
  
  
  merged_delivery_id text,
  merged_at text,
  failure_code text,
  failure_detail text,
  created_at text not null,
  updated_at text not null,
  unique (
    run_id, attempt, revision, repository_id, pull_request_number
  ),
  unique (batch_id, ordinal),
  unique (batch_id, repository_id, pull_request_number),
  unique (queue_entry_id)
);
-- @statement
CREATE TABLE briar_merge_queue_pull_request_observations (
  delivery_id text primary key not null,
  repository_id integer not null check (repository_id > 0),
  pull_request_number integer not null check (pull_request_number > 0),
  action text not null check (
    action = trim(action) and length(action) between 1 and 100
  ),
  identity_changed integer not null check (identity_changed in (0, 1)),
  head_sha text not null check (
    length(head_sha) = 40 and head_sha not glob '*[^0-9a-f]*'
  ),
  base_branch text not null check (
    base_branch = trim(base_branch) and length(base_branch) between 1 and 255
  ),
  received_at text not null
);
-- @statement
CREATE TABLE briar_merge_group_heads (
  
  
  delivery_id text primary key not null,
  batch_id text references briar_merge_batches (id) on delete cascade,
  repository_id integer not null check (repository_id > 0),
  repository text not null check (
    repository = lower(trim(repository)) and length(repository) between 3 and 300
  ),
  base_branch text not null check (base_branch = 'main'),
  head_ref text not null check (
    head_ref = trim(head_ref)
    and head_ref like 'refs/heads/gh-readonly-queue/main/pr-%'
  ),
  head_sha text not null check (
    length(head_sha) = 40 and head_sha not glob '*[^0-9a-f]*'
  ),
  base_sha text not null check (
    length(base_sha) = 40 and base_sha not glob '*[^0-9a-f]*'
  ),
  tail_pull_request_number integer not null check (tail_pull_request_number > 0),
  state text not null check (state in (
    'pending', 'selected', 'superseded', 'orphaned'
  )),
  received_at text not null,
  resolved_at text,
  created_at text not null,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_managed_computer_campaigns (
  id text primary key not null,
  code_key text not null unique check (
    code_key = lower(trim(code_key)) and length(code_key) between 1 and 80
  ),
  name text not null check (length(trim(name)) between 1 and 160),
  active integer not null default 1 check (active in (0, 1)),
  created_at text not null,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_managed_computer_entitlements (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  requester_user_id text not null references "user" (id) on delete restrict,
  source text not null check (source in ('free_promotion', 'payment')),
  source_reference text not null check (length(trim(source_reference)) > 0),
  request_id text not null check (length(trim(request_id)) between 1 and 200),
  status text not null default 'approved'
    check (status in ('approved', 'revoked', 'expired')),
  approved_at text not null,
  revoked_at text,
  expires_at text,
  created_at text not null,
  updated_at text not null,
  unique (organization_id, request_id)
);
-- @statement
CREATE TABLE briar_managed_computer_promotion_redemptions (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete restrict,
  managed_computer_id text not null unique
    references briar_managed_computers (id) on delete restrict,
  campaign_id text not null
    references briar_managed_computer_campaigns (id) on delete restrict,
  request_id text not null check (
    length(trim(request_id)) between 1 and 200
  ),
  redeemed_at text not null,
  unique (organization_id, request_id),
  unique (organization_id, campaign_id),
  unique (user_id, campaign_id)
);
-- @statement
CREATE TABLE briar_managed_computer_audit_events (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  managed_computer_id text
    references briar_managed_computers (id) on delete cascade,
  actor_user_id text references "user" (id) on delete set null,
  action text not null check (action in (
    'promotion_validated', 'entitlement_approved', 'requested',
    'provisioning_started', 'instance_created', 'bootstrapping_started',
    'enrolled', 'ready', 'provisioning_failed', 'retry_requested',
    'draining_started', 'stopped', 'terminated', 'orphan_detected',
    'reconciled'
  )),
  request_id text,
  detail_json text not null default '{}'
    check (json_valid(detail_json) and json_type(detail_json) = 'object'),
  occurred_at text not null
);
-- @statement
CREATE TABLE briar_managed_computer_remote_sessions (
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
  updated_at text not null, agent_id text check (
    agent_id is null or length(trim(agent_id)) between 1 and 256
  ),
  unique (organization_id, controller_user_id, request_id)
);
-- @statement
CREATE TABLE briar_managed_computer_remote_audit_events (
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
-- @statement
CREATE TABLE IF NOT EXISTS "briar_managed_computers" (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  requester_user_id text not null references "user" (id) on delete restrict,
  entitlement_id text not null unique
    references briar_managed_computer_entitlements (id) on delete restrict,
  state text not null default 'requested' check (state in (
    'requested', 'provisioning', 'bootstrapping', 'needs_setup', 'ready',
    'failed', 'draining', 'stopped', 'terminated'
  )),
  aws_account_id text,
  aws_region text not null check (length(trim(aws_region)) between 1 and 40),
  aws_instance_type text not null
    check (length(trim(aws_instance_type)) between 1 and 80),
  aws_instance_id text unique,
  aws_volume_id text,
  aws_launch_template_id text not null
    check (length(trim(aws_launch_template_id)) between 1 and 200),
  aws_launch_template_version text not null
    check (length(trim(aws_launch_template_version)) between 1 and 40),
  bootstrap_api_origin text not null
    check (bootstrap_api_origin like 'https://%'),
  briar_device_id text unique
    references briar_execution_worker_devices (id) on delete set null,
  provisioning_job_id text not null unique,
  enrollment_nonce_hash text not null unique check (
    length(enrollment_nonce_hash) = 64
    and enrollment_nonce_hash not glob '*[^0-9a-f]*'
  ),
  enrollment_expires_at text not null,
  enrollment_consumed_at text,
  enrollment_identity_hash text check (
    enrollment_identity_hash is null or (
      length(enrollment_identity_hash) = 64
      and enrollment_identity_hash not glob '*[^0-9a-f]*'
    )
  ),
  error_code text,
  error_detail text,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at text not null,
  state_updated_at text not null,
  expires_at text not null,
  last_retry_at text,
  drained_at text,
  stopped_at text,
  terminated_at text,
  updated_at text not null
);
-- @statement
CREATE TABLE IF NOT EXISTS "briar_managed_computer_provisioning_jobs" (
  id text primary key not null,
  managed_computer_id text not null
    references briar_managed_computers (id) on delete cascade,
  workflow_instance_id text not null unique,
  idempotency_key text not null unique,
  status text not null default 'requested'
    check (status in ('requested', 'running', 'succeeded', 'failed')),
  attempt integer not null default 1 check (attempt >= 1),
  error_code text,
  error_detail text,
  started_at text,
  completed_at text,
  created_at text not null,
  updated_at text not null,
  unique (managed_computer_id, attempt)
);
-- @statement
CREATE TABLE briar_managed_computer_setup_sessions (
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
-- @statement
CREATE TABLE briar_channel_issue_batch_items (
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null,
  proposal_id text not null,
  project_id text not null,
  local_key text not null check (
    length(local_key) between 1 and 64
    and local_key glob '[A-Za-z0-9]*'
    and local_key not glob '*[^A-Za-z0-9._-]*'
  ),
  position integer not null check (position between 0 and 7),
  source_key text not null unique,
  run_id text not null unique,
  created_at text not null,
  primary key (proposal_id, local_key),
  unique (proposal_id, position)
);
-- @statement
CREATE TABLE briar_channel_reply_sessions (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  thread_root_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  project_id text references briar_projects (id) on delete set null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  provider text not null check (
    provider in (
      'codex', 'claude', 'cursor', 'grok', 'agy', 'opencode', 'openrouter'
    )
  ),
  model text,
  effort text,
  owner_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  owner_worker_id text
    references briar_execution_workers (id) on delete set null,
  conversation_id text check (
    conversation_id is null or length(conversation_id) between 1 and 1024
  ),
  last_activity_at text not null,
  retained_until text not null,
  created_at text not null,
  updated_at text not null, owner_worker_label text
  check (
    owner_worker_label is null
    or length(trim(owner_worker_label)) between 1 and 100
  ), memory_space_id text, memory_revocation_epoch integer,
  unique (channel_id, thread_root_message_id, agent_id),
  check (retained_until >= last_activity_at),
  check (
    (owner_device_id is null and owner_worker_id is null)
    or (owner_device_id is not null and owner_worker_id is not null)
  )
);
-- @statement
CREATE TABLE briar_channel_reply_session_events (
  id text primary key not null,
  session_id text not null
    references briar_channel_reply_sessions (id) on delete cascade,
  reply_job_id text
    references briar_channel_agent_reply_jobs (id) on delete set null,
  event_type text not null check (
    event_type in ('claimed', 'checkpointed', 'ttl_renewed', 'cleaned')
  ),
  reason text not null check (length(reason) between 1 and 100),
  from_worker_id text,
  to_worker_id text,
  retained_until text,
  detail_json text not null default '{}'
    check (json_valid(detail_json) and json_type(detail_json) = 'object'),
  occurred_at text not null
);
-- @statement
CREATE TABLE briar_execution_worker_lifecycle_events (
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
-- @statement
CREATE TABLE briar_issue_attachments (
  id text primary key not null,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'video/mp4', 'video/webm', 'video/quicktime'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);
-- @statement
CREATE TABLE briar_organization_members (
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  role text not null check (
    role in ('owner', 'co-owner', 'developer', 'editor', 'viewer')
  ),
  created_at text not null,
  updated_at text not null,
  primary key (organization_id, user_id)
);
-- @statement
CREATE TABLE briar_project_members (
  project_id text not null,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  updated_at text not null,
  primary key (project_id, user_id),
  foreign key (project_id, organization_id)
    references briar_projects (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);
-- @statement
CREATE TABLE briar_issue_subscriptions (
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  primary key (run_id, user_id),
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);
-- @statement
CREATE TABLE briar_channel_thread_subscriptions (
  root_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  channel_id text not null
    references briar_channels (id) on delete cascade,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  primary key (root_message_id, user_id),
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);
-- @statement
CREATE TABLE briar_organization_invitations (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  initial_project_id text not null
    references briar_projects (id) on delete cascade,
  email_normalized text not null
    check (
      length(email_normalized) between 3 and 320
      and email_normalized = lower(trim(email_normalized))
    ),
  role text not null check (
    role in ('co-owner', 'developer', 'editor', 'viewer')
  ),
  token_hash text not null unique check (
    length(token_hash) = 64
    and token_hash not glob '*[^0-9a-f]*'
  ),
  invited_by_user_id text references "user" (id) on delete set null,
  expires_at text not null,
  accepted_at text,
  accepted_by_user_id text references "user" (id) on delete set null,
  revoked_at text,
  created_at text not null,
  updated_at text not null,
  check (accepted_at is null or revoked_at is null)
);
-- @statement
CREATE TABLE briar_mobile_push_registrations (
  id text primary key,
  user_id text not null references "user"(id) on delete cascade,
  platform text not null check (platform in ('apns', 'fcm')),
  token text not null,
  environment text not null check (environment in ('development', 'production')),
  topic text not null,
  locale text not null check (locale in ('ko', 'en', 'zh')),
  play_sound integer not null check (play_sound in (0, 1)),
  notify_urgent integer not null check (notify_urgent in (0, 1)),
  notify_action_required integer not null check (notify_action_required in (0, 1)),
  notify_important integer not null check (notify_important in (0, 1)),
  notify_activity integer not null check (notify_activity in (0, 1)),
  registered_at text not null,
  updated_at text not null,
  unique (platform, token)
);
-- @statement
CREATE TABLE briar_mobile_push_registration_scopes (
  registration_id text not null
    references briar_mobile_push_registrations(id) on delete cascade,
  organization_id text not null
    references briar_organizations(id) on delete cascade,
  baseline_version integer not null check (baseline_version >= 0),
  registered_at text not null,
  updated_at text not null,
  primary key (registration_id, organization_id)
);
-- @statement
CREATE TABLE briar_mobile_push_deliveries (
  registration_id text not null
    references briar_mobile_push_registrations(id) on delete cascade,
  message_id text not null,
  message_version text not null,
  delivered_at text not null,
  primary key (registration_id, message_id, message_version)
);
-- @statement
CREATE TABLE briar_mobile_push_outbox (
  
  
  
  organization_id text primary key,
  version integer not null check (version >= 0),
  updated_at text not null
);
-- @statement
CREATE TABLE briar_teams (
  id text primary key not null,
  owner_user_id text not null references "user" (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  agent_token_hash text not null unique check (
    length(agent_token_hash) = 64
    and agent_token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null,
  updated_at text not null,
  organization_id text references briar_organizations (id) on delete cascade,
  icon_data_url text check (
    icon_data_url is null
    or (
      length(icon_data_url) <= 400000
      and substr(icon_data_url, 1, 23) = 'data:image/webp;base64,'
    )
  ),
  icon_data_url_browser text check (
    icon_data_url_browser is null
    or (
      length(icon_data_url_browser) <= 400000
      and (
        substr(icon_data_url_browser, 1, 22) = 'data:image/png;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/jpeg;base64,'
        or substr(icon_data_url_browser, 1, 23) = 'data:image/webp;base64,'
      )
    )
  ),
  issue_key_prefix text not null default 'AH' check (
    issue_key_prefix = upper(trim(issue_key_prefix))
    and length(issue_key_prefix) between 1 and 3
    and issue_key_prefix not glob '*[^A-Z0-9]*'
  ),
  schedule_tab_enabled integer not null default 1
    check (schedule_tab_enabled in (0, 1))
, icon_name text
  check (
    icon_name is null
    or (
      length(icon_name) between 1 and 40
      and icon_name not glob '*[^a-z0-9-]*'
    )
  ), icon_color text
  check (
    icon_color is null
    or (
      length(icon_color) = 7
      and substr(icon_color, 1, 1) = '#'
      and substr(icon_color, 2) not glob '*[^0-9a-f]*'
    )
  ));
-- @statement
CREATE TABLE briar_planning_projects (
  id text primary key not null,
  team_id text not null references briar_teams (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 10000),
  status text not null default 'planned'
    check (status in ('planned', 'active', 'completed', 'cancelled')),
  lead_user_id text references "user" (id) on delete set null,
  start_date text check (
    start_date is null or (
      start_date = date(start_date) and length(start_date) = 10
    )
  ),
  target_date text check (
    target_date is null or (
      target_date = date(target_date) and length(target_date) = 10
    )
  ),
  icon text check (icon is null or length(icon) <= 200),
  color text check (
    color is null or (
      length(color) = 7
      and substr(color, 1, 1) = '#'
      and substr(color, 2) not glob '*[^0-9A-Fa-f]*'
    )
  ),
  sort_order integer not null default 0,
  is_default integer not null default 0 check (is_default in (0, 1)),
  created_at text not null,
  updated_at text not null,
  unique (id, team_id)
);
-- @statement
CREATE TABLE briar_issue_key_aliases (
  team_id text not null references briar_teams (id) on delete cascade,
  issue_key text not null check (length(trim(issue_key)) between 3 and 32),
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  created_at text not null,
  primary key (team_id, issue_key)
);
-- @statement
CREATE TABLE briar_agent_skill_execution_realtime_outbox (
  task_id text primary key not null,
  organization_id text not null,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_cursor integer,
  project_cursor integer,
  session_version integer not null check (session_version >= 0),
  updated_at text not null
);
-- @statement
CREATE TABLE briar_dm_memory_spaces (
  id text primary key not null,
  organization_id text not null references briar_organizations(id) on delete cascade,
  channel_id text not null,
  owner_user_id text not null references "user"(id) on delete cascade,
  agent_id text not null,
  roster_epoch integer not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  use_enabled integer not null default 0 check (use_enabled in (0, 1)),
  auto_enabled integer not null default 0 check (auto_enabled in (0, 1)),
  auto_enabled_at text,
  ever_saved integer not null default 0 check (ever_saved in (0, 1)),
  memory_revision integer not null default 0,
  revocation_epoch integer not null default 0,
  created_at text not null,
  updated_at text not null,
  unique (organization_id, channel_id, owner_user_id, agent_id, roster_epoch)
);
-- @statement
CREATE TABLE briar_dm_memory_documents (
  id text primary key not null,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  kind text not null check (kind in ('observation', 'topic')),
  title text not null check (length(title) between 1 and 200),
  current_version integer not null check (current_version > 0),
  status text not null default 'active'
    check (status in ('active', 'invalidated', 'superseded', 'deleted')),
  conflicted integer not null default 0 check (conflicted in (0, 1)),
  superseded_by text,
  created_at text not null,
  updated_at text not null, expired_version integer not null default 0,
  unique (space_id, id)
);
-- @statement
CREATE TABLE briar_dm_memory_revisions (
  space_id text not null,
  document_id text not null,
  version integer not null,
  body text not null check (length(cast(body as blob)) between 1 and 65536),
  body_hash text not null,
  memory_class text not null check (memory_class in ('profile', 'log', 'note')),
  evidence_type text not null check (evidence_type in ('explicit_user', 'observed')),
  protected_by_user integer not null check (protected_by_user in (0, 1)),
  source_language text not null,
  observed_at text,
  valid_until text,
  origin text not null check (origin in ('user_edit', 'explicit_request', 'extract', 'consolidate')),
  author_agent_id text,
  policy_version text not null,
  created_at text not null,
  primary key (document_id, version),
  foreign key (space_id, document_id)
    references briar_dm_memory_documents(space_id, id) on delete cascade
);
-- @statement
CREATE TABLE briar_dm_memory_sources (
  space_id text not null,
  document_id text not null,
  document_version integer not null,
  item_id text not null default '',
  source_type text not null check (source_type in ('message', 'user_edit_event')),
  source_id text not null,
  source_version integer not null,
  source_hash text not null,
  primary key (document_id, document_version, item_id, source_type, source_id),
  foreign key (space_id, document_id)
    references briar_dm_memory_documents(space_id, id) on delete cascade,
  foreign key (document_id, document_version)
    references briar_dm_memory_revisions(document_id, version) on delete cascade
);
-- @statement
CREATE TABLE briar_dm_memory_commits (
  id text primary key not null,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  request_id text not null,
  document_id text,
  payload_hash text,
  result_version integer,
  applied integer not null default 0 check (applied in (0, 1)),
  created_at text not null,
  unique (space_id, request_id)
);
-- @statement
CREATE TABLE briar_dm_memory_jobs (
  id text primary key not null,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  kind text not null check (kind in ('index', 'delete', 'extract', 'consolidate', 'explicit_request')),
  dedupe_key text not null unique,
  document_id text,
  document_version integer,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retry_wait', 'succeeded', 'no_change', 'failed', 'cancelled')),
  stage text,
  attempt integer not null default 0,
  lease_token_hash text,
  lease_expires_at text,
  expected_memory_revision integer not null,
  revocation_epoch integer not null,
  input_json text,
  error_code text,
  mutation_id text,
  available_at text not null,
  created_at text not null,
  updated_at text not null
, claimed_worker_id text, claimed_device_id text, input_hash text, policy_json text, calls_used integer not null default 0, source_start integer not null default 0, source_end integer not null default 0, request_source_id text, request_targets_json text not null default '[]', result_json text);
-- @statement
CREATE TABLE briar_dm_memory_exclusions (
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  source_type text not null check (source_type in ('message', 'user_edit_event')),
  source_id text not null,
  document_id text not null,
  revocation_epoch integer not null,
  created_at text not null,
  primary key (space_id, source_type, source_id, document_id)
);
-- @statement
CREATE TABLE briar_dm_memory_chunks (
  id text primary key not null,
  space_id text not null,
  document_id text not null,
  document_version integer not null,
  vector_id text not null unique,
  splitter_profile text not null,
  embedding_profile text not null,
  start_bytes integer not null check (start_bytes >= 0),
  end_bytes integer not null check (end_bytes > start_bytes),
  line_start integer not null check (line_start > 0),
  line_end integer not null check (line_end >= line_start),
  headings_json text not null,
  token_count integer not null check (token_count between 1 and 800),
  ready integer not null default 0 check (ready in (0, 1)),
  created_at text not null,
  foreign key (space_id, document_id)
    references briar_dm_memory_documents(space_id, id) on delete cascade,
  foreign key (document_id, document_version)
    references briar_dm_memory_revisions(document_id, version) on delete cascade
);
-- @statement
CREATE TABLE briar_dm_memory_vectors (
  id text primary key not null,
  organization_id text not null,
  space_id text not null,
  document_id text not null,
  document_version integer not null,
  chunk_id text not null,
  embedding_profile text not null,
  state text not null default 'pending'
    check (state in ('pending', 'submitted', 'ready', 'purging', 'purged', 'purge_failed')),
  upsert_mutation_id text,
  delete_mutation_id text,
  submitted_at text,
  write_expires_at text,
  delete_submitted_at text,
  confirmed_at text,
  available_at text not null,
  lease_token text,
  lease_expires_at text,
  attempt integer not null default 0,
  error_code text,
  created_at text not null
);
-- @statement
CREATE TABLE briar_dm_memory_briefs (
  space_id text primary key not null references briar_dm_memory_spaces(id) on delete cascade,
  memory_revision integer not null,
  revocation_epoch integer not null,
  policy_version text not null,
  valid_through text,
  content_json text not null check (length(cast(content_json as blob)) <= 8192),
  created_at text not null
);
-- @statement
CREATE TABLE briar_issue_parent_links (
  project_id text not null references briar_projects (id) on delete cascade,
  parent_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  child_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (child_run_id),
  check (parent_run_id <> child_run_id)
);
-- @statement
CREATE TABLE briar_issue_relations (
  project_id text not null references briar_projects (id) on delete cascade,
  first_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  second_run_id text not null
    references briar_hunt_runs (id) on delete cascade,
  relation_type text not null default 'related'
    check (relation_type = 'related'),
  created_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (first_run_id, second_run_id),
  check (first_run_id < second_run_id)
);
-- @statement
CREATE TABLE briar_dm_memory_reply_fences (
  job_id text primary key not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  space_id text not null,
  revocation_epoch integer not null,
  protocol integer not null check (protocol in (0, 1)),
  created_at text not null
);
-- @statement
CREATE TABLE briar_channel_reply_lookups (
  job_id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  request_id text not null,
  kind text not null check (kind in ('memory', 'organization')),
  request_hash text,
  query_hashes_json text not null default '[]' check (json_valid(query_hashes_json)),
  memory_revision integer,
  revocation_epoch integer,
  lease_token text not null,
  lease_expires_at text not null,
  attempts integer not null default 1,
  response_json text check (response_json is null or (json_valid(response_json) and length(cast(response_json as blob)) <= 2097152)),
  created_at text not null,
  primary key (job_id, claim_token_hash, request_id)
);
-- @statement
CREATE TABLE briar_dm_memory_discovered_refs (
  job_id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  version integer not null,
  primary key (job_id, claim_token_hash, document_id, version)
);
-- @statement
CREATE TABLE briar_dm_memory_activity_revocations (
  id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  organization_id text not null, channel_id text not null, agent_id text not null,
  trigger_message_id text not null, parent_message_id text not null,
  attempts integer not null, primary key (id, attempts)
);
-- @statement
CREATE TABLE briar_dm_memory_reply_citations (
  message_id text not null references briar_channel_messages(id) on delete cascade,
  document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  version integer not null,
  primary key (message_id, document_id, version)
);
-- @statement
CREATE TABLE briar_dm_memory_source_events (
  sequence integer primary key autoincrement,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  message_id text not null,
  created_at text not null,
  unique (space_id, message_id)
);
-- @statement
CREATE TABLE briar_dm_memory_learning_outbox (
  reply_job_id text not null,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  kind text not null check (kind in ('extract', 'explicit_request')),
  source_end integer not null,
  request_source_id text,
  request_targets_json text not null default '[]',
  revocation_epoch integer not null,
  settled integer not null default 0,
  available_at text not null,
  created_at text not null,
  primary key (reply_job_id, kind)
);
-- @statement
CREATE TABLE briar_dm_memory_observation_events (
  sequence integer primary key autoincrement,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  document_id text not null,
  document_version integer not null,
  created_at text not null,
  unique (document_id, document_version)
);
-- @statement
CREATE TABLE briar_dm_memory_learning_state (
  space_id text primary key not null references briar_dm_memory_spaces(id) on delete cascade,
  source_watermark integer not null default 0,
  observation_watermark integer not null default 0,
  last_consolidation_started_at text,
  last_consolidation_succeeded_at text,
  last_scheduled_at text,
  updated_at text not null
);
-- @statement
CREATE TABLE briar_dm_memory_learning_retries (
  request_id text primary key not null,
  operation_id text not null,
  job_id text not null references briar_dm_memory_jobs(id) on delete cascade,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  revocation_epoch integer not null,
  created_at text not null
);
-- @statement
CREATE TABLE briar_dm_memory_learning_inputs (
  job_id text not null references briar_dm_memory_jobs(id) on delete cascade,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  source_type text not null check (source_type in ('message', 'user_edit_event')),
  source_id text not null,
  source_version integer not null,
  source_hash text,
  primary key (job_id, source_type, source_id)
);
-- @statement
CREATE TABLE briar_dm_memory_model_calls (
  id text primary key not null,
  job_id text not null references briar_dm_memory_jobs(id) on delete cascade,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  organization_id text not null references briar_organizations(id) on delete cascade,
  claim_token_hash text not null,
  stage text not null check (stage in ('proposing', 'verifying')),
  input_hash text,
  proposal_hash text,
  model_json text not null,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed')),
  budget_applied integer not null default 0,
  reserved_micro_usd integer not null,
  input_tokens integer,
  output_tokens integer,
  cost_micro_usd integer,
  error_code text,
  created_at text not null,
  completed_at text
);
-- @statement
CREATE TABLE briar_dm_memory_proposals (
  id text primary key not null references briar_dm_memory_model_calls(id) on delete cascade,
  job_id text not null references briar_dm_memory_jobs(id) on delete cascade,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  input_hash text,
  proposal_hash text,
  proposal_json text,
  normalized_json text,
  status text not null check (status in ('proposed', 'applied', 'rejected', 'stale', 'cancelled')),
  created_at text not null,
  terminal_at text
);
-- @statement
CREATE TABLE briar_dm_memory_verifications (
  id text primary key not null references briar_dm_memory_model_calls(id) on delete cascade,
  job_id text not null references briar_dm_memory_jobs(id) on delete cascade,
  proposal_id text not null references briar_dm_memory_proposals(id) on delete cascade,
  input_hash text,
  proposal_hash text,
  decisions_json text,
  approved integer not null,
  request_authorized integer not null default 0,
  error_code text,
  created_at text not null
);
-- @statement
CREATE TABLE briar_dm_memory_learning_commits (
  job_id text primary key not null references briar_dm_memory_jobs(id) on delete cascade,
  commit_id text not null references briar_dm_memory_commits(id) on delete cascade,
  proposal_hash text,
  result_json text not null
);
-- @statement
CREATE TABLE briar_dm_memory_document_links (
  document_id text not null,
  document_version integer not null,
  source_document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  source_document_version integer not null,
  primary key (document_id, document_version, source_document_id),
  foreign key (document_id, document_version)
    references briar_dm_memory_revisions(document_id, version) on delete cascade
);
-- @statement
CREATE TABLE briar_dm_memory_learning_payload_purges (
  space_id text not null,
  source_type text not null,
  source_id text not null,
  primary key (space_id, source_type, source_id)
);
-- @statement
CREATE TABLE briar_dm_memory_purge_documents (
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  root_document_id text not null,
  document_id text not null,
  primary key (root_document_id, document_id)
);
-- @statement
CREATE TABLE briar_reply_completion_receipts (
  request_id text primary key not null,
  reply_kind text not null check (reply_kind in ('issue', 'channel')),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null,
  work_id text not null,
  run_id text not null,
  worker_id text not null,
  device_id text not null,
  claim_token_hash text not null check (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ),
  payload_hash text not null check (
    length(payload_hash) = 64
    and payload_hash not glob '*[^0-9a-f]*'
  ),
  outcome_kind text not null check (outcome_kind in ('success', 'failure')),
  disposition text not null
    check (disposition in ('completed', 'requeued', 'failed')),
  retained_until text,
  created_at text not null,
  check (
    (reply_kind = 'issue' and retained_until is null)
    or reply_kind = 'channel'
  ),
  check (
    (outcome_kind = 'success' and disposition = 'completed')
    or (outcome_kind = 'failure' and disposition in ('requeued', 'failed'))
  ),
  unique (reply_kind, work_id, worker_id, claim_token_hash)
);
-- @statement
CREATE TABLE briar_upload_batches (
  request_id text primary key not null,
  purpose text not null check (
    purpose in (
      'issue_reply', 'channel_reply', 'run_evidence', 'channel_message',
      'issue_create', 'issue_update', 'issue_message'
    )
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text references briar_projects (id) on delete cascade,
  channel_id text references briar_channels (id) on delete cascade,
  user_id text references "user" (id) on delete cascade,
  work_id text,
  run_id text,
  worker_id text,
  device_id text,
  claim_token_hash text check (
    claim_token_hash is null or (
      length(claim_token_hash) = 64
      and claim_token_hash not glob '*[^0-9a-f]*'
    )
  ),
  metadata_hash text not null check (
    length(metadata_hash) = 64
    and metadata_hash not glob '*[^0-9a-f]*'
  ),
  file_count integer not null check (file_count between 1 and 5),
  creation_nonce text not null unique check (length(creation_nonce) = 36),
  expires_at text not null,
  created_at text not null,
  check (expires_at > created_at)
);
-- @statement
CREATE TABLE briar_uploads (
  upload_id text primary key not null,
  batch_request_id text not null
    references briar_upload_batches (request_id) on delete cascade,
  client_id text not null check (
    client_id = trim(client_id) and length(client_id) between 1 and 128
  ),
  position integer not null check (position between 0 and 4),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (
    content_type = trim(content_type)
    and length(content_type) between 1 and 255
  ),
  byte_size integer not null check (byte_size between 1 and 20971520),
  sha256 blob not null check (typeof(sha256) = 'blob' and length(sha256) = 32),
  object_key text not null unique check (
    object_key = trim(object_key) and length(object_key) between 1 and 500
  ),
  uploaded_at text,
  consumed_at text,
  consumer_kind text,
  consumer_id text,
  check (
    (consumed_at is null and consumer_kind is null and consumer_id is null)
    or (
      uploaded_at is not null and consumed_at is not null
      and consumer_kind is not null and consumer_id is not null
    )
  ),
  unique (batch_request_id, client_id),
  unique (batch_request_id, position)
);
-- @statement
CREATE TABLE briar_upload_cleanup_queue (
  object_key text primary key not null,
  batch_request_id text not null,
  attempts integer not null default 0 check (attempts >= 0),
  generation integer not null default 1 check (generation >= 1),
  queued_at text not null,
  next_attempt_at text not null,
  last_error text
);
-- @statement
CREATE TABLE briar_channel_message_mutation_receipts (
  message_id text primary key not null
    references briar_channel_messages (id) on delete cascade,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null
);
-- @statement
CREATE TABLE briar_run_evidence_images (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  evidence_id text not null references briar_run_evidence (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  position integer not null check (position between 0 and 4),
  created_at text not null,
  unique (evidence_id, position)
);
-- @statement
CREATE TABLE briar_issue_create_mutation_receipts (
  client_issue_id text primary key not null
    references briar_hunt_runs (id) on delete cascade check (
      length(client_issue_id) between 1 and 128
      and client_issue_id not glob '*[^0-9A-Za-z_-]*'
    ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);
-- @statement
CREATE TABLE briar_issue_update_mutation_receipts (
  request_id text primary key not null check (
    length(request_id) between 1 and 128
    and request_id not glob '*[^0-9A-Za-z_-]*'
  ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade check (
    length(run_id) between 1 and 128
    and run_id not glob '*[^0-9A-Za-z_-]*'
  ),
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);
-- @statement
CREATE TABLE briar_issue_message_mutation_receipts (
  message_id text primary key not null
    references briar_issue_messages (id) on delete cascade check (
      length(message_id) between 1 and 128
      and message_id not glob '*[^0-9A-Za-z_-]*'
    ),
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade check (
    length(run_id) between 1 and 128
    and run_id not glob '*[^0-9A-Za-z_-]*'
  ),
  user_id text not null references "user" (id) on delete cascade,
  request_hash text not null check (
    length(request_hash) = 64
    and request_hash not glob '*[^0-9a-f]*'
  ),
  attachment_upload_ids_json text not null check (
    length(attachment_upload_ids_json) between 2 and 1024
    and json_valid(attachment_upload_ids_json)
    and json_type(attachment_upload_ids_json) = 'array'
    and json_array_length(attachment_upload_ids_json) between 0 and 5
  ),
  response_json text not null check (
    length(response_json) between 2 and 1000000
    and json_valid(response_json)
    and json_type(response_json) = 'object'
  ),
  created_at text not null check (
    length(created_at) between 17 and 64 and created_at = trim(created_at)
  )
);
-- @statement
CREATE TABLE briar_project_agent_schedules (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name)
    and length(name) between 1 and 120
  ),
  recurrence text not null check (
    recurrence in ('interval', 'daily', 'weekdays', 'weekly', 'custom')
  ),
  time_of_day text not null check (
    length(time_of_day) = 5
    and substr(time_of_day, 3, 1) = ':'
    and substr(time_of_day, 1, 2) between '00' and '23'
    and substr(time_of_day, 4, 2) between '00' and '59'
  ),
  day_of_week integer check (
    (recurrence = 'weekly' and day_of_week between 0 and 6)
    or (recurrence != 'weekly' and day_of_week is null)
  ),
  time_zone text not null check (
    time_zone = trim(time_zone)
    and length(time_zone) between 1 and 100
  ),
  enabled integer not null default 1 check (enabled in (0, 1)),
  created_at text not null,
  updated_at text not null,
  next_run_at text,
  interval_value integer not null default 1
    check (interval_value between 1 and 999),
  interval_unit text not null default 'day'
    check (interval_unit in ('minute', 'hour', 'day', 'week')),
  days_of_week text,
  notification_level text not null default 'important_updates'
    check (notification_level in ('important_updates', 'none')),
  created_by_user_id text references "user" (id) on delete set null
);
-- @statement
CREATE TABLE briar_project_agent_schedule_runs (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  schedule_id text not null
    references briar_project_agent_schedules (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  scheduled_for text not null,
  claim_token_hash text,
  lease_expires_at text,
  started_at text not null,
  completed_at text,
  result_summary text,
  error text,
  created_at text not null,
  updated_at text not null,
  structured_result_json text,
  unique (schedule_id, scheduled_for)
);
-- @statement
CREATE TABLE briar_run_evidence_pull_requests (
  evidence_id text primary key not null
    references briar_run_evidence (id) on delete cascade,
  run_id text not null,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  repository_id integer not null check (repository_id > 0),
  pull_request_number integer not null check (pull_request_number > 0),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  foreign key (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  ) references briar_run_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  ) on delete cascade
);
-- @statement
CREATE TABLE briar_channel_message_attachments (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null references briar_channels (id) on delete cascade,
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'text/html', 'application/pdf'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);
-- @statement
CREATE TABLE IF NOT EXISTS "account" (
  "id" text primary key not null,
  "issuer" text not null,
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
-- @statement
CREATE TABLE briar_production_operation_leases (
  name text primary key not null,
  owner text not null,
  head_sha text not null,
  acquired_at integer not null,
  expires_at integer not null,
  constraint briar_production_operation_leases_name_check
    check (length(name) between 1 and 80),
  constraint briar_production_operation_leases_owner_check
    check (length(owner) between 1 and 80),
  constraint briar_production_operation_leases_head_sha_check
    check (head_sha not glob '*[^0-9a-f]*' and length(head_sha) = 40),
  constraint briar_production_operation_leases_expiry_check
    check (expires_at > acquired_at)
) strict;
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-pilot','getbriar-pilot','GETBRIAR managed computer pilot',1,'2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-1','getbriar-jay-1','Managed computer pilot Jay slot 1',1,'2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-2','getbriar-jay-2','Managed computer pilot Jay slot 2',1,'2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-3','getbriar-jay-3','Managed computer pilot Jay slot 3',1,'2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-4','getbriar-jay-4','Managed computer pilot Jay slot 4',1,'2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-5','getbriar-jay-5','Managed computer pilot Jay slot 5',1,'2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-6','getbriar-jay-6','Managed computer pilot Jay slot 6',1,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-7','getbriar-jay-7','Managed computer pilot Jay slot 7',1,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-8','getbriar-jay-8','Managed computer pilot Jay slot 8',1,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-9','getbriar-jay-9','Managed computer pilot Jay slot 9',1,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z');
-- @statement
INSERT INTO "briar_managed_computer_campaigns" ("id","code_key","name","active","created_at","updated_at") VALUES('getbriar-jay-10','getbriar-jay-10','Managed computer pilot Jay slot 10',1,'2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z');
-- @statement
CREATE VIEW briar_run_child_storage_a_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'issue_attachment' as entity_kind,
       child.id as entity_id
from briar_issue_attachments child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'issue_message', child.id
from briar_issue_messages child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'run_evidence', child.id
from briar_run_evidence child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'run_evidence_image', child.id
from briar_run_evidence_images child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id;
-- @statement
CREATE VIEW briar_run_child_relation_a_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'run_pull_request' as entity_kind,
       child.run_id || ':' || child.attempt || ':' || child.revision || ':' ||
       child.repository_id || ':' || child.pull_request_number as entity_id
from briar_run_pull_requests child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'transcript_session',
       child.session_id
from briar_agent_transcript_sessions child
join briar_hunt_runs run on run.id = child.run_id
where child.run_id is not null and child.project_id <> run.project_id
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = child.session_id
  )
union all
select child.project_id, run.project_id, run.id, 'rework_proposal', child.id
from briar_issue_rework_proposals child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'action_proposal', child.id
from briar_issue_action_proposals child
join briar_hunt_runs run on run.id = child.conversation_run_id
where child.project_id <> run.project_id;
-- @statement
CREATE VIEW briar_run_child_relation_b_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'dependency_prerequisite' as entity_kind,
       child.prerequisite_run_id || ':' || child.dependent_run_id
         as entity_id
from briar_issue_dependencies child
join briar_hunt_runs run on run.id = child.prerequisite_run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'dependency_dependent',
       child.prerequisite_run_id || ':' || child.dependent_run_id
from briar_issue_dependencies child
join briar_hunt_runs run on run.id = child.dependent_run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'channel_proposal', child.id
from briar_channel_action_proposals child
join briar_hunt_runs run on run.id = child.result_run_id
where child.status = 'accepted' and child.project_id is not null
  and child.project_id <> run.project_id;
-- @statement
CREATE VIEW briar_run_child_storage_b_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'issue_reply_job' as entity_kind,
       child.id as entity_id
from briar_issue_agent_reply_jobs child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'log_archive', child.id
from briar_log_archives child
join briar_hunt_runs run on run.id = child.run_id
where child.archive_kind <> 'execution_audit'
  and child.project_id <> run.project_id
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_archive'
      and quarantine.entity_id = child.id
  )
union all
select child.project_id, run.project_id, run.id, 'archive_cleanup',
       child.bucket || ':' || child.object_key
from briar_archive_cleanup_queue child
join briar_hunt_runs run on run.id = child.run_id
where child.run_id is not null and child.project_id <> run.project_id;
-- @statement
CREATE VIEW briar_issue_hierarchy as
select run.id,
       team.organization_id as workspace_id,
       run.team_id,
       run.planning_project_id as project_id,
       run.run_number,
       run.source,
       run.source_key,
       run.title,
       run.status,
       run.repository,
       run.created_at,
       run.updated_at
from briar_hunt_runs run
join briar_teams team on team.id = run.team_id
join briar_planning_projects project
  on project.id = run.planning_project_id
 and project.team_id = run.team_id;
-- @statement
CREATE VIEW briar_dm_memory_live_rosters as
select channel.organization_id, channel.id as channel_id, member.user_id as owner_user_id,
       agent.id as agent_id, channel.memory_roster_epoch as roster_epoch
from briar_channels channel
join briar_channel_members member on member.channel_id = channel.id
join briar_organization_members membership
  on membership.organization_id = channel.organization_id and membership.user_id = member.user_id
join briar_channel_agents roster on roster.channel_id = channel.id
join briar_project_agents agent
  on agent.id = roster.agent_id and agent.organization_id = channel.organization_id
where channel.kind = 'dm' and channel.archived_at is null
  and (select count(*) from briar_channel_members m where m.channel_id = channel.id) = 1
  and (select count(*) from briar_channel_agents a where a.channel_id = channel.id) = 1
  and (agent.project_id is null or (
    membership.role in ('owner', 'co-owner', 'developer')
    and exists (select 1 from briar_teams team
      where team.id = agent.project_id and team.organization_id = channel.organization_id
        and (membership.role in ('owner', 'co-owner') or exists (
          select 1 from briar_project_members pm where pm.project_id = team.id
            and pm.organization_id = team.organization_id and pm.user_id = member.user_id
        )))
  ));
-- @statement
CREATE VIEW briar_workflow_checkpoint_storage_validation as
select cast(null as text) as owner, cast(null as text) as checkpoints_json
where 0;
-- @statement
CREATE VIEW briar_execution_worker_healthy_providers as
select worker.id as worker_id,
       case json_extract(health.value, '$.provider')
         when 'AGENT_PROVIDER_CODEX' then 'codex'
         when 'AGENT_PROVIDER_CLAUDE' then 'claude'
         when 'AGENT_PROVIDER_CURSOR' then 'cursor'
         when 'AGENT_PROVIDER_GROK' then 'grok'
         when 'AGENT_PROVIDER_AGY' then 'agy'
         when 'AGENT_PROVIDER_OPENCODE' then 'opencode'
         when 'AGENT_PROVIDER_OPENROUTER' then 'openrouter'
       end as provider,
       case json_extract(worker.runtime_proto_json, '$.agentProvider')
         when 'AGENT_PROVIDER_CODEX' then 'codex'
         when 'AGENT_PROVIDER_CLAUDE' then 'claude'
         when 'AGENT_PROVIDER_CURSOR' then 'cursor'
         when 'AGENT_PROVIDER_GROK' then 'grok'
         when 'AGENT_PROVIDER_AGY' then 'agy'
         when 'AGENT_PROVIDER_OPENCODE' then 'opencode'
         when 'AGENT_PROVIDER_OPENROUTER' then 'openrouter'
       end as agent_provider
from briar_execution_workers worker,
     json_each(worker.runtime_proto_json, '$.providerHealth') health
where json_extract(health.value, '$.healthy') = 1
  and json_extract(health.value, '$.provider') in (
    'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
    'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
    'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
  );
-- @statement
CREATE VIEW briar_invalid_execution_worker_runtime as
select worker.id
from briar_execution_workers worker
where not (
  json_valid(worker.runtime_proto_json)
  and json_type(worker.runtime_proto_json) = 'object'
  and length(cast(worker.runtime_proto_json as blob)) <= 1048576
  and json_extract(worker.runtime_proto_json, '$.agentProvider') in (
    'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
    'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
    'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
  )
  and json_type(worker.runtime_proto_json, '$.providerHealth') = 'array'
  and json_array_length(worker.runtime_proto_json, '$.providerHealth') = 7
  and (
    select count(distinct json_extract(health.value, '$.provider'))
    from json_each(worker.runtime_proto_json, '$.providerHealth') health
    where health.type = 'object'
      and json_extract(health.value, '$.provider') in (
        'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
        'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
        'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
      )
  ) = 7
  and json_type(worker.runtime_proto_json, '$.capabilities') = 'object'
  and json_type(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = 'array'
  and json_array_length(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = 7
  and (
    select count(distinct json_extract(capability.value, '$.provider'))
    from json_each(
      worker.runtime_proto_json, '$.capabilities.providerCapabilities'
    ) capability
    where capability.type = 'object'
      and json_extract(capability.value, '$.provider') in (
        'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
        'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
        'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
      )
  ) = 7
  and (
    json_type(worker.runtime_proto_json, '$.versions') is null
    or json_type(worker.runtime_proto_json, '$.versions') = 'object'
  )
);
-- @statement
CREATE VIEW briar_invalid_project_agent_session_payload as
select session.project_id, session.id
from briar_project_agent_sessions session
where case
  when length(cast(session.payload_json as blob)) > 1048576 then 1
  when not json_valid(session.payload_json) then 1
  when json_type(session.payload_json) <> 'object' then 1
  else
    coalesce(
      json_extract(session.payload_json, '$.agentId') is not session.agent_id,
      1
    )
    or coalesce(
      json_extract(session.payload_json, '$.status') is not session.status,
      1
    )
    or coalesce(
      json_extract(session.payload_json, '$.sessionType')
        is not session.session_type,
      1
    )
    or coalesce(
      json_extract(session.payload_json, '$.startedAt')
        is not session.started_at,
      1
    )
    or json_extract(session.payload_json, '$.completedAt')
      is not session.completed_at
    or coalesce(
      json_extract(session.payload_json, '$.updatedAt')
        is not session.updated_at,
      1
    )
    or json_extract(session.payload_json, '$.requestedByUserId')
      is not session.requested_by_user_id
end;
-- @statement
CREATE VIEW briar_invalid_project_agent_session_summary as
select summary.project_id, summary.session_id
from briar_project_agent_session_summaries summary
where case
  when length(cast(summary.summary_json as blob)) > 262144 then 1
  when not json_valid(summary.summary_json) then 1
  when json_type(summary.summary_json) <> 'object' then 1
  else
    coalesce(
      json_extract(summary.summary_json, '$.updatedAt')
        is not summary.updated_at,
      1
    )
    or coalesce(
      json_type(summary.summary_json, '$.requestedByUserId')
        not in ('null', 'text'),
      1
    )
end;
-- @statement
CREATE INDEX "session_userId_idx" on "session" ("userId");
-- @statement
CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");
-- @statement
CREATE INDEX briar_projects_owner_idx
  on briar_projects (owner_user_id, created_at);
-- @statement
CREATE INDEX briar_projects_organization_idx
  on briar_projects (organization_id, created_at);
-- @statement
CREATE UNIQUE INDEX briar_organizations_handle_idx
  on briar_organizations (handle);
-- @statement
CREATE INDEX briar_slack_installations_organization_idx
  on briar_slack_installations (organization_id, created_at);
-- @statement
CREATE INDEX briar_slack_oauth_states_expiry_idx
  on briar_slack_oauth_states (expires_at);
-- @statement
CREATE INDEX briar_slack_events_claimed_idx
  on briar_slack_events (status, claimed_at);
-- @statement
CREATE INDEX briar_execution_worker_devices_owner_idx
  on briar_execution_worker_devices
    (owner_user_id, organization_id, last_heartbeat_at desc);
-- @statement
CREATE INDEX briar_execution_worker_credentials_expiry_idx
  on briar_execution_worker_credentials (expires_at, revoked_at);
-- @statement
CREATE INDEX briar_project_agent_tokens_project_idx
  on briar_project_agent_tokens (project_id, created_at);
-- @statement
CREATE INDEX briar_dashboard_changes_project_version_idx
  on briar_dashboard_changes (project_id, version);
-- @statement
CREATE INDEX briar_dashboard_changes_created_idx
  on briar_dashboard_changes (created_at);
-- @statement
CREATE INDEX briar_archive_cleanup_queue_age_idx
  on briar_archive_cleanup_queue (queued_at, bucket, object_key);
-- @statement
CREATE UNIQUE INDEX "user_username_unique_idx"
  on "user" (lower("username"))
  where "username" is not null;
-- @statement
CREATE INDEX briar_project_agent_sessions_recent_idx
  on briar_project_agent_sessions (project_id, updated_at desc, id);
-- @statement
CREATE INDEX briar_user_workflow_checkpoint_defaults_user_idx
  on briar_user_workflow_checkpoint_defaults (user_id, project_id);
-- @statement
CREATE INDEX briar_github_deliveries_status_idx
  on briar_github_deliveries (status, claimed_at);
-- @statement
CREATE INDEX briar_github_pull_requests_repository_idx
  on briar_github_pull_requests (repository, pull_request_number);
-- @statement
CREATE INDEX briar_github_pull_requests_url_idx
  on briar_github_pull_requests (url);
-- @statement
CREATE INDEX briar_inbox_read_states_user_updated_idx
  on briar_inbox_read_states (user_id, updated_at desc);
-- @statement
CREATE UNIQUE INDEX briar_github_connections_active_organization_idx
  on briar_github_connections (organization_id)
  where status = 'connected';
-- @statement
CREATE INDEX briar_github_connections_organization_idx
  on briar_github_connections (organization_id, status, updated_at);
-- @statement
CREATE INDEX briar_github_connection_repositories_name_idx
  on briar_github_connection_repositories (installation_id, full_name);
-- @statement
CREATE INDEX briar_github_oauth_states_expiry_idx
  on briar_github_oauth_states (expires_at);
-- @statement
CREATE UNIQUE INDEX briar_channels_slug_idx
  on briar_channels (organization_id, slug);
-- @statement
CREATE INDEX briar_channels_organization_idx
  on briar_channels (organization_id, archived_at, name);
-- @statement
CREATE INDEX briar_channel_members_user_idx
  on briar_channel_members (user_id, channel_id);
-- @statement
CREATE INDEX briar_channel_changes_organization_version_idx
  on briar_channel_changes (organization_id, version);
-- @statement
CREATE INDEX briar_channel_changes_created_idx
  on briar_channel_changes (created_at);
-- @statement
CREATE UNIQUE INDEX briar_execution_worker_update_requests_pending_idx
  on briar_execution_worker_update_requests (device_id)
  where status = 'requested';
-- @statement
CREATE INDEX briar_execution_worker_update_requests_org_idx
  on briar_execution_worker_update_requests
    (organization_id, status, requested_at desc);
-- @statement
CREATE INDEX briar_projects_organization_context_idx
  on briar_projects (organization_id, created_at, id);
-- @statement
CREATE INDEX briar_project_agent_session_context_visible_idx
  on briar_project_agent_session_context_membership (
    project_id, visible_at, session_id
  );
-- @statement
CREATE INDEX briar_channel_issue_approval_audit_run_identity_idx
  on briar_channel_issue_approval_audit (run_id, issue_source_key);
-- @statement
CREATE INDEX briar_channel_issue_approval_audit_proposal_idx
  on briar_channel_issue_approval_audit (proposal_id, created_at);
-- @statement
CREATE INDEX briar_archive_cleanup_queue_due_idx
  on briar_archive_cleanup_queue (
    dead_lettered_at, next_attempt_at, queued_at, bucket, object_key
  );
-- @statement
CREATE INDEX briar_slack_revocation_queue_due_idx
  on briar_slack_revocation_queue (
    dead_lettered_at, next_attempt_at, queued_at, id
  );
-- @statement
CREATE INDEX briar_project_agent_task_completion_receipt_session_idx
  on briar_project_agent_task_completion_receipts (
    project_id, task_id, created_at
  );
-- @statement
CREATE INDEX briar_project_agent_session_summaries_recent_idx
  on briar_project_agent_session_summaries (
    project_id, updated_at desc, session_id
  );
-- @statement
CREATE INDEX briar_project_agent_session_changes_project_version_idx
  on briar_project_agent_session_changes (project_id, version);
-- @statement
CREATE INDEX briar_project_agent_session_changes_created_idx
  on briar_project_agent_session_changes (created_at);
-- @statement
CREATE INDEX briar_channel_webhooks_channel_idx
  on briar_channel_webhooks (channel_id, revoked_at, created_at, id);
-- @statement
CREATE INDEX briar_channel_read_states_channel_idx
  on briar_channel_read_states (channel_id);
-- @statement
CREATE INDEX briar_hunt_events_run_idx
  on briar_hunt_events (run_id, occurred_at desc, id desc);
-- @statement
CREATE INDEX briar_hunt_events_run_attempt_idx
  on briar_hunt_events (run_id, attempt, occurred_at desc, id desc);
-- @statement
CREATE INDEX briar_run_evidence_run_attempt
  on briar_run_evidence (run_id, attempt, workflow_stage, evidence_type);
-- @statement
CREATE INDEX briar_run_stage_revisions_run_attempt
  on briar_run_stage_revisions (run_id, attempt, required_revision);
-- @statement
CREATE UNIQUE INDEX briar_execution_audit_request_idx
  on briar_execution_audit_events (project_id, action, request_id)
  where request_id is not null;
-- @statement
CREATE INDEX briar_execution_audit_project_idx
  on briar_execution_audit_events (project_id, occurred_at desc, id);
-- @statement
CREATE INDEX briar_project_execution_worker_allowlist_worker_idx
  on briar_project_execution_worker_allowlist (worker_id, project_id);
-- @statement
CREATE INDEX briar_issue_message_mentions_user_idx
  on briar_issue_message_mentions (user_id, created_at desc, message_id);
-- @statement
CREATE INDEX briar_issue_dependencies_dependent_idx
  on briar_issue_dependencies (project_id, dependent_run_id, created_at);
-- @statement
CREATE INDEX briar_issue_dependencies_prerequisite_idx
  on briar_issue_dependencies (project_id, prerequisite_run_id, created_at);
-- @statement
CREATE INDEX briar_log_archives_project_kind_idx
  on briar_log_archives (project_id, archive_kind, period_end, id);
-- @statement
CREATE INDEX briar_log_archives_run_kind_idx
  on briar_log_archives (run_id, archive_kind, period_end, id)
  where run_id is not null;
-- @statement
CREATE INDEX briar_log_archives_status_idx
  on briar_log_archives (status, created_at, id);
-- @statement
CREATE INDEX briar_log_archives_expiry_idx
  on briar_log_archives (expires_at, id)
  where status = 'complete';
-- @statement
CREATE INDEX briar_issue_result_reviews_completed_idx
  on briar_issue_result_reviews (completed_at desc);
-- @statement
CREATE INDEX briar_issue_messages_run_idx
  on briar_issue_messages (run_id, created_at, id);
-- @statement
CREATE INDEX briar_issue_messages_parent_idx
  on briar_issue_messages (parent_message_id, created_at, id);
-- @statement
CREATE INDEX briar_execution_workers_project_idx
  on briar_execution_workers (project_id, last_heartbeat_at desc);
-- @statement
CREATE UNIQUE INDEX briar_execution_workers_project_device_idx
  on briar_execution_workers (project_id, device_id);
-- @statement
CREATE INDEX briar_execution_workers_device_idx
  on briar_execution_workers (device_id, project_id);
-- @statement
CREATE INDEX briar_agent_transcript_sessions_project_idx
  on briar_agent_transcript_sessions (project_id, last_event_at desc);
-- @statement
CREATE INDEX briar_hunt_runs_project_idx
  on briar_hunt_runs (project_id, last_event_at desc);
-- @statement
CREATE INDEX briar_hunt_runs_attention_idx
  on briar_hunt_runs (project_id, last_event_at desc)
  where stage in ('blocked', 'failed');
-- @statement
CREATE INDEX briar_hunt_runs_tracker_issue_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_issue_id is not null;
-- @statement
CREATE UNIQUE INDEX briar_hunt_runs_tracker_issue_unique_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_provider is not null and tracker_issue_id is not null;
-- @statement
CREATE INDEX briar_hunt_runs_worker_idx
  on briar_hunt_runs (worker_id, last_event_at desc);
-- @statement
CREATE INDEX briar_hunt_runs_status_idx
  on briar_hunt_runs (project_id, status, last_event_at desc);
-- @statement
CREATE INDEX briar_hunt_runs_queue_claim_idx on briar_hunt_runs (
  project_id, priority, source_created_at, lease_expires_at
) where status = 'queued';
-- @statement
CREATE UNIQUE INDEX briar_hunt_runs_dispatch_request_idx
  on briar_hunt_runs (project_id, dispatch_request_id)
  where dispatch_request_id is not null;
-- @statement
CREATE INDEX briar_hunt_runs_dispatch_queue_idx on briar_hunt_runs (
  project_id, status, requested_worker_id, agent_id, dispatched_at
);
-- @statement
CREATE INDEX briar_run_stage_progress_lookup_idx
  on briar_run_stage_progress (run_id, attempt, revision, stage_id);
-- @statement
CREATE INDEX briar_run_checkpoint_progress_lookup_idx
  on briar_run_checkpoint_progress (
    run_id, attempt, revision, stage_id, position
  );
-- @statement
CREATE UNIQUE INDEX briar_run_checkpoint_waiting_unique_idx
  on briar_run_checkpoint_progress (run_id, attempt, revision)
  where state = 'waiting';
-- @statement
CREATE INDEX briar_hunt_runs_waiting_checkpoint_idx
  on briar_hunt_runs (
    project_id, waiting_checkpoint_revision, waiting_checkpoint_key
  )
  where waiting_checkpoint_key is not null;
-- @statement
CREATE INDEX briar_hunt_runs_resume_requested_idx
  on briar_hunt_runs(project_id, resume_requested_at, run_number)
  where resume_requested_at is not null;
-- @statement
CREATE INDEX briar_hunt_runs_assignee_idx
  on briar_hunt_runs (project_id, assignee_user_id, updated_at desc);
-- @statement
CREATE INDEX briar_run_pull_requests_current_idx
  on briar_run_pull_requests (run_id, attempt, revision, state);
-- @statement
CREATE INDEX briar_run_pull_requests_url_idx
  on briar_run_pull_requests (url, run_id, attempt, revision);
-- @statement
CREATE INDEX briar_run_pull_requests_identity_idx
  on briar_run_pull_requests (
    repository_id, pull_request_number, run_id, attempt, revision
  );
-- @statement
CREATE INDEX briar_issue_rework_proposals_run_idx
  on briar_issue_rework_proposals (run_id, created_at, id);
-- @statement
CREATE INDEX briar_issue_rework_proposals_pending_idx
  on briar_issue_rework_proposals (project_id, status, created_at);
-- @statement
CREATE INDEX briar_issue_action_proposals_run_idx
  on briar_issue_action_proposals (conversation_run_id, created_at, id);
-- @statement
CREATE INDEX briar_issue_action_proposals_pending_idx
  on briar_issue_action_proposals (project_id, status, created_at);
-- @statement
CREATE INDEX briar_channel_message_mentions_user_idx
  on briar_channel_message_mentions (user_id, created_at desc, message_id);
-- @statement
CREATE INDEX briar_channel_message_documents_channel_idx
  on briar_channel_message_documents (channel_id, created_at);
-- @statement
CREATE INDEX briar_channel_action_proposals_pending_idx
  on briar_channel_action_proposals (channel_id, status, created_at);
-- @statement
CREATE INDEX briar_run_execution_attempts_org_claimed_idx
  on briar_run_execution_attempts (
    organization_id, claimed_at desc, run_id, claim_attempt
  );
-- @statement
CREATE INDEX briar_run_execution_attempts_worker_idx
  on briar_run_execution_attempts (worker_id, project_id, id);
-- @statement
CREATE INDEX briar_run_execution_attempts_run_idx
  on briar_run_execution_attempts (run_id, organization_id, claimed_at);
-- @statement
CREATE INDEX briar_run_usage_records_observed_idx
  on briar_run_usage_records (observed_at, execution_id);
-- @statement
CREATE INDEX briar_agent_transcript_sessions_project_run_idx
  on briar_agent_transcript_sessions (
    project_id, run_id, last_event_at desc, started_at desc, session_id desc
  );
-- @statement
CREATE INDEX briar_run_cost_records_observed_idx
  on briar_run_cost_records (observed_at, execution_id);
-- @statement
CREATE INDEX briar_run_cost_records_usage_idx
  on briar_run_cost_records (execution_id, usage_key)
  where usage_key is not null;
-- @statement
CREATE INDEX briar_channel_message_reactions_message_idx
  on briar_channel_message_reactions (message_id, created_at, emoji);
-- @statement
CREATE INDEX briar_hunt_runs_project_run_number_idx
  on briar_hunt_runs (project_id, run_number);
-- @statement
CREATE INDEX briar_log_archives_project_sessions_idx
  on briar_log_archives (project_id, scope_id, period_end, id)
  where archive_kind = 'project_agent_sessions'
    and status in ('verified', 'complete');
-- @statement
CREATE INDEX briar_hunt_runs_source_identity_project_idx
  on briar_hunt_runs (source, source_key, project_id);
-- @statement
CREATE UNIQUE INDEX briar_issue_action_proposals_issue_source_key_idx
  on briar_issue_action_proposals (issue_source_key)
  where issue_source_key is not null;
-- @statement
CREATE UNIQUE INDEX briar_channel_action_proposals_issue_source_key_idx
  on briar_channel_action_proposals (issue_source_key)
  where issue_source_key is not null;
-- @statement
CREATE UNIQUE INDEX briar_channel_action_execution_proposal_idx
  on briar_channel_action_proposals (execution_proposal_id)
  where execution_proposal_id is not null;
-- @statement
CREATE UNIQUE INDEX briar_issue_action_execution_proposal_idx
  on briar_issue_action_proposals (execution_proposal_id)
  where execution_proposal_id is not null;
-- @statement
CREATE INDEX briar_issue_execution_proposals_issue_idx
  on briar_issue_execution_proposals (
    project_id, conversation_run_id, created_at, id
  );
-- @statement
CREATE INDEX briar_issue_execution_proposals_channel_idx
  on briar_issue_execution_proposals (channel_id, created_at, id);
-- @statement
CREATE INDEX briar_issue_execution_proposals_target_idx
  on briar_issue_execution_proposals (target_run_id, status, generation);
-- @statement
CREATE UNIQUE INDEX briar_issue_execution_origin_create_idx
  on briar_issue_execution_proposals (source_kind, origin_create_proposal_id)
  where origin_create_proposal_id is not null;
-- @statement
CREATE INDEX briar_issue_execution_approval_audit_run_idx
  on briar_issue_execution_approval_audit (run_id, approved_at, id);
-- @statement
CREATE INDEX briar_issue_execution_approval_audit_proposal_idx
  on briar_issue_execution_approval_audit (proposal_id, generation);
-- @statement
CREATE INDEX briar_agent_skill_execution_audit_session_idx
  on briar_agent_skill_execution_approval_audit (
    project_id, result_session_id, approved_at
  );
-- @statement
CREATE INDEX briar_run_execution_attempts_project_idx
  on briar_run_execution_attempts (project_id, id);
-- @statement
CREATE INDEX briar_channel_messages_root_idx
  on briar_channel_messages (channel_id, created_at, id)
  where parent_message_id is null;
-- @statement
CREATE INDEX briar_channel_messages_thread_idx
  on briar_channel_messages (parent_message_id, created_at, id);
-- @statement
CREATE INDEX briar_channel_messages_channel_idx
  on briar_channel_messages (channel_id, created_at, id);
-- @statement
CREATE UNIQUE INDEX briar_channel_messages_webhook_event_idx
  on briar_channel_messages (author_webhook_id, webhook_event_id)
  where author_webhook_id is not null and webhook_event_id is not null;
-- @statement
CREATE INDEX briar_hunt_runs_project_created_idx
  on briar_hunt_runs (project_id, source_created_at, created_by_user_id);
-- @statement
CREATE INDEX briar_agent_worklog_entries_session_sequence_idx
  on briar_agent_worklog_entries (session_id, sequence, entry_id);
-- @statement
CREATE INDEX briar_agent_worklog_entries_session_updated_idx
  on briar_agent_worklog_entries (session_id, updated_sequence, entry_id);
-- @statement
CREATE INDEX briar_agent_transcript_segments_session_sequence_idx
  on briar_agent_transcript_segments (
    session_id, first_sequence, last_sequence
  );
-- @statement
CREATE INDEX briar_hunt_runs_github_reconcile_idx
  on briar_hunt_runs (paused_at, id)
  where status = 'running'
    and paused_at is not null
    and resume_requested_at is null
    and workflow_stage = 'pr_open';
-- @statement
CREATE INDEX briar_project_agents_project_idx
  on briar_project_agents (project_id, created_at, id);
-- @statement
CREATE INDEX briar_project_agents_organization_idx
  on briar_project_agents (organization_id, created_at, id);
-- @statement
CREATE INDEX briar_channel_agents_agent_idx
  on briar_channel_agents (agent_id, channel_id);
-- @statement
CREATE INDEX briar_channel_agent_reply_jobs_queue_idx
  on briar_channel_agent_reply_jobs (
    organization_id, status, project_id, lease_expires_at, created_at
  );
-- @statement
CREATE INDEX briar_channel_agent_reply_jobs_channel_idx
  on briar_channel_agent_reply_jobs (channel_id, created_at desc);
-- @statement
CREATE INDEX briar_project_agent_task_jobs_queue_idx
  on briar_project_agent_task_jobs (
    project_id, preferred_worker_id, status, lease_expires_at, created_at
  );
-- @statement
CREATE INDEX briar_project_agent_task_jobs_session_idx
  on briar_project_agent_task_jobs (project_id, updated_at desc, id);
-- @statement
CREATE UNIQUE INDEX briar_agent_skills_name_idx
  on briar_agent_skills (agent_id, name collate nocase);
-- @statement
CREATE INDEX briar_agent_skills_agent_idx
  on briar_agent_skills (agent_id, position, created_at, id);
-- @statement
CREATE INDEX briar_project_agent_task_jobs_skill_idx
  on briar_project_agent_task_jobs (skill_id, status, created_at);
-- @statement
CREATE INDEX briar_channel_agent_reply_jobs_skill_idx
  on briar_channel_agent_reply_jobs (skill_id, status, created_at);
-- @statement
CREATE INDEX briar_channel_agent_reply_jobs_claimed_worker_idx
  on briar_channel_agent_reply_jobs (claimed_worker_id, status, lease_expires_at);
-- @statement
CREATE UNIQUE INDEX briar_channel_agent_reply_jobs_delegation_target_idx
  on briar_channel_agent_reply_jobs (delegated_by_reply_job_id, agent_id)
  where delegated_by_reply_job_id is not null;
-- @statement
CREATE INDEX briar_channel_agent_reply_jobs_delegation_parent_idx
  on briar_channel_agent_reply_jobs (
    delegated_by_reply_job_id, status, created_at, id
  );
-- @statement
CREATE UNIQUE INDEX briar_agent_skill_execution_source_job_idx
  on briar_agent_skill_execution_proposals (source_kind, source_reply_job_id);
-- @statement
CREATE INDEX briar_agent_skill_execution_channel_idx
  on briar_agent_skill_execution_proposals (channel_id, created_at, id);
-- @statement
CREATE INDEX briar_agent_skill_execution_issue_idx
  on briar_agent_skill_execution_proposals (
    project_id, conversation_run_id, created_at, id
  );
-- @statement
CREATE INDEX briar_agent_skill_execution_skill_idx
  on briar_agent_skill_execution_proposals (skill_id, status, created_at);
-- @statement
CREATE UNIQUE INDEX briar_project_agent_task_skill_execution_idx
  on briar_project_agent_task_jobs (skill_execution_proposal_id)
  where skill_execution_proposal_id is not null;
-- @statement
CREATE INDEX briar_channel_agent_reply_jobs_preferred_device_idx
  on briar_channel_agent_reply_jobs (
    preferred_device_id, status, created_at, id
  );
-- @statement
CREATE INDEX briar_channel_notification_inbox_user_organization_created_idx
  on briar_channel_notification_inbox (
    user_id, organization_id, created_at desc, message_id desc
  );
-- @statement
CREATE INDEX briar_issue_agent_reply_jobs_queue_idx
  on briar_issue_agent_reply_jobs (
    project_id, status, preferred_worker_id, lease_expires_at, created_at
  );
-- @statement
CREATE INDEX briar_issue_agent_reply_jobs_run_idx
  on briar_issue_agent_reply_jobs (run_id, created_at desc);
-- @statement
CREATE INDEX briar_issue_agent_reply_jobs_skill_idx
  on briar_issue_agent_reply_jobs (skill_id, status, created_at);
-- @statement
CREATE INDEX briar_issue_agent_reply_jobs_agent_idx
  on briar_issue_agent_reply_jobs (agent_id, status, created_at);
-- @statement
CREATE UNIQUE INDEX verification_sign_in_otp_unique_idx
  on verification (identifier)
  where identifier like 'sign-in-otp-%';
-- @statement
CREATE INDEX briar_auth_email_rate_limits_updated_idx
  on briar_auth_email_rate_limits (updated_at);
-- @statement
CREATE INDEX briar_project_agent_session_summaries_requester_recent_idx
  on briar_project_agent_session_summaries (
    project_id,
    json_extract(summary_json, '$.requestedByUserId'),
    updated_at desc,
    session_id
  );
-- @statement
CREATE INDEX briar_execution_worker_update_handoffs_device_idx
  on briar_execution_worker_update_handoffs (device_id, updated_at desc);
-- @statement
CREATE INDEX briar_execution_worker_update_handoffs_work_idx
  on briar_execution_worker_update_handoffs (work_type, work_id, updated_at desc);
-- @statement
CREATE UNIQUE INDEX briar_merge_queue_profiles_enabled_lane_idx
  on briar_merge_queue_profiles (repository_id, base_branch)
  where enabled = 1;
-- @statement
CREATE UNIQUE INDEX briar_merge_batches_active_lane_idx
  on briar_merge_batches (repository_id, base_branch)
  where state in (
    'collecting', 'frozen', 'enqueueing', 'waiting_tail', 'validating',
    'publishing', 'awaiting_merge', 'blocked', 'draining'
  );
-- @statement
CREATE INDEX briar_merge_batches_claim_idx
  on briar_merge_batches (project_id, state, quiet_until, lease_expires_at);
-- @statement
CREATE INDEX briar_merge_batch_candidates_ready_idx
  on briar_merge_batch_candidates (
    repository_id, base_branch, state, batch_id,
    priority, ready_at, run_id, pull_request_number
  );
-- @statement
CREATE INDEX briar_merge_batch_candidates_project_state_idx
  on briar_merge_batch_candidates (
    project_id, state, batch_id, repository_id, base_branch
  );
-- @statement
CREATE INDEX briar_merge_batch_candidates_pull_request_head_idx
  on briar_merge_batch_candidates (
    repository_id, pull_request_number, frozen_head_sha, state
  );
-- @statement
CREATE INDEX briar_merge_queue_pull_request_observations_identity_idx
  on briar_merge_queue_pull_request_observations (
    repository_id, pull_request_number, received_at
  );
-- @statement
CREATE UNIQUE INDEX briar_merge_group_heads_selected_batch_idx
  on briar_merge_group_heads (batch_id)
  where state = 'selected';
-- @statement
CREATE INDEX briar_merge_group_heads_pending_idx
  on briar_merge_group_heads (
    repository_id, base_branch, tail_pull_request_number, state, received_at
  );
-- @statement
CREATE UNIQUE INDEX briar_channels_direct_message_key_idx
  on briar_channels (organization_id, dm_key)
  where kind = 'dm' and dm_key is not null;
-- @statement
CREATE INDEX briar_channels_kind_idx
  on briar_channels (organization_id, kind, archived_at, updated_at desc);
-- @statement
CREATE INDEX briar_managed_computer_entitlements_requester_idx
  on briar_managed_computer_entitlements
    (requester_user_id, approved_at desc);
-- @statement
CREATE INDEX briar_managed_computer_redemptions_campaign_idx
  on briar_managed_computer_promotion_redemptions
    (campaign_id, redeemed_at desc);
-- @statement
CREATE INDEX briar_managed_computer_audit_organization_idx
  on briar_managed_computer_audit_events
    (organization_id, occurred_at desc);
-- @statement
CREATE INDEX briar_managed_computer_audit_computer_idx
  on briar_managed_computer_audit_events
    (managed_computer_id, occurred_at desc);
-- @statement
CREATE UNIQUE INDEX briar_managed_computer_remote_sessions_controller_idx
  on briar_managed_computer_remote_sessions (managed_computer_id)
  where state in ('created', 'connecting', 'connected', 'disconnected');
-- @statement
CREATE INDEX briar_managed_computer_remote_sessions_organization_idx
  on briar_managed_computer_remote_sessions (organization_id, created_at desc);
-- @statement
CREATE INDEX briar_managed_computer_remote_sessions_user_rate_idx
  on briar_managed_computer_remote_sessions
    (controller_user_id, created_at desc);
-- @statement
CREATE INDEX briar_managed_computer_remote_sessions_expiry_idx
  on briar_managed_computer_remote_sessions (state, max_expires_at);
-- @statement
CREATE INDEX briar_managed_computer_remote_audit_computer_idx
  on briar_managed_computer_remote_audit_events
    (managed_computer_id, occurred_at desc);
-- @statement
CREATE INDEX briar_managed_computer_remote_audit_session_idx
  on briar_managed_computer_remote_audit_events
    (remote_session_id, occurred_at desc);
-- @statement
CREATE INDEX briar_managed_computers_organization_idx
  on briar_managed_computers (organization_id, created_at desc);
-- @statement
CREATE INDEX briar_managed_computers_fleet_idx
  on briar_managed_computers (state, created_at);
-- @statement
CREATE INDEX briar_managed_computers_expiry_idx
  on briar_managed_computers (expires_at, state);
-- @statement
CREATE INDEX briar_managed_computers_device_idx
  on briar_managed_computers (briar_device_id, state);
-- @statement
CREATE INDEX briar_managed_computer_jobs_status_idx
  on briar_managed_computer_provisioning_jobs (status, created_at);
-- @statement
CREATE INDEX briar_channel_messages_deleted_idx
  on briar_channel_messages (channel_id, deleted_at)
  where deleted_at is not null;
-- @statement
CREATE INDEX briar_managed_computer_setup_sessions_expiry_idx
  on briar_managed_computer_setup_sessions (status, expires_at);
-- @statement
CREATE INDEX briar_managed_computer_setup_sessions_computer_idx
  on briar_managed_computer_setup_sessions
    (managed_computer_id, created_at desc);
-- @statement
CREATE INDEX briar_managed_computer_setup_sessions_project_idx
  on briar_managed_computer_setup_sessions (project_id, created_at desc);
-- @statement
CREATE INDEX briar_channel_issue_batch_items_proposal_idx
  on briar_channel_issue_batch_items (proposal_id, position);
-- @statement
CREATE INDEX briar_channel_issue_batch_items_run_idx
  on briar_channel_issue_batch_items (run_id, source_key);
-- @statement
CREATE INDEX briar_channel_reply_sessions_owner_idx
  on briar_channel_reply_sessions (
    owner_worker_id, retained_until, updated_at
  );
-- @statement
CREATE INDEX briar_channel_reply_sessions_expiry_idx
  on briar_channel_reply_sessions (retained_until, updated_at);
-- @statement
CREATE INDEX briar_channel_agent_reply_jobs_session_idx
  on briar_channel_agent_reply_jobs (
    session_id, status, lease_expires_at, created_at, id
  );
-- @statement
CREATE INDEX briar_channel_reply_session_events_session_idx
  on briar_channel_reply_session_events (session_id, occurred_at desc, id);
-- @statement
CREATE INDEX briar_execution_worker_lifecycle_reason_idx
  on briar_execution_worker_lifecycle_events (
    reason, operation, created_at desc
  );
-- @statement
CREATE INDEX briar_execution_worker_lifecycle_device_idx
  on briar_execution_worker_lifecycle_events (device_id, created_at desc);
-- @statement
CREATE UNIQUE INDEX briar_projects_id_organization_unique
  on briar_projects (id, organization_id);
-- @statement
CREATE INDEX briar_agent_skill_execution_origin_idx
  on briar_agent_skill_execution_proposals (
    channel_id, thread_root_message_id, trigger_message_id, created_at
  );
-- @statement
CREATE INDEX briar_project_agents_designated_worker_idx
  on briar_project_agents (designated_worker_id, project_id);
-- @statement
CREATE INDEX briar_issue_attachments_run_idx
  on briar_issue_attachments (run_id, created_at, id);
-- @statement
CREATE INDEX briar_issue_attachments_project_idx
  on briar_issue_attachments (project_id, run_id);
-- @statement
CREATE INDEX briar_organization_members_user_idx
  on briar_organization_members (user_id, organization_id);
-- @statement
CREATE INDEX briar_project_members_user_idx
  on briar_project_members (user_id, project_id);
-- @statement
CREATE INDEX briar_issue_subscriptions_user_idx
  on briar_issue_subscriptions (organization_id, user_id, created_at desc);
-- @statement
CREATE INDEX briar_channel_thread_subscriptions_user_idx
  on briar_channel_thread_subscriptions (
    organization_id, user_id, created_at desc
  );
-- @statement
CREATE INDEX briar_channel_thread_subscriptions_channel_idx
  on briar_channel_thread_subscriptions (channel_id, root_message_id);
-- @statement
CREATE INDEX briar_organization_invitations_org_idx
  on briar_organization_invitations (
    organization_id, accepted_at, revoked_at, created_at desc
  );
-- @statement
CREATE INDEX briar_organization_invitations_email_idx
  on briar_organization_invitations (
    email_normalized, accepted_at, revoked_at, expires_at
  );
-- @statement
CREATE UNIQUE INDEX briar_organization_invitations_pending_idx
  on briar_organization_invitations (organization_id, email_normalized)
  where accepted_at is null and revoked_at is null;
-- @statement
CREATE INDEX briar_mobile_push_registrations_user_idx
  on briar_mobile_push_registrations (user_id, updated_at desc);
-- @statement
CREATE INDEX briar_mobile_push_registration_scopes_organization_idx
  on briar_mobile_push_registration_scopes (
    organization_id, baseline_version, registration_id
  );
-- @statement
CREATE INDEX briar_mobile_push_deliveries_delivered_idx
  on briar_mobile_push_deliveries (delivered_at);
-- @statement
CREATE INDEX briar_teams_owner_idx
  on briar_teams (owner_user_id, created_at);
-- @statement
CREATE INDEX briar_teams_organization_idx
  on briar_teams (organization_id, created_at);
-- @statement
CREATE INDEX briar_teams_organization_context_idx
  on briar_teams (organization_id, id, name, created_at);
-- @statement
CREATE UNIQUE INDEX briar_teams_id_organization_unique
  on briar_teams (id, organization_id);
-- @statement
CREATE INDEX briar_planning_projects_team_sort_idx
  on briar_planning_projects (team_id, sort_order, created_at, id);
-- @statement
CREATE UNIQUE INDEX briar_planning_projects_team_default_unique
  on briar_planning_projects (team_id) where is_default = 1;
-- @statement
CREATE INDEX briar_hunt_runs_planning_project_idx
  on briar_hunt_runs (planning_project_id, last_event_at desc, id);
-- @statement
CREATE INDEX briar_hunt_runs_team_hierarchy_idx
  on briar_hunt_runs (team_id, last_event_at desc, id);
-- @statement
CREATE INDEX briar_issue_key_aliases_run_idx
  on briar_issue_key_aliases (run_id, created_at, team_id);
-- @statement
CREATE INDEX briar_agent_skill_execution_realtime_outbox_updated_idx
  on briar_agent_skill_execution_realtime_outbox (updated_at, task_id);
-- @statement
CREATE INDEX briar_dm_memory_spaces_owner on briar_dm_memory_spaces
  (organization_id, owner_user_id, channel_id, status);
-- @statement
CREATE INDEX briar_dm_memory_documents_page on briar_dm_memory_documents
  (space_id, status, id);
-- @statement
CREATE INDEX briar_dm_memory_sources_origin on briar_dm_memory_sources
  (source_type, source_id, space_id);
-- @statement
CREATE INDEX briar_dm_memory_jobs_claim on briar_dm_memory_jobs
  (kind, status, available_at, id);
-- @statement
CREATE INDEX briar_dm_memory_chunks_document on briar_dm_memory_chunks
  (space_id, document_id, document_version, start_bytes);
-- @statement
CREATE INDEX briar_dm_memory_vectors_cleanup on briar_dm_memory_vectors (state, available_at, id);
-- @statement
CREATE INDEX briar_dm_memory_vectors_document on briar_dm_memory_vectors (document_id, document_version);
-- @statement
CREATE INDEX briar_issue_parent_links_parent_idx
  on briar_issue_parent_links (project_id, parent_run_id, created_at);
-- @statement
CREATE INDEX briar_issue_parent_links_child_idx
  on briar_issue_parent_links (project_id, child_run_id, created_at);
-- @statement
CREATE INDEX briar_issue_relations_first_idx
  on briar_issue_relations (project_id, first_run_id, created_at);
-- @statement
CREATE INDEX briar_issue_relations_second_idx
  on briar_issue_relations (project_id, second_run_id, created_at);
-- @statement
CREATE INDEX briar_dm_memory_reply_fences_space on briar_dm_memory_reply_fences(space_id);
-- @statement
CREATE INDEX briar_dm_memory_reply_citations_document on briar_dm_memory_reply_citations(document_id);
-- @statement
CREATE UNIQUE INDEX briar_dm_memory_one_learning_claim on briar_dm_memory_jobs(space_id)
where kind in ('extract', 'explicit_request', 'consolidate') and status = 'running';
-- @statement
CREATE INDEX briar_dm_memory_source_events_space on briar_dm_memory_source_events(space_id, sequence);
-- @statement
CREATE INDEX briar_dm_memory_learning_outbox_pending on briar_dm_memory_learning_outbox(space_id, settled, available_at);
-- @statement
CREATE INDEX briar_dm_memory_observation_events_space on briar_dm_memory_observation_events(space_id, sequence);
-- @statement
CREATE INDEX briar_dm_memory_learning_inputs_source on briar_dm_memory_learning_inputs(space_id, source_type, source_id);
-- @statement
CREATE INDEX briar_dm_memory_calls_organization on briar_dm_memory_model_calls(organization_id, created_at);
-- @statement
CREATE INDEX briar_dm_memory_calls_space on briar_dm_memory_model_calls(space_id, created_at);
-- @statement
CREATE INDEX briar_dm_memory_proposals_job on briar_dm_memory_proposals(job_id, created_at);
-- @statement
CREATE INDEX briar_dm_memory_document_links_source on briar_dm_memory_document_links(source_document_id, source_document_version);
-- @statement
CREATE INDEX briar_reply_completion_receipts_work_idx
  on briar_reply_completion_receipts (reply_kind, work_id, created_at);
-- @statement
CREATE INDEX briar_upload_batches_expiry_idx
  on briar_upload_batches (expires_at, request_id);
-- @statement
CREATE INDEX briar_upload_batches_scope_idx
  on briar_upload_batches (
    purpose, organization_id, project_id, channel_id, user_id, work_id,
    run_id, claim_token_hash
  );
-- @statement
CREATE INDEX briar_uploads_batch_idx
  on briar_uploads (batch_request_id, position, upload_id);
-- @statement
CREATE INDEX briar_uploads_consumer_idx
  on briar_uploads (consumer_kind, consumer_id, upload_id);
-- @statement
CREATE INDEX briar_upload_cleanup_queue_due_idx
  on briar_upload_cleanup_queue (
    next_attempt_at, attempts, queued_at, object_key
  );
-- @statement
CREATE INDEX briar_channel_message_mutation_receipts_scope_idx
  on briar_channel_message_mutation_receipts (
    organization_id, channel_id, user_id, message_id
  );
-- @statement
CREATE INDEX briar_run_evidence_images_evidence_idx
  on briar_run_evidence_images (evidence_id, position, id);
-- @statement
CREATE INDEX briar_run_evidence_images_project_run_idx
  on briar_run_evidence_images (project_id, run_id);
-- @statement
CREATE INDEX briar_issue_create_mutation_receipts_scope_idx
  on briar_issue_create_mutation_receipts (
    organization_id, project_id, user_id, client_issue_id
  );
-- @statement
CREATE INDEX briar_issue_update_mutation_receipts_scope_idx
  on briar_issue_update_mutation_receipts (
    organization_id, project_id, run_id, user_id, request_id
  );
-- @statement
CREATE INDEX briar_issue_message_mutation_receipts_scope_idx
  on briar_issue_message_mutation_receipts (
    organization_id, project_id, run_id, user_id, message_id
  );
-- @statement
CREATE INDEX briar_project_agent_schedules_project_idx
  on briar_project_agent_schedules (project_id, created_at, id);
-- @statement
CREATE INDEX briar_project_agent_schedules_agent_idx
  on briar_project_agent_schedules (agent_id, created_at, id);
-- @statement
CREATE INDEX briar_project_agent_schedules_due_idx
  on briar_project_agent_schedules (project_id, enabled, next_run_at, id);
-- @statement
CREATE INDEX briar_project_agent_schedule_runs_project_idx
  on briar_project_agent_schedule_runs (project_id, scheduled_for desc, id);
-- @statement
CREATE INDEX briar_project_agent_schedule_runs_lease_idx
  on briar_project_agent_schedule_runs (
    project_id, status, lease_expires_at, scheduled_for, id
  );
-- @statement
CREATE UNIQUE INDEX briar_run_pull_requests_full_identity_idx
  on briar_run_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  );
-- @statement
CREATE INDEX briar_run_evidence_pull_requests_link_idx
  on briar_run_evidence_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  );
-- @statement
CREATE INDEX briar_channel_message_attachments_message_idx
  on briar_channel_message_attachments (message_id, created_at, id);
-- @statement
CREATE INDEX briar_channel_message_attachments_channel_idx
  on briar_channel_message_attachments (organization_id, channel_id, message_id);
-- @statement
CREATE INDEX "account_userId_idx" on "account" ("userId");
-- @statement
CREATE UNIQUE INDEX "account_issuer_accountId_uidx"
  on "account" ("issuer", "accountId");
-- @statement
CREATE UNIQUE INDEX "deviceCode_deviceCode_uidx"
  on "deviceCode" ("deviceCode");
-- @statement
CREATE UNIQUE INDEX "deviceCode_userCode_uidx"
  on "deviceCode" ("userCode");
-- @statement
CREATE TRIGGER briar_dashboard_settings_update_sync
after update on briar_project_settings BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_projects_update_sync
after update on briar_projects BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.id, 'metadata', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_channels_insert_sync
after insert on briar_channels BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.id, 'channel', new.id, 'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_channels_delete_sync
after delete on briar_channels BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    old.organization_id, old.id, 'channel', old.id, 'delete', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (old.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_project_settings_workflow_v2_insert
before insert on briar_project_settings
when not (
  json_valid(new.workflow_json)
  and json_extract(new.workflow_json, '$.version') = 2
  and json_type(new.workflow_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and new.mandatory_checkpoints_json is not null
  and json_valid(new.mandatory_checkpoints_json)
  and json_type(new.mandatory_checkpoints_json) = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
  and not exists (
    select 1 from json_each(new.mandatory_checkpoints_json) checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
)
begin
  select raise(abort, 'project workflow must use canonical v2 checkpoints');
END;
-- @statement
CREATE TRIGGER briar_project_settings_workflow_v2_update
before update of workflow_json, mandatory_checkpoints_json on briar_project_settings
when not (
  json_valid(new.workflow_json)
  and json_extract(new.workflow_json, '$.version') = 2
  and json_type(new.workflow_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and new.mandatory_checkpoints_json is not null
  and json_valid(new.mandatory_checkpoints_json)
  and json_type(new.mandatory_checkpoints_json) = 'array'
  and not exists (
    select 1 from json_each(new.workflow_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
  and not exists (
    select 1 from json_each(new.mandatory_checkpoints_json) checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
  )
)
begin
  select raise(abort, 'project workflow must use canonical v2 checkpoints');
END;
-- @statement
CREATE TRIGGER briar_channel_issue_approval_audit_immutable_update
before update on briar_channel_issue_approval_audit
when not (
  old.approved_by_user_id is not null
  and new.approved_by_user_id is null
  and new.id is old.id
  and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.channel_id is old.channel_id
  and new.project_id is old.project_id
  and new.run_id is old.run_id
  and new.approved_at is old.approved_at
  and new.issue_source_key is old.issue_source_key
  and new.result_verification is old.result_verification
  and new.payload_json is old.payload_json
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'channel issue approval audit is immutable');
END;
-- @statement
CREATE TRIGGER briar_project_agent_task_completion_receipt_immutable_update
before update on briar_project_agent_task_completion_receipts
BEGIN
  select raise(abort, 'project Agent task completion receipt is immutable');
END;
-- @statement
CREATE TRIGGER briar_project_agent_task_completion_receipt_immutable_delete
before delete on briar_project_agent_task_completion_receipts
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'project Agent task completion receipt is immutable');
END;
-- @statement
CREATE TRIGGER briar_project_agent_session_summaries_insert_sync
after insert on briar_project_agent_session_summaries BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (new.project_id, new.session_id, 'upsert', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_project_agent_session_summaries_update_sync
after update on briar_project_agent_session_summaries BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (new.project_id, new.session_id, 'upsert', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_project_agent_session_summaries_delete_sync
after delete on briar_project_agent_session_summaries
when exists (
  select 1 from briar_projects where id = old.project_id
) BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (old.project_id, old.session_id, 'delete', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_inbox_organizations_delete_sync
after delete on briar_organizations BEGIN
  delete from briar_organization_inbox_sync_state
  where organization_id = old.id;
END;
-- @statement
CREATE TRIGGER briar_inbox_projects_insert_sync
after insert on briar_projects BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_projects_delete_sync
before delete on briar_projects BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (old.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_dashboard_state_insert_sync
after insert on briar_dashboard_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_dashboard_state_update_sync
after update of current_version on briar_dashboard_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_agent_session_state_insert_sync
after insert on briar_project_agent_session_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_agent_session_state_update_sync
after update of current_version on briar_project_agent_session_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select project.organization_id, 1
  from briar_projects project
  where project.id = new.project_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_channel_state_insert_sync
after insert on briar_channel_sync_state BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_channel_state_update_sync
after update of current_version on briar_channel_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  ) values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_channel_members_insert_sync
after insert on briar_channel_members BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel
  where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_channel_members_delete_sync
before delete on briar_channel_members BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel
  where channel.id = old.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_user_name_update_sync
after update of name on "user"
when new.name <> old.name BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select membership.organization_id, 1
  from briar_organization_members membership
  where membership.user_id = new.id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_realtime_state_insert
after insert on briar_organization_inbox_sync_state BEGIN
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  ) values (new.organization_id, new.current_version, datetime('now'))
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;
-- @statement
CREATE TRIGGER briar_inbox_realtime_state_update
after update of current_version on briar_organization_inbox_sync_state
when new.current_version <> old.current_version BEGIN
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  ) values (new.organization_id, new.current_version, datetime('now'))
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;
-- @statement
CREATE TRIGGER briar_inbox_realtime_state_delete
after delete on briar_organization_inbox_sync_state BEGIN
  delete from briar_organization_inbox_realtime_outbox
  where organization_id = old.organization_id;
END;
-- @statement
CREATE TRIGGER briar_dashboard_worker_policy_insert_sync
after insert on briar_project_execution_worker_policies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_worker_policy_update_sync
after update on briar_project_execution_worker_policies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_worker_allowlist_insert_sync
after insert on briar_project_execution_worker_allowlist BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'metadata', new.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_worker_allowlist_delete_sync
after delete on briar_project_execution_worker_allowlist BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'metadata', old.project_id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_dependencies_insert_sync
after insert on briar_issue_dependencies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.prerequisite_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.dependent_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_dependencies_delete_sync
before delete on briar_issue_dependencies BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.prerequisite_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.dependent_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_messages_insert_sync
after insert on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_messages_update_sync
after update on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_messages_delete_sync
before delete on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'notifications', old.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_workers_insert_sync
after insert on briar_execution_workers BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_workers_delete_sync
before delete on briar_execution_workers BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'worker', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_events_insert_sync
after insert on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_events_update_sync
after update on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_events_delete_sync
after delete on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', old.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_mentions_insert_sync
after insert on briar_issue_message_mentions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select message.project_id, 'notifications', new.message_id, 'replace', datetime('now')
    from briar_issue_messages message where message.id = new.message_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select message.project_id, last_insert_rowid()
    from briar_issue_messages message where message.id = new.message_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_mentions_delete_sync
after delete on briar_issue_message_mentions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select message.project_id, 'notifications', old.message_id, 'replace', datetime('now')
    from briar_issue_messages message where message.id = old.message_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select message.project_id, last_insert_rowid()
    from briar_issue_messages message where message.id = old.message_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_hunt_events_increment_run_event_count
after insert on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = event_count + 1
  where id = new.run_id;
END;
-- @statement
CREATE TRIGGER briar_hunt_events_decrement_run_event_count
after delete on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = max(event_count - 1, 0)
  where id = old.run_id;
END;
-- @statement
CREATE TRIGGER briar_issue_result_reviews_insert_sync
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
-- @statement
CREATE TRIGGER briar_issue_result_reviews_delete_sync
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
-- @statement
CREATE TRIGGER briar_dashboard_worker_devices_update_sync
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
-- @statement
CREATE TRIGGER briar_quarantined_transcript_session_project_guard
before update of project_id, run_id on briar_agent_transcript_sessions
when (new.project_id <> old.project_id or new.run_id is not old.run_id)
  and exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = old.session_id
  )
BEGIN
  select raise(abort, 'quarantined transcript ownership is immutable');
END;
-- @statement
CREATE TRIGGER briar_quarantined_transcript_archive_project_guard
before update of project_id on briar_log_archives
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_archive'
      and quarantine.entity_id = old.id
  )
BEGIN
  select raise(abort, 'quarantined transcript ownership is immutable');
END;
-- @statement
CREATE TRIGGER briar_mismatched_transcript_archive_quarantine
after insert on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
BEGIN
  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_archive', new.id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_session', new.scope_id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  update briar_log_archives
  set status = 'failed',
      failure_count = failure_count + 1,
      last_error = 'Transcript archive ownership requires remediation'
  where id = new.id and status in ('verified', 'complete');
END;
-- @statement
CREATE TRIGGER briar_mismatched_transcript_archive_verify_guard
before update of status on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.status in ('verified', 'complete')
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
BEGIN
  select raise(abort, 'transcript archive ownership requires remediation');
END;
-- @statement
CREATE TRIGGER briar_mismatched_run_archive_insert_guard
before insert on briar_log_archives
when new.archive_kind not in ('execution_audit', 'agent_transcript')
  and new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
BEGIN
  select raise(abort, 'run archive project does not match current run');
END;
-- @statement
CREATE TRIGGER briar_transcript_session_run_insert_guard
before insert on briar_agent_transcript_sessions
when new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
BEGIN
  select raise(abort, 'transcript run does not belong to project');
END;
-- @statement
CREATE TRIGGER briar_transcript_session_run_update_guard
before update of run_id, project_id on briar_agent_transcript_sessions
when new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = old.session_id
  )
BEGIN
  select raise(abort, 'transcript run does not belong to project');
END;
-- @statement
CREATE TRIGGER briar_conversation_issue_creation_finalize_guard
before update of status on briar_issue_action_proposals
when old.status = 'pending'
  and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
  and not (
    old.approval_reserved_by_user_id is not null
    and old.approval_reserved_at is not null
    and old.issue_source_key is not null
    and new.approval_reserved_by_user_id is
      old.approval_reserved_by_user_id
    and new.approval_reserved_at is old.approval_reserved_at
    and new.issue_source_key is old.issue_source_key
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
    and new.result_run_id is not null
    and exists (
      select 1
      from briar_hunt_runs conversation
      where conversation.id = old.conversation_run_id
        and conversation.project_id = old.project_id
    )
    and exists (
      select 1
      from briar_hunt_runs result
      where result.id = new.result_run_id
        and result.project_id = old.project_id
        and result.source = 'issue'
        and result.source_key = old.issue_source_key
        and result.status = 'backlog' and result.stage = 'queued'
        and result.workflow_stage is null
        and result.worker_id is null
        and result.agent_id is null
        and result.requested_worker_id is null
        and result.claim_token_hash is null
        and result.claimed_by is null and result.claimed_at is null
        and result.lease_expires_at is null
        and result.last_execution_id is null
        and result.dispatch_mode is null
        and result.dispatch_request_id is null
        and result.dispatched_at is null
        and result.requested_by_user_id is null
        and result.requested_agent_provider is null
        and result.requested_agent_model is null
        and result.requested_agent_effort is null
        and result.completed_at is null
        and result.paused_at is null
        and result.resume_requested_at is null
    )
  )
BEGIN
  select raise(abort, 'conversation proposal acceptance requires reservation');
END;
-- @statement
CREATE TRIGGER briar_conversation_issue_reservation_immutable
before update of approval_reserved_by_user_id, approval_reserved_at,
                 issue_source_key
on briar_issue_action_proposals
when old.action_type = 'request_issue_create'
  and old.issue_source_key is not null
  and not (
    new.issue_source_key is old.issue_source_key
    and (
      (
        new.approval_reserved_at is old.approval_reserved_at
        and (
          new.approval_reserved_by_user_id is
            old.approval_reserved_by_user_id
          or (
            old.approval_reserved_by_user_id is not null
            and new.approval_reserved_by_user_id is null
          )
        )
      )
      or (
        old.approval_reserved_by_user_id is null
        and new.approval_reserved_by_user_id is not null
        and new.approval_reserved_at is not null
      )
    )
  )
BEGIN
  select raise(abort, 'conversation proposal reservation is immutable');
END;
-- @statement
CREATE TRIGGER briar_conversation_issue_approval_audit_insert
after update of status on briar_issue_action_proposals
when old.status = 'pending'
  and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
BEGIN
  insert into briar_channel_issue_approval_audit (
    id, proposal_id, organization_id, channel_id, project_id, run_id,
    approved_by_user_id, approved_at, issue_source_key, result_verification,
    payload_json, created_at
  )
  select old.id || ':conversation-approval:' || new.result_run_id,
         old.id, project.organization_id,
         'conversation:' || old.conversation_run_id,
         old.project_id, new.result_run_id, new.accepted_by_user_id,
         new.accepted_at, old.issue_source_key, 'atomic', old.payload_json,
         new.accepted_at
  from briar_projects project where project.id = old.project_id
  on conflict (id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_proposals_insert_sync
after insert on briar_channel_action_proposals BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'proposal', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_proposals_update_sync
after update on briar_channel_action_proposals BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'proposal', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_create_execution_intent_insert_guard
before insert on briar_channel_action_proposals
when not (
  (new.execute_after_create = 0 and new.execution_proposal_id is null)
  or (
    new.execute_after_create = 1
    and new.execution_proposal_id is not null
    and new.action_type = 'request_issue_create'
    and new.status = 'pending'
  )
)
BEGIN
  select raise(abort, 'invalid channel create execution intent');
END;
-- @statement
CREATE TRIGGER briar_issue_create_execution_intent_insert_guard
before insert on briar_issue_action_proposals
when not (
  (new.execute_after_create = 0 and new.execution_proposal_id is null)
  or (
    new.execute_after_create = 1
    and new.execution_proposal_id is not null
    and new.action_type = 'request_issue_create'
    and new.status = 'pending'
  )
)
BEGIN
  select raise(abort, 'invalid issue create execution intent');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_organization_delete_invalidate
before delete on briar_organizations
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where organization_id = old.id and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_project_delete_invalidate
before delete on briar_projects
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where project_id = old.id and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_channel_delete_invalidate
before delete on briar_channels
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.id
    and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_channel_archive_invalidate
after update of archived_at on briar_channels
when old.archived_at is null and new.archived_at is not null
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id
    and status = 'pending';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_channel_private_invalidate
after update of visibility on briar_channels
when old.visibility = 'public' and new.visibility = 'private'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id
    and status = 'pending'
    and approval_reserved_by_user_id is not null
    and not exists (
      select 1 from briar_channel_members member
      where member.channel_id = new.id
        and member.user_id = approval_reserved_by_user_id
    );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_private_member_remove_invalidate
after delete on briar_channel_members
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and approval_reserved_by_user_id = old.user_id
    and exists (
      select 1 from briar_channels channel
      where channel.id = old.channel_id and channel.visibility = 'private'
    );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_worker_delete_run_reset
before delete on briar_execution_workers
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '승인에서 선택한 Worker가 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and proposal.requested_worker_id = old.id
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and approval.worker_id = old.id
      )
    );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_approver_delete_run_reset
before delete on "user"
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '실행 승인 계정이 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            proposal.approval_reserved_by_user_id,
            proposal.accepted_by_user_id
          )
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and approval.approved_by_user_id = old.id
      )
    );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_approval_audit_insert_guard
before insert on briar_issue_execution_approval_audit
when not exists (
  select 1
  from briar_issue_execution_proposals proposal
  where proposal.id = new.proposal_id
    and proposal.status = 'accepted'
    and new.id = proposal.id || ':approval:' || proposal.generation
    and new.organization_id = proposal.organization_id
    and new.project_id = proposal.project_id
    and new.source_kind = proposal.source_kind
    and new.channel_id is proposal.channel_id
    and new.conversation_run_id is proposal.conversation_run_id
    and new.run_id = proposal.target_run_id
    and new.generation = proposal.generation
    and new.approved_by_user_id is proposal.accepted_by_user_id
    and new.approved_at = proposal.accepted_at
    and new.provider = proposal.requested_provider
    and new.model is proposal.requested_model
    and new.effort is proposal.requested_effort
    and new.worker_id is proposal.requested_worker_id
    and new.dispatch_request_id = proposal.dispatch_request_id
    and new.proposed_by_agent_id is proposal.proposed_by_agent_id
    and new.delegated_by_agent_id is proposal.delegated_by_agent_id
    and new.created_at = proposal.accepted_at
)
BEGIN
  select raise(abort, 'invalid issue execution approval audit');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_approval_audit_immutable_update
before update on briar_issue_execution_approval_audit
when not (
  old.approved_by_user_id is not null
  and new.approved_by_user_id is null
  and not exists (
    select 1 from "user" account
    where account.id = old.approved_by_user_id
  )
  and new.id is old.id
  and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.project_id is old.project_id
  and new.source_kind is old.source_kind
  and new.channel_id is old.channel_id
  and new.conversation_run_id is old.conversation_run_id
  and new.run_id is old.run_id
  and new.generation is old.generation
  and new.approved_at is old.approved_at
  and new.provider is old.provider
  and new.model is old.model
  and new.effort is old.effort
  and new.worker_id is old.worker_id
  and new.dispatch_request_id is old.dispatch_request_id
  and new.proposed_by_agent_id is old.proposed_by_agent_id
  and new.delegated_by_agent_id is old.delegated_by_agent_id
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'issue execution approval audit is immutable');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_approval_audit_immutable_delete
before delete on briar_issue_execution_approval_audit
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'issue execution approval audit is immutable');
END;
-- @statement
CREATE TRIGGER briar_channel_create_execution_intent_immutable
before update of execute_after_create, execution_proposal_id
on briar_channel_action_proposals
when old.execute_after_create <> new.execute_after_create
  or old.execution_proposal_id is not new.execution_proposal_id
BEGIN
  select raise(abort, 'channel create execution intent is immutable');
END;
-- @statement
CREATE TRIGGER briar_issue_create_execution_intent_immutable
before update of execute_after_create, execution_proposal_id
on briar_issue_action_proposals
when old.execute_after_create <> new.execute_after_create
  or old.execution_proposal_id is not new.execution_proposal_id
BEGIN
  select raise(abort, 'issue create execution intent is immutable');
END;
-- @statement
CREATE TRIGGER briar_issue_create_materialize_execution_proposal
after update of status on briar_issue_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.action_type = 'request_issue_create'
  and new.execute_after_create = 1
  and new.execution_proposal_id is not null
  and new.result_run_id is not null
BEGIN
  insert into briar_issue_execution_proposals (
    id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    target_run_id, target_title, target_run_updated_at,
    proposed_by_agent_id, delegated_by_agent_id, delegated_by_agent_name,
    origin_create_proposal_id, created_at, updated_at
  )
  select new.execution_proposal_id, project.organization_id, new.project_id,
         'issue', null, new.conversation_run_id, new.trigger_message_id,
         new.reply_message_id, run.id, run.title, run.updated_at,
         conversation.agent_id, null, null, new.id,
         new.accepted_at, new.accepted_at
  from briar_hunt_runs run
  join briar_hunt_runs conversation
    on conversation.id = new.conversation_run_id
   and conversation.project_id = new.project_id
  join briar_projects project on project.id = new.project_id
  where run.id = new.result_run_id and run.project_id = new.project_id
    and run.status = 'backlog' and run.stage = 'queued'
    and run.dispatch_request_id is null and run.claim_token_hash is null
  on conflict (id) do nothing;

  select raise(abort, 'issue execution proposal was not materialized')
  where not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.id = new.execution_proposal_id
      and proposal.project_id = new.project_id
      and proposal.source_kind = 'issue'
      and proposal.channel_id is null
      and proposal.conversation_run_id = new.conversation_run_id
      and proposal.trigger_message_id = new.trigger_message_id
      and proposal.reply_message_id = new.reply_message_id
      and proposal.target_run_id = new.result_run_id
      and proposal.origin_create_proposal_id = new.id
      and proposal.status = 'pending'
      and proposal.dispatch_request_id is null
  );
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_audit_immutable_update
before update on briar_agent_skill_execution_approval_audit
when not (
  old.approved_by_user_id is not null and new.approved_by_user_id is null
  and not exists (
    select 1 from "user" account where account.id = old.approved_by_user_id
  )
  and new.id is old.id and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.project_id is old.project_id and new.source_kind is old.source_kind
  and new.channel_id is old.channel_id
  and new.conversation_run_id is old.conversation_run_id
  and new.trigger_message_id is old.trigger_message_id
  and new.reply_message_id is old.reply_message_id
  and new.source_reply_job_id is old.source_reply_job_id
  and new.delegated_by_reply_job_id is old.delegated_by_reply_job_id
  and new.agent_id is old.agent_id and new.agent_name is old.agent_name
  and new.agent_responsibility is old.agent_responsibility
  and new.skill_id is old.skill_id and new.skill_name is old.skill_name
  and new.skill_instructions is old.skill_instructions
  and new.skill_kind is old.skill_kind
  and new.provider is old.provider and new.model is old.model
  and new.effort is old.effort and new.request is old.request
  and new.worker_id is old.worker_id and new.worker_label is old.worker_label
  and new.result_session_id is old.result_session_id
  and new.approved_at is old.approved_at
  and new.delegated_by_agent_id is old.delegated_by_agent_id
  and new.delegated_by_agent_name is old.delegated_by_agent_name
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is immutable');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_audit_immutable_delete
before delete on briar_agent_skill_execution_approval_audit
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is immutable');
END;
-- @statement
CREATE TRIGGER briar_inbox_channel_mentions_insert_sync
after insert on briar_channel_message_mentions BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_inbox_channel_mentions_delete_sync
before delete on briar_channel_message_mentions BEGIN
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_reactions_insert_sync
after insert on briar_channel_message_reactions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, message.channel_id, 'message', new.message_id,
           'upsert', datetime('now')
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_reactions_delete_sync
after delete on briar_channel_message_reactions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, message.channel_id, 'message', old.message_id,
           'upsert', datetime('now')
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_rework_proposals_insert_sync
after insert on briar_issue_rework_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_rework_proposals_update_sync
after update on briar_issue_rework_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_action_proposals_insert_sync
after insert on briar_issue_action_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_action_proposals_update_sync
after update on briar_issue_action_proposals BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_issue_subscriptions_message_author_insert
after insert on briar_issue_messages
when new.author_user_id is not null BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.run_id, project.organization_id, new.author_user_id, new.created_at
  from briar_hunt_runs run
  join briar_projects project on project.id = run.project_id
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.author_user_id
  where run.id = new.run_id and run.project_id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_issue_subscriptions_mention_insert
after insert on briar_issue_message_mentions BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select message.run_id, project.organization_id, new.user_id, new.created_at
  from briar_issue_messages message
  join briar_projects project on project.id = message.project_id
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.user_id
  where message.id = new.message_id
  on conflict (run_id, user_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_dashboard_runs_insert_sync
after insert on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_runs_delete_sync
before delete on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_workflow_v2_insert
before insert on briar_hunt_runs
when not (
  json_valid(new.workflow_snapshot_json)
  and json_extract(new.workflow_snapshot_json, '$.version') = 2
  and json_type(new.workflow_snapshot_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
      and json_extract(checkpoint.value, '$.key') not glob 'user-*'
      and json_extract(checkpoint.value, '$.key') not glob 'issue-*'
  )
)
begin
  select raise(abort, 'run workflow must use canonical v2 checkpoints');
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_workflow_v2_update
before update of workflow_snapshot_json on briar_hunt_runs
when not (
  json_valid(new.workflow_snapshot_json)
  and json_extract(new.workflow_snapshot_json, '$.version') = 2
  and json_type(new.workflow_snapshot_json, '$.execution.checkpoints') = 'array'
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution') field
    where field.key <> 'checkpoints'
  )
  and not exists (
    select 1 from json_each(new.workflow_snapshot_json, '$.execution.checkpoints') checkpoint
    where json_extract(checkpoint.value, '$.key') not glob 'project-*'
      and json_extract(checkpoint.value, '$.key') not glob 'user-*'
      and json_extract(checkpoint.value, '$.key') not glob 'issue-*'
  )
)
begin
  select raise(abort, 'run workflow must use canonical v2 checkpoints');
END;
-- @statement
CREATE TRIGGER briar_channel_reply_skill_snapshot_update
after update of skill_id on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
BEGIN
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
END;
-- @statement
CREATE TRIGGER briar_conversation_issue_creation_finalize
after insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-conversation-approved:%'
BEGIN
  update briar_issue_action_proposals
  set status = 'accepted',
      accepted_by_user_id = approval_reserved_by_user_id,
      accepted_at = approval_reserved_at,
      result_run_id = new.id,
      updated_at = approval_reserved_at
  where status = 'pending'
    and action_type = 'request_issue_create'
    and project_id = new.project_id
    and approval_reserved_by_user_id is not null
    and approval_reserved_at is not null
    and issue_source_key = new.source_key;
END;
-- @statement
CREATE TRIGGER briar_conversation_issue_acceptance_transfer_guard
before update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_issue_action_proposals proposal
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and (
        (
          proposal.conversation_run_id = old.id
          and proposal.approval_reserved_by_user_id is not null
        )
        or (
          old.source = 'issue'
          and proposal.issue_source_key is not null
          and old.source_key = proposal.issue_source_key
        )
      )
  )
BEGIN
  select raise(abort, 'conversation proposal acceptance in progress');
END;
-- @statement
CREATE TRIGGER briar_verified_run_archive_transfer_guard
before update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_log_archives archive
    where archive.run_id = old.id and archive.status = 'verified'
      and archive.archive_kind <> 'execution_audit'
  )
BEGIN
  select raise(abort, 'verified run archive prevents transfer');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_reserved_proposal_delete_guard
before delete on briar_issue_execution_proposals
when old.status = 'pending' and old.dispatch_request_id is not null
  and exists (
    select 1 from briar_organizations organization
    where organization.id = old.organization_id
  )
  and exists (
    select 1 from briar_projects project where project.id = old.project_id
  )
  and exists (
    select 1 from briar_hunt_runs run where run.id = old.target_run_id
  )
BEGIN
  select raise(abort, 'reserved execution proposal cannot be deleted');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_identity_immutable
before update on briar_issue_execution_proposals
when new.id is not old.id
  or new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.source_kind is not old.source_kind
  or not (
    new.channel_id is old.channel_id
    or (
      old.channel_id is not null and new.channel_id is null
      and not exists (
        select 1 from briar_channels channel where channel.id = old.channel_id
      )
    )
  )
  or not (
    new.conversation_run_id is old.conversation_run_id
    or (
      old.conversation_run_id is not null and new.conversation_run_id is null
      and not exists (
        select 1 from briar_hunt_runs run
        where run.id = old.conversation_run_id
      )
    )
  )
  or new.trigger_message_id is not old.trigger_message_id
  or new.reply_message_id is not old.reply_message_id
  or new.target_run_id is not old.target_run_id
  or new.target_title is not old.target_title
  or new.target_run_updated_at is not old.target_run_updated_at
  or not (
    new.proposed_by_agent_id is old.proposed_by_agent_id
    or (old.proposed_by_agent_id is not null
        and new.proposed_by_agent_id is null
        and not exists (
          select 1 from briar_project_agents agent
          where agent.id = old.proposed_by_agent_id
        ))
  )
  or not (
    new.delegated_by_agent_id is old.delegated_by_agent_id
    or (old.delegated_by_agent_id is not null
        and new.delegated_by_agent_id is null
        and not exists (
          select 1 from briar_project_agents agent
          where agent.id = old.delegated_by_agent_id
        ))
  )
  or new.delegated_by_agent_name is not old.delegated_by_agent_name
  or new.origin_create_proposal_id is not old.origin_create_proposal_id
  or new.created_at is not old.created_at
BEGIN
  select raise(abort, 'issue execution proposal identity is immutable');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_status_guard
before update of status, generation on briar_issue_execution_proposals
when not (
  (new.status = old.status and new.generation = old.generation)
  or (
    old.status = 'pending' and new.status = 'accepted'
    and new.generation = old.generation
  )
  or (
    old.status in ('pending', 'accepted')
    and new.status = 'invalidated'
    and new.generation = old.generation + 1
  )
)
BEGIN
  select raise(abort, 'invalid issue execution proposal transition');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_reservation_immutable
before update of approval_reserved_by_user_id, approval_reserved_at,
                 requested_provider, requested_model, requested_effort,
                 requested_worker_id, dispatch_request_id
on briar_issue_execution_proposals
when old.dispatch_request_id is not null
  and not (
    (
      new.approval_reserved_by_user_id is old.approval_reserved_by_user_id
      or (
        old.approval_reserved_by_user_id is not null
        and new.approval_reserved_by_user_id is null
        and not exists (
          select 1 from "user" account
          where account.id = old.approval_reserved_by_user_id
        )
      )
    )
    and new.approval_reserved_at is old.approval_reserved_at
    and new.requested_provider is old.requested_provider
    and new.requested_model is old.requested_model
    and new.requested_effort is old.requested_effort
    and (
      new.requested_worker_id is old.requested_worker_id
      or (
        old.requested_worker_id is not null
        and new.requested_worker_id is null
        and not exists (
          select 1 from briar_execution_workers worker
          where worker.id = old.requested_worker_id
        )
      )
    )
    and new.dispatch_request_id is old.dispatch_request_id
  )
BEGIN
  select raise(abort, 'issue execution approval reservation is immutable');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_deleted_approver_invalidate
after update of approval_reserved_by_user_id
on briar_issue_execution_proposals
when old.approval_reserved_by_user_id is not null
  and new.approval_reserved_by_user_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_deleted_agent_invalidate
after update of proposed_by_agent_id
on briar_issue_execution_proposals
when old.proposed_by_agent_id is not null
  and new.proposed_by_agent_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_deleted_delegator_invalidate
after update of delegated_by_agent_id
on briar_issue_execution_proposals
when old.delegated_by_agent_id is not null
  and new.delegated_by_agent_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_deleted_worker_invalidate
after update of requested_worker_id
on briar_issue_execution_proposals
when old.requested_worker_id is not null
  and new.requested_worker_id is null
  and new.status <> 'invalidated'
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where id = new.id and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_conversation_delete_invalidate
before delete on briar_hunt_runs
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and conversation_run_id = old.id
    and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_channel_roster_remove_invalidate
after delete on briar_channel_agents
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and (
      proposed_by_agent_id = old.agent_id
      or delegated_by_agent_id = old.agent_id
    );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_agent_delete_run_reset
before delete on briar_project_agents
BEGIN
  update briar_hunt_runs
  set status = 'backlog', stage = 'queued', workflow_stage = null,
      agent_id = null, worker_id = null, requested_worker_id = null,
      claim_token_hash = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
      dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
      requested_by_user_id = null, requested_agent_provider = null,
      requested_agent_model = null, requested_agent_effort = null,
      paused_at = null, resume_requested_at = null, completed_at = null,
      detail = '승인에 연결된 Agent가 삭제되어 새 실행 승인이 필요합니다.',
      updated_at = datetime('now'), last_event_at = datetime('now')
  where status in ('queued', 'blocked', 'failed')
    and dispatch_request_id is not null
    and (
      exists (
        select 1 from briar_issue_execution_proposals proposal
        where proposal.target_run_id = briar_hunt_runs.id
          and proposal.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            proposal.proposed_by_agent_id, proposal.delegated_by_agent_id
          )
      )
      or exists (
        select 1 from briar_issue_execution_approval_audit approval
        where approval.run_id = briar_hunt_runs.id
          and approval.dispatch_request_id = briar_hunt_runs.dispatch_request_id
          and old.id in (
            approval.proposed_by_agent_id, approval.delegated_by_agent_id
          )
      )
    );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_acceptance_immutable
before update of accepted_by_user_id, accepted_at
on briar_issue_execution_proposals
when not (
  (
    old.status = 'pending' and new.status = 'accepted'
    and old.accepted_by_user_id is null and old.accepted_at is null
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
  )
  or (
    old.status in ('accepted', 'invalidated')
    and new.status = old.status
    and old.accepted_by_user_id is not null
    and new.accepted_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.accepted_by_user_id
    )
    and new.accepted_at is old.accepted_at
  )
  or (
    new.accepted_by_user_id is old.accepted_by_user_id
    and new.accepted_at is old.accepted_at
  )
)
BEGIN
  select raise(abort, 'issue execution proposal acceptance is immutable');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_claim_approval_guard
before update of claim_token_hash on briar_hunt_runs
when old.claim_token_hash is null and new.claim_token_hash is not null
  and new.dispatch_request_id is not null
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.dispatch_request_id = new.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.dispatch_request_id = new.dispatch_request_id
    )
  )
  and not exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.project_id = new.project_id
      and approval.run_id = new.id
      and approval.dispatch_request_id = new.dispatch_request_id
      and approval.provider = new.requested_agent_provider
      and approval.model is new.requested_agent_model
      and approval.effort is new.requested_agent_effort
      and approval.worker_id is new.requested_worker_id
      and approval.approved_by_user_id is new.requested_by_user_id
      and approval.proposed_by_agent_id is new.agent_id
  )
BEGIN
  select raise(abort, 'conversational execution approval audit is missing');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_dispatch_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending'
      and proposal.organization_id = (
        select project.organization_id from briar_projects project
        where project.id = old.project_id
      )
      and proposal.project_id = old.project_id
      and proposal.target_run_id = old.id
      and proposal.target_run_updated_at = old.updated_at
      and proposal.approval_reserved_by_user_id is not null
      and proposal.approval_reserved_at is not null
      and proposal.requested_provider is not null
      and old.status = 'backlog' and old.stage = 'queued'
      and old.workflow_stage is null
      and old.worker_id is null and old.requested_worker_id is null
      and old.claim_token_hash is null and old.claimed_by is null
      and old.claimed_at is null and old.lease_expires_at is null
      and old.last_execution_id is null
      and old.dispatch_mode is null and old.dispatch_request_id is null
      and old.dispatched_at is null and old.requested_by_user_id is null
      and old.completed_at is null and old.paused_at is null
      and old.resume_requested_at is null
      and new.status = 'queued' and new.stage = 'queued'
      and new.workflow_stage is null
      and new.requested_by_user_id = proposal.approval_reserved_by_user_id
      and new.requested_agent_provider = proposal.requested_provider
      and new.requested_agent_model is proposal.requested_model
      and new.requested_agent_effort is proposal.requested_effort
      and new.requested_worker_id is proposal.requested_worker_id
      and new.dispatch_mode = iif(
        proposal.requested_worker_id is null, 'any', 'specific'
      )
      and new.dispatched_at = proposal.approval_reserved_at
  )
BEGIN
  select raise(abort, 'execution proposal target is stale');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_dispatch_agent_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending'
      and (
        proposal.proposed_by_agent_id is null
        or (
          new.agent_id = proposal.proposed_by_agent_id
          and exists (
            select 1 from briar_project_agents agent
            where agent.id = proposal.proposed_by_agent_id
              and agent.project_id = proposal.project_id
              and agent.organization_id = proposal.organization_id
          )
        )
      )
  )
BEGIN
  select raise(abort, 'execution proposal Agent is stale');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_dispatch_issue_source_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.source_kind = 'issue'
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_hunt_runs conversation
      on conversation.id = proposal.conversation_run_id
     and conversation.project_id = proposal.project_id
    join briar_issue_messages reply
      on reply.id = proposal.reply_message_id
     and reply.run_id = conversation.id
     and reply.project_id = conversation.project_id
    join briar_projects project on project.id = conversation.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = proposal.approval_reserved_by_user_id
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending' and proposal.source_kind = 'issue'
      and project.organization_id = proposal.organization_id
  )
BEGIN
  select raise(abort, 'issue execution proposal source is stale');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_dispatch_audit_guard
before insert on briar_execution_audit_events
when new.request_id is not null
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.request_id
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_hunt_runs run
      on run.id = proposal.target_run_id
     and run.project_id = proposal.project_id
    where proposal.dispatch_request_id = new.request_id
      and proposal.status = 'pending'
      and proposal.approval_reserved_by_user_id is not null
      and proposal.approval_reserved_at is not null
      and new.action = 'dispatched'
      and new.organization_id = proposal.organization_id
      and new.project_id = proposal.project_id
      and new.run_id = proposal.target_run_id
      and new.worker_id is proposal.requested_worker_id
      and new.agent_id is proposal.proposed_by_agent_id
      and new.actor_user_id is proposal.approval_reserved_by_user_id
      and new.occurred_at = proposal.approval_reserved_at
      and run.dispatch_request_id = proposal.dispatch_request_id
      and run.dispatched_at = proposal.approval_reserved_at
      and run.requested_by_user_id = proposal.approval_reserved_by_user_id
      and run.requested_agent_provider = proposal.requested_provider
      and run.requested_agent_model is proposal.requested_model
      and run.requested_agent_effort is proposal.requested_effort
      and run.requested_worker_id is proposal.requested_worker_id
  )
BEGIN
  select raise(abort, 'invalid issue execution dispatch audit');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_dispatch_finalize
after insert on briar_execution_audit_events
when new.action = 'dispatched' and new.request_id is not null
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.request_id
  )
BEGIN
  update briar_issue_execution_proposals
  set status = 'accepted',
      accepted_by_user_id = approval_reserved_by_user_id,
      accepted_at = approval_reserved_at,
      updated_at = approval_reserved_at
  where dispatch_request_id = new.request_id and status = 'pending'
    and organization_id = new.organization_id
    and project_id = new.project_id and target_run_id = new.run_id
    and approval_reserved_by_user_id is new.actor_user_id
    and approval_reserved_at = new.occurred_at;

  select raise(abort, 'execution approval was not finalized')
  where changes() <> 1;
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_accept_guard
before update of status on briar_issue_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
  and not (
    old.approval_reserved_by_user_id is not null
    and old.approval_reserved_at is not null
    and old.dispatch_request_id is not null
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
    and new.generation = old.generation
    and exists (
      select 1 from briar_hunt_runs run
      where run.id = old.target_run_id and run.project_id = old.project_id
        and run.dispatch_request_id = old.dispatch_request_id
        and run.dispatched_at = old.approval_reserved_at
        and run.requested_by_user_id = old.approval_reserved_by_user_id
        and run.requested_agent_provider = old.requested_provider
        and run.requested_agent_model is old.requested_model
        and run.requested_agent_effort is old.requested_effort
        and run.requested_worker_id is old.requested_worker_id
    )
    and exists (
      select 1 from briar_execution_audit_events audit
      where audit.organization_id = old.organization_id
        and audit.project_id = old.project_id
        and audit.run_id = old.target_run_id
        and audit.request_id = old.dispatch_request_id
        and audit.actor_user_id is old.approval_reserved_by_user_id
        and audit.action = 'dispatched'
    )
  )
BEGIN
  select raise(abort, 'execution proposal acceptance requires dispatch audit');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_audit_insert
after update of status on briar_issue_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
BEGIN
  insert into briar_issue_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, run_id, generation, approved_by_user_id,
    approved_at, provider, model, effort, worker_id, dispatch_request_id,
    proposed_by_agent_id, delegated_by_agent_id, created_at
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id,
    new.conversation_run_id, new.target_run_id, new.generation,
    new.accepted_by_user_id, new.accepted_at, new.requested_provider,
    new.requested_model, new.requested_effort, new.requested_worker_id,
    new.dispatch_request_id, new.proposed_by_agent_id,
    new.delegated_by_agent_id, new.accepted_at
  );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_dispatch_clear_guard
before update of dispatch_request_id, status on briar_hunt_runs
when old.dispatch_request_id is not null
  and new.dispatch_request_id is null
  and new.status not in ('completed', 'cancelled')
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.target_run_id = old.id
        and proposal.project_id = old.project_id
        and proposal.dispatch_request_id = old.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.run_id = old.id
        and approval.project_id = old.project_id
        and approval.dispatch_request_id = old.dispatch_request_id
    )
  )
  and not (
    new.status = 'backlog' and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null and new.requested_worker_id is null
    and new.claim_token_hash is null and new.claimed_by is null
    and new.claimed_at is null and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null and new.dispatched_at is null
    and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null and new.resume_requested_at is null
    and new.completed_at is null
  )
BEGIN
  select raise(
    abort, 'conversational execution cancellation requires backlog reset'
  );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_retryable_transfer_guard
before update of project_id, status on briar_hunt_runs
when old.status in ('queued', 'blocked', 'failed')
  and new.project_id <> old.project_id
  and old.dispatch_request_id is not null
  and (
    exists (
      select 1 from briar_issue_execution_proposals proposal
      where proposal.target_run_id = old.id
        and proposal.project_id = old.project_id
        and proposal.dispatch_request_id = old.dispatch_request_id
    )
    or exists (
      select 1 from briar_issue_execution_approval_audit approval
      where approval.run_id = old.id
        and approval.project_id = old.project_id
        and approval.dispatch_request_id = old.dispatch_request_id
    )
  )
  and not (
    new.status = 'backlog' and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null and new.requested_worker_id is null
    and new.claim_token_hash is null and new.claimed_by is null
    and new.claimed_at is null and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null and new.dispatch_request_id is null
    and new.dispatched_at is null and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null and new.resume_requested_at is null
    and new.completed_at is null
  )
BEGIN
  select raise(
    abort, 'conversational execution transfer requires backlog reset'
  );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_terminal_transfer_guard
before update of project_id on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.run_id = old.id
      and approval.project_id = old.project_id
  )
BEGIN
  select raise(
    abort, 'conversationally approved terminal issue transfer is not allowed'
  );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_terminal_reactivation_guard
before update of status on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.status not in ('completed', 'cancelled')
  and exists (
    select 1 from briar_issue_execution_approval_audit approval
    where approval.run_id = old.id
      and approval.project_id = old.project_id
  )
BEGIN
  select raise(
    abort, 'conversational execution reactivation requires fresh approval'
  );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_target_mutation_invalidate
after update of updated_at on briar_hunt_runs
when new.updated_at is not old.updated_at
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status = 'pending'
    and target_run_updated_at is not new.updated_at
    and not (
      dispatch_request_id is not null
      and new.project_id = project_id
      and new.dispatch_request_id = dispatch_request_id
      and new.dispatched_at = approval_reserved_at
      and new.requested_by_user_id = approval_reserved_by_user_id
      and new.requested_agent_provider = requested_provider
      and new.requested_agent_model is requested_model
      and new.requested_agent_effort is requested_effort
      and new.requested_worker_id is requested_worker_id
      and new.status = 'queued' and new.stage = 'queued'
      and new.workflow_stage is null
    );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_transfer_invalidate
after update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status <> 'invalidated';
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_unassign_invalidate
after update of dispatch_request_id on briar_hunt_runs
when old.dispatch_request_id is not null and new.dispatch_request_id is null
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status <> 'invalidated'
    and dispatch_request_id = old.dispatch_request_id;
END;
-- @statement
CREATE TRIGGER briar_channel_execution_proposals_insert_sync
after insert on briar_issue_execution_proposals
when new.source_kind = 'channel'
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_execution_proposals_update_sync
after update on briar_issue_execution_proposals
when new.source_kind = 'channel' and new.channel_id is not null
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_project_agent_task_completion_receipt_insert_guard
before insert on briar_project_agent_task_completion_receipts
when not exists (
  select 1
  from briar_project_agent_task_jobs task
  join briar_projects project on project.id = task.project_id
  where task.id = new.task_id and task.project_id = new.project_id
    and project.organization_id = new.organization_id
    and task.status = 'running'
    and task.claimed_worker_id = new.worker_id
    and task.claim_token_hash = new.claim_token_hash
    and task.skill_execution_proposal_id is new.skill_execution_proposal_id
    and (
      (new.error is null and new.outcome_status = 'completed' and (
        new.skill_execution_proposal_id is null or new.summary is not null
      ))
      or (new.error is not null and new.summary is null
        and task.attempts >= 3 and new.outcome_status = 'failed')
      or (new.error is not null and new.summary is null
        and task.attempts < 3 and new.outcome_status = 'queued')
    )
    and new.completed_at = new.created_at
)
BEGIN
  select raise(abort, 'invalid project Agent task completion receipt');
END;
-- @statement
CREATE TRIGGER briar_channel_agent_reply_skill_snapshot_immutable
before update of selected_skill_id_snapshot, selected_agent_name_snapshot,
                 selected_agent_responsibility_snapshot,
                 selected_skill_name_snapshot,
                 selected_skill_instructions_snapshot,
                 selected_skill_kind_snapshot,
                 selected_skill_provider_snapshot,
                 selected_skill_model_snapshot,
                 selected_skill_effort_snapshot,
                 skill_execution_request_snapshot
on briar_channel_agent_reply_jobs
when new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
  or new.selected_agent_name_snapshot is not old.selected_agent_name_snapshot
  or new.selected_agent_responsibility_snapshot is not
    old.selected_agent_responsibility_snapshot
  or new.selected_skill_name_snapshot is not old.selected_skill_name_snapshot
  or new.selected_skill_instructions_snapshot is not
    old.selected_skill_instructions_snapshot
  or new.selected_skill_kind_snapshot is not old.selected_skill_kind_snapshot
  or new.selected_skill_provider_snapshot is not
    old.selected_skill_provider_snapshot
  or new.selected_skill_model_snapshot is not old.selected_skill_model_snapshot
  or new.selected_skill_effort_snapshot is not
    old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
BEGIN
  select raise(abort, 'channel Agent Skill reply snapshot is immutable');
END;
-- @statement
CREATE TRIGGER briar_channel_action_skill_execution_exclusive
before insert on briar_channel_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'channel proposal conflicts with Agent Skill execution');
END;
-- @statement
CREATE TRIGGER briar_issue_action_skill_execution_exclusive
before insert on briar_issue_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue proposal conflicts with Agent Skill execution');
END;
-- @statement
CREATE TRIGGER briar_issue_rework_skill_execution_exclusive
before insert on briar_issue_rework_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'rework proposal conflicts with Agent Skill execution');
END;
-- @statement
CREATE TRIGGER briar_issue_execution_skill_execution_exclusive
before insert on briar_issue_execution_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue execution conflicts with Agent Skill execution');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_identity_immutable
before update on briar_agent_skill_execution_proposals
when new.id is not old.id
  or new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.source_kind is not old.source_kind
  or new.channel_id is not old.channel_id
  or new.conversation_run_id is not old.conversation_run_id
  or new.trigger_message_id is not old.trigger_message_id
  or new.reply_message_id is not old.reply_message_id
  or new.source_reply_job_id is not old.source_reply_job_id
  or new.delegated_by_reply_job_id is not old.delegated_by_reply_job_id
  or new.agent_id is not old.agent_id
  or new.agent_name is not old.agent_name
  or new.agent_responsibility is not old.agent_responsibility
  or new.skill_id is not old.skill_id
  or new.skill_name is not old.skill_name
  or new.skill_instructions is not old.skill_instructions
  or new.skill_kind is not old.skill_kind
  or new.provider is not old.provider
  or new.model is not old.model
  or new.effort is not old.effort
  or new.request is not old.request
  or new.delegated_by_agent_id is not old.delegated_by_agent_id
  or new.delegated_by_agent_name is not old.delegated_by_agent_name
  or new.created_at is not old.created_at
BEGIN
  select raise(abort, 'Agent Skill execution proposal identity is immutable');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_status_guard
before update of status, generation on briar_agent_skill_execution_proposals
when not (
  (new.status = old.status and new.generation = old.generation)
  or (old.status = 'pending' and new.status = 'accepted'
      and new.generation = old.generation)
  or (old.status = 'pending' and new.status = 'invalidated'
      and new.generation = old.generation + 1)
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution proposal transition');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_acceptance_immutable
before update of requested_worker_id, requested_worker_label,
                 result_session_id, accepted_by_user_id, accepted_at
on briar_agent_skill_execution_proposals
when not (
  (
    old.status = 'pending' and new.status = 'accepted'
    and old.requested_worker_id is null
    and old.requested_worker_label is null
    and old.result_session_id is null
    and old.accepted_by_user_id is null and old.accepted_at is null
    and new.requested_worker_id is not null
    and new.requested_worker_label is not null
    and new.result_session_id is not null
    and new.accepted_by_user_id is not null and new.accepted_at is not null
  )
  or (
    new.requested_worker_id is old.requested_worker_id
    and new.requested_worker_label is old.requested_worker_label
    and new.result_session_id is old.result_session_id
    and new.accepted_by_user_id is old.accepted_by_user_id
    and new.accepted_at is old.accepted_at
  )
  or (
    old.status = 'accepted' and new.status = 'accepted'
    and old.accepted_by_user_id is not null
    and new.accepted_by_user_id is null
    and not exists (
      select 1 from "user" account where account.id = old.accepted_by_user_id
    )
    and new.requested_worker_id is old.requested_worker_id
    and new.requested_worker_label is old.requested_worker_label
    and new.result_session_id is old.result_session_id
    and new.accepted_at is old.accepted_at
  )
)
BEGIN
  select raise(abort, 'Agent Skill execution acceptance is immutable');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_audit_insert_guard
before insert on briar_agent_skill_execution_approval_audit
when not exists (
  select 1 from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.proposal_id and proposal.status = 'accepted'
    and new.id = proposal.id || ':approval:' || proposal.generation
    and new.organization_id = proposal.organization_id
    and new.project_id = proposal.project_id
    and new.source_kind = proposal.source_kind
    and new.channel_id is proposal.channel_id
    and new.conversation_run_id is proposal.conversation_run_id
    and new.trigger_message_id = proposal.trigger_message_id
    and new.reply_message_id = proposal.reply_message_id
    and new.source_reply_job_id = proposal.source_reply_job_id
    and new.delegated_by_reply_job_id is proposal.delegated_by_reply_job_id
    and new.agent_id = proposal.agent_id and new.agent_name = proposal.agent_name
    and new.agent_responsibility = proposal.agent_responsibility
    and new.skill_id = proposal.skill_id and new.skill_name = proposal.skill_name
    and new.skill_instructions = proposal.skill_instructions
    and new.skill_kind = proposal.skill_kind
    and new.provider = proposal.provider and new.model is proposal.model
    and new.effort is proposal.effort and new.request = proposal.request
    and new.worker_id = proposal.requested_worker_id
    and new.worker_label = proposal.requested_worker_label
    and new.result_session_id = proposal.result_session_id
    and new.approved_by_user_id is proposal.accepted_by_user_id
    and new.approved_at = proposal.accepted_at
    and new.delegated_by_agent_id is proposal.delegated_by_agent_id
    and new.delegated_by_agent_name is proposal.delegated_by_agent_name
    and new.created_at = proposal.accepted_at
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution approval audit');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_task_link_immutable
before update of skill_execution_proposal_id on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and new.skill_execution_proposal_id is not old.skill_execution_proposal_id
BEGIN
  select raise(abort, 'Agent Skill execution task linkage is immutable');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_task_core_immutable
before update of id, project_id, agent_id, skill_id, request, request_id,
                 preferred_worker_id, created_at
on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and (
    new.id is not old.id or new.project_id is not old.project_id
    or new.agent_id is not old.agent_id or new.skill_id is not old.skill_id
    or new.request is not old.request or new.request_id is not old.request_id
    or new.preferred_worker_id is not old.preferred_worker_id
    or new.created_at is not old.created_at
  )
BEGIN
  select raise(abort, 'Agent Skill execution task core is immutable');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_task_terminal_guard
before update of status on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
  and new.status in ('completed', 'failed')
  and not exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    join briar_project_agent_sessions session
      on session.project_id = approval.project_id
     and session.id = approval.result_session_id
    where approval.proposal_id = old.skill_execution_proposal_id
      and approval.project_id = old.project_id
      and approval.result_session_id = old.id
      and approval.agent_id = old.agent_id
      and approval.skill_id = old.skill_id
      and approval.request = old.request
      and approval.worker_id = old.preferred_worker_id
      and session.agent_id = approval.agent_id
      and session.session_type = 'task'
      and json_valid(session.payload_json)
      and json_extract(session.payload_json, '$.dispatchGroupId') = old.id
      and json_extract(session.payload_json, '$.agentId') = approval.agent_id
      and json_extract(session.payload_json, '$.agentName') = approval.agent_name
      and json_extract(session.payload_json, '$.skillId') = approval.skill_id
      and json_extract(session.payload_json, '$.sessionType') = 'task'
      and json_extract(session.payload_json, '$.trigger') = 'manual'
      and json_extract(session.payload_json, '$.request') = approval.request
      and json_extract(session.payload_json, '$.requestedWorkerId') =
        approval.worker_id
      and json_extract(session.payload_json, '$.workerId') = approval.worker_id
  )
BEGIN
  select raise(abort, 'Agent Skill execution session is missing or invalid');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_task_delete_reconcile
before delete on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
BEGIN
  update briar_project_agent_sessions
  set status = 'failed',
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', 'failed',
          '$.summary', null,
          '$.conversationId', null,
          '$.error', 'Approved Agent Skill execution authority was removed.',
          '$.completedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', 'failed',
          'occurredAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ),
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where project_id = old.project_id and id = old.id;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_organization_delete_reconcile
before delete on briar_organizations
BEGIN
  delete from briar_project_agent_task_jobs
  where skill_execution_proposal_id in (
    select proposal_id
    from briar_agent_skill_execution_approval_audit
    where organization_id = old.id
  );
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_worker_delete_reconcile
before delete on briar_execution_workers
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker binding was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where preferred_worker_id = old.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_worker_binding_reconcile
after update of project_id, device_id on briar_execution_workers
when new.project_id is not old.project_id or new.device_id is not old.device_id
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker binding changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where preferred_worker_id = new.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_worker_disable_reconcile
after update of state on briar_execution_workers
when old.state <> 'disabled' and new.state = 'disabled'
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker was disabled before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where preferred_worker_id = new.id and status in ('queued', 'running')
    and skill_execution_proposal_id is not null;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_device_authority_reconcile
after update of organization_id, owner_user_id on briar_execution_worker_devices
when new.organization_id is not old.organization_id
  or new.owner_user_id is not old.owner_user_id
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker device authority changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select id from briar_execution_workers where device_id = new.id
    );
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_device_disable_reconcile
after update of state on briar_execution_worker_devices
when old.state <> 'disabled' and new.state = 'disabled'
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker device was disabled before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select id from briar_execution_workers where device_id = new.id
    );
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_skill_delete_invalidate
before delete on briar_agent_skills
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where skill_id = old.id and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_id = old.id
    and skill_execution_proposal_id is not null
    and exists (
      select 1 from briar_agent_skill_execution_approval_audit approval
      where approval.proposal_id = skill_execution_proposal_id
    );

  delete from briar_project_agent_task_jobs
  where skill_id = old.id and skill_execution_proposal_id is not null;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_agent_delete_invalidate
before delete on briar_project_agents
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where (agent_id = old.id or delegated_by_agent_id = old.id)
    and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Agent was removed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where agent_id = old.id
    );
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_agent_update_invalidate
after update of organization_id, project_id, name, responsibility
on briar_project_agents
when new.organization_id is not old.organization_id
  or new.project_id is not old.project_id
  or new.name <> old.name
  or new.responsibility <> old.responsibility
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where (agent_id = old.id or delegated_by_agent_id = old.id)
    and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Agent changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where agent_id = old.id
        and (new.organization_id is not organization_id
          or new.project_id is not project_id
          or new.name <> agent_name
          or new.responsibility <> agent_responsibility)
    );
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_archive_invalidate
after update of archived_at on briar_channels
when old.archived_at is null and new.archived_at is not null
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id and status = 'pending';
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_roster_invalidate
after delete on briar_channel_agents
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and channel_id = old.channel_id
    and status = 'pending'
    and (agent_id = old.agent_id or delegated_by_agent_id = old.agent_id);
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_job_invalidate
after update of organization_id, channel_id, project_id, agent_id, skill_id,
                selected_skill_id_snapshot, trigger_message_id,
                reply_message_id, delegated_by_reply_job_id,
                delegation_request, status
on briar_channel_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel'
    and (source_reply_job_id = old.id or delegated_by_reply_job_id = old.id)
    and status = 'pending'
    and (new.organization_id is not old.organization_id
      or new.channel_id is not old.channel_id
      or new.project_id is not old.project_id
      or new.agent_id is not old.agent_id
      or new.skill_id is not old.skill_id
      or new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
      or new.trigger_message_id is not old.trigger_message_id
      or new.reply_message_id is not old.reply_message_id
      or new.delegated_by_reply_job_id is not old.delegated_by_reply_job_id
      or new.delegation_request is not old.delegation_request
      or new.status <> 'completed');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_issue_message_invalidate
after update of body on briar_issue_messages
when new.body <> old.body
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and trigger_message_id = new.id
    and status = 'pending';
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_issue_message_delete_invalidate
before delete on briar_issue_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_issue_assignment_invalidate
after update of agent_id, project_id on briar_hunt_runs
when new.agent_id is not old.agent_id or new.project_id <> old.project_id
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and conversation_run_id = new.id
    and status = 'pending';
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_sync_insert
after insert on briar_agent_skill_execution_proposals
when new.source_kind = 'channel'
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_sync_update
after update on briar_agent_skill_execution_proposals
when new.source_kind = 'channel' and new.channel_id is not null
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'proposal', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_runs_update_sync
after update on briar_hunt_runs
when old.lease_expires_at is new.lease_expires_at
  or old.updated_at is not new.updated_at
BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_reply_jobs_update_sync
after update on briar_channel_agent_reply_jobs
when old.lease_expires_at is new.lease_expires_at
  or old.updated_at is not new.updated_at
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'reply_job', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_issue_subscriptions_run_insert
after insert on briar_hunt_runs
when new.assignee_user_id is not null BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.assignee_user_id, new.started_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.assignee_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_issue_subscriptions_assignee_update
after update of assignee_user_id on briar_hunt_runs
when new.assignee_user_id is not null
  and new.assignee_user_id is not old.assignee_user_id BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.assignee_user_id, new.updated_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.assignee_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_messages_insert_sync
after insert on briar_channel_messages BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'message', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_messages_delete_sync
after delete on briar_channel_messages BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, old.channel_id, 'message', old.id,
           'delete', datetime('now')
    from briar_channels channel where channel.id = old.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = old.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_message_invalidate
after update of body on briar_channel_messages
when new.body <> old.body
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and trigger_message_id = new.id
    and status = 'pending';
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_message_delete_invalidate
before delete on briar_channel_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;
-- @statement
CREATE TRIGGER briar_channel_changes_reply_jobs_insert_sync
after insert on briar_channel_agent_reply_jobs BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'reply_job', new.id, 'upsert',
    datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_reply_skill_snapshot_insert
after insert on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
BEGIN
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_channel_job_delete_invalidate
before delete on briar_channel_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and (source_reply_job_id = old.id or delegated_by_reply_job_id = old.id);
END;
-- @statement
CREATE TRIGGER briar_issue_execution_proposal_insert_guard
before insert on briar_issue_execution_proposals
when not (
  new.status = 'pending' and new.generation = 1
  and new.approval_reserved_by_user_id is null
  and new.approval_reserved_at is null
  and new.requested_provider is null and new.requested_model is null
  and new.requested_effort is null and new.requested_worker_id is null
  and new.dispatch_request_id is null
  and new.accepted_by_user_id is null and new.accepted_at is null
  and exists (
    select 1
    from briar_projects project
    join briar_hunt_runs target
      on target.id = new.target_run_id and target.project_id = project.id
    where project.id = new.project_id
      and project.organization_id = new.organization_id
      and target.title = new.target_title
      and target.updated_at = new.target_run_updated_at
      and target.status = 'backlog' and target.stage = 'queued'
      and target.workflow_stage is null
      and target.worker_id is null and target.requested_worker_id is null
      and target.claim_token_hash is null and target.claimed_by is null
      and target.claimed_at is null and target.lease_expires_at is null
      and target.last_execution_id is null
      and target.dispatch_mode is null and target.dispatch_request_id is null
      and target.dispatched_at is null and target.requested_by_user_id is null
      and target.completed_at is null and target.paused_at is null
      and target.resume_requested_at is null
  )
  and (
    new.proposed_by_agent_id is null
    or exists (
      select 1 from briar_project_agents agent
      where agent.id = new.proposed_by_agent_id
        and agent.project_id = new.project_id
        and agent.organization_id = new.organization_id
    )
  )
  and (
    (
      new.source_kind = 'channel'
      and new.proposed_by_agent_id is not null
      and exists (
        select 1
        from briar_channels channel
        join briar_channel_messages reply
          on reply.id = new.reply_message_id
         and reply.channel_id = channel.id
        join briar_channel_agents roster
          on roster.channel_id = channel.id
         and roster.agent_id = new.proposed_by_agent_id
        where channel.id = new.channel_id
          and channel.organization_id = new.organization_id
          and reply.author_agent_id = new.proposed_by_agent_id
      )
      and (
        (new.origin_create_proposal_id is null)
        or exists (
          select 1 from briar_channel_action_proposals origin
          where origin.id = new.origin_create_proposal_id
            and origin.channel_id = new.channel_id
            and origin.reply_message_id = new.reply_message_id
            and origin.result_run_id = new.target_run_id
            and origin.execution_proposal_id = new.id
            and origin.execute_after_create = 1
            and origin.status = 'accepted'
        )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and exists (
        select 1
        from briar_hunt_runs conversation
        join briar_issue_messages reply
          on reply.id = new.reply_message_id
         and reply.run_id = conversation.id
         and reply.project_id = conversation.project_id
        where conversation.id = new.conversation_run_id
          and conversation.project_id = new.project_id
      )
      and (
        (
          new.origin_create_proposal_id is null
          and new.target_run_id = new.conversation_run_id
        )
        or exists (
          select 1 from briar_issue_action_proposals origin
          where origin.id = new.origin_create_proposal_id
            and origin.conversation_run_id = new.conversation_run_id
            and origin.reply_message_id = new.reply_message_id
            and origin.result_run_id = new.target_run_id
            and origin.execution_proposal_id = new.id
            and origin.execute_after_create = 1
            and origin.status = 'accepted'
        )
      )
    )
  )
)
BEGIN
  select raise(abort, 'invalid issue execution proposal');
END;
-- @statement
CREATE TRIGGER briar_channel_create_materialize_execution_proposal
after update of status on briar_channel_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.action_type = 'request_issue_create'
  and new.execute_after_create = 1
  and new.execution_proposal_id is not null
  and new.result_run_id is not null
BEGIN
  insert into briar_issue_execution_proposals (
    id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    target_run_id, target_title, target_run_updated_at,
    proposed_by_agent_id, delegated_by_agent_id, delegated_by_agent_name,
    origin_create_proposal_id, created_at, updated_at
  )
  select new.execution_proposal_id, channel.organization_id, new.project_id,
         'channel', new.channel_id, null, new.trigger_message_id,
         new.reply_message_id, run.id, run.title, run.updated_at,
         reply.author_agent_id, parent.agent_id, parent_agent.name,
         new.id, new.accepted_at, new.accepted_at
  from briar_hunt_runs run
  join briar_channels channel on channel.id = new.channel_id
  join briar_channel_messages reply on reply.id = new.reply_message_id
  left join briar_channel_agent_reply_jobs child
    on child.reply_message_id = new.reply_message_id
  left join briar_channel_agent_reply_jobs parent
    on parent.id = child.delegated_by_reply_job_id
  left join briar_project_agents parent_agent on parent_agent.id = parent.agent_id
  where run.id = new.result_run_id and run.project_id = new.project_id
    and run.status = 'backlog' and run.stage = 'queued'
    and run.dispatch_request_id is null and run.claim_token_hash is null
  on conflict (id) do nothing;

  select raise(abort, 'channel execution proposal was not materialized')
  where not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_channels channel on channel.id = new.channel_id
    where proposal.id = new.execution_proposal_id
      and proposal.organization_id = channel.organization_id
      and proposal.project_id = new.project_id
      and proposal.source_kind = 'channel'
      and proposal.channel_id = new.channel_id
      and proposal.conversation_run_id is null
      and proposal.trigger_message_id = new.trigger_message_id
      and proposal.reply_message_id = new.reply_message_id
      and proposal.target_run_id = new.result_run_id
      and proposal.origin_create_proposal_id = new.id
      and proposal.status = 'pending'
      and proposal.dispatch_request_id is null
  );
END;
-- @statement
CREATE TRIGGER briar_issue_execution_dispatch_channel_source_guard
before update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and exists (
    select 1 from briar_issue_execution_proposals proposal
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.source_kind = 'channel'
  )
  and not exists (
    select 1
    from briar_issue_execution_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_organization_members membership
      on membership.organization_id = channel.organization_id
     and membership.user_id = proposal.approval_reserved_by_user_id
    join briar_channel_messages reply
      on reply.id = proposal.reply_message_id
     and reply.channel_id = channel.id
    join briar_project_agents agent
      on agent.id = proposal.proposed_by_agent_id
     and agent.id = reply.author_agent_id
     and agent.project_id = proposal.project_id
     and agent.organization_id = proposal.organization_id
    join briar_channel_agents roster
      on roster.channel_id = channel.id and roster.agent_id = agent.id
    where proposal.dispatch_request_id = new.dispatch_request_id
      and proposal.status = 'pending' and proposal.source_kind = 'channel'
      and channel.organization_id = proposal.organization_id
      and channel.archived_at is null
      and (
        channel.visibility = 'public'
        or exists (
          select 1 from briar_channel_members channel_member
          where channel_member.channel_id = channel.id
            and channel_member.user_id = proposal.approval_reserved_by_user_id
        )
      )
      and (
        proposal.delegated_by_agent_id is null
        or exists (
          select 1
          from briar_project_agents source_agent
          join briar_channel_agents source_roster
            on source_roster.channel_id = channel.id
           and source_roster.agent_id = source_agent.id
          join briar_channel_agent_reply_jobs child
            on child.reply_message_id = proposal.reply_message_id
          join briar_channel_agent_reply_jobs parent
            on parent.id = child.delegated_by_reply_job_id
           and parent.agent_id = source_agent.id
          where source_agent.id = proposal.delegated_by_agent_id
            and source_agent.organization_id = proposal.organization_id
            and source_agent.project_id is null
        )
      )
  )
BEGIN
  select raise(abort, 'channel execution proposal source is stale');
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_execution_proposals_insert_sync
after insert on briar_issue_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_execution_proposals_update_sync
after update on briar_issue_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_skill_proposals_insert_sync
after insert on briar_agent_skill_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_issue_skill_proposals_update_sync
after update on briar_agent_skill_execution_proposals
when new.source_kind = 'issue' BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.reply_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_issue_subscriptions_creator_insert
after insert on briar_hunt_runs
when new.created_by_user_id is not null BEGIN
  insert into briar_issue_subscriptions (
    run_id, organization_id, user_id, created_at
  )
  select new.id, project.organization_id, new.created_by_user_id, new.started_at
  from briar_projects project
  join briar_organization_members membership
    on membership.organization_id = project.organization_id
   and membership.user_id = new.created_by_user_id
  where project.id = new.project_id
  on conflict (run_id, user_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_agent_skills_max_count_insert
before insert on briar_agent_skills
when not exists (
  select 1 from briar_agent_skills existing
  where existing.id = new.id and existing.agent_id = new.agent_id
)
and (
  select count(*) from briar_agent_skills skill
  where skill.agent_id = new.agent_id
) >= 5
BEGIN
  select raise(abort, 'An Agent can have at most 5 Skills');
END;
-- @statement
CREATE TRIGGER briar_agent_skills_max_count_update
before update of agent_id on briar_agent_skills
when new.agent_id <> old.agent_id
and (
  select count(*) from briar_agent_skills skill
  where skill.agent_id = new.agent_id
) >= 5
BEGIN
  select raise(abort, 'An Agent can have at most 5 Skills');
END;
-- @statement
CREATE TRIGGER briar_channel_thread_subscriptions_author_insert
after insert on briar_channel_messages
when new.author_user_id is not null BEGIN
  insert into briar_channel_thread_subscriptions (
    root_message_id, channel_id, organization_id, user_id, created_at
  )
  select coalesce(new.parent_message_id, new.id), new.channel_id,
         channel.organization_id, new.author_user_id, new.created_at
  from briar_channels channel
  join briar_organization_members membership
    on membership.organization_id = channel.organization_id
   and membership.user_id = new.author_user_id
  where channel.id = new.channel_id
  on conflict (root_message_id, user_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_channel_thread_subscriptions_mention_insert
after insert on briar_channel_message_mentions BEGIN
  insert into briar_channel_thread_subscriptions (
    root_message_id, channel_id, organization_id, user_id, created_at
  )
  select coalesce(message.parent_message_id, message.id), message.channel_id,
         channel.organization_id, new.user_id, new.created_at
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  join briar_organization_members membership
    on membership.organization_id = channel.organization_id
   and membership.user_id = new.user_id
  where message.id = new.message_id
  on conflict (root_message_id, user_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_channel_notification_message_insert
after insert on briar_channel_messages
when new.parent_message_id is not null BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, new.id,
         iif(root.author_user_id = subscription.user_id, 'thread_reply', 'subscription'),
         new.created_at
  from briar_channel_thread_subscriptions subscription
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = new.channel_id
  where subscription.root_message_id = new.parent_message_id
    and (new.author_user_id is null
         or new.author_user_id <> subscription.user_id)
    and julianday(new.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_channel_notification_mention_insert
after insert on briar_channel_message_mentions
BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select new.user_id, channel.organization_id, message.id,
         'mention', message.created_at
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
    and (message.author_user_id is null
         or message.author_user_id <> new.user_id)
  on conflict (user_id, message_id) do update set
    organization_id = excluded.organization_id,
    notification_reason = 'mention',
    created_at = excluded.created_at;
END;
-- @statement
CREATE TRIGGER briar_channel_notification_mention_delete
after delete on briar_channel_message_mentions
BEGIN
  delete from briar_channel_notification_inbox
  where user_id = old.user_id and message_id = old.message_id;

  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, message.id,
         iif(root.author_user_id = subscription.user_id, 'thread_reply', 'subscription'),
         message.created_at
  from briar_channel_messages message
  join briar_channel_thread_subscriptions subscription
    on subscription.root_message_id = coalesce(
         message.parent_message_id, message.id
       )
   and subscription.user_id = old.user_id
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = message.channel_id
  where message.id = old.message_id
    and message.parent_message_id is not null
    and (message.author_user_id is null
         or message.author_user_id <> old.user_id)
    and julianday(message.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do nothing;
END;
-- @statement
CREATE TRIGGER briar_issue_agent_reply_skill_snapshot_immutable
before update of selected_skill_id_snapshot, selected_agent_name_snapshot,
                 selected_agent_responsibility_snapshot,
                 selected_skill_name_snapshot,
                 selected_skill_instructions_snapshot,
                 selected_skill_kind_snapshot,
                 selected_skill_provider_snapshot,
                 selected_skill_model_snapshot,
                 selected_skill_effort_snapshot,
                 skill_execution_request_snapshot
on briar_issue_agent_reply_jobs
when new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
  or new.selected_agent_name_snapshot is not old.selected_agent_name_snapshot
  or new.selected_agent_responsibility_snapshot is not
    old.selected_agent_responsibility_snapshot
  or new.selected_skill_name_snapshot is not old.selected_skill_name_snapshot
  or new.selected_skill_instructions_snapshot is not
    old.selected_skill_instructions_snapshot
  or new.selected_skill_kind_snapshot is not old.selected_skill_kind_snapshot
  or new.selected_skill_provider_snapshot is not
    old.selected_skill_provider_snapshot
  or new.selected_skill_model_snapshot is not old.selected_skill_model_snapshot
  or new.selected_skill_effort_snapshot is not old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
begin
  select raise(abort, 'issue Agent Skill reply snapshot is immutable');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_issue_job_invalidate
after update of project_id, run_id, trigger_message_id, reply_message_id,
                skill_id, selected_skill_id_snapshot, status
on briar_issue_agent_reply_jobs
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending'
    and (new.project_id is not old.project_id
      or new.run_id is not old.run_id
      or new.trigger_message_id is not old.trigger_message_id
      or new.reply_message_id is not old.reply_message_id
      or new.skill_id is not old.skill_id
      or new.selected_skill_id_snapshot is not old.selected_skill_id_snapshot
      or new.status <> 'completed');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_issue_job_delete_invalidate
before delete on briar_issue_agent_reply_jobs
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending';
end;
-- @statement
CREATE TRIGGER briar_dashboard_issue_reply_jobs_insert_sync
after insert on briar_issue_agent_reply_jobs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;
-- @statement
CREATE TRIGGER briar_dashboard_issue_reply_jobs_update_sync
after update of status, claimed_worker_id, agent_provider, error, completed_at
on briar_issue_agent_reply_jobs begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
end;
-- @statement
CREATE TRIGGER briar_project_stranded_run_child_delete_guard
before delete on briar_projects
when exists (
  select 1 from briar_run_child_storage_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_storage_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
begin
  select raise(abort, 'project has stranded transferred issue data');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_insert_guard
before insert on briar_agent_skill_execution_proposals
when not (
  new.status = 'pending' and new.generation = 1
  and new.requested_worker_id is null
  and new.requested_worker_label is null
  and new.result_session_id is null
  and new.accepted_by_user_id is null and new.accepted_at is null
  and exists (
    select 1
    from briar_projects project
    join briar_project_agents agent
      on agent.id = new.agent_id and agent.project_id = project.id
     and agent.organization_id = project.organization_id
    join briar_agent_skills skill
      on skill.id = new.skill_id and skill.agent_id = agent.id
    where project.id = new.project_id
      and project.organization_id = new.organization_id
      and agent.name = new.agent_name
      and agent.responsibility = new.agent_responsibility
      and skill.name = new.skill_name
      and skill.body = new.skill_instructions
      and skill.kind = new.skill_kind
      and skill.provider = new.provider
      and skill.model is new.model
      and skill.effort is new.effort
  )
  and not exists (
    select 1 from briar_issue_execution_proposals execution
    where execution.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_channel_action_proposals action
    where new.source_kind = 'channel'
      and action.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_issue_action_proposals action
    where new.source_kind = 'issue'
      and action.reply_message_id = new.reply_message_id
  )
  and not exists (
    select 1 from briar_issue_rework_proposals rework
    where new.source_kind = 'issue'
      and rework.reply_message_id = new.reply_message_id
  )
  and (
    (
      new.source_kind = 'channel'
      and exists (
        select 1
        from briar_channel_agent_reply_jobs job
        join briar_channels channel
          on channel.id = job.channel_id
         and channel.organization_id = job.organization_id
        join briar_channel_messages trigger_message
          on trigger_message.id = job.trigger_message_id
         and trigger_message.channel_id = job.channel_id
        join briar_channel_messages reply
          on reply.id = job.reply_message_id
         and reply.channel_id = job.channel_id
         and reply.author_agent_id = job.agent_id
        join briar_channel_agents roster
          on roster.channel_id = job.channel_id and roster.agent_id = job.agent_id
        where job.id = new.source_reply_job_id
          and job.organization_id = new.organization_id
          and job.channel_id = new.channel_id
          and job.project_id = new.project_id
          and job.agent_id = new.agent_id
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and job.trigger_message_id = new.trigger_message_id
          and job.reply_message_id = new.reply_message_id
          and job.status = 'completed'
          and channel.archived_at is null
          and (
            (job.delegated_by_reply_job_id is null
              and new.request = trigger_message.body)
            or
            (job.delegated_by_reply_job_id is not null
              and new.request = job.delegation_request)
          )
          and new.delegated_by_reply_job_id is job.delegated_by_reply_job_id
          and (
            (job.delegated_by_reply_job_id is null
              and new.delegated_by_agent_id is null
              and new.delegated_by_agent_name is null)
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.organization_id = job.organization_id
               and parent_agent.project_id is null
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = job.channel_id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = job.organization_id
                and parent.channel_id = job.channel_id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and new.delegated_by_reply_job_id is null
      and new.delegated_by_agent_id is null
      and new.delegated_by_agent_name is null
      and exists (
        select 1
        from briar_issue_agent_reply_jobs job
        join briar_hunt_runs run
          on run.id = job.run_id and run.project_id = job.project_id
        join briar_issue_messages trigger_message
          on trigger_message.id = job.trigger_message_id
         and trigger_message.run_id = job.run_id
         and trigger_message.project_id = job.project_id
        join briar_issue_messages reply
          on reply.id = job.reply_message_id
         and reply.run_id = job.run_id and reply.project_id = job.project_id
        where job.id = new.source_reply_job_id
          and job.project_id = new.project_id
          and job.run_id = new.conversation_run_id
          and job.trigger_message_id = new.trigger_message_id
          and job.reply_message_id = new.reply_message_id
          and job.status = 'completed'
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and coalesce(job.agent_id, run.agent_id) = new.agent_id
          and trigger_message.body = new.request
      )
    )
  )
)
begin
  select raise(abort, 'invalid Agent Skill execution proposal');
end;
-- @statement
CREATE TRIGGER briar_project_agent_session_requester_immutable
before update of requested_by_user_id on briar_project_agent_sessions
when new.requested_by_user_id is not old.requested_by_user_id
  and not (
    old.requested_by_user_id is not null
    and new.requested_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.requested_by_user_id
    )
  )
begin
  select raise(abort, 'Agent Session requester is immutable');
end;
-- @statement
CREATE TRIGGER briar_managed_computers_state_transition
before update of state on briar_managed_computers
when new.state != old.state and not (
  (old.state = 'requested' and new.state in ('provisioning', 'failed', 'draining')) or
  (old.state = 'provisioning' and new.state in ('bootstrapping', 'failed', 'draining')) or
  (old.state = 'bootstrapping' and new.state in ('needs_setup', 'failed', 'draining')) or
  (old.state = 'needs_setup' and new.state in ('ready', 'failed', 'draining')) or
  (old.state = 'ready' and new.state in ('failed', 'draining')) or
  (old.state = 'failed' and new.state in ('requested', 'draining', 'terminated')) or
  (old.state = 'draining' and new.state in ('stopped', 'failed')) or
  (old.state = 'stopped' and new.state in ('terminated', 'failed'))
)
begin
  select raise(abort, 'invalid managed computer state transition');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_batch_items_immutable_update
before update on briar_channel_issue_batch_items
BEGIN
  select raise(abort, 'channel issue batch mapping is immutable');
END;
-- @statement
CREATE TRIGGER briar_channel_reply_session_events_immutable_update
before update on briar_channel_reply_session_events
begin
  select raise(abort, 'Channel reply session events are immutable');
end;
-- @statement
CREATE TRIGGER briar_agent_transcript_segments_totals_after_insert
after insert on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count,
      byte_count = byte_count + new.uncompressed_bytes
  where session_id = new.session_id;
end;
-- @statement
CREATE TRIGGER briar_agent_transcript_segments_totals_after_delete
after delete on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count - old.event_count,
      byte_count = byte_count - old.uncompressed_bytes
  where session_id = old.session_id;
end;
-- @statement
CREATE TRIGGER briar_agent_transcript_segments_totals_after_update
after update of session_id, event_count, uncompressed_bytes
on briar_agent_transcript_segments
begin
  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count - old.event_count,
      byte_count = byte_count + new.uncompressed_bytes - old.uncompressed_bytes
  where session_id = new.session_id
    and old.session_id = new.session_id;

  update briar_agent_transcript_sessions
  set event_count = event_count - old.event_count,
      byte_count = byte_count - old.uncompressed_bytes
  where session_id = old.session_id
    and old.session_id <> new.session_id;

  update briar_agent_transcript_sessions
  set event_count = event_count + new.event_count,
      byte_count = byte_count + new.uncompressed_bytes
  where session_id = new.session_id
    and old.session_id <> new.session_id;
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_mode_insert_guard
before insert on briar_agent_skill_execution_proposals
when not (
  exists (
    select 1 from briar_agent_skills skill
    where skill.id = new.skill_id and skill.agent_id = new.agent_id
      and skill.execution_mode = new.execution_mode
      and skill.approval_policy = new.approval_policy
  )
  and (
    (new.source_kind = 'channel'
      and new.channel_id is not null
      and new.thread_root_message_id is not null
      and exists (
        select 1 from briar_channel_agent_reply_jobs job
        where job.id = new.source_reply_job_id
          and job.channel_id = new.channel_id
          and job.parent_message_id = new.thread_root_message_id
          and job.trigger_message_id = new.trigger_message_id
      ))
    or
    (new.source_kind = 'issue'
      and new.channel_id is null
      and new.execution_mode = 'task'
      and new.thread_root_message_id is not null
      and exists (
        select 1 from briar_issue_agent_reply_jobs job
        where job.id = new.source_reply_job_id
          and job.run_id = new.conversation_run_id
          and job.parent_message_id = new.thread_root_message_id
          and job.trigger_message_id = new.trigger_message_id
      ))
  )
)
begin
  select raise(abort, 'invalid Agent Skill execution mode or origin');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_result_job_insert_guard
before insert on briar_channel_agent_reply_jobs
when new.approved_skill_execution_proposal_id is not null
  and not exists (
    select 1
    from briar_agent_skill_execution_proposals proposal
    join briar_channel_agent_reply_jobs source
      on source.id = proposal.source_reply_job_id
     and source.session_id = proposal.result_session_id
    where proposal.id = new.approved_skill_execution_proposal_id
      and proposal.status = 'accepted'
      and proposal.source_kind = 'channel'
      and proposal.execution_mode = 'conversation'
      and proposal.channel_id = new.channel_id
      and proposal.project_id = new.project_id
      and proposal.agent_id = new.agent_id
      and proposal.skill_id = new.skill_id
      and proposal.result_session_id = new.session_id
      and proposal.result_reply_job_id = new.id
      and proposal.result_message_id = new.reply_message_id
      and proposal.reply_message_id = new.trigger_message_id
      and proposal.thread_root_message_id = new.parent_message_id
      and proposal.request = new.skill_execution_request_snapshot
      and proposal.skill_id = new.selected_skill_id_snapshot
      and proposal.agent_name = new.selected_agent_name_snapshot
      and proposal.agent_responsibility =
        new.selected_agent_responsibility_snapshot
      and proposal.skill_name = new.selected_skill_name_snapshot
      and proposal.skill_instructions =
        new.selected_skill_instructions_snapshot
      and proposal.skill_kind = new.selected_skill_kind_snapshot
      and proposal.provider = new.selected_skill_provider_snapshot
      and proposal.model is new.selected_skill_model_snapshot
      and proposal.effort is new.selected_skill_effort_snapshot
  )
begin
  select raise(abort, 'invalid approved Agent Skill conversation job');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_result_job_origin_immutable
before update of approved_skill_execution_proposal_id
on briar_channel_agent_reply_jobs
when new.approved_skill_execution_proposal_id is not
  old.approved_skill_execution_proposal_id
begin
  select raise(abort, 'approved Agent Skill conversation origin is immutable');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_result_job_failure_publish
after update of status on briar_channel_agent_reply_jobs
when old.status in ('queued', 'running') and new.status = 'failed'
  and new.approved_skill_execution_proposal_id is not null
begin
  insert or ignore into briar_channel_messages (
    id, channel_id, parent_message_id, author_user_id, author_agent_id,
    author_agent_name, author_agent_provider, body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.channel_id,
         proposal.thread_root_message_id, null, proposal.agent_id,
         proposal.agent_name, proposal.provider,
         '**Skill execution failed**' || char(10) || char(10) ||
           substr(coalesce(new.error, 'The Skill failed without an error summary.'),
                  1, 9000),
         new.updated_at, new.updated_at
  from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.approved_skill_execution_proposal_id
    and proposal.status = 'accepted'
    and proposal.execution_mode = 'conversation'
    and proposal.result_reply_job_id = new.id
    and proposal.result_message_id = new.reply_message_id
    and exists (
      select 1 from briar_channel_messages root
      where root.id = proposal.thread_root_message_id
        and root.channel_id = proposal.channel_id
        and root.parent_message_id is null
    );
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_mode_immutable
before update of execution_mode, approval_policy, thread_root_message_id
on briar_agent_skill_execution_proposals
when new.execution_mode is not old.execution_mode
  or new.approval_policy is not old.approval_policy
  or new.thread_root_message_id is not old.thread_root_message_id
begin
  select raise(abort, 'Agent Skill execution mode and origin are immutable');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_result_origin_immutable
before update of result_reply_job_id, result_message_id
on briar_agent_skill_execution_proposals
when not (
  (old.status = 'pending' and new.status = 'accepted'
    and old.result_reply_job_id is null and old.result_message_id is null
    and (
      (new.execution_mode = 'task'
        and new.result_reply_job_id is null and new.result_message_id is null)
      or
      (new.execution_mode = 'conversation'
        and new.result_reply_job_id is not null
        and new.result_message_id is not null)
    ))
  or
  (old.status = 'accepted' and new.status = 'accepted'
    and new.execution_mode = 'task'
    and old.result_reply_job_id is null and new.result_reply_job_id is null
    and old.result_message_id is null and new.result_message_id is not null
    and exists (
      select 1 from briar_project_agent_task_jobs task
      where task.id = new.result_session_id
        and task.skill_execution_proposal_id = new.id
        and task.status in ('completed', 'failed')
    ))
  or
  (new.result_reply_job_id is old.result_reply_job_id
    and new.result_message_id is old.result_message_id)
)
begin
  select raise(abort, 'Agent Skill execution result origin is immutable');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_proposal_decline_guard
before update of declined_by_user_id, declined_at
on briar_channel_action_proposals
when not (
  old.action_type = 'request_issue_create'
  and old.status = 'pending'
  and old.declined_by_user_id is null
  and old.declined_at is null
  and old.accepted_by_user_id is null
  and old.accepted_at is null
  and old.issue_source_key is null
  and new.declined_by_user_id is not null
  and new.declined_at is not null
)
begin
  select raise(abort, 'channel issue proposal decline is immutable');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_proposal_declined_accept_guard
before update of status, accepted_by_user_id, accepted_at, issue_source_key
on briar_channel_action_proposals
when old.action_type = 'request_issue_create'
  and old.declined_at is not null
  and (
    new.status is not old.status
    or new.accepted_by_user_id is not old.accepted_by_user_id
    or new.accepted_at is not old.accepted_at
    or new.issue_source_key is not old.issue_source_key
  )
begin
  
  
  select raise(ignore);
end;
-- @statement
CREATE TRIGGER briar_dashboard_attachments_insert_sync
after insert on briar_issue_attachments BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_attachments_delete_sync
after delete on briar_issue_attachments BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_members_insert_sync
after insert on briar_organization_members BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', new.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = new.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = new.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_members_update_sync
after update on briar_organization_members BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', new.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = new.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = new.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_members_delete_sync
after delete on briar_organization_members BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select id, 'metadata', old.user_id, 'replace', datetime('now')
    from briar_projects where organization_id = old.organization_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select change.project_id, max(change.version)
    from briar_dashboard_changes change
    join briar_projects project on project.id = change.project_id
   where project.organization_id = old.organization_id
     and change.entity_type = 'metadata'
   group by change.project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_issue_execution_org_member_remove_invalidate
after delete on briar_organization_members
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where organization_id = old.organization_id and status = 'pending'
    and approval_reserved_by_user_id = old.user_id;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_worker_membership_reconcile
before delete on briar_organization_members
BEGIN
  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Worker owner lost organization access.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id is not null
    and preferred_worker_id in (
      select worker.id
      from briar_execution_workers worker
      join briar_execution_worker_devices device on device.id = worker.device_id
      where device.organization_id = old.organization_id
        and device.owner_user_id = old.user_id
    );
END;
-- @statement
CREATE TRIGGER briar_project_members_insert_sync
after insert on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_project_members_delete_sync
before delete on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;
-- @statement
CREATE TRIGGER briar_issue_subscriptions_insert_sync
after insert on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_issue_subscriptions_delete_sync
before delete on briar_issue_subscriptions BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  )
  select run.project_id, 'run', run.id, 'upsert', datetime('now')
  from briar_hunt_runs run where run.id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select run.project_id, last_insert_rowid()
  from briar_hunt_runs run where run.id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_thread_subscriptions_insert_sync
after insert on briar_channel_thread_subscriptions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.channel_id, 'message', new.root_message_id,
    'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_thread_subscriptions_delete_sync
before delete on briar_channel_thread_subscriptions BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    old.organization_id, old.channel_id, 'message', old.root_message_id,
    'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (old.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_mobile_push_outbox_sync_insert
after insert on briar_organization_inbox_sync_state BEGIN
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  values (new.organization_id, new.current_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
END;
-- @statement
CREATE TRIGGER briar_mobile_push_outbox_sync_update
after update of current_version on briar_organization_inbox_sync_state
when new.current_version > old.current_version BEGIN
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  values (new.organization_id, new.current_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
END;
-- @statement
CREATE TRIGGER briar_mobile_push_outbox_sync_delete
after delete on briar_organization_inbox_sync_state BEGIN
  delete from briar_mobile_push_outbox
  where organization_id = old.organization_id;
END;
-- @statement
CREATE TRIGGER briar_projects_sync_team_after_insert
after insert on briar_projects BEGIN
  insert or ignore into briar_teams (
    id, owner_user_id, name, agent_token_hash, created_at, updated_at,
    organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
    schedule_tab_enabled
  ) values (
    new.id, new.owner_user_id, new.name, new.agent_token_hash,
    new.created_at, new.updated_at, new.organization_id, new.icon_data_url,
    new.icon_data_url_browser, new.issue_key_prefix, new.schedule_tab_enabled
  );
  update briar_teams
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;
-- @statement
CREATE TRIGGER briar_projects_sync_team_after_update
after update on briar_projects BEGIN
  update briar_teams
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;
-- @statement
CREATE TRIGGER briar_projects_sync_team_after_delete
after delete on briar_projects BEGIN
  delete from briar_teams where id = old.id;
END;
-- @statement
CREATE TRIGGER briar_teams_sync_legacy_after_insert
after insert on briar_teams BEGIN
  insert or ignore into briar_projects (
    id, owner_user_id, name, agent_token_hash, created_at, updated_at,
    organization_id, icon_data_url, icon_data_url_browser, issue_key_prefix,
    schedule_tab_enabled
  ) values (
    new.id, new.owner_user_id, new.name, new.agent_token_hash,
    new.created_at, new.updated_at, new.organization_id, new.icon_data_url,
    new.icon_data_url_browser, new.issue_key_prefix, new.schedule_tab_enabled
  );
  update briar_projects
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;
-- @statement
CREATE TRIGGER briar_teams_sync_legacy_after_update
after update on briar_teams BEGIN
  update briar_projects
  set owner_user_id = new.owner_user_id,
      name = new.name,
      agent_token_hash = new.agent_token_hash,
      created_at = new.created_at,
      updated_at = new.updated_at,
      organization_id = new.organization_id,
      icon_data_url = new.icon_data_url,
      icon_data_url_browser = new.icon_data_url_browser,
      issue_key_prefix = new.issue_key_prefix,
      schedule_tab_enabled = new.schedule_tab_enabled
  where id = new.id and (
    owner_user_id is not new.owner_user_id or name is not new.name
    or agent_token_hash is not new.agent_token_hash
    or created_at is not new.created_at or updated_at is not new.updated_at
    or organization_id is not new.organization_id
    or icon_data_url is not new.icon_data_url
    or icon_data_url_browser is not new.icon_data_url_browser
    or issue_key_prefix is not new.issue_key_prefix
    or schedule_tab_enabled is not new.schedule_tab_enabled
  );
END;
-- @statement
CREATE TRIGGER briar_teams_sync_legacy_after_delete
after delete on briar_teams BEGIN
  delete from briar_projects where id = old.id;
END;
-- @statement
CREATE TRIGGER briar_teams_delete_issues_before_projects
before delete on briar_teams BEGIN
  delete from briar_hunt_runs where project_id = old.id;
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_assign_default_project
after insert on briar_hunt_runs
when new.planning_project_id is null BEGIN
  update briar_hunt_runs
  set team_id = coalesce(new.team_id, new.project_id),
      planning_project_id = (
    select project.id
    from briar_planning_projects project
    where project.team_id = new.project_id and project.is_default = 1
  )
  where id = new.id;
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_validate_team_insert
before insert on briar_hunt_runs
when new.team_id is not null and new.team_id <> new.project_id BEGIN
  select raise(abort, 'legacy project id must match issue team');
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_sync_team_after_insert
after insert on briar_hunt_runs
when new.team_id is null BEGIN
  update briar_hunt_runs set team_id = new.project_id where id = new.id;
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_validate_team_update
before update of team_id on briar_hunt_runs
when new.team_id is null or new.team_id <> new.project_id BEGIN
  select raise(abort, 'legacy project id must match issue team');
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_validate_project_insert
before insert on briar_hunt_runs
when new.planning_project_id is not null BEGIN
  select case when not exists (
    select 1 from briar_planning_projects project
    where project.id = new.planning_project_id
      and project.team_id = new.project_id
  ) then raise(abort, 'issue project must belong to its team') end;
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_validate_project_update
before update of planning_project_id on briar_hunt_runs BEGIN
  select case when new.planning_project_id is null or not exists (
    select 1 from briar_planning_projects project
    where project.id = new.planning_project_id
      and project.team_id = new.project_id
  ) then raise(abort, 'issue project must belong to its team') end;
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_reclassify_after_team_transfer
after update of project_id on briar_hunt_runs
when old.project_id <> new.project_id BEGIN
  update briar_hunt_runs
  set team_id = new.project_id,
      planning_project_id = (
    select project.id
    from briar_planning_projects project
    where project.team_id = new.project_id and project.is_default = 1
  )
  where id = new.id;
END;
-- @statement
CREATE TRIGGER briar_teams_create_default_project_after_insert
after insert on briar_teams BEGIN
  insert into briar_planning_projects (
    id, team_id, name, description, status, sort_order, is_default,
    created_at, updated_at
  ) values (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
      '4' || substr(hex(randomblob(2)), 2) || '-' ||
      substr('89ab', 1 + abs(random()) % 4, 1) ||
      substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    ),
    new.id, 'General', '', 'active', 0, 1, new.created_at, new.updated_at
  );
END;
-- @statement
CREATE TRIGGER briar_planning_projects_validate_lead_insert
before insert on briar_planning_projects
when new.lead_user_id is not null BEGIN
  select case when not exists (
    select 1
    from briar_teams team
    join briar_organization_members membership
      on membership.organization_id = team.organization_id
     and membership.user_id = new.lead_user_id
    left join briar_project_members team_membership
      on team_membership.project_id = team.id
     and team_membership.user_id = membership.user_id
    where team.id = new.team_id
      and (
        membership.role in ('owner', 'co-owner')
        or team_membership.user_id is not null
      )
  ) then raise(abort, 'project lead must have access to its team') end;
END;
-- @statement
CREATE TRIGGER briar_planning_projects_validate_lead_update
before update of lead_user_id, team_id on briar_planning_projects
when new.lead_user_id is not null BEGIN
  select case when not exists (
    select 1
    from briar_teams team
    join briar_organization_members membership
      on membership.organization_id = team.organization_id
     and membership.user_id = new.lead_user_id
    left join briar_project_members team_membership
      on team_membership.project_id = team.id
     and team_membership.user_id = membership.user_id
    where team.id = new.team_id
      and (
        membership.role in ('owner', 'co-owner')
        or team_membership.user_id is not null
      )
  ) then raise(abort, 'project lead must have access to its team') end;
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_skill_update_invalidate
after update of body, provider, model, effort, execution_mode, approval_policy
on briar_agent_skills
when new.body is not old.body
  or new.provider is not old.provider
  or new.model is not old.model
  or new.effort is not old.effort
  or new.execution_mode is not old.execution_mode
  or new.approval_policy is not old.approval_policy
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where skill_id = old.id and status = 'pending'
    and (
      new.body is not skill_instructions
      or new.provider is not provider
      or new.model is not model
      or new.effort is not effort
      or new.execution_mode is not execution_mode
      or new.approval_policy is not approval_policy
    );

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill runtime changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select approval.proposal_id
      from briar_agent_skill_execution_approval_audit approval
      where approval.skill_id = old.id
        and (
          new.body is not approval.skill_instructions
          or new.provider is not approval.provider
          or new.model is not approval.model
          or new.effort is not approval.effort
          or new.execution_mode is not approval.execution_mode
          or new.approval_policy is not approval.approval_policy
        )
    );

  update briar_channel_agent_reply_jobs
  set status = 'failed',
      error = 'Approved Skill runtime changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_device_id = null, claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and approved_skill_execution_proposal_id in (
      select proposal.id
      from briar_agent_skill_execution_proposals proposal
      where proposal.skill_id = old.id and proposal.status = 'accepted'
        and (
          new.body is not proposal.skill_instructions
          or new.provider is not proposal.provider
          or new.model is not proposal.model
          or new.effort is not proposal.effort
          or new.execution_mode is not proposal.execution_mode
          or new.approval_policy is not proposal.approval_policy
        )
    );
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_task_terminal_project
after update of status on briar_project_agent_task_jobs
when new.skill_execution_proposal_id is not null
  and new.status in ('completed', 'failed')
  and (
    old.status in ('queued', 'running')
    or (
      old.status = new.status
      and (
        new.completed_at is null
        or exists (
          select 1 from briar_project_agent_sessions session
          where session.project_id = new.project_id and session.id = new.id
            and (
              session.status is not new.status
              or julianday(new.completed_at) < julianday(session.started_at)
            )
        )
        or not exists (
          select 1 from briar_project_agent_session_summaries summary
          where summary.project_id = new.project_id
            and summary.session_id = new.id
            and json_extract(summary.summary_json, '$.status') = new.status
        )
        or not exists (
          select 1
          from briar_agent_skill_execution_proposals proposal
          left join briar_channel_messages channel_message
            on proposal.source_kind = 'channel'
           and channel_message.id = proposal.result_message_id
          left join briar_issue_messages issue_message
            on proposal.source_kind = 'issue'
           and issue_message.id = proposal.result_message_id
          where proposal.id = new.skill_execution_proposal_id
            and proposal.result_message_id is not null
            and (
              channel_message.id is not null or issue_message.id is not null
            )
        )
      )
    )
  )
begin
  update briar_project_agent_task_jobs
  set completed_at = case
        when julianday(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) <
             julianday((
               select session.started_at
               from briar_project_agent_sessions session
               where session.project_id = new.project_id
                 and session.id = new.id
             ))
          then (
            select session.started_at
            from briar_project_agent_sessions session
            where session.project_id = new.project_id and session.id = new.id
          )
        else strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      end,
      updated_at = case
        when julianday(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) <
             julianday((
               select session.started_at
               from briar_project_agent_sessions session
               where session.project_id = new.project_id
                 and session.id = new.id
             ))
          then (
            select session.started_at
            from briar_project_agent_sessions session
            where session.project_id = new.project_id and session.id = new.id
          )
        else strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      end
  where project_id = new.project_id and id = new.id;

  update briar_project_agent_sessions
  set status = new.status,
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', new.status,
          '$.summary', new.result_summary,
          '$.conversationId', new.result_conversation_id,
          '$.error', new.error,
          '$.completedAt', (
            select task.completed_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          ),
          '$.updatedAt', (
            select task.updated_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          )
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', new.status,
          'occurredAt', (
            select task.completed_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          )
        )
      ),
      completed_at = (
        select task.completed_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      ),
      updated_at = (
        select task.updated_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      )
  where project_id = new.project_id and id = new.id;

  insert into briar_project_agent_session_summaries (
    project_id, session_id, summary_json, updated_at, archived
  )
  select session.project_id, session.id,
         json_object(
           'dispatchGroupId', coalesce(
             json_extract(session.payload_json, '$.dispatchGroupId'),
             session.id
           ),
           'agentId', coalesce(
             json_extract(session.payload_json, '$.agentId'),
             session.agent_id
           ),
           'agentName', json_extract(session.payload_json, '$.agentName'),
           'skillId', json_extract(session.payload_json, '$.skillId'),
           'sessionType', coalesce(
             json_extract(session.payload_json, '$.sessionType'),
             session.session_type
           ),
           'trigger', json_extract(session.payload_json, '$.trigger'),
           'scheduleId', json_extract(session.payload_json, '$.scheduleId'),
           'scheduleRunId',
             json_extract(session.payload_json, '$.scheduleRunId'),
           'parentSessionId',
             json_extract(session.payload_json, '$.parentSessionId'),
           'requestedByUserId', session.requested_by_user_id,
           'request', substr(
             json_extract(session.payload_json, '$.request'), 1, 500
           ),
           'status', session.status,
           'issues', json(coalesce(
             json_extract(session.payload_json, '$.issues'), '[]'
           )),
           'startedAt', session.started_at,
           'completedAt', session.completed_at,
           'inboxVersion', 'session:v1:' || session.status || ':' ||
             coalesce(session.completed_at, session.started_at),
           'requestedWorkerId',
             json_extract(session.payload_json, '$.requestedWorkerId'),
           'workerId', json_extract(session.payload_json, '$.workerId'),
           'updatedAt', session.updated_at
         ),
         session.updated_at, 0
  from briar_project_agent_sessions session
  where session.project_id = new.project_id and session.id = new.id
  on conflict (project_id, session_id) do update set
    summary_json = excluded.summary_json,
    updated_at = excluded.updated_at,
    archived = 0;

  update briar_agent_skill_execution_proposals
  set result_message_id = coalesce(
        result_message_id,
        lower(hex(randomblob(4))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(6)))
      ),
      updated_at = (
        select task.updated_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      )
  where id = new.skill_execution_proposal_id
    and status = 'accepted' and execution_mode = 'task'
    and result_session_id = new.id;

  insert into briar_channel_messages (
    id, channel_id, parent_message_id, author_user_id, author_agent_id,
    author_agent_name, author_agent_provider, body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.channel_id,
         proposal.thread_root_message_id, null, proposal.agent_id,
         proposal.agent_name, proposal.provider,
         case when new.status = 'completed'
           then '**Skill execution completed**'
           else '**Skill execution failed**' end || char(10) || char(10) ||
           substr(case when new.status = 'completed'
             then coalesce(
               new.result_summary, 'The Skill completed without a summary.'
             )
             else coalesce(
               new.error, 'The Skill failed without an error summary.'
             ) end, 1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         task.completed_at, task.completed_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'channel'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_channel_messages root
      where root.id = proposal.thread_root_message_id
        and root.channel_id = proposal.channel_id
        and root.parent_message_id is null
    )
  on conflict (id) do update set
    body = excluded.body,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  insert into briar_issue_messages (
    id, project_id, run_id, parent_message_id, author_user_id,
    author_agent_id, author_agent_name, author_agent_provider,
    body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.project_id,
         proposal.conversation_run_id, proposal.thread_root_message_id,
         null, proposal.agent_id, proposal.agent_name, proposal.provider,
         case when new.status = 'completed'
           then '**Skill execution completed**'
           else '**Skill execution failed**' end || char(10) || char(10) ||
           substr(case when new.status = 'completed'
             then coalesce(
               new.result_summary, 'The Skill completed without a summary.'
             )
             else coalesce(
               new.error, 'The Skill failed without an error summary.'
             ) end, 1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         task.completed_at, task.completed_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'issue'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_issue_messages root
      where root.id = proposal.thread_root_message_id
        and root.project_id = proposal.project_id
        and root.run_id = proposal.conversation_run_id
    )
  on conflict (id) do update set
    body = excluded.body,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  
  
  
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, message.id,
         iif(root.author_user_id = subscription.user_id,
             'thread_reply', 'subscription'),
         message.created_at
  from briar_agent_skill_execution_proposals proposal
  join briar_channel_messages message
    on message.id = proposal.result_message_id
   and message.channel_id = proposal.channel_id
  join briar_channel_thread_subscriptions subscription
    on subscription.root_message_id = proposal.thread_root_message_id
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = proposal.channel_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'channel'
    and (message.author_user_id is null
         or message.author_user_id <> subscription.user_id)
    and julianday(message.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do update set
    organization_id = excluded.organization_id,
    notification_reason = excluded.notification_reason,
    created_at = excluded.created_at;

  insert into briar_agent_skill_execution_realtime_outbox (
    task_id, organization_id, project_id, source_kind,
    channel_cursor, project_cursor, session_version, updated_at
  )
  select new.id, proposal.organization_id, proposal.project_id,
         proposal.source_kind,
         case when proposal.source_kind = 'channel'
           then coalesce(channel_state.current_version, 0) else null end,
         case when proposal.source_kind = 'issue'
           then coalesce(project_state.current_version, 0) else null end,
         coalesce(session_state.current_version, 0),
         task.updated_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  left join briar_channel_sync_state channel_state
    on channel_state.organization_id = proposal.organization_id
  left join briar_dashboard_sync_state project_state
    on project_state.project_id = proposal.project_id
  left join briar_project_agent_session_sync_state session_state
    on session_state.project_id = proposal.project_id
  where proposal.id = new.skill_execution_proposal_id
  on conflict (task_id) do update set
    channel_cursor = case when excluded.source_kind = 'channel' then max(
        coalesce(briar_agent_skill_execution_realtime_outbox.channel_cursor, 0),
        excluded.channel_cursor
      ) else null end,
    project_cursor = case when excluded.source_kind = 'issue' then max(
        coalesce(briar_agent_skill_execution_realtime_outbox.project_cursor, 0),
        excluded.project_cursor
      ) else null end,
    session_version = max(
      briar_agent_skill_execution_realtime_outbox.session_version,
      excluded.session_version
    ),
    updated_at = excluded.updated_at;
end;
-- @statement
CREATE TRIGGER briar_channel_changes_channels_update_sync
after update on briar_channels
when old.memory_roster_epoch = new.memory_roster_epoch
  or old.id is not new.id
  or old.organization_id is not new.organization_id
  or old.slug is not new.slug
  or old.name is not new.name
  or old.topic is not new.topic
  or old.visibility is not new.visibility
  or old.default_project_id is not new.default_project_id
  or old.created_by_user_id is not new.created_by_user_id
  or old.archived_at is not new.archived_at
  or old.created_at is not new.created_at
  or old.updated_at is not new.updated_at
  or old.kind is not new.kind
  or old.dm_key is not new.dm_key
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.id, 'channel', new.id, 'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_channel_changes_messages_update_sync
after update on briar_channel_messages
when old.memory_source_version = new.memory_source_version
  or old.id is not new.id
  or old.channel_id is not new.channel_id
  or old.parent_message_id is not new.parent_message_id
  or old.author_user_id is not new.author_user_id
  or old.author_agent_id is not new.author_agent_id
  or old.author_agent_name is not new.author_agent_name
  or old.author_agent_provider is not new.author_agent_provider
  or old.author_webhook_id is not new.author_webhook_id
  or old.author_webhook_name is not new.author_webhook_name
  or old.webhook_event_id is not new.webhook_event_id
  or old.body is not new.body
  or old.created_at is not new.created_at
  or old.updated_at is not new.updated_at
  or old.blocks_json is not new.blocks_json
  or old.deleted_at is not new.deleted_at
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'message', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dm_memory_close_roster
after update of memory_roster_epoch on briar_channels
when old.memory_roster_epoch <> new.memory_roster_epoch
begin
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where channel_id = new.id and status = 'active';
end;
-- @statement
CREATE TRIGGER briar_dm_memory_member_added after insert on briar_channel_members begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.channel_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_member_removed after delete on briar_channel_members begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = old.channel_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_agent_added after insert on briar_channel_agents begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.channel_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_agent_removed after delete on briar_channel_agents begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = old.channel_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_member_replaced after update of channel_id, user_id on briar_channel_members
when old.channel_id <> new.channel_id or old.user_id <> new.user_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (old.channel_id, new.channel_id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_agent_replaced after update of channel_id, agent_id on briar_channel_agents
when old.channel_id <> new.channel_id or old.agent_id <> new.agent_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (old.channel_id, new.channel_id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_agent_scope_changed
after update of project_id, organization_id on briar_project_agents
when old.project_id is not new.project_id or old.organization_id <> new.organization_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (select channel_id from briar_channel_agents where agent_id = new.id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_channel_changed after update of kind, archived_at on briar_channels
when old.kind <> new.kind or old.archived_at is not new.archived_at begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_channel_deleted before delete on briar_channels begin
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where channel_id = old.id and status = 'active';
end;
-- @statement
CREATE TRIGGER briar_dm_memory_owner_removed before delete on briar_organization_members begin
  
  
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where organization_id = old.organization_id and id in (
    select channel_id from briar_channel_members where user_id = old.user_id
  );
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where organization_id = old.organization_id and owner_user_id = old.user_id and status = 'active';
end;
-- @statement
CREATE TRIGGER briar_dm_memory_role_changed after update of role on briar_organization_members
when old.role <> new.role begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where organization_id = new.organization_id and owner_user_id = new.user_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_project_access_removed before delete on briar_project_members begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where owner_user_id = old.user_id and agent_id in (
    select id from briar_project_agents where project_id = old.project_id
  );
end;
-- @statement
CREATE TRIGGER briar_dm_memory_cancel_revoked after update of revocation_epoch on briar_dm_memory_spaces
when old.revocation_epoch <> new.revocation_epoch begin
  update briar_dm_memory_jobs set status = 'cancelled', input_json = null,
    lease_token_hash = null, lease_expires_at = null, error_code = 'scope_revoked'
  where space_id = new.id and kind in ('extract', 'consolidate', 'explicit_request')
    and status in ('pending', 'running', 'retry_wait');
end;
-- @statement
CREATE TRIGGER briar_dm_memory_message_changed
after update of body, deleted_at on briar_channel_messages
when old.body <> new.body or old.deleted_at is not new.deleted_at
begin
  update briar_channel_messages set memory_source_version = old.memory_source_version + 1
  where id = new.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = new.id);
  update briar_dm_memory_documents set status = 'invalidated'
  where status = 'active' and id in (select document_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = new.id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_message_deleted before delete on briar_channel_messages begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
  update briar_dm_memory_documents set status = 'invalidated'
  where status = 'active' and id in (select document_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_chunk_purge after delete on briar_dm_memory_chunks
begin
  update briar_dm_memory_vectors set state = 'purging', delete_mutation_id = null,
    confirmed_at = null, available_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    lease_token = null, lease_expires_at = null, attempt = 0, error_code = null
    where id = old.vector_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_document_projection_update
after update of current_version, status, conflicted, expired_version on briar_dm_memory_documents
begin
  delete from briar_dm_memory_chunks where document_id = new.id
    and (document_version <> new.current_version or new.status <> 'active'
      or new.expired_version = new.current_version);
  delete from briar_dm_memory_briefs where space_id = new.space_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_space_projection_update
after update of memory_revision, revocation_epoch, status on briar_dm_memory_spaces
begin
  delete from briar_dm_memory_briefs where space_id = new.id;
  delete from briar_dm_memory_chunks where space_id = new.id and new.status <> 'active';
end;
-- @statement
CREATE TRIGGER briar_dm_memory_expiry_epoch
after update of expired_version on briar_dm_memory_documents
when new.expired_version = new.current_version and old.expired_version <> new.expired_version
begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.space_id;
end;
-- @statement
CREATE TRIGGER briar_issue_hierarchy_validate_insert
before insert on briar_issue_parent_links BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs parent
    where parent.id = new.parent_run_id and parent.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs child
    where child.id = new.child_run_id and child.project_id = new.project_id
  ) then raise(abort, 'issue hierarchy endpoints must belong to the project') end;
  select case when exists (
    with recursive descendants(run_id) as (
      values (new.child_run_id)
      union
      select hierarchy.child_run_id
      from briar_issue_parent_links hierarchy
      join descendants on descendants.run_id = hierarchy.parent_run_id
      where hierarchy.project_id = new.project_id
    )
    select 1 from descendants where run_id = new.parent_run_id
  ) then raise(abort, 'issue hierarchy would create a cycle') end;
END;
-- @statement
CREATE TRIGGER briar_issue_hierarchy_validate_update
before update of project_id, parent_run_id, child_run_id
on briar_issue_parent_links BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs parent
    where parent.id = new.parent_run_id and parent.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs child
    where child.id = new.child_run_id and child.project_id = new.project_id
  ) then raise(abort, 'issue hierarchy endpoints must belong to the project') end;
  select case when exists (
    with recursive descendants(run_id) as (
      values (new.child_run_id)
      union
      select hierarchy.child_run_id
      from briar_issue_parent_links hierarchy
      join descendants on descendants.run_id = hierarchy.parent_run_id
      where hierarchy.project_id = new.project_id
        and hierarchy.child_run_id <> old.child_run_id
    )
    select 1 from descendants where run_id = new.parent_run_id
  ) then raise(abort, 'issue hierarchy would create a cycle') end;
END;
-- @statement
CREATE TRIGGER briar_issue_relations_validate_insert
before insert on briar_issue_relations BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs first_run
    where first_run.id = new.first_run_id
      and first_run.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs second_run
    where second_run.id = new.second_run_id
      and second_run.project_id = new.project_id
  ) then raise(abort, 'related issue endpoints must belong to the project') end;
END;
-- @statement
CREATE TRIGGER briar_issue_relations_validate_update
before update of project_id, first_run_id, second_run_id
on briar_issue_relations BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs first_run
    where first_run.id = new.first_run_id
      and first_run.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs second_run
    where second_run.id = new.second_run_id
      and second_run.project_id = new.project_id
  ) then raise(abort, 'related issue endpoints must belong to the project') end;
END;
-- @statement
CREATE TRIGGER briar_dashboard_hierarchy_insert_sync
after insert on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.parent_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_hierarchy_update_sync
after update on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.parent_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.child_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.parent_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_hierarchy_delete_sync
before delete on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.parent_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_relations_insert_sync
after insert on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.first_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_relations_update_sync
after update on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.first_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.second_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.first_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dashboard_relations_delete_sync
before delete on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.first_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
-- @statement
CREATE TRIGGER briar_dm_memory_reply_revoked
after update of revocation_epoch on briar_dm_memory_spaces
when old.revocation_epoch <> new.revocation_epoch begin
  insert or ignore into briar_dm_memory_activity_revocations
    (id, organization_id, channel_id, agent_id, trigger_message_id, parent_message_id, attempts)
    select job.id, job.organization_id, job.channel_id, job.agent_id, job.trigger_message_id, job.parent_message_id, job.attempts
    from briar_channel_agent_reply_jobs job join briar_dm_memory_reply_fences fence on fence.job_id = job.id
    where job.status = 'running' and fence.space_id = new.id;

  update briar_channel_reply_sessions set conversation_id = null,
    memory_revocation_epoch = null
    where memory_space_id = new.id;
  update briar_channel_agent_reply_jobs set status = 'queued',
    claim_token_hash = null, claimed_at = null, lease_expires_at = null,
    planned_update_resume = 0, memory_restart_count = memory_restart_count + 1, error = null
    where status = 'running' and id in (
      select job_id from briar_dm_memory_reply_fences where space_id = new.id
    );
  delete from briar_channel_reply_lookups where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = new.id
  );
  delete from briar_dm_memory_discovered_refs where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = new.id
  );
end;
-- @statement
CREATE TRIGGER briar_dm_memory_reply_space_deleted before delete on briar_dm_memory_spaces begin
  insert or ignore into briar_dm_memory_activity_revocations
    (id, organization_id, channel_id, agent_id, trigger_message_id, parent_message_id, attempts)
    select job.id, job.organization_id, job.channel_id, job.agent_id, job.trigger_message_id, job.parent_message_id, job.attempts
    from briar_channel_agent_reply_jobs job join briar_dm_memory_reply_fences fence on fence.job_id = job.id
    where job.status = 'running' and fence.space_id = old.id;

  update briar_channel_reply_sessions set conversation_id = null,
    memory_revocation_epoch = null where memory_space_id = old.id;
  update briar_channel_agent_reply_jobs set status = 'queued',
    claim_token_hash = null, claimed_at = null, lease_expires_at = null,
    planned_update_resume = 0, memory_restart_count = memory_restart_count + 1, error = null
    where status = 'running' and id in (
      select job_id from briar_dm_memory_reply_fences where space_id = old.id
    );
  delete from briar_channel_reply_lookups where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = old.id
  );
  delete from briar_dm_memory_discovered_refs where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = old.id
  );
end;
-- @statement
CREATE TRIGGER briar_dm_memory_lookup_revision_changed after update of memory_revision on briar_dm_memory_spaces
when old.memory_revision <> new.memory_revision begin
  update briar_channel_reply_lookups set response_json = null
    where job_id in (select job_id from briar_dm_memory_reply_fences where space_id = new.id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_lookup_claim_ended after update of status on briar_channel_agent_reply_jobs
when old.status = 'running' and new.status <> 'running' begin
  delete from briar_channel_reply_lookups where job_id = new.id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_citations_forgotten after update of status on briar_dm_memory_documents
when new.status = 'deleted' begin
  delete from briar_dm_memory_reply_citations where document_id = new.id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_invalidate_derived_versions after update of current_version, expired_version on briar_dm_memory_documents
when old.current_version <> new.current_version or
  (old.expired_version <> new.expired_version and new.expired_version = new.current_version) begin
  update briar_dm_memory_documents set status = 'invalidated' where status = 'active' and id in (
    with recursive affected(id) as (
      select link.document_id from briar_dm_memory_document_links link
      join briar_dm_memory_documents current on current.id = link.document_id and current.current_version = link.document_version
      where link.source_document_id = new.id and
        (link.source_document_version <> new.current_version or new.expired_version = new.current_version)
      union select link.document_id from briar_dm_memory_document_links link join affected on link.source_document_id = affected.id
        join briar_dm_memory_documents current on current.id = link.document_id and current.current_version = link.document_version
    ) select id from affected where id <> new.id
  );
end;
-- @statement
CREATE TRIGGER briar_dm_memory_capture_message after insert on briar_channel_messages begin
  insert into briar_dm_memory_source_events(space_id, message_id, created_at)
  select space.id, new.id, new.created_at from briar_dm_memory_spaces space
  join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
    and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
    and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
  where space.channel_id = new.channel_id and space.status = 'active'
    and space.use_enabled = 1 and space.auto_enabled = 1 and new.deleted_at is null
    and julianday(new.created_at) >= julianday(space.auto_enabled_at)
    and (new.author_user_id = space.owner_user_id or new.author_agent_id = space.agent_id)
  on conflict (space_id, message_id) do nothing;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_capture_observation after insert on briar_dm_memory_revisions begin
  insert into briar_dm_memory_observation_events(space_id, document_id, document_version, created_at)
  select new.space_id, new.document_id, new.version, new.created_at
  from briar_dm_memory_documents doc where doc.id = new.document_id and doc.kind = 'observation' and new.version = 1
  on conflict (document_id, document_version) do nothing;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_begin_opt_in after update of auto_enabled on briar_dm_memory_spaces
when old.auto_enabled = 0 and new.auto_enabled = 1 begin
  insert into briar_dm_memory_learning_state(space_id, updated_at) values (new.id, new.updated_at)
  on conflict (space_id) do nothing;
  update briar_dm_memory_learning_state set
    source_watermark = coalesce((select max(sequence) from briar_dm_memory_source_events where space_id = new.id), 0),
    observation_watermark = coalesce((select max(sequence) from briar_dm_memory_observation_events where space_id = new.id), 0),
    updated_at = new.updated_at where space_id = new.id;
  update briar_dm_memory_learning_outbox set settled = 1 where space_id = new.id and kind = 'extract';
end;
-- @statement
CREATE TRIGGER briar_dm_memory_learning_cancel after update of status on briar_dm_memory_jobs
when new.kind in ('extract', 'explicit_request', 'consolidate') and new.status = 'cancelled' begin
  update briar_dm_memory_jobs set input_json = null, input_hash = null,
    lease_token_hash = null, lease_expires_at = null, result_json = null where id = new.id;
  update briar_dm_memory_proposals set proposal_json = null, normalized_json = null,
    status = 'cancelled', terminal_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where job_id = new.id;
  update briar_dm_memory_verifications set decisions_json = null where job_id = new.id;
  update briar_dm_memory_model_calls set status = 'failed', error_code = 'scope_revoked',
    completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where job_id = new.id and status = 'reserved';
end;
-- @statement
CREATE TRIGGER briar_dm_memory_purge_learning_payload after insert on briar_dm_memory_learning_payload_purges begin
  update briar_dm_memory_jobs set input_json = null, input_hash = null, result_json = null,
    status = case when status in ('pending', 'running', 'retry_wait') then 'cancelled' else status end,
    lease_token_hash = null, lease_expires_at = null
  where id in (select job_id from briar_dm_memory_learning_inputs
    where space_id = new.space_id and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_proposals set input_hash = null, proposal_hash = null,
    proposal_json = null, normalized_json = null where job_id in (
      select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
        and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_verifications set input_hash = null, proposal_hash = null,
    decisions_json = null where job_id in (
      select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
        and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_model_calls set input_hash = null, proposal_hash = null where job_id in (
    select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
      and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_learning_commits set proposal_hash = null where job_id in (
    select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
      and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_commits set payload_hash = null where id in (
    select commit_id from briar_dm_memory_learning_commits where job_id in (
      select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
        and source_type = new.source_type and source_id = new.source_id));
  update briar_dm_memory_learning_inputs set source_hash = null where space_id = new.space_id
    and source_type = new.source_type and source_id = new.source_id;
  delete from briar_dm_memory_learning_payload_purges where space_id = new.space_id
    and source_type = new.source_type and source_id = new.source_id;
end;
-- @statement
CREATE TRIGGER briar_dm_memory_forget_learning_payload after insert on briar_dm_memory_exclusions begin
  insert into briar_dm_memory_purge_documents(space_id, root_document_id, document_id)
  select new.space_id, new.document_id, source.document_id from briar_dm_memory_sources source
  where source.space_id = new.space_id and source.source_type = new.source_type and source.source_id = new.source_id
  on conflict (root_document_id, document_id) do nothing;
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  values (new.space_id, new.source_type, new.source_id);
  update briar_dm_memory_jobs set request_targets_json = '[]' where space_id = new.space_id
    and exists (select 1 from json_each(request_targets_json) target
      where json_extract(target.value, '$.documentId') in (
        select document_id from briar_dm_memory_purge_documents where space_id = new.space_id));
end;
-- @statement
CREATE TRIGGER briar_dm_memory_edit_learning_source after update of body, deleted_at on briar_channel_messages
when old.body <> new.body or old.deleted_at is not new.deleted_at begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', new.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = new.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = new.id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_delete_learning_source before delete on briar_channel_messages begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', old.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = old.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = old.id);
end;
-- @statement
CREATE TRIGGER briar_dm_memory_forget_derived_content after update of revocation_epoch on briar_dm_memory_spaces
when old.revocation_epoch <> new.revocation_epoch begin
  update briar_dm_memory_documents set status = 'deleted', title = '[deleted]'
  where space_id = new.id and id in (select source.document_id from briar_dm_memory_sources source
    join briar_dm_memory_exclusions excluded on excluded.space_id = source.space_id
      and excluded.source_type = source.source_type and excluded.source_id = source.source_id
    where source.space_id = new.id);
  update briar_dm_memory_commits set payload_hash = null where document_id in (
    select id from briar_dm_memory_documents where space_id = new.id and status = 'deleted');
  delete from briar_dm_memory_revisions where document_id in (
    select id from briar_dm_memory_documents where space_id = new.id and status = 'deleted');
end;
-- @statement
CREATE TRIGGER briar_reply_completion_receipt_insert_guard
before insert on briar_reply_completion_receipts
when not (
  (
    new.reply_kind = 'issue'
    and exists (
      select 1
      from briar_issue_agent_reply_jobs job
      join briar_projects project on project.id = job.project_id
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.project_id = job.project_id
      where job.id = new.work_id and job.project_id = new.project_id
        and job.run_id = new.run_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.claim_token_hash = new.claim_token_hash
        and (
          (new.outcome_kind = 'success'
            and new.disposition = 'completed'
            and job.status = 'completed'
            and job.completed_at = new.created_at)
          or
          (new.outcome_kind = 'failure'
            and job.updated_at = new.created_at
            and (
              (job.attempts < 3 and new.disposition = 'requeued'
                and job.status = 'queued')
              or
              (job.attempts >= 3 and new.disposition = 'failed'
                and job.status = 'failed')
            ))
        )
    )
  )
  or
  (
    new.reply_kind = 'channel'
    and exists (
      select 1
      from briar_channel_agent_reply_jobs job
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.device_id = job.claimed_device_id
      join briar_projects project on project.id = worker.project_id
      where job.id = new.work_id and job.channel_id = new.run_id
        and job.organization_id = new.organization_id
        and project.id = new.project_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.claim_token_hash = new.claim_token_hash
        and (
          (new.outcome_kind = 'success'
            and new.disposition = 'completed'
            and job.status = 'completed'
            and job.completed_at = new.created_at)
          or
          (new.outcome_kind = 'failure'
            and job.updated_at = new.created_at
            and (
              (job.attempts < 3 and new.disposition = 'requeued'
                and job.status = 'queued')
              or
              (job.attempts >= 3 and new.disposition = 'failed'
                and job.status = 'failed')
            ))
        )
    )
  )
)
begin
  select raise(abort, 'invalid reply completion receipt');
end;
-- @statement
CREATE TRIGGER briar_reply_completion_receipt_immutable_update
before update on briar_reply_completion_receipts
begin
  select raise(abort, 'reply completion receipt is immutable');
end;
-- @statement
CREATE TRIGGER briar_reply_completion_receipt_immutable_delete
before delete on briar_reply_completion_receipts
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
begin
  select raise(abort, 'reply completion receipt is immutable');
end;
-- @statement
CREATE TRIGGER briar_channel_message_mutation_receipt_insert_guard
before insert on briar_channel_message_mutation_receipts
when not exists (
  select 1 from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id and message.channel_id = new.channel_id
    and message.author_user_id = new.user_id
    and channel.organization_id = new.organization_id
)
begin
  select raise(abort, 'invalid channel message receipt');
end;
-- @statement
CREATE TRIGGER briar_channel_message_mutation_receipt_immutable
before update on briar_channel_message_mutation_receipts
begin
  select raise(abort, 'channel message receipt is immutable');
end;
-- @statement
CREATE TRIGGER briar_upload_batch_insert_guard
before insert on briar_upload_batches
when not (
  (
    new.purpose = 'issue_reply'
    and new.channel_id is null and new.user_id is null
    and exists (
      select 1
      from briar_issue_agent_reply_jobs job
      join briar_projects project on project.id = job.project_id
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.project_id = job.project_id
      where job.id = new.work_id and job.project_id = new.project_id
        and job.run_id = new.run_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.status = 'running'
        and job.claim_token_hash = new.claim_token_hash
        and job.lease_expires_at > new.created_at
        and new.expires_at <= job.lease_expires_at
    )
  )
  or
  (
    new.purpose = 'channel_reply'
    and new.channel_id is null and new.user_id is null
    and exists (
      select 1
      from briar_channel_agent_reply_jobs job
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.device_id = job.claimed_device_id
      join briar_projects project on project.id = worker.project_id
      where job.id = new.work_id and job.channel_id = new.run_id
        and job.organization_id = new.organization_id
        and project.id = new.project_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.status = 'running'
        and job.claim_token_hash = new.claim_token_hash
        and job.lease_expires_at > new.created_at
        and new.expires_at <= job.lease_expires_at
    )
  )
  or
  (
    new.purpose = 'run_evidence'
    and new.channel_id is null and new.user_id is null
    and new.work_id = new.run_id
    and exists (
      select 1
      from briar_hunt_runs run
      join briar_projects project on project.id = run.project_id
      where run.id = new.run_id and run.project_id = new.project_id
        and project.organization_id = new.organization_id
        and run.claim_token_hash = new.claim_token_hash
        and run.lease_expires_at > new.created_at
        and new.expires_at <= run.lease_expires_at
        and run.status not in ('completed', 'cancelled', 'blocked', 'failed')
    )
  )
  or
  (
    new.purpose = 'channel_message'
    and new.project_id is null and new.run_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.channel_id is not null and new.user_id is not null
    and new.work_id is not null
    and exists (
      select 1
      from briar_channels channel
      join briar_organization_members membership
        on membership.organization_id = channel.organization_id
       and membership.user_id = new.user_id
      where channel.id = new.channel_id
        and channel.organization_id = new.organization_id
        and channel.archived_at is null
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          channel.visibility = 'public'
          or exists (
            select 1 from briar_channel_members member
            where member.channel_id = channel.id
              and member.user_id = new.user_id
          )
        )
    )
  )
  or
  (
    new.purpose = 'issue_create'
    and new.channel_id is null and new.run_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.project_id is not null and new.user_id is not null
    and new.work_id is not null
    and exists (
      select 1
      from briar_projects project
      join briar_organization_members membership
        on membership.organization_id = project.organization_id
       and membership.user_id = new.user_id
      where project.id = new.project_id
        and project.organization_id = new.organization_id
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          membership.role in ('owner', 'co-owner')
          or exists (
            select 1 from briar_project_members project_member
            where project_member.project_id = project.id
              and project_member.organization_id = project.organization_id
              and project_member.user_id = new.user_id
          )
        )
    )
  )
  or
  (
    new.purpose = 'issue_update'
    and new.channel_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.project_id is not null and new.user_id is not null
    and new.work_id is not null and new.run_id is not null
    and exists (
      select 1
      from briar_hunt_runs run
      join briar_projects project on project.id = run.project_id
      join briar_organization_members membership
        on membership.organization_id = project.organization_id
       and membership.user_id = new.user_id
      where run.id = new.run_id and run.project_id = new.project_id
        and project.organization_id = new.organization_id
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          membership.role in ('owner', 'co-owner')
          or exists (
            select 1 from briar_project_members project_member
            where project_member.project_id = project.id
              and project_member.organization_id = project.organization_id
              and project_member.user_id = new.user_id
          )
        )
    )
  )
  or
  (
    new.purpose = 'issue_message'
    and new.channel_id is null
    and new.worker_id is null and new.device_id is null
    and new.claim_token_hash is null
    and new.project_id is not null and new.user_id is not null
    and new.work_id is not null and new.run_id is not null
    and exists (
      select 1
      from briar_hunt_runs run
      join briar_projects project on project.id = run.project_id
      join briar_organization_members membership
        on membership.organization_id = project.organization_id
       and membership.user_id = new.user_id
      where run.id = new.run_id and run.project_id = new.project_id
        and project.organization_id = new.organization_id
        and membership.role in ('owner', 'co-owner', 'developer', 'editor')
        and (
          membership.role in ('owner', 'co-owner')
          or exists (
            select 1 from briar_project_members project_member
            where project_member.project_id = project.id
              and project_member.organization_id = project.organization_id
              and project_member.user_id = new.user_id
          )
        )
    )
  )
)
begin
  select raise(abort, 'invalid upload authorization');
end;
-- @statement
CREATE TRIGGER briar_upload_batch_immutable
before update on briar_upload_batches
begin
  select raise(abort, 'upload batch is immutable');
end;
-- @statement
CREATE TRIGGER briar_upload_metadata_immutable
before update on briar_uploads
when new.upload_id is not old.upload_id
  or new.batch_request_id is not old.batch_request_id
  or new.client_id is not old.client_id
  or new.position is not old.position
  or new.filename is not old.filename
  or new.content_type is not old.content_type
  or new.byte_size is not old.byte_size
  or new.sha256 is not old.sha256
  or new.object_key is not old.object_key
  or old.consumed_at is not null
  or (old.uploaded_at is not null and new.uploaded_at is not old.uploaded_at)
begin
  select raise(abort, 'upload metadata is immutable');
end;
-- @statement
CREATE TRIGGER briar_issue_create_mutation_receipt_insert_guard
before insert on briar_issue_create_mutation_receipts
when exists (
    select 1 from json_each(new.attachment_upload_ids_json)
    where type != 'text'
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(distinct value)
    from json_each(new.attachment_upload_ids_json)
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(*)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    join briar_issue_attachments attachment
      on attachment.id = upload.upload_id
     and attachment.project_id = new.project_id
     and attachment.run_id = new.client_issue_id
    where batch.purpose = 'issue_create'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.channel_id is null
      and batch.user_id = new.user_id
      and batch.work_id = new.client_issue_id
      and batch.run_id is null
      and batch.worker_id is null and batch.device_id is null
      and batch.claim_token_hash is null
      and batch.expires_at > new.created_at
      and upload.uploaded_at is not null and upload.consumed_at is null
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
      and attachment.object_key = upload.object_key
      and attachment.filename = upload.filename
      and attachment.content_type = upload.content_type
      and attachment.byte_size = upload.byte_size
  )
  or 1 < (
    select count(distinct upload.batch_request_id)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    where batch.purpose = 'issue_create'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.user_id = new.user_id
      and batch.work_id = new.client_issue_id
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
  )
  or not exists (
    select 1
    from briar_hunt_runs run
    join briar_projects project on project.id = run.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = new.user_id
    where run.id = new.client_issue_id and run.project_id = new.project_id
      and run.created_by_user_id = new.user_id
      and project.organization_id = new.organization_id
      and membership.role in ('owner', 'co-owner', 'developer', 'editor')
      and (
        membership.role in ('owner', 'co-owner')
        or exists (
          select 1 from briar_project_members project_member
          where project_member.project_id = project.id
            and project_member.organization_id = project.organization_id
            and project_member.user_id = new.user_id
        )
      )
  )
begin
  select raise(abort, 'invalid issue create receipt');
end;
-- @statement
CREATE TRIGGER briar_issue_update_mutation_receipt_insert_guard
before insert on briar_issue_update_mutation_receipts
when exists (
    select 1 from json_each(new.attachment_upload_ids_json)
    where type != 'text'
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(distinct value)
    from json_each(new.attachment_upload_ids_json)
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(*)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    join briar_issue_attachments attachment
      on attachment.id = upload.upload_id
     and attachment.project_id = new.project_id
     and attachment.run_id = new.run_id
    where batch.purpose = 'issue_update'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.channel_id is null
      and batch.user_id = new.user_id
      and batch.work_id = new.request_id
      and batch.run_id = new.run_id
      and batch.worker_id is null and batch.device_id is null
      and batch.claim_token_hash is null
      and batch.expires_at > new.created_at
      and upload.uploaded_at is not null and upload.consumed_at is null
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
      and attachment.object_key = upload.object_key
      and attachment.filename = upload.filename
      and attachment.content_type = upload.content_type
      and attachment.byte_size = upload.byte_size
  )
  or 1 < (
    select count(distinct upload.batch_request_id)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    where batch.purpose = 'issue_update'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.user_id = new.user_id
      and batch.work_id = new.request_id
      and batch.run_id = new.run_id
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
  )
  or not exists (
    select 1
    from briar_hunt_runs run
    join briar_projects project on project.id = run.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = new.user_id
    where run.id = new.run_id and run.project_id = new.project_id
      and project.organization_id = new.organization_id
      and membership.role in ('owner', 'co-owner', 'developer', 'editor')
      and (
        membership.role in ('owner', 'co-owner')
        or exists (
          select 1 from briar_project_members project_member
          where project_member.project_id = project.id
            and project_member.organization_id = project.organization_id
            and project_member.user_id = new.user_id
        )
      )
  )
begin
  select raise(abort, 'invalid issue update receipt');
end;
-- @statement
CREATE TRIGGER briar_issue_message_mutation_receipt_insert_guard
before insert on briar_issue_message_mutation_receipts
when exists (
    select 1 from json_each(new.attachment_upload_ids_json)
    where type != 'text'
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(distinct value)
    from json_each(new.attachment_upload_ids_json)
  )
  or json_array_length(new.attachment_upload_ids_json) != (
    select count(*)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    join briar_issue_attachments attachment
      on attachment.id = upload.upload_id
     and attachment.project_id = new.project_id
     and attachment.run_id = new.run_id
    where batch.purpose = 'issue_message'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.channel_id is null
      and batch.user_id = new.user_id
      and batch.work_id = new.message_id
      and batch.run_id = new.run_id
      and batch.worker_id is null and batch.device_id is null
      and batch.claim_token_hash is null
      and batch.expires_at > new.created_at
      and upload.uploaded_at is not null and upload.consumed_at is null
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
      and attachment.object_key = upload.object_key
      and attachment.filename = upload.filename
      and attachment.content_type = upload.content_type
      and attachment.byte_size = upload.byte_size
  )
  or 1 < (
    select count(distinct upload.batch_request_id)
    from briar_uploads upload
    join briar_upload_batches batch
      on batch.request_id = upload.batch_request_id
    where batch.purpose = 'issue_message'
      and batch.organization_id = new.organization_id
      and batch.project_id = new.project_id
      and batch.user_id = new.user_id
      and batch.work_id = new.message_id
      and batch.run_id = new.run_id
      and exists (
        select 1 from json_each(new.attachment_upload_ids_json) expected
        where expected.value = upload.upload_id
      )
  )
  or not exists (
    select 1
    from briar_issue_messages message
    join briar_hunt_runs run
      on run.id = message.run_id and run.project_id = message.project_id
    join briar_projects project on project.id = run.project_id
    join briar_organization_members membership
      on membership.organization_id = project.organization_id
     and membership.user_id = new.user_id
    where message.id = new.message_id
      and message.project_id = new.project_id and message.run_id = new.run_id
      and project.organization_id = new.organization_id
      and membership.role in ('owner', 'co-owner', 'developer', 'editor')
      and (
        membership.role in ('owner', 'co-owner')
        or exists (
          select 1 from briar_project_members project_member
          where project_member.project_id = project.id
            and project_member.organization_id = project.organization_id
            and project_member.user_id = new.user_id
        )
      )
  )
begin
  select raise(abort, 'invalid issue message receipt');
end;
-- @statement
CREATE TRIGGER briar_issue_create_mutation_receipt_immutable
before update on briar_issue_create_mutation_receipts
begin
  select raise(abort, 'issue create receipt is immutable');
end;
-- @statement
CREATE TRIGGER briar_issue_update_mutation_receipt_immutable
before update on briar_issue_update_mutation_receipts
begin
  select raise(abort, 'issue update receipt is immutable');
end;
-- @statement
CREATE TRIGGER briar_issue_message_mutation_receipt_immutable
before update on briar_issue_message_mutation_receipts
begin
  select raise(abort, 'issue message receipt is immutable');
end;
-- @statement
CREATE TRIGGER briar_upload_state_guard
before update on briar_uploads
when not (
  (
    old.uploaded_at is null and new.uploaded_at is not null
    and new.consumed_at is null
    and new.consumer_kind is null and new.consumer_id is null
    and exists (
      select 1 from briar_upload_batches batch
      where batch.request_id = old.batch_request_id
        and batch.expires_at > new.uploaded_at
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'reply_completion'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_reply_completion_receipts receipt
        on receipt.request_id = new.consumer_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = receipt.reply_kind || '_reply'
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.work_id = receipt.work_id
        and batch.run_id = receipt.run_id
        and batch.worker_id = receipt.worker_id
        and batch.device_id = receipt.device_id
        and batch.claim_token_hash = receipt.claim_token_hash
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'run_evidence'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_run_evidence evidence on evidence.id = new.consumer_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'run_evidence'
        and batch.project_id = evidence.project_id
        and batch.run_id = evidence.run_id
        and exists (
          select 1 from json_each(evidence.image_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'channel_message'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_channel_message_mutation_receipts receipt
        on receipt.message_id = new.consumer_id
      join briar_channel_message_attachments attachment
        on attachment.id = old.upload_id
       and attachment.message_id = receipt.message_id
       and attachment.channel_id = receipt.channel_id
       and attachment.organization_id = receipt.organization_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'channel_message'
        and batch.organization_id = receipt.organization_id
        and batch.channel_id = receipt.channel_id
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.message_id
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'issue_create'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_issue_create_mutation_receipts receipt
        on receipt.client_issue_id = new.consumer_id
      join briar_issue_attachments attachment
        on attachment.id = old.upload_id
       and attachment.run_id = receipt.client_issue_id
       and attachment.project_id = receipt.project_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'issue_create'
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.channel_id is null
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.client_issue_id
        and batch.run_id is null
        and exists (
          select 1
          from json_each(receipt.attachment_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'issue_update'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_issue_update_mutation_receipts receipt
        on receipt.request_id = new.consumer_id
      join briar_issue_attachments attachment
        on attachment.id = old.upload_id
       and attachment.run_id = receipt.run_id
       and attachment.project_id = receipt.project_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'issue_update'
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.channel_id is null
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.request_id
        and batch.run_id = receipt.run_id
        and exists (
          select 1
          from json_each(receipt.attachment_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
    )
  )
  or
  (
    old.uploaded_at is not null and new.uploaded_at is old.uploaded_at
    and old.consumed_at is null and new.consumed_at is not null
    and new.consumer_kind = 'issue_message'
    and exists (
      select 1
      from briar_upload_batches batch
      join briar_issue_message_mutation_receipts receipt
        on receipt.message_id = new.consumer_id
      join briar_issue_attachments attachment
        on attachment.id = old.upload_id
       and attachment.run_id = receipt.run_id
       and attachment.project_id = receipt.project_id
      where batch.request_id = old.batch_request_id
        and batch.purpose = 'issue_message'
        and batch.organization_id = receipt.organization_id
        and batch.project_id = receipt.project_id
        and batch.channel_id is null
        and batch.user_id = receipt.user_id
        and batch.work_id = receipt.message_id
        and batch.run_id = receipt.run_id
        and exists (
          select 1
          from json_each(receipt.attachment_upload_ids_json) expected
          where expected.value = old.upload_id
        )
        and batch.expires_at > new.consumed_at
        and receipt.created_at = new.consumed_at
        and attachment.object_key = old.object_key
        and attachment.filename = old.filename
        and attachment.content_type = old.content_type
        and attachment.byte_size = old.byte_size
    )
  )
)
begin
  select raise(abort, 'invalid upload state transition');
end;
-- @statement
CREATE TRIGGER briar_upload_delete_cleanup
before delete on briar_uploads
when old.consumed_at is null
begin
  insert into briar_upload_cleanup_queue (
    object_key, batch_request_id, queued_at, next_attempt_at
  ) values (
    old.object_key,
    old.batch_request_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) on conflict (object_key) do nothing;
end;
-- @statement
CREATE TRIGGER briar_project_agent_schedule_creator_immutable
before update of created_by_user_id on briar_project_agent_schedules
when new.created_by_user_id is not old.created_by_user_id
  and not (
    old.created_by_user_id is not null
    and new.created_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.created_by_user_id
    )
  )
begin
  select raise(abort, 'Agent schedule creator is immutable');
end;
-- @statement
CREATE TRIGGER briar_archive_related_object_keys_insert_guard
before insert on briar_log_archives
when exists (
  select 1 from json_each(new.related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
)
begin
  select raise(abort, 'invalid archive related object key');
end;
-- @statement
CREATE TRIGGER briar_archive_related_object_keys_update_guard
before update of related_object_keys_json on briar_log_archives
when exists (
  select 1 from json_each(new.related_object_keys_json) related
  where related.type <> 'text'
    or related.value <> trim(related.value)
    or length(related.value) not between 1 and 1024
)
begin
  select raise(abort, 'invalid archive related object key');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_channel_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
begin
  select raise(abort, 'channel issue proposal payload is immutable');
end;
-- @statement
CREATE TRIGGER briar_conversation_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_issue_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
begin
  select raise(abort, 'conversation issue proposal payload is immutable');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_proposal_current_insert_guard
before insert on briar_channel_action_proposals
when new.action_type = 'request_issue_create'
  and (
    json_type(new.payload_json, '$.issue.status') is not null
    or exists (
      select 1
      from json_each(new.payload_json, '$.batch.items') item
      where json_type(item.value, '$.issue.status') is not null
    )
  )
begin
  select raise(abort, 'channel issue proposal payload cannot include status');
end;
-- @statement
CREATE TRIGGER briar_conversation_issue_proposal_current_insert_guard
before insert on briar_issue_action_proposals
when new.action_type = 'request_issue_create'
  and json_type(new.payload_json, '$.issue.status') is not null
begin
  select raise(abort, 'conversation issue proposal payload cannot include status');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_batch_items_immutable_delete
before delete on briar_channel_issue_batch_items
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
begin
  select raise(abort, 'channel issue batch mapping is immutable');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_proposal_action_insert_guard
before insert on briar_channel_action_proposals
when new.action_type <> 'request_issue_create'
begin
  select raise(abort, 'channel proposals must create issues');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_proposal_action_update_guard
before update of action_type on briar_channel_action_proposals
when new.action_type <> 'request_issue_create'
begin
  select raise(abort, 'channel proposals must create issues');
end;
-- @statement
CREATE TRIGGER briar_channel_message_blocks_array_insert
before insert on briar_channel_messages
when new.blocks_json is not null
  and case
    when not json_valid(new.blocks_json) then 1
    when json_type(new.blocks_json) <> 'array' then 1
    when json_array_length(new.blocks_json) not between 1 and 50 then 1
    when length(cast(new.blocks_json as blob)) > 1048576 then 1
    else 0
  end
begin
  select raise(abort, 'channel message blocks must be a bounded JSON array');
end;
-- @statement
CREATE TRIGGER briar_channel_message_blocks_array_update
before update of blocks_json on briar_channel_messages
when new.blocks_json is not null
  and case
    when not json_valid(new.blocks_json) then 1
    when json_type(new.blocks_json) <> 'array' then 1
    when json_array_length(new.blocks_json) not between 1 and 50 then 1
    when length(cast(new.blocks_json as blob)) > 1048576 then 1
    else 0
  end
begin
  select raise(abort, 'channel message blocks must be a bounded JSON array');
end;
-- @statement
CREATE TRIGGER briar_workflow_checkpoint_storage_validate
instead of insert on briar_workflow_checkpoint_storage_validation
when not (
  new.owner in ('project', 'user', 'issue')
  and new.checkpoints_json is not null
  and
  json_valid(new.checkpoints_json)
  and case
        when json_valid(new.checkpoints_json)
          then json_type(new.checkpoints_json)
        else null
      end = 'array'
  and json_array_length(
        case
          when json_valid(new.checkpoints_json)
            then case
              when json_type(new.checkpoints_json) = 'array'
                then new.checkpoints_json
              else '[]'
            end
          else '[]'
        end
      ) <= 100
  and not exists (
    select 1
    from json_each(
      case
        when json_valid(new.checkpoints_json)
          then case
            when json_type(new.checkpoints_json) = 'array'
              then new.checkpoints_json
            else '[]'
          end
        else '[]'
      end
    ) checkpoint
    where checkpoint.type <> 'object'
       or (
         select count(*)
         from json_each(
           case when checkpoint.type = 'object'
             then checkpoint.value else '{}'
           end
         ) field
       ) <> 3
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.key'
       ) glob '*[^a-z0-9_-]*'
       or case new.owner
            when 'project' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'project-*'
            when 'user' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'user-*'
            when 'issue' then json_extract(
              case when checkpoint.type = 'object'
                then checkpoint.value else '{}'
              end,
              '$.key'
            ) not glob 'issue-*'
            else 1
          end
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), '') <> 'text'
       or length(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       )) not between 1 and 64
       or substr(json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ), 1, 1) not glob '[a-z]'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.stage'
       ) glob '*[^a-z0-9_-]*'
       or coalesce(json_type(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ), '') <> 'text'
       or json_extract(
         case when checkpoint.type = 'object'
           then checkpoint.value else '{}'
         end,
         '$.position'
       ) not in ('before', 'after')
  )
)
begin
  select raise(abort, 'workflow checkpoints must use the canonical shape');
end;
-- @statement
CREATE TRIGGER briar_project_mandatory_checkpoints_shape_insert
before insert on briar_project_settings
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('project', new.mandatory_checkpoints_json);
end;
-- @statement
CREATE TRIGGER briar_project_mandatory_checkpoints_shape_update
before update of mandatory_checkpoints_json on briar_project_settings
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('project', new.mandatory_checkpoints_json);
end;
-- @statement
CREATE TRIGGER briar_user_default_checkpoints_shape_insert
before insert on briar_user_workflow_checkpoint_defaults
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('user', new.checkpoints_json);
end;
-- @statement
CREATE TRIGGER briar_user_default_checkpoints_shape_update
before update of checkpoints_json on briar_user_workflow_checkpoint_defaults
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('user', new.checkpoints_json);
end;
-- @statement
CREATE TRIGGER briar_issue_checkpoints_shape_insert
before insert on briar_hunt_runs
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('issue', new.issue_checkpoints_json);
end;
-- @statement
CREATE TRIGGER briar_issue_checkpoints_shape_update
before update of issue_checkpoints_json on briar_hunt_runs
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('issue', new.issue_checkpoints_json);
end;
-- @statement
CREATE TRIGGER briar_execution_worker_runtime_insert_guard
after insert on briar_execution_workers
when exists (
  select 1 from briar_invalid_execution_worker_runtime invalid
  where invalid.id = new.id
)
begin
  select raise(abort, 'Worker runtime ProtoJSON is invalid');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_task_claim_guard
before update of claim_token_hash on briar_project_agent_task_jobs
when new.claim_token_hash is not null
  and new.claim_token_hash is not old.claim_token_hash
  and new.skill_execution_proposal_id is not null
  and not exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    join briar_project_agents agent
      on agent.id = approval.agent_id and agent.project_id = approval.project_id
     and agent.organization_id = approval.organization_id
    join briar_agent_skills skill
      on skill.id = approval.skill_id and skill.agent_id = approval.agent_id
    join briar_execution_workers worker
      on worker.id = new.claimed_worker_id
     and worker.project_id = approval.project_id
    join briar_execution_worker_devices device
      on device.id = worker.device_id
     and device.organization_id = approval.organization_id
    join briar_organization_members worker_owner
      on worker_owner.organization_id = device.organization_id
     and worker_owner.user_id = device.owner_user_id
    where approval.proposal_id = new.skill_execution_proposal_id
      and approval.project_id = new.project_id
      and approval.result_session_id = new.id
      and approval.agent_id = new.agent_id
      and approval.skill_id = new.skill_id
      and approval.request = new.request
      and approval.proposal_id = new.request_id
      and approval.worker_id = new.preferred_worker_id
      and approval.worker_id = new.claimed_worker_id
      and agent.name = approval.agent_name
      and agent.responsibility = approval.agent_responsibility
      and skill.name = approval.skill_name
      and skill.body = approval.skill_instructions
      and skill.kind = approval.skill_kind
      and skill.provider = approval.provider
      and skill.model is approval.model and skill.effort is approval.effort
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and exists (
        select 1
        from briar_execution_worker_healthy_providers healthy
        where healthy.worker_id = worker.id
          and healthy.provider = approval.provider
      )
      and (
        not exists (
          select 1 from briar_project_execution_worker_policies policy
          where policy.project_id = new.project_id
            and policy.selection_mode = 'allowlist'
        )
        or exists (
          select 1 from briar_project_execution_worker_allowlist allowed
          where allowed.project_id = new.project_id
            and allowed.worker_id = worker.id
        )
      )
      and (
        (select count(*)
         from briar_hunt_runs run
         join briar_execution_workers holder on holder.id = run.worker_id
         where holder.device_id = device.id
           and run.claim_token_hash is not null
           and run.lease_expires_at > new.claimed_at
           and run.status not in (
             'backlog', 'completed', 'cancelled', 'blocked', 'failed'
           ))
        +
        (select count(*)
         from briar_project_agent_task_jobs task
         join briar_execution_workers holder
           on holder.id = task.claimed_worker_id
         where holder.device_id = device.id and task.status = 'running'
           and task.lease_expires_at > new.claimed_at)
        < device.max_concurrent_sessions
      )
  )
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is missing or stale');
END;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_accept_guard
before update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted' and not (
  old.requested_worker_id is null and old.requested_worker_label is null
  and old.result_session_id is null
  and old.accepted_by_user_id is null and old.accepted_at is null
  and new.requested_worker_id is not null
  and new.requested_worker_label is not null
  and new.result_session_id is not null
  and new.accepted_by_user_id is not null and new.accepted_at is not null
  and new.updated_at = new.accepted_at
  and exists (
    select 1
    from briar_organization_members membership
    join briar_projects project
      on project.id = new.project_id
     and project.organization_id = membership.organization_id
    join briar_project_agents agent
      on agent.id = new.agent_id and agent.project_id = project.id
     and agent.organization_id = project.organization_id
    join briar_agent_skills skill
      on skill.id = new.skill_id and skill.agent_id = agent.id
    left join briar_channel_agent_reply_jobs conversation_source
      on new.execution_mode = 'conversation'
     and new.source_kind = 'channel'
     and conversation_source.id = new.source_reply_job_id
    left join briar_channel_reply_sessions conversation_session
      on conversation_session.id = conversation_source.session_id
     and conversation_session.organization_id = new.organization_id
     and conversation_session.channel_id = new.channel_id
     and conversation_session.thread_root_message_id =
       new.thread_root_message_id
     and conversation_session.agent_id = new.agent_id
    join briar_execution_workers worker
      on worker.id = new.requested_worker_id
     and worker.project_id = new.project_id
    join briar_execution_worker_devices device
      on device.id = worker.device_id
     and device.organization_id = new.organization_id
    join briar_organization_members worker_owner
      on worker_owner.organization_id = device.organization_id
     and worker_owner.user_id = device.owner_user_id
    where membership.organization_id = new.organization_id
      and membership.user_id = new.accepted_by_user_id
      and agent.name = new.agent_name
      and agent.responsibility = new.agent_responsibility
      and skill.name = new.skill_name
      and skill.body = new.skill_instructions
      and skill.kind = new.skill_kind
      and skill.provider = new.provider
      and skill.model is new.model and skill.effort is new.effort
      and (
        new.execution_mode = 'task'
        or conversation_session.id is not null
      )
      and worker.label = new.requested_worker_label
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and exists (
        select 1
        from briar_execution_worker_healthy_providers healthy
        where healthy.worker_id = worker.id
          and healthy.provider = case
            when new.execution_mode = 'conversation'
              then conversation_session.provider
            else new.provider
          end
      )
      and (
        not exists (
          select 1 from briar_project_execution_worker_policies policy
          where policy.project_id = new.project_id
            and policy.selection_mode = 'allowlist'
        )
        or exists (
          select 1 from briar_project_execution_worker_allowlist allowed
          where allowed.project_id = new.project_id
            and allowed.worker_id = worker.id
        )
      )
      and (
        (select count(*)
         from briar_hunt_runs run
         join briar_execution_workers holder on holder.id = run.worker_id
         where holder.device_id = device.id
           and run.claim_token_hash is not null
           and run.lease_expires_at > new.accepted_at
           and run.status not in (
             'backlog', 'completed', 'cancelled', 'blocked', 'failed'
           ))
        +
        (select count(*)
         from briar_project_agent_task_jobs task
         join briar_execution_workers holder
           on holder.id = task.claimed_worker_id
         where holder.device_id = device.id and task.status = 'running'
           and task.lease_expires_at > new.accepted_at)
        < device.max_concurrent_sessions
      )
  )
  and (
    (
      new.source_kind = 'channel'
      and exists (
        select 1
        from briar_channels channel
        join briar_channel_messages trigger_message
          on trigger_message.id = new.trigger_message_id
         and trigger_message.channel_id = channel.id
        join briar_channel_messages reply
          on reply.id = new.reply_message_id
         and reply.channel_id = channel.id
         and reply.author_agent_id = new.agent_id
        join briar_channel_agent_reply_jobs job
          on job.id = new.source_reply_job_id
         and job.channel_id = channel.id
         and job.trigger_message_id = trigger_message.id
         and job.reply_message_id = reply.id
        join briar_channel_agents roster
          on roster.channel_id = channel.id and roster.agent_id = new.agent_id
        where channel.id = new.channel_id
          and channel.organization_id = new.organization_id
          and channel.archived_at is null
          and job.organization_id = new.organization_id
          and job.project_id = new.project_id
          and job.agent_id = new.agent_id
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and job.status = 'completed'
          and (
            (job.delegated_by_reply_job_id is null
              and new.request = trigger_message.body)
            or
            (job.delegated_by_reply_job_id is not null
              and new.request = job.delegation_request)
          )
          and new.delegated_by_reply_job_id is job.delegated_by_reply_job_id
          and (
            (job.delegated_by_reply_job_id is null
              and new.delegated_by_agent_id is null
              and new.delegated_by_agent_name is null)
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.organization_id = job.organization_id
               and parent_agent.project_id is null
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = job.channel_id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = job.organization_id
                and parent.channel_id = job.channel_id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
          and (
            channel.visibility = 'public'
            or exists (
              select 1 from briar_channel_members member
              where member.channel_id = channel.id
                and member.user_id = new.accepted_by_user_id
            )
          )
          and (
            job.delegated_by_reply_job_id is null
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.project_id is null
               and parent_agent.organization_id = new.organization_id
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = channel.id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = new.organization_id
                and parent.channel_id = channel.id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and exists (
        select 1
        from briar_hunt_runs run
        join briar_issue_messages trigger_message
          on trigger_message.id = new.trigger_message_id
         and trigger_message.project_id = run.project_id
         and trigger_message.run_id = run.id
        join briar_issue_messages reply
          on reply.id = new.reply_message_id
         and reply.project_id = run.project_id and reply.run_id = run.id
        join briar_issue_agent_reply_jobs job
          on job.id = new.source_reply_job_id
         and job.project_id = run.project_id and job.run_id = run.id
         and job.trigger_message_id = trigger_message.id
         and job.reply_message_id = reply.id
        where run.id = new.conversation_run_id
          and run.project_id = new.project_id
          and run.agent_id = new.agent_id
          and job.status = 'completed'
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and trigger_message.body = new.request
      )
    )
  )
)
begin
  select raise(abort, 'Agent Skill execution proposal is stale');
end;
-- @statement
CREATE TRIGGER briar_execution_worker_runtime_update_guard
after update of runtime_proto_json on briar_execution_workers
when exists (
  select 1 from briar_invalid_execution_worker_runtime invalid
  where invalid.id = new.id
)
begin
  select raise(abort, 'Worker runtime ProtoJSON is invalid');
end;
-- @statement
CREATE TRIGGER briar_dashboard_workers_update_sync
after update on briar_execution_workers
when old.project_id is not new.project_id
  or old.device_id is not new.device_id
  or old.label is not new.label
  or old.host_fingerprint is not new.host_fingerprint
  or old.runtime_proto_json is not new.runtime_proto_json
  or old.state is not new.state
  or old.accepting_work is not new.accepting_work
  or old.readiness_state is not new.readiness_state
  or old.readiness_detail is not new.readiness_detail
begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update
    set current_version = excluded.current_version;
end;
-- @statement
CREATE TRIGGER briar_hunt_run_structured_result_insert_guard
before insert on briar_hunt_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;
-- @statement
CREATE TRIGGER briar_hunt_run_structured_result_update_guard
before update of structured_result_json on briar_hunt_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;
-- @statement
CREATE TRIGGER briar_schedule_run_structured_result_insert_guard
before insert on briar_project_agent_schedule_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;
-- @statement
CREATE TRIGGER briar_schedule_run_structured_result_update_guard
before update of structured_result_json
on briar_project_agent_schedule_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;
-- @statement
CREATE TRIGGER briar_hunt_run_execution_metrics_insert_guard
before insert on briar_hunt_runs
when new.execution_metrics_json is not null
  and case
    when not json_valid(new.execution_metrics_json) then 1
    when json_type(new.execution_metrics_json) <> 'object' then 1
    when length(cast(new.execution_metrics_json as blob)) > 4096 then 1
    else 0
  end
begin
  select raise(
    abort,
    'agent execution metrics must be a bounded JSON object'
  );
end;
-- @statement
CREATE TRIGGER briar_hunt_run_execution_metrics_update_guard
before update of execution_metrics_json on briar_hunt_runs
when new.execution_metrics_json is not null
  and case
    when not json_valid(new.execution_metrics_json) then 1
    when json_type(new.execution_metrics_json) <> 'object' then 1
    when length(cast(new.execution_metrics_json as blob)) > 4096 then 1
    else 0
  end
begin
  select raise(
    abort,
    'agent execution metrics must be a bounded JSON object'
  );
end;
-- @statement
CREATE TRIGGER briar_project_agent_session_payload_insert_guard
after insert on briar_project_agent_sessions
when exists (
  select 1 from briar_invalid_project_agent_session_payload invalid
  where invalid.project_id = new.project_id and invalid.id = new.id
)
begin
  select raise(abort, 'invalid stored project Agent session payload');
end;
-- @statement
CREATE TRIGGER briar_project_agent_session_payload_update_guard
after update of payload_json, agent_id, status, session_type,
  started_at, completed_at, updated_at, requested_by_user_id
on briar_project_agent_sessions
when exists (
  select 1 from briar_invalid_project_agent_session_payload invalid
  where invalid.project_id = new.project_id and invalid.id = new.id
)
begin
  select raise(abort, 'invalid stored project Agent session payload');
end;
-- @statement
CREATE TRIGGER briar_project_agent_session_summary_insert_guard
after insert on briar_project_agent_session_summaries
when exists (
  select 1 from briar_invalid_project_agent_session_summary invalid
  where invalid.project_id = new.project_id
    and invalid.session_id = new.session_id
)
begin
  select raise(abort, 'invalid stored project Agent session summary');
end;
-- @statement
CREATE TRIGGER briar_project_agent_session_summary_update_guard
after update of summary_json, updated_at
on briar_project_agent_session_summaries
when exists (
  select 1 from briar_invalid_project_agent_session_summary invalid
  where invalid.project_id = new.project_id
    and invalid.session_id = new.session_id
)
begin
  select raise(abort, 'invalid stored project Agent session summary');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_payload_insert_guard
before insert on briar_agent_skill_execution_proposals
when new.materialized_session_payload_json is not null
begin
  select raise(abort, 'Agent Skill session payload is transient');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_payload_update_guard
before update of status, materialized_session_payload_json
on briar_agent_skill_execution_proposals
when not (
  new.materialized_session_payload_json is old.materialized_session_payload_json
  or (
    old.status = 'pending' and new.status = 'accepted'
    and new.execution_mode = 'task'
    and old.materialized_session_payload_json is null
    and new.materialized_session_payload_json is not null
  )
  or (
    old.status = 'accepted' and new.status = 'accepted'
    and new.execution_mode = 'task'
    and old.materialized_session_payload_json is not null
    and new.materialized_session_payload_json is null
    and exists (
      select 1 from briar_project_agent_sessions session
      where session.project_id = new.project_id
        and session.id = new.result_session_id
    )
  )
)
begin
  select raise(abort, 'invalid Agent Skill session payload transition');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_payload_accept_guard
before update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted' and (
  (new.execution_mode = 'conversation'
    and new.materialized_session_payload_json is not null)
  or
  (new.execution_mode = 'task' and case
    when new.materialized_session_payload_json is null then 1
    when length(cast(new.materialized_session_payload_json as blob)) > 1048576
      then 1
    when not json_valid(new.materialized_session_payload_json) then 1
    when json_type(new.materialized_session_payload_json) <> 'object' then 1
    else not (
      json_extract(new.materialized_session_payload_json, '$.dispatchGroupId')
        is new.result_session_id
      and json_extract(new.materialized_session_payload_json, '$.agentName')
        is new.agent_name
      and json_extract(new.materialized_session_payload_json, '$.skillId')
        is new.skill_id
      and json_extract(new.materialized_session_payload_json, '$.trigger')
        = 'manual'
      and json_extract(new.materialized_session_payload_json, '$.request')
        is new.request
      and json_extract(
        new.materialized_session_payload_json, '$.requestedWorkerId'
      ) is new.requested_worker_id
      and json_extract(new.materialized_session_payload_json, '$.workerId')
        is new.requested_worker_id
    )
  end)
)
begin
  select raise(abort, 'invalid materialized Agent Skill session payload');
end;
-- @statement
CREATE TRIGGER briar_agent_skill_execution_materialize
after update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.execution_mode = 'task'
begin
  insert into briar_project_agent_task_jobs (
    id, project_id, agent_id, skill_id, request, request_id, status,
    preferred_worker_id, skill_execution_proposal_id, created_at, updated_at
  ) values (
    new.result_session_id, new.project_id, new.agent_id, new.skill_id,
    new.request, new.id, 'queued', new.requested_worker_id, new.id,
    new.accepted_at, new.accepted_at
  );

  insert into briar_project_agent_session_context_membership (
    project_id, session_id, visible_at
  ) values (new.project_id, new.result_session_id, new.accepted_at);

  insert into briar_project_agent_sessions (
    project_id, id, agent_id, status, session_type, payload_json,
    started_at, completed_at, updated_at, requested_by_user_id
  ) values (
    new.project_id, new.result_session_id, new.agent_id, 'running', 'task',
    new.materialized_session_payload_json,
    new.accepted_at, null, new.accepted_at, new.accepted_by_user_id
  );

  insert into briar_agent_skill_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    source_reply_job_id, delegated_by_reply_job_id, agent_id, agent_name,
    agent_responsibility, skill_id, skill_name, skill_instructions, skill_kind,
    provider, model, effort, request, worker_id, worker_label,
    result_session_id, approved_by_user_id, approved_at,
    delegated_by_agent_id, delegated_by_agent_name, created_at,
    execution_mode, approval_policy, thread_root_message_id,
    result_reply_job_id, result_message_id
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id, new.conversation_run_id,
    new.trigger_message_id, new.reply_message_id, new.source_reply_job_id,
    new.delegated_by_reply_job_id, new.agent_id, new.agent_name,
    new.agent_responsibility, new.skill_id, new.skill_name,
    new.skill_instructions, new.skill_kind, new.provider, new.model,
    new.effort, new.request, new.requested_worker_id,
    new.requested_worker_label, new.result_session_id,
    new.accepted_by_user_id, new.accepted_at, new.delegated_by_agent_id,
    new.delegated_by_agent_name, new.accepted_at, new.execution_mode,
    new.approval_policy, new.thread_root_message_id, new.result_reply_job_id,
    new.result_message_id
  );

  update briar_agent_skill_execution_proposals
  set materialized_session_payload_json = null
  where id = new.id and materialized_session_payload_json is not null;
end;
-- @statement
CREATE TRIGGER briar_conversation_issue_creation_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-conversation-approved:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
  and (
    new.status <> 'backlog'
    or new.stage <> 'queued'
    or new.workflow_stage is not null
    or new.worker_id is not null
    or new.agent_id is not null
    or new.requested_worker_id is not null
    or new.claim_token_hash is not null
    or new.claimed_by is not null
    or new.claimed_at is not null
    or new.lease_expires_at is not null
    or new.last_execution_id is not null
    or new.dispatch_mode is not null
    or new.dispatch_request_id is not null
    or new.dispatched_at is not null
    or new.requested_by_user_id is not null
    or new.requested_agent_provider is not null
    or new.requested_agent_model is not null
    or new.requested_agent_effort is not null
    or new.completed_at is not null
    or new.paused_at is not null
    or new.resume_requested_at is not null
    or not exists (
      select 1
      from briar_issue_action_proposals proposal
      join briar_hunt_runs conversation
        on conversation.id = proposal.conversation_run_id
       and conversation.project_id = proposal.project_id
      where proposal.status = 'pending'
        and proposal.action_type = 'request_issue_create'
        and proposal.project_id = new.project_id
        and proposal.approval_reserved_by_user_id is not null
        and proposal.approval_reserved_at is not null
        and proposal.issue_source_key = new.source_key
        and new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.issue_checkpoints_json = '[]'
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
        and json_extract(new.context_json, '$.origin') =
          'briar-conversation'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_extract(new.context_json, '$.conversationRunId') =
          proposal.conversation_run_id
        and new.full_auto = 0
        and new.requires_claim_token = 0
    )
    or exists (
      select 1 from briar_hunt_runs existing
      where existing.source = new.source
        and existing.source_key = new.source_key
        and existing.project_id <> new.project_id
    )
  )
BEGIN
  select raise(abort, 'conversation proposal no longer belongs to project');
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_channel_proposal_reservation_required
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
  and not exists (
    select 1
    from briar_channel_action_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_projects project
      on project.id = proposal.project_id
     and project.organization_id = channel.organization_id
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and proposal.project_id = new.project_id
      and proposal.issue_source_key = new.source_key
      and proposal.accepted_by_user_id is not null
      and proposal.accepted_at is not null
      and (
        length(new.source_key) = 87
        and substr(new.source_key, 1, 23) = 'briar-channel-approved:'
        and substr(new.source_key, 24) not glob '*[^0-9a-f]*'
      )
      and (
        json_type(proposal.payload_json) = 'object'
        and (select count(*) from json_each(proposal.payload_json)) = 1
        and json_type(proposal.payload_json, '$.issue') = 'object'
        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) = 3
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
      )
      and (
        new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.status = 'backlog'
        and new.stage = 'queued'
        and new.workflow_stage is null
        and new.issue_checkpoints_json = '[]'
        and new.detail =
          '채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.'
        and new.repository = coalesce(
          (select settings.github_repository
           from briar_project_settings settings
           where settings.project_id = proposal.project_id),
          project.name
        )
      )
      and (
        new.assignee_user_id is null
        and new.agent_id is null
        and new.worker_id is null
        and new.requested_worker_id is null
        and new.claim_token_hash is null
        and new.claimed_by is null
        and new.claimed_at is null
        and new.lease_expires_at is null
        and new.claim_attempts = 0
        and new.current_attempt = 1
        and new.current_revision = 1
        and new.full_auto = 0
        and new.requires_claim_token = 0
      )
      and (
        new.last_execution_id is null
        and new.dispatch_mode is null
        and new.dispatch_request_id is null
        and new.dispatched_at is null
        and new.requested_by_user_id is null
        and new.requested_agent_provider is null
        and new.requested_agent_model is null
        and new.requested_agent_effort is null
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
      )
      and (
        new.branch is null
        and new.commit_sha is null
        and new.tracker_provider is null
        and new.tracker_issue_id is null
        and new.tracker_issue_identifier is null
        and new.tracker_issue_url is null
        and new.tracker_issue_state is null
        and new.result_summary is null
        and new.structured_result_json is null
        and new.pull_request_urls = '[]'
        and new.target_sha is null
        and new.staging_qa_status is null
        and new.production_qa_status is null
        and new.staging_qa_detail is null
        and new.production_qa_detail is null
        and new.execution_metrics_json is null
      )
      and (
        new.completed_at is null
        and new.paused_at is null
        and new.resume_requested_at is null
        and new.waiting_checkpoint_key is null
        and new.waiting_checkpoint_revision is null
        and new.event_count = 0
        and new.source_created_at = proposal.created_at
        and new.started_at = proposal.created_at
        and new.last_event_at = proposal.created_at
        and new.created_at = new.updated_at
      )
      and (
        json_type(new.context_json) = 'object'
        and (select count(*) from json_each(new.context_json)) = 6
        and json_type(new.context_json, '$.origin') = 'text'
        and json_extract(new.context_json, '$.origin') = 'briar-channel'
        and json_type(new.context_json, '$.proposalId') = 'text'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_type(new.context_json, '$.channelId') = 'text'
        and json_extract(new.context_json, '$.channelId') = proposal.channel_id
        and json_type(new.context_json, '$.issueId') = 'text'
        and json_extract(new.context_json, '$.issueId') = proposal.id
        and json_type(new.context_json, '$.attachmentCount') = 'integer'
        and json_extract(new.context_json, '$.attachmentCount') = 0
        and json_type(new.context_json, '$.relatedMessage') = 'object'
        and (
          select count(*)
          from json_each(new.context_json, '$.relatedMessage')
        ) = 4
        and json_type(
          new.context_json, '$.relatedMessage.organizationId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.organizationId'
        ) = channel.organization_id
        and json_type(
          new.context_json, '$.relatedMessage.channelId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.channelId'
        ) = proposal.channel_id
        and json_type(
          new.context_json, '$.relatedMessage.messageId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.messageId'
        ) = proposal.reply_message_id
        and json_type(
          new.context_json, '$.relatedMessage.rootMessageId'
        ) = 'text'
      )
  )
BEGIN
  select raise(abort, 'channel proposal approval reservation not found');
END;
-- @statement
CREATE TRIGGER briar_hunt_runs_finalize_channel_proposal_approval
after insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and exists (
    select 1
    from briar_channel_action_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_projects project
      on project.id = proposal.project_id
     and project.organization_id = channel.organization_id
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and proposal.project_id = new.project_id
      and proposal.issue_source_key = new.source_key
      and proposal.accepted_by_user_id is not null
      and proposal.accepted_at is not null
      and (
        length(new.source_key) = 87
        and substr(new.source_key, 1, 23) = 'briar-channel-approved:'
        and substr(new.source_key, 24) not glob '*[^0-9a-f]*'
      )
      and (
        json_type(proposal.payload_json) = 'object'
        and (select count(*) from json_each(proposal.payload_json)) = 1
        and json_type(proposal.payload_json, '$.issue') = 'object'
        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) = 3
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
      )
      and (
        new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.status = 'backlog'
        and new.stage = 'queued'
        and new.workflow_stage is null
        and new.issue_checkpoints_json = '[]'
        and new.detail =
          '채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.'
        and new.repository = coalesce(
          (select settings.github_repository
           from briar_project_settings settings
           where settings.project_id = proposal.project_id),
          project.name
        )
      )
      and (
        new.assignee_user_id is null
        and new.agent_id is null
        and new.worker_id is null
        and new.requested_worker_id is null
        and new.claim_token_hash is null
        and new.claimed_by is null
        and new.claimed_at is null
        and new.lease_expires_at is null
        and new.claim_attempts = 0
        and new.current_attempt = 1
        and new.current_revision = 1
        and new.full_auto = 0
        and new.requires_claim_token = 0
      )
      and (
        new.last_execution_id is null
        and new.dispatch_mode is null
        and new.dispatch_request_id is null
        and new.dispatched_at is null
        and new.requested_by_user_id is null
        and new.requested_agent_provider is null
        and new.requested_agent_model is null
        and new.requested_agent_effort is null
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
      )
      and (
        new.branch is null
        and new.commit_sha is null
        and new.tracker_provider is null
        and new.tracker_issue_id is null
        and new.tracker_issue_identifier is null
        and new.tracker_issue_url is null
        and new.tracker_issue_state is null
        and new.result_summary is null
        and new.structured_result_json is null
        and new.pull_request_urls = '[]'
        and new.target_sha is null
        and new.staging_qa_status is null
        and new.production_qa_status is null
        and new.staging_qa_detail is null
        and new.production_qa_detail is null
        and new.execution_metrics_json is null
      )
      and (
        new.completed_at is null
        and new.paused_at is null
        and new.resume_requested_at is null
        and new.waiting_checkpoint_key is null
        and new.waiting_checkpoint_revision is null
        and new.event_count = 0
        and new.source_created_at = proposal.created_at
        and new.started_at = proposal.created_at
        and new.last_event_at = proposal.created_at
        and new.created_at = new.updated_at
      )
      and (
        json_type(new.context_json) = 'object'
        and (select count(*) from json_each(new.context_json)) = 6
        and json_type(new.context_json, '$.origin') = 'text'
        and json_extract(new.context_json, '$.origin') = 'briar-channel'
        and json_type(new.context_json, '$.proposalId') = 'text'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_type(new.context_json, '$.channelId') = 'text'
        and json_extract(new.context_json, '$.channelId') = proposal.channel_id
        and json_type(new.context_json, '$.issueId') = 'text'
        and json_extract(new.context_json, '$.issueId') = proposal.id
        and json_type(new.context_json, '$.attachmentCount') = 'integer'
        and json_extract(new.context_json, '$.attachmentCount') = 0
        and json_type(new.context_json, '$.relatedMessage') = 'object'
        and (
          select count(*)
          from json_each(new.context_json, '$.relatedMessage')
        ) = 4
        and json_type(
          new.context_json, '$.relatedMessage.organizationId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.organizationId'
        ) = channel.organization_id
        and json_type(
          new.context_json, '$.relatedMessage.channelId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.channelId'
        ) = proposal.channel_id
        and json_type(
          new.context_json, '$.relatedMessage.messageId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.messageId'
        ) = proposal.reply_message_id
        and json_type(
          new.context_json, '$.relatedMessage.rootMessageId'
        ) = 'text'
      )
  )
BEGIN
  insert into briar_channel_issue_approval_audit (
    id, proposal_id, organization_id, channel_id, project_id, run_id,
    approved_by_user_id, approved_at, issue_source_key, result_verification,
    payload_json, created_at
  )
  select proposal.id || ':approval:' || proposal.issue_source_key,
         proposal.id, channel.organization_id, proposal.channel_id,
         proposal.project_id, new.id, proposal.accepted_by_user_id,
         proposal.accepted_at, proposal.issue_source_key, 'atomic',
         proposal.payload_json, proposal.accepted_at
  from briar_channel_action_proposals proposal
  join briar_channels channel on channel.id = proposal.channel_id
  where proposal.status = 'pending'
    and proposal.action_type = 'request_issue_create'
    and proposal.project_id = new.project_id
    and proposal.issue_source_key = new.source_key
    and proposal.accepted_by_user_id is not null
    and proposal.accepted_at is not null;
  update briar_channel_action_proposals
  set status = 'accepted', result_run_id = new.id, updated_at = accepted_at
  where status = 'pending' and action_type = 'request_issue_create'
    and project_id = new.project_id and issue_source_key = new.source_key
    and accepted_by_user_id is not null and accepted_at is not null;
END;
-- @statement
CREATE TRIGGER briar_channel_issue_approval_audit_atomic_insert_guard
before insert on briar_channel_issue_approval_audit
when new.result_verification <> 'atomic'
begin
  select raise(abort, 'channel issue approval requires atomic verification');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_approval_audit_atomic_update_guard
before update of result_verification on briar_channel_issue_approval_audit
when new.result_verification <> 'atomic'
begin
  select raise(abort, 'channel issue approval requires atomic verification');
end;
-- @statement
CREATE TRIGGER briar_channel_issue_approval_finalize_guard
before update of status on briar_channel_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
  and not exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.proposal_id = old.id
      and approval.result_verification = 'atomic'
      and approval.run_id = new.result_run_id
      and approval.project_id = new.project_id
      and approval.issue_source_key = new.issue_source_key
      and approval.approved_by_user_id is new.accepted_by_user_id
      and approval.approved_at = new.accepted_at
  )
begin
  select raise(abort, 'channel proposal acceptance requires atomic approval');
end;
-- @statement
CREATE TRIGGER briar_channel_approved_backlog_event_guard
before insert on briar_hunt_events
when new.status not in ('backlog', 'cancelled')
  and new.actor not like 'briar-app:%'
  and exists (
    select 1
    from briar_hunt_runs run
    join briar_channel_issue_approval_audit approval
      on approval.run_id = run.id
     and approval.issue_source_key = run.source_key
    where run.id = new.run_id
      and run.source = 'issue'
      and run.status in ('backlog', 'cancelled')
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved issue execution requires explicit dispatch'
  );
end;
-- @statement
CREATE TRIGGER briar_channel_approved_backlog_context_guard
before update of context_json on briar_hunt_runs
when old.status in ('backlog', 'cancelled')
  and new.context_json is not old.context_json
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved issue context is immutable before dispatch'
  );
end;
-- @statement
CREATE TRIGGER briar_channel_approved_retryable_transfer_guard
before update of project_id, status on briar_hunt_runs
when old.status in ('queued', 'blocked', 'failed')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
  and not (
    new.status = 'backlog'
    and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null
    and new.requested_worker_id is null
    and new.claim_token_hash is null
    and new.claimed_by is null
    and new.claimed_at is null
    and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null
    and new.dispatch_request_id is null
    and new.dispatched_at is null
    and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null
    and new.resume_requested_at is null
    and new.completed_at is null
  )
begin
  select raise(
    abort, 'channel-approved retryable transfer requires execution reset'
  );
end;
-- @statement
CREATE TRIGGER briar_channel_approved_terminal_transfer_guard
before update of project_id on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved terminal issue transfer is not allowed'
  );
end;
-- @statement
CREATE TRIGGER briar_channel_approved_terminal_reactivation_guard
before update of status on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.status not in ('completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'approved issue terminal reactivation requires fresh execution approval'
  );
end;
-- @statement
CREATE TRIGGER briar_channel_approved_dispatch_clear_guard
before update of dispatch_request_id, status on briar_hunt_runs
when old.dispatch_request_id is not null
  and new.dispatch_request_id is null
  and new.status not in ('backlog', 'completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved dispatch cancellation requires backlog reset'
  );
end;
-- @statement
CREATE TRIGGER briar_channel_approved_dispatch_preference_snapshot
after update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and new.requested_agent_provider is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = new.id
      and approval.issue_source_key = new.source_key
      and approval.result_verification = 'atomic'
  )
begin
  update briar_hunt_runs
  set preferred_agent_provider = new.requested_agent_provider,
      preferred_agent_model = new.requested_agent_model,
      preferred_agent_effort = new.requested_agent_effort
  where id = new.id;
end;
-- @statement
CREATE TRIGGER briar_channel_approved_dispatch_preference_guard
before update of preferred_agent_provider, preferred_agent_model,
  preferred_agent_effort on briar_hunt_runs
when old.dispatch_request_id is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
  and not (
    new.preferred_agent_provider is old.preferred_agent_provider
    and new.preferred_agent_model is old.preferred_agent_model
    and new.preferred_agent_effort is old.preferred_agent_effort
  )
  and not (
    new.dispatch_request_id is old.dispatch_request_id
    and new.requested_agent_provider is old.requested_agent_provider
    and new.requested_agent_model is old.requested_agent_model
    and new.requested_agent_effort is old.requested_agent_effort
    and new.preferred_agent_provider is old.requested_agent_provider
    and new.preferred_agent_model is old.requested_agent_model
    and new.preferred_agent_effort is old.requested_agent_effort
  )
  and not (
    new.project_id is old.project_id
    and new.source is old.source
    and new.source_key is old.source_key
    and new.dispatch_request_id is not null
    and new.dispatch_request_id is not old.dispatch_request_id
    and new.dispatched_at is not null
    and new.requested_by_user_id is not null
    and new.requested_agent_provider is not null
    and new.status = 'queued'
    and new.stage = 'queued'
    and new.workflow_stage is null
    and new.dispatch_mode in ('any', 'specific')
    and (
      (new.dispatch_mode = 'any' and new.requested_worker_id is null)
      or
      (new.dispatch_mode = 'specific' and new.requested_worker_id is not null)
    )
    and new.worker_id is null
    and new.claim_token_hash is null
    and new.claimed_by is null
    and new.claimed_at is null
    and new.lease_expires_at is null
    and new.preferred_agent_provider is new.requested_agent_provider
    and new.preferred_agent_model is new.requested_agent_model
    and new.preferred_agent_effort is new.requested_agent_effort
  )
begin
  select raise(
    abort, 'approved channel issue dispatch preferences are immutable'
  );
end;
-- @statement
CREATE TRIGGER briar_hunt_runs_channel_proposal_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.source = new.source
      and existing.source_key = new.source_key
      and existing.project_id = new.project_id
  )
  and exists (
    select 1 from briar_hunt_runs existing
    where existing.source = new.source
      and existing.source_key = new.source_key
      and existing.project_id <> new.project_id
  )
begin
  select raise(abort, 'channel proposal issue project conflict');
end;
-- @statement
CREATE TRIGGER briar_hunt_runs_channel_proposal_reservation_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and exists (
    select 1 from briar_channel_action_proposals proposal
    where proposal.issue_source_key = new.source_key
      and proposal.project_id is not null
      and proposal.project_id <> new.project_id
  )
begin
  select raise(abort, 'channel proposal issue project conflict');
end;
-- @statement
CREATE TRIGGER briar_hunt_runs_context_policy_insert_guard
before insert on briar_hunt_runs
when json_type(new.context_json, '$.fullAuto') is not null
begin
  select raise(abort, 'run context cannot contain execution policy');
end;
-- @statement
CREATE TRIGGER briar_hunt_runs_context_policy_update_guard
before update of context_json on briar_hunt_runs
when json_type(new.context_json, '$.fullAuto') is not null
begin
  select raise(abort, 'run context cannot contain execution policy');
end;
