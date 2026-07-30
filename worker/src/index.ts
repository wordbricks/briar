import { z } from "zod";
import briarIconPng from "../../src/assets/app-icons/aubergine-riso.png";
import {
  autoHuntEvidenceTypeMaxLength,
  autoHuntEvidenceTypePattern,
  autoHuntRunStatuses,
  autoHuntSources,
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
  repositoryWorkflowBootstrap,
  type AutoHuntRunStatus,
  type DashboardStage,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import {
  structuredAgentResultSchema,
  type StructuredAgentResult,
} from "../../src/lib/agent-result";
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
import { createAuth, type BriarAuth } from "./auth";
import {
  addOrganizationMember,
  assertQueuedHuntClaim,
  claimDueProjectAgentScheduleRun,
  claimNextQueuedHuntRun,
  completeProjectAgentScheduleRun,
  completeSlackEvent,
  consumeSlackOAuthState,
  createIssueMessage,
  createIssueAttachments,
  createRunEvidenceImages,
  createOrganization,
  createProjectAgent,
  createProjectAgentSchedule,
  createProject,
  createSlackOAuthState,
  claimSlackEvent,
  deleteSlackInstallation,
  deleteProjectAgent,
  deleteProjectAgentSchedule,
  deleteIssue,
  deleteProject,
  EventKeyConflictError,
  findProjectIdByAgentTokenHash,
  getProjectAgent,
  getIssueAttachment,
  getRunEvidenceImage,
  getOrganizationRole,
  getSlackInstallation,
  isOrganizationHandleAvailable,
  getProject,
  getProjectSettings,
  getHuntRunForProject,
  HuntClaimError,
  HuntTransitionError,
  importLinearHuntRuns,
  listIssueAttachments,
  listIssueMessages,
  listAllRunEvidenceImages,
  listEvidenceImagesForEvidence,
  listDashboardRuns,
  listRunEvidence,
  listRunEvidenceImages,
  listRunStageRevisions,
  listOrganizationMembers,
  listOrganizationProjects,
  listOrganizations,
  listProjects,
  listProjectAgents,
  listProjectAgentScheduleRuns,
  listProjectAgentSchedules,
  listSlackInstallations,
  moveHuntRun,
  issueProjectAgentToken,
  recoverHuntRun,
  reworkHuntRun,
  recordHuntEvent,
  recordRunEvidence,
  removeOrganizationMember,
  renewProjectAgentScheduleRunLease,
  rollbackNewAppIssue,
  releaseSlackEvent,
  updateProjectAgent,
  updateProjectAgentSchedule,
  updateProjectSettings,
  updateOrganization,
  updateOrganizationLogo,
  updateOrganizationMemberRole,
  updateIssue,
  updateSlackInstallationProject,
  upsertSlackInstallation,
  type HuntEventRow,
  type HuntRunRow,
  type IssueAttachmentInput,
  type IssueAttachmentRow,
  type IssueMessageRow,
  type ProjectRow,
  type ProjectAgentRow,
  type ProjectAgentScheduleRunRow,
  type ProjectAgentScheduleRow,
  type ProjectSettingsRow,
  type OrganizationMemberRow,
  type OrganizationRole,
  type OrganizationRow,
  type RunEvidenceRow,
  type RunEvidenceImageInput,
  type RunEvidenceImageRow,
} from "./db";
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
  updateProjectExecutionWorkerPolicy,
} from "./workers";
import { serveRelease } from "./releases";
import {
  callSlackApi,
  decryptSlackToken,
  encryptSlackToken,
  exchangeSlackOAuthCode,
  parseSlackIssueInstruction,
  randomUrlSafeToken,
  sha256Hex,
  slackBotScopes,
  slackEventClaimTtlMs,
  slackHelpMessage,
  slackOAuthStateTtlMs,
  verifySlackRequest,
} from "./slack";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-briar-claim-token",
  "Access-Control-Allow-Methods": "DELETE, GET, HEAD, PATCH, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const runStatusSchema = z.enum(autoHuntRunStatuses);
const workflowStageIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u);
const evidenceTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(autoHuntEvidenceTypeMaxLength)
  .regex(autoHuntEvidenceTypePattern);
const workflowSchema = z
  .object({
    version: z.literal(1),
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
        stopAfterStage: workflowStageIdSchema,
      })
      .strict()
      .optional(),
    /** Read compatibility for workflows stored before stopAfterStage. */
    release: z.object({ enabled: z.boolean() }).strict().optional(),
  })
  .strict()
  .transform(normalizeAutoHuntWorkflow);

const dashboardStageForProgress = (
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
): DashboardStage => {
  if (status === "backlog") return "queued";
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

const eventSchema = z
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
        message: "blocked progress requires an exact blocker reason",
        path: ["detail"],
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
    provider: z.enum(["codex", "claude", "grok"]),
    model: z.string().trim().min(1).max(100).nullable().optional(),
    responsibility: z.string().trim().min(1).max(2_000),
    calendarColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-f]{6}$/iu)
      .default(defaultProjectAgentCalendarColor),
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

const issueInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(100_000).nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
    status: z.enum(["backlog", "queued"]).default("queued"),
  })
  .strict();

export const issueUpdateInputSchema = issueInputSchema
  .pick({
    title: true,
    description: true,
    priority: true,
  })
  .required({
    title: true,
    description: true,
    priority: true,
  })
  .strict();

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
    agentConversationId: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .nullable()
      .optional(),
  })
  .strict();

export async function readIssueRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return {
      input: issueInputSchema.parse(await readJson(request)),
      attachments: [] as File[],
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

  const description = form.get("description");
  const priority = form.get("priority");
  const status = form.get("status");
  return {
    input: issueInputSchema.parse({
      title: form.get("title"),
      description:
        typeof description === "string" && description.trim()
          ? description
          : null,
      priority:
        typeof priority === "string" && priority ? Number(priority) : null,
      status: typeof status === "string" && status ? status : undefined,
    }),
    attachments,
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

const workerRegisterSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    deviceIdentity: z.string().regex(/^briar_device_[0-9a-f]{64}$/u),
    agentProvider: z.enum(["codex", "claude", "grok"]),
    providers: z
      .array(z.enum(["codex", "claude", "grok"]))
      .max(3)
      .optional(),
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

const dispatchRunSchema = z
  .object({
    agentId: z.string().uuid(),
    workerId: z.string().trim().min(1).max(128).nullable().optional(),
    requestId: z.string().uuid(),
  })
  .strict();

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

const transcriptSchema = z
  .object({
    sessionId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/u),
    runId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().optional(),
    workerId: z.string().trim().min(1).max(128).nullable().optional(),
    agentProvider: z.enum(["codex", "claude", "grok"]),
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
  .strict();

const recoveryUserInputSchema = z
  .object({
    requestId: z.string().uuid(),
    reason: z.string().trim().min(1).max(4_000).nullable().optional(),
  })
  .strict();

const recoveryAgentInputSchema = recoveryUserInputSchema.extend({
  actor: z.string().trim().min(1).max(128),
});

export const runReworkInputSchema = z
  .object({
    requestId: z.string().uuid(),
    workflowStage: workflowStageIdSchema,
    reason: z.string().trim().min(1).max(4_000),
    actor: z.string().trim().min(1).max(128),
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
    workflow: workflowSchema.default(repositoryWorkflowBootstrap),
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

const devicePage = (apiOrigin: string, mobileCompanion: boolean) => {
  const copy = mobileCompanion
    ? {
        eyebrow: "MOBILE COMPANION",
        title: "Companion 로그인 승인",
        description:
          "Google 계정으로 로그인한 뒤 이 기기의 Briar Companion 로그인을 승인하세요.",
        approve: "이 기기에서 로그인하기",
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
const base=${JSON.stringify(apiOrigin)};const mobileCompanion=${JSON.stringify(mobileCompanion)};const returnUrl='briar-companion://auth-complete';const params=new URLSearchParams(location.search);const code=(params.get('user_code')||'').replace(/-/g,'').toUpperCase();const callbackParams=new URLSearchParams({user_code:code});if(mobileCompanion)callbackParams.set('client','mobile');const callbackUrl=base+'/device?'+callbackParams.toString();document.querySelector('#code').textContent=code||'코드 없음';const status=document.querySelector('#status');const google=document.querySelector('#google');const approve=document.querySelector('#approve');const deny=document.querySelector('#deny');
async function api(path,options={}){const response=await fetch(base+'/api/auth'+path,{credentials:'include',headers:{'content-type':'application/json'},...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error_description||'요청에 실패했습니다.');return data}
async function boot(){if(!code){status.textContent='유효한 기기 코드가 없습니다.';google.hidden=true;return}const session=await api('/get-session').catch(()=>null);if(!session?.user){status.textContent='먼저 Google 계정으로 로그인하세요.';return}google.hidden=true;await api('/device?user_code='+encodeURIComponent(code));approve.hidden=false;deny.hidden=false;status.textContent=session.user.email+' 계정으로 연결합니다.'}
google.onclick=async()=>{status.textContent='Google 로그인 페이지를 여는 중…';try{const data=await api('/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',callbackURL:callbackUrl})});location.href=data.url}catch(error){status.textContent=error.message}};
approve.onclick=async()=>{try{await api('/device/approve',{method:'POST',body:JSON.stringify({userCode:code})});approve.hidden=true;deny.hidden=true;if(mobileCompanion){status.textContent='승인되었습니다. Briar Companion으로 돌아갑니다…';window.setTimeout(()=>location.replace(returnUrl),250)}else{status.textContent='승인되었습니다. Briar 앱으로 돌아가세요.'}}catch(error){status.textContent=error.message}};
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

const workerJson = (
  worker: {
    id: string;
    device_id?: string;
    owner_user_id?: string;
    label: string;
    agent_provider: "codex" | "claude" | "grok";
    versions_json: string;
    state: string;
    accepting_work?: number;
    readiness_state?: string;
    readiness_detail?: string | null;
    capabilities_json?: string;
    max_concurrent_sessions?: number;
    active_sessions?: number;
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
  if (!bearerToken(request).startsWith("briar_worker_")) return projectId;
  const claimToken = request.headers.get("x-briar-claim-token");
  if (!claimToken?.startsWith("briar_claim_")) {
    throw new HttpError(409, "Active claim token is required");
  }
  const active = await db
    .prepare(
      `select id from briar_hunt_runs
       where id = ? and project_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and status not in ('completed', 'cancelled', 'blocked', 'failed')`,
    )
    .bind(runId, projectId, await sha256(claimToken), new Date().toISOString())
    .first<{ id: string }>();
  if (!active) throw new HttpError(409, "Auto Hunt claim token is no longer active");
  return projectId;
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
    responsibility: row.responsibility,
    skill: row.skill_markdown,
    calendarColor: row.calendar_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

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
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );

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
            : "Slack 멘션으로 생성된 이슈가 Auto Hunt 처리를 기다리고 있습니다.",
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
    const statusLabel =
      instruction.status === "backlog" ? "백로그" : "작업 대기열";
    const priorityLabel = instruction.priority
      ? ` · P${instruction.priority}`
      : "";
    await postSlackReply(
      token,
      payload.event,
      `:white_check_mark: *${instruction.title}* 이슈를 만들었습니다.\n프로젝트: ${project.name} · ${statusLabel}${priorityLabel}\n이슈 ID: \`${runId}\``,
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

async function handleSlackEventRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  if (!env.SLACK_SIGNING_SECRET?.trim()) {
    return json({ message: "Slack integration is not configured" }, 503);
  }
  const rawBody = await request.text();
  if (
    !(await verifySlackRequest(
      rawBody,
      request.headers,
      env.SLACK_SIGNING_SECRET,
    ))
  ) {
    return json({ message: "Invalid Slack signature" }, 401);
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
const organizationMemberJson = (row: OrganizationMemberRow) => ({
  userId: row.user_id,
  name: row.name,
  email: row.email,
  image: row.image,
  role: row.role,
  createdAt: row.created_at,
});

const canManageOrganization = (role: OrganizationRole | null) =>
  role === "owner" || role === "admin";

const settingsJson = (row: ProjectSettingsRow | null) => ({
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
    : structuredClone(repositoryWorkflowBootstrap),
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

const issueMessageJson = (message: IssueMessageRow) => ({
  id: message.id,
  runId: message.run_id,
  parentMessageId: message.parent_message_id,
  body: message.body,
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
  createdAt: message.created_at,
  updatedAt: message.updated_at,
});

export const claimConversationJson = (messages: IssueMessageRow[]) =>
  messages.map(issueMessageJson);

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
  events: HuntEventRow[],
  attachments: IssueAttachmentRow[],
) {
  return {
    id: run.id,
    runNumber: run.run_number,
    currentAttempt: run.current_attempt,
    currentRevision: run.current_revision,
    source: run.source,
    sourceKey: run.source_key,
    title: run.title,
    status: run.status,
    workflowStage: run.workflow_stage,
    workflow: normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json)),
    progress: progressForAutoHuntRun(
      run.status,
      run.workflow_stage,
      normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json)),
    ),
    detail: run.detail,
    priority: run.priority,
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
    resultSummary: run.result_summary,
    structuredResult: parseStructuredResult(run.structured_result_json),
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
    requestedWorkerId: run.requested_worker_id,
    requestedByUserId: run.requested_by_user_id,
    dispatchMode: run.dispatch_mode,
    dispatchedAt: run.dispatched_at,
    workerId: run.worker_id,
    startedAt: run.started_at,
    updatedAt: run.updated_at,
    completedAt: run.completed_at,
    eventCount: run.event_count,
    events: events.map(dashboardEventJson),
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
    return json({ user: session.user });
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
    const input = workerConcurrencySchema.parse(await readJson(request));
    const updated = await updateExecutionWorkerConcurrency(
      db,
      device.id,
      input.maxConcurrentSessions,
      new Date().toISOString(),
    );
    if (!updated) throw new HttpError(409, "Worker is disabled");
    return json({
      deviceId: updated.id,
      maxConcurrentSessions: updated.max_concurrent_sessions,
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
    return json({ projects: projects.map(projectJson) });
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
    const [attachments, evidenceImages] = await Promise.all([
      listIssueAttachments(db, project.id),
      listRunEvidenceImages(db, project.id),
    ]);
    const attachmentKeys = [...attachments, ...(evidenceImages ?? [])].map(
      (attachment) => attachment.object_key,
    );
    for (let offset = 0; offset < attachmentKeys.length; offset += 1_000) {
      await attachmentsBucket.delete(
        attachmentKeys.slice(offset, offset + 1_000),
      );
    }
    if (!(await deleteProject(db, project.id, session.user.id))) {
      throw new HttpError(404, "Project not found");
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const settingsMatch = pathname.match(/^\/projects\/([0-9a-f-]+)\/settings$/u);
  if (settingsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    return json({
      settings: settingsJson(await getProjectSettings(db, project.id)),
    });
  }
  if (settingsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = projectSettingsSchema.parse(await readJson(request));
    const settings = await updateProjectSettings(db, project.id, {
      velenOrg: input.velenOrg ?? null,
      dataSource: input.dataSource ?? null,
      linear: input.linear,
      githubRepository: input.githubRepository ?? null,
      workflow: input.workflow,
    });
    return json({ settings: settingsJson(settings) });
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
    if (result === "not_found") {
      throw new HttpError(404, "Project agent schedule not found");
    }
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
      : structuredClone(repositoryWorkflowBootstrap);
    const firstStageId = workflow.stages[0]?.id ?? null;
    const workflowStageIds = new Set(workflow.stages.map((stage) => stage.id));

    const statusMap = new Map<
      string,
      { status: AutoHuntRunStatus; workflowStage: string | null }
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

  const dashboardMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard$/u,
  );
  if (dashboardMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dashboardMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const observedAt = new Date().toISOString();
    const [{ runs, events }, settings, attachments, workers, executionPolicy] =
      await Promise.all([
        listDashboardRuns(db, project.id),
        getProjectSettings(db, project.id),
        listIssueAttachments(db, project.id),
        listExecutionWorkers(db, project.id, observedAt),
        getProjectExecutionWorkerPolicy(db, project.id),
      ]);
    const eventsByRun = new Map<string, HuntEventRow[]>();
    for (const event of events) {
      const runEvents = eventsByRun.get(event.run_id) ?? [];
      runEvents.push(event);
      eventsByRun.set(event.run_id, runEvents);
    }
    const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
    for (const attachment of attachments) {
      const runAttachments = attachmentsByRun.get(attachment.run_id) ?? [];
      runAttachments.push(attachment);
      attachmentsByRun.set(attachment.run_id, runAttachments);
    }
    return json({
      project: projectJson(project),
      settings: settingsJson(settings),
      runs: runs.map((run) =>
        dashboardRunJson(
          run,
          eventsByRun.get(run.id) ?? [],
          attachmentsByRun.get(run.id) ?? [],
        ),
      ),
      workers: workers.map((worker) => workerJson(worker, observedAt)),
      executionPolicy,
      generatedAt: observedAt,
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
    const messages = await listIssueMessages(db, project.id, run.id);
    return json({ messages: messages.map(issueMessageJson) });
  }
  if (issueMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessagesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const input = issueMessageInputSchema.parse(
      await readJson(request, 16_384),
    );
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
    const message = await createIssueMessage(db, {
      id: crypto.randomUUID(),
      projectId: project.id,
      runId: issueMessagesMatch[2],
      parentMessageId: input.parentMessageId ?? null,
      authorUserId: agentProvider ? null : session.user.id,
      authorAgentProvider: agentProvider,
      body: input.body,
      createdAt: new Date().toISOString(),
    });
    if (!message) {
      throw new HttpError(
        404,
        input.parentMessageId ? "Thread message not found" : "Run not found",
      );
    }
    return json({ message: issueMessageJson(message) }, 201);
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
    const [evidence, revisions, images] = await Promise.all([
      listRunEvidence(db, project.id, projectRunEvidenceMatch[2]),
      listRunStageRevisions(db, project.id, projectRunEvidenceMatch[2]),
      listRunEvidenceImages(db, project.id, projectRunEvidenceMatch[2]),
    ]);
    if (!evidence || !revisions || !images) {
      throw new HttpError(404, "Run not found");
    }
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
    const image = await getRunEvidenceImage(
      db,
      projectEvidenceImageMatch[1],
      projectEvidenceImageMatch[2],
      projectEvidenceImageMatch[3],
    );
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
    const [{ input, attachments }, settings] = await Promise.all([
      readIssueRequest(request),
      getProjectSettings(db, project.id),
    ]);
    const issueId = crypto.randomUUID();
    const sourceKey = `briar-issue:${issueId}`;
    const occurredAt = new Date().toISOString();
    const detail =
      input.status === "backlog"
        ? "Briar 앱에서 생성된 이슈가 백로그에 추가되었습니다."
        : "Briar 앱에서 생성된 이슈가 Auto Hunt 처리를 기다리고 있습니다.";
    const storedAttachments: Array<IssueAttachmentInput & { file: File }> =
      attachments.map((file) => {
        const id = crypto.randomUUID();
        return {
          id,
          object_key: `issue-attachments/${project.id}/${issueId}/${id}`,
          filename: file.name.normalize("NFC").trim(),
          content_type: file.type,
          byte_size: file.size,
          file,
        };
      });
    const uploadedKeys: string[] = [];
    let runId: string | null = null;
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
      runId = await recordHuntEvent(db, project.id, {
        source: "issue",
        sourceKey,
        title: input.title,
        stage: "queued",
        status: input.status,
        workflowStage: null,
        eventKey: `${sourceKey}:${input.status}:intake`,
        occurredAt,
        actor: "briar-app",
        repository: settings?.github_repository ?? project.name,
        detail,
        priority: input.priority ?? null,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: input.description || null,
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: occurredAt,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: {
          origin: "briar-app",
          issueId,
          attachmentCount: storedAttachments.length,
        },
      });
      await createIssueAttachments(
        db,
        project.id,
        runId,
        storedAttachments.map(({ file: _file, ...attachment }) => attachment),
      );
      const attachmentRows = await listIssueAttachments(db, project.id, runId);
      return json(
        {
          runId,
          sourceKey,
          stage: "queued",
          status: input.status,
          attachments: attachmentRows.map(attachmentJson),
        },
        201,
      );
    } catch (error) {
      if (runId) {
        try {
          await rollbackNewAppIssue(db, project.id, runId);
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
          await attachmentsBucket.delete(uploadedKeys);
        } catch (cleanupError) {
          console.error(
            JSON.stringify({
              message: "attachment cleanup failed",
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
              issueId,
            }),
          );
        }
      }
      throw error;
    }
  }

  const recoveryMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );

  const issueUpdateMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)$/u,
  );
  if (issueUpdateMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issueUpdateMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = issueUpdateInputSchema.parse(await readJson(request));
    const run = await updateIssue(db, project.id, issueUpdateMatch[2], {
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? null,
      updatedAt: new Date().toISOString(),
    });
    if (!run) throw new HttpError(404, "Run not found");
    return json({
      runId: run.id,
      title: run.title,
      description: run.issue_description,
      priority: run.priority,
    });
  }
  if (issueUpdateMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issueUpdateMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const [attachments, evidenceImages] = await Promise.all([
      listIssueAttachments(db, project.id, issueUpdateMatch[2]),
      listAllRunEvidenceImages(db, project.id, issueUpdateMatch[2]),
    ]);
    const outcome = await deleteIssue(
      db,
      project.id,
      issueUpdateMatch[2],
      new Date().toISOString(),
    );
    if (outcome === "not_found") throw new HttpError(404, "Run not found");
    if (outcome === "active") {
      throw new HttpError(409, "An active Auto Hunt issue cannot be deleted");
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
    return new Response(null, { status: 204, headers: corsHeaders });
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
        agentId: input.agentId,
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
    const events = await listExecutionAuditEvents(db, project.id, runId);
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
    return json({ worker: workerJson(worker, observedAt), reaped });
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
    const result = await appendAgentTranscript(db, projectId, {
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      workerId: authenticatedWorkerId ?? input.workerId ?? null,
      agentProvider: input.agentProvider,
      events: input.events,
      observedAt: new Date().toISOString(),
    });
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
    const transcript = await readAgentTranscript(
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
    const [attachments, messages] = run
      ? await Promise.all([
          listIssueAttachments(db, projectId, run.id),
          listIssueMessages(db, projectId, run.id),
        ])
      : [[], []];
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
            agent: agent
              ? {
                  id: agent.id,
                  name: agent.name,
                  provider: agent.provider,
                  model: agent.model,
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
    const [evidence, revisions, images] = await Promise.all([
      listRunEvidence(db, projectId, evidenceMatch[1]),
      listRunStageRevisions(db, projectId, evidenceMatch[1]),
      listRunEvidenceImages(db, projectId, evidenceMatch[1]),
    ]);
    if (!evidence || !revisions || !images) {
      throw new HttpError(404, "Run not found");
    }
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
    const projectId = await requireActiveWorkerRunClaim(
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
      });
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
      ? await requireActiveWorkerRunClaim(db, request, parsed.runId)
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
  async fetch(
    request: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "briar-api",
        database: "cloudflare-d1",
        updates: "cloudflare-r2",
      });
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
    const releaseResponse = await serveRelease(request, env.RELEASES);
    if (releaseResponse) return releaseResponse;
    if (url.pathname === "/brand/briar-icon.png" && request.method === "GET") {
      return pngResponse(briarIconPng);
    }
    if (url.pathname === "/device" && request.method === "GET") {
      return devicePage(
        url.origin,
        url.searchParams.get("client") === "mobile" ||
          url.searchParams.get("client") === "android",
      );
    }

    try {
      const auth = createAuth(env, url.origin);
      return await route(request, auth, env.DB, env.ATTACHMENTS, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ message: error.message }, error.status);
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
