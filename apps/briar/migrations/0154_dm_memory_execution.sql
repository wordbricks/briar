-- A claim and a retained provider conversation have different lifetimes.
-- Keep a server-owned memory fence for each claim, including older Workers.
alter table briar_channel_agent_reply_jobs add column memory_restart_count integer not null default 0;
alter table briar_channel_reply_sessions add column memory_space_id text;
alter table briar_channel_reply_sessions add column memory_revocation_epoch integer;

create table briar_dm_memory_reply_fences (
  job_id text primary key not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  space_id text not null,
  revocation_epoch integer not null,
  protocol integer not null check (protocol in (0, 1)),
  created_at text not null
);
create index briar_dm_memory_reply_fences_space on briar_dm_memory_reply_fences(space_id);

-- Shared with organization context. New request IDs count as new lookup turns,
-- even when the normalized query can reuse a result from this claim.
create table briar_channel_reply_lookups (
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
create table briar_dm_memory_discovered_refs (
  job_id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  claim_token_hash text not null,
  document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  version integer not null,
  primary key (job_id, claim_token_hash, document_id, version)
);

create table briar_dm_memory_activity_revocations (
  id text not null references briar_channel_agent_reply_jobs(id) on delete cascade,
  organization_id text not null, channel_id text not null, agent_id text not null,
  trigger_message_id text not null, parent_message_id text not null,
  attempts integer not null, primary key (id, attempts)
);

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
  delete from briar_dm_memory_discovered_refs where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = new.id
  );
end;
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
  delete from briar_dm_memory_discovered_refs where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = old.id
  );
end;
create trigger briar_dm_memory_lookup_revision_changed after update of memory_revision on briar_dm_memory_spaces
when old.memory_revision <> new.memory_revision begin
  update briar_channel_reply_lookups set response_json = null
    where job_id in (select job_id from briar_dm_memory_reply_fences where space_id = new.id);
end;
create trigger briar_dm_memory_lookup_claim_ended after update of status on briar_channel_agent_reply_jobs
when old.status = 'running' and new.status <> 'running' begin
  delete from briar_channel_reply_lookups where job_id = new.id;
end;

-- References name immutable revisions without retaining private text. Forgetting
-- the source document removes every citation through its foreign key.
create table briar_dm_memory_reply_citations (
  message_id text not null references briar_channel_messages(id) on delete cascade,
  document_id text not null references briar_dm_memory_documents(id) on delete cascade,
  version integer not null,
  primary key (message_id, document_id, version)
);
create index briar_dm_memory_reply_citations_document on briar_dm_memory_reply_citations(document_id);

create trigger briar_dm_memory_citations_forgotten after update of status on briar_dm_memory_documents
when new.status = 'deleted' begin
  delete from briar_dm_memory_reply_citations where document_id = new.id;
end;
