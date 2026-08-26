import { briarApiUrl, briarWebAppOrigin } from "./api-config";
export { briarApiUrl } from "./api-config";
import { ApiError, isApiErrorStatus } from "./api/errors";
export {
  ApiError,
  ApiResponseDecodeError,
  apiErrorIssueMessages,
  errorWithMessage,
  isApiErrorStatus,
} from "./api/errors";
import { request } from "./api/request";
export {
  deleteAccount,
  loadSession,
  updateAccountProfile,
} from "./api/account";
import { decodeInboxReadVersions } from "./api/inbox-contract";
import {
  decodeOrganizationResponse,
  decodeOrganizationsResponse,
} from "./api/organization-contract";
import {
  decodeClaimedProjectAgentScheduleRunResponse,
  decodeLeaseExpirationResponse,
  decodeProjectAgentResponse,
  decodeProjectAgentScheduleResponse,
  decodeProjectAgentScheduleRunResponse,
  decodeProjectAgentScheduleRunsResponse,
  decodeProjectAgentSchedulesResponse,
  decodeProjectAgentSessionResponse,
  decodeProjectAgentSessionSyncResponse,
  decodeProjectAgentsResponse,
} from "./api/project-agent-contract";
import {
  decodeProjectResponse,
  decodeProjectsResponse,
  decodeProjectUsageSummaryResponse,
} from "./api/project-contract";
import type { StructuredAgentResult } from "./agent-result";
import { validateIssueAttachments } from "./issue-attachments";
import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
} from "./auto-hunt-contract";
import type { ProjectAgentLocale } from "./project-agent";
import type { ModelEffort } from "./agent-provider-contract";
import type { AgentProvider } from "./agent-provider";
import type { UsageRangeDays } from "./agent-usage-overview";
import type {
  ProjectUsageDateRange,
  ProjectUsagePeriod,
} from "./project-usage-summary";
import { LITELLM_MAIN_PRICING_SOURCE } from "./agent-usage-pricing";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { InboxMessage } from "../hooks/useInbox";
import type {
  ChannelAgentReply,
  ChannelAgentSkillInput,
  ChannelAgentSummary,
  ChannelDelta,
  ChannelMember,
  ChannelMessage,
  ChannelMessageAttachment,
  ChannelMessageDocumentContent,
  DeleteChannelMessageResponse,
  ChannelExecutionProposal,
  ChannelSummary,
  ChannelVisibility,
  ChannelWebhook,
} from "./channels-contract";
import type {
  LinearImportConnectResult,
  LinearImportResult,
  LinearImportStatesResult,
} from "./linear-import";
import type {
  CreateIssueInput,
  CreateProjectAgentInput,
  CreateProjectAgentScheduleInput,
  AgentUsageReport,
  AgentExecutionCostEstimate,
  DashboardPayload,
  DashboardDeltaPayload,
  ExecutionWorker,
  OrganizationExecutionWorker,
  ManagedComputer,
  ManagedComputerProduct,
  ManagedComputerRemoteSessionTicket,
  MergeQueueProfile,
  MergeQueueStatus,
  ProjectExecutionWorkerPolicy,
  HuntRunPlacement,
  HuntEvent,
  IssueAttachment,
  IssueAgentReplyState,
  IssueConversationDelta,
  IssueConversationSnapshot,
  IssueMessage,
  IssueProposedAction,
  IssueExecutionPreferences,
  IssueExecutionApprovalInput,
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  IssueExecutionProposal,
  IssueResultReview,
  ClaimedProjectAgentScheduleRun,
  Project,
  ProjectAgent,
  ProjectAgentSchedule,
  ProjectAgentScheduleRun,
  Organization,
  OrganizationInvitation,
  OrganizationInvitationPreview,
  OrganizationMember,
  ProjectSettings,
  ProjectUsageSummary,
  RunEvidence,
  RunEvidenceImage,
  StatusTrayRunsPayload,
  UpdateProjectAgentInput,
  UpdateProjectAgentScheduleInput,
  UpdateIssueInput,
  UpdateIssueResult,
  WorkerIcon,
} from "../types";

const apiUrl = briarApiUrl;

const normalizeDashboardWorkflow = (workflow: AutoHuntWorkflow) =>
  normalizeAutoHuntWorkflow(workflow);

export const isApiConfigured = Boolean(apiUrl);

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
};

export type DeviceClientId =
  | "briar-mobile"
  | "briar-android"
  | "briar-desktop"
  | "briar-web";

export type DeviceLoginMethod = "email" | "google";

export async function beginDeviceAuthorization(
  clientId: DeviceClientId = "briar-desktop",
  options: {
    method?: DeviceLoginMethod;
    locale?: "ko" | "en" | "zh";
    switchAccount?: boolean;
  } = {},
): Promise<DeviceAuthorization> {
  const response = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval?: number;
  }>("/api/auth/device/code", null, {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId,
      scope: "openid profile email",
    }),
  });
  const verificationUrl =
    response.verification_uri_complete ?? response.verification_uri;
  const clientVerificationUrl = new URL(verificationUrl);
  if (clientId === "briar-mobile" || clientId === "briar-android") {
    clientVerificationUrl.searchParams.set("client", "mobile");
  } else if (clientId === "briar-web") {
    clientVerificationUrl.searchParams.set("client", "web");
  }
  if (options.method) {
    clientVerificationUrl.searchParams.set("method", options.method);
  }
  if (options.locale) {
    clientVerificationUrl.searchParams.set("locale", options.locale);
  }
  if (options.switchAccount) {
    clientVerificationUrl.searchParams.set("switch_account", "1");
  }
  return {
    deviceCode: response.device_code,
    userCode: response.user_code,
    verificationUrl: clientVerificationUrl.toString(),
    interval: response.interval ?? 5,
  };
}

type DeviceTokenResponse = {
  access_token?: string;
  error?:
    "authorization_pending" | "slow_down" | "access_denied" | "expired_token";
  error_description?: string;
};

export async function pollDeviceToken(
  deviceCode: string,
  clientId: DeviceClientId = "briar-desktop",
): Promise<DeviceTokenResponse> {
  try {
    return await request<DeviceTokenResponse>("/api/auth/device/token", null, {
      method: "POST",
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: clientId,
      }),
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const message = error.message.toLowerCase();
    if (message.includes("pending")) return { error: "authorization_pending" };
    if (message.includes("slow")) return { error: "slow_down" };
    throw error;
  }
}

export type InboxFeedSyncState = {
  etag: string | null;
};

export type InboxFeedSyncResult = {
  state: InboxFeedSyncState;
  notModified: boolean;
  messages: InboxMessage[];
  subscribedIssueIds?: string[];
};

export async function loadInboxFeed(
  token: string,
  organizationId: string,
  state: InboxFeedSyncState | null = null,
  signal?: AbortSignal,
): Promise<InboxFeedSyncResult> {
  if (!apiUrl) throw new Error("Briar API URL이 설정되지 않았습니다.");
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });
  if (state?.etag) headers.set("If-None-Match", state.etag);
  const response = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/inbox`,
    { headers, signal },
  );
  if (response.status === 304 && state) {
    return {
      state: { etag: response.headers.get("ETag") ?? state.etag },
      notModified: true,
      messages: [],
    };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.message ?? `Briar API 요청 실패 (${response.status})`,
      body?.code,
      Array.isArray(body?.issues) ? body.issues : undefined,
    );
  }
  const result = await response.json() as {
    messages?: InboxMessage[];
    subscribedIssueIds?: string[];
  };
  return {
    state: { etag: response.headers.get("ETag") },
    notModified: false,
    messages: Array.isArray(result.messages) ? result.messages : [],
    subscribedIssueIds: Array.isArray(result.subscribedIssueIds)
      ? result.subscribedIssueIds.filter(
          (runId): runId is string => typeof runId === "string",
        )
      : undefined,
  };
}

export async function loadInboxReadStates(
  token: string,
): Promise<Record<string, string>> {
  const result = await request<{ readVersions?: unknown }>(
    "/inbox/read-states",
    token,
  );
  return decodeInboxReadVersions(result.readVersions ?? {});
}

export async function saveInboxReadStates(
  token: string,
  readVersions: Record<string, string>,
): Promise<Record<string, string>> {
  const result = await request<{ readVersions?: unknown }>(
    "/inbox/read-states",
    token,
    {
      method: "PUT",
      body: JSON.stringify({ readVersions }),
    },
  );
  return decodeInboxReadVersions(result.readVersions ?? {});
}

export async function deleteInboxReadState(
  token: string,
  messageId: string,
): Promise<Record<string, string>> {
  const result = await request<{ readVersions?: unknown }>(
    "/inbox/read-states",
    token,
    {
      method: "DELETE",
      body: JSON.stringify({ messageId }),
    },
  );
  return decodeInboxReadVersions(result.readVersions ?? {});
}

export async function loadProjects(token: string): Promise<Project[]> {
  const result = await request<{ projects: unknown[] }>("/projects", token);
  return decodeProjectsResponse(result.projects);
}

export async function loadOrganizations(
  token: string,
): Promise<Organization[]> {
  const result = await request<{ organizations: unknown[] }>(
    "/organizations",
    token,
  );
  return decodeOrganizationsResponse(result.organizations);
}

export async function createOrganization(
  token: string,
  input: { name: string; handle: string },
): Promise<{ organization: Organization }> {
  const result = await request<{ organization: unknown }>(
    "/organizations",
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return { organization: decodeOrganizationResponse(result.organization) };
}

export async function isOrganizationHandleAvailable(
  token: string,
  handle: string,
) {
  const result = await request<{ available: boolean }>(
    `/organizations/handle-availability?handle=${encodeURIComponent(handle)}`,
    token,
  );
  return result.available;
}

export async function updateOrganization(
  token: string,
  organizationId: string,
  name: string,
) {
  return request<{ organization: Organization }>(
    `/organizations/${organizationId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ name }),
    },
  );
}

export async function updateOrganizationLogo(
  token: string,
  organizationId: string,
  logo: string | null,
): Promise<{ organization: Organization }> {
  const result = await request<{ organization: unknown }>(
    `/organizations/${organizationId}/logo`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ logo }),
    },
  );
  return { organization: decodeOrganizationResponse(result.organization) };
}

export async function loadOrganizationMembers(
  token: string,
  organizationId: string,
) {
  const result = await request<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members`,
    token,
  );
  return result.members;
}

export async function loadOrganizationInvitations(
  token: string,
  organizationId: string,
) {
  const result = await request<{ invitations: OrganizationInvitation[] }>(
    `/organizations/${organizationId}/invitations`,
    token,
  );
  return result.invitations;
}

export async function createOrganizationInvitation(
  token: string,
  organizationId: string,
  input: {
    email: string;
    role: "admin" | "member";
    initialProjectId: string;
  },
) {
  const result = await request<{
    invitation: OrganizationInvitation;
    invitePath: string;
  }>(`/organizations/${organizationId}/invitations`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const appOrigin = briarWebAppOrigin || "https://briar.wordbricks.ai";
  return {
    invitation: result.invitation,
    inviteUrl: new URL(result.invitePath, appOrigin).toString(),
  };
}

export async function revokeOrganizationInvitation(
  token: string,
  organizationId: string,
  invitationId: string,
) {
  return request<void>(
    `/organizations/${organizationId}/invitations/${invitationId}`,
    token,
    { method: "DELETE" },
  );
}

export async function loadOrganizationInvitation(token: string) {
  return request<{ invitation: OrganizationInvitationPreview }>(
    `/invitations/${encodeURIComponent(token)}`,
    null,
  );
}

export async function acceptOrganizationInvitation(
  sessionToken: string,
  invitationToken: string,
) {
  return request<{
    invitation: OrganizationInvitation;
    alreadyAccepted: boolean;
  }>(`/invitations/${encodeURIComponent(invitationToken)}`, sessionToken, {
    method: "POST",
  });
}

export async function loadOrganizationExecutionWorkers(
  token: string,
  organizationId: string,
) {
  return request<{
    workers: OrganizationExecutionWorker[];
    latestVersion?: string | null;
    canManage: boolean;
    generatedAt: string;
  }>(`/organizations/${organizationId}/workers`, token);
}

export async function loadManagedComputerProduct(
  token: string,
  organizationId: string,
) {
  return request<ManagedComputerProduct>(
    `/organizations/${organizationId}/managed-computers/product`,
    token,
  );
}

export async function loadManagedComputers(
  token: string,
  organizationId: string,
) {
  return request<{ computers: ManagedComputer[]; generatedAt: string }>(
    `/organizations/${organizationId}/managed-computers`,
    token,
  );
}

export async function validateManagedComputerPromotion(
  token: string,
  organizationId: string,
  code: string,
) {
  return request<{
    valid: boolean;
    eligible: boolean;
    totalCents: number;
    currency: "USD";
    applicationsEnabled: boolean;
    limitReason: "user" | "organization" | "fleet" | null;
  }>(
    `/organizations/${organizationId}/managed-computers/promotion/validate`,
    token,
    { method: "POST", body: JSON.stringify({ code }) },
  );
}

export async function applyForManagedComputer(
  token: string,
  organizationId: string,
  input: { code: string; requestId: string },
) {
  return request<{
    computer: ManagedComputer;
    duplicate: boolean;
    entitlement: {
      source: "free_promotion";
      totalCents: 0;
      currency: "USD";
    };
  }>(`/organizations/${organizationId}/managed-computers`, token, {
    method: "POST",
    headers: { "Idempotency-Key": input.requestId },
    body: JSON.stringify(input),
  });
}

export async function retryManagedComputer(
  token: string,
  organizationId: string,
  managedComputerId: string,
  requestId: string,
) {
  return request<{ computer: ManagedComputer; duplicate: boolean }>(
    `/organizations/${organizationId}/managed-computers/${managedComputerId}/retry`,
    token,
    {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      body: JSON.stringify({ requestId }),
    },
  );
}

export async function retireManagedComputer(
  token: string,
  organizationId: string,
  managedComputerId: string,
) {
  return request<{ computer: ManagedComputer; duplicate: boolean }>(
    `/organizations/${organizationId}/managed-computers/${managedComputerId}`,
    token,
    { method: "DELETE" },
  );
}

export async function createManagedComputerRemoteSession(
  token: string,
  organizationId: string,
  managedComputerId: string,
  input: { requestId: string; reconnectSessionId?: string },
) {
  return request<ManagedComputerRemoteSessionTicket>(
    `/organizations/${organizationId}/managed-computers/${managedComputerId}/remote-sessions`,
    token,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.requestId },
      body: JSON.stringify(input),
    },
  );
}

export async function endManagedComputerRemoteSession(
  token: string,
  organizationId: string,
  managedComputerId: string,
  remoteSessionId: string,
) {
  return request<void>(
    `/organizations/${organizationId}/managed-computers/${managedComputerId}/remote-sessions/${remoteSessionId}`,
    token,
    { method: "DELETE" },
  );
}

export async function requestOrganizationExecutionWorkerUpdate(
  token: string,
  organizationId: string,
  deviceId: string,
) {
  return request<{
    outcome: "requested" | "already_current";
    requestId?: string;
    targetVersion: string;
  }>(
    `/organizations/${organizationId}/workers/${encodeURIComponent(deviceId)}/updates`,
    token,
    { method: "POST" },
  );
}

export async function deleteOrganizationExecutionWorker(
  token: string,
  organizationId: string,
  deviceId: string,
) {
  return request<void>(
    `/organizations/${organizationId}/workers/${encodeURIComponent(deviceId)}`,
    token,
    {
      method: "DELETE",
      headers: { "Idempotency-Key": `worker-deprovision:${deviceId}` },
    },
  );
}

export async function updateOrganizationExecutionWorkerConcurrency(
  token: string,
  organizationId: string,
  deviceId: string,
  maxConcurrentSessions: number,
) {
  return request<{ deviceId: string; maxConcurrentSessions: number }>(
    `/organizations/${organizationId}/workers/${encodeURIComponent(deviceId)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ maxConcurrentSessions }),
    },
  );
}

export async function updateOrganizationExecutionWorkerIcon(
  token: string,
  organizationId: string,
  deviceId: string,
  icon: WorkerIcon | null,
) {
  return request<{ deviceId: string; icon: WorkerIcon | null }>(
    `/organizations/${organizationId}/workers/${encodeURIComponent(deviceId)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ icon }),
    },
  );
}

export async function addOrganizationMember(
  token: string,
  organizationId: string,
  input: { email: string; role: "admin" | "member" },
) {
  return request<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function updateOrganizationMemberRole(
  token: string,
  organizationId: string,
  userId: string,
  role: "admin" | "member",
) {
  return request<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members/${encodeURIComponent(userId)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
}

export async function updateOrganizationMemberProjects(
  token: string,
  organizationId: string,
  userId: string,
  projectIds: string[],
) {
  return request<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members/${encodeURIComponent(userId)}/projects`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ projectIds }),
    },
  );
}

export async function removeOrganizationMember(
  token: string,
  organizationId: string,
  userId: string,
) {
  return request<void>(
    `/organizations/${organizationId}/members/${encodeURIComponent(userId)}`,
    token,
    { method: "DELETE" },
  );
}

export type GithubIntegrationRepository = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  private?: boolean;
};

export type GithubIntegration = {
  configured: boolean;
  canManage: boolean;
  connected: boolean;
  installationId: string | number | null;
  accountLogin: string | null;
  accountAvatarUrl: string | null;
  repositories: GithubIntegrationRepository[];
  connectedAt: string | null;
};

const githubIntegrationPath = (organizationId: string) =>
  `/organizations/${organizationId}/integrations/github`;

export async function loadGithubIntegration(
  token: string,
  organizationId: string,
) {
  const result = await request<{
    configured: boolean;
    canManage: boolean;
    connected: boolean;
    installationId?: string | number | null;
    accountLogin?: string | null;
    accountAvatarUrl?: string | null;
    repositories?: Array<{
      id: string | number;
      owner: string;
      name: string;
      fullName: string;
      private?: boolean;
    }>;
    connectedAt?: string | null;
  }>(
    githubIntegrationPath(organizationId),
    token,
  );
  return {
    ...result,
    installationId: result.installationId ?? null,
    accountLogin: result.accountLogin ?? null,
    accountAvatarUrl: result.accountAvatarUrl ?? null,
    repositories: (result.repositories ?? []).map((repository) => ({
      ...repository,
      id: String(repository.id),
    })),
    connectedAt: result.connectedAt ?? null,
  } satisfies GithubIntegration;
}

export async function createGithubInstallUrl(
  token: string,
  organizationId: string,
) {
  return request<{ installUrl: string }>(
    `${githubIntegrationPath(organizationId)}/install-url`,
    token,
    { method: "POST" },
  );
}

const normalizeDashboardRuns = (runs: DashboardPayload["runs"]) =>
  runs.map((run) => ({
    ...run,
    workflow: normalizeDashboardWorkflow(run.workflow),
    resultReviews: run.resultReviews ?? [],
    currentRevision:
      Number.isInteger(run.currentRevision) && run.currentRevision >= 1
        ? run.currentRevision
        : 1,
  }));

export async function loadDashboard(
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<DashboardPayload> {
  const dashboard = await request<DashboardPayload>(
    `/projects/${projectId}/dashboard`,
    token,
    { signal },
  );
  return {
    ...dashboard,
    settings: {
      ...dashboard.settings,
      workflow: normalizeDashboardWorkflow(dashboard.settings.workflow),
    },
    runs: normalizeDashboardRuns(dashboard.runs),
  };
}

export async function loadAgentUsageReport(
  token: string,
  organizationId: string,
  days: UsageRangeDays = 90,
  signal?: AbortSignal,
): Promise<AgentUsageReport> {
  const result = await request<
    Omit<AgentUsageReport, "pricing"> & {
      pricing?: AgentUsageReport["pricing"];
    }
  >(
    `/organizations/${encodeURIComponent(organizationId)}/usage/runs?days=${days}`,
    token,
    { signal },
  );
  return {
    ...result,
    pricing: result.pricing ?? {
      status: "unavailable",
      source: LITELLM_MAIN_PRICING_SOURCE,
      fetchedAt: null,
      knownModels: 0,
    },
  };
}

export async function loadProjectUsageSummary(
  token: string,
  projectId: string,
  period: ProjectUsagePeriod = "day",
  range?: ProjectUsageDateRange,
  signal?: AbortSignal,
): Promise<ProjectUsageSummary> {
  const search = new URLSearchParams({ period });
  if (range) {
    search.set("from", range.from);
    search.set("to", range.to);
  }
  return decodeProjectUsageSummaryResponse(await request<ProjectUsageSummary>(
    `/projects/${encodeURIComponent(projectId)}/usage/summary?${search}`,
    token,
    { signal },
  ));
}

export async function loadDashboardDelta(
  token: string,
  projectId: string,
  cursor: number,
  signal?: AbortSignal,
): Promise<DashboardDeltaPayload> {
  const delta = await request<DashboardDeltaPayload>(
    `/projects/${projectId}/dashboard/delta?cursor=${cursor}`,
    token,
    { signal },
  );
  return { ...delta, runs: normalizeDashboardRuns(delta.runs) };
}

export async function loadStatusTrayRuns(
  token: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<StatusTrayRunsPayload> {
  return request<StatusTrayRunsPayload>(
    `/organizations/${encodeURIComponent(organizationId)}/status-tray/runs`,
    token,
    { signal },
  );
}

export async function loadRunCostEstimate(
  token: string,
  projectId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<AgentExecutionCostEstimate> {
  return request<AgentExecutionCostEstimate>(
    `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/cost-estimate`,
    token,
    { signal },
  );
}

export async function loadRunEvents(
  token: string,
  projectId: string,
  runId: string,
): Promise<HuntEvent[]> {
  const result = await request<{ events: HuntEvent[] }>(
    `/projects/${projectId}/runs/${runId}/events`,
    token,
  );
  return result.events.map((event) => ({
    ...event,
    actorName: event.actorName ?? null,
    revision:
      Number.isInteger(event.revision) && event.revision >= 1
        ? event.revision
        : 1,
  }));
}

export type ProjectAgentTranscript = {
  session: {
    sessionId: string;
    runId: string | null;
    workerId: string | null;
    agentProvider: AgentProvider;
    startedAt: string;
    lastEventAt: string;
    eventCount: number;
    projection?: "worklog";
  };
  events: Array<{
    sequence: number;
    direction: "client" | "server";
    message: unknown;
    recordedAt: string;
  }>;
};

export async function loadProjectAgentTranscript(
  token: string,
  projectId: string,
  sessionId: string,
  afterSequence = 0,
): Promise<ProjectAgentTranscript> {
  return request<ProjectAgentTranscript>(
    `/projects/${projectId}/sessions/${encodeURIComponent(sessionId)}/transcript?afterSequence=${afterSequence}`,
    token,
  );
}

export async function createProject(
  token: string,
  input: { name: string; organizationId?: string },
) {
  return request<{ project: Project; agentToken: string }>("/projects", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteProject(token: string, projectId: string) {
  return request<void>(`/projects/${projectId}`, token, { method: "DELETE" });
}

export async function updateProjectIcon(
  token: string,
  projectId: string,
  icon: string | null,
): Promise<{ project: Project }> {
  const result = await request<{ project: unknown }>(
    `/projects/${projectId}/icon`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ icon }),
    },
  );
  return { project: decodeProjectResponse(result.project) };
}

export async function updateProjectIssueKeyPrefix(
  token: string,
  projectId: string,
  issueKeyPrefix: string,
): Promise<{ project: Project }> {
  const result = await request<{ project: unknown }>(
    `/projects/${projectId}/issue-key-prefix`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ issueKeyPrefix }),
    },
  );
  return { project: decodeProjectResponse(result.project) };
}

export async function updateProjectTabs(
  token: string,
  projectId: string,
  tabs: { schedule: boolean },
): Promise<{ project: Project }> {
  const result = await request<{ project: unknown }>(
    `/projects/${projectId}/tabs`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(tabs),
    },
  );
  return { project: decodeProjectResponse(result.project) };
}

export async function loadProjectAgents(
  token: string,
  projectId: string,
  locale: ProjectAgentLocale,
): Promise<ProjectAgent[]> {
  const result = await request<{ agents: unknown[] }>(
    `/projects/${projectId}/agents?locale=${encodeURIComponent(locale)}`,
    token,
  );
  return decodeProjectAgentsResponse(result.agents);
}

export type ProjectAgentSessionSyncState = {
  cursor: number;
  etag: string | null;
};

export type ProjectAgentSessionSyncResult = {
  state: ProjectAgentSessionSyncState;
  hasMore: boolean;
  reset: boolean;
  notModified: boolean;
  sessions: AutoHuntSession[];
  deletedSessionIds: string[];
};

export async function loadProjectAgentSessionChanges(
  token: string,
  projectId: string,
  state: ProjectAgentSessionSyncState | null,
): Promise<ProjectAgentSessionSyncResult> {
  if (!apiUrl) throw new Error("Briar API URL이 설정되지 않았습니다.");
  const query = state ? `?cursor=${state.cursor}` : "";
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });
  if (state?.etag) headers.set("If-None-Match", state.etag);
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/agent-sessions/changes${query}`,
    { headers },
  );
  if (response.status === 304 && state) {
    return {
      state: {
        cursor: state.cursor,
        etag: response.headers.get("ETag") ?? state.etag,
      },
      hasMore: false,
      reset: false,
      notModified: true,
      sessions: [],
      deletedSessionIds: [],
    };
  }
  if (response.status === 410 && state) {
    return loadProjectAgentSessionChanges(token, projectId, null);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.message ?? `Briar API 요청 실패 (${response.status})`,
      body?.code,
      Array.isArray(body?.issues) ? body.issues : undefined,
    );
  }
  const result = decodeProjectAgentSessionSyncResponse(await response.json());
  return {
    state: {
      cursor: result.cursor,
      etag: response.headers.get("ETag"),
    },
    hasMore: result.hasMore,
    reset: result.reset,
    notModified: false,
    sessions: result.sessions.map((session) => ({
      ...session,
      localOwner: false,
    } as AutoHuntSession)),
    deletedSessionIds: result.deletedSessionIds,
  };
}

export async function loadProjectAgentSession(
  token: string,
  projectId: string,
  sessionId: string,
): Promise<AutoHuntSession> {
  const result = await request<{ session: unknown }>(
    `/projects/${projectId}/agent-sessions/${encodeURIComponent(sessionId)}`,
    token,
  );
  return {
    ...decodeProjectAgentSessionResponse(result.session),
    localOwner: false,
  } as AutoHuntSession;
}

export async function runProjectAgentTaskOnWorker(
  token: string,
  projectId: string,
  input: {
    agentId: string;
    request: string;
    workerId: string;
    skillId: string;
  },
): Promise<AutoHuntSession> {
  const result = await request<{ session: unknown }>(
    `/projects/${projectId}/agent-tasks`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        // Project Agent IDs are persisted as lowercase UUID strings and the
        // Worker uses case-sensitive lookups. Keep shared clients canonical.
        agentId: input.agentId.toLowerCase(),
        requestId: crypto.randomUUID(),
      }),
    },
  );
  return {
    ...decodeProjectAgentSessionResponse(result.session),
    localOwner: false,
  } as AutoHuntSession;
}

export async function upsertProjectAgentSession(
  token: string,
  session: AutoHuntSession,
): Promise<AutoHuntSession> {
  const result = await request<{ session: unknown }>(
    `/projects/${session.projectId}/agent-sessions/${encodeURIComponent(session.id)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        dispatchGroupId: session.dispatchGroupId,
        agentId: session.agentId ?? null,
        agentName: session.agentName ?? null,
        skillId: session.skillId ?? null,
        sessionType: session.sessionType ?? "dispatch",
        trigger: session.trigger ?? null,
        scheduleId: session.scheduleId ?? null,
        scheduleRunId: session.scheduleRunId ?? null,
        parentSessionId: session.parentSessionId ?? null,
        request: session.request ?? null,
        followUps: session.followUps ?? [],
        status: session.status,
        issues: session.issues,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        conversationId: session.conversationId,
        requestedWorkerId: session.requestedWorkerId ?? null,
        workerId: session.workerId ?? null,
        summary: session.summary,
        error: session.error,
        events: session.events,
        updatedAt:
          session.updatedAt ?? session.completedAt ?? session.startedAt,
      }),
    },
  );
  return {
    ...decodeProjectAgentSessionResponse(result.session),
    localOwner: session.localOwner,
    workspaceRoot: session.workspaceRoot,
    dispatchEvents: session.dispatchEvents,
    workers: session.workers,
  } as AutoHuntSession;
}

export async function createProjectAgent(
  token: string,
  projectId: string,
  input: CreateProjectAgentInput,
): Promise<ProjectAgent> {
  const result = await request<{ agent: unknown }>(
    `/projects/${projectId}/agents`,
    token,
    {
      method: "POST",
      body: JSON.stringify(projectAgentInputJson(input)),
    },
  );
  return decodeProjectAgentResponse(result.agent);
}

export async function loadProjectAgentSchedules(
  token: string,
  projectId: string,
): Promise<ProjectAgentSchedule[]> {
  const result = await request<{ schedules: unknown[] }>(
    `/projects/${projectId}/agent-schedules`,
    token,
  );
  return decodeProjectAgentSchedulesResponse(result.schedules);
}

export async function createProjectAgentSchedule(
  token: string,
  projectId: string,
  input: CreateProjectAgentScheduleInput,
): Promise<ProjectAgentSchedule> {
  const result = await request<{ schedule: unknown }>(
    `/projects/${projectId}/agent-schedules`,
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return decodeProjectAgentScheduleResponse(result.schedule);
}

export async function updateProjectAgentSchedule(
  token: string,
  projectId: string,
  scheduleId: string,
  input: UpdateProjectAgentScheduleInput,
): Promise<ProjectAgentSchedule> {
  const result = await request<{ schedule: unknown }>(
    `/projects/${projectId}/agent-schedules/${scheduleId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return decodeProjectAgentScheduleResponse(result.schedule);
}

export async function deleteProjectAgentSchedule(
  token: string,
  projectId: string,
  scheduleId: string,
) {
  try {
    return await request<void>(
      `/projects/${projectId}/agent-schedules/${scheduleId}`,
      token,
      { method: "DELETE" },
    );
  } catch (error) {
    // Deletion is idempotent: a stale client should still be able to remove an
    // entry that was already deleted by another request or cascading cleanup.
    if (isApiErrorStatus(error, 404)) return;
    throw error;
  }
}

export async function loadProjectAgentScheduleRuns(
  token: string,
  projectId: string,
): Promise<ProjectAgentScheduleRun[]> {
  const result = await request<{ runs: unknown[] }>(
    `/projects/${projectId}/agent-schedule-runs`,
    token,
  );
  return decodeProjectAgentScheduleRunsResponse(result.runs);
}

export async function claimProjectAgentScheduleRuns(
  token: string,
  projectIds: readonly string[],
): Promise<ClaimedProjectAgentScheduleRun | null> {
  const uniqueProjectIds = [...new Set(projectIds)];
  for (let offset = 0; offset < uniqueProjectIds.length; offset += 100) {
    const result = await request<{ run: unknown }>(
      "/agent-schedule-runs/claim",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          projectIds: uniqueProjectIds.slice(offset, offset + 100),
        }),
      },
    );
    if (result.run !== null) {
      return decodeClaimedProjectAgentScheduleRunResponse(result.run);
    }
  }
  return null;
}

export async function completeProjectAgentScheduleRun(
  token: string,
  projectId: string,
  runId: string,
  input:
    | {
        claimToken: string;
        status: "completed";
        resultSummary: string;
        structuredResult: StructuredAgentResult;
      }
    | {
        claimToken: string;
        status: "failed";
        error: string;
        structuredResult: StructuredAgentResult;
      },
): Promise<ProjectAgentScheduleRun> {
  const result = await request<{ run: unknown }>(
    `/projects/${projectId}/agent-schedule-runs/${runId}/complete`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        claimToken: input.claimToken,
        status: input.status,
        resultSummary:
          input.status === "completed" ? input.resultSummary : null,
        structuredResult: input.structuredResult,
        error: input.status === "failed" ? input.error : null,
      }),
    },
  );
  return decodeProjectAgentScheduleRunResponse(result.run);
}

export async function renewProjectAgentScheduleRun(
  token: string,
  projectId: string,
  runId: string,
  claimToken: string,
) {
  const result = await request<{ leaseExpiresAt: unknown }>(
    `/projects/${projectId}/agent-schedule-runs/${runId}/renew`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ claimToken }),
    },
  );
  return decodeLeaseExpirationResponse(result.leaseExpiresAt);
}

export async function updateProjectAgent(
  token: string,
  projectId: string,
  agentId: string,
  input: UpdateProjectAgentInput,
): Promise<ProjectAgent> {
  const result = await request<{ agent: unknown }>(
    `/projects/${projectId}/agents/${agentId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(projectAgentInputJson(input)),
    },
  );
  return decodeProjectAgentResponse(result.agent);
}

export async function deleteProjectAgent(
  token: string,
  projectId: string,
  agentId: string,
) {
  return request<void>(`/projects/${projectId}/agents/${agentId}`, token, {
    method: "DELETE",
  });
}

export async function loadProjectAgentSpriteSheet(
  token: string,
  projectId: string,
  agentId: string,
): Promise<Blob> {
  if (!apiUrl) throw new Error("Briar API URL이 설정되지 않았습니다.");
  const response = await fetch(
    `${apiUrl}/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/spritesheet`,
    {
      headers: {
        Accept: "image/webp",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    throw new ApiError(response.status, "Agent sprite sheet request failed");
  }
  const spriteSheet = await response.blob();
  if (spriteSheet.type !== "image/webp") {
    throw new Error("Invalid agent sprite sheet");
  }
  return spriteSheet;
}

function projectAgentInputJson(input: CreateProjectAgentInput) {
  return {
    ...input,
    codexPet:
      input.codexPet === undefined
        ? undefined
        : input.codexPet === null
          ? null
          : { slug: input.codexPet.slug },
  };
}

export async function createIssue(
  token: string,
  projectId: string,
  input: CreateIssueInput,
) {
  if (input.attachments.length === 0) {
    const {
      attachments: _attachments,
      attachmentReferences: _attachmentReferences,
      ...issue
    } = input;
    return request<{
      runId: string;
      sourceKey: string;
      stage: "queued";
      status: "backlog" | "queued";
      assigneeUserId: string | null;
      createdByUserId: string;
      difficulty: CreateIssueInput["difficulty"];
      attachments: IssueAttachment[];
    }>(`/projects/${projectId}/issues`, token, {
      method: "POST",
      body: JSON.stringify(issue),
    });
  }
  const attachmentError = validateIssueAttachments(input.attachments);
  if (attachmentError) throw new Error(attachmentError);
  const form = new FormData();
  form.set("title", input.title);
  form.set("description", input.description ?? "");
  form.set("priority", input.priority === null ? "" : String(input.priority));
  form.set("difficulty", input.difficulty);
  form.set("assigneeUserId", input.assigneeUserId ?? "");
  form.set("status", input.status);
  form.set("preferredProvider", input.preferredProvider ?? "");
  form.set("preferredModel", input.preferredModel ?? "");
  form.set("preferredEffort", input.preferredEffort ?? "");
  form.set("fullAuto", input.fullAuto ? "true" : "false");
  if (input.checkpoints?.length) {
    form.set("checkpoints", JSON.stringify(input.checkpoints));
  }
  if (input.attachmentReferences?.length) {
    form.set(
      "attachmentReferences",
      JSON.stringify(input.attachmentReferences),
    );
  }
  for (const attachment of input.attachments) {
    form.append("attachments", attachment, attachment.name);
  }
  return request<{
    runId: string;
    sourceKey: string;
    stage: "queued";
    status: "backlog" | "queued";
    assigneeUserId: string | null;
    attachments: IssueAttachment[];
  }>(`/projects/${projectId}/issues`, token, { method: "POST", body: form });
}

export async function listChannels(token: string, organizationId: string) {
  return request<{ channels: ChannelSummary[]; cursor: number }>(
    `/organizations/${organizationId}/channels`,
    token,
  );
}

export async function createChannel(
  token: string,
  organizationId: string,
  input: {
    name: string;
    slug?: string;
    topic?: string | null;
    visibility?: ChannelVisibility;
    defaultProjectId?: string | null;
  },
) {
  return request<{ channel: ChannelSummary }>(
    `/organizations/${organizationId}/channels`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function createDirectMessage(
  token: string,
  organizationId: string,
  input: { memberIds: string[]; agentIds: string[] },
) {
  return request<{ channel: ChannelSummary }>(
    `/organizations/${organizationId}/dms`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function loadChannel(
  token: string,
  organizationId: string,
  channelId: string,
  options: { messageLimit?: number; signal?: AbortSignal } = {},
) {
  const query = options.messageLimit
    ? `?limit=${encodeURIComponent(String(options.messageLimit))}`
    : "";
  return request<{
    channel: ChannelSummary;
    members: ChannelMember[];
    agents: ChannelAgentSummary[];
    messages: ChannelMessage[];
    agentReplies?: ChannelAgentReply[];
    nextCursor?: string | null;
  }>(`/organizations/${organizationId}/channels/${channelId}${query}`, token, {
    signal: options.signal,
  });
}

export async function markChannelRead(
  token: string,
  organizationId: string,
  channelId: string,
  input: { lastReadAt?: string } = {},
) {
  return request<{ channel: ChannelSummary }>(
    `/organizations/${organizationId}/channels/${channelId}/read`,
    token,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export async function updateChannel(
  token: string,
  organizationId: string,
  channelId: string,
  input: {
    name?: string;
    topic?: string | null;
    visibility?: ChannelVisibility;
    defaultProjectId?: string | null;
    archived?: boolean;
  },
) {
  return request<{ channel: ChannelSummary }>(
    `/organizations/${organizationId}/channels/${channelId}`,
    token,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function deleteChannel(
  token: string,
  organizationId: string,
  channelId: string,
) {
  return request<{ deleted: boolean }>(
    `/organizations/${organizationId}/channels/${channelId}`,
    token,
    { method: "DELETE" },
  );
}

export async function listChannelMessages(
  token: string,
  organizationId: string,
  channelId: string,
  parentMessageId?: string,
  page: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
) {
  const params = new URLSearchParams();
  if (parentMessageId) params.set("parentMessageId", parentMessageId);
  if (page.limit) params.set("limit", String(page.limit));
  if (page.cursor) params.set("cursor", page.cursor);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<{ messages: ChannelMessage[]; nextCursor?: string | null }>(
    `/organizations/${organizationId}/channels/${channelId}/messages${query}`,
    token,
    { signal: page.signal },
  );
}

export async function sendChannelMessage(
  token: string,
  organizationId: string,
  channelId: string,
  input: {
    body: string;
    clientMessageId?: string;
    skillId?: string | null;
    parentMessageId?: string | null;
    mentionedUserIds?: string[];
    mentionedAgentIds?: string[];
    preferredDeviceId?: string | null;
    attachments?: File[];
    attachmentReferences?: string[];
  },
) {
  const clientMessageId = input.clientMessageId?.toLowerCase();
  let body: BodyInit;
  if (input.attachments?.length) {
    const form = new FormData();
    form.set("body", input.body);
    if (clientMessageId) {
      form.set("clientMessageId", clientMessageId);
    }
    if (input.skillId) {
      form.set("skillId", input.skillId);
    }
    form.set("parentMessageId", input.parentMessageId ?? "");
    form.set("mentionedUserIds", JSON.stringify(input.mentionedUserIds ?? []));
    form.set("mentionedAgentIds", JSON.stringify(input.mentionedAgentIds ?? []));
    if (input.preferredDeviceId) {
      form.set("preferredDeviceId", input.preferredDeviceId);
    }
    form.set(
      "attachmentReferences",
      JSON.stringify(input.attachmentReferences ?? []),
    );
    for (const attachment of input.attachments) {
      form.append("attachments", attachment, attachment.name);
    }
    body = form;
  } else {
    const {
      attachments: _attachments,
      attachmentReferences: _attachmentReferences,
      ...jsonInput
    } = input;
    body = JSON.stringify({ ...jsonInput, clientMessageId });
  }
  return request<{
    message: ChannelMessage;
    agentReplies: ChannelAgentReply[];
  }>(
    `/organizations/${organizationId}/channels/${channelId}/messages`,
    token,
    { method: "POST", body },
  );
}

export async function deleteChannelMessage(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
) {
  return request<DeleteChannelMessageResponse>(
    `/organizations/${organizationId}/channels/${channelId}/messages/${messageId}`,
    token,
    { method: "DELETE" },
  );
}

export async function loadChannelMessageAttachment(
  token: string,
  attachment: ChannelMessageAttachment,
) {
  if (!apiUrl || !attachment.url.startsWith("/")) {
    throw new Error("첨부 이미지 경로가 유효하지 않습니다.");
  }
  const response = await fetch(`${apiUrl}${attachment.url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`첨부 이미지를 열 수 없습니다. (${response.status})`);
  }
  return response.blob();
}

export async function loadChannelMessageDocument(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
) {
  return request<{ document: ChannelMessageDocumentContent }>(
    `/organizations/${organizationId}/channels/${channelId}/messages/${messageId}/document`,
    token,
  );
}

/** Toggle the current user's emoji reaction on a channel message. */
export async function toggleChannelMessageReaction(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
  emoji: string,
) {
  return request<{ message: ChannelMessage }>(
    `/organizations/${organizationId}/channels/${channelId}/messages/${messageId}/reactions`,
    token,
    { method: "PUT", body: JSON.stringify({ emoji }) },
  );
}

export async function setChannelAgent(
  token: string,
  organizationId: string,
  channelId: string,
  agentId: string,
  present: boolean,
) {
  return request<{ agents: ChannelAgentSummary[] }>(
    `/organizations/${organizationId}/channels/${channelId}/agents/${agentId}`,
    token,
    { method: present ? "PUT" : "DELETE" },
  );
}

export async function setChannelMember(
  token: string,
  organizationId: string,
  channelId: string,
  userId: string,
  present: boolean,
) {
  return request<{ members: ChannelMember[] }>(
    `/organizations/${organizationId}/channels/${channelId}/members/${encodeURIComponent(userId)}`,
    token,
    {
      method: present ? "PUT" : "DELETE",
      body: present ? JSON.stringify({ role: "member" }) : undefined,
    },
  );
}

export async function listChannelWebhooks(
  token: string,
  organizationId: string,
  channelId: string,
) {
  return request<{ webhooks: ChannelWebhook[] }>(
    `/organizations/${organizationId}/channels/${channelId}/webhooks`,
    token,
  );
}

export async function createChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  name: string,
) {
  return request<{ webhook: ChannelWebhook; url: string }>(
    `/organizations/${organizationId}/channels/${channelId}/webhooks`,
    token,
    { method: "POST", body: JSON.stringify({ name }) },
  );
}

export async function updateChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  webhookId: string,
  name: string,
) {
  return request<{ webhook: ChannelWebhook }>(
    `/organizations/${organizationId}/channels/${channelId}/webhooks/${webhookId}`,
    token,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
}

export async function rotateChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  webhookId: string,
) {
  return request<{ webhook: ChannelWebhook; url: string }>(
    `/organizations/${organizationId}/channels/${channelId}/webhooks/${webhookId}/rotate`,
    token,
    { method: "POST" },
  );
}

export async function revokeChannelWebhook(
  token: string,
  organizationId: string,
  channelId: string,
  webhookId: string,
) {
  return request<{ webhook: ChannelWebhook }>(
    `/organizations/${organizationId}/channels/${channelId}/webhooks/${webhookId}`,
    token,
    { method: "DELETE" },
  );
}

export async function acceptChannelProposal(
  token: string,
  organizationId: string,
  channelId: string,
  proposalId: string,
  projectId: string | null,
  execution: IssueExecutionApprovalInput | null = null,
) {
  return request<{
    outcome: "accepted" | "already_accepted";
    projectId: string;
    resultRunId: string;
    /** Present for an accepted issue batch, in proposal order. */
    resultItems?: Array<{ localKey: string; runId: string }>;
    /** Present when create approval materializes or accepts execution. */
    executionProposal?: ChannelExecutionProposal | null;
    dispatch?: HuntDispatchResult | null;
  }>(
    `/organizations/${organizationId}/channels/${channelId}/proposals/${proposalId}/accept`,
    token,
    {
      method: "POST",
      body: JSON.stringify(execution
        ? { projectId, execution }
        : { projectId }),
    },
  );
}

export async function acceptChannelExecutionProposal(
  token: string,
  organizationId: string,
  channelId: string,
  proposalId: string,
  input: IssueExecutionApprovalInput,
) {
  return request<{
    proposal: ChannelExecutionProposal;
    outcome: "accepted" | "already_accepted";
    projectId: string;
    runId: string;
    dispatch: HuntDispatchResult;
  }>(
    `/organizations/${organizationId}/channels/${channelId}/proposals/${proposalId}/accept-execution`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

type AgentSkillExecutionAcceptResponse = {
  proposal: AgentSkillExecutionProposal;
  outcome: "accepted" | "already_accepted";
  projectId: string;
  session: unknown;
};

function assertPendingAgentSkillExecutionApproval(
  proposal: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) {
  if (
    proposal.status !== "pending" ||
    proposal.acceptedAt !== null ||
    proposal.requestedWorkerId !== null ||
    proposal.requestedWorkerLabel !== null ||
    proposal.resultSessionId !== null ||
    !input.workerId ||
    input.workerId !== input.workerId.trim()
  ) {
    throw new Error(
      "Skill execution approval requires one exact Worker and a pending proposal.",
    );
  }
}

const skillExecutionSnapshotKeys = [
  "id",
  "type",
  "projectId",
  "agentId",
  "agentName",
  "skillId",
  "skillName",
  "request",
  "provider",
  "model",
  "effort",
  "createdAt",
  "delegatedByAgentId",
  "delegatedByAgentName",
] as const satisfies readonly (keyof AgentSkillExecutionProposal)[];

function validateAgentSkillExecutionAcceptance(
  result: AgentSkillExecutionAcceptResponse,
  expected: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) {
  const session = {
    ...decodeProjectAgentSessionResponse(result.session),
    localOwner: false,
  } as AutoHuntSession;
  const snapshotChanged = skillExecutionSnapshotKeys.some(
    (key) => result.proposal[key] !== expected[key],
  );
  if (
    snapshotChanged ||
    (result.outcome !== "accepted" && result.outcome !== "already_accepted") ||
    result.projectId !== expected.projectId ||
    result.proposal.status !== "accepted" ||
    !result.proposal.acceptedAt ||
    result.proposal.requestedWorkerId !== input.workerId ||
    !result.proposal.requestedWorkerLabel?.trim() ||
    result.proposal.resultSessionId !== session.id ||
    session.projectId !== expected.projectId ||
    session.agentId !== expected.agentId ||
    session.agentName !== expected.agentName ||
    session.skillId !== expected.skillId ||
    session.sessionType !== "task" ||
    session.trigger !== "manual" ||
    session.request !== expected.request ||
    session.requestedWorkerId !== input.workerId ||
    session.workerId !== input.workerId
  ) {
    throw new Error(
      "Skill execution approval returned inconsistent immutable evidence.",
    );
  }
  return { ...result, session };
}

export async function acceptChannelSkillExecutionProposal(
  token: string,
  organizationId: string,
  channelId: string,
  expectedProposal: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) {
  assertPendingAgentSkillExecutionApproval(expectedProposal, input);
  const result = await request<{
    proposal: AgentSkillExecutionProposal;
    outcome: "accepted" | "already_accepted";
    projectId: string;
    session: unknown;
  }>(
    `/organizations/${organizationId}/channels/${channelId}/skill-execution-proposals/${expectedProposal.id}/accept`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
  return validateAgentSkillExecutionAcceptance(
    result,
    expectedProposal,
    input,
  );
}

export async function loadChannelDelta(
  token: string,
  organizationId: string,
  since: number,
  signal?: AbortSignal,
) {
  return request<ChannelDelta>(
    `/organizations/${organizationId}/channel-changes?since=${since}`,
    token,
    { signal },
  );
}

export async function listOrganizationAgents(
  token: string,
  organizationId: string,
) {
  return request<{ agents: ChannelAgentSummary[]; canManage: boolean }>(
    `/organizations/${organizationId}/agents`,
    token,
  );
}

export async function createOrganizationAgent(
  token: string,
  organizationId: string,
  input: {
    name: string;
    provider: AgentProvider;
    model: string | null;
    description?: string;
    responsibility: string;
    effort?: ModelEffort | null;
    skills?: ChannelAgentSkillInput[];
  },
) {
  return request<{ agent: ChannelAgentSummary }>(
    `/organizations/${organizationId}/agents`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function updateOrganizationAgent(
  token: string,
  organizationId: string,
  agentId: string,
  input: {
    name: string;
    provider: AgentProvider;
    model: string | null;
    description?: string;
    responsibility: string;
    effort?: ModelEffort | null;
    skills: ChannelAgentSkillInput[];
  },
) {
  return request<{ agent: ChannelAgentSummary }>(
    `/organizations/${organizationId}/agents/${agentId}`,
    token,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function deleteOrganizationAgent(
  token: string,
  organizationId: string,
  agentId: string,
) {
  return request<{ deleted: boolean }>(
    `/organizations/${organizationId}/agents/${agentId}`,
    token,
    { method: "DELETE" },
  );
}

export async function updateIssue(
  token: string,
  projectId: string,
  runId: string,
  input: UpdateIssueInput,
) {
  if (input.attachments.length === 0) {
    const {
      attachments: _attachments,
      attachmentReferences: _attachmentReferences,
      ...issue
    } = input;
    return request<UpdateIssueResult>(
      `/projects/${projectId}/runs/${runId}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify(
          input.keptAttachmentIds === undefined
            ? issue
            : { ...issue, keptAttachmentIds: input.keptAttachmentIds },
        ),
      },
    );
  }
  const attachmentError = validateIssueAttachments(input.attachments);
  if (attachmentError) throw new Error(attachmentError);
  const form = new FormData();
  form.set("title", input.title);
  form.set("description", input.description ?? "");
  form.set("priority", input.priority === null ? "" : String(input.priority));
  form.set("difficulty", input.difficulty);
  form.set("assigneeUserId", input.assigneeUserId ?? "");
  if (input.attachmentReferences?.length) {
    form.set(
      "attachmentReferences",
      JSON.stringify(input.attachmentReferences),
    );
  }
  if (input.keptAttachmentIds !== undefined) {
    form.set("keptAttachmentIds", JSON.stringify(input.keptAttachmentIds));
  }
  for (const attachment of input.attachments) {
    form.append("attachments", attachment, attachment.name);
  }
  return request<UpdateIssueResult>(
    `/projects/${projectId}/runs/${runId}`,
    token,
    { method: "PATCH", body: form },
  );
}

export async function updateChannelThreadSubscription(
  token: string,
  organizationId: string,
  channelId: string,
  messageId: string,
  subscribed: boolean,
) {
  return request<{
    rootMessageId: string;
    subscribers: Array<{ userId: string; subscribedAt: string }>;
  }>(
    `/organizations/${organizationId}/channels/${channelId}/messages/${messageId}/subscription`,
    token,
    { method: subscribed ? "PUT" : "DELETE" },
  );
}

export async function updateIssueSubscription(
  token: string,
  projectId: string,
  runId: string,
  subscribed: boolean,
) {
  return request<{
    runId: string;
    subscribers: Array<{ userId: string; subscribedAt: string }>;
  }>(`/projects/${projectId}/runs/${runId}/subscription`, token, {
    method: subscribed ? "PUT" : "DELETE",
  });
}

export async function updateIssueExecutionPreferences(
  token: string,
  projectId: string,
  runId: string,
  input: IssueExecutionPreferences,
) {
  return request<{ runId: string } & IssueExecutionPreferences>(
    `/projects/${projectId}/runs/${runId}/preferences`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

export async function updateIssueCheckpoints(
  token: string,
  projectId: string,
  runId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
) {
  return request<{
    runId: string;
    checkpoints: AutoHuntWorkflowCheckpoint[];
  }>(`/projects/${projectId}/runs/${runId}/checkpoints`, token, {
    method: "PUT",
    body: JSON.stringify({ checkpoints }),
  });
}

export async function completeIssueResultReview(
  token: string,
  projectId: string,
  runId: string,
) {
  return request<IssueResultReview>(
    `/projects/${projectId}/runs/${runId}/result-reviews`,
    token,
    { method: "POST" },
  );
}

export async function addIssueDependency(
  token: string,
  projectId: string,
  dependentRunId: string,
  prerequisiteRunId: string,
) {
  return request<{
    prerequisiteRunId: string;
    dependentRunId: string;
    outcome: "created" | "already_exists";
  }>(
    `/projects/${projectId}/runs/${dependentRunId}/dependencies/${prerequisiteRunId}`,
    token,
    { method: "PUT" },
  );
}

export async function removeIssueDependency(
  token: string,
  projectId: string,
  dependentRunId: string,
  prerequisiteRunId: string,
) {
  await request<void>(
    `/projects/${projectId}/runs/${dependentRunId}/dependencies/${prerequisiteRunId}`,
    token,
    { method: "DELETE" },
  );
}

export async function deleteIssue(
  token: string,
  projectId: string,
  runId: string,
) {
  await request<void>(`/projects/${projectId}/runs/${runId}`, token, {
    method: "DELETE",
  });
}

export type TransferIssueResult = {
  runId: string;
  sourceProjectId: string;
  targetProjectId: string;
  outcome: "transferred";
};

export async function transferIssue(
  token: string,
  projectId: string,
  runId: string,
  targetProjectId: string,
) {
  return request<TransferIssueResult>(
    `/projects/${projectId}/runs/${runId}/transfer`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ targetProjectId }),
    },
  );
}

export async function loadIssueAttachment(
  token: string,
  attachment: IssueAttachment,
) {
  if (attachment.url.startsWith("blob:")) {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error("첨부 파일을 열 수 없습니다.");
    return response.blob();
  }
  if (!apiUrl || !attachment.url.startsWith("/")) {
    throw new Error("첨부 파일 경로가 유효하지 않습니다.");
  }
  const response = await fetch(`${apiUrl}${attachment.url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`첨부 파일을 열 수 없습니다. (${response.status})`);
  }
  return response.blob();
}

export async function loadIssueMessages(
  token: string,
  projectId: string,
  runId: string,
) {
  const result = await loadIssueConversationSnapshot(token, projectId, runId);
  return result.messages;
}

export async function loadIssueConversationSnapshot(
  token: string,
  projectId: string,
  runId: string,
) {
  return request<IssueConversationSnapshot>(
    `/projects/${projectId}/runs/${runId}/messages`,
    token,
  );
}

export async function loadIssueConversationDelta(
  token: string,
  projectId: string,
  runId: string,
  cursor: number,
) {
  return request<IssueConversationDelta>(
    `/projects/${projectId}/runs/${runId}/messages/delta?cursor=${cursor}`,
    token,
  );
}

export async function loadRunEvidence(
  token: string,
  projectId: string,
  runId: string,
) {
  const result = await request<{
    runId: string;
    attempt: number;
    revision: number;
    evidence: RunEvidence[];
  }>(`/projects/${projectId}/runs/${runId}/evidence`, token);
  return result.evidence;
}

export async function loadRunEvidenceImage(
  token: string,
  image: RunEvidenceImage,
) {
  if (!apiUrl || !image.url.startsWith("/")) {
    throw new Error("증빙 이미지 경로가 유효하지 않습니다.");
  }
  const response = await fetch(`${apiUrl}${image.url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`증빙 이미지를 열 수 없습니다. (${response.status})`);
  }
  return response.blob();
}

export async function createIssueMessage(
  token: string,
  projectId: string,
  runId: string,
  input: {
    body: string;
    clientMessageId?: string;
    parentMessageId: string | null;
    mentionedUserIds?: string[];
    mentionedAgentIds?: string[];
    agentConversationId?: string | null;
    attachments?: File[];
    attachmentReferences?: string[];
  },
) {
  const attachments = input.attachments ?? [];
  const clientMessageId = input.clientMessageId?.toLowerCase();
  const parentMessageId = input.parentMessageId?.toLowerCase() ?? null;
  let body: BodyInit;
  if (attachments.length > 0) {
    const attachmentError = validateIssueAttachments(attachments);
    if (attachmentError) throw new Error(attachmentError);
    const form = new FormData();
    form.set("body", input.body);
    if (clientMessageId) {
      form.set("clientMessageId", clientMessageId);
    }
    form.set("parentMessageId", parentMessageId ?? "");
    form.set("mentionedUserIds", JSON.stringify(input.mentionedUserIds ?? []));
    form.set("mentionedAgentIds", JSON.stringify(input.mentionedAgentIds ?? []));
    form.set("agentConversationId", input.agentConversationId ?? "");
    form.set(
      "attachmentReferences",
      JSON.stringify(input.attachmentReferences ?? []),
    );
    for (const attachment of attachments) {
      form.append("attachments", attachment, attachment.name);
    }
    body = form;
  } else {
    const {
      attachments: _attachments,
      attachmentReferences: _attachmentReferences,
      ...message
    } = input;
    body = JSON.stringify({ ...message, clientMessageId, parentMessageId });
  }
  const result = await request<{
    message: IssueMessage;
    agentReply: IssueAgentReplyState | null;
    agentReplies?: IssueAgentReplyState[];
  }>(
    `/projects/${projectId}/runs/${runId}/messages`,
    token,
    { method: "POST", body },
  );
  return result;
}

export async function editIssueMessage(
  token: string,
  projectId: string,
  runId: string,
  messageId: string,
  input: {
    body: string;
    mentionedUserIds?: string[];
  },
) {
  const result = await request<{ message: IssueMessage }>(
    `/projects/${projectId}/runs/${runId}/messages/${messageId}`,
    token,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return result.message;
}

export async function deleteIssueMessage(
  token: string,
  projectId: string,
  runId: string,
  messageId: string,
) {
  await request<null>(
    `/projects/${projectId}/runs/${runId}/messages/${messageId}`,
    token,
    { method: "DELETE" },
  );
}

export async function acceptIssueReworkProposal(
  token: string,
  projectId: string,
  runId: string,
  proposalId: string,
) {
  return request<{
    proposal: Extract<IssueProposedAction, { type: "request_issue_rework" }>;
    outcome: "accepted" | "already_accepted";
    attempt: number;
    revision: number;
    workflowStage: string;
  }>(
    `/projects/${projectId}/runs/${runId}/rework-proposals/${proposalId}/accept`,
    token,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function acceptIssueActionProposal(
  token: string,
  projectId: string,
  runId: string,
  proposalId: string,
) {
  return request<{
    proposal: Exclude<IssueProposedAction, { type: "request_issue_rework" }>;
    executionProposal?: IssueExecutionProposal | null;
    outcome: "accepted" | "already_accepted";
    resultRunId: string | null;
  }>(
    `/projects/${projectId}/runs/${runId}/issue-action-proposals/${proposalId}/accept`,
    token,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function acceptIssueExecutionProposal(
  token: string,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
  input: IssueExecutionApprovalInput,
) {
  return request<{
    proposal: IssueExecutionProposal;
    outcome: "accepted" | "already_accepted";
    projectId: string;
    runId: string;
    dispatch: HuntDispatchResult;
  }>(
    `/projects/${projectId}/runs/${conversationRunId}/issue-execution-proposals/${proposalId}/accept`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function acceptIssueSkillExecutionProposal(
  token: string,
  projectId: string,
  conversationRunId: string,
  expectedProposal: AgentSkillExecutionProposal,
  input: AgentSkillExecutionApprovalInput,
) {
  assertPendingAgentSkillExecutionApproval(expectedProposal, input);
  const result = await request<{
    proposal: AgentSkillExecutionProposal;
    outcome: "accepted" | "already_accepted";
    projectId: string;
    session: unknown;
  }>(
    `/projects/${projectId}/runs/${conversationRunId}/skill-execution-proposals/${expectedProposal.id}/accept`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
  return validateAgentSkillExecutionAcceptance(
    result,
    expectedProposal,
    input,
  );
}

export type HuntRecoveryResult = {
  runId: string;
  outcome: "retried" | "cancelled" | "already_retried" | "already_cancelled";
  attempt: number;
  stage: "queued" | "cancelled";
};

export type HuntResumeResult = {
  runId: string;
  outcome:
    | "resumed"
    | "already_resumed"
    | "approved"
    | "already_approved"
    | "not_found"
    | "ineligible";
  workflowStage: string | null;
  startStage: string | null;
  checkpointKey: string | null;
  attempt: number | null;
  revision: number | null;
  terminalReviewOnly: boolean;
};

export async function resumeHuntRun(
  token: string,
  projectId: string,
  runId: string,
  checkpoint: {
    key: string;
    attempt: number;
    revision: number;
  },
  requestId: string = crypto.randomUUID(),
) {
  return request<HuntResumeResult>(
    `/projects/${projectId}/runs/${runId}/resume`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requestId,
        checkpointKey: checkpoint.key,
        attempt: checkpoint.attempt,
        revision: checkpoint.revision,
      }),
    },
  );
}

export type HuntReworkResult = {
  runId: string;
  outcome: "reworked" | "already_reworked";
  attempt: number;
  revision: number;
  workflowStage: string;
};

export async function reworkPausedHuntRun(
  token: string,
  projectId: string,
  runId: string,
  input: {
    workflowStage: string;
    reason: string;
    checkpoint: {
      key: string;
      attempt: number;
      revision: number;
    };
  },
  requestId: string = crypto.randomUUID(),
) {
  return request<HuntReworkResult>(
    `/projects/${projectId}/runs/${runId}/rework`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requestId,
        workflowStage: input.workflowStage,
        reason: input.reason,
        checkpointKey: input.checkpoint.key,
        attempt: input.checkpoint.attempt,
        revision: input.checkpoint.revision,
      }),
    },
  );
}

export async function updateCheckpointPolicy(
  token: string,
  projectId: string,
  input: {
    scope: "project" | "user";
    checkpoints: NonNullable<
      ProjectSettings["checkpointPolicy"]
    >["projectMandatory"];
    expectedRevision: number;
  },
) {
  return request<{
    checkpointPolicy: NonNullable<ProjectSettings["checkpointPolicy"]>;
  }>(`/projects/${projectId}/checkpoint-policy`, token, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

async function recoverHuntRun(
  token: string,
  projectId: string,
  runId: string,
  action: "retry" | "cancel",
  reason: string | null,
) {
  return request<HuntRecoveryResult>(
    `/projects/${projectId}/runs/${runId}/${action}`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ requestId: crypto.randomUUID(), reason }),
    },
  );
}

export const retryHuntRun = (
  token: string,
  projectId: string,
  runId: string,
  reason: string | null = null,
) => recoverHuntRun(token, projectId, runId, "retry", reason);

export const cancelHuntRun = (
  token: string,
  projectId: string,
  runId: string,
  reason: string | null = null,
) => recoverHuntRun(token, projectId, runId, "cancel", reason);

export type HuntDispatchResult = {
  runId: string;
  agentId: string | null;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  requestedWorkerId: string | null;
  requestedByUserId: string;
  dispatchMode: "any" | "specific";
  dispatchedAt: string;
  outcome: "dispatched" | "already_dispatched";
};

export async function dispatchHuntRun(
  token: string,
  projectId: string,
  runId: string,
  input: {
    agentId?: string | null;
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    workerId: string | null;
    reassign?: boolean;
    persistPreferences?: boolean;
  },
) {
  return request<HuntDispatchResult>(
    `/projects/${projectId}/runs/${runId}/${input.reassign ? "reassign" : "dispatch"}`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        ...(input.agentId ? { agentId: input.agentId } : {}),
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        persistPreferences: input.persistPreferences,
        workerId: input.workerId,
        requestId: crypto.randomUUID(),
      }),
    },
  );
}

export async function unassignHuntRun(token: string, projectId: string, runId: string) {
  return request<{
    runId: string;
    outcome: "unassigned" | "not_assigned";
  }>(`/projects/${projectId}/runs/${runId}/unassign`, token, {
    method: "POST",
    body: JSON.stringify({ requestId: crypto.randomUUID() }),
  });
}

export async function updateExecutionWorkerConcurrency(
  token: string,
  projectId: string,
  workerId: string,
  maxConcurrentSessions: number,
) {
  return request<ExecutionWorker>(
    `/projects/${projectId}/workers/${workerId}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ maxConcurrentSessions }),
    },
  );
}

export async function loadProjectExecutionWorkerPolicy(
  token: string,
  projectId: string,
) {
  return request<{ policy: ProjectExecutionWorkerPolicy }>(
    `/projects/${projectId}/execution-policy`,
    token,
  );
}

export async function updateProjectExecutionWorkerPolicy(
  token: string,
  projectId: string,
  policy: Pick<
    ProjectExecutionWorkerPolicy,
    "selectionMode" | "defaultWorkerId" | "allowedWorkerIds"
  >,
) {
  return request<{ policy: ProjectExecutionWorkerPolicy }>(
    `/projects/${projectId}/execution-policy`,
    token,
    { method: "PUT", body: JSON.stringify(policy) },
  );
}

export type HuntMoveResult = {
  runId: string;
  outcome: "moved" | "unchanged" | "already_moved";
  status: HuntRunPlacement["status"];
  workflowStage: string | null;
};

export async function moveHuntRun(
  token: string,
  projectId: string,
  runId: string,
  placement: HuntRunPlacement,
) {
  return request<HuntMoveResult>(
    `/projects/${projectId}/runs/${runId}/status`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        ...placement,
      }),
    },
  );
}

export async function createAgentToken(token: string, projectId: string) {
  return request<{ agentToken: string }>(
    `/projects/${projectId}/agent-token`,
    token,
    {
      method: "POST",
    },
  );
}

export async function updateProjectSettings(
  token: string,
  projectId: string,
  settings: ProjectSettings,
) {
  const writableSettings = {
    velenOrg: settings.velenOrg,
    dataSource: settings.dataSource,
    linear: settings.linear,
    githubRepository: settings.githubRepository,
    workflow: settings.workflow,
  };
  const result = await request<{ settings: ProjectSettings }>(
    `/projects/${projectId}/settings`,
    token,
    { method: "PUT", body: JSON.stringify(writableSettings) },
  );
  return {
    ...result,
    settings: {
      ...result.settings,
      workflow: normalizeDashboardWorkflow(result.settings.workflow),
    },
  };
}

export async function loadMergeQueueProfile(
  token: string,
  projectId: string,
) {
  return request<{ profile: MergeQueueProfile | null }>(
    `/projects/${projectId}/merge-queue-profile`,
    token,
  );
}

export async function loadMergeQueueStatus(
  token: string,
  projectId: string,
) {
  return request<{ status: MergeQueueStatus; generatedAt: string }>(
    `/projects/${projectId}/merge-queue-status`,
    token,
  );
}

export async function updateMergeQueueProfile(
  token: string,
  projectId: string,
  input: { enabled: boolean; readinessStageId: string },
) {
  return request<{ profile: MergeQueueProfile }>(
    `/projects/${projectId}/merge-queue-profile`,
    token,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export async function connectLinearImport(
  token: string,
  projectId: string,
  apiKey: string,
) {
  return request<LinearImportConnectResult>(
    `/projects/${projectId}/linear/connect`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    },
  );
}

export async function loadLinearImportStates(
  token: string,
  projectId: string,
  input: { apiKey: string; teamIds: string[] },
) {
  return request<LinearImportStatesResult>(
    `/projects/${projectId}/linear/states`,
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function importLinearIssues(
  token: string,
  projectId: string,
  input: {
    apiKey: string;
    teamIds: string[];
    statusMapping: Record<string, string>;
  },
) {
  return request<LinearImportResult>(
    `/projects/${projectId}/linear/import`,
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
