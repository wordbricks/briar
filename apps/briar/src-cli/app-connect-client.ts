import {
  Code,
  ConnectError,
  createClient,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
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

export const appConnectTransport = (apiUrl: string) =>
  createConnectTransport({ baseUrl: apiUrl.replace(/\/+$/u, "") });

export const appConnectCallOptions = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
});

export async function fetchCurrentUser(
  apiUrl: string,
  token: string,
): Promise<NonNullable<GetCurrentUserResponse["user"]>> {
  const response = await createClient(
    AccountService,
    appConnectTransport(apiUrl),
  ).getCurrentUser({}, appConnectCallOptions(token));
  if (response.user === undefined) throw new Error("Current user is missing");
  return response.user;
}

export async function fetchProjects(
  apiUrl: string,
  token: string,
): Promise<ListProjectsResponse["projects"]> {
  return (await createClient(
    ProjectService,
    appConnectTransport(apiUrl),
  ).listProjects({}, appConnectCallOptions(token))).projects;
}

export async function fetchDashboard(
  apiUrl: string,
  token: string,
  projectId: string,
): Promise<GetDashboardResponse> {
  return createClient(
    DashboardService,
    appConnectTransport(apiUrl),
  ).getDashboard({ projectId }, appConnectCallOptions(token));
}

export async function updateRemoteProjectSettings(
  apiUrl: string,
  token: string,
  input: UpdateProjectSettingsRequest,
) {
  return createClient(
    ProjectService,
    appConnectTransport(apiUrl),
  ).updateProjectSettings(input, appConnectCallOptions(token));
}

export async function fetchManagedComputer(
  apiUrl: string,
  token: string,
  organizationId: string,
  managedComputerId: string,
) {
  const response = await createClient(
    FleetService,
    appConnectTransport(apiUrl),
  ).getManagedComputer(
    { organizationId, managedComputerId },
    appConnectCallOptions(token),
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
  const response = await createClient(
    FleetService,
    appConnectTransport(apiUrl),
  ).createManagedComputerSetupSession(
    { organizationId, managedComputerId, projectId, requestId },
    appConnectCallOptions(token),
  );
  return managedComputerSetupSessionTicketFromProto(response);
}

export async function fetchManagedComputerSetupStatus(
  apiUrl: string,
  token: string,
  organizationId: string,
  managedComputerId: string,
) {
  const response = await createClient(
    FleetService,
    appConnectTransport(apiUrl),
  ).getManagedComputerSetupStatus(
    { organizationId, managedComputerId },
    appConnectCallOptions(token),
  );
  return managedComputerSetupStatusFromProto(response);
}

export async function fetchMergeQueueProfile(
  apiUrl: string,
  token: string,
  projectId: string,
) {
  const response = await createClient(
    MergeQueueService,
    appConnectTransport(apiUrl),
  ).getMergeQueueProfile({ projectId }, appConnectCallOptions(token));
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
  const response = await createClient(
    MergeQueueService,
    appConnectTransport(apiUrl),
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
    appConnectCallOptions(token),
  );
  return mergeQueueProfileFromProto(requiredMessage(
    response.profile,
    "updateMergeQueueProfile.profile",
  ));
}

export const isUnauthenticatedConnectError = (error: unknown) =>
  error instanceof ConnectError && error.code === Code.Unauthenticated;
