import { z } from "zod";
import { modelEffortSchema } from "./agent-provider-contract";
import { agentProviders } from "./agent-provider";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillInstructionsMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";
import {
  autoHuntQaStatuses,
  autoHuntRunStatuses,
  autoHuntSources,
} from "./auto-hunt-contract";

export const organizationAgentContextResources = [
  "projects",
  "agents",
  "issues",
  "issue-pull-requests",
  "agent-sessions",
] as const;

export const organizationAgentContextCapability = { protocol: 1 } as const;

/**
 * Protocol 1 originally exposed only eager, paginated collections. These
 * request types are additive so older Workers can keep using those pages while
 * newer Workers fetch a small manifest and hydrate only the context selected by
 * an Organization Agent.
 */
export const organizationAgentContextLookupResources = [
  "project-settings",
  "agents",
  "skills",
  "issues",
  "issue-pull-requests",
  "agent-sessions",
] as const;

export type OrganizationAgentContextResource =
  (typeof organizationAgentContextResources)[number];

const organizationAgentContextIdSchema = z.string().min(1).max(128);
const organizationAgentContextTimestampSchema = z
  .string()
  .datetime({ offset: true });

/**
 * Attached to an Organization Agent claim to advertise the private, paginated
 * context protocol supported by the claiming Worker.
 */
export const organizationAgentContextDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotAt: organizationAgentContextTimestampSchema,
  })
  .strict();

const organizationAgentContextLimitSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return /^\d+$/u.test(normalized) ? Number(normalized) : Number.NaN;
}, z.number().int().min(1).max(50).default(25));

/** Query shared by all claim-scoped organization-context resources. */
export const organizationAgentContextQuerySchema = z
  .object({
    workerId: z.string().trim().min(1).max(64),
    limit: organizationAgentContextLimitSchema,
    cursor: z.string().min(1).max(4096).optional(),
  })
  .strict();

const organizationAgentContextLookupIdsSchema = z
  .array(organizationAgentContextIdSchema)
  .min(1)
  .max(50);

const organizationAgentContextSummaryLookupSchema = z
  .object({
    resource: z.enum(["agents", "issues", "agent-sessions"]),
    projectId: organizationAgentContextIdSchema,
    detail: z.literal("summary"),
    limit: z.number().int().min(1).max(50).default(25),
    cursor: z.string().min(1).max(4096).nullable().default(null),
  })
  .strict();

const organizationAgentContextDetailLookupSchema = z
  .object({
    resource: z.enum(["agents", "issues", "agent-sessions"]),
    projectId: organizationAgentContextIdSchema,
    detail: z.literal("full"),
    ids: organizationAgentContextLookupIdsSchema,
  })
  .strict();

export const organizationAgentContextLookupRequestSchema = z.union([
  z.object({
    resource: z.literal("project-settings"),
    projectId: organizationAgentContextIdSchema,
  }).strict(),
  organizationAgentContextSummaryLookupSchema,
  organizationAgentContextDetailLookupSchema,
  z.object({
    resource: z.literal("skills"),
    projectId: organizationAgentContextIdSchema,
    ids: organizationAgentContextLookupIdsSchema,
  }).strict(),
  z.object({
    resource: z.literal("issue-pull-requests"),
    projectId: organizationAgentContextIdSchema,
    issueIds: organizationAgentContextLookupIdsSchema,
  }).strict(),
]);

export const organizationAgentContextLookupInputSchema = z
  .object({
    workerId: z.string().trim().min(1).max(64),
    requests: z.array(organizationAgentContextLookupRequestSchema).min(1).max(12),
  })
  .strict();

export const organizationAgentContextLookupResultSchema = z
  .object({
    request: organizationAgentContextLookupRequestSchema,
    data: z.unknown(),
  })
  .strict();

export const organizationAgentContextLookupResponseSchema = z
  .object({
    schemaVersion: z.literal(2),
    organizationId: organizationAgentContextIdSchema,
    workId: organizationAgentContextIdSchema,
    snapshotAt: organizationAgentContextTimestampSchema,
    results: z.array(organizationAgentContextLookupResultSchema).max(12),
  })
  .strict();

const organizationAgentContextResourceRevisionSchema = z
  .object({
    count: z.number().int().nonnegative(),
    revision: organizationAgentContextTimestampSchema.nullable(),
  })
  .strict();

export const organizationAgentContextManifestProjectSchema = z
  .object({
    id: organizationAgentContextIdSchema,
    name: z.string().min(1).max(100),
    issueKeyPrefix: z.string().regex(/^[A-Z0-9]{1,3}$/u),
    createdAt: organizationAgentContextTimestampSchema,
    updatedAt: organizationAgentContextTimestampSchema,
    resources: z.object({
      settings: z.object({
        revision: organizationAgentContextTimestampSchema.nullable(),
      }).strict(),
      agents: organizationAgentContextResourceRevisionSchema,
      issues: organizationAgentContextResourceRevisionSchema.extend({
        openCount: z.number().int().nonnegative(),
        pullRequestCount: z.number().int().nonnegative(),
      }).strict(),
      sessions: organizationAgentContextResourceRevisionSchema.extend({
        archivedCount: z.number().int().nonnegative(),
      }).strict(),
    }).strict(),
  })
  .strict();

export const organizationAgentContextManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    organizationId: organizationAgentContextIdSchema,
    workId: organizationAgentContextIdSchema,
    snapshotAt: organizationAgentContextTimestampSchema,
    revision: z.string().regex(/^[0-9a-f]{64}$/u),
    projects: z.array(organizationAgentContextManifestProjectSchema).max(5_000),
    loadedQueries: z.array(z.object({
      file: z.string().min(1).max(1_024),
      request: organizationAgentContextLookupRequestSchema,
    }).strict()).max(36).default([]),
  })
  .strict();

export const organizationAgentContextRequestTurnSchema = z
  .object({
    contextRequests: z.array(organizationAgentContextLookupRequestSchema)
      .min(1)
      .max(12),
  })
  .strict();

export const organizationAgentContextAgentSkillSchema = z
  .object({
    id: organizationAgentContextIdSchema,
    name: z.string().min(1).max(100),
    instructions: z.string().max(agentSkillInstructionsMaxLength),
    provider: z.enum(agentProviders),
    model: z.string().min(1).max(100).nullable(),
    effort: modelEffortSchema.nullable(),
    kind: z.enum(["issue_processing", "custom"]),
    position: z.number().int().min(0).max(999),
  })
  .strict();

export const organizationAgentContextProjectAgentSchema = z
  .object({
    id: organizationAgentContextIdSchema,
    name: z.string().min(1).max(100),
    provider: z.enum(agentProviders),
    model: z.string().min(1).max(100).nullable(),
    effort: modelEffortSchema.nullable(),
    description: z.string().max(agentDescriptionMaxLength),
    responsibility: z.string().max(agentResponsibilityMaxLength),
    skills: z
      .array(organizationAgentContextAgentSkillSchema)
      .max(agentSkillsMaxCount),
    createdAt: organizationAgentContextTimestampSchema,
    updatedAt: organizationAgentContextTimestampSchema,
  })
  .strict();

export const organizationAgentContextProjectSchema = z
  .object({
    id: organizationAgentContextIdSchema,
    name: z.string().min(1).max(100),
    issueKeyPrefix: z.string().regex(/^[A-Z0-9]{1,3}$/u),
    createdAt: organizationAgentContextTimestampSchema,
    settings: z
      .object({
        velenOrg: z.string().max(500).nullable(),
        dataSource: z.string().max(500).nullable(),
        linear: z
          .object({
            enabled: z.boolean(),
            source: z.string().max(500).nullable(),
            teamKey: z.string().max(100).nullable(),
          })
          .strict(),
        githubRepository: z.string().max(500).nullable(),
        workflow: z.unknown(),
      })
      .strict(),
  })
  .strict();

export const organizationAgentContextIssueSchema = z
  .object({
    id: organizationAgentContextIdSchema,
    projectId: organizationAgentContextIdSchema,
    runNumber: z.number().int().positive(),
    source: z.enum(autoHuntSources),
    sourceKey: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    status: z.enum(autoHuntRunStatuses),
    workflowStage: z.string().min(1).max(64).nullable(),
    detail: z.string().max(4_000).nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    assigneeUserId: organizationAgentContextIdSchema.nullable(),
    agentId: organizationAgentContextIdSchema.nullable(),
    issueDescription: z.string().max(100_000).nullable(),
    resultSummary: z.string().max(100_000).nullable(),
    structuredResult: z.unknown().nullable(),
    repository: z.string().min(1).max(500),
    branch: z.string().min(1).max(500).nullable(),
    commitSha: z.string().min(7).max(64).nullable(),
    targetSha: z.string().min(7).max(64).nullable(),
    tracker: z
      .object({
        provider: z.string().min(1).max(100),
        issueId: z.string().min(1).max(500).nullable(),
        identifier: z.string().min(1).max(500).nullable(),
        url: z.string().url().max(2_000).nullable(),
        state: z.string().max(200).nullable(),
      })
      .strict()
      .nullable(),
    preferredProvider: z.enum(agentProviders).nullable(),
    preferredModel: z.string().min(1).max(100).nullable(),
    preferredEffort: modelEffortSchema.nullable(),
    requestedProvider: z.enum(agentProviders).nullable(),
    requestedModel: z.string().min(1).max(100).nullable(),
    requestedEffort: modelEffortSchema.nullable(),
    stagingQaStatus: z.enum(autoHuntQaStatuses).nullable(),
    productionQaStatus: z.enum(autoHuntQaStatuses).nullable(),
    stagingQaDetail: z.string().max(100_000).nullable(),
    productionQaDetail: z.string().max(100_000).nullable(),
    sourceCreatedAt: organizationAgentContextTimestampSchema.nullable(),
    startedAt: organizationAgentContextTimestampSchema,
    createdAt: organizationAgentContextTimestampSchema,
    updatedAt: organizationAgentContextTimestampSchema,
    completedAt: organizationAgentContextTimestampSchema.nullable(),
    lastEventAt: organizationAgentContextTimestampSchema,
    eventCount: z.number().int().nonnegative(),
    eventCountStable: z.boolean(),
  })
  .strict();

export const organizationAgentContextIssuePullRequestSchema = z
  .object({
    issueId: organizationAgentContextIdSchema,
    projectId: organizationAgentContextIdSchema,
    runNumber: z.number().int().positive(),
    position: z.number().int().nonnegative(),
    url: z.string().url().max(2_000),
  })
  .strict();

export const organizationAgentContextSessionPayloadSchema = z
  .object({
    dispatchGroupId: z.string().max(128),
    agentId: organizationAgentContextIdSchema.nullable(),
    agentName: z.string().min(1).max(200).nullable(),
    skillId: organizationAgentContextIdSchema.nullable(),
    sessionType: z.enum(["task", "dispatch"]),
    trigger: z.enum(["manual", "scheduled"]).nullable(),
    scheduleId: z.string().max(128).nullable(),
    scheduleRunId: z.string().max(128).nullable(),
    parentSessionId: z.string().max(128).nullable(),
    request: z.string().max(50_000).nullable(),
    followUps: z.array(z.object({
      id: z.string().min(1).max(128),
      message: z.string().min(1).max(50_000),
      sentAt: organizationAgentContextTimestampSchema,
    }).strict()).max(200),
    status: z.enum([
      "running",
      "completed",
      "failed",
      "skipped",
      "interrupted",
    ]),
    issues: z.array(z.object({
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
    }).strict()).max(100),
    startedAt: organizationAgentContextTimestampSchema,
    completedAt: organizationAgentContextTimestampSchema.nullable(),
    conversationId: z.string().max(128).nullable(),
    summary: z.string().max(50_000).nullable(),
    error: z.string().max(20_000).nullable(),
    requestedWorkerId: z.string().max(128).nullable(),
    workerId: z.string().max(128).nullable(),
    events: z.array(z.object({
      id: z.string().min(1).max(128),
      type: z.enum([
        "started",
        "completed",
        "failed",
        "skipped",
        "interrupted",
        "stopped",
      ]),
      occurredAt: organizationAgentContextTimestampSchema,
    }).strict()).max(200),
    updatedAt: organizationAgentContextTimestampSchema,
  })
  .partial()
  .strict();

export const organizationAgentContextSessionSchema = z
  .object({
    id: organizationAgentContextIdSchema,
    projectId: organizationAgentContextIdSchema,
    agentId: organizationAgentContextIdSchema.nullable(),
    status: z.enum([
      "running",
      "completed",
      "failed",
      "skipped",
      "interrupted",
    ]),
    sessionType: z.enum(["task", "dispatch"]),
    payload: organizationAgentContextSessionPayloadSchema,
    startedAt: organizationAgentContextTimestampSchema,
    completedAt: organizationAgentContextTimestampSchema.nullable(),
    updatedAt: organizationAgentContextTimestampSchema,
  })
  .strict();

const organizationAgentContextPageShape = {
  schemaVersion: z.literal(1),
  organizationId: organizationAgentContextIdSchema,
  workId: organizationAgentContextIdSchema,
  snapshotAt: organizationAgentContextTimestampSchema,
  total: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).max(4096).nullable(),
  complete: z.boolean(),
} as const;

function validateOrganizationAgentContextPage(
  page: { complete: boolean; nextCursor: string | null },
  context: z.RefinementCtx,
) {
  if (page.complete !== (page.nextCursor === null)) {
    context.addIssue({
      code: "custom",
      message: "complete must be true exactly when nextCursor is null",
      path: ["complete"],
    });
  }
}

function validateOrganizationAgentContextProjectPage(
  page: {
    complete: boolean;
    nextCursor: string | null;
    projectId: string;
    items: Array<{ projectId: string }>;
  },
  context: z.RefinementCtx,
) {
  validateOrganizationAgentContextPage(page, context);
  page.items.forEach((item, index) => {
    if (item.projectId !== page.projectId) {
      context.addIssue({
        code: "custom",
        message: "item projectId must match the page projectId",
        path: ["items", index, "projectId"],
      });
    }
  });
}

export const organizationAgentContextProjectsPageSchema = z
  .object({
    ...organizationAgentContextPageShape,
    resource: z.literal("projects"),
    projectId: z.null(),
    items: z.array(organizationAgentContextProjectSchema).max(50),
  })
  .strict()
  .superRefine(validateOrganizationAgentContextPage);

export const organizationAgentContextIssuesPageSchema = z
  .object({
    ...organizationAgentContextPageShape,
    resource: z.literal("issues"),
    projectId: organizationAgentContextIdSchema,
    items: z.array(organizationAgentContextIssueSchema).max(50),
  })
  .strict()
  .superRefine(validateOrganizationAgentContextProjectPage);

export const organizationAgentContextAgentsPageSchema = z
  .object({
    ...organizationAgentContextPageShape,
    resource: z.literal("agents"),
    projectId: organizationAgentContextIdSchema,
    items: z.array(organizationAgentContextProjectAgentSchema).max(50),
  })
  .strict()
  .superRefine(validateOrganizationAgentContextPage);

export const organizationAgentContextIssuePullRequestsPageSchema = z
  .object({
    ...organizationAgentContextPageShape,
    resource: z.literal("issue-pull-requests"),
    projectId: organizationAgentContextIdSchema,
    items: z.array(organizationAgentContextIssuePullRequestSchema).max(50),
  })
  .strict()
  .superRefine(validateOrganizationAgentContextProjectPage);

export const organizationAgentContextSessionsPageSchema = z
  .object({
    ...organizationAgentContextPageShape,
    resource: z.literal("agent-sessions"),
    projectId: organizationAgentContextIdSchema,
    items: z.array(organizationAgentContextSessionSchema).max(50),
  })
  .strict()
  .superRefine(validateOrganizationAgentContextProjectPage);

export const organizationAgentContextResourcePageSchema = z.union([
  organizationAgentContextProjectsPageSchema,
  organizationAgentContextAgentsPageSchema,
  organizationAgentContextIssuesPageSchema,
  organizationAgentContextIssuePullRequestsPageSchema,
  organizationAgentContextSessionsPageSchema,
]);

export type OrganizationAgentContextDescriptor = z.infer<
  typeof organizationAgentContextDescriptorSchema
>;
export type OrganizationAgentContextQuery = z.output<
  typeof organizationAgentContextQuerySchema
>;
export type OrganizationAgentContextProject = z.infer<
  typeof organizationAgentContextProjectSchema
>;
export type OrganizationAgentContextIssue = z.infer<
  typeof organizationAgentContextIssueSchema
>;
export type OrganizationAgentContextIssuePullRequest = z.infer<
  typeof organizationAgentContextIssuePullRequestSchema
>;
export type OrganizationAgentContextSession = z.infer<
  typeof organizationAgentContextSessionSchema
>;
export type OrganizationAgentContextProjectsPage = z.infer<
  typeof organizationAgentContextProjectsPageSchema
>;
export type OrganizationAgentContextIssuesPage = z.infer<
  typeof organizationAgentContextIssuesPageSchema
>;
export type OrganizationAgentContextAgentsPage = z.infer<
  typeof organizationAgentContextAgentsPageSchema
>;
export type OrganizationAgentContextIssuePullRequestsPage = z.infer<
  typeof organizationAgentContextIssuePullRequestsPageSchema
>;
export type OrganizationAgentContextSessionsPage = z.infer<
  typeof organizationAgentContextSessionsPageSchema
>;
export type OrganizationAgentContextResourcePage = z.infer<
  typeof organizationAgentContextResourcePageSchema
>;
export type OrganizationAgentContextLookupRequest = z.output<
  typeof organizationAgentContextLookupRequestSchema
>;
export type OrganizationAgentContextLookupInput = z.output<
  typeof organizationAgentContextLookupInputSchema
>;
export type OrganizationAgentContextManifest = z.infer<
  typeof organizationAgentContextManifestSchema
>;
