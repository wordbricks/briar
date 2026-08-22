import * as Option from "effect/Option";
import * as SchemaIssue from "effect/SchemaIssue";
import {
  AutoHuntWorkflowValidationError,
  autoHuntEvidenceTypeMaxLength,
  autoHuntEvidenceTypePattern,
  autoHuntPersistedRunStatuses,
  autoHuntRequirementKinds,
  autoHuntSources,
  cloneAutoHuntWorkflow,
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
  type AutoHuntRunStatus,
} from "../../src/lib/auto-hunt-contract";
import {
  decodeAgentProviderCapabilityCatalogOption,
  mergeAgentProviderCapabilityCatalogs,
} from "../../src/lib/agent-provider-contract";
import {
  agentProviderLabels,
  agentProviders,
  type AgentProvider,
} from "../../src/lib/agent-provider";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillsMaxCount,
} from "../../src/lib/agent-limits";
import {
  defaultProjectAgentCalendarColor,
} from "../../src/lib/project-agent";
import {
  isValidProjectAgentScheduleTimeZone,
  normalizeProjectAgentScheduleDay,
  normalizeProjectAgentScheduleDays,
  normalizeProjectAgentScheduleInterval,
  projectAgentScheduleIntervalUnits,
  projectAgentScheduleNotificationLevels,
  projectAgentScheduleRecurrences,
} from "../../src/lib/project-agent-schedule";
import {
  canonicalizeIssueAttachmentReferences,
  issueAttachmentMarkdown,
  issueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import {
  agentReplyParentMessageId,
  issueReplyAgentIds,
} from "../../src/lib/issue-reply-decision";
import {
  ChannelAgentActivityPublishInput,
} from "../../src/lib/channel-agent-activity";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
  issueTitleTooLongMessageKo,
  isIssueTitleWithinLimit,
} from "../../src/lib/issue-title";
import {
  isWorkerEmoji,
  isWorkerLogoDataUrl,
  maxWorkerEmojiLength,
  maxWorkerLogoDataUrlLength,
} from "../../src/lib/worker-icon-validation";
import {
  projectUsageSummaryWindow,
} from "../../src/lib/project-usage-summary";
import {
  decodeOrganizationAgentContextAgentsPage,
  decodeOrganizationAgentContextDescriptor,
  decodeOrganizationAgentContextIssuePullRequestsPage,
  decodeOrganizationAgentContextIssuesPage,
  decodeOrganizationAgentContextLookupInput,
  decodeOrganizationAgentContextLookupResponse,
  decodeOrganizationAgentContextManifest,
  decodeOrganizationAgentContextProjectsPage,
  decodeOrganizationAgentContextQuery,
  decodeOrganizationAgentContextSessionsPage,
} from "../../src/lib/organization-agent-context-contract";
import {
  createAuth,
  type BriarAuth,
} from "./auth";
import { requireSession } from "./session-auth";
import { handleAccountRoute } from "./account-routes";
import {
  agentSkillExecutionProposalJson,
  approveAgentSkillExecutionProposal,
} from "./agent-skill-execution-approval";
import {
  channelConversationNotificationJson,
  claimConversationJson,
  issueActionProposalJson,
  issueAgentReplyJson,
  issueAttachmentJson as attachmentJson,
  issueConversationNotificationJson,
  issueExecutionProposalJson,
  issueMessageJson,
  issueReworkProposalJson,
  liveAgentSkillExecutionProposalJson,
  liveIssueExecutionProposalJson,
  type IssueProposalRow,
} from "./issue-conversation-json";
import {
  deleteUnreferencedUploadedIssueObjects,
  issueAttachmentResponse as attachmentResponse,
  removeOrphanedIssueAttachments,
} from "./issue-attachment-service";
import {
  listIssueMessagesWithArchive,
  loadIssueConversationSnapshot,
} from "./issue-conversation-service";
import { handleIssueConversationRoute } from "./issue-conversation-routes";
import { handleIssueCoreRoute } from "./issue-core-routes";
import { handleIssueProposalRoute } from "./issue-proposal-routes";
import {
  createIssueWithAttachments,
  updateIssueWithAttachments,
} from "./issue-write-service";
import { handleChannelMessageRoute } from "./channel-message-routes";
import { handleChannelOrganizationContextRoute } from "./channel-organization-context-routes";
import { handleChannelProposalRoute } from "./channel-proposal-routes";
import { handleChannelReplyClaimRoute } from "./channel-reply-claim-routes";
import { handleChannelReplyResultRoute } from "./channel-reply-result-routes";
import { handleChannelWebhookManagementRoute } from "./channel-webhook-management-routes";
import { handleManagedComputerRoute } from "./managed-computer-routes";
import { handleOrganizationChannelRoute } from "./organization-channel-routes";
import { handleOrganizationWorkerRoute } from "./organization-worker-routes";
import { handleOrganizationRoute } from "./organization-routes";
import { handleProjectAgentRoute } from "./project-agent-routes";
import { handleProjectAgentSessionRoute } from "./project-agent-session-routes";
import { handleProjectAgentTaskRoute } from "./project-agent-task-routes";
import { handleProjectCoreRoute } from "./project-core-routes";
import { handleProjectLinearRoute } from "./project-linear-routes";
import { handleProjectSettingsRoute } from "./project-settings-routes";
import { handleProjectWorkerRoute } from "./project-worker-routes";
import { handlePublicRoute } from "./public-routes";
import { handleIncomingChannelWebhookRoute } from "./incoming-channel-webhook";
import { handleRealtimeRoute } from "./realtime-routes";
import {
  type AuthenticatedWorkerPrincipal,
  requireWorkerCredential,
} from "./worker-route-auth";
import { projectJson } from "./project-json";
import { projectAgentSessionJson } from "./project-agent-session-json";
import { syncProjectAgentTaskSession } from "./project-agent-task-session";
import { settingsJson } from "./project-settings-json";
import {
  isReservedProposalIssueSourceKey,
  newConversationProposalIssueSourceKey,
} from "./proposal-issue-source";
import { handleMergeBatchRoute } from "./merge-batch-routes";
import { evidenceImageJson, runEvidenceJson } from "./run-evidence-json";
import { handleRunAgentRoute } from "./run-agent-routes";
import { handleRunEvidenceRoute } from "./run-evidence-routes";
import { handleTranscriptRoute } from "./transcript-routes";
import { workerJson } from "./worker-json";
import { handleExecutionWorkerRoute } from "./execution-worker-routes";
import {
  contentDisposition,
  prepareStoredAttachments,
  uploadStoredAttachments,
} from "./attachment-storage";
import {
  getDashboardSyncCursor,
  listDashboardChanges,
} from "./dashboard-change-repository";
import {
  getOrganizationRole,
  listOrganizationMembers,
} from "./organization-repository";
import { canManageOrganization } from "./organization-access";
import { organizationMemberJson } from "./organization-json";
import { issueSubscribers } from "./issue-subscribers";
import {
  listOrganizationProjects,
  type ProjectRow,
} from "./project-repository";
import {
  getArchivedEvidenceImage,
  getArchivedProjectAgentSession,
  listArchivedExecutionAuditEvents,
  listArchivedIssueMessages,
  listArchivedRunEvidence,
  listArchivedRunEvents,
  processArchiveCleanupQueue,
  readArchivedWorkLog,
  readLatestArchivedWorkLogForRun,
} from "./archive";
import {
  assertQueuedHuntClaim,
  attemptGithubMergeAutoResume,
  agentSkillExecutionApprovalTablesAvailable,
  acceptAgentSkillExecutionProposal,
  claimGithubDelivery,
  claimNextIssueAgentReply,
  claimNextProjectAgentTask,
  claimNextQueuedHuntRun,
  completeIssueAgentReplyOutput,
  completeIssueResultReview,
  completeGithubDelivery,
  completeSlackEvent,
  connectGithubInstallation,
  consumeGithubInstallState,
  consumeGithubOAuthState,
  consumeSlackOAuthState,
  createGithubOAuthState,
  createIssueMessage,
  createIssueDependency,
  createIssueAttachments,
  issueAttachmentObjectKeysInUse,
  issueExecutionApprovalTablesAvailable,
  createRunEvidenceImages,
  createSlackOAuthState,
  claimSlackEvent,
  deleteSlackInstallation,
  disconnectGithubInstallation,
  disconnectGithubInstallationById,
  disconnectGithubInstallationsByAuthorizedUser,
  deleteIssue,
  transferIssue,
  deleteIssueDependency,
  EventKeyConflictError,
  enqueueIssueAgentReply,
  failIssueAgentReply,
  findProjectIdByAgentTokenHash,
  getProjectAgent,
  getClaimedIssueAgentReply,
  getIssueActionProposal,
  getIssueExecutionProposal,
  getIssueAgentSkillExecutionProposal,
  getAgentSkillExecutionApprovalAudit,
  getIssueAgentReplyJob,
  getIssueReworkProposal,
  getIssueAttachment,
  getIssueMessage,
  getRunEvidenceImage,
  getOrganizationInboxSyncVersion,
  getGithubConnectionByInstallation,
  getGithubConnectionForOrganization,
  getSlackInstallation,
  getProject,
  getProjectSettings,
  getProjectAgentSession,
  getProjectAgentTaskJob,
  getHuntRunForProject,
  getRunExecutionAttempt,
  HuntClaimError,
  HuntTransitionError,
  listIssueAttachments,
  listIssueAttachmentsByRunIds,
  listChannelConversationNotifications,
  listIssueDependencies,
  listIssueDependenciesByRunIds,
  listIssueConversationNotifications,
  listIssueSubscriptions,
  listIssueActionProposals,
  listIssueExecutionProposals,
  listIssueAgentReplyJobs,
  listIssueAgentSkillExecutionProposals,
  listIssueMessages,
  listIssueReworkProposals,
  listIssueThreadMessages,
  listIssueResultReviews,
  listIssueResultReviewsByRunIds,
  listEvidenceImagesForEvidence,
  listDashboardRuns,
  listDashboardRunsByIds,
  listHuntRunEvents,
  resolveHuntEventActorNames,
  listRunEvidence,
  listRunEvidenceImages,
  listRunStageRevisions,
  listOrganizationStatusTrayRuns,
  listRunUsageRecords,
  listProjectUsageTotals,
  listProjectUsageRuns,
  listGithubConnectionRepositories,
  listSlackInstallations,
  moveHuntRun,
  recoverHuntRun,
  completeWorkflowStageLifecycle,
  reworkHuntRun,
  recordHuntEvent,
  recordRunEvidence,
  recordRunCostRecords,
  recordRunUsageRecords,
  subscribeIssue,
  renewIssueAgentReplyLease,
  renewProjectAgentTaskLease,
  completeProjectAgentTaskWithReceipt,
  reapProjectAgentTaskJobs,
  acceptIssueCreateProposal,
  acceptIssueUpdateProposal,
  acceptIssueReworkProposal,
  reserveIssueCreateProposalApproval,
  reserveIssueExecutionProposalApproval,
  rollbackNewAppIssue,
  startWorkflowStageLifecycle,
  releaseGithubDelivery,
  releaseSlackEvent,
  deleteIssueAttachments,
  updateIssueWithAttachmentMetadata,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
  updateHuntRunExecutionMetrics,
  updateIssueMessage,
  unsubscribeIssue,
  deleteIssueMessage,
  updateSlackInstallationProject,
  upsertProjectAgentSessionSummary,
  upsertSlackInstallation,
  syncGithubPullRequest,
  syncGithubConnectionRepositories,
  type HuntEventRow,
  type HuntRunRow,
  type IssueAttachmentRow,
  type IssueActionProposalRow,
  type IssueExecutionProposalRow,
  type AgentSkillExecutionProposalRow,
  type IssueAgentReplyJobRow,
  type ChannelConversationNotificationRow,
  type IssueConversationNotificationRow,
  type IssueMessageRow,
  type IssueReworkProposalRow,
  type IssueResultReviewRow,
  type IssueDependencyRow,
  type OrganizationStatusTrayRunRow,
  type OrganizationUsageRunRow,
  type ProjectUsageTotalRow,
  type RunExecutionAttemptRow,
  type RunEvidenceRow,
  type RunEvidenceImageInput,
  type RunEvidenceImageRow,
} from "./db";
import {
  exchangeGithubOAuthCode,
  githubOAuthStateTtlMs,
  githubPkceChallenge,
  githubSha256Hex,
  mergeQueueTailPullRequestNumber,
  parseGitHubWebhook,
  parseGitHubWebhookHeaders,
  randomGithubOAuthToken,
  verifyGithubOAuthInstallation,
  verifyGitHubWebhook,
} from "./github";
import {
  blockMergeBatch,
  claimNextMergeBatch,
  completeMergeBatchPublication,
  observeSignedMergedBatchPullRequest,
  recordMergeBatchCandidateEnqueued,
  recordMergeBatchValidationProof,
  recordSignedMergeQueuePullRequestObservation,
  recordSignedMergeGroupHead,
  reconcileReadyMergeCandidates,
  registerReadyMergeCandidates,
  releaseMergeBatchLease,
  renewMergeBatchLease,
  selectAuthoritativeMergeGroupHead,
} from "./merge-batches";
import {
  decodeMergeBatchAuthorityInput,
  decodeMergeBatchBlockInput,
  decodeMergeBatchClaimInput,
  decodeMergeBatchEnqueueInput,
  decodeMergeBatchLeaseInput,
  decodeMergeBatchPublicationInput,
  decodeMergeBatchValidationInput,
} from "./merge-queue-contract";
import {
  reconcileMergeQueuePullRequest,
} from "./merge-queue-reconcile";
import {
  checkpointPolicyJson,
  loadWorkflowCheckpointPolicy,
} from "./workflow-policy";
import {
  estimateRunExecutionCost,
  loadAgentUsagePricing,
} from "./usage-pricing";
import {
  assertExecutionSelectionAvailable,
  availableExecutionWorkerForAgentSkill,
  auditExecutionEvent,
  authenticateExecutionWorker,
  bindExecutionWorkerProject,
  countExecutionWorkerDeviceSessions,
  completeExecutionWorkerUpdates,
  countLeasedRuns,
  deleteExecutionWorker,
  disableExecutionWorker,
  dispatchHuntRun,
  unassignHuntRun,
  executionWorkerBindingById,
  executionWorkerBindingForProject,
  executionWorkerDeviceForBinding,
  executionWorkerProviders,
  executionWorkerSupportsOrganizationAgentContext,
  executionWorkerUpdateStatus,
  failExecutionWorkerUpdateHandoff,
  handoffExecutionWorkerClaim,
  hasAvailableChannelReplyWorker,
  leaseExpiryFrom,
  listExecutionAuditEvents,
  listExecutionWorkers,
  listOrganizationExecutionWorkers,
  listOrganizationExecutionProviders,
  getProjectExecutionWorkerPolicy,
  hasExecutionWorkerReadinessChanged,
  isExecutionWorkerAllowedForProject,
  WORKER_STALE_AFTER_MS,
  reapStalledHuntRuns,
  recordWorkerHeartbeat,
  registerExecutionWorker,
  requestExecutionWorkerUpdate,
  renewHuntRunLease,
  TranscriptLimitError,
  WorkerConflictError,
  workerStateAt,
  unbindExecutionWorker,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerIcon,
  updateExecutionWorkerLabel,
  userOwnsExecutionWorkerDevice,
} from "./workers";
import {
  latestExecutionWorkerUpdateHandoff,
  pendingExecutionWorkerUpdate,
} from "./worker-update-repository";
import { MAX_WORKER_CONCURRENT_SESSIONS } from "./worker-limits";
import { TranscriptRequestDecodeError } from "./transcript-request";
import {
  decodeRequestSync,
  RequestDecodeError,
} from "./request-schema";
import { decodeSlackOAuthInput } from "./account-organization-request-contract";
import {
  decodeAgentSkillExecutionProposalAcceptInput,
  decodeExecutionPreferences,
  decodeIssueAgentReplyLease,
  decodeIssueCreateProposalAction,
  decodeIssueMessageEditInput,
  decodeIssueUpdateProposalAction,
  type IssueInput,
  type IssueUpdateInput,
} from "./issue-request-contract";
import {
  decodeProjectAgentTaskClaimInput,
  decodeProjectAgentTaskCompletion,
  decodeProjectAgentTaskLease,
  decodeProjectTransferInput,
} from "./project-request-contract";
import {
  decodeIssueCheckpointsInput,
  decodeMoveRunInput,
  decodePausedRunReworkInput,
  decodeProjectUsagePeriod,
  decodeRecoveryAgentInput,
  decodeRecoveryUserInput,
  decodeResumeAgentInput,
  decodeResumeUserInput,
  decodeRunEvent,
  decodeRunReworkInput,
  decodeRequestIdInput,
  decodeWorkflowStageLifecycleInput,
  ProjectWorkflowInputError,
} from "./run-request-contract";
import {
  decodeChannelMessageQuery,
  decodeMessageLimit,
  decodeProjectChannelMessageQuery,
  decodeUuidOption,
} from "./query-contract";
import {
  decodeClaimInput,
  decodeDispatchRun,
  decodeIssueReplyClaimInput,
  decodeLeaseRenew,
  decodeWorkerBind,
  decodeWorkerClaimInput,
  decodeWorkerConcurrency,
  decodeWorkerHeartbeat,
  decodeWorkerLabel,
  decodeWorkerRegister,
  decodeWorkerSettings,
} from "./worker-request-contract";
import {
  decodeWorkerUpdateHandoff,
  decodeWorkerUpdatePrepare,
  decodeWorkerUpdateRequestId,
} from "./worker-update-contract";
import { ManagedComputerServiceError } from "./managed-computer-service";
import {
  ingestAgentTranscript,
  listAgentTranscriptSegments,
  readAgentWorkLog,
  readLatestAgentWorkLogForRun,
  readRawTranscriptSegment,
  workLogEntryTranscriptEvent,
  type AgentTranscriptSegmentRow,
} from "./agent-worklog";
import { readLatestVersion } from "./releases";
import {
  compareSemanticVersions,
  isSemanticVersion,
} from "../../src/lib/semantic-version";
import {
  acceptChannelActionProposal,
  addChannelAgent,
  addChannelMember,
  channelJson,
  channelWebhookJson,
  channelExecutionProposalTablesAvailable,
  channelSkillExecutionProposalTablesAvailable,
  channelMessageJson,
  channelReplyJson,
  claimNextChannelAgentReply,
  completeChannelReply,
  createChannel,
  createChannelMessage,
  createChannelWebhook,
  createIncomingChannelWebhookMessage,
  deleteChannel,
  enqueueChannelAgentReplies,
  failChannelReply,
  getChannel,
  getChannelActionProposal,
  getChannelExecutionProposal,
  getChannelAgentSkillExecutionProposal,
  getChannelAgentReplyJob,
  getChannelById,
  getDirectMessageByKey,
  getClaimedChannelReplyAttachment,
  getActiveOrganizationChannelReplyContextClaim,
  getChannelMessage,
  getChannelMessageAttachment,
  getChannelMessageDocument,
  getProjectAgentChannel,
  getProjectOrganizationChannel,
  getIncomingChannelWebhook,
  getChannelSyncCursor,
  getClaimedChannelReply,
  getOrganizationProject,
  listChannelAgentReplies,
  listActiveChannelAgentReplies,
  listChannelAgents,
  listChannelMembers,
  listChannelRootMessages,
  listChannelMessagePage,
  listChannelThreadMessages,
  listChannelWebhooks,
  listChannels,
  loadChannelDelta,
  markChannelRead,
  resolveChannelThreadRootId,
  subscribeChannelThread,
  isChannelReactionEmoji,
  isChannelRootMessage,
  listChannelThreadSubscriptions,
  removeChannelAgent,
  removeChannelMember,
  revokeChannelWebhook,
  rotateChannelWebhook,
  reserveChannelActionProposalApproval,
  reserveChannelExecutionProposalApproval,
  renewChannelReplyLease,
  snapshotChannelReplyExecutionTargets,
  unsubscribeChannelThread,
  toggleChannelMessageReaction,
  updateChannel,
  updateChannelWebhook,
  consumeChannelWebhookRateLimit,
  type ChannelRow,
  type ChannelReplyJobRow,
} from "./channels";
import {
  legacyChannelRealtimeResponse,
  subscribeToOrganizationRealtime,
} from "./channel-realtime";
import {
  publishChannelActivity,
  publishIssueActivity,
  subscribeToChannelActivity,
  subscribeToIssueActivity,
} from "./channel-activity-realtime";
import {
  createChannelActivitySocketTicket,
  createIssueActivitySocketTicket,
  verifyChannelActivityPublishToken,
  verifyChannelActivitySocketTicket,
  verifyIssueActivityPublishToken,
  verifyIssueActivitySocketTicket,
} from "./channel-activity-ticket";
import {
  createChannelRealtimeTicket,
  verifyChannelRealtimeTicket,
} from "./channel-realtime-ticket";
import {
  getOrganizationAgent,
  listOrganizationAgents,
  organizationAgentJson,
} from "./organization-agents";
import {
  listOrganizationAgentContextAgentsPage,
  listOrganizationAgentContextIssuePullRequestsPage,
  listOrganizationAgentContextIssuesPage,
  listOrganizationAgentContextProjectsPage,
  listOrganizationAgentContextSessionsPage,
  lookupOrganizationAgentContext,
  organizationAgentContextManifest,
  OrganizationAgentContextCursorError,
  organizationAgentContextMaxEncodedPageBytes,
  OrganizationAgentContextPageTooLargeError,
} from "./organization-agent-context";
import {
  channelInputSchema,
  directMessageInputSchema,
  channelReadInputSchema,
  channelIssueProposalPayloadSchema,
  channelExecutionProposalAcceptInputSchema,
  channelMemberInputSchema,
  channelMessageReactionInputSchema,
  channelIncomingWebhookMessageSchema,
  channelMessageBlocksFallback,
  channelReplyContextMessageJson,
  channelProposalAcceptInputSchema,
  channelReplyClaimTokenHeader,
  channelReplyClaimInputSchema,
  type ChannelExecutionProposalAcceptInput,
  channelReplyLeaseInputSchema,
  channelReplyNoAvailableWorkerError,
  channelSlugFromName,
  channelUpdateInputSchema,
  channelWebhookInputSchema,
  organizationAgentInputSchema,
  channelAgentSkillInputSchema,
} from "../../src/lib/channels-contract";
import {
  agentSkillConflictMessage,
  agentSkillForMessage,
  agentSkillJson,
  getAgentSkill,
  hydrateAgentSkills,
  issueProcessingAgentSkillRow,
  type AgentSkillEffort,
  type AgentSkillProvider,
} from "./agent-skills";
import {
  issueClaimExecutionConfig,
  issueReplyExecutionConfig,
  legacyAgentSkillInstructions,
} from "./agent-execution-config";
import {
  parseExecutionMetrics,
  parseJsonObject,
  parseStructuredResult,
} from "./agent-result-json";
import {
  buildSlackCreateIssueModal,
  callSlackApi,
  decryptSlackToken,
  downloadSlackIssueAttachments,
  encryptSlackToken,
  exchangeSlackOAuthCode,
  parseSlackIssueInstruction,
  parseSlackCreateIssueSubmission,
  buildSlackIssueCreatedMessage,
  postSlackCommandResponse,
  randomUrlSafeToken,
  sha256Hex,
  slackBotScopes,
  slackCreateIssueBlocks,
  slackCreateIssueCallbackId,
  slackCreateIssueShortcutCallbackId,
  SlackCreateIssueValidationError,
  slackEventClaimTtlMs,
  slackHelpMessage,
  slackOAuthStateTtlMs,
  type SlackCreateIssueSubmission,
  verifySlackRequest,
} from "./slack";
import {
  processSlackRevocationQueue,
  slackConfigAvailable,
} from "./slack-revocations";
import { handleScheduledTask } from "./scheduled-task";
import {
  dashboardStageForProgress,
  readChannelMessageRequest,
  readChannelReplyCompleteRequest,
  readIssueMessageRequest,
  readIssueReplyCompleteRequest,
  readIssueRequest,
  readIssueUpdateRequest,
  readJson,
  readRunEvidenceRequest,
  readTranscriptRequest,
} from "./request-readers";
import {
  appendChannelMessageBacklink,
  approvedIssueCreation,
  assertChannelProposalAuthorScope,
  channelMessageShareUrl,
  loadChannelCatalogSnapshot,
  resolveChannelProposalTargetProjectId,
} from "./channel-proposal-helpers";
import {
  claimWorkflowContext,
  resumeRunWithCheckpointIdentity,
} from "./workflow-resume";
import { assertRunEventIdentityNotOverridden } from "./run-event-identity";
import { sha256, sha256Bytes } from "./crypto-digest";
import { projectUsageSummaryJson } from "./usage-json";
import { handleProjectAgentScheduleRoute } from "./project-agent-schedule-routes";
import {
  corsHeaders,
  HttpError,
  json,
  privateNoStoreJson,
} from "./http-response";
import {
  responseWithPostCommitCleanup,
  schedulePostCommitCleanup,
} from "./post-commit-cleanup";
import {
  channelActivityCredential,
  channelActivityFrame,
  channelMutationOrganization,
  flushOrganizationInboxRealtimeOutbox,
  issueActivityCredential,
  issueActivityFrame,
  projectMutationProject,
  projectScheduleClaimMutation,
  scheduleChannelActivityClear,
  scheduleChannelActivityDisconnect,
  scheduleChannelRealtimePublish,
  scheduleInboxRealtimeFlush,
  scheduleIssueActivityClear,
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const decodeChannelAgentActivityPublishInput = decodeRequestSync(
  ChannelAgentActivityPublishInput,
);
const decodeChannelInput = decodeRequestSync(channelInputSchema);
const decodeDirectMessageInput = decodeRequestSync(directMessageInputSchema);
const decodeChannelReadInput = decodeRequestSync(channelReadInputSchema);
const decodeChannelUpdateInput = decodeRequestSync(channelUpdateInputSchema);
const decodeChannelMemberInput = decodeRequestSync(channelMemberInputSchema);
const decodeChannelWebhookInput = decodeRequestSync(channelWebhookInputSchema);
const decodeChannelMessageReactionInput = decodeRequestSync(
  channelMessageReactionInputSchema,
);
const decodeChannelProposalAcceptInput = decodeRequestSync(
  channelProposalAcceptInputSchema,
);
const decodeChannelIssueProposalPayload = decodeRequestSync(
  channelIssueProposalPayloadSchema,
);
const decodeChannelExecutionProposalAcceptInput = decodeRequestSync(
  channelExecutionProposalAcceptInputSchema,
);
const decodeChannelReplyClaimInput = decodeRequestSync(
  channelReplyClaimInputSchema,
);
const decodeChannelReplyLeaseInput = decodeRequestSync(
  channelReplyLeaseInputSchema,
);
const decodeChannelIncomingWebhookMessage = decodeRequestSync(
  channelIncomingWebhookMessageSchema,
);

async function requireAgentProject(db: D1Database, request: Request) {
  const token = bearerToken(request);
  if (!token.startsWith("briar_agent_")) {
    throw new HttpError(401, "Invalid agent token");
  }
  const projectId = await findProjectIdByAgentTokenHash(
    db,
    await sha256(token),
  );
  if (!projectId) throw new HttpError(401, "Invalid agent token");
  return projectId;
}

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

type AuthenticatedWorkerProject = {
  principal: AuthenticatedWorkerPrincipal;
  binding: NonNullable<
    Awaited<ReturnType<typeof executionWorkerBindingById>>
  >;
};

async function requireWorkerProjectBinding(
  db: D1Database,
  request: Request,
  projectId: string,
  workerId?: string,
  preauthenticated?: AuthenticatedWorkerProject,
): Promise<AuthenticatedWorkerProject> {
  if (preauthenticated) {
    if (
      preauthenticated.binding.project_id !== projectId ||
      (workerId !== undefined && preauthenticated.binding.id !== workerId) ||
      preauthenticated.binding.state === "disabled"
    ) {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    return preauthenticated;
  }
  const principal = await requireWorkerCredential(db, request);
  const binding = workerId
    ? await executionWorkerBindingById(db, principal.deviceId, workerId)
    : await executionWorkerBindingForProject(db, principal.deviceId, projectId);
  if (!binding || binding.project_id !== projectId || binding.state === "disabled") {
    throw new HttpError(403, "Worker is not enabled for this project");
  }
  return { principal, binding };
}

async function requireRunExecutionProject(
  db: D1Database,
  request: Request,
  runId: string,
) {
  if (!bearerToken(request).startsWith("briar_worker_")) {
    return await requireAgentProject(db, request);
  }
  const run = await db
    .prepare(`select project_id, worker_id from briar_hunt_runs where id = ?`)
    .bind(runId)
    .first<{ project_id: string; worker_id: string | null }>();
  if (!run) throw new HttpError(404, "Run not found");
  const { binding } = await requireWorkerProjectBinding(
    db,
    request,
    run.project_id,
  );
  if (run.worker_id !== binding.id) {
    throw new HttpError(403, "Run is not assigned to this worker");
  }
  return run.project_id;
}

async function requireActiveWorkerRunClaim(
  db: D1Database,
  request: Request,
  runId: string,
) {
  const projectId = await requireRunExecutionProject(db, request, runId);
  const claimToken = request.headers.get("x-briar-claim-token");
  if (!claimToken?.startsWith("briar_claim_")) {
    throw new HttpError(409, "Active claim token is required");
  }
  const claimTokenHash = await sha256(claimToken);
  const authenticatedAt = new Date().toISOString();
  const active = await db
    .prepare(
      `select id from briar_hunt_runs
       where id = ? and project_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and status not in ('completed', 'cancelled', 'blocked', 'failed')`,
    )
    .bind(runId, projectId, claimTokenHash, authenticatedAt)
    .first<{ id: string }>();
  if (!active) throw new HttpError(409, "Issue processing claim token is no longer active");
  return { projectId, claimTokenHash, authenticatedAt };
}

async function requireProjectAccess(
  auth: BriarAuth,
  db: D1Database,
  request: Request,
  projectId: string,
) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer briar_agent_")) {
    const agentProjectId = await requireAgentProject(db, request);
    if (agentProjectId !== projectId)
      throw new HttpError(404, "Attachment not found");
    return;
  }
  const session = await requireSession(auth, request);
  if (!(await getProject(db, projectId, session.user.id))) {
    throw new HttpError(404, "Attachment not found");
  }
}

const slackInstallationJson = (
  row: Awaited<ReturnType<typeof listSlackInstallations>>[number],
) => ({
  teamId: row.team_id,
  teamName: row.team_name,
  botUserId: row.bot_user_id,
  defaultProjectId: row.default_project_id,
  defaultProjectName: row.default_project_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const slackOAuthRedirectUri = (origin: string) =>
  `${origin}/slack/oauth/callback`;

const githubCallbackOrigin = (env: Env) => {
  const value = env.GITHUB_CALLBACK_ORIGIN?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLocalhost = url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (
      (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

const githubConfigAvailable = (env: Env) =>
  Boolean(
    env.GITHUB_WEBHOOK_SECRET?.trim() &&
      env.GITHUB_APP_CLIENT_ID?.trim() &&
      env.GITHUB_APP_CLIENT_SECRET?.trim() &&
      /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/u.test(
        env.GITHUB_APP_SLUG?.trim() ?? "",
      ) &&
      githubCallbackOrigin(env),
  );

const githubOAuthRedirectUri = (origin: string) =>
  `${origin}/github/oauth/callback`;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

const html = (title: string, message: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7fb;color:#29272f;font:16px/1.55 system-ui,sans-serif}.card{width:min(520px,calc(100vw - 48px));padding:36px;border:1px solid #e7e3ee;border-radius:18px;background:white;box-shadow:0 18px 50px #33264d14}h1{margin:0 0 12px;font-size:25px}p{margin:0;color:#69636f}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );

const noStoreRedirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });

type SlackAppMentionEvent = {
  type: "app_mention";
  user: string;
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
};

type SlackEventCallback = {
  type: "event_callback";
  team_id: string;
  event_id: string;
  event: SlackAppMentionEvent;
};

const isSlackEventCallback = (
  payload: unknown,
): payload is SlackEventCallback => {
  if (!payload || typeof payload !== "object") return false;
  const callback = payload as Partial<SlackEventCallback>;
  const event = callback.event as Partial<SlackAppMentionEvent> | undefined;
  return (
    callback.type === "event_callback" &&
    typeof callback.team_id === "string" &&
    typeof callback.event_id === "string" &&
    event?.type === "app_mention" &&
    typeof event.user === "string" &&
    typeof event.text === "string" &&
    typeof event.channel === "string" &&
    typeof event.ts === "string" &&
    (event.thread_ts === undefined || typeof event.thread_ts === "string")
  );
};

async function postSlackReply(
  token: string,
  event: SlackAppMentionEvent,
  text: string,
) {
  await callSlackApi("chat.postMessage", token, {
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
}

async function processSlackAppMention(env: Env, payload: SlackEventCallback) {
  const now = new Date();
  const observedAt = now.toISOString();
  const claimed = await claimSlackEvent(
    env.DB,
    payload.team_id,
    payload.event_id,
    observedAt,
    new Date(now.getTime() - slackEventClaimTtlMs).toISOString(),
  );
  if (!claimed) return;

  const installation = await getSlackInstallation(env.DB, payload.team_id);
  if (!installation) {
    await completeSlackEvent(
      env.DB,
      payload.team_id,
      payload.event_id,
      observedAt,
    );
    return;
  }
  let token: string;
  try {
    token = await decryptSlackToken(
      installation.encrypted_bot_token,
      installation.token_iv,
      env.SLACK_TOKEN_ENCRYPTION_KEY,
    );
  } catch (error) {
    await releaseSlackEvent(env.DB, payload.team_id, payload.event_id);
    console.error(
      JSON.stringify({
        message: "Slack bot token decrypt failed",
        error: error instanceof Error ? error.message : String(error),
        teamId: payload.team_id,
      }),
    );
    return;
  }

  try {
    const instruction = parseSlackIssueInstruction(payload.event.text);
    if (!instruction) {
      await postSlackReply(token, payload.event, slackHelpMessage());
      await completeSlackEvent(
        env.DB,
        payload.team_id,
        payload.event_id,
        new Date().toISOString(),
      );
      return;
    }
    if (
      instruction.titleTooLong ||
      !isIssueTitleWithinLimit(instruction.title)
    ) {
      await postSlackReply(
        token,
        payload.event,
        [
          `:warning: ${issueTitleTooLongMessageKo(instruction.title)}`,
          "멘션 뒤 첫 줄 제목만 짧게 다시 보내 주세요.",
        ].join("\n"),
      );
      await completeSlackEvent(
        env.DB,
        payload.team_id,
        payload.event_id,
        new Date().toISOString(),
      );
      return;
    }
    if (!installation.default_project_id) {
      await postSlackReply(
        token,
        payload.event,
        "기본 프로젝트가 설정되지 않았습니다. Briar 조직 설정 → Slack에서 프로젝트를 선택해 주세요.",
      );
      await completeSlackEvent(
        env.DB,
        payload.team_id,
        payload.event_id,
        new Date().toISOString(),
      );
      return;
    }

    const settings = await getProjectSettings(
      env.DB,
      installation.default_project_id,
    );
    const project = (
      await listOrganizationProjects(env.DB, installation.organization_id)
    ).find((candidate) => candidate.id === installation.default_project_id);
    if (!project) {
      throw new Error("Slack default project is unavailable");
    }

    const sourceKey = `slack:${payload.team_id}:${payload.event_id}`;
    const runId = await recordHuntEvent(
      env.DB,
      installation.default_project_id,
      {
        source: "issue",
        sourceKey,
        title: instruction.title,
        stage: "queued",
        status: instruction.status,
        workflowStage: null,
        eventKey: `${sourceKey}:intake`,
        occurredAt: observedAt,
        actor: `slack:${payload.event.user}`,
        repository: settings?.github_repository ?? project.name,
        detail:
          instruction.status === "backlog"
            ? "Slack 멘션으로 생성된 이슈가 백로그에 추가되었습니다."
            : "Slack 멘션으로 생성된 이슈가 처리를 기다리고 있습니다.",
        priority: instruction.priority,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: instruction.description,
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: observedAt,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: {
          origin: "slack",
          slackTeamId: payload.team_id,
          slackEventId: payload.event_id,
          slackChannelId: payload.event.channel,
          slackMessageTs: payload.event.ts,
          slackThreadTs: payload.event.thread_ts ?? payload.event.ts,
          slackUserId: payload.event.user,
        },
      },
    );
    const run = await getHuntRunForProject(
      env.DB,
      installation.default_project_id,
      runId,
    );
    if (!run) {
      throw new Error("Created Slack mention issue is missing");
    }
    const statusLabel =
      instruction.status === "backlog" ? "백로그" : "작업 대기열";
    const priorityLabel = instruction.priority
      ? ` · P${instruction.priority}`
      : "";
    await postSlackReply(
      token,
      payload.event,
      buildSlackIssueCreatedMessage({
        title: instruction.title,
        projectName: project.name,
        statusLabel,
        priorityLabel,
        runNumber: run.run_number,
        issueKeyPrefix: project.issue_key_prefix,
      }),
    );
    await completeSlackEvent(
      env.DB,
      payload.team_id,
      payload.event_id,
      new Date().toISOString(),
    );
  } catch (error) {
    await releaseSlackEvent(env.DB, payload.team_id, payload.event_id);
    console.error(
      JSON.stringify({
        message: "Slack app mention failed",
        error: error instanceof Error ? error.message : String(error),
        teamId: payload.team_id,
        eventId: payload.event_id,
      }),
    );
    try {
      await postSlackReply(
        token,
        payload.event,
        ":warning: 이슈를 만들지 못했습니다. 프로젝트 워크플로와 Slack 연결 설정을 확인한 뒤 다시 시도해 주세요.",
      );
    } catch {
      // Slack will retry the signed event, so keep the original failure retryable.
    }
  }
}

async function readVerifiedSlackBody(request: Request, env: Env) {
  if (!env.SLACK_SIGNING_SECRET?.trim()) {
    throw new HttpError(503, "Slack integration is not configured");
  }
  const rawBody = await request.text();
  if (
    !(await verifySlackRequest(
      rawBody,
      request.headers,
      env.SLACK_SIGNING_SECRET,
    ))
  ) {
    throw new HttpError(401, "Invalid Slack signature");
  }
  return rawBody;
}

async function handleSlackEventRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  const rawBody = await readVerifiedSlackBody(request, env);
  if (
    request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded")
  ) {
    return handleSlackCommandForm(new URLSearchParams(rawBody), env, ctx);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "Invalid Slack event payload");
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    payload.type === "url_verification" &&
    "challenge" in payload &&
    typeof payload.challenge === "string"
  ) {
    return json({ challenge: payload.challenge });
  }
  if (isSlackEventCallback(payload)) {
    const processing = processSlackAppMention(env, payload).finally(() =>
      flushOrganizationInboxRealtimeOutbox(env, env.DB).catch((error) => {
        console.error(JSON.stringify({
          message: "Inbox realtime flush after Slack event failed",
          error: error instanceof Error ? error.message : String(error),
        }));
      })
    );
    if (ctx) ctx.waitUntil(processing);
    else await processing;
  }
  return json({ ok: true });
}

async function readVerifiedGithubBody(request: Request, env: Env) {
  const maxBytes = 1_048_576;
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new HttpError(503, "GitHub integration is not configured");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new HttpError(400, "Invalid GitHub webhook content length");
    }
    if (declaredLength > maxBytes) {
      throw new HttpError(413, "GitHub webhook body is too large");
    }
  }
  if (!request.body) {
    throw new HttpError(400, "GitHub webhook body is required");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "GitHub webhook body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength > maxBytes) {
    throw new HttpError(413, "GitHub webhook body is too large");
  }
  if (!(await verifyGitHubWebhook(bytes, request.headers, webhookSecret))) {
    throw new HttpError(401, "Invalid GitHub webhook signature");
  }
  return bytes;
}

async function handleGithubWebhookRequest(request: Request, env: Env) {
  const rawBody = await readVerifiedGithubBody(request, env);
  const headers = parseGitHubWebhookHeaders(request.headers);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new HttpError(400, "Invalid GitHub webhook payload");
  }
  const event = parseGitHubWebhook(headers, payload);
  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(Date.parse(claimedAt) - 5 * 60_000).toISOString();
  const action = event.event === "ping" ? null : event.action;
  const claimed = await claimGithubDelivery(env.DB, {
    deliveryId: event.deliveryId,
    eventName: event.event,
    action,
    claimedAt,
    staleBefore,
  });
  if (!claimed) return json({ ok: true, duplicate: true });

  try {
    if (event.event === "ping") {
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event });
    }
    if (event.event === "installation") {
      if (event.action === "deleted" || event.action === "suspend") {
        await disconnectGithubInstallationById(
          env.DB,
          event.installationId,
          claimedAt,
        );
      }
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event, action: event.action });
    }
    if (event.event === "installation_repositories") {
      const updated = await syncGithubConnectionRepositories(env.DB, {
        installationId: event.installationId,
        added: event.added,
        removedIds: event.removed.map((repository) => repository.id),
        observedAt: claimedAt,
      });
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({
        ok: true,
        event: event.event,
        action: event.action,
        updated,
      });
    }
    if (event.event === "github_app_authorization") {
      if (event.action === "revoked") {
        await disconnectGithubInstallationsByAuthorizedUser(
          env.DB,
          event.githubUserId,
          claimedAt,
        );
      }
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event, action: event.action });
    }

    const connection = await getGithubConnectionByInstallation(
      env.DB,
      event.installationId,
    );
    if (event.event === "merge_group") {
      if (event.action !== "checks_requested") {
        await completeGithubDelivery(
          env.DB,
          event.deliveryId,
          claimedAt,
          new Date().toISOString(),
        );
        return json({
          ok: true,
          event: event.event,
          ignored: true,
          reason: "unsupported_action",
        });
      }
      const repositoryAccess = connection?.status === "connected"
        ? (await listGithubConnectionRepositories(
            env.DB,
            event.installationId,
          )).some((repository) =>
            repository.repository_id === event.repositoryId &&
            repository.full_name.toLowerCase() ===
              event.repositoryFullName.toLowerCase()
          )
        : false;
      const tailPullRequestNumber = mergeQueueTailPullRequestNumber(
        event.headRef,
        event.baseRef,
      );
      if (!repositoryAccess || tailPullRequestNumber === null) {
        await completeGithubDelivery(
          env.DB,
          event.deliveryId,
          claimedAt,
          new Date().toISOString(),
        );
        return json({
          ok: true,
          event: event.event,
          ignored: true,
          reason: !repositoryAccess
            ? "repository_unconnected"
            : "unsupported_base",
        });
      }
      const stored = await recordSignedMergeGroupHead(env.DB, {
        deliveryId: event.deliveryId,
        repositoryId: event.repositoryId,
        repository: event.repositoryFullName,
        baseBranch: "main",
        headRef: event.headRef,
        headSha: event.headSha,
        baseSha: event.baseSha,
        tailPullRequestNumber,
        receivedAt: claimedAt,
      });
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({
        ok: true,
        event: event.event,
        stored: stored !== null,
        state: stored?.state ?? null,
      });
    }
    if (connection?.status === "disconnected") {
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({
        ok: true,
        event: event.event,
        ignored: true,
        reason: "integration_disconnected",
      });
    }
    if (event.event === "issues") {
      // GitHub Issue mirroring is intentionally non-authoritative for the
      // Briar workflow. Accept the signed delivery without moving a run.
      await completeGithubDelivery(
        env.DB,
        event.deliveryId,
        claimedAt,
        new Date().toISOString(),
      );
      return json({ ok: true, event: event.event, matchedRunCount: 0 });
    }

    await recordSignedMergeQueuePullRequestObservation(env.DB, {
      deliveryId: event.deliveryId,
      repositoryId: event.repositoryId,
      pullRequestNumber: event.number,
      action: event.action,
      identityChanged: event.action === "synchronize" || event.baseBranchChanged,
      headSha: event.headSha,
      baseBranch: event.baseBranch,
      receivedAt: claimedAt,
    });
    const result = await syncGithubPullRequest(env.DB, {
      deliveryId: event.deliveryId,
      installationId: event.installationId,
      repositoryId: event.repositoryId,
      repository: event.repositoryFullName,
      pullRequestId: event.pullRequestId,
      pullRequestNodeId: event.pullRequestNodeId,
      pullRequestNumber: event.number,
      url: event.htmlUrl,
      state: event.state,
      draft: event.draft,
      headSha: event.headSha,
      baseSha: event.baseSha,
      baseBranch: event.baseBranch,
      mergeCommitSha: event.mergeCommitSha,
      openedAt: event.createdAt,
      closedAt: event.closedAt,
      mergedAt: event.mergedAt,
      providerUpdatedAt: event.providerUpdatedAt,
      linkedIssues: event.briarIssueLinks,
      actor: `github:${event.senderLogin}`,
      observedAt: claimedAt,
      organizationId: connection?.organization_id ?? null,
    });
    const mergeQueueReconciliation = await reconcileMergeQueuePullRequest(
      env.DB,
      {
        repositoryId: event.repositoryId,
        pullRequestNumber: event.number,
        observedAt: claimedAt,
      },
    );
    const mergeBatchObservation =
      event.state === "merged" && event.mergedAt
        ? await observeSignedMergedBatchPullRequest(env.DB, {
            deliveryId: event.deliveryId,
            repositoryId: event.repositoryId,
            pullRequestNumber: event.number,
            headSha: event.headSha,
            mergedAt: event.mergedAt,
          })
        : null;
    // The signed provider snapshot includes its exact Briar issue links. A PR
    // evidence request that commits after this handler can consume that
    // snapshot, so successful deliveries are safe to complete even when no
    // run link was visible during this request.
    await completeGithubDelivery(
      env.DB,
      event.deliveryId,
      claimedAt,
      new Date().toISOString(),
    );
    return json({
      ok: true,
      event: event.event,
      ...result,
      mergeQueueReconciliation,
      mergeBatchState: mergeBatchObservation?.batch?.state ?? null,
    });
  } catch (error) {
    await releaseGithubDelivery(env.DB, event.deliveryId, claimedAt);
    throw error;
  }
}

const slackCommandMessage = (text: string) =>
  Response.json({ response_type: "ephemeral", text });

async function openSlackCreateIssueModal(
  input: {
    env: Env;
    teamId: string;
    userId: string;
    channelId: string | null;
    triggerId: string;
    responseUrl: string | null;
    initialTitle?: string;
  },
) {
  const { env, teamId, userId, channelId, triggerId, responseUrl } = input;
  let token: string | null = null;
  const notify = async (text: string) => {
    if (responseUrl) {
      await postSlackCommandResponse(responseUrl, text);
    } else if (token) {
      await callSlackApi("chat.postMessage", token, {
        channel: userId,
        text,
      });
    }
  };
  try {
    const installation = await getSlackInstallation(env.DB, teamId);
    if (!installation) {
      await notify("이 Slack 워크스페이스가 Briar에 연결되어 있지 않습니다.");
      return;
    }
    token = await decryptSlackToken(
      installation.encrypted_bot_token,
      installation.token_iv,
      env.SLACK_TOKEN_ENCRYPTION_KEY,
    );
    const projects = await listOrganizationProjects(
      env.DB,
      installation.organization_id,
    );
    if (projects.length === 0) {
      await notify(
        "이슈를 만들 Briar 프로젝트가 없습니다. 먼저 프로젝트를 만들어 주세요.",
      );
      return;
    }
    await callSlackApi("views.open", token, {
      trigger_id: triggerId,
      view: buildSlackCreateIssueModal({
        projects,
        defaultProjectId: installation.default_project_id,
        responseUrl,
        channelId,
        initialTitle: input.initialTitle,
      }),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Slack create issue modal failed",
        error: error instanceof Error ? error.message : String(error),
        teamId,
      }),
    );
    try {
      await notify(
        "Briar 이슈 생성 화면을 열지 못했습니다. Slack 연결을 새로고침한 뒤 다시 시도해 주세요.",
      );
    } catch {
      // The slash command has already been acknowledged.
    }
  }
}

async function handleSlackCommandForm(
  form: URLSearchParams,
  env: Env,
  ctx?: ExecutionContext,
) {
  if (form.get("ssl_check") === "1") return new Response(null);
  if (form.get("command") !== "/create") {
    return slackCommandMessage("지원하지 않는 Slack 명령입니다.");
  }
  const teamId = form.get("team_id")?.trim() ?? "";
  const channelId = form.get("channel_id")?.trim() ?? "";
  const userId = form.get("user_id")?.trim() ?? "";
  const triggerId = form.get("trigger_id")?.trim() ?? "";
  const responseUrl = form.get("response_url")?.trim() ?? "";
  if (!teamId || !userId || !channelId || !triggerId || !responseUrl) {
    return slackCommandMessage("Slack 명령 정보를 확인할 수 없습니다.");
  }

  const processing = openSlackCreateIssueModal({
    env,
    teamId,
    userId,
    channelId,
    triggerId,
    responseUrl,
    initialTitle: form.get("text") ?? undefined,
  });
  if (ctx) ctx.waitUntil(processing);
  else await processing;
  return new Response(null);
}

async function handleSlackCommandRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  return handleSlackCommandForm(
    new URLSearchParams(await readVerifiedSlackBody(request, env)),
    env,
    ctx,
  );
}

async function processSlackCreateIssueSubmission(
  env: Env,
  submission: SlackCreateIssueSubmission,
  project: ProjectRow,
  token: string,
) {
  const now = new Date();
  const eventId = `view_submission:${submission.viewId}`;
  const claimed = await claimSlackEvent(
    env.DB,
    submission.teamId,
    eventId,
    now.toISOString(),
    new Date(now.getTime() - slackEventClaimTtlMs).toISOString(),
  );
  if (!claimed) return;

  try {
    const attachments = await downloadSlackIssueAttachments(
      token,
      submission.fileIds,
    );
    const sourceKey = `slack-create:${submission.teamId}:${submission.viewId}`;
    const created = await createIssueWithAttachments({
      db: env.DB,
      attachmentsBucket: env.ATTACHMENTS,
      project,
      issue: {
        title: submission.title,
        description: submission.description,
        priority: null,
        status: "queued",
        checkpoints: [],
      },
      attachments,
      sourceKey,
      actor: `slack:${submission.userId}`,
      detail:
        submission.source === "shortcut"
          ? "Slack Briar shortcut으로 생성된 이슈가 처리를 기다리고 있습니다."
          : "Slack /create 명령으로 생성된 이슈가 처리를 기다리고 있습니다.",
      context: {
        origin:
          submission.source === "shortcut"
            ? "slack-shortcut"
            : "slack-command",
        slackTeamId: submission.teamId,
        slackChannelId: submission.channelId,
        slackUserId: submission.userId,
        slackViewId: submission.viewId,
      },
    });
    await completeSlackEvent(
      env.DB,
      submission.teamId,
      eventId,
      new Date().toISOString(),
    );
    try {
      const run = await getHuntRunForProject(
        env.DB,
        project.id,
        created.runId,
      );
      if (!run) {
        throw new Error("Created Slack issue is missing");
      }
      const text = buildSlackIssueCreatedMessage({
        title: submission.title,
        projectName: project.name,
        statusLabel: "작업 대기열",
        runNumber: run.run_number,
        issueKeyPrefix: project.issue_key_prefix,
      });
      if (submission.responseUrl) {
        await postSlackCommandResponse(submission.responseUrl, text);
      } else {
        await callSlackApi("chat.postMessage", token, {
          channel: submission.userId,
          text,
        });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Slack create issue confirmation failed",
          error: error instanceof Error ? error.message : String(error),
          teamId: submission.teamId,
          viewId: submission.viewId,
          runId: created.runId,
        }),
      );
    }
  } catch (error) {
    await releaseSlackEvent(env.DB, submission.teamId, eventId);
    console.error(
      JSON.stringify({
        message: "Slack create issue submission failed",
        error: error instanceof Error ? error.message : String(error),
        teamId: submission.teamId,
        viewId: submission.viewId,
      }),
    );
    try {
      const text =
        ":warning: 이슈를 만들지 못했습니다. 첨부파일 제한과 프로젝트 워크플로를 확인한 뒤 다시 시도해 주세요.";
      if (submission.responseUrl) {
        await postSlackCommandResponse(submission.responseUrl, text);
      } else {
        await callSlackApi("chat.postMessage", token, {
          channel: submission.userId,
          text,
        });
      }
    } catch {
      // The command response URL is best-effort after the modal is acknowledged.
    }
  }
}

async function handleSlackInteractionRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  const form = new URLSearchParams(await readVerifiedSlackBody(request, env));
  const rawPayload = form.get("payload");
  if (!rawPayload) throw new HttpError(400, "Missing Slack interaction payload");
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new HttpError(400, "Invalid Slack interaction payload");
  }
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const view =
    root?.view && typeof root.view === "object"
      ? (root.view as Record<string, unknown>)
      : null;
  if (
    root?.type === "shortcut" &&
    root.callback_id === slackCreateIssueShortcutCallbackId
  ) {
    const team =
      root.team && typeof root.team === "object"
        ? (root.team as Record<string, unknown>)
        : null;
    const user =
      root.user && typeof root.user === "object"
        ? (root.user as Record<string, unknown>)
        : null;
    const teamId = typeof team?.id === "string" ? team.id.trim() : "";
    const userId = typeof user?.id === "string" ? user.id.trim() : "";
    const triggerId =
      typeof root.trigger_id === "string" ? root.trigger_id.trim() : "";
    if (!teamId || !userId || !triggerId) {
      throw new HttpError(400, "Slack shortcut context is incomplete");
    }
    const processing = openSlackCreateIssueModal({
      env,
      teamId,
      userId,
      channelId: null,
      triggerId,
      responseUrl: null,
    });
    if (ctx) ctx.waitUntil(processing);
    else await processing;
    return new Response(null);
  }
  if (
    root?.type !== "view_submission" ||
    view?.callback_id !== slackCreateIssueCallbackId
  ) {
    return new Response(null);
  }

  let submission: SlackCreateIssueSubmission;
  try {
    submission = parseSlackCreateIssueSubmission(payload);
  } catch (error) {
    if (error instanceof SlackCreateIssueValidationError) {
      return Response.json({
        response_action: "errors",
        errors: { [error.blockId]: error.message },
      });
    }
    throw error;
  }
  const installation = await getSlackInstallation(env.DB, submission.teamId);
  if (!installation) {
    return Response.json({
      response_action: "errors",
      errors: {
        [slackCreateIssueBlocks.project]:
          "이 Slack 워크스페이스를 Briar에 다시 연결해 주세요.",
      },
    });
  }
  const project = (
    await listOrganizationProjects(env.DB, installation.organization_id)
  ).find((candidate) => candidate.id === submission.projectId);
  if (!project) {
    return Response.json({
      response_action: "errors",
      errors: {
        [slackCreateIssueBlocks.project]:
          "선택한 프로젝트를 사용할 수 없습니다.",
      },
    });
  }
  const token = await decryptSlackToken(
    installation.encrypted_bot_token,
    installation.token_iv,
    env.SLACK_TOKEN_ENCRYPTION_KEY,
  );
  const processing = processSlackCreateIssueSubmission(
    env,
    submission,
    project,
    token,
  ).finally(() =>
    flushOrganizationInboxRealtimeOutbox(env, env.DB).catch((error) => {
      console.error(JSON.stringify({
        message: "Inbox realtime flush after Slack submission failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    })
  );
  if (ctx) ctx.waitUntil(processing);
  else await processing;
  return new Response(null);
}

async function handleSlackOAuthCallback(request: Request, env: Env) {
  if (!slackConfigAvailable(env)) {
    return html(
      "Slack 연결 실패",
      "Briar 서버의 Slack 환경 변수가 설정되지 않았습니다.",
      503,
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!state || oauthError || !code) {
    return html(
      "Slack 연결 취소됨",
      oauthError
        ? `Slack이 연결을 완료하지 않았습니다 (${oauthError}).`
        : "유효하지 않은 OAuth 응답입니다.",
      400,
    );
  }
  const oauthState = await consumeSlackOAuthState(
    env.DB,
    await sha256Hex(state),
    new Date().toISOString(),
  );
  if (!oauthState) {
    return html(
      "Slack 연결 만료됨",
      "설치 링크가 만료되었거나 이미 사용되었습니다. Briar에서 다시 연결해 주세요.",
      400,
    );
  }

  try {
    const authorization = await exchangeSlackOAuthCode({
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      code,
      redirectUri: slackOAuthRedirectUri(url.origin),
    });
    const encrypted = await encryptSlackToken(
      authorization.token,
      env.SLACK_TOKEN_ENCRYPTION_KEY,
    );
    await upsertSlackInstallation(env.DB, {
      teamId: authorization.teamId,
      teamName: authorization.teamName,
      organizationId: oauthState.organization_id,
      defaultProjectId: oauthState.default_project_id,
      botUserId: authorization.botUserId,
      encryptedBotToken: encrypted.encryptedToken,
      tokenIv: encrypted.iv,
      installedByUserId: oauthState.user_id,
      observedAt: new Date().toISOString(),
    });
    return html(
      "Slack 연결 완료",
      `${authorization.teamName} 워크스페이스가 Briar에 연결되었습니다. 이 창을 닫고 Slack에서 @Briar를 멘션해 보세요.`,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Slack OAuth callback failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return html(
      "Slack 연결 실패",
      "Slack 인증을 저장하지 못했습니다. Briar에서 다시 연결해 주세요.",
      502,
    );
  }
}

async function handleGithubInstallCallback(request: Request, env: Env) {
  const callbackOrigin = githubCallbackOrigin(env);
  if (!githubConfigAvailable(env) || !callbackOrigin) {
    return html(
      "GitHub 연결 실패",
      "Briar 서버의 GitHub App 환경 변수가 설정되지 않았습니다.",
      503,
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const rawInstallationId = url.searchParams.get("installation_id");
  const installationId = rawInstallationId && /^\d+$/u.test(rawInstallationId)
    ? Number(rawInstallationId)
    : Number.NaN;
  if (!state || !Number.isSafeInteger(installationId) || installationId <= 0) {
    return html(
      "GitHub 연결 취소됨",
      "GitHub App 설치가 완료되지 않았거나 유효하지 않은 응답입니다.",
      400,
    );
  }

  const installState = await consumeGithubInstallState(
    env.DB,
    await githubSha256Hex(state),
    new Date().toISOString(),
  );
  if (!installState) {
    return html(
      "GitHub 연결 만료됨",
      "설치 링크가 만료되었거나 이미 사용되었습니다. Briar에서 다시 연결해 주세요.",
      400,
    );
  }

  const oauthState = randomGithubOAuthToken();
  const pkceVerifier = randomGithubOAuthToken();
  const createdAt = new Date();
  await createGithubOAuthState(env.DB, {
    stateHash: await githubSha256Hex(oauthState),
    organizationId: installState.organization_id,
    userId: installState.user_id,
    pkceVerifier,
    installationId,
    expiresAt: new Date(
      createdAt.getTime() + githubOAuthStateTtlMs,
    ).toISOString(),
    createdAt: createdAt.toISOString(),
  });
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID!);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    githubOAuthRedirectUri(callbackOrigin),
  );
  authorizeUrl.searchParams.set("state", oauthState);
  authorizeUrl.searchParams.set(
    "code_challenge",
    await githubPkceChallenge(pkceVerifier),
  );
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("prompt", "select_account");
  return noStoreRedirect(authorizeUrl.toString());
}

async function handleGithubOAuthCallback(request: Request, env: Env) {
  const callbackOrigin = githubCallbackOrigin(env);
  if (!githubConfigAvailable(env) || !callbackOrigin) {
    return html(
      "GitHub 연결 실패",
      "Briar 서버의 GitHub App 환경 변수가 설정되지 않았습니다.",
      503,
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!state || oauthError || !code) {
    return html(
      "GitHub 연결 취소됨",
      oauthError
        ? `GitHub이 연결을 완료하지 않았습니다 (${oauthError}).`
        : "유효하지 않은 OAuth 응답입니다.",
      400,
    );
  }

  const oauthState = await consumeGithubOAuthState(
    env.DB,
    await githubSha256Hex(state),
    new Date().toISOString(),
  );
  if (!oauthState?.installation_id) {
    return html(
      "GitHub 연결 만료됨",
      "인증 요청이 만료되었거나 이미 사용되었습니다. Briar에서 다시 연결해 주세요.",
      400,
    );
  }
  const role = await getOrganizationRole(
    env.DB,
    oauthState.organization_id,
    oauthState.user_id,
  );
  if (!canManageOrganization(role)) {
    return html(
      "GitHub 연결 권한 없음",
      "조직 관리자 권한이 없어 GitHub 연결을 완료할 수 없습니다.",
      403,
    );
  }

  try {
    const authorization = await exchangeGithubOAuthCode({
      clientId: env.GITHUB_APP_CLIENT_ID!,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET!,
      code,
      redirectUri: githubOAuthRedirectUri(callbackOrigin),
      codeVerifier: oauthState.pkce_verifier,
    });
    const verified = await verifyGithubOAuthInstallation({
      accessToken: authorization.access_token,
      installationId: oauthState.installation_id,
      appSlug: env.GITHUB_APP_SLUG!,
    });
    const result = await connectGithubInstallation(env.DB, {
      organizationId: oauthState.organization_id,
      installationId: verified.installation.id,
      installationAccountId: verified.installation.accountId,
      accountLogin: verified.installation.accountLogin,
      accountAvatarUrl: verified.installation.accountAvatarUrl,
      authorizedGithubUserId: verified.user.id,
      authorizedGithubUserLogin: verified.user.login,
      connectedByUserId: oauthState.user_id,
      repositories: verified.repositories,
      observedAt: new Date().toISOString(),
    });
    if (result.outcome !== "connected") {
      return html(
        "GitHub 연결 충돌",
        result.outcome === "organization_conflict"
          ? "이 Briar 조직에는 다른 GitHub 설치가 이미 연결되어 있습니다."
          : "이 GitHub 설치는 다른 Briar 조직에 이미 연결되어 있습니다.",
        409,
      );
    }
    return html(
      "GitHub 연결 완료",
      `${verified.installation.accountLogin}의 GitHub 저장소가 Briar에 연결되었습니다. 이 창을 닫고 Briar로 돌아가세요.`,
    );
  } catch (error) {
    console.error(JSON.stringify({
      message: "GitHub OAuth callback failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return html(
      "GitHub 연결 실패",
      "GitHub 설치를 확인하거나 연결 정보를 저장하지 못했습니다. Briar에서 다시 연결해 주세요.",
      502,
    );
  }
}
const parseJsonArray = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

const dashboardEventJson = (
  event: HuntEventRow,
  actorNames: ReadonlyMap<string, string> = new Map(),
) => ({
  id: event.id,
  attempt: event.attempt,
  revision: event.revision,
  status: event.status,
  workflowStage: event.workflow_stage,
  detail: event.detail,
  actor: event.actor,
  actorName: actorNames.get(event.actor) ?? null,
  qaStatus: event.qa_status,
  trackerState: event.tracker_issue_state,
  pullRequestUrls: parseJsonArray(event.pull_request_urls),
  targetSha: event.target_sha,
  occurredAt: event.occurred_at,
  recordedAt: event.recorded_at,
});

const readLatestWorkLogForRunWithArchive = async (
  db: D1Database,
  archivesBucket: R2Bucket,
  projectId: string,
  runId: string,
  limit = 200,
) => {
  const hot = await readLatestAgentWorkLogForRun(db, projectId, runId);
  const workLog = hot && hot.entries.length > 0
    ? hot
    : await readLatestArchivedWorkLogForRun(
        db,
        archivesBucket,
        projectId,
        runId,
      );
  return workLog
    ? { ...workLog, entries: workLog.entries.slice(-Math.min(limit, 1_000)) }
    : null;
};

function dashboardRunJson(
  run: HuntRunRow,
  attachments: IssueAttachmentRow[],
  prerequisites: IssueDependencyRow[] = [],
  dependents: IssueDependencyRow[] = [],
  resultReviews: IssueResultReviewRow[] = [],
) {
  const status = run.paused_at ? ("paused" as const) : run.status;
  const workflow = normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json));
  const context = parseJsonObject(run.context_json);
  const dependencyStatus = (
    rawStatus: AutoHuntRunStatus,
    pausedAt: string | null,
  ) => (pausedAt ? ("paused" as const) : rawStatus);
  const waitingOnPrerequisiteCount = prerequisites.filter(
    (dependency) => dependency.prerequisite_status !== "completed",
  ).length;
  const waitingCheckpoint = run.waiting_checkpoint_key
    ? workflow.execution.checkpoints.find(
        (checkpoint) => checkpoint.key === run.waiting_checkpoint_key,
      ) ?? null
    : null;
  const checkpointStageIndex = waitingCheckpoint
    ? workflow.stages.findIndex((stage) => stage.id === waitingCheckpoint.stage)
    : -1;
  const nextStage = waitingCheckpoint?.position === "before"
    ? workflow.stages[checkpointStageIndex]
    : workflow.stages[checkpointStageIndex + 1];
  const terminalReviewOnly = Boolean(
    waitingCheckpoint?.position === "after" &&
      checkpointStageIndex === workflow.stages.length - 1,
  );
  return {
    id: run.id,
    runNumber: run.run_number,
    currentAttempt: run.current_attempt,
    currentRevision: run.current_revision,
    source: run.source,
    sourceKey: run.source_key,
    title: run.title,
    status,
    workflowStage: run.workflow_stage,
    workflow,
    progress: progressForAutoHuntRun(
      status,
      run.workflow_stage,
      workflow,
    ),
    pausedAt: run.paused_at,
    resumeRequestedAt: run.resume_requested_at,
    waitingCheckpoint: run.waiting_checkpoint_key
      ? {
          key: run.waiting_checkpoint_key,
          revision: run.waiting_checkpoint_revision ?? run.current_revision,
        }
      : null,
    checkpoint: waitingCheckpoint
      ? {
          key: waitingCheckpoint.key,
          stage: waitingCheckpoint.stage,
          stageLabel:
            workflow.stages[checkpointStageIndex]?.label ?? waitingCheckpoint.stage,
          position: waitingCheckpoint.position,
          attempt: run.current_attempt,
          revision:
            run.waiting_checkpoint_revision ?? run.current_revision,
          reachedAt: run.paused_at,
          nextStage: nextStage?.id ?? null,
          nextStageLabel: nextStage?.label ?? null,
          terminalReviewOnly,
        }
      : null,
    issueCheckpoints: JSON.parse(run.issue_checkpoints_json || "[]"),
    fullAuto:
      context !== null &&
      (context as Record<string, unknown>).fullAuto === true,
    detail: run.detail,
    priority: run.priority,
    assigneeUserId: run.assignee_user_id,
    createdByUserId: run.created_by_user_id ?? null,
    subscribers: issueSubscribers(run),
    repository: run.repository,
    branch: run.branch,
    commitSha: run.commit_sha,
    tracker: run.tracker_provider
      ? {
          provider: run.tracker_provider,
          issueId: run.tracker_issue_id,
          identifier: run.tracker_issue_identifier,
          url: run.tracker_issue_url,
          state: run.tracker_issue_state,
        }
      : null,
    issueDescription: run.issue_description,
    attachments: attachments.map(attachmentJson),
    prerequisites: prerequisites.map((dependency) => ({
      id: dependency.prerequisite_run_id,
      runNumber: dependency.prerequisite_run_number,
      title: dependency.prerequisite_title,
      status: dependencyStatus(
        dependency.prerequisite_status,
        dependency.prerequisite_paused_at,
      ),
    })),
    executionReadiness:
      waitingOnPrerequisiteCount > 0 ? "waiting" : "ready",
    waitingOnPrerequisiteCount,
    dependents: dependents.map((dependency) => ({
      id: dependency.dependent_run_id,
      runNumber: dependency.dependent_run_number,
      title: dependency.dependent_title,
      status: dependencyStatus(
        dependency.dependent_status,
        dependency.dependent_paused_at,
      ),
    })),
    resultSummary: run.result_summary,
    structuredResult: parseStructuredResult(run.structured_result_json),
    resultReviews: resultReviews.map((review) => ({
      userId: review.user_id,
      name: review.name,
      username: review.username,
      image: review.image,
      completedAt: review.completed_at,
    })),
    executionMetrics: parseExecutionMetrics(run.execution_metrics_json),
    pullRequestUrls: parseJsonArray(run.pull_request_urls),
    targetSha: run.target_sha,
    sourceCreatedAt: run.source_created_at,
    stagingQaStatus: run.staging_qa_status,
    productionQaStatus: run.production_qa_status,
    stagingQaDetail: run.staging_qa_detail,
    productionQaDetail: run.production_qa_detail,
    context,
    claimedBy: run.claimed_by,
    claimedAt: run.claimed_at,
    leaseExpiresAt: run.lease_expires_at,
    claimAttempts: run.claim_attempts,
    agentId: run.agent_id,
    preferredProvider: run.preferred_agent_provider,
    preferredModel: run.preferred_agent_model,
    preferredEffort: run.preferred_agent_effort,
    requestedProvider: run.requested_agent_provider,
    requestedModel: run.requested_agent_model,
    requestedEffort: run.requested_agent_effort,
    requestedWorkerId: run.requested_worker_id,
    requestedByUserId: run.requested_by_user_id,
    dispatchMode: run.dispatch_mode,
    dispatchedAt: run.dispatched_at,
    workerId: run.worker_id,
    startedAt: run.started_at,
    updatedAt: run.updated_at,
    completedAt: run.completed_at,
    lastEventAt: run.last_event_at,
    eventCount: run.event_count,
  };
}

function statusTrayRunJson(run: OrganizationStatusTrayRunRow) {
  const workflow = normalizeAutoHuntWorkflow(
    JSON.parse(run.workflow_snapshot_json),
  );
  return {
    projectId: run.project_id,
    projectName: run.project_name,
    id: run.id,
    title: run.title,
    status: run.status,
    workflowStage: run.workflow_stage,
    workflowStageLabel:
      workflow.stages.find((stage) => stage.id === run.workflow_stage)?.label ??
      null,
    startedAt: run.started_at,
    updatedAt: run.updated_at,
    lastEventAt: run.last_event_at,
  };
}

async function route(
  request: Request,
  auth: BriarAuth,
  db: D1Database,
  attachmentsBucket: R2Bucket,
  env: Env,
  context?: ExecutionContext,
  workerClaimContext?: AuthenticatedWorkerProject,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  const accountResponse = await handleAccountRoute({
    request,
    auth,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (accountResponse) return accountResponse;

  const managedComputerResponse = await handleManagedComputerRoute({
    request,
    auth,
    db,
    env,
  });
  if (managedComputerResponse !== undefined) return managedComputerResponse;

  const organizationResponse = await handleOrganizationRoute({
    request,
    url,
    auth,
    db,
  });
  if (organizationResponse !== undefined) return organizationResponse;

  const realtimeResponse = await handleRealtimeRoute({
    request,
    auth,
    db,
    env,
  });
  if (realtimeResponse !== undefined) return realtimeResponse;

  const channelMessageResponse = await handleChannelMessageRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
  });
  if (channelMessageResponse !== undefined) return channelMessageResponse;

  const organizationChannelResponse = await handleOrganizationChannelRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (organizationChannelResponse !== undefined) {
    return organizationChannelResponse;
  }

  const channelWebhookManagementResponse =
    await handleChannelWebhookManagementRoute({
      request,
      url,
      auth,
      db,
    });
  if (channelWebhookManagementResponse !== undefined) {
    return channelWebhookManagementResponse;
  }

  const channelProposalResponse = await handleChannelProposalRoute({
    request,
    url,
    auth,
    db,
    env,
  });
  if (channelProposalResponse !== undefined) return channelProposalResponse;

  const organizationWorkerResponse = await handleOrganizationWorkerRoute({
    request,
    url,
    auth,
    db,
    env,
  });
  if (organizationWorkerResponse !== undefined) {
    return organizationWorkerResponse;
  }

  const organizationGithubMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/integrations\/github$/u,
  );
  if (organizationGithubMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationGithubMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const connection = await getGithubConnectionForOrganization(
      db,
      organizationId,
    );
    if (!connection) {
      return json({
        configured: githubConfigAvailable(env),
        canManage: canManageOrganization(role),
        connected: false,
      });
    }
    const repositories = await listGithubConnectionRepositories(
      db,
      connection.installation_id,
    );
    return json({
      configured: githubConfigAvailable(env),
      canManage: canManageOrganization(role),
      connected: true,
      accountLogin: connection.account_login,
      accountAvatarUrl: connection.account_avatar_url,
      installationId: connection.installation_id,
      repositories: repositories.map((repository) => ({
        id: repository.repository_id,
        owner: repository.owner,
        name: repository.name,
        fullName: repository.full_name,
      })),
      connectedAt: connection.connected_at,
    });
  }
  if (organizationGithubMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationGithubMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    await disconnectGithubInstallation(
      db,
      organizationId,
      new Date().toISOString(),
    );
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const organizationGithubInstallMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/integrations\/github\/install-url$/u,
  );
  if (organizationGithubInstallMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationGithubInstallMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    if (!githubConfigAvailable(env)) {
      throw new HttpError(503, "GitHub integration is not configured");
    }
    if (await getGithubConnectionForOrganization(db, organizationId)) {
      throw new HttpError(409, "GitHub integration is already connected");
    }
    const state = randomGithubOAuthToken();
    const createdAt = new Date();
    await createGithubOAuthState(db, {
      stateHash: await githubSha256Hex(state),
      organizationId,
      userId: session.user.id,
      // This verifier is never disclosed or exchanged. The setup callback
      // consumes this state and rotates to a fresh state and PKCE verifier.
      pkceVerifier: randomGithubOAuthToken(),
      expiresAt: new Date(
        createdAt.getTime() + githubOAuthStateTtlMs,
      ).toISOString(),
      createdAt: createdAt.toISOString(),
    });
    const installUrl = new URL(
      `https://github.com/apps/${env.GITHUB_APP_SLUG!}/installations/new`,
    );
    installUrl.searchParams.set("state", state);
    return json({ installUrl: installUrl.toString() }, 201);
  }

  const organizationSlackMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/slack$/u,
  );
  if (organizationSlackMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationSlackMatch[1],
      session.user.id,
    );
    if (!role) throw new HttpError(404, "Organization not found");
    const [projects, installations] = await Promise.all([
      listOrganizationProjects(db, organizationSlackMatch[1]),
      listSlackInstallations(db, organizationSlackMatch[1]),
    ]);
    return json({
      configured: slackConfigAvailable(env),
      canManage: canManageOrganization(role),
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
      })),
      installations: installations.map(slackInstallationJson),
    });
  }
  if (organizationSlackMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationSlackMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    if (!slackConfigAvailable(env)) {
      throw new HttpError(503, "Slack integration is not configured");
    }
    const input = decodeSlackOAuthInput(await readJson(request));
    const project = await getProject(db, input.defaultProjectId, session.user.id);
    if (
      !project ||
      project.organization_id !== organizationSlackMatch[1]
    ) {
      throw new HttpError(404, "Project not found");
    }
    const state = randomUrlSafeToken();
    const createdAt = new Date();
    await createSlackOAuthState(db, {
      stateHash: await sha256Hex(state),
      organizationId: organizationSlackMatch[1],
      defaultProjectId: project.id,
      userId: session.user.id,
      expiresAt: new Date(
        createdAt.getTime() + slackOAuthStateTtlMs,
      ).toISOString(),
      createdAt: createdAt.toISOString(),
    });
    const installUrl = new URL("https://slack.com/oauth/v2/authorize");
    installUrl.searchParams.set("client_id", env.SLACK_CLIENT_ID);
    installUrl.searchParams.set("scope", slackBotScopes.join(","));
    installUrl.searchParams.set(
      "redirect_uri",
      slackOAuthRedirectUri(new URL(request.url).origin),
    );
    installUrl.searchParams.set("state", state);
    return json({ installUrl: installUrl.toString() }, 201);
  }

  const organizationSlackInstallationMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/slack\/installations\/([^/]+)$/u,
  );
  if (
    organizationSlackInstallationMatch &&
    (request.method === "PUT" || request.method === "DELETE")
  ) {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationSlackInstallationMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const teamId = decodeURIComponent(
      organizationSlackInstallationMatch[2],
    );
    if (request.method === "DELETE") {
      const observedAt = new Date().toISOString();
      const outcome = await deleteSlackInstallation(db, {
        organizationId: organizationSlackInstallationMatch[1],
        teamId,
        actorUserId: session.user.id,
        observedAt,
      });
      if (outcome === "forbidden") {
        throw new HttpError(403, "Organization admin access required");
      }
      if (outcome === "not_found") {
        throw new HttpError(404, "Slack workspace not found");
      }
      // Credential durability is already committed. A missing encryption key
      // or Slack outage leaves the row due for scheduled retry instead of
      // risking credential loss; no OAuth/signing configuration is required.
      return responseWithPostCommitCleanup(
        new Response(null, { status: 204, headers: corsHeaders }),
        {
          context,
          operation: "slack_uninstall",
          observedAt,
          tasks: [{
            queue: "slack",
            run: () => processSlackRevocationQueue(db, env, observedAt, 1),
          }],
        },
      );
    }
    const input = decodeSlackOAuthInput(await readJson(request));
    const updated = await updateSlackInstallationProject(
      db,
      organizationSlackInstallationMatch[1],
      teamId,
      input.defaultProjectId,
    );
    if (!updated) {
      throw new HttpError(404, "Slack workspace or project not found");
    }
    const installations = await listSlackInstallations(
      db,
      organizationSlackInstallationMatch[1],
    );
    const installation = installations.find(
      (candidate) => candidate.team_id === teamId,
    );
    if (!installation) throw new HttpError(404, "Slack workspace not found");
    return json({ installation: slackInstallationJson(installation) });
  }

  const projectCoreResponse = await handleProjectCoreRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (projectCoreResponse !== undefined) return projectCoreResponse;

  const projectSettingsResponse = await handleProjectSettingsRoute({
    request,
    url,
    auth,
    db,
  });
  if (projectSettingsResponse !== undefined) return projectSettingsResponse;

  const projectAgentTaskResponse = await handleProjectAgentTaskRoute({
    request,
    url,
    auth,
    db,
    env,
    context,
  });
  if (projectAgentTaskResponse !== undefined) return projectAgentTaskResponse;

  const projectAgentSessionResponse = await handleProjectAgentSessionRoute({
    request,
    url,
    auth,
    db,
    env,
    context,
  });
  if (projectAgentSessionResponse !== undefined) {
    return projectAgentSessionResponse;
  }

  const projectAgentResponse = await handleProjectAgentRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
  });
  if (projectAgentResponse !== undefined) return projectAgentResponse;

  const projectAgentScheduleResponse =
    await handleProjectAgentScheduleRoute({
      request,
      db,
      env,
      context,
      requireSession: () => requireSession(auth, request),
    });
  if (projectAgentScheduleResponse) return projectAgentScheduleResponse;

  const projectLinearResponse = await handleProjectLinearRoute({
    request,
    url,
    auth,
    db,
  });
  if (projectLinearResponse !== undefined) return projectLinearResponse;

  const statusTrayRunsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/status-tray\/runs$/u,
  );
  if (statusTrayRunsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = statusTrayRunsMatch[1];
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!role) throw new HttpError(404, "Organization not found");
    const runs = await listOrganizationStatusTrayRuns(db, organizationId);
    return json({
      runs: runs.map(statusTrayRunJson),
      generatedAt: new Date().toISOString(),
    });
  }

  const projectUsageSummaryMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/usage\/summary$/u,
  );
  if (projectUsageSummaryMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectUsageSummaryMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const period = decodeProjectUsagePeriod(
      new URL(request.url).searchParams.get("period") ?? "day",
    );
    const generatedAt = Date.now();
    const since = new Date(
      projectUsageSummaryWindow(period, generatedAt).startAt,
    ).toISOString();
    const [runs, totals] = await Promise.all([
      listProjectUsageRuns(db, project.id, since),
      listProjectUsageTotals(db, project.id, since),
    ]);
    return json(projectUsageSummaryJson(runs, totals, period, generatedAt));
  }

  const dashboardDeltaMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard\/delta$/u,
  );
  if (dashboardDeltaMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      dashboardDeltaMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    if (!rawCursor || !/^\d+$/u.test(rawCursor)) {
      throw new HttpError(400, "A non-negative dashboard cursor is required");
    }
    const cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor)) {
      throw new HttpError(400, "Dashboard cursor is outside the safe range");
    }
    const page = await listDashboardChanges(db, project.id, cursor);
    if (page.expired) {
      return json(
        {
          code: "dashboard_cursor_expired",
          message: "Dashboard cursor expired; reload the full snapshot",
        },
        410,
      );
    }

    const observedAt = new Date().toISOString();
    const changedRunIds = new Set(
      page.changes.flatMap((change) =>
        change.entity_type === "run" && change.entity_id
          ? [change.entity_id]
          : [],
      ),
    );
    const changedRunIdList = [...changedRunIds];
    const metadataChanged = page.changes.some(
      (change) => change.entity_type === "metadata",
    );
    const notificationsChanged = page.changes.some(
      (change) =>
        change.entity_type === "notifications" || change.entity_type === "run",
    );
    const [
      dashboardRows,
      attachments,
      dependencies,
      resultReviews,
      workers,
      organizationProviders,
    ] =
      await Promise.all([
        listDashboardRunsByIds(db, project.id, changedRunIdList),
        listIssueAttachmentsByRunIds(db, project.id, changedRunIdList),
        listIssueDependenciesByRunIds(db, project.id, changedRunIdList),
        listIssueResultReviewsByRunIds(db, project.id, changedRunIdList),
        listExecutionWorkers(db, project.id, observedAt),
        listOrganizationExecutionProviders(
          db,
          project.organization_id,
        ),
      ]);
    const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
    for (const attachment of attachments) {
      if (!changedRunIds.has(attachment.run_id)) continue;
      const runAttachments = attachmentsByRun.get(attachment.run_id) ?? [];
      runAttachments.push(attachment);
      attachmentsByRun.set(attachment.run_id, runAttachments);
    }
    const prerequisitesByRun = new Map<string, IssueDependencyRow[]>();
    const dependentsByRun = new Map<string, IssueDependencyRow[]>();
    const resultReviewsByRun = new Map<string, IssueResultReviewRow[]>();
    for (const review of resultReviews) {
      if (!changedRunIds.has(review.run_id)) continue;
      const runReviews = resultReviewsByRun.get(review.run_id) ?? [];
      runReviews.push(review);
      resultReviewsByRun.set(review.run_id, runReviews);
    }
    for (const dependency of dependencies) {
      if (changedRunIds.has(dependency.dependent_run_id)) {
        const prerequisites =
          prerequisitesByRun.get(dependency.dependent_run_id) ?? [];
        prerequisites.push(dependency);
        prerequisitesByRun.set(dependency.dependent_run_id, prerequisites);
      }
      if (changedRunIds.has(dependency.prerequisite_run_id)) {
        const dependents =
          dependentsByRun.get(dependency.prerequisite_run_id) ?? [];
        dependents.push(dependency);
        dependentsByRun.set(dependency.prerequisite_run_id, dependents);
      }
    }
    const changedRuns = dashboardRows.filter((run) =>
      changedRunIds.has(run.id),
    );
    const existingRunIds = new Set(changedRuns.map((run) => run.id));
    const metadata = metadataChanged
      ? await Promise.all([
          getProjectSettings(db, project.id),
          loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
          getProjectExecutionWorkerPolicy(db, project.id),
          listOrganizationMembers(db, project.organization_id),
        ])
      : null;
    const conversationNotifications = notificationsChanged
      ? await listIssueConversationNotifications(
          db,
          project.id,
          session.user.id,
        )
      : null;
    // Channel changes have an organization cursor rather than a project
    // dashboard cursor. Refresh this bounded projection on the existing
    // dashboard cadence so Inbox needs no second polling loop.
    const channelNotifications = await listChannelConversationNotifications(
      db,
      project.organization_id,
      session.user.id,
    );

    return json({
      cursor: page.nextCursor,
      hasMore: page.hasMore,
      runs: changedRuns.map((run) =>
        dashboardRunJson(
          run,
          attachmentsByRun.get(run.id) ?? [],
          prerequisitesByRun.get(run.id) ?? [],
          dependentsByRun.get(run.id) ?? [],
          resultReviewsByRun.get(run.id) ?? [],
        ),
      ),
      deletedRunIds: [...changedRunIds].filter(
        (runId) => !existingRunIds.has(runId),
      ),
      // Worker liveness also changes as time passes without a database write,
      // so this small projection is refreshed on every delta request.
      workers: workers.map((worker) => workerJson(worker, observedAt)),
      organizationProviders,
      ...(metadata
        ? {
            project: projectJson(project),
            settings: settingsJson(
              metadata[0],
              checkpointPolicyJson(metadata[1]),
            ),
            executionPolicy: metadata[2],
            members: metadata[3].map(organizationMemberJson),
          }
        : {}),
      ...(conversationNotifications
        ? {
            conversationNotifications: conversationNotifications.map(
              issueConversationNotificationJson,
            ),
          }
        : {}),
      channelNotifications: channelNotifications.map(
        channelConversationNotificationJson,
      ),
      generatedAt: observedAt,
    });
  }

  const dashboardMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard$/u,
  );
  if (dashboardMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dashboardMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    // Capture the cursor before reading the snapshot. A concurrent write is
    // therefore either visible here or guaranteed to appear in the next delta.
    const cursor = await getDashboardSyncCursor(db, project.id);
    const observedAt = new Date().toISOString();
    const [
      runs,
      settings,
      checkpointPolicy,
      attachments,
      dependencies,
      resultReviews,
      workers,
      organizationProviders,
      executionPolicy,
      members,
      conversationNotifications,
      channelNotifications,
    ] =
      await Promise.all([
        listDashboardRuns(db, project.id),
        getProjectSettings(db, project.id),
        loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
        listIssueAttachments(db, project.id),
        listIssueDependencies(db, project.id),
        listIssueResultReviews(db, project.id),
        listExecutionWorkers(db, project.id, observedAt),
        listOrganizationExecutionProviders(
          db,
          project.organization_id,
        ),
        getProjectExecutionWorkerPolicy(db, project.id),
        listOrganizationMembers(db, project.organization_id),
        listIssueConversationNotifications(
          db,
          project.id,
          session.user.id,
        ),
        listChannelConversationNotifications(
          db,
          project.organization_id,
          session.user.id,
        ),
      ]);
    const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
    for (const attachment of attachments) {
      const runAttachments = attachmentsByRun.get(attachment.run_id) ?? [];
      runAttachments.push(attachment);
      attachmentsByRun.set(attachment.run_id, runAttachments);
    }
    const prerequisitesByRun = new Map<string, IssueDependencyRow[]>();
    const dependentsByRun = new Map<string, IssueDependencyRow[]>();
    const resultReviewsByRun = new Map<string, IssueResultReviewRow[]>();
    for (const review of resultReviews) {
      const runReviews = resultReviewsByRun.get(review.run_id) ?? [];
      runReviews.push(review);
      resultReviewsByRun.set(review.run_id, runReviews);
    }
    for (const dependency of dependencies) {
      const prerequisites =
        prerequisitesByRun.get(dependency.dependent_run_id) ?? [];
      prerequisites.push(dependency);
      prerequisitesByRun.set(dependency.dependent_run_id, prerequisites);
      const dependents =
        dependentsByRun.get(dependency.prerequisite_run_id) ?? [];
      dependents.push(dependency);
      dependentsByRun.set(dependency.prerequisite_run_id, dependents);
    }
    return json({
      project: projectJson(project),
      settings: settingsJson(settings, checkpointPolicyJson(checkpointPolicy)),
      runs: runs.map((run) =>
        dashboardRunJson(
          run,
          attachmentsByRun.get(run.id) ?? [],
          prerequisitesByRun.get(run.id) ?? [],
          dependentsByRun.get(run.id) ?? [],
          resultReviewsByRun.get(run.id) ?? [],
        ),
      ),
      workers: workers.map((worker) => workerJson(worker, observedAt)),
      organizationProviders,
      executionPolicy,
      members: members.map(organizationMemberJson),
      conversationNotifications: conversationNotifications.map(
        issueConversationNotificationJson,
      ),
      channelNotifications: channelNotifications.map(
        channelConversationNotificationJson,
      ),
      cursor,
      generatedAt: observedAt,
    });
  }

  const runCostEstimateMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/cost-estimate$/u,
  );
  if (runCostEstimateMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const projectId = runCostEstimateMatch[1];
    const runId = runCostEstimateMatch[2];
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, projectId, runId);
    if (!run) throw new HttpError(404, "Run not found");
    const [usageRecords, loadedPricing] = await Promise.all([
      listRunUsageRecords(
        db,
        projectId,
        runId,
        run.current_attempt,
        run.last_execution_id,
      ),
      loadAgentUsagePricing(),
    ]);
    const metrics = parseExecutionMetrics(run.execution_metrics_json);
    const provider =
      run.preferred_agent_provider ?? run.requested_agent_provider ?? null;
    const model = run.preferred_agent_provider
      ? run.preferred_agent_model
      : run.requested_agent_provider
        ? run.requested_agent_model
        : null;
    return json(
      estimateRunExecutionCost({
        usageRecords,
        loadedPricing,
        fallback:
          metrics && provider
            ? {
                agentProvider: provider,
                model,
                inputTokens: metrics.inputTokens,
                cacheReadTokens: metrics.cacheReadTokens,
                cacheWriteTokens: metrics.cacheWriteTokens,
                outputTokens: metrics.outputTokens,
              }
            : null,
      }),
    );
  }

  const runEventsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/events$/u,
  );
  if (runEventsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, runEventsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, project.id, runEventsMatch[2]);
    if (!run) throw new HttpError(404, "Run not found");
    const [hotEvents, archivedEvents] = await Promise.all([
      listHuntRunEvents(db, project.id, run.id),
      listArchivedRunEvents(db, env.ARCHIVES, project.id, run.id),
    ]);
    const events = [
      ...new Map(
        [...archivedEvents, ...hotEvents].map((event) => [event.id, event]),
      ).values(),
    ].sort(
      (left, right) =>
        right.occurred_at.localeCompare(left.occurred_at) ||
        right.id.localeCompare(left.id),
    );
    const actorNames = await resolveHuntEventActorNames(
      db,
      project.id,
      events.map((event) => event.actor),
    );
    return json({
      runId: run.id,
      eventCount: events.length,
      events: events.map((event) => dashboardEventJson(event, actorNames)),
    });
  }

  const issueConversationResponse = await handleIssueConversationRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket: env.ARCHIVES,
    requireRunExecutionProject,
    requireProjectAccess,
  });
  if (issueConversationResponse !== undefined) {
    return issueConversationResponse;
  }

  const issueProposalResponse = await handleIssueProposalRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket: env.ARCHIVES,
  });
  if (issueProposalResponse !== undefined) return issueProposalResponse;

  const runEvidenceResponse = await handleRunEvidenceRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket: env.ARCHIVES,
    requireRunExecutionProject,
    requireProjectAccess,
  });
  if (runEvidenceResponse !== undefined) return runEvidenceResponse;

  const issueCoreResponse = await handleIssueCoreRoute({
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket: env.ARCHIVES,
    context,
  });
  if (issueCoreResponse !== undefined) return issueCoreResponse;

  const recoveryMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );

  const issueTransferMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/transfer$/u,
  );
  if (issueTransferMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const sourceProject = await getProject(
      db,
      issueTransferMatch[1],
      session.user.id,
    );
    if (!sourceProject) throw new HttpError(404, "Project not found");
    const body = decodeProjectTransferInput(await readJson(request));
    if (body.targetProjectId === sourceProject.id) {
      throw new HttpError(400, "Target project must be different");
    }
    const targetProject = await getProject(
      db,
      body.targetProjectId,
      session.user.id,
    );
    if (!targetProject) throw new HttpError(404, "Target project not found");
    if (targetProject.organization_id !== sourceProject.organization_id) {
      throw new HttpError(
        403,
        "Issues can only be transferred within the same organization",
      );
    }
    const outcome = await transferIssue(db, {
      sourceProjectId: sourceProject.id,
      targetProjectId: targetProject.id,
      targetProjectName: targetProject.name,
      runId: issueTransferMatch[2],
      observedAt: new Date().toISOString(),
    });
    if (outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (outcome === "active") {
      throw new HttpError(
        409,
        "An active issue cannot be transferred",
      );
    }
    if (outcome === "same_project") {
      throw new HttpError(400, "Target project must be different");
    }
    if (outcome === "source_key_conflict") {
      throw new HttpError(
        409,
        "The target project already has an issue with the same source key",
      );
    }
    if (outcome === "archive_in_progress") {
      throw new HttpError(
        409,
        "This issue is being archived; retry the transfer shortly",
      );
    }
    if (outcome === "proposal_approval_in_progress") {
      throw new HttpError(
        409,
        "This issue has an approval in progress; retry the transfer shortly",
      );
    }
    if (outcome === "execution_approval_boundary") {
      throw new HttpError(
        409,
        "Completed or cancelled channel-approved issues cannot be transferred",
      );
    }
    return json({
      runId: issueTransferMatch[2],
      sourceProjectId: sourceProject.id,
      targetProjectId: targetProject.id,
      outcome: "transferred",
    });
  }

  if (recoveryMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, recoveryMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeRecoveryUserInput(await readJson(request));
    const result = await recoverHuntRun(db, project.id, {
      runId: recoveryMatch[2],
      action: recoveryMatch[3] as "retry" | "cancel",
      requestId: input.requestId,
      actor: `briar-app:${session.user.id}`,
      reason: input.reason ?? null,
      occurredAt: new Date().toISOString(),
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "ineligible") {
      throw new HttpError(
        409,
        recoveryMatch[3] === "retry"
          ? "Only blocked or failed runs can be retried"
          : "Completed or cancelled runs cannot be cancelled",
      );
    }
    if (
      recoveryMatch[3] === "cancel" &&
      (result.outcome === "cancelled" ||
        result.outcome === "already_cancelled")
    ) {
      await auditExecutionEvent(db, {
        organizationId: project.organization_id,
        projectId: project.id,
        runId: recoveryMatch[2],
        actorUserId: session.user.id,
        action: "cancelled",
        requestId: input.requestId,
        detail: { reason: input.reason ?? null },
        occurredAt: new Date().toISOString(),
      });
    }
    return json({ runId: recoveryMatch[2], ...result });
  }

  const resumeRunMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/resume$/u,
  );
  if (resumeRunMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, resumeRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeResumeUserInput(await readJson(request));
    const result = await resumeRunWithCheckpointIdentity(
      db,
      project.id,
      resumeRunMatch[2],
      input,
      `briar-app:${session.user.id}`,
    );
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "conflict") {
      throw new HttpError(
        409,
        "The paused checkpoint changed before it could be resumed",
        "CHECKPOINT_CONFLICT",
      );
    }
    return json({
      runId: resumeRunMatch[2],
      ...result,
      workflowStage: result.nextStage,
      startStage: result.nextStage,
    });
  }

  const pausedReworkMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/rework$/u,
  );
  if (pausedReworkMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, pausedReworkMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodePausedRunReworkInput(await readJson(request));
    try {
      const result = await reworkHuntRun(db, project.id, {
        runId: pausedReworkMatch[2],
        workflowStage: input.workflowStage,
        requestId: input.requestId,
        actor: `briar-app:${session.user.id}`,
        reason: input.reason,
        occurredAt: new Date().toISOString(),
        checkpoint: {
          key: input.checkpointKey,
          attempt: input.attempt,
          revision: input.revision,
        },
      });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found");
      }
      return json({ runId: pausedReworkMatch[2], ...result });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message, "CHECKPOINT_CONFLICT");
      }
      throw error;
    }
  }

  const moveRunMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/status$/u,
  );
  if (moveRunMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, moveRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeMoveRunInput(await readJson(request));
    try {
      const result = await moveHuntRun(db, project.id, {
        runId: moveRunMatch[2],
        status: input.status,
        workflowStage: input.workflowStage,
        requestId: input.requestId,
        actor: `briar-app:${session.user.id}`,
        occurredAt: new Date().toISOString(),
      });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found");
      }
      return json({ runId: moveRunMatch[2], ...result });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  const dispatchRunMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/(dispatch|reassign)$/u,
  );
  if (dispatchRunMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dispatchRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeDispatchRun(await readJson(request));
    const dispatched = await dispatchHuntRun(
      db,
      project.organization_id,
      project.id,
      {
        runId: dispatchRunMatch[2],
        agentId: input.agentId ?? null,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        persistPreferences: input.persistPreferences,
        workerId: input.workerId ?? null,
        requestedByUserId: session.user.id,
        requestId: input.requestId,
        occurredAt: new Date().toISOString(),
        reassign: dispatchRunMatch[3] === "reassign",
      },
    );
    if (!dispatched) throw new HttpError(404, "Run not found");
    return json(dispatched);
  }

  const unassignRunMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/unassign$/u,
  );
  if (unassignRunMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, unassignRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeRequestIdInput(await readJson(request));
    const result = await unassignHuntRun(db, project.organization_id, project.id, {
      runId: unassignRunMatch[2],
      requestedByUserId: session.user.id,
      requestId: input.requestId,
      occurredAt: new Date().toISOString(),
    });
    if (!result) throw new HttpError(404, "Run not found");
    return json(result);
  }

  const executionAuditMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/execution-audit$/u,
  );
  if (executionAuditMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, executionAuditMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (project.member_role !== "owner" && project.member_role !== "admin") {
      throw new HttpError(403, "Organization admin access required");
    }
    const runId = new URL(request.url).searchParams.get("runId") ?? undefined;
    const [hotEvents, archivedEvents] = await Promise.all([
      listExecutionAuditEvents(db, project.id, runId),
      listArchivedExecutionAuditEvents(
        db,
        env.ARCHIVES,
        project.id,
        runId,
      ),
    ]);
    const events = [
      ...new Map(
        [...archivedEvents, ...hotEvents].map((event) => [event.id, event]),
      ).values(),
    ].sort(
      (left, right) =>
        right.occurred_at.localeCompare(left.occurred_at) ||
        right.id.localeCompare(left.id),
    );
    return json({
      events: events.map((event) => ({
        id: event.id,
        runId: event.run_id,
        workerId: event.worker_id,
        agentId: event.agent_id,
        actorUserId: event.actor_user_id,
        actorDeviceId: event.actor_device_id,
        action: event.action,
        requestId: event.request_id,
        detail: parseJsonObject(event.detail_json) ?? {},
        occurredAt: event.occurred_at,
      })),
    });
  }

  const executionWorkerResponse = await handleExecutionWorkerRoute({
    request,
    url,
    auth,
    db,
    requireAgentProject: () => requireAgentProject(db, request),
    requireWorkerCredential: () => requireWorkerCredential(db, request),
    requireWorkerProjectBinding: (projectId) =>
      requireWorkerProjectBinding(db, request, projectId),
  });
  if (executionWorkerResponse !== undefined) return executionWorkerResponse;

  const transcriptResponse = await handleTranscriptRoute({
    request,
    url,
    db,
    env,
    requireAgentProject: () => requireAgentProject(db, request),
    requireWorkerProjectBinding: (projectId, workerId) =>
      requireWorkerProjectBinding(db, request, projectId, workerId),
    requireRunExecutionProject: (runId) =>
      requireRunExecutionProject(db, request, runId),
    requireProjectAccess: (projectId) =>
      requireProjectAccess(auth, db, request, projectId),
  });
  if (transcriptResponse !== undefined) return transcriptResponse;

  const projectWorkerResponse = await handleProjectWorkerRoute({
    request,
    url,
    db,
    requireProjectAccess: (projectId) =>
      requireProjectAccess(auth, db, request, projectId),
  });
  if (projectWorkerResponse !== undefined) return projectWorkerResponse;

  const mergeBatchResponse = await handleMergeBatchRoute({
    request,
    url,
    db,
    requireWorkerProjectBinding: (projectId, workerId) =>
      requireWorkerProjectBinding(db, request, projectId, workerId),
  });
  if (mergeBatchResponse !== undefined) return mergeBatchResponse;

  if (pathname === "/worker-claims" && request.method === "POST") {
    const input = decodeWorkerClaimInput(await readJson(request));
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const claimRoutes = [
      {
        pathname: "/issue-reply-claims",
        body: input,
      },
      {
        pathname: "/agent-task-claims",
        body: { workerId: input.workerId, projectId: input.projectId },
      },
      {
        pathname: "/channel-reply-claims",
        body: {
          organizationId: authenticatedWorker.principal.organizationId,
          workerId: input.workerId,
        },
      },
      {
        pathname: "/queue/claims",
        body: input,
      },
    ];
    for (const candidate of claimRoutes) {
      const internalRequest = new Request(
        new URL(candidate.pathname, request.url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(candidate.body),
        },
      );
      const response = await route(
        internalRequest,
        auth,
        db,
        attachmentsBucket,
        env,
        context,
        authenticatedWorker,
      );
      const result = await response.json<{ work: unknown }>();
      if (result.work !== null) return json({ work: result.work });
    }
    return json({ work: null, retryAfterMs: 15_000 });
  }

  if (pathname === "/issue-reply-claims" && request.method === "POST") {
    const input = decodeIssueReplyClaimInput(await readJson(request));
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
      workerClaimContext,
    );
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(
        authenticatedWorker.binding.last_heartbeat_at,
        observedAt,
        authenticatedWorker.binding.state,
      ) !== "online" ||
      authenticatedWorker.binding.accepting_work !== 1 ||
      authenticatedWorker.binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim replies");
    }
    const providers = executionWorkerProviders(authenticatedWorker.binding);
    const defaultProvider = providers.includes(
      authenticatedWorker.binding.agent_provider,
    )
      ? authenticatedWorker.binding.agent_provider
      : providers[0];
    if (!defaultProvider) {
      throw new HttpError(409, "Worker has no available reply provider");
    }
    const claimToken = `briar_reply_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const job = await claimNextIssueAgentReply(db, input.projectId, {
      workerId: authenticatedWorker.binding.id,
      agentProvider: defaultProvider,
      agentProviders: providers,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
      staleBefore: new Date(
        Date.parse(observedAt) - WORKER_STALE_AFTER_MS,
      ).toISOString(),
    });
    if (!job) return json({ work: null });
    scheduleProjectRealtimePublish(env, db, input.projectId, context);

    const [run, events, attachments, messages, evidence, transcript] =
      await Promise.all([
        getHuntRunForProject(db, input.projectId, job.run_id),
        listHuntRunEvents(db, input.projectId, job.run_id),
        listIssueAttachments(db, input.projectId, job.run_id),
        listIssueMessagesWithArchive(
          db,
          env.ARCHIVES,
          input.projectId,
          job.run_id,
        ),
        listRunEvidence(db, input.projectId, job.run_id),
        readLatestWorkLogForRunWithArchive(
          db,
          env.ARCHIVES,
          input.projectId,
          job.run_id,
          200,
        ),
      ]);
    if (!run || !job.agent_provider) {
      throw new HttpError(409, "Reply job lost its issue context");
    }
    const liveAgent = job.agent_id
      ? await getProjectAgent(db, input.projectId, job.agent_id)
      : run.agent_id
        ? await getProjectAgent(db, input.projectId, run.agent_id)
        : null;
    if (job.agent_id && !liveAgent) {
      throw new HttpError(409, "Reply job lost its Project Agent");
    }
    const triggerMessage = messages.find(
      (message) => message.id === job.trigger_message_id,
    ) ?? null;
    const selectedSkillId = job.skill_id ?? null;
    const selectedSkillSnapshotId = job.selected_skill_id_snapshot ?? null;
    const liveSelectedSkill = selectedSkillId && liveAgent
      ? liveAgent.skills.find((skill) => skill.id === selectedSkillId) ?? null
      : null;
    if (
      selectedSkillSnapshotId !== selectedSkillId ||
      (selectedSkillId !== null && (
        !liveSelectedSkill || !triggerMessage ||
        !job.selected_agent_name_snapshot ||
        !job.selected_agent_responsibility_snapshot ||
        !job.selected_skill_name_snapshot ||
        job.selected_skill_instructions_snapshot == null ||
        !job.selected_skill_provider_snapshot ||
        !job.skill_execution_request_snapshot ||
        job.skill_execution_request_snapshot !== triggerMessage.body
      ))
    ) {
      throw new HttpError(409, "Reply job lost its selected Agent Skill");
    }
    const selectedSkill = liveSelectedSkill
      ? {
          ...liveSelectedSkill,
          name: job.selected_skill_name_snapshot!,
          instructions: job.selected_skill_instructions_snapshot!,
          provider: job.selected_skill_provider_snapshot!,
          model: job.selected_skill_model_snapshot ?? null,
          effort: job.selected_skill_effort_snapshot ?? null,
        }
      : null;
    const agent = liveAgent
      ? {
          ...liveAgent,
          name: job.agent_name_snapshot ?? liveAgent.name,
          responsibility:
            job.agent_responsibility_snapshot ?? liveAgent.responsibility,
          skills: selectedSkill
            ? liveAgent.skills.map((skill) =>
                skill.id === selectedSkill.id ? selectedSkill : skill
              )
            : liveAgent.skills,
        }
      : null;
    const activeSkill = selectedSkill ?? (agent
      ? issueProcessingAgentSkillRow(agent.skills)
      : null);
    const replyExecution = issueReplyExecutionConfig({
      provider: job.agent_provider,
      preferred: {
        provider: run.preferred_agent_provider,
        model: run.preferred_agent_model,
        effort: run.preferred_agent_effort,
      },
      requested: {
        provider: run.requested_agent_provider,
        model: run.requested_agent_model,
        effort: run.requested_agent_effort,
      },
      activeSkill,
      agent,
      prioritizeAgent: job.agent_id !== null,
    });
    const handoffContext = await latestExecutionWorkerUpdateHandoff(db, {
      deviceId: authenticatedWorker.principal.deviceId,
      workType: "issueReply",
      workId: job.id,
    });
    return json({
      work: {
        workType: "issueReply",
        workId: job.id,
        runId: run.id,
        sourceKey: `${run.source_key}:reply:${job.trigger_message_id}`,
        title: run.title,
        triggerMessageId: job.trigger_message_id,
        parentMessageId: job.parent_message_id,
        provider: job.agent_provider,
        model: replyExecution.model,
        effort: replyExecution.effort,
        activeSkill: activeSkill ? agentSkillJson(activeSkill) : null,
        handoffContext,
        skillExecutionTarget: selectedSkill && agent && triggerMessage
          ? {
              projectId: input.projectId,
              agentId: agent.id,
              skillId: selectedSkill.id,
              skillName: selectedSkill.name,
              request: job.skill_execution_request_snapshot!,
            }
          : null,
        agent: agent
          ? {
              id: agent.id,
              name: agent.name,
              provider: job.agent_provider,
              model: replyExecution.model,
              effort: replyExecution.effort,
              responsibility: agent.responsibility,
              skill: legacyAgentSkillInstructions(
                activeSkill,
                agent.skill_markdown,
              ),
              skills: agent.skills.map(agentSkillJson),
            }
          : null,
        branch: run.branch,
        requiresPreferredWorker: job.requires_preferred_worker === 1,
        claimToken,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
        activity: env.CHANNEL_ACTIVITY_REALTIME
          ? await issueActivityCredential(
              env,
              authenticatedWorker.principal.organizationId,
              job,
              {
                workerId: authenticatedWorker.binding.id,
                deviceId: authenticatedWorker.principal.deviceId,
              },
            )
          : null,
        snapshot: {
          run: {
            ...dashboardRunJson(run, attachments),
            events: events.map((event) => dashboardEventJson(event)),
            // Workers from before first-class Agent Skills ignore work.agent,
            // but retain arbitrary fields inside snapshot.run. Keep the saved
            // profile here as read-only context during a rolling upgrade.
            agentProfile: agent
              ? {
                  id: agent.id,
                  name: agent.name,
                  responsibility: agent.responsibility,
                  skill: legacyAgentSkillInstructions(
                    activeSkill,
                    agent.skill_markdown,
                  ),
                  skills: agent.skills.map(agentSkillJson),
                }
              : null,
          },
          messages: claimConversationJson(messages, attachments),
          agentTranscript:
            transcript?.entries
              .filter((entry) =>
                entry.entry_type === "message" && entry.status !== "writing"
              )
              .map((entry) => ({
                sequence: entry.sequence,
                message: {
                  type: "event",
                  event: workLogEntryTranscriptEvent(entry),
                },
                recordedAt: entry.updated_at,
              })) ?? [],
          evidence: (evidence ?? []).map((item) => ({
            stage: item.workflow_stage,
            type: item.evidence_type,
            status: item.status,
            detail: item.detail,
            command: item.command,
            url: item.url,
            metadata: item.metadata_json
              ? JSON.parse(item.metadata_json)
              : null,
            observedAt: item.observed_at,
          })),
        },
      },
    });
  }

  const channelReplyClaimResponse = await handleChannelReplyClaimRoute({
    request,
    url,
    db,
    env,
    context,
    authenticatedWorker: workerClaimContext,
  });
  if (channelReplyClaimResponse !== undefined) {
    return channelReplyClaimResponse;
  }

  const channelOrganizationContextResponse =
    await handleChannelOrganizationContextRoute({
      request,
      url,
      db,
      env,
    });
  if (channelOrganizationContextResponse !== undefined) {
    return channelOrganizationContextResponse;
  }

  const channelReplyResultResponse = await handleChannelReplyResultRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    context,
  });
  if (channelReplyResultResponse !== undefined) {
    return channelReplyResultResponse;
  }

  const issueReplyActivityMatch = pathname.match(
    /^\/issue-reply-claims\/([0-9a-f-]+)\/activity$/u,
  );
  if (issueReplyActivityMatch && request.method === "POST") {
    const token = request.headers.get("X-Briar-Channel-Activity-Token") ?? "";
    const verified = await verifyIssueActivityPublishToken(
      env.BETTER_AUTH_SECRET,
      token,
      issueReplyActivityMatch[1],
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity token");
    }
    const input = decodeChannelAgentActivityPublishInput(
      await readJson(request),
    );
    const frame = issueActivityFrame(
      {
        id: verified.replyJobId,
        project_id: verified.projectId,
        run_id: verified.runId,
        trigger_message_id: verified.triggerMessageId,
        parent_message_id: verified.parentMessageId,
        attempts: verified.attempt,
      },
      input,
    );
    await publishIssueActivity(env, verified.organizationId, frame);
    return new Response(null, { status: 204 });
  }

  const issueReplyClaimMatch = pathname.match(
    /^\/issue-reply-claims\/([0-9a-f-]+)\/(lease|complete)$/u,
  );
  if (issueReplyClaimMatch && request.method === "POST") {
    if (issueReplyClaimMatch[2] === "lease") {
      const input = decodeIssueAgentReplyLease(await readJson(request));
      const worker = await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const observedAt = new Date().toISOString();
      const renewed = await renewIssueAgentReplyLease(
        db,
        input.projectId,
        issueReplyClaimMatch[1],
        {
          workerId: worker.binding.id,
          claimTokenHash: await sha256(input.claimToken),
          leaseExpiresAt: leaseExpiryFrom(observedAt),
          updatedAt: observedAt,
        },
      );
      if (!renewed) throw new HttpError(409, "Reply claim is no longer active");
      const activity = env.CHANNEL_ACTIVITY_REALTIME
        ? await issueActivityCredential(
            env,
            worker.principal.organizationId,
            renewed,
            {
              workerId: worker.binding.id,
              deviceId: worker.principal.deviceId,
            },
          )
        : null;
      return json({ leaseExpiresAt: renewed.lease_expires_at, activity });
    }

    const { input, attachments } = await readIssueReplyCompleteRequest(request);
    if (
      (input.executionProposal ||
        (input.proposedAction?.type === "request_issue_create" &&
          input.proposedAction.executeAfterCreate)) &&
      !(await issueExecutionApprovalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    if (
      input.skillExecutionProposal &&
      !(await agentSkillExecutionApprovalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Agent Skill execution approval is not available during this upgrade",
        "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const worker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const observedAt = new Date().toISOString();
    const job = await getClaimedIssueAgentReply(
      db,
      input.projectId,
      issueReplyClaimMatch[1],
      { workerId: worker.binding.id, claimTokenHash, observedAt },
    );
    if (!job) throw new HttpError(409, "Reply claim is no longer active");
    if (input.error) {
      const failed = await failIssueAgentReply(
        db,
        input.projectId,
        job.id,
        {
          workerId: worker.binding.id,
          claimTokenHash,
          error: input.error,
          updatedAt: observedAt,
        },
      );
      if (!failed) throw new HttpError(409, "Reply claim is no longer active");
      scheduleProjectRealtimePublish(env, db, input.projectId, context);
      scheduleIssueActivityClear(
        env,
        worker.principal.organizationId,
        failed,
        context,
      );
      return json({ agentReply: issueAgentReplyJson(failed) });
    }
    if (
      input.skillExecutionProposal &&
      (!job.skill_id || job.selected_skill_id_snapshot !== job.skill_id)
    ) {
      throw new HttpError(
        409,
        "Agent Skill execution requires the server-selected Skill",
        "ISSUE_SKILL_EXECUTION_PROPOSAL_STALE",
      );
    }

    const storedAttachments = prepareStoredAttachments(attachments, () => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.projectId}/${job.run_id}/${id}`,
      };
    });
    const completedAt = new Date().toISOString();
    const replyBody = [
      input.body!,
      ...storedAttachments.map((attachment) =>
        issueAttachmentMarkdown(attachment.id, attachment.filename)
      ),
    ].filter(Boolean).join("\n\n");
    const uploadedKeys: string[] = [];
    const discardUploadedReplyImages = () =>
      deleteUnreferencedUploadedIssueObjects(
        db,
        attachmentsBucket,
        uploadedKeys,
      );
    let completed: Awaited<ReturnType<typeof completeIssueAgentReplyOutput>> =
      null;
    try {
      await uploadStoredAttachments(
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          projectId: input.projectId,
          runId: job.run_id,
          messageId: job.reply_message_id,
        }),
      );
      completed = await completeIssueAgentReplyOutput(
        db,
        input.projectId,
        job.id,
        {
          workerId: worker.binding.id,
          claimTokenHash,
          completedAt,
          output: {
            body: replyBody,
            proposedAction: input.proposedAction ?? null,
            executionProposal: Boolean(input.executionProposal),
            skillExecutionProposal: Boolean(input.skillExecutionProposal),
            attachments: storedAttachments.map(
              ({ file: _file, ...attachment }) => attachment,
            ),
          },
        },
      );
    } catch (error) {
      await discardUploadedReplyImages().catch(() => undefined);
      throw error;
    }
    if (!completed) {
      await discardUploadedReplyImages().catch(() => undefined);
      throw new HttpError(409, "Reply claim is no longer active");
    }
    scheduleProjectRealtimePublish(env, db, input.projectId, context);
    scheduleIssueActivityClear(
      env,
      worker.principal.organizationId,
      completed,
      context,
    );
    const [
      messages,
      reworkProposals,
      actionProposals,
      executionProposals,
      skillExecutionProposals,
    ] =
      await Promise.all([
        listIssueMessagesWithArchive(
          db,
          env.ARCHIVES,
          input.projectId,
          job.run_id,
        ),
        listIssueReworkProposals(db, input.projectId, job.run_id),
        listIssueActionProposals(db, input.projectId, job.run_id),
        listIssueExecutionProposals(db, input.projectId, job.run_id),
        listIssueAgentSkillExecutionProposals(
          db,
          input.projectId,
          job.run_id,
        ),
      ]);
    const reply = messages.find(
      (message) => message.id === job.reply_message_id,
    ) ?? null;
    if (!reply) throw new HttpError(409, "Agent reply could not be persisted");
    const proposal: IssueProposalRow | null =
      reworkProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? actionProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? null;
    const executionProposal: IssueExecutionProposalRow | null =
      executionProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? null;
    const skillExecutionProposal: AgentSkillExecutionProposalRow | null =
      skillExecutionProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? null;
    return json({
      agentReply: issueAgentReplyJson(completed),
      message: issueMessageJson(
        reply,
        storedAttachments.map(({ file: _file, ...attachment }) => ({
          ...attachment,
          project_id: input.projectId,
          run_id: job.run_id,
          created_at: completedAt,
        })),
        proposal,
        executionProposal,
        skillExecutionProposal,
      ),
    });
  }

  if (pathname === "/agent-task-claims" && request.method === "POST") {
    const input = decodeProjectAgentTaskClaimInput(await readJson(request));
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
      workerClaimContext,
    );
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(
        authenticatedWorker.binding.last_heartbeat_at,
        observedAt,
        authenticatedWorker.binding.state,
      ) !== "online" ||
      authenticatedWorker.binding.accepting_work !== 1 ||
      authenticatedWorker.binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim agent tasks");
    }
    const providers = executionWorkerProviders(authenticatedWorker.binding);
    if (providers.length === 0) {
      throw new HttpError(409, "Worker has no available agent provider");
    }
    if (
      !(await isExecutionWorkerAllowedForProject(
        db,
        input.projectId,
        authenticatedWorker.binding.id,
      ))
    ) {
      throw new HttpError(
        409,
        "Worker is not allowed by this project's execution policy",
      );
    }
    const reaped = await reapProjectAgentTaskJobs(db, input.projectId, {
      observedAt,
      error: "Worker lease expired after repeated attempts.",
    });
    await Promise.all(
      reaped.map(async (job) => {
        if (job.skill_execution_proposal_id) {
          const session = await getProjectAgentSession(
            db,
            job.project_id,
            job.id,
          );
          if (!session) return;
          await upsertProjectAgentSessionSummary(db, session, false);
          scheduleProjectAgentSessionRealtimePublish(
            env,
            db,
            job.project_id,
            context,
          );
          return;
        }
        const session = await syncProjectAgentTaskSession(
          db,
          job,
          { error: job.error },
        );
        if (session) {
          scheduleProjectAgentSessionRealtimePublish(
            env,
            db,
            job.project_id,
            context,
          );
        }
      }),
    );
    const claimToken = `briar_agent_task_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const job = await claimNextProjectAgentTask(db, input.projectId, {
      workerId: authenticatedWorker.binding.id,
      agentProviders: providers,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
    });
    if (!job) return json({ work: null });
    const activeSkill = job.agent_skills.find(
      (skill) => skill.id === job.selected_skill_id,
    );
    if (!activeSkill) {
      throw new HttpError(409, "Agent task lost its selected Skill");
    }
    const handoffContext = await latestExecutionWorkerUpdateHandoff(db, {
      deviceId: authenticatedWorker.principal.deviceId,
      workType: "projectAgentTask",
      workId: job.id,
    });
    return json({
      work: {
        workType: "projectAgentTask",
        workId: job.id,
        runId: job.id,
        sourceKey: `project-agent:${input.projectId}:${job.id}`,
        title: job.agent_name,
        claimToken,
        claimAttempts: job.attempts,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
        request: job.request,
        activeSkill: agentSkillJson(activeSkill),
        handoffContext,
        agent: {
          id: job.agent_id,
          name: job.agent_name,
          provider: job.agent_provider,
          model: job.agent_model,
          effort: job.agent_effort,
          responsibility: job.agent_responsibility,
          skill: job.agent_skill,
          skills: job.agent_skills.map(agentSkillJson),
        },
      },
    });
  }

  const projectAgentTaskClaimMatch = pathname.match(
    /^\/agent-task-claims\/([0-9a-f-]+)\/(lease|complete)$/u,
  );
  if (projectAgentTaskClaimMatch && request.method === "POST") {
    const body = await readJson(request);
    if (projectAgentTaskClaimMatch[2] === "lease") {
      const input = decodeProjectAgentTaskLease(body);
      const worker = await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const renewed = await renewProjectAgentTaskLease(
        db,
        input.projectId,
        projectAgentTaskClaimMatch[1],
        {
          workerId: worker.binding.id,
          claimTokenHash: await sha256(input.claimToken),
          leaseExpiresAt: leaseExpiryFrom(new Date().toISOString()),
          updatedAt: new Date().toISOString(),
        },
      );
      if (!renewed) throw new HttpError(409, "Agent task claim is no longer active");
      return json({ leaseExpiresAt: renewed.lease_expires_at });
    }
    const input = decodeProjectAgentTaskCompletion(body);
    const worker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const observedAt = new Date().toISOString();
    const completion = await completeProjectAgentTaskWithReceipt(
      db,
      input.projectId,
      projectAgentTaskClaimMatch[1],
      {
        workerId: worker.binding.id,
        claimTokenHash,
        updatedAt: observedAt,
        summary: input.summary ?? null,
        conversationId: input.conversationId ?? null,
        error: input.error,
      },
    );
    if (!completion) {
      throw new HttpError(409, "Agent task completion conflicts with its receipt");
    }
    const completed = completion.job;
    const hotSession = await getProjectAgentSession(
      db,
      input.projectId,
      projectAgentTaskClaimMatch[1],
    );
    let session = hotSession ? projectAgentSessionJson(hotSession) : null;
    let sessionChanged = false;
    if (
      completed && !completed.skill_execution_proposal_id &&
      hotSession &&
      (
        !completion.replayed || hotSession.updated_at !== completed.updated_at ||
        hotSession.status !== (completed.status === "queued" ? "running" : completed.status)
      )
    ) {
      session = await syncProjectAgentTaskSession(db, completed, {
        summary: completed.result_summary ?? input.summary ?? null,
        conversationId:
          completed.result_conversation_id ?? input.conversationId ?? null,
        error: completed.error ?? input.error ?? null,
      });
      sessionChanged = session !== null;
    }
    if (completed?.skill_execution_proposal_id && hotSession) {
      const summaryResult = await upsertProjectAgentSessionSummary(
        db,
        hotSession,
        false,
      );
      sessionChanged ||= (summaryResult.meta.changes ?? 0) > 0;
    }
    if (sessionChanged) {
      scheduleProjectAgentSessionRealtimePublish(
        env,
        db,
        input.projectId,
        context,
      );
    }
    if (!session) {
      const archived = await getArchivedProjectAgentSession(
        db,
        env.ARCHIVES,
        input.projectId,
        projectAgentTaskClaimMatch[1],
      );
      session = archived ? projectAgentSessionJson(archived) : null;
    }
    if (!session) throw new HttpError(409, "Agent task session is missing");
    return json({ session });
  }

  if (pathname === "/queue/claims" && request.method === "POST") {
    // Migration 0090 is applied by worker:deploy before this code can run.
    const input = decodeClaimInput(await readJson(request));
    let authenticatedWorkerId: string | undefined;
    let authenticatedWorker:
      | Awaited<ReturnType<typeof requireWorkerProjectBinding>>
      | undefined;
    const projectId = input.workerId
      ? (() => {
          if (!input.projectId) {
            throw new HttpError(400, "projectId is required for worker claims");
          }
          return input.projectId;
        })()
      : await requireAgentProject(db, request);
    if (input.workerId) {
      authenticatedWorker = await requireWorkerProjectBinding(
        db,
        request,
        projectId,
        input.workerId,
        workerClaimContext,
      );
      authenticatedWorkerId = authenticatedWorker.binding.id;
      if (
        workerStateAt(
          authenticatedWorker.binding.last_heartbeat_at,
          new Date().toISOString(),
          authenticatedWorker.binding.state,
        ) !== "online" ||
        authenticatedWorker.binding.accepting_work !== 1 ||
        authenticatedWorker.binding.readiness_state === "needs_attention"
      ) {
        throw new HttpError(409, "Worker is not ready to claim work");
      }
    }
    const claimedAt = new Date().toISOString();
    // Recover runs abandoned by a dead worker before looking at the queue, so
    // they are claimable again in this same request.
    await reapStalledHuntRuns(db, projectId, claimedAt);
    const leaseExpiresAt = leaseExpiryFrom(claimedAt);
    const claimToken = `briar_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: await sha256(claimToken),
      claimedBy: input.claimedBy,
      claimedAt,
      leaseExpiresAt,
      runId: input.runId,
      workerId: authenticatedWorkerId,
      workerDeviceId: authenticatedWorker?.principal.deviceId,
      agentProviders: authenticatedWorker
        ? executionWorkerProviders(authenticatedWorker.binding)
        : undefined,
      detachedOnly: Boolean(authenticatedWorkerId),
    });
    if (!run && input.runId) {
      const waiting = await db
        .prepare(
          `select count(*) as count
           from briar_issue_dependencies dependency
           join briar_hunt_runs prerequisite
             on prerequisite.id = dependency.prerequisite_run_id
           where dependency.project_id = ?
             and dependency.dependent_run_id = ?
             and prerequisite.status != 'completed'`,
        )
        .bind(projectId, input.runId)
        .first<{ count: number }>();
      if ((waiting?.count ?? 0) > 0) {
        throw new HttpError(
          409,
          "Run is waiting for prerequisite issues to complete",
        );
      }
    }
    if (run && authenticatedWorker) {
      await auditExecutionEvent(db, {
        organizationId: authenticatedWorker.principal.organizationId,
        projectId,
        runId: run.id,
        workerId: authenticatedWorker.binding.id,
        agentId: run.agent_id,
        actorDeviceId: authenticatedWorker.principal.deviceId,
        action: "claimed",
        detail: { claimAttempts: run.claim_attempts },
        occurredAt: claimedAt,
      });
    }
    const agent =
      run?.agent_id ? await getProjectAgent(db, projectId, run.agent_id) : null;
    const activeSkill = agent
      ? issueProcessingAgentSkillRow(agent.skills)
      : null;
    const execution = run
      ? issueClaimExecutionConfig({
          preferred: {
            provider: run.preferred_agent_provider,
            model: run.preferred_agent_model,
            effort: run.preferred_agent_effort,
          },
          requested: {
            provider: run.requested_agent_provider,
            model: run.requested_agent_model,
            effort: run.requested_agent_effort,
          },
          activeSkill,
          agent,
        })
      : null;
    const [attachments, messages, reworkFeedbackEvent] = run
      ? await Promise.all([
          listIssueAttachments(db, projectId, run.id),
          listIssueMessagesWithArchive(db, env.ARCHIVES, projectId, run.id),
          run.current_revision > 1
            ? db
                .prepare(
                  `select detail from briar_hunt_events
                   where run_id = ? and revision = ?
                     and event_key like 'workflow:rework:%'
                   order by recorded_at desc, id desc
                   limit 1`,
                )
                .bind(run.id, run.current_revision)
                .first<{ detail: string | null }>()
            : null,
        ])
      : [[], [], null];
    const workflowContext = run
      ? await claimWorkflowContext(db, projectId, run)
      : { startStage: null, resumeContext: null };
    const handoffContext = run && authenticatedWorker
      ? await latestExecutionWorkerUpdateHandoff(db, {
          deviceId: authenticatedWorker.principal.deviceId,
          workType: "issue",
          workId: run.id,
        })
      : null;
    return json({
      work: run
        ? {
            runId: run.id,
            runNumber: run.run_number,
            currentAttempt: run.current_attempt,
            currentRevision: run.current_revision,
            source: run.source,
            sourceKey: run.source_key,
            title: run.title,
            description: run.issue_description,
            priority: run.priority,
            repository: run.repository,
            sourceCreatedAt: run.source_created_at,
            createdByUserId: run.created_by_user_id ?? null,
            context: parseJsonObject(run.context_json),
            reviewFeedback: reworkFeedbackEvent?.detail ?? null,
            workflowStage: run.workflow_stage,
            startStage: workflowContext.startStage,
            resumeContext: workflowContext.resumeContext,
            workflow: normalizeAutoHuntWorkflow(
              JSON.parse(run.workflow_snapshot_json),
            ),
            attachments: attachments.map(attachmentJson),
            messages: claimConversationJson(messages, attachments),
            claimToken,
            executionId: run.last_execution_id,
            claimedBy: run.claimed_by,
            claimedAt: run.claimed_at,
            leaseExpiresAt: run.lease_expires_at,
            claimAttempts: run.claim_attempts,
            handoffContext,
            execution: execution?.provider
              ? execution
              : null,
            activeSkill: activeSkill ? agentSkillJson(activeSkill) : null,
            agent: agent
              ? {
                  id: agent.id,
                  name: agent.name,
                  provider: execution?.provider ?? agent.provider,
                  model: execution?.model ?? null,
                  effort: execution?.effort ?? null,
                  responsibility: agent.responsibility,
                  skill: legacyAgentSkillInstructions(
                    activeSkill,
                    agent.skill_markdown,
                  ),
                  skills: agent.skills.map(agentSkillJson),
                }
              : null,
          }
        : null,
    });
  }

  const runAgentResponse = await handleRunAgentRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    requireRunExecutionProject: (runId) =>
      requireRunExecutionProject(db, request, runId),
    requireActiveWorkerRunClaim: (runId) =>
      requireActiveWorkerRunClaim(db, request, runId),
    requireAgentProject: () => requireAgentProject(db, request),
  });
  if (runAgentResponse !== undefined) return runAgentResponse;

  throw new HttpError(404, "Not found");
}

export default {
  scheduled: handleScheduledTask,
  async fetch(
    request: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const publicResponse = await handlePublicRoute({ request, env });
    if (publicResponse) return publicResponse;

    const incomingChannelWebhookResponse =
      await handleIncomingChannelWebhookRoute({
        request,
        env,
        context: ctx,
      });
    if (incomingChannelWebhookResponse !== undefined) {
      return incomingChannelWebhookResponse;
    }
    if (url.pathname === "/github/webhooks" && request.method === "POST") {
      try {
        const response = await handleGithubWebhookRequest(request, env);
        scheduleInboxRealtimeFlush(env, env.DB, ctx);
        return response;
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ message: error.message }, error.status);
        }
        if (error instanceof RequestDecodeError) {
          return json({
            message: "Invalid GitHub webhook",
            issues: formatSchemaIssue(error.cause.issue).issues,
          }, 400);
        }
        console.error(
          JSON.stringify({
            message: "GitHub webhook request failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return json({ message: "Internal server error" }, 500);
      }
    }
    if (
      url.pathname === "/github/install/callback" &&
      request.method === "GET"
    ) {
      return handleGithubInstallCallback(request, env);
    }
    if (
      url.pathname === "/github/oauth/callback" &&
      request.method === "GET"
    ) {
      return handleGithubOAuthCallback(request, env);
    }
    if (url.pathname === "/slack/commands" && request.method === "POST") {
      try {
        return await handleSlackCommandRequest(request, env, ctx);
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ message: error.message }, error.status);
        }
        console.error(
          JSON.stringify({
            message: "Slack command request failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return slackCommandMessage(
          "Briar 이슈 생성 화면을 열지 못했습니다. Slack 연결을 새로고침한 뒤 다시 시도해 주세요.",
        );
      }
    }
    if (url.pathname === "/slack/interactions" && request.method === "POST") {
      try {
        return await handleSlackInteractionRequest(request, env, ctx);
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ message: error.message }, error.status);
        }
        console.error(
          JSON.stringify({
            message: "Slack interaction request failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return json({ message: "Internal server error" }, 500);
      }
    }
    if (url.pathname === "/slack/events" && request.method === "POST") {
      try {
        return await handleSlackEventRequest(request, env, ctx);
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ message: error.message }, error.status);
        }
        console.error(
          JSON.stringify({
            message: "Slack event request failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return json({ message: "Internal server error" }, 500);
      }
    }
    if (url.pathname === "/slack/oauth/callback" && request.method === "GET") {
      return handleSlackOAuthCallback(request, env);
    }
    try {
      const auth = createAuth(env, url.origin, ctx);
      const response = await route(
        request,
        auth,
        env.DB,
        env.ATTACHMENTS,
        env,
        ctx,
      );
      const organizationId = channelMutationOrganization(
        url.pathname,
        request.method,
        response.status,
      );
      if (organizationId) {
        scheduleChannelRealtimePublish(env, env.DB, organizationId, ctx);
      }
      const projectId = projectMutationProject(
        url.pathname,
        request.method,
        response.status,
      );
      if (projectId) {
        scheduleProjectRealtimePublish(env, env.DB, projectId, ctx);
      }
      const projectScheduleClaimHandled = projectScheduleClaimMutation(
        url.pathname,
        request.method,
        response.status,
      );
      if (
        !organizationId &&
        !projectId &&
        !projectScheduleClaimHandled &&
        request.method !== "GET" &&
        request.method !== "HEAD"
      ) {
        scheduleInboxRealtimeFlush(env, env.DB, ctx);
      }
      return response;
    } catch (error) {
      const skillConflictMessage = agentSkillConflictMessage(error);
      if (skillConflictMessage) {
        return json({ message: skillConflictMessage }, 409);
      }
      if (error instanceof HttpError) {
        return json(
          {
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
          },
          error.status,
        );
      }
      if (error instanceof ManagedComputerServiceError) {
        return json(
          { message: error.message, code: error.code },
          error.status,
        );
      }
      if (error instanceof WorkerConflictError) {
        return json({ message: error.message }, 409);
      }
      if (error instanceof TranscriptLimitError) {
        return json({ message: error.message }, 413);
      }
      if (error instanceof OrganizationAgentContextCursorError) {
        return json({ message: error.message }, 400);
      }
      if (error instanceof OrganizationAgentContextPageTooLargeError) {
        return json({ message: error.message }, 413);
      }
      if (error instanceof TranscriptRequestDecodeError) {
        return json({
          message: "Invalid request",
          issues: formatSchemaIssue(error.cause.issue).issues,
        }, 400);
      }
      if (error instanceof RequestDecodeError) {
        return json({
          message: "Invalid request",
          issues: formatSchemaIssue(error.cause.issue).issues,
        }, 400);
      }
      if (error instanceof ProjectWorkflowInputError) {
        return json({
          message: error.message,
          code: error.code,
          issues: error.issues,
        }, 400);
      }
      if (error instanceof AutoHuntWorkflowValidationError) {
        return json({
          message: "Invalid checkpoint policy",
          code: "INVALID_CHECKPOINT_POLICY",
          issues: error.issues,
        }, 400);
      }
      console.error(
        JSON.stringify({
          message: "request failed",
          error: error instanceof Error ? error.message : String(error),
          method: request.method,
          path: url.pathname,
        }),
      );
      return json({ message: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
