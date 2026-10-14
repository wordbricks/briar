import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

const now = "2026-10-14T00:00:00.000Z";
const later = "2026-10-14T01:00:00.000Z";
const previous = "0221_memory_vault_cutover.sql";
const target = "0222_remove_legacy_dm_memory.sql";
const vaultId = "00000000-0000-4000-8000-0000000000aa";
const documentId = "00000000-0000-4000-8000-0000000000dd";
const unmappedDocumentId = "00000000-0000-4000-8000-0000000000de";

/*
  0222 drops the legacy D1 memory. Before it does, a citation of a migrated
  legacy document becomes a citation of the vault record it was migrated into,
  and the triggers that mixed space and fence maintenance with legacy work are
  recreated without the legacy half. The fixture is plain SQL against the 0221
  schema: a one-user, one-Agent DM with a running fenced reply, a legacy
  document cited by a message, and the vault record the D1 → vault migration
  made of it.
*/
const seed = (db: D1Database) => executeD1Sql(db, `
  insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
  values ('mem-owner', 'Owner', 'mem@example.com', 1, '${now}', '${now}');
  insert into briar_organizations (id, name, handle, created_at, updated_at)
  values ('mem-org', 'Org', 'mem-org', '${now}', '${now}');
  insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
  values ('mem-org', 'mem-owner', 'owner', '${now}', '${now}');
  insert into briar_project_agents (id, project_id, organization_id, name, responsibility, provider, created_at, updated_at)
  values ('mem-agent', null, 'mem-org', 'Agent', 'Answers', 'codex', '${now}', '${now}');
  insert into briar_channels (id, organization_id, slug, name, visibility, created_by_user_id, created_at, updated_at,
    kind, dm_key)
  values ('mem-dm', 'mem-org', 'mem-dm', 'DM', 'private', 'mem-owner', '${now}', '${now}', 'dm', 'mem-dm-key');
  insert into briar_channel_members (channel_id, user_id, role, created_at)
  values ('mem-dm', 'mem-owner', 'owner', '${now}');
  insert into briar_channel_agents (channel_id, agent_id, created_at) values ('mem-dm', 'mem-agent', '${now}');
  insert into briar_channel_messages (id, channel_id, author_user_id, body, created_at, updated_at) values
    ('mem-question', 'mem-dm', 'mem-owner', 'What do I drink?', '${now}', '${now}'),
    ('mem-answer', 'mem-dm', 'mem-owner', 'Tea.', '${now}', '${now}'),
    ('mem-next', 'mem-dm', 'mem-owner', 'And now?', '${now}', '${now}'),
    ('mem-pending', 'mem-dm', 'mem-owner', '…', '${now}', '${now}');
  insert into briar_channel_agent_reply_jobs (id, organization_id, channel_id, project_id, agent_id,
    trigger_message_id, parent_message_id, reply_message_id, status, agent_provider, created_at, updated_at)
  values ('mem-done', 'mem-org', 'mem-dm', null, 'mem-agent', 'mem-question', 'mem-question', 'mem-answer',
    'completed', 'codex', '${now}', '${now}');
  insert into briar_channel_agent_reply_jobs (id, organization_id, channel_id, project_id, agent_id,
    trigger_message_id, parent_message_id, reply_message_id, status, agent_provider, claim_token_hash, claimed_at,
    lease_expires_at, attempts, created_at, updated_at)
  values ('mem-running', 'mem-org', 'mem-dm', null, 'mem-agent', 'mem-next', 'mem-next', 'mem-pending', 'running', 'codex',
    '${"a".repeat(64)}', '${now}', '2099-01-01T00:00:00.000Z', 1, '${now}', '${now}');
  insert into briar_dm_memory_spaces (id, organization_id, channel_id, owner_user_id, agent_id, roster_epoch,
    use_enabled, auto_enabled, ever_saved, created_at, updated_at)
  select 'mem-space', 'mem-org', 'mem-dm', 'mem-owner', 'mem-agent', memory_roster_epoch, 1, 1, 1, '${now}', '${now}'
  from briar_channels where id = 'mem-dm';
  insert into briar_dm_memory_reply_fences (job_id, claim_token_hash, space_id, revocation_epoch, protocol, created_at)
  values ('mem-running', '${"a".repeat(64)}', 'mem-space', 0, 1, '${now}');
  insert into briar_dm_memory_exclusions (space_id, source_type, source_id, document_id, revocation_epoch, created_at)
  values ('mem-space', 'message', 'mem-question', '${unmappedDocumentId}', 0, '${now}');
  insert into briar_dm_memory_documents (id, space_id, kind, title, current_version, created_at, updated_at) values
    ('${documentId}', 'mem-space', 'topic', 'Drinks', 1, '${now}', '${now}'),
    ('${unmappedDocumentId}', 'mem-space', 'topic', 'Never migrated', 1, '${now}', '${now}');
  insert into briar_dm_memory_revisions (space_id, document_id, version, body, body_hash, memory_class, evidence_type,
    protected_by_user, source_language, origin, policy_version, created_at) values
    ('mem-space', '${documentId}', 1, 'Tea.', '${"b".repeat(64)}', 'note', 'observed', 0, 'en', 'extract', 'v1', '${now}'),
    ('mem-space', '${unmappedDocumentId}', 1, 'x', '${"c".repeat(64)}', 'note', 'observed', 0, 'en', 'extract', 'v1', '${now}');
  insert into briar_dm_memory_reply_citations (message_id, document_id, version) values
    ('mem-answer', '${documentId}', 1),
    ('mem-answer', '${unmappedDocumentId}', 1);
  insert into briar_memory_vaults (id, organization_id, agent_id, scope_kind, scope_key, owner_user_id, dm_space_id,
    repo_name, created_at, updated_at)
  values ('${vaultId}', 'mem-org', 'mem-agent', 'dm', 'mem-space', 'mem-owner', 'mem-space', 'mv-test-g1',
    '${now}', '${now}');
  insert into briar_memory_vault_records (vault_id, record_id, record_type, path, revision, commit_sha,
    created_at, updated_at)
  values ('${vaultId}', 'drinks', 'fact', 'knowledge/facts/drinks.md', 1, '${"1".repeat(40)}', '${now}', '${now}');
  insert into briar_memory_vault_legacy_map (vault_id, document_id, document_version, record_id, revision, commit_sha,
    body_hash, created_at)
  values ('${vaultId}', '${documentId}', 1, 'drinks', 1, '${"1".repeat(40)}', '${"d".repeat(64)}', '${now}');
  insert into briar_memory_vault_legacy_migrations (space_id, versions_migrated, verified_at, updated_at)
  values ('mem-space', 1, '${now}', '${now}');
`);

const legacyTables = [
  "briar_dm_memory_documents", "briar_dm_memory_revisions", "briar_dm_memory_sources", "briar_dm_memory_commits",
  "briar_dm_memory_jobs", "briar_dm_memory_chunks", "briar_dm_memory_vectors", "briar_dm_memory_briefs",
  "briar_dm_memory_source_events", "briar_dm_memory_learning_outbox", "briar_dm_memory_observation_events",
  "briar_dm_memory_learning_state", "briar_dm_memory_learning_retries", "briar_dm_memory_learning_inputs",
  "briar_dm_memory_model_calls", "briar_dm_memory_proposals", "briar_dm_memory_verifications",
  "briar_dm_memory_learning_commits", "briar_dm_memory_document_links", "briar_dm_memory_learning_payload_purges",
  "briar_dm_memory_purge_documents", "briar_dm_memory_discovered_refs", "briar_dm_memory_reply_citations",
  "briar_memory_vault_legacy_map", "briar_memory_vault_legacy_migrations",
];

describe("legacy DM memory removal migration", () => {
  it("keeps migrated citations, drops the legacy tables and keeps spaces and fences working", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    // The migrated document's citation now names its vault record; the
    // never-migrated one had nothing to point at.
    expect((await db.prepare(`select message_id, vault_id, record_id, revision
      from briar_memory_vault_reply_citations`).all()).results)
      .toEqual([{ message_id: "mem-answer", vault_id: vaultId, record_id: "drinks", revision: 1 }]);

    const names = (await db.prepare(`select name from sqlite_schema where type = 'table'`)
      .all<{ name: string }>()).results.map(({ name }) => name);
    for (const table of legacyTables) expect(names).not.toContain(table);
    expect(names).toEqual(expect.arrayContaining([
      "briar_dm_memory_spaces", "briar_dm_memory_reply_fences", "briar_dm_memory_exclusions",
      "briar_dm_memory_activity_revocations", "briar_dm_memory_setting_requests",
    ]));
    // No trigger or view is left naming a dropped table.
    const objects = (await db.prepare(`select name, sql from sqlite_schema where type in ('trigger', 'view')`)
      .all<{ name: string; sql: string }>()).results;
    for (const object of objects) {
      for (const table of legacyTables) expect(object.sql, object.name).not.toMatch(new RegExp(`\\b${table}\\b`, "u"));
    }
    expect(await db.prepare("select count(*) as count from briar_dm_memory_exclusions").first("count")).toBe(1);
    expect((await db.prepare("pragma foreign_key_check").all()).results).toEqual([]);

    // Editing a message still versions it (DM schedules and public batches compare it).
    const version = () => db.prepare(`select memory_source_version from briar_channel_messages where id = 'mem-answer'`)
      .first<number>("memory_source_version");
    const before = await version();
    await db.prepare(`update briar_channel_messages set body = 'Green tea.' where id = 'mem-answer'`).run();
    expect(await version()).toBe(before! + 1);

    // A revocation still ends the running fenced reply and queues its activity for clearing.
    await db.prepare(`update briar_dm_memory_spaces set revocation_epoch = revocation_epoch + 1, updated_at = ?
      where id = 'mem-space'`).bind(later).run();
    expect(await db.prepare(`select status, claim_token_hash, memory_restart_count
      from briar_channel_agent_reply_jobs where id = 'mem-running'`).first())
      .toEqual({ status: "queued", claim_token_hash: null, memory_restart_count: 1 });
    expect(await db.prepare(`select id from briar_dm_memory_activity_revocations`).first("id")).toBe("mem-running");

    // A closed roster still closes the space.
    await db.prepare(`delete from briar_channel_agents where channel_id = 'mem-dm'`).run();
    expect(await db.prepare(`select status, use_enabled, auto_enabled from briar_dm_memory_spaces where id = 'mem-space'`)
      .first()).toEqual({ status: "closed", use_enabled: 0, auto_enabled: 0 });
  });
});
