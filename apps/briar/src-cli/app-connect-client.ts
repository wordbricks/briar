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
import {
  ProjectService,
  type ListProjectsResponse,
} from "@briar/contracts/gen/briar/app/v1/project_pb";

const transport = (apiUrl: string) =>
  createConnectTransport({ baseUrl: apiUrl.replace(/\/+$/u, "") });

const callOptions = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
});

export async function fetchCurrentUser(
  apiUrl: string,
  token: string,
): Promise<NonNullable<GetCurrentUserResponse["user"]>> {
  const response = await createClient(
    AccountService,
    transport(apiUrl),
  ).getCurrentUser({}, callOptions(token));
  if (response.user === undefined) throw new Error("Current user is missing");
  return response.user;
}

export async function fetchProjects(
  apiUrl: string,
  token: string,
): Promise<ListProjectsResponse["projects"]> {
  return (await createClient(
    ProjectService,
    transport(apiUrl),
  ).listProjects({}, callOptions(token))).projects;
}

export async function fetchDashboard(
  apiUrl: string,
  token: string,
  projectId: string,
): Promise<GetDashboardResponse> {
  return createClient(
    DashboardService,
    transport(apiUrl),
  ).getDashboard({ projectId }, callOptions(token));
}

export const isUnauthenticatedConnectError = (error: unknown) =>
  error instanceof ConnectError && error.code === Code.Unauthenticated;
