import { liveChannelReplyRuntime } from "./channels";
import { dmMemoryReplyFenceCurrent } from "./dm-memory-reply-fence";
import type {
  DmPublicMessageBatchRow,
  DmPublicMessageClaimRow,
  DmPublicMessagePartInput,
  DmPublicMessagePublicationKind,
  DmPublishedMessageBatch,
} from "./dm-public-message-model";

const publicMessageCapabilitySql = (job: string) => `
  json_type(binding.runtime_proto_json,
    '$.capabilities.dmPublicMessages.protocol') = 'integer'
  and json_extract(binding.runtime_proto_json,
    '$.capabilities.dmPublicMessages.protocol') = 1
  and exists (
    select 1
    from json_each(binding.runtime_proto_json,
      '$.capabilities.dmPublicMessages.providers') provider
    where provider.value = 'AGENT_PROVIDER_' ||
      upper(replace(${job}.agent_provider, '-', '_'))
  )`;

export async function captureDmPublicMessageClaim(
  db: D1Database,
  input: {
    jobId: string;
    organizationId: string;
    workerId: string;
    deviceId: string;
    claimTokenHash: string;
    observedAt: string;
  },
) {
  await db.prepare(
    `insert into briar_dm_public_message_claim_scopes (
       job_id, organization_id, channel_id, owner_user_id, agent_id,
       roster_epoch, input_revision, trigger_message_id,
       trigger_source_version, worker_id, device_id, claim_token_hash,
       created_at
     )
     select job.id, job.organization_id, job.channel_id, member.user_id,
            job.agent_id, channel.memory_roster_epoch,
            job.applied_steer_revision, trigger.id,
            trigger.memory_source_version, job.claimed_worker_id,
            job.claimed_device_id, job.claim_token_hash, ?
     from briar_channel_agent_reply_jobs job
     join briar_channels channel
       on channel.id = job.channel_id
      and channel.organization_id = job.organization_id
      and channel.kind = 'dm'
     join briar_channel_members member on member.channel_id = job.channel_id
     join briar_channel_messages trigger
       on trigger.id = job.trigger_message_id
      and trigger.channel_id = job.channel_id
      and trigger.deleted_at is null
     join briar_execution_workers binding
       on binding.id = job.claimed_worker_id
      and binding.device_id = job.claimed_device_id
     join briar_execution_worker_devices device on device.id = binding.device_id
     where job.id = ? and job.organization_id = ?
       and job.claimed_worker_id = ? and job.claimed_device_id = ?
       and job.claim_token_hash = ? and job.status = 'running'
       and job.lease_expires_at > ?
       and job.steer_revision = job.applied_steer_revision
       and binding.state <> 'disabled' and device.state <> 'disabled'
       and device.organization_id = job.organization_id
       and ${publicMessageCapabilitySql("job")}
       and exists (
         select 1 from briar_channel_agents roster
         where roster.channel_id = job.channel_id
           and roster.agent_id = job.agent_id
       )
       and (select count(*) from briar_channel_agents
            where channel_id = job.channel_id) = 1
       and (select count(*) from briar_channel_members
            where channel_id = job.channel_id) = 1
     on conflict (job_id) do update set
       organization_id = excluded.organization_id,
       channel_id = excluded.channel_id,
       owner_user_id = excluded.owner_user_id,
       agent_id = excluded.agent_id,
       roster_epoch = excluded.roster_epoch,
       input_revision = excluded.input_revision,
       trigger_message_id = excluded.trigger_message_id,
       trigger_source_version = excluded.trigger_source_version,
       worker_id = excluded.worker_id,
       device_id = excluded.device_id,
       claim_token_hash = excluded.claim_token_hash,
       created_at = excluded.created_at`,
  ).bind(
    input.observedAt,
    input.jobId,
    input.organizationId,
    input.workerId,
    input.deviceId,
    input.claimTokenHash,
    input.observedAt,
  ).run();
  return getDmPublicMessageClaim(db, { ...input, control: "classification" });
}

export async function getDmPublicMessageClaim(
  db: D1Database,
  input: {
    jobId: string;
    organizationId: string;
    workerId: string;
    deviceId: string;
    claimTokenHash: string;
    observedAt: string;
    control?: "classification" | "routing" | "stop" | "stop-unconfirmed";
  },
) {
  return db.prepare(
    `select job.id as job_id, job.organization_id, job.channel_id,
            job.project_id, captured.owner_user_id, job.agent_id,
            agent.name as agent_name, job.agent_provider,
            captured.roster_epoch, captured.input_revision,
            captured.trigger_message_id, captured.trigger_source_version,
            job.reply_message_id
     from briar_channel_agent_reply_jobs job
     join briar_dm_public_message_claim_scopes captured
       on captured.job_id = job.id
      and captured.organization_id = job.organization_id
      and captured.channel_id = job.channel_id
      and captured.agent_id = job.agent_id
      and captured.input_revision = job.applied_steer_revision
      and captured.worker_id = job.claimed_worker_id
      and captured.device_id = job.claimed_device_id
      and captured.claim_token_hash = job.claim_token_hash
     join briar_channels channel
       on channel.id = job.channel_id
      and channel.organization_id = job.organization_id
      and channel.kind = 'dm'
      and channel.memory_roster_epoch = captured.roster_epoch
     join briar_project_agents agent
       on agent.id = job.agent_id
      and agent.organization_id = job.organization_id
     join briar_channel_agents roster
       on roster.channel_id = job.channel_id and roster.agent_id = job.agent_id
     join briar_channel_members member
       on member.channel_id = job.channel_id
      and member.user_id = captured.owner_user_id
     join briar_channel_messages trigger
       on trigger.id = captured.trigger_message_id
      and trigger.id = job.trigger_message_id
      and trigger.channel_id = job.channel_id
      and trigger.deleted_at is null
      and trigger.memory_source_version = captured.trigger_source_version
     join briar_execution_workers binding
       on binding.id = job.claimed_worker_id
      and binding.device_id = job.claimed_device_id
     join briar_execution_worker_devices device on device.id = binding.device_id
     where job.id = ? and job.organization_id = ?
       and job.claimed_worker_id = ? and job.claimed_device_id = ?
       and job.claim_token_hash = ?
       and ${input.control === "routing" ?
         "job.status = 'completed' and job.routing_action in ('steer', 'cancel') and job.routing_receipt_id is not null and job.updated_at <= ?" :
         input.control === "stop-unconfirmed" ?
         "(job.status = 'running' or (job.status = 'completed' and job.stop_requested_at is not null)) and job.updated_at <= ?" :
         input.control === "stop" ?
         "job.status = 'completed' and job.stop_requested_at is not null and job.stop_requested_at <= ?" :
         input.control === "classification" ?
         "job.status = 'running' and job.lease_expires_at > ? and job.steer_revision = job.applied_steer_revision" :
         "job.status = 'running' and job.lease_expires_at > ? and job.steer_revision = job.applied_steer_revision and coalesce(job.routing_action, 'new') <> 'pending'"}
       and binding.state <> 'disabled' and device.state <> 'disabled'
       and device.organization_id = job.organization_id
       and ${publicMessageCapabilitySql("job")}
       and ${liveChannelReplyRuntime("job")}
       and ${dmMemoryReplyFenceCurrent("job")}
       and (select count(*) from briar_channel_agents
            where channel_id = job.channel_id) = 1
       and (select count(*) from briar_channel_members
            where channel_id = job.channel_id) = 1`,
  ).bind(
    input.jobId,
    input.organizationId,
    input.workerId,
    input.deviceId,
    input.claimTokenHash,
    input.observedAt,
  ).first<DmPublicMessageClaimRow>();
}

async function hydratedBatch(
  db: D1Database,
  row: DmPublicMessageBatchRow | null,
): Promise<DmPublishedMessageBatch | null> {
  if (!row) return null;
  const messages = await db.prepare(
    `select id from briar_channel_messages
     where dm_batch_id = ? order by dm_part_index`,
  ).bind(row.id).all<{ id: string }>();
  if (messages.results.length !== row.part_count) {
    throw new Error("DM public message batch is missing message parts");
  }
  return {
    batchId: row.id,
    messageIds: messages.results.map(({ id }) => id),
    firstSequence: row.first_sequence,
    lastSequence: row.last_sequence,
    publicationKind: row.publication_kind,
    createdAt: row.created_at,
    payloadHash: row.payload_hash,
  };
}

export async function findDmPublicMessageByClaimRequest(
  db: D1Database,
  input: {
    jobId: string;
    organizationId: string;
    channelId: string;
    workerId: string;
    deviceId: string;
    claimTokenHash: string;
    requestId: string;
  },
) {
  const row = await db.prepare(
    `select batch.*
     from briar_dm_public_message_receipts receipt
     join briar_dm_public_message_batches batch on batch.id = receipt.batch_id
     where receipt.request_id = ? and receipt.origin_reply_job_id = ?
       and receipt.organization_id = ? and receipt.channel_id = ?
       and receipt.worker_id = ? and receipt.device_id = ?
       and receipt.claim_token_hash = ?`,
  ).bind(
    input.requestId,
    input.jobId,
    input.organizationId,
    input.channelId,
    input.workerId,
    input.deviceId,
    input.claimTokenHash,
  ).first<DmPublicMessageBatchRow>();
  return hydratedBatch(db, row);
}

export async function findDmPublicMessageByRequestId(
  db: D1Database,
  requestId: string,
) {
  const row = await db.prepare(
    `select batch.*
     from briar_dm_public_message_receipts receipt
     join briar_dm_public_message_batches batch on batch.id = receipt.batch_id
     where receipt.request_id = ?`,
  ).bind(requestId).first<DmPublicMessageBatchRow>();
  return hydratedBatch(db, row);
}

export async function listDmPublicMessagesForReply(
  db: D1Database,
  input: { jobId: string; organizationId: string },
) {
  const rows = await db.prepare(
    `select * from briar_dm_public_message_batches
     where origin_reply_job_id = ? and organization_id = ?
     order by first_sequence, id`,
  ).bind(input.jobId, input.organizationId).all<DmPublicMessageBatchRow>();
  const batches: DmPublishedMessageBatch[] = [];
  for (const row of rows.results) batches.push((await hydratedBatch(db, row))!);
  return batches;
}

export async function getDmFinalPublicMessageBatch(
  db: D1Database,
  input: {
    batchId: string;
    jobId: string;
    organizationId: string;
    channelId: string;
    ownerUserId: string;
    agentId: string;
    rosterEpoch: number;
    inputRevision: number;
    triggerMessageId: string;
    triggerSourceVersion: number;
  },
) {
  const row = await db.prepare(
    `select * from briar_dm_public_message_batches
     where id = ? and origin_reply_job_id = ? and organization_id = ?
       and channel_id = ? and owner_user_id = ? and agent_id = ?
       and roster_epoch = ? and input_revision = ?
       and trigger_message_id = ? and trigger_source_version = ?
       and publication_kind = 'final'`,
  ).bind(
    input.batchId,
    input.jobId,
    input.organizationId,
    input.channelId,
    input.ownerUserId,
    input.agentId,
    input.rosterEpoch,
    input.inputRevision,
    input.triggerMessageId,
    input.triggerSourceVersion,
  ).first<DmPublicMessageBatchRow>();
  const batch = await hydratedBatch(db, row);
  if (!batch) return null;
  const finalMessageId = batch.messageIds.at(-1)!;
  const message = await db.prepare(
    `select body from briar_channel_messages
     where id = ? and channel_id = ? and dm_batch_id = ?
       and deleted_at is null`,
  ).bind(finalMessageId, input.channelId, input.batchId)
    .first<{ body: string }>();
  return message ? { ...batch, finalMessageId, finalBody: message.body } : null;
}

export async function findDmFinalPublicMessageForReply(
  db: D1Database,
  jobId: string,
) {
  const row = await db.prepare(
    `select * from briar_dm_public_message_batches
     where origin_reply_job_id = ? and publication_kind = 'final'`,
  ).bind(jobId).first<DmPublicMessageBatchRow>();
  return hydratedBatch(db, row);
}

export function dmPublicMessageBatchStatements(
  db: D1Database,
  input: {
    scope: DmPublicMessageClaimRow;
    requestId: string;
    payloadHash: string;
    publicationKind: DmPublicMessagePublicationKind;
    parts: readonly DmPublicMessagePartInput[];
    workerId: string;
    deviceId: string;
    claimTokenHash: string;
    createdAt: string;
    /** Internal control receipt only; never exposed by the publication RPC. */
    control?: "routing" | "stop" | "stop-unconfirmed";
    routingReceiptId?: string;
  },
) {
  const batchId = crypto.randomUUID();
  const messageIds = input.parts.map((_, index) =>
    input.publicationKind === "final" && index === input.parts.length - 1
      ? input.scope.reply_message_id
      : crypto.randomUUID()
  );
  const { scope } = input;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `insert into briar_dm_public_message_sequences (
         organization_id, channel_id, next_sequence, updated_at
       ) select scope.organization_id, scope.channel_id, 1, ?
         from briar_dm_public_message_claim_scopes scope
         where scope.job_id = ? and scope.claim_token_hash = ?
       on conflict (organization_id, channel_id) do nothing`,
    ).bind(input.createdAt, scope.job_id, input.claimTokenHash),
    db.prepare(
      `insert into briar_dm_public_message_batches (
         id, organization_id, channel_id, owner_user_id, agent_id,
         roster_epoch, origin_reply_job_id, input_revision,
         trigger_message_id, trigger_source_version, publication_kind,
         payload_hash, first_sequence, last_sequence, part_count,
         worker_id, device_id, claim_token_hash, created_at
       )
       select ?, claim.organization_id, claim.channel_id, claim.owner_user_id,
              claim.agent_id, claim.roster_epoch, claim.job_id,
              claim.input_revision, claim.trigger_message_id,
              claim.trigger_source_version, ?, ?, sequence.next_sequence,
              sequence.next_sequence + ? - 1, ?, ?, ?, ?, ?
       from briar_dm_public_message_claim_scopes claim
       join briar_dm_public_message_sequences sequence
         on sequence.organization_id = claim.organization_id
        and sequence.channel_id = claim.channel_id
       join briar_channel_agent_reply_jobs job on job.id = claim.job_id
       join briar_channels channel
         on channel.id = job.channel_id and channel.kind = 'dm'
        and channel.memory_roster_epoch = claim.roster_epoch
       join briar_channel_messages trigger
         on trigger.id = claim.trigger_message_id
        and trigger.id = job.trigger_message_id
        and trigger.channel_id = job.channel_id
        and trigger.deleted_at is null
        and trigger.memory_source_version = claim.trigger_source_version
       join briar_execution_workers binding
         on binding.id = job.claimed_worker_id
        and binding.device_id = job.claimed_device_id
       join briar_execution_worker_devices device on device.id = binding.device_id
       where claim.job_id = ? and claim.organization_id = ?
         and claim.worker_id = ? and claim.device_id = ?
         and claim.claim_token_hash = ?
         and job.claimed_worker_id = claim.worker_id
         and job.claimed_device_id = claim.device_id
         and job.claim_token_hash = claim.claim_token_hash
         and ${input.control === "routing" ?
           "job.status in ('running', 'completed') and job.routing_action in ('steer', 'cancel') and job.routing_receipt_id is not null and job.updated_at <= ?" :
           input.control === "stop-unconfirmed" ?
           "job.error = 'dm_reply_stop_unconfirmed' and job.status in ('running', 'completed') and job.updated_at <= ?" :
           input.control === "stop" ?
           "job.status = 'completed' and job.stop_requested_at is not null and job.stop_requested_at <= ?" :
           "job.status = 'running' and job.lease_expires_at > ? and job.steer_revision = job.applied_steer_revision and coalesce(job.routing_action, 'new') <> 'pending'"}
         and (? is null or job.routing_receipt_id = ?)
         and job.applied_steer_revision = claim.input_revision
         and binding.state <> 'disabled' and device.state <> 'disabled'
         and device.organization_id = job.organization_id
         and ${publicMessageCapabilitySql("job")}
         and ${liveChannelReplyRuntime("job")}
         and ${dmMemoryReplyFenceCurrent("job")}
         and exists (
           select 1 from briar_channel_agents roster
           where roster.channel_id = job.channel_id
             and roster.agent_id = job.agent_id
         )
         and exists (
           select 1 from briar_channel_members member
           where member.channel_id = job.channel_id
             and member.user_id = claim.owner_user_id
         )
         and (select count(*) from briar_channel_agents
              where channel_id = job.channel_id) = 1
         and (select count(*) from briar_channel_members
              where channel_id = job.channel_id) = 1
         and not exists (
           select 1 from briar_dm_public_message_receipts receipt
           where receipt.request_id = ?
         )`,
    ).bind(
      batchId,
      input.publicationKind,
      input.payloadHash,
      input.parts.length,
      input.parts.length,
      input.workerId,
      input.deviceId,
      input.claimTokenHash,
      input.createdAt,
      scope.job_id,
      scope.organization_id,
      input.workerId,
      input.deviceId,
      input.claimTokenHash,
      input.createdAt,
      input.routingReceiptId ?? null, input.routingReceiptId ?? null,
      input.requestId,
    ),
  ];
  input.parts.forEach((part, partIndex) => {
    statements.push(db.prepare(
      `insert into briar_channel_messages (
         id, channel_id, parent_message_id, author_user_id, author_agent_id,
         author_agent_name, author_agent_provider, body, created_at, updated_at,
         dm_batch_id, dm_part_index, dm_sequence, dm_purpose
       )
       select ?, batch.channel_id, null, null, batch.agent_id, ?, ?, ?, ?, ?,
              batch.id, ?, batch.first_sequence + ?, ?
       from briar_dm_public_message_batches batch where batch.id = ?`,
    ).bind(
      messageIds[partIndex],
      scope.agent_name,
      scope.agent_provider,
      part.body,
      input.createdAt,
      input.createdAt,
      partIndex,
      partIndex,
      part.purpose,
      batchId,
    ));
  });
  statements.push(
    db.prepare(
      `insert into briar_dm_public_message_receipts (
         request_id, organization_id, channel_id, origin_reply_job_id,
         worker_id, device_id, claim_token_hash, payload_hash, batch_id,
         created_at
       )
       select ?, batch.organization_id, batch.channel_id,
              batch.origin_reply_job_id, ?, ?, ?, ?, batch.id, ?
       from briar_dm_public_message_batches batch where batch.id = ?`,
    ).bind(
      input.requestId,
      input.workerId,
      input.deviceId,
      input.claimTokenHash,
      input.payloadHash,
      input.createdAt,
      batchId,
    ),
    db.prepare(
      `update briar_dm_public_message_sequences
       set next_sequence = next_sequence + ?, updated_at = ?
       where organization_id = ? and channel_id = ?
         and exists (
           select 1 from briar_dm_public_message_batches batch
           where batch.id = ?
             and batch.first_sequence =
               briar_dm_public_message_sequences.next_sequence
         )`,
    ).bind(
      input.parts.length,
      input.createdAt,
      scope.organization_id,
      scope.channel_id,
      batchId,
    ),
  );
  return { batchId, statements };
}

export async function commitDmPublicMessageBatch(
  db: D1Database, input: Parameters<typeof dmPublicMessageBatchStatements>[1],
) {
  const { batchId, statements } = dmPublicMessageBatchStatements(db, input);
  await db.batch(statements);
  const stored = await db.prepare(
    `select * from briar_dm_public_message_batches where id = ?`,
  ).bind(batchId).first<DmPublicMessageBatchRow>();
  return hydratedBatch(db, stored);
}
