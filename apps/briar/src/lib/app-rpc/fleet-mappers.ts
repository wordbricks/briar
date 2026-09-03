import { create } from "@bufbuild/protobuf";
import {
  DashboardWorker_Readiness,
  DashboardWorker_State,
  WorkerIcon_Kind,
  WorkerIconSchema,
  type DashboardWorker as DashboardWorkerMessage,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  ExecutionWorkerHandoffState,
  ExecutionWorkerUpdateStatus,
  ManagedComputerCurrency,
  ManagedComputerEntitlement_Source,
  ManagedComputerPromotionLimitReason,
  ManagedComputerRemoteSessionState,
  ManagedComputerSetupSessionStatus,
  ManagedComputerState as ProtoManagedComputerState,
  RequestExecutionWorkerUpdateResponse_Outcome,
  UpdateExecutionWorkerRequest_ClearIconSchema,
  type ApplyForManagedComputerResponse,
  type CreateManagedComputerRemoteSessionResponse,
  type CreateManagedComputerSetupSessionResponse,
  type GetManagedComputerProductResponse,
  type GetManagedComputerSetupStatusResponse,
  type ListExecutionWorkersResponse,
  type ListManagedComputersResponse,
  type ManagedComputer as ManagedComputerMessage,
  type ManagedComputerEntitlement,
  type ManagedComputerRemoteSession as ManagedComputerRemoteSessionMessage,
  type ManagedComputerSetupSession as ManagedComputerSetupSessionMessage,
  type ManagedComputerSetupStatusSession,
  type OrganizationExecutionWorker as OrganizationExecutionWorkerMessage,
  type RequestExecutionWorkerUpdateResponse,
  type RetryManagedComputerResponse,
  type RetireManagedComputerResponse,
  type TerminateManagedComputerResponse,
  type UpdateExecutionWorkerResponse,
  type UpdateExecutionWorkerRequest,
  type ValidateManagedComputerPromotionResponse,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import type { WorkerCapabilities as WorkerCapabilitiesMessage } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import {
  emptyAgentProviderCapabilityCatalog,
  type AgentEffortCapability,
  type AgentModelCapability,
} from "../agent-provider-contract";
import type {
  ExecutionWorker,
  ManagedComputer,
  ManagedComputerProduct,
  ManagedComputerRemoteSession,
  ManagedComputerRemoteSessionTicket,
  ManagedComputerSetupSessionTicket,
  ManagedComputerState,
  OrganizationExecutionWorker,
  WorkerIcon,
} from "../../types";
import {
  agentProviderFromProto,
  optionalTimestamp,
  requiredMessage,
  requiredTimestamp,
} from "./mappers";

export const workerStateFromProto = (
  value: DashboardWorker_State,
): ExecutionWorker["state"] => {
  switch (value) {
    case DashboardWorker_State.ONLINE:
      return "online";
    case DashboardWorker_State.STALE:
      return "stale";
    case DashboardWorker_State.DISABLED:
      return "disabled";
    default:
      throw new Error(`Unknown worker state: ${value}`);
  }
};

export const workerReadinessFromProto = (
  value: DashboardWorker_Readiness,
): ExecutionWorker["readiness"] => {
  switch (value) {
    case DashboardWorker_Readiness.AVAILABLE:
      return "available";
    case DashboardWorker_Readiness.BUSY:
      return "busy";
    case DashboardWorker_Readiness.OFFLINE:
      return "offline";
    case DashboardWorker_Readiness.NEEDS_ATTENTION:
      return "needs_attention";
    case DashboardWorker_Readiness.DISABLED:
      return "disabled";
    default:
      throw new Error(`Unknown worker readiness: ${value}`);
  }
};

const effortCapabilityFromProto = (
  effort: WorkerCapabilitiesMessage["providerCapabilities"][number]["defaultEfforts"][number],
): AgentEffortCapability => ({
  id: effort.id,
  label: effort.label,
  ...(effort.description !== undefined
    ? { description: effort.description }
    : {}),
  ...(effort.isDefault !== undefined ? { isDefault: effort.isDefault } : {}),
});

const modelCapabilityFromProto = (
  model: WorkerCapabilitiesMessage["providerCapabilities"][number]["models"][number],
): AgentModelCapability => ({
  id: model.id,
  label: model.label,
  ...(model.isDefault !== undefined ? { isDefault: model.isDefault } : {}),
  ...(model.defaultEffortId !== undefined
    ? { defaultEffortId: model.defaultEffortId }
    : {}),
  ...(model.efforts.length > 0
    ? { efforts: model.efforts.map(effortCapabilityFromProto) }
    : {}),
});

const workerCapabilitiesFromProto = (
  value: WorkerCapabilitiesMessage,
): ExecutionWorker["capabilities"] => {
  const providerCapabilities = emptyAgentProviderCapabilityCatalog();
  for (const capability of value.providerCapabilities) {
    const provider = agentProviderFromProto(capability.provider);
    providerCapabilities[provider] = {
      models: capability.models.map(modelCapabilityFromProto),
      ...(capability.defaultEfforts.length > 0
        ? {
            defaultEfforts: capability.defaultEfforts.map(
              effortCapabilityFromProto,
            ),
          }
        : {}),
      allowCustomModels: capability.allowCustomModels,
      error: capability.error ?? null,
    };
  }
  return {
    providerCapabilities,
    ...(value.remoteUpdates
      ? {
          remoteUpdates: {
            supported: value.remoteUpdates.supported,
            ...(value.remoteUpdates.protocol !== undefined
              ? { protocol: value.remoteUpdates.protocol }
              : {}),
          },
        }
      : {}),
  };
};

export const workerIconFromProto = (
  icon: DashboardWorkerMessage["icon"],
): ExecutionWorker["icon"] =>
  icon === undefined
    ? null
    : {
        type:
          icon.kind === WorkerIcon_Kind.EMOJI
            ? "emoji"
            : icon.kind === WorkerIcon_Kind.IMAGE
              ? "image"
              : (() => {
                  throw new Error(`Unknown worker icon kind: ${icon.kind}`);
                })(),
        value: icon.value,
      };

export const workerIconToProto = (icon: WorkerIcon) => {
  switch (icon.type) {
    case "emoji":
      return create(WorkerIconSchema, {
        kind: WorkerIcon_Kind.EMOJI,
        value: icon.value,
      });
    case "image":
      return create(WorkerIconSchema, {
        kind: WorkerIcon_Kind.IMAGE,
        value: icon.value,
      });
  }
};

export const executionWorkerIconUpdateFromDomain = (
  icon: WorkerIcon | null,
): UpdateExecutionWorkerRequest["iconUpdate"] =>
  icon === null
    ? {
        case: "clearIcon",
        value: create(UpdateExecutionWorkerRequest_ClearIconSchema),
      }
    : { case: "icon", value: workerIconToProto(icon) };

export const dashboardWorkerFromProto = (
  worker: DashboardWorkerMessage,
): ExecutionWorker => ({
  id: worker.id,
  deviceId: worker.deviceId,
  ownerUserId: worker.ownerUserId,
  label: worker.label,
  icon: workerIconFromProto(worker.icon),
  agentProvider: agentProviderFromProto(worker.agentProvider),
  providers: worker.providers.map(agentProviderFromProto),
  versions: worker.versions,
  state: workerStateFromProto(worker.state),
  readiness: workerReadinessFromProto(worker.readiness),
  acceptingWork: worker.acceptingWork,
  readinessDetail: worker.readinessDetail ?? null,
  capabilities: workerCapabilitiesFromProto(
    requiredMessage(worker.capabilities, "worker.capabilities"),
  ),
  maxConcurrentSessions: worker.maxConcurrentSessions,
  activeSessions: worker.activeSessions,
  availableSessions: worker.availableSessions,
  lastHeartbeatAt: requiredTimestamp(
    worker.lastHeartbeatAt,
    "worker.lastHeartbeatAt",
  ),
  createdAt: requiredTimestamp(worker.createdAt, "worker.createdAt"),
});

const workerUpdateStatusFromProto = (
  value: ExecutionWorkerUpdateStatus,
): NonNullable<OrganizationExecutionWorker["updateRequest"]>["status"] => {
  switch (value) {
    case ExecutionWorkerUpdateStatus.REQUESTED:
      return "requested";
    case ExecutionWorkerUpdateStatus.COMPLETED:
      return "completed";
    case ExecutionWorkerUpdateStatus.CANCELLED:
      return "cancelled";
    case ExecutionWorkerUpdateStatus.UNSPECIFIED:
      throw new Error("Execution worker update status is missing");
    default:
      throw new Error(`Unknown execution worker update status: ${value}`);
  }
};

const workerHandoffStateFromProto = (
  value: ExecutionWorkerHandoffState,
): NonNullable<
  OrganizationExecutionWorker["updateRequest"]
>["handoffState"] => {
  switch (value) {
    case ExecutionWorkerHandoffState.IDLE:
      return "idle";
    case ExecutionWorkerHandoffState.DRAINING:
      return "draining";
    case ExecutionWorkerHandoffState.READY:
      return "ready";
    case ExecutionWorkerHandoffState.FAILED:
      return "failed";
    case ExecutionWorkerHandoffState.UNSPECIFIED:
      throw new Error("Execution worker handoff state is missing");
    default:
      throw new Error(`Unknown execution worker handoff state: ${value}`);
  }
};

export const organizationExecutionWorkerFromProto = (
  worker: OrganizationExecutionWorkerMessage,
): OrganizationExecutionWorker => ({
  deviceId: worker.deviceId,
  ownerUserId: worker.ownerUserId,
  ownerName: worker.ownerName,
  label: worker.label,
  icon: workerIconFromProto(worker.icon),
  state: workerStateFromProto(worker.state),
  maxConcurrentSessions: worker.maxConcurrentSessions,
  activeSessions: worker.activeSessions,
  lastHeartbeatAt: requiredTimestamp(
    worker.lastHeartbeatAt,
    "organizationExecutionWorker.lastHeartbeatAt",
  ),
  createdAt: requiredTimestamp(
    worker.createdAt,
    "organizationExecutionWorker.createdAt",
  ),
  versions: { ...worker.versions },
  remoteUpdateSupported: worker.remoteUpdateSupported,
  updateRequest:
    worker.updateRequest === undefined
      ? null
      : {
          id: worker.updateRequest.id,
          targetVersion: worker.updateRequest.targetVersion,
          status: workerUpdateStatusFromProto(worker.updateRequest.status),
          requestedAt: requiredTimestamp(
            worker.updateRequest.requestedAt,
            "organizationExecutionWorker.updateRequest.requestedAt",
          ),
          handoffState: workerHandoffStateFromProto(
            worker.updateRequest.handoffState,
          ),
          handoffError: worker.updateRequest.handoffError ?? null,
        },
  bindings: worker.bindings.map((binding) => ({
    id: binding.id,
    projectId: binding.projectId,
    projectName: binding.projectName,
    agentProvider: agentProviderFromProto(binding.agentProvider),
    providers: binding.providers.map(agentProviderFromProto),
    state: workerStateFromProto(binding.state),
    acceptingWork: binding.acceptingWork,
    readiness: workerReadinessFromProto(binding.readiness),
    readinessDetail: binding.readinessDetail ?? null,
  })),
});

export const listExecutionWorkersResponseFromProto = (
  response: ListExecutionWorkersResponse,
) => ({
  workers: response.workers.map(organizationExecutionWorkerFromProto),
  latestVersion: response.latestVersion ?? null,
  canManage: response.canManage,
  generatedAt: requiredTimestamp(
    response.generatedAt,
    "listExecutionWorkers.generatedAt",
  ),
});

const managedComputerStateFromProto = (
  value: ProtoManagedComputerState,
): ManagedComputerState => {
  switch (value) {
    case ProtoManagedComputerState.REQUESTED:
      return "requested";
    case ProtoManagedComputerState.PROVISIONING:
      return "provisioning";
    case ProtoManagedComputerState.BOOTSTRAPPING:
      return "bootstrapping";
    case ProtoManagedComputerState.NEEDS_SETUP:
      return "needs_setup";
    case ProtoManagedComputerState.READY:
      return "ready";
    case ProtoManagedComputerState.FAILED:
      return "failed";
    case ProtoManagedComputerState.DRAINING:
      return "draining";
    case ProtoManagedComputerState.STOPPED:
      return "stopped";
    case ProtoManagedComputerState.TERMINATED:
      return "terminated";
    case ProtoManagedComputerState.UNSPECIFIED:
      throw new Error("Managed computer state is missing");
    default:
      throw new Error(`Unknown managed computer state: ${value}`);
  }
};

export const managedComputerFromProto = (
  computer: ManagedComputerMessage,
): ManagedComputer => ({
  id: computer.id,
  organizationId: computer.organizationId,
  requesterUserId: computer.requesterUserId,
  state: managedComputerStateFromProto(computer.state),
  region: computer.region,
  instanceId: computer.instanceId ?? null,
  volumeId: computer.volumeId ?? null,
  deviceId: computer.deviceId ?? null,
  error:
    computer.error === undefined
      ? null
      : { code: computer.error.code, message: computer.error.message },
  retryCount: computer.retryCount,
  retryAvailable: computer.retryAvailable,
  createdAt: requiredTimestamp(computer.createdAt, "managedComputer.createdAt"),
  expiresAt: requiredTimestamp(computer.expiresAt, "managedComputer.expiresAt"),
  updatedAt: requiredTimestamp(computer.updatedAt, "managedComputer.updatedAt"),
});

export const listManagedComputersResponseFromProto = (
  response: ListManagedComputersResponse,
) => ({
  computers: response.computers.map(managedComputerFromProto),
  generatedAt: requiredTimestamp(
    response.generatedAt,
    "listManagedComputers.generatedAt",
  ),
});

const managedComputerCurrencyFromProto = (
  value: ManagedComputerCurrency,
): "USD" => {
  switch (value) {
    case ManagedComputerCurrency.USD:
      return "USD";
    case ManagedComputerCurrency.UNSPECIFIED:
      throw new Error("Managed computer currency is missing");
    default:
      throw new Error(`Unknown managed computer currency: ${value}`);
  }
};

export const validateManagedComputerPromotionResponseFromProto = (
  response: ValidateManagedComputerPromotionResponse,
) => ({
  valid: response.valid,
  eligible: response.eligible,
  totalCents: response.totalCents,
  currency: managedComputerCurrencyFromProto(response.currency),
  applicationsEnabled: response.applicationsEnabled,
  limitReason: promotionLimitReasonFromProto(response.limitReason),
});

export const managedComputerProductFromProto = (
  response: GetManagedComputerProductResponse,
): ManagedComputerProduct => {
  const product = requiredMessage(
    response.product,
    "managedComputerProduct.product",
  );
  const specification = requiredMessage(
    product.specification,
    "managedComputerProduct.product.specification",
  );
  if (product.quantity !== 1) {
    throw new Error(
      `Unexpected managed computer quantity: ${product.quantity}`,
    );
  }
  if (specification.maxConcurrentRuns !== 1) {
    throw new Error(
      `Unexpected managed computer concurrency: ${specification.maxConcurrentRuns}`,
    );
  }
  if (product.modelApiCostsIncluded) {
    throw new Error(
      "Managed computer product unexpectedly includes model API costs",
    );
  }
  return {
    product: {
      currency: managedComputerCurrencyFromProto(product.currency),
      monthlyPriceCents: product.monthlyPriceCents,
      quantity: 1,
      specification: {
        instanceType: specification.instanceType,
        vcpu: specification.vcpu,
        memoryGiB: specification.memoryGib,
        volumeGiB: specification.volumeGib,
        maxConcurrentRuns: 1,
        region: specification.region ?? null,
      },
      modelApiCostsIncluded: false,
    },
    applicationsEnabled: response.applicationsEnabled,
    remoteDesktopEnabled: response.remoteDesktopEnabled,
    configurationReady: response.configurationReady,
    canApply: response.canApply,
    organizationLimit: response.organizationLimit,
    fleetLimit: response.fleetLimit,
  };
};

export const promotionLimitReasonFromProto = (
  value: ManagedComputerPromotionLimitReason | undefined,
): "user" | "organization" | "fleet" | null => {
  switch (value) {
    case undefined:
      return null;
    case ManagedComputerPromotionLimitReason.USER:
      return "user";
    case ManagedComputerPromotionLimitReason.ORGANIZATION:
      return "organization";
    case ManagedComputerPromotionLimitReason.FLEET:
      return "fleet";
    case ManagedComputerPromotionLimitReason.UNSPECIFIED:
      throw new Error("Managed computer promotion limit reason is missing");
    default:
      throw new Error(
        `Unknown managed computer promotion limit reason: ${value}`,
      );
  }
};

export const managedComputerEntitlementFromProto = (
  entitlement: ManagedComputerEntitlement,
) => {
  if (entitlement.source !== ManagedComputerEntitlement_Source.FREE_PROMOTION) {
    throw new Error(
      `Unknown managed computer entitlement source: ${entitlement.source}`,
    );
  }
  if (entitlement.totalCents !== 0) {
    throw new Error(
      `Unexpected managed computer entitlement total: ${entitlement.totalCents}`,
    );
  }
  return {
    source: "free_promotion",
    totalCents: 0,
    currency: managedComputerCurrencyFromProto(entitlement.currency),
  } as const;
};

const managedComputerRemoteSessionStateFromProto = (
  value: ManagedComputerRemoteSessionState,
): ManagedComputerRemoteSession["state"] => {
  switch (value) {
    case ManagedComputerRemoteSessionState.CREATED:
      return "created";
    case ManagedComputerRemoteSessionState.CONNECTING:
      return "connecting";
    case ManagedComputerRemoteSessionState.CONNECTED:
      return "connected";
    case ManagedComputerRemoteSessionState.DISCONNECTED:
      return "disconnected";
    case ManagedComputerRemoteSessionState.ENDED:
      return "ended";
    case ManagedComputerRemoteSessionState.EXPIRED:
      return "expired";
    case ManagedComputerRemoteSessionState.REJECTED:
      return "rejected";
    case ManagedComputerRemoteSessionState.UNSPECIFIED:
      throw new Error("Managed computer remote session state is missing");
    default:
      throw new Error(
        `Unknown managed computer remote session state: ${value}`,
      );
  }
};

export const managedComputerRemoteSessionFromProto = (
  session: ManagedComputerRemoteSessionMessage,
): ManagedComputerRemoteSession => ({
  id: session.id,
  managedComputerId: session.managedComputerId,
  agentId: session.agentId ?? null,
  state: managedComputerRemoteSessionStateFromProto(session.state),
  connectionGeneration: session.connectionGeneration,
  tokenExpiresAt: requiredTimestamp(
    session.tokenExpiresAt,
    "managedComputerRemoteSession.tokenExpiresAt",
  ),
  maxExpiresAt: requiredTimestamp(
    session.maxExpiresAt,
    "managedComputerRemoteSession.maxExpiresAt",
  ),
  connectedAt: optionalTimestamp(session.connectedAt),
  disconnectedAt: optionalTimestamp(session.disconnectedAt),
  endedAt: optionalTimestamp(session.endedAt),
});

export const managedComputerRemoteSessionTicketFromProto = (
  response: CreateManagedComputerRemoteSessionResponse,
): ManagedComputerRemoteSessionTicket => {
  const socket = requiredMessage(
    response.socket,
    "managedComputerRemoteSessionTicket.socket",
  );
  return {
    session: managedComputerRemoteSessionFromProto(
      requiredMessage(
        response.session,
        "managedComputerRemoteSessionTicket.session",
      ),
    ),
    socket: { url: socket.url, protocol: socket.protocol },
    reconnected: response.reconnected,
  };
};

export const managedComputerSetupSessionStatusFromProto = (
  value: ManagedComputerSetupSessionStatus,
): "pending" | "consumed" | "expired" => {
  switch (value) {
    case ManagedComputerSetupSessionStatus.PENDING:
      return "pending";
    case ManagedComputerSetupSessionStatus.CONSUMED:
      return "consumed";
    case ManagedComputerSetupSessionStatus.EXPIRED:
      return "expired";
    case ManagedComputerSetupSessionStatus.UNSPECIFIED:
      throw new Error("Managed computer setup session status is missing");
    default:
      throw new Error(
        `Unknown managed computer setup session status: ${value}`,
      );
  }
};

const managedComputerSetupSessionFromProto = (
  session: ManagedComputerSetupSessionMessage,
): ManagedComputerSetupSessionTicket["session"] => {
  const status = managedComputerSetupSessionStatusFromProto(session.status);
  if (status === "expired") {
    throw new Error(
      "Cannot create an already expired managed computer setup session",
    );
  }
  return {
    id: session.id,
    managedComputerId: session.managedComputerId,
    organizationId: session.organizationId,
    teamId: session.projectId,
    status,
    expiresAt: requiredTimestamp(
      session.expiresAt,
      "managedComputerSetupSession.expiresAt",
    ),
  };
};

export const managedComputerSetupSessionTicketFromProto = (
  response: CreateManagedComputerSetupSessionResponse,
): ManagedComputerSetupSessionTicket => {
  const socket = requiredMessage(
    response.socket,
    "managedComputerSetupSessionTicket.socket",
  );
  return {
    session: managedComputerSetupSessionFromProto(
      requiredMessage(
        response.session,
        "managedComputerSetupSessionTicket.session",
      ),
    ),
    setupToken: response.setupToken,
    socket: { url: socket.url, protocol: socket.protocol },
    agentConnected: response.agentConnected,
    duplicate: response.duplicate,
  };
};

const managedComputerSetupStatusSessionFromProto = (
  session: ManagedComputerSetupStatusSession,
) => ({
  id: session.id,
  projectId: session.projectId,
  status: managedComputerSetupSessionStatusFromProto(session.status),
  expiresAt: requiredTimestamp(
    session.expiresAt,
    "managedComputerSetupStatus.session.expiresAt",
  ),
  consumedAt: optionalTimestamp(session.consumedAt),
});

export const managedComputerSetupStatusFromProto = (
  response: GetManagedComputerSetupStatusResponse,
) => ({
  session:
    response.session === undefined
      ? null
      : managedComputerSetupStatusSessionFromProto(response.session),
  worker:
    response.worker === undefined
      ? null
      : dashboardWorkerFromProto(response.worker),
});

export const managedComputerMutationResponseFromProto = (
  response:
    | RetryManagedComputerResponse
    | RetireManagedComputerResponse
    | TerminateManagedComputerResponse,
) => ({
  computer: managedComputerFromProto(
    requiredMessage(response.computer, "managedComputerMutation.computer"),
  ),
  duplicate: response.duplicate,
});

export const updateOutcomeFromProto = (
  value: RequestExecutionWorkerUpdateResponse_Outcome,
): "requested" | "already_current" => {
  switch (value) {
    case RequestExecutionWorkerUpdateResponse_Outcome.REQUESTED:
      return "requested";
    case RequestExecutionWorkerUpdateResponse_Outcome.ALREADY_CURRENT:
      return "already_current";
    case RequestExecutionWorkerUpdateResponse_Outcome.UNSPECIFIED:
      throw new Error("Execution worker update outcome is missing");
    default:
      throw new Error(`Unknown execution worker update outcome: ${value}`);
  }
};

export const requestExecutionWorkerUpdateResponseFromProto = (
  response: RequestExecutionWorkerUpdateResponse,
) => ({
  outcome: updateOutcomeFromProto(response.outcome),
  requestId: response.requestId,
  targetVersion: response.targetVersion,
});

export const executionWorkerConcurrencyResponseFromProto = (
  response: UpdateExecutionWorkerResponse,
) => ({
  deviceId: response.deviceId,
  maxConcurrentSessions: response.maxConcurrentSessions,
});

export const executionWorkerIconResponseFromProto = (
  response: UpdateExecutionWorkerResponse,
) => ({
  deviceId: response.deviceId,
  icon: workerIconFromProto(response.icon),
});

export const applyForManagedComputerResponseFromProto = (
  response: ApplyForManagedComputerResponse,
) => ({
  computer: managedComputerFromProto(
    requiredMessage(response.computer, "applyForManagedComputer.computer"),
  ),
  duplicate: response.duplicate,
  entitlement: managedComputerEntitlementFromProto(
    requiredMessage(
      response.entitlement,
      "applyForManagedComputer.entitlement",
    ),
  ),
});
