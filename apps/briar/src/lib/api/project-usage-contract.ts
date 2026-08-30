import * as Schema from "effect/Schema";
import { mutableArray, NonNegativeInteger } from "./schema-helpers";

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

export const decodeProjectUsageSummaryResponse = Schema.decodeUnknownSync(
  ProjectUsageSummaryResponse,
);
