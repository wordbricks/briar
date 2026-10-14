import { requireDmMemoryReplyFence } from "./dm-memory-reply-fence";
import { HttpError } from "./http-response";

/**
 * Binds a DM reply claim to the live one-user/one-Agent roster's memory space.
 * The caller never chooses an owner or space.
 *
 * The fence is written for every eligible DM, whatever the Worker supports:
 * the memory vault resolves a DM claim's scope through it, and forget,
 * settings and roster changes end the claim and resumed conversations through
 * its revocation epoch. A Worker that reads memory from the vault
 * (`capabilities.memoryVaultProtocol = 1`) resumes its conversation while the
 * epoch is unchanged; any other Worker starts fresh, so a transcript that saw
 * memory never reaches a Worker that cannot honour a later revocation.
 *
 * Fence protocol 1 belonged to the retired D1 memory; every new fence is 0.
 */
export async function bindDmMemoryReplyClaim(db: D1Database, input: {
  jobId: string; claimTokenHash: string;
  /** The Worker reads memory from the vault (`capabilities.memoryVaultProtocol = 1`). */
  vaultCapable: boolean;
}) {
  const now = new Date().toISOString();
  await db.prepare(`insert into briar_dm_memory_spaces
    (id, organization_id, channel_id, owner_user_id, agent_id, roster_epoch, created_at, updated_at)
    select ?, live.organization_id, live.channel_id, live.owner_user_id, live.agent_id, live.roster_epoch, ?, ?
    from briar_channel_agent_reply_jobs job join briar_dm_memory_live_rosters live
      on live.channel_id = job.channel_id and live.organization_id = job.organization_id and live.agent_id = job.agent_id
    where job.id = ? and job.status = 'running' and job.claim_token_hash = ?
    on conflict (organization_id, channel_id, owner_user_id, agent_id, roster_epoch) do nothing`)
    .bind(crypto.randomUUID(), now, now, input.jobId, input.claimTokenHash).run();
  const selected = await db.prepare(`select space.id from briar_dm_memory_spaces space
    join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
      and live.channel_id = space.channel_id and live.agent_id = space.agent_id
      and live.owner_user_id = space.owner_user_id and live.roster_epoch = space.roster_epoch
    join briar_channel_agent_reply_jobs job on job.channel_id = space.channel_id and job.agent_id = space.agent_id
    where job.id = ? and job.claim_token_hash = ? and space.status = 'active'`)
    .bind(input.jobId, input.claimTokenHash).first<{ id: string }>();
  if (!selected) return null;
  const gate = `exists (select 1 from briar_channel_agent_reply_jobs job where job.id = ?
    and job.claim_token_hash = ? and job.status = 'running' and job.lease_expires_at > ?)`;
  const [bound] = await db.batch([
    db.prepare(`insert into briar_dm_memory_reply_fences
      (job_id, claim_token_hash, space_id, revocation_epoch, protocol, created_at)
      select ?, ?, space.id, space.revocation_epoch, 0, ? from briar_dm_memory_spaces space
      where space.id = ? and space.status = 'active' and ${gate}
      on conflict (job_id) do update set claim_token_hash = excluded.claim_token_hash,
        space_id = excluded.space_id, revocation_epoch = excluded.revocation_epoch,
        protocol = excluded.protocol, created_at = excluded.created_at returning space_id`)
      .bind(input.jobId, input.claimTokenHash, now, selected.id, input.jobId, input.claimTokenHash, now),
    db.prepare(`update briar_channel_reply_sessions as session
      set conversation_id = case when ? = 1 and session.memory_space_id = ?
        and session.memory_revocation_epoch = (select revocation_epoch from briar_dm_memory_spaces where id = ?)
        then session.conversation_id else null end,
        memory_space_id = ?, memory_revocation_epoch = (select revocation_epoch from briar_dm_memory_spaces where id = ?)
      where session.id = (select session_id from briar_channel_agent_reply_jobs where id = ?)
        and ${gate}`)
      .bind(input.vaultCapable ? 1 : 0, selected.id, selected.id, selected.id, selected.id, input.jobId,
        input.jobId, input.claimTokenHash, now),
    db.prepare(`delete from briar_channel_reply_lookups where job_id = ? and claim_token_hash <> ? and ${gate}`)
      .bind(input.jobId, input.claimTokenHash, input.jobId, input.claimTokenHash, now),
  ]);
  if (bound.results.length !== 1) throw new HttpError(409, "Memory claim changed", "memory_scope_revoked");
  await requireDmMemoryReplyFence(db, input.jobId);
  return { spaceId: selected.id };
}

/**
 * Only the Agent snapshot is filtered; the owner's conversation history stays
 * intact. `briar_dm_memory_exclusions` holds the source messages of memories
 * the owner deleted under the retired D1 memory; they stay withheld from
 * Agents. Vault forget does not add rows (spec §10: words of a forgotten
 * record kept elsewhere are separate things the owner deletes).
 */
export async function excludeForgottenDmSources<T extends { id: string }>(
  db: D1Database, channelId: string, messages: T[],
): Promise<T[]> {
  if (!messages.length) return messages;
  const rows = await db.prepare(`select distinct exclusion.source_id from briar_dm_memory_exclusions exclusion
    join briar_dm_memory_spaces space on space.id = exclusion.space_id
    where space.channel_id = ? and exclusion.source_type = 'message'
      and exclusion.source_id in (select value from json_each(?))`)
    .bind(channelId, JSON.stringify(messages.map((message) => message.id))).all<{ source_id: string }>();
  const excluded = new Set(rows.results.map((row) => row.source_id));
  return messages.filter((message) => !excluded.has(message.id));
}
