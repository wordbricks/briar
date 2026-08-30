import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { isSemanticVersion } from "../../src/lib/semantic-version";
import { getProjectSettings } from "./project-settings-repository";
import { pendingExecutionWorkerUpdate } from "./worker-update-repository";
import { recordPreservedWorkerBinding } from "./worker-lifecycle-repository";
import type { AuthenticatedWorkerPrincipal } from "./worker-route-auth";
import type { WorkerRuntimeMetadata } from "./worker-runtime-mappers";
import {
  auditExecutionEvent,
  completeExecutionWorkerUpdates,
  executionWorkerBindingById,
  executionWorkerUpdateStatus,
  failExecutionWorkerUpdate,
  hasExecutionWorkerReadinessChanged,
  reapStalledHuntRuns,
  recordWorkerHeartbeat,
  requestExecutionWorkerUpdate,
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
  observedAt: string;
}) {
  await enabledBinding(input);
  if (!isSemanticVersion(input.targetVersion)) {
    invalid("Worker update target must be a semantic version");
  }
  const update = await requestExecutionWorkerUpdate(input.db, {
    id: crypto.randomUUID(),
    organizationId: input.principal.organizationId,
    deviceId: input.principal.deviceId,
    requestedByUserId: input.principal.ownerUserId,
    targetVersion: input.targetVersion,
    requestedAt: input.observedAt,
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
  return status ?? { request: null, activeWorkCount: 0, ready: true };
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
  const updateIsPending = updateDirective !== null;
  const updateFailed = updateDirective?.handoffState === "failed";
  const worker = await recordWorkerHeartbeat(input.db, binding.project_id, {
    workerId: input.workerId,
    knownBinding: binding,
    versions: input.runtime.versions,
    acceptingWork: updateIsPending ? false : input.acceptingWork,
    readinessState: updateFailed
      ? "needs_attention"
      : updateIsPending
        ? "busy"
        : input.readinessState,
    readinessDetail: updateFailed
      ? "원격 런타임 업데이트에 실패했습니다."
      : updateIsPending
        ? "계획된 업데이트 handoff를 진행 중입니다."
        : input.readinessDetail,
    capabilities: input.runtime.capabilities,
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
      getProjectSettings(input.db, binding.project_id),
    ]);
    const projectWorkflow = projectSettings?.workflow_json
      ? normalizeAutoHuntWorkflow(JSON.parse(projectSettings.workflow_json))
      : null;
    workflowRequirements = projectWorkflow?.requirements ?? [];
  }
  return { worker, workflowRequirements, updateDirective };
}
