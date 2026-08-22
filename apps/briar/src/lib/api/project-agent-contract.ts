import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { ModelEffort } from "../agent-provider-contract";
import { agentProviders } from "../agent-provider";
import { StructuredAgentResult } from "../agent-result";
import {
  autoHuntRequirementKinds,
  normalizeAutoHuntWorkflow,
} from "../auto-hunt-contract";
import { defaultProjectAgentCalendarColor } from "../project-agent";
import {
  DataImageString,
  defaulted,
  defaultedWith,
  integerBetween,
  mutableArray,
  NonNegativeInteger,
  UuidString,
} from "./schema-helpers";

const ProjectAgentCodexPetResponse = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  author: Schema.String,
  license: Schema.String,
  spriteVersion: Schema.Literals([1, 2]),
  spriteSheetUrl: Schema.NullOr(Schema.String),
});

const ProjectAgentSkillResponseSource = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  provider: Schema.Literals(agentProviders),
  model: Schema.NullOr(Schema.String),
  effort: defaulted(Schema.NullOr(ModelEffort), null),
  kind: Schema.Literals(["issue_processing", "custom"]),
  position: NonNegativeInteger,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const ProjectAgentSkillResponseType = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  name: Schema.String,
  description: Schema.String,
  body: Schema.String,
  provider: Schema.Literals(agentProviders),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(ModelEffort),
  kind: Schema.Literals(["issue_processing", "custom"]),
  position: NonNegativeInteger,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const ProjectAgentSkillResponse = ProjectAgentSkillResponseSource.pipe(
  Schema.decodeTo(
    ProjectAgentSkillResponseType,
    SchemaTransformation.transform({
      decode: ({ body, description, instructions, ...skill }) => {
        const normalizedBody = body ?? instructions ?? "";
        return {
          ...skill,
          description: description ||
            normalizedBody.replace(/\s+/gu, " ").trim().slice(0, 1_000) ||
            skill.name,
          body: normalizedBody,
        };
      },
      encode: (skill) => ({ ...skill, instructions: undefined }),
    }),
  ),
);

const ProjectAgentScheduleRunAgentResponse = Schema.Struct({
  id: UuidString,
  name: Schema.String,
  provider: Schema.Literals(agentProviders),
  model: Schema.NullOr(Schema.String),
  effort: defaulted(Schema.NullOr(ModelEffort), null),
  description: defaulted(Schema.String, ""),
  responsibility: Schema.String,
  skill: Schema.String,
  skills: defaultedWith(mutableArray(ProjectAgentSkillResponse), () => []),
});

export const ProjectAgentResponse = Schema.Struct({
  id: UuidString,
  projectId: UuidString,
  name: Schema.String,
  avatar: defaulted(Schema.NullOr(DataImageString), null),
  codexPet: defaulted(Schema.NullOr(ProjectAgentCodexPetResponse), null),
  provider: Schema.Literals(agentProviders),
  model: Schema.NullOr(Schema.String),
  effort: defaulted(Schema.NullOr(ModelEffort), null),
  description: defaulted(Schema.String, ""),
  responsibility: Schema.String,
  skill: Schema.String,
  skills: defaultedWith(mutableArray(ProjectAgentSkillResponse), () => []),
  calendarColor: defaulted(
    Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/iu)),
    defaultProjectAgentCalendarColor,
  ),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectAgentResponse = typeof ProjectAgentResponse.Type;

const ProjectAgentSessionFollowUpResponse = Schema.Struct({
  id: Schema.String,
  message: Schema.String,
  sentAt: Schema.String,
});

const ProjectAgentSessionIssueResponse = Schema.Struct({
  runId: Schema.String,
  runNumber: Schema.Int,
  sourceKey: Schema.String,
  title: Schema.String,
  outcome: Schema.Literals([
    "pending",
    "completed",
    "blocked",
    "failed",
    "skipped",
  ]),
  summary: Schema.NullOr(Schema.String),
});

const ProjectAgentSessionEventResponse = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals([
    "started",
    "completed",
    "failed",
    "skipped",
    "interrupted",
    "stopped",
  ]),
  occurredAt: Schema.String,
});

export const ProjectAgentSessionResponse = Schema.Struct({
  id: Schema.String,
  projectId: UuidString,
  dispatchGroupId: Schema.String,
  agentId: Schema.NullOr(UuidString),
  agentName: Schema.optional(Schema.NullOr(Schema.String)),
  skillId: Schema.optional(Schema.NullOr(UuidString)),
  sessionType: Schema.Literals(["task", "dispatch"]),
  trigger: Schema.NullOr(Schema.Literals(["manual", "scheduled"])),
  scheduleId: Schema.NullOr(Schema.String),
  scheduleRunId: Schema.NullOr(Schema.String),
  parentSessionId: Schema.NullOr(Schema.String),
  request: Schema.NullOr(Schema.String),
  followUps: defaultedWith(
    mutableArray(ProjectAgentSessionFollowUpResponse),
    () => [],
  ),
  status: Schema.Literals([
    "running",
    "completed",
    "failed",
    "skipped",
    "interrupted",
  ]),
  issues: mutableArray(ProjectAgentSessionIssueResponse),
  startedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  conversationId: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.Null,
  summary: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  requestedWorkerId: Schema.optional(Schema.NullOr(Schema.String)),
  workerId: Schema.optional(Schema.NullOr(Schema.String)),
  requestedByUserId: Schema.optional(Schema.NullOr(Schema.String)),
  events: mutableArray(ProjectAgentSessionEventResponse),
  dispatchEvents: mutableArray(Schema.Never),
  workers: mutableArray(Schema.Never),
  updatedAt: Schema.String,
  archived: defaulted(Schema.Boolean, false),
  detailLoaded: defaulted(Schema.Boolean, true),
});
export type ProjectAgentSessionResponse =
  typeof ProjectAgentSessionResponse.Type;

export const ProjectAgentSessionSyncResponse = Schema.Struct({
  cursor: NonNegativeInteger,
  hasMore: Schema.Boolean,
  reset: Schema.Boolean,
  sessions: mutableArray(ProjectAgentSessionResponse),
  deletedSessionIds: mutableArray(Schema.String),
});
export type ProjectAgentSessionSyncResponse =
  typeof ProjectAgentSessionSyncResponse.Type;

export const ProjectAgentScheduleResponse = Schema.Struct({
  id: UuidString,
  projectId: UuidString,
  agentId: UuidString,
  agentName: Schema.String,
  agentProvider: Schema.Literals(agentProviders),
  name: Schema.String,
  recurrence: Schema.Literals([
    "interval",
    "daily",
    "weekdays",
    "weekly",
    "custom",
  ]),
  timeOfDay: Schema.String,
  dayOfWeek: Schema.NullOr(integerBetween(0, 6)),
  intervalValue: Schema.optional(integerBetween(1, 999)),
  intervalUnit: Schema.optional(
    Schema.Literals(["minute", "hour", "day", "week"]),
  ),
  daysOfWeek: Schema.optional(mutableArray(integerBetween(0, 6))),
  notificationLevel: Schema.optional(
    Schema.Literals(["important_updates", "none"]),
  ),
  timeZone: Schema.String,
  enabled: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectAgentScheduleResponse =
  typeof ProjectAgentScheduleResponse.Type;

const AutoHuntWorkflowRequirementResponse = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(autoHuntRequirementKinds),
  tool: Schema.String,
  reason: Schema.String,
});

const AutoHuntWorkflowStageResponse = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  required: Schema.Boolean,
  evidence: Schema.optional(mutableArray(Schema.String)),
  checks: Schema.optional(mutableArray(Schema.String)),
});

const AutoHuntWorkflowCheckpointResponse = Schema.Struct({
  key: Schema.String,
  stage: Schema.String,
  position: Schema.Literals(["before", "after"]),
});

const AutoHuntWorkflowSourceResponse = Schema.Struct({
  version: Schema.Literal(2),
  requirements: Schema.optional(
    mutableArray(AutoHuntWorkflowRequirementResponse),
  ),
  stages: mutableArray(AutoHuntWorkflowStageResponse),
  execution: Schema.optional(Schema.Struct({
    checkpoints: Schema.optional(
      mutableArray(AutoHuntWorkflowCheckpointResponse),
    ),
  })),
  completion: Schema.optional(Schema.Struct({
    requiredStages: mutableArray(Schema.String),
  })),
});

const NormalizedAutoHuntWorkflowResponse = Schema.Struct({
  version: Schema.Literal(2),
  requirements: mutableArray(AutoHuntWorkflowRequirementResponse),
  stages: mutableArray(AutoHuntWorkflowStageResponse),
  execution: Schema.Struct({
    checkpoints: mutableArray(AutoHuntWorkflowCheckpointResponse),
  }),
  completion: Schema.Struct({
    requiredStages: mutableArray(Schema.String),
  }),
});

export const ProjectAgentScheduleRunResponse = Schema.Struct({
  id: UuidString,
  projectId: UuidString,
  scheduleId: UuidString,
  scheduleName: Schema.String,
  agent: ProjectAgentScheduleRunAgentResponse,
  workflow: NormalizedAutoHuntWorkflowResponse,
  status: Schema.Literals(["running", "completed", "failed"]),
  scheduledFor: Schema.String,
  leaseExpiresAt: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  resultSummary: Schema.NullOr(Schema.String),
  structuredResult: Schema.NullOr(StructuredAgentResult),
  error: Schema.NullOr(Schema.String),
});
export type ProjectAgentScheduleRunResponse =
  typeof ProjectAgentScheduleRunResponse.Type;

const ProjectAgentScheduleRunSourceResponse = Schema.Struct({
  ...ProjectAgentScheduleRunResponse.fields,
  workflow: AutoHuntWorkflowSourceResponse,
});
type ProjectAgentScheduleRunSourceResponse =
  typeof ProjectAgentScheduleRunSourceResponse.Type;

export const ClaimedProjectAgentScheduleRunResponse = Schema.Struct({
  ...ProjectAgentScheduleRunResponse.fields,
  status: Schema.Literal("running"),
  claimToken: Schema.String.check(
    Schema.isPattern(/^briar_schedule_claim_[0-9a-f]{64}$/u),
  ),
});
export type ClaimedProjectAgentScheduleRunResponse =
  typeof ClaimedProjectAgentScheduleRunResponse.Type;

const ClaimedProjectAgentScheduleRunSourceResponse = Schema.Struct({
  ...ProjectAgentScheduleRunSourceResponse.fields,
  status: Schema.Literal("running"),
  claimToken: Schema.String.check(
    Schema.isPattern(/^briar_schedule_claim_[0-9a-f]{64}$/u),
  ),
});
type ClaimedProjectAgentScheduleRunSourceResponse =
  typeof ClaimedProjectAgentScheduleRunSourceResponse.Type;

const ProjectAgentsResponse = mutableArray(ProjectAgentResponse);
const ProjectAgentSessionsResponse = mutableArray(ProjectAgentSessionResponse);
const ProjectAgentSchedulesResponse = mutableArray(ProjectAgentScheduleResponse);
const ProjectAgentScheduleRunSourcesResponse = mutableArray(
  ProjectAgentScheduleRunSourceResponse,
);

const decodeProjectAgentScheduleRunSource = Schema.decodeUnknownSync(
  ProjectAgentScheduleRunSourceResponse,
);
const decodeProjectAgentScheduleRunSources = Schema.decodeUnknownSync(
  ProjectAgentScheduleRunSourcesResponse,
);
const decodeClaimedProjectAgentScheduleRunSource = Schema.decodeUnknownSync(
  ClaimedProjectAgentScheduleRunSourceResponse,
);

const normalizeProjectAgentScheduleRun = (
  run: ProjectAgentScheduleRunSourceResponse,
): ProjectAgentScheduleRunResponse => ({
  ...run,
  workflow: normalizeAutoHuntWorkflow(run.workflow),
});

const normalizeClaimedProjectAgentScheduleRun = (
  run: ClaimedProjectAgentScheduleRunSourceResponse,
): ClaimedProjectAgentScheduleRunResponse => ({
  ...run,
  workflow: normalizeAutoHuntWorkflow(run.workflow),
});

export const decodeProjectAgentResponse = Schema.decodeUnknownSync(
  ProjectAgentResponse,
);
export const decodeProjectAgentsResponse = Schema.decodeUnknownSync(
  ProjectAgentsResponse,
);
export const decodeProjectAgentSessionResponse = Schema.decodeUnknownSync(
  ProjectAgentSessionResponse,
);
export const decodeProjectAgentSessionsResponse = Schema.decodeUnknownSync(
  ProjectAgentSessionsResponse,
);
export const decodeProjectAgentSessionSyncResponse = Schema.decodeUnknownSync(
  ProjectAgentSessionSyncResponse,
);
export const decodeProjectAgentScheduleResponse = Schema.decodeUnknownSync(
  ProjectAgentScheduleResponse,
);
export const decodeProjectAgentSchedulesResponse = Schema.decodeUnknownSync(
  ProjectAgentSchedulesResponse,
);
export const decodeProjectAgentScheduleRunResponse = (input: unknown) =>
  normalizeProjectAgentScheduleRun(decodeProjectAgentScheduleRunSource(input));
export const decodeProjectAgentScheduleRunsResponse = (input: unknown) =>
  decodeProjectAgentScheduleRunSources(input).map(
    normalizeProjectAgentScheduleRun,
  );
export const decodeClaimedProjectAgentScheduleRunResponse = (input: unknown) =>
  normalizeClaimedProjectAgentScheduleRun(
    decodeClaimedProjectAgentScheduleRunSource(input),
  );
export const decodeLeaseExpirationResponse = Schema.decodeUnknownSync(
  Schema.String,
);
