import {
  Code,
  ConnectError,
} from "@connectrpc/connect";
import {
  AccountService,
  type GetCurrentUserResponse,
} from "@briar/contracts/gen/briar/app/v1/account_pb";
import {
  DashboardService,
  type GetDashboardResponse,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { FleetService } from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import { MergeQueueService } from "@briar/contracts/gen/briar/app/v1/merge_queue_pb";
import {
  ProjectService,
  type ListProjectsResponse,
  type UpdateProjectSettingsRequest,
} from "@briar/contracts/gen/briar/app/v1/project_pb";
import {
  managedComputerFromProto,
  managedComputerSetupSessionTicketFromProto,
  managedComputerSetupStatusFromProto,
} from "../src/lib/app-rpc/fleet-mappers";
import {
  mergeQueueProfileFromProto,
  mergeQueueQuietWindowToProto,
} from "../src/lib/app-rpc/merge-queue-mappers";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import { createAuthenticatedConnectClient } from "./connect-client";

export async function fetchCurrentUser(
  apiUrl: string,
  token: string,
): Promise<NonNullable<GetCurrentUserResponse["user"]>> {
  const response = await createAuthenticatedConnectClient(
    AccountService,
    apiUrl,
    token,
  ).getCurrentUser({});
  if (response.user === undefined) throw new Error("Current user is missing");
  return response.user;
}

export async function fetchProjects(
  apiUrl: string,
  token: string,
): Promise<ListProjectsResponse["projects"]> {
  return (await createAuthenticatedConnectClient(
    ProjectService,
    apiUrl,
    token,
  ).listProjects({})).projects;
}

export async function fetchDashboard(
  apiUrl: string,
  token: string,
  projectId: string,
): Promise<GetDashboardResponse> {
  return createAuthenticatedConnectClient(
    DashboardService,
    apiUrl,
    token,
  ).getDashboard({ projectId });
}

export async function updateRemoteProjectSettings(
  apiUrl: string,
  token: string,
  input: UpdateProjectSettingsRequest,
) {
  return createAuthenticatedConnectClient(
    ProjectService,
    apiUrl,
    token,
  ).updateProjectSettings(input);
}

export async function fetchManagedComputer(
  apiUrl: string,
  token: string,
  organizationId: string,
  managedComputerId: string,
) {
  const response = await createAuthenticatedConnectClient(
    FleetService,
    apiUrl,
    token,
  ).getManagedComputer(
    { organizationId, managedComputerId },
  );
  return managedComputerFromProto(
    requiredMessage(response.computer, "managedComputer"),
  );
}

export async function createManagedComputerSetupSession(
  apiUrl: string,
  token: string,
  organizationId: string,
  managedComputerId: string,
  projectId: string,
  requestId: string,
) {
  const response = await createAuthenticatedConnectClient(
    FleetService,
    apiUrl,
    token,
  ).createManagedComputerSetupSession(
    { organizationId, managedComputerId, projectId, requestId },
  );
  return managedComputerSetupSessionTicketFromProto(response);
}

export async function fetchManagedComputerSetupStatus(
  apiUrl: string,
  token: string,
  organizationId: string,
  managedComputerId: string,
) {
  const response = await createAuthenticatedConnectClient(
    FleetService,
    apiUrl,
    token,
  ).getManagedComputerSetupStatus(
    { organizationId, managedComputerId },
  );
  return managedComputerSetupStatusFromProto(response);
}

export async function fetchMergeQueueProfile(
  apiUrl: string,
  token: string,
  projectId: string,
) {
  const response = await createAuthenticatedConnectClient(
    MergeQueueService,
    apiUrl,
    token,
  ).getMergeQueueProfile({ projectId });
  return response.profile
    ? mergeQueueProfileFromProto(response.profile)
    : null;
}

export async function updateRemoteMergeQueueProfile(
  apiUrl: string,
  token: string,
  input: {
    projectId: string;
    enabled: boolean;
    readinessStageId?: string;
    quietWindowMs?: number;
    maxBatchSize?: number;
  },
) {
  const response = await createAuthenticatedConnectClient(
    MergeQueueService,
    apiUrl,
    token,
  ).updateMergeQueueProfile(
    {
      projectId: input.projectId,
      enabled: input.enabled,
      readinessStageId: input.readinessStageId,
      quietWindow: input.quietWindowMs === undefined
        ? undefined
        : mergeQueueQuietWindowToProto(input.quietWindowMs),
      maxBatchSize: input.maxBatchSize,
    },
  );
  return mergeQueueProfileFromProto(requiredMessage(
    response.profile,
    "updateMergeQueueProfile.profile",
  ));
}

export const isUnauthenticatedConnectError = (error: unknown) =>
  error instanceof ConnectError && error.code === Code.Unauthenticated;
