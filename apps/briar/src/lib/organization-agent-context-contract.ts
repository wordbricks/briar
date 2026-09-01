import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTimeWithOffset } from "./date-time-schema";

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

const OrganizationAgentContextId = stringBetween(1, 128);

const OrganizationAgentContextLookupIds = mutableArrayBetween(
  OrganizationAgentContextId,
  1,
  50,
);

const OrganizationAgentContextSummaryLookup = strict(Schema.Struct({
  resource: Schema.Literals(["agents", "issues", "agent-sessions"]),
  projectId: OrganizationAgentContextId,
  detail: Schema.Literal("summary"),
  limit: integerBetween(1, 50),
  cursor: Schema.NullOr(stringBetween(1, 4_096)),
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

export const OrganizationAgentContextRequests = mutableArrayBetween(
  OrganizationAgentContextLookupRequest,
  1,
  12,
);

export const OrganizationAgentContextRequestTurn = strict(Schema.Struct({
  contextRequests: OrganizationAgentContextRequests,
}));
export type OrganizationAgentContextRequestTurn =
  typeof OrganizationAgentContextRequestTurn.Type;

export const decodeOrganizationAgentContextManifest = Schema.decodeUnknownSync(
  OrganizationAgentContextManifest,
  strictSchemaOptions,
);
export const decodeOrganizationAgentContextRequestTurn =
  Schema.decodeUnknownSync(
    OrganizationAgentContextRequestTurn,
    strictSchemaOptions,
  );
