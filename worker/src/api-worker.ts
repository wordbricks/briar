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
import { integrationHtml as html } from "./integration-http";
import {
  handleGithubPublicRoute,
  handleOrganizationGithubRoute,
} from "./github-integration-routes";
import { handleDashboardRoute } from "./dashboard-routes";
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
  handleOrganizationSlackRoute,
  handleSlackAppPublicRoute,
} from "./slack-app-routes";
import { handleSlackEventPublicRoute } from "./slack-event-routes";
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

  const organizationGithubResponse = await handleOrganizationGithubRoute({
    request,
    url,
    auth,
    db,
    env,
  });
  if (organizationGithubResponse !== undefined) {
    return organizationGithubResponse;
  }

  const organizationSlackResponse = await handleOrganizationSlackRoute({
    request,
    url,
    auth,
    db,
    env,
    context,
  });
  if (organizationSlackResponse !== undefined) {
    return organizationSlackResponse;
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

  const dashboardResponse = await handleDashboardRoute({
    request,
    url,
    auth,
    db,
    archivesBucket: env.ARCHIVES,
  });
  if (dashboardResponse !== undefined) return dashboardResponse;

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
    const githubPublicResponse = await handleGithubPublicRoute({
      request,
      url,
      env,
      context: ctx,
    });
    if (githubPublicResponse !== undefined) return githubPublicResponse;

    const slackAppResponse = await handleSlackAppPublicRoute({
      request,
      url,
      env,
      context: ctx,
    });
    if (slackAppResponse !== undefined) return slackAppResponse;

    const slackEventResponse = await handleSlackEventPublicRoute({
      request,
      url,
      env,
      context: ctx,
    });
    if (slackEventResponse !== undefined) return slackEventResponse;

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
