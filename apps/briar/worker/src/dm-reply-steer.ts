/** The receive-time window slides only while messages belong to this response. */
export const DM_REPLY_STEER_MS = 30_000;

const plain = (job: string) => `${job}.skill_id is null
  and ${job}.delegated_by_reply_job_id is null and ${job}.agent_message_hop = 0
  and ${job}.approved_skill_execution_proposal_id is null`;

/** Appended to the message transaction, after inserting its reply job. */
export function dmReplySteerStatements(db: D1Database, jobId: string) {
  return [
    db.prepare(`update briar_channel_agent_reply_jobs as incoming
      set superseded_by_reply_job_id = (
        select active.id from briar_channel_agent_reply_jobs active
        where active.session_id = incoming.session_id and active.id <> incoming.id
          and (active.status = 'running' or (active.status = 'queued' and active.steer_revision > 0))
          and active.lease_expires_at > incoming.created_at
          and ${plain("active")} and active.superseded_by_reply_job_id is null
          and incoming.created_at >= coalesce(active.last_input_at, active.created_at)
          and incoming.created_at <= strftime('%Y-%m-%dT%H:%M:%fZ',
            coalesce(active.last_input_at, active.created_at), '+${DM_REPLY_STEER_MS / 1_000} seconds')
          and not exists (
            select 1 from briar_channel_agent_reply_jobs barrier
            where barrier.session_id = active.session_id
              and barrier.id not in (active.id, incoming.id)
              and barrier.superseded_by_reply_job_id is null
              and barrier.created_at > coalesce(active.last_input_at, active.created_at)
              and barrier.created_at <= incoming.created_at
          )
        order by active.created_at, active.id limit 1
      )
      where incoming.id = ? and incoming.status = 'queued'
        and ${plain("incoming")} and incoming.superseded_by_reply_job_id is null
        and exists (select 1 from briar_channels channel
          join briar_channel_messages message on message.channel_id = channel.id
          where channel.id = incoming.channel_id and channel.kind = 'dm'
            and message.id = incoming.trigger_message_id and message.author_user_id is not null)`)
      .bind(jobId),
    db.prepare(`update briar_channel_agent_reply_jobs
      set steer_revision = steer_revision + 1,
          last_input_at = (select created_at from briar_channel_agent_reply_jobs where id = ?)
      where id = (select superseded_by_reply_job_id from briar_channel_agent_reply_jobs where id = ? and status = 'queued')`)
      .bind(jobId, jobId),
    db.prepare(`update briar_channel_agent_reply_jobs
      set status = 'completed', completed_at = created_at
      where id = ? and superseded_by_reply_job_id is not null`)
      .bind(jobId),
  ];
}

/** The Worker calls this only after its provider has stopped. The old token is
 * retained until the next claim so an acknowledgement retry is idempotent. */
export async function acknowledgeDmReplySteer(db: D1Database, input: {
  jobId: string; organizationId: string; channelId: string;
  deviceId: string; workerId: string; claimTokenHash: string; observedAt: string;
}) {
  const result = await db.prepare(`update briar_channel_agent_reply_jobs
    set status = 'queued', updated_at = ?
    where id = ? and organization_id = ? and channel_id = ?
      and claimed_device_id = ? and claimed_worker_id = ? and claim_token_hash = ?
      and status in ('running', 'queued') and lease_expires_at > ?
      and steer_revision > applied_steer_revision
    returning id`).bind(input.observedAt, input.jobId, input.organizationId,
      input.channelId, input.deviceId, input.workerId, input.claimTokenHash,
      input.observedAt).first<{ id: string }>();
  return result !== null;
}
