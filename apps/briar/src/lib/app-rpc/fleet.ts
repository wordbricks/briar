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

export async function loadWorkspaceExecutionWorkers(
  token: string,
  workspaceId: string,
) {
  return listExecutionWorkersResponseFromProto(
    await requireFleetClient().listExecutionWorkers(
      { workspaceId: workspaceId },
      appCallOptions(token),
    ),
  );
}

export async function loadManagedComputerProduct(
  token: string,
  workspaceId: string,
): Promise<ManagedComputerProduct> {
  return managedComputerProductFromProto(
    await requireFleetClient().getManagedComputerProduct(
      { workspaceId: workspaceId },
      appCallOptions(token),
    ),
  );
}

export async function loadManagedComputers(
  token: string,
  workspaceId: string,
) {
  return listManagedComputersResponseFromProto(
    await requireFleetClient().listManagedComputers(
      { workspaceId: workspaceId },
      appCallOptions(token),
    ),
  );
}

export async function validateManagedComputerPromotion(
  token: string,
  workspaceId: string,
  code: string,
) {
  return validateManagedComputerPromotionResponseFromProto(
    await requireFleetClient().validateManagedComputerPromotion(
      { workspaceId: workspaceId, code },
      appCallOptions(token),
    ),
  );
}

export async function applyForManagedComputer(
  token: string,
  workspaceId: string,
  input: { code: string; requestId: string },
) {
  return applyForManagedComputerResponseFromProto(
    await requireFleetClient().applyForManagedComputer(
      { workspaceId: workspaceId, code: input.code, requestId: input.requestId },
      appCallOptions(token),
    ),
  );
}

export async function retryManagedComputer(
  token: string,
  workspaceId: string,
  managedComputerId: string,
  requestId: string,
) {
  return managedComputerMutationResponseFromProto(
    await requireFleetClient().retryManagedComputer(
      { workspaceId: workspaceId, managedComputerId, requestId },
      appCallOptions(token),
    ),
  );
}

export async function retireManagedComputer(
  token: string,
  workspaceId: string,
  managedComputerId: string,
) {
  return managedComputerMutationResponseFromProto(
    await requireFleetClient().retireManagedComputer(
      { workspaceId: workspaceId, managedComputerId },
      appCallOptions(token),
    ),
  );
}

export async function terminateManagedComputer(
  token: string,
  workspaceId: string,
  managedComputerId: string,
) {
  return managedComputerMutationResponseFromProto(
    await requireFleetClient().terminateManagedComputer(
      { workspaceId: workspaceId, managedComputerId },
      appCallOptions(token),
    ),
  );
}

export async function createManagedComputerRemoteSession(
  token: string,
  workspaceId: string,
  managedComputerId: string,
  input: { requestId: string; reconnectSessionId?: string; agentId?: string },
): Promise<ManagedComputerRemoteSessionTicket> {
  return managedComputerRemoteSessionTicketFromProto(
    await requireFleetClient().createManagedComputerRemoteSession(
      {
        workspaceId: workspaceId,
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
  workspaceId: string,
  managedComputerId: string,
  input: { projectId: string; requestId: string },
): Promise<ManagedComputerSetupSessionTicket> {
  return managedComputerSetupSessionTicketFromProto(
    await requireFleetClient().createManagedComputerSetupSession(
      {
        workspaceId: workspaceId,
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
  workspaceId: string,
  managedComputerId: string,
  remoteSessionId: string,
): Promise<void> {
  await requireFleetClient().endManagedComputerRemoteSession(
    { workspaceId: workspaceId, managedComputerId, remoteSessionId },
    appCallOptions(token),
  );
}

export async function requestWorkspaceExecutionWorkerUpdate(
  token: string,
  workspaceId: string,
  deviceId: string,
) {
  return requestExecutionWorkerUpdateResponseFromProto(
    await requireFleetClient().requestExecutionWorkerUpdate(
      { workspaceId: workspaceId, deviceId },
      appCallOptions(token),
    ),
  );
}

export async function deleteWorkspaceExecutionWorker(
  token: string,
  workspaceId: string,
  deviceId: string,
): Promise<void> {
  await requireFleetClient().deleteExecutionWorker(
    {
      workspaceId: workspaceId,
      deviceId,
      requestId: `worker-deprovision:${deviceId}`,
    },
    appCallOptions(token),
  );
}

export async function updateWorkspaceExecutionWorkerConcurrency(
  token: string,
  workspaceId: string,
  deviceId: string,
  maxConcurrentSessions: number,
) {
  return executionWorkerConcurrencyResponseFromProto(
    await requireFleetClient().updateExecutionWorker(
      { workspaceId: workspaceId, deviceId, maxConcurrentSessions },
      appCallOptions(token),
    ),
  );
}

export async function updateWorkspaceExecutionWorkerIcon(
  token: string,
  workspaceId: string,
  deviceId: string,
  icon: WorkerIcon | null,
) {
  return executionWorkerIconResponseFromProto(
    await requireFleetClient().updateExecutionWorker(
      {
        workspaceId: workspaceId,
        deviceId,
        iconUpdate: executionWorkerIconUpdateFromDomain(icon),
      },
      appCallOptions(token),
    ),
  );
}
