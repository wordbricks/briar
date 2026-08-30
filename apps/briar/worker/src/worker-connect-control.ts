import {
  WorkerControlService,
  WorkerReadinessState,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { withConnectErrors } from "./app-connect-errors";
import { appExecutionWorkerUpdateRequestState } from "./app-connect-fleet-mappers";
import { appDashboardWorker } from "./app-connect-mappers";
import { HttpError } from "./http-response";
import {
  failWorkerUpdateHandoffApplication,
  getWorkerUpdateHandoffApplication,
  heartbeatWorkerApplication,
  prepareWorkerUpdateHandoffApplication,
  updateWorkerLabelApplication,
  WorkerControlApplicationError,
} from "./worker-control-application";
import { workerJson } from "./worker-json";
import { requireWorkerCredential } from "./worker-route-auth";
import {
  workerRuntimeMetadataFromProto,
  WorkerRuntimeValidationError,
} from "./worker-runtime-mappers";
import { WorkerConflictError } from "./workers";

export type WorkerConnectControlInput = {
  readonly request: Request;
  readonly db: D1Database;
};

const workerId = (value: string) => {
  const decoded = value.trim();
  if (decoded.length < 1 || decoded.length > 128) {
    throw new HttpError(400, "Worker ID is invalid");
  }
  return decoded;
};

const readinessState = (value: WorkerReadinessState) => {
  switch (value) {
    case WorkerReadinessState.READY:
      return "ready" as const;
    case WorkerReadinessState.BUSY:
      return "busy" as const;
    case WorkerReadinessState.NEEDS_ATTENTION:
      return "needs_attention" as const;
    case WorkerReadinessState.UNSPECIFIED:
      throw new HttpError(400, "Worker readiness state is required");
    default:
      throw new HttpError(400, `Unknown Worker readiness state: ${value}`);
  }
};

const throwWorkerControlError = (error: unknown): never => {
  if (error instanceof WorkerRuntimeValidationError) {
    throw new HttpError(400, error.message);
  }
  if (error instanceof WorkerConflictError) {
    throw new HttpError(409, error.message);
  }
  if (!(error instanceof WorkerControlApplicationError)) throw error;
  switch (error.reason) {
    case "invalid_input":
      throw new HttpError(400, error.message);
    case "worker_forbidden":
      throw new HttpError(403, error.message);
    case "worker_disabled":
      throw new HttpError(409, error.message);
  }
};

const withWorkerControlErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    return throwWorkerControlError(error);
  }
};

export const createWorkerControlService = (
  { request, db }: WorkerConnectControlInput,
): ServiceImpl<typeof WorkerControlService> => ({
  heartbeatWorker: (input) => withConnectErrors(async () => {
    const principal = await requireWorkerCredential(db, request);
    const observedAt = new Date().toISOString();
    const result = await withWorkerControlErrors(heartbeatWorkerApplication({
      db,
      principal,
      workerId: workerId(input.workerId),
      runtime: workerRuntimeMetadataFromProto(input.runtime),
      refreshMaintenance: input.refreshMaintenance,
      acceptingWork: input.acceptingWork,
      readinessState: readinessState(input.readinessState),
      readinessDetail: input.readinessDetail,
      observedAt,
    }));
    return {
      worker: appDashboardWorker(workerJson(result.worker, observedAt)),
      workflowRequirements: result.workflowRequirements ?? [],
      updateDirective: result.updateDirective
        ? appExecutionWorkerUpdateRequestState(result.updateDirective)
        : undefined,
    };
  }),

  updateWorkerLabel: (input) => withConnectErrors(async () => {
    const principal = await requireWorkerCredential(db, request);
    const device = await withWorkerControlErrors(updateWorkerLabelApplication({
      db,
      principal,
      workerId: workerId(input.workerId),
      label: input.label,
      observedAt: new Date().toISOString(),
    }));
    return { deviceId: device.id, label: device.label };
  }),

  prepareWorkerUpdateHandoff: (input) => withConnectErrors(async () => {
    const principal = await requireWorkerCredential(db, request);
    const result = await withWorkerControlErrors(
      prepareWorkerUpdateHandoffApplication({
        db,
        principal,
        workerId: workerId(input.workerId),
        targetVersion: input.targetVersion,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      update: appExecutionWorkerUpdateRequestState(result.update),
      activeWorkCount: result.activeWorkCount,
      ready: result.ready,
    };
  }),

  getWorkerUpdateHandoff: (input) => withConnectErrors(async () => {
    const principal = await requireWorkerCredential(db, request);
    const result = await withWorkerControlErrors(
      getWorkerUpdateHandoffApplication({
        db,
        principal,
        workerId: workerId(input.workerId),
        requestId: input.requestId,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      update: result.request
        ? appExecutionWorkerUpdateRequestState(result.request)
        : undefined,
      activeWorkCount: result.activeWorkCount,
      ready: result.ready,
    };
  }),

  failWorkerUpdateHandoff: (input) => withConnectErrors(async () => {
    const principal = await requireWorkerCredential(db, request);
    return await withWorkerControlErrors(failWorkerUpdateHandoffApplication({
      db,
      principal,
      workerId: workerId(input.workerId),
      requestId: input.requestId,
      error: input.error,
      observedAt: new Date().toISOString(),
    }));
  }),
});

export const registerWorkerControlService = (
  router: ConnectRouter,
  input: WorkerConnectControlInput,
) => router.service(WorkerControlService, createWorkerControlService(input));
