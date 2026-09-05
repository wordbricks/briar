import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DashboardWorker_Readiness,
  DashboardWorker_State,
  WorkerIcon_Kind,
  WorkerIconSchema,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  ExecutionWorkerBindingSchema,
  ExecutionWorkerHandoffState,
  ExecutionWorkerUpdateRequestStateSchema,
  ExecutionWorkerUpdateStatus,
  ManagedComputerCurrency,
  ManagedComputerEntitlement_Source,
  ManagedComputerEntitlementSchema,
  ManagedComputerErrorSchema,
  ManagedComputerProductSchema,
  ManagedComputerPromotionLimitReason,
  ManagedComputerRemoteSessionSchema,
  ManagedComputerRemoteSessionState,
  ManagedComputerProvider,
  ManagedComputerSchema,
  ManagedComputerSetupSessionSchema,
  ManagedComputerSetupSessionStatus,
  ManagedComputerSetupStatusSessionSchema,
  ManagedComputerSocketTicketSchema,
  ManagedComputerSpecificationSchema,
  ManagedComputerState,
  OrganizationExecutionWorkerSchema,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import type { ManagedComputerRow } from "./managed-computer-model";
import type { managedComputerProductResponse } from "./managed-computer-service";
import type { ManagedComputerRemoteSessionState as RemoteSessionState } from "./managed-computer-remote-model";
import type { ManagedComputerSetupSessionRow } from "./managed-computer-model";
import type {
  ExecutionWorkerState,
  OrganizationExecutionWorker,
} from "./workers";
import { appAgentProvider } from "./app-connect-mappers";

export const appFleetTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp in FleetService response");
  }
  return timestampFromDate(date);
};

const workerState = {
  online: DashboardWorker_State.ONLINE,
  stale: DashboardWorker_State.STALE,
  disabled: DashboardWorker_State.DISABLED,
} as const satisfies Record<ExecutionWorkerState, DashboardWorker_State>;

const workerReadiness = {
  available: DashboardWorker_Readiness.AVAILABLE,
  busy: DashboardWorker_Readiness.BUSY,
  offline: DashboardWorker_Readiness.OFFLINE,
  needs_attention: DashboardWorker_Readiness.NEEDS_ATTENTION,
  disabled: DashboardWorker_Readiness.DISABLED,
} as const;

const updateStatus = {
  requested: ExecutionWorkerUpdateStatus.REQUESTED,
  completed: ExecutionWorkerUpdateStatus.COMPLETED,
  cancelled: ExecutionWorkerUpdateStatus.CANCELLED,
} as const;

const handoffState = {
  idle: ExecutionWorkerHandoffState.IDLE,
  draining: ExecutionWorkerHandoffState.DRAINING,
  ready: ExecutionWorkerHandoffState.READY,
  failed: ExecutionWorkerHandoffState.FAILED,
} as const;

export const appExecutionWorkerUpdateRequestState = (update: {
  readonly id: string;
  readonly targetVersion: string;
  readonly status: keyof typeof updateStatus;
  readonly requestedAt: string;
  readonly handoffState: keyof typeof handoffState;
  readonly handoffError?: string | null;
}) => create(ExecutionWorkerUpdateRequestStateSchema, {
  id: update.id,
  targetVersion: update.targetVersion,
  status: updateStatus[update.status],
  requestedAt: appFleetTimestamp(update.requestedAt),
  handoffState: handoffState[update.handoffState],
  handoffError: update.handoffError ?? undefined,
});

export const appFleetWorkerIcon = (
  icon: { readonly type: "emoji" | "image"; readonly value: string } | null,
) => icon
  ? create(WorkerIconSchema, {
    kind: icon.type === "emoji" ? WorkerIcon_Kind.EMOJI : WorkerIcon_Kind.IMAGE,
    value: icon.value,
  })
  : undefined;

export const appOrganizationExecutionWorker = (
  worker: OrganizationExecutionWorker,
) => create(OrganizationExecutionWorkerSchema, {
  deviceId: worker.deviceId,
  ownerUserId: worker.ownerUserId,
  ownerName: worker.ownerName,
  label: worker.label,
  icon: appFleetWorkerIcon(worker.icon),
  state: workerState[worker.state],
  maxConcurrentSessions: worker.maxConcurrentSessions,
  activeSessions: worker.activeSessions,
  lastHeartbeatAt: appFleetTimestamp(worker.lastHeartbeatAt),
  createdAt: appFleetTimestamp(worker.createdAt),
  versions: { ...worker.versions },
  remoteUpdateSupported: worker.remoteUpdateSupported,
  updateRequest: worker.updateRequest
    ? appExecutionWorkerUpdateRequestState(worker.updateRequest)
    : undefined,
  bindings: worker.bindings.map((binding) =>
    create(ExecutionWorkerBindingSchema, {
      id: binding.id,
      projectId: binding.projectId,
      projectName: binding.projectName,
      agentProvider: appAgentProvider[binding.agentProvider],
      providers: binding.providers.map((provider) => appAgentProvider[provider]),
      state: workerState[binding.state],
      acceptingWork: binding.acceptingWork,
      readiness: workerReadiness[binding.readiness],
      readinessDetail: binding.readinessDetail ?? undefined,
    })
  ),
});

const managedState = {
  requested: ManagedComputerState.REQUESTED,
  provisioning: ManagedComputerState.PROVISIONING,
  bootstrapping: ManagedComputerState.BOOTSTRAPPING,
  needs_setup: ManagedComputerState.NEEDS_SETUP,
  ready: ManagedComputerState.READY,
  failed: ManagedComputerState.FAILED,
  draining: ManagedComputerState.DRAINING,
  stopped: ManagedComputerState.STOPPED,
  terminated: ManagedComputerState.TERMINATED,
} as const satisfies Record<ManagedComputerRow["state"], ManagedComputerState>;

const managedProvider = {
  aws: ManagedComputerProvider.AWS,
  sandbox: ManagedComputerProvider.SANDBOX,
} as const satisfies Record<ManagedComputerRow["provider"], ManagedComputerProvider>;

export const appManagedComputer = (row: ManagedComputerRow) =>
  create(ManagedComputerSchema, {
    id: row.id,
    organizationId: row.organization_id,
    requesterUserId: row.requester_user_id,
    state: managedState[row.state],
    provider: managedProvider[row.provider],
    label: row.provider === "sandbox" ? row.device_label ?? undefined : undefined,
    region: row.aws_region,
    instanceId: row.aws_instance_id ?? undefined,
    volumeId: row.aws_volume_id ?? undefined,
    deviceId: row.briar_device_id ?? undefined,
    error: row.error_code
      ? create(ManagedComputerErrorSchema, {
        code: row.error_code,
        message: row.error_detail ?? row.error_code,
      })
      : undefined,
    retryCount: row.retry_count,
    retryAvailable: row.state === "failed",
    createdAt: appFleetTimestamp(row.created_at),
    expiresAt: appFleetTimestamp(row.expires_at),
    updatedAt: appFleetTimestamp(row.updated_at),
  });

export const appManagedComputerProduct = (
  value: ReturnType<typeof managedComputerProductResponse>["product"],
) => create(ManagedComputerProductSchema, {
  currency: ManagedComputerCurrency.USD,
  monthlyPriceCents: value.monthlyPriceCents,
  quantity: value.quantity,
  specification: create(ManagedComputerSpecificationSchema, {
    instanceType: value.specification.instanceType,
    vcpu: value.specification.vcpu,
    memoryGib: value.specification.memoryGiB,
    volumeGib: value.specification.volumeGiB,
    maxConcurrentRuns: value.specification.maxConcurrentRuns,
    region: value.specification.region ?? undefined,
  }),
  modelApiCostsIncluded: value.modelApiCostsIncluded,
});

export const appManagedComputerPromotionLimitReason = (
  value: string | null,
) => {
  switch (value) {
    case null:
      return undefined;
    case "user":
      return ManagedComputerPromotionLimitReason.USER;
    case "organization":
      return ManagedComputerPromotionLimitReason.ORGANIZATION;
    case "fleet":
      return ManagedComputerPromotionLimitReason.FLEET;
    default:
      throw new Error(`Unknown managed computer promotion limit: ${value}`);
  }
};

export const appManagedComputerEntitlement = () =>
  create(ManagedComputerEntitlementSchema, {
    source: ManagedComputerEntitlement_Source.FREE_PROMOTION,
    totalCents: 0,
    currency: ManagedComputerCurrency.USD,
  });

const remoteSessionState = {
  created: ManagedComputerRemoteSessionState.CREATED,
  connecting: ManagedComputerRemoteSessionState.CONNECTING,
  connected: ManagedComputerRemoteSessionState.CONNECTED,
  disconnected: ManagedComputerRemoteSessionState.DISCONNECTED,
  ended: ManagedComputerRemoteSessionState.ENDED,
  expired: ManagedComputerRemoteSessionState.EXPIRED,
  rejected: ManagedComputerRemoteSessionState.REJECTED,
} as const satisfies Record<RemoteSessionState, ManagedComputerRemoteSessionState>;

export const appManagedComputerRemoteSession = (session: {
  readonly id: string;
  readonly managedComputerId: string;
  readonly agentId: string | null;
  readonly state: RemoteSessionState;
  readonly connectionGeneration: number;
  readonly tokenExpiresAt: string;
  readonly maxExpiresAt: string;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
  readonly endedAt: string | null;
}) => create(ManagedComputerRemoteSessionSchema, {
  id: session.id,
  managedComputerId: session.managedComputerId,
  agentId: session.agentId ?? undefined,
  state: remoteSessionState[session.state],
  connectionGeneration: session.connectionGeneration,
  tokenExpiresAt: appFleetTimestamp(session.tokenExpiresAt),
  maxExpiresAt: appFleetTimestamp(session.maxExpiresAt),
  connectedAt: session.connectedAt
    ? appFleetTimestamp(session.connectedAt)
    : undefined,
  disconnectedAt: session.disconnectedAt
    ? appFleetTimestamp(session.disconnectedAt)
    : undefined,
  endedAt: session.endedAt ? appFleetTimestamp(session.endedAt) : undefined,
});

export const appManagedComputerSocketTicket = (socket: {
  readonly url: string;
  readonly protocol: string;
}) => create(ManagedComputerSocketTicketSchema, socket);

const setupSessionStatus = {
  pending: ManagedComputerSetupSessionStatus.PENDING,
  consumed: ManagedComputerSetupSessionStatus.CONSUMED,
  expired: ManagedComputerSetupSessionStatus.EXPIRED,
} as const;

export const appManagedComputerSetupSession = (
  session: ManagedComputerSetupSessionRow,
) => create(ManagedComputerSetupSessionSchema, {
  id: session.id,
  managedComputerId: session.managed_computer_id,
  organizationId: session.organization_id,
  projectId: session.project_id,
  status: setupSessionStatus[session.status],
  expiresAt: appFleetTimestamp(session.expires_at),
});

export const appManagedComputerSetupStatusSession = (session: {
  readonly id: string;
  readonly projectId: string;
  readonly status: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}) => {
  const status = (() => {
    switch (session.status) {
      case "pending":
        return ManagedComputerSetupSessionStatus.PENDING;
      case "consumed":
        return ManagedComputerSetupSessionStatus.CONSUMED;
      case "expired":
        return ManagedComputerSetupSessionStatus.EXPIRED;
      default:
        throw new Error(
          `Unknown managed computer setup status: ${session.status}`,
        );
    }
  })();
  return create(ManagedComputerSetupStatusSessionSchema, {
    id: session.id,
    projectId: session.projectId,
    status,
    expiresAt: appFleetTimestamp(session.expiresAt),
    consumedAt: session.consumedAt
      ? appFleetTimestamp(session.consumedAt)
      : undefined,
  });
};
