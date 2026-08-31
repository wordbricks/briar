import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { ModelEffort } from "./agent-provider-contract";
import { agentProviders } from "./agent-provider";
import { IsoDateTimeWithOffset } from "./date-time-schema";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillBodyMaxLength,
  agentSkillDescriptionMaxLength,
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

export type OrganizationAgentContextResource =
  (typeof organizationAgentContextResources)[number];

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: strictSchemaOptions });

const mutableArrayAtMost = <S extends Schema.Top>(
  item: S,
  maximum: number,
) => Schema.mutable(Schema.Array(item)).check(Schema.isMaxLength(maximum));

const mutableArrayBetween = <S extends Schema.Top>(
  item: S,
  minimum: number,
  maximum: number,
) =>
  Schema.mutable(Schema.Array(item)).check(
    Schema.isLengthBetween(minimum, maximum),
  );

const stringBetween = (minimum: number, maximum: number) =>
  Schema.String.check(Schema.isLengthBetween(minimum, maximum));

const integerBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  );

const nonNegativeInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);

const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));

const defaulted = <S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema);

const defaultedWith = <S extends Schema.Constraint>(
  schema: S,
  value: () => S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema);

const UrlString = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      new URL(value);
      return undefined;
    } catch {
      return "Expected a valid URL";
    }
  }),
);

const OrganizationAgentContextId = stringBetween(1, 128);

/**
 * Attached to an Organization Agent claim to advertise the private, paginated
 * context protocol supported by the claiming Worker.
 */
export const OrganizationAgentContextDescriptor = strict(Schema.Struct({
  schemaVersion: Schema.Literal(1),
  snapshotAt: IsoDateTimeWithOffset,
}));
export type OrganizationAgentContextDescriptor =
  typeof OrganizationAgentContextDescriptor.Type;

const OrganizationAgentContextLimit = Schema.Unknown.pipe(
  Schema.decodeTo(
    defaulted(integerBetween(1, 50), 25),
    SchemaTransformation.transform<number | undefined, unknown>({
      decode: (value) => {
        if (value === undefined || value === null || value === "") {
          return undefined;
        }
        if (typeof value !== "string") {
          return typeof value === "number" ? value : Number.NaN;
        }
        const normalized = value.trim();
        return /^[0-9]+$/u.test(normalized)
          ? Number(normalized)
          : Number.NaN;
      },
      encode: (value) => value,
    }),
  ),
);

/** Query shared by all claim-scoped organization-context resources. */
export const OrganizationAgentContextQuery = strict(Schema.Struct({
  workerId: Schema.Trim.check(Schema.isLengthBetween(1, 64)),
  limit: OrganizationAgentContextLimit,
  cursor: Schema.optional(stringBetween(1, 4_096)),
}));
export type OrganizationAgentContextQuery =
  typeof OrganizationAgentContextQuery.Type;

const OrganizationAgentContextLookupIds = mutableArrayBetween(
  OrganizationAgentContextId,
  1,
  50,
);

const OrganizationAgentContextSummaryLookup = strict(Schema.Struct({
  resource: Schema.Literals(["agents", "issues", "agent-sessions"]),
  projectId: OrganizationAgentContextId,
  detail: Schema.Literal("summary"),
  limit: defaulted(integerBetween(1, 50), 25),
  cursor: defaulted(Schema.NullOr(stringBetween(1, 4_096)), null),
}));

const OrganizationAgentContextDetailLookup = strict(Schema.Struct({
  resource: Schema.Literals(["agents", "issues", "agent-sessions"]),
  projectId: OrganizationAgentContextId,
  detail: Schema.Literal("full"),
  ids: OrganizationAgentContextLookupIds,
}));

export const OrganizationAgentContextLookupRequest = Schema.Union([
  strict(Schema.Struct({
    resource: Schema.Literal("project-settings"),
    projectId: OrganizationAgentContextId,
  })),
  OrganizationAgentContextSummaryLookup,
  OrganizationAgentContextDetailLookup,
  strict(Schema.Struct({
    resource: Schema.Literal("skills"),
    projectId: OrganizationAgentContextId,
    ids: OrganizationAgentContextLookupIds,
  })),
  strict(Schema.Struct({
    resource: Schema.Literal("issue-pull-requests"),
    projectId: OrganizationAgentContextId,
    issueIds: OrganizationAgentContextLookupIds,
  })),
]);
export type OrganizationAgentContextLookupRequest =
  typeof OrganizationAgentContextLookupRequest.Type;

export const OrganizationAgentContextLookupInput = strict(Schema.Struct({
  requestId: Schema.optional(Schema.String.check(Schema.isUUID())),
  workerId: Schema.Trim.check(Schema.isLengthBetween(1, 64)),
  requests: mutableArrayBetween(OrganizationAgentContextLookupRequest, 1, 12),
}));
export type OrganizationAgentContextLookupInput =
  typeof OrganizationAgentContextLookupInput.Type;

export const OrganizationAgentContextLookupResult = strict(Schema.Struct({
  request: OrganizationAgentContextLookupRequest,
  // This opaque extension point accepts omission as well as explicit undefined.
  data: Schema.optional(Schema.Unknown),
}));
export type OrganizationAgentContextLookupResult =
  typeof OrganizationAgentContextLookupResult.Type;

export const OrganizationAgentContextLookupResponse = strict(Schema.Struct({
  schemaVersion: Schema.Literal(2),
  organizationId: OrganizationAgentContextId,
  workId: OrganizationAgentContextId,
  snapshotAt: IsoDateTimeWithOffset,
  results: mutableArrayAtMost(OrganizationAgentContextLookupResult, 12),
}));
export type OrganizationAgentContextLookupResponse =
  typeof OrganizationAgentContextLookupResponse.Type;

const OrganizationAgentContextResourceRevision = strict(Schema.Struct({
  count: nonNegativeInteger,
  revision: Schema.NullOr(IsoDateTimeWithOffset),
}));

export const OrganizationAgentContextManifestProject = strict(Schema.Struct({
  id: OrganizationAgentContextId,
  name: stringBetween(1, 100),
  issueKeyPrefix: Schema.String.check(
    Schema.isPattern(/^[A-Z0-9]{1,3}$/u),
  ),
  createdAt: IsoDateTimeWithOffset,
  updatedAt: IsoDateTimeWithOffset,
  resources: strict(Schema.Struct({
    settings: strict(Schema.Struct({
      revision: Schema.NullOr(IsoDateTimeWithOffset),
    })),
    agents: OrganizationAgentContextResourceRevision,
    issues: strict(Schema.Struct({
      ...OrganizationAgentContextResourceRevision.fields,
      openCount: nonNegativeInteger,
      pullRequestCount: nonNegativeInteger,
    })),
    sessions: strict(Schema.Struct({
      ...OrganizationAgentContextResourceRevision.fields,
      archivedCount: nonNegativeInteger,
    })),
  })),
}));
export type OrganizationAgentContextManifestProject =
  typeof OrganizationAgentContextManifestProject.Type;

const OrganizationAgentContextLoadedQuery = strict(Schema.Struct({
  file: stringBetween(1, 1_024),
  request: OrganizationAgentContextLookupRequest,
}));

export const OrganizationAgentContextManifest = strict(Schema.Struct({
  schemaVersion: Schema.Literal(2),
  organizationId: OrganizationAgentContextId,
  workId: OrganizationAgentContextId,
  snapshotAt: IsoDateTimeWithOffset,
  revision: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  projects: mutableArrayAtMost(OrganizationAgentContextManifestProject, 5_000),
  loadedQueries: defaultedWith(
    mutableArrayAtMost(OrganizationAgentContextLoadedQuery, 36),
    () => [],
  ),
}));
export type OrganizationAgentContextManifest =
  typeof OrganizationAgentContextManifest.Type;

export const OrganizationAgentContextRequestTurn = strict(Schema.Struct({
  contextRequests: mutableArrayBetween(
    OrganizationAgentContextLookupRequest,
    1,
    12,
  ),
}));
export type OrganizationAgentContextRequestTurn =
  typeof OrganizationAgentContextRequestTurn.Type;

export const OrganizationAgentContextAgentSkill = strict(Schema.Struct({
  id: OrganizationAgentContextId,
  name: stringBetween(1, 100),
  description: Schema.String.check(
    Schema.isLengthBetween(1, agentSkillDescriptionMaxLength),
  ),
  body: Schema.String.check(
    Schema.isLengthBetween(1, agentSkillBodyMaxLength),
  ),
  provider: Schema.Literals(agentProviders),
  model: Schema.NullOr(stringBetween(1, 100)),
  effort: Schema.NullOr(ModelEffort),
  kind: Schema.Literals(["issue_processing", "custom"]),
  position: integerBetween(0, 999),
}));
export type OrganizationAgentContextAgentSkill =
  typeof OrganizationAgentContextAgentSkill.Type;

export const OrganizationAgentContextProjectAgent = strict(Schema.Struct({
  id: OrganizationAgentContextId,
  name: stringBetween(1, 100),
  provider: Schema.Literals(agentProviders),
  model: Schema.NullOr(stringBetween(1, 100)),
  effort: Schema.NullOr(ModelEffort),
  description: Schema.String.check(
    Schema.isMaxLength(agentDescriptionMaxLength),
  ),
  responsibility: Schema.String.check(
    Schema.isMaxLength(agentResponsibilityMaxLength),
  ),
  skills: mutableArrayAtMost(
    OrganizationAgentContextAgentSkill,
    agentSkillsMaxCount,
  ),
  createdAt: IsoDateTimeWithOffset,
  updatedAt: IsoDateTimeWithOffset,
}));
export type OrganizationAgentContextProjectAgent =
  typeof OrganizationAgentContextProjectAgent.Type;

export const OrganizationAgentContextProject = strict(Schema.Struct({
  id: OrganizationAgentContextId,
  name: stringBetween(1, 100),
  issueKeyPrefix: Schema.String.check(
    Schema.isPattern(/^[A-Z0-9]{1,3}$/u),
  ),
  createdAt: IsoDateTimeWithOffset,
  settings: strict(Schema.Struct({
    velenOrg: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
    dataSource: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
    linear: strict(Schema.Struct({
      enabled: Schema.Boolean,
      source: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
      teamKey: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
    })),
    githubRepository: Schema.NullOr(
      Schema.String.check(Schema.isMaxLength(500)),
    ),
    // Persisted workflows may be omitted or explicitly undefined.
    workflow: Schema.optional(Schema.Unknown),
  })),
}));
export type OrganizationAgentContextProject =
  typeof OrganizationAgentContextProject.Type;

const OrganizationAgentContextTracker = strict(Schema.Struct({
  provider: stringBetween(1, 100),
  issueId: Schema.NullOr(stringBetween(1, 500)),
  identifier: Schema.NullOr(stringBetween(1, 500)),
  url: Schema.NullOr(UrlString.check(Schema.isMaxLength(2_000))),
  state: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
}));

export const OrganizationAgentContextIssue = strict(Schema.Struct({
  id: OrganizationAgentContextId,
  projectId: OrganizationAgentContextId,
  runNumber: positiveInteger,
  source: Schema.Literals(autoHuntSources),
  sourceKey: stringBetween(1, 200),
  title: stringBetween(1, 300),
  status: Schema.Literals(autoHuntRunStatuses),
  workflowStage: Schema.NullOr(stringBetween(1, 64)),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_000))),
  priority: Schema.NullOr(integerBetween(1, 4)),
  assigneeUserId: Schema.NullOr(OrganizationAgentContextId),
  agentId: Schema.NullOr(OrganizationAgentContextId),
  issueDescription: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(100_000)),
  ),
  resultSummary: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(100_000)),
  ),
  // Persisted results may be omitted, null, or explicitly undefined.
  structuredResult: Schema.optional(Schema.NullOr(Schema.Unknown)),
  repository: stringBetween(1, 500),
  branch: Schema.NullOr(stringBetween(1, 500)),
  commitSha: Schema.NullOr(stringBetween(7, 64)),
  targetSha: Schema.NullOr(stringBetween(7, 64)),
  tracker: Schema.NullOr(OrganizationAgentContextTracker),
  preferredProvider: Schema.NullOr(Schema.Literals(agentProviders)),
  preferredModel: Schema.NullOr(stringBetween(1, 100)),
  preferredEffort: Schema.NullOr(ModelEffort),
  requestedProvider: Schema.NullOr(Schema.Literals(agentProviders)),
  requestedModel: Schema.NullOr(stringBetween(1, 100)),
  requestedEffort: Schema.NullOr(ModelEffort),
  stagingQaStatus: Schema.NullOr(Schema.Literals(autoHuntQaStatuses)),
  productionQaStatus: Schema.NullOr(Schema.Literals(autoHuntQaStatuses)),
  stagingQaDetail: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(100_000)),
  ),
  productionQaDetail: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(100_000)),
  ),
  sourceCreatedAt: Schema.NullOr(IsoDateTimeWithOffset),
  startedAt: IsoDateTimeWithOffset,
  createdAt: IsoDateTimeWithOffset,
  updatedAt: IsoDateTimeWithOffset,
  completedAt: Schema.NullOr(IsoDateTimeWithOffset),
  lastEventAt: IsoDateTimeWithOffset,
  eventCount: nonNegativeInteger,
  eventCountStable: Schema.Boolean,
}));
export type OrganizationAgentContextIssue =
  typeof OrganizationAgentContextIssue.Type;

export const OrganizationAgentContextIssuePullRequest = strict(Schema.Struct({
  issueId: OrganizationAgentContextId,
  projectId: OrganizationAgentContextId,
  runNumber: positiveInteger,
  position: nonNegativeInteger,
  url: UrlString.check(Schema.isMaxLength(2_000)),
}));
export type OrganizationAgentContextIssuePullRequest =
  typeof OrganizationAgentContextIssuePullRequest.Type;

const OrganizationAgentContextFollowUp = strict(Schema.Struct({
  id: stringBetween(1, 128),
  message: stringBetween(1, 50_000),
  sentAt: IsoDateTimeWithOffset,
}));

const OrganizationAgentContextSessionIssue = strict(Schema.Struct({
  runId: stringBetween(1, 128),
  runNumber: nonNegativeInteger,
  sourceKey: stringBetween(1, 500),
  title: stringBetween(1, 500),
  outcome: Schema.Literals([
    "pending",
    "completed",
    "blocked",
    "failed",
    "skipped",
  ]),
  summary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(50_000))),
}));

const OrganizationAgentContextSessionEvent = strict(Schema.Struct({
  id: stringBetween(1, 128),
  type: Schema.Literals([
    "started",
    "completed",
    "failed",
    "skipped",
    "interrupted",
    "stopped",
  ]),
  occurredAt: IsoDateTimeWithOffset,
}));

export const OrganizationAgentContextSessionPayload = strict(Schema.Struct({
  dispatchGroupId: Schema.optional(
    Schema.String.check(Schema.isMaxLength(128)),
  ),
  agentId: Schema.optional(Schema.NullOr(OrganizationAgentContextId)),
  agentName: Schema.optional(Schema.NullOr(stringBetween(1, 200))),
  skillId: Schema.optional(Schema.NullOr(OrganizationAgentContextId)),
  sessionType: Schema.optional(Schema.Literals(["task", "dispatch"])),
  trigger: Schema.optional(
    Schema.NullOr(Schema.Literals(["manual", "scheduled"])),
  ),
  scheduleId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  scheduleRunId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  parentSessionId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  request: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(50_000))),
  ),
  followUps: Schema.optional(
    mutableArrayAtMost(OrganizationAgentContextFollowUp, 200),
  ),
  status: Schema.optional(Schema.Literals([
    "running",
    "completed",
    "failed",
    "skipped",
    "interrupted",
  ])),
  issues: Schema.optional(
    mutableArrayAtMost(OrganizationAgentContextSessionIssue, 100),
  ),
  startedAt: Schema.optional(IsoDateTimeWithOffset),
  completedAt: Schema.optional(Schema.NullOr(IsoDateTimeWithOffset)),
  conversationId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  summary: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(50_000))),
  ),
  error: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(20_000))),
  ),
  requestedWorkerId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  workerId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  events: Schema.optional(
    mutableArrayAtMost(OrganizationAgentContextSessionEvent, 200),
  ),
  updatedAt: Schema.optional(IsoDateTimeWithOffset),
}));
export type OrganizationAgentContextSessionPayload =
  typeof OrganizationAgentContextSessionPayload.Type;

export const OrganizationAgentContextSession = strict(Schema.Struct({
  id: OrganizationAgentContextId,
  projectId: OrganizationAgentContextId,
  agentId: Schema.NullOr(OrganizationAgentContextId),
  status: Schema.Literals([
    "running",
    "completed",
    "failed",
    "skipped",
    "interrupted",
  ]),
  sessionType: Schema.Literals(["task", "dispatch"]),
  payload: OrganizationAgentContextSessionPayload,
  startedAt: IsoDateTimeWithOffset,
  completedAt: Schema.NullOr(IsoDateTimeWithOffset),
  updatedAt: IsoDateTimeWithOffset,
}));
export type OrganizationAgentContextSession =
  typeof OrganizationAgentContextSession.Type;

const organizationAgentContextPageFields = {
  schemaVersion: Schema.Literal(1),
  organizationId: OrganizationAgentContextId,
  workId: OrganizationAgentContextId,
  snapshotAt: IsoDateTimeWithOffset,
  total: nonNegativeInteger,
  nextCursor: Schema.NullOr(stringBetween(1, 4_096)),
  complete: Schema.Boolean,
} as const;

const validateOrganizationAgentContextPage = (
  page: { readonly complete: boolean; readonly nextCursor: string | null },
): Schema.FilterIssue | undefined =>
  page.complete === (page.nextCursor === null)
    ? undefined
    : {
        path: ["complete"],
        issue: "complete must be true exactly when nextCursor is null",
      };

const validateOrganizationAgentContextProjectPage = (
  page: {
    readonly complete: boolean;
    readonly nextCursor: string | null;
    readonly projectId: string;
    readonly items: ReadonlyArray<{ readonly projectId: string }>;
  },
): Schema.FilterOutput => {
  const issues: Array<Schema.FilterIssue> = [];
  const pageIssue = validateOrganizationAgentContextPage(page);
  if (pageIssue !== undefined) issues.push(pageIssue);
  page.items.forEach((item, index) => {
    if (item.projectId !== page.projectId) {
      issues.push({
        path: ["items", index, "projectId"],
        issue: "item projectId must match the page projectId",
      });
    }
  });
  return issues;
};

export const OrganizationAgentContextProjectsPage = strict(Schema.Struct({
  ...organizationAgentContextPageFields,
  resource: Schema.Literal("projects"),
  projectId: Schema.Null,
  items: mutableArrayAtMost(OrganizationAgentContextProject, 50),
}).check(
  Schema.makeFilter((page) => validateOrganizationAgentContextPage(page)),
));
export type OrganizationAgentContextProjectsPage =
  typeof OrganizationAgentContextProjectsPage.Type;

export const OrganizationAgentContextIssuesPage = strict(Schema.Struct({
  ...organizationAgentContextPageFields,
  resource: Schema.Literal("issues"),
  projectId: OrganizationAgentContextId,
  items: mutableArrayAtMost(OrganizationAgentContextIssue, 50),
}).check(
  Schema.makeFilter((page) =>
    validateOrganizationAgentContextProjectPage(page)
  ),
));
export type OrganizationAgentContextIssuesPage =
  typeof OrganizationAgentContextIssuesPage.Type;

export const OrganizationAgentContextAgentsPage = strict(Schema.Struct({
  ...organizationAgentContextPageFields,
  resource: Schema.Literal("agents"),
  projectId: OrganizationAgentContextId,
  items: mutableArrayAtMost(OrganizationAgentContextProjectAgent, 50),
}).check(
  Schema.makeFilter((page) => validateOrganizationAgentContextPage(page)),
));
export type OrganizationAgentContextAgentsPage =
  typeof OrganizationAgentContextAgentsPage.Type;

export const OrganizationAgentContextIssuePullRequestsPage = strict(
  Schema.Struct({
    ...organizationAgentContextPageFields,
    resource: Schema.Literal("issue-pull-requests"),
    projectId: OrganizationAgentContextId,
    items: mutableArrayAtMost(OrganizationAgentContextIssuePullRequest, 50),
  }).check(
    Schema.makeFilter((page) =>
      validateOrganizationAgentContextProjectPage(page)
    ),
  ),
);
export type OrganizationAgentContextIssuePullRequestsPage =
  typeof OrganizationAgentContextIssuePullRequestsPage.Type;

export const OrganizationAgentContextSessionsPage = strict(Schema.Struct({
  ...organizationAgentContextPageFields,
  resource: Schema.Literal("agent-sessions"),
  projectId: OrganizationAgentContextId,
  items: mutableArrayAtMost(OrganizationAgentContextSession, 50),
}).check(
  Schema.makeFilter((page) =>
    validateOrganizationAgentContextProjectPage(page)
  ),
));
export type OrganizationAgentContextSessionsPage =
  typeof OrganizationAgentContextSessionsPage.Type;

export const OrganizationAgentContextResourcePage = Schema.Union([
  OrganizationAgentContextProjectsPage,
  OrganizationAgentContextAgentsPage,
  OrganizationAgentContextIssuesPage,
  OrganizationAgentContextIssuePullRequestsPage,
  OrganizationAgentContextSessionsPage,
]);
export type OrganizationAgentContextResourcePage =
  typeof OrganizationAgentContextResourcePage.Type;

export const decodeOrganizationAgentContextDescriptor =
  Schema.decodeUnknownSync(
    OrganizationAgentContextDescriptor,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextQuery = Schema.decodeUnknownSync(
  OrganizationAgentContextQuery,
  strictSchemaOptions,
);
export const decodeOrganizationAgentContextLookupRequest =
  Schema.decodeUnknownSync(
    OrganizationAgentContextLookupRequest,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextLookupInput =
  Schema.decodeUnknownSync(
    OrganizationAgentContextLookupInput,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextLookupResult =
  Schema.decodeUnknownSync(
    OrganizationAgentContextLookupResult,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextLookupResponse =
  Schema.decodeUnknownSync(
    OrganizationAgentContextLookupResponse,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextManifest = Schema.decodeUnknownSync(
  OrganizationAgentContextManifest,
  strictSchemaOptions,
);
export const decodeOrganizationAgentContextRequestTurn =
  Schema.decodeUnknownSync(
    OrganizationAgentContextRequestTurn,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextProjectsPage =
  Schema.decodeUnknownSync(
    OrganizationAgentContextProjectsPage,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextIssuesPage =
  Schema.decodeUnknownSync(
    OrganizationAgentContextIssuesPage,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextAgentsPage =
  Schema.decodeUnknownSync(
    OrganizationAgentContextAgentsPage,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextIssuePullRequestsPage =
  Schema.decodeUnknownSync(
    OrganizationAgentContextIssuePullRequestsPage,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextSessionsPage =
  Schema.decodeUnknownSync(
    OrganizationAgentContextSessionsPage,
    strictSchemaOptions,
  );
export const decodeOrganizationAgentContextResourcePage =
  Schema.decodeUnknownSync(
    OrganizationAgentContextResourcePage,
    strictSchemaOptions,
  );
