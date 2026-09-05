import {
  type WorkerIcon,
  WorkerIcon_Kind,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  FleetService,
  ManagedComputerCurrency,
  RequestExecutionWorkerUpdateResponse_Outcome,
  UnbindProjectExecutionWorkerRequest_Reason,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import type { BriarAuth } from "./auth";

import {
  appFleetTimestamp,
  appFleetWorkerIcon,
  appManagedComputer,
  appManagedComputerEntitlement,
  appManagedComputerProduct,
  appManagedComputerPromotionLimitReason,
  appManagedComputerRemoteSession,
  appManagedComputerSetupSession,
  appManagedComputerSetupStatusSession,
  appManagedComputerSocketTicket,
  appOrganizationExecutionWorker,
} from "./app-connect-fleet-mappers";
import { appDashboardWorker } from "./app-connect-mappers";
import {
  applyForManagedComputerApplication,
  bindProjectExecutionWorkerApplication,
  createManagedComputerRemoteSessionApplication,
  createManagedComputerSetupSessionApplication,
  deleteExecutionWorkerApplication,
  endManagedComputerRemoteSessionApplication,
  FleetApplicationError,
  getManagedComputerApplication,
  getManagedComputerProductApplication,
  getManagedComputerSetupStatusApplication,
  listExecutionWorkersApplication,
  listManagedComputersApplication,
  registerProjectExecutionWorkerApplication,
  requestExecutionWorkerUpdateApplication,
  registerSandboxComputerApplication,
  retireManagedComputerApplication,
  retryManagedComputerApplication,
  unregisterSandboxComputerApplication,
  terminateManagedComputerApplication,
  unbindProjectExecutionWorkerApplication,
  updateExecutionWorkerApplication,
  validateManagedComputerPromotionApplication,
} from "./fleet-application";
import { HttpError } from "./http-response";
import {
  decodeManagedComputerApplication,
  decodeManagedComputerPromotionValidation,
  decodeManagedComputerRemoteSessionRequest,
  decodeManagedComputerRetry,
  decodeManagedComputerSetupSession,
} from "./managed-computer-request-contract";
import { ManagedComputerServiceError } from "./managed-computer-service";
import { decodeRequestSync } from "./request-schema";
import { trimmedText, UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { WorkerLifecycleConflictError } from "./worker-lifecycle-repository";
import { decodeWorkerLifecycleRequestId } from "./worker-lifecycle-request";
import { decodeWorkerSettings } from "./worker-request-contract";
import { WorkerConflictError } from "./workers";
import { workerJson } from "./worker-json";
import {
  workerRuntimeMetadataFromProto,
  WorkerRuntimeValidationError,
} from "./worker-runtime-mappers";

export type AppConnectFleetInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

const decodeUuid = decodeRequestSync(UuidString);
const decodeWorkerDeviceId = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(value)) {
    throw new HttpError(400, "Worker device id is invalid", "VALIDATION_FAILED");
  }
  return value;
};
const decodeDeviceId = decodeRequestSync(trimmedText(1, 128));

const workerDeviceIdentity = (value: string) => {
  if (!/^briar_device_[0-9a-f]{64}$/u.test(value)) {
    throw new ConnectError("Worker device identity is invalid", Code.InvalidArgument);
  }
  return value;
};

const workerLabel = (value: string) => {
  const label = value.trim();
  if (label.length < 1 || label.length > 100) {
    throw new ConnectError("Worker label must be 1-100 characters", Code.InvalidArgument);
  }
  return label;
};

const unbindReason = (value: UnbindProjectExecutionWorkerRequest_Reason) => {
  switch (value) {
    case UnbindProjectExecutionWorkerRequest_Reason.EXPLICIT_USER_UNLINK:
      return "explicit_user_unlink" as const;
    case UnbindProjectExecutionWorkerRequest_Reason.MANAGED_DEPROVISION:
      return "managed_deprovision" as const;
    case UnbindProjectExecutionWorkerRequest_Reason.UNSPECIFIED:
      throw new ConnectError("Worker unlink reason is required", Code.InvalidArgument);
    default:
      throw new ConnectError(`Unknown Worker unlink reason: ${value}`, Code.InvalidArgument);
  }
};

const workerIconFromMessage = (
  icon: WorkerIcon,
) => {
  switch (icon.kind) {
    case WorkerIcon_Kind.EMOJI:
      return { type: "emoji", value: icon.value } as const;
    case WorkerIcon_Kind.IMAGE:
      return { type: "image", value: icon.value } as const;
    case WorkerIcon_Kind.UNSPECIFIED:
      throw new ConnectError("Worker icon kind is required", Code.InvalidArgument);
    default:
      throw new ConnectError(
        `Unknown Worker icon kind: ${icon.kind}`,
        Code.InvalidArgument,
      );
  }
};

const throwFleetError = (error: unknown): never => {
  if (error instanceof WorkerRuntimeValidationError) {
    throw new HttpError(400, error.message);
  }
  if (error instanceof ManagedComputerServiceError) {
    throw new HttpError(error.status, error.message, error.code);
  }
  if (
    error instanceof WorkerConflictError ||
    error instanceof WorkerLifecycleConflictError
  ) {
    throw new HttpError(409, error.message);
  }
  if (!(error instanceof FleetApplicationError)) throw error;
  switch (error.reason) {
    case "organization_not_found":
    case "project_not_found":
    case "worker_not_found":
    case "managed_computer_not_found":
    case "remote_session_not_found":
      throw new HttpError(404, error.message);
    case "development_management_required":
      throw new HttpError(403, error.message);
    case "managed_computer_remote_forbidden":
      throw new HttpError(
        403,
        error.message,
        "MANAGED_COMPUTER_REMOTE_FORBIDDEN",
      );
    case "managed_computer_setup_forbidden":
      throw new HttpError(
        403,
        error.message,
        "MANAGED_COMPUTER_SETUP_FORBIDDEN",
      );
    case "worker_request_id_mismatch":
      throw new HttpError(400, error.message);
    case "latest_release_unavailable":
      throw new HttpError(503, error.message);
    case "worker_disabled":
    case "worker_update_unsupported":
      throw new HttpError(409, error.message);
    case "managed_computer_retire_unavailable":
      throw new HttpError(
        409,
        error.message,
        "MANAGED_COMPUTER_RETIRE_UNAVAILABLE",
      );
    case "managed_computer_terminate_unavailable":
      throw new HttpError(
        409,
        error.message,
        "MANAGED_COMPUTER_TERMINATE_UNAVAILABLE",
      );
  }
};

const withFleetErrors = async <A>(operation: Promise<A>): Promise<A> => {
  try {
    return await operation;
  } catch (error) {
    return throwFleetError(error);
  }
};

export const createAppFleetService = (
  { request, auth, db, env, context }: AppConnectFleetInput,
): ServiceImpl<typeof FleetService> => ({
  registerProjectExecutionWorker: async (input, context) => {
    const session = await requireSession(auth, request);
    const observedAt = new Date().toISOString();
    const result = await withFleetErrors(
      registerProjectExecutionWorkerApplication({
        db,
        projectId: decodeUuid(input.projectId),
        userId: session.user.id,
        label: workerLabel(input.label),
        deviceIdentity: workerDeviceIdentity(input.deviceIdentity),
        runtime: workerRuntimeMetadataFromProto(input.runtime),
        maxConcurrentSessions: input.maxConcurrentSessions,
        observedAt,
      }),
    );
    context.responseHeader.set("Cache-Control", "no-store");
    return {
      organizationId: result.organizationId,
      deviceId: result.device.id,
      worker: appDashboardWorker(workerJson(result.worker, observedAt)),
      workerToken: result.workerToken,
    };
  },

  bindProjectExecutionWorker: async (input) => {
    const session = await requireSession(auth, request);
    const observedAt = new Date().toISOString();
    const result = await withFleetErrors(bindProjectExecutionWorkerApplication({
      db,
      projectId: decodeUuid(input.projectId),
      userId: session.user.id,
      deviceIdentity: workerDeviceIdentity(input.deviceIdentity),
      runtime: workerRuntimeMetadataFromProto(input.runtime),
      observedAt,
    }));
    return {
      organizationId: result.organizationId,
      deviceId: result.device.id,
      worker: appDashboardWorker(workerJson(result.worker, observedAt)),
    };
  },

  unbindProjectExecutionWorker: async (input) => {
    const session = await requireSession(auth, request);
    return await withFleetErrors(unbindProjectExecutionWorkerApplication({
      db,
      env,
      projectId: decodeUuid(input.projectId),
      workerId: decodeDeviceId(input.workerId),
      userId: session.user.id,
      requestId: decodeWorkerLifecycleRequestId(input.requestId),
      reason: unbindReason(input.reason),
      observedAt: new Date().toISOString(),
    }));
  },

  listExecutionWorkers: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(listExecutionWorkersApplication({
      db,
      releases: env.RELEASES,
      organizationId: decodeUuid(input.organizationId),
      userId: session.user.id,
      observedAt: new Date().toISOString(),
    }));
    return {
      workers: result.workers.map(appOrganizationExecutionWorker),
      latestVersion: result.latestVersion ?? undefined,
      canManage: result.canManage,
      generatedAt: appFleetTimestamp(result.generatedAt),
    };
  },

  requestExecutionWorkerUpdate: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(
      requestExecutionWorkerUpdateApplication({
        db,
        releases: env.RELEASES,
        organizationId: decodeUuid(input.organizationId),
        deviceId: decodeDeviceId(input.deviceId),
        userId: session.user.id,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      outcome: result.outcome === "requested"
        ? RequestExecutionWorkerUpdateResponse_Outcome.REQUESTED
        : RequestExecutionWorkerUpdateResponse_Outcome.ALREADY_CURRENT,
      requestId: result.requestId ?? undefined,
      targetVersion: result.targetVersion,
    };
  },

  updateExecutionWorker: async (input) => {
    const session = await requireSession(auth, request);
    const icon = input.iconUpdate.case === "icon"
      ? workerIconFromMessage(input.iconUpdate.value)
      : input.iconUpdate.case === "clearIcon"
      ? null
      : undefined;
    const update = decodeWorkerSettings({
      maxConcurrentSessions: input.maxConcurrentSessions,
      icon,
    });
    const worker = await withFleetErrors(updateExecutionWorkerApplication({
      db,
      organizationId: decodeUuid(input.organizationId),
      deviceId: decodeDeviceId(input.deviceId),
      userId: session.user.id,
      update,
      observedAt: new Date().toISOString(),
    }));
    return {
      deviceId: worker.id,
      maxConcurrentSessions: worker.max_concurrent_sessions,
      icon: appFleetWorkerIcon(
        worker.icon_type && worker.icon_value
          ? { type: worker.icon_type, value: worker.icon_value }
          : null,
      ),
    };
  },

  deleteExecutionWorker: async (input) => {
    const session = await requireSession(auth, request);
    return await withFleetErrors(deleteExecutionWorkerApplication({
      db,
      env,
      organizationId: decodeUuid(input.organizationId),
      deviceId: decodeDeviceId(input.deviceId),
      userId: session.user.id,
      requestId: decodeWorkerLifecycleRequestId(input.requestId),
      observedAt: new Date().toISOString(),
    }));
  },

  getManagedComputerProduct: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(getManagedComputerProductApplication({
      db,
      env,
      organizationId: decodeUuid(input.organizationId),
      userId: session.user.id,
    }));
    return {
      product: appManagedComputerProduct(result.product),
      applicationsEnabled: result.applicationsEnabled,
      remoteDesktopEnabled: result.remoteDesktopEnabled,
      configurationReady: result.configurationReady,
      canApply: result.canApply,
      organizationLimit: result.organizationLimit,
      fleetLimit: result.fleetLimit,
    };
  },

  listManagedComputers: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(listManagedComputersApplication({
      db,
      organizationId: decodeUuid(input.organizationId),
      userId: session.user.id,
      observedAt: new Date().toISOString(),
    }));
    return {
      computers: result.computers.map(appManagedComputer),
      generatedAt: appFleetTimestamp(result.generatedAt),
    };
  },

  registerSandboxComputer: async (input) => {
    const session = await requireSession(auth, request);
    const label = input.label.trim();
    if (label.length === 0 || label.length > 100) {
      throw new HttpError(400, "Sandbox label must be 1-100 characters", "VALIDATION_FAILED");
    }
    const result = await withFleetErrors(registerSandboxComputerApplication({
      db,
      organizationId: decodeUuid(input.organizationId),
      deviceId: decodeWorkerDeviceId(input.deviceId),
      label,
      userId: session.user.id,
      apiOrigin: new URL(request.url).origin,
      observedAt: new Date().toISOString(),
    }));
    return { computer: appManagedComputer(result.computer) };
  },

  unregisterSandboxComputer: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(unregisterSandboxComputerApplication({
      db,
      env,
      organizationId: decodeUuid(input.organizationId),
      deviceId: decodeWorkerDeviceId(input.deviceId),
      userId: session.user.id,
      observedAt: new Date().toISOString(),
    }));
    return { removed: result.removed };
  },

  getManagedComputer: async (input) => {
    const session = await requireSession(auth, request);
    const computer = await withFleetErrors(getManagedComputerApplication({
      db,
      organizationId: decodeUuid(input.organizationId),
      managedComputerId: decodeUuid(input.managedComputerId),
      userId: session.user.id,
      observedAt: new Date().toISOString(),
    }));
    return { computer: appManagedComputer(computer) };
  },

  validateManagedComputerPromotion: async (input) => {
    const session = await requireSession(auth, request);
    const decoded = decodeManagedComputerPromotionValidation({
      code: input.code,
    });
    const result = await withFleetErrors(
      validateManagedComputerPromotionApplication({
        db,
        env,
        organizationId: decodeUuid(input.organizationId),
        userId: session.user.id,
        code: decoded.code,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      valid: result.valid,
      eligible: result.eligible,
      totalCents: result.totalCents,
      currency: ManagedComputerCurrency.USD,
      applicationsEnabled: result.applicationsEnabled,
      limitReason: appManagedComputerPromotionLimitReason(result.limitReason),
    };
  },

  applyForManagedComputer: async (input) => {
    const session = await requireSession(auth, request);
    const decoded = decodeManagedComputerApplication({
      code: input.code,
      requestId: input.requestId,
    });
    const result = await withFleetErrors(applyForManagedComputerApplication({
      db,
      env,
      organizationId: decodeUuid(input.organizationId),
      userId: session.user.id,
      ...decoded,
      observedAt: new Date().toISOString(),
    }));
    return {
      computer: appManagedComputer(result.computer),
      duplicate: result.duplicate,
      entitlement: appManagedComputerEntitlement(),
    };
  },

  retryManagedComputer: async (input) => {
    const session = await requireSession(auth, request);
    const decoded = decodeManagedComputerRetry({ requestId: input.requestId });
    const result = await withFleetErrors(retryManagedComputerApplication({
      db,
      env,
      organizationId: decodeUuid(input.organizationId),
      managedComputerId: decodeUuid(input.managedComputerId),
      userId: session.user.id,
      requestId: decoded.requestId,
      observedAt: new Date().toISOString(),
    }));
    return {
      computer: appManagedComputer(result.computer),
      duplicate: result.duplicate,
    };
  },

  retireManagedComputer: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(retireManagedComputerApplication({
      db,
      env,
      organizationId: decodeUuid(input.organizationId),
      managedComputerId: decodeUuid(input.managedComputerId),
      userId: session.user.id,
      observedAt: new Date().toISOString(),
    }));
    if (result.reconciliation) {
      if (context) context.waitUntil(result.reconciliation);
      else await result.reconciliation;
    }
    return {
      computer: appManagedComputer(result.computer),
      duplicate: result.duplicate,
    };
  },

  terminateManagedComputer: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(terminateManagedComputerApplication({
      db,
      env,
      organizationId: decodeUuid(input.organizationId),
      managedComputerId: decodeUuid(input.managedComputerId),
      userId: session.user.id,
      observedAt: new Date().toISOString(),
    }));
    return {
      computer: appManagedComputer(result.computer),
      duplicate: result.duplicate,
    };
  },

  createManagedComputerRemoteSession: async (input) => {
    const session = await requireSession(auth, request);
    const decoded = decodeManagedComputerRemoteSessionRequest({
      requestId: input.requestId,
      reconnectSessionId: input.reconnectSessionId,
      agentId: input.agentId,
    });
    const result = await withFleetErrors(
      createManagedComputerRemoteSessionApplication({
        db,
        env,
        organizationId: decodeUuid(input.organizationId),
        managedComputerId: decodeUuid(input.managedComputerId),
        userId: session.user.id,
        ...decoded,
        requestUrl: request.url,
        origin: request.headers.get("origin"),
        secFetchSite: request.headers.get("sec-fetch-site"),
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      session: appManagedComputerRemoteSession(result.session),
      socket: appManagedComputerSocketTicket(result.socket),
      reconnected: result.reconnected,
    };
  },

  endManagedComputerRemoteSession: async (input) => {
    const session = await requireSession(auth, request);
    return await withFleetErrors(
      endManagedComputerRemoteSessionApplication({
        db,
        env,
        organizationId: decodeUuid(input.organizationId),
        managedComputerId: decodeUuid(input.managedComputerId),
        remoteSessionId: decodeUuid(input.remoteSessionId),
        userId: session.user.id,
        origin: request.headers.get("origin"),
        secFetchSite: request.headers.get("sec-fetch-site"),
        observedAt: new Date().toISOString(),
      }),
    );
  },

  createManagedComputerSetupSession: async (input) => {
    const session = await requireSession(auth, request);
    const decoded = decodeManagedComputerSetupSession({
      projectId: input.projectId,
      requestId: input.requestId,
    });
    const result = await withFleetErrors(
      createManagedComputerSetupSessionApplication({
        db,
        env,
        organizationId: decodeUuid(input.organizationId),
        managedComputerId: decodeUuid(input.managedComputerId),
        userId: session.user.id,
        ...decoded,
        requestUrl: request.url,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      session: appManagedComputerSetupSession(result.session),
      setupToken: result.setupToken,
      socket: appManagedComputerSocketTicket(result.socket),
      agentConnected: result.agentConnected,
      duplicate: result.duplicate,
    };
  },

  getManagedComputerSetupStatus: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withFleetErrors(
      getManagedComputerSetupStatusApplication({
        db,
        organizationId: decodeUuid(input.organizationId),
        managedComputerId: decodeUuid(input.managedComputerId),
        userId: session.user.id,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      session: result.session
        ? appManagedComputerSetupStatusSession(result.session)
        : undefined,
      worker: result.worker ? appDashboardWorker(result.worker) : undefined,
    };
  },
});

export const registerAppFleetService = (
  router: ConnectRouter,
  input: AppConnectFleetInput,
) => router.service(FleetService, createAppFleetService(input));
