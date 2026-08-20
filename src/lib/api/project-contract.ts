import * as Schema from "effect/Schema";
import {
  DataImageString,
  defaulted,
  mutableArray,
  NonNegativeInteger,
  UuidString,
} from "./schema-helpers";

export const ProjectResponse = Schema.Struct({
  id: UuidString,
  name: Schema.String,
  issueKeyPrefix: defaulted(
    Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,3}$/u)),
    "AH",
  ),
  scheduleTabEnabled: defaulted(Schema.Boolean, true),
  icon: defaulted(Schema.NullOr(DataImageString), null),
  organizationId: UuidString,
  organizationName: Schema.String,
  role: Schema.Literals(["owner", "admin", "member"]),
  createdAt: Schema.String,
});
export type ProjectResponse = typeof ProjectResponse.Type;

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

const ProjectsResponse = mutableArray(ProjectResponse);

export const decodeProjectResponse = Schema.decodeUnknownSync(ProjectResponse);
export const decodeProjectsResponse = Schema.decodeUnknownSync(ProjectsResponse);
export const decodeProjectUsageSummaryResponse = Schema.decodeUnknownSync(
  ProjectUsageSummaryResponse,
);
