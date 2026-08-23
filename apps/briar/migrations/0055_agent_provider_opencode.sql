-- Expand every persisted agent-provider constraint to include OpenCode.
-- SQLite cannot alter CHECK constraints in place, so rebuild affected tables.

-- D1 runs migrations inside an implicit transaction, so foreign_keys cannot
-- be changed here. Defer validation while the related tables are rebuilt.
pragma defer_foreign_keys = on;

-- Triggers attached to other tables keep references to the tables rebuilt
-- below. Remove them first so SQLite never has to validate a temporarily
-- dangling trigger body; they are restored after every table is back in place.
drop trigger if exists briar_dashboard_events_insert_sync;
drop trigger if exists briar_dashboard_events_update_sync;
drop trigger if exists briar_dashboard_events_delete_sync;
drop trigger if exists briar_dashboard_mentions_insert_sync;
drop trigger if exists briar_dashboard_mentions_delete_sync;
drop trigger if exists briar_dashboard_worker_devices_update_sync;
drop trigger if exists briar_hunt_events_increment_run_event_count;
drop trigger if exists briar_hunt_events_decrement_run_event_count;
drop trigger if exists briar_issue_result_reviews_insert_sync;
drop trigger if exists briar_issue_result_reviews_delete_sync;

-- Dropping a parent table still executes ON DELETE actions even while foreign
-- key validation is deferred. Preserve every row that can be cascaded or have
-- a foreign-key column nulled while the provider-constrained tables are
-- rebuilt, then restore those rows before the transaction commits.
create table briar_0055_backup_hunt_runs as
select * from briar_hunt_runs;
create table briar_0055_backup_issue_messages as
select * from briar_issue_messages;
create table briar_0055_backup_issue_agent_reply_jobs as
select * from briar_issue_agent_reply_jobs;
create table briar_0055_backup_agent_transcript_sessions as
select * from briar_agent_transcript_sessions;
create table briar_0055_backup_execution_audit_events as
select * from briar_execution_audit_events;
create table briar_0055_backup_agent_transcripts as
select * from briar_agent_transcripts;
create table briar_0055_backup_hunt_events as
select * from briar_hunt_events;
create table briar_0055_backup_issue_attachments as
select * from briar_issue_attachments;
create table briar_0055_backup_issue_dependencies as
select * from briar_issue_dependencies;
create table briar_0055_backup_issue_message_mentions as
select * from briar_issue_message_mentions;
create table briar_0055_backup_issue_result_reviews as
select * from briar_issue_result_reviews;
create table briar_0055_backup_log_archives as
select * from briar_log_archives;
create table briar_0055_backup_run_evidence as
select * from briar_run_evidence;
create table briar_0055_backup_run_evidence_images as
select * from briar_run_evidence_images;
create table briar_0055_backup_run_stage_revisions as
select * from briar_run_stage_revisions;
create table briar_0055_backup_project_agent_schedules as
select * from briar_project_agent_schedules;
create table briar_0055_backup_project_agent_schedule_runs as
select * from briar_project_agent_schedule_runs;
create table briar_0055_backup_worker_allowlist as
select * from briar_project_execution_worker_allowlist;
create table briar_0055_backup_worker_policies as
select * from briar_project_execution_worker_policies;

create table briar_issue_messages_new (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  parent_message_id text,
  author_user_id text references "user" (id) on delete set null,
  author_agent_provider text check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude', 'grok', 'opencode')
  ),
  body text not null check (
    body = trim(body) and length(body) between 1 and 10000
  ),
  created_at text not null,
  updated_at text not null,
  check (parent_message_id is null or parent_message_id <> id)
);

insert into briar_issue_messages_new select * from briar_issue_messages;
drop table briar_issue_messages;
alter table briar_issue_messages_new rename to briar_issue_messages;
create index briar_issue_messages_run_idx
  on briar_issue_messages (run_id, created_at, id);
create index briar_issue_messages_parent_idx
  on briar_issue_messages (parent_message_id, created_at, id);

create table briar_execution_workers_new (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 100),
  host_fingerprint text not null check (
    length(host_fingerprint) = 64
    and host_fingerprint not glob '*[^0-9a-f]*'
  ),
  agent_provider text not null
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode')),
  versions_json text not null default '{}' check (
    json_valid(versions_json) and json_type(versions_json) = 'object'
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
  capabilities_json text not null default '{}' check (
    json_valid(capabilities_json) and json_type(capabilities_json) = 'object'
  ),
  unique (project_id, host_fingerprint)
);

insert into briar_execution_workers_new select * from briar_execution_workers;
drop table briar_execution_workers;
alter table briar_execution_workers_new rename to briar_execution_workers;
create index briar_execution_workers_project_idx
  on briar_execution_workers (project_id, last_heartbeat_at desc);
create unique index briar_execution_workers_project_device_idx
  on briar_execution_workers (project_id, device_id);
create index briar_execution_workers_device_idx
  on briar_execution_workers (device_id, project_id);

create table briar_agent_transcript_sessions_new (
  session_id text primary key not null check (
    session_id = trim(session_id) and length(session_id) between 1 and 128
  ),
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_provider text not null
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode')),
  started_at text not null,
  last_event_at text not null,
  event_count integer not null default 0 check (event_count >= 0),
  byte_count integer not null default 0 check (byte_count >= 0)
);

insert into briar_agent_transcript_sessions_new
select * from briar_agent_transcript_sessions;
drop table briar_agent_transcript_sessions;
alter table briar_agent_transcript_sessions_new
  rename to briar_agent_transcript_sessions;
create index briar_agent_transcript_sessions_project_idx
  on briar_agent_transcript_sessions (project_id, last_event_at desc);

create table briar_project_agents_new (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode')),
  model text check (
    model is null or (model = trim(model) and length(model) between 1 and 100)
  ),
  responsibility text not null check (
    responsibility = trim(responsibility)
    and length(responsibility) between 1 and 2000
  ),
  created_at text not null,
  updated_at text not null,
  calendar_color text not null default '#3275d5'
    check (length(calendar_color) = 7 and substr(calendar_color, 1, 1) = '#'),
  skill_markdown text not null default '' check (length(skill_markdown) <= 10000),
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
  )
);

insert into briar_project_agents_new select * from briar_project_agents;
drop table briar_project_agents;
alter table briar_project_agents_new rename to briar_project_agents;
create index briar_project_agents_project_idx
  on briar_project_agents (project_id, created_at, id);

create table briar_issue_agent_reply_jobs_new (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  trigger_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  parent_message_id text not null
    references briar_issue_messages (id) on delete cascade,
  reply_message_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  preferred_worker_id text
    references briar_execution_workers (id) on delete set null,
  claimed_worker_id text
    references briar_execution_workers (id) on delete set null,
  preferred_provider text
    check (preferred_provider in ('codex', 'claude', 'grok', 'opencode')),
  agent_provider text
    check (agent_provider in ('codex', 'claude', 'grok', 'opencode')),
  claim_token_hash text,
  claimed_at text,
  lease_expires_at text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  unique (project_id, trigger_message_id)
);

insert into briar_issue_agent_reply_jobs_new
select * from briar_issue_agent_reply_jobs;
drop table briar_issue_agent_reply_jobs;
alter table briar_issue_agent_reply_jobs_new rename to briar_issue_agent_reply_jobs;
create index briar_issue_agent_reply_jobs_queue_idx
  on briar_issue_agent_reply_jobs (
    project_id, status, preferred_worker_id, lease_expires_at, created_at
  );
create index briar_issue_agent_reply_jobs_run_idx
  on briar_issue_agent_reply_jobs (run_id, created_at desc);

create table briar_hunt_runs_new (
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
    or requested_agent_provider in ('codex', 'claude', 'grok', 'opencode')
  ),
  preferred_agent_provider text check (
    preferred_agent_provider is null
    or preferred_agent_provider in ('codex', 'claude', 'grok', 'opencode')
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
  execution_metrics_json text,
  unique (project_id, source, source_key),
  check (
    (stage in ('completed', 'cancelled') and completed_at is not null)
    or (stage not in ('completed', 'cancelled') and completed_at is null)
  )
);

-- Earlier worker and project-agent rebuilds temporarily null foreign keys on
-- the live table, so copy the untouched snapshot into the final run table.
insert into briar_hunt_runs_new select * from briar_0055_backup_hunt_runs;
drop table briar_hunt_runs;
alter table briar_hunt_runs_new rename to briar_hunt_runs;
create index briar_hunt_runs_project_idx
  on briar_hunt_runs (project_id, last_event_at desc);
create index briar_hunt_runs_attention_idx
  on briar_hunt_runs (project_id, last_event_at desc)
  where stage in ('blocked', 'failed');
create index briar_hunt_runs_tracker_issue_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_issue_id is not null;
create unique index briar_hunt_runs_tracker_issue_unique_idx
  on briar_hunt_runs (project_id, tracker_provider, tracker_issue_id)
  where tracker_provider is not null and tracker_issue_id is not null;
create index briar_hunt_runs_worker_idx
  on briar_hunt_runs (worker_id, last_event_at desc);
create index briar_hunt_runs_status_idx
  on briar_hunt_runs (project_id, status, last_event_at desc);
create index briar_hunt_runs_queue_claim_idx on briar_hunt_runs (
  project_id, priority, source_created_at, lease_expires_at
) where status = 'queued';
create unique index briar_hunt_runs_dispatch_request_idx
  on briar_hunt_runs (project_id, dispatch_request_id)
  where dispatch_request_id is not null;
create index briar_hunt_runs_dispatch_queue_idx on briar_hunt_runs (
  project_id, status, requested_worker_id, agent_id, dispatched_at
);

-- Restore rows affected by the implicit deletes above while synchronization
-- triggers are still absent. Deleting first also repairs surviving SET NULL
-- rows, such as audit events without a run and worker-selection policies.
delete from briar_run_evidence_images;
delete from briar_agent_transcripts;
delete from briar_project_agent_schedule_runs;
delete from briar_issue_message_mentions;
delete from briar_issue_agent_reply_jobs;
delete from briar_project_agent_schedules;
delete from briar_project_execution_worker_allowlist;
delete from briar_run_evidence;
delete from briar_run_stage_revisions;
delete from briar_issue_result_reviews;
delete from briar_issue_dependencies;
delete from briar_issue_attachments;
delete from briar_log_archives;
delete from briar_hunt_events;
delete from briar_execution_audit_events;
delete from briar_issue_messages;
delete from briar_agent_transcript_sessions;
delete from briar_project_execution_worker_policies;

insert into briar_agent_transcript_sessions
select * from briar_0055_backup_agent_transcript_sessions;
insert into briar_issue_messages
select * from briar_0055_backup_issue_messages;
insert into briar_project_execution_worker_policies
select * from briar_0055_backup_worker_policies;
insert into briar_project_execution_worker_allowlist
select * from briar_0055_backup_worker_allowlist;
insert into briar_project_agent_schedules
select * from briar_0055_backup_project_agent_schedules;
insert into briar_project_agent_schedule_runs
select * from briar_0055_backup_project_agent_schedule_runs;
insert into briar_execution_audit_events
select * from briar_0055_backup_execution_audit_events;
insert into briar_hunt_events
select * from briar_0055_backup_hunt_events;
insert into briar_issue_attachments
select * from briar_0055_backup_issue_attachments;
insert into briar_issue_dependencies
select * from briar_0055_backup_issue_dependencies;
insert into briar_issue_result_reviews
select * from briar_0055_backup_issue_result_reviews;
insert into briar_log_archives
select * from briar_0055_backup_log_archives;
insert into briar_run_evidence
select * from briar_0055_backup_run_evidence;
insert into briar_run_stage_revisions
select * from briar_0055_backup_run_stage_revisions;
insert into briar_run_evidence_images
select * from briar_0055_backup_run_evidence_images;
insert into briar_issue_agent_reply_jobs
select * from briar_0055_backup_issue_agent_reply_jobs;
insert into briar_issue_message_mentions
select * from briar_0055_backup_issue_message_mentions;
insert into briar_agent_transcripts
select * from briar_0055_backup_agent_transcripts;

drop table briar_0055_backup_hunt_runs;
drop table briar_0055_backup_issue_messages;
drop table briar_0055_backup_issue_agent_reply_jobs;
drop table briar_0055_backup_agent_transcript_sessions;
drop table briar_0055_backup_execution_audit_events;
drop table briar_0055_backup_agent_transcripts;
drop table briar_0055_backup_hunt_events;
drop table briar_0055_backup_issue_attachments;
drop table briar_0055_backup_issue_dependencies;
drop table briar_0055_backup_issue_message_mentions;
drop table briar_0055_backup_issue_result_reviews;
drop table briar_0055_backup_log_archives;
drop table briar_0055_backup_run_evidence;
drop table briar_0055_backup_run_evidence_images;
drop table briar_0055_backup_run_stage_revisions;
drop table briar_0055_backup_project_agent_schedules;
drop table briar_0055_backup_project_agent_schedule_runs;
drop table briar_0055_backup_worker_allowlist;
drop table briar_0055_backup_worker_policies;

-- Rebuilding tables removes their dashboard-sync triggers.
create trigger briar_dashboard_messages_insert_sync
after insert on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_messages_update_sync
after update on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'notifications', new.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_messages_delete_sync
before delete on briar_issue_messages BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'notifications', old.id, 'replace', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_workers_insert_sync
after insert on briar_execution_workers BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_workers_update_sync
after update on briar_execution_workers BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_workers_delete_sync
before delete on briar_execution_workers BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'worker', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_runs_insert_sync
after insert on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_runs_update_sync
after update on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_runs_delete_sync
before delete on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_events_insert_sync
after insert on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_events_update_sync
after update on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', new.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = new.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = new.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;
create trigger briar_dashboard_events_delete_sync
after delete on briar_hunt_events BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'run', old.run_id, 'upsert', datetime('now')
    from briar_hunt_runs where id = old.run_id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, last_insert_rowid() from briar_hunt_runs where id = old.run_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_dashboard_mentions_insert_sync
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
create trigger briar_dashboard_mentions_delete_sync
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

create trigger briar_dashboard_worker_devices_update_sync
after update on briar_execution_worker_devices BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) select project_id, 'worker', id, 'upsert', datetime('now')
    from briar_execution_workers where device_id = new.id;
  insert into briar_dashboard_sync_state (project_id, current_version)
  select project_id, max(version)
    from briar_dashboard_changes
   where entity_type = 'worker'
     and entity_id in (select id from briar_execution_workers where device_id = new.id)
   group by project_id
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

create trigger briar_hunt_events_increment_run_event_count
after insert on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = event_count + 1
  where id = new.run_id;
END;
create trigger briar_hunt_events_decrement_run_event_count
after delete on briar_hunt_events BEGIN
  update briar_hunt_runs
  set event_count = max(event_count - 1, 0)
  where id = old.run_id;
END;

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

pragma defer_foreign_keys = off;
