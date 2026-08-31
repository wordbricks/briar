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
  agentProviderSupportsSelection,
  mergeAgentProviderCapabilityAdvertisements,
  type AgentProviderCapabilityCatalog,
  type ModelEffort,
} from "../../src/lib/agent-provider-contract";
import type { AgentProvider } from "../../src/lib/agent-provider";
import { isChannelApprovedIssue } from "./db";
import {
  executionWorkerHandoffExists,
  executionWorkerUpdateRequest,
  executionWorkerUpdateIsReady,
  pendingExecutionWorkerUpdate,
} from "./worker-update-repository";
import type {
  WorkerUpdateHandoffWorkType,
  WorkerUpdateRequest,
} from "./worker-update-model";
import {
  MAX_WORKER_CONCURRENT_SESSIONS,
  MIN_WORKER_CONCURRENT_SESSIONS,
} from "./worker-limits";
import {
  addD1MutationMetrics,
  beginWorkerHardDelete,
  completeWorkerHardDelete,
  d1MutationMetrics,
  failWorkerHardDelete,
  recordPreservedWorkerBinding,
  type D1MutationMetrics,
  type WorkerHardDeleteContext,
} from "./worker-lifecycle-repository";
import {
  type WorkerRuntimeMetadata,
  workerRuntimeMetadataFromStoredProtoJson,
} from "./worker-runtime-mappers";

export type ExecutionWorkerState = "online" | "stale" | "disabled";
export type ExecutionWorkerReadiness = "ready" | "busy" | "needs_attention";
export type ProviderHealth = {
  installed: boolean;
  authenticated: boolean;
  healthy: boolean;
  reason?: string | null;
  usageExhausted?: boolean;
  maxUsedPercent?: number | null;
};
export type ProviderHealthMap = Partial<Record<AgentProvider, ProviderHealth>>;
export type TranscriptDirection = "client" | "server";

export type ExecutionWorkerRow = {
  id: string;
  project_id: string;
  device_id: string;
  label: string;
  host_fingerprint: string;
  runtime_proto_json: string;
  state: ExecutionWorkerState;
  accepting_work: number;
  readiness_state: ExecutionWorkerReadiness;
  readiness_detail: string | null;
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
  updateRequest: WorkerUpdateRequest | null;
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

async function beginExecutionWorkerUpdate(
  db: D1Database,
  input: { requestId: string; deviceId: string; observedAt: string },
) {
  await db.batch([
    db
      .prepare(
        `update briar_execution_worker_update_requests
         set handoff_state = case
               when handoff_state = 'ready' then 'ready'
               else 'draining'
             end,
             handoff_started_at = coalesce(handoff_started_at, ?),
             handoff_error = null,
             updated_at = ?
         where id = ? and device_id = ? and status = 'requested'`,
      )
      .bind(input.observedAt, input.observedAt, input.requestId, input.deviceId),
    db
      .prepare(
        `update briar_execution_workers
         set accepting_work = 0,
             readiness_state = 'busy',
             readiness_detail = '계획된 업데이트 handoff를 준비하고 있습니다.',
             updated_at = ?
         where device_id = ? and state <> 'disabled'`,
      )
      .bind(input.observedAt, input.deviceId),
  ]);
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
): Promise<WorkerUpdateRequest> {
  const pending = await pendingExecutionWorkerUpdate(db, input.deviceId);
  if (pending) {
    await beginExecutionWorkerUpdate(db, {
      requestId: pending.id,
      deviceId: input.deviceId,
      observedAt: input.requestedAt,
    });
    return (await pendingExecutionWorkerUpdate(db, input.deviceId)) ?? pending;
  }
  const inserted = await db
    .prepare(
      `insert into briar_execution_worker_update_requests (
         id, organization_id, device_id, requested_by_user_id,
         target_version, status, requested_at, updated_at,
         handoff_state, handoff_started_at
       ) values (?, ?, ?, ?, ?, 'requested', ?, ?, 'draining', ?)
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
      input.requestedAt,
    )
    .run();
  if (inserted.meta.changes < 1) {
    const concurrent = await pendingExecutionWorkerUpdate(db, input.deviceId);
    if (concurrent) {
      await beginExecutionWorkerUpdate(db, {
        requestId: concurrent.id,
        deviceId: input.deviceId,
        observedAt: input.requestedAt,
      });
      return (await pendingExecutionWorkerUpdate(db, input.deviceId)) ?? concurrent;
    }
    throw new WorkerConflictError("Worker update request changed");
  }
  await beginExecutionWorkerUpdate(db, {
    requestId: input.id,
    deviceId: input.deviceId,
    observedAt: input.requestedAt,
  });
  const requested = await pendingExecutionWorkerUpdate(db, input.deviceId);
  if (!requested) throw new WorkerConflictError("Worker update request disappeared");
  return requested;
}

async function updateExecutionWorkerHandoffStateIfIdle(
  db: D1Database,
  deviceId: string,
  requestId: string,
  observedAt: string,
) {
  const activeWorkCount = await countExecutionWorkerDeviceSessions(
    db,
    deviceId,
    observedAt,
  );
  if (activeWorkCount === 0) {
    await db
      .prepare(
        `update briar_execution_worker_update_requests
         set handoff_state = 'ready',
             handoff_completed_at = coalesce(handoff_completed_at, ?),
             updated_at = ?
         where id = ? and device_id = ? and status = 'requested'
           and handoff_state = 'draining'`,
      )
      .bind(observedAt, observedAt, requestId, deviceId)
      .run();
  }
  return activeWorkCount;
}

export async function executionWorkerUpdateStatus(
  db: D1Database,
  input: { deviceId: string; requestId?: string; observedAt: string },
) {
  const row = await executionWorkerUpdateRequest(db, input);
  if (!row) return null;
  const activeWorkCount = row.status === "requested"
    ? await updateExecutionWorkerHandoffStateIfIdle(
        db,
        input.deviceId,
        row.id,
        input.observedAt,
      )
    : 0;
  const request = await executionWorkerUpdateRequest(db, {
    deviceId: input.deviceId,
    requestId: row.id,
  }) ?? row;
  return {
    request,
    activeWorkCount,
    ready: request.handoffState === "ready",
  };
}

export async function completeExecutionWorkerUpdates(
  db: D1Database,
  deviceId: string,
  currentVersion: string | undefined,
  observedAt: string,
  knownPending?: WorkerUpdateRequest | null,
): Promise<WorkerUpdateRequest | null> {
  const pending = knownPending === undefined
    ? await pendingExecutionWorkerUpdate(db, deviceId)
    : knownPending;
  if (
    !pending ||
    !currentVersion ||
    !isSemanticVersion(currentVersion) ||
    compareSemanticVersions(currentVersion, pending.targetVersion) < 0
  ) {
    return pending;
  }
  const status = await executionWorkerUpdateStatus(db, {
    deviceId,
    requestId: pending.id,
    observedAt,
  });
  if (!status?.ready || status.activeWorkCount > 0) {
    return status?.request.status === "requested" ? status.request : null;
  }
  const completed = await db
    .prepare(
      `update briar_execution_worker_update_requests
       set status = 'completed', completed_at = ?, updated_at = ?
       where id = ? and status = 'requested'`,
    )
    .bind(observedAt, observedAt, pending.id)
    .run();
  if ((completed.meta.changes ?? 0) > 0) {
    const device = await db
      .prepare(
        `select organization_id from briar_execution_worker_devices where id = ?`,
      )
      .bind(deviceId)
      .first<{ organization_id: string }>();
    if (device) {
      await recordPreservedWorkerBinding(db, {
        requestId: `worker-update:${pending.id}`,
        organizationId: device.organization_id,
        projectId: null,
        deviceId,
        workerId: null,
        reason: "update",
        observedAt,
        detail: {
          bindingPreserved: true,
          targetVersion: pending.targetVersion,
          currentVersion,
        },
      }).catch(() => {
        console.error(JSON.stringify({
          message: "Execution Worker update lifecycle telemetry failed",
          requestId: pending.id,
          deviceId,
        }));
      });
    }
  }
  return null;
}

export async function handoffExecutionWorkerClaim(
  db: D1Database,
  input: {
    requestId: string;
    organizationId: string;
    deviceId: string;
    projectId: string;
    workerId: string;
    workType: WorkerUpdateHandoffWorkType;
    workId: string;
    runId: string | null;
    claimTokenHash: string;
    metadata: Record<string, unknown>;
    observedAt: string;
  },
) {
  if (!(await executionWorkerUpdateIsReady(db, {
    requestId: input.requestId,
    deviceId: input.deviceId,
    organizationId: input.organizationId,
  }))) {
    return { outcome: "not_ready" as const, activeWorkCount: 0 };
  }

  const update = (() => {
    switch (input.workType) {
      case "issue":
        return db.prepare(
          `update briar_hunt_runs
           set status = 'queued',
               claim_token_hash = null, claimed_by = null, claimed_at = null,
               lease_expires_at = null, worker_id = null,
               planned_update_resume = 1,
               detail = '계획된 Worker 업데이트 후 작업을 이어받도록 인계했습니다.',
               updated_at = ?
           where id = ? and project_id = ? and status not in
             ('backlog', 'completed', 'cancelled', 'blocked', 'failed')
             and worker_id = ? and claim_token_hash = ?
             and lease_expires_at > ?
           returning id`,
        ).bind(
          input.observedAt,
          input.workId,
          input.projectId,
          input.workerId,
          input.claimTokenHash,
          input.observedAt,
        );
      case "projectAgentTask":
        return db.prepare(
          `update briar_project_agent_task_jobs
           set status = 'queued', claimed_worker_id = null,
               claim_token_hash = null, claimed_at = null,
               lease_expires_at = null, planned_update_resume = 1,
               error = null, updated_at = ?
           where id = ? and project_id = ? and status = 'running'
             and claimed_worker_id = ? and claim_token_hash = ?
             and lease_expires_at > ?
           returning id`,
        ).bind(
          input.observedAt,
          input.workId,
          input.projectId,
          input.workerId,
          input.claimTokenHash,
          input.observedAt,
        );
      case "issueReply":
        return db.prepare(
          `update briar_issue_agent_reply_jobs
           set status = 'queued', claimed_worker_id = null,
               claim_token_hash = null, claimed_at = null,
               lease_expires_at = null, planned_update_resume = 1,
               error = null, updated_at = ?
           where id = ? and project_id = ? and status = 'running'
             and claimed_worker_id = ? and claim_token_hash = ?
             and lease_expires_at > ?
           returning id`,
        ).bind(
          input.observedAt,
          input.workId,
          input.projectId,
          input.workerId,
          input.claimTokenHash,
          input.observedAt,
        );
      case "channelReply":
        return db.prepare(
          `update briar_channel_agent_reply_jobs
           set status = 'queued', claimed_device_id = null,
               claimed_worker_id = null, claim_token_hash = null,
               claimed_at = null, lease_expires_at = null,
               planned_update_resume = 1, error = null, updated_at = ?
           where id = ? and organization_id = ? and status = 'running'
             and (project_id is null or project_id = ?) and claimed_device_id = ?
             and claimed_worker_id = ? and claim_token_hash = ?
             and lease_expires_at > ?
           returning id`,
        ).bind(
          input.observedAt,
          input.workId,
          input.organizationId,
          input.projectId,
          input.deviceId,
          input.workerId,
          input.claimTokenHash,
          input.observedAt,
        );
    }
  })();

  const table = input.workType === "issue"
    ? "briar_hunt_runs"
    : input.workType === "projectAgentTask"
      ? "briar_project_agent_task_jobs"
      : input.workType === "issueReply"
        ? "briar_issue_agent_reply_jobs"
        : "briar_channel_agent_reply_jobs";
  const audit = db
    .prepare(
      `insert into briar_execution_worker_update_handoffs (
         id, update_request_id, organization_id, device_id, project_id,
         worker_id, work_type, work_id, run_id, claim_token_hash,
         metadata_json, status, created_at, updated_at
       )
       select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'handed_off', ?, ?
       where exists (
         select 1 from ${table}
         where id = ? and status = 'queued' and planned_update_resume = 1
           and updated_at = ?
       )
       on conflict (update_request_id, work_type, work_id) do nothing`,
    )
    .bind(
      crypto.randomUUID(),
      input.requestId,
      input.organizationId,
      input.deviceId,
      input.projectId,
      input.workerId,
      input.workType,
      input.workId,
      input.runId,
      input.claimTokenHash,
      JSON.stringify(input.metadata),
      input.observedAt,
      input.observedAt,
      input.workId,
      input.observedAt,
    );
  const [updated, inserted] = await db.batch([update, audit]);
  if ((updated.results?.length ?? 0) < 1) {
    const existing = await executionWorkerHandoffExists(db, {
      requestId: input.requestId,
      workType: input.workType,
      workId: input.workId,
      claimTokenHash: input.claimTokenHash,
    });
    if (!existing) return { outcome: "not_active" as const, activeWorkCount: 0 };
    const status = await executionWorkerUpdateStatus(db, {
      deviceId: input.deviceId,
      requestId: input.requestId,
      observedAt: input.observedAt,
    });
    return {
      outcome: "already_handed_off" as const,
      activeWorkCount: status?.activeWorkCount ?? 0,
    };
  }
  if ((inserted.meta?.changes ?? 0) < 1) {
    throw new WorkerConflictError("Worker handoff audit was not recorded");
  }
  const status = await executionWorkerUpdateStatus(db, {
    deviceId: input.deviceId,
    requestId: input.requestId,
    observedAt: input.observedAt,
  });
  return {
    outcome: "handed_off" as const,
    activeWorkCount: status?.activeWorkCount ?? 0,
  };
}

/** Persist a failed handoff without releasing the old lease. */
export async function failExecutionWorkerUpdateHandoff(
  db: D1Database,
  input: {
    requestId: string;
    organizationId: string;
    deviceId: string;
    projectId: string;
    workerId: string;
    workType: WorkerUpdateHandoffWorkType;
    workId: string;
    runId: string | null;
    claimTokenHash: string;
    metadata: Record<string, unknown>;
    error: string;
    observedAt: string;
  },
) {
  const error = input.error.trim().slice(0, 4_000) || "Unknown handoff failure";
  await db.batch([
    db
      .prepare(
        `update briar_execution_worker_update_requests
         set handoff_state = 'failed', handoff_error = ?, updated_at = ?
         where id = ? and device_id = ? and organization_id = ?
           and status = 'requested' and handoff_state in ('draining', 'ready')`,
      )
      .bind(
        error,
        input.observedAt,
        input.requestId,
        input.deviceId,
        input.organizationId,
      ),
    db
      .prepare(
        `update briar_execution_workers
         set accepting_work = 0,
             readiness_state = 'busy',
             readiness_detail = ?,
             updated_at = ?
         where device_id = ? and state <> 'disabled'`,
      )
      .bind(
        `계획된 업데이트 handoff 실패: ${error.slice(0, 420)}`,
        input.observedAt,
        input.deviceId,
      ),
    db
      .prepare(
        `insert into briar_execution_worker_update_handoffs (
           id, update_request_id, organization_id, device_id, project_id,
           worker_id, work_type, work_id, run_id, claim_token_hash,
           metadata_json, status, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)
         on conflict (update_request_id, work_type, work_id) do nothing`,
      )
      .bind(
        crypto.randomUUID(),
        input.requestId,
        input.organizationId,
        input.deviceId,
        input.projectId,
        input.workerId,
        input.workType,
        input.workId,
        input.runId,
        input.claimTokenHash,
        JSON.stringify({ ...input.metadata, error }),
        input.observedAt,
        input.observedAt,
      ),
  ]);
}

export async function failExecutionWorkerUpdate(
  db: D1Database,
  input: {
    requestId: string;
    organizationId: string;
    deviceId: string;
    error: string;
    observedAt: string;
  },
) {
  const error = input.error.trim().slice(0, 4_000) || "Unknown update failure";
  const [updated] = await db.batch([
    db
      .prepare(
        `update briar_execution_worker_update_requests
         set handoff_state = 'failed', handoff_error = ?, updated_at = ?
         where id = ? and device_id = ? and organization_id = ?
           and status = 'requested'
           and handoff_state in ('draining', 'ready', 'failed')`,
      )
      .bind(
        error,
        input.observedAt,
        input.requestId,
        input.deviceId,
        input.organizationId,
      ),
    db
      .prepare(
        `update briar_execution_workers
         set accepting_work = 0,
             readiness_state = 'needs_attention',
             readiness_detail = '원격 런타임 업데이트에 실패했습니다.',
             updated_at = ?
         where device_id = ? and state <> 'disabled'`,
      )
      .bind(input.observedAt, input.deviceId),
  ]);
  if ((updated.meta?.changes ?? 0) < 1) {
    throw new WorkerConflictError("Worker update request is no longer active");
  }
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
  payload?: unknown;
};

/** Heartbeat older than this and the worker is reported as stale. */
export const WORKER_STALE_AFTER_MS = 3 * 60_000;
/** Lease length granted at claim time and by every renewal. */
export const LEASE_DURATION_MS = 15 * 60_000;
/** Credential usage is operational telemetry, so persist it at coarse granularity. */
export const WORKER_CREDENTIAL_TOUCH_INTERVAL_MS = 5 * 60_000;
/** Workers renew every 5 minutes, so a lease this far past expiry is stalled. */
export const STALLED_RUN_GRACE_MS = 5 * 60_000;
/** Reaping past this many attempts blocks the run instead of looping forever. */
export const MAX_CLAIM_ATTEMPTS = 5;

export class WorkerConflictError extends Error {}
export class TranscriptLimitError extends Error {}

export function executionWorkerProviders(
  worker: Pick<ExecutionWorkerRow, "runtime_proto_json">,
): AgentProvider[] {
  return executionWorkerRuntime(worker).providers;
}

export const executionWorkerRuntime = (
  worker: Pick<ExecutionWorkerRow, "runtime_proto_json">,
) => workerRuntimeMetadataFromStoredProtoJson(worker.runtime_proto_json);

export function executionWorkerSupportsSelection(
  worker: Pick<ExecutionWorkerRow, "runtime_proto_json">,
  provider: AgentProvider,
  model: string | null,
  effort: string | null,
) {
  const runtime = executionWorkerRuntime(worker);
  if (!runtime.providers.includes(provider)) return false;
  return agentProviderSupportsSelection(
    runtime.providerCapabilities[provider],
    model,
    effort,
  );
}

function executionWorkerAdvertisesSelection(
  worker: Pick<ExecutionWorkerRow, "runtime_proto_json">,
  provider: AgentProvider,
  model: string | null,
  effort: string | null,
) {
  return agentProviderSupportsSelection(
    executionWorkerRuntime(worker).providerCapabilities[provider],
    model,
    effort,
  );
}

function executionWorkerProviderUsageExhausted(
  worker: Pick<ExecutionWorkerRow, "runtime_proto_json">,
  provider: AgentProvider,
) {
  return executionWorkerRuntime(worker).providerHealth[provider]
    ?.usageExhausted === true;
}

export function projectExecutionWorkerCapabilityCatalog(
  workers: readonly ExecutionWorkerRow[],
  policy: ProjectExecutionWorkerPolicy,
) {
  const allowedWorkerIds = new Set(policy.allowedWorkerIds);
  const eligibleWorkers = workers.filter((worker) =>
    worker.state === "online" &&
    worker.accepting_work === 1 &&
    worker.readiness_state !== "needs_attention" &&
    (policy.selectionMode !== "allowlist" || allowedWorkerIds.has(worker.id))
  );
  const advertisements = eligibleWorkers.flatMap((worker) => {
    const runtime = executionWorkerRuntime(worker);
    const providers = runtime.providers;
    if (providers.length === 0) return [];
    return [{
      providers,
      providerCapabilities: runtime.providerCapabilities,
    }];
  });
  return {
    capabilities: mergeAgentProviderCapabilityAdvertisements(advertisements),
    workerCount: advertisements.length,
  };
}

/**
 * Channel mentions are interactive, so only a Worker that can claim the reply
 * immediately counts as available. Project Agents require an exact project
 * binding; Organization Agents may use any live binding in the organization.
 */
export type ChannelReplyWorkerAvailability =
  | "available"
  | "usage_exhausted"
  | "unavailable";

export async function channelReplyWorkerAvailability(
  db: D1Database,
  input: {
    organizationId: string;
    projectId: string | null;
    preferredDeviceId?: string | null;
    preferredWorkerId?: string | null;
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    observedAt: string;
  },
) {
  const result = await db
    .prepare(
      `select worker.runtime_proto_json,
              worker.state as worker_state,
              worker.accepting_work, worker.readiness_state,
              worker.last_heartbeat_at as worker_last_heartbeat_at,
              device.state as device_state,
              device.last_heartbeat_at as device_last_heartbeat_at
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       join briar_execution_worker_credentials credential
         on credential.device_id = device.id
       join briar_organization_members membership
         on membership.organization_id = device.organization_id
        and membership.user_id = device.owner_user_id
       where device.organization_id = ?
         and (? is null or worker.project_id = ?)
         and (? is null or device.id = ?)
         and (? is null or worker.id = ?)
         and credential.revoked_at is null
         and (credential.expires_at is null or credential.expires_at > ?)
         and (
           ? is null
           or not exists (
             select 1 from briar_project_execution_worker_policies policy
             where policy.project_id = ?
               and policy.selection_mode = 'allowlist'
           )
           or exists (
             select 1 from briar_project_execution_worker_allowlist allowed
             where allowed.project_id = ? and allowed.worker_id = worker.id
           )
         )`,
    )
    .bind(
      input.organizationId,
      input.projectId,
      input.projectId,
      input.preferredDeviceId ?? null,
      input.preferredDeviceId ?? null,
      input.preferredWorkerId ?? null,
      input.preferredWorkerId ?? null,
      input.observedAt,
      input.projectId,
      input.projectId,
      input.projectId,
    )
    .all<{
      runtime_proto_json: string;
      worker_state: ExecutionWorkerState;
      accepting_work: number;
      readiness_state: ExecutionWorkerReadiness;
      worker_last_heartbeat_at: string;
      device_state: ExecutionWorkerState;
      device_last_heartbeat_at: string;
    }>();

  const liveWorkers = result.results.filter((worker) =>
    workerStateAt(
      worker.device_last_heartbeat_at,
      input.observedAt,
      worker.device_state,
    ) === "online" &&
    workerStateAt(
      worker.worker_last_heartbeat_at,
      input.observedAt,
      worker.worker_state,
    ) === "online"
  );
  if (liveWorkers.some((worker) =>
    worker.accepting_work === 1 &&
    // Reply work is independent of regular execution slots. `busy` means
    // those slots are occupied, while `needs_attention` remains a hard stop.
    worker.readiness_state !== "needs_attention" &&
    executionWorkerSupportsSelection(
      worker,
      input.provider,
      input.model,
      input.effort,
    )
  )) return "available";

  if (liveWorkers.some((worker) =>
    executionWorkerProviderUsageExhausted(worker, input.provider) &&
    executionWorkerAdvertisesSelection(
      worker,
      input.provider,
      input.model,
      input.effort,
    )
  )) return "usage_exhausted";

  return "unavailable";
}

export async function hasAvailableChannelReplyWorker(
  db: D1Database,
  input: Parameters<typeof channelReplyWorkerAvailability>[1],
) {
  return await channelReplyWorkerAvailability(db, input) === "available";
}

export async function getProjectDesignatedWorker(
  db: D1Database,
  input: {
    organizationId: string;
    projectId: string;
    workerId: string;
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    observedAt: string;
  },
) {
  const worker = await db.prepare(
    `select worker.id, worker.device_id, worker.label
     from briar_execution_workers worker
     join briar_execution_worker_devices device on device.id = worker.device_id
     join briar_teams project on project.id = worker.project_id
     where worker.id = ? and worker.project_id = ?
       and device.organization_id = ?
       and project.organization_id = device.organization_id`,
  ).bind(
    input.workerId,
    input.projectId,
    input.organizationId,
  ).first<{ id: string; device_id: string; label: string }>();
  if (!worker) return null;
  return {
    id: worker.id,
    deviceId: worker.device_id,
    label: worker.label,
    availability: await channelReplyWorkerAvailability(db, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      preferredDeviceId: worker.device_id,
      preferredWorkerId: worker.id,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      observedAt: input.observedAt,
    }),
  };
}

export async function userOwnsExecutionWorkerDevice(
  db: D1Database,
  input: { organizationId: string; userId: string; deviceId: string },
) {
  const row = await db.prepare(
    `select 1 as present from briar_execution_worker_devices
     where id = ? and organization_id = ? and owner_user_id = ?`,
  ).bind(input.deviceId, input.organizationId, input.userId)
    .first<{ present: number }>();
  return row?.present === 1;
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
    runtime: WorkerRuntimeMetadata;
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
    .prepare(`select organization_id from briar_teams where id = ?`)
    .bind(projectId)
    .first<{ organization_id: string }>();
  if (!project || project.organization_id !== input.organizationId) {
    throw new WorkerConflictError("Worker project must belong to its organization");
  }

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
           id, project_id, device_id, label, host_fingerprint,
           runtime_proto_json, state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)
         on conflict (project_id, device_id) do update set
           label = excluded.label,
           host_fingerprint = excluded.host_fingerprint,
           runtime_proto_json = excluded.runtime_proto_json,
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
        input.runtime.runtimeProtoJson,
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
    runtime: WorkerRuntimeMetadata;
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
    .prepare(`select organization_id from briar_teams where id = ?`)
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
         id, project_id, device_id, label, host_fingerprint,
         runtime_proto_json, state, last_heartbeat_at, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)
       on conflict (project_id, device_id) do update set
         label = excluded.label,
         host_fingerprint = excluded.host_fingerprint,
         runtime_proto_json = excluded.runtime_proto_json,
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
      input.runtime.runtimeProtoJson,
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
    knownBinding?: ExecutionWorkerRow;
    runtime: WorkerRuntimeMetadata;
    acceptingWork?: boolean;
    readinessState?: ExecutionWorkerReadiness;
    readinessDetail?: string | null;
    observedAt: string;
  },
) {
  const binding = input.knownBinding ?? await db
    .prepare(
      `select worker.*, device.max_concurrent_sessions,
              device.icon_type, device.icon_value
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.id = ? and worker.project_id = ?`,
    )
    .bind(input.workerId, projectId)
    .first<ExecutionWorkerRow>();
  if (
    !binding ||
    binding.id !== input.workerId ||
    binding.project_id !== projectId
  ) {
    throw new WorkerConflictError("Worker is not registered for this project");
  }
  const [, workerUpdate] = await db.batch<ExecutionWorkerRow>([
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
             runtime_proto_json = ?,
             accepting_work = case when exists (
               select 1 from briar_managed_computers computer
               where computer.briar_device_id = ?
                 and computer.state not in ('needs_setup', 'ready')
             ) then 0 else coalesce(?, accepting_work) end,
             readiness_state = case when exists (
               select 1 from briar_managed_computers computer
               where computer.briar_device_id = ?
                 and computer.state not in ('needs_setup', 'ready')
             ) then 'busy' else coalesce(?, readiness_state) end,
             readiness_detail = case when exists (
               select 1 from briar_managed_computers computer
               where computer.briar_device_id = ?
                 and computer.state not in ('needs_setup', 'ready')
             ) then 'Managed computer is not accepting new work.'
               when ? is null then readiness_detail else ? end,
             state = case when state = 'disabled' then 'disabled' else 'online' end
         where id = ? and project_id = ?
         returning *`,
      )
      .bind(
        input.observedAt,
        input.observedAt,
        input.runtime.runtimeProtoJson,
        binding.device_id,
        input.acceptingWork === undefined ? null : input.acceptingWork ? 1 : 0,
        binding.device_id,
        input.readinessState ?? null,
        binding.device_id,
        input.readinessDetail === undefined ? null : 1,
        input.readinessDetail ?? null,
        input.workerId,
        projectId,
      ),
  ]);
  const updated = workerUpdate.results?.[0];
  if (!updated) {
    throw new WorkerConflictError("Worker heartbeat update was not persisted");
  }
  return {
    ...updated,
    max_concurrent_sessions: binding.max_concurrent_sessions,
    icon_type: binding.icon_type,
    icon_value: binding.icon_value,
  };
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
       join briar_teams project on project.id = worker.project_id
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
      `select device.id, device.organization_id, device.owner_user_id,
              credential.last_used_at
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
      last_used_at: string | null;
    }>();
  if (!row) return null;
  const observedAtMs = Date.parse(observedAt);
  const lastUsedAtMs = row.last_used_at ? Date.parse(row.last_used_at) : NaN;
  if (
    !Number.isFinite(lastUsedAtMs) ||
    lastUsedAtMs <= observedAtMs - WORKER_CREDENTIAL_TOUCH_INTERVAL_MS
  ) {
    const touchBefore = new Date(
      observedAtMs - WORKER_CREDENTIAL_TOUCH_INTERVAL_MS,
    ).toISOString();
    await db
      .prepare(
        `update briar_execution_worker_credentials
         set last_used_at = ?
         where device_id = ? and token_hash = ?
           and (last_used_at is null or last_used_at <= ?)`,
      )
      .bind(observedAt, row.id, tokenHash, touchBefore)
      .run();
  }
  return {
    deviceId: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
  };
}

async function disableExecutionWorkerMutation(
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
  return {
    disabled: (results[0]?.meta.changes ?? 0) > 0,
    metrics: d1MutationMetrics(results),
  };
}

export async function disableExecutionWorker(
  db: D1Database,
  deviceId: string,
  observedAt: string,
) {
  return (await disableExecutionWorkerMutation(db, deviceId, observedAt)).disabled;
}

async function executionWorkerPinnedUse(
  db: D1Database,
  input: { deviceId: string; projectId?: string; observedAt: string },
) {
  return db.prepare(
    `select pin.kind, pin.worker_label, pin.agent_name
     from (
       select 'designated' as kind, worker.label as worker_label,
              agent.name as agent_name, worker.project_id
       from briar_execution_workers worker
       join briar_project_agents agent
         on agent.designated_worker_id = worker.id
       where worker.device_id = ?
       union all
       select 'retained_thread' as kind, worker.label as worker_label,
              null as agent_name, worker.project_id
       from briar_execution_workers worker
       join briar_channel_reply_sessions session
         on session.owner_worker_id = worker.id
       where worker.device_id = ? and session.retained_until > ?
     ) pin
     where (? is null or pin.project_id = ?)
     limit 1`,
  ).bind(
    input.deviceId,
    input.deviceId,
    input.observedAt,
    input.projectId ?? null,
    input.projectId ?? null,
  ).first<{
    kind: "designated" | "retained_thread";
    worker_label: string;
    agent_name: string | null;
  }>();
}

function pinnedWorkerDeleteError(pin: NonNullable<
  Awaited<ReturnType<typeof executionWorkerPinnedUse>>
>) {
  return pin.kind === "designated"
    ? `Worker "${pin.worker_label}" is the Designated Worker for Agent "${pin.agent_name ?? "Agent"}"; select another Worker or automatic placement before deleting it`
    : `Worker "${pin.worker_label}" owns a retained channel thread; wait for that session to expire before deleting it`;
}

/**
 * Permanently remove an idle organization Worker and its project bindings.
 *
 * Disable first so a concurrent request cannot claim new work while deletion
 * waits for already-issued leases to drain. Device foreign keys cascade the
 * credential, project bindings, update requests, and update handoffs; durable
 * run and audit references use `on delete set null` and remain readable.
 */
export async function deleteExecutionWorker(
  db: D1Database,
  deviceId: string,
  observedAt: string,
  lifecycle: Omit<WorkerHardDeleteContext, "deviceId" | "observedAt" | "operation">,
) {
  const context: WorkerHardDeleteContext = {
    ...lifecycle,
    deviceId,
    observedAt,
    operation: "device_delete",
  };
  const attempt = await beginWorkerHardDelete(db, context);
  if (attempt.replayed) return true;
  let metrics: D1MutationMetrics = { rowsRead: 0, rowsWritten: 0, changes: 0 };
  let failureRecorded = false;
  try {
    const bindingCountResult = await db
      .prepare(
        `select count(*) as binding_count from briar_execution_workers
         where device_id = ?`,
      )
      .bind(deviceId)
      .all<{ binding_count: number }>();
    const bindingCount = bindingCountResult.results[0]?.binding_count ?? 0;
    metrics = addD1MutationMetrics(
      metrics,
      d1MutationMetrics([bindingCountResult]),
    );
    const pinned = await executionWorkerPinnedUse(db, {
      deviceId,
      observedAt,
    });
    if (pinned) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "blocked",
        reasonCode: "active_sessions",
        metrics,
      });
      failureRecorded = true;
      throw new WorkerConflictError(pinnedWorkerDeleteError(pinned));
    }
    const disabled = await disableExecutionWorkerMutation(db, deviceId, observedAt);
    metrics = addD1MutationMetrics(metrics, disabled.metrics);
    if (!disabled.disabled) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "failed",
        reasonCode: "mutation_failed",
        metrics,
      });
      failureRecorded = true;
      return false;
    }
    if ((await countExecutionWorkerDeviceSessions(db, deviceId, observedAt)) > 0) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "blocked",
        reasonCode: "active_sessions",
        metrics,
      });
      failureRecorded = true;
      throw new WorkerConflictError(
        "Worker has active sessions; wait for them to finish before deleting it",
      );
    }
    const deleted = await db
      .prepare(
        `delete from briar_execution_worker_devices
         where id = ?
           and not exists (${executionWorkerDeviceSessionsQuery})`,
      )
      .bind(
        deviceId,
        ...executionWorkerDeviceSessionBindings(deviceId, observedAt),
      )
      .run();
    const deletionMetrics = d1MutationMetrics([deleted]);
    metrics = addD1MutationMetrics(metrics, deletionMetrics);
    if (deleted.meta.changes > 0) {
      await completeWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        metrics,
        detail: {
          bindingCount,
          disableRowsWritten: disabled.metrics.rowsWritten,
          deviceDeleteRowsWritten: deletionMetrics.rowsWritten,
        },
      });
      return true;
    }
    const existing = await db
      .prepare(`select 1 from briar_execution_worker_devices where id = ?`)
      .bind(deviceId)
      .first<number>();
    if (!existing) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "failed",
        reasonCode: "mutation_failed",
        metrics,
      });
      failureRecorded = true;
      return false;
    }
    await failWorkerHardDelete(db, context, {
      attemptCount: attempt.attemptCount,
      outcome: "blocked",
      reasonCode: "active_sessions",
      metrics,
    });
    failureRecorded = true;
    throw new WorkerConflictError(
      "Worker has active sessions; wait for them to finish before deleting it",
    );
  } catch (error) {
    if (!failureRecorded) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "failed",
        reasonCode: "mutation_failed",
        metrics,
      });
    }
    throw error;
  }
}

/**
 * Remove one project binding for an explicit unlink operation; restart and
 * update callers cannot construct this hard-delete lifecycle context.
 */
export async function unbindExecutionWorker(
  db: D1Database,
  deviceId: string,
  projectId: string,
  observedAt: string,
  lifecycle: Omit<WorkerHardDeleteContext, "deviceId" | "projectId" | "observedAt" | "operation">,
) {
  const context: WorkerHardDeleteContext = {
    ...lifecycle,
    deviceId,
    projectId,
    observedAt,
    operation: "binding_delete",
  };
  const attempt = await beginWorkerHardDelete(db, context);
  if (attempt.replayed) return true;
  let metrics: D1MutationMetrics = { rowsRead: 0, rowsWritten: 0, changes: 0 };
  let failureRecorded = false;
  try {
    const pinned = await executionWorkerPinnedUse(db, {
      deviceId,
      projectId,
      observedAt,
    });
    if (pinned) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "blocked",
        reasonCode: "active_sessions",
        metrics,
      });
      failureRecorded = true;
      throw new WorkerConflictError(pinnedWorkerDeleteError(pinned));
    }
    const deleted = await db
      .prepare(
        `delete from briar_execution_workers
         where device_id = ? and project_id = ?`,
      )
      .bind(deviceId, projectId)
      .run();
    const bindingDeleteMetrics = d1MutationMetrics([deleted]);
    metrics = addD1MutationMetrics(metrics, bindingDeleteMetrics);
    if (deleted.meta.changes < 1) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "failed",
        reasonCode: "mutation_failed",
        metrics,
      });
      failureRecorded = true;
      return false;
    }
    const remainingResult = await db
      .prepare(
        `select count(*) as bindings from briar_execution_workers
         where device_id = ?`,
      )
      .bind(deviceId)
      .all<{ bindings: number }>();
    metrics = addD1MutationMetrics(metrics, d1MutationMetrics([remainingResult]));
    const remainingBindings = remainingResult.results[0]?.bindings ?? 0;
    let followupMetrics: D1MutationMetrics;
    if (remainingBindings === 0) {
      followupMetrics = (await disableExecutionWorkerMutation(
        db,
        deviceId,
        observedAt,
      )).metrics;
    } else {
      const touched = await db
        .prepare(
          `update briar_execution_worker_devices
           set updated_at = ? where id = ?`,
        )
        .bind(observedAt, deviceId)
        .run();
      followupMetrics = d1MutationMetrics([touched]);
    }
    metrics = addD1MutationMetrics(metrics, followupMetrics);
    await completeWorkerHardDelete(db, context, {
      attemptCount: attempt.attemptCount,
      metrics,
      detail: {
        bindingDeleteRowsWritten: bindingDeleteMetrics.rowsWritten,
        remainingBindings,
        deviceStateRowsWritten: followupMetrics.rowsWritten,
      },
    });
    return true;
  } catch (error) {
    if (!failureRecorded) {
      await failWorkerHardDelete(db, context, {
        attemptCount: attempt.attemptCount,
        outcome: "failed",
        reasonCode: "mutation_failed",
        metrics,
      });
    }
    throw error;
  }
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
                  union all
                  select batch.id
                  from briar_merge_batches batch
                  join briar_execution_workers holder
                    on holder.id = batch.claimed_worker_id
                  where holder.device_id = device.id
                    and batch.claim_token_hash is not null
                    and batch.lease_expires_at > ?
                    and batch.state in (
                      'enqueueing', 'waiting_tail', 'validating',
                      'publishing', 'draining'
                    )
                ) active_work
              ) as active_sessions
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.project_id = ?
       order by worker.last_heartbeat_at desc, worker.id asc`,
    )
    .bind(observedAt, observedAt, observedAt, projectId)
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

/**
 * Resolve one exact Worker for an approved saved-Skill task. This is a
 * preflight for a helpful HTTP error; migration 0092 repeats every authority
 * check in the atomic acceptance trigger so a concurrent change fails closed.
 */
export async function availableExecutionWorkerForAgentSkill(
  db: D1Database,
  input: {
    organizationId: string;
    projectId: string;
    workerId: string;
    provider: AgentProvider;
    observedAt: string;
  },
) {
  const worker = (await listExecutionWorkers(
    db,
    input.projectId,
    input.observedAt,
  )).find((candidate) => candidate.id === input.workerId);
  if (!worker) {
    throw new WorkerConflictError("Worker not found for this project");
  }
  const device = await db
    .prepare(
      `select device.organization_id, device.owner_user_id, device.state,
              device.last_heartbeat_at,
              exists (
                select 1 from briar_organization_members membership
                where membership.organization_id = device.organization_id
                  and membership.user_id = device.owner_user_id
              ) as owner_is_member
       from briar_execution_worker_devices device
       where device.id = ?`,
    )
    .bind(worker.device_id)
    .first<{
      organization_id: string;
      owner_user_id: string;
      state: ExecutionWorkerState;
      last_heartbeat_at: string;
      owner_is_member: number;
    }>();
  if (device?.organization_id !== input.organizationId) {
    throw new WorkerConflictError("Worker is outside this organization");
  }
  if (device.owner_is_member !== 1) {
    throw new WorkerConflictError(
      "Worker owner is not a member of this organization",
    );
  }
  if (
    workerStateAt(device.last_heartbeat_at, input.observedAt, device.state) !==
      "online"
  ) {
    throw new WorkerConflictError("Worker device is not online");
  }
  if (
    worker.state !== "online" || worker.accepting_work !== 1 ||
    worker.readiness_state === "needs_attention"
  ) {
    throw new WorkerConflictError("Worker is not ready to accept Agent tasks");
  }
  if (!executionWorkerProviders(worker).includes(input.provider)) {
    throw new WorkerConflictError(
      `Worker does not support the ${input.provider} provider`,
    );
  }
  if (!(await isExecutionWorkerAllowedForProject(
    db,
    input.projectId,
    worker.id,
  ))) {
    throw new WorkerConflictError(
      "Worker is not allowed by this project's execution policy",
    );
  }
  if (
    (worker.active_sessions ?? 0) >= (worker.max_concurrent_sessions ?? 1)
  ) {
    throw new WorkerConflictError("Worker has no available execution slot");
  }
  return worker;
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
              worker.runtime_proto_json,
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
                  union all
                  select batch.id
                  from briar_merge_batches batch
                  join briar_execution_workers holder
                    on holder.id = batch.claimed_worker_id
                  where holder.device_id = device.id
                    and batch.claim_token_hash is not null
                    and batch.lease_expires_at > ?
                    and batch.state in (
                      'enqueueing', 'waiting_tail', 'validating',
                      'publishing', 'draining'
                    )
                ) active_work
              ) as active_sessions
       from briar_execution_worker_devices device
       join "user" owner on owner.id = device.owner_user_id
       left join briar_execution_workers worker
         on worker.device_id = device.id
       left join briar_teams project on project.id = worker.project_id
       where device.organization_id = ?
       order by device.last_heartbeat_at desc, device.id, project.created_at`,
    )
    .bind(observedAt, observedAt, observedAt, organizationId)
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
      runtime_proto_json: string | null;
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
    if (
      !row.worker_id ||
      !row.project_id ||
      !row.project_name ||
      !row.runtime_proto_json ||
      !row.worker_state ||
      !row.readiness_state ||
      !row.worker_heartbeat_at
    ) {
      continue;
    }
    const runtime = workerRuntimeMetadataFromStoredProtoJson(
      row.runtime_proto_json,
    );
    if (Object.keys(device.versions).length === 0) {
      device.versions = runtime.versions;
    }
    const remoteUpdates = runtime.proto.capabilities?.remoteUpdates;
    device.remoteUpdateSupported ||=
      remoteUpdates?.supported === true && remoteUpdates.protocol === 1;
    const state = workerStateAt(
      row.worker_heartbeat_at,
      observedAt,
      row.worker_state,
    );
    device.bindings.push({
      id: row.worker_id,
      projectId: row.project_id,
      projectName: row.project_name,
      agentProvider: runtime.agentProvider,
      providers: runtime.providers,
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
      `select worker.runtime_proto_json
       from briar_execution_worker_devices device
       join "user" owner on owner.id = device.owner_user_id
       left join briar_execution_workers worker
         on worker.device_id = device.id
       left join briar_teams project on project.id = worker.project_id
       where device.organization_id = ?
       order by device.last_heartbeat_at desc, device.id, project.created_at`,
    )
    .bind(organizationId)
    .all<{ runtime_proto_json: string | null }>();
  const providers = new Set<AgentProvider>();
  for (const row of result.results ?? []) {
    if (!row.runtime_proto_json) continue;
    for (
      const provider of workerRuntimeMetadataFromStoredProtoJson(
        row.runtime_proto_json,
      ).providers
    ) {
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
    db
      .prepare(
        `update briar_project_agent_task_jobs
         set status = 'failed',
             error = 'Approved Worker was removed from the project allowlist.',
             claim_token_hash = null, claimed_worker_id = null,
             claimed_at = null, lease_expires_at = null,
             completed_at = ?, updated_at = ?
         where project_id = ? and status in ('queued', 'running')
           and skill_execution_proposal_id is not null
           and ? = 'allowlist'
           and not exists (
             select 1
             from briar_project_execution_worker_allowlist allowed
             where allowed.project_id = briar_project_agent_task_jobs.project_id
               and allowed.worker_id =
                 briar_project_agent_task_jobs.preferred_worker_id
           )`,
      )
      .bind(
        input.observedAt,
        input.observedAt,
        projectId,
        input.selectionMode,
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
    db
      .prepare(
        `update briar_project_agents set designated_worker_label = ?
         where designated_worker_id in (
           select id from briar_execution_workers where device_id = ?
         )`,
      )
      .bind(label, deviceId),
    db
      .prepare(
        `update briar_channel_reply_sessions set owner_worker_label = ?
         where owner_worker_id in (
           select id from briar_execution_workers where device_id = ?
         )`,
      )
      .bind(label, deviceId),
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
 * Revalidates one member-selected runtime against the target project without
 * mutating a run. Combined channel approval uses this before creating the
 * backlog issue, so an invalid or unauthorized Worker selection cannot leave
 * an issue behind. dispatchHuntRun repeats the same check at the mutation
 * boundary to close the race between preflight and dispatch.
 */
export async function assertExecutionSelectionAvailable(
  db: D1Database,
  organizationId: string,
  projectId: string,
  input: {
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    workerId: string | null;
    observedAt: string;
  },
) {
  if (input.workerId) {
    const worker = await db
      .prepare(
        `select worker.runtime_proto_json, worker.state,
                worker.accepting_work, worker.readiness_state,
                worker.last_heartbeat_at
         from briar_execution_workers worker
         join briar_execution_worker_devices device on device.id = worker.device_id
         where worker.id = ? and worker.project_id = ?
           and device.organization_id = ?`,
      )
      .bind(input.workerId, projectId, organizationId)
      .first<{
        runtime_proto_json: string;
        state: ExecutionWorkerState;
        accepting_work: number;
        readiness_state: ExecutionWorkerReadiness;
        last_heartbeat_at: string;
      }>();
    if (!worker) throw new WorkerConflictError("Worker not found for this project");
    if (
      workerStateAt(worker.last_heartbeat_at, input.observedAt, worker.state) !==
        "online" ||
      worker.accepting_work !== 1 ||
      worker.readiness_state === "needs_attention"
    ) {
      throw new WorkerConflictError("Worker is not ready to accept work");
    }
    if (
      !executionWorkerSupportsSelection(
        worker,
        input.provider,
        input.model,
        input.effort,
      )
    ) {
      throw new WorkerConflictError(
        input.model || input.effort
          ? `Worker does not support ${input.provider}${input.model ? ` model ${input.model}` : ""}${input.effort ? ` with ${input.effort} effort` : ""}`
          : `Worker does not support the ${input.provider} provider`,
      );
    }
    if (
      !(await isExecutionWorkerAllowedForProject(db, projectId, input.workerId))
    ) {
      throw new WorkerConflictError(
        "Worker is not allowed by this project's execution policy",
      );
    }
    return;
  }

  const eligible = await db
    .prepare(
      `select worker.id, worker.runtime_proto_json,
              worker.state, worker.last_heartbeat_at
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.project_id = ? and device.organization_id = ?
         and worker.state != 'disabled'
         and worker.accepting_work = 1
         and worker.readiness_state != 'needs_attention'
         and exists (
           select 1
           from briar_execution_worker_healthy_providers healthy
           where healthy.worker_id = worker.id
             and healthy.provider = ?
         )
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
       limit 100`,
    )
    .bind(projectId, organizationId, input.provider)
    .all<Pick<
      ExecutionWorkerRow,
      | "id"
      | "runtime_proto_json"
      | "state"
      | "last_heartbeat_at"
    >>();
  if (!eligible.results.some((worker) =>
    workerStateAt(
      worker.last_heartbeat_at,
      input.observedAt,
      worker.state,
    ) === "online" && executionWorkerSupportsSelection(
      worker,
      input.provider,
      input.model,
      input.effort,
    )
  )) {
    throw new WorkerConflictError(
      input.model || input.effort
        ? `No Worker supports ${input.provider}${input.model ? ` model ${input.model}` : ""}${input.effort ? ` with ${input.effort} effort` : ""}`
        : `No Worker is configured for the ${input.provider} provider`,
    );
  }
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
  // Idempotency is checked before mutable eligibility, dependency, Agent, or
  // Worker state. A committed dispatch remains the same committed dispatch
  // even if one of those inputs changes before the HTTP retry arrives.
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
    if (existing.id !== input.runId) {
      throw new WorkerConflictError("Dispatch request belongs to another run");
    }
    const existingProvider = existing.requested_agent_provider;
    if (!existingProvider) {
      throw new WorkerConflictError("Committed dispatch has no provider snapshot");
    }
    return {
      runId: existing.id,
      agentId: existing.agent_id,
      provider: existingProvider,
      model: existing.requested_agent_model,
      effort: existing.requested_agent_effort,
      requestedWorkerId: existing.requested_worker_id,
      requestedByUserId: existing.requested_by_user_id,
      dispatchMode: existing.dispatch_mode,
      dispatchedAt: existing.dispatched_at,
      outcome: "already_dispatched",
    };
  }

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

  await assertExecutionSelectionAvailable(db, organizationId, projectId, {
    provider,
    model,
    effort,
    workerId: input.workerId ?? null,
    observedAt: input.occurredAt,
  });

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
  const dispatchMode = input.workerId ? "specific" : "any";
  const auditDetail = JSON.stringify({
    previousWorkerId: run.worker_id,
    provider,
    model,
    effort,
    dispatchMode,
  });
  const [dispatchUpdate] = await db.batch([
    db
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
           and status not in ('completed', 'cancelled')
         returning id`,
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
        dispatchMode,
        input.requestId,
        input.occurredAt,
        nextAttempt,
        detail,
        input.occurredAt,
        input.occurredAt,
        input.runId,
        projectId,
      ),
    db
      .prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         )
         select ?, ?, ?, run.id, ?, ?, ?, null, ?, ?, ?, ?
         from briar_hunt_runs run
         where run.id = ? and run.project_id = ?
           and run.dispatch_request_id = ? and run.dispatched_at = ?
           and run.requested_by_user_id = ?
         on conflict do nothing`,
      )
      .bind(
        crypto.randomUUID(),
        organizationId,
        projectId,
        input.workerId ?? null,
        agent?.id ?? null,
        input.requestedByUserId,
        action,
        input.requestId,
        auditDetail,
        input.occurredAt,
        input.runId,
        projectId,
        input.requestId,
        input.occurredAt,
        input.requestedByUserId,
      ),
  ]);
  if (!dispatchUpdate.results[0]) {
    throw new WorkerConflictError("Run dispatch raced with another update");
  }
  return {
    runId: input.runId,
    agentId: agent?.id ?? null,
    provider,
    model,
    effort,
    requestedWorkerId: input.workerId ?? null,
    requestedByUserId: input.requestedByUserId,
    dispatchMode,
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
      `select id, source_key, status, current_attempt, claim_token_hash,
              worker_id, requested_worker_id, dispatch_request_id
       from briar_hunt_runs where id = ? and project_id = ?`,
    )
    .bind(input.runId, projectId)
    .first<{
      id: string;
      source_key: string;
      status: string;
      current_attempt: number;
      claim_token_hash: string | null;
      worker_id: string | null;
      requested_worker_id: string | null;
      dispatch_request_id: string | null;
    }>();
  if (!run) return null;
  if (["completed", "cancelled"].includes(run.status)) {
    throw new WorkerConflictError("Completed or cancelled runs cannot be unassigned");
  }
  if (!run.worker_id && !run.requested_worker_id && !run.dispatch_request_id) {
    return { runId: input.runId, outcome: "not_assigned" as const };
  }
  const channelApproved = await isChannelApprovedIssue(db, run);
  const conversationalExecutionApproved = Boolean(
    run.dispatch_request_id && await db
      .prepare(
        `select 1 as approved
         where exists (
           select 1 from briar_issue_execution_proposals proposal
           where proposal.target_run_id = ? and proposal.project_id = ?
             and proposal.dispatch_request_id = ?
         ) or exists (
           select 1 from briar_issue_execution_approval_audit approval
           where approval.run_id = ? and approval.project_id = ?
             and approval.dispatch_request_id = ?
         )`,
      )
      .bind(
        run.id,
        projectId,
        run.dispatch_request_id,
        run.id,
        projectId,
        run.dispatch_request_id,
      )
      .first<{ approved: number }>(),
  );
  const resetExecutionApproval =
    channelApproved || conversationalExecutionApproved ? 1 : 0;
  const nextAttempt = run.claim_token_hash ? run.current_attempt + 1 : run.current_attempt;
  const detail = resetExecutionApproval
    ? "사용자가 Worker 배정을 취소했습니다. 다시 실행하려면 명시적인 승인이 필요합니다."
    : "사용자가 Worker 배정을 취소했습니다.";
  const auditDetail = JSON.stringify({
    previousWorkerId: run.worker_id,
    previousRequestedWorkerId: run.requested_worker_id,
    reason: "user_unassigned",
    executionApprovalReset: Boolean(resetExecutionApproval),
  });
  const [unassignUpdate, auditInsert] = await db.batch([
    db.prepare(
      `update briar_hunt_runs
       set requested_worker_id = null, requested_by_user_id = null,
           dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
           requested_agent_provider = case when ? = 1 then null else requested_agent_provider end,
           requested_agent_model = case when ? = 1 then null else requested_agent_model end,
           requested_agent_effort = case when ? = 1 then null else requested_agent_effort end,
           agent_id = case when ? = 1 then null else agent_id end,
           worker_id = null, claim_token_hash = null, claimed_by = null,
           claimed_at = null, lease_expires_at = null,
           last_execution_id = case when ? = 1 then null else last_execution_id end,
           claim_attempts = case when ? = 1 then 0 else claim_attempts end,
           status = case when ? = 1 then 'backlog' else 'queued' end,
           stage = 'queued', workflow_stage = null,
           current_attempt = ?, current_revision = 1, paused_at = null,
           resume_requested_at = null, completed_at = null,
           detail = ?, last_event_at = ?, updated_at = ?
       where id = ? and project_id = ? and status not in ('completed', 'cancelled')
         and (
           worker_id is not null or requested_worker_id is not null
           or dispatch_request_id is not null
         )
         and not exists (
           select 1 from briar_execution_audit_events audit
           where audit.project_id = ? and audit.action = 'requeued'
             and audit.request_id = ?
         )
       returning id`,
    )
    .bind(
      resetExecutionApproval,
      resetExecutionApproval,
      resetExecutionApproval,
      resetExecutionApproval,
      resetExecutionApproval,
      resetExecutionApproval,
      resetExecutionApproval,
      nextAttempt,
      detail,
      input.occurredAt,
      input.occurredAt,
      input.runId,
      projectId,
      projectId,
      input.requestId,
    ),
    db.prepare(
      `insert into briar_execution_audit_events (
         id, organization_id, project_id, run_id, worker_id, agent_id,
         actor_user_id, actor_device_id, action, request_id, detail_json,
         occurred_at
       )
       select ?, ?, ?, current.id, ?, null, ?, null, 'requeued', ?, ?, ?
       from briar_hunt_runs current
       where changes() = 1
         and current.id = ? and current.project_id = ?
         and current.status = ? and current.worker_id is null
         and current.requested_worker_id is null
         and current.dispatch_request_id is null
         and current.last_event_at = ? and current.updated_at = ?
       returning id`,
    ).bind(
      crypto.randomUUID(),
      organizationId,
      projectId,
      run.worker_id,
      input.requestedByUserId,
      input.requestId,
      auditDetail,
      input.occurredAt,
      input.runId,
      projectId,
      resetExecutionApproval ? "backlog" : "queued",
      input.occurredAt,
      input.occurredAt,
    ),
  ]);
  if (!unassignUpdate.results[0]) {
    throw new WorkerConflictError("Worker assignment changed before it could be cancelled");
  }
  if (!auditInsert.results[0]) {
    throw new WorkerConflictError("Worker unassignment audit was not recorded");
  }
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

const executionWorkerDeviceSessionsQuery = `
         select run.id
         from briar_hunt_runs run
         join briar_execution_workers worker on worker.id = run.worker_id
         where worker.device_id = ?
           and run.claim_token_hash is not null
           and run.lease_expires_at is not null
           and run.lease_expires_at > ?
           and run.status not in (
             'backlog', 'completed', 'cancelled', 'blocked', 'failed'
           )
         union all
         select task.id
         from briar_project_agent_task_jobs task
         join briar_execution_workers worker
           on worker.id = task.claimed_worker_id
         where worker.device_id = ? and task.status = 'running'
           and task.lease_expires_at > ?
         union all
         select batch.id
         from briar_merge_batches batch
         join briar_execution_workers worker
           on worker.id = batch.claimed_worker_id
         where worker.device_id = ?
           and batch.claim_token_hash is not null
           and batch.lease_expires_at > ?
           and batch.state in (
             'enqueueing', 'waiting_tail', 'validating', 'publishing', 'draining'
           )
         union all
         select reply.id
         from briar_issue_agent_reply_jobs reply
         join briar_execution_workers worker
           on worker.id = reply.claimed_worker_id
         where worker.device_id = ? and reply.status = 'running'
           and reply.lease_expires_at > ?
         union all
         select reply.id
         from briar_channel_agent_reply_jobs reply
         join briar_execution_workers worker
           on worker.id = reply.claimed_worker_id
         where worker.device_id = ? and reply.status = 'running'
           and reply.lease_expires_at > ?
`;

const executionWorkerDeviceSessionBindings = (
  deviceId: string,
  observedAt: string,
) => [
  deviceId,
  observedAt,
  deviceId,
  observedAt,
  deviceId,
  observedAt,
  deviceId,
  observedAt,
  deviceId,
  observedAt,
];

/** Return all live Worker leases on one device, including reply work. */
export async function countExecutionWorkerDeviceSessions(
  db: D1Database,
  deviceId: string,
  observedAt: string,
) {
  const row = await db
    .prepare(
      `select count(*) as active_sessions
       from (${executionWorkerDeviceSessionsQuery}) active_work`,
    )
    .bind(...executionWorkerDeviceSessionBindings(deviceId, observedAt))
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
       set lease_expires_at = ?
       where id = ? and project_id = ? and claim_token_hash = ?
         and (? is null or worker_id = ?)
         and status not in ('completed', 'cancelled')
       returning id, lease_expires_at`,
    )
    .bind(
      leaseExpiresAt,
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
       join briar_teams project on project.id = run.project_id
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
