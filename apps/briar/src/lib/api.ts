import { briarApiUrl } from "./api-config";
export { briarApiUrl } from "./api-config";
import { ApiError } from "./api/errors";
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
import { decodeProjectUsageSummaryResponse } from "./api/project-usage-contract";
import { listProjects } from "./app-rpc/project";
export {
  createAgentToken,
  createProject,
  deleteProject,
  loadProjectExecutionWorkerPolicy,
  updateCheckpointPolicy,
  updateProjectIcon,
  updateProjectExecutionWorkerPolicy,
  updateProjectIssueKeyPrefix,
  updateProjectSettings,
  updateProjectTabs,
} from "./app-rpc/project";
export {
  acceptOrganizationInvitation,
  createOrganization,
  createOrganizationInvitation,
  isOrganizationHandleAvailable,
  loadOrganizationInvitation,
  loadOrganizationInvitations,
  loadOrganizationMembers,
  loadOrganizations,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganization,
  updateOrganizationLogo,
  updateOrganizationMemberProjects,
  updateOrganizationMemberRole,
} from "./app-rpc/organization";
import {
  deleteInboxReadStateRpc,
  getInboxFeed,
  getInboxReadStates,
  putInboxReadStates,
} from "./app-rpc/inbox";
import {
  getDashboard,
  listRunEventsRpc,
  syncDashboard,
} from "./app-rpc/dashboard";
export {
  claimProjectAgentScheduleRuns,
  completeProjectAgentScheduleRun,
  createOrganizationAgent,
  createProjectAgent,
  createProjectAgentSchedule,
  deleteOrganizationAgent,
  deleteProjectAgent,
  deleteProjectAgentSchedule,
  listOrganizationAgents,
  loadProjectAgents,
  loadProjectAgentScheduleRuns,
  loadProjectAgentSchedules,
  loadProjectAgentSession,
  loadProjectAgentSessionChanges,
  renewProjectAgentScheduleRun,
  runProjectAgentTaskOnWorker,
  type ProjectAgentSessionSyncResult,
  type ProjectAgentSessionSyncState,
  updateOrganizationAgent,
  updateProjectAgent,
  updateProjectAgentSchedule,
  upsertProjectAgentSession,
} from "./app-rpc/agent";
export {
  acceptChannelExecutionProposal,
  acceptChannelProposal,
  acceptChannelSkillExecutionProposal,
  createDirectMessage,
  declineChannelProposal,
  deleteChannelMessage,
  listChannelMessages,
  listChannels,
  listDirectMessageRecipients,
  loadChannel,
  loadChannelDelta,
  markChannelRead,
  sendChannelMessage,
  toggleChannelMessageReaction,
  updateChannelThreadSubscription,
} from "./app-rpc/channel";
export {
  acceptIssueActionProposal,
  acceptIssueExecutionProposal,
  acceptIssueReworkProposal,
  acceptIssueSkillExecutionProposal,
  addIssueDependency,
  cancelHuntRun,
  completeIssueResultReview,
  createIssue,
  createIssueMessage,
  deleteIssue,
  dispatchHuntRun,
  loadIssueAgentReply,
  loadIssueConversationDelta,
  loadIssueConversationSnapshot,
  loadIssueMessages,
  loadRunEvidence,
  moveHuntRun,
  removeIssueDependency,
  resumeHuntRun,
  retryHuntRun,
  transferIssue,
  type CreateIssueResult,
  type HuntDispatchResult,
  type HuntMoveResult,
  type HuntRecoveryResult,
  type HuntResumeResult,
  type TransferIssueResult,
  updateIssue,
  updateIssueExecutionPreferences,
  updateIssueSubscription,
} from "./app-rpc/issue";
import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
} from "./auto-hunt-contract";
import type { AgentProvider } from "./agent-provider";
import type { UsageRangeDays } from "./agent-usage-overview";
import type {
  ProjectUsageDateRange,
  ProjectUsagePeriod,
} from "./project-usage-summary";
import { LITELLM_MAIN_PRICING_SOURCE } from "./agent-usage-pricing";
import type { InboxMessage } from "../hooks/useInbox";
import type {
  ChannelAgentSummary,
  ChannelLinkPreview,
  ChannelMember,
  ChannelMessageAttachment,
  ChannelMessageDocumentContent,
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
  AgentUsageReport,
  AgentExecutionCostEstimate,
  DashboardPayload,
  DashboardDeltaPayload,
  OrganizationExecutionWorker,
  ManagedComputer,
  ManagedComputerProduct,
  ManagedComputerRemoteSessionTicket,
  ManagedComputerSetupSessionTicket,
  MergeQueueProfile,
  MergeQueueStatus,
  ProjectExecutionWorkerPolicy,
  HuntEvent,
  IssueAttachment,
  IssueMessage,
  Project,
  ProjectSettings,
  ProjectUsageSummary,
  RunEvidenceImage,
  StatusTrayRunsPayload,
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
  version: string;
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
  const result = await getInboxFeed(
    token,
    organizationId,
    state?.version,
    signal,
  );
  return {
    state: { version: result.version },
    notModified: result.unchanged,
    messages: result.messages,
    subscribedIssueIds: result.subscribedIssueIds,
  };
}

export async function loadInboxReadStates(
  token: string,
): Promise<Record<string, string>> {
  return decodeInboxReadVersions(await getInboxReadStates(token));
}

export async function saveInboxReadStates(
  token: string,
  readVersions: Record<string, string>,
): Promise<Record<string, string>> {
  return decodeInboxReadVersions(await putInboxReadStates(token, readVersions));
}

export async function deleteInboxReadState(
  token: string,
  messageId: string,
): Promise<Record<string, string>> {
  return decodeInboxReadVersions(await deleteInboxReadStateRpc(token, messageId));
}

export async function loadProjects(token: string): Promise<Project[]> {
  return listProjects(token);
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

export async function createManagedComputerSetupSession(
  token: string,
  organizationId: string,
  managedComputerId: string,
  input: { projectId: string; requestId: string },
) {
  return request<ManagedComputerSetupSessionTicket>(
    `/organizations/${organizationId}/managed-computers/${managedComputerId}/setup-sessions`,
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
  const dashboard = await getDashboard(token, projectId, signal);
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
  const delta = await syncDashboard(token, projectId, cursor, signal);
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
  return listRunEventsRpc(token, projectId, runId);
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

export async function loadChannelMessageAttachment(
  token: string,
  attachment: ChannelMessageAttachment,
) {
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

export async function loadChannelLinkPreview(
  token: string,
  organizationId: string,
  channelId: string,
  targetUrl: string,
) {
  const params = new URLSearchParams({ url: targetUrl });
  return request<{ preview: ChannelLinkPreview | null }>(
    `/organizations/${organizationId}/channels/${channelId}/link-preview?${params}`,
    token,
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

export async function unassignHuntRun(token: string, projectId: string, runId: string) {
  return request<{
    runId: string;
    outcome: "unassigned" | "not_assigned";
  }>(`/projects/${projectId}/runs/${runId}/unassign`, token, {
    method: "POST",
    body: JSON.stringify({ requestId: crypto.randomUUID() }),
  });
}

export type ProjectGithubCredential = {
  project: { id: string; organizationId: string };
  repository: { id: number; fullName: string; cloneUrl: string };
  username: string;
  password: string;
  expiresAt: string;
};

export async function createProjectGithubCredential(
  token: string,
  projectId: string,
) {
  return request<ProjectGithubCredential>(
    `/projects/${projectId}/github/credentials`,
    token,
    { method: "POST" },
  );
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
