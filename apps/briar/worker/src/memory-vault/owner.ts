import type {
  DmMemoryClass,
  DmMemoryDocument,
  DmMemoryDocumentDetail,
  DmMemoryRevisionPage,
} from "../../../src/lib/dm-memory-contract";
import { dmMemoryPageSize } from "../../../src/lib/dm-memory-contract";
import { sha256 } from "../crypto-digest";
import { HttpError } from "../http-response";
import { MemoryVaultError } from "./errors";
import { forgetMemoryVaultRecord } from "./forget";
import { VaultCommitNotFoundError, type VaultGitStore } from "./git-store";
import { vaultRecordHandle, vaultRecordHandles } from "./handles";
import {
  commitWithRetry,
  locateRecord,
  openVaultForWrite,
  recordCommitted,
  replayedResult,
  requireStore,
  withStore,
} from "./operations";
import { MEMORY_VAULT_README } from "./readme";
import {
  README_PATH,
  describeRecordFile,
  frontmatterTime,
  isValidRecordId,
  normalizeRecordBody,
  parseRecordPath,
  recordPath,
  renderRecordFile,
  type RecordType,
} from "./records";
import { assertNoSecrets } from "./secret-detector";
import { vaultCommitMessage } from "./trailers";
import type { RecordUpsert, RevisionInsert, VaultRecordRow, VaultRow } from "./vault-repository";

/**
 * Owner operations on a DM vault (spec §9): the app's DM memory dialog keeps
 * its `DmMemoryService` shapes and is served from the vault once
 * `MEMORY_VAULT_ENABLED` is on. The caller (`app-connect-dm-memory.ts`) has
 * already authorized the owner exactly as before (`ownerFor`) and passes the
 * owner's own spaces; nothing here widens who may see a space.
 *
 * Mapping to the legacy document shape:
 * - `id` is the record's handle (`handles.ts`); a legacy document id that the
 *   migration mapped to a record also resolves, so old citations still open.
 * - `title` is the body's leading `# ` heading (how the app and the migration
 *   store a title), else the record id; the heading is not repeated in `body`.
 * - `memoryClass`: `person` → profile, `timeline-*` → log, anything else → note.
 *   Creating a profile writes a `person` record; a note or log, a `fact`.
 * - `version` is the record revision; revisions come from the D1 revision map.
 * - Validity (`observedAt`/`validUntil`), language and sources are not part of
 *   a vault record: they are accepted on write and come back empty.
 */
export type OwnerVaultDeps = {
  readonly db: D1Database;
  readonly store: VaultGitStore | null;
  readonly now?: () => Date;
};

export type OwnerSpace = {
  readonly id: string;
  readonly organization_id: string;
  readonly channel_id: string;
  readonly owner_user_id: string;
  readonly agent_id: string;
  readonly status: "active" | "closed";
};

const clock = (deps: OwnerVaultDeps) => deps.now?.() ?? new Date();

const notFound = () => new HttpError(404, "Memory not found", "memory_not_found");
const versionConflict = () => new HttpError(409, "Memory changed; reload it", "version_conflict");

export const vaultForSpace = (db: D1Database, spaceId: string) =>
  db.prepare(`select * from briar_memory_vaults where dm_space_id = ? and scope_kind = 'dm'`)
    .bind(spaceId).first<VaultRow>();

const memoryClassOf = (type: RecordType): DmMemoryClass =>
  type === "person" ? "profile"
    : type === "timeline-daily" || type === "timeline-weekly" || type === "timeline-monthly" ? "log"
    : "note";

const typeForClass = (memoryClass: DmMemoryClass): RecordType => memoryClass === "profile" ? "person" : "fact";

const TITLE_LINE = /^# ([^\n]{1,200})\n(?:\n)?/u;

/** The owner-facing title and body of a stored record body. */
export function splitOwnerTitle(body: string, recordId: string) {
  const match = TITLE_LINE.exec(body);
  return match ? { title: match[1]!.trim(), body: body.slice(match[0].length) } : { title: recordId, body };
}

/** Stores an owner title as the body's leading heading, as the migration does. */
export const joinOwnerTitle = (title: string, body: string) =>
  `# ${title.replace(/\s+/gu, " ").trim()}\n\n${body.replace(/^\n+/u, "")}`;

/** A record id from a title: ASCII slug, else `memory`; never a reserved id. */
export function recordIdFromTitle(title: string) {
  const slug = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "")
    .slice(0, 50).replace(/-+$/u, "");
  return slug && isValidRecordId(slug) && slug !== "readme" && slug !== "playbook" ? slug : "memory";
}

type ResolvedRecord = { readonly row: VaultRecordRow; readonly revision: number | null };

/**
 * A document id from the app → the vault record: the record's handle, or a
 * legacy document id the migration mapped (with the mapped revision when the
 * app asks for a legacy version).
 */
async function resolveRecord(db: D1Database, vault: VaultRow, documentId: string, options: {
  readonly version?: number;
  readonly includeDeleted?: boolean;
} = {}): Promise<ResolvedRecord | null> {
  const rows = (await db.prepare(`select * from briar_memory_vault_records where vault_id = ?
      and (? = 1 or deleted_at is null)`)
    .bind(vault.id, options.includeDeleted ? 1 : 0).all<VaultRecordRow>()).results;
  const handles = await vaultRecordHandles(vault.id, rows.map((row) => row.record_id));
  const byHandle = handles.get(documentId.toLowerCase());
  if (byHandle) {
    const row = rows.find((candidate) => candidate.record_id === byHandle)!;
    return { row, revision: options.version ?? null };
  }
  const mapped = await db.prepare(`select record_id, revision from briar_memory_vault_legacy_map
    where vault_id = ? and document_id = ? and (? is null or document_version = ?)
    order by document_version desc limit 1`)
    .bind(vault.id, documentId.toLowerCase(), options.version ?? null, options.version ?? null)
    .first<{ record_id: string; revision: number }>();
  const row = mapped ? rows.find((candidate) => candidate.record_id === mapped.record_id) : undefined;
  if (!mapped || !row) return null;
  return { row, revision: options.version === undefined ? null : mapped.revision };
}

/** Finds which of the owner's spaces holds the document. */
async function locate(db: D1Database, spaces: readonly OwnerSpace[], documentId: string, options: {
  readonly version?: number;
  readonly includeDeleted?: boolean;
} = {}) {
  for (const space of spaces) {
    const vault = await vaultForSpace(db, space.id);
    if (!vault) continue;
    const resolved = await resolveRecord(db, vault, documentId, options);
    if (resolved) return { space, vault, ...resolved };
  }
  return null;
}

async function documentOf(space: OwnerSpace, vault: VaultRow, row: VaultRecordRow, title: string): Promise<DmMemoryDocument> {
  return {
    id: await vaultRecordHandle(vault.id, row.record_id),
    memorySpaceId: space.id,
    kind: "observation",
    title,
    version: row.revision,
    status: "active",
    conflicted: false,
    memoryClass: memoryClassOf(row.record_type),
    evidenceType: row.protected_by_user === 1 ? "explicit_user" : "observed",
    protectedByUser: row.protected_by_user === 1,
    sourceLanguage: "und",
    observedAt: null,
    validUntil: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexState: "ready",
  };
}

/**
 * One page of the space's records from the D1 index, newest id order like the
 * legacy list (by id). No Artifacts call: the dialog polls this every few
 * seconds, and the index moves in the same D1 batch as the vault head.
 */
export async function listOwnerVaultDocuments(db: D1Database, space: OwnerSpace, cursor: string | undefined) {
  const vault = await vaultForSpace(db, space.id);
  if (!vault) return { documents: [] as DmMemoryDocument[], nextCursor: null };
  const rows = (await db.prepare(`select * from briar_memory_vault_records
    where vault_id = ? and deleted_at is null and record_id > ? order by record_id limit ?`)
    .bind(vault.id, cursor ?? "", dmMemoryPageSize + 1).all<VaultRecordRow>()).results;
  const page = rows.slice(0, dmMemoryPageSize);
  return {
    documents: await Promise.all(page.map((row) => documentOf(space, vault, row, row.record_id))),
    nextCursor: rows.length > dmMemoryPageSize ? page.at(-1)!.record_id : null,
  };
}

export async function getOwnerVaultDocument(deps: OwnerVaultDeps, spaces: readonly OwnerSpace[], documentId: string,
  version?: number): Promise<DmMemoryDocumentDetail> {
  const found = await locate(deps.db, spaces, documentId, { version });
  if (!found) throw notFound();
  const { space, vault, row } = found;
  const revision = found.revision ?? row.revision;
  let commit = row.commit_sha;
  let path = row.path;
  if (revision !== row.revision) {
    const old = await deps.db.prepare(`select commit_sha, path from briar_memory_vault_revisions
      where vault_id = ? and record_id = ? and revision = ?`)
      .bind(vault.id, row.record_id, revision).first<{ commit_sha: string; path: string }>();
    if (!old) throw new HttpError(404, "Memory revision not found", "memory_not_found");
    commit = old.commit_sha;
    path = old.path;
  }
  const store = requireStore(deps);
  const content = await withStore("owner read", async () => {
    try {
      return await store.readFile(vault.repo_name, commit, path);
    } catch (error) {
      if (error instanceof VaultCommitNotFoundError) return null;
      throw error;
    }
  });
  const described = content === null ? null : describeRecordFile(path, content);
  if (!described) throw notFound();
  // A concurrent forget must not return the body it just removed.
  const current = await deps.db.prepare(`select 1 from briar_memory_vault_records
    where vault_id = ? and record_id = ? and deleted_at is null`).bind(vault.id, row.record_id).first();
  if (!current) throw notFound();
  const split = splitOwnerTitle(described.body, row.record_id);
  const document = await documentOf(space, vault, row, split.title);
  return {
    ...document,
    version: revision,
    memoryClass: memoryClassOf(described.type),
    updatedAt: described.updatedAt ?? row.updated_at,
    body: split.body,
    sources: [],
  };
}

export async function listOwnerVaultRevisions(db: D1Database, spaces: readonly OwnerSpace[], documentId: string,
  beforeVersion?: number): Promise<DmMemoryRevisionPage> {
  const found = await locate(db, spaces, documentId);
  if (!found) throw notFound();
  const { vault, row } = found;
  const rows = (await db.prepare(`select revision, path, actor, created_at from briar_memory_vault_revisions
    where vault_id = ? and record_id = ? and revision < ? order by revision desc limit 21`)
    .bind(vault.id, row.record_id, beforeVersion ?? row.revision + 1)
    .all<{ revision: number; path: string; actor: string; created_at: string }>()).results;
  const page = rows.slice(0, 20);
  return {
    documentId: await vaultRecordHandle(vault.id, row.record_id),
    currentVersion: row.revision,
    revisions: page.map((revision) => ({
      version: revision.revision,
      createdAt: revision.created_at,
      memoryClass: memoryClassOf(parseRecordPath(revision.path)?.type ?? row.record_type),
      protectedByUser: revision.actor.startsWith("user:"),
      validUntil: null,
      origin: revision.actor.startsWith("user:") ? "user_edit" : "extract",
    })),
    nextCursor: rows.length > 20 ? page.at(-1)!.revision : null,
  };
}

/** Maps vault refusals to the codes the dialog already understands. */
function ownerError(error: unknown): never {
  if (error instanceof MemoryVaultError) {
    if (error.vaultCode === "revision_conflict" || error.vaultCode === "expected_revision_required") throw versionConflict();
    if (error.vaultCode === "not_found") throw notFound();
  }
  throw error;
}

type OwnerSaveResult = { readonly recordId: string; readonly revision: number; readonly commit: string };

/**
 * Create or update as the owner: a `save` commit with actor `user:<id>`,
 * protected from agent edits (`protected_by_user = 1`), with the DM opt-in
 * semantics of the legacy save — the first save turns recall on, and editing
 * an existing memory ends resumed conversations that saw the old text.
 */
export async function saveOwnerVaultRecord(deps: OwnerVaultDeps, input: {
  /** Where a new record goes; an update stays in the space that holds its record. */
  readonly space: OwnerSpace | null;
  /** Every space of the owner in this channel, to resolve an update's document id. */
  readonly spaces: readonly OwnerSpace[];
  readonly userId: string;
  readonly requestId: string;
  readonly documentId: string | null;
  readonly expectedVersion: number | null;
  readonly title: string;
  readonly body: string;
  readonly memoryClass: DmMemoryClass;
}) {
  const existing = input.documentId === null
    ? null
    : await locate(deps.db, input.spaces, input.documentId);
  if (input.documentId !== null && !existing) throw notFound();
  const space = existing?.space ?? input.space;
  if (!space || (input.space && existing && input.space.id !== existing.space.id)) throw notFound();
  const live = await deps.db.prepare(`select 1 from briar_dm_memory_spaces space
    join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
      and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
      and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
    where space.id = ? and space.status = 'active'`).bind(space.id).first();
  if (!live) throw new HttpError(409, "An active one-user, one-Agent DM is required", "memory_scope_revoked");
  const body = normalizeRecordBody(joinOwnerTitle(input.title, input.body.replace(/\r\n?/gu, "\n")));
  assertNoSecrets(body);
  const vault = existing?.vault ?? await openVaultForWrite(deps, {
    organizationId: space.organization_id,
    agentId: space.agent_id,
    scopeKind: "dm",
    scopeKey: space.id,
    ownerUserId: space.owner_user_id,
    dmSpaceId: space.id,
  });
  if (vault.state === "purging") throw new MemoryVaultError("busy", "Memory is busy; retry shortly");
  const requestKey = `owner:${input.requestId}`;
  const payloadHash = await sha256(JSON.stringify({
    operation: "owner-save", documentId: input.documentId, expectedVersion: input.expectedVersion,
    title: input.title, body, memoryClass: input.memoryClass,
  }));
  const replay = await replayedResult<OwnerSaveResult>(deps, vault.id, requestKey, payloadHash).catch(ownerError);
  if (replay) {
    return { documentId: await vaultRecordHandle(vault.id, replay.recordId), version: replay.revision, replayed: true };
  }
  if (existing && input.expectedVersion !== existing.row.revision) throw versionConflict();
  let recordId = existing?.row.record_id ?? null;
  if (recordId === null) {
    const base = recordIdFromTitle(input.title);
    const taken = await deps.db.prepare(`select 1 from briar_memory_vault_records where vault_id = ? and record_id = ?`)
      .bind(vault.id, base).first();
    recordId = taken ? `${base}-${(await sha256(input.requestId)).slice(0, 8)}` : base;
  }
  const targetId = recordId;
  const actor = `user:${input.userId}`;
  const outcome = await commitWithRetry<OwnerSaveResult>(deps, vault, async (head) => {
    const now = clock(deps);
    const timestamp = frontmatterTime(now);
    const current = locateRecord(head.files, targetId);
    if (existing ? current?.revision !== input.expectedVersion : current !== null) {
      throw new MemoryVaultError("revision_conflict", "The memory changed; reload it");
    }
    // Keep the record's own type unless the owner moved it to another class.
    const type: RecordType = current && memoryClassOf(current.type) === input.memoryClass
      ? current.type
      : typeForClass(input.memoryClass);
    const revision = (current?.revision ?? 0) + 1;
    const path = recordPath(type, targetId);
    const files = new Map(head.files);
    if (current && current.path !== path) files.delete(current.path);
    const status = type === "workstream" ? current?.status ?? "active" : null;
    const aliases = current?.aliases ?? [];
    const createdAt = current?.createdAt ?? timestamp;
    files.set(path, renderRecordFile({ id: targetId, type, status, aliases, revision, createdAt, updatedAt: timestamp }, body));
    if (files.get(README_PATH) !== MEMORY_VAULT_README) files.set(README_PATH, MEMORY_VAULT_README);
    const records: Omit<RecordUpsert, "commit">[] = [{
      recordId: targetId, type, path, status, aliases, revision, createdAt, updatedAt: timestamp, protectedByUser: true,
    }];
    const revisions: Omit<RevisionInsert, "commit">[] = [{ recordId: targetId, revision, path, actor, createdAt: timestamp }];
    return {
      kind: "commit",
      files,
      message: vaultCommitMessage(`memory: save ${targetId} r${revision}`, {
        vaultId: vault.id, operation: "save", requestId: requestKey, payloadHash, actor, claim: null,
        records: [{ recordId: targetId, path, revision }], journalLine: null,
      }),
      timestamp: Math.floor(now.getTime() / 1000),
      value: { result: { recordId: targetId, revision, commit: "" }, records, revisions },
    };
  }).catch(ownerError);
  if (outcome.kind !== "committed") throw new Error("An owner save always commits");
  const result = { ...outcome.value.result, commit: outcome.commit };
  await recordCommitted(deps, vault, outcome, { requestId: requestKey, payloadHash, result });
  // Reconcile never clears protection, so a lost-race replay keeps the owner's flag.
  await deps.db.prepare(`update briar_memory_vault_records set protected_by_user = 1
    where vault_id = ? and record_id = ? and revision = ?`).bind(vault.id, targetId, result.revision).run();
  await deps.db.prepare(`update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
      revocation_epoch = revocation_epoch + ?,
      use_enabled = case when ever_saved = 0 then 1 else use_enabled end, ever_saved = 1, updated_at = ?
    where id = ?`)
    .bind(existing ? 1 : 0, clock(deps).toISOString(), space.id).run();
  return { documentId: await vaultRecordHandle(vault.id, targetId), version: result.revision, replayed: false };
}

/**
 * Forget as the owner (spec §10): the record leaves the head now, its D1
 * revisions, claim reads and citations go, the space's revocation epoch moves,
 * legacy documents mapped to it are purged, and the scheduled purge job
 * rebuilds history without it. Repeating it reports the purge state.
 */
export async function forgetOwnerVaultRecord(deps: OwnerVaultDeps, spaces: readonly OwnerSpace[], userId: string,
  documentId: string) {
  const found = await locate(deps.db, spaces, documentId, { includeDeleted: true });
  if (!found) throw notFound();
  if (found.row.deleted_at === null) {
    await forgetMemoryVaultRecord({ db: deps.db, store: requireStore(deps), now: deps.now }, {
      vaultId: found.vault.id, recordId: found.row.record_id, actor: `user:${userId}`,
    }).catch(ownerError);
  }
  const open = await deps.db.prepare(`select 1 from briar_memory_vault_purges
    where vault_id = ? and completed_at is null limit 1`).bind(found.vault.id).first();
  return { deleted: true, purgeState: open ? "pending" : "complete" } as const;
}

/** The export: a manifest and every file of the head tree, README included. */
export async function* exportOwnerVaultEntries(deps: OwnerVaultDeps, space: OwnerSpace):
  AsyncGenerator<{ name: string; content: string }> {
  const vault = await vaultForSpace(deps.db, space.id);
  const store = vault?.head_commit ? requireStore(deps) : null;
  const snapshot = vault && store
    ? await withStore("owner export", () => store.snapshot(vault.repo_name, vault.head_commit!))
    : null;
  yield { name: "manifest.json", content: JSON.stringify({
    format: "briar-memory-vault", version: 1, memorySpaceId: space.id, vaultId: vault?.id ?? null,
    head: snapshot?.commit ?? null, exportedAt: clock(deps).toISOString(),
    entries: "the vault's files at head, at their repository paths",
    warning: "Exported copies are not recalled by server-side deletion.",
  }, null, 2) };
  for (const path of [...snapshot?.files.keys() ?? []].sort()) {
    yield { name: path, content: snapshot!.files.get(path)! };
  }
}
