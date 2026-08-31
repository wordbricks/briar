alter table briar_dm_memory_jobs add column claimed_worker_id text;
alter table briar_dm_memory_jobs add column claimed_device_id text;
alter table briar_dm_memory_jobs add column input_hash text;
alter table briar_dm_memory_jobs add column policy_json text;
alter table briar_dm_memory_jobs add column calls_used integer not null default 0;
alter table briar_dm_memory_jobs add column source_start integer not null default 0;
alter table briar_dm_memory_jobs add column source_end integer not null default 0;
alter table briar_dm_memory_jobs add column request_source_id text;
alter table briar_dm_memory_jobs add column request_targets_json text not null default '[]';
alter table briar_dm_memory_jobs add column result_json text;

create unique index briar_dm_memory_one_learning_claim on briar_dm_memory_jobs(space_id)
where kind in ('extract', 'explicit_request', 'consolidate') and status = 'running';

create table briar_dm_memory_source_events (
  sequence integer primary key autoincrement,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  message_id text not null,
  created_at text not null,
  unique (space_id, message_id)
);
create index briar_dm_memory_source_events_space on briar_dm_memory_source_events(space_id, sequence);

create table briar_dm_memory_learning_outbox (
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
create index briar_dm_memory_learning_outbox_pending on briar_dm_memory_learning_outbox(space_id, settled, available_at);

create table briar_dm_memory_observation_events (
  sequence integer primary key autoincrement,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  document_id text not null,
  document_version integer not null,
  created_at text not null,
  unique (document_id, document_version)
);
create index briar_dm_memory_observation_events_space on briar_dm_memory_observation_events(space_id, sequence);

create table briar_dm_memory_learning_state (
  space_id text primary key not null references briar_dm_memory_spaces(id) on delete cascade,
  source_watermark integer not null default 0,
  observation_watermark integer not null default 0,
  last_consolidation_started_at text,
  last_consolidation_succeeded_at text,
  last_scheduled_at text,
  updated_at text not null
);

create table briar_dm_memory_learning_retries (
  request_id text primary key not null,
  operation_id text not null,
  job_id text not null references briar_dm_memory_jobs(id) on delete cascade,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  revocation_epoch integer not null,
  created_at text not null
);

create table briar_dm_memory_learning_inputs (
  job_id text not null references briar_dm_memory_jobs(id) on delete cascade,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  source_type text not null check (source_type in ('message', 'user_edit_event')),
  source_id text not null,
  source_version integer not null,
  source_hash text,
  primary key (job_id, source_type, source_id)
);
create index briar_dm_memory_learning_inputs_source on briar_dm_memory_learning_inputs(space_id, source_type, source_id);

create table briar_dm_memory_model_calls (
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
create index briar_dm_memory_calls_organization on briar_dm_memory_model_calls(organization_id, created_at);
create index briar_dm_memory_calls_space on briar_dm_memory_model_calls(space_id, created_at);

create table briar_dm_memory_proposals (
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
create index briar_dm_memory_proposals_job on briar_dm_memory_proposals(job_id, created_at);

create table briar_dm_memory_verifications (
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

create table briar_dm_memory_learning_commits (
  job_id text primary key not null references briar_dm_memory_jobs(id) on delete cascade,
  commit_id text not null references briar_dm_memory_commits(id) on delete cascade,
  proposal_hash text,
  result_json text not null
);

create table briar_dm_memory_document_links (
  document_id text not null,
  document_version integer not null,
  source_document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  source_document_version integer not null,
  primary key (document_id, document_version, source_document_id),
  foreign key (document_id, document_version)
    references briar_dm_memory_revisions(document_id, version) on delete cascade
);
create index briar_dm_memory_document_links_source on briar_dm_memory_document_links(source_document_id, source_document_version);

create trigger briar_dm_memory_invalidate_derived_versions after update of current_version, expired_version on briar_dm_memory_documents
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

create trigger briar_dm_memory_capture_message after insert on briar_channel_messages begin
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

create trigger briar_dm_memory_capture_observation after insert on briar_dm_memory_revisions begin
  insert into briar_dm_memory_observation_events(space_id, document_id, document_version, created_at)
  select new.space_id, new.document_id, new.version, new.created_at
  from briar_dm_memory_documents doc where doc.id = new.document_id and doc.kind = 'observation' and new.version = 1
  on conflict (document_id, document_version) do nothing;
end;

create trigger briar_dm_memory_begin_opt_in after update of auto_enabled on briar_dm_memory_spaces
when old.auto_enabled = 0 and new.auto_enabled = 1 begin
  insert into briar_dm_memory_learning_state(space_id, updated_at) values (new.id, new.updated_at)
  on conflict (space_id) do nothing;
  update briar_dm_memory_learning_state set
    source_watermark = coalesce((select max(sequence) from briar_dm_memory_source_events where space_id = new.id), 0),
    observation_watermark = coalesce((select max(sequence) from briar_dm_memory_observation_events where space_id = new.id), 0),
    updated_at = new.updated_at where space_id = new.id;
  update briar_dm_memory_learning_outbox set settled = 1 where space_id = new.id and kind = 'extract';
end;

-- Job cancellation erases transient model bodies immediately. Normal terminal
-- audit hashes expire only when their source is forgotten/deleted below.
create trigger briar_dm_memory_learning_cancel after update of status on briar_dm_memory_jobs
when new.kind in ('extract', 'explicit_request', 'consolidate') and new.status = 'cancelled' begin
  update briar_dm_memory_jobs set input_json = null, input_hash = null,
    lease_token_hash = null, lease_expires_at = null, result_json = null where id = new.id;
  update briar_dm_memory_proposals set proposal_json = null, normalized_json = null,
    status = 'cancelled', terminal_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where job_id = new.id;
  update briar_dm_memory_verifications set decisions_json = null where job_id = new.id;
  update briar_dm_memory_model_calls set status = 'failed', error_code = 'scope_revoked',
    completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where job_id = new.id and status = 'reserved';
end;

-- An exclusion also forgets copies in derived topic/observation revisions, but
-- does not exclude their other, unrelated roots from future learning.
create table briar_dm_memory_learning_payload_purges (
  space_id text not null,
  source_type text not null,
  source_id text not null,
  primary key (space_id, source_type, source_id)
);

-- Body-free membership keeps a forget request pending until its derived vectors
-- are removed as well, even after their revisions and source links disappear.
create table briar_dm_memory_purge_documents (
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  root_document_id text not null,
  document_id text not null,
  primary key (root_document_id, document_id)
);

create trigger briar_dm_memory_purge_learning_payload after insert on briar_dm_memory_learning_payload_purges begin
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

create trigger briar_dm_memory_forget_learning_payload after insert on briar_dm_memory_exclusions begin
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

create trigger briar_dm_memory_edit_learning_source after update of body, deleted_at on briar_channel_messages
when old.body <> new.body or old.deleted_at is not new.deleted_at begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', new.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = new.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = new.id);
end;

create trigger briar_dm_memory_delete_learning_source before delete on briar_channel_messages begin
  insert into briar_dm_memory_learning_payload_purges(space_id, source_type, source_id)
  select distinct space_id, 'message', old.id from briar_dm_memory_learning_inputs
  where source_type = 'message' and source_id = old.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_learning_inputs where source_type = 'message' and source_id = old.id);
end;

-- Run after all exclusions were inserted. Deleting source rows from an exclusion
-- row trigger could interrupt the user's INSERT ... SELECT over those rows.
create trigger briar_dm_memory_forget_derived_content after update of revocation_epoch on briar_dm_memory_spaces
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
