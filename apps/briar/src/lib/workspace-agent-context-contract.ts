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

const WorkspaceAgentContextId = stringBetween(1, 128);

const WorkspaceAgentContextLookupIds = mutableArrayBetween(
  WorkspaceAgentContextId,
  1,
  50,
);

const WorkspaceAgentContextSummaryLookup = strict(Schema.Struct({
  resource: Schema.Literals(["agents", "issues", "agent-sessions"]),
  projectId: WorkspaceAgentContextId,
  detail: Schema.Literal("summary"),
  limit: integerBetween(1, 50),
  cursor: Schema.NullOr(stringBetween(1, 4_096)),
}));

const WorkspaceAgentContextDetailLookup = strict(Schema.Struct({
  resource: Schema.Literals(["agents", "issues", "agent-sessions"]),
  projectId: WorkspaceAgentContextId,
  detail: Schema.Literal("full"),
  ids: WorkspaceAgentContextLookupIds,
}));

export const WorkspaceAgentContextLookupRequest = Schema.Union([
  strict(Schema.Struct({
    resource: Schema.Literal("project-settings"),
    projectId: WorkspaceAgentContextId,
  })),
  WorkspaceAgentContextSummaryLookup,
  WorkspaceAgentContextDetailLookup,
  strict(Schema.Struct({
    resource: Schema.Literal("skills"),
    projectId: WorkspaceAgentContextId,
    ids: WorkspaceAgentContextLookupIds,
  })),
  strict(Schema.Struct({
    resource: Schema.Literal("issue-pull-requests"),
    projectId: WorkspaceAgentContextId,
    issueIds: WorkspaceAgentContextLookupIds,
  })),
]);
export type WorkspaceAgentContextLookupRequest =
  typeof WorkspaceAgentContextLookupRequest.Type;

const WorkspaceAgentContextResourceRevision = strict(Schema.Struct({
  count: nonNegativeInteger,
  revision: Schema.NullOr(IsoDateTimeWithOffset),
}));

export const WorkspaceAgentContextManifestProject = strict(Schema.Struct({
  id: WorkspaceAgentContextId,
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
    agents: WorkspaceAgentContextResourceRevision,
    issues: strict(Schema.Struct({
      ...WorkspaceAgentContextResourceRevision.fields,
      openCount: nonNegativeInteger,
      pullRequestCount: nonNegativeInteger,
    })),
    sessions: strict(Schema.Struct({
      ...WorkspaceAgentContextResourceRevision.fields,
      archivedCount: nonNegativeInteger,
    })),
  })),
}));
export type WorkspaceAgentContextManifestProject =
  typeof WorkspaceAgentContextManifestProject.Type;

const WorkspaceAgentContextLoadedQuery = strict(Schema.Struct({
  file: stringBetween(1, 1_024),
  request: WorkspaceAgentContextLookupRequest,
}));

export const WorkspaceAgentContextManifest = strict(Schema.Struct({
  schemaVersion: Schema.Literal(2),
  workspaceId: WorkspaceAgentContextId,
  workId: WorkspaceAgentContextId,
  snapshotAt: IsoDateTimeWithOffset,
  revision: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  projects: mutableArrayAtMost(WorkspaceAgentContextManifestProject, 5_000),
  loadedQueries: defaultedWith(
    mutableArrayAtMost(WorkspaceAgentContextLoadedQuery, 36),
    () => [],
  ),
}));
export type WorkspaceAgentContextManifest =
  typeof WorkspaceAgentContextManifest.Type;

export const WorkspaceAgentContextRequests = mutableArrayBetween(
  WorkspaceAgentContextLookupRequest,
  1,
  12,
);

export const WorkspaceAgentContextRequestTurn = strict(Schema.Struct({
  contextRequests: WorkspaceAgentContextRequests,
}));
export type WorkspaceAgentContextRequestTurn =
  typeof WorkspaceAgentContextRequestTurn.Type;

export const decodeWorkspaceAgentContextManifest = Schema.decodeUnknownSync(
  WorkspaceAgentContextManifest,
  strictSchemaOptions,
);
export const decodeWorkspaceAgentContextRequestTurn =
  Schema.decodeUnknownSync(
    WorkspaceAgentContextRequestTurn,
    strictSchemaOptions,
  );
