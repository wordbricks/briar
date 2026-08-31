import { sha256 } from "./crypto-digest";
import { dmMemoryReplyFenceCurrent } from "./dm-memory-reply-fence";
import { HttpError } from "./http-response";

type LookupRow = {
  request_hash: string | null; memory_revision: number | null; revocation_epoch: number | null;
  response_json: string | null; lease_token: string; lease_expires_at: string; attempts: number;
};
export type ReplyLookupReservation = {
  jobId: string; claimTokenHash: string; requestId: string; leaseToken: string;
  memoryRevision: number | null; revocationEpoch: number | null; cachedJson: string | null;
};

export async function reserveReplyLookup(db: D1Database, input: {
  jobId: string; claimTokenHash: string; requestId: string; kind: "memory" | "organization";
  request: unknown; queries?: readonly string[]; memoryRevision: number | null; revocationEpoch: number | null;
}): Promise<ReplyLookupReservation> {
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + 7_000).toISOString();
  const leaseToken = crypto.randomUUID();
  // Hashes are claim-salted, never written to logs, and removed on forgetting.
  const salt = `${input.jobId}:${input.claimTokenHash}:`;
  const requestHash = await sha256(salt + JSON.stringify([input.kind, input.request]));
  const queryHashes = await Promise.all([...new Set(input.queries ?? [])].map((query) => sha256(salt + query)));
  const keys = [input.jobId, input.claimTokenHash, input.requestId];
  const read = () => db.prepare(`select request_hash, memory_revision, revocation_epoch,
    response_json, lease_token, lease_expires_at, attempts from briar_channel_reply_lookups
    where job_id = ? and claim_token_hash = ? and request_id = ?`).bind(...keys).first<LookupRow>();
  await db.prepare(`insert into briar_channel_reply_lookups
    (job_id, claim_token_hash, request_id, kind, request_hash, query_hashes_json,
      memory_revision, revocation_epoch, lease_token, lease_expires_at, response_json, created_at)
    select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (
      select response_json from briar_channel_reply_lookups cache
      where cache.job_id = ? and cache.claim_token_hash = ? and cache.kind = ? and cache.request_hash = ?
        and cache.memory_revision is ? and cache.revocation_epoch is ? and cache.response_json is not null
      order by cache.created_at desc limit 1
    ), ?
    where exists (select 1 from briar_channel_agent_reply_jobs job where job.id = ?
      and job.claim_token_hash = ? and job.status = 'running' and job.lease_expires_at > ?
      and ${dmMemoryReplyFenceCurrent("job")})
      and (select count(*) from briar_channel_reply_lookups where job_id = ? and claim_token_hash = ?) < 3
      and (select count(*) from (
        select query.value from briar_channel_reply_lookups lookup, json_each(lookup.query_hashes_json) query
          where lookup.job_id = ? and lookup.claim_token_hash = ?
        union select value from json_each(?)
      )) <= 6
    on conflict (job_id, claim_token_hash, request_id) do nothing`)
    .bind(...keys, input.kind, requestHash, JSON.stringify(queryHashes), input.memoryRevision, input.revocationEpoch,
      leaseToken, leaseExpiresAt, input.jobId, input.claimTokenHash, input.kind, requestHash,
      input.memoryRevision, input.revocationEpoch, now, input.jobId, input.claimTokenHash, now,
      input.jobId, input.claimTokenHash, input.jobId, input.claimTokenHash, JSON.stringify(queryHashes)).run();
  let row = await read();
  if (!row) throw new HttpError(429, "Reply lookup budget exhausted", "lookup_budget_exhausted");
  if (row.request_hash !== requestHash || row.memory_revision !== input.memoryRevision || row.revocation_epoch !== input.revocationEpoch) {
    throw new HttpError(409, "Lookup request ID cannot be reused after input or memory changes", "lookup_request_conflict");
  }
  if (!row.response_json && row.lease_token !== leaseToken) {
    if (row.lease_expires_at > now) throw new HttpError(409, "Lookup is still running; retry this request ID", "lookup_in_progress");
    if (row.attempts >= 3) throw new HttpError(503, "Lookup retry limit reached", "lookup_failed");
    await db.prepare(`update briar_channel_reply_lookups set lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
      where job_id = ? and claim_token_hash = ? and request_id = ? and lease_expires_at <= ? and attempts < 3
        and response_json is null`).bind(leaseToken, leaseExpiresAt, ...keys, now).run();
    row = await read();
    if (!row || row.lease_token !== leaseToken) throw new HttpError(409, "Lookup is still running", "lookup_in_progress");
  }
  return { jobId: input.jobId, claimTokenHash: input.claimTokenHash, requestId: input.requestId,
    leaseToken, memoryRevision: input.memoryRevision, revocationEpoch: input.revocationEpoch, cachedJson: row.response_json };
}

export function replyLookupCompletionStatement(db: D1Database, reservation: ReplyLookupReservation, response: unknown) {
  return db.prepare(`update briar_channel_reply_lookups set response_json = ?
    where job_id = ? and claim_token_hash = ? and request_id = ? and lease_token = ?
      and memory_revision is ? and revocation_epoch is ?
      and exists (select 1 from briar_channel_agent_reply_jobs job where job.id = job_id
        and job.claim_token_hash = briar_channel_reply_lookups.claim_token_hash and job.status = 'running'
        and job.lease_expires_at > ? and ${dmMemoryReplyFenceCurrent("job")})
      and (? is null or exists (
        select 1 from briar_dm_memory_reply_fences fence join briar_dm_memory_spaces space on space.id = fence.space_id
        where fence.job_id = briar_channel_reply_lookups.job_id and space.memory_revision = ?
          and space.revocation_epoch = ?)) returning request_id`)
    .bind(JSON.stringify(response), reservation.jobId, reservation.claimTokenHash, reservation.requestId,
      reservation.leaseToken, reservation.memoryRevision, reservation.revocationEpoch, new Date().toISOString(),
      reservation.memoryRevision, reservation.memoryRevision, reservation.revocationEpoch);
}

/** Re-read the cache after authorization so a concurrent revision change cannot replay old data. */
export async function currentReplyLookupCache(db: D1Database, reservation: ReplyLookupReservation) {
  return db.prepare(`select response_json from briar_channel_reply_lookups lookup
    where lookup.job_id = ? and lookup.claim_token_hash = ? and lookup.request_id = ?
      and lookup.memory_revision is ? and lookup.revocation_epoch is ? and response_json is not null
      and (? is null or exists (select 1 from briar_dm_memory_reply_fences fence
        join briar_dm_memory_spaces space on space.id = fence.space_id where fence.job_id = lookup.job_id
          and space.memory_revision = ? and space.revocation_epoch = ?))`)
    .bind(reservation.jobId, reservation.claimTokenHash, reservation.requestId, reservation.memoryRevision,
      reservation.revocationEpoch, reservation.memoryRevision, reservation.memoryRevision, reservation.revocationEpoch)
    .first<{ response_json: string }>();
}

export async function cleanupAbandonedReplyLookups(db: D1Database, now: string) {
  const staleJobs = `select job.id from briar_channel_agent_reply_jobs job
    where (job.status <> 'running' or julianday(job.lease_expires_at) <= julianday(?))
      and (exists (select 1 from briar_channel_reply_lookups lookup where lookup.job_id = job.id)
        or exists (select 1 from briar_dm_memory_discovered_refs ref where ref.job_id = job.id))
    order by job.updated_at limit 100`;
  // Both reads run in the same transaction. A completed reply no longer needs its discovery set.
  await db.batch([
    db.prepare(`delete from briar_channel_reply_lookups where job_id in (${staleJobs})`).bind(now),
    db.prepare(`delete from briar_dm_memory_discovered_refs where job_id in (${staleJobs})`).bind(now),
  ]);
}
