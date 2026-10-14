-- Remove the legacy D1 DM memory (documents, Vectorize index, learning
-- pipeline). The memory vault (0220, 0221; docs/plans/memory-vault-spec.md)
-- serves all memory; its D1 → vault migration finished in production on
-- 2026-10-14 (11 legacy documents mapped, both DM spaces with active documents
-- verified).
--
-- Kept, because the vault and DM replies depend on them:
--   briar_dm_memory_spaces, briar_dm_memory_live_rosters (view) and the
--     roster/membership/role/project-access/channel triggers that close or
--     revoke spaces;
--   briar_dm_memory_reply_fences (vault DM scope, revocation of claims and
--     resumed conversations), briar_dm_memory_activity_revocations (clears the
--     activity of a reply a revocation sent back to the queue);
--   briar_dm_memory_exclusions: source messages of memories the owner deleted
--     stay withheld from Agent snapshots (1 row in production);
--   briar_channel_reply_lookups and its triggers (workspace context lookups).
--
-- No table rebuild. Tables are dropped children first, so no foreign-key
-- cascade runs; every row they hold is simply freed.
--
-- Rows written: production row counts on 2026-10-14 put the dropped tables at
-- about 920 rows (largest: learning_inputs 253, source_events 248,
-- learning_outbox 106) plus 11 legacy map rows and 2 migration rows; with
-- their indexes that is at most a few thousand rows written. Inserted: one
-- vault citation per legacy citation whose document was migrated (5 legacy
-- citations exist). Nothing else is touched.

-- 1. Old messages keep their citations: a legacy citation of a migrated
--    document version becomes a citation of the vault record revision it was
--    migrated into. The app shows it by the record's handle (a UUID).
insert into briar_memory_vault_reply_citations (message_id, vault_id, record_id, revision, created_at)
select citation.message_id, map.vault_id, map.record_id, map.revision,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_dm_memory_reply_citations citation
join briar_memory_vault_legacy_map map
  on map.document_id = citation.document_id and map.document_version = citation.version
join briar_memory_vault_records record
  on record.vault_id = map.vault_id and record.record_id = map.record_id and record.deleted_at is null
where true
on conflict do nothing;

-- 2. Triggers that only fed the legacy tables. Triggers defined on a dropped
--    table would go with it; they are dropped here explicitly so no trigger is
--    left referring to a missing table at any point.
drop trigger briar_dm_memory_cancel_revoked;
drop trigger briar_dm_memory_chunk_purge;
drop trigger briar_dm_memory_document_projection_update;
drop trigger briar_dm_memory_space_projection_update;
drop trigger briar_dm_memory_expiry_epoch;
drop trigger briar_dm_memory_citations_forgotten;
drop trigger briar_dm_memory_invalidate_derived_versions;
drop trigger briar_dm_memory_capture_observation;
drop trigger briar_dm_memory_begin_opt_in;
drop trigger briar_dm_memory_learning_cancel;
drop trigger briar_dm_memory_purge_learning_payload;
drop trigger briar_dm_memory_forget_learning_payload;
drop trigger briar_dm_memory_forget_derived_content;
drop trigger briar_dm_memory_message_deleted;
drop trigger briar_dm_memory_capture_message;
drop trigger briar_dm_memory_edit_learning_source;
drop trigger briar_dm_memory_delete_learning_source;
drop trigger briar_dm_memory_jobs_update_claim_fence;
drop trigger briar_dm_memory_jobs_update_reservation_release;

-- 3. Triggers that mixed space/fence maintenance with legacy work: recreated
--    without the legacy statements.

-- A message edit or deletion still versions the message: DM schedules and
-- public DM message batches compare `memory_source_version`.
drop trigger briar_dm_memory_message_changed;
create trigger briar_dm_memory_message_changed
after update of body, deleted_at on briar_channel_messages
when old.body <> new.body or old.deleted_at is not new.deleted_at
begin
  update briar_channel_messages set memory_source_version = old.memory_source_version + 1
  where id = new.id;
end;

-- A revocation ends every running reply fenced to the space and every resumed
-- conversation that ran under it (vault forget, settings, roster changes).
drop trigger briar_dm_memory_reply_revoked;
create trigger briar_dm_memory_reply_revoked
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
end;

drop trigger briar_dm_memory_reply_space_deleted;
create trigger briar_dm_memory_reply_space_deleted before delete on briar_dm_memory_spaces begin
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
end;

-- 4. Learning jobs can no longer hold a Worker update reservation. The
--    `work_type` CHECK keeps its 'dmMemory' value: changing it would rebuild
--    the table, and an unused value costs nothing.
delete from briar_worker_update_reservations where work_type = 'dmMemory';

-- 5. The owner's settings switch keeps its request-id idempotency, which used
--    to live in the legacy commit ledger.
create table briar_dm_memory_setting_requests (
  id text primary key not null check (length(id) = 36),
  space_id text not null references briar_dm_memory_spaces (id) on delete cascade,
  request_id text not null check (length(request_id) = 36),
  payload_hash text not null
    check (length(payload_hash) = 64 and payload_hash not glob '*[^0-9a-f]*'),
  applied integer not null default 0 check (applied in (0, 1)),
  created_at text not null,
  unique (space_id, request_id)
) strict;

-- 6. The legacy tables, children before parents.
drop table briar_dm_memory_discovered_refs;
drop table briar_dm_memory_reply_citations;
drop table briar_dm_memory_document_links;
drop table briar_dm_memory_learning_commits;
drop table briar_dm_memory_verifications;
drop table briar_dm_memory_proposals;
drop table briar_dm_memory_model_calls;
drop table briar_dm_memory_learning_inputs;
drop table briar_dm_memory_learning_retries;
drop table briar_dm_memory_jobs;
drop table briar_dm_memory_chunks;
drop table briar_dm_memory_vectors;
drop table briar_dm_memory_sources;
drop table briar_dm_memory_revisions;
drop table briar_dm_memory_documents;
drop table briar_dm_memory_commits;
drop table briar_dm_memory_briefs;
drop table briar_dm_memory_source_events;
drop table briar_dm_memory_learning_outbox;
drop table briar_dm_memory_observation_events;
drop table briar_dm_memory_learning_state;
drop table briar_dm_memory_learning_payload_purges;
drop table briar_dm_memory_purge_documents;

-- The D1 → vault migration ledger: the citations above were its last use.
drop table briar_memory_vault_legacy_map;
drop table briar_memory_vault_legacy_migrations;
