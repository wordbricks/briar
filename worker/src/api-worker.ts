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
import { handleIssueControlRoute } from "./issue-control-routes";
import { handleIssueReplyWorkerRoute } from "./issue-reply-worker-routes";
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
import { handleProjectAgentTaskWorkerRoute } from "./project-agent-task-worker-routes";
import { handleProjectCoreRoute } from "./project-core-routes";
import { handleProjectLinearRoute } from "./project-linear-routes";
import { handleProjectSettingsRoute } from "./project-settings-routes";
import { handleProjectWorkerRoute } from "./project-worker-routes";
import { handleQueueClaimRoute } from "./queue-claim-routes";
import { handlePublicRoute } from "./public-routes";
import { handleIncomingChannelWebhookRoute } from "./incoming-channel-webhook";
import { handleRealtimeRoute } from "./realtime-routes";
import {
  type AuthenticatedWorkerProject,
  requireAgentProject,
  requireWorkerCredential,
  requireWorkerProjectBinding,
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
  dashboardEventJson,
  dashboardRunJson,
  statusTrayRunJson,
} from "./dashboard-json";
import { readLatestWorkLogForRunWithArchive } from "./agent-worklog-service";
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

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

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

  const issueControlResponse = await handleIssueControlRoute({
    request,
    url,
    auth,
    db,
    archivesBucket: env.ARCHIVES,
  });
  if (issueControlResponse !== undefined) return issueControlResponse;

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

  const issueReplyWorkerResponse = await handleIssueReplyWorkerRoute({
    request,
    url,
    db,
    attachmentsBucket,
    env,
    context,
    authenticatedWorker: workerClaimContext,
  });
  if (issueReplyWorkerResponse !== undefined) return issueReplyWorkerResponse;

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

  const projectAgentTaskWorkerResponse =
    await handleProjectAgentTaskWorkerRoute({
      request,
      url,
      db,
      env,
      context,
      authenticatedWorker: workerClaimContext,
    });
  if (projectAgentTaskWorkerResponse !== undefined) {
    return projectAgentTaskWorkerResponse;
  }

  const queueClaimResponse = await handleQueueClaimRoute({
    request,
    url,
    db,
    env,
    authenticatedWorker: workerClaimContext,
  });
  if (queueClaimResponse !== undefined) return queueClaimResponse;

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
