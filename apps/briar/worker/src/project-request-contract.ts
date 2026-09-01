import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { ModelEffort } from "../../src/lib/agent-provider-contract";
import { agentProviders } from "../../src/lib/agent-provider";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillsMaxCount,
} from "../../src/lib/agent-limits";
import { defaultProjectAgentCalendarColor } from "../../src/lib/project-agent";
import {
  isValidProjectAgentScheduleTimeZone,
  normalizeProjectAgentScheduleDay,
  normalizeProjectAgentScheduleDays,
  normalizeProjectAgentScheduleInterval,
  projectAgentScheduleIntervalUnits,
  projectAgentScheduleNotificationLevels,
  projectAgentScheduleRecurrences,
} from "../../src/lib/project-agent-schedule";
import {
  channelAgentSkillInputSchema,
  organizationAgentInputSchema,
} from "../../src/lib/channels-contract";
import { IsoDateTimeWithOffset } from "../../src/lib/date-time-schema";
import {
  defaulted,
  defaultedWith,
  integerBetween,
  mutableArray,
  NonNegativeSafeInteger,
  strictSchema,
  strictSchemaOptions,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

const agentImagePattern =
  /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu;

export const ProjectTransferInput = Schema.Struct({
  targetProjectId: UuidString,
});

const CodexPetSelection = strictSchema(Schema.Struct({
  slug: Schema.String.check(
    Schema.isPattern(
      /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/u,
    ),
  ),
}));

const uniqueAgentSkillNames = Schema.makeFilter<{
  readonly skills?: ReadonlyArray<{ readonly name: string }>;
}>((input) => {
  if (!input.skills?.length) return undefined;
  const names = new Set<string>();
  const issues: Array<Schema.FilterIssue> = [];
  input.skills.forEach((skill, index) => {
    const key = skill.name.toLocaleLowerCase("en-US");
    if (names.has(key)) {
      issues.push({
        path: ["skills", index, "name"],
        issue: "Agent Skill names must be unique",
      });
    }
    names.add(key);
  });
  return issues.length > 0 ? issues : undefined;
});

export const ProjectAgentInput = strictSchema(Schema.Struct({
  name: Schema.optional(Schema.NullOr(trimmedText(1, 100))),
  description: Schema.optional(
    Schema.Trim.check(Schema.isMaxLength(agentDescriptionMaxLength)),
  ),
  avatar: Schema.optional(Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(400_000),
      Schema.isPattern(agentImagePattern),
    ),
  )),
  codexPet: Schema.optional(Schema.NullOr(CodexPetSelection)),
  provider: Schema.Literals(agentProviders),
  model: Schema.optional(Schema.NullOr(trimmedText(1, 100))),
  effort: Schema.optional(Schema.NullOr(ModelEffort)),
  designatedWorkerId: Schema.optional(Schema.NullOr(trimmedText(1, 128))),
  responsibility: trimmedText(1, agentResponsibilityMaxLength),
  skills: Schema.optional(
    mutableArray(channelAgentSkillInputSchema).check(
      Schema.isMaxLength(agentSkillsMaxCount),
    ),
  ),
  calendarColor: defaulted(
    Schema.Trim.check(Schema.isPattern(/^#[0-9a-f]{6}$/iu)),
    defaultProjectAgentCalendarColor,
  ),
}).check(uniqueAgentSkillNames));

export const OrganizationAgentWrite = strictSchema(
  organizationAgentInputSchema.check(uniqueAgentSkillNames),
);

const ProjectAgentSessionEvent = strictSchema(Schema.Struct({
  id: Schema.String.check(Schema.isLengthBetween(1, 128)),
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

const ProjectAgentSessionIssue = strictSchema(Schema.Struct({
  runId: Schema.String.check(Schema.isLengthBetween(1, 128)),
  runNumber: NonNegativeSafeInteger,
  sourceKey: Schema.String.check(Schema.isLengthBetween(1, 500)),
  title: Schema.String.check(Schema.isLengthBetween(1, 500)),
  outcome: Schema.Literals([
    "pending",
    "completed",
    "blocked",
    "failed",
    "skipped",
  ]),
  summary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(50_000))),
}));

export const ProjectAgentSessionInput = strictSchema(Schema.Struct({
  dispatchGroupId: Schema.String.check(Schema.isLengthBetween(1, 128)),
  agentId: Schema.NullOr(UuidString),
  agentName: Schema.optional(Schema.NullOr(trimmedText(1, 200))),
  skillId: Schema.optional(Schema.NullOr(UuidString)),
  sessionType: Schema.Literals(["task", "dispatch"]),
  trigger: Schema.NullOr(Schema.Literals(["manual", "scheduled"])),
  scheduleId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  scheduleRunId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  parentSessionId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  request: Schema.NullOr(Schema.String.check(Schema.isMaxLength(50_000))),
  followUps: defaultedWith(
    mutableArray(strictSchema(Schema.Struct({
      id: Schema.String.check(Schema.isLengthBetween(1, 128)),
      message: trimmedText(1, 50_000),
      sentAt: IsoDateTimeWithOffset,
    }))).check(Schema.isMaxLength(200)),
    () => [],
  ),
  status: Schema.Literals([
    "running",
    "completed",
    "failed",
    "skipped",
    "interrupted",
  ]),
  issues: mutableArray(ProjectAgentSessionIssue).check(Schema.isMaxLength(100)),
  startedAt: IsoDateTimeWithOffset,
  completedAt: Schema.NullOr(IsoDateTimeWithOffset),
  conversationId: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(128)),
  ),
  summary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(50_000))),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(20_000))),
  requestedWorkerId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  workerId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
  events: mutableArray(ProjectAgentSessionEvent).check(Schema.isMaxLength(200)),
  updatedAt: IsoDateTimeWithOffset,
}));

/**
 * Internal session snapshots may carry the server-owned requester binding used
 * to verify approved Agent Skill executions. It is intentionally absent from
 * the public write contract above, so clients cannot set it.
 */
export const StoredProjectAgentSessionPayload = strictSchema(Schema.Struct({
  ...ProjectAgentSessionInput.fields,
  requestedByUserId: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  ),
}));

export type StoredProjectAgentSessionPayload =
  typeof StoredProjectAgentSessionPayload.Type;

export const storedProjectAgentSessionPayloadMaxBytes = 1_048_576;
export const storedProjectAgentSessionSummaryMaxBytes = 262_144;

const boundedJsonString = (maximumBytes: number) =>
  Schema.String.check(
    Schema.makeFilter((value) =>
      new TextEncoder().encode(value).byteLength <= maximumBytes ||
      `JSON must contain at most ${maximumBytes} bytes`
    ),
  );

const storedJson = <S extends Schema.Constraint>(
  schema: S,
  maximumBytes: number,
) =>
  boundedJsonString(maximumBytes).pipe(
    Schema.decodeTo(schema, SchemaTransformation.fromJsonString()),
  );

const StoredProjectAgentSessionPayloadJson = storedJson(
  StoredProjectAgentSessionPayload,
  storedProjectAgentSessionPayloadMaxBytes,
);

export const decodeStoredProjectAgentSessionPayload =
  Schema.decodeUnknownSync(
    StoredProjectAgentSessionPayloadJson,
    strictSchemaOptions,
  );

export const encodeStoredProjectAgentSessionPayload = Schema.encodeSync(
  StoredProjectAgentSessionPayloadJson,
  strictSchemaOptions,
);

const StoredProjectAgentSessionSummaryIssue = strictSchema(Schema.Struct({
  runId: Schema.String.check(Schema.isLengthBetween(1, 128)),
  runNumber: NonNegativeSafeInteger,
  sourceKey: Schema.String.check(Schema.isLengthBetween(1, 500)),
  title: Schema.String.check(Schema.isLengthBetween(1, 500)),
  outcome: Schema.Literals([
    "pending",
    "completed",
    "blocked",
    "failed",
    "skipped",
  ]),
  summary: Schema.Null,
}));

export const StoredProjectAgentSessionSummary = strictSchema(Schema.Struct({
  dispatchGroupId: Schema.String.check(Schema.isLengthBetween(1, 128)),
  agentId: Schema.NullOr(UuidString),
  agentName: Schema.NullOr(trimmedText(1, 200)),
  skillId: Schema.NullOr(UuidString),
  sessionType: Schema.Literals(["task", "dispatch"]),
  trigger: Schema.NullOr(Schema.Literals(["manual", "scheduled"])),
  scheduleId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  scheduleRunId: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(128)),
  ),
  parentSessionId: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(128)),
  ),
  requestedByUserId: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(128)),
  ),
  request: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  status: Schema.Literals([
    "running",
    "completed",
    "failed",
    "skipped",
    "interrupted",
  ]),
  issues: mutableArray(StoredProjectAgentSessionSummaryIssue).check(
    Schema.isMaxLength(100),
  ),
  startedAt: IsoDateTimeWithOffset,
  completedAt: Schema.NullOr(IsoDateTimeWithOffset),
  summary: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
  requestedWorkerId: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(128)),
  ),
  workerId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  updatedAt: IsoDateTimeWithOffset,
}));

export type StoredProjectAgentSessionSummary =
  typeof StoredProjectAgentSessionSummary.Type;

const StoredProjectAgentSessionSummaryJson = storedJson(
  StoredProjectAgentSessionSummary,
  storedProjectAgentSessionSummaryMaxBytes,
);

export const decodeStoredProjectAgentSessionSummary = Schema.decodeUnknownSync(
  StoredProjectAgentSessionSummaryJson,
  strictSchemaOptions,
);

export const encodeStoredProjectAgentSessionSummary = Schema.encodeSync(
  StoredProjectAgentSessionSummaryJson,
  strictSchemaOptions,
);

export const ProjectAgentTaskInput = strictSchema(Schema.Struct({
  agentId: UuidString,
  skillId: Schema.optional(Schema.NullOr(UuidString)),
  request: trimmedText(1, 50_000),
  workerId: trimmedText(1, 128),
  requestId: UuidString,
}));

export const ProjectAgentTaskSuccess = strictSchema(Schema.Struct({
  summary: trimmedText(1, 50_000),
  conversationId: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(128))),
  ),
}));

export const ProjectAgentTaskFailure = strictSchema(Schema.Struct({
  error: trimmedText(1, 20_000),
}));

const ScheduleSource = strictSchema(Schema.Struct({
  agentId: UuidString,
  name: trimmedText(1, 120),
  recurrence: Schema.Literals(projectAgentScheduleRecurrences),
  timeOfDay: Schema.String.check(
    Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  ),
  dayOfWeek: Schema.optional(Schema.NullOr(integerBetween(0, 6))),
  intervalValue: Schema.optional(integerBetween(1, 999)),
  intervalUnit: Schema.optional(
    Schema.Literals(projectAgentScheduleIntervalUnits),
  ),
  daysOfWeek: Schema.optional(
    mutableArray(integerBetween(0, 6)).check(Schema.isMaxLength(7)),
  ),
  notificationLevel: Schema.optional(
    Schema.Literals(projectAgentScheduleNotificationLevels),
  ),
  timeZone: Schema.Trim.check(
    Schema.isLengthBetween(1, 100),
    Schema.makeFilter((value) =>
      isValidProjectAgentScheduleTimeZone(value) || "Invalid IANA time zone"
    ),
  ),
}).check(
  Schema.makeFilter((input) => {
    const intervalUnit = input.intervalUnit ??
      (input.recurrence === "interval"
        ? "hour"
        : input.recurrence === "custom"
          ? "week"
          : "day");
    const issues: Array<Schema.FilterIssue> = [];
    if (
      input.recurrence === "interval" &&
      intervalUnit !== "minute" &&
      intervalUnit !== "hour"
    ) {
      issues.push({
        path: ["intervalUnit"],
        issue: "Interval schedules use minutes or hours",
      });
    }
    if (
      input.recurrence === "custom" &&
      intervalUnit !== "day" &&
      intervalUnit !== "week"
    ) {
      issues.push({
        path: ["intervalUnit"],
        issue: "Custom schedules repeat daily or weekly",
      });
    }
    if (
      input.recurrence === "custom" &&
      intervalUnit === "week" &&
      normalizeProjectAgentScheduleDays(input.daysOfWeek).length === 0
    ) {
      issues.push({
        path: ["daysOfWeek"],
        issue: "Choose at least one weekday",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));

const ScheduleTarget = strictSchema(Schema.Struct({
  agentId: UuidString,
  name: trimmedText(1, 120),
  recurrence: Schema.Literals(projectAgentScheduleRecurrences),
  timeOfDay: Schema.String.check(
    Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  ),
  dayOfWeek: Schema.NullOr(integerBetween(0, 6)),
  intervalValue: integerBetween(1, 999),
  intervalUnit: Schema.Literals(projectAgentScheduleIntervalUnits),
  daysOfWeek: mutableArray(integerBetween(0, 6)).check(Schema.isMaxLength(7)),
  notificationLevel: Schema.Literals(projectAgentScheduleNotificationLevels),
  timeZone: Schema.Trim.check(Schema.isLengthBetween(1, 100)),
}));

export const ProjectAgentScheduleInput = ScheduleSource.pipe(
  Schema.decodeTo(
    ScheduleTarget,
    SchemaTransformation.transform({
      decode: (input) => ({
        ...input,
        dayOfWeek: normalizeProjectAgentScheduleDay(
          input.recurrence,
          input.dayOfWeek,
        ),
        intervalValue: normalizeProjectAgentScheduleInterval(
          input.intervalValue,
        ),
        intervalUnit: input.intervalUnit ??
          (input.recurrence === "interval"
            ? "hour"
            : input.recurrence === "custom"
              ? "week"
              : "day"),
        daysOfWeek: normalizeProjectAgentScheduleDays(input.daysOfWeek),
        notificationLevel: input.notificationLevel ?? "important_updates",
      }),
      encode: (input) => input,
    }),
  ),
);

export const decodeProjectTransferInput = decodeRequestSync(
  ProjectTransferInput,
);
export const decodeProjectAgentInput = decodeRequestSync(ProjectAgentInput);
export const decodeProjectAgentInputOption = Schema.decodeUnknownOption(
  ProjectAgentInput,
  { errors: "all", onExcessProperty: "error" },
);
export const decodeOrganizationAgentWrite = decodeRequestSync(
  OrganizationAgentWrite,
);
export const decodeProjectAgentSessionInput = decodeRequestSync(
  ProjectAgentSessionInput,
);
export const decodeProjectAgentTaskInput = decodeRequestSync(
  ProjectAgentTaskInput,
);
export const decodeProjectAgentTaskSuccess = decodeRequestSync(
  ProjectAgentTaskSuccess,
);
export const decodeProjectAgentTaskFailure = decodeRequestSync(
  ProjectAgentTaskFailure,
);
export const decodeProjectAgentScheduleInput = decodeRequestSync(
  ProjectAgentScheduleInput,
);
