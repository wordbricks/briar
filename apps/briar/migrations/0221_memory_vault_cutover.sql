-- Memory vault cutover (docs/plans/memory-vault-spec.md §8, §11;
-- docs/operations/memory-vault.md).
--
-- New tables only: no table rebuild, no backfill, no existing row touched.
-- Rows written by this migration: 0. The legacy migration that later fills
-- `briar_memory_vault_legacy_migrations` writes one row per DM memory space
-- with active documents (12 in production on 2026-10-13).

-- Citations a vault-mode reply made and completion accepted: records this
-- claim read at their current revision (spec §8). One row per cited record
-- revision; the app shows them as the message's memory citations.
create table briar_memory_vault_reply_citations (
  message_id text not null references briar_channel_messages (id) on delete cascade,
  vault_id text not null references briar_memory_vaults (id) on delete cascade,
  record_id text not null check (length(record_id) between 1 and 63),
  revision integer not null check (revision >= 1),
  created_at text not null,
  primary key (message_id, vault_id, record_id, revision)
) strict;

-- Forget removes a record's citations.
create index briar_memory_vault_reply_citations_record
on briar_memory_vault_reply_citations (vault_id, record_id);

-- Per-space progress of the legacy D1 memory -> vault migration. The ledger
-- of what moved is `briar_memory_vault_legacy_map`; this row only leases the
-- space to one runner, backs off after a failure and says what was skipped.
create table briar_memory_vault_legacy_migrations (
  space_id text primary key not null references briar_dm_memory_spaces (id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  versions_migrated integer not null default 0 check (versions_migrated >= 0),
  -- Legacy versions the vault refused (secret detector, size); never retried
  -- until removed from this list. Each element is `<document id>@<version>: <reason>`.
  skipped_json text not null default '[]'
    check (json_valid(skipped_json) and json_type(skipped_json) = 'array'),
  last_error text check (last_error is null or length(last_error) <= 2000),
  next_attempt_at text,
  lease_token text check (lease_token is null or length(lease_token) = 36),
  lease_expires_at text,
  -- Every mapped revision was read back from Artifacts and matched its body hash.
  verified_at text,
  updated_at text not null
) strict;

create index briar_memory_vault_legacy_migrations_due
on briar_memory_vault_legacy_migrations (next_attempt_at);
