import { VaultRepoNotFoundError, type VaultCommit, type VaultGitStore } from "./git-store";
import { describeRecordFile, parseRecordPath, README_PATH, type RecordType } from "./records";
import { parseVaultCommitMessage, type VaultTrailers } from "./trailers";

/**
 * D1 side of the vault: ownership and control rows, plus the record index,
 * revision map and idempotency rows derived from the repository. Derived rows
 * are written in the same batch that moves `head_commit`, guarded by the head
 * the write started from; when the guard fails, `reconcileVault` replays the
 * repository into D1 instead.
 */
export type VaultScopeKind = "dm" | "group" | "project";

export type VaultRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  scope_kind: VaultScopeKind;
  scope_key: string;
  owner_user_id: string | null;
  dm_space_id: string | null;
  repo_name: string;
  generation: number;
  head_commit: string | null;
  synced_at: string | null;
  state: "active" | "purging";
  created_at: string;
  updated_at: string;
};

export type VaultRecordRow = {
  vault_id: string;
  record_id: string;
  record_type: RecordType;
  path: string;
  status: string | null;
  aliases_json: string;
  revision: number;
  commit_sha: string;
  protected_by_user: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type VaultKey = {
  readonly organizationId: string;
  readonly agentId: string;
  readonly scopeKind: VaultScopeKind;
  readonly scopeKey: string;
};

export const vaultRepoName = (vaultId: string, generation: number) =>
  `mv-${vaultId.replaceAll("-", "")}-g${generation}`;

export const VAULT_REPO_NAME = /^mv-([0-9a-f]{32})-g(\d+)$/u;

export const vaultIdFromHex = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

export async function findVault(db: D1Database, key: VaultKey) {
  return db.prepare(`select * from briar_memory_vaults
    where organization_id = ? and agent_id = ? and scope_kind = ? and scope_key = ?`)
    .bind(key.organizationId, key.agentId, key.scopeKind, key.scopeKey).first<VaultRow>();
}

export async function getVault(db: D1Database, vaultId: string) {
  return db.prepare(`select * from briar_memory_vaults where id = ?`).bind(vaultId).first<VaultRow>();
}

/** Inserts the vault row if missing and returns the row that owns the key. */
export async function ensureVaultRow(db: D1Database, key: VaultKey & {
  readonly ownerUserId: string | null;
  readonly dmSpaceId: string | null;
}, now: string) {
  const id = crypto.randomUUID();
  await db.prepare(`insert into briar_memory_vaults
      (id, organization_id, agent_id, scope_kind, scope_key, owner_user_id, dm_space_id,
       repo_name, generation, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    on conflict (organization_id, agent_id, scope_kind, scope_key) do nothing`)
    .bind(id, key.organizationId, key.agentId, key.scopeKind, key.scopeKey, key.ownerUserId,
      key.dmSpaceId, vaultRepoName(id, 1), now, now)
    .run();
  const row = await findVault(db, key);
  if (!row) throw new Error("Memory vault row was not created");
  return row;
}

export type RecordUpsert = {
  readonly recordId: string;
  readonly type: RecordType;
  readonly path: string;
  readonly status: string | null;
  readonly aliases: readonly string[];
  readonly revision: number;
  readonly commit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** true/false sets protection (owner writes from the app); null keeps it. */
  readonly protectedByUser: boolean | null;
};

export type RevisionInsert = {
  readonly recordId: string;
  readonly revision: number;
  readonly commit: string;
  readonly path: string;
  readonly actor: string;
  readonly createdAt: string;
};

export type RequestInsert = {
  readonly requestId: string;
  readonly payloadHash: string;
  readonly commit: string | null;
  readonly result: unknown;
  readonly createdAt: string;
};

export type DerivedChanges = {
  readonly records: readonly RecordUpsert[];
  readonly deletedRecords: readonly string[];
  readonly revisions: readonly RevisionInsert[];
  readonly requests: readonly RequestInsert[];
};

/** Statements that apply derived rows only while the vault head is `head`. */
function derivedStatements(db: D1Database, vaultId: string, head: string, changes: DerivedChanges, now: string) {
  const atHead = `exists (select 1 from briar_memory_vaults where id = ? and head_commit = ?)`;
  return [
    ...changes.records.map((record) => db.prepare(`insert into briar_memory_vault_records
        (vault_id, record_id, record_type, path, status, aliases_json, revision, commit_sha,
         protected_by_user, created_at, updated_at, deleted_at)
      select ?, ?, ?, ?, ?, ?, ?, ?, coalesce(?, 0), ?, ?, null where ${atHead}
      on conflict (vault_id, record_id) do update set record_type = excluded.record_type,
        path = excluded.path, status = excluded.status, aliases_json = excluded.aliases_json,
        revision = excluded.revision, commit_sha = excluded.commit_sha,
        protected_by_user = case when ? is null then briar_memory_vault_records.protected_by_user else excluded.protected_by_user end,
        created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = null`)
      .bind(vaultId, record.recordId, record.type, record.path, record.status,
        JSON.stringify(record.aliases), record.revision, record.commit,
        record.protectedByUser === null ? null : record.protectedByUser ? 1 : 0,
        record.createdAt, record.updatedAt, vaultId, head,
        record.protectedByUser === null ? null : 1)),
    ...changes.deletedRecords.map((recordId) => db.prepare(`update briar_memory_vault_records
      set deleted_at = coalesce(deleted_at, ?) where vault_id = ? and record_id = ? and ${atHead}`)
      .bind(now, vaultId, recordId, vaultId, head)),
    ...changes.revisions.map((revision) => db.prepare(`insert into briar_memory_vault_revisions
        (vault_id, record_id, revision, commit_sha, path, actor, created_at)
      select ?, ?, ?, ?, ?, ?, ? where ${atHead}
      on conflict (vault_id, record_id, revision) do nothing`)
      .bind(vaultId, revision.recordId, revision.revision, revision.commit, revision.path,
        revision.actor, revision.createdAt, vaultId, head)),
    ...changes.requests.map((request) => db.prepare(`insert into briar_memory_vault_requests
        (vault_id, request_id, payload_hash, commit_sha, result_json, created_at)
      select ?, ?, ?, ?, ?, ? where ${atHead}
      on conflict (vault_id, request_id) do nothing`)
      .bind(vaultId, request.requestId, request.payloadHash, request.commit,
        JSON.stringify(request.result), request.createdAt, vaultId, head)),
  ];
}

/**
 * Moves the vault head from `base` to `commit` and applies the derived rows,
 * atomically. Returns false when D1 was not at `base` (a concurrent writer or a
 * lost update); the caller then reconciles.
 */
export async function recordVaultCommit(db: D1Database, vault: VaultRow, input: {
  readonly base: string | null;
  readonly commit: string;
  readonly changes: DerivedChanges;
  readonly now: string;
}) {
  const [moved] = await db.batch([
    db.prepare(`update briar_memory_vaults set head_commit = ?, synced_at = ?, updated_at = ?
      where id = ? and generation = ? and state = 'active' and head_commit is ?`)
      .bind(input.commit, input.now, input.now, vault.id, vault.generation, input.base),
    ...derivedStatements(db, vault.id, input.commit, input.changes, input.now),
  ]);
  return (moved.meta.changes ?? 0) === 1;
}

export async function storeRequestResult(db: D1Database, vaultId: string, request: RequestInsert) {
  await db.prepare(`insert into briar_memory_vault_requests
      (vault_id, request_id, payload_hash, commit_sha, result_json, created_at)
    values (?, ?, ?, ?, ?, ?) on conflict (vault_id, request_id) do nothing`)
    .bind(vaultId, request.requestId, request.payloadHash, request.commit,
      JSON.stringify(request.result), request.createdAt)
    .run();
}

export async function findRequest(db: D1Database, vaultId: string, requestId: string) {
  return db.prepare(`select payload_hash, result_json from briar_memory_vault_requests
    where vault_id = ? and request_id = ?`)
    .bind(vaultId, requestId).first<{ payload_hash: string; result_json: string }>();
}

/** The result a `save`/`journal` returned, rebuilt from a commit's trailers. */
export function requestResultFromTrailers(trailers: VaultTrailers, commit: string) {
  if (trailers.operation === "journal") {
    const record = trailers.records[0];
    return {
      operation: "journal",
      id: record?.recordId ?? "",
      path: record?.path ?? "",
      revision: record?.revision ?? 0,
      commit,
      line: trailers.journalLine ?? "",
      deduplicated: false,
      replayed: false,
    };
  }
  // Lines a playbook/voice save trimmed are not in the commit; a replay after a
  // lost D1 update reports none.
  const record = trailers.records[0];
  return {
    operation: "save",
    id: record?.recordId ?? "",
    type: record ? parseRecordPath(record.path)?.type ?? null : null,
    path: record?.path ?? "",
    revision: record?.revision ?? 0,
    commit,
    droppedLines: [],
    replayed: false,
  };
}

const RECONCILE_HISTORY_LIMIT = 500;

/**
 * Makes D1 match the repository head (spec §13). Cheap when nothing changed:
 * one ref discovery. On a mismatch, replays the missing commits' trailers into
 * revisions and idempotency rows and rebuilds the record index from the head
 * tree's frontmatter. Control data (protection) is preserved.
 */
export async function reconcileVault(
  db: D1Database,
  store: VaultGitStore,
  vault: VaultRow,
  now: () => string,
  depth = 0,
): Promise<VaultRow> {
  let remoteHead: string | null;
  try {
    remoteHead = await store.head(vault.repo_name);
  } catch (error) {
    // A vault row is written before its repository exists; nothing to sync yet.
    if (error instanceof VaultRepoNotFoundError && vault.head_commit === null) return vault;
    throw error;
  }
  if (remoteHead === vault.head_commit) return vault;
  if (remoteHead === null) {
    throw new Error(`Memory repository ${vault.repo_name} lost its history`);
  }
  const commits: VaultCommit[] = await store.history(vault.repo_name, {
    stopAt: vault.head_commit,
    limit: RECONCILE_HISTORY_LIMIT,
  });
  const snapshot = await store.snapshot(vault.repo_name, remoteHead);
  const timestamp = now();
  const revisions: RevisionInsert[] = [];
  const requests: RequestInsert[] = [];
  const latestCommit = new Map<string, string>();
  // Oldest first, so the newest commit naming a record revision wins.
  for (const commit of [...commits].reverse()) {
    const trailers = parseVaultCommitMessage(commit.message);
    if (!trailers || trailers.vaultId !== vault.id) continue;
    for (const record of trailers.records) {
      if (record.revision === 0) continue;
      revisions.push({ recordId: record.recordId, revision: record.revision, commit: commit.oid,
        path: record.path, actor: trailers.actor, createdAt: commit.authoredAt });
      latestCommit.set(`${record.recordId}@${record.revision}`, commit.oid);
    }
    if (trailers.requestId && trailers.payloadHash && (trailers.operation === "save" || trailers.operation === "journal")) {
      requests.push({ requestId: trailers.requestId, payloadHash: trailers.payloadHash, commit: commit.oid,
        result: requestResultFromTrailers(trailers, commit.oid), createdAt: commit.authoredAt });
    }
  }
  const existing = (await db.prepare(`select * from briar_memory_vault_records where vault_id = ?`)
    .bind(vault.id).all<VaultRecordRow>()).results;
  const existingById = new Map(existing.map((row) => [row.record_id, row]));
  const records: RecordUpsert[] = [];
  const present = new Set<string>();
  const files = [...snapshot.files].sort(([left], [right]) =>
    // Canonical paths win over legacy workstream paths for the same id.
    Number(left.startsWith("workstreams/active/") || left.startsWith("workstreams/completed/")) -
    Number(right.startsWith("workstreams/active/") || right.startsWith("workstreams/completed/")) ||
    left.localeCompare(right));
  for (const [path, content] of files) {
    if (path === README_PATH) continue;
    const described = describeRecordFile(path, content);
    if (!described || present.has(described.id)) continue;
    present.add(described.id);
    const known = existingById.get(described.id);
    const commit = latestCommit.get(`${described.id}@${described.revision}`) ??
      (known && known.revision === described.revision && !known.deleted_at ? known.commit_sha : remoteHead);
    records.push({
      recordId: described.id,
      type: described.type,
      path,
      status: described.status,
      aliases: described.aliases,
      revision: described.revision,
      commit,
      createdAt: described.createdAt ?? known?.created_at ?? timestamp,
      updatedAt: described.updatedAt ?? known?.updated_at ?? timestamp,
      protectedByUser: null,
    });
  }
  const deletedRecords = existing
    .filter((row) => row.deleted_at === null && !present.has(row.record_id))
    .map((row) => row.record_id);
  const [moved] = await db.batch([
    db.prepare(`update briar_memory_vaults set head_commit = ?, synced_at = ?, updated_at = ?
      where id = ? and generation = ? and head_commit is ?`)
      .bind(remoteHead, timestamp, timestamp, vault.id, vault.generation, vault.head_commit),
    ...derivedStatements(db, vault.id, remoteHead, { records, deletedRecords, revisions, requests }, timestamp),
  ]);
  const current = await getVault(db, vault.id);
  if (!current) throw new Error("Memory vault disappeared during sync");
  if ((moved.meta.changes ?? 0) !== 1 && current.head_commit !== remoteHead) {
    // Someone else moved D1 meanwhile; converge on whatever is newest.
    if (depth >= 3) throw new Error("Memory vault sync did not converge");
    return reconcileVault(db, store, current, now, depth + 1);
  }
  return current;
}
