import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  DashboardWorker_State,
  type DashboardWorker,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  ExecutionWorkerHandoffState,
  ExecutionWorkerUpdateStatus,
  FleetService,
  UnbindProjectExecutionWorkerRequest_Reason,
  type ExecutionWorkerUpdateRequestState,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import {
  WorkerControlService,
  WorkerReadinessState,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  autoHuntRequirementKinds,
  type AutoHuntWorkflowRequirement,
} from "../src/lib/auto-hunt-contract";
import {
  workerRuntimeToProto,
  type WorkerRuntimeInput,
} from "../src/lib/worker-runtime-proto";
import { createAuthenticatedConnectClient } from "./connect-client";
import type { WorkerLoopUpdateDirective } from "./worker";

export { workerRuntimeToProto, type WorkerRuntimeInput };

const requiredTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => {
  if (!value) throw new Error(`Worker RPC omitted ${field}`);
  const date = timestampDate(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Worker RPC returned invalid ${field}`);
  }
  return date.toISOString();
};

const workerState = (value: DashboardWorker_State) => {
  switch (value) {
    case DashboardWorker_State.ONLINE:
      return "online" as const;
    case DashboardWorker_State.STALE:
      return "stale" as const;
    case DashboardWorker_State.DISABLED:
      return "disabled" as const;
    default:
      throw new Error(`Unknown Worker state: ${value}`);
  }
};

const enrollmentWorker = (worker: DashboardWorker | undefined) => {
  if (!worker) throw new Error("Fleet RPC omitted worker");
  return {
    id: worker.id,
    label: worker.label,
    state: workerState(worker.state),
    maxConcurrentSessions: worker.maxConcurrentSessions,
    lastHeartbeatAt: requiredTimestamp(
      worker.lastHeartbeatAt,
      "worker.lastHeartbeatAt",
    ),
  };
};

const updateState = (value: ExecutionWorkerUpdateRequestState | undefined) => {
  if (!value) return null;
  const status = (() => {
    switch (value.status) {
      case ExecutionWorkerUpdateStatus.REQUESTED:
        return "requested" as const;
      case ExecutionWorkerUpdateStatus.COMPLETED:
        return "completed" as const;
      case ExecutionWorkerUpdateStatus.CANCELLED:
        return "cancelled" as const;
      default:
        throw new Error(`Unknown Worker update status: ${value.status}`);
    }
  })();
  const handoffState = (() => {
    switch (value.handoffState) {
      case ExecutionWorkerHandoffState.IDLE:
        return "idle" as const;
      case ExecutionWorkerHandoffState.DRAINING:
        return "draining" as const;
      case ExecutionWorkerHandoffState.READY:
        return "ready" as const;
      case ExecutionWorkerHandoffState.FAILED:
        return "failed" as const;
      default:
        throw new Error(`Unknown Worker update handoff state: ${value.handoffState}`);
    }
  })();
  return {
    id: value.id,
    targetVersion: value.targetVersion,
    status,
    requestedAt: requiredTimestamp(value.requestedAt, "update.requestedAt"),
    handoffState,
    handoffError: value.handoffError ?? null,
  };
};

const updateDirective = (
  value: ExecutionWorkerUpdateRequestState | undefined,
): WorkerLoopUpdateDirective | null => {
  const update = updateState(value);
  if (update?.status !== "requested") return null;
  return {
    id: update.id,
    targetVersion: update.targetVersion,
    status: "requested",
    requestedAt: update.requestedAt,
    handoffState: update.handoffState,
  };
};

const workflowRequirement = (value: {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly tool: string;
  readonly reason: string;
}): AutoHuntWorkflowRequirement => {
  if (!(autoHuntRequirementKinds as readonly string[]).includes(value.kind)) {
    throw new Error(`Unknown workflow requirement kind: ${value.kind}`);
  }
  return {
    id: value.id,
    label: value.label,
    kind: value.kind as AutoHuntWorkflowRequirement["kind"],
    tool: value.tool,
    reason: value.reason,
  };
};

export function createWorkerEnrollmentClient(apiUrl: string, token: string) {
  const client = createAuthenticatedConnectClient(
    FleetService,
    apiUrl,
    token,
    { binary: true },
  );
  return {
    register: async (input: {
      projectId: string;
      label: string;
      deviceIdentity: string;
      runtime: WorkerRuntimeInput;
      maxConcurrentSessions?: number;
    }) => {
      const response = await client.registerProjectExecutionWorker({
        projectId: input.projectId,
        label: input.label,
        deviceIdentity: input.deviceIdentity,
        runtime: workerRuntimeToProto(input.runtime),
        maxConcurrentSessions: input.maxConcurrentSessions,
      });
      return {
        organizationId: response.organizationId,
        deviceId: response.deviceId,
        worker: enrollmentWorker(response.worker),
        workerToken: response.workerToken,
      };
    },
    bind: async (input: {
      projectId: string;
      deviceIdentity: string;
      runtime: WorkerRuntimeInput;
    }) => {
      const response = await client.bindProjectExecutionWorker({
        projectId: input.projectId,
        deviceIdentity: input.deviceIdentity,
        runtime: workerRuntimeToProto(input.runtime),
      });
      return {
        organizationId: response.organizationId,
        deviceId: response.deviceId,
        worker: enrollmentWorker(response.worker),
      };
    },
    unbind: (input: {
      projectId: string;
      workerId: string;
      requestId: string;
      reason: "explicit_user_unlink" | "managed_deprovision";
    }) => client.unbindProjectExecutionWorker({
      projectId: input.projectId,
      workerId: input.workerId,
      requestId: input.requestId,
      reason: input.reason === "managed_deprovision"
        ? UnbindProjectExecutionWorkerRequest_Reason.MANAGED_DEPROVISION
        : UnbindProjectExecutionWorkerRequest_Reason.EXPLICIT_USER_UNLINK,
    }),
  };
}

export function createWorkerControlClient(apiUrl: string, token: string) {
  const client = createAuthenticatedConnectClient(
    WorkerControlService,
    apiUrl,
    token,
    { binary: true },
  );
  return {
    heartbeat: async (input: {
      workerId: string;
      runtime: WorkerRuntimeInput;
      refreshMaintenance?: boolean;
      acceptingWork: boolean;
      readinessState: "ready" | "busy" | "needs_attention";
      readinessDetail?: string | null;
    }) => {
      const readiness = {
        ready: WorkerReadinessState.READY,
        busy: WorkerReadinessState.BUSY,
        needs_attention: WorkerReadinessState.NEEDS_ATTENTION,
      } as const;
      const response = await client.heartbeatWorker({
        workerId: input.workerId,
        runtime: workerRuntimeToProto(input.runtime),
        refreshMaintenance: input.refreshMaintenance ?? false,
        acceptingWork: input.acceptingWork,
        readinessState: readiness[input.readinessState],
        readinessDetail: input.readinessDetail ?? undefined,
      });
      if (!response.worker) throw new Error("Worker heartbeat omitted worker");
      return {
        maxConcurrentSessions: response.worker.maxConcurrentSessions,
        updateDirective: updateDirective(response.updateDirective),
        workflowRequirements: response.workflowRequirements.map(
          workflowRequirement,
        ),
      };
    },
    updateLabel: (workerId: string, label: string) =>
      client.updateWorkerLabel({ workerId, label }),
    prepareUpdateHandoff: async (workerId: string, targetVersion: string) => {
      const response = await client.prepareWorkerUpdateHandoff({
        workerId,
        targetVersion,
      });
      const update = updateDirective(response.update);
      if (!update) throw new Error("Worker handoff did not return a pending update");
      return { ...response, update };
    },
    getUpdateHandoff: async (workerId: string, requestId?: string) => {
      const response = await client.getWorkerUpdateHandoff({
        workerId,
        requestId,
      });
      return {
        activeWorkCount: response.activeWorkCount,
        ready: response.ready,
        update: updateState(response.update),
      };
    },
    failUpdateHandoff: (workerId: string, requestId: string, error: string) =>
      client.failWorkerUpdateHandoff({ workerId, requestId, error }),
  };
}
