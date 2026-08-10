/**
 * Detached execution workers and their agent transcripts.
 *
 * A worker is a machine running `briar worker`: it claims queued issues, runs
 * the agent locally, and reports progress here. Multiple workers per project
 * are supported, so every race in this module is closed rather than avoided by
 * limiting concurrency — see docs/plans/detached-execution-workers.md.
 */

import {
  isWorkerEmoji,
  isWorkerLogoDataUrl,
} from "../../src/lib/worker-icon-validation";
import {
  compareSemanticVersions,
  isSemanticVersion,
} from "../../src/lib/semantic-version";
import {
  agentProviders,
  type AgentProvider,
  type ModelEffort,
} from "../../src/lib/agent-provider-contract";
import {
  organizationAgentContextCapability,
} from "../../src/lib/organization-agent-context-contract";

export type {
  AgentProvider,
  ModelEffort,
} from "../../src/lib/agent-provider-contract";

export type ExecutionWorkerState = "online" | "stale" | "disabled";
export type ExecutionWorkerReadiness = "ready" | "busy" | "needs_attention";
export type ProviderHealth = {
  installed: boolean;
  authenticated: boolean;
  healthy: boolean;
  reason?: string | null;
};
export type ProviderHealthMap = Partial<Record<AgentProvider, ProviderHealth>>;
export type TranscriptDirection = "client" | "server";

export type ExecutionWorkerRow = {
  id: string;
  project_id: string;
  device_id: string;
  label: string;
  host_fingerprint: string;
  agent_provider: AgentProvider;
  versions_json: string;
  state: ExecutionWorkerState;
  accepting_work: number;
  readiness_state: ExecutionWorkerReadiness;
  readiness_detail: string | null;
  capabilities_json: string;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
  max_concurrent_sessions?: number;
  active_sessions?: number;
  icon_type?: "emoji" | "image" | null;
  icon_value?: string | null;
};

export type ExecutionWorkerReadinessSnapshot = Pick<
  ExecutionWorkerRow,
  "accepting_work" | "readiness_state" | "readiness_detail"
>;

export function hasExecutionWorkerReadinessChanged(
  before: ExecutionWorkerReadinessSnapshot,
  after: ExecutionWorkerReadinessSnapshot,
) {
  return (
    before.accepting_work !== after.accepting_work ||
    before.readiness_state !== after.readiness_state ||
    before.readiness_detail !== after.readiness_detail
  );
}

export type ExecutionWorkerDeviceRow = {
  id: string;
  organization_id: string;
  owner_user_id: string;
  label: string;
  icon_type: "emoji" | "image" | null;
  icon_value: string | null;
  device_identity_hash: string;
  state: ExecutionWorkerState;
  max_concurrent_sessions: number;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
};

export type ProjectExecutionWorkerPolicy = {
  selectionMode: "any" | "allowlist";
  defaultWorkerId: string | null;
  allowedWorkerIds: string[];
  updatedAt: string | null;
};

export type OrganizationExecutionWorker = {
  deviceId: string;
  ownerUserId: string;
  ownerName: string;
  label: string;
  icon:
    | { type: "emoji"; value: string }
    | { type: "image"; value: string }
    | null;
  state: ExecutionWorkerState;
  maxConcurrentSessions: number;
  activeSessions: number;
  lastHeartbeatAt: string;
  createdAt: string;
  versions: Record<string, string>;
  remoteUpdateSupported: boolean;
  updateRequest: ExecutionWorkerUpdateRequest | null;
  bindings: Array<{
    id: string;
    projectId: string;
    projectName: string;
    agentProvider: AgentProvider;
    providers: AgentProvider[];
    state: ExecutionWorkerState;
    acceptingWork: boolean;
    readiness:
      "available" | "busy" | "offline" | "needs_attention" | "disabled";
    readinessDetail: string | null;
  }>;
};

export type ExecutionWorkerUpdateRequest = {
  id: string;
  targetVersion: string;
  status: "requested" | "completed" | "cancelled";
  requestedAt: string;
};

type ExecutionWorkerUpdateRequestRow = {
  id: string;
  organization_id: string;
  device_id: string;
  requested_by_user_id: string;
  target_version: string;
  status: "requested" | "completed" | "cancelled";
  requested_at: string;
  updated_at: string;
  completed_at: string | null;
};

const updateRequestJson = (
  row: Pick<
    ExecutionWorkerUpdateRequestRow,
    "id" | "target_version" | "status" | "requested_at"
  >,
): ExecutionWorkerUpdateRequest => ({
  id: row.id,
  targetVersion: row.target_version,
  status: row.status,
  requestedAt: row.requested_at,
});

export async function pendingExecutionWorkerUpdate(
  db: D1Database,
  deviceId: string,
): Promise<ExecutionWorkerUpdateRequest | null> {
  const row = await db
    .prepare(
      `select id, target_version, status, requested_at
       from briar_execution_worker_update_requests
       where device_id = ? and status = 'requested'
       order by requested_at desc limit 1`,
    )
    .bind(deviceId)
    .first<Pick<
      ExecutionWorkerUpdateRequestRow,
      "id" | "target_version" | "status" | "requested_at"
    >>();
  return row ? updateRequestJson(row) : null;
}

export async function requestExecutionWorkerUpdate(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    deviceId: string;
    requestedByUserId: string;
    targetVersion: string;
    requestedAt: string;
  },
): Promise<ExecutionWorkerUpdateRequest> {
  const pending = await pendingExecutionWorkerUpdate(db, input.deviceId);
  if (pending) return pending;
  const inserted = await db
    .prepare(
      `insert into briar_execution_worker_update_requests (
         id, organization_id, device_id, requested_by_user_id,
         target_version, status, requested_at, updated_at
       ) values (?, ?, ?, ?, ?, 'requested', ?, ?)
       on conflict do nothing`,
    )
    .bind(
      input.id,
      input.organizationId,
      input.deviceId,
      input.requestedByUserId,
      input.targetVersion,
      input.requestedAt,
      input.requestedAt,
    )
    .run();
  if (inserted.meta.changes < 1) {
    const concurrent = await pendingExecutionWorkerUpdate(db, input.deviceId);
    if (concurrent) return concurrent;
    throw new WorkerConflictError("Worker update request changed");
  }
  return {
    id: input.id,
    targetVersion: input.targetVersion,
    status: "requested",
    requestedAt: input.requestedAt,
  };
}

export async function completeExecutionWorkerUpdates(
  db: D1Database,
  deviceId: string,
  currentVersion: string | undefined,
  observedAt: string,
): Promise<void> {
  if (!currentVersion || !isSemanticVersion(currentVersion)) return;
  const pending = await pendingExecutionWorkerUpdate(db, deviceId);
  if (
    !pending ||
    compareSemanticVersions(currentVersion, pending.targetVersion) < 0
  ) {
    return;
  }
  await db
    .prepare(
      `update briar_execution_worker_update_requests
       set status = 'completed', completed_at = ?, updated_at = ?
       where id = ? and status = 'requested'`,
    )
    .bind(observedAt, observedAt, pending.id)
    .run();
}

export type ExecutionWorkerCredentialPrincipal = {
  deviceId: string;
  organizationId: string;
  ownerUserId: string;
};

export type TranscriptSessionRow = {
  session_id: string;
  project_id: string;
  run_id: string | null;
  worker_id: string | null;
  agent_provider: AgentProvider;
  started_at: string;
  last_event_at: string;
  event_count: number;
  byte_count: number;
};

export type TranscriptEventInput = {
  sequence: number;
  direction: TranscriptDirection;
  payload: unknown;
};

/** Heartbeat older than this and the worker is reported as stale. */
export const WORKER_STALE_AFTER_MS = 3 * 60_000;
/** Lease length granted at claim time and by every renewal. */
export const LEASE_DURATION_MS = 15 * 60_000;
/** Workers renew every 5 minutes, so a lease this far past expiry is stalled. */
export const STALLED_RUN_GRACE_MS = 5 * 60_000;
/** Reaping past this many attempts blocks the run instead of looping forever. */
export const MAX_CLAIM_ATTEMPTS = 5;
export const MIN_WORKER_CONCURRENT_SESSIONS = 1;
export const MAX_WORKER_CONCURRENT_SESSIONS = 16;

export const MAX_TRANSCRIPT_PAYLOAD_BYTES = 32 * 1024;
export const MAX_TRANSCRIPT_EVENTS_PER_REQUEST = 200;
export const MAX_TRANSCRIPT_REQUEST_BYTES = 1024 * 1024;
export const MAX_TRANSCRIPT_SESSION_EVENTS = 5_000;
export const MAX_TRANSCRIPT_SESSION_BYTES = 8 * 1024 * 1024;

export class WorkerConflictError extends Error {}
export class TranscriptLimitError extends Error {}

export function executionWorkerProviders(
  worker: Pick<ExecutionWorkerRow, "agent_provider" | "capabilities_json">,
): AgentProvider[] {
  try {
    const capabilities = JSON.parse(worker.capabilities_json) as {
      providerHealth?: unknown;
    };
    if (
      capabilities.providerHealth &&
      typeof capabilities.providerHealth === "object" &&
      !Array.isArray(capabilities.providerHealth)
    ) {
      const providerHealth = capabilities.providerHealth as Record<
        string,
        unknown
      >;
      return agentProviders.filter((provider) =>
        Boolean(
          providerHealth[provider] &&
            typeof providerHealth[provider] === "object" &&
            (providerHealth[provider] as { healthy?: unknown }).healthy === true,
        ),
      );
    }
  } catch {
    // Invalid or legacy capability payloads are not safe dispatch targets.
  }
  return [];
}

/**
 * Organization Agent jobs expose claim-scoped organization data. Only Workers
 * that explicitly advertise this exact protocol version may receive them.
 */
export function executionWorkerSupportsOrganizationAgentContext(
  worker: Pick<ExecutionWorkerRow, "capabilities_json">,
) {
  try {
    const capabilities = JSON.parse(worker.capabilities_json) as {
      organizationAgentContext?: unknown;
    };
    const context = capabilities.organizationAgentContext;
    return Boolean(
      context && typeof context === "object" && !Array.isArray(context) &&
        (context as { protocol?: unknown }).protocol ===
          organizationAgentContextCapability.protocol,
    );
  } catch {
    return false;
  }
}

export type ExecutionDispatchRow = {
  runId: string;
  agentId: string | null;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  requestedWorkerId: string | null;
  requestedByUserId: string;
  dispatchMode: "any" | "specific";
  dispatchedAt: string;
  outcome: "dispatched" | "already_dispatched";
};

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export const workerStateAt = (
  lastHeartbeatAt: string,
  observedAt: string,
  state: ExecutionWorkerState,
): ExecutionWorkerState => {
  if (state === "disabled") return "disabled";
  const heartbeat = Date.parse(lastHeartbeatAt);
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(heartbeat) || !Number.isFinite(observed)) return "stale";
  return observed - heartbeat > WORKER_STALE_AFTER_MS ? "stale" : "online";
};

export const leaseExpiryFrom = (observedAt: string) =>
  new Date(Date.parse(observedAt) + LEASE_DURATION_MS).toISOString();

const executionWorkerIcon = (input: {
  icon_type?: "emoji" | "image" | null;
  icon_value?: string | null;
}) =>
  input.icon_type && input.icon_value
    ? { type: input.icon_type, value: input.icon_value }
    : null;

/**
 * Enroll an organization-scoped device and bind it to one project.
 *
 * Re-enrollment is explicit and rotates the device credential. A device may be
 * bound to several projects in the same organization, while runs continue to
 * reference the project-specific worker row.
 */
export async function registerExecutionWorker(
  db: D1Database,
  projectId: string,
  input: {
    deviceId: string;
    organizationId: string;
    ownerUserId: string;
    deviceIdentityHash: string;
    credentialTokenHash: string;
    label: string;
    agentProvider: AgentProvider;
    providers?: AgentProvider[];
    providerHealth?: ProviderHealthMap;
    versions: Record<string, string>;
    maxConcurrentSessions?: number;
    observedAt: string;
    id: string;
  },
) {
  const label = input.label.trim();
  if (label.length < 1 || label.length > 100) {
    throw new WorkerConflictError("Worker label must be 1-100 characters");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.deviceIdentityHash)) {
    throw new WorkerConflictError("Worker device identity must be a SHA-256 hex digest");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.credentialTokenHash)) {
    throw new WorkerConflictError("Worker credential must be a SHA-256 hex digest");
  }
  if (
    input.maxConcurrentSessions !== undefined &&
    (!Number.isInteger(input.maxConcurrentSessions) ||
      input.maxConcurrentSessions < MIN_WORKER_CONCURRENT_SESSIONS ||
      input.maxConcurrentSessions > MAX_WORKER_CONCURRENT_SESSIONS)
  ) {
    throw new WorkerConflictError(
      `Worker concurrency must be ${MIN_WORKER_CONCURRENT_SESSIONS}-${MAX_WORKER_CONCURRENT_SESSIONS}`,
    );
  }
  const project = await db
    .prepare(`select organization_id from briar_projects where id = ?`)
    .bind(projectId)
    .first<{ organization_id: string }>();
  if (!project || project.organization_id !== input.organizationId) {
    throw new WorkerConflictError("Worker project must belong to its organization");
  }

  const versions = JSON.stringify(input.versions ?? {});
  const capabilities = JSON.stringify({
    providers: input.providers ?? [],
    providerHealth: input.providerHealth ?? {},
  });
  await db
    .prepare(
      `insert into briar_execution_worker_devices (
         id, organization_id, owner_user_id, label, device_identity_hash,
         state, max_concurrent_sessions, last_heartbeat_at, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'online', ?, ?, ?, ?)
       on conflict (organization_id, device_identity_hash) do update set
         label = excluded.label,
         state = 'online',
         max_concurrent_sessions = coalesce(
           ?, briar_execution_worker_devices.max_concurrent_sessions
         ),
         last_heartbeat_at = excluded.last_heartbeat_at,
         updated_at = excluded.updated_at
       where briar_execution_worker_devices.owner_user_id = excluded.owner_user_id`,
    )
    .bind(
      input.deviceId,
      input.organizationId,
      input.ownerUserId,
      label,
      input.deviceIdentityHash,
      input.maxConcurrentSessions ?? 1,
      input.observedAt,
      input.observedAt,
      input.observedAt,
      input.maxConcurrentSessions ?? null,
    )
    .run();

  const device = await db
    .prepare(
      `select * from briar_execution_worker_devices
       where organization_id = ? and device_identity_hash = ?`,
    )
    .bind(input.organizationId, input.deviceIdentityHash)
    .first<ExecutionWorkerDeviceRow>();
  if (!device || device.owner_user_id !== input.ownerUserId) {
    throw new WorkerConflictError(
      "Worker device is already owned by another organization member",
    );
  }

  await db.batch([
    db
      .prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint, agent_provider,
           versions_json, capabilities_json, state, last_heartbeat_at, created_at,
           updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)
         on conflict (project_id, device_id) do update set
           label = excluded.label,
           host_fingerprint = excluded.host_fingerprint,
           agent_provider = excluded.agent_provider,
           versions_json = excluded.versions_json,
           capabilities_json = excluded.capabilities_json,
           state = 'online',
           last_heartbeat_at = excluded.last_heartbeat_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.id,
        projectId,
        device.id,
        label,
        input.deviceIdentityHash,
        input.agentProvider,
        versions,
        capabilities,
        input.observedAt,
        input.observedAt,
        input.observedAt,
      ),
    db
      .prepare(
        `update briar_execution_workers
         set label = ?, updated_at = ?
         where device_id = ?`,
      )
      .bind(label, input.observedAt, device.id),
    db
      .prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at, last_used_at, expires_at, revoked_at
         ) values (?, ?, ?, null, null, null)
         on conflict (device_id) do update set
           token_hash = excluded.token_hash,
           created_at = excluded.created_at,
           last_used_at = null,
           expires_at = null,
           revoked_at = null`,
      )
      .bind(device.id, input.credentialTokenHash, input.observedAt),
  ]);

  const worker = await executionWorkerBindingForProject(
    db,
    device.id,
    projectId,
  );
  if (!worker) throw new WorkerConflictError("Worker project binding was not created");
  return { device, worker };
}

/**
 * Add a project binding for an already enrolled device without rotating its
 * organization-scoped credential. This keeps other project services alive.
 */
export async function bindExecutionWorkerProject(
  db: D1Database,
  projectId: string,
  input: {
    id: string;
    organizationId: string;
    ownerUserId: string;
    deviceIdentityHash: string;
    agentProvider: AgentProvider;
    providers?: AgentProvider[];
    providerHealth?: ProviderHealthMap;
    versions: Record<string, string>;
    observedAt: string;
  },
) {
  const device = await db
    .prepare(
      `select device.*
       from briar_execution_worker_devices device
       join briar_execution_worker_credentials credential
         on credential.device_id = device.id
       where device.organization_id = ?
         and device.owner_user_id = ?
         and device.device_identity_hash = ?
         and device.state != 'disabled'
         and credential.revoked_at is null`,
    )
    .bind(input.organizationId, input.ownerUserId, input.deviceIdentityHash)
    .first<ExecutionWorkerDeviceRow>();
  if (!device) {
    throw new WorkerConflictError(
      "This computer must be enrolled in the organization before another project can be enabled",
    );
  }
  const project = await db
    .prepare(`select organization_id from briar_projects where id = ?`)
    .bind(projectId)
    .first<{ organization_id: string }>();
  if (!project || project.organization_id !== device.organization_id) {
    throw new WorkerConflictError(
      "Worker project must belong to its organization",
    );
  }
  await db
    .prepare(
      `insert into briar_execution_workers (
         id, project_id, device_id, label, host_fingerprint, agent_provider,
         versions_json, capabilities_json, state, last_heartbeat_at, created_at,
         updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)
       on conflict (project_id, device_id) do update set
         label = excluded.label,
         host_fingerprint = excluded.host_fingerprint,
         agent_provider = excluded.agent_provider,
         versions_json = excluded.versions_json,
         capabilities_json = excluded.capabilities_json,
         state = 'online',
         last_heartbeat_at = excluded.last_heartbeat_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.id,
      projectId,
      device.id,
      device.label,
      input.deviceIdentityHash,
      input.agentProvider,
      JSON.stringify(input.versions ?? {}),
      JSON.stringify({
        providers: input.providers ?? [],
        providerHealth: input.providerHealth ?? {},
      }),
      input.observedAt,
      input.observedAt,
      input.observedAt,
    )
    .run();
  const worker = await executionWorkerBindingForProject(
    db,
    device.id,
    projectId,
  );
  if (!worker)
    throw new WorkerConflictError("Worker project binding was not created");
  return { device, worker };
}

export async function recordWorkerHeartbeat(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    versions?: Record<string, string>;
    acceptingWork?: boolean;
    readinessState?: ExecutionWorkerReadiness;
    readinessDetail?: string | null;
    capabilities?: Record<string, unknown>;
    observedAt: string;
  },
) {
  const binding = await db
    .prepare(
      `select * from briar_execution_workers
       where id = ? and project_id = ?`,
    )
    .bind(input.workerId, projectId)
    .first<ExecutionWorkerRow>();
  if (!binding) {
    throw new WorkerConflictError("Worker is not registered for this project");
  }
  await db.batch([
    db
      .prepare(
        `update briar_execution_worker_devices
         set last_heartbeat_at = ?,
             updated_at = ?,
             state = case when state = 'disabled' then 'disabled' else 'online' end
         where id = ?`,
      )
      .bind(input.observedAt, input.observedAt, binding.device_id),
    db
      .prepare(
        `update briar_execution_workers
         set last_heartbeat_at = ?,
             updated_at = ?,
             versions_json = coalesce(?, versions_json),
             accepting_work = coalesce(?, accepting_work),
             readiness_state = coalesce(?, readiness_state),
             readiness_detail = case when ? is null
               then readiness_detail else ? end,
             capabilities_json = coalesce(?, capabilities_json),
             state = case when state = 'disabled' then 'disabled' else 'online' end
         where id = ? and project_id = ?`,
      )
      .bind(
        input.observedAt,
        input.observedAt,
        input.versions ? JSON.stringify(input.versions) : null,
        input.acceptingWork === undefined ? null : input.acceptingWork ? 1 : 0,
        input.readinessState ?? null,
        input.readinessDetail === undefined ? null : 1,
        input.readinessDetail ?? null,
        input.capabilities ? JSON.stringify(input.capabilities) : null,
        input.workerId,
        projectId,
      ),
  ]);
  const updated = await db
    .prepare(
      `select worker.*, device.max_concurrent_sessions,
              device.icon_type, device.icon_value,
              (
                select count(*) from (
                  select active.id
                  from briar_hunt_runs active
                  join briar_execution_workers holder
                    on holder.id = active.worker_id
                  where holder.device_id = device.id
                    and active.claim_token_hash is not null
                    and active.lease_expires_at is not null
                    and active.lease_expires_at > ?
                    and active.status not in (
                      'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                    )
                  union all
                  select task.id
                  from briar_project_agent_task_jobs task
                  join briar_execution_workers holder
                    on holder.id = task.claimed_worker_id
                  where holder.device_id = device.id
                    and task.status = 'running'
                    and task.lease_expires_at > ?
                ) active_work
              ) as active_sessions
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.id = ?`,
    )
    .bind(input.observedAt, input.observedAt, input.workerId)
    .first<ExecutionWorkerRow>();
  if (!updated) {
    throw new WorkerConflictError("Worker heartbeat update was not persisted");
  }
  return updated;
}

export async function executionWorkerBindingForProject(
  db: D1Database,
  deviceId: string,
  projectId: string,
) {
  return await db
    .prepare(
      `select worker.*, device.max_concurrent_sessions,
              device.icon_type, device.icon_value
       from briar_execution_workers worker
       join briar_projects project on project.id = worker.project_id
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.project_id = ? and worker.device_id = ?
         and project.organization_id = device.organization_id`,
    )
    .bind(projectId, deviceId)
    .first<ExecutionWorkerRow>();
}

export async function executionWorkerBindingById(
  db: D1Database,
  deviceId: string,
  workerId: string,
) {
  return await db
    .prepare(
      `select worker.*, device.max_concurrent_sessions,
              device.icon_type, device.icon_value
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.id = ? and worker.device_id = ?`,
    )
    .bind(workerId, deviceId)
    .first<ExecutionWorkerRow>();
}

export async function executionWorkerDeviceForBinding(
  db: D1Database,
  workerId: string,
) {
  return await db
    .prepare(
      `select device.*
       from briar_execution_worker_devices device
       join briar_execution_workers worker on worker.device_id = device.id
       where worker.id = ?`,
    )
    .bind(workerId)
    .first<ExecutionWorkerDeviceRow>();
}

export async function authenticateExecutionWorker(
  db: D1Database,
  tokenHash: string,
  observedAt: string,
): Promise<ExecutionWorkerCredentialPrincipal | null> {
  const row = await db
    .prepare(
      `select device.id, device.organization_id, device.owner_user_id
       from briar_execution_worker_credentials credential
       join briar_execution_worker_devices device
         on device.id = credential.device_id
       join briar_organization_members membership
         on membership.organization_id = device.organization_id
        and membership.user_id = device.owner_user_id
       where credential.token_hash = ?
         and credential.revoked_at is null
         and (credential.expires_at is null or credential.expires_at > ?)
         and device.state != 'disabled'`,
    )
    .bind(tokenHash, observedAt)
    .first<{
      id: string;
      organization_id: string;
      owner_user_id: string;
    }>();
  if (!row) return null;
  await db
    .prepare(
      `update briar_execution_worker_credentials
       set last_used_at = ?
       where device_id = ? and token_hash = ?`,
    )
    .bind(observedAt, row.id, tokenHash)
    .run();
  return {
    deviceId: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
  };
}

export async function disableExecutionWorker(
  db: D1Database,
  deviceId: string,
  observedAt: string,
) {
  const results = await db.batch([
    db
      .prepare(
        `update briar_execution_worker_devices
         set state = 'disabled', updated_at = ?
         where id = ?`,
      )
      .bind(observedAt, deviceId),
    db
      .prepare(
        `update briar_execution_workers
         set state = 'disabled', updated_at = ?
         where device_id = ?`,
      )
      .bind(observedAt, deviceId),
    db
      .prepare(
        `update briar_execution_worker_credentials
         set revoked_at = ?
         where device_id = ? and revoked_at is null`,
      )
      .bind(observedAt, deviceId),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

/** Remove one project binding; revoke the device only after its last binding. */
export async function unbindExecutionWorker(
  db: D1Database,
  deviceId: string,
  projectId: string,
  observedAt: string,
) {
  const deleted = await db
    .prepare(
      `delete from briar_execution_workers
       where device_id = ? and project_id = ?`,
    )
    .bind(deviceId, projectId)
    .run();
  if (deleted.meta.changes < 1) return false;
  const remaining = await db
    .prepare(
      `select count(*) as bindings from briar_execution_workers
       where device_id = ?`,
    )
    .bind(deviceId)
    .first<{ bindings: number }>();
  if ((remaining?.bindings ?? 0) === 0) {
    await disableExecutionWorker(db, deviceId, observedAt);
  } else {
    await db
      .prepare(
        `update briar_execution_worker_devices
         set updated_at = ? where id = ?`,
      )
      .bind(observedAt, deviceId)
      .run();
  }
  return true;
}

export async function listExecutionWorkers(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const result = await db
    .prepare(
      `select worker.*, device.owner_user_id, device.organization_id,
              device.max_concurrent_sessions, device.icon_type,
              device.icon_value,
              (
                select count(*) from (
                  select active.id
                  from briar_hunt_runs active
                  join briar_execution_workers holder
                    on holder.id = active.worker_id
                  where holder.device_id = device.id
                    and active.claim_token_hash is not null
                    and active.lease_expires_at is not null
                    and active.lease_expires_at > ?
                    and active.status not in (
                      'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                    )
                  union all
                  select task.id
                  from briar_project_agent_task_jobs task
                  join briar_execution_workers holder
                    on holder.id = task.claimed_worker_id
                  where holder.device_id = device.id
                    and task.status = 'running'
                    and task.lease_expires_at > ?
                ) active_work
              ) as active_sessions
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.project_id = ?
       order by worker.last_heartbeat_at desc, worker.id asc`,
    )
    .bind(observedAt, observedAt, projectId)
    .all<
      ExecutionWorkerRow & {
        owner_user_id: string;
        organization_id: string;
      }
    >();
  return (result.results ?? []).map((row) => ({
    ...row,
    state: workerStateAt(row.last_heartbeat_at, observedAt, row.state),
  }));
}

export async function listOrganizationExecutionWorkers(
  db: D1Database,
  organizationId: string,
  observedAt: string,
): Promise<OrganizationExecutionWorker[]> {
  const result = await db
    .prepare(
      `select device.id as device_id, device.owner_user_id, owner.name as owner_name,
              device.label as device_label, device.icon_type, device.icon_value,
              device.state as device_state,
              device.max_concurrent_sessions, device.last_heartbeat_at,
              device.created_at, worker.id as worker_id,
              worker.project_id, project.name as project_name,
              worker.agent_provider, worker.capabilities_json,
              worker.versions_json,
              worker.state as worker_state,
              worker.accepting_work, worker.readiness_state,
              worker.readiness_detail, worker.last_heartbeat_at as worker_heartbeat_at,
              (
                select count(*) from (
                  select active.id
                  from briar_hunt_runs active
                  join briar_execution_workers holder
                    on holder.id = active.worker_id
                  where holder.device_id = device.id
                    and active.claim_token_hash is not null
                    and active.lease_expires_at is not null
                    and active.lease_expires_at > ?
                    and active.status not in (
                      'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                    )
                  union all
                  select task.id
                  from briar_project_agent_task_jobs task
                  join briar_execution_workers holder
                    on holder.id = task.claimed_worker_id
                  where holder.device_id = device.id
                    and task.status = 'running'
                    and task.lease_expires_at > ?
                ) active_work
              ) as active_sessions
       from briar_execution_worker_devices device
       join "user" owner on owner.id = device.owner_user_id
       left join briar_execution_workers worker
         on worker.device_id = device.id
       left join briar_projects project on project.id = worker.project_id
       where device.organization_id = ?
       order by device.last_heartbeat_at desc, device.id, project.created_at`,
    )
    .bind(observedAt, observedAt, organizationId)
    .all<{
      device_id: string;
      owner_user_id: string;
      owner_name: string;
      device_label: string;
      icon_type: "emoji" | "image" | null;
      icon_value: string | null;
      device_state: ExecutionWorkerState;
      max_concurrent_sessions: number;
      last_heartbeat_at: string;
      created_at: string;
      worker_id: string | null;
      project_id: string | null;
      project_name: string | null;
      agent_provider: AgentProvider | null;
      capabilities_json: string | null;
      versions_json: string | null;
      worker_state: ExecutionWorkerState | null;
      accepting_work: number | null;
      readiness_state: ExecutionWorkerReadiness | null;
      readiness_detail: string | null;
      worker_heartbeat_at: string | null;
      active_sessions: number;
    }>();
  const workers = new Map<string, OrganizationExecutionWorker>();
  for (const row of result.results ?? []) {
    const activeSessions = row.active_sessions ?? 0;
    const device =
      workers.get(row.device_id) ??
      ({
        deviceId: row.device_id,
        ownerUserId: row.owner_user_id,
        ownerName: row.owner_name,
        label: row.device_label,
        icon: executionWorkerIcon(row),
        state: workerStateAt(
          row.last_heartbeat_at,
          observedAt,
          row.device_state,
        ),
        maxConcurrentSessions: row.max_concurrent_sessions,
        activeSessions,
        lastHeartbeatAt: row.last_heartbeat_at,
        createdAt: row.created_at,
        versions: {},
        remoteUpdateSupported: false,
        updateRequest: await pendingExecutionWorkerUpdate(db, row.device_id),
        bindings: [],
      } satisfies OrganizationExecutionWorker);
    workers.set(row.device_id, device);
    if (Object.keys(device.versions).length === 0 && row.versions_json) {
      try {
        device.versions = JSON.parse(row.versions_json) as Record<string, string>;
      } catch {
        device.versions = {};
      }
    }
    if (row.capabilities_json) {
      try {
        const capabilities = JSON.parse(row.capabilities_json) as {
          remoteUpdates?: { supported?: unknown; protocol?: unknown };
        };
        device.remoteUpdateSupported ||=
          capabilities.remoteUpdates?.supported === true &&
          capabilities.remoteUpdates.protocol === 1;
      } catch {
        // Ignore malformed legacy capabilities.
      }
    }
    if (
      !row.worker_id ||
      !row.project_id ||
      !row.project_name ||
      !row.agent_provider ||
      !row.capabilities_json ||
      !row.worker_state ||
      !row.readiness_state ||
      !row.worker_heartbeat_at
    ) {
      continue;
    }
    const state = workerStateAt(
      row.worker_heartbeat_at,
      observedAt,
      row.worker_state,
    );
    device.bindings.push({
      id: row.worker_id,
      projectId: row.project_id,
      projectName: row.project_name,
      agentProvider: row.agent_provider,
      providers: executionWorkerProviders({
        agent_provider: row.agent_provider,
        capabilities_json: row.capabilities_json,
      }),
      state,
      acceptingWork: row.accepting_work !== 0,
      readiness:
        state === "disabled"
          ? "disabled"
          : state === "stale"
            ? "offline"
            : row.readiness_state === "needs_attention"
              ? "needs_attention"
              : activeSessions >= row.max_concurrent_sessions
                ? "busy"
                : "available",
      readinessDetail: row.readiness_detail,
    });
  }
  return [...workers.values()];
}

export async function listOrganizationExecutionProviders(
  db: D1Database,
  organizationId: string,
): Promise<AgentProvider[]> {
  const result = await db
    .prepare(
      `select worker.agent_provider, worker.capabilities_json
       from briar_execution_worker_devices device
       join "user" owner on owner.id = device.owner_user_id
       left join briar_execution_workers worker
         on worker.device_id = device.id
       left join briar_projects project on project.id = worker.project_id
       where device.organization_id = ?
       order by device.last_heartbeat_at desc, device.id, project.created_at`,
    )
    .bind(organizationId)
    .all<{
      agent_provider: AgentProvider | null;
      capabilities_json: string | null;
    }>();
  const providers = new Set<AgentProvider>();
  for (const row of result.results ?? []) {
    if (!row.agent_provider || !row.capabilities_json) continue;
    for (const provider of executionWorkerProviders({
      agent_provider: row.agent_provider,
      capabilities_json: row.capabilities_json,
    })) {
      providers.add(provider);
    }
  }
  return [...providers];
}

export async function getProjectExecutionWorkerPolicy(
  db: D1Database,
  projectId: string,
): Promise<ProjectExecutionWorkerPolicy> {
  const [policy, allowed] = await Promise.all([
    db
      .prepare(
        `select selection_mode, default_worker_id, updated_at
         from briar_project_execution_worker_policies
         where project_id = ?`,
      )
      .bind(projectId)
      .first<{
        selection_mode: "any" | "allowlist";
        default_worker_id: string | null;
        updated_at: string;
      }>(),
    db
      .prepare(
        `select worker_id
         from briar_project_execution_worker_allowlist
         where project_id = ?
         order by created_at, worker_id`,
      )
      .bind(projectId)
      .all<{ worker_id: string }>(),
  ]);
  return {
    selectionMode: policy?.selection_mode ?? "any",
    defaultWorkerId: policy?.default_worker_id ?? null,
    allowedWorkerIds: (allowed.results ?? []).map((row) => row.worker_id),
    updatedAt: policy?.updated_at ?? null,
  };
}

export async function updateProjectExecutionWorkerPolicy(
  db: D1Database,
  projectId: string,
  input: {
    selectionMode: "any" | "allowlist";
    defaultWorkerId: string | null;
    allowedWorkerIds: string[];
    updatedByUserId: string;
    observedAt: string;
  },
) {
  const allowedWorkerIds = [...new Set(input.allowedWorkerIds)];
  const referencedIds = [
    ...new Set([
      ...allowedWorkerIds,
      ...(input.defaultWorkerId ? [input.defaultWorkerId] : []),
    ]),
  ];
  if (referencedIds.length > 0) {
    const placeholders = referencedIds.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `select id from briar_execution_workers
         where project_id = ? and id in (${placeholders})`,
      )
      .bind(projectId, ...referencedIds)
      .all<{ id: string }>();
    if (
      new Set(result.results?.map((row) => row.id)).size !==
      referencedIds.length
    ) {
      throw new WorkerConflictError(
        "Execution policy references an unknown Worker",
      );
    }
  }
  if (
    input.selectionMode === "allowlist" &&
    input.defaultWorkerId &&
    !allowedWorkerIds.includes(input.defaultWorkerId)
  ) {
    throw new WorkerConflictError(
      "The default Worker must be in the allowlist",
    );
  }
  await db.batch([
    db
      .prepare(
        `insert into briar_project_execution_worker_policies (
           project_id, selection_mode, default_worker_id, updated_by_user_id,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?)
         on conflict(project_id) do update set
           selection_mode = excluded.selection_mode,
           default_worker_id = excluded.default_worker_id,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        projectId,
        input.selectionMode,
        input.defaultWorkerId,
        input.updatedByUserId,
        input.observedAt,
        input.observedAt,
      ),
    db
      .prepare(
        `delete from briar_project_execution_worker_allowlist
         where project_id = ?`,
      )
      .bind(projectId),
    ...allowedWorkerIds.map((workerId) =>
      db
        .prepare(
          `insert into briar_project_execution_worker_allowlist (
             project_id, worker_id, created_at
           ) values (?, ?, ?)`,
        )
        .bind(projectId, workerId, input.observedAt),
    ),
  ]);
  return getProjectExecutionWorkerPolicy(db, projectId);
}

export async function isExecutionWorkerAllowedForProject(
  db: D1Database,
  projectId: string,
  workerId: string,
) {
  const row = await db
    .prepare(
      `select case
         when policy.selection_mode is null or policy.selection_mode = 'any'
           then 1
         when allowed.worker_id is not null then 1
         else 0
       end as allowed
       from (select 1) seed
       left join briar_project_execution_worker_policies policy
         on policy.project_id = ?
       left join briar_project_execution_worker_allowlist allowed
         on allowed.project_id = ? and allowed.worker_id = ?`,
    )
    .bind(projectId, projectId, workerId)
    .first<{ allowed: number }>();
  return row?.allowed === 1;
}

export async function updateExecutionWorkerConcurrency(
  db: D1Database,
  deviceId: string,
  maxConcurrentSessions: number,
  observedAt: string,
) {
  if (
    !Number.isInteger(maxConcurrentSessions) ||
    maxConcurrentSessions < MIN_WORKER_CONCURRENT_SESSIONS ||
    maxConcurrentSessions > MAX_WORKER_CONCURRENT_SESSIONS
  ) {
    throw new WorkerConflictError(
      `Worker concurrency must be ${MIN_WORKER_CONCURRENT_SESSIONS}-${MAX_WORKER_CONCURRENT_SESSIONS}`,
    );
  }
  return await db
    .prepare(
      `update briar_execution_worker_devices
       set max_concurrent_sessions = ?, updated_at = ?
       where id = ? and state != 'disabled'
       returning *`,
    )
    .bind(maxConcurrentSessions, observedAt, deviceId)
    .first<ExecutionWorkerDeviceRow>();
}

export async function updateExecutionWorkerIcon(
  db: D1Database,
  deviceId: string,
  icon:
    | { type: "emoji"; value: string }
    | { type: "image"; value: string }
    | null,
  observedAt: string,
) {
  if (
    icon?.type === "emoji" &&
    !isWorkerEmoji(icon.value)
  ) {
    throw new WorkerConflictError("Worker emoji must be one emoji");
  }
  if (
    icon?.type === "image" &&
    !isWorkerLogoDataUrl(icon.value)
  ) {
    throw new WorkerConflictError("Worker image must be a supported data URL");
  }
  return await db
    .prepare(
      `update briar_execution_worker_devices
       set icon_type = ?, icon_value = ?, updated_at = ?
       where id = ? and state != 'disabled'
       returning *`,
    )
    .bind(icon?.type ?? null, icon?.value ?? null, observedAt, deviceId)
    .first<ExecutionWorkerDeviceRow>();
}

/** Keep the organization device and every project binding on the same name. */
export async function updateExecutionWorkerLabel(
  db: D1Database,
  deviceId: string,
  labelInput: string,
  observedAt: string,
) {
  const label = labelInput.trim();
  if (label.length < 1 || label.length > 100) {
    throw new WorkerConflictError("Worker label must be 1-100 characters");
  }
  const [deviceUpdate] = await db.batch([
    db
      .prepare(
        `update briar_execution_worker_devices
         set label = ?, updated_at = ?
         where id = ? and state != 'disabled'
         returning *`,
      )
      .bind(label, observedAt, deviceId),
    db
      .prepare(
        `update briar_execution_workers
         set label = ?, updated_at = ?
         where device_id = ? and state != 'disabled'`,
      )
      .bind(label, observedAt, deviceId),
  ]);
  return (deviceUpdate.results[0] as ExecutionWorkerDeviceRow | undefined) ?? null;
}

export async function auditExecutionEvent(
  db: D1Database,
  input: {
    organizationId: string;
    projectId: string;
    runId?: string | null;
    workerId?: string | null;
    agentId?: string | null;
    actorUserId?: string | null;
    actorDeviceId?: string | null;
    action:
      | "dispatched"
      | "reassigned"
      | "unassigned"
      | "claimed"
      | "lease_lost"
      | "cancelled"
      | "requeued"
      | "blocked"
      | "completed"
      | "worker_readiness_changed";
    requestId?: string | null;
    detail?: Record<string, unknown>;
    occurredAt: string;
  },
) {
  await db
    .prepare(
      `insert into briar_execution_audit_events (
         id, organization_id, project_id, run_id, worker_id, agent_id,
         actor_user_id, actor_device_id, action, request_id, detail_json,
         occurred_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict do nothing`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.projectId,
      input.runId ?? null,
      input.workerId ?? null,
      input.agentId ?? null,
      input.actorUserId ?? null,
      input.actorDeviceId ?? null,
      input.action,
      input.requestId ?? null,
      JSON.stringify(input.detail ?? {}),
      input.occurredAt,
    )
    .run();
}

/**
 * Assign execution settings and a Worker policy to one run. A logical Agent
 * remains optional and does not create an ownership edge with the Worker.
 */
export async function dispatchHuntRun(
  db: D1Database,
  organizationId: string,
  projectId: string,
  input: {
    runId: string;
    agentId?: string | null;
    provider?: AgentProvider;
    model?: string | null;
    effort?: ModelEffort | null;
    persistPreferences?: boolean;
    workerId?: string | null;
    requestedByUserId: string;
    requestId: string;
    occurredAt: string;
    reassign?: boolean;
  },
): Promise<ExecutionDispatchRow | null> {
  const agent = input.agentId
    ? await db
        .prepare(
          `select id, provider, model from briar_project_agents
           where id = ? and project_id = ?`,
        )
        .bind(input.agentId, projectId)
        .first<{ id: string; provider: AgentProvider; model: string | null }>()
    : null;
  if (input.agentId && !agent) {
    throw new WorkerConflictError("Agent not found for this project");
  }
  const preferences = await db
    .prepare(
      `select preferred_agent_provider, preferred_agent_model,
              preferred_agent_effort,
              (select count(*)
               from briar_issue_dependencies dependency
               join briar_hunt_runs prerequisite
                 on prerequisite.id = dependency.prerequisite_run_id
               where dependency.project_id = run.project_id
                 and dependency.dependent_run_id = run.id
                 and prerequisite.status != 'completed'
              ) as unsatisfied_dependency_count
       from briar_hunt_runs run where id = ? and project_id = ?`,
    )
    .bind(input.runId, projectId)
    .first<{
      preferred_agent_provider: AgentProvider | null;
      preferred_agent_model: string | null;
      preferred_agent_effort: ModelEffort | null;
      unsatisfied_dependency_count: number;
    }>();
  if (!preferences) return null;
  if (preferences.unsatisfied_dependency_count > 0) {
    throw new WorkerConflictError(
      "Run is waiting for prerequisite issues to complete",
    );
  }
  const provider =
    input.provider ?? preferences.preferred_agent_provider ?? agent?.provider;
  if (!provider) {
    throw new WorkerConflictError("Provider is required when no Agent is assigned");
  }
  const model =
    input.model !== undefined
      ? input.model
      : preferences.preferred_agent_provider
        ? preferences.preferred_agent_model
        : (agent?.model ?? null);
  const effort =
    input.effort !== undefined
      ? input.effort
      : preferences.preferred_agent_model
        ? preferences.preferred_agent_effort
        : null;

  if (input.workerId) {
    const worker = await db
      .prepare(
        `select worker.agent_provider, worker.capabilities_json, worker.state,
                worker.accepting_work, worker.readiness_state,
                worker.last_heartbeat_at
         from briar_execution_workers worker
         join briar_execution_worker_devices device on device.id = worker.device_id
         where worker.id = ? and worker.project_id = ?
           and device.organization_id = ?`,
      )
      .bind(input.workerId, projectId, organizationId)
      .first<{
        agent_provider: AgentProvider;
        capabilities_json: string;
        state: ExecutionWorkerState;
        accepting_work: number;
        readiness_state: ExecutionWorkerReadiness;
        last_heartbeat_at: string;
      }>();
    if (!worker) throw new WorkerConflictError("Worker not found for this project");
    if (
      workerStateAt(worker.last_heartbeat_at, input.occurredAt, worker.state) !==
        "online" ||
      worker.accepting_work !== 1 ||
      worker.readiness_state === "needs_attention"
    ) {
      throw new WorkerConflictError("Worker is not ready to accept work");
    }
    if (!executionWorkerProviders(worker).includes(provider)) {
      throw new WorkerConflictError(
        `Worker does not support the ${provider} provider`,
      );
    }
    if (
      !(await isExecutionWorkerAllowedForProject(db, projectId, input.workerId))
    ) {
      throw new WorkerConflictError(
        "Worker is not allowed by this project's execution policy",
      );
    }
  } else {
    const eligible = await db
      .prepare(
        `select worker.id
         from briar_execution_workers worker
         join briar_execution_worker_devices device on device.id = worker.device_id
         where worker.project_id = ? and device.organization_id = ?
           and worker.state != 'disabled'
           and worker.accepting_work = 1
           and worker.readiness_state != 'needs_attention'
           and coalesce(
             json_extract(
               worker.capabilities_json,
               '$.providerHealth.' || ? || '.healthy'
             ),
             0
           ) = 1
           and (
             not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = worker.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1
               from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = worker.project_id
                 and allowed.worker_id = worker.id
             )
           )
         limit 1`,
      )
      .bind(projectId, organizationId, provider)
      .first<{ id: string }>();
    if (!eligible) {
      throw new WorkerConflictError(
        `No worker is configured for the ${provider} provider`,
      );
    }
  }

  const existing = await db
    .prepare(
      `select id, agent_id, requested_agent_provider, requested_agent_model,
              requested_agent_effort, requested_worker_id,
              requested_by_user_id, dispatch_mode, dispatched_at
       from briar_hunt_runs
       where project_id = ? and dispatch_request_id = ?`,
    )
    .bind(projectId, input.requestId)
    .first<{
      id: string;
      agent_id: string | null;
      requested_agent_provider: AgentProvider | null;
      requested_agent_model: string | null;
      requested_agent_effort: ModelEffort | null;
      requested_worker_id: string | null;
      requested_by_user_id: string;
      dispatch_mode: "any" | "specific";
      dispatched_at: string;
    }>();
  if (existing) {
    return {
      runId: existing.id,
      agentId: existing.agent_id,
      provider: existing.requested_agent_provider ?? agent?.provider ?? provider,
      model: existing.requested_agent_model,
      effort: existing.requested_agent_effort,
      requestedWorkerId: existing.requested_worker_id,
      requestedByUserId: existing.requested_by_user_id,
      dispatchMode: existing.dispatch_mode,
      dispatchedAt: existing.dispatched_at,
      outcome: "already_dispatched",
    };
  }

  const run = await db
    .prepare(
      `select id, status, paused_at, current_attempt, claim_token_hash, worker_id
       from briar_hunt_runs where id = ? and project_id = ?`,
    )
    .bind(input.runId, projectId)
    .first<{
      id: string;
      status: string;
      paused_at: string | null;
      current_attempt: number;
      claim_token_hash: string | null;
      worker_id: string | null;
  }>();
  if (!run) return null;
  if (run.paused_at) {
    throw new WorkerConflictError("Run is paused; resume it before dispatching");
  }
  const active = ![
    "backlog",
    "queued",
    "blocked",
    "failed",
    "cancelled",
    "completed",
  ].includes(run.status);
  if (active && !input.reassign) {
    throw new WorkerConflictError("Run is already executing");
  }
  if (["completed", "cancelled"].includes(run.status)) {
    throw new WorkerConflictError("Completed or cancelled runs cannot be dispatched");
  }

  const nextAttempt =
    input.reassign && (active || run.claim_token_hash)
      ? run.current_attempt + 1
      : run.current_attempt;
  const action = input.reassign ? "reassigned" : "dispatched";
  const detail = input.workerId
    ? "사용자가 특정 Worker에 작업을 배정했습니다."
    : "사용자가 적합한 Worker에 작업을 배정했습니다.";
  const result = await db
    .prepare(
      `update briar_hunt_runs
       set agent_id = ?, requested_agent_provider = ?,
           requested_agent_model = ?, requested_agent_effort = ?,
           preferred_agent_provider = case when ? = 1 then ? else preferred_agent_provider end,
           preferred_agent_model = case when ? = 1 then ? else preferred_agent_model end,
           preferred_agent_effort = case when ? = 1 then ? else preferred_agent_effort end,
           requested_worker_id = ?,
           requested_by_user_id = ?,
           dispatch_mode = ?, dispatch_request_id = ?, dispatched_at = ?,
           status = 'queued', stage = 'queued', workflow_stage = null,
           current_attempt = ?, current_revision = 1,
           worker_id = null, claim_token_hash = null, claimed_by = null,
           claimed_at = null, lease_expires_at = null, completed_at = null,
           resume_requested_at = null, execution_metrics_json = null,
           detail = ?, last_event_at = ?, updated_at = ?
       where id = ? and project_id = ?
         and status not in ('completed', 'cancelled')`,
    )
    .bind(
      agent?.id ?? null,
      provider,
      model,
      effort,
      input.persistPreferences ? 1 : 0,
      provider,
      input.persistPreferences ? 1 : 0,
      model,
      input.persistPreferences ? 1 : 0,
      effort,
      input.workerId ?? null,
      input.requestedByUserId,
      input.workerId ? "specific" : "any",
      input.requestId,
      input.occurredAt,
      nextAttempt,
      detail,
      input.occurredAt,
      input.occurredAt,
      input.runId,
      projectId,
    )
    .run();
  if (result.meta.changes < 1) {
    throw new WorkerConflictError("Run dispatch raced with another update");
  }
  await auditExecutionEvent(db, {
    organizationId,
    projectId,
    runId: input.runId,
    workerId: input.workerId ?? null,
    agentId: agent?.id ?? null,
    actorUserId: input.requestedByUserId,
    action,
    requestId: input.requestId,
    detail: {
      previousWorkerId: run.worker_id,
      provider,
      model,
      effort,
      dispatchMode: input.workerId ? "specific" : "any",
    },
    occurredAt: input.occurredAt,
  });
  return {
    runId: input.runId,
    agentId: agent?.id ?? null,
    provider,
    model,
    effort,
    requestedWorkerId: input.workerId ?? null,
    requestedByUserId: input.requestedByUserId,
    dispatchMode: input.workerId ? "specific" : "any",
    dispatchedAt: input.occurredAt,
    outcome: "dispatched",
  };
}

export async function unassignHuntRun(
  db: D1Database,
  organizationId: string,
  projectId: string,
  input: { runId: string; requestedByUserId: string; requestId: string; occurredAt: string },
) {
  const run = await db
    .prepare(
      `select id, status, current_attempt, claim_token_hash, worker_id, requested_worker_id
       from briar_hunt_runs where id = ? and project_id = ?`,
    )
    .bind(input.runId, projectId)
    .first<{
      id: string;
      status: string;
      current_attempt: number;
      claim_token_hash: string | null;
      worker_id: string | null;
      requested_worker_id: string | null;
    }>();
  if (!run) return null;
  if (["completed", "cancelled"].includes(run.status)) {
    throw new WorkerConflictError("Completed or cancelled runs cannot be unassigned");
  }
  if (!run.worker_id && !run.requested_worker_id) {
    return { runId: input.runId, outcome: "not_assigned" as const };
  }
  const nextAttempt = run.claim_token_hash ? run.current_attempt + 1 : run.current_attempt;
  const result = await db
    .prepare(
      `update briar_hunt_runs
       set requested_worker_id = null, requested_by_user_id = null,
           dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
           worker_id = null, claim_token_hash = null, claimed_by = null,
           claimed_at = null, lease_expires_at = null,
           status = 'queued', stage = 'queued', workflow_stage = null,
           current_attempt = ?, current_revision = 1, paused_at = null,
           resume_requested_at = null, completed_at = null,
           detail = ?, last_event_at = ?, updated_at = ?
       where id = ? and project_id = ? and status not in ('completed', 'cancelled')
         and (worker_id is not null or requested_worker_id is not null)`,
    )
    .bind(
      nextAttempt,
      "사용자가 Worker 배정을 취소했습니다.",
      input.occurredAt,
      input.occurredAt,
      input.runId,
      projectId,
    )
    .run();
  if (result.meta.changes < 1) {
    throw new WorkerConflictError("Worker assignment changed before it could be cancelled");
  }
  await auditExecutionEvent(db, {
    organizationId,
    projectId,
    runId: input.runId,
    workerId: run.worker_id,
    actorUserId: input.requestedByUserId,
    action: "unassigned",
    requestId: input.requestId,
    detail: { previousWorkerId: run.worker_id, previousRequestedWorkerId: run.requested_worker_id },
    occurredAt: input.occurredAt,
  });
  return { runId: input.runId, outcome: "unassigned" as const };
}

export async function listExecutionAuditEvents(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  const result = await db
    .prepare(
      `select id, run_id, worker_id, agent_id, actor_user_id, actor_device_id,
              action, request_id, detail_json, occurred_at
       from briar_execution_audit_events
       where project_id = ? and (? is null or run_id = ?)
       order by occurred_at desc, id desc
       limit 200`,
    )
    .bind(projectId, runId ?? null, runId ?? null)
    .all<{
      id: string;
      run_id: string | null;
      worker_id: string | null;
      agent_id: string | null;
      actor_user_id: string | null;
      actor_device_id: string | null;
      action: string;
      request_id: string | null;
      detail_json: string;
      occurred_at: string;
    }>();
  return result.results ?? [];
}

/** Return the number of live run leases held across every project binding. */
export async function countExecutionWorkerDeviceSessions(
  db: D1Database,
  deviceId: string,
  observedAt: string,
) {
  const row = await db
    .prepare(
      `select count(*) as active_sessions
       from briar_hunt_runs run
       join briar_execution_workers worker on worker.id = run.worker_id
       where worker.device_id = ?
         and run.claim_token_hash is not null
         and run.lease_expires_at is not null
         and run.lease_expires_at > ?
         and run.status not in (
           'backlog', 'completed', 'cancelled', 'blocked', 'failed'
         )`,
    )
    .bind(deviceId, observedAt)
    .first<{ active_sessions: number }>();
  return row?.active_sessions ?? 0;
}

/**
 * Extend the lease of a run the caller proved it holds. Without this a long
 * run silently loses its claim 15 minutes in and can be taken by another
 * worker while it is still working.
 */
export async function renewHuntRunLease(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    claimTokenHash: string;
    observedAt: string;
    workerId?: string;
  },
) {
  const leaseExpiresAt = leaseExpiryFrom(input.observedAt);
  const row = await db
    .prepare(
      `update briar_hunt_runs
       set lease_expires_at = ?, updated_at = ?
       where id = ? and project_id = ? and claim_token_hash = ?
         and (? is null or worker_id = ?)
         and status not in ('completed', 'cancelled')
       returning id, lease_expires_at`,
    )
    .bind(
      leaseExpiresAt,
      input.observedAt,
      input.runId,
      projectId,
      input.claimTokenHash,
      input.workerId ?? null,
      input.workerId ?? null,
    )
    .first<{ id: string; lease_expires_at: string }>();
  if (!row) {
    throw new WorkerConflictError("Issue processing claim token is no longer active");
  }
  return row;
}

export type ReapedRun = {
  runId: string;
  outcome: "requeued" | "blocked";
  workerId: string | null;
  claimAttempts: number;
};

/**
 * Return runs whose holder stopped reporting.
 *
 * `assertQueuedHuntClaim` only gates writes while a run is still `queued`; once
 * the first event moves it out of `queued` the run is no longer claimable and
 * its lease no longer gates writes, so a worker that dies mid-run would leave
 * the issue in progress forever. Called opportunistically on claim and on
 * dashboard reads rather than from a cron trigger.
 */
export async function reapStalledHuntRuns(
  db: D1Database,
  projectId: string,
  observedAt: string,
): Promise<ReapedRun[]> {
  const cutoff = new Date(Date.parse(observedAt) - STALLED_RUN_GRACE_MS).toISOString();
  const stalled = await db
    .prepare(
      `select run.id, run.worker_id, run.claim_attempts, run.agent_id,
              run.resume_requested_at,
              project.organization_id
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where run.project_id = ?
         and status not in (
           'backlog', 'queued', 'completed', 'cancelled', 'blocked', 'failed'
         )
         and claim_token_hash is not null
         and lease_expires_at is not null
         and lease_expires_at <= ?
       order by run_number asc`,
    )
    .bind(projectId, cutoff)
    .all<{
      id: string;
      worker_id: string | null;
      claim_attempts: number;
      agent_id: string | null;
      resume_requested_at: string | null;
      organization_id: string;
    }>();

  const reaped: ReapedRun[] = [];
  for (const run of stalled.results ?? []) {
    const blocked = run.claim_attempts >= MAX_CLAIM_ATTEMPTS;
    const awaitingResumeClaim = !blocked && run.resume_requested_at !== null;
    await db
      .prepare(
        `update briar_hunt_runs
         set status = ?,
             stage = case when ? then stage else ? end,
             paused_at = ?,
             claim_token_hash = null,
             claimed_by = null,
             claimed_at = null,
             lease_expires_at = null,
             detail = ?,
             last_event_at = ?,
             updated_at = ?
         where id = ? and project_id = ?`,
      )
      .bind(
        blocked ? "blocked" : awaitingResumeClaim ? "running" : "queued",
        awaitingResumeClaim ? 1 : 0,
        blocked ? "blocked" : "queued",
        awaitingResumeClaim ? run.resume_requested_at : null,
        blocked
          ? "워커가 응답하지 않아 재시도 한도를 넘었습니다."
          : awaitingResumeClaim
            ? "워커가 응답하지 않아 일시정지 상태에서 다른 워커를 기다리고 있습니다."
            : "워커가 응답하지 않아 대기열로 돌아갔습니다.",
        observedAt,
        observedAt,
        run.id,
        projectId,
      )
      .run();
    await auditExecutionEvent(db, {
      organizationId: run.organization_id,
      projectId,
      runId: run.id,
      workerId: run.worker_id,
      agentId: run.agent_id,
      action: blocked ? "blocked" : "requeued",
      detail: { reason: "lease_expired", claimAttempts: run.claim_attempts },
      occurredAt: observedAt,
    });
    reaped.push({
      runId: run.id,
      outcome: blocked ? "blocked" : "requeued",
      workerId: run.worker_id,
      claimAttempts: run.claim_attempts,
    });
  }
  return reaped;
}

/** Runs currently held under a live lease, so automation does not double-dispatch. */
export async function countLeasedRuns(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const row = await db
    .prepare(
      `select count(*) as leased from briar_hunt_runs
       where project_id = ?
         and claim_token_hash is not null
         and lease_expires_at is not null
         and lease_expires_at > ?
         and status not in (
           'backlog', 'completed', 'cancelled', 'blocked', 'failed'
         )`,
    )
    .bind(projectId, observedAt)
    .first<{ leased: number }>();
  return row?.leased ?? 0;
}

/**
 * Append transcript events without destructively pruning older sessions.
 * The archive scheduler moves eligible sessions to verified R2 objects before
 * deleting their D1 rows, so an overloaded project never loses its history.
 */
export async function appendAgentTranscript(
  db: D1Database,
  projectId: string,
  input: {
    sessionId: string;
    runId: string | null;
    workerId: string | null;
    agentProvider: AgentProvider;
    events: TranscriptEventInput[];
    observedAt: string;
  },
) {
  const sessionId = input.sessionId.trim();
  if (sessionId.length < 1 || sessionId.length > 128) {
    throw new TranscriptLimitError("Transcript session id must be 1-128 characters");
  }
  if (input.events.length === 0) {
    throw new TranscriptLimitError("Transcript request carried no events");
  }
  if (input.events.length > MAX_TRANSCRIPT_EVENTS_PER_REQUEST) {
    throw new TranscriptLimitError(
      `Transcript request may carry at most ${MAX_TRANSCRIPT_EVENTS_PER_REQUEST} events`,
    );
  }

  const payloads = input.events.map((event) => {
    const serialized = JSON.stringify(event.payload ?? null);
    const bytes = utf8Length(serialized);
    if (bytes > MAX_TRANSCRIPT_PAYLOAD_BYTES) {
      // Rejected rather than truncated: a silently clipped payload reads as a
      // real agent message downstream.
      throw new TranscriptLimitError(
        `Transcript event ${event.sequence} exceeds ${MAX_TRANSCRIPT_PAYLOAD_BYTES} bytes`,
      );
    }
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      throw new TranscriptLimitError("Transcript sequence numbers start at 1");
    }
    return { ...event, serialized, bytes };
  });
  const requestBytes = payloads.reduce((total, event) => total + event.bytes, 0);
  if (requestBytes > MAX_TRANSCRIPT_REQUEST_BYTES) {
    throw new TranscriptLimitError(
      `Transcript request may carry at most ${MAX_TRANSCRIPT_REQUEST_BYTES} bytes`,
    );
  }

  const existing = await db
    .prepare(
      `select * from briar_agent_transcript_sessions
       where session_id = ? and project_id = ?`,
    )
    .bind(sessionId, projectId)
    .first<TranscriptSessionRow>();
  if (
    existing &&
    (existing.event_count + payloads.length > MAX_TRANSCRIPT_SESSION_EVENTS ||
      existing.byte_count + requestBytes > MAX_TRANSCRIPT_SESSION_BYTES)
  ) {
    throw new TranscriptLimitError(
      "Transcript session reached its retention limit; further events are not stored",
    );
  }

  if (!existing) {
    await db
      .prepare(
        `insert into briar_agent_transcript_sessions (
           session_id, project_id, run_id, worker_id, agent_provider,
           started_at, last_event_at, event_count, byte_count
         ) values (?, ?, ?, ?, ?, ?, ?, 0, 0)
         on conflict (session_id) do nothing`,
      )
      .bind(
        sessionId,
        projectId,
        input.runId,
        input.workerId,
        input.agentProvider,
        input.observedAt,
        input.observedAt,
      )
      .run();
  }

  let stored = 0;
  let storedBytes = 0;
  for (const event of payloads) {
    const result = await db
      .prepare(
        `insert into briar_agent_transcripts (
           session_id, sequence, direction, payload_json, recorded_at
         ) values (?, ?, ?, ?, ?)
         on conflict (session_id, sequence) do nothing`,
      )
      .bind(sessionId, event.sequence, event.direction, event.serialized, input.observedAt)
      .run();
    // A retried batch must not inflate the counters it is charged against.
    if (result.meta.changes > 0) {
      stored += 1;
      storedBytes += event.bytes;
    }
  }

  await db
    .prepare(
      `update briar_agent_transcript_sessions
       set last_event_at = ?,
           event_count = event_count + ?,
           byte_count = byte_count + ?,
           run_id = coalesce(run_id, ?),
           worker_id = coalesce(worker_id, ?)
       where session_id = ?`,
    )
    .bind(
      input.observedAt,
      stored,
      storedBytes,
      input.runId,
      input.workerId,
      sessionId,
    )
    .run();

  return { sessionId, stored, storedBytes, pruned: [] as string[] };
}

type TranscriptReadOptions = {
  afterSequence?: number;
  limit?: number;
  tail?: boolean;
};

export async function readAgentTranscript(
  db: D1Database,
  projectId: string,
  sessionId: string,
  options: TranscriptReadOptions = {},
) {
  const session = await db
    .prepare(
      `select * from briar_agent_transcript_sessions
       where session_id = ? and project_id = ?`,
    )
    .bind(sessionId, projectId)
    .first<TranscriptSessionRow>();
  if (!session) return null;
  const result = await db
    .prepare(
      `select sequence, direction, payload_json, recorded_at
       from briar_agent_transcripts
       where session_id = ? and sequence > ?
       order by sequence ${options.tail ? "desc" : "asc"}
       limit ?`,
    )
    .bind(
      sessionId,
      options.afterSequence ?? 0,
      Math.min(options.limit ?? 1_000, MAX_TRANSCRIPT_SESSION_EVENTS),
    )
    .all<{
      sequence: number;
      direction: TranscriptDirection;
      payload_json: string;
      recorded_at: string;
    }>();
  const events = result.results ?? [];
  return { session, events: options.tail ? events.reverse() : events };
}

export async function readLatestAgentTranscriptForRun(
  db: D1Database,
  projectId: string,
  runId: string,
  options: TranscriptReadOptions = {},
) {
  const latest = await db
    .prepare(
      `select session_id from briar_agent_transcript_sessions
       where project_id = ? and run_id = ?
       order by last_event_at desc, started_at desc, session_id desc
       limit 1`,
    )
    .bind(projectId, runId)
    .first<{ session_id: string }>();
  return latest
    ? readAgentTranscript(db, projectId, latest.session_id, options)
    : null;
}
