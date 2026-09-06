import {
  buildWhatsAppReplyChunks,
  splitWhatsAppText,
} from "./whatsapp";

export type WhatsAppConnectionRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  phone_number_id: string;
  waba_id: string;
  encrypted_access_token: string;
  token_iv: string;
  verify_token_hash: string;
  connected_by_user_id: string | null;
  status: "connected" | "disconnected";
  connected_at: string;
  disconnected_at: string | null;
  updated_at: string;
};

export type WhatsAppUserLinkRow = {
  id: string;
  connection_id: string;
  organization_id: string;
  user_id: string;
  user_name: string;
  phone_number: string;
  last_inbound_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WhatsAppOutboxClaim = {
  id: string;
  connection_id: string;
  channel_message_id: string | null;
  source_wamid: string | null;
  part_index: number;
  part_count: number;
  recipient_phone: string;
  body: string;
  last_customer_message_at: string;
  attempts: number;
  claim_token: string;
  phone_number_id: string;
  encrypted_access_token: string;
  token_iv: string;
};

const connectionSelect = `select id, organization_id, agent_id,
       phone_number_id, waba_id, encrypted_access_token, token_iv,
       verify_token_hash, connected_by_user_id, status, connected_at,
       disconnected_at, updated_at
from briar_whatsapp_connections`;

export async function getWhatsAppConnectionForOrganization(
  db: D1Database,
  organizationId: string,
) {
  return db.prepare(
    `${connectionSelect}
     where organization_id = ? and status = 'connected'
     order by updated_at desc limit 1`,
  ).bind(organizationId).first<WhatsAppConnectionRow>();
}

export async function getWhatsAppConnectionByPhoneNumberId(
  db: D1Database,
  phoneNumberId: string,
) {
  return db.prepare(
    `${connectionSelect}
     where phone_number_id = ? and status = 'connected' limit 1`,
  ).bind(phoneNumberId).first<WhatsAppConnectionRow>();
}

export async function getWhatsAppConnectionByVerifyTokenHash(
  db: D1Database,
  verifyTokenHash: string,
) {
  return db.prepare(
    `${connectionSelect}
     where verify_token_hash = ? and status = 'connected' limit 1`,
  ).bind(verifyTokenHash).first<WhatsAppConnectionRow>();
}

export async function upsertWhatsAppConnection(
  db: D1Database,
  input: {
    organizationId: string;
    agentId: string;
    phoneNumberId: string;
    wabaId: string;
    encryptedAccessToken: string;
    tokenIv: string;
    verifyTokenHash: string;
    connectedByUserId: string;
    observedAt: string;
  },
) {
  const current = await getWhatsAppConnectionForOrganization(
    db,
    input.organizationId,
  );
  const id = current?.id ?? crypto.randomUUID();
  await db.prepare(
    `insert into briar_whatsapp_connections (
       id, organization_id, agent_id, phone_number_id, waba_id,
       encrypted_access_token, token_iv, verify_token_hash,
       connected_by_user_id, status, connected_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?)
     on conflict(id) do update set
       agent_id = excluded.agent_id,
       phone_number_id = excluded.phone_number_id,
       waba_id = excluded.waba_id,
       encrypted_access_token = excluded.encrypted_access_token,
       token_iv = excluded.token_iv,
       verify_token_hash = excluded.verify_token_hash,
       connected_by_user_id = excluded.connected_by_user_id,
       status = 'connected', disconnected_at = null,
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    input.organizationId,
    input.agentId,
    input.phoneNumberId,
    input.wabaId,
    input.encryptedAccessToken,
    input.tokenIv,
    input.verifyTokenHash,
    input.connectedByUserId,
    input.observedAt,
    input.observedAt,
  ).run();
  return getWhatsAppConnectionForOrganization(db, input.organizationId);
}

export async function disconnectWhatsAppConnection(
  db: D1Database,
  organizationId: string,
  observedAt: string,
) {
  const results = await db.batch([
    db.prepare(
      `update briar_whatsapp_outbox
       set status = 'dead_letter', claim_token = null, claimed_at = null,
           dead_lettered_at = ?,
           dead_letter_reason = 'WhatsApp connection was disconnected',
           last_error = 'WhatsApp connection was disconnected', updated_at = ?
       where connection_id in (
         select id from briar_whatsapp_connections
         where organization_id = ? and status = 'connected'
       ) and status <> 'dead_letter'`,
    ).bind(observedAt, observedAt, organizationId),
    db.prepare(
      `update briar_whatsapp_connections
       set status = 'disconnected', disconnected_at = ?, updated_at = ?
       where organization_id = ? and status = 'connected'
       returning id`,
    ).bind(observedAt, observedAt, organizationId),
  ]);
  return results[1]?.results.length === 1;
}

export async function listWhatsAppUserLinks(
  db: D1Database,
  organizationId: string,
) {
  const result = await db.prepare(
    `select link.id, link.connection_id, link.organization_id, link.user_id,
            user.name as user_name, link.phone_number, link.last_inbound_at,
            link.created_at, link.updated_at
     from briar_whatsapp_user_links link
     join briar_whatsapp_connections connection
       on connection.id = link.connection_id and connection.status = 'connected'
     join "user" user on user.id = link.user_id
     where link.organization_id = ?
     order by lower(user.name), link.user_id`,
  ).bind(organizationId).all<WhatsAppUserLinkRow>();
  return result.results;
}

export async function getWhatsAppUserLinkByPhone(
  db: D1Database,
  connectionId: string,
  phoneNumber: string,
) {
  return db.prepare(
    `select link.id, link.connection_id, link.organization_id, link.user_id,
            user.name as user_name, link.phone_number, link.last_inbound_at,
            link.created_at, link.updated_at
     from briar_whatsapp_user_links link
     join briar_whatsapp_connections connection
       on connection.id = link.connection_id and connection.status = 'connected'
     join briar_organization_members membership
       on membership.organization_id = link.organization_id
      and membership.user_id = link.user_id
     join "user" user on user.id = link.user_id
     where link.connection_id = ? and link.phone_number = ?`,
  ).bind(connectionId, phoneNumber).first<WhatsAppUserLinkRow>();
}

export async function upsertWhatsAppUserLink(
  db: D1Database,
  input: {
    organizationId: string;
    userId: string;
    phoneNumber: string;
    createdByUserId: string;
    observedAt: string;
  },
) {
  const connection = await getWhatsAppConnectionForOrganization(
    db,
    input.organizationId,
  );
  if (!connection) return null;
  await db.prepare(
    `insert into briar_whatsapp_user_links (
       id, connection_id, organization_id, user_id, phone_number,
       created_by_user_id, created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(connection_id, user_id) do update set
       phone_number = excluded.phone_number,
       created_by_user_id = excluded.created_by_user_id,
       updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(),
    connection.id,
    input.organizationId,
    input.userId,
    input.phoneNumber,
    input.createdByUserId,
    input.observedAt,
    input.observedAt,
  ).run();
  return getWhatsAppUserLinkByPhone(db, connection.id, input.phoneNumber);
}

export async function deleteWhatsAppUserLink(
  db: D1Database,
  organizationId: string,
  linkId: string,
) {
  const result = await db.prepare(
    `delete from briar_whatsapp_user_links
     where organization_id = ? and id = ?
       and connection_id in (
         select id from briar_whatsapp_connections where status = 'connected'
       )`,
  ).bind(organizationId, linkId).run();
  return result.meta.changes > 0;
}

export async function recordWhatsAppInboundAt(
  db: D1Database,
  linkId: string,
  observedAt: string,
) {
  await db.prepare(
    `update briar_whatsapp_user_links
     set last_inbound_at = max(coalesce(last_inbound_at, ?), ?), updated_at = ?
     where id = ?`,
  ).bind(observedAt, observedAt, observedAt, linkId).run();
}

export async function claimWhatsAppEvent(
  db: D1Database,
  input: {
    connectionId: string;
    wamid: string;
    senderPhone: string;
    messageId: string;
    observedAt: string;
    staleBefore: string;
  },
) {
  const retentionBefore = new Date(
    Date.parse(input.observedAt) - 30 * 24 * 60 * 60_000,
  ).toISOString();
  await db.prepare(
    `delete from briar_whatsapp_events
     where coalesce(completed_at, claimed_at) < ?`,
  ).bind(retentionBefore).run();
  return db.prepare(
    `insert into briar_whatsapp_events (
       connection_id, wamid, message_id, sender_phone, status,
       observed_at, claimed_at
     ) values (?, ?, ?, ?, 'processing', ?, ?)
     on conflict(connection_id, wamid) do update set
       claimed_at = excluded.claimed_at
     where briar_whatsapp_events.status = 'processing'
       and briar_whatsapp_events.claimed_at <= ?
     returning message_id`,
  ).bind(
    input.connectionId,
    input.wamid,
    input.messageId,
    input.senderPhone,
    input.observedAt,
    input.observedAt,
    input.staleBefore,
  ).first<{ message_id: string }>();
}

export async function completeWhatsAppEvent(
  db: D1Database,
  connectionId: string,
  wamid: string,
  completedAt: string,
) {
  await db.prepare(
    `update briar_whatsapp_events
     set status = 'completed', completed_at = ?
     where connection_id = ? and wamid = ? and status = 'processing'`,
  ).bind(completedAt, connectionId, wamid).run();
}

export async function releaseWhatsAppEvent(
  db: D1Database,
  connectionId: string,
  wamid: string,
) {
  await db.prepare(
    `delete from briar_whatsapp_events
     where connection_id = ? and wamid = ? and status = 'processing'`,
  ).bind(connectionId, wamid).run();
}

export async function enqueueWhatsAppSystemMessage(
  db: D1Database,
  input: {
    connectionId: string;
    wamid: string;
    recipientPhone: string;
    body: string;
    observedAt: string;
  },
) {
  const chunks = splitWhatsAppText(input.body);
  await db.batch(chunks.map((body, partIndex) =>
    db.prepare(
      `insert into briar_whatsapp_outbox (
         id, connection_id, channel_message_id, source_wamid,
         part_index, part_count, recipient_phone, body,
         last_customer_message_at, next_attempt_at, created_at, updated_at
       ) values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(connection_id, source_wamid, part_index)
         where source_wamid is not null do nothing`,
    ).bind(
      crypto.randomUUID(),
      input.connectionId,
      input.wamid,
      partIndex,
      chunks.length,
      input.recipientPhone,
      body,
      input.observedAt,
      input.observedAt,
      input.observedAt,
      input.observedAt,
    )
  ));
}

export function enqueueWhatsAppReplyStatements(
  db: D1Database,
  input: {
    jobId: string;
    deviceId: string;
    workerId: string;
    claimTokenHash: string;
    completedAt: string;
    organizationId: string;
    channelId: string;
    channelMessageId: string;
    body: string;
    approvalSummary: string | null;
    appOrigin: string;
  },
) {
  const chunks = buildWhatsAppReplyChunks({
    body: input.body,
    approvalSummary: input.approvalSummary,
    appOrigin: input.appOrigin,
    organizationId: input.organizationId,
    channelId: input.channelId,
    messageId: input.channelMessageId,
  });
  return chunks.map((template, partIndex) =>
    db.prepare(
      `insert into briar_whatsapp_outbox (
         id, connection_id, channel_message_id, source_wamid,
         part_index, part_count, recipient_phone, body,
         last_customer_message_at, next_attempt_at, created_at, updated_at
       )
       select ?, connection.id, ?, null, ?, ?, link.phone_number,
              ?,
              link.last_inbound_at, ?, ?, ?
       from briar_channel_agent_reply_jobs job
       join briar_channels channel on channel.id = job.channel_id
       join briar_whatsapp_connections connection
         on connection.organization_id = job.organization_id
        and connection.status = 'connected'
       join briar_channel_agents representative
         on representative.channel_id = channel.id
        and representative.agent_id = connection.agent_id
       join briar_channel_members member on member.channel_id = channel.id
       join briar_whatsapp_user_links link
         on link.connection_id = connection.id
        and link.organization_id = job.organization_id
        and link.user_id = member.user_id
       where job.id = ? and job.claimed_device_id = ?
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.status = 'completed' and job.completed_at = ?
         and channel.kind = 'dm'
         and channel.dm_key = 'agent:' || json_array(member.user_id, connection.agent_id)
         and link.last_inbound_at is not null
       on conflict(channel_message_id, part_index)
         where channel_message_id is not null do nothing`,
    ).bind(
      crypto.randomUUID(),
      input.channelMessageId,
      partIndex,
      chunks.length,
      template,
      input.completedAt,
      input.completedAt,
      input.completedAt,
      input.jobId,
      input.deviceId,
      input.workerId,
      input.claimTokenHash,
      input.completedAt,
    )
  );
}

export async function claimWhatsAppOutbox(
  db: D1Database,
  input: {
    observedAt: string;
    staleBefore: string;
    limit: number;
  },
) {
  const claimToken = crypto.randomUUID();
  await db.prepare(
    `update briar_whatsapp_outbox as candidate
     set status = 'processing', claim_token = ?, claimed_at = ?, updated_at = ?
     where candidate.id in (
       select due.id
       from briar_whatsapp_outbox due
       join briar_whatsapp_connections connection
         on connection.id = due.connection_id and connection.status = 'connected'
       where due.next_attempt_at <= ?
         and (
           due.status = 'pending'
           or (due.status = 'processing' and due.claimed_at <= ?)
         )
         and not exists (
           select 1 from briar_whatsapp_outbox earlier
           where earlier.connection_id = due.connection_id
             and earlier.part_index < due.part_index
             and earlier.status <> 'dead_letter'
             and (
               (earlier.channel_message_id is due.channel_message_id
                 and due.channel_message_id is not null)
               or (earlier.source_wamid is due.source_wamid
                 and due.source_wamid is not null)
             )
         )
       order by due.next_attempt_at, due.created_at, due.id
       limit ?
     )`,
  ).bind(
    claimToken,
    input.observedAt,
    input.observedAt,
    input.observedAt,
    input.staleBefore,
    Math.max(1, Math.min(input.limit, 50)),
  ).run();
  const result = await db.prepare(
    `select outbox.id, outbox.connection_id, outbox.channel_message_id,
            outbox.source_wamid, outbox.part_index, outbox.part_count,
            outbox.recipient_phone, outbox.body,
            outbox.last_customer_message_at, outbox.attempts,
            outbox.claim_token, connection.phone_number_id,
            connection.encrypted_access_token, connection.token_iv
     from briar_whatsapp_outbox outbox
     join briar_whatsapp_connections connection
       on connection.id = outbox.connection_id and connection.status = 'connected'
     where outbox.claim_token = ? and outbox.status = 'processing'
     order by outbox.created_at, outbox.id`,
  ).bind(claimToken).all<WhatsAppOutboxClaim>();
  return result.results;
}

export async function acknowledgeWhatsAppOutbox(
  db: D1Database,
  claim: WhatsAppOutboxClaim,
) {
  const result = await db.prepare(
    `delete from briar_whatsapp_outbox
     where id = ? and status = 'processing' and claim_token = ?`,
  ).bind(claim.id, claim.claim_token).run();
  return result.meta.changes > 0;
}

export async function retryWhatsAppOutbox(
  db: D1Database,
  claim: WhatsAppOutboxClaim,
  input: { observedAt: string; nextAttemptAt: string; error: string },
) {
  const result = await db.prepare(
    `update briar_whatsapp_outbox
     set status = 'pending', attempts = attempts + 1,
         claim_token = null, claimed_at = null, last_attempt_at = ?,
         next_attempt_at = ?, last_error = ?, updated_at = ?
     where id = ? and status = 'processing' and claim_token = ?`,
  ).bind(
    input.observedAt,
    input.nextAttemptAt,
    input.error.slice(0, 1_000),
    input.observedAt,
    claim.id,
    claim.claim_token,
  ).run();
  return result.meta.changes > 0;
}

export async function deadLetterWhatsAppOutbox(
  db: D1Database,
  claim: WhatsAppOutboxClaim,
  input: { observedAt: string; error: string },
) {
  const reason = input.error.slice(0, 1_000);
  const result = await db.prepare(
    `update briar_whatsapp_outbox
     set status = 'dead_letter',
         attempts = attempts + case when id = ? then 1 else 0 end,
         claim_token = null, claimed_at = null, last_attempt_at = ?,
         last_error = ?, dead_lettered_at = ?, dead_letter_reason = ?,
         updated_at = ?
     where connection_id = ? and status <> 'dead_letter'
       and (
         (channel_message_id is ? and ? is not null)
         or (source_wamid is ? and ? is not null)
       )`,
  ).bind(
    claim.id,
    input.observedAt,
    reason,
    input.observedAt,
    reason,
    input.observedAt,
    claim.connection_id,
    claim.channel_message_id,
    claim.channel_message_id,
    claim.source_wamid,
    claim.source_wamid,
  ).run();
  return result.meta.changes > 0;
}
