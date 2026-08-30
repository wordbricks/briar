import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  decodeMobileOperationResponse,
  listProjectsOperation,
  mobileProjectSchema,
  type MobileProject,
} from "@briar/contracts";
import {
  DataImageString,
  mutableArray,
  NonNegativeInteger,
} from "./schema-helpers";

export const ProjectResponse = mobileProjectSchema;
export type ProjectResponse = typeof ProjectResponse.Type;

const decodeProjectIcon = Schema.decodeUnknownOption(
  Schema.NullOr(DataImageString),
);

const toProjectResponse = (project: MobileProject): ProjectResponse => ({
  ...project,
  // The HTTP contract permits future icon representations. The desktop UI
  // currently renders only bounded image data URLs, so keep that domain guard
  // after decoding the shared wire DTO.
  icon: Option.getOrNull(decodeProjectIcon(project.icon)),
});

const ProjectUsageTimelinePointResponse = Schema.Struct({
  startAt: Schema.String,
  completedIssues: NonNegativeInteger,
  totalTokens: NonNegativeInteger,
});

const ProjectUsageBreakdownItemResponse = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  issues: NonNegativeInteger,
});

export const ProjectUsageSummaryResponse = Schema.Struct({
  period: Schema.Literals(["day", "week", "month"]),
  rangeStart: Schema.String,
  rangeEnd: Schema.String,
  totalTokens: NonNegativeInteger,
  trackedDurationMs: NonNegativeInteger,
  observedRuns: NonNegativeInteger,
  reportedRuns: NonNegativeInteger,
  completedIssues: NonNegativeInteger,
  timeline: mutableArray(ProjectUsageTimelinePointResponse),
  issueCreators: mutableArray(ProjectUsageBreakdownItemResponse),
  agents: mutableArray(ProjectUsageBreakdownItemResponse),
  generatedAt: Schema.String,
});
export type ProjectUsageSummaryResponse =
  typeof ProjectUsageSummaryResponse.Type;

const decodeSharedProjectResponse = Schema.decodeUnknownSync(ProjectResponse);

export const decodeProjectResponse = (input: unknown): ProjectResponse =>
  toProjectResponse(decodeSharedProjectResponse(input));

export const decodeProjectsResponse = (input: unknown): ProjectResponse[] =>
  decodeMobileOperationResponse(listProjectsOperation, input).projects.map(
    toProjectResponse,
  );
export const decodeProjectUsageSummaryResponse = Schema.decodeUnknownSync(
  ProjectUsageSummaryResponse,
);
