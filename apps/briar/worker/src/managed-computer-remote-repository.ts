import type { ManagedComputerRemoteSessionRow } from "./managed-computer-remote-model";

const activeRemoteSessionStates = [
  "created",
  "connecting",
  "connected",
  "disconnected",
] as const;
const activeRemoteSessionSql = activeRemoteSessionStates.map(() => "?").join(", ");

export type ManagedComputerRemoteAuditAction =
  | "session_created"
  | "reconnect_issued"
  | "client_connected"
  | "client_disconnected"
  | "session_ended"
  | "session_expired"
  | "connection_rejected";

export async function managedComputerRemoteSessionById(
  db: D1Database,
  sessionId: string,
) {
  return db.prepare(
    `select * from briar_managed_computer_remote_sessions where id = ?`,
  ).bind(sessionId).first<ManagedComputerRemoteSessionRow>();
}

export async function managedComputerRemoteSessionByRequest(
  db: D1Database,
  input: {
    organizationId: string;
    controllerUserId: string;
    requestId: string;
  },
) {
  return db.prepare(
    `select * from briar_managed_computer_remote_sessions
     where organization_id = ? and controller_user_id = ? and request_id = ?`,
  ).bind(input.organizationId, input.controllerUserId, input.requestId)
    .first<ManagedComputerRemoteSessionRow>();
}

export async function activeManagedComputerRemoteSession(
  db: D1Database,
  managedComputerId: string,
) {
  return db.prepare(
    `select * from briar_managed_computer_remote_sessions
     where managed_computer_id = ? and state in (${activeRemoteSessionSql})
     order by created_at desc limit 1`,
  ).bind(managedComputerId, ...activeRemoteSessionStates)
    .first<ManagedComputerRemoteSessionRow>();
}

export async function expireStaleManagedComputerRemoteSessions(
  db: D1Database,
  observedAt: string,
) {
  const result = await db.prepare(
    `update briar_managed_computer_remote_sessions
     set state = 'expired', ended_at = coalesce(ended_at, ?),
         end_reason = coalesce(end_reason, 'expired'), updated_at = ?
     where state in (${activeRemoteSessionSql})
       and (
         max_expires_at <= ?
         or (state = 'created' and token_expires_at <= ?)
       )
     returning *`,
  ).bind(
    observedAt,
    observedAt,
    ...activeRemoteSessionStates,
    observedAt,
    observedAt,
  ).all<ManagedComputerRemoteSessionRow>();
  return result.results ?? [];
}

export async function managedComputerRemoteSessionCapacity(
  db: D1Database,
  input: {
    organizationId: string;
    userId: string;
    rateCutoff: string;
  },
) {
  const row = await db.prepare(
    `select
       (select count(*) from briar_managed_computer_remote_sessions
        where organization_id = ? and state in (${activeRemoteSessionSql}))
         organization_count,
       (select count(*) from briar_managed_computer_remote_sessions
        where state in (${activeRemoteSessionSql})) fleet_count,
       (select count(*) from briar_managed_computer_remote_audit_events
        where actor_user_id = ? and occurred_at >= ?
          and action in ('session_created', 'reconnect_issued')) recent_user_count`,
  ).bind(
    input.organizationId,
    ...activeRemoteSessionStates,
    ...activeRemoteSessionStates,
    input.userId,
    input.rateCutoff,
  ).first<{
    organization_count: number;
    fleet_count: number;
    recent_user_count: number;
  }>();
  return row ?? {
    organization_count: 0,
    fleet_count: 0,
    recent_user_count: 0,
  };
}

export async function createManagedComputerRemoteSession(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    managedComputerId: string;
    agentId?: string;
    controllerUserId: string;
    requestId: string;
    clientTokenHash: string;
    tokenExpiresAt: string;
    maxExpiresAt: string;
    organizationSessionLimit: number;
    fleetSessionLimit: number;
    rateLimit: number;
    rateCutoff: string;
    observedAt: string;
  },
) {
  await expireStaleManagedComputerRemoteSessions(db, input.observedAt);
  try {
    await db.prepare(
      `insert into briar_managed_computer_remote_sessions (
         id, organization_id, managed_computer_id, agent_id, controller_user_id,
         request_id, state, client_token_hash, token_expires_at,
         connection_generation, max_expires_at, created_at, updated_at
       )
       select ?, ?, ?, ?, ?, ?, 'created', ?, ?, 1, ?, ?, ?
       where
         (select count(*) from briar_managed_computer_remote_sessions
          where organization_id = ? and state in (${activeRemoteSessionSql})) < ?
         and (select count(*) from briar_managed_computer_remote_sessions
          where state in (${activeRemoteSessionSql})) < ?
         and (select count(*) from briar_managed_computer_remote_sessions
          where controller_user_id = ? and created_at >= ?) < ?
         and not exists (
           select 1 from briar_managed_computer_remote_sessions
           where managed_computer_id = ? and state in (${activeRemoteSessionSql})
         )
       on conflict (organization_id, controller_user_id, request_id) do nothing`,
    ).bind(
      input.id,
      input.organizationId,
      input.managedComputerId,
      input.agentId ?? null,
      input.controllerUserId,
      input.requestId,
      input.clientTokenHash,
      input.tokenExpiresAt,
      input.maxExpiresAt,
      input.observedAt,
      input.observedAt,
      input.organizationId,
      ...activeRemoteSessionStates,
      input.organizationSessionLimit,
      ...activeRemoteSessionStates,
      input.fleetSessionLimit,
      input.controllerUserId,
      input.rateCutoff,
      input.rateLimit,
      input.managedComputerId,
      ...activeRemoteSessionStates,
    ).run();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
  }
  return managedComputerRemoteSessionById(db, input.id);
}

export async function reconnectManagedComputerRemoteSession(
  db: D1Database,
  input: {
    sessionId: string;
    organizationId: string;
    managedComputerId: string;
    agentId?: string;
    controllerUserId: string;
    requestId: string;
    clientTokenHash: string;
    tokenExpiresAt: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_managed_computer_remote_sessions
     set request_id = ?, state = 'created', client_token_hash = ?,
         token_expires_at = ?, token_consumed_at = null,
         connection_generation = connection_generation + 1,
         disconnected_at = null, end_reason = null, updated_at = ?
     where id = ? and organization_id = ? and managed_computer_id = ?
       and controller_user_id = ?
       and agent_id is ?
       and state in (${activeRemoteSessionSql}) and max_expires_at > ?
     returning *`,
  ).bind(
    input.requestId,
    input.clientTokenHash,
    input.tokenExpiresAt,
    input.observedAt,
    input.sessionId,
    input.organizationId,
    input.managedComputerId,
    input.controllerUserId,
    input.agentId ?? null,
    ...activeRemoteSessionStates,
    input.observedAt,
  ).first<ManagedComputerRemoteSessionRow>();
}

export async function consumeManagedComputerRemoteSessionToken(
  db: D1Database,
  input: {
    sessionId: string;
    managedComputerId: string;
    clientTokenHash: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_managed_computer_remote_sessions
     set state = 'connecting', token_consumed_at = ?, updated_at = ?
     where id = ? and managed_computer_id = ? and client_token_hash = ?
       and token_consumed_at is null and token_expires_at > ?
       and max_expires_at > ? and state = 'created'
     returning *`,
  ).bind(
    input.observedAt,
    input.observedAt,
    input.sessionId,
    input.managedComputerId,
    input.clientTokenHash,
    input.observedAt,
    input.observedAt,
  ).first<ManagedComputerRemoteSessionRow>();
}

export async function markManagedComputerRemoteSessionConnected(
  db: D1Database,
  input: {
    sessionId: string;
    connectionGeneration: number;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_managed_computer_remote_sessions
     set state = 'connected', connected_at = coalesce(connected_at, ?),
         disconnected_at = null, updated_at = ?
     where id = ? and connection_generation = ?
       and state in ('created', 'connecting', 'disconnected')
       and max_expires_at > ?
     returning *`,
  ).bind(
    input.observedAt,
    input.observedAt,
    input.sessionId,
    input.connectionGeneration,
    input.observedAt,
  ).first<ManagedComputerRemoteSessionRow>();
}

export async function markManagedComputerRemoteSessionDisconnected(
  db: D1Database,
  input: {
    sessionId: string;
    connectionGeneration: number;
    reason: string;
    controllerBytes: number;
    screenBytes: number;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_managed_computer_remote_sessions
     set state = 'disconnected', disconnected_at = ?, end_reason = ?,
         controller_bytes = max(controller_bytes, ?),
         screen_bytes = max(screen_bytes, ?), updated_at = ?
     where id = ? and connection_generation = ?
       and state in ('connecting', 'connected')
     returning *`,
  ).bind(
    input.observedAt,
    input.reason.slice(0, 120),
    input.controllerBytes,
    input.screenBytes,
    input.observedAt,
    input.sessionId,
    input.connectionGeneration,
  ).first<ManagedComputerRemoteSessionRow>();
}

export async function endManagedComputerRemoteSession(
  db: D1Database,
  input: {
    sessionId: string;
    organizationId: string;
    managedComputerId: string;
    reason: string;
    observedAt: string;
  },
) {
  return db.prepare(
    `update briar_managed_computer_remote_sessions
     set state = 'ended', ended_at = coalesce(ended_at, ?), end_reason = ?,
         updated_at = ?
     where id = ? and organization_id = ? and managed_computer_id = ?
       and state in (${activeRemoteSessionSql})
     returning *`,
  ).bind(
    input.observedAt,
    input.reason.slice(0, 120),
    input.observedAt,
    input.sessionId,
    input.organizationId,
    input.managedComputerId,
    ...activeRemoteSessionStates,
  ).first<ManagedComputerRemoteSessionRow>();
}

export async function expireManagedComputerRemoteSession(
  db: D1Database,
  sessionId: string,
  observedAt: string,
) {
  return db.prepare(
    `update briar_managed_computer_remote_sessions
     set state = 'expired', ended_at = coalesce(ended_at, ?),
         end_reason = 'expired', updated_at = ?
     where id = ? and state in (${activeRemoteSessionSql})
     returning *`,
  ).bind(observedAt, observedAt, sessionId, ...activeRemoteSessionStates)
    .first<ManagedComputerRemoteSessionRow>();
}

export async function endManagedComputerRemoteSessionsForComputer(
  db: D1Database,
  input: {
    managedComputerId: string;
    reason: string;
    observedAt: string;
  },
) {
  const result = await db.prepare(
    `update briar_managed_computer_remote_sessions
     set state = 'ended', ended_at = coalesce(ended_at, ?), end_reason = ?,
         updated_at = ?
     where managed_computer_id = ? and state in (${activeRemoteSessionSql})
     returning *`,
  ).bind(
    input.observedAt,
    input.reason.slice(0, 120),
    input.observedAt,
    input.managedComputerId,
    ...activeRemoteSessionStates,
  ).all<ManagedComputerRemoteSessionRow>();
  return result.results ?? [];
}

export async function recordManagedComputerRemoteAuditEvent(
  db: D1Database,
  input: {
    organizationId: string;
    managedComputerId: string;
    remoteSessionId?: string | null;
    actorUserId?: string | null;
    action: ManagedComputerRemoteAuditAction;
    reasonCode?: string | null;
    controllerBytes?: number;
    screenBytes?: number;
    occurredAt: string;
  },
) {
  await db.prepare(
    `insert into briar_managed_computer_remote_audit_events (
       id, organization_id, managed_computer_id, remote_session_id,
       actor_user_id, action, reason_code, controller_bytes, screen_bytes,
       occurred_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.organizationId,
    input.managedComputerId,
    input.remoteSessionId ?? null,
    input.actorUserId ?? null,
    input.action,
    input.reasonCode?.slice(0, 120) ?? null,
    input.controllerBytes ?? 0,
    input.screenBytes ?? 0,
    input.occurredAt,
  ).run();
}
