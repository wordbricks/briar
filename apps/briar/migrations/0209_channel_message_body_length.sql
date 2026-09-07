-- Raise the ceiling on a channel message body from 10,000 to 50,000 characters.
--
-- A pasted prompt or a log excerpt is an ordinary message, and the column's
-- `check (length(body) between 1 and 10000)` rejected one with a validation
-- error the composer showed as "[unknown] Invalid request". SQLite can only
-- widen a CHECK by rebuilding the table, and rebuilding this one means moving
-- its eighteen foreign-key descendants out of the way and back:
--
--   * D1 does not honour `pragma foreign_keys = off` — set it and it still
--     reads 1 — so neither half of the usual recipe is available.
--   * With foreign keys on, dropping the parent runs an implicit DELETE that
--     cascades, taking every descendant row with it.
--   * Renaming the parent aside instead rewrites the REFERENCES clauses that
--     name it, so the descendants follow the rename and the old table can
--     never be orphaned.
--
-- So the rows are parked, the parent is dropped, the widened parent is created
-- under the same name, and everything is put back. The triggers on all
-- nineteen tables are dropped first and recreated last: the restore is a
-- replay of rows that already existed, and letting the sync, notification and
-- DM-memory triggers fire on it would re-enqueue work for the whole history.
--
-- This is the shape the provider-lookup rebuild used, at a nineteenth of its
-- reach: that one had to rewrite 67 tables because a provider column appears
-- all over the schema, while a message body is one column with one closure.

pragma defer_foreign_keys = on;

drop trigger if exists "briar_channel_changes_messages_insert_sync";

drop trigger if exists "briar_channel_changes_messages_delete_sync";

drop trigger if exists "briar_agent_skill_execution_channel_message_invalidate";

drop trigger if exists "briar_agent_skill_execution_channel_message_delete_invalidate";

drop trigger if exists "briar_channel_thread_subscriptions_author_insert";

drop trigger if exists "briar_channel_notification_message_insert";

drop trigger if exists "briar_channel_changes_messages_update_sync";

drop trigger if exists "briar_dm_memory_message_changed";

drop trigger if exists "briar_dm_memory_message_deleted";

drop trigger if exists "briar_dm_memory_capture_message";

drop trigger if exists "briar_dm_memory_edit_learning_source";

drop trigger if exists "briar_dm_memory_delete_learning_source";

drop trigger if exists "briar_channel_message_blocks_array_insert";

drop trigger if exists "briar_channel_message_blocks_array_update";

drop trigger if exists "briar_inbox_channel_mentions_insert_sync";

drop trigger if exists "briar_inbox_channel_mentions_delete_sync";

drop trigger if exists "briar_channel_thread_subscriptions_mention_insert";

drop trigger if exists "briar_channel_notification_mention_insert";

drop trigger if exists "briar_channel_notification_mention_delete";

drop trigger if exists "briar_channel_message_mutation_receipt_insert_guard";

drop trigger if exists "briar_channel_message_mutation_receipt_immutable";

drop trigger if exists "briar_channel_changes_reactions_insert_sync";

drop trigger if exists "briar_channel_changes_reactions_delete_sync";

drop trigger if exists "briar_channel_thread_subscriptions_insert_sync";

drop trigger if exists "briar_channel_thread_subscriptions_delete_sync";

drop trigger if exists "briar_channel_reply_skill_snapshot_update";

drop trigger if exists "briar_channel_changes_reply_jobs_update_sync";

drop trigger if exists "briar_channel_changes_reply_jobs_insert_sync";

drop trigger if exists "briar_channel_reply_skill_snapshot_insert";

drop trigger if exists "briar_agent_skill_execution_channel_job_delete_invalidate";

drop trigger if exists "briar_agent_skill_execution_result_job_insert_guard";

drop trigger if exists "briar_agent_skill_execution_result_job_origin_immutable";

drop trigger if exists "briar_agent_skill_execution_result_job_failure_publish";

drop trigger if exists "briar_dm_memory_lookup_claim_ended";

drop trigger if exists "briar_channel_reply_agent_message_hop_insert_guard";

drop trigger if exists "briar_channel_reply_session_events_immutable_update";

create table "briar_body_backup_channel_messages" as select * from "briar_channel_messages";

create table "briar_body_backup_channel_message_agent_mentions" as select * from "briar_channel_message_agent_mentions";

create table "briar_body_backup_channel_message_attachments" as select * from "briar_channel_message_attachments";

create table "briar_body_backup_channel_message_documents" as select * from "briar_channel_message_documents";

create table "briar_body_backup_channel_message_mentions" as select * from "briar_channel_message_mentions";

create table "briar_body_backup_channel_message_mutation_receipts" as select * from "briar_channel_message_mutation_receipts";

create table "briar_body_backup_channel_message_reactions" as select * from "briar_channel_message_reactions";

create table "briar_body_backup_channel_notification_inbox" as select * from "briar_channel_notification_inbox";

create table "briar_body_backup_channel_reply_sessions" as select * from "briar_channel_reply_sessions";

create table "briar_body_backup_channel_thread_subscriptions" as select * from "briar_channel_thread_subscriptions";

create table "briar_body_backup_dm_memory_reply_citations" as select * from "briar_dm_memory_reply_citations";

create table "briar_body_backup_whatsapp_outbox" as select * from "briar_whatsapp_outbox";

create table "briar_body_backup_channel_agent_reply_jobs" as select * from "briar_channel_agent_reply_jobs";

create table "briar_body_backup_channel_message_relays" as select * from "briar_channel_message_relays";

create table "briar_body_backup_channel_reply_lookups" as select * from "briar_channel_reply_lookups";

create table "briar_body_backup_channel_reply_session_events" as select * from "briar_channel_reply_session_events";

create table "briar_body_backup_dm_memory_activity_revocations" as select * from "briar_dm_memory_activity_revocations";

create table "briar_body_backup_dm_memory_discovered_refs" as select * from "briar_dm_memory_discovered_refs";

create table "briar_body_backup_dm_memory_reply_fences" as select * from "briar_dm_memory_reply_fences";

drop table "briar_channel_messages";

create table "briar_channel_messages" (
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
  author_agent_provider text,
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
    body = trim(body) and length(body) between 1 and 50000
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
  ),
  foreign key ("author_agent_provider") references briar_agent_providers (provider)
);

insert into "briar_channel_messages" (
  "id",
  "channel_id",
  "parent_message_id",
  "author_user_id",
  "author_agent_id",
  "author_agent_name",
  "author_agent_provider",
  "author_webhook_id",
  "author_webhook_name",
  "webhook_event_id",
  "body",
  "created_at",
  "updated_at",
  "blocks_json",
  "deleted_at",
  "memory_source_version"
)
select
  "id",
  "channel_id",
  "parent_message_id",
  "author_user_id",
  "author_agent_id",
  "author_agent_name",
  "author_agent_provider",
  "author_webhook_id",
  "author_webhook_name",
  "webhook_event_id",
  "body",
  "created_at",
  "updated_at",
  "blocks_json",
  "deleted_at",
  "memory_source_version"
from "briar_body_backup_channel_messages";

insert into "briar_channel_message_agent_mentions" (
  "message_id",
  "agent_id",
  "created_at"
)
select
  "message_id",
  "agent_id",
  "created_at"
from "briar_body_backup_channel_message_agent_mentions";

insert into "briar_channel_message_attachments" (
  "id",
  "organization_id",
  "channel_id",
  "message_id",
  "object_key",
  "filename",
  "content_type",
  "byte_size",
  "created_at",
  "image_width",
  "image_height"
)
select
  "id",
  "organization_id",
  "channel_id",
  "message_id",
  "object_key",
  "filename",
  "content_type",
  "byte_size",
  "created_at",
  "image_width",
  "image_height"
from "briar_body_backup_channel_message_attachments";

insert into "briar_channel_message_documents" (
  "message_id",
  "channel_id",
  "project_id",
  "title",
  "markdown",
  "created_at",
  "updated_at"
)
select
  "message_id",
  "channel_id",
  "project_id",
  "title",
  "markdown",
  "created_at",
  "updated_at"
from "briar_body_backup_channel_message_documents";

insert into "briar_channel_message_mentions" (
  "message_id",
  "user_id",
  "created_at"
)
select
  "message_id",
  "user_id",
  "created_at"
from "briar_body_backup_channel_message_mentions";

insert into "briar_channel_message_mutation_receipts" (
  "message_id",
  "organization_id",
  "channel_id",
  "user_id",
  "request_hash",
  "created_at"
)
select
  "message_id",
  "organization_id",
  "channel_id",
  "user_id",
  "request_hash",
  "created_at"
from "briar_body_backup_channel_message_mutation_receipts";

insert into "briar_channel_message_reactions" (
  "message_id",
  "user_id",
  "emoji",
  "created_at"
)
select
  "message_id",
  "user_id",
  "emoji",
  "created_at"
from "briar_body_backup_channel_message_reactions";

insert into "briar_channel_notification_inbox" (
  "user_id",
  "organization_id",
  "message_id",
  "notification_reason",
  "created_at"
)
select
  "user_id",
  "organization_id",
  "message_id",
  "notification_reason",
  "created_at"
from "briar_body_backup_channel_notification_inbox";

insert into "briar_channel_reply_sessions" (
  "id",
  "organization_id",
  "channel_id",
  "thread_root_message_id",
  "project_id",
  "agent_id",
  "provider",
  "model",
  "effort",
  "owner_device_id",
  "owner_worker_id",
  "conversation_id",
  "last_activity_at",
  "retained_until",
  "created_at",
  "updated_at",
  "owner_worker_label",
  "memory_space_id",
  "memory_revocation_epoch"
)
select
  "id",
  "organization_id",
  "channel_id",
  "thread_root_message_id",
  "project_id",
  "agent_id",
  "provider",
  "model",
  "effort",
  "owner_device_id",
  "owner_worker_id",
  "conversation_id",
  "last_activity_at",
  "retained_until",
  "created_at",
  "updated_at",
  "owner_worker_label",
  "memory_space_id",
  "memory_revocation_epoch"
from "briar_body_backup_channel_reply_sessions";

insert into "briar_channel_thread_subscriptions" (
  "root_message_id",
  "channel_id",
  "organization_id",
  "user_id",
  "created_at"
)
select
  "root_message_id",
  "channel_id",
  "organization_id",
  "user_id",
  "created_at"
from "briar_body_backup_channel_thread_subscriptions";

insert into "briar_dm_memory_reply_citations" (
  "message_id",
  "document_id",
  "version"
)
select
  "message_id",
  "document_id",
  "version"
from "briar_body_backup_dm_memory_reply_citations";

insert into "briar_whatsapp_outbox" (
  "id",
  "connection_id",
  "channel_message_id",
  "source_wamid",
  "part_index",
  "part_count",
  "recipient_phone",
  "body",
  "last_customer_message_at",
  "status",
  "next_attempt_at",
  "attempts",
  "claim_token",
  "claimed_at",
  "last_attempt_at",
  "last_error",
  "dead_lettered_at",
  "dead_letter_reason",
  "created_at",
  "updated_at"
)
select
  "id",
  "connection_id",
  "channel_message_id",
  "source_wamid",
  "part_index",
  "part_count",
  "recipient_phone",
  "body",
  "last_customer_message_at",
  "status",
  "next_attempt_at",
  "attempts",
  "claim_token",
  "claimed_at",
  "last_attempt_at",
  "last_error",
  "dead_lettered_at",
  "dead_letter_reason",
  "created_at",
  "updated_at"
from "briar_body_backup_whatsapp_outbox";

insert into "briar_channel_agent_reply_jobs" (
  "id",
  "organization_id",
  "channel_id",
  "project_id",
  "agent_id",
  "trigger_message_id",
  "parent_message_id",
  "reply_message_id",
  "status",
  "agent_provider",
  "claimed_device_id",
  "claim_token_hash",
  "claimed_at",
  "lease_expires_at",
  "attempts",
  "error",
  "created_at",
  "updated_at",
  "completed_at",
  "skill_id",
  "claimed_worker_id",
  "delegated_by_reply_job_id",
  "delegation_request",
  "selected_skill_id_snapshot",
  "execution_target_ids_json",
  "selected_agent_name_snapshot",
  "selected_agent_responsibility_snapshot",
  "selected_skill_name_snapshot",
  "selected_skill_instructions_snapshot",
  "selected_skill_provider_snapshot",
  "selected_skill_kind_snapshot",
  "selected_skill_model_snapshot",
  "selected_skill_effort_snapshot",
  "skill_execution_request_snapshot",
  "preferred_device_id",
  "planned_update_resume",
  "session_id",
  "approved_skill_execution_proposal_id",
  "memory_restart_count",
  "agent_message_hop",
  "origin_reply_job_id",
  "superseded_by_reply_job_id"
)
select
  "id",
  "organization_id",
  "channel_id",
  "project_id",
  "agent_id",
  "trigger_message_id",
  "parent_message_id",
  "reply_message_id",
  "status",
  "agent_provider",
  "claimed_device_id",
  "claim_token_hash",
  "claimed_at",
  "lease_expires_at",
  "attempts",
  "error",
  "created_at",
  "updated_at",
  "completed_at",
  "skill_id",
  "claimed_worker_id",
  "delegated_by_reply_job_id",
  "delegation_request",
  "selected_skill_id_snapshot",
  "execution_target_ids_json",
  "selected_agent_name_snapshot",
  "selected_agent_responsibility_snapshot",
  "selected_skill_name_snapshot",
  "selected_skill_instructions_snapshot",
  "selected_skill_provider_snapshot",
  "selected_skill_kind_snapshot",
  "selected_skill_model_snapshot",
  "selected_skill_effort_snapshot",
  "skill_execution_request_snapshot",
  "preferred_device_id",
  "planned_update_resume",
  "session_id",
  "approved_skill_execution_proposal_id",
  "memory_restart_count",
  "agent_message_hop",
  "origin_reply_job_id",
  "superseded_by_reply_job_id"
from "briar_body_backup_channel_agent_reply_jobs";

insert into "briar_channel_message_relays" (
  "message_id",
  "direction",
  "peer_channel_id",
  "peer_message_id",
  "origin_reply_job_id",
  "created_at"
)
select
  "message_id",
  "direction",
  "peer_channel_id",
  "peer_message_id",
  "origin_reply_job_id",
  "created_at"
from "briar_body_backup_channel_message_relays";

insert into "briar_channel_reply_lookups" (
  "job_id",
  "claim_token_hash",
  "request_id",
  "kind",
  "request_hash",
  "query_hashes_json",
  "memory_revision",
  "revocation_epoch",
  "lease_token",
  "lease_expires_at",
  "attempts",
  "response_json",
  "created_at"
)
select
  "job_id",
  "claim_token_hash",
  "request_id",
  "kind",
  "request_hash",
  "query_hashes_json",
  "memory_revision",
  "revocation_epoch",
  "lease_token",
  "lease_expires_at",
  "attempts",
  "response_json",
  "created_at"
from "briar_body_backup_channel_reply_lookups";

insert into "briar_channel_reply_session_events" (
  "id",
  "session_id",
  "reply_job_id",
  "event_type",
  "reason",
  "from_worker_id",
  "to_worker_id",
  "retained_until",
  "detail_json",
  "occurred_at"
)
select
  "id",
  "session_id",
  "reply_job_id",
  "event_type",
  "reason",
  "from_worker_id",
  "to_worker_id",
  "retained_until",
  "detail_json",
  "occurred_at"
from "briar_body_backup_channel_reply_session_events";

insert into "briar_dm_memory_activity_revocations" (
  "id",
  "organization_id",
  "channel_id",
  "agent_id",
  "trigger_message_id",
  "parent_message_id",
  "attempts"
)
select
  "id",
  "organization_id",
  "channel_id",
  "agent_id",
  "trigger_message_id",
  "parent_message_id",
  "attempts"
from "briar_body_backup_dm_memory_activity_revocations";

insert into "briar_dm_memory_discovered_refs" (
  "job_id",
  "claim_token_hash",
  "document_id",
  "version"
)
select
  "job_id",
  "claim_token_hash",
  "document_id",
  "version"
from "briar_body_backup_dm_memory_discovered_refs";

insert into "briar_dm_memory_reply_fences" (
  "job_id",
  "claim_token_hash",
  "space_id",
  "revocation_epoch",
  "protocol",
  "created_at"
)
select
  "job_id",
  "claim_token_hash",
  "space_id",
  "revocation_epoch",
  "protocol",
  "created_at"
from "briar_body_backup_dm_memory_reply_fences";

drop table "briar_body_backup_channel_messages";

drop table "briar_body_backup_channel_message_agent_mentions";

drop table "briar_body_backup_channel_message_attachments";

drop table "briar_body_backup_channel_message_documents";

drop table "briar_body_backup_channel_message_mentions";

drop table "briar_body_backup_channel_message_mutation_receipts";

drop table "briar_body_backup_channel_message_reactions";

drop table "briar_body_backup_channel_notification_inbox";

drop table "briar_body_backup_channel_reply_sessions";

drop table "briar_body_backup_channel_thread_subscriptions";

drop table "briar_body_backup_dm_memory_reply_citations";

drop table "briar_body_backup_whatsapp_outbox";

drop table "briar_body_backup_channel_agent_reply_jobs";

drop table "briar_body_backup_channel_message_relays";

drop table "briar_body_backup_channel_reply_lookups";

drop table "briar_body_backup_channel_reply_session_events";

drop table "briar_body_backup_dm_memory_activity_revocations";

drop table "briar_body_backup_dm_memory_discovered_refs";

drop table "briar_body_backup_dm_memory_reply_fences";

CREATE INDEX briar_channel_messages_root_idx
  on briar_channel_messages (channel_id, created_at, id)
  where parent_message_id is null;

CREATE INDEX briar_channel_messages_thread_idx
  on briar_channel_messages (parent_message_id, created_at, id);

CREATE INDEX briar_channel_messages_channel_idx
  on briar_channel_messages (channel_id, created_at, id);

CREATE UNIQUE INDEX briar_channel_messages_webhook_event_idx
  on briar_channel_messages (author_webhook_id, webhook_event_id)
  where author_webhook_id is not null and webhook_event_id is not null;

CREATE INDEX briar_channel_messages_deleted_idx
  on briar_channel_messages (channel_id, deleted_at)
  where deleted_at is not null;

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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = old.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = old.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = old.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

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

CREATE TRIGGER briar_dm_memory_message_deleted before delete on briar_channel_messages begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
  update briar_dm_memory_documents set status = 'invalidated'
  where status = 'active' and id in (select document_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
end;

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

CREATE TRIGGER briar_dm_memory_edit_learning_source after update of body, deleted_at on briar_channel_messages
when old.body <> new.body or old.deleted_at is not new.deleted_at begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', new.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = new.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = new.id);
end;

CREATE TRIGGER briar_dm_memory_delete_learning_source before delete on briar_channel_messages begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', old.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = old.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = old.id);
end;

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
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

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
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

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

CREATE TRIGGER briar_channel_message_mutation_receipt_immutable
before update on briar_channel_message_mutation_receipts
begin
  select raise(abort, 'channel message receipt is immutable');
end;

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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = new.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = new.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channel_messages message
  join briar_channels channel on channel.id = message.channel_id
  where message.id = old.message_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channel_messages message
    join briar_channels channel on channel.id = message.channel_id
    where message.id = old.message_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (old.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = old.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_reply_skill_snapshot_update
after update of skill_id on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
BEGIN
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
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
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
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

CREATE TRIGGER briar_agent_skill_execution_result_job_origin_immutable
before update of approved_skill_execution_proposal_id
on briar_channel_agent_reply_jobs
when new.approved_skill_execution_proposal_id is not
  old.approved_skill_execution_proposal_id
begin
  select raise(abort, 'approved Agent Skill conversation origin is immutable');
end;

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

CREATE TRIGGER briar_dm_memory_lookup_claim_ended after update of status on briar_channel_agent_reply_jobs
when old.status = 'running' and new.status <> 'running' begin
  delete from briar_channel_reply_lookups where job_id = new.id;
end;

CREATE TRIGGER briar_channel_reply_agent_message_hop_insert_guard
before insert on briar_channel_agent_reply_jobs
when new.agent_message_hop > 0
BEGIN
  select case
    when new.delegated_by_reply_job_id is not null
      then raise(abort, 'delegated reply cannot carry an Agent message hop')
  end;
  select case
    when new.origin_reply_job_id is null
      then raise(abort, 'Agent message hop requires an origin reply job')
  end;
END;

CREATE TRIGGER briar_channel_reply_session_events_immutable_update
before update on briar_channel_reply_session_events
when not (
  old.reply_job_id is not null
  and new.reply_job_id is null
  and new.id is old.id
  and new.session_id is old.session_id
  and new.event_type is old.event_type
  and new.reason is old.reason
  and new.from_worker_id is old.from_worker_id
  and new.to_worker_id is old.to_worker_id
  and new.retained_until is old.retained_until
  and new.detail_json is old.detail_json
  and new.occurred_at is old.occurred_at
)
begin
  select raise(abort, 'Channel reply session events are immutable');
end;
