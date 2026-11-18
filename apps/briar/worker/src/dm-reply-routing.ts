import { dmScheduleReplyFenceCurrent } from "./dm-schedule-fence";
import { dmPublicMessageBatchStatements, getDmPublicMessageClaim } from "./dm-public-message-repository";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import type { ChannelReplyJobRow } from "./channels";

export type DmReplyRoutingDecision = {
  action: string;
  proposedAction?: string | null;
  targetJobId?: string | null;
  response?: string | null;
};

// A reply points to a job; it does not decide what the person wants to do to it.
export async function dmReplyRoutingContext(db: D1Database, job: ChannelReplyJobRow) {
  const explicit = await db.prepare(`select coalesce(original.superseded_by_reply_job_id, original.id) as id
    from briar_channel_messages incoming
    join briar_channel_messages reference on reference.id = incoming.parent_message_id
      and reference.channel_id = incoming.channel_id
    left join briar_dm_public_message_batches batch on batch.id = reference.dm_batch_id
    join briar_channel_agent_reply_jobs original on
      (original.trigger_message_id = reference.id or original.reply_message_id = reference.id
       or original.id = batch.origin_reply_job_id)
    where incoming.id = ? and original.organization_id = ?
      and original.channel_id = ? and original.agent_id = ? limit 1`)
    .bind(job.trigger_message_id, job.organization_id, job.channel_id, job.agent_id)
    .first<{ id: string }>();
  const candidates = await db.prepare(`select candidate.id, candidate.status,
      substr(message.body, 1, 3000) as request, candidate.created_at as createdAt,
      candidate.error as error, candidate.stop_requested_at as stopRequestedAt,
      candidate.stop_confirmed_at as stopConfirmedAt,
      substr((select progress.body from briar_channel_messages progress
        join briar_dm_public_message_batches batch on batch.id = progress.dm_batch_id
        where batch.origin_reply_job_id = candidate.id
        order by progress.created_at desc, progress.id desc limit 1), 1, 1500) as progress
    from briar_channel_agent_reply_jobs candidate
    join briar_channel_messages message on message.id = candidate.trigger_message_id
    where candidate.organization_id = ? and candidate.channel_id = ? and candidate.agent_id = ?
      and candidate.id <> ? and candidate.rowid < (select rowid from briar_channel_agent_reply_jobs where id = ?) and candidate.skill_id is null
      and candidate.agent_message_hop = 0 and candidate.delegated_by_reply_job_id is null
      and candidate.approved_skill_execution_proposal_id is null
      and candidate.superseded_by_reply_job_id is null
      and (candidate.routing_action is null or candidate.routing_action in ('new', 'pending'))
      and (message.author_user_id is not null or (candidate.dm_schedule_id is not null and ${dmScheduleReplyFenceCurrent("candidate")}))
      and message.deleted_at is null
    order by candidate.id = ? desc, candidate.created_at desc, candidate.rowid desc limit 21`)
    .bind(job.organization_id, job.channel_id, job.agent_id, job.id, job.id, explicit?.id ?? null)
    .all();
  return { explicitTargetJobId: explicit?.id ?? null,
    candidates: candidates.results.slice(0, 20), candidatesTruncated: candidates.results.length > 20 };
}

const authorized = `exists (
  select 1 from briar_channels channel
  join briar_channel_messages message on message.channel_id = channel.id
  join briar_channel_members member on member.channel_id = channel.id
    and member.user_id = message.author_user_id
  join briar_organization_members organization_member
    on organization_member.organization_id = channel.organization_id
    and organization_member.user_id = member.user_id
  join briar_channel_agents roster on roster.channel_id = channel.id
    and roster.agent_id = incoming.agent_id
  where channel.id = incoming.channel_id and channel.organization_id = incoming.organization_id
    and channel.kind = 'dm' and channel.archived_at is null
    and message.id = incoming.trigger_message_id and message.deleted_at is null
    and (select count(*) from briar_channel_members where channel_id = channel.id) = 1
    and (select count(*) from briar_channel_agents where channel_id = channel.id) = 1
)`;

/** The chosen intent survives a restart. Its effect and public receipt commit together. */
export async function resolveDmReplyRouting(db: D1Database, input: {
  jobId: string; workspaceId: string; channelId: string; deviceId: string;
  workerId: string; claimTokenHash: string; observedAt: string;
  decision: DmReplyRoutingDecision;
}) {
  if (!["new", "steer", "cancel", "answer", "clarify"].includes(input.decision.action) ||
      ((input.decision.action === "steer" || input.decision.action === "cancel") && !input.decision.targetJobId) ||
      ((input.decision.action === "answer" || input.decision.action === "clarify") && !input.decision.response?.trim()) ||
      (input.decision.response?.length ?? 0) > 8000) throw new HttpError(400, "Invalid DM routing decision");
  const identity = [input.jobId, input.workspaceId, input.channelId,
    input.deviceId, input.workerId, input.claimTokenHash];
  const claimed = `incoming.id = ? and incoming.organization_id = ? and incoming.channel_id = ?
    and incoming.claimed_device_id = ? and incoming.claimed_worker_id = ? and incoming.claim_token_hash = ?`;
  const readDecision = () => db.prepare(`select routing_action as action,
      routing_decision_action as proposedAction, routing_target_job_id as targetJobId,
      routing_response as response, status, lease_expires_at as leaseExpiresAt
    from briar_channel_agent_reply_jobs incoming where ${claimed} and ${authorized}`)
    .bind(...identity).first<DmReplyRoutingDecision & { status: string; leaseExpiresAt: string | null }>();
  let existing = await readDecision();
  if (!existing?.action) throw new HttpError(409, "DM routing claim is unavailable");
  if (existing.action === "steer" || existing.action === "cancel") return existing;
  if (existing.status !== "running" || !existing.leaseExpiresAt || existing.leaseExpiresAt <= input.observedAt) {
    throw new HttpError(409, "DM routing claim is no longer active");
  }
  if (existing.action !== "pending") return existing;
  const target = `select target.id from briar_channel_agent_reply_jobs target
    join briar_channel_messages source on source.id = target.trigger_message_id
    where target.id = ? and target.organization_id = incoming.organization_id
      and target.channel_id = incoming.channel_id and target.agent_id = incoming.agent_id
      and target.rowid < incoming.rowid and target.skill_id is null
      and target.agent_message_hop = 0 and target.delegated_by_reply_job_id is null
      and target.approved_skill_execution_proposal_id is null
      and target.superseded_by_reply_job_id is null
      and (target.routing_action is null or target.routing_action = 'new')
      and (source.author_user_id is not null or (target.dm_schedule_id is not null and ${dmScheduleReplyFenceCurrent("target")}))
      and source.deleted_at is null`;
  if (!existing.proposedAction) {
    const targetAction = input.decision.action === "steer" || input.decision.action === "cancel";
    await db.prepare(`update briar_channel_agent_reply_jobs as incoming
      set routing_decision_action = ?, routing_target_job_id = ?, routing_response = ?
      where ${claimed} and incoming.status = 'running' and incoming.lease_expires_at > ?
        and incoming.routing_action = 'pending' and incoming.routing_decision_action is null
        and ${authorized} and (? = 0 or exists (${target}))`)
      .bind(input.decision.action, targetAction ? input.decision.targetJobId! : null,
        input.decision.response?.trim() || null, ...identity, input.observedAt,
        targetAction ? 1 : 0, input.decision.targetJobId ?? null).run();
    existing = await readDecision();
    if (!existing?.proposedAction) throw new HttpError(409, "DM routing target or claim changed");
    if (existing.action !== "pending") return existing;
  }
  const decision = { action: existing.proposedAction, targetJobId: existing.targetJobId,
    response: existing.response };
  const targetAction = decision.action === "steer" || decision.action === "cancel";
  if (targetAction && await db.prepare(`select id from briar_channel_agent_reply_jobs earlier
    where earlier.organization_id = ? and earlier.channel_id = ? and earlier.agent_id = (
      select agent_id from briar_channel_agent_reply_jobs where id = ?)
      and earlier.rowid < (select rowid from briar_channel_agent_reply_jobs where id = ?)
      and earlier.routing_action = 'pending' and earlier.status in ('queued', 'running')`)
    .bind(input.workspaceId, input.channelId, input.jobId, input.jobId).first()) return existing;
  // A terminal result stays the result. A late steer becomes a fresh follow-up;
  // a late cancel never selects a different running job.
  const liveTarget = `${target} and target.status in ('queued', 'running') and target.stop_requested_at is null
    and not exists (select 1 from briar_dm_public_message_batches final
      where final.origin_reply_job_id = target.id and final.publication_kind = 'final')`;
  const marker = crypto.randomUUID();
  const targetId = decision.targetJobId ?? null;
  const acceptedBody = decision.action === "steer"
    ? "해당 작업에 변경을 전달했습니다. 적용을 기다리고 있습니다."
    : "해당 작업의 중단을 요청했습니다. 실행 중단 확인을 기다리고 있습니다.";
  const scope = targetAction ? await getDmPublicMessageClaim(db, { ...input, control: "classification" }) : null;
  if (targetAction && !scope) throw new HttpError(409, "DM routing publication authority changed");
  const publication = scope ? dmPublicMessageBatchStatements(db, {
    scope, requestId: `dm-routing:${input.jobId}`, publicationKind: "final",
    parts: [{ purpose: "acknowledgement", body: acceptedBody }], payloadHash: await sha256(acceptedBody),
    workerId: input.workerId, deviceId: input.deviceId, claimTokenHash: input.claimTokenHash,
    createdAt: input.observedAt, control: "routing", routingReceiptId: marker,
  }) : null;
  const receipt = `select id from briar_channel_agent_reply_jobs where id = ? and routing_receipt_id = ?
    and exists (select 1 from briar_dm_public_message_batches where id = ?)`;
  const receiptParams = [input.jobId, marker, publication?.batchId ?? null];
  await db.batch([
    db.prepare(`update briar_channel_agent_reply_jobs as incoming set
      routing_action = case when ? = 'steer' and not exists (${liveTarget}) then 'new'
        when ? = 'cancel' and not exists (${liveTarget}) then 'answer' else ? end,
      routing_response = case when ? = 'cancel' and not exists (${liveTarget})
        then '이 요청에 연결된 작업은 이미 끝났습니다. 다른 작업은 중단하지 않았습니다.'
        when ? = 1 then ? else routing_response end,
      routing_receipt_id = ?, updated_at = ?
      where ${claimed} and incoming.status = 'running' and incoming.lease_expires_at > ?
        and incoming.routing_action = 'pending' and ${authorized}
        and (? = 0 or exists (${target}))
        and (? = 0 or not exists (select 1 from briar_channel_agent_reply_jobs earlier
          where earlier.organization_id = incoming.organization_id and earlier.channel_id = incoming.channel_id
            and earlier.agent_id = incoming.agent_id and earlier.rowid < incoming.rowid
            and earlier.routing_action = 'pending' and earlier.status in ('queued', 'running')))`)
      .bind(decision.action, targetId, decision.action, targetId, decision.action,
        decision.action, targetId, targetAction ? 1 : 0, acceptedBody,
        marker, input.observedAt, ...identity, input.observedAt,
        targetAction ? 1 : 0, targetId, targetAction ? 1 : 0),
    ...(publication?.statements ?? []),
    db.prepare(`update briar_channel_agent_reply_jobs set
        steer_revision = steer_revision + 1,
        last_input_at = (select created_at from briar_channel_agent_reply_jobs where id = ?)
      where id = (select routing_target_job_id from briar_channel_agent_reply_jobs
        where id in (${receipt}) and routing_action = 'steer')
        and status in ('queued', 'running') and stop_requested_at is null`)
      .bind(input.jobId, ...receiptParams),
    db.prepare(`update briar_channel_agent_reply_jobs set
        stop_requested_at = ?, stop_confirmed_at = case when status = 'queued' then ? else null end,
        status = 'completed', completed_at = ?, updated_at = ?, error = ?
      where id = (select routing_target_job_id from briar_channel_agent_reply_jobs
        where id in (${receipt}) and routing_action = 'cancel')
        and status in ('queued', 'running') and stop_requested_at is null`)
      .bind(input.observedAt, input.observedAt, input.observedAt, input.observedAt,
        `dm_reply_stopped:${input.jobId}`, ...receiptParams),
    db.prepare(`update briar_channel_agent_reply_jobs set
        superseded_by_reply_job_id = routing_target_job_id, status = 'completed', completed_at = ?
      where id in (${receipt}) and routing_action in ('steer', 'cancel')`)
      .bind(input.observedAt, ...receiptParams),
    // A lost publication fence must not accept the control or change its target.
    db.prepare(`update briar_channel_agent_reply_jobs set routing_action = 'pending', routing_receipt_id = null
      where id = ? and routing_receipt_id = ? and routing_action in ('steer', 'cancel')
        and not exists (select 1 from briar_dm_public_message_batches where id = ?)`)
      .bind(...receiptParams),
  ]);
  const saved = await readDecision();
  if (!saved) throw new HttpError(409, "DM routing claim changed");
  if (saved.action === "pending") {
    const waiting = await db.prepare(`select id from briar_channel_agent_reply_jobs incoming
      where ${claimed} and incoming.status = 'running' and incoming.lease_expires_at > ? and ${authorized}
        and exists (select 1 from briar_channel_agent_reply_jobs earlier
          where earlier.channel_id = incoming.channel_id and earlier.agent_id = incoming.agent_id
            and earlier.rowid < incoming.rowid and earlier.routing_action = 'pending'
            and earlier.status in ('queued', 'running'))`)
      .bind(...identity, input.observedAt).first();
    if (!waiting) throw new HttpError(409, "DM routing target or publication authority changed");
  }
  return saved;
}
