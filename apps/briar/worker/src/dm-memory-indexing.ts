import { flushDmMemoryActivityRevocations } from "./dm-memory-activity-revocations";
import { cleanupAbandonedReplyLookups } from "./channel-reply-lookup-budget";
import * as Schema from "effect/Schema";
import { expireDmMemories } from "./dm-memory-access";
import { chunkDmMemory, dmMemoryEmbeddingPrefix, dmMemoryEmbeddingProfile, dmMemorySplitterProfile, memoryUtf8Slice } from "./dm-memory-chunks";
import { DmMemoryIndexError, dmMemoryVectorStore, type DmMemoryVectorStore } from "./dm-memory-vector-store";
import { sha256 } from "./crypto-digest";

type IndexJob = { id: string; space_id: string; document_id: string; document_version: number;
  stage: string | null; attempt: number; lease_token_hash: string };
type IndexSource = { organization_id: string; revocation_epoch: number; title: string;
  kind: "observation" | "topic"; body: string };
type IndexChunk = { id: string; vector_id: string; start_bytes: number; end_bytes: number; headings_json: string };
type RegistryRow = { id: string; space_id: string; organization_id: string; document_id: string;
  document_version: number; chunk_id: string; state: string; upsert_mutation_id: string | null;
  delete_mutation_id: string | null; submitted_at: string | null; delete_submitted_at: string | null;
  write_expires_at: string | null; attempt: number };
const iso = () => new Date().toISOString();
const later = (now: string, seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
const jobGate = `exists (select 1 from briar_dm_memory_jobs job
  where job.id = ? and job.status = 'running' and job.lease_token_hash = ? and job.lease_expires_at > ?)`;
const sourceGate = `exists (select 1 from briar_dm_memory_documents doc
  join briar_dm_memory_spaces space on space.id = doc.space_id
  join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version
  join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
    and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
    and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
  where doc.id = ? and doc.current_version = ? and doc.status = 'active'
    and doc.expired_version <> doc.current_version and space.status = 'active' and space.revocation_epoch = ?
    and (rev.valid_until is null or julianday(rev.valid_until) > julianday(?))
    and not exists (select 1 from briar_dm_memory_sources source
      join briar_dm_memory_exclusions excluded on excluded.space_id = source.space_id
        and excluded.source_type = source.source_type and excluded.source_id = source.source_id
      where source.document_id = doc.id and source.document_version = doc.current_version))`;

async function readSource(db: D1Database, job: IndexJob, now: string) {
  return db.prepare(`select space.organization_id, space.revocation_epoch, doc.title, doc.kind, rev.body
    from briar_dm_memory_documents doc join briar_dm_memory_spaces space on space.id = doc.space_id
    join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version
    join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
      and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
      and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
    where doc.id = ? and doc.space_id = ? and doc.current_version = ? and doc.status = 'active'
      and doc.expired_version <> doc.current_version and space.status = 'active'
      and (rev.valid_until is null or julianday(rev.valid_until) > julianday(?))
      and not exists (select 1 from briar_dm_memory_sources source
        join briar_dm_memory_exclusions excluded on excluded.space_id = source.space_id
          and excluded.source_type = source.source_type and excluded.source_id = source.source_id
        where source.document_id = doc.id and source.document_version = doc.current_version)`)
    .bind(job.document_id, job.space_id, job.document_version, now).first<IndexSource>();
}

async function finishJob(db: D1Database, job: IndexJob, status: string, stage: string | null,
  code: string | null = null, delaySeconds = 0, source?: IndexSource) {
  const now = iso();
  await db.prepare(`update briar_dm_memory_jobs set status = ?, stage = ?, error_code = ?,
    available_at = ?, lease_token_hash = null, lease_expires_at = null, updated_at = ?
    where id = ? and lease_token_hash = ? and status = 'running'
      ${source ? `and ${sourceGate}` : ""}`)
    .bind(status, stage, code, later(now, delaySeconds), now, job.id, job.lease_token_hash,
      ...(source ? [job.document_id, job.document_version, source.revocation_epoch, now] : [])).run();
}

async function prepareChunks(db: D1Database, job: IndexJob, source: IndexSource) {
  const chunks = await chunkDmMemory({ spaceId: job.space_id, documentId: job.document_id,
    version: job.document_version, title: source.title, kind: source.kind, body: source.body });
  const now = iso();
  const guards = [job.id, job.lease_token_hash, now, job.document_id, job.document_version, source.revocation_epoch, now];
  const statements: D1PreparedStatement[] = [];
  for (const chunk of chunks) {
    statements.push(db.prepare(`insert into briar_dm_memory_chunks
      (id, space_id, document_id, document_version, vector_id, splitter_profile, embedding_profile,
        start_bytes, end_bytes, line_start, line_end, headings_json, token_count, created_at)
      select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? where ${jobGate} and ${sourceGate}
      on conflict (id) do nothing`)
      .bind(chunk.id, job.space_id, job.document_id, job.document_version, chunk.vectorId,
        dmMemorySplitterProfile, dmMemoryEmbeddingProfile, chunk.startBytes, chunk.endBytes,
        chunk.lineStart, chunk.lineEnd, JSON.stringify(chunk.headings), chunk.tokenCount, now, ...guards));
    statements.push(db.prepare(`insert into briar_dm_memory_vectors
      (id, organization_id, space_id, document_id, document_version, chunk_id, embedding_profile, available_at, created_at)
      select ?, ?, ?, ?, ?, ?, ?, ?, ? where ${jobGate} and ${sourceGate}
      on conflict (id) do nothing`)
      .bind(chunk.vectorId, source.organization_id, job.space_id, job.document_id, job.document_version,
        chunk.id, dmMemoryEmbeddingProfile, now, now, ...guards));
  }
  statements.push(db.prepare(`update briar_dm_memory_jobs set stage = 'embedding', revocation_epoch = ?, updated_at = ?
    where id = ? and ${jobGate} and ${sourceGate}`)
    .bind(source.revocation_epoch, now, job.id, ...guards));
  await db.batch(statements);
}

async function runIndexJob(db: D1Database, store: DmMemoryVectorStore, job: IndexJob) {
  const source = await readSource(db, job, iso());
  if (!source) { await finishJob(db, job, "cancelled", job.stage, "source_unavailable"); return; }
  if (!job.stage) await prepareChunks(db, job, source);
  const chunks = (await db.prepare(`select chunk.id, chunk.vector_id, chunk.start_bytes, chunk.end_bytes, chunk.headings_json
    from briar_dm_memory_chunks chunk join briar_dm_memory_vectors vector on vector.id = chunk.vector_id
    where chunk.document_id = ? and chunk.document_version = ? and chunk.ready = 0
      and vector.state = 'pending' order by chunk.start_bytes limit 16`)
    .bind(job.document_id, job.document_version).all<IndexChunk>()).results;
  if (chunks.length) {
    const texts = chunks.map((chunk) => {
      const headings = Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(chunk.headings_json));
      return `${dmMemoryEmbeddingPrefix(source.title, headings)}${memoryUtf8Slice(source.body,
        chunk.start_bytes, chunk.end_bytes - chunk.start_bytes).body}`;
    });
    const embeddings = await store.embed(texts);
    const now = iso();
    const ids = chunks.map((chunk) => chunk.vector_id);
    const intent = await db.prepare(`update briar_dm_memory_vectors set state = 'submitted', submitted_at = ?,
      write_expires_at = ?, upsert_mutation_id = null where id in (${ids.map(() => "?").join(",")})
      and state = 'pending' and ${jobGate} and ${sourceGate}`)
      .bind(now, later(now, 60), ...ids, job.id, job.lease_token_hash, now,
        job.document_id, job.document_version, source.revocation_epoch, now).run();
    if (intent.meta.changes !== chunks.length) {
      await finishJob(db, job, "pending", "embedding", null, 5); return;
    }
    const mutation = await store.upsert(chunks.map((chunk, index) => ({
      id: chunk.vector_id, namespace: source.organization_id, values: embeddings[index]!,
      metadata: { memorySpaceId: job.space_id, documentId: job.document_id,
        version: job.document_version, chunkId: chunk.id },
    })));
    // Record an external receipt even if deletion cancelled the originating job.
    // Tombstones survive cascades and will schedule another delete for a late write.
    await db.prepare(`update briar_dm_memory_vectors set upsert_mutation_id = ?, write_expires_at = null,
      state = case when state in ('purging', 'purged', 'purge_failed') then 'purging' else state end,
      delete_mutation_id = case when state in ('purging', 'purged', 'purge_failed') then null else delete_mutation_id end,
      lease_token = case when state in ('purging', 'purged', 'purge_failed') then null else lease_token end,
      lease_expires_at = case when state in ('purging', 'purged', 'purge_failed') then null else lease_expires_at end,
      available_at = ? where id in (${ids.map(() => "?").join(",")})`)
      .bind(mutation.mutationId, iso(), ...ids).run();
    await finishJob(db, job, "pending", "submitted", null, 5);
    return;
  }
  const submitted = (await db.prepare(`select vector.* from briar_dm_memory_vectors vector
    join briar_dm_memory_chunks chunk on chunk.vector_id = vector.id
    where vector.document_id = ? and vector.document_version = ? and vector.state = 'submitted'
    order by chunk.start_bytes limit 16`).bind(job.document_id, job.document_version).all<RegistryRow>()).results;
  if (submitted.length) {
    const [info, actual] = await Promise.all([store.info(), store.getByIds(submitted.map((vector) => vector.id))]);
    const present = submitted.filter((row) => actual.some((vector) => vector.id === row.id
      && vector.namespace === source.organization_id && vector.metadata?.memorySpaceId === job.space_id
      && vector.metadata?.documentId === job.document_id && vector.metadata?.version === job.document_version
      && vector.metadata?.chunkId === row.chunk_id));
    if (present.length && info.processedUpToDatetime && info.processedUpToMutation) {
      // getByIds alone is insufficient: exercise the actual filtered query path.
      const query = await store.queryById(present[0]!.id, { topK: 1, namespace: source.organization_id,
        filter: { memorySpaceId: job.space_id }, returnMetadata: "all", returnValues: false });
      if (query.matches.some((match) => match.metadata?.memorySpaceId === job.space_id)) {
        const now = iso();
        const guards = [job.id, job.lease_token_hash, now, job.document_id, job.document_version, source.revocation_epoch, now];
        await db.batch(present.flatMap((vector) => [
          db.prepare(`update briar_dm_memory_chunks set ready = 1 where vector_id = ? and ${jobGate} and ${sourceGate}`)
            .bind(vector.id, ...guards),
          db.prepare(`update briar_dm_memory_vectors set state = 'ready', confirmed_at = ?, error_code = null
            where id = ? and state = 'submitted' and ${jobGate} and ${sourceGate}`)
            .bind(now, vector.id, ...guards),
        ]));
      }
    }
    // An interrupted submission has no receipt. Retry its stable IDs only while
    // the current source remains valid and the previous writer's lease has ended.
    await db.prepare(`update briar_dm_memory_vectors set state = 'pending'
      where document_id = ? and document_version = ? and state = 'submitted' and upsert_mutation_id is null
        and write_expires_at < ? and ${jobGate} and ${sourceGate}`)
      .bind(job.document_id, job.document_version, iso(), job.id, job.lease_token_hash, iso(),
        job.document_id, job.document_version, source.revocation_epoch, iso()).run();
  }
  const remaining = await db.prepare(`select count(*) as total from briar_dm_memory_chunks
    where document_id = ? and document_version = ? and ready = 0`)
    .bind(job.document_id, job.document_version).first<{ total: number }>();
  await finishJob(db, job, remaining?.total ? "pending" : "succeeded", remaining?.total ? "submitted" : "ready", null, 5, source);
}

export async function processDmMemoryIndexJobs(db: D1Database, store: DmMemoryVectorStore, limit = 4) {
  const now = iso();
  const jobs = (await db.prepare(`select id from briar_dm_memory_jobs where kind = 'index'
    and ((status in ('pending', 'retry_wait') and available_at <= ?)
      or (status = 'running' and lease_expires_at <= ?)) order by available_at, id limit ?`)
    .bind(now, now, Math.min(limit, 4)).all<{ id: string }>()).results;
  let processed = 0;
  let failed = 0;
  for (const candidate of jobs) {
    const token = await sha256(crypto.randomUUID());
    const claimedAt = iso();
    const job = await db.prepare(`update briar_dm_memory_jobs set status = 'running', lease_token_hash = ?,
      lease_expires_at = ?, updated_at = ? where id = ? and kind = 'index'
      and ((status in ('pending', 'retry_wait') and available_at <= ?)
        or (status = 'running' and lease_expires_at <= ?)) returning *`)
      .bind(token, later(claimedAt, 60), claimedAt, candidate.id, claimedAt, claimedAt).first<IndexJob>();
    if (!job) continue;
    try { await runIndexJob(db, store, job); processed++; }
    catch (error) {
      const attempt = job.attempt + 1;
      const retryable = !(error instanceof DmMemoryIndexError) || error.retryable;
      const code = error instanceof DmMemoryIndexError ? error.code : "index_processing_failed";
      await db.prepare("update briar_dm_memory_jobs set attempt = ? where id = ? and lease_token_hash = ?")
        .bind(attempt, job.id, token).run();
      await finishJob(db, job, retryable && attempt < 3 ? "retry_wait" : "failed", job.stage, code,
        retryable ? 15 * 2 ** attempt + crypto.getRandomValues(new Uint8Array(1))[0]! % 10 : 0);
      failed++;
    }
  }
  return { processed, failed };
}

export async function processDmMemoryVectorCleanup(db: D1Database, store: DmMemoryVectorStore, limit = 32) {
  const now = iso();
  const candidates = (await db.prepare(`select * from briar_dm_memory_vectors
    where state in ('purging', 'purged') and available_at <= ?
      and (lease_expires_at is null or lease_expires_at <= ?)
    order by case state when 'purging' then 0 else 1 end, available_at, id limit ?`)
    .bind(now, now, Math.min(limit, 32)).all<RegistryRow>()).results;
  let purged = 0;
  let failed = 0;
  for (const row of candidates) {
    const token = crypto.randomUUID();
    const claimedAt = iso();
    const claimed = await db.prepare(`update briar_dm_memory_vectors set lease_token = ?, lease_expires_at = ?
      where id = ? and state in ('purging', 'purged') and (lease_expires_at is null or lease_expires_at <= ?)`)
      .bind(token, later(claimedAt, 60), row.id, claimedAt).run();
    if (!claimed.meta.changes) continue;
    try {
      const actual = await store.getByIds([row.id]);
      const info = await store.info();
      const processed = row.delete_mutation_id && (info.processedUpToMutation === row.delete_mutation_id
        || (info.processedUpToDatetime && row.delete_submitted_at
          && Date.parse(info.processedUpToDatetime) >= Date.parse(row.delete_submitted_at)));
      const writerFinished = !row.write_expires_at || Date.parse(row.write_expires_at) <= Date.parse(now);
      if (actual.length === 0 && writerFinished && (processed || row.state === "purged")) {
        await db.prepare(`update briar_dm_memory_vectors set state = 'purged', confirmed_at = ?,
          available_at = ?, lease_token = null, lease_expires_at = null, error_code = null
          where id = ? and lease_token = ?`)
          .bind(now, later(now, 86_400), row.id, token).run();
        purged++;
      } else {
        const mutation = await store.deleteByIds([row.id]);
        await db.prepare(`update briar_dm_memory_vectors set state = 'purging', delete_mutation_id = ?,
          delete_submitted_at = ?, confirmed_at = null, available_at = ?, lease_token = null, lease_expires_at = null
          where id = ? and lease_token = ?`)
          .bind(mutation.mutationId, iso(), later(iso(), 10), row.id, token).run();
      }
    } catch {
      await db.prepare(`update briar_dm_memory_vectors set error_code = 'vector_purge_failed', attempt = attempt + 1,
        state = case when attempt >= 2 then 'purge_failed' else state end,
        available_at = ?, lease_token = null, lease_expires_at = null where id = ? and lease_token = ?`)
        .bind(later(now, 30 * 2 ** Math.min(row.attempt, 2) + crypto.getRandomValues(new Uint8Array(1))[0]! % 10), row.id, token).run();
      failed++;
    }
  }
  await finishMemoryPurges(db, now);
  return { purged, failed };
}

export async function reconcileDmMemory(db: D1Database, store: DmMemoryVectorStore | null, observedAt: string, indexingEnabled = true) {
  await cleanupAbandonedReplyLookups(db, observedAt);
  const expired = await expireDmMemories(db, observedAt);
  if (!store) { await finishMemoryPurges(db, observedAt); return { expired, indexing: null, cleanup: null }; }
  const cleanup = await processDmMemoryVectorCleanup(db, store);
  const indexing = indexingEnabled ? await processDmMemoryIndexJobs(db, store) : null;
  return { expired, indexing, cleanup };
}

async function finishMemoryPurges(db: D1Database, now: string) {
  await db.prepare(`update briar_dm_memory_jobs set status = 'succeeded', stage = 'purged', updated_at = ?
    where id in (select job.id from briar_dm_memory_jobs job
      where job.kind = 'delete' and job.status not in ('succeeded', 'cancelled')
        and not exists (select 1 from briar_dm_memory_vectors vector
          where vector.document_id = job.document_id and vector.state <> 'purged')
      order by job.available_at, job.id limit 100)`)
    .bind(now).run();
}

export async function runDmMemoryMaintenance(env: Env, observedAt: string) {
  let store: DmMemoryVectorStore | null = null;
  try { store = dmMemoryVectorStore(env.DM_MEMORY_AI, env.DM_MEMORY_INDEX); }
  catch { /* Revocation and expiry cleanup must run even without a vector binding. */ }
  const result = await reconcileDmMemory(env.DB, store, observedAt, String(env.DM_MEMORY_INDEX_ENABLED) === "true");
  if (env.CHANNEL_ACTIVITY_REALTIME) await flushDmMemoryActivityRevocations(env.DB, env);
  return result;
}
