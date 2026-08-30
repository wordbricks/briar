import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  AutoHuntWorkflowValidationError,
  canonicalizeProjectWorkflow,
  autoHuntEvidenceTypeMaxLength,
  autoHuntEvidenceTypePattern,
  autoHuntPersistedRunStatuses,
  autoHuntRequirementKinds,
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import { IsoDateTimeWithOffset } from "../../src/lib/date-time-schema";
import {
  defaulted,
  defaultedWith,
  mutableArray,
  NonNegativeSafeInteger,
  PositiveSafeInteger,
  strictSchema,
  strictSchemaOptions,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync, RequestDecodeError } from "./request-schema";

export const UsageRangeDays = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Literals([7, 30, 90]),
    SchemaTransformation.transform<7 | 30 | 90, unknown>({
      decode: (value) => typeof value === "string" && value.trim() !== ""
          ? Number(value) as 7 | 30 | 90
          : typeof value === "number"
            ? value as 7 | 30 | 90
            : Number.NaN as 7 | 30 | 90,
      encode: (value) => value,
    }),
  ),
);
export type UsageRangeDays = typeof UsageRangeDays.Type;

export const ProjectUsagePeriod = Schema.Literals(["day", "week", "month"]);
export const UtcCalendarDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
);
export const ProjectUsageDateRangeInput = strictSchema(Schema.Struct({
  from: UtcCalendarDate,
  to: UtcCalendarDate,
}));

export const RunStatus = Schema.Literals(autoHuntPersistedRunStatuses);
export const WorkflowStageId = Schema.Trim.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/u),
);
export const WorkflowCheckpoint = strictSchema(Schema.Struct({
  key: WorkflowStageId,
  stage: WorkflowStageId,
  position: Schema.Literals(["before", "after"]),
}));
export const EvidenceType = Schema.Trim.check(
  Schema.isLengthBetween(1, autoHuntEvidenceTypeMaxLength),
  Schema.isPattern(autoHuntEvidenceTypePattern),
);

const WorkflowRequirement = strictSchema(Schema.Struct({
  id: WorkflowStageId,
  label: trimmedText(1, 80),
  kind: Schema.Literals(autoHuntRequirementKinds),
  tool: Schema.Trim.check(
    Schema.isPattern(/^[a-zA-Z0-9_.+-]+$/u),
    Schema.isMaxLength(80),
  ),
  reason: trimmedText(1, 200),
}));

const WorkflowStage = strictSchema(Schema.Struct({
  id: WorkflowStageId,
  label: trimmedText(1, 80),
  required: Schema.Boolean,
  evidence: Schema.optional(
    mutableArray(EvidenceType).check(Schema.isMaxLength(20)),
  ),
  checks: Schema.optional(
    mutableArray(trimmedText(1, 500)).check(Schema.isMaxLength(20)),
  ),
}));

export const Workflow = strictSchema(Schema.Struct({
  version: Schema.Literal(2),
  requirements: Schema.optional(
    mutableArray(WorkflowRequirement).check(Schema.isMaxLength(30)),
  ),
  stages: mutableArray(WorkflowStage).check(
    Schema.isLengthBetween(1, 30),
  ),
  completion: Schema.optional(strictSchema(Schema.Struct({
    requiredStages: mutableArray(WorkflowStageId).check(
      Schema.isMaxLength(30),
    ),
  }))),
  execution: Schema.optional(strictSchema(Schema.Struct({
    checkpoints: Schema.optional(
      mutableArray(WorkflowCheckpoint).check(Schema.isMaxLength(100)),
    ),
  }))),
}));

export const HttpsUrl = Schema.String.check(
  Schema.isMaxLength(1_000),
  Schema.makeFilter((value) => {
    try {
      return new URL(value).protocol === "https:"
        ? undefined
        : "HTTPS URL required";
    } catch {
      return "Expected a valid URL";
    }
  }),
);

export const RunEvidenceInput = strictSchema(Schema.Struct({
  evidenceKey: trimmedText(1, 300),
  stage: WorkflowStageId,
  type: EvidenceType,
  status: Schema.Literals(["pending", "passed", "failed", "skipped"]),
  observedAt: IsoDateTimeWithOffset,
  actor: trimmedText(1, 128),
  detail: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(100_000))),
  ),
  command: Schema.optional(Schema.NullOr(trimmedText(1, 2_000))),
  url: Schema.optional(Schema.NullOr(HttpsUrl)),
  metadata: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
}));

export const RecoveryUserInput = strictSchema(Schema.Struct({
  requestId: UuidString,
  reason: Schema.optional(Schema.NullOr(trimmedText(1, 4_000))),
}));

export const ResumeUserInput = strictSchema(Schema.Struct({
  requestId: UuidString,
  checkpointKey: WorkflowStageId,
  attempt: PositiveSafeInteger,
  revision: PositiveSafeInteger,
}));
export type ResumeUserInput = typeof ResumeUserInput.Type;

export const PausedRunReworkInput = strictSchema(Schema.Struct({
  requestId: UuidString,
  workflowStage: WorkflowStageId,
  reason: trimmedText(1, 4_000),
  checkpointKey: WorkflowStageId,
  attempt: PositiveSafeInteger,
  revision: PositiveSafeInteger,
}));

export const MoveRunInput = strictSchema(Schema.Struct({
  requestId: UuidString,
  status: RunStatus,
  workflowStage: Schema.NullOr(WorkflowStageId),
}).check(
  Schema.makeFilter((input) => {
    if (input.status === "running" && !input.workflowStage) {
      return {
        path: ["workflowStage"],
        issue: "running status requires a workflow stage",
      };
    }
    if (input.status !== "running" && input.workflowStage !== null) {
      return {
        path: ["workflowStage"],
        issue: "only running status can select a workflow stage",
      };
    }
    return undefined;
  }),
));

const NullableTrimmed = (maximum: number) =>
  Schema.optional(Schema.NullOr(trimmedText(1, maximum)));

const ProjectSettingsSource = strictSchema(Schema.Struct({
  velenOrg: NullableTrimmed(100),
  dataSource: NullableTrimmed(300),
  linear: strictSchema(Schema.Struct({
    enabled: Schema.Boolean,
    source: Schema.NullOr(
      Schema.Trim.check(
        Schema.isPattern(/^linear:\/\/.+/u),
        Schema.isMaxLength(300),
      ),
    ),
    teamKey: Schema.NullOr(trimmedText(1, 100)),
  })),
  githubRepository: NullableTrimmed(300),
  workflow: defaultedWith(Workflow, cloneAutoHuntWorkflow),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (input.dataSource && !input.velenOrg) {
      issues.push({
        path: ["dataSource"],
        issue: "Velen data source requires a Velen org",
      });
    }
    if (input.linear.enabled && (!input.velenOrg || !input.linear.source)) {
      issues.push({
        path: ["linear"],
        issue: "Linear integration requires a Velen org and Linear source",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));

export const CheckpointPolicyInput = strictSchema(Schema.Struct({
  scope: Schema.Literals(["project", "user"]),
  checkpoints: mutableArray(WorkflowCheckpoint).check(
    Schema.isMaxLength(100),
  ),
  expectedRevision: NonNegativeSafeInteger,
}));

export const IssueCheckpointsInput = strictSchema(Schema.Struct({
  checkpoints: mutableArray(WorkflowCheckpoint).check(
    Schema.isMaxLength(100),
  ),
}));

export const RequestIdInput = strictSchema(Schema.Struct({
  requestId: UuidString,
}));

export class ProjectWorkflowInputError extends Error {
  readonly code = "INVALID_PROJECT_WORKFLOW";

  constructor(readonly issues: readonly unknown[]) {
    super("Invalid project workflow");
    this.name = "ProjectWorkflowInputError";
  }
}

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const decodeProjectSettingsSource = Schema.decodeUnknownSync(
  ProjectSettingsSource,
  strictSchemaOptions,
);

export function parseProjectSettingsInput(value: unknown) {
  try {
    const input = decodeProjectSettingsSource(value);
    return {
      ...input,
      workflow: canonicalizeProjectWorkflow(input.workflow),
    };
  } catch (error) {
    if (Schema.isSchemaError(error)) {
      const issues = formatSchemaIssue(error.issue).issues;
      if (issues.some((issue) => issue.path?.[0] === "workflow")) {
        throw new ProjectWorkflowInputError(issues);
      }
      throw new RequestDecodeError({ cause: error });
    }
    if (error instanceof AutoHuntWorkflowValidationError) {
      throw new ProjectWorkflowInputError(error.issues);
    }
    throw error;
  }
}

export const decodeUsageRangeDays = decodeRequestSync(UsageRangeDays);
export const decodeProjectUsagePeriod = decodeRequestSync(ProjectUsagePeriod);
export const decodeProjectUsageDateRange = decodeRequestSync(
  ProjectUsageDateRangeInput,
);
export const decodeRunEvidenceInput = decodeRequestSync(RunEvidenceInput);
export const decodeRecoveryUserInput = decodeRequestSync(RecoveryUserInput);
export const decodeResumeUserInput = decodeRequestSync(ResumeUserInput);
export const decodePausedRunReworkInput = decodeRequestSync(
  PausedRunReworkInput,
);
export const decodeMoveRunInput = decodeRequestSync(MoveRunInput);
export const decodeCheckpointPolicyInput = decodeRequestSync(
  CheckpointPolicyInput,
);
export const decodeIssueCheckpointsInput = decodeRequestSync(
  IssueCheckpointsInput,
);
export const decodeRequestIdInput = decodeRequestSync(RequestIdInput);
