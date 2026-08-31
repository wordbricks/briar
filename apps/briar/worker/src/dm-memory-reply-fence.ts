import { expireDmMemories } from "./dm-memory-access";
import { HttpError } from "./http-response";

/** SQL guard runs inside completion's transaction, after any model/attachment I/O. */
export const dmMemoryReplyFenceCurrent = (job: string) => `not exists (
  select 1 from briar_dm_memory_reply_fences fence
  where fence.job_id = ${job}.id and fence.claim_token_hash = ${job}.claim_token_hash
    and not exists (
      select 1 from briar_dm_memory_spaces space
      join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
        and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
        and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
      where space.id = fence.space_id and space.status = 'active'
        and space.organization_id = ${job}.organization_id and space.channel_id = ${job}.channel_id
        and space.agent_id = ${job}.agent_id and space.revocation_epoch = fence.revocation_epoch
        and (fence.protocol = 0 or exists (select 1 from briar_execution_workers binding
          where binding.id = ${job}.claimed_worker_id and binding.device_id = ${job}.claimed_device_id
            and json_valid(binding.runtime_proto_json)
            and json_type(binding.runtime_proto_json, '$.capabilities.dmMemoryProtocol') = 'integer'
            and json_extract(binding.runtime_proto_json, '$.capabilities.dmMemoryProtocol') = 1))
        and not exists (select 1 from briar_dm_memory_documents expired
          join briar_dm_memory_revisions rev on rev.document_id = expired.id and rev.version = expired.current_version
          where expired.space_id = space.id and expired.status = 'active'
            and expired.expired_version <> expired.current_version
            and julianday(rev.valid_until) <= julianday('now'))
    )
)`;

export async function requireDmMemoryReplyFence(db: D1Database, jobId: string) {
  const fence = await db.prepare(`select space_id from briar_dm_memory_reply_fences where job_id = ?`)
    .bind(jobId).first<{ space_id: string }>();
  if (!fence) return;
  await expireDmMemories(db, new Date().toISOString(), fence.space_id);
  const valid = await db.prepare(`select 1 from briar_channel_agent_reply_jobs job
    where job.id = ? and job.status = 'running' and julianday(job.lease_expires_at) > julianday('now')
      and ${dmMemoryReplyFenceCurrent("job")}`)
    .bind(jobId).first();
  if (!valid) throw new HttpError(409, "Memory context was revoked; start a fresh reply", "memory_scope_revoked");
}
