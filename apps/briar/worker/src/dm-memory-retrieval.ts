import * as Schema from "effect/Schema";
import {
  dmMemoryGetInput, dmMemorySearchInput,
  type DmMemoryGetResponse, type DmMemoryGetResult, type DmMemoryReference,
  type DmMemoryResultMetadata, type DmMemorySearchResponse, type DmMemorySearchResult,
} from "../../src/lib/dm-memory-query-contract";
import { dmMemoryReadableDocument, requireDmMemoryAccess, type DmMemoryAccess } from "./dm-memory-access";
import { dmMemoryCurrentSections, dmMemoryEmbeddingProfile, memoryUtf8Slice } from "./dm-memory-chunks";
import type { DmMemoryVectorStore } from "./dm-memory-vector-store";
import { HttpError } from "./http-response";

export type DmMemoryReadRow = {
  id: string; current_version: number; title: string; kind: "observation" | "topic";
  body: string; memory_class: "profile" | "log" | "note"; evidence_type: "explicit_user" | "observed";
  protected_by_user: number; source_language: string; observed_at: string | null;
  valid_until: string | null; conflicted: number; updated_at: string;
};
type ChunkRow = DmMemoryReadRow & {
  chunk_id: string; vector_id: string; start_bytes: number; end_bytes: number;
  line_start: number; line_end: number; headings_json: string;
};
export const dmMemoryReadColumns = `doc.id, doc.current_version, doc.title, doc.kind, doc.conflicted,
  doc.updated_at, rev.body, rev.memory_class, rev.evidence_type, rev.protected_by_user,
  rev.source_language, rev.observed_at, rev.valid_until`;
export const dmMemoryJsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const nowIso = () => new Date().toISOString();

async function metadata(db: D1Database, row: DmMemoryReadRow): Promise<DmMemoryResultMetadata> {
  const sources = await db.prepare(`select distinct source_type, source_id from briar_dm_memory_sources
    where document_id = ? and document_version = ? order by source_type, source_id limit 64`)
    .bind(row.id, row.current_version).all<{ source_type: string; source_id: string }>();
  return { documentId: row.id, version: row.current_version, title: row.title,
    memoryClass: row.memory_class, evidenceType: row.evidence_type,
    protectedByUser: row.protected_by_user === 1, sourceLanguage: row.source_language,
    observedAt: row.observed_at, validUntil: row.valid_until, conflicted: row.conflicted === 1,
    sourceMessageIds: sources.results.filter((source) => source.source_type === "message").map((source) => source.source_id),
    sourceEventIds: sources.results.filter((source) => source.source_type === "user_edit_event").map((source) => source.source_id),
    updatedAt: row.updated_at };
}

async function indexState(db: D1Database, spaceId: string): Promise<DmMemorySearchResponse["indexState"]> {
  const row = await db.prepare(`select
    sum(case when job.status = 'failed' then 1 else 0 end) as failed,
    sum(case when job.status not in ('succeeded', 'cancelled') then 1 else 0 end) as pending
    from briar_dm_memory_jobs job join briar_dm_memory_documents doc
      on doc.id = job.document_id and doc.current_version = job.document_version
    where job.space_id = ? and job.kind = 'index' and doc.status = 'active'`)
    .bind(spaceId).first<{ failed: number | null; pending: number | null }>();
  return row?.failed ? "failed" : row?.pending ? "pending" : "ready";
}

async function sameSnapshot(db: D1Database, access: DmMemoryAccess, revision: number) {
  const current = await requireDmMemoryAccess(db, access, nowIso());
  if (current.memory_revision !== revision) throw new HttpError(409, "Memory changed during lookup", "memory_snapshot_changed");
}

export async function searchDmMemory(
  db: D1Database, access: DmMemoryAccess, rawInput: unknown,
  options: { store: DmMemoryVectorStore | null; minimumScore: number | null; timeoutMs?: number },
): Promise<DmMemorySearchResponse> {
  // Include authorization, D1 reads and final revalidation in the same deadline.
  // A timed-out response carries no document or source data and makes no claim
  // about a revision that the server has not finished reading.
  Schema.decodeUnknownSync(dmMemorySearchInput)(rawInput);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      searchWithinDeadline(db, access, rawInput, options),
      new Promise<DmMemorySearchResponse>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout", memoryRevision: null,
          revocationEpoch: access.revocationEpoch, indexState: "pending", truncated: false, results: [] }),
        Math.max(0, Math.min(options.timeoutMs ?? 5000, 5000)));
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function searchWithinDeadline(
  db: D1Database, access: DmMemoryAccess, rawInput: unknown,
  options: { store: DmMemoryVectorStore | null; minimumScore: number | null },
): Promise<DmMemorySearchResponse> {
  const input = Schema.decodeUnknownSync(dmMemorySearchInput)(rawInput);
  const queries = [...new Set(input.queries)];
  const snapshot = await requireDmMemoryAccess(db, access, nowIso());
  const response: DmMemorySearchResponse = { status: "ok", memoryRevision: snapshot.memory_revision,
    revocationEpoch: snapshot.revocation_epoch, indexState: await indexState(db, access.spaceId), truncated: false, results: [] };
  const store = options.store;
  const minimumScore = options.minimumScore;
  if (!store || minimumScore === null || !Number.isFinite(minimumScore) || minimumScore < -1 || minimumScore > 1) {
    return { ...response, status: "unavailable" };
  }
  const lookup = async (): Promise<DmMemorySearchResponse> => {
    const embeddings = await store.embed(queries);
    const candidates = await Promise.all(embeddings.map((vector) => store.query(vector, {
      topK: 20, namespace: access.organizationId, filter: { memorySpaceId: access.spaceId },
      returnMetadata: "none", returnValues: false,
    })));
    const scores = new Map<string, number>();
    for (const { matches } of candidates) for (const match of matches.slice(0, 20)) {
      if (!Number.isFinite(match.score) || match.score < minimumScore) continue;
      scores.set(match.id, Math.max(scores.get(match.id) ?? -Infinity, match.score));
    }
    if (scores.size === 0) { await sameSnapshot(db, access, snapshot.memory_revision); return response; }
    const ids = [...scores.keys()];
    const rows = await db.prepare(`select ${dmMemoryReadColumns}, chunk.id as chunk_id,
      chunk.vector_id, chunk.start_bytes, chunk.end_bytes, chunk.line_start, chunk.line_end, chunk.headings_json
      from briar_dm_memory_chunks chunk join briar_dm_memory_documents doc on doc.id = chunk.document_id
        and doc.current_version = chunk.document_version
      join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version
      where chunk.space_id = ? and chunk.embedding_profile = ? and chunk.ready = 1
        and chunk.vector_id in (${ids.map(() => "?").join(",")}) and ${dmMemoryReadableDocument}`)
      .bind(access.spaceId, dmMemoryEmbeddingProfile, ...ids, nowIso()).all<ChunkRow>();
    const clusters: ChunkRow[] = [];
    for (const row of rows.results.sort((a, b) => a.id.localeCompare(b.id) || a.start_bytes - b.start_bytes)) {
      const previous = clusters.at(-1);
      if (previous?.id === row.id && row.start_bytes < previous.end_bytes) {
        const representative = scores.get(row.vector_id)! > scores.get(previous.vector_id)! ? row : previous;
        clusters[clusters.length - 1] = { ...representative,
          start_bytes: Math.min(row.start_bytes, previous.start_bytes),
          end_bytes: Math.max(row.end_bytes, previous.end_bytes),
          line_start: Math.min(row.line_start, previous.line_start),
          line_end: Math.max(row.line_end, previous.line_end) };
      } else clusters.push({ ...row });
    }
    const ranked = clusters.sort((a, b) => (scores.get(b.vector_id)! - scores.get(a.vector_id)!)
      || Number(b.evidence_type === "explicit_user") - Number(a.evidence_type === "explicit_user")
      || b.updated_at.localeCompare(a.updated_at) || a.chunk_id.localeCompare(b.chunk_id));
    const selected: ChunkRow[] = [];
    for (const row of ranked) {
      if (selected.filter((other) => other.id === row.id).length < 2) selected.push(row);
    }
    const verificationCandidates = selected.slice(0, 10).map((row) => ({ id: row.chunk_id,
      text: `${row.title}\n\n${memoryUtf8Slice(row.body, row.start_bytes, row.end_bytes - row.start_bytes).body}` }));
    let verified: Set<string>;
    try { verified = new Set(await store.verify(queries, verificationCandidates)); }
    catch {
      await sameSnapshot(db, access, snapshot.memory_revision);
      return { ...response, status: "unavailable" };
    }
    const relevant = selected.filter((row) => verified.has(row.chunk_id));
    for (const row of relevant.slice(0, input.max_results ?? 5)) {
      const sourceMetadata = await metadata(db, row);
      const headings = Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(row.headings_json))
        .map((heading) => {
          const characters = Array.from(heading);
          if (characters.length <= 200) return heading;
          response.truncated = true;
          return `${characters.slice(0, 200).join("")}…`;
        });
      const result: DmMemorySearchResult = { ...sourceMetadata, chunkId: row.chunk_id,
        headings,
        excerpt: memoryUtf8Slice(row.body, row.start_bytes, row.end_bytes - row.start_bytes).body,
        startBytes: row.start_bytes, endBytes: row.end_bytes, lineStart: row.line_start, lineEnd: row.line_end,
        score: scores.get(row.vector_id)! };
      if (sourceMetadata.sourceEventIds.length + sourceMetadata.sourceMessageIds.length >= 64) response.truncated = true;
      while (dmMemoryJsonBytes({ ...response, results: [...response.results, result] }) > 16_384 && result.excerpt.length) {
        const bytes = new TextEncoder().encode(result.excerpt).length;
        const shortened = memoryUtf8Slice(result.excerpt, 0, Math.max(0, bytes - 256));
        result.excerpt = shortened.body;
        result.endBytes = row.start_bytes + shortened.endOffsetBytes;
        result.lineEnd = result.lineStart + result.excerpt.trimEnd().split("\n").length - 1;
        response.truncated = true;
      }
      if (!result.excerpt || dmMemoryJsonBytes({ ...response, results: [...response.results, result] }) > 16_384) {
        response.truncated = true; break;
      }
      response.results.push(result);
    }
    await sameSnapshot(db, access, snapshot.memory_revision);
    return response;
  };
  try {
    return await lookup();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    await sameSnapshot(db, access, snapshot.memory_revision);
    return { ...response, status: "unavailable", indexState: "failed", results: [] };
  }
}

export async function getDmMemoryReferences(
  db: D1Database, access: DmMemoryAccess, rawInput: unknown, discovered: readonly DmMemoryReference[],
): Promise<DmMemoryGetResponse> {
  const input = Schema.decodeUnknownSync(dmMemoryGetInput)(rawInput);
  const snapshot = await requireDmMemoryAccess(db, access, nowIso());
  const response: DmMemoryGetResponse = { memoryRevision: snapshot.memory_revision,
    revocationEpoch: snapshot.revocation_epoch, truncated: false, documents: [] };
  for (const request of input.documents) {
    const stale: DmMemoryGetResult = { documentId: request.documentId, version: request.version,
      status: "stale_reference", nextOffsetBytes: null };
    if (!discovered.some((reference) => reference.documentId === request.documentId && reference.version === request.version)) {
      response.documents.push(stale); continue;
    }
    const row = await db.prepare(`select ${dmMemoryReadColumns} from briar_dm_memory_documents doc
      join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version
      where doc.space_id = ? and doc.id = ? and doc.current_version = ? and ${dmMemoryReadableDocument}`)
      .bind(access.spaceId, request.documentId, request.version, nowIso()).first<DmMemoryReadRow>();
    if (!row) { response.documents.push(stale); continue; }
    const requestedOffset = request.offsetBytes ?? 0;
    try { memoryUtf8Slice(row.body, requestedOffset, 0); }
    catch { throw new HttpError(400, "Offset must be a UTF-8 character boundary", "invalid_utf8_offset"); }
    const sections = dmMemoryCurrentSections(row.body, row.kind);
    const section = sections.find((part) => part.endOffsetBytes > requestedOffset);
    const offset = section ? Math.max(requestedOffset, section.offsetBytes) : requestedOffset;
    const maxBytes = section ? Math.min(request.maxBytes ?? 4096, section.endOffsetBytes - offset) : 0;
    const slice = memoryUtf8Slice(row.body, offset, maxBytes);
    const nextSection = section ? sections.find((part) => part.offsetBytes >= section.endOffsetBytes) : undefined;
    const result: DmMemoryGetResult = { ...await metadata(db, row), status: "ok", ...slice,
      nextOffsetBytes: section && slice.endOffsetBytes < section.endOffsetBytes ? slice.endOffsetBytes
        : nextSection?.offsetBytes ?? null };
    if (result.sourceEventIds.length + result.sourceMessageIds.length >= 64) response.truncated = true;
    while (dmMemoryJsonBytes({ ...response, documents: [...response.documents, result] }) > 32_000 && result.body.length) {
      const shorter = memoryUtf8Slice(result.body, 0, Math.max(0, new TextEncoder().encode(result.body).length - 256));
      result.body = shorter.body;
      result.endOffsetBytes = offset + shorter.endOffsetBytes;
      result.nextOffsetBytes = result.endOffsetBytes;
      response.truncated = true;
    }
    if (!result.body && maxBytes > 0) {
      response.documents.push({ documentId: row.id, version: row.current_version, status: "deferred", nextOffsetBytes: offset });
      response.truncated = true;
    } else response.documents.push(result);
  }
  await sameSnapshot(db, access, snapshot.memory_revision);
  return response;
}
