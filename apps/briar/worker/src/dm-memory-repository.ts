import type {
  DmMemoryCreateInput,
  DmMemoryDocument,
  DmMemoryDocumentDetail,
  DmMemoryEditInput,
  DmMemoryPage,
  DmMemorySettingsInput,
  DmMemorySource,
  DmMemorySpace,
} from "../../src/lib/dm-memory-contract";
import { dmMemoryPageSize } from "../../src/lib/dm-memory-contract";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";

export type DmMemoryOwner = { organizationId: string; channelId: string; userId: string };
type SpaceRow = {
  id: string; organization_id: string; channel_id: string; owner_user_id: string;
  agent_id: string; roster_epoch: number; status: "active" | "closed";
  use_enabled: number; auto_enabled: number; ever_saved: number;
  memory_revision: number; revocation_epoch: number; created_at: string; updated_at: string;
};
type DocumentRow = {
  id: string; space_id: string; kind: DmMemoryDocument["kind"]; title: string;
  current_version: number; status: DmMemoryDocument["status"]; conflicted: number;
  body: string; memory_class: DmMemoryDocument["memoryClass"];
  evidence_type: DmMemoryDocument["evidenceType"]; protected_by_user: number;
  source_language: string; observed_at: string | null; valid_until: string | null;
  created_at: string; updated_at: string; index_status: string | null;
};
type CommitRow = {
  id: string; document_id: string | null; payload_hash: string | null;
  result_version: number | null; applied: number;
};

export const dmMemorySpaceJson = (space: SpaceRow): DmMemorySpace => ({
  id: space.id, channelId: space.channel_id, agentId: space.agent_id,
  rosterEpoch: space.roster_epoch, status: space.status,
  useEnabled: space.use_enabled === 1, autoEnabled: space.auto_enabled === 1,
  memoryRevision: space.memory_revision, revocationEpoch: space.revocation_epoch,
  createdAt: space.created_at, updatedAt: space.updated_at,
});

const ownerWhere = `space.organization_id = ? and space.channel_id = ? and space.owner_user_id = ?
  and exists (select 1 from briar_organization_members member
    where member.organization_id = space.organization_id and member.user_id = space.owner_user_id)`;
const ownerBindings = (owner: DmMemoryOwner) => [owner.organizationId, owner.channelId, owner.userId];
const liveSpaceWhere = `space.status = 'active' and exists (
  select 1 from briar_dm_memory_live_rosters live
  where live.organization_id = space.organization_id and live.channel_id = space.channel_id
    and live.owner_user_id = space.owner_user_id and live.agent_id = space.agent_id
    and live.roster_epoch = space.roster_epoch
)`;

export async function listDmMemorySpaces(db: D1Database, owner: DmMemoryOwner) {
  const { results } = await db.prepare(`select space.* from briar_dm_memory_spaces space
    where ${ownerWhere} order by space.roster_epoch desc, space.id`)
    .bind(...ownerBindings(owner)).all<SpaceRow>();
  return results;
}

async function requireSpace(db: D1Database, owner: DmMemoryOwner, spaceId: string) {
  const row = await db.prepare(`select space.* from briar_dm_memory_spaces space
    where ${ownerWhere} and space.id = ?`).bind(...ownerBindings(owner), spaceId).first<SpaceRow>();
  if (!row) throw new HttpError(404, "Memory space not found", "memory_not_found");
  return row;
}

async function ensureWriteSpace(db: D1Database, owner: DmMemoryOwner, spaceId?: string) {
  if (spaceId) return requireSpace(db, owner, spaceId);
  const now = new Date().toISOString();
  await db.prepare(`insert into briar_dm_memory_spaces (
    id, organization_id, channel_id, owner_user_id, agent_id, roster_epoch, created_at, updated_at
  ) select ?, organization_id, channel_id, owner_user_id, agent_id, roster_epoch, ?, ?
    from briar_dm_memory_live_rosters
    where organization_id = ? and channel_id = ? and owner_user_id = ?
    on conflict (organization_id, channel_id, owner_user_id, agent_id, roster_epoch) do nothing`)
    .bind(crypto.randomUUID(), now, now, ...ownerBindings(owner)).run();
  const row = await db.prepare(`select space.* from briar_dm_memory_spaces space
    where ${ownerWhere} and ${liveSpaceWhere}`)
    .bind(...ownerBindings(owner)).first<SpaceRow>();
  if (!row) throw new HttpError(409, "An active one-user, one-Agent DM is required", "memory_scope_revoked");
  return row;
}

const documentSelect = `select doc.*, rev.body, rev.memory_class, rev.evidence_type,
  rev.protected_by_user, rev.source_language, rev.observed_at, rev.valid_until,
  (select job.status from briar_dm_memory_jobs job where job.space_id = doc.space_id
    and job.document_id = doc.id and job.document_version = doc.current_version
    and job.kind = 'index' order by job.created_at desc limit 1) as index_status
  from briar_dm_memory_documents doc
  join briar_dm_memory_spaces space on space.id = doc.space_id
  join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version`;
const documentJson = (row: DocumentRow): DmMemoryDocument => ({
  id: row.id, memorySpaceId: row.space_id, kind: row.kind, title: row.title,
  version: row.current_version, status: row.status, conflicted: row.conflicted === 1,
  memoryClass: row.memory_class, evidenceType: row.evidence_type,
  protectedByUser: row.protected_by_user === 1, sourceLanguage: row.source_language,
  observedAt: row.observed_at, validUntil: row.valid_until,
  createdAt: row.created_at, updatedAt: row.updated_at,
  indexState: row.index_status === "succeeded" ? "ready"
    : row.index_status === "failed" ? "failed" : "pending",
});

export async function listDmMemories(
  db: D1Database, owner: DmMemoryOwner, spaceId?: string, cursor?: string,
): Promise<DmMemoryPage> {
  const spaces = await listDmMemorySpaces(db, owner);
  const eligible = await db.prepare(`select 1 as found from briar_dm_memory_live_rosters
    where organization_id = ? and channel_id = ? and owner_user_id = ?`)
    .bind(...ownerBindings(owner)).first();
  const selected = spaceId ? spaces.find((space) => space.id === spaceId) : spaces[0];
  if (spaceId && !selected) throw new HttpError(404, "Memory space not found", "memory_not_found");
  const rows = selected ? (await db.prepare(`${documentSelect}
    where ${ownerWhere} and space.id = ? and doc.status <> 'deleted' and doc.id > ?
    order by doc.id limit ?`).bind(...ownerBindings(owner), selected.id, cursor ?? "", dmMemoryPageSize + 1)
    .all<DocumentRow>()).results : [];
  const page = rows.slice(0, dmMemoryPageSize);
  return {
    eligible: eligible !== null, capabilities: { recall: false, automaticLearning: false },
    spaces: spaces.map(dmMemorySpaceJson), selectedSpaceId: selected?.id ?? null,
    documents: page.map(documentJson),
    nextCursor: rows.length > dmMemoryPageSize ? page.at(-1)?.id ?? null : null,
  };
}

export async function getDmMemory(
  db: D1Database, owner: DmMemoryOwner, documentId: string,
): Promise<DmMemoryDocumentDetail> {
  const row = await db.prepare(`${documentSelect}
    where ${ownerWhere} and doc.id = ? and doc.status <> 'deleted'`)
    .bind(...ownerBindings(owner), documentId).first<DocumentRow>();
  if (!row) throw new HttpError(404, "Memory not found", "memory_not_found");
  const sources = await db.prepare(`select source_type as type, source_id as id, source_version as version
    from briar_dm_memory_sources where document_id = ? and document_version = ?
    order by source_type, source_id`).bind(row.id, row.current_version).all<DmMemorySource>();
  // A concurrent delete or permission loss must not return the already-read body.
  const current = await db.prepare(`select 1 from briar_dm_memory_documents doc
    join briar_dm_memory_spaces space on space.id = doc.space_id
    where ${ownerWhere} and doc.id = ? and doc.current_version = ? and doc.status <> 'deleted'`)
    .bind(...ownerBindings(owner), documentId, row.current_version).first();
  if (!current) throw new HttpError(409, "Memory changed; reload it", "version_conflict");
  return { ...documentJson(row), body: row.body, sources: sources.results };
}

const commitGate = `exists (select 1 from briar_dm_memory_commits where id = ? and applied = 0)`;
const finishCommit = (db: D1Database, commitId: string) => db.prepare(
  "update briar_dm_memory_commits set applied = 1 where id = ? and applied = 0",
).bind(commitId);

async function findCommit(db: D1Database, spaceId: string, requestId: string) {
  return db.prepare(`select id, document_id, payload_hash, result_version, applied
    from briar_dm_memory_commits where space_id = ? and request_id = ?`)
    .bind(spaceId, requestId).first<CommitRow>();
}

export async function saveDmMemory(
  db: D1Database, owner: DmMemoryOwner, input: DmMemoryCreateInput | DmMemoryEditInput,
  documentId?: string,
) {
  const existing = documentId ? await getDmMemory(db, owner, documentId) : null;
  if (existing && input.memorySpaceId && input.memorySpaceId !== existing.memorySpaceId) {
    throw new HttpError(404, "Memory not found", "memory_not_found");
  }
  const space = await ensureWriteSpace(db, owner, existing?.memorySpaceId ?? input.memorySpaceId);
  const body = input.body.replace(/\r\n?/gu, "\n");
  const payloadHash = await sha256(JSON.stringify({ ...input, body, documentId: documentId ?? null }));
  const previous = await findCommit(db, space.id, input.requestId);
  if (previous) {
    if (
      previous.payload_hash !== payloadHash
      || !previous.applied
      || !previous.document_id
      || previous.result_version === null
    ) {
      throw new HttpError(409, "Request ID was already used", "idempotency_conflict");
    }
    return { documentId: previous.document_id, version: previous.result_version, replayed: true };
  }
  const expectedVersion = "expectedVersion" in input ? input.expectedVersion : null;
  if (existing && expectedVersion !== existing.version) {
    throw new HttpError(409, "Memory changed; reload it", "version_conflict");
  }
  const id = documentId ?? crypto.randomUUID();
  const version = existing ? existing.version + 1 : 1;
  const commitId = crypto.randomUUID();
  const now = new Date().toISOString();
  const bodyHash = await sha256(body);
  const source = input.sourceMessage;
  const sourceRow = source ? await db.prepare(`select body from briar_channel_messages
    where id = ? and channel_id = ? and memory_source_version = ? and deleted_at is null`)
    .bind(source.id, owner.channelId, source.version).first<{ body: string }>() : null;
  if (source && !sourceRow) throw new HttpError(409, "Source message changed", "source_changed");
  const sourceHash = sourceRow ? await sha256(sourceRow.body) : null;
  const statements = [db.prepare(`insert into briar_dm_memory_commits
    (id, space_id, request_id, document_id, payload_hash, result_version, created_at)
    select ?, space.id, ?, ?, ?, ?, ? from briar_dm_memory_spaces space
    where ${ownerWhere} and space.id = ? and space.memory_revision = ?
      and space.revocation_epoch = ? and ${liveSpaceWhere}
      and (? is null or exists (select 1 from briar_dm_memory_documents doc
        where doc.space_id = space.id and doc.id = ? and doc.current_version = ? and doc.status <> 'deleted'))
      and (? is null or exists (select 1 from briar_channel_messages message
        where message.id = ? and message.channel_id = space.channel_id
          and message.memory_source_version = ? and message.deleted_at is null
          and not exists (select 1 from briar_dm_memory_exclusions excluded
            where excluded.space_id = space.id and excluded.source_type = 'message'
              and excluded.source_id = message.id)))
    on conflict (space_id, request_id) do nothing`)
    .bind(commitId, input.requestId, id, payloadHash, version, now, ...ownerBindings(owner),
      space.id, space.memory_revision, space.revocation_epoch,
      documentId ?? null, documentId ?? null, expectedVersion,
      source?.id ?? null, source?.id ?? null, source?.version ?? null)];
  statements.push(existing
    ? db.prepare(`update briar_dm_memory_documents set title = ?, current_version = ?,
        status = 'active', conflicted = 0, superseded_by = null, updated_at = ?
        where id = ? and space_id = ? and ${commitGate}`)
      .bind(input.title, version, now, id, space.id, commitId)
    : db.prepare(`insert into briar_dm_memory_documents
        (id, space_id, kind, title, current_version, created_at, updated_at)
        select ?, ?, 'observation', ?, ?, ?, ? where ${commitGate}`)
      .bind(id, space.id, input.title, version, now, now, commitId));
  statements.push(db.prepare(`insert into briar_dm_memory_revisions
    (space_id, document_id, version, body, body_hash, memory_class, evidence_type, protected_by_user,
      source_language, observed_at, valid_until, origin, policy_version, created_at)
    select ?, ?, ?, ?, ?, ?, 'explicit_user', 1, ?, ?, ?, 'user_edit', 'dm-memory-v1', ?
    where ${commitGate}`)
    .bind(space.id, id, version, body, bodyHash, input.memoryClass, input.sourceLanguage,
      input.observedAt, input.validUntil, now, commitId));
  statements.push(db.prepare(`insert into briar_dm_memory_sources
    (space_id, document_id, document_version, source_type, source_id, source_version, source_hash)
    select ?, ?, ?, 'user_edit_event', ?, 1, ? where ${commitGate}`)
    .bind(space.id, id, version, commitId, bodyHash, commitId));
  if (source) statements.push(db.prepare(`insert into briar_dm_memory_sources
    (space_id, document_id, document_version, source_type, source_id, source_version, source_hash)
    select ?, ?, ?, 'message', ?, ?, ? where ${commitGate}`)
    .bind(space.id, id, version, source.id, source.version, sourceHash, commitId));
  statements.push(db.prepare(`update briar_dm_memory_spaces set
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + ?,
    use_enabled = case when ever_saved = 0 then 1 else use_enabled end,
    ever_saved = 1, updated_at = ? where id = ? and ${commitGate}`)
    .bind(existing ? 1 : 0, now, space.id, commitId));
  statements.push(db.prepare(`insert into briar_dm_memory_jobs
    (id, space_id, kind, dedupe_key, document_id, document_version,
      expected_memory_revision, revocation_epoch, available_at, created_at, updated_at)
    select ?, space.id, 'index', ?, ?, ?, space.memory_revision, space.revocation_epoch, ?, ?, ?
    from briar_dm_memory_spaces space where space.id = ? and ${commitGate}`)
    .bind(crypto.randomUUID(), `index:${id}:${version}`, id, version, now, now, now, space.id, commitId));
  statements.push(finishCommit(db, commitId));
  await db.batch(statements);
  const committed = await findCommit(db, space.id, input.requestId);
  if (
    !committed?.applied
    || committed.payload_hash !== payloadHash
    || !committed.document_id
    || committed.result_version === null
  ) {
    throw new HttpError(409, "Memory or its permissions changed; reload", "version_conflict");
  }
  return { documentId: committed.document_id, version: committed.result_version, replayed: committed.id !== commitId };
}

export async function updateDmMemorySettings(
  db: D1Database, owner: DmMemoryOwner, input: DmMemorySettingsInput,
) {
  if (input.autoEnabled) {
    throw new HttpError(409, "Automatic memory learning is not available yet", "memory_learning_unavailable");
  }
  const space = await ensureWriteSpace(db, owner, input.memorySpaceId);
  const payloadHash = await sha256(JSON.stringify(input));
  const previous = await findCommit(db, space.id, input.requestId);
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new HttpError(409, "Request ID was already used", "idempotency_conflict");
    return dmMemorySpaceJson(await requireSpace(db, owner, space.id));
  }
  const commitId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`insert into briar_dm_memory_commits
      (id, space_id, request_id, payload_hash, created_at)
      select ?, space.id, ?, ?, ? from briar_dm_memory_spaces space
      where ${ownerWhere} and space.id = ? and space.memory_revision = ? and ${liveSpaceWhere}
      on conflict (space_id, request_id) do nothing`)
      .bind(commitId, input.requestId, payloadHash, now, ...ownerBindings(owner), space.id, input.expectedMemoryRevision),
    db.prepare(`update briar_dm_memory_spaces set use_enabled = ?, auto_enabled = 0,
      memory_revision = memory_revision + 1,
      revocation_epoch = revocation_epoch + case when use_enabled = 1 and ? = 0 then 1 else 0 end,
      updated_at = ? where id = ? and ${commitGate}`)
      .bind(Number(input.useEnabled), Number(input.useEnabled), now, space.id, commitId),
    finishCommit(db, commitId),
  ]);
  const committed = await findCommit(db, space.id, input.requestId);
  if (!committed?.applied || committed.payload_hash !== payloadHash) throw new HttpError(409, "Memory settings changed; reload", "version_conflict");
  return dmMemorySpaceJson(await requireSpace(db, owner, space.id));
}

export async function deleteDmMemory(db: D1Database, owner: DmMemoryOwner, documentId: string) {
  const target = await db.prepare(`select doc.space_id, doc.status from briar_dm_memory_documents doc
    join briar_dm_memory_spaces space on space.id = doc.space_id where ${ownerWhere} and doc.id = ?`)
    .bind(...ownerBindings(owner), documentId).first<{ space_id: string; status: string }>();
  if (!target) throw new HttpError(404, "Memory not found", "memory_not_found");
  const space = await requireSpace(db, owner, target.space_id);
  if (target.status === "deleted") return { deleted: true, purgeState: await dmMemoryPurgeState(db, documentId) };
  const commitId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`insert into briar_dm_memory_commits (id, space_id, request_id, document_id, created_at)
      select ?, space.id, ?, ?, ? from briar_dm_memory_spaces space
      where ${ownerWhere} and space.id = ? and space.memory_revision = ?`)
      .bind(commitId, commitId, documentId, now, ...ownerBindings(owner), space.id, space.memory_revision),
    db.prepare(`insert into briar_dm_memory_exclusions
      (space_id, source_type, source_id, document_id, revocation_epoch, created_at)
      select space_id, source_type, source_id, document_id, ?, ? from briar_dm_memory_sources
      where document_id = ? and ${commitGate}
      on conflict (space_id, source_type, source_id, document_id) do nothing`)
      .bind(space.revocation_epoch + 1, now, documentId, commitId),
    db.prepare(`update briar_dm_memory_documents set status = 'deleted', title = '[deleted]',
      updated_at = ? where id = ? and ${commitGate}`).bind(now, documentId, commitId),
    db.prepare(`delete from briar_dm_memory_revisions where document_id = ? and ${commitGate}`)
      .bind(documentId, commitId),
    db.prepare(`update briar_dm_memory_commits set payload_hash = null
      where document_id = ? and ${commitGate}`).bind(documentId, commitId),
    db.prepare(`update briar_dm_memory_jobs set status = 'cancelled', input_json = null,
      lease_token_hash = null, lease_expires_at = null where document_id = ? and kind <> 'delete'
      and ${commitGate}`).bind(documentId, commitId),
    db.prepare(`update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
      revocation_epoch = revocation_epoch + 1, updated_at = ? where id = ? and ${commitGate}`)
      .bind(now, space.id, commitId),
    db.prepare(`insert into briar_dm_memory_jobs
      (id, space_id, kind, dedupe_key, document_id, expected_memory_revision, revocation_epoch,
        available_at, created_at, updated_at)
      select ?, ?, 'delete', ?, ?, ?, ?, ?, ?, ? where ${commitGate}
      on conflict (dedupe_key) do nothing`)
      .bind(crypto.randomUUID(), space.id, `delete:${documentId}`, documentId,
        space.memory_revision + 1, space.revocation_epoch + 1, now, now, now, commitId),
    finishCommit(db, commitId),
  ]);
  const result = await findCommit(db, space.id, commitId);
  if (!result?.applied) throw new HttpError(409, "Memory changed; retry deletion", "version_conflict");
  return { deleted: true, purgeState: "pending" } as const;
}

async function dmMemoryPurgeState(db: D1Database, documentId: string): Promise<"pending" | "complete"> {
  const pending = await db.prepare(`select 1 from briar_dm_memory_vectors where document_id = ? and state <> 'purged'
    union all select 1 from briar_dm_memory_jobs where document_id = ? and kind = 'delete'
      and status <> 'succeeded' limit 1`).bind(documentId, documentId).first();
  return pending ? "pending" : "complete";
}

export async function* exportDmMemoryEntries(
  db: D1Database, owner: DmMemoryOwner, spaceId: string,
): AsyncGenerator<{ name: string; content: string }> {
  const space = await requireSpace(db, owner, spaceId);
  const checkSnapshot = async () => {
    const current = await requireSpace(db, owner, space.id);
    if (current.memory_revision !== space.memory_revision || current.revocation_epoch !== space.revocation_epoch) {
      throw new HttpError(409, "Memory changed during export; start again", "version_conflict");
    }
  };
  let cursor = "";
  // Each entry carries its manifest metadata beside the Markdown. The root
  // manifest specifies this layout, avoiding an unbounded in-memory file list.
  yield { name: "manifest.json", content: JSON.stringify({
    format: "briar-dm-memory", version: 1, memorySpaceId: space.id,
    memoryRevision: space.memory_revision, exportedAt: new Date().toISOString(),
    entries: "profile|log|note/<document-id>.md and <document-id>.json",
    warning: "Exported copies are not recalled by server-side deletion.",
  }, null, 2) };
  for (;;) {
    await checkSnapshot();
    const { results } = await db.prepare(`${documentSelect}
      where ${ownerWhere} and space.id = ? and doc.status <> 'deleted' and doc.id > ?
      order by doc.id limit 10`).bind(...ownerBindings(owner), space.id, cursor).all<DocumentRow>();
    if (results.length === 0) break;
    const sourceRows = await db.prepare(`select source.document_id,
      source.source_type as type, source.source_id as id, source.source_version as version
      from briar_dm_memory_sources source
      join briar_dm_memory_documents doc on doc.id = source.document_id
        and doc.current_version = source.document_version
      where source.space_id = ? and doc.id > ? and doc.id <= ?
      order by doc.id, source.source_type, source.source_id`)
      .bind(space.id, cursor, results.at(-1)!.id).all<DmMemorySource & { document_id: string }>();
    for (const row of results) {
      await checkSnapshot();
      const sources = sourceRows.results.filter((source) => source.document_id === row.id)
        .map(({ type, id, version }) => ({ type, id, version }));
      const filename = `${row.memory_class}/${row.id}`;
      yield { name: `${filename}.md`, content: row.body };
      await checkSnapshot();
      yield { name: `${filename}.json`, content: JSON.stringify({ ...documentJson(row), sources }, null, 2) };
    }
    cursor = results.at(-1)!.id;
  }
  await checkSnapshot();
}
