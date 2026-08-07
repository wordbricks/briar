import { z } from "zod";
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
  structuredAgentResultSchema,
  type StructuredAgentResult,
} from "../../src/lib/agent-result";
import { agentExecutionMetricsSchema } from "../../src/lib/agent-execution-metrics";
import {
  ideaDocumentSchema,
  ideaIssuePlanItemsSchema,
  ideaMessageSchema,
  ideaPlanResultSchema,
  ideaProviders,
  ideaTurnResultSchema,
} from "../../src/lib/ideas-contract";
import {
  defaultProjectAgentCalendarColor,
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
  validateIssueAttachments,
} from "../../src/lib/issue-attachments";
import {
  canonicalizeIssueAttachmentReferences,
  isIssueAttachmentReference,
  issueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import { shouldBriarReply } from "../../src/lib/issue-reply-decision";
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
import { createAuth, type BriarAuth } from "./auth";
import {
  mobileCurrentUserResponseSchema,
  mobileHealthResponseSchema,
  mobileProjectsResponseSchema,
} from "./mobile-contract";
import {
  archiveCompletedLogs,
  cancelArchiveCleanup,
  collectStorageMetrics,
  enqueueArchiveCleanup,
  expireArchives,
  getArchivedEvidenceImage,
  listArchivedExecutionAuditEvents,
  listArchivedIssueMessages,
  listArchivedProjectAgentSessions,
  listArchivedRunEvidence,
  listArchivedRunEvents,
  listArchiveObjectsForDeletion,
  processArchiveCleanupQueue,
  readArchivedTranscript,
} from "./archive";
import {
  acceptOrganizationInvitation,
  addOrganizationMember,
  assertQueuedHuntClaim,
  attemptGithubMergeAutoResume,
  claimGithubDelivery,
  claimNextIssueAgentReply,
  claimDueProjectAgentScheduleRun,
  claimNextQueuedHuntRun,
  completeIssueAgentReply,
  completeIssueResultReview,
  completeProjectAgentScheduleRun,
  completeGithubDelivery,
  completeSlackEvent,
  connectGithubInstallation,
  consumeGithubInstallState,
  consumeGithubOAuthState,
  consumeSlackOAuthState,
  createGithubOAuthState,
  createIssueActionProposal,
  createIssueMessage,
  createIssueReworkProposal,
  createIssueDependency,
  createIssueAttachments,
  createRunEvidenceImages,
  createOrganization,
  createOrganizationInvitation,
  createProjectAgent,
  createProjectAgentSchedule,
  createProject,
  createSlackOAuthState,
  claimSlackEvent,
  deleteAccountData,
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
  findProjectIdByAgentTokenHash,
  getProjectAgent,
  getClaimedIssueAgentReply,
  getIssueActionProposal,
  getIssueAgentReplyJob,
  getIssueReworkProposal,
  getIssueAttachment,
  getRunEvidenceImage,
  getOrganizationRole,
  getOrganizationInvitationByTokenHash,
  getGithubConnectionByInstallation,
  getGithubConnectionForOrganization,
  getSlackInstallation,
  isOrganizationHandleAvailable,
  getProject,
  getProjectSettings,
  getDashboardSyncCursor,
  getHuntRunForProject,
  HuntClaimError,
  HuntTransitionError,
  initializeWorkflowProgress,
  importLinearHuntRuns,
  listIssueAttachments,
  listIssueDependencies,
  listIssueConversationNotifications,
  listIssueActionProposals,
  listIssueMessages,
  listIssueReworkProposals,
  listIssueThreadMessages,
  listIssueResultReviews,
  listInboxReadStates,
  listAllRunEvidenceImages,
  listEvidenceImagesForEvidence,
  listDashboardRuns,
  listDashboardChanges,
  listHuntRunEvents,
  listRunEvidence,
  listRunEvidenceImages,
  listRunStageRevisions,
  listOrganizationMembers,
  listOrganizationInvitations,
  listGithubConnectionRepositories,
  listOrganizationProjects,
  listOrganizations,
  listProjects,
  listProjectAgents,
  listProjectAgentSessions,
  listProjectAgentScheduleRuns,
  listProjectAgentSchedules,
  listSlackInstallations,
  moveHuntRun,
  planAccountDeletion,
  issueProjectAgentToken,
  recoverHuntRun,
  reconcileGithubMergedRuns,
  completeWorkflowStageLifecycle,
  resumeWorkflowCheckpoint,
  resumeHuntRun,
  reworkHuntRun,
  recordHuntEvent,
  recordRunEvidence,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  renewProjectAgentScheduleRunLease,
  renewIssueAgentReplyLease,
  acceptIssueCreateProposal,
  acceptIssueUpdateProposal,
  acceptIssueReworkProposal,
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
  updateIssue,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
  updateHuntRunExecutionMetrics,
  updateSlackInstallationProject,
  upsertInboxReadStates,
  upsertProjectAgentSession,
  upsertSlackInstallation,
  syncGithubPullRequest,
  syncGithubConnectionRepositories,
  type HuntEventRow,
  type HuntRunRow,
  type IssueAttachmentInput,
  type IssueAttachmentRow,
  type IssueActionProposalRow,
  type IssueAgentReplyJobRow,
  type IssueConversationNotificationRow,
  type IssueMessageRow,
  type IssueReworkProposalRow,
  type IssueResultReviewRow,
  type IssueDependencyRow,
  type ProjectRow,
  type ProjectAgentRow,
  type ProjectAgentScheduleRunRow,
  type ProjectAgentScheduleRow,
  type ProjectSettingsRow,
  type OrganizationMemberRow,
  type OrganizationInvitationRow,
  type OrganizationRole,
  type OrganizationRow,
  type RunEvidenceRow,
  type RunEvidenceImageInput,
  type RunEvidenceImageRow,
} from "./db";
import {
  exchangeGithubOAuthCode,
  githubOAuthStateTtlMs,
  githubPkceChallenge,
  githubSha256Hex,
  parseGitHubWebhook,
  parseGitHubWebhookHeaders,
  randomGithubOAuthToken,
  verifyGithubOAuthInstallation,
  verifyGitHubWebhook,
} from "./github";
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
  appendAgentTranscript,
  auditExecutionEvent,
  authenticateExecutionWorker,
  bindExecutionWorkerProject,
  countExecutionWorkerDeviceSessions,
  countLeasedRuns,
  disableExecutionWorker,
  dispatchHuntRun,
  unassignHuntRun,
  executionWorkerBindingById,
  executionWorkerBindingForProject,
  executionWorkerDeviceForBinding,
  executionWorkerProviders,
  leaseExpiryFrom,
  listExecutionAuditEvents,
  listExecutionWorkers,
  listOrganizationExecutionWorkers,
  getProjectExecutionWorkerPolicy,
  MAX_WORKER_CONCURRENT_SESSIONS,
  MAX_TRANSCRIPT_EVENTS_PER_REQUEST,
  WORKER_STALE_AFTER_MS,
  reapStalledHuntRuns,
  readAgentTranscript,
  recordWorkerHeartbeat,
  registerExecutionWorker,
  renewHuntRunLease,
  TranscriptLimitError,
  WorkerConflictError,
  workerStateAt,
  unbindExecutionWorker,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerIcon,
  updateExecutionWorkerLabel,
  updateProjectExecutionWorkerPolicy,
} from "./workers";
import { serveRelease } from "./releases";
import {
  claimNextIdeaJob,
  completeIdeaChatJob,
  completeIdeaPlanJob,
  convertIdeaPlanToIssues,
  createIdea,
  deleteIdea,
  enqueueIdeaPlan,
  failIdeaJob,
  getClaimedIdeaJob,
  getIdea,
  getOrganizationIdea,
  ideaJobSnapshot,
  listIdeas,
  listOrganizationIdeas,
  renewIdeaJobLease,
  retryIdeaJob,
  sendIdeaMessage,
  updateIdea,
  updateIdeaPlan,
} from "./ideas";
import {
  acceptChannelActionProposal,
  addChannelAgent,
  addChannelMember,
  channelJson,
  channelMessageJson,
  channelReplyJson,
  claimNextChannelAgentReply,
  completeChannelReply,
  createChannel,
  createChannelMessage,
  deleteChannel,
  enqueueChannelAgentReplies,
  failChannelReply,
  getChannel,
  getChannelActionProposal,
  getChannelAgentReplyJob,
  getChannelById,
  getChannelMessage,
  getChannelMessageAttachment,
  getChannelSyncCursor,
  getClaimedChannelReply,
  getOrganizationProject,
  listOrganizationProjectTargets,
  listChannelAgentReplies,
  listChannelAttachmentObjectKeys,
  listChannelAgents,
  listChannelMembers,
  listChannelRootMessages,
  listChannelThreadMessages,
  listChannels,
  loadChannelDelta,
  removeChannelAgent,
  removeChannelMember,
  renewChannelReplyLease,
  updateChannel,
} from "./channels";
import {
  createOrganizationAgent,
  deleteOrganizationAgent,
  getOrganizationAgent,
  listOrganizationAgents,
  organizationAgentJson,
  updateOrganizationAgent,
} from "./organization-agents";
import {
  channelInputSchema,
  channelIssueProposalPayloadSchema,
  channelMemberInputSchema,
  channelMessageInputSchema,
  channelProposalAcceptInputSchema,
  channelReplyClaimInputSchema,
  channelReplyCompleteInputSchema,
  channelReplyLeaseInputSchema,
  channelSlugFromName,
  channelUpdateInputSchema,
  handleFromName,
  organizationAgentInputSchema,
} from "../../src/lib/channels-contract";
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
    "authorization, content-type, x-briar-claim-token",
  "Access-Control-Allow-Methods": "DELETE, GET, HEAD, PATCH, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const accountDeletionFreshAgeMs = 24 * 60 * 60 * 1_000;
const organizationInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

class ProjectWorkflowInputError extends Error {
  readonly code = "INVALID_PROJECT_WORKFLOW";

  constructor(readonly issues: readonly unknown[]) {
    super("Invalid project workflow");
    this.name = "ProjectWorkflowInputError";
  }
}

const runStatusSchema = z.enum(autoHuntPersistedRunStatuses);
const workflowStageIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u);
const workflowCheckpointSchema = z
  .object({
    key: workflowStageIdSchema,
    stage: workflowStageIdSchema,
    position: z.enum(["before", "after"]),
  })
  .strict();
const evidenceTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(autoHuntEvidenceTypeMaxLength)
  .regex(autoHuntEvidenceTypePattern);
const workflowSchema = z
  .object({
    version: z.literal(2),
    requirements: z
      .array(
        z.object({
          id: workflowStageIdSchema,
          label: z.string().trim().min(1).max(80),
          kind: z.enum(autoHuntRequirementKinds),
          tool: z.string().trim().regex(/^[a-zA-Z0-9_.+-]+$/u).max(80),
          reason: z.string().trim().min(1).max(200),
        }).strict(),
      )
      .max(30)
      .optional(),
    stages: z
      .array(
        z
          .object({
            id: workflowStageIdSchema,
            label: z.string().trim().min(1).max(80),
            required: z.boolean(),
            evidence: z
              .array(evidenceTypeSchema)
              .max(20)
              .optional(),
            checks: z
              .array(z.string().trim().min(1).max(500))
              .max(20)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    completion: z
      .object({
        requiredStages: z.array(workflowStageIdSchema).max(30),
      })
      .strict()
      .optional(),
    execution: z
      .object({
        checkpoints: z
          .array(
            z
              .object({
                key: workflowStageIdSchema,
                stage: workflowStageIdSchema,
                position: z.enum(["before", "after"]),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .transform(normalizeAutoHuntWorkflow);

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
const nullableTrimmed = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const httpsUrl = z
  .string()
  .url()
  .max(1_000)
  .refine(
    (value) => new URL(value).protocol === "https:",
    "HTTPS URL required",
  );
const trackerSchema = z
  .object({
    provider: z.string().trim().min(1).max(50),
    issueId: nullableTrimmed(200),
    identifier: nullableTrimmed(100),
    url: httpsUrl.nullable().optional(),
    state: nullableTrimmed(100),
  })
  .strict();

export const eventSchema = z
  .object({
    runId: z.string().uuid().nullable().optional(),
    source: z.enum(autoHuntSources).nullable().optional(),
    sourceKey: z.string().trim().min(1).max(200).nullable().optional(),
    title: z.string().trim().min(1).max(300).nullable().optional(),
    status: runStatusSchema,
    workflowStage: workflowStageIdSchema.nullable().optional(),
    eventKey: z.string().trim().min(1).max(300),
    occurredAt: z.string().datetime({ offset: true }),
    actor: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(500),
    detail: z.string().max(4_000).nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
    branch: nullableTrimmed(500),
    commitSha: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/u)
      .nullable()
      .optional(),
    tracker: trackerSchema.nullable().optional(),
    issueDescription: z.string().max(100_000).nullable().optional(),
    resultSummary: z.string().max(100_000).nullable().optional(),
    structuredResult: structuredAgentResultSchema.nullable().optional(),
    pullRequestUrls: z
      .array(httpsUrl)
      .max(20)
      .default([])
      .transform((urls) => [...new Set(urls)].sort()),
    targetSha: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/u)
      .nullable()
      .optional(),
    sourceCreatedAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    context: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.runId && (!input.source || !input.sourceKey || !input.title)) {
      context.addIssue({
        code: "custom",
        message: "source, sourceKey, and title are required without runId",
        path: ["runId"],
      });
    }
    if (input.status === "running" && !input.workflowStage) {
      context.addIssue({
        code: "custom",
        message: "running progress requires a workflow stage",
        path: ["workflowStage"],
      });
    }
    if (input.status === "blocked" && !input.detail?.trim()) {
      context.addIssue({
        code: "custom",
        message: "blocked progress requires technical blocker details",
        path: ["detail"],
      });
    }
    if (input.status === "blocked" && !input.structuredResult) {
      context.addIssue({
        code: "custom",
        message: "blocked progress requires a structured blocked result",
        path: ["structuredResult"],
      });
    }
    if (
      input.status === "blocked" &&
      input.structuredResult &&
      input.structuredResult.outcome !== "blocked"
    ) {
      context.addIssue({
        code: "custom",
        message: "blocked progress requires a blocked structured outcome",
        path: ["structuredResult", "outcome"],
      });
    }
    if (
      input.status === "blocked" &&
      input.structuredResult &&
      (!input.structuredResult.humanActionRequired ||
        !input.structuredResult.nextAction)
    ) {
      context.addIssue({
        code: "custom",
        message: "blocked progress requires an exact human next action",
        path: ["structuredResult", "nextAction"],
      });
    }
    if (input.status === "completed" && !input.structuredResult) {
      context.addIssue({
        code: "custom",
        message: "completed runs require a structured result",
        path: ["structuredResult"],
      });
    }
    if (
      input.status === "completed" &&
      input.structuredResult &&
      !["completed", "partial"].includes(input.structuredResult.outcome)
    ) {
      context.addIssue({
        code: "custom",
        message: "completed runs require a completed or partial outcome",
        path: ["structuredResult", "outcome"],
      });
    }
    if (
      input.resultSummary &&
      input.structuredResult &&
      input.resultSummary !== input.structuredResult.summary
    ) {
      context.addIssue({
        code: "custom",
        message: "resultSummary must match structuredResult.summary",
        path: ["resultSummary"],
      });
    }
    if (input.tracker?.provider === "linear" && input.tracker.url) {
      if (new URL(input.tracker.url).hostname !== "linear.app") {
        context.addIssue({
          code: "custom",
          message: "Linear tracker URLs must use linear.app",
          path: ["tracker", "url"],
        });
      }
    }
  });

export const runEvidenceInputSchema = z
  .object({
    evidenceKey: z.string().trim().min(1).max(300),
    stage: workflowStageIdSchema,
    type: evidenceTypeSchema,
    status: z.enum(["pending", "passed", "failed", "skipped"]),
    observedAt: z.string().datetime({ offset: true }),
    actor: z.string().trim().min(1).max(128),
    detail: z.string().max(100_000).nullable().optional(),
    command: z.string().trim().min(1).max(2_000).nullable().optional(),
    url: httpsUrl.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export async function readRunEvidenceRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return {
      input: runEvidenceInputSchema.parse(await readJson(request)),
      images: [] as File[],
    };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxEvidenceMultipartBytes) {
    throw new HttpError(413, "Evidence images exceed the 25MB total limit");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
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
  const rawImages = form.getAll("images");
  if (rawImages.some((image) => !(image instanceof File))) {
    throw new HttpError(400, "Evidence images must be files");
  }
  const images = rawImages as File[];
  const imageError = validateEvidenceImages(images);
  if (imageError) throw new HttpError(400, imageError);
  return { input: runEvidenceInputSchema.parse(input), images };
}

const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  organizationId: z.string().uuid().optional(),
});
const maxProjectIconDataUrlLength = 400_000;
const maxProjectIconRequestBytes = maxProjectIconDataUrlLength + 20;
export const projectIconInputSchema = z
  .object({
    icon: z
      .string()
      .max(maxProjectIconDataUrlLength)
      .regex(
        /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu,
      )
      .nullable(),
  })
  .strict();
export const projectIssueKeyPrefixInputSchema = z
  .object({
    issueKeyPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,3}$/u),
  })
  .strict();
const projectAgentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).nullable().optional(),
    avatar: z
      .string()
      .max(400_000)
      .regex(/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu)
      .nullable()
      .optional(),
    codexPet: z
      .object({
        slug: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/u),
      })
      .strict()
      .nullable()
      .optional(),
    provider: z.enum(["codex", "claude", "grok", "opencode"]),
    model: z.string().trim().min(1).max(100).nullable().optional(),
    effort: z
      .enum(["low", "medium", "high", "xhigh", "max", "ultra"])
      .nullable()
      .optional(),
    responsibility: z.string().trim().min(1).max(2_000),
    calendarColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-f]{6}$/iu)
      .default(defaultProjectAgentCalendarColor),
  })
  .strict();
const projectAgentSessionEventSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.enum([
      "started",
      "completed",
      "failed",
      "skipped",
      "interrupted",
      "stopped",
    ]),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
const projectAgentSessionIssueSchema = z
  .object({
    runId: z.string().min(1).max(128),
    runNumber: z.number().int().nonnegative(),
    sourceKey: z.string().min(1).max(500),
    title: z.string().min(1).max(500),
    outcome: z.enum([
      "pending",
      "completed",
      "blocked",
      "failed",
      "skipped",
    ]),
    summary: z.string().max(50_000).nullable(),
  })
  .strict();
export const projectAgentSessionInputSchema = z
  .object({
    dispatchGroupId: z.string().max(128),
    agentId: z.string().uuid().nullable(),
    sessionType: z.enum(["task", "dispatch"]),
    trigger: z.enum(["manual", "scheduled"]).nullable(),
    scheduleId: z.string().max(128).nullable(),
    scheduleRunId: z.string().max(128).nullable(),
    parentSessionId: z.string().max(128).nullable(),
    request: z.string().max(50_000).nullable(),
    status: z.enum(["running", "completed", "failed", "skipped", "interrupted"]),
    issues: z.array(projectAgentSessionIssueSchema).max(100),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    conversationId: z.string().max(128).nullable(),
    summary: z.string().max(50_000).nullable(),
    error: z.string().max(20_000).nullable(),
    events: z.array(projectAgentSessionEventSchema).max(200),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const projectAgentScheduleInputSchema = z
  .object({
    agentId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    recurrence: z.enum(projectAgentScheduleRecurrences),
    timeOfDay: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    intervalValue: z.number().int().min(1).max(999).optional(),
    intervalUnit: z.enum(projectAgentScheduleIntervalUnits).optional(),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .optional(),
    notificationLevel: z
      .enum(projectAgentScheduleNotificationLevels)
      .optional(),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidProjectAgentScheduleTimeZone, "Invalid IANA time zone"),
  })
  .strict()
  .superRefine((input, context) => {
    const intervalUnit =
      input.intervalUnit ??
      (input.recurrence === "interval"
        ? "hour"
        : input.recurrence === "custom"
          ? "week"
          : "day");
    if (
      input.recurrence === "interval" &&
      intervalUnit !== "minute" &&
      intervalUnit !== "hour"
    ) {
      context.addIssue({
        code: "custom",
        message: "Interval schedules use minutes or hours",
        path: ["intervalUnit"],
      });
    }
    if (
      input.recurrence === "custom" &&
      intervalUnit !== "day" &&
      intervalUnit !== "week"
    ) {
      context.addIssue({
        code: "custom",
        message: "Custom schedules repeat daily or weekly",
        path: ["intervalUnit"],
      });
    }
    if (
      input.recurrence === "custom" &&
      intervalUnit === "week" &&
      normalizeProjectAgentScheduleDays(input.daysOfWeek).length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose at least one weekday",
        path: ["daysOfWeek"],
      });
    }
  })
  .transform((input) => ({
    ...input,
    dayOfWeek: normalizeProjectAgentScheduleDay(
      input.recurrence,
      input.dayOfWeek,
    ),
    intervalValue: normalizeProjectAgentScheduleInterval(input.intervalValue),
    intervalUnit:
      input.intervalUnit ??
      (input.recurrence === "interval"
        ? "hour"
        : input.recurrence === "custom"
          ? "week"
          : "day"),
    daysOfWeek: normalizeProjectAgentScheduleDays(input.daysOfWeek),
    notificationLevel: input.notificationLevel ?? "important_updates",
  }));
const organizationInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  handle: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/u),
});

export const accountProfileInputSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/u),
  name: z.string().trim().min(1).max(100),
  image: z
    .string()
    .max(400_000)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,/u)
    .nullable(),
});
const inboxReadStateMaxEntries = 2_000;
const inboxReadStateMessageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(?:issue|session|conversation):.+$/u);
const inboxReadStateVersionSchema = z.string().trim().min(1).max(500);
export const inboxReadStatesInputSchema = z
  .object({
    readVersions: z
      .record(inboxReadStateMessageIdSchema, inboxReadStateVersionSchema)
      .default({}),
  })
  .strict()
  .superRefine((input, context) => {
    if (Object.keys(input.readVersions).length > inboxReadStateMaxEntries) {
      context.addIssue({
        code: "custom",
        message: `At most ${inboxReadStateMaxEntries} inbox read states are allowed`,
        path: ["readVersions"],
      });
    }
  });

export const accountDeletionInputSchema = z
  .object({
    confirmation: z.string().trim().email().max(320),
  })
  .strict();
export const organizationUpdateInputSchema = organizationInputSchema.pick({
  name: true,
});
export const organizationLogoInputSchema = z
  .object({
    logo: z
      .string()
      .max(400_000)
      .regex(/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu)
      .nullable(),
  })
  .strict();
const organizationHandleSchema = organizationInputSchema.shape.handle;
const organizationMemberInputSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "member"]).default("member"),
});
export const organizationInvitationInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum(["admin", "member"]).default("member"),
    initialProjectId: z.string().uuid(),
  })
  .strict();
export const organizationMemberRoleInputSchema = z
  .object({
    role: z.enum(["admin", "member"]),
  })
  .strict();
const slackOAuthInputSchema = z
  .object({
    defaultProjectId: z.string().uuid(),
  })
  .strict();
const slackInstallationUpdateSchema = slackOAuthInputSchema;

const providerModels = {
  codex: new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
  claude: new Set(["sonnet", "opus", "haiku", "fable"]),
  grok: new Set(["grok-4.5", "grok-build"]),
  opencode: new Set<string>(),
} as const;

const issueTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(issueTitleAbsoluteMaxLength)
  .superRefine((title, context) => {
    const message = issueTitleOverLimitMessage(title);
    if (message) {
      context.addIssue({ code: "custom", message });
    }
  });

const issueInputBaseSchema = z
  .object({
    title: issueTitleSchema,
    description: z.string().trim().max(100_000).nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
    assigneeUserId: z.string().trim().min(1).max(200).nullable().optional(),
    status: z.enum(["backlog", "queued"]).default("queued"),
    preferredProvider: z
      .enum(["codex", "claude", "grok", "opencode"])
      .nullable()
      .optional(),
    preferredModel: z.string().trim().min(1).max(100).nullable().optional(),
    preferredEffort: z
      .enum(["low", "medium", "high", "xhigh", "max", "ultra"])
      .nullable()
      .optional(),
    checkpoints: z.array(workflowCheckpointSchema).max(100).default([]),
  })
  .strict();

const issueInputSchema = issueInputBaseSchema.superRefine((input, context) => {
  if (!input.preferredProvider && input.preferredModel) {
    context.addIssue({
      code: "custom",
      message: "A provider is required for a model preference",
    });
  }
  if (!input.preferredProvider && input.preferredEffort) {
    context.addIssue({
      code: "custom",
      message: "A provider is required for an effort preference",
    });
  }
  if (!input.preferredModel && input.preferredEffort) {
    context.addIssue({
      code: "custom",
      message: "A model is required for an effort preference",
    });
  }
  if (
    input.preferredProvider &&
    input.preferredProvider !== "opencode" &&
    input.preferredModel &&
    !providerModels[input.preferredProvider].has(input.preferredModel)
  ) {
    context.addIssue({
      code: "custom",
      message: `${input.preferredModel} is not available from ${input.preferredProvider}`,
    });
  }
  if (input.preferredProvider === "claude" && input.preferredEffort === "ultra") {
    context.addIssue({
      code: "custom",
      message: "Claude does not support ultra effort",
    });
  }
  if (
    (input.preferredProvider === "grok" || input.preferredProvider === "opencode") &&
    input.preferredEffort &&
    !["low", "medium", "high"].includes(input.preferredEffort)
  ) {
    context.addIssue({
      code: "custom",
      message: `${input.preferredProvider} supports low, medium, or high effort`,
    });
  }
});

const ideaModelSchema = z.string().trim().min(1).max(100).nullable();
const ideaCreateInputSchema = z
  .object({
    provider: z.enum(ideaProviders),
    model: ideaModelSchema.default(null),
  })
  .strict();
const ideaUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    title: z.string().trim().min(1).max(300).optional(),
    documentMarkdown: ideaDocumentSchema.optional(),
    status: z.enum(["refining", "ready", "archived"]).optional(),
    provider: z.enum(ideaProviders).optional(),
    model: ideaModelSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.documentMarkdown !== undefined ||
      input.status !== undefined ||
      input.provider !== undefined ||
      input.model !== undefined,
    "At least one idea field is required",
  );
const ideaMessageInputSchema = z
  .object({ body: ideaMessageSchema })
  .strict();
const ideaPlanUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    items: ideaIssuePlanItemsSchema,
  })
  .strict();
const ideaConversionInputSchema = z
  .object({ planVersion: z.number().int().min(1) })
  .strict();
const ideaJobClaimInputSchema = z
  .object({ projectId: z.string().uuid(), workerId: z.string().uuid() })
  .strict();
const ideaJobLeaseInputSchema = ideaJobClaimInputSchema.extend({
  claimToken: z.string().startsWith("briar_idea_claim_"),
});
const ideaJobCompletionInputSchema = ideaJobLeaseInputSchema.extend({
  error: z.string().trim().min(1).max(4_000).optional(),
  result: z.unknown().optional(),
});

export const issueUpdateInputSchema = issueInputBaseSchema
  .pick({
    title: true,
    description: true,
    priority: true,
    assigneeUserId: true,
  })
  .required({
    title: true,
    description: true,
    priority: true,
  })
  .strict();

const modelEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

export const issueExecutionPreferencesSchema = z
  .object({
    provider: z.enum(["codex", "claude", "grok", "opencode"]).nullable(),
    model: z.string().trim().min(1).max(100).nullable(),
    effort: modelEffortSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.provider && (input.model || input.effort)) {
      context.addIssue({
        code: "custom",
        message: "A provider is required for a model or effort preference",
      });
    }
    if (!input.model && input.effort) {
      context.addIssue({
        code: "custom",
        message: "A model is required for an effort preference",
      });
    }
    if (
      input.provider &&
      input.provider !== "opencode" &&
      input.model &&
      !providerModels[input.provider].has(input.model)
    ) {
      context.addIssue({
        code: "custom",
        message: `${input.model} is not available from ${input.provider}`,
      });
    }
    if (input.provider === "claude" && input.effort === "ultra") {
      context.addIssue({
        code: "custom",
        message: "Claude does not support ultra effort",
      });
    }
    if (
      (input.provider === "grok" || input.provider === "opencode") &&
      input.effort &&
      !["low", "medium", "high"].includes(input.effort)
    ) {
      context.addIssue({
        code: "custom",
        message: `${input.provider} supports low, medium, or high effort`,
      });
    }
  });

const linearApiKeySchema = z
  .object({
    apiKey: z.string().trim().min(10).max(500),
  })
  .strict();

const linearStatesInputSchema = z
  .object({
    apiKey: z.string().trim().min(10).max(500),
    teamIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  })
  .strict();

const linearImportInputSchema = z
  .object({
    apiKey: z.string().trim().min(10).max(500),
    teamIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    statusMapping: z
      .record(
        z.string().trim().min(1).max(100),
        z.string().trim().min(1).max(100),
      )
      .refine((value) => Object.keys(value).length > 0, {
        message: "statusMapping is required",
      }),
  })
  .strict();

const issueMessageInputSchema = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    parentMessageId: z.string().uuid().nullable().optional(),
    mentionedUserIds: z.array(z.string().min(1).max(200)).max(50).optional(),
    agentConversationId: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .nullable()
      .optional(),
  })
  .strict();

export async function readIssueMessageRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return {
      input: issueMessageInputSchema.parse(await readJson(request, 16_384)),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
    };
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxIssueMultipartBytes) {
    throw new HttpError(413, "Message attachments exceed the 25MB total limit");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }
  const rawAttachments = form.getAll("attachments");
  if (rawAttachments.some((attachment) => !(attachment instanceof File))) {
    throw new HttpError(400, "Attachments must be files");
  }
  const attachments = rawAttachments as File[];
  const attachmentError = validateIssueAttachments(attachments);
  if (attachmentError) throw new HttpError(400, attachmentError);
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new HttpError(400, "Conversation attachments must be images");
  }
  const parseArray = (name: string) => {
    const value = form.get(name);
    if (typeof value !== "string" || !value) return [] as unknown[];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed;
    } catch {
      throw new HttpError(400, `${name} is invalid`);
    }
  };
  const attachmentReferences = parseArray("attachmentReferences");
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
  const mentionedUserIds = parseArray("mentionedUserIds");
  const parentMessageId = form.get("parentMessageId");
  const agentConversationId = form.get("agentConversationId");
  return {
    input: issueMessageInputSchema.parse({
      body: form.get("body"),
      parentMessageId:
        typeof parentMessageId === "string" && parentMessageId
          ? parentMessageId
          : null,
      mentionedUserIds,
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
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return {
      input: channelMessageInputSchema.parse(await readJson(request, 32_768)),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
    };
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxIssueMultipartBytes) {
    throw new HttpError(413, "Channel images exceed the 25MB total limit");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }
  const rawAttachments = form.getAll("attachments");
  if (rawAttachments.some((attachment) => !(attachment instanceof File))) {
    throw new HttpError(400, "Attachments must be files");
  }
  const attachments = rawAttachments as File[];
  const attachmentError = validateIssueAttachments(attachments);
  if (attachmentError) throw new HttpError(400, attachmentError);
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new HttpError(400, "Channel attachments must be images");
  }
  const parseArray = (name: string) => {
    const value = form.get(name);
    if (typeof value !== "string" || !value) return [] as unknown[];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed;
    } catch {
      throw new HttpError(400, `${name} is invalid`);
    }
  };
  const attachmentReferences = parseArray("attachmentReferences");
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
  return {
    input: channelMessageInputSchema.parse({
      body: rawBody,
      parentMessageId:
        typeof parentMessageId === "string" && parentMessageId
          ? parentMessageId
          : null,
      mentionedUserIds: parseArray("mentionedUserIds"),
      mentionedAgentIds: parseArray("mentionedAgentIds"),
    }),
    attachments,
    attachmentReferences: attachmentReferences as string[],
  };
}

const issueUpdateProposalActionSchema = z
  .object({
    type: z.literal("request_issue_update"),
    changes: z
      .object({
        title: issueTitleSchema.optional(),
        description: z.string().trim().max(100_000).nullable().optional(),
        priority: z.number().int().min(1).max(4).nullable().optional(),
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0, {
        message: "At least one issue change is required",
      }),
  })
  .strict();

const issueCreateProposalActionSchema = z
  .object({
    type: z.literal("request_issue_create"),
    issue: z
      .object({
        title: issueTitleSchema,
        description: z.string().trim().max(100_000).nullable(),
        priority: z.number().int().min(1).max(4).nullable(),
        status: z.enum(["backlog", "queued"]),
      })
      .strict(),
  })
  .strict();

const issueAgentProposedActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("request_issue_rework"),
      workflowStage: workflowStageIdSchema,
      reason: z.string().trim().min(1).max(4_000),
    })
    .strict(),
  issueUpdateProposalActionSchema,
  issueCreateProposalActionSchema,
]);

const issueAgentReplyCompletionSchema = z
  .object({
    projectId: z.string().uuid(),
    workerId: z.string().trim().min(1).max(128),
    claimToken: z.string().startsWith("briar_reply_claim_"),
    body: z.string().trim().min(1).max(10_000).optional(),
    proposedAction: issueAgentProposedActionSchema.nullable().optional(),
    error: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.body) !== Boolean(input.error), {
    message: "Provide exactly one of body or error",
  });

const issueAgentReplyLeaseSchema = z
  .object({
    projectId: z.string().uuid(),
    workerId: z.string().trim().min(1).max(128),
    claimToken: z.string().startsWith("briar_reply_claim_"),
  })
  .strict();

export async function readIssueRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return {
      input: issueInputSchema.parse(await readJson(request)),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
    };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxIssueMultipartBytes) {
    throw new HttpError(413, "Issue attachments exceed the 25MB total limit");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }
  const rawAttachments = form.getAll("attachments");
  if (rawAttachments.some((attachment) => !(attachment instanceof File))) {
    throw new HttpError(400, "Attachments must be files");
  }
  const attachments = rawAttachments as File[];
  const attachmentError = validateIssueAttachments(attachments);
  if (attachmentError) throw new HttpError(400, attachmentError);

  const rawAttachmentReferences = form.get("attachmentReferences");
  let attachmentReferences: string[] = [];
  if (typeof rawAttachmentReferences === "string" && rawAttachmentReferences) {
    try {
      const parsed: unknown = JSON.parse(rawAttachmentReferences);
      if (
        !Array.isArray(parsed) ||
        parsed.length !== attachments.length ||
        !parsed.every(isIssueAttachmentReference)
      ) {
        throw new Error("invalid attachment references");
      }
      attachmentReferences = parsed;
    } catch {
      throw new HttpError(400, "Attachment references are invalid");
    }
  }

  const description = form.get("description");
  const priority = form.get("priority");
  const assigneeUserId = form.get("assigneeUserId");
  const status = form.get("status");
  const preferredProvider = form.get("preferredProvider");
  const preferredModel = form.get("preferredModel");
  const preferredEffort = form.get("preferredEffort");
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
    input: issueInputSchema.parse({
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
      checkpoints,
    }),
    attachments,
    attachmentReferences,
  };
}

const issueKeptAttachmentIdsSchema = z.array(z.string().uuid()).max(50);

export async function readIssueUpdateRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    const raw = await readJson(request);
    const { keptAttachmentIds, ...fields } = (raw ?? {}) as {
      keptAttachmentIds?: unknown;
      [key: string]: unknown;
    };
    return {
      input: issueUpdateInputSchema.parse(fields),
      attachments: [] as File[],
      attachmentReferences: [] as string[],
      keptAttachmentIds:
        keptAttachmentIds === undefined
          ? undefined
          : issueKeptAttachmentIdsSchema.parse(keptAttachmentIds),
    };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxIssueMultipartBytes) {
    throw new HttpError(413, "Issue attachments exceed the 25MB total limit");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }
  const rawAttachments = form.getAll("attachments");
  if (rawAttachments.some((attachment) => !(attachment instanceof File))) {
    throw new HttpError(400, "Attachments must be files");
  }
  const attachments = rawAttachments as File[];
  const attachmentError = validateIssueAttachments(attachments);
  if (attachmentError) throw new HttpError(400, attachmentError);

  const rawAttachmentReferences = form.get("attachmentReferences");
  let attachmentReferences: string[] = [];
  if (typeof rawAttachmentReferences === "string" && rawAttachmentReferences) {
    try {
      const parsed: unknown = JSON.parse(rawAttachmentReferences);
      if (
        !Array.isArray(parsed) ||
        parsed.length !== attachments.length ||
        !parsed.every(isIssueAttachmentReference)
      ) {
        throw new Error("invalid attachment references");
      }
      attachmentReferences = parsed;
    } catch {
      throw new HttpError(400, "Attachment references are invalid");
    }
  }

  const rawKeptAttachmentIds = form.get("keptAttachmentIds");
  let keptAttachmentIds: string[] | undefined;
  if (typeof rawKeptAttachmentIds === "string" && rawKeptAttachmentIds) {
    try {
      const parsed: unknown = JSON.parse(rawKeptAttachmentIds);
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
        throw new Error("invalid kept attachment ids");
      }
      keptAttachmentIds = issueKeptAttachmentIdsSchema.parse(parsed);
    } catch {
      throw new HttpError(400, "Kept attachment IDs are invalid");
    }
  }

  const description = form.get("description");
  const priority = form.get("priority");
  const assigneeUserId = form.get("assigneeUserId");
  return {
    input: issueUpdateInputSchema.parse({
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

const claimInputSchema = z
  .object({
    claimedBy: z.string().trim().min(1).max(128),
    workerId: z.string().trim().min(1).max(128).optional(),
    projectId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
  })
  .strict();

const providerHealthSchema = z.record(
  z.enum(["codex", "claude", "grok", "opencode"]),
  z
    .object({
      installed: z.boolean(),
      authenticated: z.boolean(),
      healthy: z.boolean(),
      reason: z.string().trim().max(64).nullable().optional(),
    })
    .strict(),
);

const workerRegisterSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    deviceIdentity: z.string().regex(/^briar_device_[0-9a-f]{64}$/u),
    agentProvider: z.enum(["codex", "claude", "grok", "opencode"]),
    providers: z
      .array(z.enum(["codex", "claude", "grok", "opencode"]))
      .max(4)
      .optional(),
    providerHealth: providerHealthSchema.optional(),
    maxConcurrentSessions: z
      .number()
      .int()
      .min(1)
      .max(MAX_WORKER_CONCURRENT_SESSIONS)
      .optional(),
    versions: z.record(z.string().max(64), z.string().max(64)).default({}),
  })
  .strict();

const workerBindSchema = workerRegisterSchema.pick({
  deviceIdentity: true,
  agentProvider: true,
  providers: true,
  providerHealth: true,
  versions: true,
});

const workerConcurrencySchema = z
  .object({
    maxConcurrentSessions: z
      .number()
      .int()
      .min(1)
      .max(MAX_WORKER_CONCURRENT_SESSIONS),
  })
  .strict();

const workerIconSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("emoji"),
      value: z
        .string()
        .trim()
        .min(1)
        .max(maxWorkerEmojiLength)
        .refine(isWorkerEmoji, "Worker emoji must be one emoji"),
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      value: z
        .string()
        .max(maxWorkerLogoDataUrlLength)
        .refine(isWorkerLogoDataUrl, "Worker image must be a supported data URL"),
    })
    .strict(),
]);

export const workerSettingsSchema = z
  .object({
    maxConcurrentSessions: workerConcurrencySchema.shape.maxConcurrentSessions
      .optional(),
    icon: workerIconSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.maxConcurrentSessions !== undefined || input.icon !== undefined,
    "At least one Worker setting is required",
  );

const executionWorkerPolicySchema = z
  .object({
    selectionMode: z.enum(["any", "allowlist"]),
    defaultWorkerId: z.string().trim().min(1).max(128).nullable(),
    allowedWorkerIds: z
      .array(z.string().trim().min(1).max(128))
      .max(100)
      .default([]),
  })
  .strict();

const workerHeartbeatSchema = z
  .object({
    versions: z.record(z.string().max(64), z.string().max(64)).optional(),
    acceptingWork: z.boolean().optional(),
    readinessState: z.enum(["ready", "busy", "needs_attention"]).optional(),
    readinessDetail: z.string().trim().max(500).nullable().optional(),
    capabilities: z.record(z.string().max(64), z.unknown()).optional(),
  })
  .strict();

const workerLabelSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
  })
  .strict();

const dispatchRunSchema = z
  .object({
    agentId: z.string().uuid().nullable().optional(),
    provider: z.enum(["codex", "claude", "grok", "opencode"]).optional(),
    model: z.string().trim().min(1).max(100).nullable().optional(),
    effort: modelEffortSchema.nullable().optional(),
    persistPreferences: z.boolean().optional(),
    workerId: z.string().trim().min(1).max(128).nullable().optional(),
    requestId: z.string().uuid(),
  })
  .strict()
  .superRefine((input, context) => {
    const preferences = {
      provider: input.provider ?? null,
      model: input.model ?? null,
      effort: input.effort ?? null,
    };
    const parsed = issueExecutionPreferencesSchema.safeParse(preferences);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
      }
    }
  });

const leaseRenewSchema = z
  .object({
    claimToken: z.string().trim().min(1).max(200),
    projectId: z.string().uuid().optional(),
  })
  .strict();

const projectAgentScheduleClaimTokenSchema = z
  .string()
  .trim()
  .regex(/^briar_schedule_claim_[0-9a-f]{64}$/u);

const projectAgentScheduleRunRenewSchema = z
  .object({ claimToken: projectAgentScheduleClaimTokenSchema })
  .strict();

export const projectAgentScheduleRunCompletionSchema = z
  .object({
    claimToken: projectAgentScheduleClaimTokenSchema,
    status: z.enum(["completed", "failed"]),
    resultSummary: z.string().trim().min(1).max(100_000).nullable().optional(),
    structuredResult: structuredAgentResultSchema,
    error: z.string().trim().min(1).max(4_000).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "completed" && !input.resultSummary) {
      context.addIssue({
        code: "custom",
        message: "completed runs require a result summary",
        path: ["resultSummary"],
      });
    }
    if (
      input.resultSummary &&
      input.resultSummary !== input.structuredResult.summary
    ) {
      context.addIssue({
        code: "custom",
        message: "resultSummary must match structuredResult.summary",
        path: ["resultSummary"],
      });
    }
    if (input.status === "completed" && input.structuredResult.outcome === "failed") {
      context.addIssue({
        code: "custom",
        message: "completed schedule runs cannot report a failed outcome",
        path: ["structuredResult", "outcome"],
      });
    }
    if (input.status === "failed" && input.structuredResult.outcome !== "failed") {
      context.addIssue({
        code: "custom",
        message: "failed schedule runs require a failed structured outcome",
        path: ["structuredResult", "outcome"],
      });
    }
    if (input.status === "failed" && !input.error) {
      context.addIssue({
        code: "custom",
        message: "failed runs require an error",
        path: ["error"],
      });
    }
  });

export const transcriptSchema = z
  .object({
    sessionId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/u),
    runId: z.string().uuid().nullable().optional(),
    runAttempt: z.number().int().positive().optional(),
    projectId: z.string().uuid().optional(),
    workerId: z.string().trim().min(1).max(128).nullable().optional(),
    agentProvider: z.enum(["codex", "claude", "grok", "opencode"]),
    executionMetrics: agentExecutionMetricsSchema.optional(),
    events: z
      .array(
        z
          .object({
            sequence: z.number().int().positive(),
            direction: z.enum(["client", "server"]),
            payload: z.unknown(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_TRANSCRIPT_EVENTS_PER_REQUEST),
  })
  .strict()
  .refine(
    (input) =>
      input.executionMetrics === undefined ||
      (Boolean(input.runId) && input.runAttempt !== undefined),
    {
      message: "runId and runAttempt are required with executionMetrics",
      path: ["executionMetrics"],
    },
  );

const recoveryUserInputSchema = z
  .object({
    requestId: z.string().uuid(),
    reason: z.string().trim().min(1).max(4_000).nullable().optional(),
  })
  .strict();

const recoveryAgentInputSchema = recoveryUserInputSchema.extend({
  actor: z.string().trim().min(1).max(128),
});

const resumeInputShape = z.object({
  requestId: z.string().uuid(),
  checkpointKey: workflowStageIdSchema.optional(),
  attempt: z.number().int().positive().optional(),
  revision: z.number().int().positive().optional(),
}).strict();

const validateResumeInput = (input: {
  checkpointKey?: string;
  attempt?: number;
  revision?: number;
}, context: z.RefinementCtx) => {
  const hasIdentity = input.checkpointKey !== undefined ||
    input.attempt !== undefined || input.revision !== undefined;
  if (hasIdentity &&
    (input.checkpointKey === undefined ||
      input.attempt === undefined ||
      input.revision === undefined)) {
    context.addIssue({
      code: "custom",
      message: "checkpointKey, attempt, and revision must be supplied together",
      path: ["checkpointKey"],
    });
  }
};

const resumeUserInputSchema = resumeInputShape
  .superRefine(validateResumeInput);

const resumeAgentInputSchema = resumeInputShape
  .extend({ actor: z.string().trim().min(1).max(128) })
  .superRefine(validateResumeInput)
  .strict();

export const workflowStageLifecycleInputSchema = z
  .object({
    requestId: z.string().uuid(),
    attempt: z.number().int().positive().optional(),
    revision: z.number().int().positive().optional(),
    actor: z.string().trim().min(1).max(128),
  })
  .strict();

export const runReworkInputSchema = z
  .object({
    requestId: z.string().uuid(),
    workflowStage: workflowStageIdSchema,
    reason: z.string().trim().min(1).max(4_000),
    actor: z.string().trim().min(1).max(128),
  })
  .strict();

export const pausedRunReworkInputSchema = z
  .object({
    requestId: z.string().uuid(),
    workflowStage: workflowStageIdSchema,
    reason: z.string().trim().min(1).max(4_000),
    checkpointKey: workflowStageIdSchema,
    attempt: z.number().int().positive(),
    revision: z.number().int().positive(),
  })
  .strict();

const moveRunInputSchema = z
  .object({
    requestId: z.string().uuid(),
    status: runStatusSchema,
    workflowStage: workflowStageIdSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "running" && !input.workflowStage) {
      context.addIssue({
        code: "custom",
        message: "running status requires a workflow stage",
        path: ["workflowStage"],
      });
    }
    if (input.status !== "running" && input.workflowStage !== null) {
      context.addIssue({
        code: "custom",
        message: "only running status can select a workflow stage",
        path: ["workflowStage"],
      });
    }
  });

const projectSettingsSchema = z
  .object({
    velenOrg: nullableTrimmed(100),
    dataSource: nullableTrimmed(300),
    linear: z
      .object({
        enabled: z.boolean(),
        source: z
          .string()
          .trim()
          .regex(/^linear:\/\/.+/u)
          .max(300)
          .nullable(),
        teamKey: z.string().trim().min(1).max(100).nullable(),
      })
      .strict(),
    githubRepository: nullableTrimmed(300),
    workflow: workflowSchema.default(cloneAutoHuntWorkflow()),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.dataSource && !input.velenOrg) {
      context.addIssue({
        code: "custom",
        message: "Velen data source requires a Velen org",
        path: ["dataSource"],
      });
    }
    if (input.linear.enabled && (!input.velenOrg || !input.linear.source)) {
      context.addIssue({
        code: "custom",
        message: "Linear integration requires a Velen org and Linear source",
        path: ["linear"],
      });
    }
  });

export function parseProjectSettingsInput(value: unknown) {
  try {
    return projectSettingsSchema.parse(value);
  } catch (error) {
    if (
      error instanceof z.ZodError &&
      error.issues.some((issue) => issue.path[0] === "workflow")
    ) {
      throw new ProjectWorkflowInputError(error.issues);
    }
    if (error instanceof AutoHuntWorkflowValidationError) {
      throw new ProjectWorkflowInputError(error.issues);
    }
    throw error;
  }
}

const checkpointPolicyInputSchema = z
  .object({
    scope: z.enum(["project", "user"]),
    checkpoints: z.array(workflowCheckpointSchema).max(100),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

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

const pngResponse = (png: ArrayBuffer) =>
  new Response(png, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  });

const contentDisposition = (filename: string) =>
  `inline; filename*=UTF-8''${encodeURIComponent(filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;

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
  return new Response(body, { headers });
};

async function createIssueWithAttachments(input: {
  db: D1Database;
  attachmentsBucket: R2Bucket;
  project: Pick<ProjectRow, "id" | "name">;
  issue: z.infer<typeof issueInputSchema>;
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
  const storedAttachments: Array<IssueAttachmentInput & { file: File }> =
    input.attachments.map((file) => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.project.id}/${issueStorageId}/${id}`,
        filename: file.name.normalize("NFC").trim(),
        content_type: file.type,
        byte_size: file.size,
        file,
      };
    });
  const uploadedKeys: string[] = [];
  const issueDescription = canonicalizeIssueAttachmentReferences(
    input.issue.description,
    input.attachmentReferences ?? [],
    storedAttachments.map((attachment) => attachment.id),
  );
  let runId: string | null = null;
  try {
    for (const attachment of storedAttachments) {
      await input.attachmentsBucket.put(
        attachment.object_key,
        attachment.file.stream(),
        {
          httpMetadata: {
            contentType: attachment.content_type,
            contentDisposition: contentDisposition(attachment.filename),
          },
          customMetadata: {
            attachmentId: attachment.id,
            projectId: input.project.id,
          },
        },
      );
      uploadedKeys.push(attachment.object_key);
    }
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
      },
      createdByUserId: input.createdByUserId,
      preferredAgentProvider: input.issue.preferredProvider ?? null,
      preferredAgentModel: input.issue.preferredModel ?? null,
      preferredAgentEffort: input.issue.preferredEffort ?? null,
    });
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
        await input.attachmentsBucket.delete(uploadedKeys);
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
  issue: z.infer<typeof issueUpdateInputSchema>;
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
  const storedAttachments: Array<IssueAttachmentInput & { file: File }> =
    input.attachments.map((file) => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.project.id}/${input.runId}/${id}`,
        filename: file.name.normalize("NFC").trim(),
        content_type: file.type,
        byte_size: file.size,
        file,
      };
    });
  const uploadedKeys: string[] = [];
  const issueDescription = canonicalizeIssueAttachmentReferences(
    input.issue.description,
    input.attachmentReferences ?? [],
    storedAttachments.map((attachment) => attachment.id),
  );
  try {
    for (const attachment of storedAttachments) {
      await input.attachmentsBucket.put(
        attachment.object_key,
        attachment.file.stream(),
        {
          httpMetadata: {
            contentType: attachment.content_type,
            contentDisposition: contentDisposition(attachment.filename),
          },
          customMetadata: {
            attachmentId: attachment.id,
            projectId: input.project.id,
          },
        },
      );
      uploadedKeys.push(attachment.object_key);
    }
    const run = await updateIssue(input.db, input.project.id, input.runId, {
      title: input.issue.title,
      description: issueDescription ?? null,
      priority: input.issue.priority ?? null,
      assigneeUserId: input.issue.assigneeUserId,
      updatedAt: input.updatedAt,
    });
    if (!run) throw new HttpError(404, "Run not found");
    await createIssueAttachments(
      input.db,
      input.project.id,
      input.runId,
      storedAttachments.map(({ file: _file, ...attachment }) => attachment),
    );
    if (removed.length > 0) {
      await deleteIssueAttachments(
        input.db,
        input.project.id,
        input.runId,
        removed.map((attachment) => attachment.id),
      );
      await Promise.all(
        removed.map((attachment) =>
          input.attachmentsBucket.delete(attachment.object_key),
        ),
      ).catch(() => undefined);
    }
    return run;
  } catch (error) {
    if (uploadedKeys.length > 0) {
      await Promise.all(
        uploadedKeys.map((objectKey) =>
          input.attachmentsBucket.delete(objectKey),
        ),
      ).catch(() => undefined);
      await deleteIssueAttachments(
        input.db,
        input.project.id,
        input.runId,
        storedAttachments.map((attachment) => attachment.id),
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

const devicePage = (
  apiOrigin: string,
  client: "desktop" | "mobile" | "web",
) => {
  const mobileCompanion = client === "mobile";
  const webApp = client === "web";
  const copy = mobileCompanion
    ? {
        eyebrow: "MOBILE COMPANION",
        title: "Companion 로그인 승인",
        description:
          "Google 계정으로 로그인한 뒤 이 기기의 Briar Companion 로그인을 승인하세요.",
        approve: "이 기기에서 로그인하기",
      }
    : webApp
      ? {
          eyebrow: "BRIAR FOR WEB",
          title: "웹 로그인 승인",
          description:
            "Google 계정으로 로그인한 뒤 열려 있는 Briar 웹 로그인을 승인하세요.",
          approve: "웹에서 로그인하기",
        }
      : {
          eyebrow: "DEVICE AUTHORIZATION",
          title: "데스크톱 연결 승인",
          description:
            "Google 계정으로 로그인한 뒤 Briar 데스크톱의 접근을 승인하세요.",
          approve: "이 기기 승인하기",
        };

  return new Response(
    `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="/brand/briar-icon.png"><title>Briar 로그인</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(390px,calc(100vw - 32px));padding:30px;border:1px solid #282a30;border-radius:14px;background:#111318;box-shadow:0 30px 100px #0008}.brand{display:flex;align-items:center;gap:10px;font-weight:750;font-size:20px}.brand img{width:26px;height:26px;display:block;border-radius:6px}.eyebrow{margin-top:32px;color:#8979cf;font:500 10px monospace;letter-spacing:1px}.code{margin:18px 0;padding:15px;border:1px solid #332e49;border-radius:8px;background:#171420;text-align:center;font:600 26px monospace;letter-spacing:4px}.copy{color:#838792;font-size:12px;line-height:1.6}.actions{display:grid;gap:8px;margin-top:22px}button{height:42px;border:1px solid #34363d;border-radius:8px;background:#f4f4f5;color:#18191d;font-weight:650;cursor:pointer}button.secondary{background:#191b20;color:#aaaeb8}.status{min-height:18px;margin-top:12px;color:#777b86;font-size:11px;text-align:center}</style></head>
<body><main class="card"><div class="brand"><img src="/brand/briar-icon.png" alt="">briar</div><p class="eyebrow">${copy.eyebrow}</p><h1>${copy.title}</h1><p class="copy">${copy.description}</p><div class="code" id="code">--------</div><div class="actions"><button id="google">Google로 로그인</button><button id="approve" hidden>${copy.approve}</button><button id="deny" class="secondary" hidden>거절</button></div><div class="status" id="status"></div></main>
<script>
const base=${JSON.stringify(apiOrigin)};const mobileCompanion=${JSON.stringify(mobileCompanion)};const webApp=${JSON.stringify(webApp)};const returnUrl='briar-companion://auth-complete';const params=new URLSearchParams(location.search);const switchAccount=params.get('switch_account')==='1';const code=(params.get('user_code')||'').replace(/-/g,'').toUpperCase();const callbackParams=new URLSearchParams({user_code:code});if(mobileCompanion)callbackParams.set('client','mobile');if(webApp)callbackParams.set('client','web');const callbackUrl=base+'/device?'+callbackParams.toString();document.querySelector('#code').textContent=code||'코드 없음';const status=document.querySelector('#status');const google=document.querySelector('#google');const approve=document.querySelector('#approve');const deny=document.querySelector('#deny');
async function api(path,options={}){const response=await fetch(base+'/api/auth'+path,{credentials:'include',headers:{'content-type':'application/json'},...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error_description||'요청에 실패했습니다.');return data}
async function beginGoogle(){status.textContent='Google 로그인 페이지를 여는 중…';try{const data=await api('/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',callbackURL:callbackUrl,...(switchAccount?{additionalParams:{prompt:'select_account'}}:{})})});location.href=data.url}catch(error){status.textContent=error.message}}
async function boot(){if(!code){status.textContent='유효한 기기 코드가 없습니다.';google.hidden=true;return}if(switchAccount){google.hidden=true;await beginGoogle();return}const session=await api('/get-session').catch(()=>null);if(!session?.user){status.textContent='먼저 Google 계정으로 로그인하세요.';return}google.hidden=true;await api('/device?user_code='+encodeURIComponent(code));approve.hidden=false;deny.hidden=false;status.textContent=session.user.email+' 계정으로 연결합니다.'}
google.onclick=beginGoogle;
approve.onclick=async()=>{try{await api('/device/approve',{method:'POST',body:JSON.stringify({userCode:code})});approve.hidden=true;deny.hidden=true;if(mobileCompanion){status.textContent='승인되었습니다. Briar Companion으로 돌아갑니다…';window.setTimeout(()=>location.replace(returnUrl),250)}else if(webApp){status.textContent='승인되었습니다. Briar 웹 탭으로 돌아가세요.';window.setTimeout(()=>window.close(),800)}else{status.textContent='승인되었습니다. Briar 앱으로 돌아가세요.'}}catch(error){status.textContent=error.message}};
deny.onclick=async()=>{try{await api('/device/deny',{method:'POST',body:JSON.stringify({userCode:code})});status.textContent='요청을 거절했습니다.'}catch(error){status.textContent=error.message}};void boot();
</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
};

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
  resource: "issues" | "sessions",
  projectId: string,
  targetId: string,
  head: boolean,
) => {
  const appUrl = `briar-companion://${resource}/${projectId}/${targetId}`;
  const subject = resource === "issues" ? "이슈" : "세션";
  const subjectWithParticle = resource === "issues" ? "이슈를" : "세션을";
  const englishSubject = resource === "issues" ? "issue" : "session";
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
    agent_provider: "codex" | "claude" | "grok" | "opencode";
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
 * Channel work is organization work, so a device only has to prove it belongs
 * to the organization. Whether it may run a particular job is decided per job:
 * organization Agents need nothing more, project Agents still need a binding.
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

async function requireWorkerProjectBinding(
  db: D1Database,
  request: Request,
  projectId: string,
  workerId?: string,
) {
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
    responsibility: row.responsibility,
    skill: row.skill_markdown,
    calendarColor: row.calendar_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const projectAgentSessionJson = (row: {
  project_id: string;
  id: string;
  payload_json: string;
}) => ({
  id: row.id,
  projectId: row.project_id,
  ...(JSON.parse(row.payload_json) as Record<string, unknown>),
  workspaceRoot: null,
  dispatchEvents: [],
  workers: [],
});

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
    responsibility: row.agent_responsibility,
    skill: row.agent_skill_markdown,
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
    const processing = processSlackAppMention(env, payload);
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

const parseJsonArray = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
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
  const result = structuredAgentResultSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

const parseExecutionMetrics = (value: string | null) => {
  const result = agentExecutionMetricsSchema.safeParse(parseJsonObject(value));
  return result.success ? result.data : null;
};

const dashboardEventJson = (event: HuntEventRow) => ({
  id: event.id,
  attempt: event.attempt,
  revision: event.revision,
  status: event.status,
  workflowStage: event.workflow_stage,
  detail: event.detail,
  actor: event.actor,
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
    acceptedAt: proposal.accepted_at,
    resultRunId: proposal.result_run_id,
  };
};

type IssueProposalRow = IssueReworkProposalRow | IssueActionProposalRow;

const issueProposalJson = (proposal: IssueProposalRow) =>
  "action_type" in proposal
    ? issueActionProposalJson(proposal)
    : issueReworkProposalJson(proposal);

const issueMessageJson = (
  message: IssueMessageRow,
  attachments: IssueAttachmentRow[] = [],
  proposal: IssueProposalRow | null = null,
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
    id: message.author_agent_provider ? null : message.author_user_id,
    name: message.author_agent_provider
      ? `Briar · ${
          message.author_agent_provider === "codex"
            ? "Codex"
            : message.author_agent_provider === "grok"
              ? "Grok"
              : "Claude"
        }`
      : (message.author_name ?? "알 수 없는 사용자"),
    image: message.author_agent_provider ? null : message.author_image,
    provider: message.author_agent_provider,
  },
  replyCount: message.reply_count,
  proposedAction: proposal ? issueProposalJson(proposal) : null,
  createdAt: message.created_at,
  updatedAt: message.updated_at,
});

const issueAgentReplyJson = (job: IssueAgentReplyJobRow) => ({
  id: job.id,
  triggerMessageId: job.trigger_message_id,
  status: job.status,
  workerId: job.claimed_worker_id,
  provider: job.agent_provider,
  error: job.status === "failed" ? job.error : null,
  updatedAt: job.updated_at,
});

const issueReplyTranscriptPayload = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.type === "result" || payload.type === "error") return payload;
  const normalized =
    payload.event && typeof payload.event === "object"
      ? (payload.event as Record<string, unknown>)
      : null;
  if (
    payload.type === "event" &&
    normalized?.type === "messageCompleted"
  ) {
    return payload;
  }
  const item =
    payload.item && typeof payload.item === "object"
      ? (payload.item as Record<string, unknown>)
      : null;
  return payload.type === "item.completed" && item?.type === "agent_message"
    ? payload
    : null;
};

const issueConversationNotificationJson = (
  notification: IssueConversationNotificationRow,
) => ({
  id: notification.id,
  runId: notification.run_id,
  runTitle: notification.run_title,
  rootMessageId: notification.root_message_id,
  body: notification.body,
  author: issueMessageJson(notification).author,
  reason: notification.notification_reason,
  createdAt: notification.created_at,
});

export const claimConversationJson = (messages: IssueMessageRow[]) =>
  messages.map((message) => issueMessageJson(message));

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
    detail: run.detail,
    priority: run.priority,
    assigneeUserId: run.assignee_user_id,
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
    context: parseJsonObject(run.context_json),
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
  input: z.infer<typeof resumeUserInputSchema>,
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
  if (input.checkpointKey) {
    return resumeWorkflowCheckpoint(db, projectId, {
      runId,
      checkpointKey: input.checkpointKey,
      attempt: input.attempt!,
      revision: input.revision!,
      requestId: input.requestId,
      actor,
      approvedAt: new Date().toISOString(),
    });
  }
  if (run.waiting_checkpoint_key) {
    const rawWorkflow = JSON.parse(run.workflow_snapshot_json) as { version?: number };
    if (rawWorkflow.version === 2) {
      throw new HttpError(
        400,
        "checkpointKey, attempt, and revision are required for workflow v2",
        "CHECKPOINT_IDENTITY_REQUIRED",
      );
    }
    return resumeWorkflowCheckpoint(db, projectId, {
      runId,
      checkpointKey: run.waiting_checkpoint_key,
      attempt: run.current_attempt,
      revision: run.waiting_checkpoint_revision ?? run.current_revision,
      requestId: input.requestId,
      actor,
      approvedAt: new Date().toISOString(),
    });
  }
  const legacy = await resumeHuntRun(db, projectId, {
    runId,
    requestId: input.requestId,
    actor,
    occurredAt: new Date().toISOString(),
  });
  const workflow = normalizeAutoHuntWorkflow(
    JSON.parse(run.workflow_snapshot_json),
  );
  const terminalReviewOnly = legacy.outcome !== "not_found" &&
    run.workflow_stage === workflow.stages.at(-1)?.id;
  return {
    ...legacy,
    checkpointKey: null,
    attempt: run.current_attempt,
    revision: run.current_revision,
    nextStage: terminalReviewOnly ? null : legacy.workflowStage,
    terminalReviewOnly,
  };
}

async function route(
  request: Request,
  auth: BriarAuth,
  db: D1Database,
  attachmentsBucket: R2Bucket,
  env: Env,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/auth/")) {
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  if (pathname === "/me" && request.method === "GET") {
    const session = await requireSession(auth, request);
    return json(mobileCurrentUserResponseSchema.parse({ user: session.user }));
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
    const input = inboxReadStatesInputSchema.parse(await readJson(request));
    const entries = Object.entries(input.readVersions).map(
      ([messageId, version]) => ({ messageId, version }),
    );
    if (entries.length > inboxReadStateMaxEntries) {
      throw new HttpError(400, "Too many inbox read states");
    }
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

  if (pathname === "/me" && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const input = accountProfileInputSchema.parse(
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
    const input = accountDeletionInputSchema.parse(await readJson(request));
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

    const cleanupPlans = await Promise.all(
      plan.projectIds.map(async (projectId) => {
        const [attachments, evidenceImages, archivedObjects, agents] =
          await Promise.all([
            listIssueAttachments(db, projectId),
            listRunEvidenceImages(db, projectId),
            listArchiveObjectsForDeletion(db, projectId),
            listProjectAgents(db, projectId),
          ]);
        return {
          projectId,
          objects: {
            archives: [...new Set(archivedObjects.archives)],
            attachments: [
              ...new Set([
                ...archivedObjects.attachments,
                ...attachments.map((attachment) => attachment.object_key),
                ...(evidenceImages ?? []).map((image) => image.object_key),
                ...agents.flatMap((agent) =>
                  agent.avatar_spritesheet_object_key
                    ? [agent.avatar_spritesheet_object_key]
                    : [],
                ),
              ]),
            ],
          },
        };
      }),
    );
    const observedAt = new Date().toISOString();
    for (const cleanup of cleanupPlans) {
      await enqueueArchiveCleanup(
        db,
        cleanup.projectId,
        null,
        cleanup.objects,
        observedAt,
      );
    }

    const slackInstallations = (
      await Promise.all(
        plan.organizationIds.map((organizationId) =>
          listSlackInstallations(db, organizationId),
        ),
      )
    ).flat();
    if (slackConfigAvailable(env)) {
      for (const installation of slackInstallations) {
        try {
          const token = await decryptSlackToken(
            installation.encrypted_bot_token,
            installation.token_iv,
            env.SLACK_TOKEN_ENCRYPTION_KEY,
          );
          await callSlackApi("auth.revoke", token, { test: false });
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "Slack token revoke failed during account deletion",
              error: error instanceof Error ? error.message : String(error),
              teamId: installation.team_id,
            }),
          );
        }
      }
    }

    const deleted = await deleteAccountData(db, {
      userId: session.user.id,
      email: session.user.email,
      organizationIds: plan.organizationIds,
    });
    if (!deleted) {
      for (const cleanup of cleanupPlans) {
        await cancelArchiveCleanup(db, cleanup.objects);
      }
      throw new HttpError(404, "Account not found");
    }
    await processArchiveCleanupQueue(
      db,
      env.ARCHIVES,
      attachmentsBucket,
      observedAt,
      1_000,
    );
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const projectIdeasMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/ideas$/u,
  );
  if (projectIdeasMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectIdeasMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    return json({ ideas: await listIdeas(db, project.id) });
  }
  if (projectIdeasMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectIdeasMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = ideaCreateInputSchema.parse(await readJson(request));
    const idea = await createIdea(db, {
      id: crypto.randomUUID(),
      organizationId: project.organization_id,
      projectId: project.id,
      authorUserId: session.user.id,
      provider: input.provider,
      model: input.model,
      title: "새 아이디어",
      createdAt: new Date().toISOString(),
    });
    return json({ idea }, 201);
  }

  const ideaMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/ideas\/([0-9a-f-]+)$/u,
  );
  if (ideaMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const idea = await getIdea(db, project.id, ideaMatch[2], session.user.id);
    if (!idea) throw new HttpError(404, "Idea not found");
    return json({ idea });
  }
  if (ideaMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = ideaUpdateInputSchema.parse(await readJson(request, 220_000));
    const outcome = await updateIdea(db, {
      projectId: project.id,
      ideaId: ideaMatch[2],
      authorUserId: session.user.id,
      expectedVersion: input.expectedVersion,
      title: input.title,
      documentMarkdown: input.documentMarkdown,
      status: input.status,
      provider: input.provider,
      model: input.model,
      updatedAt: new Date().toISOString(),
    });
    if (outcome === "not_found") throw new HttpError(404, "Idea not found");
    if (outcome === "busy") throw new HttpError(409, "Idea is being updated by an agent");
    if (outcome === "conflict") throw new HttpError(409, "Idea was updated elsewhere");
    return json({
      idea: await getIdea(db, project.id, ideaMatch[2], session.user.id),
    });
  }
  if (ideaMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const deleted = await deleteIdea(
      db,
      project.id,
      ideaMatch[2],
      session.user.id,
    );
    if (!deleted) throw new HttpError(409, "Idea is busy or not editable");
    return json({ deleted: true });
  }

  const ideaMessagesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/ideas\/([0-9a-f-]+)\/messages$/u,
  );
  if (ideaMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaMessagesMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = ideaMessageInputSchema.parse(await readJson(request));
    const outcome = await sendIdeaMessage(db, {
      jobId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      replyMessageId: crypto.randomUUID(),
      projectId: project.id,
      ideaId: ideaMessagesMatch[2],
      authorUserId: session.user.id,
      body: input.body,
      createdAt: new Date().toISOString(),
    });
    if (outcome === "not_found") throw new HttpError(404, "Idea not found");
    if (outcome === "archived") throw new HttpError(409, "Archived ideas are read-only");
    if (outcome === "busy") throw new HttpError(409, "Idea is already processing a request");
    return json(
      {
        idea: await getIdea(
          db,
          project.id,
          ideaMessagesMatch[2],
          session.user.id,
        ),
      },
      202,
    );
  }

  const ideaPlanMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/ideas\/([0-9a-f-]+)\/plan$/u,
  );
  if (ideaPlanMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaPlanMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const outcome = await enqueueIdeaPlan(db, {
      jobId: crypto.randomUUID(),
      projectId: project.id,
      ideaId: ideaPlanMatch[2],
      authorUserId: session.user.id,
      createdAt: new Date().toISOString(),
    });
    if (outcome === "not_found") throw new HttpError(404, "Idea not found");
    if (outcome === "archived") throw new HttpError(409, "Archived ideas are read-only");
    if (outcome === "not_ready") throw new HttpError(409, "Idea must be ready first");
    if (outcome === "busy") throw new HttpError(409, "Idea is already processing a request");
    return json(
      {
        idea: await getIdea(db, project.id, ideaPlanMatch[2], session.user.id),
      },
      202,
    );
  }
  if (ideaPlanMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaPlanMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = ideaPlanUpdateInputSchema.parse(await readJson(request, 550_000));
    const updated = await updateIdeaPlan(db, {
      projectId: project.id,
      ideaId: ideaPlanMatch[2],
      authorUserId: session.user.id,
      expectedVersion: input.expectedVersion,
      items: input.items,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) throw new HttpError(409, "Idea plan was updated elsewhere");
    return json({
      idea: await getIdea(db, project.id, ideaPlanMatch[2], session.user.id),
    });
  }

  const ideaJobRetryMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/ideas\/([0-9a-f-]+)\/jobs\/([0-9a-f-]+)\/retry$/u,
  );
  if (ideaJobRetryMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaJobRetryMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const outcome = await retryIdeaJob(db, {
      failedJobId: ideaJobRetryMatch[3],
      jobId: crypto.randomUUID(),
      replyMessageId: crypto.randomUUID(),
      projectId: project.id,
      ideaId: ideaJobRetryMatch[2],
      authorUserId: session.user.id,
      createdAt: new Date().toISOString(),
    });
    if (outcome === "not_found") throw new HttpError(404, "Failed idea job not found");
    if (outcome === "archived") throw new HttpError(409, "Archived ideas are read-only");
    if (outcome === "not_ready") throw new HttpError(409, "Idea must be ready first");
    if (outcome === "busy") throw new HttpError(409, "Idea is already processing a request");
    return json(
      {
        idea: await getIdea(db, project.id, ideaJobRetryMatch[2], session.user.id),
      },
      202,
    );
  }

  const ideaConvertMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/ideas\/([0-9a-f-]+)\/convert$/u,
  );
  if (ideaConvertMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, ideaConvertMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = ideaConversionInputSchema.parse(await readJson(request));
    const result = await convertIdeaPlanToIssues(db, {
      projectId: project.id,
      ideaId: ideaConvertMatch[2],
      authorUserId: session.user.id,
      planVersion: input.planVersion,
      createdAt: new Date().toISOString(),
    });
    if (result.outcome === "active_issues") {
      throw new HttpError(409, "Generated issues have already started");
    }
    if (result.outcome === "workflow_pending") {
      throw new HttpError(409, "Project workflow is not ready");
    }
    if (result.outcome !== "created") {
      throw new HttpError(409, "Idea or plan is not ready");
    }
    return json({ runIds: result.runIds }, 201);
  }

  if (pathname === "/idea-job-claims" && request.method === "POST") {
    const input = ideaJobClaimInputSchema.parse(await readJson(request));
    const worker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(
        worker.binding.last_heartbeat_at,
        observedAt,
        worker.binding.state,
      ) !== "online" ||
      worker.binding.accepting_work !== 1 ||
      worker.binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim idea work");
    }
    const providers = executionWorkerProviders(worker.binding);
    const claimToken = `briar_idea_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const job = await claimNextIdeaJob(db, input.projectId, {
      workerId: worker.binding.id,
      providers,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
    });
    if (!job) return json({ work: null });
    const snapshot = await ideaJobSnapshot(db, job);
    if (!snapshot) throw new HttpError(409, "Idea job lost its context");
    return json({
      work: {
        workType: "idea",
        workId: job.id,
        runId: job.idea_id,
        sourceKey: `briar-idea:${job.idea_id}:${job.kind}`,
        title: snapshot.idea.title,
        kind: job.kind,
        provider: job.provider,
        model: job.model,
        claimToken,
        leaseExpiresAt: job.lease_expires_at,
        snapshot,
      },
    });
  }

  const ideaJobClaimMatch = pathname.match(
    /^\/idea-job-claims\/([0-9a-f-]+)\/(lease|complete)$/u,
  );
  if (ideaJobClaimMatch && request.method === "POST") {
    if (ideaJobClaimMatch[2] === "lease") {
      const input = ideaJobLeaseInputSchema.parse(await readJson(request));
      const worker = await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const observedAt = new Date().toISOString();
      const renewed = await renewIdeaJobLease(
        db,
        input.projectId,
        ideaJobClaimMatch[1],
        {
          workerId: worker.binding.id,
          claimTokenHash: await sha256(input.claimToken),
          leaseExpiresAt: leaseExpiryFrom(observedAt),
          updatedAt: observedAt,
        },
      );
      if (!renewed) throw new HttpError(409, "Idea claim is no longer active");
      return json({ leaseExpiresAt: renewed.lease_expires_at });
    }
    const input = ideaJobCompletionInputSchema.parse(await readJson(request, 550_000));
    const worker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const job = await getClaimedIdeaJob(
      db,
      input.projectId,
      ideaJobClaimMatch[1],
      worker.binding.id,
      claimTokenHash,
    );
    if (!job) throw new HttpError(409, "Idea claim is no longer active");
    const observedAt = new Date().toISOString();
    if (input.error) {
      await failIdeaJob(db, job, claimTokenHash, input.error, observedAt);
      return json({ status: "failed" });
    }
    const completed =
      job.kind === "chat"
        ? await completeIdeaChatJob(
            db,
            job,
            claimTokenHash,
            ideaTurnResultSchema.parse(input.result),
            observedAt,
          )
        : await completeIdeaPlanJob(
            db,
            job,
            claimTokenHash,
            ideaPlanResultSchema.parse(input.result).issues,
            observedAt,
          );
    if (!completed) throw new HttpError(409, "Idea result became stale");
    return json({ status: "completed" });
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
            "Sign in with the Google account that matches this invitation",
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

  if (
    pathname === "/organizations/handle-availability" &&
    request.method === "GET"
  ) {
    await requireSession(auth, request);
    const handle = organizationHandleSchema.parse(
      new URL(request.url).searchParams.get("handle"),
    );
    return json({
      available: await isOrganizationHandleAvailable(db, handle),
    });
  }

  if (pathname === "/organizations" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = organizationInputSchema.parse(await readJson(request));
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
    const input = organizationUpdateInputSchema.parse(await readJson(request));
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
    const input = organizationLogoInputSchema.parse(await readJson(request));
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
    const input = organizationInvitationInputSchema.parse(
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
    const input = organizationMemberInputSchema.parse(await readJson(request));
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
    const input = organizationMemberRoleInputSchema.parse(
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
    const input = organizationAgentInputSchema.parse(await readJson(request));
    const agent = await createOrganizationAgent(db, {
      id: crypto.randomUUID(),
      organizationId,
      name: input.name,
      handle: input.handle ?? handleFromName(input.name) ?? undefined,
      provider: input.provider,
      model: input.model,
      responsibility: input.responsibility,
      effort: input.effort,
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
    const input = organizationAgentInputSchema.parse(await readJson(request));
    const agent = await updateOrganizationAgent(db, {
      organizationId,
      agentId: organizationAgentMatch[2],
      name: input.name,
      handle: input.handle,
      provider: input.provider,
      model: input.model,
      responsibility: input.responsibility,
      effort: input.effort,
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

  const organizationIdeasMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/ideas$/u,
  );
  if (organizationIdeasMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationIdeasMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    return json({ ideas: await listOrganizationIdeas(db, organizationId) });
  }

  const organizationIdeaMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/ideas\/([0-9a-f-]+)$/u,
  );
  if (organizationIdeaMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationIdeaMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const idea = await getOrganizationIdea(
      db,
      organizationId,
      organizationIdeaMatch[2],
      session.user.id,
    );
    if (!idea) throw new HttpError(404, "Idea not found");
    return json({ idea });
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

  const organizationChannelsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels$/u,
  );
  if (organizationChannelsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const channels = await listChannels(db, organizationId, session.user.id);
    return json({
      channels: channels.map(channelJson),
      cursor: await getChannelSyncCursor(db, organizationId),
    });
  }
  if (organizationChannelsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const input = channelInputSchema.parse(await readJson(request));
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
    const [members, agents, messages] = await Promise.all([
      listChannelMembers(db, channel.id),
      listChannelAgents(db, channel.id),
      listChannelRootMessages(db, channel.id),
    ]);
    return json({
      channel: channelJson(channel),
      members,
      agents: agents.map(organizationAgentJson),
      messages,
    });
  }
  if (organizationChannelMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    await requireChannelAccess(
      db,
      organizationChannelMatch[1],
      organizationChannelMatch[2],
      session.user.id,
    );
    const input = channelUpdateInputSchema.parse(await readJson(request));
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
    return json({ channel: channelJson(channel) });
  }
  if (organizationChannelMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const attachmentKeys = await listChannelAttachmentObjectKeys(
      db,
      organizationId,
      organizationChannelMatch[2],
    );
    const deleted = await deleteChannel(
      db,
      organizationId,
      organizationChannelMatch[2],
    );
    if (!deleted) throw new HttpError(404, "Channel not found");
    if (attachmentKeys.length > 0) {
      try {
        await attachmentsBucket.delete(attachmentKeys);
      } catch (error) {
        console.error(JSON.stringify({
          message: "Channel attachment cleanup failed",
          organizationId,
          channelId: organizationChannelMatch[2],
          attachmentCount: attachmentKeys.length,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    return json({ deleted: true });
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
    const input = channelMemberInputSchema.parse(await readJson(request));
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
    const agents = await listChannelAgents(db, channel.id);
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
    const agents = await listChannelAgents(db, channel.id);
    return json({ agents: agents.map(organizationAgentJson) });
  }

  const channelMessagesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages$/u,
  );
  const channelAttachmentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
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
    const parentMessageId = new URL(request.url).searchParams.get(
      "parentMessageId",
    );
    return json({
      messages: parentMessageId
        ? await listChannelThreadMessages(db, channel.id, parentMessageId)
        : await listChannelRootMessages(db, channel.id),
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
    const roster = await listChannelAgents(db, channel.id);
    const mentionedAgents = rawInput.mentionedAgentIds.map((agentId) => {
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
    const messageId = crypto.randomUUID();
    const storedAttachments = attachments.map((file) => {
      const id = crypto.randomUUID();
      return {
        id,
        organization_id: organizationId,
        object_key: `channel-attachments/${organizationId}/${channel.id}/${messageId}/${id}`,
        filename: file.name.normalize("NFC").trim(),
        content_type: file.type,
        byte_size: file.size,
        file,
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
    const uploadedKeys: string[] = [];
    let message = null;
    try {
      for (const attachment of storedAttachments) {
        await attachmentsBucket.put(
          attachment.object_key,
          attachment.file.stream(),
          {
            httpMetadata: {
              contentType: attachment.content_type,
              contentDisposition: contentDisposition(attachment.filename),
            },
            customMetadata: {
              attachmentId: attachment.id,
              channelId: channel.id,
              messageId,
              organizationId,
            },
          },
        );
        uploadedKeys.push(attachment.object_key);
      }
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
      parentMessageId: message.parentMessageId ?? message.id,
      agents: mentionedAgents.map((agent) => ({
        id: agent.id,
        projectId: agent.project_id,
        provider: agent.provider,
      })),
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
    if (proposal.status === "accepted") {
      return json({
        outcome: "already_accepted",
        resultRunId: proposal.result_run_id,
      });
    }
    const input = channelProposalAcceptInputSchema.parse(
      await readJson(request),
    );
    // The conversation never fixes a project, so the accepting member does:
    // their choice wins, then the proposal's, then the channel default.
    const targetProjectId =
      input.projectId ?? proposal.project_id ?? channel.default_project_id;
    if (!targetProjectId) {
      throw new HttpError(400, "A target project is required");
    }
    const project = await getProject(db, targetProjectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const payload = channelIssueProposalPayloadSchema.parse(
      JSON.parse(proposal.payload_json),
    );
    const created = await createIssueWithAttachments({
      db,
      attachmentsBucket,
      project,
      issue: { ...payload.issue, checkpoints: [] },
      attachments: [],
      sourceKey: `briar-channel-proposal:${proposal.id}`,
      actor: "briar-channel",
      detail: "채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
      context: {
        origin: "briar-channel",
        proposalId: proposal.id,
        channelId: channel.id,
      },
      issueId: proposal.id,
      createdByUserId: session.user.id,
      occurredAt: proposal.created_at,
    });
    const accepted = await acceptChannelActionProposal(db, {
      channelId: channel.id,
      proposalId: proposal.id,
      projectId: project.id,
      userId: session.user.id,
      resultRunId: created.runId,
      acceptedAt: new Date().toISOString(),
    });
    if (!accepted) throw new HttpError(409, "Proposal changed");
    return json({ outcome: "accepted", resultRunId: created.runId });
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
      canManage: canManageOrganization(role),
      generatedAt: observedAt,
    });
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
    const input = workerSettingsSchema.parse(await readJson(request));
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
    const input = slackOAuthInputSchema.parse(await readJson(request));
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
      const installation = await getSlackInstallation(db, teamId);
      if (
        !installation ||
        installation.organization_id !==
          organizationSlackInstallationMatch[1]
      ) {
        throw new HttpError(404, "Slack workspace not found");
      }
      if (slackConfigAvailable(env)) {
        try {
          const token = await decryptSlackToken(
            installation.encrypted_bot_token,
            installation.token_iv,
            env.SLACK_TOKEN_ENCRYPTION_KEY,
          );
          await callSlackApi("auth.revoke", token, { test: false });
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "Slack token revoke failed",
              error: error instanceof Error ? error.message : String(error),
              teamId,
            }),
          );
        }
      }
      const removed = await deleteSlackInstallation(
        db,
        organizationSlackInstallationMatch[1],
        teamId,
      );
      if (!removed) throw new HttpError(404, "Slack workspace not found");
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const input = slackInstallationUpdateSchema.parse(await readJson(request));
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
    return json(mobileProjectsResponseSchema.parse({
      projects: projects.map(projectJson),
    }));
  }

  if (pathname === "/projects" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = projectInputSchema.parse(await readJson(request));
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
    const [attachments, evidenceImages, archivedObjects] = await Promise.all([
      listIssueAttachments(db, project.id),
      listRunEvidenceImages(db, project.id),
      listArchiveObjectsForDeletion(db, project.id),
    ]);
    const observedAt = new Date().toISOString();
    await enqueueArchiveCleanup(
      db,
      project.id,
      null,
      archivedObjects,
      observedAt,
    );
    const attachmentKeys = [...attachments, ...(evidenceImages ?? [])].map(
      (attachment) => attachment.object_key,
    );
    try {
      for (let offset = 0; offset < attachmentKeys.length; offset += 1_000) {
        await attachmentsBucket.delete(
          attachmentKeys.slice(offset, offset + 1_000),
        );
      }
    } catch (error) {
      await cancelArchiveCleanup(db, archivedObjects);
      throw error;
    }
    if (!(await deleteProject(db, project.id, session.user.id))) {
      await cancelArchiveCleanup(db, archivedObjects);
      throw new HttpError(404, "Project not found");
    }
    await processArchiveCleanupQueue(
      db,
      env.ARCHIVES,
      attachmentsBucket,
      observedAt,
      1_000,
    );
    return new Response(null, { status: 204, headers: corsHeaders });
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
    const input = projectIconInputSchema.parse(
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
    const input = projectIssueKeyPrefixInputSchema.parse(
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

  const settingsMatch = pathname.match(/^\/projects\/([0-9a-f-]+)\/settings$/u);
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
    const input = checkpointPolicyInputSchema.parse(await readJson(request));
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
    const input = executionWorkerPolicySchema.parse(await readJson(request));
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
  if (projectAgentSessionMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = projectAgentSessionInputSchema.parse(await readJson(request));
    const row = await upsertProjectAgentSession(db, {
      project_id: project.id,
      id: projectAgentSessionMatch[2],
      agent_id: input.agentId,
      status: input.status,
      session_type: input.sessionType,
      payload_json: JSON.stringify(input),
      started_at: input.startedAt,
      completed_at: input.completedAt,
      updated_at: input.updatedAt,
    });
    if (!row) throw new HttpError(409, "Agent session could not be synchronized");
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
    const input = projectAgentInputSchema.parse(await readJson(request));
    if (input.codexPet !== undefined) {
      throw new HttpError(
        400,
        "Create the agent before selecting a Codex Pet avatar",
      );
    }
    const providerName =
      input.provider === "codex"
        ? "Codex"
        : input.provider === "claude"
          ? "Claude"
          : "Grok";
    const agent = await createProjectAgent(db, project.id, {
      name: input.name ?? `${providerName} Agent`,
      avatar: input.avatar ?? null,
      provider: input.provider,
      model: input.model ?? null,
      effort: input.effort ?? null,
      responsibility: input.responsibility,
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
    const input = projectAgentScheduleInputSchema.parse(
      await readJson(request),
    );
    const schedule = await createProjectAgentSchedule(db, project.id, input);
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
    const input = projectAgentScheduleInputSchema.parse(
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
    const input = projectAgentScheduleRunCompletionSchema.parse(
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
    const input = projectAgentScheduleRunRenewSchema.parse(
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
    const input = projectAgentInputSchema.parse(await readJson(request));
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
    const providerName =
      input.provider === "codex"
        ? "Codex"
        : input.provider === "claude"
          ? "Claude"
          : "Grok";
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
          responsibility: input.responsibility,
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
    const input = linearApiKeySchema.parse(await readJson(request));
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
    const input = linearStatesInputSchema.parse(await readJson(request));
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
    const input = linearImportInputSchema.parse(await readJson(request));
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
      organizationWorkers,
    ] =
      await Promise.all([
        changedRunIds.size > 0
          ? listDashboardRuns(db, project.id)
          : Promise.resolve([]),
        changedRunIds.size > 0
          ? listIssueAttachments(db, project.id)
          : Promise.resolve([]),
        changedRunIds.size > 0
          ? listIssueDependencies(db, project.id)
          : Promise.resolve([]),
        changedRunIds.size > 0
          ? listIssueResultReviews(db, project.id)
          : Promise.resolve([]),
        listExecutionWorkers(db, project.id, observedAt),
        listOrganizationExecutionWorkers(
          db,
          project.organization_id,
          observedAt,
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
    const organizationProviders = [
      ...new Set(
        organizationWorkers.flatMap((worker) =>
          worker.bindings.flatMap((binding) => binding.providers ?? []),
        ),
      ),
    ];
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
      organizationWorkers,
      executionPolicy,
      members,
      conversationNotifications,
    ] =
      await Promise.all([
        listDashboardRuns(db, project.id),
        getProjectSettings(db, project.id),
        loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
        listIssueAttachments(db, project.id),
        listIssueDependencies(db, project.id),
        listIssueResultReviews(db, project.id),
        listExecutionWorkers(db, project.id, observedAt),
        listOrganizationExecutionWorkers(
          db,
          project.organization_id,
          observedAt,
        ),
        getProjectExecutionWorkerPolicy(db, project.id),
        listOrganizationMembers(db, project.organization_id),
        listIssueConversationNotifications(
          db,
          project.id,
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
      organizationProviders: [
        ...new Set(
          organizationWorkers.flatMap((worker) =>
            worker.bindings.flatMap((binding) => binding.providers ?? []),
          ),
        ),
      ],
      executionPolicy,
      members: members.map(organizationMemberJson),
      conversationNotifications: conversationNotifications.map(
        issueConversationNotificationJson,
      ),
      cursor,
      generatedAt: observedAt,
    });
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
    return json({
      runId: run.id,
      eventCount: events.length,
      events: events.map(dashboardEventJson),
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
    const [messages, attachments, reworkProposals, actionProposals] = await Promise.all([
      listIssueMessagesWithArchive(db, env.ARCHIVES, project.id, run.id),
      listIssueAttachments(db, project.id, run.id),
      listIssueReworkProposals(db, project.id, run.id),
      listIssueActionProposals(db, project.id, run.id),
    ]);
    const proposalsByReply = new Map(
      [...reworkProposals, ...actionProposals].map((proposal) => [
        proposal.reply_message_id,
        proposal,
      ]),
    );
    return json({
      messages: messages.map((message) =>
        issueMessageJson(
          message,
          attachments,
          proposalsByReply.get(message.id) ?? null,
        )
      ),
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
    const { input: rawInput, attachments, attachmentReferences } =
      await readIssueMessageRequest(request);
    const storedAttachments: Array<IssueAttachmentInput & { file: File }> =
      attachments.map((file) => {
        const id = crypto.randomUUID();
        return {
          id,
          object_key: `issue-attachments/${project.id}/${issueMessagesMatch[2]}/${id}`,
          filename: file.name.normalize("NFC").trim(),
          content_type: file.type,
          byte_size: file.size,
          file,
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
    const createdAt = new Date().toISOString();
    const uploadedKeys: string[] = [];
    let message: IssueMessageRow | null = null;
    try {
      for (const attachment of storedAttachments) {
        await attachmentsBucket.put(
          attachment.object_key,
          attachment.file.stream(),
          {
            httpMetadata: {
              contentType: attachment.content_type,
              contentDisposition: contentDisposition(attachment.filename),
            },
            customMetadata: {
              attachmentId: attachment.id,
              projectId: project.id,
            },
          },
        );
        uploadedKeys.push(attachment.object_key);
      }
      await createIssueAttachments(
        db,
        project.id,
        issueMessagesMatch[2],
        storedAttachments.map(({ file: _file, ...attachment }) => attachment),
      );
      message = await createIssueMessage(db, {
        id: crypto.randomUUID(),
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
      await Promise.all(
        uploadedKeys.map((objectKey) => attachmentsBucket.delete(objectKey)),
      ).catch(() => undefined);
      throw error;
    }
    if (!message) {
      throw new HttpError(
        404,
        input.parentMessageId ? "Thread message not found" : "Run not found",
      );
    }
    const agentReply =
      !agentProvider && shouldBriarReply(
        (input.parentMessageId
          ? await listIssueThreadMessages(
              db,
              project.id,
              issueMessagesMatch[2],
              input.parentMessageId,
            )
          : []
        ).map((threadMessage) => ({
          id: threadMessage.id,
          parentMessageId: threadMessage.parent_message_id,
          body: threadMessage.body,
          author: { provider: threadMessage.author_agent_provider },
        })),
        { body: input.body, parentMessageId: input.parentMessageId ?? null },
      )
        ? await enqueueIssueAgentReply(db, {
            id: crypto.randomUUID(),
            projectId: project.id,
            runId: issueMessagesMatch[2],
            triggerMessageId: message.id,
            parentMessageId: message.parent_message_id ?? message.id,
            replyMessageId: crypto.randomUUID(),
            createdAt,
          })
        : null;
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
        agentReply: agentReply ? issueAgentReplyJson(agentReply) : null,
      },
      201,
    );
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
    const job = await getIssueAgentReplyJob(
      db,
      project.id,
      issueAgentReplyStatusMatch[3],
    );
    if (!job || job.run_id !== issueAgentReplyStatusMatch[2]) {
      throw new HttpError(404, "Agent reply not found");
    }
    const [messages, reworkProposals, actionProposals] =
      job.status === "completed"
        ? await Promise.all([
            listIssueMessagesWithArchive(
              db,
              env.ARCHIVES,
              project.id,
              job.run_id,
            ),
            listIssueReworkProposals(db, project.id, job.run_id),
            listIssueActionProposals(db, project.id, job.run_id),
          ])
        : [[], [], []];
    const reply = messages.find(
      (message) => message.id === job.reply_message_id,
    );
    const proposal = [...reworkProposals, ...actionProposals].find(
      (candidate) => candidate.reply_message_id === job.reply_message_id,
    ) ?? null;
    return json({
      agentReply: issueAgentReplyJson(job),
      message: reply ? issueMessageJson(reply, [], proposal) : null,
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
      return json({
        proposal: issueActionProposalJson(proposal),
        outcome: "already_accepted",
        resultRunId: proposal.result_run_id,
      });
    }

    const acceptedAt = new Date().toISOString();
    const rawPayload = JSON.parse(proposal.payload_json);
    if (proposal.action_type === "request_issue_update") {
      const action = issueUpdateProposalActionSchema.parse({
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

    const action = issueCreateProposalActionSchema.parse({
      type: proposal.action_type,
      ...rawPayload,
    });
    const created = await createIssueWithAttachments({
      db,
      attachmentsBucket,
      project,
      issue: {
        ...action.issue,
        checkpoints: [],
      },
      attachments: [],
      sourceKey: `briar-conversation-proposal:${proposal.id}`,
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
      createdByUserId: session.user.id,
      occurredAt: proposal.created_at,
    });
    const accepted = await acceptIssueCreateProposal(db, {
      projectId: project.id,
      conversationRunId: proposal.conversation_run_id,
      proposalId: proposal.id,
      userId: session.user.id,
      acceptedAt,
      resultRunId: created.runId,
    }) ?? await getIssueActionProposal(
      db,
      project.id,
      proposal.conversation_run_id,
      proposal.id,
    );
    if (!accepted) throw new HttpError(409, "Issue action proposal changed");
    return json({
      proposal: issueActionProposalJson(accepted),
      outcome:
        accepted.status === "accepted" && accepted.accepted_at !== acceptedAt
          ? "already_accepted"
          : "accepted",
      resultRunId: accepted.result_run_id,
    });
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
    const input = issueExecutionPreferencesSchema.parse(await readJson(request));
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
    const input = z
      .object({ checkpoints: z.array(workflowCheckpointSchema).max(100) })
      .strict()
      .parse(await readJson(request));
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
    const [attachments, evidenceImages, archivedObjects] = await Promise.all([
      listIssueAttachments(db, project.id, issueUpdateMatch[2]),
      listAllRunEvidenceImages(db, project.id, issueUpdateMatch[2]),
      listArchiveObjectsForDeletion(db, project.id, issueUpdateMatch[2]),
    ]);
    const observedAt = new Date().toISOString();
    await enqueueArchiveCleanup(
      db,
      project.id,
      issueUpdateMatch[2],
      archivedObjects,
      observedAt,
    );
    const outcome = await deleteIssue(
      db,
      project.id,
      issueUpdateMatch[2],
      observedAt,
    );
    if (outcome === "not_found") {
      await cancelArchiveCleanup(db, archivedObjects);
      throw new HttpError(404, "Run not found");
    }
    if (outcome === "active") {
      await cancelArchiveCleanup(db, archivedObjects);
      throw new HttpError(409, "An active issue cannot be deleted");
    }
    const attachmentKeys = [...attachments, ...(evidenceImages ?? [])].map(
      (attachment) => attachment.object_key,
    );
    if (attachmentKeys.length > 0) {
      try {
        await attachmentsBucket.delete(attachmentKeys);
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "deleted issue attachment cleanup failed",
            error: error instanceof Error ? error.message : String(error),
            runId: issueUpdateMatch[2],
          }),
        );
      }
    }
    await processArchiveCleanupQueue(
      db,
      env.ARCHIVES,
      attachmentsBucket,
      observedAt,
      1_000,
    );
    return new Response(null, { status: 204, headers: corsHeaders });
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
    const body = z
      .object({
        targetProjectId: z.string().uuid(),
      })
      .parse(await readJson(request));
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
    const input = recoveryUserInputSchema.parse(await readJson(request));
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
    const input = resumeUserInputSchema.parse(await readJson(request));
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
    if (result.outcome === "ineligible" || result.outcome === "conflict") {
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
    const input = pausedRunReworkInputSchema.parse(await readJson(request));
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
    const input = moveRunInputSchema.parse(await readJson(request));
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
    const input = dispatchRunSchema.parse(await readJson(request));
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
    const input = z.object({ requestId: z.string().uuid() }).strict().parse(await readJson(request));
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
    const input = workerRegisterSchema.parse(await readJson(request));
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
    const input = workerBindSchema.parse(await readJson(request));
    const observedAt = new Date().toISOString();
    const binding = await bindExecutionWorkerProject(db, projectId, {
      id: crypto.randomUUID(),
      organizationId: project.organization_id,
      ownerUserId: session.user.id,
      deviceIdentityHash: await sha256(input.deviceIdentity),
      agentProvider: input.agentProvider,
      providers: input.providers,
      providerHealth: input.providerHealth,
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
    const input = workerConcurrencySchema.parse(await readJson(request));
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
    const input = workerHeartbeatSchema.parse(await readJson(request));
    const observedAt = new Date().toISOString();
    const worker = await recordWorkerHeartbeat(db, binding.project_id, {
      workerId: workerHeartbeatMatch[1],
      versions: input.versions,
      acceptingWork: input.acceptingWork,
      readinessState: input.readinessState,
      readinessDetail: input.readinessDetail,
      capabilities: input.capabilities,
      observedAt,
    });
    if (
      input.acceptingWork !== undefined ||
      input.readinessState !== undefined ||
      input.readinessDetail !== undefined
    ) {
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
    const input = workerLabelSchema.parse(await readJson(request));
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
    const input = leaseRenewSchema.parse(await readJson(request));
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
    const input = transcriptSchema.parse(await readJson(request));
    let authenticatedWorkerId: string | null = null;
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
      if (
        input.runId &&
        (await requireRunExecutionProject(db, request, input.runId)) !== projectId
      ) {
        throw new HttpError(403, "Run is not assigned to this worker");
      }
    }
    if (
      input.executionMetrics &&
      (!authenticatedWorkerId || !input.runId || !input.runAttempt)
    ) {
      throw new HttpError(403, "Only execution workers can report run metrics");
    }
    const result = await appendAgentTranscript(db, projectId, {
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      workerId: authenticatedWorkerId ?? input.workerId ?? null,
      agentProvider: input.agentProvider,
      events: input.events,
      observedAt: new Date().toISOString(),
    });
    if (input.executionMetrics) {
      await updateHuntRunExecutionMetrics(db, projectId, {
        runId: input.runId!,
        attempt: input.runAttempt!,
        workerId: authenticatedWorkerId!,
        metrics: input.executionMetrics,
      });
    }
    return json(result, 202);
  }

  const projectWorkersMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers$/u,
  );
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
    const afterSequence = Number.parseInt(
      new URL(request.url).searchParams.get("afterSequence") ?? "0",
      10,
    );
    const hotTranscript = await readAgentTranscript(
      db,
      projectId,
      transcriptMatch[2],
      {
        afterSequence:
          Number.isFinite(afterSequence) && afterSequence > 0
            ? afterSequence
            : 0,
      },
    );
    const archivedTranscript = hotTranscript
      ? null
      : await readArchivedTranscript(
          db,
          env.ARCHIVES,
          projectId,
          transcriptMatch[2],
        );
    const transcript =
      hotTranscript ??
      (archivedTranscript
        ? {
            ...archivedTranscript,
            events: archivedTranscript.events.filter(
              (event) =>
                event.sequence >
                (Number.isFinite(afterSequence) && afterSequence > 0
                  ? afterSequence
                  : 0),
            ),
          }
        : null);
    if (!transcript) throw new HttpError(404, "Transcript not found");
    return json({
      session: {
        sessionId: transcript.session.session_id,
        runId: transcript.session.run_id,
        workerId: transcript.session.worker_id,
        agentProvider: transcript.session.agent_provider,
        startedAt: transcript.session.started_at,
        lastEventAt: transcript.session.last_event_at,
        eventCount: transcript.session.event_count,
      },
      events: transcript.events.map((event) => ({
        sequence: event.sequence,
        direction: event.direction,
        message: JSON.parse(event.payload_json),
        recordedAt: event.recorded_at,
      })),
    });
  }

  if (pathname === "/issue-reply-claims" && request.method === "POST") {
    const input = claimInputSchema
      .pick({ claimedBy: true, workerId: true, projectId: true })
      .required({ workerId: true, projectId: true })
      .parse(await readJson(request));
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
        readAgentTranscript(
          db,
          input.projectId,
          `detached-${job.run_id}`,
          { limit: 200, tail: true },
        ),
      ]);
    if (!run || !job.agent_provider) {
      throw new HttpError(409, "Reply job lost its issue context");
    }
    const agent = run.agent_id
      ? await getProjectAgent(db, input.projectId, run.agent_id)
      : null;
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
        model:
          agent?.provider === job.agent_provider ? agent.model : null,
        branch: run.branch,
        claimToken,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
        snapshot: {
          run: {
            ...dashboardRunJson(run, attachments),
            events: events.map(dashboardEventJson),
          },
          messages: claimConversationJson(messages),
          agentTranscript:
            transcript?.events.flatMap((event) => {
              const payload = issueReplyTranscriptPayload(
                JSON.parse(event.payload_json),
              );
              return payload
                ? [{
                    sequence: event.sequence,
                    message: payload,
                    recordedAt: event.recorded_at,
                  }]
                : [];
            }) ?? [],
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
    const input = channelReplyClaimInputSchema.parse(await readJson(request));
    const principal = await requireWorkerOrganization(
      db,
      request,
      input.organizationId,
    );
    // Readiness and provider health still come from a project binding, which
    // every registered device has. Eligibility per job is enforced in the claim.
    const binding = await executionWorkerBindingById(
      db,
      principal.deviceId,
      input.workerId,
    );
    if (!binding || binding.state === "disabled") {
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
      binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim replies");
    }
    const providers = executionWorkerProviders(binding);
    if (providers.length === 0) {
      throw new HttpError(409, "Worker has no available reply provider");
    }
    const claimToken = `briar_channel_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const job = await claimNextChannelAgentReply(db, input.organizationId, {
      deviceId: principal.deviceId,
      providers,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
    });
    if (!job) return json({ work: null });
    const [channel, agent, messages] = await Promise.all([
      getChannelById(db, job.organization_id, job.channel_id),
      getOrganizationAgent(db, job.organization_id, job.agent_id),
      listChannelThreadMessages(db, job.channel_id, job.parent_message_id),
    ]);
    if (!channel || !agent || !job.agent_provider) {
      throw new HttpError(409, "Reply job lost its channel context");
    }
    const project = job.project_id
      ? await getOrganizationProject(db, job.organization_id, job.project_id)
      : null;
    return json({
      work: {
        workType: "channelReply",
        workId: job.id,
        organizationId: job.organization_id,
        channelId: job.channel_id,
        // Null means there is no repository: the runner skips worktree setup.
        projectId: job.project_id,
        // The worker loop keys in-flight work by runId; a channel reply has no
        // run, so the channel stands in for it.
        runId: job.channel_id,
        sourceKey: `briar-channel:${job.channel_id}:reply:${job.trigger_message_id}`,
        title: channel.name,
        triggerMessageId: job.trigger_message_id,
        parentMessageId: job.parent_message_id,
        provider: job.agent_provider,
        model: agent.model,
        claimToken,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
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
            handle: agent.handle,
            responsibility: agent.responsibility,
            provider: agent.provider,
            model: agent.model,
            projectId: agent.project_id,
          },
          project: project ? { id: project.id, name: project.name } : null,
          projectTargets: await listOrganizationProjectTargets(
            db,
            job.organization_id,
          ),
          messages,
        },
      },
    });
  }

  const channelReplyClaimMatch = pathname.match(
    /^\/channel-reply-claims\/([0-9a-f-]+)\/(lease|complete)$/u,
  );
  if (channelReplyClaimMatch && request.method === "POST") {
    if (channelReplyClaimMatch[2] === "lease") {
      const input = channelReplyLeaseInputSchema.parse(await readJson(request));
      await requireWorkerOrganization(db, request, input.organizationId);
      const observedAt = new Date().toISOString();
      const renewed = await renewChannelReplyLease(db, {
        jobId: channelReplyClaimMatch[1],
        claimTokenHash: await sha256(input.claimToken),
        leaseExpiresAt: leaseExpiryFrom(observedAt),
      });
      if (!renewed) throw new HttpError(409, "Reply claim is no longer active");
      return json({ leaseExpiresAt: renewed.lease_expires_at });
    }

    const input = channelReplyCompleteInputSchema.parse(await readJson(request));
    await requireWorkerOrganization(db, request, input.organizationId);
    const claimTokenHash = await sha256(input.claimToken);
    const job = await getClaimedChannelReply(
      db,
      channelReplyClaimMatch[1],
      claimTokenHash,
    );
    if (!job || job.organization_id !== input.organizationId) {
      throw new HttpError(409, "Reply claim is no longer active");
    }
    const observedAt = new Date().toISOString();
    if (input.error) {
      const failed = await failChannelReply(db, {
        jobId: job.id,
        claimTokenHash,
        error: input.error,
        updatedAt: observedAt,
      });
      if (!failed) throw new HttpError(409, "Reply claim is no longer active");
      return json({ agentReply: channelReplyJson(failed) });
    }
    const agent = await getOrganizationAgent(
      db,
      job.organization_id,
      job.agent_id,
    );
    if (!agent) throw new HttpError(409, "Reply job lost its Agent");
    const result = input.result!;
    // A document or issue may only target a project inside this organization.
    for (const projectId of [
      result.document?.projectId,
      result.issueProposal?.projectId,
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
    const completed = await completeChannelReply(db, job, {
      jobId: job.id,
      claimTokenHash,
      body: result.body,
      document: result.document,
      issueProposal: result.issueProposal,
      agentName: agent.name,
      agentProvider: job.agent_provider ?? agent.provider,
      completedAt: observedAt,
    });
    if (!completed) throw new HttpError(409, "Reply claim is no longer active");
    return json({
      agentReply: channelReplyJson(completed),
      message: await getChannelMessage(
        db,
        job.channel_id,
        job.reply_message_id,
      ),
    });
  }

  const issueReplyClaimMatch = pathname.match(
    /^\/issue-reply-claims\/([0-9a-f-]+)\/(lease|complete)$/u,
  );
  if (issueReplyClaimMatch && request.method === "POST") {
    if (issueReplyClaimMatch[2] === "lease") {
      const input = issueAgentReplyLeaseSchema.parse(await readJson(request));
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
      return json({ leaseExpiresAt: renewed.lease_expires_at });
    }

    const input = issueAgentReplyCompletionSchema.parse(
      await readJson(request),
    );
    const worker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const job = await getClaimedIssueAgentReply(
      db,
      input.projectId,
      issueReplyClaimMatch[1],
      { workerId: worker.binding.id, claimTokenHash },
    );
    if (!job) throw new HttpError(409, "Reply claim is no longer active");
    const observedAt = new Date().toISOString();
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
      return json({ agentReply: issueAgentReplyJson(failed) });
    }

    let reply = await createIssueMessage(db, {
      id: job.reply_message_id,
      projectId: input.projectId,
      runId: job.run_id,
      parentMessageId: job.parent_message_id,
      authorUserId: null,
      authorAgentProvider: job.agent_provider,
      body: input.body!,
      createdAt: observedAt,
    });
    if (!reply) {
      reply = (await listIssueMessagesWithArchive(
        db,
        env.ARCHIVES,
        input.projectId,
        job.run_id,
      )).find(
        (message) => message.id === job.reply_message_id,
      ) ?? null;
    }
    if (!reply) throw new HttpError(409, "Agent reply could not be persisted");
    let proposal: IssueProposalRow | null = null;
    if (input.proposedAction?.type === "request_issue_rework") {
      proposal = await createIssueReworkProposal(db, {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        runId: job.run_id,
        triggerMessageId: job.trigger_message_id,
        replyMessageId: job.reply_message_id,
        workflowStage: input.proposedAction.workflowStage,
        reason: input.proposedAction.reason,
        createdAt: observedAt,
      });
      if (!proposal) {
        proposal = (await listIssueReworkProposals(
          db,
          input.projectId,
          job.run_id,
        )).find(
          (candidate) => candidate.trigger_message_id === job.trigger_message_id,
        ) ?? null;
      }
    } else if (input.proposedAction) {
      const payload = input.proposedAction.type === "request_issue_update"
        ? { changes: input.proposedAction.changes }
        : { issue: input.proposedAction.issue };
      proposal = await createIssueActionProposal(db, {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        conversationRunId: job.run_id,
        triggerMessageId: job.trigger_message_id,
        replyMessageId: job.reply_message_id,
        actionType: input.proposedAction.type,
        payloadJson: JSON.stringify(payload),
        createdAt: observedAt,
      });
      if (!proposal) {
        proposal = (await listIssueActionProposals(
          db,
          input.projectId,
          job.run_id,
        )).find(
          (candidate) => candidate.trigger_message_id === job.trigger_message_id,
        ) ?? null;
      }
    }
    const completed = await completeIssueAgentReply(
      db,
      input.projectId,
      job.id,
      {
        workerId: worker.binding.id,
        claimTokenHash,
        completedAt: observedAt,
      },
    );
    if (!completed) throw new HttpError(409, "Reply claim is no longer active");
    return json({
      agentReply: issueAgentReplyJson(completed),
      message: issueMessageJson(reply, [], proposal),
    });
  }

  if (pathname === "/queue/claims" && request.method === "POST") {
    const input = claimInputSchema.parse(await readJson(request));
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
    const executionProvider = run
      ? run.preferred_agent_provider ??
        run.requested_agent_provider ??
        agent?.provider ??
        null
      : null;
    const executionModel = run?.preferred_agent_provider
      ? run.preferred_agent_model
      : run?.requested_agent_provider
        ? run.requested_agent_model
        : (agent?.model ?? null);
    const executionEffort = run?.preferred_agent_provider
      ? run.preferred_agent_effort
      : (run?.requested_agent_effort ?? null);
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
            context: parseJsonObject(run.context_json),
            reviewFeedback: reworkFeedbackEvent?.detail ?? null,
            workflowStage: run.workflow_stage,
            startStage: workflowContext.startStage,
            resumeContext: workflowContext.resumeContext,
            workflow: normalizeAutoHuntWorkflow(
              JSON.parse(run.workflow_snapshot_json),
            ),
            attachments: attachments.map(attachmentJson),
            messages: claimConversationJson(messages),
            claimToken,
            claimedBy: run.claimed_by,
            claimedAt: run.claimed_at,
            leaseExpiresAt: run.lease_expires_at,
            claimAttempts: run.claim_attempts,
            execution: executionProvider
              ? {
                  provider: executionProvider,
                  model: executionModel,
                  effort: executionEffort,
                }
              : null,
            agent: agent
              ? {
                  id: agent.id,
                  name: agent.name,
                  provider:
                    run.preferred_agent_provider ??
                    run.requested_agent_provider ??
                    agent.provider,
                  model: executionModel,
                  effort: executionEffort,
                  responsibility: agent.responsibility,
                  skill: agent.skill_markdown,
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
    const input = recoveryAgentInputSchema.parse(await readJson(request));
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
    const input = workflowStageLifecycleInputSchema.parse(await readJson(request));
    try {
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
            finishedAt: new Date().toISOString(),
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
      return json({
        runId: agentStageLifecycleMatch[1],
        requestId: input.requestId,
        ...result,
        ...(githubAutoResume ? { githubAutoResume } : {}),
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
    const input = resumeAgentInputSchema.parse(await readJson(request));
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
    if (result.outcome === "ineligible" || result.outcome === "conflict") {
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
    const input = runReworkInputSchema.parse(await readJson(request));
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
    const parsed = eventSchema.parse(await readJson(request));
    const projectId = parsed.runId
      ? (await requireActiveWorkerRunClaim(db, request, parsed.runId)).projectId
      : await requireAgentProject(db, request);
    const run = parsed.runId
      ? await getHuntRunForProject(db, projectId, parsed.runId)
      : null;
    if (parsed.runId && !run) throw new HttpError(404, "Run not found");
    const source = parsed.source ?? run?.source;
    const sourceKey = parsed.sourceKey ?? run?.source_key;
    const title = parsed.title ?? run?.title;
    if (!source || !sourceKey || !title) {
      throw new HttpError(400, "Run identity is incomplete");
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

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const observedAt = new Date(controller.scheduledTime).toISOString();
    if (controller.cron === "* * * * *") {
      ctx.waitUntil((async () => {
        try {
          const github = await reconcileGithubMergedRuns(env.DB);
          console.log(JSON.stringify({
            message: "GitHub merge reconciliation completed",
            observedAt,
            github,
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
    ctx.waitUntil((async () => {
      try {
        const [archive, expired, cleanup, github] = await Promise.all([
          archiveCompletedLogs(env.DB, env.ARCHIVES, observedAt),
          expireArchives(env.DB, env.ARCHIVES, observedAt),
          processArchiveCleanupQueue(
            env.DB,
            env.ARCHIVES,
            env.ATTACHMENTS,
            observedAt,
          ),
          reconcileGithubMergedRuns(env.DB),
        ]);
        console.log(JSON.stringify({
          message: "log archive sweep completed",
          observedAt,
          archive,
          expiredObjects: expired,
          cleanup,
          github,
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
  },
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
      return json(mobileHealthResponseSchema.parse({
        ok: true,
        service: "briar-api",
        database: "cloudflare-d1",
        updates: "cloudflare-r2",
      }));
    }
    if (url.pathname === "/github/webhooks" && request.method === "POST") {
      try {
        return await handleGithubWebhookRequest(request, env);
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ message: error.message }, error.status);
        }
        if (error instanceof z.ZodError) {
          return json({ message: "Invalid GitHub webhook", issues: error.issues }, 400);
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
      return devicePage(url.origin, deviceClient);
    }

    try {
      const auth = createAuth(env, url.origin);
      return await route(request, auth, env.DB, env.ATTACHMENTS, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          {
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
          },
          error.status,
        );
      }
      if (error instanceof WorkerConflictError) {
        return json({ message: error.message }, 409);
      }
      if (error instanceof TranscriptLimitError) {
        return json({ message: error.message }, 413);
      }
      if (error instanceof z.ZodError) {
        return json({ message: "Invalid request", issues: error.issues }, 400);
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
