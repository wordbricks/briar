import { briarApiUrl, briarAuthUrl } from "./api-config";
export { briarApiUrl } from "./api-config";
import { ApiError } from "./api/errors";
export {
  ApiError,
  ApiResponseDecodeError,
  apiErrorIssueMessages,
  errorWithMessage,
  isApiErrorStatus,
} from "./api/errors";
import {
  createDeviceVerificationUrl,
  createDeviceAuthorizationClient,
  type DeviceAuthorizationClientId,
  type DeviceAuthorizationLaunchOptions,
} from "./device-authorization-client";
export {
  deleteAccount,
  loadSession,
  updateAccountProfile,
} from "./api/account";
import { decodeInboxReadVersions } from "./api/inbox-contract";
import { listProjects } from "./app-rpc/project";
export {
  createAgentToken,
  createPlanningProject,
  createProject,
  deletePlanningProject,
  deleteProject,
  loadProjectExecutionWorkerPolicy,
  loadTeamProjects,
  moveIssueToPlanningProject,
  resolveIssueHierarchyLocation,
  updateCheckpointPolicy,
  updateProjectIcon,
  updateProjectExecutionWorkerPolicy,
  updateProjectIssueKeyPrefix,
  updateProjectSettings,
  updateProjectTabs,
  updatePlanningProject,
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
  loadProjectAgentTranscript,
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
  createChannel,
  createChannelWebhook,
  createDirectMessage,
  declineChannelProposal,
  deleteChannel,
  deleteChannelMessage,
  listChannelMessages,
  listChannels,
  listChannelWebhooks,
  listDirectMessageRecipients,
  loadChannel,
  loadChannelDelta,
  loadChannelLinkPreview,
  loadChannelMessageDocument,
  markChannelRead,
  revokeChannelWebhook,
  rotateChannelWebhook,
  sendChannelMessage,
  setChannelAgent,
  setChannelMember,
  toggleChannelMessageReaction,
  updateChannel,
  updateChannelWebhook,
  updateChannelThreadSubscription,
} from "./app-rpc/channel";
export {
  acceptIssueActionProposal,
  acceptIssueExecutionProposal,
  acceptIssueReworkProposal,
  acceptIssueSkillExecutionProposal,
  addRelatedIssue,
  addIssueDependency,
  cancelHuntRun,
  completeIssueResultReview,
  createIssue,
  createIssueMessage,
  deleteIssue,
  deleteIssueMessage,
  dispatchHuntRun,
  editIssueMessage,
  type HuntReworkResult,
  loadIssueAgentReply,
  loadIssueConversationDelta,
  loadIssueConversationSnapshot,
  loadIssueMessages,
  loadRunEvidence,
  moveHuntRun,
  removeIssueDependency,
  removeIssueParent,
  removeRelatedIssue,
  reworkPausedHuntRun,
  resumeHuntRun,
  retryHuntRun,
  setIssueParent,
  transferIssue,
  type CreateIssueResult,
  type HuntDispatchResult,
  type HuntMoveResult,
  type HuntRecoveryResult,
  type HuntResumeResult,
  type TransferIssueResult,
  updateIssue,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
  updateIssueSubscription,
  unassignHuntRun,
} from "./app-rpc/issue";
export {
  applyForManagedComputer,
  createManagedComputerRemoteSession,
  createManagedComputerSetupSession,
  deleteOrganizationExecutionWorker,
  endManagedComputerRemoteSession,
  loadManagedComputerProduct,
  loadManagedComputers,
  loadOrganizationExecutionWorkers,
  requestOrganizationExecutionWorkerUpdate,
  retireManagedComputer,
  retryManagedComputer,
  updateOrganizationExecutionWorkerConcurrency,
  updateOrganizationExecutionWorkerIcon,
  validateManagedComputerPromotion,
} from "./app-rpc/fleet";
export {
  loadAgentUsageReport,
  loadProjectUsageSummary,
  loadRunCostEstimate,
  loadStatusTrayRuns,
} from "./app-rpc/reporting";
export {
  connectLinearImport,
  importLinearIssues,
  loadLinearImportStates,
} from "./app-rpc/linear-import";
export {
  createGithubInstallUrl,
  createProjectGithubCredential,
  loadGithubIntegration,
  type GithubIntegration,
  type GithubIntegrationRepository,
  type ProjectGithubCredential,
} from "./app-rpc/github";
export {
  loadMergeQueueProfile,
  loadMergeQueueStatus,
  updateMergeQueueProfile,
} from "./app-rpc/merge-queue";
import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import type { InboxMessage } from "../hooks/useInbox";
import type { ChannelMessageAttachment } from "./channels-contract";
import type {
  DashboardPayload,
  DashboardDeltaPayload,
  ProjectExecutionWorkerPolicy,
  HuntEvent,
  IssueAttachment,
  Project,
  ProjectSettings,
  RunEvidenceImage,
} from "../types";

const apiUrl = briarApiUrl;
const deviceAuthorizationClient = briarAuthUrl
  ? createDeviceAuthorizationClient(briarAuthUrl)
  : undefined;

const requireDeviceAuthorizationClient = () => {
  if (!deviceAuthorizationClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return deviceAuthorizationClient;
};

const normalizeDashboardWorkflow = (workflow: AutoHuntWorkflow) =>
  normalizeAutoHuntWorkflow(workflow);

export const isApiConfigured = Boolean(apiUrl);

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
};

export type DeviceClientId = Exclude<
  DeviceAuthorizationClientId,
  "briar-cli"
>;

export type DeviceLoginMethod = NonNullable<
  DeviceAuthorizationLaunchOptions["method"]
>;

export async function beginDeviceAuthorization(
  clientId: DeviceClientId = "briar-desktop",
  options: DeviceAuthorizationLaunchOptions = {},
): Promise<DeviceAuthorization> {
  const response = await requireDeviceAuthorizationClient().requestCode({
    clientId,
    scope: "openid profile email",
  });
  return {
    deviceCode: response.deviceCode,
    userCode: response.userCode,
    verificationUrl: createDeviceVerificationUrl(
      response.verificationUriComplete,
      clientId,
      options,
    ),
    interval: response.interval,
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
  const result = await requireDeviceAuthorizationClient().pollToken({
    deviceCode,
    clientId,
  });
  if (result.status === "authorized") {
    return { access_token: result.accessToken };
  }
  return { error: result.status, error_description: result.description };
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

export async function loadDashboardDelta(
  token: string,
  projectId: string,
  cursor: number,
  signal?: AbortSignal,
): Promise<DashboardDeltaPayload> {
  const delta = await syncDashboard(token, projectId, cursor, signal);
  return { ...delta, runs: normalizeDashboardRuns(delta.runs) };
}

export async function loadRunEvents(
  token: string,
  projectId: string,
  runId: string,
): Promise<HuntEvent[]> {
  return listRunEventsRpc(token, projectId, runId);
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
