/**
 * What a Worker publishes when it claims a reply the server has not reacted to
 * yet, and what a completed reply falls back to. It says only "this was read",
 * so it may open the Agent's slot but must never take it from a reaction that
 * says more.
 */
export const CHANNEL_ACKNOWLEDGEMENT_PLACEHOLDER = "👀";

/** If the body outruns selection, finish with a fallback without delaying the body. */
export function channelAcknowledgementFallbackStatement(
  db: D1Database,
  input: {
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    completedAt: string;
  },
): D1PreparedStatement {
  return db.prepare(`
    insert into briar_channel_message_reactions (message_id, user_id, agent_id, emoji, created_at)
    select job.trigger_message_id, null, job.agent_id, '👀', ?
    from briar_channel_agent_reply_jobs job
    join briar_channels channel on channel.id = job.channel_id
    join briar_project_agents agent
      on agent.id = job.agent_id and agent.organization_id = job.organization_id
    join briar_channel_agents roster
      on roster.channel_id = channel.id and roster.agent_id = agent.id
    join briar_channel_messages message
      on message.id = job.trigger_message_id and message.channel_id = channel.id
    where job.id = ? and job.claimed_device_id = ? and job.claimed_worker_id = ?
      and job.claim_token_hash = ? and job.status = 'completed' and job.completed_at = ?
      and channel.organization_id = job.organization_id and channel.kind = 'dm'
      and message.author_user_id is not null and message.deleted_at is null
      and not exists (select 1 from briar_channel_message_reactions existing
        where existing.message_id = job.trigger_message_id and existing.agent_id = job.agent_id)
    on conflict do nothing
  `).bind(input.completedAt, input.jobId, input.deviceId, input.workerId,
    input.claimTokenHash, input.completedAt);
}
