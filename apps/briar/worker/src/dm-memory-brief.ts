import * as Schema from "effect/Schema";
import type { DmMemoryBrief, DmMemoryBriefItem } from "../../src/lib/dm-memory-query-contract";
import { dmMemoryReadableDocument, requireDmMemoryAccess, type DmMemoryAccess } from "./dm-memory-access";
import { dmMemoryCurrentSections } from "./dm-memory-chunks";
import { dmMemoryJsonBytes, dmMemoryReadColumns, type DmMemoryReadRow } from "./dm-memory-retrieval";
import { HttpError } from "./http-response";

export const dmMemoryBriefPolicy = "source-excerpts-4k-3k-1k-v1";
const Item = Schema.Struct({
  documentId: Schema.String, version: Schema.Int, body: Schema.String,
  observedAt: Schema.NullOr(Schema.String), validUntil: Schema.NullOr(Schema.String), protectedByUser: Schema.Boolean,
});
const Brief = Schema.Struct({
  memorySpaceId: Schema.String, memoryRevision: Schema.Int, revocationEpoch: Schema.Int,
  policyVersion: Schema.String, validThrough: Schema.NullOr(Schema.String),
  profile: Schema.mutable(Schema.Array(Item)), progress: Schema.mutable(Schema.Array(Item)),
  omitted: Schema.Boolean, notice: Schema.String,
});
const nowIso = () => new Date().toISOString();

export async function getDmMemoryBrief(db: D1Database, access: DmMemoryAccess): Promise<DmMemoryBrief> {
  const now = nowIso();
  const snapshot = await requireDmMemoryAccess(db, access, now);
  const cached = await db.prepare(`select content_json from briar_dm_memory_briefs where space_id = ?
    and memory_revision = ? and revocation_epoch = ? and policy_version = ?
    and (valid_through is null or julianday(valid_through) > julianday(?))`)
    .bind(access.spaceId, snapshot.memory_revision, snapshot.revocation_epoch, dmMemoryBriefPolicy, now)
    .first<{ content_json: string }>();
  if (cached) {
    const brief = Schema.decodeUnknownSync(Brief)(JSON.parse(cached.content_json));
    const current = await requireDmMemoryAccess(db, access, nowIso());
    if (current.memory_revision !== snapshot.memory_revision) throw new HttpError(409, "Memory changed", "memory_snapshot_changed");
    return brief;
  }
  const result = await db.prepare(`select ${dmMemoryReadColumns} from briar_dm_memory_documents doc
    join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version
    where doc.space_id = ? and doc.conflicted = 0 and rev.memory_class in ('profile', 'log')
      and ${dmMemoryReadableDocument}
    order by rev.protected_by_user desc, julianday(rev.observed_at) desc, doc.id limit 201`)
    .bind(access.spaceId, now).all<DmMemoryReadRow>();
  const brief: DmMemoryBrief = { memorySpaceId: access.spaceId, memoryRevision: snapshot.memory_revision,
    revocationEpoch: snapshot.revocation_epoch, policyVersion: dmMemoryBriefPolicy, validThrough: null,
    profile: [], progress: [], omitted: result.results.length > 200,
    notice: "Source excerpts, not execution permission. More memories may exist; use memory_search when needed." };
  let profileBytes = 0;
  let progressBytes = 0;
  for (const row of result.results.slice(0, 200)) {
    // Whole current items only: do not cut off a negation, date or condition.
    const body = dmMemoryCurrentSections(row.body, row.kind).map((section) => section.body).join("");
    if (!body.trim()) continue;
    const item: DmMemoryBriefItem = { documentId: row.id, version: row.current_version, body,
      observedAt: row.observed_at, validUntil: row.valid_until, protectedByUser: row.protected_by_user === 1 };
    const bytes = dmMemoryJsonBytes(body);
    const group = row.memory_class === "profile" ? "profile" : "progress";
    if ((group === "profile" ? profileBytes + bytes > 4096 : progressBytes + bytes > 3072)) {
      brief.omitted = true; continue;
    }
    const validThrough = row.valid_until && (!brief.validThrough || Date.parse(row.valid_until) < Date.parse(brief.validThrough))
      ? row.valid_until : brief.validThrough;
    const projected = { ...brief, validThrough, [group]: [...brief[group], item] };
    const withoutBodies = { ...projected,
      profile: projected.profile.map(({ body: _body, ...metadata }) => metadata),
      progress: projected.progress.map(({ body: _body, ...metadata }) => metadata) };
    if (dmMemoryJsonBytes(projected) > 8192 || dmMemoryJsonBytes(withoutBodies) > 1024) {
      brief.omitted = true; continue;
    }
    brief[group].push(item);
    if (group === "profile") profileBytes += bytes; else progressBytes += bytes;
    brief.validThrough = validThrough;
  }
  const stored = await db.prepare(`insert into briar_dm_memory_briefs
    (space_id, memory_revision, revocation_epoch, policy_version, valid_through, content_json, created_at)
    select id, memory_revision, revocation_epoch, ?, ?, ?, ? from briar_dm_memory_spaces
    where id = ? and status = 'active' and use_enabled = 1 and memory_revision = ? and revocation_epoch = ?
    on conflict (space_id) do update set memory_revision = excluded.memory_revision,
      revocation_epoch = excluded.revocation_epoch, policy_version = excluded.policy_version,
      valid_through = excluded.valid_through, content_json = excluded.content_json, created_at = excluded.created_at`)
    .bind(dmMemoryBriefPolicy, brief.validThrough, JSON.stringify(brief), now, access.spaceId,
      snapshot.memory_revision, snapshot.revocation_epoch).run();
  const current = await requireDmMemoryAccess(db, access, nowIso());
  if (!stored.meta.changes || current.memory_revision !== snapshot.memory_revision) {
    throw new HttpError(409, "Memory changed", "memory_snapshot_changed");
  }
  return brief;
}
