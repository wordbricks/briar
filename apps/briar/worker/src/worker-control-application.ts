import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { compareSemanticVersions, isSemanticVersion } from "../../src/lib/semantic-version";
import { getTeamSettings } from "./team-settings-repository";
import { pendingExecutionWorkerUpdate } from "./worker-update-repository";
import { recordPreservedWorkerBinding } from "./worker-lifecycle-repository";
import type { AuthenticatedWorkerPrincipal } from "./worker-route-auth";
import { workerRuntimeMetadataFromStoredProtoJson, type WorkerRuntimeMetadata } from "./worker-runtime-mappers";
import {
  auditExecutionEvent,
  completeExecutionWorkerUpdates,
  executionWorkerBindingById,
  executionWorkerUpdateStatus,
  failExecutionWorkerUpdate,
  hasExecutionWorkerReadinessChanged,
  PLANNED_UPDATE_HANDOFF_READINESS_DETAIL,
  reapStalledHuntRuns,
  recordWorkerHeartbeat,
  requestExecutionWorkerUpdate,
  restoreExecutionWorkersAfterUpdate,
  updateExecutionWorkerLabel,
  workerStateAt,
} from "./workers";

export type WorkerControlApplicationErrorReason =
  | "invalid_input"
  | "worker_disabled"
  | "worker_forbidden";

export class WorkerControlApplicationError extends Error {
  constructor(
    readonly reason: WorkerControlApplicationErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "WorkerControlApplicationError";
  }
}

const invalid = (message: string): never => {
  throw new WorkerControlApplicationError("invalid_input", message);
};

const enabledBinding = async (input: {
  db: D1Database;
  principal: AuthenticatedWorkerPrincipal;
  workerId: string;
}) => {
  const binding = await executionWorkerBindingById(
    input.db,
    input.principal.deviceId,
    input.workerId,
  );
  if (!binding || binding.state === "disabled") {
    throw new WorkerControlApplicationError(
      "worker_forbidden",
      "Worker is not enabled for this project",
    );
  }
  return binding;
};

export async function prepareWorkerUpdateHandoffApplication(input: {
  db: D1Database;
  principal: AuthenticatedWorkerPrincipal;
  workerId: string;
  targetVersion: string;
  requiresRuntimeAck?: boolean;
  requestId?: string;
  observedAt: string;
}) {
  await enabledBinding(input);
  if (!isSemanticVersion(input.targetVersion)) {
    invalid("Worker update target must be a semantic version");
  }
  if (input.requestId && !/^[0-9a-f-]{36}$/iu.test(input.requestId)) invalid("Invalid update request ID");
  const existing = await pendingExecutionWorkerUpdate(input.db, input.principal.deviceId);
  if (input.requestId && existing && existing.id !== input.requestId) invalid("A different update is already pending");
  const update = await requestExecutionWorkerUpdate(input.db, {
    id: input.requestId ?? crypto.randomUUID(),
    organizationId: input.principal.organizationId,
    deviceId: input.principal.deviceId,
    requestedByUserId: input.principal.ownerUserId,
    targetVersion: input.targetVersion,
    requestedAt: input.observedAt,
    requiresRuntimeAck: input.requiresRuntimeAck,
  });
  const status = await executionWorkerUpdateStatus(input.db, {
    deviceId: input.principal.deviceId,
    requestId: update.id,
    observedAt: input.observedAt,
  });
  return {
    update: status?.request ?? update,
    activeWorkCount: status?.activeWorkCount ?? 0,
    ready: status?.ready ?? false,
  };
}

export async function getWorkerUpdateHandoffApplication(input: {
  db: D1Database;
  principal: AuthenticatedWorkerPrincipal;
  workerId: string;
  requestId?: string;
  observedAt: string;
}) {
  await enabledBinding(input);
  if (input.requestId !== undefined && !/^[0-9a-f-]{36}$/iu.test(input.requestId)) {
    invalid("Worker update request ID is invalid");
  }
  const status = await executionWorkerUpdateStatus(input.db, {
    deviceId: input.principal.deviceId,
    requestId: input.requestId,
    observedAt: input.observedAt,
  });
  return {
    ...(status ?? { request: null, activeWorkCount: 0, ready: true }),
    runtimes: await workerUpdateRuntimes(input.db, input.principal.deviceId),
  };
}

async function workerUpdateRuntimes(db: D1Database, deviceId: string) {
  const rows = await db.prepare(
    `select id, runtime_proto_json, last_heartbeat_at
     from briar_execution_workers where device_id = ? and state <> 'disabled'`,
  ).bind(deviceId).all<{
    id: string; runtime_proto_json: string; last_heartbeat_at: string;
  }>();
  return rows.results.map((row) => ({
    workerId: row.id,
    runtime: workerRuntimeMetadataFromStoredProtoJson(row.runtime_proto_json).proto,
    lastHeartbeatAt: row.last_heartbeat_at,
  }));
}

export async function finishWorkerUpdateApplication(input: {
  db: D1Database;
  principal: AuthenticatedWorkerPrincipal;
  workerId: string;
  requestId: string;
  cancel: boolean;
  error?: string;
  observedAt: string;
}) {
  await enabledBinding(input);
  if (!/^[0-9a-f-]{36}$/iu.test(input.requestId)) invalid("Invalid update request ID");
  if ((input.error?.length ?? 0) > 2_000) invalid("Update error is too long");
  const status = await executionWorkerUpdateStatus(input.db, {
    deviceId: input.principal.deviceId,
    requestId: input.requestId,
    observedAt: input.observedAt,
  });
  if (!status?.request.requiresRuntimeAck) return invalid("Not a sandbox runtime update");
  const terminalStatus = input.cancel ? "cancelled" : "completed";
  if (status.request.status === terminalStatus) return {};
  if (status.request.status !== "requested") invalid("Update is already finished");
  if (!input.cancel) {
    if (!status.ready || status.activeWorkCount !== 0) invalid("Update handoff is not ready");
    const runtimes = await workerUpdateRuntimes(input.db, input.principal.deviceId);
    if (runtimes.length === 0 || runtimes.some(({ runtime, lastHeartbeatAt }) => {
      const version = runtime.versions.briar;
      return runtime.updateRequestId !== input.requestId ||
        lastHeartbeatAt < (status.request.handoffCompletedAt ?? status.request.requestedAt) ||
        !version || !isSemanticVersion(version) ||
        compareSemanticVersions(version, status.request.targetVersion) < 0 ||
        !runtime.providerHealth.some((provider) => provider.healthy);
    })) invalid("Every sandbox worker must report the new healthy runtime first");
  }
  const finished = await input.db.prepare(
    `update briar_execution_worker_update_requests
     set status = ?, handoff_error = ?, completed_at = ?, updated_at = ?,
         handoff_state = case when ? then 'failed' else handoff_state end
     where id = ? and device_id = ? and status = 'requested'`,
  ).bind(
    terminalStatus, input.error ?? null, input.observedAt, input.observedAt, input.cancel && Boolean(input.error) ? 1 : 0,
    input.requestId, input.principal.deviceId,
  ).run();
  // Cancels and failures leave the device drained on purpose; only a completed
  // update undoes the drain it caused.
  if (terminalStatus === "completed" && finished.meta.changes > 0) {
    await restoreExecutionWorkersAfterUpdate(
      input.db,
      input.principal.deviceId,
      input.observedAt,
    );
  }
  return {};
}

export async function failWorkerUpdateHandoffApplication(input: {
  db: D1Database;
  principal: AuthenticatedWorkerPrincipal;
  workerId: string;
  requestId: string;
  error: string;
  observedAt: string;
}) {
  await enabledBinding(input);
  if (!/^[0-9a-f-]{36}$/iu.test(input.requestId)) {
    invalid("Worker update request ID is invalid");
  }
  const error = input.error.trim();
  if (error.length < 1 || error.length > 2_000) {
    invalid("Worker update error must be 1-2000 characters");
  }
  await failExecutionWorkerUpdate(input.db, {
    requestId: input.requestId,
    organizationId: input.principal.organizationId,
    deviceId: input.principal.deviceId,
    error,
    observedAt: input.observedAt,
  });
  return {};
}

export async function updateWorkerLabelApplication(input: {
  db: D1Database;
  principal: AuthenticatedWorkerPrincipal;
  workerId: string;
  label: string;
  observedAt: string;
}) {
  await enabledBinding(input);
  const label = input.label.trim();
  if (label.length < 1 || label.length > 100) {
    invalid("Worker label must be 1-100 characters");
  }
  const device = await updateExecutionWorkerLabel(
    input.db,
    input.principal.deviceId,
    label,
    input.observedAt,
  );
  if (!device) {
    throw new WorkerControlApplicationError(
      "worker_disabled",
      "Worker is disabled",
    );
  }
  return device;
}

export async function heartbeatWorkerApplication(input: {
  db: D1Database;
  principal: AuthenticatedWorkerPrincipal;
  workerId: string;
  runtime: WorkerRuntimeMetadata;
  refreshMaintenance: boolean;
  acceptingWork: boolean;
  readinessState: "ready" | "busy" | "needs_attention";
  readinessDetail?: string;
  observedAt: string;
}) {
  const binding = await enabledBinding(input);
  if (input.readinessDetail !== undefined && input.readinessDetail.length > 500) {
    invalid("Worker readiness detail must contain at most 500 characters");
  }
  const pendingBeforeHeartbeat = await pendingExecutionWorkerUpdate(
    input.db,
    input.principal.deviceId,
  );
  const updateDirective = await completeExecutionWorkerUpdates(
    input.db,
    input.principal.deviceId,
    input.runtime.versions.briar,
    input.observedAt,
    pendingBeforeHeartbeat,
  );
  const updateIsPending = updateDirective !== null && updateDirective.handoffState !== "idle";
  const updateFailed = updateDirective?.handoffState === "failed";
  const worker = await recordWorkerHeartbeat(input.db, binding.project_id, {
    workerId: input.workerId,
    knownBinding: binding,
    runtime: input.runtime,
    acceptingWork: updateIsPending ? false : input.acceptingWork,
    readinessState: updateFailed
      ? "needs_attention"
      : updateIsPending
        ? "busy"
        : input.readinessState,
    readinessDetail: updateFailed
      ? "원격 런타임 업데이트에 실패했습니다."
      : updateIsPending
        ? PLANNED_UPDATE_HANDOFF_READINESS_DETAIL
        : input.readinessDetail ?? null,
    observedAt: input.observedAt,
  });
  if (
    !pendingBeforeHeartbeat &&
    workerStateAt(
      binding.last_heartbeat_at,
      input.observedAt,
      binding.state,
    ) === "stale"
  ) {
    await recordPreservedWorkerBinding(input.db, {
      requestId: `worker-restart:${binding.id}:${binding.last_heartbeat_at}`,
      organizationId: input.principal.organizationId,
      projectId: binding.project_id,
      deviceId: input.principal.deviceId,
      workerId: binding.id,
      reason: "restart",
      observedAt: input.observedAt,
      detail: {
        bindingPreserved: true,
        detection: "heartbeat_after_stale",
      },
    }).catch(() => {
      console.error(JSON.stringify({
        message: "Execution Worker restart lifecycle telemetry failed",
        deviceId: input.principal.deviceId,
        workerId: binding.id,
      }));
    });
  }
  if (hasExecutionWorkerReadinessChanged(binding, worker)) {
    await auditExecutionEvent(input.db, {
      organizationId: input.principal.organizationId,
      projectId: binding.project_id,
      workerId: binding.id,
      actorDeviceId: input.principal.deviceId,
      action: "worker_readiness_changed",
      detail: {
        acceptingWork: worker.accepting_work === 1,
        readinessState: worker.readiness_state,
        readinessDetail: worker.readiness_detail,
      },
      occurredAt: input.observedAt,
    });
  }
  let workflowRequirements:
    | ReturnType<typeof normalizeAutoHuntWorkflow>["requirements"]
    | undefined;
  if (input.refreshMaintenance) {
    const [, projectSettings] = await Promise.all([
      reapStalledHuntRuns(input.db, binding.project_id, input.observedAt),
      getTeamSettings(input.db, binding.project_id),
    ]);
    const projectWorkflow = projectSettings?.workflow_json
      ? normalizeAutoHuntWorkflow(JSON.parse(projectSettings.workflow_json))
      : null;
    workflowRequirements = projectWorkflow?.requirements ?? [];
  }
  return { worker, workflowRequirements, updateDirective };
}
