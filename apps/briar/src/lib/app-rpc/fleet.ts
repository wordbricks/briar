import { createClient } from "@connectrpc/connect";
import { FleetService } from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import type {
  ManagedComputerProduct,
  ManagedComputerRemoteSessionTicket,
  ManagedComputerSetupSessionTicket,
  WorkerIcon,
} from "../../types";
import { appCallOptions, appTransport } from "./core";
import {
  applyForManagedComputerResponseFromProto,
  executionWorkerIconUpdateFromDomain,
  executionWorkerConcurrencyResponseFromProto,
  executionWorkerIconResponseFromProto,
  listExecutionWorkersResponseFromProto,
  listManagedComputersResponseFromProto,
  managedComputerMutationResponseFromProto,
  managedComputerProductFromProto,
  managedComputerRemoteSessionTicketFromProto,
  managedComputerSetupSessionTicketFromProto,
  requestExecutionWorkerUpdateResponseFromProto,
  validateManagedComputerPromotionResponseFromProto,
} from "./fleet-mappers";

const fleetClient = appTransport
  ? createClient(FleetService, appTransport)
  : undefined;

const requireFleetClient = () => {
  if (!fleetClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return fleetClient;
};

export async function loadOrganizationExecutionWorkers(
  token: string,
  organizationId: string,
) {
  return listExecutionWorkersResponseFromProto(
    await requireFleetClient().listExecutionWorkers(
      { organizationId },
      appCallOptions(token),
    ),
  );
}

export async function loadManagedComputerProduct(
  token: string,
  organizationId: string,
): Promise<ManagedComputerProduct> {
  return managedComputerProductFromProto(
    await requireFleetClient().getManagedComputerProduct(
      { organizationId },
      appCallOptions(token),
    ),
  );
}

export async function loadManagedComputers(
  token: string,
  organizationId: string,
) {
  return listManagedComputersResponseFromProto(
    await requireFleetClient().listManagedComputers(
      { organizationId },
      appCallOptions(token),
    ),
  );
}

export async function validateManagedComputerPromotion(
  token: string,
  organizationId: string,
  code: string,
) {
  return validateManagedComputerPromotionResponseFromProto(
    await requireFleetClient().validateManagedComputerPromotion(
      { organizationId, code },
      appCallOptions(token),
    ),
  );
}

export async function applyForManagedComputer(
  token: string,
  organizationId: string,
  input: { code: string; requestId: string },
) {
  return applyForManagedComputerResponseFromProto(
    await requireFleetClient().applyForManagedComputer(
      { organizationId, code: input.code, requestId: input.requestId },
      appCallOptions(token),
    ),
  );
}

export async function retryManagedComputer(
  token: string,
  organizationId: string,
  managedComputerId: string,
  requestId: string,
) {
  return managedComputerMutationResponseFromProto(
    await requireFleetClient().retryManagedComputer(
      { organizationId, managedComputerId, requestId },
      appCallOptions(token),
    ),
  );
}

export async function retireManagedComputer(
  token: string,
  organizationId: string,
  managedComputerId: string,
) {
  return managedComputerMutationResponseFromProto(
    await requireFleetClient().retireManagedComputer(
      { organizationId, managedComputerId },
      appCallOptions(token),
    ),
  );
}

export async function createManagedComputerRemoteSession(
  token: string,
  organizationId: string,
  managedComputerId: string,
  input: { requestId: string; reconnectSessionId?: string; agentId?: string },
): Promise<ManagedComputerRemoteSessionTicket> {
  return managedComputerRemoteSessionTicketFromProto(
    await requireFleetClient().createManagedComputerRemoteSession(
      {
        organizationId,
        managedComputerId,
        requestId: input.requestId,
        reconnectSessionId: input.reconnectSessionId,
        agentId: input.agentId,
      },
      appCallOptions(token),
    ),
  );
}

export async function createManagedComputerSetupSession(
  token: string,
  organizationId: string,
  managedComputerId: string,
  input: { projectId: string; requestId: string },
): Promise<ManagedComputerSetupSessionTicket> {
  return managedComputerSetupSessionTicketFromProto(
    await requireFleetClient().createManagedComputerSetupSession(
      {
        organizationId,
        managedComputerId,
        projectId: input.projectId,
        requestId: input.requestId,
      },
      appCallOptions(token),
    ),
  );
}

export async function endManagedComputerRemoteSession(
  token: string,
  organizationId: string,
  managedComputerId: string,
  remoteSessionId: string,
): Promise<void> {
  await requireFleetClient().endManagedComputerRemoteSession(
    { organizationId, managedComputerId, remoteSessionId },
    appCallOptions(token),
  );
}

export async function requestOrganizationExecutionWorkerUpdate(
  token: string,
  organizationId: string,
  deviceId: string,
) {
  return requestExecutionWorkerUpdateResponseFromProto(
    await requireFleetClient().requestExecutionWorkerUpdate(
      { organizationId, deviceId },
      appCallOptions(token),
    ),
  );
}

export async function deleteOrganizationExecutionWorker(
  token: string,
  organizationId: string,
  deviceId: string,
): Promise<void> {
  await requireFleetClient().deleteExecutionWorker(
    {
      organizationId,
      deviceId,
      requestId: `worker-deprovision:${deviceId}`,
    },
    appCallOptions(token),
  );
}

export async function updateOrganizationExecutionWorkerConcurrency(
  token: string,
  organizationId: string,
  deviceId: string,
  maxConcurrentSessions: number,
) {
  return executionWorkerConcurrencyResponseFromProto(
    await requireFleetClient().updateExecutionWorker(
      { organizationId, deviceId, maxConcurrentSessions },
      appCallOptions(token),
    ),
  );
}

export async function updateOrganizationExecutionWorkerIcon(
  token: string,
  organizationId: string,
  deviceId: string,
  icon: WorkerIcon | null,
) {
  return executionWorkerIconResponseFromProto(
    await requireFleetClient().updateExecutionWorker(
      {
        organizationId,
        deviceId,
        iconUpdate: executionWorkerIconUpdateFromDomain(icon),
      },
      appCallOptions(token),
    ),
  );
}
