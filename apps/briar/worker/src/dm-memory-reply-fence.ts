import { HttpError } from "./http-response";

/**
 * A DM reply claim is fenced to the memory space it was bound to
 * (`bindDmMemoryReplyClaim`). The fence holds while the space is active, its
 * roster is live and its revocation epoch is the one the claim saw; a forget,
 * a settings change or a roster change moves the epoch and ends the claim.
 * The memory vault resolves a DM claim's scope through the same fence.
 *
 * SQL guard; runs inside completion's transaction, after any model/attachment I/O.
 */
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
    )
)`;

export async function requireDmMemoryReplyFence(db: D1Database, jobId: string) {
  const fence = await db.prepare(`select 1 from briar_dm_memory_reply_fences where job_id = ?`)
    .bind(jobId).first();
  if (!fence) return;
  const valid = await db.prepare(`select 1 from briar_channel_agent_reply_jobs job
    where job.id = ? and job.status = 'running' and julianday(job.lease_expires_at) > julianday('now')
      and ${dmMemoryReplyFenceCurrent("job")}`)
    .bind(jobId).first();
  if (!valid) throw new HttpError(409, "Memory context was revoked; start a fresh reply", "memory_scope_revoked");
}
