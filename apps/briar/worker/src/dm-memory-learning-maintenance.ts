/** Durable inputs remain queued; only an expired attempt and its copies are retired. */
export async function reapDmLearningClaims(db: D1Database, now: string, organizationId: string | null = null) {
  const expired = (await db.prepare(`select job.id, job.lease_token_hash, job.attempt, job.calls_used,
      exists (select 1 from briar_dm_memory_verifications verification where verification.job_id = job.id
        and verification.approved = 0) as rejected
    from briar_dm_memory_jobs job join briar_dm_memory_spaces space on space.id = job.space_id
    where job.kind in ('extract', 'explicit_request', 'consolidate') and job.status = 'running'
      and job.lease_expires_at <= ? and (? is null or space.organization_id = ?)
    order by job.lease_expires_at, job.id limit 100`)
    .bind(now, organizationId, organizationId)
    .all<{ id: string; lease_token_hash: string; attempt: number; calls_used: number; rejected: number }>()).results;
  let reaped = 0;
  for (const job of expired) {
    const code = job.rejected ? "verification_rejected" : "model_timeout";
    const gate = `exists (select 1 from briar_dm_memory_jobs where id = ? and updated_at = ?
      and lease_token_hash is null and error_code = ?)`;
    const [updated] = await db.batch([
      db.prepare(`update briar_dm_memory_jobs set status = ?, error_code = ?, input_json = null, input_hash = null,
        lease_token_hash = null, lease_expires_at = null, available_at = ?, updated_at = ?
        where id = ? and lease_token_hash = ? and status = 'running' and lease_expires_at <= ? returning id`)
        .bind(job.rejected || job.attempt >= 3 || job.calls_used >= 6 ? "failed" : "retry_wait", code, now, now,
          job.id, job.lease_token_hash, now),
      db.prepare(`update briar_dm_memory_proposals set proposal_json = null, normalized_json = null,
        status = 'rejected', terminal_at = ? where job_id = ? and status = 'proposed' and ${gate}`)
        .bind(now, job.id, job.id, now, code),
      db.prepare(`update briar_dm_memory_model_calls set status = 'failed', error_code = ?, completed_at = ?
        where job_id = ? and claim_token_hash = ? and status = 'reserved' and ${gate}`)
        .bind(code, now, job.id, job.lease_token_hash, job.id, now, code),
    ]);
    reaped += updated.results.length;
  }
  return reaped;
}

/** Keep body-free audit records, while bounding terminal model copies to 24 hours. */
export async function cleanupDmLearningPayloads(db: D1Database, now: string) {
  const cutoff = new Date(Date.parse(now) - 86_400_000).toISOString();
  const jobs = (await db.prepare(`select job.id from briar_dm_memory_jobs job
    where job.kind in ('extract', 'explicit_request', 'consolidate')
      and job.status in ('succeeded', 'no_change', 'failed', 'cancelled') and job.updated_at <= ?
      and (job.input_json is not null or job.lease_token_hash is not null
        or exists (select 1 from briar_dm_memory_proposals proposal where proposal.job_id = job.id
          and (proposal.proposal_json is not null or proposal.normalized_json is not null))
        or exists (select 1 from briar_dm_memory_verifications verification where verification.job_id = job.id
          and verification.decisions_json is not null))
    order by job.updated_at, job.id limit 100`).bind(cutoff).all<{ id: string }>()).results;
  if (!jobs.length) return 0;
  const ids = JSON.stringify(jobs.map((job) => job.id));
  const gate = `id in (select value from json_each(?)) and status in ('succeeded', 'no_change', 'failed', 'cancelled') and updated_at <= ?`;
  const relatedGate = `job_id in (select id from briar_dm_memory_jobs where ${gate})`;
  await db.batch([
    db.prepare(`update briar_dm_memory_jobs set input_json = null, request_targets_json = '[]',
      lease_token_hash = null, lease_expires_at = null where ${gate}`)
      .bind(ids, cutoff),
    db.prepare(`update briar_dm_memory_proposals set proposal_json = null, normalized_json = null where ${relatedGate}`)
      .bind(ids, cutoff),
    db.prepare(`update briar_dm_memory_verifications set decisions_json = null where ${relatedGate}`)
      .bind(ids, cutoff),
  ]);
  return jobs.length;
}

export async function maintainDmMemoryLearning(db: D1Database, now: string) {
  const reaped = await reapDmLearningClaims(db, now);
  return { reaped, cleared: await cleanupDmLearningPayloads(db, now) };
}
