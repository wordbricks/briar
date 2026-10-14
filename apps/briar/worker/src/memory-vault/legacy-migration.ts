import { sha256 } from "../crypto-digest";
import { MemoryVaultError } from "./errors";
import { forgetMemoryVaultRecord } from "./forget";
import type { VaultGitStore } from "./git-store";
import { joinOwnerTitle, recordIdFromTitle, vaultForSpace } from "./owner";
import { commitWithRetry, locateRecord, openVaultForWrite, recordCommitted, withStore } from "./operations";
import { MEMORY_VAULT_README } from "./readme";
import {
  README_PATH,
  describeRecordFile,
  frontmatterTime,
  normalizeRecordBody,
  recordPath,
  renderRecordFile,
  type RecordType,
} from "./records";
import { detectSecrets } from "./secret-detector";
import { parseVaultCommitMessage, vaultCommitMessage } from "./trailers";
import type { VaultRow } from "./vault-repository";

/**
 * Legacy D1 DM memory → vault migration (spec §11).
 *
 * Per DM memory space, every revision of every active document becomes one
 * commit, in version order, with the revision's original timestamp and a
 * `Briar-Legacy: <document id>@<version>` trailer. `profile` documents become
 * `person` records; `note` and `log` documents become `fact` records (a log
 * is a multi-line, versioned document, which a single immutable journal line
 * cannot hold). The title is the body's leading `# ` heading, message sources
 * a `## Sources` footer, validity a `## Validity` footer, protection the D1
 * `protected_by_user` flag.
 *
 * Rerunnable and idempotent: `briar_memory_vault_legacy_map` records each
 * migrated version; a rerun skips mapped versions, recovers a version whose
 * commit landed but whose map row did not (from the trailer), and fails loudly
 * if a mapped version no longer renders to the body hash it was migrated with,
 * if a record changed in the vault since its last migrated version, or if any
 * migrated revision read back from Artifacts does not hash to its map row.
 * The legacy rows are never modified, so turning the vault off rolls back to
 * them. A mapped document the owner deleted in the legacy dialog is forgotten
 * in the vault on the next run.
 */
export type LegacyMigrationDeps = {
  readonly db: D1Database;
  readonly store: VaultGitStore;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
};

/** A mapped version that no longer matches: the migration stops for the space until someone looks. */
export class LegacyMigrationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyMigrationMismatchError";
  }
}

type SpaceRow = {
  id: string; organization_id: string; channel_id: string; owner_user_id: string; agent_id: string;
};

type LegacyVersion = {
  document_id: string; title: string; document_created_at: string; version: number; body: string;
  memory_class: "profile" | "log" | "note"; protected_by_user: number; observed_at: string | null;
  valid_until: string | null; origin: string; author_agent_id: string | null; created_at: string;
};

type MapRow = {
  document_id: string; document_version: number; record_id: string; revision: number; commit_sha: string;
  body_hash: string;
};

export type SpaceMigrationReport = {
  readonly spaceId: string;
  readonly vaultId: string | null;
  readonly migrated: number;
  readonly recovered: number;
  readonly forgotten: number;
  readonly skipped: readonly string[];
  readonly verified: number;
};

const clock = (deps: { now?: () => Date }) => deps.now?.() ?? new Date();

const recordTypeOf = (memoryClass: LegacyVersion["memory_class"]): RecordType =>
  memoryClass === "profile" ? "person" : "fact";

/** The vault body of one legacy revision. Its hash is the map row's `body_hash`. */
export function legacyRecordBody(version: LegacyVersion, sources: readonly { id: string; version: number }[]) {
  const sections = [joinOwnerTitle(version.title, version.body.replace(/\r\n?/gu, "\n").replace(/\n+$/u, ""))];
  if (sources.length > 0) {
    sections.push(`## Sources\n${sources.map((source) => `- message ${source.id} (v${source.version})`).join("\n")}`);
  }
  if (version.observed_at || version.valid_until) {
    sections.push(`## Validity\n${[
      ...(version.observed_at ? [`- Observed at: ${version.observed_at}`] : []),
      ...(version.valid_until ? [`- Valid until: ${version.valid_until}`] : []),
    ].join("\n")}`);
  }
  return normalizeRecordBody(sections.join("\n\n"));
}

const legacyKey = (documentId: string, version: number) => `${documentId}@${version}`;

async function legacyVersions(db: D1Database, spaceId: string) {
  const versions = (await db.prepare(`select doc.id as document_id, doc.title, doc.created_at as document_created_at,
      rev.version, rev.body, rev.memory_class, rev.protected_by_user, rev.observed_at, rev.valid_until, rev.origin,
      rev.author_agent_id, rev.created_at
    from briar_dm_memory_documents doc
    join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.space_id = doc.space_id
    where doc.space_id = ? and doc.status = 'active'
    order by doc.created_at, doc.id, rev.version`).bind(spaceId).all<LegacyVersion>()).results;
  const sources = (await db.prepare(`select document_id, document_version, source_id, source_version
    from briar_dm_memory_sources where space_id = ? and source_type = 'message'
    order by document_id, document_version, source_id`).bind(spaceId)
    .all<{ document_id: string; document_version: number; source_id: string; source_version: number }>()).results;
  const sourcesOf = (documentId: string, version: number) => sources
    .filter((source) => source.document_id === documentId && source.document_version === version)
    .map((source) => ({ id: source.source_id, version: source.source_version }));
  return { versions, sourcesOf };
}

const mapRows = async (db: D1Database, vaultId: string) => (await db.prepare(`select document_id, document_version,
    record_id, revision, commit_sha, body_hash from briar_memory_vault_legacy_map where vault_id = ?
    order by document_id, document_version`).bind(vaultId).all<MapRow>()).results;

const insertMap = (db: D1Database, vaultId: string, row: MapRow, now: string) => db.prepare(`insert into
    briar_memory_vault_legacy_map (vault_id, document_id, document_version, record_id, revision, commit_sha,
      body_hash, created_at)
  values (?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing`)
  .bind(vaultId, row.document_id, row.document_version, row.record_id, row.revision, row.commit_sha, row.body_hash, now)
  .run();

/** Migrates one space. Throws on a mismatch; the scheduled runner records it and backs off. */
export async function migrateLegacyDmMemorySpace(deps: LegacyMigrationDeps, spaceId: string, options: {
  readonly skipped?: readonly string[];
} = {}): Promise<SpaceMigrationReport> {
  const db = deps.db;
  const space = await db.prepare(`select space.id, space.organization_id, space.channel_id, space.owner_user_id,
      space.agent_id
    from briar_dm_memory_spaces space
    join briar_project_agents agent on agent.id = space.agent_id and agent.organization_id = space.organization_id
    where space.id = ?`).bind(spaceId).first<SpaceRow>();
  if (!space) throw new Error(`DM memory space ${spaceId} has no live Agent to own its vault`);
  const skippedKeys = new Set((options.skipped ?? []).map((entry) => entry.split(":")[0]!));
  const { versions, sourcesOf } = await legacyVersions(db, space.id);
  const report = { spaceId: space.id, vaultId: null as string | null, migrated: 0, recovered: 0, forgotten: 0,
    skipped: [] as string[], verified: 0 };

  let vault: VaultRow | null = await vaultForSpace(db, space.id);
  const expected = new Map<string, string>();
  const refused = new Map<string, string>();
  for (const version of versions) {
    const key = legacyKey(version.document_id, version.version);
    try {
      const body = legacyRecordBody(version, sourcesOf(version.document_id, version.version));
      const secrets = detectSecrets(body);
      if (secrets.length > 0) refused.set(key, `secret_detected (${secrets.join(", ")})`);
      else expected.set(key, await sha256(body));
    } catch (error) {
      refused.set(key, error instanceof MemoryVaultError ? error.vaultCode : String(error));
    }
  }
  const pending = versions.filter((version) => !skippedKeys.has(legacyKey(version.document_id, version.version)));
  if (!vault && pending.length === 0) return report;

  // A legacy document the owner deleted after it was migrated is forgotten in the vault too.
  if (vault) {
    const gone = (await db.prepare(`select distinct map.record_id from briar_memory_vault_legacy_map map
      join briar_memory_vault_records record on record.vault_id = map.vault_id and record.record_id = map.record_id
        and record.deleted_at is null
      where map.vault_id = ? and not exists (select 1 from briar_dm_memory_documents doc
        where doc.id = map.document_id and doc.status <> 'deleted')`).bind(vault.id).all<{ record_id: string }>()).results;
    for (const record of gone) {
      await forgetMemoryVaultRecord(deps, { vaultId: vault.id, recordId: record.record_id, actor: "system" });
      report.forgotten += 1;
    }
  }

  const unmapped = async (current: VaultRow | null) => {
    const mapped = new Set(current ? (await mapRows(db, current.id)).map((row) => legacyKey(row.document_id, row.document_version)) : []);
    return pending.filter((version) => !mapped.has(legacyKey(version.document_id, version.version)));
  };
  let todo = await unmapped(vault);
  if (todo.length > 0) {
    vault = await openVaultForWrite(deps, {
      organizationId: space.organization_id, agentId: space.agent_id, scopeKind: "dm", scopeKey: space.id,
      ownerUserId: space.owner_user_id, dmSpaceId: space.id,
    });
    // A commit that landed while its map row did not (a crash in between) is recovered from its trailer.
    const history = await withStore("migration history", () => deps.store.history(vault!.repo_name, { stopAt: null, limit: 2_000 }));
    const wanted = new Set(todo.map((version) => legacyKey(version.document_id, version.version)));
    for (const commit of history) {
      const trailers = parseVaultCommitMessage(commit.message);
      const record = trailers?.records.find((entry) => entry.revision > 0);
      if (!trailers?.legacy || trailers.vaultId !== vault.id || !record || !wanted.has(trailers.legacy)) continue;
      const at = trailers.legacy.lastIndexOf("@");
      const documentId = trailers.legacy.slice(0, at);
      const documentVersion = Number(trailers.legacy.slice(at + 1));
      await insertMap(db, vault.id, {
        document_id: documentId, document_version: documentVersion, record_id: record.recordId,
        revision: record.revision, commit_sha: commit.oid, body_hash: expected.get(trailers.legacy) ?? "0".repeat(64),
      }, clock(deps).toISOString());
      // The replay that rebuilt the record row cannot know protection; it is D1 control data.
      const source = versions.find((version) => legacyKey(version.document_id, version.version) === trailers.legacy);
      if (source) {
        await db.prepare(`update briar_memory_vault_records set protected_by_user = ?
          where vault_id = ? and record_id = ? and revision = ?`)
          .bind(source.protected_by_user, vault.id, record.recordId, record.revision).run();
      }
      report.recovered += 1;
    }
    todo = await unmapped(vault);
  }
  if (!vault) return report;
  const activeVault = vault;
  report.vaultId = activeVault.id;

  // Mapped versions must still render to the hash they were migrated with.
  const mapped = await mapRows(db, activeVault.id);
  for (const row of mapped) {
    const key = legacyKey(row.document_id, row.document_version);
    const hash = expected.get(key);
    if (hash !== undefined && hash !== row.body_hash) {
      throw new LegacyMigrationMismatchError(`Legacy memory ${key} changed after it was migrated to ${row.record_id} r${row.revision}`);
    }
  }

  const recordOf = new Map(mapped.map((row) => [row.document_id, row.record_id]));
  const lastRevision = new Map<string, number>();
  for (const row of mapped) lastRevision.set(row.document_id, Math.max(lastRevision.get(row.document_id) ?? 0, row.revision));
  const takenIds = new Set((await db.prepare(`select record_id from briar_memory_vault_records where vault_id = ?`)
    .bind(activeVault.id).all<{ record_id: string }>()).results.map((row) => row.record_id));
  for (const id of recordOf.values()) takenIds.add(id);

  for (const version of todo) {
    const key = legacyKey(version.document_id, version.version);
    const refusal = refused.get(key);
    if (refusal) {
      report.skipped.push(`${key}: ${refusal}`);
      console.error(JSON.stringify({ message: "legacy memory version not migrated", spaceId: space.id, version: key, reason: refusal }));
      continue;
    }
    let recordId = recordOf.get(version.document_id);
    if (!recordId) {
      const base = recordIdFromTitle(version.title);
      recordId = takenIds.has(base) ? `${base.slice(0, 50)}-${version.document_id.replaceAll("-", "").slice(0, 8)}` : base;
      takenIds.add(recordId);
      recordOf.set(version.document_id, recordId);
    }
    const targetId = recordId;
    const type = recordTypeOf(version.memory_class);
    const body = legacyRecordBody(version, sourcesOf(version.document_id, version.version));
    const bodyHash = expected.get(key)!;
    const expectedRevision = lastRevision.get(version.document_id) ?? 0;
    const actor = version.origin === "user_edit" ? `user:${space.owner_user_id}` : `agent:${version.author_agent_id ?? space.agent_id}`;
    const outcome = await commitWithRetry<{ revision: number; path: string }>(deps, activeVault, async (head) => {
      const current = locateRecord(head.files, targetId);
      if ((current?.revision ?? 0) !== expectedRevision) {
        throw new LegacyMigrationMismatchError(
          `Vault record ${targetId} is at revision ${current?.revision ?? 0}, not ${expectedRevision}; it changed since legacy ${key}'s predecessor was migrated`);
      }
      const revision = expectedRevision + 1;
      const path = recordPath(type, targetId);
      const files = new Map(head.files);
      if (current && current.path !== path) files.delete(current.path);
      const createdAt = current?.createdAt ?? frontmatterTime(new Date(version.document_created_at));
      const updatedAt = frontmatterTime(new Date(version.created_at));
      files.set(path, renderRecordFile({ id: targetId, type, status: null, aliases: [], revision, createdAt, updatedAt }, body));
      if (files.get(README_PATH) !== MEMORY_VAULT_README) files.set(README_PATH, MEMORY_VAULT_README);
      return {
        kind: "commit",
        files,
        message: vaultCommitMessage(`memory: migrate ${targetId} r${revision}`, {
          vaultId: activeVault.id, operation: "migrate", requestId: `migrate:${key}`, payloadHash: bodyHash, actor,
          claim: null, records: [{ recordId: targetId, path, revision }], journalLine: null, legacy: key,
        }),
        timestamp: Math.floor(Date.parse(version.created_at) / 1000),
        value: {
          result: { revision, path },
          records: [{ recordId: targetId, type, path, status: null, aliases: [], revision, createdAt, updatedAt,
            protectedByUser: version.protected_by_user === 1 }],
          revisions: [{ recordId: targetId, revision, path, actor, createdAt: updatedAt }],
        },
      };
    });
    if (outcome.kind !== "committed") throw new Error("A migrated version always commits");
    const current = (await db.prepare(`select * from briar_memory_vaults where id = ?`).bind(activeVault.id).first<VaultRow>())!;
    await recordCommitted(deps, current, outcome, {
      requestId: `migrate:${key}`, payloadHash: bodyHash,
      result: { operation: "migrate", id: targetId, revision: outcome.value.result.revision, commit: outcome.commit },
    });
    await db.prepare(`update briar_memory_vault_records set protected_by_user = ? where vault_id = ? and record_id = ?`)
      .bind(version.protected_by_user, activeVault.id, targetId).run();
    await insertMap(db, activeVault.id, {
      document_id: version.document_id, document_version: version.version, record_id: targetId,
      revision: outcome.value.result.revision, commit_sha: outcome.commit, body_hash: bodyHash,
    }, clock(deps).toISOString());
    lastRevision.set(version.document_id, outcome.value.result.revision);
    report.migrated += 1;
  }

  report.verified = await verifyLegacyMigration(deps, activeVault.id);
  return report;
}

/**
 * Reads every migrated revision back from Artifacts and compares its body hash
 * with the map row. Returns how many were checked; throws on the first mismatch.
 */
export async function verifyLegacyMigration(deps: LegacyMigrationDeps, vaultId: string) {
  const vault = await deps.db.prepare(`select * from briar_memory_vaults where id = ?`).bind(vaultId).first<VaultRow>();
  if (!vault) return 0;
  const rows = (await deps.db.prepare(`select map.document_id, map.document_version, map.record_id, map.revision,
      map.commit_sha, map.body_hash, revision.path
    from briar_memory_vault_legacy_map map
    left join briar_memory_vault_revisions revision on revision.vault_id = map.vault_id
      and revision.record_id = map.record_id and revision.revision = map.revision
    where map.vault_id = ?`).bind(vaultId).all<MapRow & { path: string | null }>()).results;
  for (const row of rows) {
    const key = legacyKey(row.document_id, row.document_version);
    if (!row.path) throw new LegacyMigrationMismatchError(`Migrated ${key} has no revision ${row.record_id} r${row.revision}`);
    const content = await withStore("migration verify", () => deps.store.readFile(vault.repo_name, row.commit_sha, row.path!));
    const described = content === null ? null : describeRecordFile(row.path, content);
    if (!described || await sha256(described.body) !== row.body_hash) {
      throw new LegacyMigrationMismatchError(`Migrated ${key} (${row.record_id} r${row.revision}) does not match its body hash in Artifacts`);
    }
  }
  return rows.length;
}

const LEASE_MS = 10 * 60_000;

/**
 * Scheduled entry point (minute cron while `MEMORY_VAULT_ENABLED` or
 * `MEMORY_VAULT_MIGRATION_ENABLED` is on): migrates up to `limit` spaces that
 * still have work — unmapped active versions, mapped documents deleted in
 * legacy, or an unverified ledger. A failure is recorded on the space's row,
 * logged, and retried with backoff.
 */
export async function runLegacyMemoryMigration(deps: LegacyMigrationDeps, options: { readonly limit?: number } = {}) {
  const now = clock(deps).toISOString();
  const candidates = (await deps.db.prepare(`select space.id from briar_dm_memory_spaces space
    join briar_project_agents agent on agent.id = space.agent_id and agent.organization_id = space.organization_id
    left join briar_memory_vaults vault on vault.dm_space_id = space.id and vault.scope_kind = 'dm'
    left join briar_memory_vault_legacy_migrations migration on migration.space_id = space.id
    where (migration.next_attempt_at is null or migration.next_attempt_at <= ?)
      and (migration.lease_expires_at is null or migration.lease_expires_at <= ?)
      and (
        exists (select 1 from briar_dm_memory_documents doc
          join briar_dm_memory_revisions rev on rev.document_id = doc.id
          where doc.space_id = space.id and doc.status = 'active'
            and not exists (select 1 from briar_memory_vault_legacy_map map
              where map.vault_id = vault.id and map.document_id = doc.id and map.document_version = rev.version))
        or exists (select 1 from briar_memory_vault_legacy_map map
          join briar_memory_vault_records record on record.vault_id = map.vault_id
            and record.record_id = map.record_id and record.deleted_at is null
          where map.vault_id = vault.id and not exists (select 1 from briar_dm_memory_documents doc
            where doc.id = map.document_id and doc.status <> 'deleted'))
        or (migration.verified_at is null and exists (select 1 from briar_memory_vault_legacy_map map
          where map.vault_id = vault.id))
      )
    order by coalesce(migration.updated_at, space.created_at), space.id limit ?`)
    .bind(now, now, options.limit ?? 1).all<{ id: string }>()).results;
  const outcomes: (SpaceMigrationReport | { spaceId: string; error: string })[] = [];
  for (const candidate of candidates) {
    const token = crypto.randomUUID();
    const leased = await deps.db.prepare(`insert into briar_memory_vault_legacy_migrations
        (space_id, lease_token, lease_expires_at, attempts, updated_at)
      values (?, ?, ?, 1, ?)
      on conflict (space_id) do update set lease_token = excluded.lease_token,
        lease_expires_at = excluded.lease_expires_at, attempts = briar_memory_vault_legacy_migrations.attempts + 1,
        updated_at = excluded.updated_at
      where briar_memory_vault_legacy_migrations.lease_expires_at is null
        or briar_memory_vault_legacy_migrations.lease_expires_at <= ?`)
      .bind(candidate.id, token, new Date(Date.parse(now) + LEASE_MS).toISOString(), now, now).run();
    if ((leased.meta.changes ?? 0) !== 1) continue;
    const row = (await deps.db.prepare(`select skipped_json, attempts from briar_memory_vault_legacy_migrations
      where space_id = ?`).bind(candidate.id).first<{ skipped_json: string; attempts: number }>())!;
    const skipped = JSON.parse(row.skipped_json) as string[];
    try {
      const report = await migrateLegacyDmMemorySpace(deps, candidate.id, { skipped });
      const allSkipped = [...skipped, ...report.skipped];
      const finished = clock(deps).toISOString();
      await deps.db.prepare(`update briar_memory_vault_legacy_migrations set lease_token = null, lease_expires_at = null,
          versions_migrated = versions_migrated + ?, skipped_json = ?, last_error = null, attempts = 0,
          next_attempt_at = ?, verified_at = ?, updated_at = ?
        where space_id = ? and lease_token = ?`)
        .bind(report.migrated, JSON.stringify(allSkipped),
          // Only skipped versions left: look again in six hours rather than every minute.
          allSkipped.length > 0 ? new Date(Date.parse(finished) + 6 * 3_600_000).toISOString() : null,
          report.vaultId ? finished : null, finished, candidate.id, token).run();
      console.log(JSON.stringify({ message: "legacy memory migrated", ...report }));
      outcomes.push(report);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const retryAt = new Date(clock(deps).getTime() + Math.min(360, 2 ** Math.min(row.attempts, 8)) * 60_000).toISOString();
      await deps.db.prepare(`update briar_memory_vault_legacy_migrations set lease_token = null, lease_expires_at = null,
          last_error = ?, next_attempt_at = ?, verified_at = null, updated_at = ?
        where space_id = ? and lease_token = ?`)
        .bind(message.slice(0, 2000), retryAt, clock(deps).toISOString(), candidate.id, token).run();
      console.error(JSON.stringify({ message: "legacy memory migration failed", spaceId: candidate.id, error: message }));
      outcomes.push({ spaceId: candidate.id, error: message });
    }
  }
  return outcomes;
}
