alter table briar_dm_memory_documents add column expired_version integer not null default 0;

create table briar_dm_memory_chunks (
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
create index briar_dm_memory_chunks_document on briar_dm_memory_chunks
  (space_id, document_id, document_version, start_bytes);

-- This body-free registry deliberately has no cascading foreign keys. A deleted
-- organization, account, or source revision must not erase the vector purge work.
create table briar_dm_memory_vectors (
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
create index briar_dm_memory_vectors_cleanup on briar_dm_memory_vectors (state, available_at, id);
create index briar_dm_memory_vectors_document on briar_dm_memory_vectors (document_id, document_version);

create table briar_dm_memory_briefs (
  space_id text primary key not null references briar_dm_memory_spaces(id) on delete cascade,
  memory_revision integer not null,
  revocation_epoch integer not null,
  policy_version text not null,
  valid_through text,
  content_json text not null check (length(cast(content_json as blob)) <= 8192),
  created_at text not null
);

create trigger briar_dm_memory_chunk_purge after delete on briar_dm_memory_chunks
begin
  update briar_dm_memory_vectors set state = 'purging', delete_mutation_id = null,
    confirmed_at = null, available_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    lease_token = null, lease_expires_at = null, attempt = 0, error_code = null
    where id = old.vector_id;
end;

create trigger briar_dm_memory_document_projection_update
after update of current_version, status, conflicted, expired_version on briar_dm_memory_documents
begin
  delete from briar_dm_memory_chunks where document_id = new.id
    and (document_version <> new.current_version or new.status <> 'active'
      or new.expired_version = new.current_version);
  delete from briar_dm_memory_briefs where space_id = new.space_id;
end;

create trigger briar_dm_memory_space_projection_update
after update of memory_revision, revocation_epoch, status on briar_dm_memory_spaces
begin
  delete from briar_dm_memory_briefs where space_id = new.id;
  delete from briar_dm_memory_chunks where space_id = new.id and new.status <> 'active';
end;

create trigger briar_dm_memory_expiry_epoch
after update of expired_version on briar_dm_memory_documents
when new.expired_version = new.current_version and old.expired_version <> new.expired_version
begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.space_id;
end;
