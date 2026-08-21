import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SchemaIssue from "effect/SchemaIssue";
import briarIconPng from "../../src/assets/app-icons/aubergine-riso.png";
import {
  AutoHuntWorkflowValidationError,
  autoHuntEvidenceTypeMaxLength,
  autoHuntEvidenceTypePattern,
  autoHuntPersistedRunStatuses,
  autoHuntRequirementKinds,
  autoHuntSources,
  canonicalizeCheckpointSet,
  cloneAutoHuntWorkflow,
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
  type AutoHuntPersistedRunStatus,
  type AutoHuntRunStatus,
  type DashboardStage,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import {
  decodeStructuredAgentResultOption,
  type StructuredAgentResult,
} from "../../src/lib/agent-result";
import {
  decodeAgentExecutionMetricsOption,
} from "../../src/lib/agent-execution-metrics";
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
  normalizeProjectAgentLocale,
} from "../../src/lib/project-agent";
import {
  isValidProjectAgentScheduleTimeZone,
  normalizeProjectAgentScheduleDay,
  normalizeProjectAgentScheduleDays,
  normalizeProjectAgentScheduleInterval,
  parseProjectAgentScheduleDays,
  projectAgentScheduleIntervalUnits,
  projectAgentScheduleNotificationLevels,
  projectAgentScheduleRecurrences,
} from "../../src/lib/project-agent-schedule";
import {
  maxEvidenceMultipartBytes,
  validateEvidenceImages,
} from "../../src/lib/evidence-images";
import {
  maxIssueMultipartBytes,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "../../src/lib/issue-attachments";
import {
  canonicalizeIssueAttachmentReferences,
  isIssueAttachmentReference,
  issueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import {
  agentReplyParentMessageId,
  issueReplyAgentIds,
} from "../../src/lib/issue-reply-decision";
import {
  CHANNEL_AGENT_ACTIVITY_STALE_MS,
  CHANNEL_AGENT_ACTIVITY_VERSION,
  ChannelAgentActivityPublishInput,
  type ChannelAgentActivityFrame,
  type IssueAgentActivityFrame,
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
  summarizeProjectUsage,
  type ProjectUsagePeriod,
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
  authEmailSenderFromEnv,
  createAuth,
  handleAuthRequest,
  type BriarAuth,
} from "./auth";
import { authEmailIdentifierHash } from "./auth-email";
import { devicePage as otpDevicePage } from "./auth-device";
import {
  contentDisposition,
  prepareStoredAttachments,
  uploadStoredAttachments,
} from "./attachment-storage";
import {
  decodeMobileCurrentUserResponse,
  decodeMobileHealthResponse,
  decodeMobileProjectsResponse,
} from "./mobile-contract";
import { buildInboxFeedMessages } from "./inbox-feed";
import {
  getDashboardSyncCursor,
  listDashboardChanges,
} from "./dashboard-change-repository";
import {
  listInboxReadStates,
  upsertInboxReadStates,
} from "./inbox-read-state-repository";
import {
  getOrganizationInvitationByTokenHash,
  getOrganizationRole,
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizations,
  type OrganizationInvitationRow,
  type OrganizationMemberRow,
  type OrganizationRole,
  type OrganizationRow,
} from "./organization-repository";
import {
  listOrganizationInboxProjects,
  listOrganizationProjects,
  listProjects,
  type ProjectRow,
} from "./project-repository";
import {
  archiveCompletedLogs,
  backfillArchivedProjectAgentSessionSummaries,
  collectStorageMetrics,
  expireArchives,
  getArchivedEvidenceImage,
  getArchivedProjectAgentSession,
  listArchivedExecutionAuditEvents,
  listArchivedIssueMessages,
  listArchivedProjectAgentSessions,
  listArchivedRunEvidence,
  listArchivedRunEvents,
  processArchiveCleanupQueue,
  readArchivedWorkLog,
  readLatestArchivedWorkLogForRun,
} from "./archive";
import {
  acceptOrganizationInvitation,
  addOrganizationMember,
  assertQueuedHuntClaim,
  attemptGithubMergeAutoResume,
  agentSkillExecutionApprovalTablesAvailable,
  acceptAgentSkillExecutionProposal,
  claimGithubDelivery,
  claimNextIssueAgentReply,
  claimNextProjectAgentTask,
  claimDueProjectAgentScheduleRun,
  claimNextQueuedHuntRun,
  completeIssueAgentReplyOutput,
  completeIssueResultReview,
  completeProjectAgentScheduleRun,
  completeGithubDelivery,
  completeSlackRevocation,
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
  createOrganization,
  createOrganizationInvitation,
  createProjectAgent,
  createProjectAgentTaskJob,
  createProjectAgentSchedule,
  createProject,
  createSlackOAuthState,
  claimSlackEvent,
  deleteAccountData,
  deadLetterSlackRevocation,
  deleteSlackInstallation,
  disconnectGithubInstallation,
  disconnectGithubInstallationById,
  disconnectGithubInstallationsByAuthorizedUser,
  deleteProjectAgent,
  deleteProjectAgentSchedule,
  deleteIssue,
  transferIssue,
  deleteIssueDependency,
  deleteProject,
  EventKeyConflictError,
  enqueueIssueAgentReply,
  failIssueAgentReply,
  failSlackRevocation,
  findProjectIdByAgentTokenHash,
  getProjectAgent,
  getProjectAgentScheduleCreatorId,
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
  isOrganizationHandleAvailable,
  getProject,
  getProjectRunChildMismatch,
  getProjectSettings,
  getProjectAgentSession,
  getProjectAgentSessionSyncCursor,
  projectAgentSessionIsApprovalOwned,
  getProjectAgentTaskJob,
  getProjectAgentTaskJobByRequest,
  getHuntRunForProject,
  getRunExecutionAttempt,
  HuntClaimError,
  HuntTransitionError,
  initializeWorkflowProgress,
  importLinearHuntRuns,
  listIssueAttachments,
  listIssueAttachmentsByRunIds,
  listChannelConversationNotifications,
  listIssueDependencies,
  listIssueDependenciesByRunIds,
  listIssueConversationNotifications,
  listIssueSubscriptions,
  listOrganizationIssueSubscriptionRunIds,
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
  listOrganizationUsageRuns,
  listOrganizationUsageExecutionAttempts,
  listOrganizationUsageCostRecords,
  listOrganizationUsageRecords,
  listRunUsageRecords,
  listProjectUsageTotals,
  listProjectUsageRuns,
  listGithubConnectionRepositories,
  listOrganizationInboxRealtimeOutbox,
  listProjectAgents,
  listProjectAgentSessions,
  listProjectAgentSessionChanges,
  listProjectAgentSessionSummaries,
  listClaimableProjectAgentScheduleProjectIds,
  listProjectAgentScheduleRuns,
  listProjectAgentSchedules,
  listSlackInstallations,
  listSlackRevocationQueue,
  moveHuntRun,
  planAccountDeletion,
  pruneExpiredDashboardChanges,
  issueProjectAgentToken,
  recoverHuntRun,
  reconcileGithubMergedRuns,
  completeWorkflowStageLifecycle,
  resumeWorkflowCheckpoint,
  reworkHuntRun,
  recordHuntEvent,
  recordRunEvidence,
  recordRunCostRecords,
  recordRunUsageRecords,
  subscribeIssue,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  renewProjectAgentScheduleRunLease,
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
  updateProjectAgent,
  updateProjectAgentSchedule,
  updateProjectSettings,
  updateProjectMandatoryCheckpoints,
  updateUserWorkflowCheckpointDefaults,
  deleteIssueAttachments,
  updateOrganization,
  updateOrganizationLogo,
  updateOrganizationMemberRole,
  updateProjectIcon,
  updateProjectIssueKeyPrefix,
  updateProjectScheduleTabEnabled,
  updateIssueWithAttachmentMetadata,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
  updateHuntRunExecutionMetrics,
  updateIssueMessage,
  unsubscribeIssue,
  deleteIssueMessage,
  updateSlackInstallationProject,
  acknowledgeOrganizationInboxRealtimeOutbox,
  upsertProjectAgentSession,
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
  type ProjectAgentRow,
  type ProjectAgentSessionRow,
  type ProjectAgentScheduleRunRow,
  type ProjectAgentScheduleRow,
  type ProjectSettingsRow,
  type OrganizationStatusTrayRunRow,
  type OrganizationUsageRunRow,
  type OrganizationCostRecordRow,
  type OrganizationUsageRecordRow,
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
  decodeMergeQueueProfileUpdate,
} from "./merge-queue-contract";
import {
  configureMergeQueueProfile,
  getMergeQueueProfile,
  type MergeQueueProfileRow,
} from "./merge-queue-profile";
import {
  reconcileEnabledMergeQueueRuns,
  reconcileMergeQueuePullRequest,
} from "./merge-queue-reconcile";
import {
  assertStoredCheckpointPoliciesCompatible,
  checkpointPolicyJson,
  isStoredWorkflowUnchanged,
  loadWorkflowCheckpointPolicy,
} from "./workflow-policy";
import {
  codexPetSpriteSheetObjectKey,
  fetchCodexPet,
  type StoredCodexPet,
} from "./codex-pets";
import {
  estimateOrganizationUsageCosts,
  estimateRunExecutionCost,
  loadAgentUsagePricing,
} from "./usage-pricing";
import {
  fetchLinearIssuesForTeams,
  fetchLinearViewerAndTeams,
  fetchLinearWorkflowStates,
  LinearApiError,
  LINEAR_IMPORT_ISSUE_LIMIT,
} from "./linear";
import {
  defaultPlacementForLinearType,
  linearSourceKey,
  mapLinearPriority,
  parsePlacementKey,
} from "../../src/lib/linear-import";
import {
  assertExecutionSelectionAvailable,
  availableExecutionWorkerForAgentSkill,
  auditExecutionEvent,
  authenticateExecutionWorker,
  bindExecutionWorkerProject,
  countExecutionWorkerDeviceSessions,
  completeExecutionWorkerUpdates,
  countLeasedRuns,
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
  updateProjectExecutionWorkerPolicy,
  userOwnsExecutionWorkerDevice,
} from "./workers";
import {
  latestExecutionWorkerUpdateHandoff,
  pendingExecutionWorkerUpdate,
} from "./worker-update-repository";
import { MAX_WORKER_CONCURRENT_SESSIONS } from "./worker-limits";
import { MAX_TRANSCRIPT_HTTP_BODY_BYTES } from "./transcript-limits";
import {
  decodeTranscriptRequestEffect,
  TranscriptRequestDecodeError,
} from "./transcript-request";
import {
  decodeRequestSync,
  RequestDecodeError,
} from "./request-schema";
import {
  decodeAccountDeletionInput,
  decodeAccountProfileInput,
  decodeInboxReadStatesInput,
  decodeOrganizationHandle,
  decodeOrganizationInput,
  decodeOrganizationInvitationInput,
  decodeOrganizationLogoInput,
  decodeOrganizationMemberInput,
  decodeOrganizationMemberRoleInput,
  decodeOrganizationUpdateInput,
  decodeProjectAgentScheduleBatchClaim,
  decodeSlackOAuthInput,
} from "./account-organization-request-contract";
import {
  decodeAgentSkillExecutionProposalAcceptInput,
  decodeExecutionPreferences,
  decodeIssueAgentReplyCompletion,
  decodeIssueAgentReplyLease,
  decodeIssueCreateProposalAction,
  decodeIssueInput,
  decodeIssueKeptAttachmentIds,
  decodeIssueMessageEditInput,
  decodeIssueMessageInput,
  decodeIssueUpdateProposalAction,
  decodeIssueUpdateInput,
  decodeLinearApiKeyInput,
  decodeLinearImportInput,
  decodeLinearStatesInput,
  type IssueInput,
  type IssueUpdateInput,
} from "./issue-request-contract";
import {
  decodeOrganizationAgentWrite,
  decodeProjectAgentInput,
  decodeProjectAgentScheduleInput,
  decodeProjectAgentSessionInput,
  decodeProjectAgentTaskClaimInput,
  decodeProjectAgentTaskCompletion,
  decodeProjectAgentTaskInput,
  decodeProjectAgentTaskLease,
  decodeProjectIconInput,
  decodeProjectInput,
  decodeProjectIssueKeyPrefixInput,
  decodeProjectTabsInput,
  decodeProjectTransferInput,
} from "./project-request-contract";
import {
  decodeCheckpointPolicyInput,
  decodeIssueCheckpointsInput,
  decodeMoveRunInput,
  decodePausedRunReworkInput,
  decodeProjectUsagePeriod,
  decodeRecoveryAgentInput,
  decodeRecoveryUserInput,
  decodeResumeAgentInput,
  decodeResumeUserInput,
  decodeRunEvent,
  decodeRunEvidenceInput,
  decodeRunReworkInput,
  decodeRequestIdInput,
  decodeUsageRangeDays,
  decodeWorkflowStageLifecycleInput,
  parseProjectSettingsInput,
  ProjectWorkflowInputError,
  type ResumeUserInput,
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
  decodeExecutionWorkerPolicy,
  decodeIssueReplyClaimInput,
  decodeLeaseRenew,
  decodeProjectAgentScheduleRunCompletion,
  decodeProjectAgentScheduleRunRenew,
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
import {
  decodeManagedComputerApplication,
  decodeManagedComputerEnrollment,
  decodeManagedComputerPromotionValidation,
  decodeManagedComputerRetry,
} from "./managed-computer-request-contract";
import {
  ManagedComputerServiceError,
  applyForPromotionalManagedComputer,
  enrollManagedComputer,
  managedComputerProductResponse,
  retryManagedComputerProvisioning,
  validateManagedComputerPromotion,
} from "./managed-computer-service";
import { managedComputerJson } from "./managed-computer-model";
import {
  listOrganizationManagedComputers,
  organizationManagedComputer,
  refreshManagedComputerReadiness,
} from "./managed-computer-repository";
import { reconcileManagedComputers } from "./managed-computer-reconciliation";
export { ManagedComputerProvisioningWorkflow } from "./managed-computer-workflow";
import {
  ingestAgentTranscript,
  listAgentTranscriptSegments,
  readAgentWorkLog,
  readLatestAgentWorkLogForRun,
  readRawTranscriptSegment,
  workLogEntryTranscriptEvent,
  type AgentTranscriptSegmentRow,
} from "./agent-worklog";
import { readLatestVersion, serveRelease } from "./releases";
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
  publishChannelRealtime,
  publishInboxRealtime,
  publishProjectAgentSessionRealtime,
  publishProjectRealtime,
  subscribeToOrganizationRealtime,
} from "./channel-realtime";
export { ChannelRealtimeHub } from "./channel-realtime";
import {
  disconnectChannelActivitySubscribers,
  publishChannelActivity,
  publishIssueActivity,
  subscribeToChannelActivity,
  subscribeToIssueActivity,
} from "./channel-activity-realtime";
export { ChannelActivityHub } from "./channel-activity-realtime";
import {
  createChannelActivityPublishToken,
  createChannelActivitySocketTicket,
  createIssueActivityPublishToken,
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
  createOrganizationAgent,
  deleteOrganizationAgent,
  getOrganizationAgent,
  listOrganizationAgents,
  organizationAgentJson,
  updateOrganizationAgent,
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
  channelMessageInputSchema,
  channelMessageReactionInputSchema,
  channelIncomingWebhookMessageSchema,
  channelMessageBlocksFallback,
  channelReplyContextMessageJson,
  channelProposalAcceptInputSchema,
  channelReplyClaimTokenHeader,
  channelReplyClaimInputSchema,
  type ChannelExecutionProposalAcceptInput,
  channelReplyCompleteInputSchema,
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

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, idempotency-key, if-none-match, x-briar-claim-token, x-briar-channel-claim-token",
  "Access-Control-Allow-Methods": "DELETE, GET, HEAD, PATCH, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag",
};

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const decodeChannelAgentActivityPublishInput = decodeRequestSync(
  ChannelAgentActivityPublishInput,
);
const decodeChannelReplyCompleteInput = decodeRequestSync(
  channelReplyCompleteInputSchema,
);
const decodeChannelMessageInput = decodeRequestSync(channelMessageInputSchema);
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

export async function flushOrganizationInboxRealtimeOutbox(
  env: Env,
  db: D1Database,
) {
  if (!env.CHANNEL_REALTIME) return;
  const pending = await listOrganizationInboxRealtimeOutbox(db);
  for (const row of pending) {
    try {
      await publishInboxRealtime(env, row.organization_id, row.version);
      await acknowledgeOrganizationInboxRealtimeOutbox(
        db,
        row.organization_id,
        row.version,
      );
    } catch (error) {
      // Keep the transactional outbox row for the next mutation, scheduled
      // sweep, or client fallback refresh.
      console.error(JSON.stringify({
        message: "Inbox realtime publish failed",
        organizationId: row.organization_id,
        version: row.version,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

function scheduleInboxRealtimeFlush(
  env: Env,
  db: D1Database,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const flush = flushOrganizationInboxRealtimeOutbox(env, db).catch((error) => {
    console.error(JSON.stringify({
      message: "Inbox realtime outbox flush failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(flush);
  else void flush;
}

function scheduleChannelRealtimePublish(
  env: Env,
  db: D1Database,
  organizationId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const publish = getChannelSyncCursor(db, organizationId)
    .then((cursor) => publishChannelRealtime(env, organizationId, cursor))
    .catch((error) => {
      console.error(JSON.stringify({
        message: "Channel realtime publish failed",
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  if (context) context.waitUntil(publish);
  else void publish;
  scheduleInboxRealtimeFlush(env, db, context);
}

type ChannelActivityReplyIdentity = Pick<
  ChannelReplyJobRow,
  | "id"
  | "organization_id"
  | "channel_id"
  | "agent_id"
  | "trigger_message_id"
  | "parent_message_id"
  | "attempts"
  | "lease_expires_at"
>;

async function channelActivityCredential(
  env: Env,
  job: ChannelActivityReplyIdentity,
  input: { workerId: string; deviceId: string },
) {
  if (!job.lease_expires_at) {
    throw new HttpError(409, "Reply claim has no active lease");
  }
  const expiresAt = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(409, "Reply claim lease has expired");
  }
  const credential = await createChannelActivityPublishToken(
    env.BETTER_AUTH_SECRET,
    {
      organizationId: job.organization_id,
      channelId: job.channel_id,
      replyJobId: job.id,
      agentId: job.agent_id,
      triggerMessageId: job.trigger_message_id,
      parentMessageId: job.parent_message_id,
      attempt: job.attempts,
      workerId: input.workerId,
      deviceId: input.deviceId,
      expiresAt,
    },
  );
  return {
    token: credential.token,
    expiresAt: new Date(credential.expiresAt).toISOString(),
  };
}

function channelActivityFrame(
  job: Omit<ChannelActivityReplyIdentity, "lease_expires_at">,
  input: Pick<ChannelAgentActivityFrame, "sequence" | "activity">,
  now = Date.now(),
): ChannelAgentActivityFrame {
  return {
    version: CHANNEL_AGENT_ACTIVITY_VERSION,
    replyJobId: job.id,
    attempt: job.attempts,
    sequence: input.sequence,
    agentId: job.agent_id,
    channelId: job.channel_id,
    triggerMessageId: job.trigger_message_id,
    parentMessageId: job.parent_message_id,
    activity: input.activity,
    sentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHANNEL_AGENT_ACTIVITY_STALE_MS).toISOString(),
  };
}

function scheduleChannelActivityClear(
  env: Env,
  job: ChannelActivityReplyIdentity,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_ACTIVITY_REALTIME) return;
  const frame = channelActivityFrame(job, {
    sequence: Number.MAX_SAFE_INTEGER,
    activity: null,
  });
  const publish = publishChannelActivity(env, job.organization_id, frame).catch(
    (error) => {
      console.error(JSON.stringify({
        message: "Channel activity clear failed",
        organizationId: job.organization_id,
        channelId: job.channel_id,
        replyJobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    },
  );
  if (context) context.waitUntil(publish);
  else void publish;
}

type IssueActivityReplyIdentity = Pick<
  IssueAgentReplyJobRow,
  | "id"
  | "project_id"
  | "run_id"
  | "trigger_message_id"
  | "parent_message_id"
  | "attempts"
  | "lease_expires_at"
>;

async function issueActivityCredential(
  env: Env,
  organizationId: string,
  job: IssueActivityReplyIdentity,
  input: { workerId: string; deviceId: string },
) {
  if (!job.lease_expires_at) {
    throw new HttpError(409, "Reply claim has no active lease");
  }
  const expiresAt = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(409, "Reply claim lease has expired");
  }
  const credential = await createIssueActivityPublishToken(
    env.BETTER_AUTH_SECRET,
    {
      organizationId,
      projectId: job.project_id,
      runId: job.run_id,
      replyJobId: job.id,
      triggerMessageId: job.trigger_message_id,
      parentMessageId: job.parent_message_id,
      attempt: job.attempts,
      workerId: input.workerId,
      deviceId: input.deviceId,
      expiresAt,
    },
  );
  return {
    token: credential.token,
    expiresAt: new Date(credential.expiresAt).toISOString(),
  };
}

function issueActivityFrame(
  job: Omit<IssueActivityReplyIdentity, "lease_expires_at">,
  input: Pick<IssueAgentActivityFrame, "sequence" | "activity">,
  now = Date.now(),
): IssueAgentActivityFrame {
  return {
    version: CHANNEL_AGENT_ACTIVITY_VERSION,
    replyJobId: job.id,
    attempt: job.attempts,
    sequence: input.sequence,
    projectId: job.project_id,
    runId: job.run_id,
    triggerMessageId: job.trigger_message_id,
    parentMessageId: job.parent_message_id,
    activity: input.activity,
    sentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHANNEL_AGENT_ACTIVITY_STALE_MS).toISOString(),
  };
}

function scheduleIssueActivityClear(
  env: Env,
  organizationId: string,
  job: IssueActivityReplyIdentity,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_ACTIVITY_REALTIME) return;
  const frame = issueActivityFrame(job, {
    sequence: Number.MAX_SAFE_INTEGER,
    activity: null,
  });
  const publish = publishIssueActivity(env, organizationId, frame).catch(
    (error) => {
      console.error(JSON.stringify({
        message: "Issue activity clear failed",
        organizationId,
        projectId: job.project_id,
        runId: job.run_id,
        replyJobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    },
  );
  if (context) context.waitUntil(publish);
  else void publish;
}

function scheduleChannelActivityDisconnect(
  env: Env,
  organizationId: string,
  channelId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_ACTIVITY_REALTIME) return;
  const disconnect = disconnectChannelActivitySubscribers(
    env,
    organizationId,
    channelId,
  ).catch((error) => {
    console.error(JSON.stringify({
      message: "Channel activity disconnect failed",
      organizationId,
      channelId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(disconnect);
  else void disconnect;
}

function scheduleProjectRealtimePublish(
  env: Env,
  db: D1Database,
  projectId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const publish = Promise.all([
    db.prepare(
      `select organization_id from briar_projects where id = ?`,
    ).bind(projectId).first<{ organization_id: string }>(),
    getDashboardSyncCursor(db, projectId),
  ]).then(([project, cursor]) => {
    if (!project) return;
    return publishProjectRealtime(
      env,
      project.organization_id,
      projectId,
      cursor,
    );
  }).catch((error) => {
    console.error(JSON.stringify({
      message: "Project realtime publish failed",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(publish);
  else void publish;
  scheduleInboxRealtimeFlush(env, db, context);
}

function scheduleProjectAgentSessionRealtimePublish(
  env: Env,
  db: D1Database,
  projectId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const publish = Promise.all([
    db.prepare(
      `select organization_id from briar_projects where id = ?`,
    ).bind(projectId).first<{ organization_id: string }>(),
    getProjectAgentSessionSyncCursor(db, projectId),
  ]).then(([project, version]) => {
    if (!project) return;
    return publishProjectAgentSessionRealtime(
      env,
      project.organization_id,
      projectId,
      version,
    );
  }).catch((error) => {
    console.error(JSON.stringify({
      message: "Project Agent session realtime publish failed",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(publish);
  else void publish;
}

function channelMutationOrganization(
  pathname: string,
  method: string,
  status: number,
) {
  if (status >= 400 || method === "GET" || method === "HEAD") return null;
  return pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels(?:\/|$)/u,
  )?.[1] ?? null;
}

export function projectScheduleClaimMutation(
  pathname: string,
  method: string,
  status: number,
) {
  if (status >= 400 || method !== "POST") return false;
  return pathname === "/agent-schedule-runs/claim" ||
    /^\/projects\/[0-9a-f-]+\/agent-schedule-runs\/claim$/u.test(pathname);
}

export function projectMutationProject(
  pathname: string,
  method: string,
  status: number,
) {
  if (status >= 400 || method === "GET" || method === "HEAD") return null;
  if (projectScheduleClaimMutation(pathname, method, status)) return null;
  if (
    /^\/projects\/[0-9a-f-]+\/agent-sessions\/[^/]+$/u.test(
      pathname,
    )
  ) return null;
  return pathname.match(/^\/projects\/([0-9a-f-]+)(?:\/|$)/u)?.[1] ?? null;
}
const accountDeletionFreshAgeMs = 24 * 60 * 60 * 1_000;
const organizationInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000;
const usageRangeFetchPaddingDays = 1;

type IssueReplyExecutionSource = {
  provider: AgentSkillProvider | null;
  model: string | null;
  effort: AgentSkillEffort | null;
};

export function issueClaimExecutionConfig(input: {
  preferred: IssueReplyExecutionSource;
  requested: IssueReplyExecutionSource;
  activeSkill: IssueReplyExecutionSource | null;
  agent: IssueReplyExecutionSource | null;
}) {
  // requested_* is the immutable choice approved for the current dispatch.
  // preferred_* remains a default only until a dispatch snapshot exists.
  const source = input.requested.provider
    ? input.requested
    : input.preferred.provider
      ? input.preferred
      : input.activeSkill?.provider
        ? input.activeSkill
        : input.agent?.provider
          ? input.agent
          : null;
  return {
    provider: source?.provider ?? null,
    model: source?.model ?? null,
    effort: source?.effort ?? null,
  };
}

export function issueReplyExecutionConfig(input: {
  provider: AgentSkillProvider;
  preferred: IssueReplyExecutionSource;
  requested: IssueReplyExecutionSource;
  activeSkill: IssueReplyExecutionSource | null;
  agent: IssueReplyExecutionSource | null;
  prioritizeAgent?: boolean;
}) {
  const source = (input.prioritizeAgent
    ? [input.activeSkill, input.agent, input.requested, input.preferred]
    : [input.requested, input.preferred, input.activeSkill, input.agent]
  ).find((candidate) => candidate?.provider === input.provider);
  return {
    model: source?.model ?? null,
    effort: source?.effort ?? null,
  };
}

export function legacyAgentSkillInstructions(
  activeSkill: { instructions: string } | null | undefined,
  fallback: string,
) {
  return activeSkill?.instructions ?? fallback;
}

export const organizationUsageQuerySince = (
  days: 7 | 30 | 90,
  now: number = Date.now(),
) =>
  new Date(
    now - (days + usageRangeFetchPaddingDays) * 24 * 60 * 60_000,
  ).toISOString();

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

const privateNoStoreJson = (body: unknown) =>
  Response.json(body, {
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-store",
    },
  });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const canonicalProjectId = (value: string | null | undefined) =>
  value ? value.toLowerCase() : null;

export function resolveChannelProposalTargetProjectId(input: {
  requestedProjectId: string | null | undefined;
  proposedProjectId: string | null | undefined;
  defaultProjectId: string | null | undefined;
}) {
  const proposedProjectId = canonicalProjectId(input.proposedProjectId);
  const requestedProjectId = canonicalProjectId(input.requestedProjectId);
  const defaultProjectId = canonicalProjectId(input.defaultProjectId);
  // UUIDs are case-insensitive. Native iOS encodes UUID request fields in
  // uppercase, while stored proposal project IDs are lowercase. Compare the
  // canonical form so the same project is not rejected as a mismatch.
  if (
    proposedProjectId &&
    requestedProjectId &&
    proposedProjectId !== requestedProjectId
  ) {
    throw new HttpError(
      400,
      "The approved project must match the Agent proposal",
    );
  }
  return proposedProjectId ??
    requestedProjectId ??
    defaultProjectId ??
    null;
}

export function assertChannelProposalAuthorScope(input: {
  channelOrganizationId: string;
  proposedProjectId: string | null;
  replyAuthorAgentId: string | null;
  replyAuthorAgentOrganizationId: string | null;
  replyAuthorAgentProjectId: string | null;
}) {
  if (
    !input.replyAuthorAgentId ||
    !input.replyAuthorAgentOrganizationId ||
    input.replyAuthorAgentOrganizationId !== input.channelOrganizationId
  ) {
    throw new HttpError(
      409,
      "The Agent proposal scope can no longer be verified; request a new proposal",
    );
  }
  if (
    input.replyAuthorAgentProjectId !== null &&
    input.replyAuthorAgentProjectId !== input.proposedProjectId
  ) {
    // Older workers could persist a null or cross-project target for a
    // Project Agent. Never reinterpret what the member saw and approved.
    throw new HttpError(
      409,
      "The Project Agent proposal scope is invalid; request a new proposal",
    );
  }
}

export function approvedIssueCreation<T extends Record<string, unknown>>(
  issue: T,
) {
  return {
    ...issue,
    // Creating and executing are separate approvals. A creation proposal can
    // never enter the worker queue, including proposals stored by older builds.
    status: "backlog" as const,
    checkpoints: [] as never[],
  };
}

export function channelMessageShareUrl(input: {
  origin: string;
  organizationId: string;
  channelId: string;
  messageId: string;
  rootMessageId?: string | null;
}) {
  const url = new URL(input.origin);
  url.pathname =
    `/open/channels/${encodeURIComponent(input.organizationId)}` +
    `/${encodeURIComponent(input.channelId)}` +
    `/${encodeURIComponent(input.messageId)}`;
  url.search = "";
  url.hash = "";
  const rootMessageId = input.rootMessageId?.trim();
  if (rootMessageId && rootMessageId !== input.messageId) {
    url.searchParams.set("root", rootMessageId);
  }
  return url.toString();
}

function appendChannelMessageBacklink(
  description: string | null,
  channelMessageUrl: string,
) {
  const backlink = `[채널 메시지로 돌아가기](${channelMessageUrl})`;
  const body = description?.trimEnd() ?? "";
  return body ? `${body}\n\n${backlink}` : backlink;
}

/**
 * Read the change cursor before the channel catalog. If a channel mutation
 * lands between the two reads, the catalog already contains it and the older
 * cursor safely replays the same mutation. Reading in the opposite order can
 * return an old catalog with a new cursor and permanently skip that change.
 */
export async function loadChannelCatalogSnapshot<T>(
  readCursor: () => Promise<number>,
  readChannels: () => Promise<T[]>,
) {
  const cursor = await readCursor();
  const channels = await readChannels();
  return { channels, cursor };
}

type PostCommitCleanupOperation =
  | "account_delete"
  | "channel_delete"
  | "issue_delete"
  | "project_delete"
  | "slack_uninstall";

type PostCommitCleanupTask = {
  queue: "archive" | "slack";
  run: () => Promise<unknown>;
};

type PostCommitCleanupInput = {
  context?: ExecutionContext;
  operation: PostCommitCleanupOperation;
  observedAt: string;
  tasks: readonly PostCommitCleanupTask[];
};

const cleanupResultCounts = (result: unknown) => {
  if (!result || typeof result !== "object") return {};
  const allowed = new Set([
    "deadLettered",
    "deferred",
    "deleted",
    "failed",
    "revoked",
  ]);
  return Object.fromEntries(
    Object.entries(result).filter(
      ([key, value]) =>
        allowed.has(key) && typeof value === "number" && Number.isFinite(value),
    ),
  );
};

const logPostCommitCleanup = (input: {
  operation: PostCommitCleanupOperation;
  observedAt: string;
  queue: PostCommitCleanupTask["queue"];
  result?: unknown;
  rejection?: unknown;
}) => {
  try {
    if (input.rejection !== undefined) {
      console.error(JSON.stringify({
        message: "Post-commit cleanup task rejected",
        operation: input.operation,
        queue: input.queue,
        observedAt: input.observedAt,
        errorType: input.rejection instanceof Error
          ? input.rejection.name
          : "UnknownError",
      }));
      return;
    }
    const result = cleanupResultCounts(input.result);
    const hasQueuedFailures = (result.failed ?? 0) > 0 ||
      (result.deadLettered ?? 0) > 0;
    const record = JSON.stringify({
      message: hasQueuedFailures
        ? "Post-commit cleanup completed with queued failures"
        : "Post-commit cleanup completed",
      operation: input.operation,
      queue: input.queue,
      observedAt: input.observedAt,
      result,
    });
    if (hasQueuedFailures) console.error(record);
    else console.log(record);
  } catch {
    // Logging must never turn durable deletion into a failed HTTP response or
    // make the already-guarded cleanup promise reject.
  }
};

/**
 * External cleanup runs only after its D1 deletion/outbox transaction commits.
 * The returned promise is observability-only: callers must not await it before
 * returning the successful deletion response.
 */
export function schedulePostCommitCleanup(input: PostCommitCleanupInput) {
  const guarded = Promise.all(
    input.tasks.map(async (task) => {
      try {
        const result = await task.run();
        logPostCommitCleanup({
          operation: input.operation,
          observedAt: input.observedAt,
          queue: task.queue,
          result,
        });
      } catch (rejection) {
        logPostCommitCleanup({
          operation: input.operation,
          observedAt: input.observedAt,
          queue: task.queue,
          rejection,
        });
      }
    }),
  ).then(() => undefined);

  if (input.context) {
    try {
      input.context.waitUntil(guarded);
    } catch (rejection) {
      // A test context or a late runtime context may reject registration. The
      // task is already rejection-handled and can still make best-effort
      // progress without changing the committed deletion response.
      logPostCommitCleanup({
        operation: input.operation,
        observedAt: input.observedAt,
        queue: input.tasks[0]?.queue ?? "archive",
        rejection,
      });
      void guarded;
    }
  } else {
    void guarded;
  }
  return guarded;
}

export function responseWithPostCommitCleanup(
  response: Response,
  input: PostCommitCleanupInput,
) {
  void schedulePostCommitCleanup(input);
  return response;
}

export function assertRunEventIdentityNotOverridden(input: {
  run: Pick<HuntRunRow, "source" | "source_key"> | null;
  source?: string | null;
  sourceKey?: string | null;
}) {
  if (
    input.run &&
    (
      (input.source != null && input.source !== input.run.source) ||
      (input.sourceKey != null && input.sourceKey !== input.run.source_key)
    )
  ) {
    throw new HttpError(400, "A claimed run's identity cannot be changed");
  }
}

async function createApprovedChannelProposalIssue(input: {
  db: D1Database;
  project: Pick<ProjectRow, "id" | "name">;
  organizationId: string;
  proposalId: string;
  channelId: string;
  messageId: string;
  rootMessageId: string | null;
  shareOrigin: string;
  sourceKey: string;
  title: string;
  description: string | null;
  priority: number | null;
  createdByUserId: string;
  occurredAt: string;
}) {
  const settings = await getProjectSettings(input.db, input.project.id);
  const channelMessageUrl = channelMessageShareUrl({
    origin: input.shareOrigin,
    organizationId: input.organizationId,
    channelId: input.channelId,
    messageId: input.messageId,
    rootMessageId: input.rootMessageId,
  });
  const issueDescription = appendChannelMessageBacklink(
    input.description,
    channelMessageUrl,
  );
  // The approval reservation trigger intentionally requires the insert to
  // match the immutable proposal payload exactly. recordHuntEvent inserts
  // that protected row first and applies this derived link in the same D1
  // batch, so a successful creation cannot expose an intermediate description.
  const runId = await recordHuntEvent(input.db, input.project.id, {
    source: "issue",
    sourceKey: input.sourceKey,
    title: input.title,
    stage: "queued",
    status: "backlog",
    workflowStage: null,
    eventKey: `${input.sourceKey}:backlog:intake`,
    occurredAt: input.occurredAt,
    actor: "briar-channel",
    repository: settings?.github_repository ?? input.project.name,
    detail: "채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
    priority: input.priority,
    assigneeUserId: null,
    issueCheckpoints: [],
    fullAuto: false,
    branch: null,
    commitSha: null,
    tracker: null,
    issueDescription: input.description,
    resultSummary: null,
    structuredResult: null,
    pullRequestUrls: [],
    targetSha: null,
    sourceCreatedAt: input.occurredAt,
    qaStatus: null,
    stagingQaDetail: null,
    productionQaDetail: null,
    context: {
      origin: "briar-channel",
      proposalId: input.proposalId,
      channelId: input.channelId,
      issueId: input.proposalId,
      attachmentCount: 0,
      fullAuto: false,
    },
    postInsertIssueDescription: issueDescription,
    createdByUserId: input.createdByUserId,
    preferredAgentProvider: null,
    preferredAgentModel: null,
    preferredAgentEffort: null,
  });
  return runId;
}

type LiveChannelExecutionProposal = NonNullable<
  Awaited<ReturnType<typeof getChannelExecutionProposal>>
>;

/**
 * Applies the existing execution reservation and dispatch transition for both
 * standalone execution cards and create-and-execute's single authenticated
 * approval. The opaque proposal/dispatch IDs make retries converge on the
 * same run even if the first HTTP response is lost after dispatch commits.
 */
async function approveChannelExecutionProposalRequest(input: {
  db: D1Database;
  channel: Pick<ChannelRow, "id" | "organization_id" | "archived_at">;
  project: Pick<ProjectRow, "id" | "organization_id">;
  proposal: LiveChannelExecutionProposal;
  userId: string;
  selection: ChannelExecutionProposalAcceptInput;
}) {
  decodeExecutionPreferences({
    provider: input.selection.provider,
    model: input.selection.model,
    effort: input.selection.effort,
  });
  const run = await getHuntRunForProject(
    input.db,
    input.project.id,
    input.proposal.target_run_id,
  );
  if (input.proposal.status === "accepted") {
    if (
      input.proposal.accepted_by_user_id !== input.userId ||
      input.proposal.requested_provider !== input.selection.provider ||
      input.proposal.requested_model !== input.selection.model ||
      input.proposal.requested_effort !== input.selection.effort ||
      input.proposal.requested_worker_id !== input.selection.workerId
    ) {
      throw new HttpError(
        409,
        "Execution was approved with different settings or by another member",
        "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    if (
      !run || !input.proposal.dispatch_request_id ||
      run.dispatch_request_id !== input.proposal.dispatch_request_id
    ) {
      throw new HttpError(
        409,
        "This execution approval is stale; request a new approval",
        "CHANNEL_EXECUTION_PROPOSAL_STALE",
      );
    }
    return {
      proposal: issueExecutionProposalJson(input.proposal),
      outcome: "already_accepted" as const,
      projectId: input.proposal.project_id,
      runId: input.proposal.target_run_id,
      dispatch: {
        runId: input.proposal.target_run_id,
        agentId: input.proposal.proposed_by_agent_id,
        provider: input.proposal.requested_provider!,
        model: input.proposal.requested_model,
        effort: input.proposal.requested_effort,
        requestedWorkerId: input.proposal.requested_worker_id,
        requestedByUserId: input.proposal.accepted_by_user_id!,
        dispatchMode: input.proposal.requested_worker_id ? "specific" : "any",
        dispatchedAt: input.proposal.accepted_at!,
        outcome: "already_dispatched" as const,
      },
    };
  }
  if (input.proposal.status !== "pending" || input.channel.archived_at) {
    throw new HttpError(
      409,
      input.channel.archived_at
        ? "Channel is archived"
        : "This execution proposal is no longer valid",
      "CHANNEL_EXECUTION_PROPOSAL_STALE",
    );
  }
  const acceptedAt = new Date().toISOString();
  const reservation = await reserveChannelExecutionProposalApproval(input.db, {
    organizationId: input.channel.organization_id,
    channelId: input.channel.id,
    proposalId: input.proposal.id,
    userId: input.userId,
    provider: input.selection.provider,
    model: input.selection.model,
    effort: input.selection.effort,
    workerId: input.selection.workerId,
    dispatchRequestId: crypto.randomUUID(),
    reservedAt: acceptedAt,
  });
  if (
    !reservation?.dispatch_request_id ||
    !reservation.approval_reserved_by_user_id ||
    !reservation.approval_reserved_at
  ) {
    throw new HttpError(
      409,
      "The issue or execution approval changed before dispatch",
      "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
    );
  }
  try {
    const dispatched = await dispatchHuntRun(
      input.db,
      input.project.organization_id,
      input.project.id,
      {
        runId: reservation.target_run_id,
        agentId: reservation.proposed_by_agent_id,
        provider: reservation.requested_provider!,
        model: reservation.requested_model,
        effort: reservation.requested_effort,
        persistPreferences: false,
        workerId: reservation.requested_worker_id,
        requestedByUserId: reservation.approval_reserved_by_user_id,
        requestId: reservation.dispatch_request_id,
        occurredAt: reservation.approval_reserved_at,
      },
    );
    if (!dispatched) throw new HttpError(404, "Run not found");
    const accepted = await getChannelExecutionProposal(input.db, {
      organizationId: reservation.organization_id,
      channelId: reservation.channel_id!,
      proposalId: reservation.id,
      userId: reservation.approval_reserved_by_user_id,
    });
    if (
      !accepted || accepted.status !== "accepted" ||
      accepted.dispatch_request_id !== reservation.dispatch_request_id
    ) {
      throw new HttpError(
        409,
        "Execution approval was not finalized",
        "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    return {
      proposal: issueExecutionProposalJson(accepted),
      outcome: "accepted" as const,
      projectId: accepted.project_id,
      runId: accepted.target_run_id,
      dispatch: dispatched,
    };
  } catch (error) {
    if (
      error instanceof WorkerConflictError ||
      (error instanceof Error && error.message.includes("execution proposal"))
    ) {
      throw new HttpError(
        409,
        error.message,
        "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    throw error;
  }
}

async function readBoundedMultipartForm(
  request: Request,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<FormData | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return null;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxBytes) {
    throw new HttpError(413, tooLargeMessage);
  }

  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }
}

function readMultipartFiles(
  form: FormData,
  fieldName: string,
  invalidFilesMessage: string,
  validate: (files: readonly File[]) => string | null,
) {
  const values = form.getAll(fieldName);
  if (values.some((value) => !(value instanceof File))) {
    throw new HttpError(400, invalidFilesMessage);
  }
  const files = (values as File[]).map(normalizeIssueAttachmentFile);
  const validationError = validate(files);
  if (validationError) throw new HttpError(400, validationError);
  return files;
}

function readMultipartJsonArray(
  form: FormData,
  fieldName: string,
  invalidMessage = `${fieldName} is invalid`,
) {
  const value = form.get(fieldName);
  if (typeof value !== "string" || !value) return [] as unknown[];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    throw new HttpError(400, invalidMessage);
  }
}

const dashboardStageForProgress = (
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
): DashboardStage => {
  if (status === "backlog") return "queued";
  if (status === "paused") {
    return workflowStage &&
      [
        "analyzing",
        "implementing",
        "pr_open",
        "staging_qa",
        "production_qa",
      ].includes(workflowStage)
      ? (workflowStage as DashboardStage)
      : "implementing";
  }
  if (status !== "running") return status;
  return workflowStage &&
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(workflowStage)
    ? (workflowStage as DashboardStage)
    : "implementing";
};
export async function readRunEvidenceRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxEvidenceMultipartBytes,
    "Evidence images exceed the 25MB total limit",
  );
  if (!form) {
    return {
      input: decodeRunEvidenceInput(await readJson(request)),
      images: [] as File[],
    };
  }
  const payload = form.get("evidence");
  if (typeof payload !== "string") {
    throw new HttpError(400, "Multipart evidence JSON is required");
  }
  let input: unknown;
  try {
    input = JSON.parse(payload);
  } catch {
    throw new HttpError(400, "Invalid multipart evidence JSON");
  }
  const images = readMultipartFiles(
    form,
    "images",
    "Evidence images must be files",
    validateEvidenceImages,
  );
  return { input: decodeRunEvidenceInput(input), images };
}

export async function readChannelReplyCompleteRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Channel reply images exceed the 25MB total limit",
  );
  if (!form) {
    return {
      input: decodeChannelReplyCompleteInput(await readJson(request)),
      attachments: [] as File[],
    };
  }
  const payload = form.get("complete");
  if (typeof payload !== "string") {
    throw new HttpError(400, "Multipart channel reply JSON is required");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new HttpError(400, "Invalid multipart channel reply JSON");
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Channel reply attachments must be files",
    validateIssueAttachments,
  );
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new HttpError(400, "Channel reply attachments must be images");
  }
  const input = decodeChannelReplyCompleteInput(parsed);
  if (input.error && attachments.length > 0) {
    throw new HttpError(400, "A failed reply cannot include images");
  }
  return { input, attachments };
}

const maxProjectIconDataUrlLength = 400_000;
const maxProjectIconRequestBytes = maxProjectIconDataUrlLength + 20;
export async function readIssueMessageRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Message attachments exceed the 25MB total limit",
  );
  if (!form) {
    return {
      input: decodeIssueMessageInput(await readJson(request, 16_384)),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
    };
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new HttpError(400, "Conversation attachments must be images");
  }
  const attachmentReferences = readMultipartJsonArray(
    form,
    "attachmentReferences",
  );
  if (
    attachmentReferences.length !== attachments.length ||
    !attachmentReferences.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  const rawBody = form.get("body");
  const bodyReferences = issueAttachmentReferences(
    typeof rawBody === "string" ? rawBody : null,
  );
  if (!attachmentReferences.every((reference) => bodyReferences.has(String(reference)))) {
    throw new HttpError(400, "Every message attachment must be referenced in the body");
  }
  const mentionedUserIds = readMultipartJsonArray(form, "mentionedUserIds");
  const mentionedAgentIds = readMultipartJsonArray(form, "mentionedAgentIds");
  const clientMessageId = form.get("clientMessageId");
  const parentMessageId = form.get("parentMessageId");
  const agentConversationId = form.get("agentConversationId");
  return {
    input: decodeIssueMessageInput({
      body: form.get("body"),
      clientMessageId:
        typeof clientMessageId === "string" && clientMessageId
          ? clientMessageId
          : undefined,
      parentMessageId:
        typeof parentMessageId === "string" && parentMessageId
          ? parentMessageId
          : null,
      mentionedUserIds,
      mentionedAgentIds,
      agentConversationId:
        typeof agentConversationId === "string" && agentConversationId
          ? agentConversationId
          : null,
    }),
    attachments,
    attachmentReferences: attachmentReferences as string[],
  };
}

export async function readChannelMessageRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Channel images exceed the 25MB total limit",
  );
  if (!form) {
    return {
      input: decodeChannelMessageInput(await readJson(request, 32_768)),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
    };
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new HttpError(400, "Channel attachments must be images");
  }
  const attachmentReferences = readMultipartJsonArray(
    form,
    "attachmentReferences",
  );
  if (
    attachmentReferences.length !== attachments.length ||
    !attachmentReferences.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  const rawBody = form.get("body");
  const bodyReferences = issueAttachmentReferences(
    typeof rawBody === "string" ? rawBody : null,
  );
  if (!attachmentReferences.every((reference) => bodyReferences.has(String(reference)))) {
    throw new HttpError(400, "Every channel image must be referenced in the body");
  }
  const parentMessageId = form.get("parentMessageId");
  const clientMessageId = form.get("clientMessageId");
  const preferredDeviceId = form.get("preferredDeviceId");
  return {
    input: decodeChannelMessageInput({
      body: rawBody,
      clientMessageId:
        typeof clientMessageId === "string" && clientMessageId
          ? clientMessageId
          : undefined,
      parentMessageId:
        typeof parentMessageId === "string" && parentMessageId
          ? parentMessageId
          : null,
      mentionedUserIds: readMultipartJsonArray(form, "mentionedUserIds"),
      mentionedAgentIds: readMultipartJsonArray(form, "mentionedAgentIds"),
      preferredDeviceId:
        typeof preferredDeviceId === "string" && preferredDeviceId
          ? preferredDeviceId
          : null,
    }),
    attachments,
    attachmentReferences: attachmentReferences as string[],
  };
}

export async function readIssueRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Issue attachments exceed the 25MB total limit",
  );
  if (!form) {
    return {
      input: decodeIssueInput(await readJson(request)),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
    };
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );

  const rawAttachmentReferences = form.get("attachmentReferences");
  let attachmentReferences: string[] = [];
  if (typeof rawAttachmentReferences === "string" && rawAttachmentReferences) {
    const parsed = readMultipartJsonArray(
      form,
      "attachmentReferences",
      "Attachment references are invalid",
    );
    if (
      parsed.length !== attachments.length ||
      !parsed.every(isIssueAttachmentReference)
    ) {
      throw new HttpError(400, "Attachment references are invalid");
    }
    attachmentReferences = parsed as string[];
  }

  const description = form.get("description");
  const priority = form.get("priority");
  const assigneeUserId = form.get("assigneeUserId");
  const status = form.get("status");
  const preferredProvider = form.get("preferredProvider");
  const preferredModel = form.get("preferredModel");
  const preferredEffort = form.get("preferredEffort");
  const fullAuto = form.get("fullAuto");
  const rawCheckpoints = form.get("checkpoints");
  let checkpoints: unknown = [];
  if (typeof rawCheckpoints === "string" && rawCheckpoints) {
    try {
      checkpoints = JSON.parse(rawCheckpoints);
    } catch {
      throw new HttpError(400, "Issue checkpoints are invalid");
    }
  }
  return {
    input: decodeIssueInput({
      title: form.get("title"),
      description:
        typeof description === "string" && description.trim()
          ? description
          : null,
      priority:
        typeof priority === "string" && priority ? Number(priority) : null,
      assigneeUserId:
        typeof assigneeUserId === "string" && assigneeUserId.trim()
          ? assigneeUserId
          : null,
      status: typeof status === "string" && status ? status : undefined,
      preferredProvider:
        typeof preferredProvider === "string" && preferredProvider.trim()
          ? preferredProvider
          : null,
      preferredModel:
        typeof preferredModel === "string" && preferredModel.trim()
          ? preferredModel
          : null,
      preferredEffort:
        typeof preferredEffort === "string" && preferredEffort.trim()
          ? preferredEffort
          : null,
      fullAuto:
        fullAuto === null
          ? undefined
          : fullAuto === "true"
            ? true
            : fullAuto === "false"
              ? false
              : fullAuto,
      checkpoints,
    }),
    attachments,
    attachmentReferences,
  };
}

export async function readIssueUpdateRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Issue attachments exceed the 25MB total limit",
  );
  if (!form) {
    const raw = await readJson(request);
    const { keptAttachmentIds, ...fields } = (raw ?? {}) as {
      keptAttachmentIds?: unknown;
      [key: string]: unknown;
    };
    return {
      input: decodeIssueUpdateInput(fields),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
      keptAttachmentIds:
        keptAttachmentIds === undefined
          ? undefined
          : decodeIssueKeptAttachmentIds(keptAttachmentIds),
    };
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );

  const rawAttachmentReferences = form.get("attachmentReferences");
  let attachmentReferences: string[] = [];
  if (typeof rawAttachmentReferences === "string" && rawAttachmentReferences) {
    const parsed = readMultipartJsonArray(
      form,
      "attachmentReferences",
      "Attachment references are invalid",
    );
    if (
      parsed.length !== attachments.length ||
      !parsed.every(isIssueAttachmentReference)
    ) {
      throw new HttpError(400, "Attachment references are invalid");
    }
    attachmentReferences = parsed as string[];
  }

  const rawKeptAttachmentIds = form.get("keptAttachmentIds");
  let keptAttachmentIds: string[] | undefined;
  if (typeof rawKeptAttachmentIds === "string" && rawKeptAttachmentIds) {
    try {
      const parsed = readMultipartJsonArray(
        form,
        "keptAttachmentIds",
        "Kept attachment IDs are invalid",
      );
      if (!parsed.every((id) => typeof id === "string")) {
        throw new Error("invalid kept attachment ids");
      }
      keptAttachmentIds = decodeIssueKeptAttachmentIds(parsed);
    } catch {
      throw new HttpError(400, "Kept attachment IDs are invalid");
    }
  }

  const description = form.get("description");
  const priority = form.get("priority");
  const assigneeUserId = form.get("assigneeUserId");
  return {
    input: decodeIssueUpdateInput({
      title: form.get("title"),
      description:
        typeof description === "string" && description.trim()
          ? description
          : null,
      priority:
        typeof priority === "string" && priority ? Number(priority) : null,
      assigneeUserId:
        typeof assigneeUserId === "string" && assigneeUserId.trim()
          ? assigneeUserId
          : null,
    }),
    attachments,
    attachmentReferences,
    keptAttachmentIds,
  };
}

async function readJson(
  request: Request,
  maxBytes = 262_144,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes)
    throw new HttpError(413, "Request body too large");
  if (!request.body) throw new HttpError(400, "Request body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export async function readTranscriptRequest(request: Request) {
  return Effect.runPromise(
    decodeTranscriptRequestEffect(
      await readJson(request, MAX_TRANSCRIPT_HTTP_BODY_BYTES),
    ),
  );
}

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const sha256Bytes = async (value: ArrayBuffer) => {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const channelProposalIssueSourcePrefix = "briar-channel-approved:";
const legacyChannelProposalIssueSourcePrefix = "briar-channel-proposal:";
const conversationProposalIssueSourcePrefix =
  "briar-conversation-approved:";
const legacyConversationProposalIssueSourcePrefix =
  "briar-conversation-proposal:";

const newChannelProposalIssueSourceKey = () =>
  `${channelProposalIssueSourcePrefix}${
    crypto.randomUUID().replaceAll("-", "")
  }${crypto.randomUUID().replaceAll("-", "")}`;

const newConversationProposalIssueSourceKey = () =>
  `${conversationProposalIssueSourcePrefix}${
    crypto.randomUUID().replaceAll("-", "")
  }${crypto.randomUUID().replaceAll("-", "")}`;

const isReservedProposalIssueSourceKey = (sourceKey: string) =>
  sourceKey.startsWith(channelProposalIssueSourcePrefix) ||
  sourceKey.startsWith(legacyChannelProposalIssueSourcePrefix) ||
  sourceKey.startsWith(conversationProposalIssueSourcePrefix) ||
  sourceKey.startsWith(legacyConversationProposalIssueSourcePrefix);

const pngResponse = (png: ArrayBuffer) =>
  new Response(png, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  });

const attachmentResponse = (
  attachment: Pick<
    IssueAttachmentRow,
    "filename" | "content_type" | "byte_size"
  >,
  object: R2Object,
  body: BodyInit | null,
) => {
  const headers = new Headers(corsHeaders);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Disposition", contentDisposition(attachment.filename));
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Type", attachment.content_type);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  if (attachment.content_type.toLowerCase() === "image/svg+xml") {
    headers.set("Content-Security-Policy", "sandbox");
  }
  return new Response(body, { headers });
};

const deleteUnreferencedUploadedIssueObjects = async (
  db: D1Database,
  attachmentsBucket: R2Bucket,
  objectKeys: string[],
) => {
  if (objectKeys.length === 0) return;
  const inUse = await issueAttachmentObjectKeysInUse(db, objectKeys);
  const deletable = objectKeys.filter((objectKey) => !inUse.has(objectKey));
  if (deletable.length > 0) await attachmentsBucket.delete(deletable);
};

async function createIssueWithAttachments(input: {
  db: D1Database;
  attachmentsBucket: R2Bucket;
  project: Pick<ProjectRow, "id" | "name">;
  issue: Omit<IssueInput, "fullAuto"> & {
    fullAuto?: boolean;
  };
  attachments: File[];
  attachmentReferences?: string[];
  sourceKey: string;
  actor: string;
  detail: string;
  context: Record<string, unknown>;
  issueId?: string;
  createdByUserId?: string | null;
  occurredAt?: string;
}) {
  const settings = await getProjectSettings(input.db, input.project.id);
  const issueStorageId = input.issueId ?? crypto.randomUUID();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const storedAttachments = prepareStoredAttachments(
    input.attachments,
    () => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.project.id}/${issueStorageId}/${id}`,
      };
    },
  );
  const uploadedKeys: string[] = [];
  let phase = "upload_attachments";
  const issueDescription = canonicalizeIssueAttachmentReferences(
    input.issue.description,
    input.attachmentReferences ?? [],
    storedAttachments.map((attachment) => attachment.id),
  );
  let runId: string | null = null;
  try {
    await uploadStoredAttachments(
      input.attachmentsBucket,
      storedAttachments,
      uploadedKeys,
      (attachment) => ({
        attachmentId: attachment.id,
        projectId: input.project.id,
      }),
    );
    phase = "record_issue";
    runId = await recordHuntEvent(input.db, input.project.id, {
      source: "issue",
      sourceKey: input.sourceKey,
      title: input.issue.title,
      stage: "queued",
      status: input.issue.status,
      workflowStage: null,
      eventKey: `${input.sourceKey}:${input.issue.status}:intake`,
      occurredAt,
      actor: input.actor,
      repository: settings?.github_repository ?? input.project.name,
      detail: input.detail,
      priority: input.issue.priority ?? null,
      assigneeUserId: input.issue.assigneeUserId ?? null,
      issueCheckpoints: input.issue.checkpoints,
      fullAuto: input.issue.fullAuto ?? false,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription,
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: occurredAt,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: {
        ...input.context,
        issueId: issueStorageId,
        attachmentCount: storedAttachments.length,
        fullAuto: input.issue.fullAuto ?? false,
      },
      createdByUserId: input.createdByUserId,
      preferredAgentProvider: input.issue.preferredProvider ?? null,
      preferredAgentModel: input.issue.preferredModel ?? null,
      preferredAgentEffort: input.issue.preferredEffort ?? null,
    });
    phase = "store_attachment_metadata";
    await createIssueAttachments(
      input.db,
      input.project.id,
      runId,
      storedAttachments.map(({ file: _file, ...attachment }) => attachment),
    );
    return {
      runId,
      sourceKey: input.sourceKey,
      attachments: await listIssueAttachments(
        input.db,
        input.project.id,
        runId,
      ),
    };
  } catch (error) {
    console.error(JSON.stringify({
      message: "issue creation failed",
      phase,
      errorType: error instanceof Error ? error.name : "UnknownError",
      error: error instanceof Error ? error.message : String(error),
      projectId: input.project.id,
      issueStorageId,
      runId,
      attachmentCount: storedAttachments.length,
      uploadedAttachmentCount: uploadedKeys.length,
      attachmentContentTypes: [
        ...new Set(storedAttachments.map((attachment) => attachment.content_type)),
      ],
    }));
    if (runId) {
      try {
        await rollbackNewAppIssue(input.db, input.project.id, runId);
      } catch (rollbackError) {
        console.error(
          JSON.stringify({
            message: "issue creation rollback failed",
            error:
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
            runId,
          }),
        );
      }
    }
    if (uploadedKeys.length > 0) {
      try {
        await deleteUnreferencedUploadedIssueObjects(
          input.db,
          input.attachmentsBucket,
          uploadedKeys,
        );
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            message: "attachment cleanup failed",
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
            issueStorageId,
          }),
        );
      }
    }
    throw error;
  }
}

async function updateIssueWithAttachments(input: {
  db: D1Database;
  attachmentsBucket: R2Bucket;
  project: Pick<ProjectRow, "id">;
  runId: string;
  issue: IssueUpdateInput;
  attachments: File[];
  attachmentReferences?: string[];
  keptAttachmentIds?: string[];
  updatedAt: string;
}) {
  const existing = await listIssueAttachments(
    input.db,
    input.project.id,
    input.runId,
  );
  const keptIds =
    input.keptAttachmentIds === undefined
      ? new Set(existing.map((attachment) => attachment.id))
      : new Set(input.keptAttachmentIds);
  const removed = existing.filter(
    (attachment) => !keptIds.has(attachment.id),
  );
  const storedAttachments = prepareStoredAttachments(
    input.attachments,
    () => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.project.id}/${input.runId}/${id}`,
      };
    },
  );
  const uploadedKeys: string[] = [];
  let phase = "upload_attachments";
  const issueDescription = canonicalizeIssueAttachmentReferences(
    input.issue.description,
    input.attachmentReferences ?? [],
    storedAttachments.map((attachment) => attachment.id),
  );
  try {
    await uploadStoredAttachments(
      input.attachmentsBucket,
      storedAttachments,
      uploadedKeys,
      (attachment) => ({
        attachmentId: attachment.id,
        projectId: input.project.id,
      }),
    );
    const updated = await updateIssueWithAttachmentMetadata(
      input.db,
      input.project.id,
      input.runId,
      {
      title: input.issue.title,
      description: issueDescription ?? null,
      priority: input.issue.priority ?? null,
      assigneeUserId: input.issue.assigneeUserId,
      updatedAt: input.updatedAt,
        attachments: storedAttachments.map(
          ({ file: _file, ...attachment }) => attachment,
        ),
        removedAttachmentIds: removed.map((attachment) => attachment.id),
      },
    );
    if (!updated) throw new HttpError(404, "Run not found");
    if (updated.deletedObjectKeys.length > 0) {
      await input.attachmentsBucket
        .delete(updated.deletedObjectKeys)
        .catch(() => undefined);
    }
    return updated.run;
  } catch (error) {
    if (uploadedKeys.length > 0) {
      await deleteUnreferencedUploadedIssueObjects(
        input.db,
        input.attachmentsBucket,
        uploadedKeys,
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function requireIssueAssigneeMembership(
  db: D1Database,
  organizationId: string,
  assigneeUserId: string | null | undefined,
) {
  if (!assigneeUserId) return;
  if (!(await getOrganizationRole(db, organizationId, assigneeUserId))) {
    throw new HttpError(400, "Assignee must be a member of the project organization");
  }
}


const appleAppSiteAssociation = (head: boolean) =>
  new Response(
    head
      ? null
      : JSON.stringify({
          applinks: {
            details: [{
              appIDs: ["QFJZ2V3829.app.briar.companion"],
              components: [
                {
                  "/": "/open/issues/*",
                  comment: "Opens a Briar issue in the iOS Companion app",
                },
                {
                  "/": "/open/sessions/*",
                  comment: "Opens a Briar session in the iOS Companion app",
                },
                {
                  "/": "/open/channels/*",
                  comment: "Opens a Briar channel message in the iOS Companion app",
                },
              ],
            }],
          },
        }),
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );

const appLinkPage = (
  resource: "issues" | "sessions" | "channels",
  projectId: string,
  targetId: string,
  head: boolean,
  extraPath = "",
  search = "",
) => {
  const appUrl =
    `briar-companion://${resource}/${projectId}/${targetId}${extraPath}${search}`;
  const subject = resource === "issues"
    ? "이슈"
    : resource === "sessions"
      ? "세션"
      : extraPath
        ? "메시지"
        : "채널";
  const subjectWithParticle = resource === "issues"
    ? "이슈를"
    : resource === "sessions"
      ? "세션을"
      : extraPath
        ? "메시지를"
        : "채널을";
  const englishSubject = resource === "issues"
    ? "issue"
    : resource === "sessions"
      ? "session"
      : extraPath
        ? "message"
        : "channel";
  const body = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="/brand/briar-icon.png"><title>Briar에서 ${subject} 열기</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a0d;color:#f4f1f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(390px,calc(100vw - 32px));padding:32px;border:1px solid #302b38;border-radius:18px;background:#151219;box-shadow:0 30px 100px #0009;text-align:center}.brand{display:flex;align-items:center;justify-content:center;gap:10px;font-size:21px;font-weight:750}.brand img{width:30px;height:30px;border-radius:7px}h1{margin:30px 0 10px;font-size:22px}.copy{margin:0;color:#aaa3b2;font-size:13px;line-height:1.65}.open{height:44px;margin-top:24px;padding:0 18px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;color:#19151f;background:#eee9f7;font-size:14px;font-weight:700;text-decoration:none}.hint{min-height:18px;margin:14px 0 0;color:#777080;font-size:11px}</style></head>
<body><main class="card"><div class="brand"><img src="/brand/briar-icon.png" alt="">briar</div><h1>Briar에서 ${subjectWithParticle} 여는 중입니다</h1><p class="copy">앱이 자동으로 열리지 않으면 아래 버튼을 눌러 주세요.<br>The ${englishSubject} will open in the Briar app.</p><a class="open" href="${appUrl}">Briar 앱 열기</a><p class="hint" id="hint"></p></main>
<script>const appUrl=${JSON.stringify(appUrl)};window.location.replace(appUrl);window.setTimeout(()=>{document.querySelector('#hint').textContent='Briar 앱이 설치되어 있어야 합니다.'},1200)</script></body></html>`;
  return new Response(head ? null : body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
};

const workerJson = (
  worker: {
    id: string;
    device_id?: string;
    owner_user_id?: string;
    label: string;
    agent_provider: AgentProvider;
    versions_json: string;
    state: string;
    accepting_work?: number;
    readiness_state?: string;
    readiness_detail?: string | null;
    capabilities_json?: string;
    max_concurrent_sessions?: number;
    active_sessions?: number;
    icon_type?: "emoji" | "image" | null;
    icon_value?: string | null;
    last_heartbeat_at: string;
    created_at: string;
  },
  observedAt: string,
) => ({
  ...(() => {
    const maximum = worker.max_concurrent_sessions ?? 1;
    const active = worker.active_sessions ?? 0;
    return {
      maxConcurrentSessions: maximum,
      activeSessions: active,
      availableSessions: Math.max(0, maximum - active),
    };
  })(),
  id: worker.id,
  ...(worker.device_id ? { deviceId: worker.device_id } : {}),
  ...(worker.owner_user_id ? { ownerUserId: worker.owner_user_id } : {}),
  label: worker.label,
  icon:
    worker.icon_type && worker.icon_value
      ? { type: worker.icon_type, value: worker.icon_value }
      : null,
  agentProvider: worker.agent_provider,
  providers: executionWorkerProviders({
    agent_provider: worker.agent_provider,
    capabilities_json: worker.capabilities_json ?? "{}",
  }),
  versions: parseJsonObject(worker.versions_json) ?? {},
  state: workerStateAt(
    worker.last_heartbeat_at,
    observedAt,
    worker.state as never,
  ),
  acceptingWork: worker.accepting_work !== 0,
  readiness:
    worker.state === "disabled"
      ? "disabled"
      : workerStateAt(
            worker.last_heartbeat_at,
            observedAt,
            worker.state as never,
          ) === "stale"
        ? "offline"
        : worker.readiness_state === "needs_attention"
          ? "needs_attention"
          : (worker.active_sessions ?? 0) >=
              (worker.max_concurrent_sessions ?? 1)
            ? "busy"
            : "available",
  readinessDetail: worker.readiness_detail ?? null,
  capabilities: worker.capabilities_json
    ? parseJsonObject(worker.capabilities_json) ?? {}
    : {},
  lastHeartbeatAt: worker.last_heartbeat_at,
  createdAt: worker.created_at,
});

async function requireSession(auth: BriarAuth, request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new HttpError(401, "Unauthorized");
  return session;
}

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

async function requireWorkerCredential(db: D1Database, request: Request) {
  const token = bearerToken(request);
  if (!token.startsWith("briar_worker_")) {
    throw new HttpError(401, "Invalid worker token");
  }
  const principal = await authenticateExecutionWorker(
    db,
    await sha256(token),
    new Date().toISOString(),
  );
  if (!principal) throw new HttpError(401, "Invalid worker token");
  return principal;
}

/**
 * Channel work is organization work, so the credential first proves device
 * membership. The claim then pins the ready host binding, and Project Agent
 * jobs additionally require that exact binding to match the target project.
 */
async function requireWorkerOrganization(
  db: D1Database,
  request: Request,
  organizationId: string,
) {
  const principal = await requireWorkerCredential(db, request);
  if (principal.organizationId !== organizationId) {
    throw new HttpError(403, "Worker is not enabled for this organization");
  }
  return principal;
}

type AuthenticatedWorkerProject = {
  principal: NonNullable<
    Awaited<ReturnType<typeof authenticateExecutionWorker>>
  >;
  binding: NonNullable<
    Awaited<ReturnType<typeof executionWorkerBindingById>>
  >;
};

async function requireChannelAccess(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!role) throw new HttpError(404, "Organization not found");
  const channel = await getChannel(db, organizationId, channelId, userId);
  if (!channel) throw new HttpError(404, "Channel not found");
  return channel;
}

async function requireChannelDeletionAccess(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!role) throw new HttpError(404, "Organization not found");
  const channel = await getChannelById(db, organizationId, channelId);
  if (!channel) throw new HttpError(404, "Channel not found");
  if (role !== "owner" && channel.created_by_user_id !== userId) {
    throw new HttpError(
      403,
      "Channel creator or organization owner access required",
    );
  }
  return channel;
}

async function requireChannelWebhookManagement(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const channel = await requireChannelAccess(
    db,
    organizationId,
    channelId,
    userId,
  );
  if (channel.kind === "dm") {
    throw new HttpError(400, "Webhooks are not available in direct messages");
  }
  const organizationRole = await getOrganizationRole(
    db,
    organizationId,
    userId,
  );
  if (canManageOrganization(organizationRole)) return channel;
  const membership = await db.prepare(
    `select role from briar_channel_members
     where channel_id = ? and user_id = ?`,
  ).bind(channelId, userId).first<{ role: "owner" | "member" }>();
  if (membership?.role !== "owner") {
    throw new HttpError(403, "Channel owner access required");
  }
  return channel;
}

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

function projectJson(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    issueKeyPrefix: row.issue_key_prefix,
    scheduleTabEnabled: row.schedule_tab_enabled !== 0,
    icon: row.icon,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    role: row.member_role,
    createdAt: row.created_at,
  };
}

const projectAgentJson = (row: ProjectAgentRow) => {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    avatar: row.avatar,
    codexPet: row.avatar_pet_json
      ? {
          ...(JSON.parse(row.avatar_pet_json) as StoredCodexPet),
          spriteSheetUrl: row.avatar_spritesheet_object_key
            ? `/projects/${row.project_id}/agents/${row.id}/spritesheet`
            : null,
        }
      : null,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    description: row.description,
    responsibility: row.responsibility,
    skill: row.skill_markdown,
    skills: (row.skills ?? []).map(agentSkillJson),
    calendarColor: row.calendar_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const projectAgentSessionJson = (row: {
  project_id: string;
  id: string;
  requested_by_user_id: string | null;
  payload_json: string;
}) => ({
  id: row.id,
  projectId: row.project_id,
  ...(JSON.parse(row.payload_json) as Record<string, unknown>),
  requestedByUserId: row.requested_by_user_id,
  workspaceRoot: null,
  dispatchEvents: [],
  workers: [],
  detailLoaded: true,
});

const projectAgentSessionSummaryJson = (row: {
  project_id: string;
  session_id: string;
  summary_json: string;
  archived: number;
}) => {
  const summary = JSON.parse(row.summary_json) as Record<string, unknown>;
  // `inboxVersion` is an internal projection used by the organization feed;
  // keep the existing public Agent-session contract unchanged.
  delete summary.inboxVersion;
  return {
    id: row.session_id,
    projectId: row.project_id,
    ...summary,
    followUps: [],
    conversationId: null,
    workspaceRoot: null,
    summary: null,
    error: null,
    events: [],
    dispatchEvents: [],
    workers: [],
    archived: row.archived === 1,
    detailLoaded: false,
  };
};

const projectAgentSessionSyncEtag = (projectId: string, cursor: number) =>
  `"project-agent-sessions:${projectId}:${cursor}"`;

export const organizationInboxSyncEtag = (
  organizationId: string,
  version: number,
) => `W/"organization-inbox:${organizationId}:${version}"`;

export async function loadOrganizationInboxConditionalSnapshot<T>(input: {
  organizationId: string;
  ifNoneMatch: string | null;
  readVersion: () => Promise<number>;
  loadSnapshot: () => Promise<T>;
}) {
  const version = await input.readVersion();
  const etag = organizationInboxSyncEtag(input.organizationId, version);
  if (input.ifNoneMatch === etag) {
    return { etag, snapshot: null };
  }
  return { etag, snapshot: await input.loadSnapshot() };
}

const organizationInboxSyncJson = (body: unknown, etag: string) =>
  Response.json(body, {
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });

const projectAgentSessionSyncJson = (
  body: unknown,
  etag: string,
  status = 200,
) =>
  Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });

const projectAgentTaskSessionEvent = (
  type: "started" | "completed" | "failed",
  occurredAt: string,
) => ({
  id: crypto.randomUUID(),
  type,
  occurredAt,
});

async function syncProjectAgentTaskSession(
  db: D1Database,
  job: {
    id: string;
    project_id: string;
    agent_id: string;
    status: "queued" | "running" | "completed" | "failed";
    claimed_worker_id: string | null;
    preferred_worker_id: string;
    updated_at: string;
    completed_at: string | null;
    error: string | null;
  },
  input: {
    summary?: string | null;
    conversationId?: string | null;
    error?: string | null;
  } = {},
) {
  const current = await getProjectAgentSession(db, job.project_id, job.id);
  if (!current) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(current.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const currentEvents = Array.isArray(payload.events) ? payload.events : [];
  const terminal = job.status === "completed" || job.status === "failed";
  const nextPayload = {
    ...payload,
    status: job.status === "queued" || job.status === "running"
      ? "running"
      : job.status,
    requestedWorkerId: payload.requestedWorkerId ?? job.preferred_worker_id,
    workerId: job.claimed_worker_id ?? payload.workerId ?? job.preferred_worker_id,
    conversationId: input.conversationId ?? payload.conversationId ?? null,
    summary: input.summary ?? payload.summary ?? null,
    error: terminal ? (input.error ?? job.error ?? null) : null,
    completedAt: terminal ? job.completed_at : null,
    updatedAt: job.updated_at,
    events: [
      ...currentEvents,
      projectAgentTaskSessionEvent(
        terminal ? (job.status === "completed" ? "completed" : "failed") : "started",
        job.updated_at,
      ),
    ],
  };
  const updated = await upsertProjectAgentSession(db, {
    project_id: current.project_id,
    id: current.id,
    agent_id: current.agent_id,
    requested_by_user_id: current.requested_by_user_id,
    status: nextPayload.status as ProjectAgentSessionRow["status"],
    session_type: current.session_type,
    payload_json: JSON.stringify(nextPayload),
    started_at: current.started_at,
    completed_at: nextPayload.completedAt as string | null,
    updated_at: job.updated_at,
  }, job.updated_at);
  return updated ? projectAgentSessionJson(updated) : null;
}

const projectAgentScheduleJson = (row: ProjectAgentScheduleRow) => ({
  id: row.id,
  projectId: row.project_id,
  agentId: row.agent_id,
  agentName: row.agent_name,
  agentProvider: row.agent_provider,
  name: row.name,
  recurrence: row.frequency ?? row.recurrence,
  timeOfDay: row.time_of_day,
  dayOfWeek: row.day_of_week,
  intervalValue: row.interval_value,
  intervalUnit: row.interval_unit,
  daysOfWeek: parseProjectAgentScheduleDays(row.days_of_week),
  notificationLevel: row.notification_level,
  timeZone: row.time_zone,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const projectAgentScheduleRunJson = (
  row: ProjectAgentScheduleRunRow,
  claimToken?: string,
) => ({
  id: row.id,
  projectId: row.project_id,
  scheduleId: row.schedule_id,
  scheduleName: row.schedule_name,
  agent: {
    id: row.agent_id,
    name: row.agent_name,
    provider: row.agent_provider,
    model: row.agent_model,
    effort: row.agent_effort,
    description: row.agent_description,
    responsibility: row.agent_responsibility,
    skill: row.agent_skill_markdown,
    skills: row.agent_skills.map(agentSkillJson),
  },
  workflow: normalizeAutoHuntWorkflow(JSON.parse(row.workflow_json)),
  status: row.status,
  scheduledFor: row.scheduled_for,
  leaseExpiresAt: row.lease_expires_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  resultSummary: row.result_summary,
  structuredResult: parseStructuredResult(row.structured_result_json),
  error: row.error,
  ...(claimToken ? { claimToken } : {}),
});

const organizationJson = (row: OrganizationRow) => ({
  id: row.id,
  name: row.name,
  handle: row.handle,
  logo: row.logo,
  role: row.role,
  createdAt: row.created_at,
});

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

const slackConfigAvailable = (env: Env) =>
  Boolean(
    env.SLACK_CLIENT_ID?.trim() &&
      env.SLACK_CLIENT_SECRET?.trim() &&
      env.SLACK_SIGNING_SECRET?.trim() &&
      env.SLACK_TOKEN_ENCRYPTION_KEY?.trim(),
  );

export async function processSlackRevocationQueue(
  db: D1Database,
  env: Pick<Env, "SLACK_TOKEN_ENCRYPTION_KEY">,
  observedAt: string,
  limit = 100,
) {
  const queued = await listSlackRevocationQueue(db, observedAt, limit);
  const encryptionKey = env.SLACK_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    return {
      revoked: 0,
      failed: 0,
      deadLettered: 0,
      deferred: queued.length,
    };
  }
  let revoked = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const item of queued) {
    try {
      const token = await decryptSlackToken(
        item.encrypted_bot_token,
        item.token_iv,
        encryptionKey,
      );
      await callSlackApi("auth.revoke", token, { test: false });
      await completeSlackRevocation(db, item.id);
      revoked += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An already-invalid token has reached the desired terminal state. Slack
      // may report any of these when a previous revoke response was lost.
      if (
        message.includes("account_inactive") ||
        message.includes("invalid_auth") ||
        message.includes("token_revoked")
      ) {
        await completeSlackRevocation(db, item.id);
        revoked += 1;
        continue;
      }
      const nextAttempt = item.attempts + 1;
      if (nextAttempt >= 8) {
        const transitioned = await deadLetterSlackRevocation(
          db,
          item.id,
          observedAt,
          message,
        );
        if (transitioned) {
          deadLettered += 1;
          console.error(JSON.stringify({
            message: "Slack token revocation dead-lettered",
            queueId: item.id,
            teamId: item.team_id,
            attempts: nextAttempt,
            deadLetteredAt: observedAt,
            error: message,
          }));
        }
        continue;
      }
      const retryDelayMs = Math.min(
        24 * 60 * 60_000,
        5 * 60_000 * 2 ** Math.max(0, nextAttempt - 1),
      );
      const nextAttemptAt = new Date(
        Date.parse(observedAt) + retryDelayMs,
      ).toISOString();
      if (
        await failSlackRevocation(
          db,
          item.id,
          observedAt,
          nextAttemptAt,
          message,
        )
      ) {
        failed += 1;
      }
    }
  }
  return { revoked, failed, deadLettered, deferred: 0 };
}

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
const organizationMemberJson = (row: OrganizationMemberRow) => ({
  userId: row.user_id,
  name: row.name,
  email: row.email,
  image: row.image,
  role: row.role,
  createdAt: row.created_at,
});

const organizationInvitationStatus = (
  row: OrganizationInvitationRow,
  observedAt: string,
) =>
  row.revoked_at
    ? "revoked"
    : row.accepted_at
      ? "accepted"
      : row.expires_at <= observedAt
        ? "expired"
        : "pending";

const maskInvitationEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1) || "*"}***@${domain}`;
};

const organizationInvitationJson = (
  row: OrganizationInvitationRow,
  observedAt = new Date().toISOString(),
) => ({
  id: row.id,
  organizationId: row.organization_id,
  organizationName: row.organization_name,
  initialProjectId: row.initial_project_id,
  initialProjectName: row.initial_project_name,
  email: row.email_normalized,
  emailHint: maskInvitationEmail(row.email_normalized),
  role: row.role,
  status: organizationInvitationStatus(row, observedAt),
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  createdAt: row.created_at,
});

const publicOrganizationInvitationJson = (
  row: OrganizationInvitationRow,
  observedAt = new Date().toISOString(),
) => {
  const invitation = organizationInvitationJson(row, observedAt);
  const { email: _email, ...publicInvitation } = invitation;
  return publicInvitation;
};

const canManageOrganization = (role: OrganizationRole | null) =>
  role === "owner" || role === "admin";

const settingsJson = (
  row: ProjectSettingsRow | null,
  checkpointPolicy?: ReturnType<typeof checkpointPolicyJson>,
) => ({
  velenOrg: row?.velen_org ?? null,
  dataSource: row?.data_source ?? null,
  linear: {
    enabled: row?.linear_enabled === 1,
    source: row?.linear_source ?? null,
    teamKey: row?.linear_team_key ?? null,
  },
  githubRepository: row?.github_repository ?? null,
  workflow: row?.workflow_json
    ? normalizeAutoHuntWorkflow(JSON.parse(row.workflow_json))
    : cloneAutoHuntWorkflow(),
  ...(checkpointPolicy ? { checkpointPolicy } : {}),
});

const mergeQueueProfileJson = (row: MergeQueueProfileRow | null) => row
  ? {
      projectId: row.project_id,
      repositoryId: row.repository_id,
      repository: row.repository,
      baseBranch: row.base_branch,
      enabled: row.enabled === 1,
      quietWindowMs: row.quiet_window_ms,
      maxBatchSize: row.max_batch_size,
      updatedAt: row.updated_at,
    }
  : null;

const mergeBatchWorkJson = (
  claim: NonNullable<Awaited<ReturnType<typeof claimNextMergeBatch>>>,
  claimToken: string,
) => ({
  workType: "mergeBatch" as const,
  workId: claim.batch.id,
  runId: claim.batch.id,
  sourceKey: `merge:${claim.batch.repository}#${claim.batch.id.slice(0, 8)}`,
  title: `Merge ${claim.members.length} PRs into ${claim.batch.base_branch}`,
  projectId: claim.batch.project_id,
  repositoryId: claim.batch.repository_id,
  repository: claim.batch.repository,
  baseBranch: claim.batch.base_branch,
  phase: claim.phase,
  claimToken,
  claimedAt: claim.batch.claimed_at,
  leaseExpiresAt: claim.batch.lease_expires_at,
  claimAttempts: claim.batch.claim_attempts,
  batch: {
    id: claim.batch.id,
    state: claim.batch.state,
    finalDeliveryId: claim.batch.final_delivery_id,
    mergeGroupRef: claim.batch.merge_group_ref,
    mergeGroupSha: claim.batch.merge_group_sha,
    mergeGroupBaseSha: claim.batch.merge_group_base_sha,
    validationResults: claim.batch.validation_results_json
      ? JSON.parse(claim.batch.validation_results_json) as unknown
      : null,
    validatedAt: claim.batch.validated_at,
    publishedAt: claim.batch.published_at,
    failureCode: claim.batch.failure_code,
    failureDetail: claim.batch.failure_detail,
  },
  members: claim.members.map((member) => ({
    id: member.id,
    ordinal: member.ordinal,
    runId: member.run_id,
    attempt: member.attempt,
    revision: member.revision,
    pullRequestId: member.pull_request_id,
    pullRequestNodeId: member.pull_request_node_id,
    pullRequestNumber: member.pull_request_number,
    pullRequestUrl: member.pull_request_url,
    headSha: member.frozen_head_sha,
    baseSha: member.frozen_base_sha,
    queueEntryId: member.queue_entry_id,
    state: member.state,
  })),
  pendingHeads: claim.pendingHeads.map((head) => ({
    deliveryId: head.delivery_id,
    headRef: head.head_ref,
    headSha: head.head_sha,
    baseSha: head.base_sha,
    tailPullRequestNumber: head.tail_pull_request_number,
    receivedAt: head.received_at,
  })),
});

const parseJsonArray = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

const issueSubscribers = (run: Pick<HuntRunRow, "subscribers_json">) =>
  parseJsonArray(run.subscribers_json ?? "[]").flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const subscriber = value as Record<string, unknown>;
    return typeof subscriber.userId === "string" &&
        typeof subscriber.subscribedAt === "string"
      ? [{
          userId: subscriber.userId,
          subscribedAt: subscriber.subscribedAt,
        }]
      : [];
  });

const occurredAtOrAfter = (occurredAt: string, subscribedAt: string) => {
  const occurredTime = Date.parse(occurredAt);
  const subscribedTime = Date.parse(subscribedAt);
  return Number.isFinite(occurredTime) &&
    Number.isFinite(subscribedTime) &&
    occurredTime >= subscribedTime;
};

const parseJsonObject = (value: string | null) => {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : null;
};

const parseStructuredResult = (
  value: string | null,
): StructuredAgentResult | null => {
  const parsed = parseJsonObject(value);
  return Option.getOrNull(decodeStructuredAgentResultOption(parsed));
};

const parseExecutionMetrics = (value: string | null) => {
  return Option.getOrNull(
    decodeAgentExecutionMetricsOption(parseJsonObject(value)),
  );
};

const parseUsageExecutionMetrics = (value: string | null) => {
  try {
    return parseExecutionMetrics(value);
  } catch {
    return null;
  }
};

const usageExecutionAttemptJson = (attempt: RunExecutionAttemptRow) => ({
  executionId: attempt.id,
  projectId: attempt.project_id,
  runAttempt: attempt.run_attempt,
  claimAttempt: attempt.claim_attempt,
  workerId: attempt.worker_id,
  claimedBy: attempt.claimed_by,
  claimedAt: attempt.claimed_at,
  recordedAt: attempt.recorded_at,
});

const organizationUsageRecordJson = (record: OrganizationUsageRecordRow) => ({
  executionId: record.execution_id,
  projectId: record.project_id,
  runAttempt: record.run_attempt,
  claimAttempt: record.claim_attempt,
  workerId: record.worker_id,
  claimedAt: record.claimed_at,
  usageKey: record.usage_key,
  sessionId: record.session_id,
  scopeId: record.scope_id,
  turnId: record.turn_id,
  agentProvider: record.agent_provider,
  modelProvider: record.model_provider,
  model: record.model,
  canonicalModel: record.canonical_model,
  modelSource: record.model_source,
  source: record.source,
  uncachedInputTokens: record.uncached_input_tokens,
  cacheReadTokens: record.cache_read_tokens,
  cacheWriteTokens: record.cache_write_tokens,
  outputTokens: record.output_tokens,
  reasoningOutputTokens: record.reasoning_output_tokens,
  totalTokens: record.total_tokens,
  observedAt: record.observed_at,
  recordedAt: record.recorded_at,
});

const organizationCostRecordJson = (record: OrganizationCostRecordRow) => ({
  executionId: record.execution_id,
  projectId: record.project_id,
  runAttempt: record.run_attempt,
  claimAttempt: record.claim_attempt,
  workerId: record.worker_id,
  claimedAt: record.claimed_at,
  costKey: record.cost_key,
  usageKey: record.usage_key,
  sessionId: record.session_id,
  scopeId: record.scope_id,
  turnId: record.turn_id,
  agentProvider: record.agent_provider,
  modelProvider: record.model_provider,
  model: record.model,
  canonicalModel: record.canonical_model,
  modelSource: record.model_source,
  source: record.source,
  costSource: "providerReported" as const,
  amountUsdTicks: record.amount_usd_ticks,
  observedAt: record.observed_at,
  recordedAt: record.recorded_at,
});

export const organizationUsageRunJson = (
  run: OrganizationUsageRunRow,
  ledger: {
    attempts?: RunExecutionAttemptRow[];
    records?: OrganizationUsageRecordRow[];
    costRecords?: OrganizationCostRecordRow[];
    estimatedCostRecords?: ReturnType<typeof estimateOrganizationUsageCosts>;
  } = {},
) => ({
  id: run.id,
  projectId: run.project_id,
  status: run.paused_at ? ("paused" as const) : run.status,
  executionMetrics: parseUsageExecutionMetrics(run.execution_metrics_json),
  claimedBy: run.claimed_by,
  claimedAt: run.claimed_at,
  claimAttempts: run.claim_attempts,
  workerId: run.worker_id,
  preferredProvider: run.preferred_agent_provider,
  preferredModel: run.preferred_agent_model,
  requestedProvider: run.requested_agent_provider,
  requestedModel: run.requested_agent_model,
  executionProvider: run.execution_provider,
  executionModel: run.execution_model,
  startedAt: run.started_at,
  updatedAt: run.updated_at,
  completedAt: run.completed_at,
  executionAttempts: (ledger.attempts ?? []).map(usageExecutionAttemptJson),
  usageRecords: (ledger.records ?? []).map(organizationUsageRecordJson),
  costRecords: (ledger.costRecords ?? []).map(organizationCostRecordJson),
  estimatedCostRecords: ledger.estimatedCostRecords ?? [],
});

export function projectUsageSummaryJson(
  runs: readonly OrganizationUsageRunRow[],
  totals: readonly ProjectUsageTotalRow[],
  period: ProjectUsagePeriod,
  generatedAt: number,
) {
  const totalsByRun = new Map<string, ProjectUsageTotalRow[]>();
  for (const total of totals) {
    const entries = totalsByRun.get(total.run_id) ?? [];
    entries.push(total);
    totalsByRun.set(total.run_id, entries);
  }
  return summarizeProjectUsage(
    runs.map((run) => {
      const runTotals = totalsByRun.get(run.id) ?? [];
      return {
        ...organizationUsageRunJson(run),
        sourceCreatedAt: run.source_created_at,
        createdByUserId: run.created_by_user_id,
        createdByName: run.created_by_name,
        agentId: run.agent_id,
        agentName: run.agent_name,
        hasUsageLedger: Boolean(run.has_usage_ledger),
        usageRecords: runTotals.map((total) => ({
              uncachedInputTokens: null,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              outputTokens: null,
              totalTokens: total.total_tokens,
              observedAt: total.observed_at,
            })),
      };
    }),
    period,
    generatedAt,
  );
}

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

const attachmentJson = (attachment: IssueAttachmentRow) => ({
  id: attachment.id,
  filename: attachment.filename,
  contentType: attachment.content_type,
  byteSize: attachment.byte_size,
  url: `/projects/${attachment.project_id}/runs/${attachment.run_id}/attachments/${attachment.id}`,
});

const evidenceImageJson = (image: RunEvidenceImageRow) => ({
  id: image.id,
  filename: image.filename,
  contentType: image.content_type,
  byteSize: image.byte_size,
  sha256: image.sha256,
  position: image.position,
  url: `/projects/${image.project_id}/runs/${image.run_id}/evidence/images/${image.id}`,
});

const issueReworkProposalJson = (proposal: IssueReworkProposalRow) => ({
  id: proposal.id,
  type: "request_issue_rework" as const,
  workflowStage: proposal.workflow_stage,
  reason: proposal.reason,
  status: proposal.status,
  acceptedAt: proposal.accepted_at,
  appliedRevision: proposal.applied_revision,
});

const issueActionProposalJson = (proposal: IssueActionProposalRow) => {
  const payload = JSON.parse(proposal.payload_json) as Record<string, unknown>;
  return {
    id: proposal.id,
    type: proposal.action_type,
    ...payload,
    ...(proposal.action_type === "request_issue_update" && payload.changes &&
      typeof payload.changes === "object" && !Array.isArray(payload.changes)
      ? { changedFields: Object.keys(payload.changes) }
      : {}),
    status: proposal.status,
    ...(proposal.action_type === "request_issue_create"
      ? { executeAfterCreate: proposal.execute_after_create === 1 }
      : {}),
    acceptedAt: proposal.accepted_at,
    resultRunId: proposal.result_run_id,
  };
};

const issueExecutionProposalJson = (proposal: IssueExecutionProposalRow) => {
  if (proposal.status !== "pending" && proposal.status !== "accepted") {
    throw new Error("Invalidated execution proposals cannot be serialized");
  }
  return {
    id: proposal.id,
    type: "request_issue_execute" as const,
    status: proposal.status,
    projectId: proposal.project_id,
    runId: proposal.target_run_id,
    title: proposal.target_title,
    createdAt: proposal.created_at,
    acceptedAt: proposal.accepted_at,
    requestedProvider: proposal.requested_provider,
    requestedModel: proposal.requested_model,
    requestedEffort: proposal.requested_effort,
    requestedWorkerId: proposal.requested_worker_id,
    delegatedByAgentId: proposal.delegated_by_agent_id,
    delegatedByAgentName: proposal.delegated_by_agent_name,
  };
};

const liveIssueExecutionProposalJson = (
  proposal: IssueExecutionProposalRow | null,
) => proposal && (proposal.status === "pending" || proposal.status === "accepted")
  ? issueExecutionProposalJson(proposal)
  : null;

const agentSkillExecutionProposalJson = (
  proposal: AgentSkillExecutionProposalRow,
) => {
  if (proposal.status !== "pending" && proposal.status !== "accepted") {
    throw new Error("Invalidated Agent Skill execution proposals cannot be serialized");
  }
  return {
    id: proposal.id,
    type: "request_agent_skill_execute" as const,
    status: proposal.status,
    projectId: proposal.project_id,
    agentId: proposal.agent_id,
    agentName: proposal.agent_name,
    skillId: proposal.skill_id,
    skillName: proposal.skill_name,
    provider: proposal.provider,
    model: proposal.model,
    effort: proposal.effort,
    request: proposal.request,
    delegatedByAgentId: proposal.delegated_by_agent_id,
    delegatedByAgentName: proposal.delegated_by_agent_name,
    requestedWorkerId: proposal.requested_worker_id,
    requestedWorkerLabel: proposal.requested_worker_label,
    resultSessionId: proposal.result_session_id,
    createdAt: proposal.created_at,
    acceptedAt: proposal.accepted_at,
  };
};

const liveAgentSkillExecutionProposalJson = (
  proposal: AgentSkillExecutionProposalRow | null,
) => proposal && (proposal.status === "pending" || proposal.status === "accepted")
  ? agentSkillExecutionProposalJson(proposal)
  : null;

async function approveAgentSkillExecutionProposal(
  db: D1Database,
  archives: Parameters<typeof getArchivedProjectAgentSession>[1],
  proposal: AgentSkillExecutionProposalRow,
  input: {
    sourceKind: "channel" | "issue";
    userId: string;
    workerId: string;
    staleCode:
      | "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE"
      | "ISSUE_SKILL_EXECUTION_PROPOSAL_STALE";
    conflictCode:
      | "CHANNEL_SKILL_EXECUTION_PROPOSAL_CONFLICT"
      | "ISSUE_SKILL_EXECUTION_PROPOSAL_CONFLICT";
    reload: () => Promise<AgentSkillExecutionProposalRow | null>;
  },
) {
  const stale = (message = "This Agent Skill execution proposal is stale") =>
    new HttpError(409, message, input.staleCode);
  const conflict = (
    message = "Agent Skill execution was approved by another member or Worker",
  ) => new HttpError(409, message, input.conflictCode);
  const acceptedResponse = async (
    current: AgentSkillExecutionProposalRow,
    outcome: "accepted" | "already_accepted",
  ) => {
    if (
      current.status !== "accepted" ||
      current.accepted_by_user_id !== input.userId ||
      current.requested_worker_id !== input.workerId
    ) {
      throw conflict();
    }
    if (!current.result_session_id || !current.requested_worker_label) {
      throw stale("The approved Agent Skill execution lost its task session");
    }
    const approval = await getAgentSkillExecutionApprovalAudit(
      db,
      current.project_id,
      current.id,
    );
    if (
      !approval ||
      approval.organization_id !== current.organization_id ||
      approval.source_kind !== current.source_kind ||
      approval.channel_id !== current.channel_id ||
      approval.conversation_run_id !== current.conversation_run_id ||
      approval.trigger_message_id !== current.trigger_message_id ||
      approval.reply_message_id !== current.reply_message_id ||
      approval.source_reply_job_id !== current.source_reply_job_id ||
      approval.delegated_by_reply_job_id !== current.delegated_by_reply_job_id ||
      approval.agent_id !== current.agent_id ||
      approval.agent_name !== current.agent_name ||
      approval.agent_responsibility !== current.agent_responsibility ||
      approval.skill_id !== current.skill_id ||
      approval.skill_name !== current.skill_name ||
      approval.skill_instructions !== current.skill_instructions ||
      approval.skill_kind !== current.skill_kind ||
      approval.provider !== current.provider ||
      approval.model !== current.model ||
      approval.effort !== current.effort ||
      approval.request !== current.request ||
      approval.worker_id !== current.requested_worker_id ||
      approval.worker_label !== current.requested_worker_label ||
      approval.result_session_id !== current.result_session_id ||
      approval.approved_by_user_id !== current.accepted_by_user_id ||
      approval.approved_at !== current.accepted_at ||
      approval.delegated_by_agent_id !== current.delegated_by_agent_id ||
      approval.delegated_by_agent_name !== current.delegated_by_agent_name
    ) {
      throw stale("The approved Agent Skill execution audit is invalid");
    }
    const session = await getProjectAgentSession(
      db,
      current.project_id,
      current.result_session_id,
    ) ?? await getArchivedProjectAgentSession(
      db,
      archives,
      current.project_id,
      current.result_session_id,
    );
    if (!session) {
      throw stale("The approved Agent Skill execution session was not found");
    }
    let sessionPayload: Record<string, unknown>;
    try {
      sessionPayload = JSON.parse(session.payload_json) as Record<string, unknown>;
    } catch {
      throw stale("The approved Agent Skill execution session is invalid");
    }
    if (
      session.id !== current.result_session_id ||
      session.project_id !== current.project_id ||
      session.agent_id !== current.agent_id ||
      session.requested_by_user_id !== current.accepted_by_user_id ||
      session.session_type !== "task" ||
      sessionPayload.dispatchGroupId !== current.result_session_id ||
      sessionPayload.agentId !== current.agent_id ||
      sessionPayload.agentName !== current.agent_name ||
      sessionPayload.skillId !== current.skill_id ||
      sessionPayload.sessionType !== "task" ||
      sessionPayload.trigger !== "manual" ||
      sessionPayload.request !== current.request ||
      sessionPayload.requestedWorkerId !== current.requested_worker_id ||
      sessionPayload.workerId !== current.requested_worker_id ||
      sessionPayload.requestedByUserId !== current.accepted_by_user_id
    ) {
      throw stale("The approved Agent Skill execution session lost its Worker binding");
    }
    await upsertProjectAgentSessionSummary(db, session, false);
    return {
      outcome,
      proposal: agentSkillExecutionProposalJson(current),
      projectId: current.project_id,
      session: projectAgentSessionJson(session),
    };
  };

  if (proposal.status === "accepted") {
    return acceptedResponse(proposal, "already_accepted");
  }
  if (proposal.status !== "pending") throw stale();

  const acceptedAt = new Date().toISOString();
  let worker: Awaited<ReturnType<typeof availableExecutionWorkerForAgentSkill>>;
  try {
    worker = await availableExecutionWorkerForAgentSkill(db, {
      organizationId: proposal.organization_id,
      projectId: proposal.project_id,
      workerId: input.workerId,
      provider: proposal.provider,
      observedAt: acceptedAt,
    });
  } catch (error) {
    if (error instanceof WorkerConflictError) {
      throw conflict(error.message);
    }
    throw error;
  }

  let accepted: AgentSkillExecutionProposalRow | null = null;
  try {
    accepted = await acceptAgentSkillExecutionProposal(db, {
      proposalId: proposal.id,
      sourceKind: input.sourceKind,
      organizationId: proposal.organization_id,
      projectId: proposal.project_id,
      channelId: proposal.channel_id,
      conversationRunId: proposal.conversation_run_id,
      userId: input.userId,
      workerId: worker.id,
      workerLabel: worker.label,
      resultSessionId: crypto.randomUUID(),
      acceptedAt,
    });
  } catch (error) {
    const current = await input.reload();
    if (current?.status === "accepted") {
      return acceptedResponse(current, "already_accepted");
    }
    if (
      error instanceof Error &&
      error.message.includes("Agent Skill execution proposal is stale")
    ) {
      throw stale(error.message);
    }
    if (error instanceof WorkerConflictError) {
      throw conflict(error.message);
    }
    throw error;
  }
  if (!accepted) {
    const current = await input.reload();
    if (current?.status === "accepted") {
      return acceptedResponse(current, "already_accepted");
    }
    throw stale("The Agent Skill execution proposal changed before approval");
  }
  return acceptedResponse(accepted, "accepted");
}

type IssueProposalRow = IssueReworkProposalRow | IssueActionProposalRow;

const issueProposalJson = (proposal: IssueProposalRow) =>
  "action_type" in proposal
    ? issueActionProposalJson(proposal)
    : issueReworkProposalJson(proposal);

const issueMessageJson = (
  message: IssueMessageRow,
  attachments: IssueAttachmentRow[] = [],
  proposal: IssueProposalRow | null = null,
  executionProposal: IssueExecutionProposalRow | null = null,
  skillExecutionProposal: AgentSkillExecutionProposalRow | null = null,
) => ({
  id: message.id,
  runId: message.run_id,
  parentMessageId: message.parent_message_id,
  body: message.body,
  attachments: attachments
    .filter((attachment) =>
      issueAttachmentReferences(message.body).has(attachment.id),
    )
    .map(attachmentJson),
  author: {
    id: message.author_agent_id ?? message.author_user_id,
    name: message.author_agent_id
      ? (message.author_agent_name ?? message.author_name ?? "Project Agent")
      : message.author_agent_provider
        ? `Agent · ${agentProviderLabels[message.author_agent_provider]}`
        : (message.author_name ?? "알 수 없는 사용자"),
    image: message.author_agent_id
      ? message.author_agent_image
      : message.author_agent_provider
        ? null
        : message.author_image,
    agentId: message.author_agent_id,
    provider: message.author_agent_provider,
  },
  replyCount: message.reply_count,
  proposedAction: proposal ? issueProposalJson(proposal) : null,
  executionProposal: executionProposal
    ? issueExecutionProposalJson(executionProposal)
    : null,
  skillExecutionProposal: skillExecutionProposal
    ? agentSkillExecutionProposalJson(skillExecutionProposal)
    : null,
  createdAt: message.created_at,
  updatedAt: message.updated_at,
});

const issueAgentReplyJson = (job: IssueAgentReplyJobRow) => ({
  id: job.id,
  triggerMessageId: job.trigger_message_id,
  parentMessageId: job.parent_message_id,
  agentId: job.agent_id,
  agentName: job.agent_name_snapshot,
  status: job.status,
  attempts: job.attempts,
  workerId: job.claimed_worker_id,
  provider: job.agent_provider,
  error: job.status === "failed" ? job.error : null,
  updatedAt: job.updated_at,
});

const issueConversationNotificationJson = (
  notification: IssueConversationNotificationRow,
) => ({
  id: notification.id,
  runId: notification.run_id,
  runTitle: notification.run_title,
  rootMessageId: notification.root_message_id,
  body: notification.body,
  author: {
    ...issueMessageJson(notification).author,
    image: notification.author_agent_id
      ? notification.author_agent_image
      : notification.author_image,
  },
  reason: notification.notification_reason,
  createdAt: notification.created_at,
});

const channelConversationNotificationJson = (
  notification: ChannelConversationNotificationRow,
) => ({
  id: notification.id,
  channelId: notification.channel_id,
  channelName: notification.channel_name,
  rootMessageId: notification.root_message_id,
  body: notification.body,
  author: {
    id: notification.author_agent_id ?? notification.author_user_id,
    name: notification.author_name ?? "",
    image: notification.author_agent_id
      ? notification.author_agent_image
      : notification.author_image,
    provider: notification.author_agent_provider,
  },
  reason: notification.notification_reason,
  createdAt: notification.created_at,
});

export const claimConversationJson = (
  messages: IssueMessageRow[],
  attachments: IssueAttachmentRow[] = [],
) => messages.map((message) => issueMessageJson(message, attachments));

const listIssueMessagesWithArchive = async (
  db: D1Database,
  archivesBucket: R2Bucket,
  projectId: string,
  runId: string,
) => {
  const [hot, archived] = await Promise.all([
    listIssueMessages(db, projectId, runId),
    listArchivedIssueMessages(db, archivesBucket, projectId, runId),
  ]);
  return [
    ...new Map(
      [...archived, ...hot].map((message) => [message.id, message]),
    ).values(),
  ].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
};

const loadIssueConversationSnapshot = async (
  db: D1Database,
  archivesBucket: R2Bucket,
  projectId: string,
  runId: string,
) => {
  const [
    messages,
    attachments,
    reworkProposals,
    actionProposals,
    executionProposals,
    skillExecutionProposals,
    agentReplies,
  ] = await Promise.all([
    listIssueMessagesWithArchive(db, archivesBucket, projectId, runId),
    listIssueAttachments(db, projectId, runId),
    listIssueReworkProposals(db, projectId, runId),
    listIssueActionProposals(db, projectId, runId),
    listIssueExecutionProposals(db, projectId, runId),
    listIssueAgentSkillExecutionProposals(db, projectId, runId),
    listIssueAgentReplyJobs(db, projectId, runId),
  ]);
  const proposalsByReply = new Map(
    [...reworkProposals, ...actionProposals].map((proposal) => [
      proposal.reply_message_id,
      proposal,
    ]),
  );
  return {
    messages: messages.map((message) =>
      issueMessageJson(
        message,
        attachments,
        proposalsByReply.get(message.id) ?? null,
        executionProposals.find(
          (proposal) => proposal.reply_message_id === message.id,
        ) ?? null,
        skillExecutionProposals.find(
          (proposal) => proposal.reply_message_id === message.id,
        ) ?? null,
      )
    ),
    agentReplies: agentReplies.map(issueAgentReplyJson),
  };
};

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

const removeOrphanedIssueAttachments = async (
  db: D1Database,
  archivesBucket: R2Bucket,
  attachmentsBucket: R2Bucket,
  projectId: string,
  runId: string,
) => {
  const [run, messages, attachments] = await Promise.all([
    getHuntRunForProject(db, projectId, runId),
    listIssueMessagesWithArchive(db, archivesBucket, projectId, runId),
    listIssueAttachments(db, projectId, runId),
  ]);
  if (!run) return;
  const referenced = new Set<string>();
  for (const id of issueAttachmentReferences(run.issue_description ?? "")) {
    referenced.add(id);
  }
  for (const message of messages) {
    for (const id of issueAttachmentReferences(message.body)) {
      referenced.add(id);
    }
  }
  const orphaned = attachments.filter((attachment) => !referenced.has(attachment.id));
  if (orphaned.length === 0) return;
  const deletedObjectKeys = await deleteIssueAttachments(
    db,
    projectId,
    runId,
    orphaned.map((attachment) => attachment.id),
  );
  if (deletedObjectKeys.length === 0) return;
  await attachmentsBucket.delete(deletedObjectKeys).catch((error) => {
    console.error(
      JSON.stringify({
        message: "orphaned issue attachment cleanup failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
};

const runEvidenceJson = (
  evidence: RunEvidenceRow,
  requiredRevision: number,
  images: RunEvidenceImageRow[] = [],
) => ({
  key: evidence.evidence_key,
  attempt: evidence.attempt,
  revision: evidence.revision,
  stage: evidence.workflow_stage,
  type: evidence.evidence_type,
  status: evidence.status,
  detail: evidence.detail,
  command: evidence.command,
  url: evidence.url,
  metadata: evidence.metadata_json ? JSON.parse(evidence.metadata_json) : null,
  actor: evidence.actor,
  observedAt: evidence.observed_at,
  recordedAt: evidence.recorded_at,
  images: images.map(evidenceImageJson),
  requiredRevision,
  canonical: evidence.revision >= requiredRevision,
});

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

async function claimWorkflowContext(
  db: D1Database,
  projectId: string,
  run: NonNullable<Awaited<ReturnType<typeof getHuntRunForProject>>>,
) {
  const workflow = normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json));
  const terminalStage = workflow.stages.at(-1)?.id ?? null;
  const progress = await initializeWorkflowProgress(db, projectId, {
    runId: run.id,
    attempt: run.current_attempt,
    revision: run.current_revision,
  });
  if (!progress) return { startStage: null, resumeContext: null };
  const latestApproval = [...progress.checkpoints]
    .filter((checkpoint) => checkpoint.state === "approved" && checkpoint.approved_at)
    .sort((left, right) =>
      (right.approved_at ?? "").localeCompare(left.approved_at ?? "")
    )[0] ?? null;
  const terminalReviewOnly = latestApproval?.position === "after" &&
    latestApproval.stage_id === terminalStage &&
    progress.stages.every((stage) =>
      stage.state === "completed" || stage.state === "skipped"
    );
  const startStage = terminalReviewOnly
    ? null
    : progress.stages.find((stage) => stage.state === "running")?.stage_id ??
      progress.stages.find((stage) => stage.state === "pending")?.stage_id ??
      null;
  return {
    startStage,
    resumeContext: latestApproval
      ? {
          checkpointKey: latestApproval.checkpoint_key,
          position: latestApproval.position,
          revision: latestApproval.revision,
          terminalReviewOnly,
        }
      : null,
  };
}

async function resumeRunWithCheckpointIdentity(
  db: D1Database,
  projectId: string,
  runId: string,
  input: ResumeUserInput,
  actor: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) {
    return {
      outcome: "not_found" as const,
      checkpointKey: null,
      attempt: null,
      revision: null,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  return resumeWorkflowCheckpoint(db, projectId, {
    runId,
    checkpointKey: input.checkpointKey,
    attempt: input.attempt,
    revision: input.revision,
    requestId: input.requestId,
    actor,
    approvedAt: new Date().toISOString(),
  });
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
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/auth/")) {
    const response = await handleAuthRequest(
      request,
      auth,
      db,
      env.BETTER_AUTH_SECRET,
      Boolean(authEmailSenderFromEnv(env)),
    );
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  const managedComputerEnrollmentMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/enroll$/u,
  );
  if (managedComputerEnrollmentMatch && request.method === "POST") {
    const input = decodeManagedComputerEnrollment(await readJson(request));
    const result = await enrollManagedComputer(db, env, {
      managedComputerId: managedComputerEnrollmentMatch[1],
      ...input,
      observedAt: new Date().toISOString(),
    });
    return json(result);
  }

  if (pathname === "/me" && request.method === "GET") {
    const session = await requireSession(auth, request);
    return json(decodeMobileCurrentUserResponse({ user: session.user }));
  }

  if (pathname === "/inbox/read-states" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const rows = await listInboxReadStates(db, session.user.id);
    return json({
      readVersions: Object.fromEntries(
        rows.map((row) => [row.message_id, row.version]),
      ),
    });
  }

  if (pathname === "/inbox/read-states" && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const input = decodeInboxReadStatesInput(await readJson(request));
    const entries = Object.entries(input.readVersions).map(
      ([messageId, version]) => ({ messageId, version }),
    );
    const rows = await upsertInboxReadStates(
      db,
      session.user.id,
      entries,
      new Date().toISOString(),
    );
    return json({
      readVersions: Object.fromEntries(
        rows.map((row) => [row.message_id, row.version]),
      ),
    });
  }

  const organizationInboxMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/inbox$/u,
  );
  if (organizationInboxMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInboxMatch[1];
    if (!(await getOrganizationRole(db, organizationId, session.user.id))) {
      throw new HttpError(404, "Organization not found");
    }
    const result = await loadOrganizationInboxConditionalSnapshot({
      organizationId,
      ifNoneMatch: request.headers.get("if-none-match"),
      readVersion: () => getOrganizationInboxSyncVersion(db, organizationId),
      loadSnapshot: async () => {
        const projects = await listOrganizationInboxProjects(db, organizationId);
        const [
          projectData,
          channelNotifications,
          subscribedIssueIds,
        ] = await Promise.all([
          Promise.all(
            projects.map(async (project) => {
              const [runs, conversationNotifications, sessionSummaries] =
                await Promise.all([
                  listDashboardRuns(db, project.id),
                  listIssueConversationNotifications(
                    db,
                    project.id,
                    session.user.id,
                  ),
                  listProjectAgentSessionSummaries(
                    db,
                    project.id,
                    undefined,
                    session.user.id,
                  ),
                ]);
              return {
                project,
                runs: runs.filter((run) => {
                  const subscription = issueSubscribers(run).find(
                    (subscriber) => subscriber.userId === session.user.id,
                  );
                  return Boolean(
                    subscription && occurredAtOrAfter(
                      run.last_event_at,
                      subscription.subscribedAt,
                    ),
                  );
                }),
                conversationNotifications,
                sessionSummaries,
              };
            }),
          ),
          listChannelConversationNotifications(
            db,
            organizationId,
            session.user.id,
          ),
          listOrganizationIssueSubscriptionRunIds(
            db,
            organizationId,
            session.user.id,
          ),
        ]);
        return {
          messages: buildInboxFeedMessages(
            projectData,
            channelNotifications,
            session.user.id,
          ),
          subscribedIssueIds,
          generatedAt: new Date().toISOString(),
        };
      },
    });
    if (result.snapshot === null) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          "Cache-Control": "private, no-cache",
          ETag: result.etag,
        },
      });
    }
    return organizationInboxSyncJson(result.snapshot, result.etag);
  }

  if (pathname === "/me" && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const input = decodeAccountProfileInput(
      await readJson(request, 450_000),
    );
    const updatedAt = new Date().toISOString();
    const result = await db
      .prepare(
        `update "user"
         set "username" = ?, "name" = ?, "image" = ?, "updatedAt" = ?
         where "id" = ?
           and not exists (
             select 1 from "user" as existing
             where lower(existing."username") = lower(?)
               and existing."id" <> ?
           )`,
      )
      .bind(
        input.username,
        input.name,
        input.image,
        updatedAt,
        session.user.id,
        input.username,
        session.user.id,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new HttpError(409, "Username is already taken");
    }
    return json({
      user: {
        ...session.user,
        username: input.username,
        name: input.name,
        image: input.image,
      },
    });
  }

  if (pathname === "/me" && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const input = decodeAccountDeletionInput(await readJson(request));
    if (input.confirmation.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new HttpError(400, "Confirmation email does not match");
    }
    const signedInAt = new Date(session.session.createdAt).getTime();
    if (
      !Number.isFinite(signedInAt) ||
      Date.now() - signedInAt >= accountDeletionFreshAgeMs
    ) {
      throw new HttpError(403, "Recent sign-in required for account deletion");
    }

    const plan = await planAccountDeletion(db, session.user.id);
    if (plan.blockedOrganizations.length > 0) {
      throw new HttpError(
        409,
        "Account deletion is blocked by shared organization resources",
      );
    }

    for (const projectId of plan.projectIds) {
      if (await getProjectRunChildMismatch(db, projectId)) {
        throw new HttpError(
          409,
          "Project transfer reconciliation is required before deletion",
          "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
        );
      }
    }

    const observedAt = new Date().toISOString();
    let deletion: Awaited<ReturnType<typeof deleteAccountData>>;
    try {
      deletion = await deleteAccountData(db, {
        userId: session.user.id,
        email: session.user.email,
        emailRateLimitIdentifierHash: await authEmailIdentifierHash(
          session.user.email,
          env.BETTER_AUTH_SECRET,
        ),
        observedAt,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.includes("project has stranded transferred issue data") ||
          error.message.includes("quarantined transcript")
        )
      ) {
        throw new HttpError(
          409,
          "Project transfer reconciliation is required before deletion",
          "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
        );
      }
      throw error;
    }
    if (deletion === "blocked") {
      throw new HttpError(
        409,
        "Account deletion state changed; review organization ownership and try again",
        "ACCOUNT_DELETION_STATE_CHANGED",
      );
    }
    if (deletion === "not_found") {
      throw new HttpError(404, "Account not found");
    }
    return responseWithPostCommitCleanup(
      new Response(null, { status: 204, headers: corsHeaders }),
      {
        context,
        operation: "account_delete",
        observedAt,
        tasks: [
          {
            queue: "archive",
            run: () => processArchiveCleanupQueue(
              db,
              env.ARCHIVES,
              attachmentsBucket,
              observedAt,
              1_000,
            ),
          },
          {
            queue: "slack",
            run: () => processSlackRevocationQueue(db, env, observedAt, 100),
          },
        ],
      },
    );
  }

  const publicInvitationMatch = pathname.match(
    /^\/invitations\/(briar_invite_[0-9a-f]{64})$/u,
  );
  if (publicInvitationMatch && request.method === "GET") {
    const observedAt = new Date().toISOString();
    const invitation = await getOrganizationInvitationByTokenHash(
      db,
      await sha256(publicInvitationMatch[1]),
    );
    if (!invitation) throw new HttpError(404, "Invitation not found");
    return json({
      invitation: publicOrganizationInvitationJson(invitation, observedAt),
    });
  }
  if (publicInvitationMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const acceptedAt = new Date().toISOString();
    const result = await acceptOrganizationInvitation(db, {
      tokenHash: await sha256(publicInvitationMatch[1]),
      userId: session.user.id,
      emailNormalized: session.user.email.trim().toLowerCase(),
      acceptedAt,
    });
    if (result.outcome === "email_mismatch") {
      return json(
        {
          code: "INVITATION_EMAIL_MISMATCH",
          message:
            "Sign in with the email address that matches this invitation",
          signedInEmail: session.user.email,
        },
        409,
      );
    }
    if (result.outcome === "expired") {
      return json(
        { code: "INVITATION_EXPIRED", message: "Invitation expired" },
        410,
      );
    }
    if (result.outcome === "revoked") {
      return json(
        { code: "INVITATION_REVOKED", message: "Invitation revoked" },
        410,
      );
    }
    if (result.outcome === "invalid") {
      throw new HttpError(404, "Invitation not found");
    }
    return json({
      invitation: organizationInvitationJson(result.invitation, acceptedAt),
      alreadyAccepted: result.outcome === "already_accepted",
    });
  }

  if (pathname === "/organizations" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizations = await listOrganizations(db, session.user.id);
    return json({ organizations: organizations.map(organizationJson) });
  }

  const organizationUsageRunsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/usage\/runs$/u,
  );
  if (organizationUsageRunsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationUsageRunsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const days = decodeUsageRangeDays(
      new URL(request.url).searchParams.get("days") ?? "90",
    );
    const generatedAt = Date.now();
    const since = organizationUsageQuerySince(days, generatedAt);
    const [runs, attempts, usageRecords, costRecords, loadedPricing] =
      await Promise.all([
        listOrganizationUsageRuns(db, organizationId, since),
        listOrganizationUsageExecutionAttempts(db, organizationId, since),
        listOrganizationUsageRecords(db, organizationId, since),
        listOrganizationUsageCostRecords(db, organizationId, since),
        loadAgentUsagePricing(),
      ]);
    const attemptsByRun = new Map<string, RunExecutionAttemptRow[]>();
    for (const attempt of attempts) {
      attemptsByRun.set(attempt.run_id, [
        ...(attemptsByRun.get(attempt.run_id) ?? []),
        attempt,
      ]);
    }
    const usageRecordsByRun = new Map<string, OrganizationUsageRecordRow[]>();
    for (const record of usageRecords) {
      usageRecordsByRun.set(record.run_id, [
        ...(usageRecordsByRun.get(record.run_id) ?? []),
        record,
      ]);
    }
    const costRecordsByRun = new Map<string, OrganizationCostRecordRow[]>();
    for (const record of costRecords) {
      costRecordsByRun.set(record.run_id, [
        ...(costRecordsByRun.get(record.run_id) ?? []),
        record,
      ]);
    }
    return json({
      runs: runs.map((run) =>
        organizationUsageRunJson(run, {
          attempts: attemptsByRun.get(run.id),
          records: usageRecordsByRun.get(run.id),
          costRecords: costRecordsByRun.get(run.id),
          estimatedCostRecords: estimateOrganizationUsageCosts({
            usageRecords: usageRecordsByRun.get(run.id) ?? [],
            costRecords: costRecordsByRun.get(run.id) ?? [],
            table: loadedPricing.table,
          }),
        }),
      ),
      generatedAt: new Date(generatedAt).toISOString(),
      pricing: loadedPricing.pricing,
    });
  }

  if (
    pathname === "/organizations/handle-availability" &&
    request.method === "GET"
  ) {
    await requireSession(auth, request);
    const handle = decodeOrganizationHandle(
      new URL(request.url).searchParams.get("handle"),
    );
    return json({
      available: await isOrganizationHandleAvailable(db, handle),
    });
  }

  if (pathname === "/organizations" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = decodeOrganizationInput(await readJson(request));
    if (!(await isOrganizationHandleAvailable(db, input.handle))) {
      throw new HttpError(409, "Organization handle already exists");
    }
    let organization: OrganizationRow;
    try {
      organization = await createOrganization(db, {
        name: input.name,
        handle: input.handle,
        ownerUserId: session.user.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("unique") && message.includes("handle")) {
        throw new HttpError(409, "Organization handle already exists");
      }
      throw error;
    }
    return json({ organization: organizationJson(organization) }, 201);
  }

  const organizationMatch = pathname.match(/^\/organizations\/([0-9a-f-]+)$/u);
  if (organizationMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeOrganizationUpdateInput(await readJson(request));
    const organization = await updateOrganization(
      db,
      organizationMatch[1],
      input.name,
      role,
    );
    if (!organization) throw new HttpError(404, "Organization not found");
    return json({ organization: organizationJson(organization) });
  }

  const organizationLogoMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/logo$/u,
  );
  if (organizationLogoMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationLogoMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeOrganizationLogoInput(await readJson(request));
    const organization = await updateOrganizationLogo(
      db,
      organizationLogoMatch[1],
      input.logo,
      role,
    );
    if (!organization) throw new HttpError(404, "Organization not found");
    return json({ organization: organizationJson(organization) });
  }

  const organizationInvitationsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/invitations$/u,
  );
  if (organizationInvitationsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInvitationsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const invitations = await listOrganizationInvitations(db, organizationId);
    const observedAt = new Date().toISOString();
    return json({
      invitations: invitations.map((invitation) =>
        organizationInvitationJson(invitation, observedAt),
      ),
    });
  }
  if (organizationInvitationsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInvitationsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeOrganizationInvitationInput(
      await readJson(request),
    );
    const token = `briar_invite_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const createdAt = new Date().toISOString();
    const result = await createOrganizationInvitation(db, {
      id: crypto.randomUUID(),
      organizationId,
      initialProjectId: input.initialProjectId,
      emailNormalized: input.email,
      role: input.role,
      tokenHash: await sha256(token),
      invitedByUserId: session.user.id,
      expiresAt: new Date(
        Date.now() + organizationInvitationTtlMs,
      ).toISOString(),
      createdAt,
    });
    if (result.outcome === "project_not_found") {
      throw new HttpError(404, "Invitation project not found");
    }
    if (result.outcome === "already_member") {
      throw new HttpError(
        409,
        "A member with that email already belongs to this organization",
      );
    }
    return json(
      {
        invitation: organizationInvitationJson(result.invitation, createdAt),
        invitePath: `/app/invitations/${token}`,
      },
      201,
    );
  }

  const organizationInvitationMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/invitations\/([0-9a-f-]+)$/u,
  );
  if (organizationInvitationMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationInvitationMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const revoked = await revokeOrganizationInvitation(
      db,
      organizationId,
      organizationInvitationMatch[2],
      new Date().toISOString(),
    );
    if (!revoked) throw new HttpError(404, "Pending invitation not found");
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const organizationMembersMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/members$/u,
  );
  if (organizationMembersMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMembersMatch[1],
      session.user.id,
    );
    if (!role) throw new HttpError(404, "Organization not found");
    const members = await listOrganizationMembers(
      db,
      organizationMembersMatch[1],
    );
    return json({ members: members.map(organizationMemberJson) });
  }
  if (organizationMembersMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMembersMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeOrganizationMemberInput(await readJson(request));
    const userId = await addOrganizationMember(
      db,
      organizationMembersMatch[1],
      input.email,
      input.role,
    );
    if (!userId) {
      throw new HttpError(404, "A Briar user with that email was not found");
    }
    const members = await listOrganizationMembers(
      db,
      organizationMembersMatch[1],
    );
    return json({ members: members.map(organizationMemberJson) });
  }

  const organizationMemberMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/members\/([^/]+)$/u,
  );
  if (organizationMemberMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const organizationId = organizationMemberMatch[1];
    const memberId = decodeURIComponent(organizationMemberMatch[2]);
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    if (memberId === session.user.id) {
      throw new HttpError(400, "You cannot change your own organization role");
    }
    const memberRole = await getOrganizationRole(db, organizationId, memberId);
    if (!memberRole) throw new HttpError(404, "Member not found");
    if (memberRole === "owner") {
      throw new HttpError(403, "Organization owner role cannot be changed");
    }
    const input = decodeOrganizationMemberRoleInput(
      await readJson(request),
    );
    const updated = await updateOrganizationMemberRole(
      db,
      organizationId,
      memberId,
      input.role,
    );
    if (!updated) throw new HttpError(404, "Member not found");
    const members = await listOrganizationMembers(db, organizationId);
    return json({ members: members.map(organizationMemberJson) });
  }
  if (organizationMemberMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMemberMatch[1],
      session.user.id,
    );
    if (role !== "owner") {
      throw new HttpError(403, "Organization owner access required");
    }
    const removed = await removeOrganizationMember(
      db,
      organizationMemberMatch[1],
      decodeURIComponent(organizationMemberMatch[2]),
    );
    if (!removed) throw new HttpError(404, "Member not found");
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const organizationAgentsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/agents$/u,
  );
  if (organizationAgentsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const agents = await listOrganizationAgents(db, organizationId);
    return json({
      agents: agents.map(organizationAgentJson),
      canManage: canManageOrganization(role),
    });
  }
  if (organizationAgentsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeOrganizationAgentWrite(await readJson(request));
    const agent = await createOrganizationAgent(db, {
      id: crypto.randomUUID(),
      organizationId,
      name: input.name,
      provider: input.provider,
      model: input.model,
      description: input.description ?? "",
      responsibility: input.responsibility,
      effort: input.effort,
      skills: input.skills ?? [],
      createdAt: new Date().toISOString(),
    });
    if (!agent) throw new HttpError(500, "Agent was not created");
    return json({ agent: organizationAgentJson(agent) }, 201);
  }

  const organizationAgentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)$/u,
  );
  if (organizationAgentMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeOrganizationAgentWrite(await readJson(request));
    const agent = await updateOrganizationAgent(db, {
      organizationId,
      agentId: organizationAgentMatch[2],
      name: input.name,
      provider: input.provider,
      model: input.model,
      description: input.description,
      responsibility: input.responsibility,
      effort: input.effort,
      skills: input.skills,
      updatedAt: new Date().toISOString(),
    });
    if (!agent) throw new HttpError(404, "Organization agent not found");
    return json({ agent: organizationAgentJson(agent) });
  }
  if (organizationAgentMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationAgentMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const deleted = await deleteOrganizationAgent(
      db,
      organizationId,
      organizationAgentMatch[2],
    );
    if (!deleted) throw new HttpError(404, "Organization agent not found");
    return json({ deleted: true });
  }

  const channelEventsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-events$/u,
  );
  if (channelEventsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = channelEventsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const issued = await createChannelRealtimeTicket(env.BETTER_AUTH_SECRET, {
      organizationId,
      userId: session.user.id,
    });
    const socketUrl = new URL(request.url);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.search = "";
    socketUrl.searchParams.set("ticket", issued.ticket);
    return privateNoStoreJson({
      url: socketUrl.toString(),
      expiresAt: issued.expiresAt,
    });
  }
  if (channelEventsMatch && request.method === "GET") {
    const organizationId = channelEventsMatch[1];
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
      if (
        !(await verifyChannelRealtimeTicket(
          env.BETTER_AUTH_SECRET,
          ticket,
          organizationId,
        ))
      ) {
        throw new HttpError(401, "Invalid or expired realtime ticket");
      }
      const [channels, inbox] = await Promise.all([
        getChannelSyncCursor(db, organizationId),
        getOrganizationInboxSyncVersion(db, organizationId),
      ]);
      return subscribeToOrganizationRealtime(env, organizationId, {
        channels,
        inbox,
      });
    }
    // Rolling-upgrade compatibility: old SSE clients keep their authoritative
    // delta fallback but never pin the Durable Object or perform D1 reads here.
    const response = legacyChannelRealtimeResponse();
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const issueActivityEventsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/agent-activity-events$/u,
  );
  if (issueActivityEventsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const [projectId, runId] = issueActivityEventsMatch.slice(1);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, projectId, runId);
    if (!run) throw new HttpError(404, "Run not found");
    const issued = await createIssueActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      {
        organizationId: project.organization_id,
        projectId,
        runId,
        userId: session.user.id,
      },
    );
    const socketUrl = new URL(request.url);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.search = "";
    socketUrl.searchParams.set("ticket", issued.ticket);
    return privateNoStoreJson({
      url: socketUrl.toString(),
      expiresAt: issued.expiresAt,
    });
  }
  if (issueActivityEventsMatch && request.method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "WebSocket transport required");
    }
    const [projectId, runId] = issueActivityEventsMatch.slice(1);
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    const verified = await verifyIssueActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      ticket,
      projectId,
      runId,
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity ticket");
    }
    return subscribeToIssueActivity(env, {
      organizationId: verified.organizationId,
      projectId,
      runId,
      userId: verified.userId,
      authorizationExpiresAt: verified.authorizationExpiresAt,
    });
  }

  const channelActivityEventsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/agent-activity-events$/u,
  );
  if (channelActivityEventsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const [organizationId, channelId] = channelActivityEventsMatch.slice(1);
    await requireChannelAccess(db, organizationId, channelId, session.user.id);
    const issued = await createChannelActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      { organizationId, channelId, userId: session.user.id },
    );
    const socketUrl = new URL(request.url);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.search = "";
    socketUrl.searchParams.set("ticket", issued.ticket);
    return privateNoStoreJson({
      url: socketUrl.toString(),
      expiresAt: issued.expiresAt,
    });
  }
  if (channelActivityEventsMatch && request.method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "WebSocket transport required");
    }
    const [organizationId, channelId] = channelActivityEventsMatch.slice(1);
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    const verified = await verifyChannelActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      ticket,
      organizationId,
      channelId,
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity ticket");
    }
    return subscribeToChannelActivity(env, {
      organizationId,
      channelId,
      userId: verified.userId,
      authorizationExpiresAt: verified.authorizationExpiresAt,
    });
  }

  const channelChangesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-changes$/u,
  );
  if (channelChangesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = channelChangesMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const since = Number(
      new URL(request.url).searchParams.get("since") ?? "0",
    );
    if (!Number.isSafeInteger(since) || since < 0) {
      throw new HttpError(400, "Invalid channel cursor");
    }
    return json(
      await loadChannelDelta(db, organizationId, session.user.id, since),
    );
  }

  const projectChannelMessagesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages$/u,
  );
  if (projectChannelMessagesMatch && request.method === "GET") {
    const requestedProjectId = projectChannelMessagesMatch[1];
    const channelId = projectChannelMessagesMatch[2];
    const authenticatedProjectId = await requireAgentProject(db, request);
    if (authenticatedProjectId !== requestedProjectId) {
      throw new HttpError(403, "Agent token is not valid for this project");
    }

    const channel = await getProjectAgentChannel(
      db,
      requestedProjectId,
      channelId,
    );
    if (!channel) {
      const organizationChannel = await getProjectOrganizationChannel(
        db,
        requestedProjectId,
        channelId,
      );
      if (!organizationChannel) throw new HttpError(404, "Channel not found");
      throw new HttpError(
        403,
        "No Project Agent for this project has access to the channel",
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const query = decodeChannelMessageQuery({
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor"),
      parentMessageId: searchParams.get("parentMessageId"),
    });
    if (
      query.parentMessageId &&
      !(await isChannelRootMessage(db, channel.id, query.parentMessageId))
    ) {
      throw new HttpError(404, "Thread parent message not found");
    }
    const page = await listChannelMessagePage(db, {
      channelId: channel.id,
      parentMessageId: query.parentMessageId,
      cursor: query.cursor,
      limit: query.limit,
    });
    if (!page) {
      throw new HttpError(400, "Cursor does not belong to this message view");
    }
    return privateNoStoreJson({ channel: channelJson(channel), ...page });
  }

  const organizationChannelsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels$/u,
  );

  const organizationDirectMessagesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/dms$/u,
  );
  if (organizationDirectMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationDirectMessagesMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const input = decodeDirectMessageInput(await readJson(request));
    const memberIds = [...new Set(input.memberIds)].filter(
      (userId) => userId !== session.user.id,
    );
    const agentIds = [...new Set(input.agentIds)];
    if (memberIds.length + agentIds.length === 0) {
      throw new HttpError(400, "At least one other participant is required");
    }

    const [organizationMembers, organizationAgents] = await Promise.all([
      listOrganizationMembers(db, organizationId),
      listOrganizationAgents(db, organizationId),
    ]);
    const membersById = new Map(
      organizationMembers.map((member) => [member.user_id, member]),
    );
    const agentsById = new Map(
      organizationAgents.map((agent) => [agent.id, agent]),
    );
    for (const userId of memberIds) {
      if (!membersById.has(userId)) {
        throw new HttpError(404, "Organization member not found");
      }
    }
    for (const agentId of agentIds) {
      if (!agentsById.has(agentId)) {
        throw new HttpError(404, "Organization Agent not found");
      }
    }

    const dmKey = memberIds.length + agentIds.length === 1
      ? memberIds.length === 1
        ? `users:${JSON.stringify([session.user.id, memberIds[0]!].sort())}`
        : `agent:${JSON.stringify([session.user.id, agentIds[0]!])}`
      : null;
    if (dmKey) {
      const existing = await getDirectMessageByKey(
        db,
        organizationId,
        dmKey,
        session.user.id,
      );
      if (existing) return json({ channel: channelJson(existing) });
    }

    const participantNames = [
      ...memberIds.map((userId) => membersById.get(userId)!.name),
      ...agentIds.map((agentId) => agentsById.get(agentId)!.name),
    ];
    const channelId = crypto.randomUUID();
    const name = participantNames.join(", ").slice(0, 100);
    let channel;
    try {
      channel = await createChannel(db, {
        id: channelId,
        organizationId,
        kind: "dm",
        dmKey,
        slug: channelSlugFromName(`dm-${channelId}`, channelId),
        name,
        topic: null,
        visibility: "private",
        defaultProjectId: null,
        createdByUserId: session.user.id,
        memberIds,
        agentIds,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (dmKey && message.includes("unique")) {
        channel = await getDirectMessageByKey(
          db,
          organizationId,
          dmKey,
          session.user.id,
        );
      } else {
        throw error;
      }
    }
    if (!channel) throw new HttpError(500, "Direct message was not created");
    return json({ channel: channelJson(channel) }, 201);
  }

  if (organizationChannelsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const snapshot = await loadChannelCatalogSnapshot(
      () => getChannelSyncCursor(db, organizationId),
      () => listChannels(db, organizationId, session.user.id),
    );
    return json({
      channels: snapshot.channels.map(channelJson),
      cursor: snapshot.cursor,
    });
  }
  if (organizationChannelsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const input = decodeChannelInput(await readJson(request));
    const channelId = crypto.randomUUID();
    const slug = input.slug ?? channelSlugFromName(input.name, channelId);
    if (input.defaultProjectId) {
      const project = await getProject(
        db,
        input.defaultProjectId,
        session.user.id,
      );
      if (!project) throw new HttpError(404, "Project not found");
    }
    let channel;
    try {
      channel = await createChannel(db, {
        id: channelId,
        organizationId,
        slug,
        name: input.name,
        topic: input.topic,
        visibility: input.visibility,
        defaultProjectId: input.defaultProjectId,
        createdByUserId: session.user.id,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("unique")) {
        throw new HttpError(409, "Channel slug already exists");
      }
      throw error;
    }
    if (!channel) throw new HttpError(500, "Channel was not created");
    return json({ channel: channelJson(channel) }, 201);
  }

  const organizationChannelReadMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/read$/u,
  );
  if (organizationChannelReadMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      organizationChannelReadMatch[1],
      organizationChannelReadMatch[2],
      session.user.id,
    );
    const input = decodeChannelReadInput(await readJson(request));
    const lastReadAt = input.lastReadAt ?? new Date().toISOString();
    await markChannelRead(db, {
      userId: session.user.id,
      channelId: channel.id,
      lastReadAt,
    });
    const updated = await getChannel(
      db,
      organizationChannelReadMatch[1],
      channel.id,
      session.user.id,
    );
    if (!updated) throw new HttpError(404, "Channel not found");
    return json({ channel: channelJson(updated) });
  }

  const organizationChannelMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)$/u,
  );
  if (organizationChannelMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      organizationChannelMatch[1],
      organizationChannelMatch[2],
      session.user.id,
    );
    const rawMessageLimit = new URL(request.url).searchParams.get("limit");
    const messageLimit = rawMessageLimit === null
      ? null
      : decodeMessageLimit(rawMessageLimit);
    const [members, channelAgents, messagePage, activeReplies] = await Promise.all([
      listChannelMembers(db, channel.id),
      listChannelAgents(db, channel.id),
      messageLimit === null
        ? listChannelRootMessages(db, channel.id).then((messages) => ({
            messages,
            nextCursor: null,
          }))
        : listChannelMessagePage(db, {
            channelId: channel.id,
            parentMessageId: null,
            cursor: null,
            limit: messageLimit,
          }),
      listActiveChannelAgentReplies(db, channel.id),
    ]);
    const agents = await hydrateAgentSkills(db, channelAgents);
    return json({
      channel: channelJson(channel),
      members,
      agents: agents.map(organizationAgentJson),
      messages: messagePage?.messages ?? [],
      agentReplies: activeReplies.map(channelReplyJson),
      nextCursor: messagePage?.nextCursor ?? null,
    });
  }
  if (organizationChannelMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const currentChannel = await requireChannelAccess(
      db,
      organizationChannelMatch[1],
      organizationChannelMatch[2],
      session.user.id,
    );
    const input = decodeChannelUpdateInput(await readJson(request));
    if (
      currentChannel.kind === "dm" &&
      (input.visibility === "public" || input.defaultProjectId)
    ) {
      throw new HttpError(400, "Direct messages must remain private and organization-scoped");
    }
    if (input.defaultProjectId) {
      const project = await getProject(
        db,
        input.defaultProjectId,
        session.user.id,
      );
      if (!project) throw new HttpError(404, "Project not found");
    }
    const channel = await updateChannel(db, {
      organizationId: organizationChannelMatch[1],
      channelId: organizationChannelMatch[2],
      userId: session.user.id,
      ...input,
      updatedAt: new Date().toISOString(),
    });
    if (!channel) throw new HttpError(404, "Channel not found");
    scheduleChannelActivityDisconnect(
      env,
      organizationChannelMatch[1],
      organizationChannelMatch[2],
      context,
    );
    return json({ channel: channelJson(channel) });
  }
  if (organizationChannelMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelMatch[1];
    await requireChannelDeletionAccess(
      db,
      organizationId,
      organizationChannelMatch[2],
      session.user.id,
    );
    const observedAt = new Date().toISOString();
    const deleted = await deleteChannel(
      db,
      organizationId,
      organizationChannelMatch[2],
      session.user.id,
      observedAt,
    );
    if (!deleted) throw new HttpError(404, "Channel not found");
    scheduleChannelActivityDisconnect(
      env,
      organizationId,
      organizationChannelMatch[2],
      context,
    );
    return responseWithPostCommitCleanup(json({ deleted: true }), {
      context,
      operation: "channel_delete",
      observedAt,
      tasks: [{
        queue: "archive",
        run: () => processArchiveCleanupQueue(
          db,
          env.ARCHIVES,
          attachmentsBucket,
          observedAt,
          1_000,
        ),
      }],
    });
  }

  const channelMemberMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/members\/([0-9a-zA-Z-]+)$/u,
  );
  if (channelMemberMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelMemberMatch[1],
      channelMemberMatch[2],
      session.user.id,
    );
    const input = decodeChannelMemberInput(await readJson(request));
    const targetRole = await getOrganizationRole(
      db,
      channelMemberMatch[1],
      channelMemberMatch[3],
    );
    if (!targetRole) throw new HttpError(404, "Organization member not found");
    await addChannelMember(db, {
      channelId: channel.id,
      userId: channelMemberMatch[3],
      role: input.role,
      createdAt: new Date().toISOString(),
    });
    return json({ members: await listChannelMembers(db, channel.id) });
  }
  if (channelMemberMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelMemberMatch[1],
      channelMemberMatch[2],
      session.user.id,
    );
    await removeChannelMember(db, channel.id, channelMemberMatch[3]);
    scheduleChannelActivityDisconnect(
      env,
      channelMemberMatch[1],
      channel.id,
      context,
    );
    return json({ members: await listChannelMembers(db, channel.id) });
  }

  const channelAgentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)$/u,
  );
  if (channelAgentMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelAgentMatch[1],
      channelAgentMatch[2],
      session.user.id,
    );
    const agent = await getOrganizationAgent(
      db,
      channelAgentMatch[1],
      channelAgentMatch[3],
    );
    if (!agent) throw new HttpError(404, "Agent not found");
    // Adding a project Agent exposes that project's context to the channel, so
    // the member doing it must be able to reach the project themselves.
    if (agent.project_id) {
      const project = await getProject(db, agent.project_id, session.user.id);
      if (!project) throw new HttpError(403, "Project access required");
    }
    await addChannelAgent(db, {
      channelId: channel.id,
      agentId: agent.id,
      addedByUserId: session.user.id,
      createdAt: new Date().toISOString(),
    });
    const agents = await hydrateAgentSkills(
      db,
      await listChannelAgents(db, channel.id),
    );
    return json({ agents: agents.map(organizationAgentJson) });
  }
  if (channelAgentMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelAgentMatch[1],
      channelAgentMatch[2],
      session.user.id,
    );
    await removeChannelAgent(db, channel.id, channelAgentMatch[3]);
    const agents = await hydrateAgentSkills(
      db,
      await listChannelAgents(db, channel.id),
    );
    return json({ agents: agents.map(organizationAgentJson) });
  }

  const channelWebhooksMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/webhooks$/u,
  );
  if (channelWebhooksMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db, channelWebhooksMatch[1], channelWebhooksMatch[2], session.user.id,
    );
    return json({
      webhooks: (await listChannelWebhooks(db, channel.id)).map(channelWebhookJson),
    });
  }
  if (channelWebhooksMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db, channelWebhooksMatch[1], channelWebhooksMatch[2], session.user.id,
    );
    if (channel.archived_at) throw new HttpError(409, "Channel is archived");
    const input = decodeChannelWebhookInput(await readJson(request));
    const secret = randomUrlSafeToken();
    const createdAt = new Date().toISOString();
    const webhook = await createChannelWebhook(db, {
      id: crypto.randomUUID(),
      channelId: channel.id,
      name: input.name,
      secretHash: await sha256(secret),
      createdByUserId: session.user.id,
      createdAt,
    });
    if (!webhook) throw new HttpError(500, "Webhook was not created");
    return json({
      webhook: channelWebhookJson(webhook),
      url: new URL(`/hooks/channels/${webhook.id}/${secret}`, request.url).toString(),
    }, 201);
  }

  const channelWebhookMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/webhooks\/([0-9a-f-]+)$/u,
  );
  if (channelWebhookMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db, channelWebhookMatch[1], channelWebhookMatch[2], session.user.id,
    );
    const input = decodeChannelWebhookInput(await readJson(request));
    const webhook = await updateChannelWebhook(db, {
      channelId: channel.id,
      webhookId: channelWebhookMatch[3],
      name: input.name,
      updatedAt: new Date().toISOString(),
    });
    if (!webhook) throw new HttpError(404, "Webhook not found");
    return json({ webhook: channelWebhookJson(webhook) });
  }
  if (channelWebhookMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db, channelWebhookMatch[1], channelWebhookMatch[2], session.user.id,
    );
    const webhook = await revokeChannelWebhook(db, {
      channelId: channel.id,
      webhookId: channelWebhookMatch[3],
      revokedAt: new Date().toISOString(),
    });
    if (!webhook) throw new HttpError(404, "Webhook not found");
    return json({ webhook: channelWebhookJson(webhook) });
  }

  const channelWebhookRotateMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/webhooks\/([0-9a-f-]+)\/rotate$/u,
  );
  if (channelWebhookRotateMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWebhookManagement(
      db,
      channelWebhookRotateMatch[1],
      channelWebhookRotateMatch[2],
      session.user.id,
    );
    if (channel.archived_at) throw new HttpError(409, "Channel is archived");
    const secret = randomUrlSafeToken();
    const webhook = await rotateChannelWebhook(db, {
      channelId: channel.id,
      webhookId: channelWebhookRotateMatch[3],
      secretHash: await sha256(secret),
      updatedAt: new Date().toISOString(),
    });
    if (!webhook) throw new HttpError(404, "Webhook not found");
    return json({
      webhook: channelWebhookJson(webhook),
      url: new URL(`/hooks/channels/${webhook.id}/${secret}`, request.url).toString(),
    });
  }

  const channelMessagesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages$/u,
  );
  const channelAttachmentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  const channelDocumentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/document$/u,
  );
  if (channelDocumentMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    await requireChannelAccess(
      db,
      channelDocumentMatch[1],
      channelDocumentMatch[2],
      session.user.id,
    );
    const document = await getChannelMessageDocument(
      db,
      channelDocumentMatch[2],
      channelDocumentMatch[3],
    );
    if (!document) throw new HttpError(404, "Document not found");
    return privateNoStoreJson({
      document: {
        messageId: document.message_id,
        title: document.title,
        markdown: document.markdown,
        projectId: document.project_id,
      },
    });
  }
  if (
    channelAttachmentMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const session = await requireSession(auth, request);
    await requireChannelAccess(
      db,
      channelAttachmentMatch[1],
      channelAttachmentMatch[2],
      session.user.id,
    );
    const attachment = await getChannelMessageAttachment(
      db,
      channelAttachmentMatch[1],
      channelAttachmentMatch[2],
      channelAttachmentMatch[3],
      channelAttachmentMatch[4],
    );
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(attachment.object_key);
      if (!object) throw new HttpError(404, "Attachment not found");
      return attachmentResponse(attachment, object, null);
    }
    const object = await attachmentsBucket.get(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return attachmentResponse(attachment, object, object.body);
  }
  if (channelMessagesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelMessagesMatch[1],
      channelMessagesMatch[2],
      session.user.id,
    );
    const searchParams = new URL(request.url).searchParams;
    const parentMessageId = searchParams.get("parentMessageId");
    const paginated = searchParams.has("limit") || searchParams.has("cursor");
    if (paginated) {
      const query = decodeProjectChannelMessageQuery({
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor"),
        parentMessageId,
      });
      const page = await listChannelMessagePage(db, {
        channelId: channel.id,
        parentMessageId: query.parentMessageId,
        cursor: query.cursor,
        limit: query.limit,
      });
      if (!page) {
        throw new HttpError(400, "Cursor does not belong to this message view");
      }
      return json(page);
    }
    return json({
      messages: parentMessageId
        ? await listChannelThreadMessages(db, channel.id, parentMessageId)
        : await listChannelRootMessages(db, channel.id),
      nextCursor: null,
    });
  }
  if (channelMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = channelMessagesMatch[1];
    const channel = await requireChannelAccess(
      db,
      organizationId,
      channelMessagesMatch[2],
      session.user.id,
    );
    if (channel.archived_at) {
      throw new HttpError(409, "Channel is archived");
    }
    const { input: rawInput, attachments, attachmentReferences } =
      await readChannelMessageRequest(request);
    if (
      rawInput.preferredDeviceId &&
      !(await userOwnsExecutionWorkerDevice(db, {
        organizationId,
        userId: session.user.id,
        deviceId: rawInput.preferredDeviceId,
      }))
    ) {
      throw new HttpError(
        403,
        "Preferred Worker device is not owned by the current user in this organization",
      );
    }
    const roster = await hydrateAgentSkills(
      db,
      await listChannelAgents(db, channel.id),
    );
    const implicitDirectAgent =
      channel.kind === "dm" &&
        channel.member_count === 1 &&
        roster.length === 1 &&
        rawInput.mentionedAgentIds.length === 0
        ? roster[0]
        : null;
    const invokedAgentIds = implicitDirectAgent
      ? [implicitDirectAgent.id]
      : rawInput.mentionedAgentIds;
    const mentionedAgents = invokedAgentIds.map((agentId) => {
      const agent = roster.find((candidate) => candidate.id === agentId);
      if (!agent) {
        throw new HttpError(400, "Mentioned Agent is not in this channel");
      }
      return agent;
    });
    for (const userId of rawInput.mentionedUserIds) {
      if (!(await getOrganizationRole(db, organizationId, userId))) {
        throw new HttpError(400, "Mentioned member is not in this organization");
      }
    }
    const createdAt = new Date().toISOString();
    const messageId = rawInput.clientMessageId ?? crypto.randomUUID();
    const storedAttachments = prepareStoredAttachments(attachments, () => {
      const id = crypto.randomUUID();
      return {
        id,
        organization_id: organizationId,
        object_key: `channel-attachments/${organizationId}/${channel.id}/${messageId}/${id}`,
      };
    });
    const input = {
      ...rawInput,
      body: canonicalizeIssueAttachmentReferences(
        rawInput.body,
        attachmentReferences,
        storedAttachments.map((attachment) => attachment.id),
      ) ?? rawInput.body,
    };
    const invokedAgents = await Promise.all(
      mentionedAgents.map(async (agent) => {
        const activeSkill = agentSkillForMessage(agent.skills, input.body);
        const runtime = activeSkill ?? agent;
        const hasAvailableWorker = await hasAvailableChannelReplyWorker(db, {
          organizationId,
          projectId: agent.project_id,
          provider: runtime.provider,
          model: runtime.model,
          effort: runtime.effort,
          observedAt: createdAt,
        });
        const unavailableReason: typeof channelReplyNoAvailableWorkerError | null =
          hasAvailableWorker ? null : channelReplyNoAvailableWorkerError;
        return {
          agent,
          activeSkill,
          unavailableReason,
        };
      }),
    );
    const uploadedKeys: string[] = [];
    let message = null;
    try {
      await uploadStoredAttachments(
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          channelId: channel.id,
          messageId,
          organizationId,
        }),
      );
      message = await createChannelMessage(db, {
        id: messageId,
        channelId: channel.id,
        parentMessageId: input.parentMessageId,
        authorUserId: session.user.id,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: input.body,
        mentionedUserIds: input.mentionedUserIds,
        mentionedAgentIds: input.mentionedAgentIds,
        attachments: storedAttachments.map(({ file: _file, ...attachment }) =>
          attachment
        ),
        createdAt,
      });
      if (!message) throw new HttpError(404, "Thread message not found");
    } catch (error) {
      if (uploadedKeys.length > 0) {
        try {
          await attachmentsBucket.delete(uploadedKeys);
        } catch (cleanupError) {
          console.error(JSON.stringify({
            message: "Failed channel upload cleanup",
            organizationId,
            channelId: channel.id,
            messageId,
            attachmentCount: uploadedKeys.length,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          }));
        }
      }
      throw error;
    }
    const agentReplies = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId: channel.id,
      triggerMessageId: message.id,
      parentMessageId: agentReplyParentMessageId(message),
      agents: invokedAgents.map(({ agent, activeSkill, unavailableReason }) => ({
        id: agent.id,
        projectId: agent.project_id,
        skillId: activeSkill?.id ?? null,
        provider: activeSkill?.provider ?? agent.provider,
        unavailableReason,
      })),
      preferredDeviceId: input.preferredDeviceId,
      createdAt,
    });
    return json(
      {
        message,
        agentReplies: agentReplies.map(channelReplyJson),
      },
      201,
    );
  }

  const channelThreadSubscriptionMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/subscription$/u,
  );
  if (
    channelThreadSubscriptionMatch &&
    (request.method === "PUT" || request.method === "DELETE")
  ) {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelThreadSubscriptionMatch[1],
      channelThreadSubscriptionMatch[2],
      session.user.id,
    );
    const rootMessageId = await resolveChannelThreadRootId(
      db,
      channel.id,
      channelThreadSubscriptionMatch[3],
    );
    if (!rootMessageId) throw new HttpError(404, "Message not found");
    if (request.method === "DELETE") {
      await unsubscribeChannelThread(
        db,
        channel.id,
        rootMessageId,
        session.user.id,
      );
    } else {
      await subscribeChannelThread(
        db,
        channel.id,
        rootMessageId,
        session.user.id,
        new Date().toISOString(),
      );
    }
    return json({
      rootMessageId,
      subscribers: await listChannelThreadSubscriptions(
        db,
        channel.id,
        rootMessageId,
      ),
    });
  }

  const channelMessageReactionMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/reactions$/u,
  );
  if (channelMessageReactionMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelMessageReactionMatch[1],
      channelMessageReactionMatch[2],
      session.user.id,
    );
    if (channel.archived_at) {
      throw new HttpError(409, "Channel is archived");
    }
    const input = decodeChannelMessageReactionInput(
      await readJson(request, 1_024),
    );
    if (!isChannelReactionEmoji(input.emoji)) {
      throw new HttpError(400, "Reaction must be a single emoji");
    }
    const message = await toggleChannelMessageReaction(db, {
      channelId: channel.id,
      messageId: channelMessageReactionMatch[3],
      userId: session.user.id,
      emoji: input.emoji,
      createdAt: new Date().toISOString(),
    });
    if (!message) throw new HttpError(404, "Message not found");
    return json({ message });
  }

  const channelAgentRepliesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/agent-replies$/u,
  );
  if (channelAgentRepliesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelAgentRepliesMatch[1],
      channelAgentRepliesMatch[2],
      session.user.id,
    );
    const jobs = await listChannelAgentReplies(
      db,
      channel.id,
      channelAgentRepliesMatch[3],
    );
    const replies = await Promise.all(
      jobs
        .filter((job) => job.status === "completed")
        .map((job) => getChannelMessage(db, channel.id, job.reply_message_id)),
    );
    return json({
      agentReplies: jobs.map(channelReplyJson),
      messages: replies.filter((reply) => reply !== null),
    });
  }

  const channelProposalAcceptMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (channelProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelProposalAcceptMatch[1],
      channelProposalAcceptMatch[2],
      session.user.id,
    );
    const proposal = await getChannelActionProposal(
      db,
      channel.id,
      channelProposalAcceptMatch[3],
    );
    if (!proposal) throw new HttpError(404, "Proposal not found");
    if (proposal.action_type !== "request_issue_create") {
      throw new HttpError(409, "This proposal cannot create an issue");
    }
    assertChannelProposalAuthorScope({
      channelOrganizationId: channel.organization_id,
      proposedProjectId: proposal.project_id,
      replyAuthorAgentId: proposal.reply_author_agent_id,
      replyAuthorAgentOrganizationId:
        proposal.reply_author_agent_organization_id,
      replyAuthorAgentProjectId: proposal.reply_author_agent_project_id,
    });
    const input = decodeChannelProposalAcceptInput(
      await readJson(request),
    );
    if (input.execution && proposal.execute_after_create !== 1) {
      throw new HttpError(
        400,
        "Execution settings require a create-and-execute proposal",
      );
    }
    if (
      input.execution &&
      !(await channelExecutionProposalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    // A Project Agent's proposal is already bound to its authoritative
    // project. Only an organization-scoped proposal may be assigned at
    // approval time, and every target must stay inside this channel's org.
    const targetProjectId = resolveChannelProposalTargetProjectId({
      requestedProjectId: input.projectId,
      proposedProjectId: proposal.project_id,
      defaultProjectId: channel.default_project_id,
    });
    if (!targetProjectId) {
      throw new HttpError(400, "A target project is required");
    }
    const organizationProject = await getOrganizationProject(
      db,
      channel.organization_id,
      targetProjectId,
    );
    if (!organizationProject) throw new HttpError(404, "Project not found");
    const project = await getProject(db, targetProjectId, session.user.id);
    if (!project || project.organization_id !== channel.organization_id) {
      throw new HttpError(404, "Project not found");
    }
    if (proposal.status === "accepted") {
      if (!proposal.project_id || !proposal.result_run_id) {
        throw new HttpError(409, "Accepted proposal is missing its result");
      }
      const executionProposal = proposal.execution_proposal_id
        ? await getChannelExecutionProposal(db, {
            organizationId: channel.organization_id,
            channelId: channel.id,
            proposalId: proposal.execution_proposal_id,
            userId: session.user.id,
          })
        : null;
      if (input.execution) {
        if (!executionProposal) {
          throw new HttpError(
            409,
            "The created issue has no retryable execution proposal",
            "CHANNEL_EXECUTION_PROPOSAL_STALE",
          );
        }
        const execution = await approveChannelExecutionProposalRequest({
          db,
          channel,
          project,
          proposal: executionProposal,
          userId: session.user.id,
          selection: input.execution,
        });
        return json({
          outcome: "already_accepted",
          projectId: proposal.project_id,
          resultRunId: proposal.result_run_id,
          executionProposal: execution.proposal,
          dispatch: execution.dispatch,
        });
      }
      return json({
        outcome: "already_accepted",
        projectId: proposal.project_id,
        resultRunId: proposal.result_run_id,
        executionProposal: liveIssueExecutionProposalJson(executionProposal),
      });
    }
    if (channel.archived_at) {
      throw new HttpError(409, "Channel is archived");
    }
    const payload = decodeChannelIssueProposalPayload(
      JSON.parse(proposal.payload_json),
    );
    const approvedAt = new Date().toISOString();
    if (input.execution) {
      decodeExecutionPreferences({
        provider: input.execution.provider,
        model: input.execution.model,
        effort: input.execution.effort,
      });
      try {
        await assertExecutionSelectionAvailable(
          db,
          channel.organization_id,
          project.id,
          {
            ...input.execution,
            observedAt: approvedAt,
          },
        );
      } catch (error) {
        if (error instanceof WorkerConflictError) {
          throw new HttpError(
            409,
            error.message,
            "CHANNEL_EXECUTION_PROPOSAL_CONFLICT",
          );
        }
        throw error;
      }
    }
    const reservation = await reserveChannelActionProposalApproval(db, {
      organizationId: channel.organization_id,
      channelId: channel.id,
      proposalId: proposal.id,
      projectId: project.id,
      userId: session.user.id,
      approvedAt,
      issueSourceKey: newChannelProposalIssueSourceKey(),
    });
    if (!reservation) {
      const current = await getChannelActionProposal(db, channel.id, proposal.id);
      if (
        current?.status === "accepted" &&
        current.project_id &&
        current.result_run_id
      ) {
        const executionProposal = current.execution_proposal_id
          ? await getChannelExecutionProposal(db, {
              organizationId: channel.organization_id,
              channelId: channel.id,
              proposalId: current.execution_proposal_id,
              userId: session.user.id,
            })
          : null;
        if (input.execution) {
          if (!executionProposal) {
            throw new HttpError(
              409,
              "The created issue has no retryable execution proposal",
              "CHANNEL_EXECUTION_PROPOSAL_STALE",
            );
          }
          const execution = await approveChannelExecutionProposalRequest({
            db,
            channel,
            project,
            proposal: executionProposal,
            userId: session.user.id,
            selection: input.execution,
          });
          return json({
            outcome: "already_accepted",
            projectId: current.project_id,
            resultRunId: current.result_run_id,
            executionProposal: execution.proposal,
            dispatch: execution.dispatch,
          });
        }
        return json({
          outcome: "already_accepted",
          projectId: current.project_id,
          resultRunId: current.result_run_id,
          executionProposal: liveIssueExecutionProposalJson(executionProposal),
        });
      }
      if (
        current?.status === "pending" &&
        current.project_id &&
        current.project_id !== project.id
      ) {
        throw new HttpError(
          409,
          "The proposal was already approved for another project",
        );
      }
      throw new HttpError(409, "Proposal changed");
    }
    const approvedIssue = approvedIssueCreation(payload.issue);
    const resultRunId = await createApprovedChannelProposalIssue({
      db,
      project,
      organizationId: channel.organization_id,
      sourceKey: reservation.issue_source_key,
      proposalId: proposal.id,
      channelId: channel.id,
      messageId: proposal.reply_message_id,
      rootMessageId: proposal.reply_parent_message_id,
      shareOrigin: new URL(request.url).origin,
      title: approvedIssue.title,
      description: approvedIssue.description,
      priority: approvedIssue.priority,
      createdByUserId: reservation.accepted_by_user_id,
      occurredAt: proposal.created_at,
    });
    const finalized = await getChannelActionProposal(db, channel.id, proposal.id);
    if (
      finalized?.status !== "accepted" ||
      finalized.project_id !== project.id ||
      finalized.result_run_id !== resultRunId ||
      finalized.issue_source_key !== reservation.issue_source_key
    ) {
      throw new HttpError(409, "Proposal approval was not finalized");
    }
    const executionProposal = finalized.execution_proposal_id
      ? await getChannelExecutionProposal(db, {
          organizationId: channel.organization_id,
          channelId: channel.id,
          proposalId: finalized.execution_proposal_id,
          userId: session.user.id,
        })
      : null;
    if (input.execution) {
      if (!executionProposal) {
        throw new HttpError(
          409,
          "The created issue has no execution proposal",
          "CHANNEL_EXECUTION_PROPOSAL_STALE",
        );
      }
      const execution = await approveChannelExecutionProposalRequest({
        db,
        channel,
        project,
        proposal: executionProposal,
        userId: session.user.id,
        selection: input.execution,
      });
      return json({
        outcome: "accepted",
        projectId: project.id,
        resultRunId,
        executionProposal: execution.proposal,
        dispatch: execution.dispatch,
      });
    }
    return json({
      outcome: "accepted",
      projectId: project.id,
      resultRunId,
      executionProposal: liveIssueExecutionProposalJson(executionProposal),
    });
  }

  const channelSkillExecutionProposalAcceptMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/skill-execution-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (channelSkillExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelSkillExecutionProposalAcceptMatch[1],
      channelSkillExecutionProposalAcceptMatch[2],
      session.user.id,
    );
    if (!(await channelSkillExecutionProposalTablesAvailable(db))) {
      throw new HttpError(
        503,
        "Agent Skill execution approval is not available during this upgrade",
        "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const proposalId = channelSkillExecutionProposalAcceptMatch[3];
    const loadProposal = () => getChannelAgentSkillExecutionProposal(db, {
      organizationId: channel.organization_id,
      channelId: channel.id,
      proposalId,
      userId: session.user.id,
    });
    const proposal = await loadProposal();
    if (!proposal) {
      throw new HttpError(404, "Agent Skill execution proposal not found");
    }
    const input = decodeAgentSkillExecutionProposalAcceptInput(
      await readJson(request),
    );
    const project = await getProject(db, proposal.project_id, session.user.id);
    if (!project || project.organization_id !== channel.organization_id) {
      throw new HttpError(404, "Project not found");
    }
    if (proposal.status === "pending" && channel.archived_at) {
      throw new HttpError(
        409,
        "Channel is archived",
        "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE",
      );
    }
    return json(await approveAgentSkillExecutionProposal(db, env.ARCHIVES, proposal, {
      sourceKind: "channel",
      userId: session.user.id,
      workerId: input.workerId,
      staleCode: "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE",
      conflictCode: "CHANNEL_SKILL_EXECUTION_PROPOSAL_CONFLICT",
      reload: loadProposal,
    }));
  }

  const channelExecutionProposalAcceptMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/proposals\/([0-9a-f-]+)\/accept-execution$/u,
  );
  if (channelExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelExecutionProposalAcceptMatch[1],
      channelExecutionProposalAcceptMatch[2],
      session.user.id,
    );
    if (!(await channelExecutionProposalTablesAvailable(db))) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const proposal = await getChannelExecutionProposal(db, {
      organizationId: channel.organization_id,
      channelId: channel.id,
      proposalId: channelExecutionProposalAcceptMatch[3],
      userId: session.user.id,
    });
    if (!proposal) throw new HttpError(404, "Execution proposal not found");
    const input = decodeChannelExecutionProposalAcceptInput(
      await readJson(request),
    );
    decodeExecutionPreferences({
      provider: input.provider,
      model: input.model,
      effort: input.effort,
    });
    const project = await getProject(db, proposal.project_id, session.user.id);
    if (!project || project.organization_id !== channel.organization_id) {
      throw new HttpError(404, "Project not found");
    }
    return json(await approveChannelExecutionProposalRequest({
      db,
      channel,
      project,
      proposal,
      userId: session.user.id,
      selection: input,
    }));
  }

  const managedComputerProductMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/product$/u,
  );
  if (managedComputerProductMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = managedComputerProductMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    return json({
      ...managedComputerProductResponse(env),
      canApply: canManageOrganization(role),
    });
  }

  const managedComputerPromotionMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/promotion\/validate$/u,
  );
  if (managedComputerPromotionMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = managedComputerPromotionMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeManagedComputerPromotionValidation(
      await readJson(request),
    );
    return json(await validateManagedComputerPromotion(db, env, {
      organizationId,
      userId: session.user.id,
      code: input.code,
      observedAt: new Date().toISOString(),
    }));
  }

  const organizationManagedComputersMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers$/u,
  );
  if (organizationManagedComputersMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputersMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const observedAt = new Date().toISOString();
    const computers = await listOrganizationManagedComputers(db, organizationId);
    const refreshed = await Promise.all(computers.map((computer) =>
      computer.state === "needs_setup"
        ? refreshManagedComputerReadiness(db, computer.id, observedAt)
        : Promise.resolve(computer)
    ));
    return json({
      computers: refreshed.flatMap((computer) =>
        computer ? [managedComputerJson(computer)] : []
      ),
      generatedAt: observedAt,
    });
  }
  if (organizationManagedComputersMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputersMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeManagedComputerApplication(await readJson(request));
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey !== input.requestId) {
      throw new HttpError(
        400,
        "Idempotency-Key must match requestId",
        "MANAGED_COMPUTER_IDEMPOTENCY_REQUIRED",
      );
    }
    const result = await applyForPromotionalManagedComputer(db, env, {
      organizationId,
      userId: session.user.id,
      code: input.code,
      requestId: input.requestId,
      observedAt: new Date().toISOString(),
    });
    return json({
      computer: managedComputerJson(result.computer),
      duplicate: result.duplicate,
      entitlement: { source: "free_promotion", totalCents: 0, currency: "USD" },
    }, result.duplicate ? 200 : 202);
  }

  const organizationManagedComputerRetryMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/([0-9a-f-]+)\/retry$/u,
  );
  if (organizationManagedComputerRetryMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputerRetryMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeManagedComputerRetry(await readJson(request));
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey !== input.requestId) {
      throw new HttpError(
        400,
        "Idempotency-Key must match requestId",
        "MANAGED_COMPUTER_IDEMPOTENCY_REQUIRED",
      );
    }
    const result = await retryManagedComputerProvisioning(db, env, {
      organizationId,
      managedComputerId: organizationManagedComputerRetryMatch[2],
      userId: session.user.id,
      requestId: input.requestId,
      observedAt: new Date().toISOString(),
    });
    const computer = await organizationManagedComputer(
      db,
      organizationId,
      organizationManagedComputerRetryMatch[2],
    );
    if (!computer) throw new HttpError(404, "Managed computer not found");
    return json({
      computer: managedComputerJson(computer),
      duplicate: !result.created,
    }, 202);
  }

  const organizationManagedComputerMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/([0-9a-f-]+)$/u,
  );
  if (organizationManagedComputerMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputerMatch[1];
    if (!(await getOrganizationRole(db, organizationId, session.user.id))) {
      throw new HttpError(404, "Organization not found");
    }
    let computer = await organizationManagedComputer(
      db,
      organizationId,
      organizationManagedComputerMatch[2],
    );
    if (!computer) throw new HttpError(404, "Managed computer not found");
    if (computer.state === "needs_setup") {
      computer = await refreshManagedComputerReadiness(
        db,
        computer.id,
        new Date().toISOString(),
      );
    }
    if (!computer) throw new HttpError(404, "Managed computer not found");
    return json({ computer: managedComputerJson(computer) });
  }

  const organizationWorkersMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/workers$/u,
  );
  if (organizationWorkersMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkersMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const observedAt = new Date().toISOString();
    return json({
      workers: await listOrganizationExecutionWorkers(
        db,
        organizationId,
        observedAt,
      ),
      latestVersion: await readLatestVersion(env.RELEASES),
      canManage: canManageOrganization(role),
      generatedAt: observedAt,
    });
  }

  const organizationWorkerUpdateMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/workers\/([0-9a-zA-Z-]+)\/updates$/u,
  );
  if (organizationWorkerUpdateMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkerUpdateMatch[1];
    const deviceId = organizationWorkerUpdateMatch[2];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const device = (
      await listOrganizationExecutionWorkers(
        db,
        organizationId,
        new Date().toISOString(),
      )
    ).find((candidate) => candidate.deviceId === deviceId);
    if (!device) throw new HttpError(404, "Worker not found");
    if (
      device.ownerUserId !== session.user.id &&
      !canManageOrganization(role)
    ) {
      throw new HttpError(
        403,
        "Worker owner or organization admin access required",
      );
    }
    if (!device.remoteUpdateSupported) {
      throw new HttpError(409, "Worker does not support remote updates");
    }
    const targetVersion = await readLatestVersion(env.RELEASES);
    if (!targetVersion) throw new HttpError(503, "Latest release is unavailable");
    const currentVersion = device.versions.briar;
    if (
      currentVersion &&
      isSemanticVersion(currentVersion) &&
      compareSemanticVersions(currentVersion, targetVersion) >= 0
    ) {
      return json({ outcome: "already_current", targetVersion });
    }
    const requestedAt = new Date().toISOString();
    const updateRequest = await requestExecutionWorkerUpdate(db, {
      id: crypto.randomUUID(),
      organizationId,
      deviceId,
      requestedByUserId: session.user.id,
      targetVersion,
      requestedAt,
    });
    return json({
      outcome: "requested",
      requestId: updateRequest.id,
      targetVersion: updateRequest.targetVersion,
    }, 202);
  }

  const organizationWorkerMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/workers\/([0-9a-zA-Z-]+)$/u,
  );
  if (organizationWorkerMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkerMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const device = await db
      .prepare(
        `select id, owner_user_id
         from briar_execution_worker_devices
         where id = ? and organization_id = ?`,
      )
      .bind(organizationWorkerMatch[2], organizationId)
      .first<{ id: string; owner_user_id: string }>();
    if (!device) throw new HttpError(404, "Worker not found");
    if (
      device.owner_user_id !== session.user.id &&
      !canManageOrganization(role)
    ) {
      throw new HttpError(
        403,
        "Worker owner or organization admin access required",
      );
    }
    const input = decodeWorkerSettings(await readJson(request));
    const observedAt = new Date().toISOString();
    let updated =
      input.maxConcurrentSessions === undefined
        ? null
        : await updateExecutionWorkerConcurrency(
            db,
            device.id,
            input.maxConcurrentSessions,
            observedAt,
          );
    if (input.icon !== undefined) {
      updated = await updateExecutionWorkerIcon(
        db,
        device.id,
        input.icon,
        observedAt,
      );
    }
    if (!updated) throw new HttpError(409, "Worker is disabled");
    return json({
      deviceId: updated.id,
      maxConcurrentSessions: updated.max_concurrent_sessions,
      icon:
        updated.icon_type && updated.icon_value
          ? { type: updated.icon_type, value: updated.icon_value }
          : null,
    });
  }
  if (organizationWorkerMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkerMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const device = await db
      .prepare(
        `select id, owner_user_id
         from briar_execution_worker_devices
         where id = ? and organization_id = ?`,
      )
      .bind(organizationWorkerMatch[2], organizationId)
      .first<{ id: string; owner_user_id: string }>();
    if (!device) throw new HttpError(404, "Worker not found");
    if (
      device.owner_user_id !== session.user.id &&
      !canManageOrganization(role)
    ) {
      throw new HttpError(
        403,
        "Worker owner or organization admin access required",
      );
    }
    if (
      !(await disableExecutionWorker(
        db,
        device.id,
        new Date().toISOString(),
      ))
    ) {
      throw new HttpError(404, "Worker not found");
    }
    return new Response(null, { status: 204, headers: corsHeaders });
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

  if (pathname === "/projects" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const projects = await listProjects(db, session.user.id);
    return json(decodeMobileProjectsResponse({
      projects: projects.map(projectJson),
    }));
  }

  if (pathname === "/projects" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = decodeProjectInput(await readJson(request));
    let organizations = await listOrganizations(db, session.user.id);
    if (organizations.length === 0) {
      const organization = await createOrganization(db, {
        name:
          session.user.name?.trim() ||
          session.user.email.split("@")[0]?.trim() ||
          "Briar",
        handle: `organization-${crypto.randomUUID().replaceAll("-", "")}`,
        ownerUserId: session.user.id,
      });
      organizations = [organization];
    }
    const organization =
      organizations.find(
        (candidate) => candidate.id === input.organizationId,
      ) ?? (input.organizationId ? null : organizations[0]);
    if (!organization || !canManageOrganization(organization.role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const tokenHash = await sha256(agentToken);
    const project = await createProject(db, {
      ownerUserId: session.user.id,
      organizationId: organization.id,
      name: input.name,
      agentTokenHash: tokenHash,
      locale: normalizeProjectAgentLocale(
        request.headers.get("accept-language"),
      ),
    });
    project.organization_name = organization.name;
    project.member_role = organization.role;
    return json({ project: projectJson(project), agentToken }, 201);
  }

  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]+)$/u);
  if (projectMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (project.member_role !== "owner") {
      throw new HttpError(403, "Organization owner access required");
    }
    if (await getProjectRunChildMismatch(db, project.id)) {
      throw new HttpError(
        409,
        "Project transfer reconciliation is required before deletion",
        "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
      );
    }
    const observedAt = new Date().toISOString();
    let deleted = false;
    try {
      deleted = await deleteProject(
        db,
        project.id,
        session.user.id,
        observedAt,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.includes("project has stranded transferred issue data") ||
          error.message.includes("quarantined transcript")
        )
      ) {
        throw new HttpError(
          409,
          "Project transfer reconciliation is required before deletion",
          "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
        );
      }
      throw error;
    }
    if (!deleted) {
      throw new HttpError(404, "Project not found");
    }
    return responseWithPostCommitCleanup(
      new Response(null, { status: 204, headers: corsHeaders }),
      {
        context,
        operation: "project_delete",
        observedAt,
        tasks: [{
          queue: "archive",
          run: () => processArchiveCleanupQueue(
            db,
            env.ARCHIVES,
            attachmentsBucket,
            observedAt,
            1_000,
          ),
        }],
      },
    );
  }

  const projectIconMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/icon$/u,
  );
  if (projectIconMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectIconMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeProjectIconInput(
      await readJson(request, maxProjectIconRequestBytes),
    );
    if (!(await updateProjectIcon(db, project.id, input.icon))) {
      throw new HttpError(404, "Project not found");
    }
    return json({ project: projectJson({ ...project, icon: input.icon }) });
  }

  const projectIssueKeyPrefixMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/issue-key-prefix$/u,
  );
  if (projectIssueKeyPrefixMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectIssueKeyPrefixMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeProjectIssueKeyPrefixInput(
      await readJson(request),
    );
    if (
      !(await updateProjectIssueKeyPrefix(
        db,
        project.id,
        input.issueKeyPrefix,
      ))
    ) {
      throw new HttpError(404, "Project not found");
    }
    return json({
      project: projectJson({
        ...project,
        issue_key_prefix: input.issueKeyPrefix,
      }),
    });
  }

  const projectTabsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/tabs$/u,
  );
  if (projectTabsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectTabsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeProjectTabsInput(await readJson(request));
    if (
      !(await updateProjectScheduleTabEnabled(
        db,
        project.id,
        input.schedule,
      ))
    ) {
      throw new HttpError(404, "Project not found");
    }
    return json({
      project: projectJson({
        ...project,
        schedule_tab_enabled: input.schedule ? 1 : 0,
      }),
    });
  }

  const settingsMatch = pathname.match(/^\/projects\/([0-9a-f-]+)\/settings$/u);
  const mergeQueueProfileMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/merge-queue-profile$/u,
  );
  if (
    mergeQueueProfileMatch &&
    (request.method === "GET" || request.method === "PUT")
  ) {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      mergeQueueProfileMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const current = await getMergeQueueProfile(db, project.id);
    if (request.method === "GET") {
      return json({ profile: mergeQueueProfileJson(current) });
    }
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeMergeQueueProfileUpdate(await readJson(request));
    const settings = await getProjectSettings(db, project.id);
    const repositoryName = settings?.github_repository?.trim().toLowerCase();
    if (!repositoryName) {
      throw new HttpError(
        409,
        "Connect one GitHub repository before configuring its merge queue",
      );
    }
    const connection = await getGithubConnectionForOrganization(
      db,
      project.organization_id,
    );
    if (!connection) {
      throw new HttpError(409, "GitHub integration is not connected");
    }
    const repository = (await listGithubConnectionRepositories(
      db,
      connection.installation_id,
    )).find((candidate) =>
      candidate.full_name.toLowerCase() === repositoryName
    );
    if (!repository) {
      throw new HttpError(
        409,
        "The configured repository is not included in the GitHub installation",
      );
    }
    const configured = await configureMergeQueueProfile(db, {
      projectId: project.id,
      repositoryId: repository.repository_id,
      repository: repository.full_name,
      enabled: input.enabled,
      quietWindowMs: input.quietWindowMs,
      maxBatchSize: input.maxBatchSize,
      observedAt: new Date().toISOString(),
    });
    if (configured.outcome === "active_batch") {
      throw new HttpError(
        409,
        "Drain the active merge batch before changing or disabling its lane",
      );
    }
    if (configured.outcome === "lane_owned") {
      throw new HttpError(
        409,
        "Another Briar project already owns this repository/main lane",
      );
    }
    return json({ profile: mergeQueueProfileJson(configured.profile) });
  }
  const checkpointPolicyMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/checkpoint-policy$/u,
  );
  if (checkpointPolicyMatch && ["GET", "PUT"].includes(request.method)) {
    const session = await requireSession(auth, request);
    const project = await getProject(db, checkpointPolicyMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (request.method === "GET") {
      return json({
        checkpointPolicy: checkpointPolicyJson(
          await loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
        ),
      });
    }
    const input = decodeCheckpointPolicyInput(await readJson(request));
    if (input.scope === "project" && !canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const current = await loadWorkflowCheckpointPolicy(
      db,
      project.id,
      session.user.id,
    );
    const checkpoints = canonicalizeCheckpointSet(
      current.workflow,
      input.checkpoints,
      input.scope,
    );
    const updated = input.scope === "project"
      ? await updateProjectMandatoryCheckpoints(
          db,
          project.id,
          checkpoints,
          input.expectedRevision,
        )
      : await updateUserWorkflowCheckpointDefaults(
          db,
          project.id,
          session.user.id,
          checkpoints,
          input.expectedRevision,
        );
    if (!updated) {
      throw new HttpError(
        409,
        "Checkpoint policy changed; reload before saving",
        "CHECKPOINT_POLICY_CONFLICT",
      );
    }
    return json({
      checkpointPolicy: checkpointPolicyJson(
        await loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
      ),
    });
  }
  const storageMetricsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/storage-metrics$/u,
  );
  if (storageMetricsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, storageMetricsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    return json({ metrics: await collectStorageMetrics(db, project.id) });
  }
  if (settingsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const [settings, policy] = await Promise.all([
      getProjectSettings(db, project.id),
      loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
    ]);
    return json({
      settings: settingsJson(settings, checkpointPolicyJson(policy)),
    });
  }
  if (settingsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = parseProjectSettingsInput(await readJson(request));
    const currentSettings = await getProjectSettings(db, project.id);
    if (
      !isStoredWorkflowUnchanged(
        currentSettings?.workflow_json,
        input.workflow,
      )
    ) {
      await assertStoredCheckpointPoliciesCompatible(
        db,
        project.id,
        input.workflow,
      );
    }
    const settings = await updateProjectSettings(db, project.id, {
      velenOrg: input.velenOrg ?? null,
      dataSource: input.dataSource ?? null,
      linear: input.linear,
      githubRepository: input.githubRepository ?? null,
      workflow: input.workflow,
    });
    const policy = await loadWorkflowCheckpointPolicy(
      db,
      project.id,
      session.user.id,
    );
    return json({ settings: settingsJson(settings, checkpointPolicyJson(policy)) });
  }

  const executionPolicyMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/execution-policy$/u,
  );
  if (executionPolicyMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      executionPolicyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    return json({
      policy: await getProjectExecutionWorkerPolicy(db, project.id),
    });
  }
  if (executionPolicyMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      executionPolicyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeExecutionWorkerPolicy(await readJson(request));
    const policy = await updateProjectExecutionWorkerPolicy(db, project.id, {
      ...input,
      updatedByUserId: session.user.id,
      observedAt: new Date().toISOString(),
    });
    return json({ policy });
  }

  const projectAgentsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agents$/u,
  );
  const projectAgentSessionsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-sessions$/u,
  );
  const projectAgentSessionChangesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-sessions\/changes$/u,
  );
  const projectAgentTasksMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-tasks$/u,
  );
  if (projectAgentTasksMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentTasksMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentTaskInput(await readJson(request));
    const existingJob = await getProjectAgentTaskJobByRequest(
      db,
      project.id,
      input.requestId,
    );
    if (existingJob) {
      const existingSession = await getProjectAgentSession(
        db,
        project.id,
        existingJob.id,
      );
      if (!existingSession) {
        throw new HttpError(409, "Agent task session is missing");
      }
      return json({ session: projectAgentSessionJson(existingSession) });
    }

    const agent = await getProjectAgent(db, project.id, input.agentId);
    if (!agent) throw new HttpError(404, "Agent not found for this project");
    if (!input.skillId && agent.skills.length !== 1) {
      throw new HttpError(400, "Choose an Agent Skill before running the Agent");
    }
    const selectedSkill = await getAgentSkill(
      db,
      agent.id,
      input.skillId ?? null,
    );
    if (!selectedSkill) {
      throw new HttpError(404, "Agent Skill not found for this Agent");
    }
    const worker = await db
      .prepare(
        `select worker.*, device.max_concurrent_sessions
         from briar_execution_workers worker
         join briar_execution_worker_devices device on device.id = worker.device_id
         where worker.id = ? and worker.project_id = ?
           and device.organization_id = ?`,
      )
      .bind(input.workerId, project.id, project.organization_id)
      .first<{
        id: string;
        agent_provider: AgentProvider;
        capabilities_json: string;
        state: "online" | "stale" | "disabled";
        accepting_work: number;
        readiness_state: "ready" | "busy" | "needs_attention";
        last_heartbeat_at: string;
        max_concurrent_sessions: number;
      }>();
    if (!worker) throw new HttpError(404, "Worker not found for this project");
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(worker.last_heartbeat_at, observedAt, worker.state) !== "online" ||
      worker.accepting_work !== 1 ||
      worker.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to accept agent tasks");
    }
    if (!executionWorkerProviders(worker).includes(selectedSkill.provider)) {
      throw new HttpError(
        409,
        `Worker does not support the ${selectedSkill.provider} provider`,
      );
    }
    if (!(await isExecutionWorkerAllowedForProject(db, project.id, worker.id))) {
      throw new HttpError(
        409,
        "Worker is not allowed by this project's execution policy",
      );
    }
    const active = await db
      .prepare(
        `select
           (select count(*)
            from briar_hunt_runs run
            where run.worker_id = ? and run.claim_token_hash is not null
              and run.lease_expires_at > ?
              and run.status not in ('backlog', 'completed', 'cancelled', 'blocked', 'failed'))
           +
           (select count(*)
            from briar_project_agent_task_jobs task
            where task.claimed_worker_id = ? and task.status = 'running'
              and task.lease_expires_at > ?) as count`,
      )
      .bind(worker.id, observedAt, worker.id, observedAt)
      .first<{ count: number }>();
    if ((active?.count ?? 0) >= worker.max_concurrent_sessions) {
      throw new HttpError(409, "Worker has no available execution slot");
    }

    const taskId = crypto.randomUUID();
    let job;
    try {
      job = await createProjectAgentTaskJob(db, {
        id: taskId,
        projectId: project.id,
        agentId: agent.id,
        skill: selectedSkill,
        request: input.request,
        requestId: input.requestId,
        workerId: worker.id,
        createdAt: observedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("unique")) throw error;
      job = await getProjectAgentTaskJobByRequest(
        db,
        project.id,
        input.requestId,
      );
    }
    if (!job) throw new HttpError(409, "Agent task could not be queued");
    const payload = {
      dispatchGroupId: taskId,
      agentId: agent.id,
      agentName: agent.name,
      skillId: selectedSkill.id,
      sessionType: "task" as const,
      trigger: "manual" as const,
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      request: input.request,
      followUps: [],
      status: "running" as const,
      issues: [],
      startedAt: observedAt,
      completedAt: null,
      conversationId: null,
      requestedWorkerId: worker.id,
      workerId: worker.id,
      summary: null,
      error: null,
      events: [projectAgentTaskSessionEvent("started", observedAt)],
      updatedAt: observedAt,
    };
    const createdSession = await upsertProjectAgentSession(db, {
      project_id: project.id,
      id: taskId,
      agent_id: agent.id,
      requested_by_user_id: session.user.id,
      status: "running",
      session_type: "task",
      payload_json: JSON.stringify(payload),
      started_at: observedAt,
      completed_at: null,
      updated_at: observedAt,
    }, observedAt);
    if (!createdSession) {
      throw new HttpError(409, "Agent task session could not be created");
    }
    scheduleProjectAgentSessionRealtimePublish(
      env,
      db,
      project.id,
      context,
    );
    return json({ session: projectAgentSessionJson(createdSession) });
  }
  if (projectAgentSessionChangesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionChangesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    let cursor: number | null = null;
    if (rawCursor !== null) {
      if (!/^\d+$/u.test(rawCursor)) {
        throw new HttpError(400, "A non-negative Agent session cursor is required");
      }
      cursor = Number(rawCursor);
      if (!Number.isSafeInteger(cursor)) {
        throw new HttpError(400, "Agent session cursor is outside the safe range");
      }
    } else {
      // Historical archives predate the D1 summary projection. This bounded
      // one-time backfill is the only list path that may read those legacy R2
      // objects; later snapshots and every delta are D1-only.
      await backfillArchivedProjectAgentSessionSummaries(
        db,
        env.ARCHIVES,
        project.id,
      );
    }

    const currentCursor = await getProjectAgentSessionSyncCursor(db, project.id);
    const etag = projectAgentSessionSyncEtag(project.id, currentCursor);
    if (
      cursor === currentCursor &&
      request.headers.get("if-none-match") === etag
    ) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          "Cache-Control": "private, no-cache",
          ETag: etag,
        },
      });
    }

    if (cursor === null) {
      const summaries = await listProjectAgentSessionSummaries(db, project.id);
      return projectAgentSessionSyncJson({
        cursor: currentCursor,
        hasMore: false,
        reset: true,
        sessions: summaries.map(projectAgentSessionSummaryJson),
        deletedSessionIds: [],
      }, etag);
    }

    const page = await listProjectAgentSessionChanges(db, project.id, cursor);
    if (page.expired) {
      return projectAgentSessionSyncJson({
        code: "project_agent_session_cursor_expired",
        message: "Agent session cursor expired; reload the summary snapshot",
      }, etag, 410);
    }
    const changedSessionIds = [...new Set(
      page.changes.map((change) => change.session_id),
    )];
    const summaries = await listProjectAgentSessionSummaries(
      db,
      project.id,
      changedSessionIds,
    );
    const existingIds = new Set(summaries.map((summary) => summary.session_id));
    return projectAgentSessionSyncJson({
      cursor: page.nextCursor,
      hasMore: page.hasMore,
      reset: false,
      sessions: summaries.map(projectAgentSessionSummaryJson),
      deletedSessionIds: changedSessionIds.filter((id) => !existingIds.has(id)),
    }, etag);
  }
  if (projectAgentSessionsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const [hotSessions, archivedSessions] = await Promise.all([
      listProjectAgentSessions(db, project.id),
      listArchivedProjectAgentSessions(db, env.ARCHIVES, project.id),
    ]);
    const sessions = [
      ...new Map(
        [...archivedSessions, ...hotSessions].map((item) => [item.id, item]),
      ).values(),
    ]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 200);
    return json({ sessions: sessions.map(projectAgentSessionJson) });
  }
  const projectAgentSessionMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-sessions\/([A-Za-z0-9_-]{1,128})$/u,
  );
  if (projectAgentSessionMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const hot = await getProjectAgentSession(
      db,
      project.id,
      projectAgentSessionMatch[2],
    );
    if (hot) return privateNoStoreJson({ session: projectAgentSessionJson(hot) });
    const archived = await getArchivedProjectAgentSession(
      db,
      env.ARCHIVES,
      project.id,
      projectAgentSessionMatch[2],
    );
    if (!archived) throw new HttpError(404, "Agent session not found");
    return privateNoStoreJson({
      session: {
        ...projectAgentSessionJson(archived),
        archived: true,
      },
    });
  }
  if (projectAgentSessionMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (
      await agentSkillExecutionApprovalTablesAvailable(db) &&
      await projectAgentSessionIsApprovalOwned(
        db,
        project.id,
        projectAgentSessionMatch[2],
      )
    ) {
      throw new HttpError(
        409,
        "Approved Agent Skill execution sessions are updated by their assigned Worker",
        "AGENT_SKILL_EXECUTION_SESSION_SERVER_OWNED",
      );
    }
    const input = decodeProjectAgentSessionInput(await readJson(request));
    const observedAt = new Date().toISOString();
    const existing = await getProjectAgentSession(
      db,
      project.id,
      projectAgentSessionMatch[2],
    ) ?? await getArchivedProjectAgentSession(
      db,
      env.ARCHIVES,
      project.id,
      projectAgentSessionMatch[2],
    );
    let requestedByUserId: string | null;
    if (existing) {
      requestedByUserId = existing.requested_by_user_id;
    } else if (input.parentSessionId) {
      const parent = await getProjectAgentSession(
        db,
        project.id,
        input.parentSessionId,
      ) ?? await getArchivedProjectAgentSession(
        db,
        env.ARCHIVES,
        project.id,
        input.parentSessionId,
      );
      requestedByUserId = parent?.requested_by_user_id ?? null;
    } else if (input.trigger === "scheduled" && input.scheduleId) {
      requestedByUserId = await getProjectAgentScheduleCreatorId(
        db,
        project.id,
        input.scheduleId,
      );
    } else {
      requestedByUserId = session.user.id;
    }
    const row = await upsertProjectAgentSession(db, {
      project_id: project.id,
      id: projectAgentSessionMatch[2],
      agent_id: input.agentId,
      requested_by_user_id: requestedByUserId,
      status: input.status,
      session_type: input.sessionType,
      payload_json: JSON.stringify(input),
      started_at: input.startedAt,
      completed_at: input.completedAt,
      updated_at: input.updatedAt,
    }, observedAt);
    if (!row) throw new HttpError(409, "Agent session could not be synchronized");
    scheduleProjectAgentSessionRealtimePublish(
      env,
      db,
      project.id,
      context,
    );
    return json({ session: projectAgentSessionJson(row) });
  }
  if (projectAgentsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const agents = await listProjectAgents(db, project.id);
    return json({
      agents: agents.map((agent) => projectAgentJson(agent)),
    });
  }
  if (projectAgentsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentInput(await readJson(request));
    if (input.codexPet !== undefined) {
      throw new HttpError(
        400,
        "Create the agent before selecting a Codex Pet avatar",
      );
    }
    const providerName = agentProviderLabels[input.provider];
    const agent = await createProjectAgent(db, project.id, {
      name: input.name ?? `${providerName} Agent`,
      avatar: input.avatar ?? null,
      provider: input.provider,
      model: input.model ?? null,
      effort: input.effort ?? null,
      description: input.description ?? "",
      responsibility: input.responsibility,
      skills: input.skills ?? [],
      calendarColor: input.calendarColor,
    });
    return json({ agent: projectAgentJson(agent) }, 201);
  }

  const projectAgentSchedulesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedules$/u,
  );
  if (projectAgentSchedulesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSchedulesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const schedules = await listProjectAgentSchedules(db, project.id);
    return json({
      schedules: schedules.map(projectAgentScheduleJson),
    });
  }
  if (projectAgentSchedulesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSchedulesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleInput(
      await readJson(request),
    );
    const schedule = await createProjectAgentSchedule(db, project.id, {
      ...input,
      createdByUserId: session.user.id,
    });
    if (!schedule) throw new HttpError(404, "Project agent not found");
    return json({ schedule: projectAgentScheduleJson(schedule) }, 201);
  }

  const projectAgentScheduleMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedules\/([0-9a-f-]+)$/u,
  );
  if (projectAgentScheduleMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentScheduleMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleInput(
      await readJson(request),
    );
    const schedule = await updateProjectAgentSchedule(
      db,
      project.id,
      projectAgentScheduleMatch[2],
      input,
    );
    if (!schedule) {
      throw new HttpError(404, "Project agent schedule not found");
    }
    return json({ schedule: projectAgentScheduleJson(schedule) });
  }
  if (projectAgentScheduleMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentScheduleMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const result = await deleteProjectAgentSchedule(
      db,
      project.id,
      projectAgentScheduleMatch[2],
    );
    if (result === "running") {
      throw new HttpError(409, "A schedule run is currently active");
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const projectAgentScheduleRunsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs$/u,
  );
  if (projectAgentScheduleRunsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentScheduleRunsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const runs = await listProjectAgentScheduleRuns(db, project.id);
    return json({ runs: runs.map((run) => projectAgentScheduleRunJson(run)) });
  }

  if (pathname === "/agent-schedule-runs/claim" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = decodeProjectAgentScheduleBatchClaim(
      await readJson(request),
    );
    const observedAt = new Date().toISOString();
    const projectIds = await listClaimableProjectAgentScheduleProjectIds(
      db,
      session.user.id,
      input.projectIds,
      observedAt,
    );
    for (const projectId of projectIds) {
      const settings = await getProjectSettings(db, projectId);
      const workflow = normalizeAutoHuntWorkflow(
        settings?.workflow_json ? JSON.parse(settings.workflow_json) : null,
      );
      if (isRepositoryWorkflowPending(workflow)) continue;
      const claimToken = `briar_schedule_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
      const run = await claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: await sha256(claimToken),
        observedAt,
      });
      if (!run) continue;
      scheduleProjectRealtimePublish(env, db, projectId, context);
      return json({ run: projectAgentScheduleRunJson(run, claimToken) });
    }
    return json({ run: null });
  }

  const projectAgentScheduleRunsClaimMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs\/claim$/u,
  );
  if (projectAgentScheduleRunsClaimMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentScheduleRunsClaimMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const settings = await getProjectSettings(db, project.id);
    const workflow = normalizeAutoHuntWorkflow(
      settings?.workflow_json ? JSON.parse(settings.workflow_json) : null,
    );
    if (isRepositoryWorkflowPending(workflow)) {
      throw new HttpError(409, "Repository workflow has not been generated");
    }
    const observedAt = new Date().toISOString();
    const claimToken = `briar_schedule_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimDueProjectAgentScheduleRun(db, project.id, {
      claimTokenHash: await sha256(claimToken),
      observedAt,
    });
    if (run) scheduleProjectRealtimePublish(env, db, project.id, context);
    return json({
      run: run ? projectAgentScheduleRunJson(run, claimToken) : null,
    });
  }

  const projectAgentScheduleRunCompleteMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs\/([0-9a-f-]+)\/complete$/u,
  );
  if (projectAgentScheduleRunCompleteMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentScheduleRunCompleteMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleRunCompletion(
      await readJson(request),
    );
    const run = await completeProjectAgentScheduleRun(
      db,
      project.id,
      projectAgentScheduleRunCompleteMatch[2],
      {
        claimTokenHash: await sha256(input.claimToken),
        status: input.status,
        resultSummary: input.resultSummary ?? null,
        structuredResult: input.structuredResult,
        error: input.error ?? null,
        observedAt: new Date().toISOString(),
      },
    );
    if (!run)
      throw new HttpError(409, "Schedule run claim is no longer active");
    return json({ run: projectAgentScheduleRunJson(run) });
  }

  const projectAgentScheduleRunRenewMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-schedule-runs\/([0-9a-f-]+)\/renew$/u,
  );
  if (projectAgentScheduleRunRenewMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentScheduleRunRenewMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentScheduleRunRenew(
      await readJson(request),
    );
    const run = await renewProjectAgentScheduleRunLease(
      db,
      project.id,
      projectAgentScheduleRunRenewMatch[2],
      {
        claimTokenHash: await sha256(input.claimToken),
        observedAt: new Date().toISOString(),
      },
    );
    if (!run)
      throw new HttpError(409, "Schedule run claim is no longer active");
    return json({ leaseExpiresAt: run.lease_expires_at });
  }

  const projectAgentMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)$/u,
  );
  if (projectAgentMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectAgentMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeProjectAgentInput(await readJson(request));
    const existing = await getProjectAgent(
      db,
      project.id,
      projectAgentMatch[2],
    );
    if (!existing) throw new HttpError(404, "Agent not found");
    let nextCodexPet:
      | {
          json: string;
          objectKey: string;
        }
      | null
      | undefined;
    if (input.codexPet === null) {
      nextCodexPet = null;
    } else if (input.codexPet) {
      let fetched;
      try {
        fetched = await fetchCodexPet(input.codexPet.slug);
      } catch {
        throw new HttpError(
          502,
          "Could not download the Codex Pet sprite sheet",
        );
      }
      const objectKey = codexPetSpriteSheetObjectKey(
        project.id,
        existing.id,
        fetched.metadata.slug,
      );
      await attachmentsBucket.put(objectKey, fetched.spriteSheet, {
        customMetadata: {
          author: fetched.metadata.author,
          license: fetched.metadata.license,
          slug: fetched.metadata.slug,
          source: "https://codexpet.top",
          spriteVersion: String(fetched.metadata.spriteVersion),
        },
        httpMetadata: {
          contentType: "image/webp",
        },
      });
      nextCodexPet = {
        json: JSON.stringify(fetched.metadata),
        objectKey,
      };
    }
    const providerName = agentProviderLabels[input.provider];
    let agent: ProjectAgentRow | null;
    try {
      agent = await updateProjectAgent(
        db,
        project.id,
        projectAgentMatch[2],
        {
          name: input.name ?? `${providerName} Agent`,
          avatar: input.avatar,
          codexPet: nextCodexPet,
          provider: input.provider,
          model: input.model ?? null,
          effort: input.effort ?? null,
          description: input.description ?? existing.description,
          responsibility: input.responsibility,
          skills: input.skills,
          calendarColor: input.calendarColor,
        },
      );
    } catch (error) {
      if (nextCodexPet?.objectKey) {
        await attachmentsBucket
          .delete(nextCodexPet.objectKey)
          .catch(() => undefined);
      }
      throw error;
    }
    if (!agent) {
      if (nextCodexPet?.objectKey) {
        await attachmentsBucket.delete(nextCodexPet.objectKey);
      }
      throw new HttpError(404, "Agent not found");
    }
    if (
      input.codexPet !== undefined &&
      existing.avatar_spritesheet_object_key &&
      existing.avatar_spritesheet_object_key !==
        agent.avatar_spritesheet_object_key
    ) {
      await attachmentsBucket
        .delete(existing.avatar_spritesheet_object_key)
        .catch(() => undefined);
    }
    return json({ agent: projectAgentJson(agent) });
  }
  if (projectAgentMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectAgentMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const agent = await deleteProjectAgent(
      db,
      project.id,
      projectAgentMatch[2],
    );
    if (!agent) throw new HttpError(404, "Agent not found");
    if (agent === "running") {
      throw new HttpError(409, "An agent schedule run is currently active");
    }
    if (agent.avatar_spritesheet_object_key) {
      await attachmentsBucket
        .delete(agent.avatar_spritesheet_object_key)
        .catch(() => undefined);
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const projectAgentSpriteSheetMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)\/spritesheet$/u,
  );
  if (projectAgentSpriteSheetMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSpriteSheetMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const agent = await getProjectAgent(
      db,
      project.id,
      projectAgentSpriteSheetMatch[2],
    );
    if (!agent?.avatar_spritesheet_object_key) {
      throw new HttpError(404, "Agent sprite sheet not found");
    }
    const object = await attachmentsBucket.get(
      agent.avatar_spritesheet_object_key,
    );
    if (!object) throw new HttpError(404, "Agent sprite sheet not found");
    const headers = new Headers(corsHeaders);
    headers.set("Cache-Control", "private, max-age=300");
    headers.set("Content-Length", String(object.size));
    headers.set("Content-Type", "image/webp");
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  }

  const linearConnectMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/linear\/connect$/u,
  );
  if (linearConnectMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      linearConnectMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeLinearApiKeyInput(await readJson(request));
    try {
      const { viewer, teams } = await fetchLinearViewerAndTeams(input.apiKey);
      return json({ viewer, teams });
    } catch (error) {
      if (error instanceof LinearApiError) {
        throw new HttpError(
          error.status === 401 || error.status === 403 ? 401 : 502,
          error.message,
        );
      }
      throw error;
    }
  }

  const linearStatesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/linear\/states$/u,
  );
  if (linearStatesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, linearStatesMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeLinearStatesInput(await readJson(request));
    try {
      const states = await fetchLinearWorkflowStates(
        input.apiKey,
        input.teamIds,
      );
      return json({ states });
    } catch (error) {
      if (error instanceof LinearApiError) {
        throw new HttpError(
          error.status === 401 || error.status === 403 ? 401 : 502,
          error.message,
        );
      }
      throw error;
    }
  }

  const linearImportMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/linear\/import$/u,
  );
  if (linearImportMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, linearImportMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeLinearImportInput(await readJson(request));
    const settings = await getProjectSettings(db, project.id);
    const workflow = settings?.workflow_json
      ? normalizeAutoHuntWorkflow(JSON.parse(settings.workflow_json))
      : cloneAutoHuntWorkflow();
    const firstStageId = workflow.stages[0]?.id ?? null;
    const workflowStageIds = new Set(workflow.stages.map((stage) => stage.id));

    const statusMap = new Map<
      string,
      { status: AutoHuntPersistedRunStatus; workflowStage: string | null }
    >();
    for (const [stateId, placementKey] of Object.entries(input.statusMapping)) {
      const placement = parsePlacementKey(placementKey);
      if (!placement) {
        throw new HttpError(400, `Invalid status mapping for state ${stateId}`);
      }
      if (
        placement.status === "running" &&
        (!placement.workflowStage ||
          !workflowStageIds.has(placement.workflowStage))
      ) {
        throw new HttpError(
          400,
          `Status mapping for ${stateId} targets an unknown workflow stage`,
        );
      }
      statusMap.set(stateId, placement);
    }

    try {
      const { issues, truncated } = await fetchLinearIssuesForTeams(
        input.apiKey,
        input.teamIds,
        LINEAR_IMPORT_ISSUE_LIMIT,
      );
      const runs = issues.map((issue) => {
        const mapped =
          (issue.state ? statusMap.get(issue.state.id) : null) ??
          defaultPlacementForLinearType(
            issue.state?.type ?? "unstarted",
            firstStageId,
          );
        return {
          sourceKey: linearSourceKey(issue.id),
          title: issue.title,
          description: issue.description,
          priority: mapLinearPriority(issue.priority),
          status: mapped.status,
          workflowStage: mapped.workflowStage,
          tracker: {
            provider: "linear",
            issueId: issue.id,
            identifier: issue.identifier,
            url: issue.url,
            state: issue.state?.name ?? null,
          },
          sourceCreatedAt: issue.createdAt,
        };
      });
      const result = await importLinearHuntRuns(
        db,
        project.id,
        settings?.github_repository ?? project.name,
        runs,
      );
      return json({
        ...result,
        total: issues.length,
        truncated,
      });
    } catch (error) {
      if (error instanceof LinearApiError) {
        throw new HttpError(
          error.status === 401 || error.status === 403 ? 401 : 502,
          error.message,
        );
      }
      throw error;
    }
  }

  const agentTokenMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-token$/u,
  );
  if (agentTokenMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, agentTokenMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const issued = await issueProjectAgentToken(
      db,
      project.id,
      session.user.id,
      await sha256(agentToken),
    );
    if (!issued) {
      throw new HttpError(403, "Repository connection permission denied");
    }
    return json({ agentToken });
  }

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

  const attachmentMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  if (
    attachmentMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    if (bearerToken(request).startsWith("briar_worker_")) {
      if (
        (await requireRunExecutionProject(db, request, attachmentMatch[2])) !==
        attachmentMatch[1]
      ) {
        throw new HttpError(404, "Attachment not found");
      }
    } else {
      await requireProjectAccess(auth, db, request, attachmentMatch[1]);
    }
    const attachment = await getIssueAttachment(
      db,
      attachmentMatch[1],
      attachmentMatch[2],
      attachmentMatch[3],
    );
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(attachment.object_key);
      if (!object) throw new HttpError(404, "Attachment not found");
      return attachmentResponse(attachment, object, null);
    }
    const object = await attachmentsBucket.get(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return attachmentResponse(attachment, object, object.body);
  }

  const issueMessagesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages$/u,
  );
  const issueMessagesDeltaMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages\/delta$/u,
  );
  if (issueMessagesDeltaMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessagesDeltaMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueMessagesDeltaMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    if (!rawCursor || !/^\d+$/u.test(rawCursor)) {
      throw new HttpError(400, "A non-negative conversation cursor is required");
    }
    const cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor)) {
      throw new HttpError(400, "Conversation cursor is outside the safe range");
    }
    const page = await listDashboardChanges(db, project.id, cursor);
    if (page.expired) {
      return json(
        {
          code: "issue_conversation_cursor_expired",
          message: "Conversation cursor expired; reload the full snapshot",
        },
        410,
      );
    }
    const changed = page.changes.some(
      (change) => change.entity_type === "notifications",
    );
    return json({
      cursor: page.nextCursor,
      hasMore: page.hasMore,
      changed,
      ...(changed
        ? await loadIssueConversationSnapshot(
            db,
            env.ARCHIVES,
            project.id,
            run.id,
          )
        : {}),
    });
  }
  if (issueMessagesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessagesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueMessagesMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    const cursor = await getDashboardSyncCursor(db, project.id);
    return json({
      cursor,
      ...(await loadIssueConversationSnapshot(
        db,
        env.ARCHIVES,
        project.id,
        run.id,
      )),
    });
  }
  if (issueMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessagesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueMessagesMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    const { input: rawInput, attachments, attachmentReferences } =
      await readIssueMessageRequest(request);
    const storedAttachments = prepareStoredAttachments(
      attachments,
      () => {
        const id = crypto.randomUUID();
        return {
          id,
          object_key: `issue-attachments/${project.id}/${issueMessagesMatch[2]}/${id}`,
        };
      },
    );
    const input = {
      ...rawInput,
      body: canonicalizeIssueAttachmentReferences(
        rawInput.body,
        attachmentReferences,
        storedAttachments.map((attachment) => attachment.id),
      ) ?? rawInput.body,
    };
    const agentProvider = input.agentConversationId
      ? input.agentConversationId.startsWith(`briar:claude:${project.id}:`)
        ? "claude"
        : input.agentConversationId.startsWith(`briar:grok:${project.id}:`)
          ? "grok"
          : input.agentConversationId.startsWith(`briar:${project.id}:`)
            ? "codex"
            : null
      : null;
    if (input.agentConversationId && !agentProvider) {
      throw new HttpError(
        400,
        "Agent conversation does not belong to this project",
      );
    }
    const explicitMentionedAgentIds = [...new Set(input.mentionedAgentIds ?? [])];
    const explicitlyMentionedAgents = new Map<
      string,
      NonNullable<Awaited<ReturnType<typeof getProjectAgent>>>
    >();
    if (!agentProvider) {
      for (const agentId of explicitMentionedAgentIds) {
        const agent = await getProjectAgent(db, project.id, agentId);
        if (!agent) {
          throw new HttpError(400, "Mentioned Agent is not in this project");
        }
        explicitlyMentionedAgents.set(agent.id, agent);
      }
    }
    const createdAt = new Date().toISOString();
    const uploadedKeys: string[] = [];
    let message: IssueMessageRow | null = null;
    try {
      await uploadStoredAttachments(
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          projectId: project.id,
        }),
      );
      await createIssueAttachments(
        db,
        project.id,
        issueMessagesMatch[2],
        storedAttachments.map(({ file: _file, ...attachment }) => attachment),
      );
      message = await createIssueMessage(db, {
        id: input.clientMessageId ?? crypto.randomUUID(),
        projectId: project.id,
        runId: issueMessagesMatch[2],
        parentMessageId: input.parentMessageId ?? null,
        authorUserId: agentProvider ? null : session.user.id,
        authorAgentProvider: agentProvider,
        body: input.body,
        mentionedUserIds: agentProvider ? [] : input.mentionedUserIds,
        createdAt,
      });
      if (!message) throw new HttpError(
        404,
        input.parentMessageId ? "Thread message not found" : "Run not found",
      );
    } catch (error) {
      await deleteIssueAttachments(
        db,
        project.id,
        issueMessagesMatch[2],
        storedAttachments.map((attachment) => attachment.id),
      ).catch(() => undefined);
      await deleteUnreferencedUploadedIssueObjects(
        db,
        attachmentsBucket,
        uploadedKeys,
      ).catch(() => undefined);
      throw error;
    }
    if (!message) {
      throw new HttpError(
        404,
        input.parentMessageId ? "Thread message not found" : "Run not found",
      );
    }
    const threadMessages = message.parent_message_id
      ? await listIssueThreadMessages(
          db,
          project.id,
          issueMessagesMatch[2],
          message.parent_message_id,
        )
      : [];
    const targetAgentIds = agentProvider
      ? []
      : issueReplyAgentIds(
          threadMessages.map((threadMessage) => ({
            id: threadMessage.id,
            parentMessageId: threadMessage.parent_message_id,
            body: threadMessage.body,
            author: {
              agentId: threadMessage.author_agent_id,
              provider: threadMessage.author_agent_provider,
            },
          })),
          {
            mentionedAgentIds: explicitMentionedAgentIds,
            parentMessageId: message.parent_message_id ?? null,
          },
        );
    const targetAgents = new Map(explicitlyMentionedAgents);
    for (const agentId of targetAgentIds) {
      if (targetAgents.has(agentId)) continue;
      const agent = await getProjectAgent(db, project.id, agentId);
      if (agent) targetAgents.set(agent.id, agent);
    }
    const agentReplies: IssueAgentReplyJobRow[] = [];
    if (targetAgents.size > 0) {
      const skillExecutionAvailable =
        await agentSkillExecutionApprovalTablesAvailable(db);
      for (const agent of targetAgents.values()) {
        const selectedSkillId = skillExecutionAvailable
          ? agentSkillForMessage(agent.skills, input.body)?.id ?? null
          : null;
        const agentReply = await enqueueIssueAgentReply(db, {
          id: crypto.randomUUID(),
          projectId: project.id,
          runId: issueMessagesMatch[2],
          triggerMessageId: message.id,
          parentMessageId: agentReplyParentMessageId({
            id: message.id,
            parentMessageId: message.parent_message_id,
          }),
          replyMessageId: crypto.randomUUID(),
          agentId: agent.id,
          skillId: selectedSkillId,
          // A live processing Worker is the only safe place to look for the
          // issue's uncommitted worktree. If the run has not been claimed yet,
          // keep the reply claimable and let the Worker answer from the
          // durable snapshot/repository context instead.
          requiresPreferredWorker: run.worker_id !== null,
          createdAt,
        });
        if (agentReply) agentReplies.push(agentReply);
      }
    }
    return json(
      {
        message: issueMessageJson(
          message,
          storedAttachments.map(({ file: _file, ...attachment }) => ({
            ...attachment,
            project_id: project.id,
            run_id: issueMessagesMatch[2],
            created_at: createdAt,
          })),
        ),
        agentReply: agentReplies.length === 1
          ? issueAgentReplyJson(agentReplies[0])
          : null,
        agentReplies: agentReplies.map(issueAgentReplyJson),
      },
      201,
    );
  }

  const issueMessageEditMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)$/u,
  );
  if (issueMessageEditMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessageEditMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeIssueMessageEditInput(await readJson(request));
    const message = await getIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      issueMessageEditMatch[3],
    );
    if (!message) throw new HttpError(404, "Message not found");
    if (message.author_user_id !== session.user.id) {
      throw new HttpError(403, "Only the author can edit this message");
    }
    const updated = await updateIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      message.id,
      {
        body: input.body,
        mentionedUserIds: input.mentionedUserIds,
        updatedAt: new Date().toISOString(),
      },
    );
    if (!updated) throw new HttpError(404, "Message not found");
    await removeOrphanedIssueAttachments(
      db,
      env.ARCHIVES,
      attachmentsBucket,
      project.id,
      issueMessageEditMatch[2],
    );
    const [
      attachments,
      reworkProposals,
      actionProposals,
      executionProposals,
      skillExecutionProposals,
    ] = await Promise.all([
      listIssueAttachments(db, project.id, issueMessageEditMatch[2]),
      listIssueReworkProposals(db, project.id, issueMessageEditMatch[2]),
      listIssueActionProposals(db, project.id, issueMessageEditMatch[2]),
      listIssueExecutionProposals(db, project.id, issueMessageEditMatch[2]),
      listIssueAgentSkillExecutionProposals(
        db,
        project.id,
        issueMessageEditMatch[2],
      ),
    ]);
    const proposal = [...reworkProposals, ...actionProposals].find(
      (candidate) => candidate.reply_message_id === updated.id,
    ) ?? null;
    const executionProposal = executionProposals.find(
      (candidate) => candidate.reply_message_id === updated.id,
    ) ?? null;
    return json({
      message: issueMessageJson(
        updated,
        attachments,
        proposal,
        executionProposal,
        skillExecutionProposals.find(
          (candidate) => candidate.reply_message_id === updated.id,
        ) ?? null,
      ),
    });
  }
  if (issueMessageEditMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessageEditMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const message = await getIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      issueMessageEditMatch[3],
    );
    if (!message) throw new HttpError(404, "Message not found");
    if (message.author_user_id !== session.user.id) {
      throw new HttpError(403, "Only the author can delete this message");
    }
    const deleted = await deleteIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      message.id,
    );
    if (!deleted) throw new HttpError(404, "Message not found");
    await removeOrphanedIssueAttachments(
      db,
      env.ARCHIVES,
      attachmentsBucket,
      project.id,
      issueMessageEditMatch[2],
    );
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const issueAgentReplyStatusMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/agent-reply$/u,
  );
  if (issueAgentReplyStatusMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueAgentReplyStatusMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const replyJobs = (await listIssueAgentReplyJobs(
      db,
      project.id,
      issueAgentReplyStatusMatch[2],
    )).filter(
      (candidate) =>
        candidate.trigger_message_id === issueAgentReplyStatusMatch[3],
    );
    const job = replyJobs[0] ?? await getIssueAgentReplyJob(
      db,
      project.id,
      issueAgentReplyStatusMatch[3],
    );
    if (!job || job.run_id !== issueAgentReplyStatusMatch[2]) {
      throw new HttpError(404, "Agent reply not found");
    }
    const [
      messages,
      reworkProposals,
      actionProposals,
      executionProposals,
      skillExecutionProposals,
    ] =
      replyJobs.some((candidate) => candidate.status === "completed")
        ? await Promise.all([
            listIssueMessagesWithArchive(
              db,
              env.ARCHIVES,
              project.id,
              job.run_id,
            ),
            listIssueReworkProposals(db, project.id, job.run_id),
            listIssueActionProposals(db, project.id, job.run_id),
            listIssueExecutionProposals(db, project.id, job.run_id),
            listIssueAgentSkillExecutionProposals(db, project.id, job.run_id),
          ])
        : [[], [], [], [], []];
    const reply = messages.find(
      (message) => message.id === job.reply_message_id,
    );
    const replyMessages = messages.filter((message) =>
      replyJobs.some((candidate) => candidate.reply_message_id === message.id),
    );
    const proposal = [...reworkProposals, ...actionProposals].find(
      (candidate) => candidate.reply_message_id === job.reply_message_id,
    ) ?? null;
    return json({
      agentReply: issueAgentReplyJson(job),
      agentReplies: replyJobs.map(issueAgentReplyJson),
      message: reply
        ? issueMessageJson(
            reply,
            [],
            proposal,
            executionProposals.find(
              (candidate) => candidate.reply_message_id === job.reply_message_id,
            ) ?? null,
            skillExecutionProposals.find(
              (candidate) => candidate.reply_message_id === job.reply_message_id,
            ) ?? null,
          )
        : null,
      messages: replyMessages.map((replyMessage) =>
        issueMessageJson(
          replyMessage,
          [],
          [...reworkProposals, ...actionProposals].find(
            (candidate) => candidate.reply_message_id === replyMessage.id,
          ) ?? null,
          executionProposals.find(
            (candidate) => candidate.reply_message_id === replyMessage.id,
          ) ?? null,
          skillExecutionProposals.find(
            (candidate) => candidate.reply_message_id === replyMessage.id,
          ) ?? null,
        ),
      ),
    });
  }

  const issueReworkProposalAcceptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/rework-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueReworkProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueReworkProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const proposal = await getIssueReworkProposal(
      db,
      project.id,
      issueReworkProposalAcceptMatch[2],
      issueReworkProposalAcceptMatch[3],
    );
    if (!proposal) throw new HttpError(404, "Rework proposal not found");
    if (proposal.status === "accepted") {
      return json({
        proposal: issueReworkProposalJson(proposal),
        outcome: "already_accepted",
        attempt: proposal.expected_attempt,
        revision: proposal.applied_revision,
        workflowStage: proposal.workflow_stage,
      });
    }
    const acceptedAt = new Date().toISOString();
    try {
      const rework = await reworkHuntRun(db, project.id, {
        runId: proposal.run_id,
        workflowStage: proposal.workflow_stage,
        requestId: proposal.id,
        actor: `briar-app:${session.user.id}`,
        reason: proposal.reason,
        occurredAt: acceptedAt,
        completed: {
          expectedAttempt: proposal.expected_attempt,
          expectedRevision: proposal.expected_revision,
        },
      });
      if (rework.outcome === "not_found" || rework.revision === null) {
        throw new HttpError(404, "Run not found");
      }
      const accepted = await acceptIssueReworkProposal(db, {
        projectId: project.id,
        runId: proposal.run_id,
        proposalId: proposal.id,
        userId: session.user.id,
        acceptedAt,
        appliedRevision: rework.revision,
      }) ?? await getIssueReworkProposal(
        db,
        project.id,
        proposal.run_id,
        proposal.id,
      );
      if (!accepted) throw new HttpError(409, "Rework proposal changed");
      return json({
        proposal: issueReworkProposalJson(accepted),
        outcome:
          rework.outcome === "already_reworked"
            ? "already_accepted"
            : "accepted",
        attempt: rework.attempt,
        revision: rework.revision,
        workflowStage: rework.workflowStage,
      });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message, "REWORK_PROPOSAL_CONFLICT");
      }
      throw error;
    }
  }

  const issueActionProposalAcceptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/issue-action-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueActionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueActionProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const proposal = await getIssueActionProposal(
      db,
      project.id,
      issueActionProposalAcceptMatch[2],
      issueActionProposalAcceptMatch[3],
    );
    if (!proposal) throw new HttpError(404, "Issue action proposal not found");
    if (proposal.status === "accepted") {
      const executionProposal = (await listIssueExecutionProposals(
        db,
        project.id,
        proposal.conversation_run_id,
      )).find(
        (candidate) => candidate.origin_create_proposal_id === proposal.id,
      ) ?? null;
      return json({
        proposal: issueActionProposalJson(proposal),
        executionProposal: executionProposal
          ? issueExecutionProposalJson(executionProposal)
          : null,
        outcome: "already_accepted",
        resultRunId: proposal.result_run_id,
      });
    }

    const acceptedAt = new Date().toISOString();
    const rawPayload = JSON.parse(proposal.payload_json);
    if (proposal.action_type === "request_issue_update") {
      const action = decodeIssueUpdateProposalAction({
        type: proposal.action_type,
        ...rawPayload,
      });
      const run = await getHuntRunForProject(
        db,
        project.id,
        proposal.conversation_run_id,
      );
      if (!run) throw new HttpError(404, "Run not found");
      const hasDescription = Object.prototype.hasOwnProperty.call(
        action.changes,
        "description",
      );
      const hasPriority = Object.prototype.hasOwnProperty.call(
        action.changes,
        "priority",
      );
      const accepted = await acceptIssueUpdateProposal(db, {
        projectId: project.id,
        conversationRunId: proposal.conversation_run_id,
        proposalId: proposal.id,
        userId: session.user.id,
        acceptedAt,
        title: action.changes.title ?? run.title,
        description: hasDescription
          ? action.changes.description ?? null
          : run.issue_description,
        priority: hasPriority
          ? action.changes.priority ?? null
          : run.priority,
      });
      if (!accepted) {
        throw new HttpError(
          409,
          "The issue changed after this proposal was created",
          "ISSUE_ACTION_PROPOSAL_CONFLICT",
        );
      }
      return json({
        proposal: issueActionProposalJson(accepted),
        outcome: "accepted",
        resultRunId: accepted.result_run_id,
      });
    }

    const action = decodeIssueCreateProposalAction({
      type: proposal.action_type,
      ...rawPayload,
    });
    const reservation = await reserveIssueCreateProposalApproval(db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id,
      proposalId: proposal.id,
      userId: session.user.id,
      reservedAt: acceptedAt,
      issueSourceKey: newConversationProposalIssueSourceKey(),
    });
    if (!reservation) {
      const latest = await getIssueActionProposal(
        db,
        project.id,
        proposal.conversation_run_id,
        proposal.id,
      );
      if (latest?.status === "accepted") {
        const executionProposal = (await listIssueExecutionProposals(
          db,
          project.id,
          latest.conversation_run_id,
        )).find(
          (candidate) => candidate.origin_create_proposal_id === latest.id,
        ) ?? null;
        return json({
          proposal: issueActionProposalJson(latest),
          executionProposal: executionProposal
            ? issueExecutionProposalJson(executionProposal)
            : null,
          outcome: "already_accepted",
          resultRunId: latest.result_run_id,
        });
      }
      throw new HttpError(
        409,
        "This issue proposal is being accepted by another member",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    if (!reservation.issue_source_key) {
      throw new HttpError(
        409,
        "This issue proposal has no approval identity",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    let created: Awaited<ReturnType<typeof createIssueWithAttachments>>;
    try {
      created = await createIssueWithAttachments({
        db,
        attachmentsBucket,
        project,
        issue: approvedIssueCreation(action.issue),
        attachments: [],
        sourceKey: reservation.issue_source_key,
        // Keep the event payload stable across retries. The accepting user is
        // recorded on the proposal row itself.
        actor: "briar-conversation",
        detail: "대화창에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
        context: {
          origin: "briar-conversation",
          proposalId: proposal.id,
          conversationRunId: proposal.conversation_run_id,
        },
        issueId: proposal.id,
        createdByUserId: reservation.approval_reserved_by_user_id,
        occurredAt: proposal.created_at,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(
          "conversation proposal no longer belongs to project",
        )
      ) {
        throw new HttpError(
          409,
          "The conversation moved before this proposal could be accepted",
          "ISSUE_ACTION_PROPOSAL_CONFLICT",
        );
      }
      throw error;
    }
    const finalized = await acceptIssueCreateProposal(db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id,
      proposalId: proposal.id,
      userId: session.user.id,
      acceptedAt,
      resultRunId: created.runId,
    });
    const accepted = finalized ?? await getIssueActionProposal(
      db,
      project.id,
      proposal.conversation_run_id,
      proposal.id,
    );
    if (
      !accepted || accepted.status !== "accepted" ||
      accepted.result_run_id !== created.runId
    ) {
      throw new HttpError(
        409,
        "The created issue is not eligible for this approval",
        "ISSUE_ACTION_PROPOSAL_CONFLICT",
      );
    }
    const executionProposal = (await listIssueExecutionProposals(
      db,
      project.id,
      accepted.conversation_run_id,
    )).find(
      (candidate) => candidate.origin_create_proposal_id === accepted.id,
    ) ?? null;
    return json({
      proposal: issueActionProposalJson(accepted),
      executionProposal: executionProposal
        ? issueExecutionProposalJson(executionProposal)
        : null,
      outcome:
        accepted.status === "accepted" && accepted.accepted_at !== acceptedAt
          ? "already_accepted"
          : "accepted",
      resultRunId: accepted.result_run_id,
    });
  }

  const issueSkillExecutionProposalAcceptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/skill-execution-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueSkillExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueSkillExecutionProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!(await agentSkillExecutionApprovalTablesAvailable(db))) {
      throw new HttpError(
        503,
        "Agent Skill execution approval is not available during this upgrade",
        "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const conversationRunId = issueSkillExecutionProposalAcceptMatch[2];
    const proposalId = issueSkillExecutionProposalAcceptMatch[3];
    const loadProposal = () => getIssueAgentSkillExecutionProposal(
      db,
      project.id,
      conversationRunId,
      proposalId,
    );
    const proposal = await loadProposal();
    if (!proposal) {
      throw new HttpError(404, "Agent Skill execution proposal not found");
    }
    const input = decodeAgentSkillExecutionProposalAcceptInput(
      await readJson(request),
    );
    return json(await approveAgentSkillExecutionProposal(db, env.ARCHIVES, proposal, {
      sourceKind: "issue",
      userId: session.user.id,
      workerId: input.workerId,
      staleCode: "ISSUE_SKILL_EXECUTION_PROPOSAL_STALE",
      conflictCode: "ISSUE_SKILL_EXECUTION_PROPOSAL_CONFLICT",
      reload: loadProposal,
    }));
  }

  const issueExecutionProposalAcceptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/issue-execution-proposals\/([0-9a-f-]+)\/accept$/u,
  );
  if (issueExecutionProposalAcceptMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueExecutionProposalAcceptMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!(await issueExecutionApprovalTablesAvailable(db))) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const proposal = await getIssueExecutionProposal(
      db,
      project.id,
      issueExecutionProposalAcceptMatch[2],
      issueExecutionProposalAcceptMatch[3],
    );
    if (!proposal) throw new HttpError(404, "Execution proposal not found");
    const input = decodeChannelExecutionProposalAcceptInput(
      await readJson(request),
    );
    decodeExecutionPreferences({
      provider: input.provider,
      model: input.model,
      effort: input.effort,
    });
    const run = await getHuntRunForProject(db, project.id, proposal.target_run_id);
    if (proposal.status === "accepted") {
      if (
        proposal.accepted_by_user_id !== session.user.id ||
        proposal.requested_provider !== input.provider ||
        proposal.requested_model !== input.model ||
        proposal.requested_effort !== input.effort ||
        proposal.requested_worker_id !== input.workerId
      ) {
        throw new HttpError(
          409,
          "Execution was approved with different settings or by another member",
          "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
        );
      }
      if (
        !run || !proposal.dispatch_request_id ||
        run.dispatch_request_id !== proposal.dispatch_request_id
      ) {
        throw new HttpError(
          409,
          "This execution approval is stale; request a new approval",
          "ISSUE_EXECUTION_PROPOSAL_STALE",
        );
      }
      return json({
        proposal: issueExecutionProposalJson(proposal),
        outcome: "already_accepted",
        projectId: proposal.project_id,
        runId: proposal.target_run_id,
        dispatch: {
          runId: proposal.target_run_id,
          agentId: proposal.proposed_by_agent_id,
          provider: proposal.requested_provider,
          model: proposal.requested_model,
          effort: proposal.requested_effort,
          requestedWorkerId: proposal.requested_worker_id,
          requestedByUserId: proposal.accepted_by_user_id,
          dispatchMode: proposal.requested_worker_id ? "specific" : "any",
          dispatchedAt: proposal.accepted_at,
          outcome: "already_dispatched",
        },
      });
    }
    if (proposal.status !== "pending") {
      throw new HttpError(
        409,
        "This execution proposal is no longer valid",
        "ISSUE_EXECUTION_PROPOSAL_STALE",
      );
    }
    const acceptedAt = new Date().toISOString();
    const reservation = await reserveIssueExecutionProposalApproval(db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id!,
      proposalId: proposal.id,
      userId: session.user.id,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      workerId: input.workerId,
      dispatchRequestId: crypto.randomUUID(),
      reservedAt: acceptedAt,
    });
    if (!reservation?.dispatch_request_id ||
        !reservation.approval_reserved_by_user_id ||
        !reservation.approval_reserved_at) {
      throw new HttpError(
        409,
        "The issue or execution approval changed before dispatch",
        "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
      );
    }
    try {
      const dispatched = await dispatchHuntRun(
        db,
        project.organization_id,
        project.id,
        {
          runId: reservation.target_run_id,
          agentId: reservation.proposed_by_agent_id,
          provider: reservation.requested_provider!,
          model: reservation.requested_model,
          effort: reservation.requested_effort,
          persistPreferences: false,
          workerId: reservation.requested_worker_id,
          requestedByUserId: reservation.approval_reserved_by_user_id,
          requestId: reservation.dispatch_request_id,
          occurredAt: reservation.approval_reserved_at,
        },
      );
      if (!dispatched) throw new HttpError(404, "Run not found");
      const accepted = await getIssueExecutionProposal(
        db,
        reservation.project_id,
        reservation.conversation_run_id!,
        reservation.id,
      );
      if (
        !accepted || accepted.status !== "accepted" ||
        accepted.dispatch_request_id !== reservation.dispatch_request_id
      ) {
        throw new HttpError(
          409,
          "Execution approval was not finalized",
          "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
        );
      }
      return json({
        proposal: issueExecutionProposalJson(accepted),
        outcome: "accepted",
        projectId: accepted.project_id,
        runId: accepted.target_run_id,
        dispatch: dispatched,
      });
    } catch (error) {
      if (error instanceof WorkerConflictError || (
        error instanceof Error && error.message.includes("execution proposal")
      )) {
        throw new HttpError(
          409,
          error.message,
          "ISSUE_EXECUTION_PROPOSAL_CONFLICT",
        );
      }
      throw error;
    }
  }

  const projectRunEvidenceMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/evidence$/u,
  );
  if (projectRunEvidenceMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectRunEvidenceMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const [hotEvidence, revisions, hotImages, archived] = await Promise.all([
      listRunEvidence(db, project.id, projectRunEvidenceMatch[2]),
      listRunStageRevisions(db, project.id, projectRunEvidenceMatch[2]),
      listRunEvidenceImages(db, project.id, projectRunEvidenceMatch[2]),
      listArchivedRunEvidence(
        db,
        env.ARCHIVES,
        project.id,
        projectRunEvidenceMatch[2],
      ),
    ]);
    if (!hotEvidence || !revisions || !hotImages) {
      throw new HttpError(404, "Run not found");
    }
    const evidence = [
      ...new Map(
        [...archived.evidence, ...hotEvidence].map((item) => [item.id, item]),
      ).values(),
    ].sort(
      (left, right) =>
        left.observed_at.localeCompare(right.observed_at) ||
        left.id.localeCompare(right.id),
    );
    const images = [
      ...new Map(
        [...archived.images, ...hotImages].map((item) => [item.id, item]),
      ).values(),
    ];
    const imagesByEvidence = new Map<string, RunEvidenceImageRow[]>();
    for (const image of images) {
      const evidenceImages = imagesByEvidence.get(image.evidence_id) ?? [];
      evidenceImages.push(image);
      imagesByEvidence.set(image.evidence_id, evidenceImages);
    }
    return json({
      runId: projectRunEvidenceMatch[2],
      attempt: revisions.attempt,
      revision: revisions.revision,
      evidence: evidence.map((item) =>
        runEvidenceJson(
          item,
          revisions.requirements.get(item.workflow_stage) ?? 1,
          imagesByEvidence.get(item.id) ?? [],
        ),
      ),
    });
  }

  const projectEvidenceImageMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/evidence\/images\/([0-9a-f-]+)$/u,
  );
  if (
    projectEvidenceImageMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    if (bearerToken(request).startsWith("briar_worker_")) {
      if (
        (await requireRunExecutionProject(
          db,
          request,
          projectEvidenceImageMatch[2],
        )) !== projectEvidenceImageMatch[1]
      ) {
        throw new HttpError(404, "Evidence image not found");
      }
    } else {
      await requireProjectAccess(
        auth,
        db,
        request,
        projectEvidenceImageMatch[1],
      );
    }
    const image = (await getRunEvidenceImage(
      db,
      projectEvidenceImageMatch[1],
      projectEvidenceImageMatch[2],
      projectEvidenceImageMatch[3],
    )) ?? (await getArchivedEvidenceImage(
      db,
      env.ARCHIVES,
      projectEvidenceImageMatch[1],
      projectEvidenceImageMatch[2],
      projectEvidenceImageMatch[3],
    ));
    if (!image) throw new HttpError(404, "Evidence image not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(image.object_key);
      if (!object) throw new HttpError(404, "Evidence image not found");
      return attachmentResponse(image, object, null);
    }
    const object = await attachmentsBucket.get(image.object_key);
    if (!object) throw new HttpError(404, "Evidence image not found");
    return attachmentResponse(image, object, object.body);
  }

  const issuesMatch = pathname.match(/^\/projects\/([0-9a-f-]+)\/issues$/u);
  if (issuesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issuesMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const { input, attachments, attachmentReferences } =
      await readIssueRequest(request);
    await requireIssueAssigneeMembership(
      db,
      project.organization_id,
      input.assigneeUserId,
    );
    const issueId = crypto.randomUUID();
    const sourceKey = `briar-issue:${issueId}`;
    const detail =
      input.status === "backlog"
        ? "Briar 앱에서 생성된 이슈가 백로그에 추가되었습니다."
        : "Briar 앱에서 생성된 이슈가 처리를 기다리고 있습니다.";
    const created = await createIssueWithAttachments({
      db,
      attachmentsBucket,
      project,
      issue: input,
      attachments,
      attachmentReferences,
      sourceKey,
      actor: "briar-app",
      detail,
      context: { origin: "briar-app" },
      issueId,
      createdByUserId: session.user.id,
    });
    return json(
      {
        runId: created.runId,
        sourceKey,
        stage: "queued",
        status: input.status,
        assigneeUserId: input.assigneeUserId ?? null,
        createdByUserId: session.user.id,
        attachments: created.attachments.map(attachmentJson),
      },
      201,
    );
  }

  const recoveryMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );

  const issueUpdateMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)$/u,
  );
  const issueSubscriptionMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/subscription$/u,
  );
  const issueDependencyMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/dependencies\/([0-9a-f-]+)$/u,
  );
  const issuePreferencesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/preferences$/u,
  );
  const issueCheckpointsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/checkpoints$/u,
  );
  const issueResultReviewsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/result-reviews$/u,
  );
  if (
    issueSubscriptionMatch &&
    (request.method === "PUT" || request.method === "DELETE")
  ) {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueSubscriptionMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueSubscriptionMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    if (request.method === "DELETE") {
      if (run.assignee_user_id === session.user.id) {
        throw new HttpError(
          409,
          "The issue assignee must remain subscribed",
          "ISSUE_ASSIGNEE_SUBSCRIPTION_REQUIRED",
        );
      }
      await unsubscribeIssue(db, project.id, run.id, session.user.id);
    } else {
      await subscribeIssue(
        db,
        project.id,
        run.id,
        session.user.id,
        new Date().toISOString(),
      );
    }
    const subscribers = await listIssueSubscriptions(db, project.id, run.id);
    return json({
      runId: run.id,
      subscribers: subscribers.map((subscriber) => ({
        userId: subscriber.user_id,
        subscribedAt: subscriber.created_at,
      })),
    });
  }
  if (issueDependencyMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueDependencyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const outcome = await createIssueDependency(db, project.id, {
      dependentRunId: issueDependencyMatch[2],
      prerequisiteRunId: issueDependencyMatch[3],
      createdByUserId: session.user.id,
      createdAt: new Date().toISOString(),
    });
    if (outcome === "not_found") {
      throw new HttpError(404, "Dependency issue not found");
    }
    if (outcome === "cycle") {
      throw new HttpError(409, "Dependency would create a cycle");
    }
    if (outcome === "ineligible") {
      throw new HttpError(
        409,
        "Dependencies cannot be added after an issue starts executing",
      );
    }
    return json(
      {
        prerequisiteRunId: issueDependencyMatch[3],
        dependentRunId: issueDependencyMatch[2],
        outcome,
      },
      outcome === "created" ? 201 : 200,
    );
  }
  if (issueDependencyMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueDependencyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    await deleteIssueDependency(
      db,
      project.id,
      issueDependencyMatch[3],
      issueDependencyMatch[2],
    );
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (issuePreferencesMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issuePreferencesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeExecutionPreferences(await readJson(request));
    const run = await updateIssueExecutionPreferences(
      db,
      project.id,
      issuePreferencesMatch[2],
      {
        ...input,
        updatedAt: new Date().toISOString(),
      },
    );
    if (!run) throw new HttpError(404, "Run not found");
    return json({
      runId: run.id,
      provider: run.preferred_agent_provider,
      model: run.preferred_agent_model,
      effort: run.preferred_agent_effort,
    });
  }
  if (issueCheckpointsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueCheckpointsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeIssueCheckpointsInput(await readJson(request));
    const outcome = await updateIssueCheckpoints(
      db,
      project.id,
      issueCheckpointsMatch[2],
      input.checkpoints,
      new Date().toISOString(),
    );
    if (outcome === "not_found") throw new HttpError(404, "Run not found");
    if (outcome === "ineligible") {
      throw new HttpError(
        409,
        "Checkpoints can only be changed before issue execution starts",
      );
    }
    return json({
      runId: issueCheckpointsMatch[2],
      checkpoints: input.checkpoints,
    });
  }
  if (issueResultReviewsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueResultReviewsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const review = await completeIssueResultReview(
      db,
      project.id,
      issueResultReviewsMatch[2],
      session.user.id,
      new Date().toISOString(),
    );
    if (!review) throw new HttpError(404, "Run not found");
    return json({
      userId: review.user_id,
      name: review.name,
      username: review.username,
      image: review.image,
      completedAt: review.completed_at,
    });
  }
  if (issueUpdateMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issueUpdateMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const { input, attachments, attachmentReferences, keptAttachmentIds } =
      await readIssueUpdateRequest(request);
    await requireIssueAssigneeMembership(
      db,
      project.organization_id,
      input.assigneeUserId,
    );
    const run = await updateIssueWithAttachments({
      db,
      attachmentsBucket,
      project,
      runId: issueUpdateMatch[2],
      issue: input,
      attachments,
      attachmentReferences,
      keptAttachmentIds,
      updatedAt: new Date().toISOString(),
    });
    return json({
      runId: run.id,
      title: run.title,
      description: run.issue_description,
      priority: run.priority,
      assigneeUserId: run.assignee_user_id,
      attachments: (await listIssueAttachments(
        db,
        project.id,
        issueUpdateMatch[2],
      )).map(attachmentJson),
    });
  }
  if (issueUpdateMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issueUpdateMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const observedAt = new Date().toISOString();
    const outcome = await deleteIssue(
      db,
      project.id,
      issueUpdateMatch[2],
      observedAt,
    );
    if (outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (outcome === "active") {
      throw new HttpError(409, "An active issue cannot be deleted");
    }
    return responseWithPostCommitCleanup(
      new Response(null, { status: 204, headers: corsHeaders }),
      {
        context,
        operation: "issue_delete",
        observedAt,
        tasks: [{
          queue: "archive",
          run: () => processArchiveCleanupQueue(
            db,
            env.ARCHIVES,
            attachmentsBucket,
            observedAt,
            1_000,
          ),
        }],
      },
    );
  }

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

  const workerRegistrationMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers\/register$/u,
  );
  if (workerRegistrationMatch && request.method === "POST") {
    const projectId = workerRegistrationMatch[1];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeWorkerRegister(await readJson(request));
    const observedAt = new Date().toISOString();
    const workerToken = `briar_worker_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const registration = await registerExecutionWorker(db, projectId, {
      id: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      organizationId: project.organization_id,
      ownerUserId: session.user.id,
      label: input.label,
      deviceIdentityHash: await sha256(input.deviceIdentity),
      credentialTokenHash: await sha256(workerToken),
      agentProvider: input.agentProvider,
      providers: input.providers,
      providerHealth: input.providerHealth,
      providerCapabilities: input.providerCapabilities,
      maxConcurrentSessions: input.maxConcurrentSessions,
      versions: input.versions,
      observedAt,
    });
    const response = json(
      {
        organizationId: project.organization_id,
        deviceId: registration.device.id,
        worker: workerJson(registration.worker, observedAt),
        workerToken,
      },
      201,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const workerBindingMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers\/bind$/u,
  );
  if (workerBindingMatch && request.method === "POST") {
    const projectId = workerBindingMatch[1];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = decodeWorkerBind(await readJson(request));
    const observedAt = new Date().toISOString();
    const binding = await bindExecutionWorkerProject(db, projectId, {
      id: crypto.randomUUID(),
      organizationId: project.organization_id,
      ownerUserId: session.user.id,
      deviceIdentityHash: await sha256(input.deviceIdentity),
      agentProvider: input.agentProvider,
      providers: input.providers,
      providerHealth: input.providerHealth,
      providerCapabilities: input.providerCapabilities,
      versions: input.versions,
      observedAt,
    });
    return json(
      {
        organizationId: project.organization_id,
        deviceId: binding.device.id,
        worker: workerJson(binding.worker, observedAt),
      },
      201,
    );
  }

  const workerDisableMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers\/([0-9a-zA-Z-]+)$/u,
  );
  if (workerDisableMatch && request.method === "PATCH") {
    const projectId = workerDisableMatch[1];
    const workerId = workerDisableMatch[2];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const device = await executionWorkerDeviceForBinding(db, workerId);
    if (!device || device.organization_id !== project.organization_id) {
      throw new HttpError(404, "Worker not found");
    }
    if (
      device.owner_user_id !== session.user.id &&
      project.member_role !== "owner" &&
      project.member_role !== "admin"
    ) {
      throw new HttpError(403, "Worker owner or organization admin access required");
    }
    const input = decodeWorkerConcurrency(await readJson(request));
    const observedAt = new Date().toISOString();
    const updated = await updateExecutionWorkerConcurrency(
      db,
      device.id,
      input.maxConcurrentSessions,
      observedAt,
    );
    if (!updated) throw new HttpError(409, "Worker is disabled");
    const binding = await executionWorkerBindingById(
      db,
      device.id,
      workerId,
    );
    if (!binding) throw new HttpError(404, "Worker not found");
    binding.active_sessions = await countExecutionWorkerDeviceSessions(
      db,
      device.id,
      observedAt,
    );
    return json(workerJson(binding, observedAt));
  }
  if (workerDisableMatch && request.method === "DELETE") {
    const projectId = workerDisableMatch[1];
    const workerId = workerDisableMatch[2];
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const device = await executionWorkerDeviceForBinding(db, workerId);
    if (!device || device.organization_id !== project.organization_id) {
      throw new HttpError(404, "Worker not found");
    }
    if (
      device.owner_user_id !== session.user.id &&
      project.member_role !== "owner" &&
      project.member_role !== "admin"
    ) {
      throw new HttpError(403, "Worker owner or organization admin access required");
    }
    await unbindExecutionWorker(
      db,
      device.id,
      projectId,
      new Date().toISOString(),
    );
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const workerUpdatePrepareMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/update-handoff\/prepare$/u,
  );
  if (workerUpdatePrepareMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerUpdatePrepareMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerUpdatePrepare(await readJson(request));
    const observedAt = new Date().toISOString();
    const updateRequest = await requestExecutionWorkerUpdate(db, {
      id: crypto.randomUUID(),
      organizationId: principal.organizationId,
      deviceId: principal.deviceId,
      requestedByUserId: principal.ownerUserId,
      targetVersion: input.targetVersion,
      requestedAt: observedAt,
    });
    const status = await executionWorkerUpdateStatus(db, {
      deviceId: principal.deviceId,
      requestId: updateRequest.id,
      observedAt,
    });
    return json({
      requestId: updateRequest.id,
      targetVersion: updateRequest.targetVersion,
      handoffState: status?.request.handoffState ?? updateRequest.handoffState,
      activeWorkCount: status?.activeWorkCount ?? 0,
      ready: status?.ready ?? false,
    }, 202);
  }

  const workerUpdateStatusMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/update-handoff\/status$/u,
  );
  if (workerUpdateStatusMatch && request.method === "GET") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerUpdateStatusMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const requestId = new URL(request.url).searchParams.get("requestId") ?? undefined;
    if (requestId) decodeWorkerUpdateRequestId(requestId);
    const status = await executionWorkerUpdateStatus(db, {
      deviceId: principal.deviceId,
      requestId,
      observedAt: new Date().toISOString(),
    });
    if (!status) return json({ request: null, activeWorkCount: 0, ready: true });
    return json({
      requestId: status.request.id,
      targetVersion: status.request.targetVersion,
      status: status.request.status,
      handoffState: status.request.handoffState,
      handoffError: status.request.handoffError,
      activeWorkCount: status.activeWorkCount,
      ready: status.ready,
    });
  }

  const workerUpdateClaimMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/update-handoff\/claim$/u,
  );
  if (workerUpdateClaimMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerUpdateClaimMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerUpdateHandoff(await readJson(request));
    if (input.projectId !== binding.project_id) {
      throw new HttpError(403, "Worker handoff project does not match its binding");
    }
    const observedAt = new Date().toISOString();
    const claimTokenHash = await sha256(input.claimToken);
    let outcome;
    try {
      outcome = await handoffExecutionWorkerClaim(db, {
        requestId: input.requestId,
        organizationId: principal.organizationId,
        deviceId: principal.deviceId,
        projectId: input.projectId,
        workerId: binding.id,
        workType: input.workType,
        workId: input.workId,
        runId: input.runId ?? null,
        claimTokenHash,
        metadata: input.checkpoint,
        observedAt,
      });
    } catch (error) {
      try {
        await failExecutionWorkerUpdateHandoff(db, {
          requestId: input.requestId,
          organizationId: principal.organizationId,
          deviceId: principal.deviceId,
          projectId: input.projectId,
          workerId: binding.id,
          workType: input.workType,
          workId: input.workId,
          runId: input.runId ?? null,
          claimTokenHash,
          metadata: input.checkpoint,
          error: error instanceof Error ? error.message : String(error),
          observedAt,
        });
      } catch (failureError) {
        console.error(
          `worker update handoff failure could not be recorded: ${
            failureError instanceof Error ? failureError.message : String(failureError)
          }`,
        );
      }
      throw error;
    }
    if (outcome.outcome === "not_ready") {
      throw new HttpError(409, "Worker update handoff is not draining");
    }
    if (outcome.outcome === "not_active") {
      throw new HttpError(409, "Worker claim is no longer active");
    }
    const status = await executionWorkerUpdateStatus(db, {
      deviceId: principal.deviceId,
      requestId: input.requestId,
      observedAt: new Date().toISOString(),
    });
    return json({
      outcome: outcome.outcome,
      requestId: input.requestId,
      handoffState: status?.request.handoffState ?? "draining",
      activeWorkCount: outcome.activeWorkCount,
      ready: status?.ready ?? false,
    });
  }

  const workerHeartbeatMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/heartbeat$/u,
  );
  if (workerHeartbeatMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerHeartbeatMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerHeartbeat(await readJson(request));
    const observedAt = new Date().toISOString();
    const pendingBeforeHeartbeat = await pendingExecutionWorkerUpdate(
      db,
      principal.deviceId,
    );
    const updateIsDraining = pendingBeforeHeartbeat?.handoffState === "draining";
    const worker = await recordWorkerHeartbeat(db, binding.project_id, {
      workerId: workerHeartbeatMatch[1],
      versions: input.versions,
      acceptingWork: updateIsDraining ? false : input.acceptingWork,
      readinessState: updateIsDraining ? "busy" : input.readinessState,
      readinessDetail: updateIsDraining
        ? "계획된 업데이트 handoff를 진행 중입니다."
        : input.readinessDetail,
      capabilities: input.capabilities,
      observedAt,
    });
    await completeExecutionWorkerUpdates(
      db,
      principal.deviceId,
      input.versions?.briar,
      observedAt,
    );
    const updateDirective = await pendingExecutionWorkerUpdate(
      db,
      principal.deviceId,
    );
    if (hasExecutionWorkerReadinessChanged(binding, worker)) {
      await auditExecutionEvent(db, {
        organizationId: principal.organizationId,
        projectId: binding.project_id,
        workerId: binding.id,
        actorDeviceId: principal.deviceId,
        action: "worker_readiness_changed",
        detail: {
          acceptingWork: worker.accepting_work === 1,
          readinessState: worker.readiness_state,
          readinessDetail: worker.readiness_detail,
        },
        occurredAt: observedAt,
      });
    }
    // A heartbeat is the cheapest regular touchpoint, so let it also recover
    // runs whose holder stopped reporting.
    const reaped = await reapStalledHuntRuns(db, binding.project_id, observedAt);
    // Share the project workflow tool list so each worker can probe readiness
    // against the same requirements, even when its local config is stale.
    const projectSettings = await getProjectSettings(db, binding.project_id);
    const projectWorkflow = projectSettings?.workflow_json
      ? normalizeAutoHuntWorkflow(JSON.parse(projectSettings.workflow_json))
      : null;
    return json({
      worker: workerJson(worker, observedAt),
      reaped,
      workflowRequirements: projectWorkflow?.requirements ?? [],
      updateDirective,
    });
  }

  const workerLabelMatch = pathname.match(
    /^\/workers\/([0-9a-zA-Z-]+)\/label$/u,
  );
  if (workerLabelMatch && request.method === "PATCH") {
    const principal = await requireWorkerCredential(db, request);
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      workerLabelMatch[1],
    );
    if (!binding || binding.state === "disabled") {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    const input = decodeWorkerLabel(await readJson(request));
    const device = await updateExecutionWorkerLabel(
      db,
      principal.deviceId,
      input.label,
      new Date().toISOString(),
    );
    if (!device) throw new HttpError(409, "Worker is disabled");
    return json({ deviceId: device.id, label: device.label });
  }

  const leaseMatch = pathname.match(/^\/runs\/([0-9a-f-]+)\/lease$/u);
  if (leaseMatch && request.method === "POST") {
    const input = decodeLeaseRenew(await readJson(request));
    let workerId: string | undefined;
    const projectId = bearerToken(request).startsWith("briar_worker_")
      ? (() => {
          if (!input.projectId) {
            throw new HttpError(400, "projectId is required for worker lease renewal");
          }
          return input.projectId;
        })()
      : await requireAgentProject(db, request);
    if (bearerToken(request).startsWith("briar_worker_")) {
      const worker = await requireWorkerProjectBinding(
        db,
        request,
        projectId,
      );
      workerId = worker.binding.id;
    }
    const observedAt = new Date().toISOString();
    let renewed;
    try {
      renewed = await renewHuntRunLease(db, projectId, {
        runId: leaseMatch[1],
        claimTokenHash: await sha256(input.claimToken),
        observedAt,
        workerId,
      });
    } catch (error) {
      if (workerId && error instanceof WorkerConflictError) {
        const project = await db
          .prepare(`select organization_id from briar_projects where id = ?`)
          .bind(projectId)
          .first<{ organization_id: string }>();
        if (project) {
          await auditExecutionEvent(db, {
            organizationId: project.organization_id,
            projectId,
            runId: leaseMatch[1],
            workerId,
            action: "lease_lost",
            detail: { reason: error.message },
            occurredAt: observedAt,
          });
        }
      }
      throw error;
    }
    return json({
      runId: renewed.id,
      leaseExpiresAt: renewed.lease_expires_at,
    });
  }

  if (pathname === "/transcripts" && request.method === "POST") {
    const input = await readTranscriptRequest(request);
    const recordedAt = new Date().toISOString();
    // Direct Project Agent tasks use their task UUID as the transcript session
    // key, but that UUID is not a Hunt run. Older Workers included it in the
    // compatibility runId field, so normalize it before run authorization and
    // persistence instead of rejecting otherwise valid task transcripts.
    const transcriptRunId = input.workType === "projectAgentTask"
      ? null
      : input.runId ?? null;
    let authenticatedWorkerId: string | null = null;
    let authenticatedWorkerDeviceId: string | null = null;
    let authenticatedWorkerOrganizationId: string | null = null;
    let authenticatedExecutionAttempt: RunExecutionAttemptRow | null = null;
    const projectId = bearerToken(request).startsWith("briar_worker_")
      ? (() => {
          if (!input.projectId) {
            throw new HttpError(400, "projectId is required for worker transcripts");
          }
          return input.projectId;
        })()
      : await requireAgentProject(db, request);
    if (bearerToken(request).startsWith("briar_worker_")) {
      const worker = await requireWorkerProjectBinding(
        db,
        request,
        projectId,
        input.workerId ?? undefined,
      );
      authenticatedWorkerId = worker.binding.id;
      authenticatedWorkerDeviceId = worker.principal.deviceId;
      authenticatedWorkerOrganizationId = worker.principal.organizationId;
      if (input.executionId) {
        authenticatedExecutionAttempt = await getRunExecutionAttempt(
          db,
          input.executionId,
        );
        if (
          !authenticatedExecutionAttempt ||
          authenticatedExecutionAttempt.project_id !== projectId ||
          authenticatedExecutionAttempt.worker_id !== authenticatedWorkerId ||
          authenticatedExecutionAttempt.run_id !== input.runId
        ) {
          throw new HttpError(403, "Execution attempt is not assigned to this worker");
        }
        if (
          input.runAttempt !== undefined &&
          input.runAttempt !== authenticatedExecutionAttempt.run_attempt
        ) {
          throw new HttpError(409, "Execution attempt does not match runAttempt");
        }
      } else if (
        transcriptRunId &&
        (await requireRunExecutionProject(db, request, transcriptRunId)) !==
          projectId
      ) {
        throw new HttpError(403, "Run is not assigned to this worker");
      }
    }
    if (input.executionId && !authenticatedExecutionAttempt) {
      throw new HttpError(403, "Only execution workers can report an execution");
    }
    const hasWorkerClaimIdentity = Boolean(
      input.claimToken || input.workType || input.workId,
    );
    if (authenticatedWorkerDeviceId && !hasWorkerClaimIdentity) {
      const pendingUpdate = await pendingExecutionWorkerUpdate(
        db,
        authenticatedWorkerDeviceId,
      );
      if (pendingUpdate && pendingUpdate.handoffState !== "idle") {
        throw new HttpError(
          409,
          "Worker transcript claim identity is required during a planned update",
        );
      }
    }
    if (input.claimToken || input.workType || input.workId) {
      if (
        !authenticatedWorkerId ||
        !authenticatedWorkerDeviceId ||
        !input.claimToken ||
        !input.workType ||
        !input.workId
      ) {
        throw new HttpError(400, "Worker transcript claim identity is incomplete");
      }
      const claimTokenHash = await sha256(input.claimToken);
      const active = input.workType === "issue"
        ? await db
            .prepare(
              `select 1 as active
               from briar_hunt_runs
               where id = ? and project_id = ? and worker_id = ?
                 and claim_token_hash = ? and lease_expires_at > ?
                 and status not in
                   ('backlog', 'completed', 'cancelled', 'blocked', 'failed')`,
            )
            .bind(
              input.workId,
              projectId,
              authenticatedWorkerId,
              claimTokenHash,
              recordedAt,
            )
            .first<{ active: number }>()
        : input.workType === "projectAgentTask"
          ? await db
              .prepare(
                `select 1 as active
                 from briar_project_agent_task_jobs
                 where id = ? and project_id = ? and status = 'running'
                   and claimed_worker_id = ? and claim_token_hash = ?
                   and lease_expires_at > ?`,
              )
              .bind(
                input.workId,
                projectId,
                authenticatedWorkerId,
                claimTokenHash,
                recordedAt,
              )
              .first<{ active: number }>()
          : input.workType === "issueReply"
            ? await db
                .prepare(
                  `select 1 as active
                   from briar_issue_agent_reply_jobs
                   where id = ? and project_id = ? and status = 'running'
                     and claimed_worker_id = ? and claim_token_hash = ?
                     and lease_expires_at > ?`,
                )
                .bind(
                  input.workId,
                  projectId,
                  authenticatedWorkerId,
                  claimTokenHash,
                  recordedAt,
                )
                .first<{ active: number }>()
            : await db
                .prepare(
                  `select 1 as active
                   from briar_channel_agent_reply_jobs
                   where id = ? and organization_id = ? and status = 'running'
                     and claimed_device_id = ? and claimed_worker_id = ?
                     and claim_token_hash = ? and lease_expires_at > ?`,
                )
                .bind(
                  input.workId,
                  authenticatedWorkerOrganizationId,
                  authenticatedWorkerDeviceId,
                  authenticatedWorkerId,
                  claimTokenHash,
                  recordedAt,
                )
                .first<{ active: number }>();
      if (!active) {
        throw new HttpError(409, "Worker claim is no longer active");
      }
    }
    if (
      input.executionMetrics &&
      (!authenticatedWorkerId || !input.runId || !input.runAttempt)
    ) {
      throw new HttpError(403, "Only execution workers can report run metrics");
    }
    if (authenticatedExecutionAttempt) {
      const clockSkewMs = 5 * 60_000;
      const earliestObservedAt =
        Date.parse(authenticatedExecutionAttempt.claimed_at) - clockSkewMs;
      const latestObservedAt = Date.parse(recordedAt) + clockSkewMs;
      if (
        input.usageRecords?.some((record) => {
          const observedAt = Date.parse(record.observedAt);
          return observedAt < earliestObservedAt || observedAt > latestObservedAt;
        })
      ) {
        throw new HttpError(
          400,
          "Usage observedAt is outside the execution attempt window",
        );
      }
      if (
        input.costRecords?.some((record) => {
          const observedAt = Date.parse(record.observedAt);
          return observedAt < earliestObservedAt || observedAt > latestObservedAt;
        })
      ) {
        throw new HttpError(
          400,
          "Cost observedAt is outside the execution attempt window",
        );
      }
    }
    const usageStored = input.usageRecords
      ? await recordRunUsageRecords(db, {
          executionId: input.executionId!,
          records: input.usageRecords,
          recordedAt,
        })
      : 0;
    const costStored = input.costRecords
      ? await recordRunCostRecords(db, {
          executionId: input.executionId!,
          records: input.costRecords,
          recordedAt,
        })
      : 0;
    const result = await ingestAgentTranscript(db, env.ARCHIVES, projectId, {
      sessionId: input.sessionId,
      runId: transcriptRunId,
      workerId: authenticatedWorkerId ?? input.workerId ?? null,
      agentProvider: input.agentProvider,
      events: input.events,
      observedAt: recordedAt,
    });
    if (input.executionMetrics) {
      await updateHuntRunExecutionMetrics(db, projectId, {
        runId: input.runId!,
        attempt: input.runAttempt!,
        workerId: authenticatedWorkerId!,
        executionId: input.executionId,
        metrics: input.executionMetrics,
      });
    }
    return json({ ...result, usageStored, costStored }, 202);
  }

  const projectWorkersMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers$/u,
  );
  const projectAgentCapabilitiesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-capabilities$/u,
  );
  if (projectAgentCapabilitiesMatch && request.method === "GET") {
    const projectId = projectAgentCapabilitiesMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const observedAt = new Date().toISOString();
    const workers = await listExecutionWorkers(db, projectId, observedAt);
    const catalogs = workers.flatMap((worker) => {
      if (worker.state !== "online") return [];
      const capabilities = parseJsonObject(worker.capabilities_json) as
        | Record<string, unknown>
        | null;
      const raw = capabilities?.providerCapabilities;
      const parsed = decodeAgentProviderCapabilityCatalogOption(raw);
      return Option.isSome(parsed) ? [parsed.value] : [];
    });
    return json({
      capabilities: mergeAgentProviderCapabilityCatalogs(catalogs),
      workerCount: catalogs.length,
      observedAt,
    });
  }
  if (projectWorkersMatch && request.method === "GET") {
    const projectId = projectWorkersMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const observedAt = new Date().toISOString();
    // Reading the dashboard is the other regular touchpoint, so recover
    // abandoned runs here too rather than waiting for the next claim.
    const reaped = await reapStalledHuntRuns(db, projectId, observedAt);
    const workers = await listExecutionWorkers(db, projectId, observedAt);
    return json({
      workers: workers.map((worker) => workerJson(worker, observedAt)),
      leasedRuns: await countLeasedRuns(db, projectId, observedAt),
      reaped,
    });
  }

  const transcriptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/sessions\/([A-Za-z0-9_-]+)\/transcript$/u,
  );
  if (transcriptMatch && request.method === "GET") {
    const projectId = transcriptMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const requestedSessionId = transcriptMatch[2];
    const detachedRunId = requestedSessionId.startsWith("detached-")
      ? decodeUuidOption(requestedSessionId.slice("detached-".length))
      : Option.none<string>();
    const hotWorkLog = Option.isSome(detachedRunId)
      ? await readLatestAgentWorkLogForRun(db, projectId, detachedRunId.value)
      : await readAgentWorkLog(db, projectId, requestedSessionId);
    const workLog = hotWorkLog && hotWorkLog.entries.length > 0
      ? hotWorkLog
      : Option.isSome(detachedRunId)
        ? await readLatestArchivedWorkLogForRun(
            db,
            env.ARCHIVES,
            projectId,
            detachedRunId.value,
          )
        : await readArchivedWorkLog(
            db,
            env.ARCHIVES,
            projectId,
            requestedSessionId,
          );
    if (!workLog || workLog.entries.length === 0) {
      throw new HttpError(404, "Transcript not found");
    }
    return json({
      session: {
        sessionId: workLog.session.session_id,
        runId: workLog.session.run_id,
        workerId: workLog.session.worker_id,
        agentProvider: workLog.session.agent_provider,
        startedAt: workLog.session.started_at,
        lastEventAt: workLog.session.last_event_at,
        eventCount: workLog.entries.length,
        projection: "worklog",
      },
      // Work-log entries are a bounded snapshot. Returning the full set on
      // each live poll lets an upsert replace a writing entry in-place.
      events: workLog.entries.map((entry) => ({
        sequence: entry.sequence,
        direction: "server" as const,
        message: {
          type: "event",
          event: workLogEntryTranscriptEvent(entry),
        },
        recordedAt: entry.updated_at,
      })),
    });
  }

  const rawTranscriptSegmentMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/sessions\/([A-Za-z0-9_-]+)\/raw-transcript\/(\d+)-(\d+)$/u,
  );
  const rawTranscriptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/sessions\/([A-Za-z0-9_-]+)\/raw-transcript$/u,
  );
  if (
    rawTranscriptSegmentMatch && request.method === "GET"
  ) {
    const projectId = rawTranscriptSegmentMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const requestedSessionId = rawTranscriptSegmentMatch[2];
    const detachedRunId = requestedSessionId.startsWith("detached-")
      ? decodeUuidOption(requestedSessionId.slice("detached-".length))
      : Option.none<string>();
    const hotWorkLog = Option.isSome(detachedRunId)
      ? await readLatestAgentWorkLogForRun(db, projectId, detachedRunId.value)
      : await readAgentWorkLog(db, projectId, requestedSessionId);
    const workLog = hotWorkLog ?? (Option.isSome(detachedRunId)
      ? await readLatestArchivedWorkLogForRun(
          db,
          env.ARCHIVES,
          projectId,
          detachedRunId.value,
        )
      : await readArchivedWorkLog(
          db,
          env.ARCHIVES,
          projectId,
          requestedSessionId,
        ));
    if (!workLog) throw new HttpError(404, "Transcript not found");
    const segments = "segments" in workLog
      ? workLog.segments as AgentTranscriptSegmentRow[]
      : await listAgentTranscriptSegments(
          db,
          projectId,
          workLog.session.session_id,
        );
    const firstSequence = Number(rawTranscriptSegmentMatch[3]);
    const lastSequence = Number(rawTranscriptSegmentMatch[4]);
    const segment = segments?.find((candidate) =>
      candidate.first_sequence === firstSequence &&
      candidate.last_sequence === lastSequence
    );
    if (!segment) throw new HttpError(404, "Transcript segment not found");
    const object = await readRawTranscriptSegment(env.ARCHIVES, segment);
    if (!object) throw new HttpError(404, "Transcript segment not found");
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": contentDisposition(object.filename).replace(
          /^inline;/u,
          "attachment;",
        ),
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (rawTranscriptMatch && request.method === "GET") {
    const projectId = rawTranscriptMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const requestedSessionId = rawTranscriptMatch[2];
    const detachedRunId = requestedSessionId.startsWith("detached-")
      ? decodeUuidOption(requestedSessionId.slice("detached-".length))
      : Option.none<string>();
    const hotWorkLog = Option.isSome(detachedRunId)
      ? await readLatestAgentWorkLogForRun(db, projectId, detachedRunId.value)
      : await readAgentWorkLog(db, projectId, requestedSessionId);
    const workLog = hotWorkLog ?? (Option.isSome(detachedRunId)
      ? await readLatestArchivedWorkLogForRun(
          db,
          env.ARCHIVES,
          projectId,
          detachedRunId.value,
        )
      : await readArchivedWorkLog(
          db,
          env.ARCHIVES,
          projectId,
          requestedSessionId,
        ));
    if (!workLog) throw new HttpError(404, "Transcript not found");
    const segments = "segments" in workLog
      ? workLog.segments as AgentTranscriptSegmentRow[]
      : await listAgentTranscriptSegments(
          db,
          projectId,
          workLog.session.session_id,
        );
    if (!segments || segments.length === 0) {
      throw new HttpError(404, "Transcript not found");
    }
    return json({
      sessionId: workLog.session.session_id,
      runId: workLog.session.run_id,
      agentProvider: workLog.session.agent_provider,
      eventCount: segments.reduce(
        (total, segment) => total + segment.event_count,
        0,
      ),
      uncompressedBytes: segments.reduce(
        (total, segment) => total + segment.uncompressed_bytes,
        0,
      ),
      compressedBytes: segments.reduce(
        (total, segment) => total + segment.compressed_bytes,
        0,
      ),
      segments: segments.map((segment) => ({
        firstSequence: segment.first_sequence,
        lastSequence: segment.last_sequence,
        eventCount: segment.event_count,
        uncompressedBytes: segment.uncompressed_bytes,
        compressedBytes: segment.compressed_bytes,
        sha256: segment.sha256,
        recordedAt: segment.recorded_at,
        url:
          `/projects/${projectId}/sessions/${requestedSessionId}/raw-transcript/` +
          `${segment.first_sequence}-${segment.last_sequence}`,
      })),
    });
  }

  if (pathname === "/merge-batch-claims" && request.method === "POST") {
    const input = decodeMergeBatchClaimInput(await readJson(request));
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
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
      throw new HttpError(409, "Worker is not ready to claim a merge batch");
    }
    const claimToken =
      `briar_merge_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const claim = await claimNextMergeBatch(db, input.projectId, {
      workerId: authenticatedWorker.binding.id,
      deviceId: authenticatedWorker.principal.deviceId,
      claimedBy: input.claimedBy,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
    });
    return json({
      work: claim ? mergeBatchWorkJson(claim, claimToken) : null,
      ...(!claim ? { retryAfterMs: 15_000 } : {}),
    });
  }

  const mergeBatchClaimMatch = pathname.match(
    /^\/merge-batch-claims\/([0-9a-f-]+)\/(lease|release|enqueued|authority|validation|published|block)$/u,
  );
  if (mergeBatchClaimMatch && request.method === "POST") {
    const batchId = mergeBatchClaimMatch[1];
    const action = mergeBatchClaimMatch[2];
    const rawInput = await readJson(request);
    const observedAt = new Date().toISOString();
    if (action === "lease" || action === "release") {
      const input = decodeMergeBatchLeaseInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const common = {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        authenticatedAt: observedAt,
      };
      if (action === "lease") {
        const leaseExpiresAt = await renewMergeBatchLease(db, {
          ...common,
          leaseExpiresAt: leaseExpiryFrom(observedAt),
        });
        if (!leaseExpiresAt) {
          throw new HttpError(409, "Merge batch claim is no longer active");
        }
        return json({ batchId, leaseExpiresAt });
      }
      if (!(await releaseMergeBatchLease(db, common))) {
        throw new HttpError(409, "Merge batch claim is no longer active");
      }
      return json({ batchId, released: true });
    }
    if (action === "enqueued") {
      const input = decodeMergeBatchEnqueueInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const result = await recordMergeBatchCandidateEnqueued(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        candidateId: input.candidateId,
        expectedHeadSha: input.expectedHeadSha,
        expectedBaseSha: input.expectedBaseSha,
        queueEntryId: input.queueEntryId,
        observedAt,
      });
      if (!result) {
        throw new HttpError(409, "Merge batch candidate identity changed");
      }
      return json({
        batchId,
        candidateId: result.candidate.id,
        state: result.batch.state,
      });
    }
    if (action === "authority") {
      const input = decodeMergeBatchAuthorityInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const result = await selectAuthoritativeMergeGroupHead(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        deliveryId: input.deliveryId,
        authorityEntries: input.authorityEntries,
        observedAt,
      });
      if (!result) {
        throw new HttpError(409, "Signed merge-group head is not the exact cohort tail");
      }
      return json({
        batchId,
        state: result.batch.state,
        mergeGroupSha: result.batch.merge_group_sha,
      });
    }
    if (action === "validation") {
      const input = decodeMergeBatchValidationInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const batch = await recordMergeBatchValidationProof(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        mergeGroupSha: input.mergeGroupSha,
        validationResults: input.validationResults,
        validatedAt: observedAt,
      });
      if (!batch) {
        throw new HttpError(409, "Merge batch validation proof was rejected");
      }
      return json({ batchId, state: batch.state, validatedAt: batch.validated_at });
    }
    if (action === "published") {
      const input = decodeMergeBatchPublicationInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const batch = await completeMergeBatchPublication(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        mergeGroupSha: input.mergeGroupSha,
        publishedAt: observedAt,
      });
      if (!batch) {
        throw new HttpError(409, "Merge batch publication claim is no longer active");
      }
      return json({ batchId, state: batch.state, publishedAt: batch.published_at });
    }
    const input = decodeMergeBatchBlockInput(rawInput);
    await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const batch = await blockMergeBatch(db, {
      batchId,
      projectId: input.projectId,
      workerId: input.workerId,
      claimTokenHash: await sha256(input.claimToken),
      code: input.code,
      detail: input.detail,
      observedAt,
    });
    if (!batch) {
      throw new HttpError(409, "Merge batch claim is no longer active");
    }
    return json({ batchId, state: batch.state });
  }

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

  if (pathname === "/channel-reply-claims" && request.method === "POST") {
    const input = decodeChannelReplyClaimInput(await readJson(request));
    const principal = workerClaimContext?.principal ??
      await requireWorkerOrganization(db, request, input.organizationId);
    if (principal.organizationId !== input.organizationId) {
      throw new HttpError(403, "Worker is not enabled for this organization");
    }
    // Readiness and provider health still come from a project binding, which
    // every registered device has. Eligibility per job is enforced in the claim.
    const binding = workerClaimContext?.binding ??
      await executionWorkerBindingById(db, principal.deviceId, input.workerId);
    if (
      !binding ||
      binding.id !== input.workerId ||
      binding.state === "disabled"
    ) {
      throw new HttpError(403, "Worker is not enabled for this organization");
    }
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(
        binding.last_heartbeat_at,
        observedAt,
        binding.state,
      ) !== "online" ||
      binding.accepting_work !== 1 ||
      // `busy` represents occupied regular execution slots. Reply work does
      // not consume those slots, so only an unhealthy readiness state blocks.
      binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim replies");
    }
    const providers = executionWorkerProviders(binding);
    if (providers.length === 0) {
      throw new HttpError(409, "Worker has no available reply provider");
    }
    const claimToken = `briar_channel_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const claimTokenHash = await sha256(claimToken);
    const job = await claimNextChannelAgentReply(db, input.organizationId, {
      deviceId: principal.deviceId,
      workerId: binding.id,
      providers,
      workerAgentProvider: binding.agent_provider,
      workerCapabilitiesJson: binding.capabilities_json,
      supportsOrganizationAgentContext:
        executionWorkerSupportsOrganizationAgentContext(binding),
      claimTokenHash,
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
    });
    if (!job) return json({ work: null });
    scheduleChannelRealtimePublish(env, db, input.organizationId, context);
    try {
      if (job.claimed_worker_id !== binding.id) {
        throw new HttpError(409, "Reply claim is bound to another Worker");
      }
      const [channel, liveAgent, messages] = await Promise.all([
        getChannelById(db, job.organization_id, job.channel_id),
        getOrganizationAgent(db, job.organization_id, job.agent_id),
        listChannelThreadMessages(db, job.channel_id, job.parent_message_id),
      ]);
      if (!channel || !liveAgent || !job.agent_provider) {
        throw new HttpError(409, "Reply job lost its channel context");
      }
      if (job.project_id !== liveAgent.project_id) {
        throw new HttpError(409, "Reply job no longer matches its Agent scope");
      }
      const triggerMessage = messages.find(
        (message) => message.id === job.trigger_message_id,
      ) ?? null;
      const liveActiveSkill = job.skill_id
        ? liveAgent.skills.find((skill) => skill.id === job.skill_id) ?? null
        : null;
      if (
        job.selected_skill_id_snapshot !== job.skill_id ||
        (job.skill_id && (
          !liveActiveSkill || !triggerMessage ||
          !job.selected_agent_name_snapshot ||
          !job.selected_agent_responsibility_snapshot ||
          !job.selected_skill_name_snapshot ||
          job.selected_skill_instructions_snapshot == null ||
          !job.selected_skill_provider_snapshot ||
          !job.skill_execution_request_snapshot ||
          job.skill_execution_request_snapshot !==
            (job.delegated_by_reply_job_id
              ? job.delegation_request
              : triggerMessage.body)
        ))
      ) {
        throw new HttpError(409, "Reply job lost its selected Agent Skill");
      }
      const activeSkill = liveActiveSkill
        ? {
            ...liveActiveSkill,
            name: job.selected_skill_name_snapshot!,
            instructions: job.selected_skill_instructions_snapshot!,
            provider: job.selected_skill_provider_snapshot!,
            model: job.selected_skill_model_snapshot ?? null,
            effort: job.selected_skill_effort_snapshot ?? null,
          }
        : null;
      const agent = activeSkill
        ? {
            ...liveAgent,
            name: job.selected_agent_name_snapshot!,
            responsibility: job.selected_agent_responsibility_snapshot!,
            skills: liveAgent.skills.map((skill) =>
              skill.id === activeSkill.id ? activeSkill : skill
            ),
          }
        : liveAgent;
      const replyRuntime = activeSkill ?? agent;
      if (replyRuntime.provider !== job.agent_provider) {
        throw new HttpError(409, "Reply job provider was revoked");
      }
      const replyModel = replyRuntime.model;
      const replyEffort = replyRuntime.effort;
      const project = job.project_id
        ? await getOrganizationProject(db, job.organization_id, job.project_id)
        : null;
      if (job.project_id !== null && !project) {
        throw new HttpError(409, "Reply job lost its project context");
      }
      const executionTargets = job.project_id &&
          await channelExecutionProposalTablesAvailable(db)
        ? await snapshotChannelReplyExecutionTargets(db, {
            jobId: job.id,
            deviceId: principal.deviceId,
            workerId: binding.id,
            claimTokenHash,
            claimedAt: job.claimed_at ?? observedAt,
          })
        : [];
      if (executionTargets === null) {
        throw new HttpError(409, "Reply claim target snapshot was not stored");
      }
      const channelAgents = agent.project_id === null
        ? await hydrateAgentSkills(db, await listChannelAgents(db, job.channel_id))
        : [];
      let delegation: {
        delegatedByReplyId: string;
        delegatedByAgentId: string;
        delegatedByAgentName: string;
        request: string;
      } | null = null;
      if (job.delegated_by_reply_job_id) {
        const delegatedByJob = await getChannelAgentReplyJob(
          db,
          job.organization_id,
          job.delegated_by_reply_job_id,
        );
        if (
          !delegatedByJob || delegatedByJob.project_id !== null ||
          delegatedByJob.status !== "completed" ||
          delegatedByJob.delegated_by_reply_job_id !== null ||
          delegatedByJob.channel_id !== job.channel_id ||
          delegatedByJob.trigger_message_id !== job.trigger_message_id ||
          delegatedByJob.parent_message_id !== job.parent_message_id ||
          !job.delegation_request
        ) {
          throw new HttpError(409, "Delegated reply lost its parent scope");
        }
        const delegatedByAgent = await getOrganizationAgent(
          db,
          job.organization_id,
          delegatedByJob.agent_id,
        );
        if (!delegatedByAgent || delegatedByAgent.project_id !== null) {
          throw new HttpError(409, "Delegated reply lost its Organization Agent");
        }
        delegation = {
          delegatedByReplyId: delegatedByJob.id,
          delegatedByAgentId: delegatedByAgent.id,
          delegatedByAgentName: delegatedByAgent.name,
          request: job.delegation_request,
        };
      }
      const skillExecutionRequest = job.skill_execution_request_snapshot ?? null;
      if (activeSkill && agent.project_id !== null && !skillExecutionRequest) {
        throw new HttpError(409, "Reply job lost its Skill execution request");
      }
      const delegationTargets = agent.project_id === null
        ? channelAgents.flatMap((target) =>
            target.project_id
              ? [{
                  agentId: target.id,
                  agentName: target.name,
                  projectId: target.project_id,
                  projectName: target.project_name ?? "Project",
                  responsibility: target.responsibility,
                  skills: target.skills.map((skill) => ({
                    id: skill.id,
                    name: skill.name,
                  })),
                }]
              : []
          )
        : [];
      const activity = env.CHANNEL_ACTIVITY_REALTIME
        ? await channelActivityCredential(env, job, {
            workerId: binding.id,
            deviceId: principal.deviceId,
          })
        : null;
      const handoffContext = await latestExecutionWorkerUpdateHandoff(db, {
        deviceId: principal.deviceId,
        workType: "channelReply",
        workId: job.id,
      });
      return json({
        work: {
          workType: "channelReply",
          workId: job.id,
          organizationId: job.organization_id,
          channelId: job.channel_id,
          // Null means there is no repository: the runner skips worktree setup.
          projectId: job.project_id,
          scope: agent.project_id === null
            ? {
                kind: "organization",
                organizationId: job.organization_id,
              }
            : {
                kind: "project",
                organizationId: job.organization_id,
                projectId: agent.project_id,
              },
          // The worker loop keys in-flight work by runId; a channel reply has no
          // run, so the channel stands in for it.
          runId: job.channel_id,
          sourceKey: `briar-channel:${job.channel_id}:reply:${job.trigger_message_id}`,
          title: channel.name,
          triggerMessageId: job.trigger_message_id,
          parentMessageId: job.parent_message_id,
          provider: job.agent_provider,
          model: replyModel,
          effort: replyEffort,
          activeSkill: activeSkill ? agentSkillJson(activeSkill) : null,
          skillExecutionTarget:
            activeSkill && agent.project_id !== null && skillExecutionRequest
              ? {
                  projectId: agent.project_id,
                  agentId: agent.id,
                  skillId: activeSkill.id,
                  skillName: activeSkill.name,
                  request: skillExecutionRequest,
                }
              : null,
          agent: {
            id: agent.id,
            name: agent.name,
            provider: job.agent_provider,
            model: replyModel,
            effort: replyEffort,
            responsibility: agent.responsibility,
            skill: legacyAgentSkillInstructions(
              activeSkill,
              agent.skill_markdown ?? agent.responsibility,
            ),
            skills: agent.skills.map(agentSkillJson),
          },
          claimToken,
          claimedAt: job.claimed_at,
          leaseExpiresAt: job.lease_expires_at,
          activity,
          handoffContext,
          organizationContext: agent.project_id === null
            ? decodeOrganizationAgentContextDescriptor({
                schemaVersion: 1,
                snapshotAt: job.claimed_at,
              })
            : null,
          delegation,
          delegationTargets,
          snapshot: {
            channel: {
              id: channel.id,
              name: channel.name,
              slug: channel.slug,
              topic: channel.topic,
              defaultProjectId: channel.default_project_id,
            },
            agent: {
              id: agent.id,
              name: agent.name,
              responsibility: agent.responsibility,
              skill: legacyAgentSkillInstructions(
                activeSkill,
                agent.skill_markdown ?? agent.responsibility,
              ),
              provider: job.agent_provider,
              model: replyModel,
              effort: replyEffort,
              skills: agent.skills.map(agentSkillJson),
              projectId: agent.project_id,
            },
            project: project ? { id: project.id, name: project.name } : null,
            projectTargets: project
              ? [{ id: project.id, name: project.name }]
              : [],
            executionTargets: executionTargets.map((target) => ({
              id: target.id,
              projectId: job.project_id,
              runId: target.id,
              runNumber: target.run_number,
              sourceKey: target.source_key,
              title: target.title,
              status: target.status,
            })),
            messages: messages.map(channelReplyContextMessageJson),
          },
        },
      });
    } catch (error) {
      await failChannelReply(db, {
        jobId: job.id,
        deviceId: principal.deviceId,
        workerId: binding.id,
        claimTokenHash,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      });
      scheduleChannelRealtimePublish(env, db, input.organizationId, context);
      throw error;
    }
  }

  const organizationContextManifestMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/organization-context\/manifest$/u,
  );
  if (organizationContextManifestMatch && request.method === "GET") {
    const organizationId = organizationContextManifestMatch[1];
    const workId = organizationContextManifestMatch[2];
    const query = decodeOrganizationAgentContextQuery(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const principal = await requireWorkerOrganization(
      db,
      request,
      organizationId,
    );
    const claimToken = request.headers.get(channelReplyClaimTokenHeader)?.trim();
    if (
      !claimToken?.startsWith("briar_channel_claim_") ||
      claimToken.length > 200
    ) {
      throw new HttpError(401, "Channel reply claim token required");
    }
    const job = await getActiveOrganizationChannelReplyContextClaim(db, {
      organizationId,
      jobId: workId,
      deviceId: principal.deviceId,
      workerId: query.workerId,
      claimTokenHash: await sha256(claimToken),
      observedAt: new Date().toISOString(),
    });
    if (!job?.claimed_at) {
      throw new HttpError(409, "Organization Agent claim is no longer active");
    }
    const manifest = decodeOrganizationAgentContextManifest(
      await organizationAgentContextManifest(db, {
        organizationId,
        workId,
        snapshotAt: job.claimed_at,
      }),
    );
    const etag = `"${manifest.revision}"`;
    const headers = {
      ...corsHeaders,
      "Cache-Control": "private, no-store",
      ETag: etag,
    };
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return Response.json(manifest, { headers });
  }

  const organizationContextLookupMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/organization-context\/lookup$/u,
  );
  if (organizationContextLookupMatch && request.method === "POST") {
    const organizationId = organizationContextLookupMatch[1];
    const workId = organizationContextLookupMatch[2];
    const input = decodeOrganizationAgentContextLookupInput(
      await readJson(request),
    );
    const principal = await requireWorkerOrganization(
      db,
      request,
      organizationId,
    );
    const claimToken = request.headers.get(channelReplyClaimTokenHeader)?.trim();
    if (
      !claimToken?.startsWith("briar_channel_claim_") ||
      claimToken.length > 200
    ) {
      throw new HttpError(401, "Channel reply claim token required");
    }
    const job = await getActiveOrganizationChannelReplyContextClaim(db, {
      organizationId,
      jobId: workId,
      deviceId: principal.deviceId,
      workerId: input.workerId,
      claimTokenHash: await sha256(claimToken),
      observedAt: new Date().toISOString(),
    });
    if (!job?.claimed_at) {
      throw new HttpError(409, "Organization Agent claim is no longer active");
    }
    const projectIds = [...new Set(input.requests.map((item) => item.projectId))];
    const projects = await Promise.all(
      projectIds.map((projectId) =>
        getOrganizationProject(db, organizationId, projectId)
      ),
    );
    if (projects.some((project) => !project)) {
      throw new HttpError(404, "Project not found");
    }
    const response = decodeOrganizationAgentContextLookupResponse(
      await lookupOrganizationAgentContext(db, env.ARCHIVES, {
        organizationId,
        workId,
        snapshotAt: job.claimed_at,
        requests: input.requests,
      }),
    );
    if (
      new TextEncoder().encode(JSON.stringify(response)).byteLength >
        organizationAgentContextMaxEncodedPageBytes
    ) {
      throw new OrganizationAgentContextPageTooLargeError();
    }
    return privateNoStoreJson(response);
  }

  const organizationContextMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/organization-context\/projects(?:\/([0-9a-f-]+)\/(agents|issues|issue-pull-requests|agent-sessions))?$/u,
  );
  if (organizationContextMatch && request.method === "GET") {
    const organizationId = organizationContextMatch[1];
    const workId = organizationContextMatch[2];
    const projectId = organizationContextMatch[3] ?? null;
    const resource = organizationContextMatch[4] ?? "projects";
    const query = decodeOrganizationAgentContextQuery(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const principal = await requireWorkerOrganization(
      db,
      request,
      organizationId,
    );
    const claimToken = request.headers.get(channelReplyClaimTokenHeader)?.trim();
    if (
      !claimToken?.startsWith("briar_channel_claim_") ||
      claimToken.length > 200
    ) {
      throw new HttpError(401, "Channel reply claim token required");
    }
    const job = await getActiveOrganizationChannelReplyContextClaim(db, {
      organizationId,
      jobId: workId,
      deviceId: principal.deviceId,
      workerId: query.workerId,
      claimTokenHash: await sha256(claimToken),
      observedAt: new Date().toISOString(),
    });
    if (!job?.claimed_at) {
      throw new HttpError(409, "Organization Agent claim is no longer active");
    }

    if (resource === "projects") {
      const page = await listOrganizationAgentContextProjectsPage(db, {
        organizationId,
        workId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextProjectsPage(page),
      );
    }

    if (!projectId) {
      throw new HttpError(404, "Project not found");
    }
    const project = await getOrganizationProject(db, organizationId, projectId);
    if (!project) throw new HttpError(404, "Project not found");
    if (resource === "agents") {
      const page = await listOrganizationAgentContextAgentsPage(db, {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextAgentsPage(page),
      );
    }
    if (resource === "issues") {
      const page = await listOrganizationAgentContextIssuesPage(db, {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextIssuesPage(page),
      );
    }
    if (resource === "issue-pull-requests") {
      const page = await listOrganizationAgentContextIssuePullRequestsPage(db, {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextIssuePullRequestsPage(page),
      );
    }
    const page = await listOrganizationAgentContextSessionsPage(
      db,
      env.ARCHIVES,
      {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      },
    );
    return privateNoStoreJson(
      decodeOrganizationAgentContextSessionsPage(page),
    );
  }

  const channelReplyAttachmentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  if (
    channelReplyAttachmentMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const principal = await requireWorkerOrganization(
      db,
      request,
      channelReplyAttachmentMatch[1],
    );
    const claimToken = request.headers.get(channelReplyClaimTokenHeader)?.trim();
    if (
      !claimToken?.startsWith("briar_channel_claim_") ||
      claimToken.length > 200
    ) {
      throw new HttpError(401, "Channel reply claim token required");
    }
    const attachment = await getClaimedChannelReplyAttachment(db, {
      organizationId: channelReplyAttachmentMatch[1],
      jobId: channelReplyAttachmentMatch[2],
      deviceId: principal.deviceId,
      claimTokenHash: await sha256(claimToken),
      attachmentId: channelReplyAttachmentMatch[3],
      observedAt: new Date().toISOString(),
    });
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(attachment.object_key);
      if (!object) throw new HttpError(404, "Attachment not found");
      return attachmentResponse(attachment, object, null);
    }
    const object = await attachmentsBucket.get(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return attachmentResponse(attachment, object, object.body);
  }

  const channelReplyActivityMatch = pathname.match(
    /^\/channel-reply-claims\/([0-9a-f-]+)\/activity$/u,
  );
  if (channelReplyActivityMatch && request.method === "POST") {
    const token = request.headers.get("X-Briar-Channel-Activity-Token") ?? "";
    const verified = await verifyChannelActivityPublishToken(
      env.BETTER_AUTH_SECRET,
      token,
      channelReplyActivityMatch[1],
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity token");
    }
    const input = decodeChannelAgentActivityPublishInput(
      await readJson(request),
    );
    const frame = channelActivityFrame(
      {
        id: verified.replyJobId,
        organization_id: verified.organizationId,
        channel_id: verified.channelId,
        agent_id: verified.agentId,
        trigger_message_id: verified.triggerMessageId,
        parent_message_id: verified.parentMessageId,
        attempts: verified.attempt,
      },
      input,
    );
    await publishChannelActivity(env, verified.organizationId, frame);
    return new Response(null, { status: 204 });
  }

  const channelReplyClaimMatch = pathname.match(
    /^\/channel-reply-claims\/([0-9a-f-]+)\/(lease|complete)$/u,
  );
  if (channelReplyClaimMatch && request.method === "POST") {
    if (channelReplyClaimMatch[2] === "lease") {
      const input = decodeChannelReplyLeaseInput(await readJson(request));
      const principal = await requireWorkerOrganization(
        db,
        request,
        input.organizationId,
      );
      const observedAt = new Date().toISOString();
      const renewed = await renewChannelReplyLease(db, {
        jobId: channelReplyClaimMatch[1],
        deviceId: principal.deviceId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        observedAt,
        leaseExpiresAt: leaseExpiryFrom(observedAt),
      });
      if (!renewed) throw new HttpError(409, "Reply claim is no longer active");
      const activity = env.CHANNEL_ACTIVITY_REALTIME
        ? await channelActivityCredential(env, renewed, {
            workerId: input.workerId,
            deviceId: principal.deviceId,
          })
        : null;
      return json({ leaseExpiresAt: renewed.lease_expires_at, activity });
    }

    const { input, attachments } = await readChannelReplyCompleteRequest(
      request,
    );
    const principal = await requireWorkerOrganization(
      db,
      request,
      input.organizationId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const observedAt = new Date().toISOString();
    const job = await getClaimedChannelReply(db, {
      jobId: channelReplyClaimMatch[1],
      deviceId: principal.deviceId,
      workerId: input.workerId,
      claimTokenHash,
      observedAt,
    });
    if (!job || job.organization_id !== input.organizationId) {
      throw new HttpError(409, "Reply claim is no longer active");
    }
    if (input.error) {
      const failed = await failChannelReply(db, {
        jobId: job.id,
        deviceId: principal.deviceId,
        workerId: input.workerId,
        claimTokenHash,
        error: input.error,
        updatedAt: observedAt,
      });
      if (!failed) throw new HttpError(409, "Reply claim is no longer active");
      scheduleChannelRealtimePublish(env, db, input.organizationId, context);
      scheduleChannelActivityClear(env, failed, context);
      return json({ agentReply: channelReplyJson(failed) });
    }
    const agent = await getOrganizationAgent(
      db,
      job.organization_id,
      job.agent_id,
    );
    if (!agent) throw new HttpError(409, "Reply job lost its Agent");
    const result = input.result!;
    if (
      (result.executionProposal || result.issueProposal?.executeAfterCreate) &&
      !(await channelExecutionProposalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    if (
      result.skillExecutionProposal &&
      !(await channelSkillExecutionProposalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Agent Skill execution approval is not available during this upgrade",
        "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    if (
      result.delegation &&
      (agent.project_id !== null || job.delegated_by_reply_job_id !== null)
    ) {
      throw new HttpError(400, "Only an Organization Agent can delegate");
    }
    for (const projectId of [
      result.document?.projectId,
      result.issueProposal?.projectId,
      result.executionProposal?.projectId,
    ]) {
      if (
        projectId !== null && projectId !== undefined &&
        agent.project_id !== null && projectId !== agent.project_id
      ) {
        throw new HttpError(400, "Project Agent output is outside its project");
      }
    }
    const document = result.document
      ? {
          ...result.document,
          projectId: result.document.projectId ?? agent.project_id,
        }
      : null;
    const issueProposal = result.issueProposal
      ? {
          ...result.issueProposal,
          projectId: result.issueProposal.projectId ?? agent.project_id,
        }
      : null;
    const executionProposal = result.executionProposal;
    if (
      agent.project_id === null &&
      (executionProposal || issueProposal?.executeAfterCreate ||
        result.skillExecutionProposal)
    ) {
      throw new HttpError(
        400,
        "Organization Agents must delegate execution requests to a Project Agent",
      );
    }
    if (
      result.skillExecutionProposal &&
      (!job.skill_id || job.selected_skill_id_snapshot !== job.skill_id ||
        !agent.skills.some((skill) =>
          skill.id === job.skill_id && skill.provider === job.agent_provider
        ))
    ) {
      throw new HttpError(
        409,
        "Agent Skill execution requires the server-selected Skill",
        "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE",
      );
    }
    let delegation: {
      projectId: string;
      agentId: string;
      skillId: string | null;
      provider: AgentProvider;
      request: string;
    } | null = null;
    if (result.delegation) {
      const roster = await hydrateAgentSkills(
        db,
        await listChannelAgents(db, job.channel_id),
      );
      const target = roster.find(
        (candidate) => candidate.id === result.delegation?.agentId,
      );
      if (
        !target || !target.project_id ||
        target.organization_id !== job.organization_id ||
        target.project_id !== result.delegation.projectId
      ) {
        throw new HttpError(
          400,
          "Delegation target is not an eligible Project Agent in this channel",
        );
      }
      const selectedSkill = agentSkillForMessage(
        target.skills,
        result.delegation.request,
      );
      delegation = {
        projectId: target.project_id,
        agentId: target.id,
        skillId: selectedSkill?.id ?? null,
        provider: selectedSkill?.provider ?? target.provider,
        request: result.delegation.request,
      };
    }
    // A document or issue may only target a project inside this organization.
    for (const projectId of [
      document?.projectId,
      issueProposal?.projectId,
      executionProposal?.projectId,
    ]) {
      if (!projectId) continue;
      const project = await getOrganizationProject(
        db,
        job.organization_id,
        projectId,
      );
      if (!project) {
        throw new HttpError(400, "Target project is outside this organization");
      }
    }
    const storedAttachments = prepareStoredAttachments(attachments, () => {
      const id = crypto.randomUUID();
      return {
        id,
        organization_id: job.organization_id,
        object_key:
          `channel-attachments/${job.organization_id}/${job.channel_id}/${job.reply_message_id}/${id}`,
      };
    });
    const uploadedKeys: string[] = [];
    const discardUploadedReplyImages = async () => {
      if (uploadedKeys.length === 0) return;
      try {
        await attachmentsBucket.delete(uploadedKeys);
      } catch (cleanupError) {
        console.error(JSON.stringify({
          message: "Failed channel reply image cleanup",
          organizationId: job.organization_id,
          channelId: job.channel_id,
          messageId: job.reply_message_id,
          attachmentCount: uploadedKeys.length,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        }));
      }
    };
    let completed: Awaited<ReturnType<typeof completeChannelReply>> = null;
    try {
      await uploadStoredAttachments(
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          channelId: job.channel_id,
          messageId: job.reply_message_id,
          organizationId: job.organization_id,
        }),
      );
      completed = await completeChannelReply(db, job, {
        jobId: job.id,
        deviceId: principal.deviceId,
        workerId: input.workerId,
        claimTokenHash,
        body: result.body,
        document,
        issueProposal,
        executionProposal,
        skillExecutionProposal: Boolean(result.skillExecutionProposal),
        delegation,
        agentName: agent.name,
        agentProvider: job.agent_provider ?? agent.provider,
        completedAt: observedAt,
        attachments: storedAttachments.map(({ file: _file, ...attachment }) =>
          attachment
        ),
      });
    } catch (error) {
      await discardUploadedReplyImages();
      throw error;
    }
    if (!completed) {
      await discardUploadedReplyImages();
      throw new HttpError(409, "Reply claim is no longer active");
    }
    scheduleChannelRealtimePublish(env, db, input.organizationId, context);
    scheduleChannelActivityClear(env, completed, context);
    return json({
      agentReply: channelReplyJson(completed),
      message: await getChannelMessage(
        db,
        job.channel_id,
        job.reply_message_id,
      ),
    });
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

    const input = decodeIssueAgentReplyCompletion(
      await readJson(request),
    );
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

    const completedAt = new Date().toISOString();
    const completed = await completeIssueAgentReplyOutput(
      db,
      input.projectId,
      job.id,
      {
        workerId: worker.binding.id,
        claimTokenHash,
        completedAt,
        output: {
          body: input.body!,
          proposedAction: input.proposedAction ?? null,
          executionProposal: Boolean(input.executionProposal),
          skillExecutionProposal: Boolean(input.skillExecutionProposal),
        },
      },
    );
    if (!completed) throw new HttpError(409, "Reply claim is no longer active");
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
        [],
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

  const agentRecoveryMatch = pathname.match(
    /^\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );
  if (agentRecoveryMatch && request.method === "POST") {
    const projectId = await requireRunExecutionProject(
      db,
      request,
      agentRecoveryMatch[1],
    );
    const input = decodeRecoveryAgentInput(await readJson(request));
    const result = await recoverHuntRun(db, projectId, {
      runId: agentRecoveryMatch[1],
      action: agentRecoveryMatch[2] as "retry" | "cancel",
      requestId: input.requestId,
      actor: input.actor,
      reason: input.reason ?? null,
      occurredAt: new Date().toISOString(),
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "ineligible") {
      throw new HttpError(409, "Only blocked or failed runs can be recovered");
    }
    return json({ runId: agentRecoveryMatch[1], ...result });
  }

  const agentResumeMatch = pathname.match(
    /^\/runs\/([0-9a-f-]+)\/resume$/u,
  );
  const agentStageLifecycleMatch = pathname.match(
    /^\/runs\/([0-9a-f-]+)\/stages\/([a-z][a-z0-9_-]{0,63})\/(start|complete)$/u,
  );
  if (agentStageLifecycleMatch && request.method === "POST") {
    const { projectId } = await requireActiveWorkerRunClaim(
      db,
      request,
      agentStageLifecycleMatch[1],
    );
    const input = decodeWorkflowStageLifecycleInput(await readJson(request));
    try {
      const lifecycleObservedAt = new Date().toISOString();
      const common = {
        runId: agentStageLifecycleMatch[1],
        stageId: agentStageLifecycleMatch[2],
        attempt: input.attempt,
        revision: input.revision,
        actor: input.actor,
      };
      const result = agentStageLifecycleMatch[3] === "start"
        ? await startWorkflowStageLifecycle(db, projectId, {
            ...common,
            startedAt: new Date().toISOString(),
          })
        : await completeWorkflowStageLifecycle(db, projectId, {
            ...common,
            finishedAt: lifecycleObservedAt,
          });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found", "RUN_NOT_FOUND");
      }
      const githubAutoResume =
        result.outcome === "paused" &&
          result.checkpoint?.stage === "pr_open" &&
          result.checkpoint.position === "after"
          ? await attemptGithubMergeAutoResume(
              db,
              projectId,
              agentStageLifecycleMatch[1],
            )
          : null;
      const mergeQueueRun =
        agentStageLifecycleMatch[3] === "complete" &&
          agentStageLifecycleMatch[2] === "ci_qa"
          ? await getHuntRunForProject(
              db,
              projectId,
              agentStageLifecycleMatch[1],
            )
          : null;
      const mergeQueueRegistration = mergeQueueRun
        ? await registerReadyMergeCandidates(db, {
            projectId,
            runId: mergeQueueRun.id,
            attempt: mergeQueueRun.current_attempt,
            revision: mergeQueueRun.current_revision,
            readyAt: lifecycleObservedAt,
          })
        : null;
      return json({
        runId: agentStageLifecycleMatch[1],
        requestId: input.requestId,
        ...result,
        ...(githubAutoResume ? { githubAutoResume } : {}),
        ...(mergeQueueRegistration
          ? { mergeQueueRegistered: mergeQueueRegistration.length }
          : {}),
      });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(
          409,
          error.message,
          "WORKFLOW_STAGE_CONFLICT",
        );
      }
      throw error;
    }
  }
  if (agentResumeMatch && request.method === "POST") {
    const projectId = await requireRunExecutionProject(
      db,
      request,
      agentResumeMatch[1],
    );
    const input = decodeResumeAgentInput(await readJson(request));
    const result = await resumeRunWithCheckpointIdentity(
      db,
      projectId,
      agentResumeMatch[1],
      input,
      input.actor,
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
      runId: agentResumeMatch[1],
      ...result,
      workflowStage: result.nextStage,
      startStage: result.nextStage,
    });
  }

  const reworkMatch = pathname.match(/^\/runs\/([0-9a-f-]+)\/rework$/u);
  if (reworkMatch && request.method === "POST") {
    const projectId = await requireRunExecutionProject(
      db,
      request,
      reworkMatch[1],
    );
    const input = decodeRunReworkInput(await readJson(request));
    try {
      const result = await reworkHuntRun(db, projectId, {
        runId: reworkMatch[1],
        workflowStage: input.workflowStage,
        requestId: input.requestId,
        actor: input.actor,
        reason: input.reason,
        occurredAt: new Date().toISOString(),
      });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found");
      }
      return json({ runId: reworkMatch[1], ...result });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  const evidenceMatch = pathname.match(/^\/runs\/([0-9a-f-]+)\/evidence$/u);
  if (evidenceMatch && request.method === "GET") {
    const projectId = await requireRunExecutionProject(
      db,
      request,
      evidenceMatch[1],
    );
    const [hotEvidence, revisions, hotImages, archived] = await Promise.all([
      listRunEvidence(db, projectId, evidenceMatch[1]),
      listRunStageRevisions(db, projectId, evidenceMatch[1]),
      listRunEvidenceImages(db, projectId, evidenceMatch[1]),
      listArchivedRunEvidence(db, env.ARCHIVES, projectId, evidenceMatch[1]),
    ]);
    if (!hotEvidence || !revisions || !hotImages) {
      throw new HttpError(404, "Run not found");
    }
    const evidence = [
      ...new Map(
        [...archived.evidence, ...hotEvidence].map((item) => [item.id, item]),
      ).values(),
    ].sort(
      (left, right) =>
        left.observed_at.localeCompare(right.observed_at) ||
        left.id.localeCompare(right.id),
    );
    const images = [
      ...new Map(
        [...archived.images, ...hotImages].map((item) => [item.id, item]),
      ).values(),
    ];
    const imagesByEvidence = new Map<string, RunEvidenceImageRow[]>();
    for (const image of images) {
      const evidenceImages = imagesByEvidence.get(image.evidence_id) ?? [];
      evidenceImages.push(image);
      imagesByEvidence.set(image.evidence_id, evidenceImages);
    }
    return json({
      runId: evidenceMatch[1],
      attempt: revisions.attempt,
      revision: revisions.revision,
      evidence: evidence.map((item) =>
        runEvidenceJson(
          item,
          revisions.requirements.get(item.workflow_stage) ?? 1,
          imagesByEvidence.get(item.id) ?? [],
        ),
      ),
    });
  }
  if (evidenceMatch && request.method === "POST") {
    const { projectId, claimTokenHash, authenticatedAt } =
      await requireActiveWorkerRunClaim(
      db,
      request,
      evidenceMatch[1],
      );
    const { input: parsed, images } = await readRunEvidenceRequest(request);
    try {
      const evidence = await recordRunEvidence(db, projectId, {
        runId: evidenceMatch[1],
        ...parsed,
        detail: parsed.detail ?? null,
        command: parsed.command ?? null,
        url: parsed.url ?? null,
        metadata: parsed.metadata ?? null,
        observedAt: new Date(parsed.observedAt).toISOString(),
      }, { claimTokenHash, authenticatedAt });
      if (!evidence) throw new HttpError(404, "Run not found");
      let storedImages = await listEvidenceImagesForEvidence(
        db,
        projectId,
        evidence.run_id,
        evidence.id,
      );
      if (images.length > 0) {
        const prepared = await Promise.all(
          images.map(async (image, position) => {
            const bytes = await image.arrayBuffer();
            return {
              bytes,
              filename: image.name.normalize("NFC").trim(),
              contentType: image.type,
              byteSize: image.size,
              sha256: await sha256Bytes(bytes),
              position,
            };
          }),
        );
        if (storedImages.length > 0) {
          const sameImages =
            storedImages.length === prepared.length &&
            storedImages.every((stored, position) => {
              const incoming = prepared[position];
              return (
                incoming &&
                stored.filename === incoming.filename &&
                stored.content_type === incoming.contentType &&
                stored.byte_size === incoming.byteSize &&
                stored.sha256 === incoming.sha256 &&
                stored.position === incoming.position
              );
            });
          if (!sameImages) throw new EventKeyConflictError();
        } else {
          const imageInputs: RunEvidenceImageInput[] = prepared.map(
            (image) => {
              const id = crypto.randomUUID();
              return {
                id,
                object_key: `run-evidence/${projectId}/${evidence.run_id}/${evidence.id}/${id}`,
                filename: image.filename,
                content_type: image.contentType,
                byte_size: image.byteSize,
                sha256: image.sha256,
                position: image.position,
              };
            },
          );
          const uploadedKeys: string[] = [];
          try {
            for (const [position, image] of imageInputs.entries()) {
              const preparedImage = prepared[position];
              if (!preparedImage) throw new Error("Evidence image is missing");
              await attachmentsBucket.put(image.object_key, preparedImage.bytes, {
                httpMetadata: {
                  contentType: image.content_type,
                  contentDisposition: contentDisposition(image.filename),
                },
                customMetadata: {
                  evidenceId: evidence.id,
                  imageId: image.id,
                  projectId,
                  runId: evidence.run_id,
                  sha256: image.sha256,
                },
              });
              uploadedKeys.push(image.object_key);
            }
            const created = await createRunEvidenceImages(
              db,
              projectId,
              evidence.run_id,
              evidence.id,
              imageInputs,
            );
            if (!created) throw new HttpError(404, "Run evidence not found");
            storedImages = created;
          } catch (error) {
            if (uploadedKeys.length > 0) {
              try {
                await attachmentsBucket.delete(uploadedKeys);
              } catch (cleanupError) {
                console.error(
                  JSON.stringify({
                    message: "evidence image cleanup failed",
                    error:
                      cleanupError instanceof Error
                        ? cleanupError.message
                        : String(cleanupError),
                    evidenceId: evidence.id,
                  }),
                );
              }
            }
            throw error;
          }
        }
      }
      return json({
        runId: evidence.run_id,
        attempt: evidence.attempt,
        key: evidence.evidence_key,
        stage: evidence.workflow_stage,
        type: evidence.evidence_type,
        status: evidence.status,
        images: storedImages.map(evidenceImageJson),
      });
    } catch (error) {
      if (
        error instanceof EventKeyConflictError ||
        error instanceof HuntTransitionError
      ) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  if (pathname === "/run-events" && request.method === "POST") {
    const parsed = decodeRunEvent(await readJson(request));
    const projectId = parsed.runId
      ? (await requireActiveWorkerRunClaim(db, request, parsed.runId)).projectId
      : await requireAgentProject(db, request);
    const run = parsed.runId
      ? await getHuntRunForProject(db, projectId, parsed.runId)
      : null;
    if (parsed.runId && !run) throw new HttpError(404, "Run not found");
    assertRunEventIdentityNotOverridden({
      run,
      source: parsed.source,
      sourceKey: parsed.sourceKey,
    });
    const source = parsed.source ?? run?.source;
    const sourceKey = parsed.sourceKey ?? run?.source_key;
    const title = parsed.title ?? run?.title;
    if (!source || !sourceKey || !title) {
      throw new HttpError(400, "Run identity is incomplete");
    }
    if (
      !parsed.runId &&
      isReservedProposalIssueSourceKey(sourceKey)
    ) {
      throw new HttpError(403, "Run identity is reserved for proposal approval");
    }
    const input = {
      ...parsed,
      source,
      sourceKey,
      title,
      stage: dashboardStageForProgress(
        parsed.status,
        parsed.workflowStage ?? null,
      ),
      workflowStage: parsed.workflowStage ?? null,
      occurredAt: new Date(parsed.occurredAt).toISOString(),
      detail: parsed.detail ?? null,
      priority: parsed.priority ?? null,
      branch: parsed.branch ?? null,
      commitSha: parsed.commitSha ?? null,
      tracker: parsed.tracker
        ? {
            provider: parsed.tracker.provider,
            issueId: parsed.tracker.issueId ?? null,
            identifier: parsed.tracker.identifier ?? null,
            url: parsed.tracker.url ?? null,
            state: parsed.tracker.state ?? null,
          }
        : null,
      issueDescription: parsed.issueDescription ?? null,
      resultSummary: parsed.resultSummary ?? null,
      structuredResult: parsed.structuredResult ?? null,
      targetSha: parsed.targetSha ?? null,
      sourceCreatedAt: parsed.sourceCreatedAt
        ? new Date(parsed.sourceCreatedAt).toISOString()
        : null,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: parsed.context ?? null,
    };
    try {
      const claimToken = request.headers.get("x-briar-claim-token");
      await assertQueuedHuntClaim(
        db,
        projectId,
        input,
        claimToken?.startsWith("briar_claim_")
          ? await sha256(claimToken)
          : null,
        new Date().toISOString(),
      );
      const runId = await recordHuntEvent(db, projectId, input);
      if (input.status === "completed" && run?.worker_id) {
        const project = await db
          .prepare(`select organization_id from briar_projects where id = ?`)
          .bind(projectId)
          .first<{ organization_id: string }>();
        if (project) {
          await auditExecutionEvent(db, {
            organizationId: project.organization_id,
            projectId,
            runId,
            workerId: run.worker_id,
            agentId: run.agent_id,
            action: "completed",
            detail: { eventKey: input.eventKey },
            occurredAt: input.occurredAt,
          });
        }
      }
      return json({
        runId,
        status: input.status,
        workflowStage: input.workflowStage,
      });
    } catch (error) {
      if (error instanceof EventKeyConflictError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntClaimError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  throw new HttpError(404, "Not found");
}

export type ScheduledTaskDependencies = {
  archiveCompletedLogs: typeof archiveCompletedLogs;
  expireArchives: typeof expireArchives;
  processArchiveCleanupQueue: typeof processArchiveCleanupQueue;
  processSlackRevocationQueue: typeof processSlackRevocationQueue;
  pruneExpiredDashboardChanges: typeof pruneExpiredDashboardChanges;
  reconcileGithubMergedRuns: typeof reconcileGithubMergedRuns;
  reconcileEnabledMergeQueueRuns: typeof reconcileEnabledMergeQueueRuns;
  reconcileManagedComputers: typeof reconcileManagedComputers;
};

const scheduledTaskDependencies: ScheduledTaskDependencies = {
  archiveCompletedLogs,
  expireArchives,
  processArchiveCleanupQueue,
  processSlackRevocationQueue,
  pruneExpiredDashboardChanges,
  reconcileGithubMergedRuns,
  reconcileEnabledMergeQueueRuns,
  reconcileManagedComputers,
};
const GITHUB_RECONCILIATION_CRON = "* * * * *";
const LOG_MAINTENANCE_CRON = "17 */6 * * *";

export async function handleScheduledTask(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
  dependencies = scheduledTaskDependencies,
): Promise<void> {
  const observedAt = new Date(controller.scheduledTime).toISOString();
  if (controller.cron === GITHUB_RECONCILIATION_CRON) {
    ctx.waitUntil((async () => {
      try {
        const [github, mergeQueue] = await Promise.all([
          dependencies.reconcileGithubMergedRuns(env.DB),
          dependencies.reconcileEnabledMergeQueueRuns(env.DB, observedAt),
        ]);
        await flushOrganizationInboxRealtimeOutbox(env, env.DB);
        console.log(JSON.stringify({
          message: "GitHub merge reconciliation completed",
          observedAt,
          github,
          mergeQueue,
        }));
      } catch (error) {
        console.error(JSON.stringify({
          message: "GitHub merge reconciliation failed",
          observedAt,
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    })());
    return;
  }
  if (controller.cron !== LOG_MAINTENANCE_CRON) {
    console.error(JSON.stringify({
      message: "Unknown scheduled task ignored",
      observedAt,
      cron: controller.cron,
    }));
    controller.noRetry();
    return;
  }
  ctx.waitUntil((async () => {
    try {
      // Keep the bounded delete separate from the other D1 maintenance writers.
      let dashboardChanges: Awaited<
        ReturnType<typeof pruneExpiredDashboardChanges>
      > | null = null;
      let dashboardChangePruneFailed = false;
      let dashboardChangePruneError: unknown = null;
      try {
        dashboardChanges = await dependencies.pruneExpiredDashboardChanges(
          env.DB,
          observedAt,
        );
      } catch (error) {
        dashboardChangePruneFailed = true;
        dashboardChangePruneError = error;
        console.error(JSON.stringify({
          message: "Dashboard change prune failed",
          observedAt,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      const [archive, expired, cleanup, slackRevocations, github, managedComputers] =
        await Promise.all([
        dependencies.archiveCompletedLogs(env.DB, env.ARCHIVES, observedAt),
        dependencies.expireArchives(
          env.DB,
          env.ARCHIVES,
          env.ATTACHMENTS,
          observedAt,
        ),
        dependencies.processArchiveCleanupQueue(
          env.DB,
          env.ARCHIVES,
          env.ATTACHMENTS,
          observedAt,
        ),
        dependencies.processSlackRevocationQueue(env.DB, env, observedAt),
        dependencies.reconcileGithubMergedRuns(env.DB),
        dependencies.reconcileManagedComputers(env.DB, env, observedAt),
      ]);
      await flushOrganizationInboxRealtimeOutbox(env, env.DB);
      if (dashboardChangePruneFailed) {
        throw dashboardChangePruneError;
      }
      console.log(JSON.stringify({
        message: "log archive sweep completed",
        observedAt,
        dashboardChanges,
        archive,
        expiredObjects: expired,
        cleanup,
        slackRevocations,
        github,
        managedComputers,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        message: "log archive sweep failed",
        observedAt,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  })());
}

async function handleIncomingChannelWebhook(
  request: Request,
  env: Env,
  context: ExecutionContext | undefined,
  webhookId: string,
  secret: string,
) {
  const webhook = await getIncomingChannelWebhook(
    env.DB,
    webhookId,
    await sha256(secret),
  );
  if (!webhook) throw new HttpError(404, "Webhook not found");
  if (webhook.channel_archived_at) {
    throw new HttpError(409, "Channel is archived");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith(
    "application/json",
  )) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const observedAt = new Date();
  const allowed = await consumeChannelWebhookRateLimit(
    env.DB,
    webhook.id,
    observedAt.toISOString(),
    new Date(observedAt.getTime() - 60_000).toISOString(),
  );
  if (!allowed) throw new HttpError(429, "Webhook rate limit exceeded");
  const input = decodeChannelIncomingWebhookMessage(
    await readJson(request, 65_536),
  );
  const rawHeaderEventId = request.headers.get("idempotency-key");
  const headerEventId = rawHeaderEventId?.trim() ?? null;
  if (rawHeaderEventId !== null &&
    (!headerEventId || headerEventId.length > 200)) {
    throw new HttpError(400, "Invalid idempotency key");
  }
  if (headerEventId && input.eventId && input.eventId !== headerEventId) {
    throw new HttpError(400, "Invalid idempotency key");
  }
  const eventId = input.eventId ?? headerEventId;
  const result = await createIncomingChannelWebhookMessage(env.DB, {
    id: crypto.randomUUID(),
    webhookId: webhook.id,
    channelId: webhook.channel_id,
    webhookName: webhook.name,
    eventId,
    body: input.text ?? channelMessageBlocksFallback(input.blocks ?? []),
    blocks: input.blocks ?? null,
    createdAt: observedAt.toISOString(),
  });
  if (!result?.message) throw new HttpError(500, "Message was not created");
  if (result.created) {
    scheduleChannelRealtimePublish(
      env,
      env.DB,
      webhook.organization_id,
      context,
    );
  }
  return json({ message: result.message, duplicate: !result.created },
    result.created ? 201 : 200);
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
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/app" || url.pathname.startsWith("/app/"))
    ) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = url.pathname.slice("/app".length) || "/";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    if (url.pathname === "/health") {
      return json(decodeMobileHealthResponse({
        ok: true,
        service: "briar-api",
        database: "cloudflare-d1",
        updates: "cloudflare-r2",
      }));
    }
    const incomingChannelWebhookMatch = url.pathname.match(
      /^\/hooks\/channels\/([0-9a-f-]+)\/([A-Za-z0-9_-]{43})$/u,
    );
    if (incomingChannelWebhookMatch && request.method === "POST") {
      try {
        return await handleIncomingChannelWebhook(
          request,
          env,
          ctx,
          incomingChannelWebhookMatch[1],
          incomingChannelWebhookMatch[2],
        );
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ message: error.message }, error.status);
        }
        if (error instanceof RequestDecodeError) {
          return json({
            message: "Invalid request",
            issues: formatSchemaIssue(error.cause.issue).issues,
          }, 400);
        }
        console.error(JSON.stringify({
          message: "Incoming channel webhook failed",
          webhookId: incomingChannelWebhookMatch[1],
          error: error instanceof Error ? error.message : String(error),
        }));
        return json({ message: "Internal server error" }, 500);
      }
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
    if (
      url.pathname === "/.well-known/apple-app-site-association" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return appleAppSiteAssociation(request.method === "HEAD");
    }
    const issueLinkMatch = url.pathname.match(
      /^\/open\/issues\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu,
    );
    if (
      issueLinkMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return appLinkPage(
        "issues",
        issueLinkMatch[1],
        issueLinkMatch[2],
        request.method === "HEAD",
      );
    }
    const sessionLinkMatch = url.pathname.match(
      /^\/open\/sessions\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu,
    );
    if (
      sessionLinkMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return appLinkPage(
        "sessions",
        sessionLinkMatch[1],
        sessionLinkMatch[2],
        request.method === "HEAD",
      );
    }
    const channelLinkMatch = url.pathname.match(
      /^\/open\/channels\/([0-9a-f-]{36})\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?\/?$/iu,
    );
    if (
      channelLinkMatch &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const root = url.searchParams.get("root")?.trim();
      const search = channelLinkMatch[3] && root && root !== channelLinkMatch[3]
        ? `?root=${encodeURIComponent(root)}`
        : "";
      return appLinkPage(
        "channels",
        channelLinkMatch[1],
        channelLinkMatch[2],
        request.method === "HEAD",
        channelLinkMatch[3] ? `/${channelLinkMatch[3]}` : "",
        search,
      );
    }
    const releaseResponse = await serveRelease(request, env.RELEASES);
    if (releaseResponse) return releaseResponse;
    if (url.pathname === "/brand/briar-icon.png" && request.method === "GET") {
      return pngResponse(briarIconPng);
    }
    if (url.pathname === "/device" && request.method === "GET") {
      const client = url.searchParams.get("client");
      const deviceClient = client === "mobile" || client === "android"
        ? "mobile"
        : client === "web"
          ? "web"
          : "desktop";
      return otpDevicePage(url.origin, deviceClient);
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
