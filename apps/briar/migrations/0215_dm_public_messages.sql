-- Durable, ordered public output for an active one-person/one-Agent DM reply.
-- Purpose and publication kind are lookup tables because both wire enums can
-- grow without rebuilding the message or batch tables.
create table briar_dm_message_purposes (
  purpose text primary key not null,
  proto_name text not null unique
    check (proto_name = 'DM_MESSAGE_PURPOSE_' || upper(purpose))
) strict;

insert into briar_dm_message_purposes (purpose, proto_name) values
  ('acknowledgement', 'DM_MESSAGE_PURPOSE_ACKNOWLEDGEMENT'),
  ('progress', 'DM_MESSAGE_PURPOSE_PROGRESS'),
  ('discovery', 'DM_MESSAGE_PURPOSE_DISCOVERY'),
  ('question', 'DM_MESSAGE_PURPOSE_QUESTION'),
  ('result', 'DM_MESSAGE_PURPOSE_RESULT'),
  ('conversation', 'DM_MESSAGE_PURPOSE_CONVERSATION');

create table briar_dm_message_publication_kinds (
  publication_kind text primary key not null,
  proto_name text not null unique
    check (
      proto_name = 'DM_MESSAGE_PUBLICATION_KIND_' || upper(publication_kind)
    )
) strict;

insert into briar_dm_message_publication_kinds (
  publication_kind, proto_name
) values
  ('intermediate', 'DM_MESSAGE_PUBLICATION_KIND_INTERMEDIATE'),
  ('final', 'DM_MESSAGE_PUBLICATION_KIND_FINAL');

create table briar_dm_public_message_claim_scopes (
  job_id text primary key not null
    references briar_channel_agent_reply_jobs (id) on delete cascade,
  organization_id text not null,
  channel_id text not null,
  owner_user_id text not null,
  agent_id text not null,
  roster_epoch integer not null check (roster_epoch >= 0),
  input_revision integer not null check (input_revision >= 0),
  trigger_message_id text not null,
  trigger_source_version integer not null check (trigger_source_version >= 1),
  worker_id text not null,
  device_id text not null,
  claim_token_hash text not null check (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null
) strict;

create table briar_dm_public_message_sequences (
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null
    references briar_channels (id) on delete cascade,
  next_sequence integer not null default 1 check (next_sequence >= 1),
  updated_at text not null,
  primary key (organization_id, channel_id)
) strict;

create table briar_dm_public_message_batches (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null
    references briar_channels (id) on delete cascade,
  owner_user_id text not null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  roster_epoch integer not null check (roster_epoch >= 0),
  origin_reply_job_id text not null
    references briar_channel_agent_reply_jobs (id) on delete cascade,
  input_revision integer not null check (input_revision >= 0),
  trigger_message_id text not null,
  trigger_source_version integer not null check (trigger_source_version >= 1),
  publication_kind text not null
    references briar_dm_message_publication_kinds (publication_kind),
  payload_hash text not null check (
    length(payload_hash) = 64
    and payload_hash not glob '*[^0-9a-f]*'
  ),
  first_sequence integer not null check (first_sequence >= 1),
  last_sequence integer not null check (last_sequence >= first_sequence),
  part_count integer not null check (
    part_count between 1 and 8
    and last_sequence = first_sequence + part_count - 1
  ),
  worker_id text not null,
  device_id text not null,
  claim_token_hash text not null check (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ),
  created_at text not null
) strict;

create index briar_dm_public_message_batches_reply_idx
  on briar_dm_public_message_batches (
    origin_reply_job_id, first_sequence, id
  );

create unique index briar_dm_public_message_batches_final_idx
  on briar_dm_public_message_batches (origin_reply_job_id)
  where publication_kind = 'final';

create table briar_dm_public_message_receipts (
  request_id text primary key not null,
  organization_id text not null,
  channel_id text not null,
  origin_reply_job_id text not null,
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
  batch_id text not null unique
    references briar_dm_public_message_batches (id) on delete cascade,
  created_at text not null
) strict;

create index briar_dm_public_message_receipts_claim_idx
  on briar_dm_public_message_receipts (
    origin_reply_job_id, worker_id, device_id, claim_token_hash, request_id
  );

alter table briar_channel_messages add column dm_batch_id text
  references briar_dm_public_message_batches (id) on delete cascade;
alter table briar_channel_messages add column dm_part_index integer
  check (dm_part_index is null or dm_part_index between 0 and 7);
alter table briar_channel_messages add column dm_sequence integer
  check (dm_sequence is null or dm_sequence >= 1);
alter table briar_channel_messages add column dm_purpose text
  references briar_dm_message_purposes (purpose);

create unique index briar_channel_messages_dm_batch_part_idx
  on briar_channel_messages (dm_batch_id, dm_part_index)
  where dm_batch_id is not null;

create unique index briar_channel_messages_dm_sequence_idx
  on briar_channel_messages (channel_id, dm_sequence)
  where dm_sequence is not null;

create trigger briar_channel_messages_dm_metadata_insert_guard
before insert on briar_channel_messages
when not (
  (new.dm_batch_id is null and new.dm_part_index is null
    and new.dm_sequence is null and new.dm_purpose is null)
  or
  (new.dm_batch_id is not null and new.dm_part_index is not null
    and new.dm_sequence is not null and new.dm_purpose is not null)
)
begin
  select raise(abort, 'DM public message metadata must be complete');
end;

create trigger briar_channel_messages_dm_metadata_update_guard
before update of dm_batch_id, dm_part_index, dm_sequence, dm_purpose
on briar_channel_messages
when old.dm_batch_id is not new.dm_batch_id
  or old.dm_part_index is not new.dm_part_index
  or old.dm_sequence is not new.dm_sequence
  or old.dm_purpose is not new.dm_purpose
begin
  select raise(abort, 'DM public message metadata is immutable');
end;
