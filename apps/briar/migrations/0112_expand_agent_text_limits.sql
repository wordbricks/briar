-- Expand Agent responsibility and Skill instruction limits while preserving

-- every dependent row and restoring SET NULL references after the rebuild.

pragma defer_foreign_keys = on;

drop trigger if exists "briar_dashboard_runs_insert_sync";

drop trigger if exists "briar_dashboard_runs_delete_sync";

drop trigger if exists "briar_hunt_runs_workflow_v2_insert";

drop trigger if exists "briar_hunt_runs_workflow_v2_update";

drop trigger if exists "briar_channel_reply_skill_snapshot_update";

drop trigger if exists "briar_channel_reconciled_run_status_guard";

drop trigger if exists "briar_channel_approved_backlog_context_guard";

drop trigger if exists "briar_conversation_issue_creation_project_guard";

drop trigger if exists "briar_conversation_issue_creation_finalize";

drop trigger if exists "briar_conversation_issue_acceptance_transfer_guard";

drop trigger if exists "briar_verified_run_archive_transfer_guard";

drop trigger if exists "briar_channel_approved_retryable_transfer_guard";

drop trigger if exists "briar_channel_approved_terminal_transfer_guard";

drop trigger if exists "briar_channel_approved_terminal_reactivation_guard";

drop trigger if exists "briar_channel_approved_dispatch_clear_guard";

drop trigger if exists "briar_channel_approved_dispatch_preference_snapshot";

drop trigger if exists "briar_channel_approved_dispatch_preference_guard";

drop trigger if exists "briar_hunt_runs_channel_proposal_project_guard";

drop trigger if exists "briar_hunt_runs_channel_proposal_reservation_guard";

drop trigger if exists "briar_hunt_runs_channel_proposal_reservation_required";

drop trigger if exists "briar_hunt_runs_finalize_channel_proposal_approval";

drop trigger if exists "briar_hunt_runs_legacy_channel_proposal_guard";

drop trigger if exists "briar_issue_execution_reserved_proposal_delete_guard";

drop trigger if exists "briar_issue_execution_proposal_identity_immutable";

drop trigger if exists "briar_issue_execution_proposal_status_guard";

drop trigger if exists "briar_issue_execution_proposal_reservation_immutable";

drop trigger if exists "briar_issue_execution_proposal_deleted_approver_invalidate";

drop trigger if exists "briar_issue_execution_proposal_deleted_agent_invalidate";

drop trigger if exists "briar_issue_execution_proposal_deleted_delegator_invalidate";

drop trigger if exists "briar_issue_execution_proposal_deleted_worker_invalidate";

drop trigger if exists "briar_issue_execution_conversation_delete_invalidate";

drop trigger if exists "briar_issue_execution_channel_roster_remove_invalidate";

drop trigger if exists "briar_issue_execution_agent_delete_run_reset";

drop trigger if exists "briar_issue_execution_proposal_acceptance_immutable";

drop trigger if exists "briar_issue_execution_claim_approval_guard";

drop trigger if exists "briar_issue_execution_proposal_dispatch_guard";

drop trigger if exists "briar_issue_execution_dispatch_agent_guard";

drop trigger if exists "briar_issue_execution_dispatch_issue_source_guard";

drop trigger if exists "briar_issue_execution_dispatch_audit_guard";

drop trigger if exists "briar_issue_execution_dispatch_finalize";

drop trigger if exists "briar_issue_execution_proposal_accept_guard";

drop trigger if exists "briar_issue_execution_proposal_audit_insert";

drop trigger if exists "briar_issue_execution_dispatch_clear_guard";

drop trigger if exists "briar_issue_execution_retryable_transfer_guard";

drop trigger if exists "briar_issue_execution_terminal_transfer_guard";

drop trigger if exists "briar_issue_execution_terminal_reactivation_guard";

drop trigger if exists "briar_issue_execution_target_mutation_invalidate";

drop trigger if exists "briar_issue_execution_proposal_transfer_invalidate";

drop trigger if exists "briar_issue_execution_proposal_unassign_invalidate";

drop trigger if exists "briar_channel_execution_proposals_insert_sync";

drop trigger if exists "briar_channel_execution_proposals_update_sync";

drop trigger if exists "briar_project_agent_task_completion_receipt_insert_guard";

drop trigger if exists "briar_issue_agent_reply_skill_snapshot_immutable";

drop trigger if exists "briar_channel_agent_reply_skill_snapshot_immutable";

drop trigger if exists "briar_channel_action_skill_execution_exclusive";

drop trigger if exists "briar_issue_action_skill_execution_exclusive";

drop trigger if exists "briar_issue_rework_skill_execution_exclusive";

drop trigger if exists "briar_issue_execution_skill_execution_exclusive";

drop trigger if exists "briar_agent_skill_execution_identity_immutable";

drop trigger if exists "briar_agent_skill_execution_status_guard";

drop trigger if exists "briar_agent_skill_execution_acceptance_immutable";

drop trigger if exists "briar_agent_skill_execution_materialize";

drop trigger if exists "briar_agent_skill_execution_audit_insert_guard";

drop trigger if exists "briar_agent_skill_execution_task_claim_guard";

drop trigger if exists "briar_agent_skill_execution_task_link_immutable";

drop trigger if exists "briar_agent_skill_execution_task_core_immutable";

drop trigger if exists "briar_agent_skill_execution_task_terminal_guard";

drop trigger if exists "briar_agent_skill_execution_task_terminal_project";

drop trigger if exists "briar_agent_skill_execution_task_delete_reconcile";

drop trigger if exists "briar_agent_skill_execution_organization_delete_reconcile";

drop trigger if exists "briar_agent_skill_execution_worker_delete_reconcile";

drop trigger if exists "briar_agent_skill_execution_worker_binding_reconcile";

drop trigger if exists "briar_agent_skill_execution_worker_disable_reconcile";

drop trigger if exists "briar_agent_skill_execution_worker_membership_reconcile";

drop trigger if exists "briar_agent_skill_execution_device_authority_reconcile";

drop trigger if exists "briar_agent_skill_execution_device_disable_reconcile";

drop trigger if exists "briar_agent_skill_execution_skill_update_invalidate";

drop trigger if exists "briar_agent_skill_execution_skill_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_agent_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_agent_update_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_archive_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_roster_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_job_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_message_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_message_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_job_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_job_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_issue_assignment_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_sync_insert";

drop trigger if exists "briar_agent_skill_execution_channel_sync_update";

drop trigger if exists "briar_dashboard_runs_update_sync";

drop trigger if exists "briar_channel_changes_reply_jobs_update_sync";

drop trigger if exists "briar_issue_subscriptions_run_insert";

drop trigger if exists "briar_issue_subscriptions_assignee_update";

drop trigger if exists "briar_channel_changes_messages_insert_sync";

drop trigger if exists "briar_channel_changes_messages_update_sync";

drop trigger if exists "briar_channel_changes_messages_delete_sync";

drop trigger if exists "briar_agent_skill_execution_channel_message_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_message_delete_invalidate";

drop trigger if exists "briar_channel_changes_reply_jobs_insert_sync";

drop trigger if exists "briar_channel_reply_skill_snapshot_insert";

drop trigger if exists "briar_agent_skill_execution_channel_job_delete_invalidate";

drop trigger if exists "briar_issue_execution_proposal_insert_guard";

drop trigger if exists "briar_channel_create_materialize_execution_proposal";

drop trigger if exists "briar_issue_execution_dispatch_channel_source_guard";

drop trigger if exists "briar_agent_skill_execution_insert_guard";

drop trigger if exists "briar_agent_skill_execution_accept_guard";

drop trigger if exists "briar_dashboard_issue_reply_jobs_insert_sync";

drop trigger if exists "briar_dashboard_issue_reply_jobs_update_sync";

drop trigger if exists "briar_dashboard_issue_execution_proposals_insert_sync";

drop trigger if exists "briar_dashboard_issue_execution_proposals_update_sync";

drop trigger if exists "briar_dashboard_issue_skill_proposals_insert_sync";

drop trigger if exists "briar_dashboard_issue_skill_proposals_update_sync";

drop trigger if exists "briar_issue_subscriptions_creator_insert";

drop trigger if exists "briar_channel_notification_message_insert";

create table "briar_limit_backup_agent_skill_execution_proposals" as select * from "briar_agent_skill_execution_proposals";

create table "briar_limit_backup_project_agents" as select * from "briar_project_agents";

create table "briar_limit_backup_agent_skills" as select * from "briar_agent_skills";

create table "briar_limit_backup_channel_agent_reply_jobs" as select * from "briar_channel_agent_reply_jobs";

create table "briar_limit_backup_channel_agents" as select * from "briar_channel_agents";

create table "briar_limit_backup_channel_message_agent_mentions" as select * from "briar_channel_message_agent_mentions";

create table "briar_limit_backup_project_agent_schedules" as select * from "briar_project_agent_schedules";

create table "briar_limit_backup_project_agent_schedule_runs" as select * from "briar_project_agent_schedule_runs";

create table "briar_limit_backup_project_agent_task_jobs" as select * from "briar_project_agent_task_jobs";

create table "briar_limit_null_channel_messages_author_agent_id" as
select rowid as backup_rowid, "author_agent_id" as backup_value
from "briar_channel_messages" where "author_agent_id" is not null;

create table "briar_limit_null_execution_audit_events_agent_id" as
select rowid as backup_rowid, "agent_id" as backup_value
from "briar_execution_audit_events" where "agent_id" is not null;

create table "briar_limit_null_hunt_runs_agent_id" as
select rowid as backup_rowid, "agent_id" as backup_value
from "briar_hunt_runs" where "agent_id" is not null;

create table "briar_limit_null_issue_agent_reply_jobs_skill_id" as
select rowid as backup_rowid, "skill_id" as backup_value
from "briar_issue_agent_reply_jobs" where "skill_id" is not null;

create table "briar_limit_null_issue_execution_proposals_delegated_by_agent_id" as
select rowid as backup_rowid, "delegated_by_agent_id" as backup_value
from "briar_issue_execution_proposals" where "delegated_by_agent_id" is not null;

create table "briar_limit_null_issue_execution_proposals_proposed_by_agent_id" as
select rowid as backup_rowid, "proposed_by_agent_id" as backup_value
from "briar_issue_execution_proposals" where "proposed_by_agent_id" is not null;

drop table "briar_project_agent_task_jobs";

drop table "briar_project_agent_schedule_runs";

drop table "briar_project_agent_schedules";

drop table "briar_channel_message_agent_mentions";

drop table "briar_channel_agents";

drop table "briar_channel_agent_reply_jobs";

drop table "briar_agent_skills";

drop table "briar_project_agents";

drop table "briar_agent_skill_execution_proposals";

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
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')),
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
  updated_at text not null,
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

CREATE TABLE "briar_project_agents" (
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
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')),
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
);

CREATE TABLE briar_agent_skills (
  id text primary key not null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name) and length(name) between 1 and 100
  ),
  instructions text not null default '' check (length(instructions) <= 20000),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')),
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
);

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
    or agent_provider in ('codex', 'claude', 'grok', 'opencode', 'agy', 'cursor')
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
  references briar_execution_worker_devices (id) on delete set null,
  unique (channel_id, trigger_message_id, agent_id)
);

CREATE TABLE briar_channel_agents (
  channel_id text not null references briar_channels (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  added_by_user_id text references "user" (id) on delete set null,
  created_at text not null,
  primary key (channel_id, agent_id)
);

CREATE TABLE briar_channel_message_agent_mentions (
  message_id text not null
    references briar_channel_messages (id) on delete cascade,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  created_at text not null,
  primary key (message_id, agent_id)
);

CREATE TABLE briar_project_agent_schedules (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  agent_id text not null references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name)
    and length(name) between 1 and 120
  ),
  recurrence text not null check (
    recurrence in ('daily', 'weekdays', 'weekly')
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
  updated_at text not null
, next_run_at text, frequency text
  check (
    frequency is null
    or frequency in ('interval', 'daily', 'weekdays', 'weekly', 'custom')
  ), interval_value integer
  not null default 1 check (interval_value between 1 and 999), interval_unit text
  not null default 'day'
  check (interval_unit in ('minute', 'hour', 'day', 'week')), days_of_week text, notification_level text
  not null default 'important_updates'
  check (notification_level in ('important_updates', 'none')));

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
  updated_at text not null, structured_result_json text,
  unique (schedule_id, scheduled_for)
);

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
    references briar_agent_skills (id) on delete set null, skill_execution_proposal_id text, result_summary text, result_conversation_id text,
  unique (project_id, request_id)
);

insert into "briar_agent_skill_execution_proposals" select * from "briar_limit_backup_agent_skill_execution_proposals";

insert into "briar_project_agents" select * from "briar_limit_backup_project_agents";

insert into "briar_agent_skills" select * from "briar_limit_backup_agent_skills";

insert into "briar_channel_agent_reply_jobs" select * from "briar_limit_backup_channel_agent_reply_jobs";

insert into "briar_channel_agents" select * from "briar_limit_backup_channel_agents";

insert into "briar_channel_message_agent_mentions" select * from "briar_limit_backup_channel_message_agent_mentions";

insert into "briar_project_agent_schedules" select * from "briar_limit_backup_project_agent_schedules";

insert into "briar_project_agent_schedule_runs" select * from "briar_limit_backup_project_agent_schedule_runs";

insert into "briar_project_agent_task_jobs" select * from "briar_limit_backup_project_agent_task_jobs";

update "briar_channel_messages"
set "author_agent_id" = (
  select backup_value from "briar_limit_null_channel_messages_author_agent_id"
  where backup_rowid = "briar_channel_messages".rowid
)
where rowid in (select backup_rowid from "briar_limit_null_channel_messages_author_agent_id");

update "briar_execution_audit_events"
set "agent_id" = (
  select backup_value from "briar_limit_null_execution_audit_events_agent_id"
  where backup_rowid = "briar_execution_audit_events".rowid
)
where rowid in (select backup_rowid from "briar_limit_null_execution_audit_events_agent_id");

update "briar_hunt_runs"
set "agent_id" = (
  select backup_value from "briar_limit_null_hunt_runs_agent_id"
  where backup_rowid = "briar_hunt_runs".rowid
)
where rowid in (select backup_rowid from "briar_limit_null_hunt_runs_agent_id");

update "briar_issue_agent_reply_jobs"
set "skill_id" = (
  select backup_value from "briar_limit_null_issue_agent_reply_jobs_skill_id"
  where backup_rowid = "briar_issue_agent_reply_jobs".rowid
)
where rowid in (select backup_rowid from "briar_limit_null_issue_agent_reply_jobs_skill_id");

update "briar_issue_execution_proposals"
set "delegated_by_agent_id" = (
  select backup_value from "briar_limit_null_issue_execution_proposals_delegated_by_agent_id"
  where backup_rowid = "briar_issue_execution_proposals".rowid
)
where rowid in (select backup_rowid from "briar_limit_null_issue_execution_proposals_delegated_by_agent_id");

update "briar_issue_execution_proposals"
set "proposed_by_agent_id" = (
  select backup_value from "briar_limit_null_issue_execution_proposals_proposed_by_agent_id"
  where backup_rowid = "briar_issue_execution_proposals".rowid
)
where rowid in (select backup_rowid from "briar_limit_null_issue_execution_proposals_proposed_by_agent_id");

CREATE INDEX briar_project_agent_schedules_project_idx
  on briar_project_agent_schedules (project_id, created_at, id);

CREATE INDEX briar_project_agent_schedules_agent_idx
  on briar_project_agent_schedules (agent_id, created_at, id);

CREATE INDEX briar_project_agent_schedules_due_idx
  on briar_project_agent_schedules (project_id, enabled, next_run_at, id);

CREATE INDEX briar_project_agent_schedule_runs_project_idx
  on briar_project_agent_schedule_runs (project_id, scheduled_for desc, id);

CREATE INDEX briar_project_agent_schedule_runs_lease_idx
  on briar_project_agent_schedule_runs (
    project_id, status, lease_expires_at, scheduled_for, id
  );

CREATE INDEX briar_project_agents_project_idx
  on briar_project_agents (project_id, created_at, id);

CREATE INDEX briar_project_agents_organization_idx
  on briar_project_agents (organization_id, created_at, id);

CREATE INDEX briar_channel_agents_agent_idx
  on briar_channel_agents (agent_id, channel_id);

CREATE INDEX briar_channel_agent_reply_jobs_queue_idx
  on briar_channel_agent_reply_jobs (
    organization_id, status, project_id, lease_expires_at, created_at
  );

CREATE INDEX briar_channel_agent_reply_jobs_channel_idx
  on briar_channel_agent_reply_jobs (channel_id, created_at desc);

CREATE INDEX briar_project_agent_task_jobs_queue_idx
  on briar_project_agent_task_jobs (
    project_id, preferred_worker_id, status, lease_expires_at, created_at
  );

CREATE INDEX briar_project_agent_task_jobs_session_idx
  on briar_project_agent_task_jobs (project_id, updated_at desc, id);

CREATE UNIQUE INDEX briar_agent_skills_name_idx
  on briar_agent_skills (agent_id, name collate nocase);

CREATE INDEX briar_agent_skills_agent_idx
  on briar_agent_skills (agent_id, position, created_at, id);

CREATE INDEX briar_project_agent_task_jobs_skill_idx
  on briar_project_agent_task_jobs (skill_id, status, created_at);

CREATE INDEX briar_channel_agent_reply_jobs_skill_idx
  on briar_channel_agent_reply_jobs (skill_id, status, created_at);

CREATE INDEX briar_channel_agent_reply_jobs_claimed_worker_idx
  on briar_channel_agent_reply_jobs (claimed_worker_id, status, lease_expires_at);

CREATE UNIQUE INDEX briar_channel_agent_reply_jobs_delegation_target_idx
  on briar_channel_agent_reply_jobs (delegated_by_reply_job_id, agent_id)
  where delegated_by_reply_job_id is not null;

CREATE INDEX briar_channel_agent_reply_jobs_delegation_parent_idx
  on briar_channel_agent_reply_jobs (
    delegated_by_reply_job_id, status, created_at, id
  );

CREATE UNIQUE INDEX briar_agent_skill_execution_source_job_idx
  on briar_agent_skill_execution_proposals (source_kind, source_reply_job_id);

CREATE INDEX briar_agent_skill_execution_channel_idx
  on briar_agent_skill_execution_proposals (channel_id, created_at, id);

CREATE INDEX briar_agent_skill_execution_issue_idx
  on briar_agent_skill_execution_proposals (
    project_id, conversation_run_id, created_at, id
  );

CREATE INDEX briar_agent_skill_execution_skill_idx
  on briar_agent_skill_execution_proposals (skill_id, status, created_at);

CREATE UNIQUE INDEX briar_project_agent_task_skill_execution_idx
  on briar_project_agent_task_jobs (skill_execution_proposal_id)
  where skill_execution_proposal_id is not null;

CREATE INDEX briar_channel_agent_reply_jobs_preferred_device_idx
  on briar_channel_agent_reply_jobs (
    preferred_device_id, status, created_at, id
  );

CREATE TRIGGER briar_dashboard_runs_insert_sync
after insert on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'run', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_runs_delete_sync
before delete on briar_hunt_runs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (old.project_id, 'run', old.id, 'delete', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

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

CREATE TRIGGER briar_channel_reply_skill_snapshot_update
after update of skill_id on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
BEGIN
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
END;

CREATE TRIGGER briar_channel_reconciled_run_status_guard
before update of status on briar_hunt_runs
when new.status <> old.status
  and exists (
    select 1 from briar_channel_issue_approval_reconciliation finding
    where finding.run_id = old.id
  )
BEGIN
  select raise(abort, 'reconciled channel proposal issue is quarantined');
END;

CREATE TRIGGER briar_channel_approved_backlog_context_guard
before update of context_json on briar_hunt_runs
when old.status in ('backlog', 'cancelled')
  and new.context_json is not old.context_json
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'channel-approved issue context is immutable before dispatch'
  );
END;

CREATE TRIGGER briar_conversation_issue_creation_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and (
    new.source_key like 'briar-conversation-approved:%'
    or new.source_key like 'briar-conversation-proposal:%'
  )
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
        and json_extract(new.context_json, '$.fullAuto') = 0
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

CREATE TRIGGER briar_channel_approved_retryable_transfer_guard
before update of project_id, status on briar_hunt_runs
when old.status in ('queued', 'blocked', 'failed')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
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
BEGIN
  select raise(
    abort, 'channel-approved retryable transfer requires execution reset'
  );
END;

CREATE TRIGGER briar_channel_approved_terminal_transfer_guard
before update of project_id on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'channel-approved terminal issue transfer is not allowed'
  );
END;

CREATE TRIGGER briar_channel_approved_terminal_reactivation_guard
before update of status on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.status not in ('completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'approved issue terminal reactivation requires fresh execution approval'
  );
END;

CREATE TRIGGER briar_channel_approved_dispatch_clear_guard
before update of dispatch_request_id, status on briar_hunt_runs
when old.dispatch_request_id is not null
  and new.dispatch_request_id is null
  and new.status not in ('backlog', 'completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'channel-approved dispatch cancellation requires backlog reset'
  );
END;

CREATE TRIGGER briar_channel_approved_dispatch_preference_snapshot
after update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and new.requested_agent_provider is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = new.id
      and approval.issue_source_key = new.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  update briar_hunt_runs
  set preferred_agent_provider = new.requested_agent_provider,
      preferred_agent_model = new.requested_agent_model,
      preferred_agent_effort = new.requested_agent_effort
  where id = new.id;
END;

CREATE TRIGGER briar_channel_approved_dispatch_preference_guard
before update of preferred_agent_provider, preferred_agent_model,
  preferred_agent_effort on briar_hunt_runs
when old.dispatch_request_id is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
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
BEGIN
  select raise(
    abort, 'approved channel issue dispatch preferences are immutable'
  );
END;

CREATE TRIGGER briar_hunt_runs_channel_proposal_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and (
    new.source_key like 'briar-channel-approved:%'
    or new.source_key like 'briar-channel-proposal:%'
  )
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
BEGIN
  select raise(abort, 'channel proposal issue project conflict');
END;

CREATE TRIGGER briar_hunt_runs_channel_proposal_reservation_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and exists (
    select 1 from briar_channel_action_proposals proposal
    where proposal.issue_source_key = new.source_key
      and proposal.project_id is not null
      and proposal.project_id <> new.project_id
  )
BEGIN
  select raise(abort, 'channel proposal issue project conflict');
END;

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
        ) = 4
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
        and json_type(proposal.payload_json, '$.issue.status') = 'text'
        and json_extract(
          proposal.payload_json, '$.issue.status'
        ) in ('backlog', 'queued')
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
        and json_type(new.context_json, '$.fullAuto') = 'false'
      )
  )
BEGIN
  select raise(abort, 'channel proposal approval reservation not found');
END;

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
        ) = 4
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
        and json_type(proposal.payload_json, '$.issue.status') = 'text'
        and json_extract(
          proposal.payload_json, '$.issue.status'
        ) in ('backlog', 'queued')
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
        and json_type(new.context_json, '$.fullAuto') = 'false'
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

CREATE TRIGGER briar_hunt_runs_legacy_channel_proposal_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-proposal:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
BEGIN
  select raise(abort, 'legacy channel proposal issue creation is disabled');
END;

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

CREATE TRIGGER briar_issue_execution_conversation_delete_invalidate
before delete on briar_hunt_runs
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and conversation_run_id = old.id
    and status <> 'invalidated';
END;

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

CREATE TRIGGER briar_issue_execution_proposal_transfer_invalidate
after update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
BEGIN
  update briar_issue_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where target_run_id = new.id and status <> 'invalidated';
END;

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
  or new.selected_skill_effort_snapshot is not
    old.selected_skill_effort_snapshot
  or new.skill_execution_request_snapshot is not
    old.skill_execution_request_snapshot
BEGIN
  select raise(abort, 'issue Agent Skill reply snapshot is immutable');
END;

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

CREATE TRIGGER briar_channel_action_skill_execution_exclusive
before insert on briar_channel_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'channel proposal conflicts with Agent Skill execution');
END;

CREATE TRIGGER briar_issue_action_skill_execution_exclusive
before insert on briar_issue_action_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue proposal conflicts with Agent Skill execution');
END;

CREATE TRIGGER briar_issue_rework_skill_execution_exclusive
before insert on briar_issue_rework_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'rework proposal conflicts with Agent Skill execution');
END;

CREATE TRIGGER briar_issue_execution_skill_execution_exclusive
before insert on briar_issue_execution_proposals
when exists (
  select 1 from briar_agent_skill_execution_proposals skill_execution
  where skill_execution.reply_message_id = new.reply_message_id
)
BEGIN
  select raise(abort, 'issue execution conflicts with Agent Skill execution');
END;

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

CREATE TRIGGER briar_agent_skill_execution_materialize
after update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
BEGIN
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
    started_at, completed_at, updated_at
  ) values (
    new.project_id, new.result_session_id, new.agent_id, 'running', 'task',
    json_object(
      'dispatchGroupId', new.result_session_id,
      'agentId', new.agent_id,
      'agentName', new.agent_name,
      'skillId', new.skill_id,
      'sessionType', 'task',
      'trigger', 'manual',
      'scheduleId', null,
      'scheduleRunId', null,
      'parentSessionId', null,
      'request', new.request,
      'followUps', json('[]'),
      'status', 'running',
      'issues', json('[]'),
      'startedAt', new.accepted_at,
      'completedAt', null,
      'conversationId', null,
      'requestedWorkerId', new.requested_worker_id,
      'workerId', new.requested_worker_id,
      'summary', null,
      'error', null,
      'events', json_array(json_object(
        'id', lower(hex(randomblob(16))),
        'type', 'started',
        'occurredAt', new.accepted_at
      )),
      'updatedAt', new.accepted_at
    ),
    new.accepted_at, null, new.accepted_at
  );

  insert into briar_agent_skill_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    source_reply_job_id, delegated_by_reply_job_id, agent_id, agent_name,
    agent_responsibility,
    skill_id, skill_name, skill_instructions, skill_kind,
    provider, model, effort, request,
    worker_id, worker_label, result_session_id, approved_by_user_id,
    approved_at, delegated_by_agent_id, delegated_by_agent_name, created_at
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id, new.conversation_run_id,
    new.trigger_message_id, new.reply_message_id, new.source_reply_job_id,
    new.delegated_by_reply_job_id, new.agent_id, new.agent_name,
    new.agent_responsibility, new.skill_id,
    new.skill_name, new.skill_instructions, new.skill_kind,
    new.provider, new.model, new.effort,
    new.request, new.requested_worker_id, new.requested_worker_label,
    new.result_session_id, new.accepted_by_user_id, new.accepted_at,
    new.delegated_by_agent_id, new.delegated_by_agent_name, new.accepted_at
  );
END;

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
      and skill.instructions = approval.skill_instructions
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
      and coalesce(json_extract(
        worker.capabilities_json,
        '$.providerHealth.' || approval.provider || '.healthy'
      ), 0) = 1
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

CREATE TRIGGER briar_agent_skill_execution_task_link_immutable
before update of skill_execution_proposal_id on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and new.skill_execution_proposal_id is not old.skill_execution_proposal_id
BEGIN
  select raise(abort, 'Agent Skill execution task linkage is immutable');
END;

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

CREATE TRIGGER briar_agent_skill_execution_task_terminal_project
after update of status on briar_project_agent_task_jobs
when old.skill_execution_proposal_id is not null
  and old.status in ('queued', 'running')
  and new.status in ('completed', 'failed')
BEGIN
  update briar_project_agent_sessions
  set status = new.status,
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', new.status,
          '$.summary', new.result_summary,
          '$.conversationId', new.result_conversation_id,
          '$.error', new.error,
          '$.completedAt', coalesce(new.completed_at, new.updated_at),
          '$.updatedAt', new.updated_at
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', new.status,
          'occurredAt', new.updated_at
        )
      ),
      completed_at = coalesce(new.completed_at, new.updated_at),
      updated_at = new.updated_at
  where project_id = new.project_id and id = new.id;
END;

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

CREATE TRIGGER briar_agent_skill_execution_skill_update_invalidate
after update on briar_agent_skills
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where skill_id = old.id and status = 'pending'
    and (new.agent_id <> agent_id or new.name <> skill_name
      or new.instructions <> skill_instructions or new.kind <> skill_kind
      or new.provider <> provider
      or new.model is not model or new.effort is not effort);

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select proposal_id
      from briar_agent_skill_execution_approval_audit
      where skill_id = old.id
        and (new.agent_id <> agent_id or new.name <> skill_name
          or new.instructions <> skill_instructions or new.kind <> skill_kind
          or new.provider <> provider or new.model is not model
          or new.effort is not effort)
    );
END;

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

CREATE TRIGGER briar_agent_skill_execution_channel_archive_invalidate
after update of archived_at on briar_channels
when old.archived_at is null and new.archived_at is not null
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where source_kind = 'channel' and channel_id = new.id and status = 'pending';
END;

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

CREATE TRIGGER briar_agent_skill_execution_issue_message_delete_invalidate
before delete on briar_issue_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;

CREATE TRIGGER briar_agent_skill_execution_issue_job_invalidate
after update of project_id, run_id, trigger_message_id, reply_message_id,
                skill_id, selected_skill_id_snapshot, status
on briar_issue_agent_reply_jobs
BEGIN
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
END;

CREATE TRIGGER briar_agent_skill_execution_issue_job_delete_invalidate
before delete on briar_issue_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'issue' and source_reply_job_id = old.id
    and status = 'pending';
END;

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

CREATE TRIGGER briar_channel_changes_messages_update_sync
after update on briar_channel_messages BEGIN
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

CREATE TRIGGER briar_agent_skill_execution_channel_message_delete_invalidate
before delete on briar_channel_messages
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and old.id in (trigger_message_id, reply_message_id);
END;

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

CREATE TRIGGER briar_channel_reply_skill_snapshot_insert
after insert on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
BEGIN
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
END;

CREATE TRIGGER briar_agent_skill_execution_channel_job_delete_invalidate
before delete on briar_channel_agent_reply_jobs
BEGIN
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = datetime('now')
  where source_kind = 'channel' and status = 'pending'
    and (source_reply_job_id = old.id or delegated_by_reply_job_id = old.id);
END;

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
      and skill.instructions = new.skill_instructions
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
          and run.agent_id = new.agent_id
          and trigger_message.body = new.request
      )
    )
  )
)
BEGIN
  select raise(abort, 'invalid Agent Skill execution proposal');
END;

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
      and skill.instructions = new.skill_instructions
      and skill.kind = new.skill_kind
      and skill.provider = new.provider
      and skill.model is new.model and skill.effort is new.effort
      and worker.label = new.requested_worker_label
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and coalesce(json_extract(
        worker.capabilities_json,
        '$.providerHealth.' || new.provider || '.healthy'
      ), 0) = 1
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
BEGIN
  select raise(abort, 'Agent Skill execution proposal is stale');
END;

CREATE TRIGGER briar_dashboard_issue_reply_jobs_insert_sync
after insert on briar_issue_agent_reply_jobs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_issue_reply_jobs_update_sync
after update of status, claimed_worker_id, agent_provider, error, completed_at
on briar_issue_agent_reply_jobs BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (
    new.project_id, 'notifications', new.trigger_message_id, 'replace',
    datetime('now')
  );
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

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

CREATE TRIGGER briar_channel_notification_message_insert
after insert on briar_channel_messages
when new.parent_message_id is not null
BEGIN
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select root.author_user_id, channel.organization_id, new.id,
         'thread_reply', new.created_at
  from briar_channel_messages root
  join briar_channels channel on channel.id = new.channel_id
  where root.id = new.parent_message_id
    and root.channel_id = new.channel_id
    and root.author_user_id is not null
    and (new.author_user_id is null
         or new.author_user_id <> root.author_user_id)
  on conflict (user_id, message_id) do nothing;
END;

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

drop table "briar_limit_null_issue_execution_proposals_proposed_by_agent_id";

drop table "briar_limit_null_issue_execution_proposals_delegated_by_agent_id";

drop table "briar_limit_null_issue_agent_reply_jobs_skill_id";

drop table "briar_limit_null_hunt_runs_agent_id";

drop table "briar_limit_null_execution_audit_events_agent_id";

drop table "briar_limit_null_channel_messages_author_agent_id";

drop table "briar_limit_backup_project_agent_task_jobs";

drop table "briar_limit_backup_project_agent_schedule_runs";

drop table "briar_limit_backup_project_agent_schedules";

drop table "briar_limit_backup_channel_message_agent_mentions";

drop table "briar_limit_backup_channel_agents";

drop table "briar_limit_backup_channel_agent_reply_jobs";

drop table "briar_limit_backup_agent_skills";

drop table "briar_limit_backup_project_agents";

drop table "briar_limit_backup_agent_skill_execution_proposals";

pragma defer_foreign_keys = off;
