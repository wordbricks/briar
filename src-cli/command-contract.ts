import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  autoHuntPersistedRunStatuses,
  autoHuntSources,
} from "../src/lib/auto-hunt-contract";
import { StructuredAgentResult } from "../src/lib/agent-result";
import { IsoDateTimeWithOffset } from "../src/lib/date-time-schema";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
} from "../src/lib/issue-title";
import { EvidenceType, WorkflowStageId } from "./config-contract";

const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));
const Uuid = Schema.String.check(Schema.isUUID());
const UrlString = Schema.String.check(
  Schema.makeFilter((value) => URL.canParse(value) || "Expected a valid URL"),
);
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const StringRecord = Schema.Record(Schema.String, Schema.Unknown);

const HttpErrorBody = Schema.Struct({
  message: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}).annotate({
  parseOptions: { onExcessProperty: "preserve" },
});

const decodeHttpErrorBodyOption = Schema.decodeUnknownOption(HttpErrorBody);

export function httpErrorMessage(input: unknown): string | undefined {
  return Option.match(decodeHttpErrorBodyOption(input), {
    onNone: () => undefined,
    onSome: (body) =>
      body.message ?? body.error_description ?? body.error,
  });
}

export const VelenEnvelope = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.Unknown,
  requestId: Schema.optional(Schema.String),
}).annotate({
  parseOptions: { onExcessProperty: "preserve" },
});
export type VelenEnvelope = typeof VelenEnvelope.Type;
export const decodeVelenEnvelope = Schema.decodeUnknownSync(VelenEnvelope);

export const WorkspaceMode = Schema.Literals([
  "project",
  "worktree",
  "current",
  "none",
]);
export const decodeWorkspaceMode = Schema.decodeUnknownSync(WorkspaceMode);
export const decodeUuid = Schema.decodeUnknownSync(Uuid);
export const decodeIsoDateTimeWithOffset = Schema.decodeUnknownSync(
  IsoDateTimeWithOffset,
);
export const decodeWorkflowStageId = Schema.decodeUnknownSync(WorkflowStageId);

const DashboardRun = Schema.Struct({
  id: Uuid,
  status: Schema.String,
  branch: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(IsoDateTimeWithOffset),
});
const DashboardRuns = mutableArray(DashboardRun);
export const decodeDashboardRuns = Schema.decodeUnknownSync(DashboardRuns);

const IssueTitle = Schema.Trim.check(
  Schema.isLengthBetween(1, issueTitleAbsoluteMaxLength),
  Schema.makeFilter((title) => issueTitleOverLimitMessage(title) ?? undefined),
);

export const CreateIssueInput = Schema.Struct({
  title: IssueTitle,
  description: Schema.NullOr(
    Schema.Trim.check(Schema.isMaxLength(100_000)),
  ),
  priority: Schema.NullOr(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(4, { message: "Too big" }),
    ),
  ),
  status: Schema.Literals(["backlog", "queued"]),
});
export type CreateIssueInput = typeof CreateIssueInput.Type;
export const decodeCreateIssueInput = Schema.decodeUnknownSync(CreateIssueInput);

export const ChannelMessagesInput = Schema.Struct({
  channelId: Uuid,
  limit: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100, { message: "Too big" }),
  ),
  cursor: Schema.NullOr(Uuid),
  parentMessageId: Schema.NullOr(Uuid),
});
export type ChannelMessagesInput = typeof ChannelMessagesInput.Type;
export const decodeChannelMessagesInput = Schema.decodeUnknownSync(
  ChannelMessagesInput,
);

const RunEventTracker = Schema.Struct({
  provider: Schema.String.check(Schema.isLengthBetween(1, 64)),
  issueId: Schema.NullOr(Schema.String),
  identifier: Schema.NullOr(Schema.String),
  url: Schema.NullOr(UrlString),
  state: Schema.NullOr(Schema.String),
});

export const RunEventInput = Schema.Struct({
  runId: Schema.NullOr(Uuid),
  source: Schema.NullOr(Schema.Literals(autoHuntSources)),
  sourceKey: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.optional(Schema.Literals(autoHuntPersistedRunStatuses)),
  workflowStage: Schema.optional(Schema.NullOr(WorkflowStageId)),
  eventKey: Schema.NonEmptyString,
  occurredAt: IsoDateTimeWithOffset,
  actor: Schema.NonEmptyString,
  repository: Schema.NonEmptyString,
  detail: Schema.NullOr(Schema.String),
  priority: Schema.NullOr(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(4, { message: "Too big" }),
    ),
  ),
  branch: Schema.NullOr(Schema.String),
  commitSha: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/u)),
  ),
  tracker: Schema.NullOr(RunEventTracker),
  issueDescription: Schema.NullOr(Schema.String),
  resultSummary: Schema.NullOr(Schema.String),
  structuredResult: Schema.NullOr(StructuredAgentResult),
  pullRequestUrls: mutableArray(UrlString).check(Schema.isMaxLength(20)),
  targetSha: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/u)),
  ),
  sourceCreatedAt: Schema.NullOr(IsoDateTimeWithOffset),
  context: Schema.NullOr(StringRecord),
}).check(
  Schema.makeFilter((progress) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (
      !progress.runId &&
      (!progress.source || !progress.sourceKey || !progress.title)
    ) {
      issues.push({
        path: [],
        issue: "--source, --source-key, and --title are required without --run",
      });
    }
    if (!progress.status) {
      issues.push({ path: [], issue: "--status is required" });
    }
    if (progress.status === "running" && !progress.workflowStage) {
      issues.push({
        path: ["workflowStage"],
        issue: "--workflow-stage is required with --status running",
      });
    }
    return issues;
  }),
);
const decodeRunEventInput = Schema.decodeUnknownSync(RunEventInput);

export function validateRunEventInput(input: unknown): void {
  decodeRunEventInput(input);
}

export const RunEvidenceInput = Schema.Struct({
  evidenceKey: Schema.String.check(Schema.isLengthBetween(1, 300)),
  stage: WorkflowStageId,
  type: EvidenceType,
  status: Schema.Literals(["pending", "passed", "failed", "skipped"]),
  observedAt: IsoDateTimeWithOffset,
  actor: Schema.NonEmptyString,
  detail: Schema.NullOr(Schema.String),
  command: Schema.NullOr(
    Schema.String.check(Schema.isLengthBetween(1, 2_000)),
  ),
  url: Schema.NullOr(UrlString),
  metadata: Schema.mutableKey(Schema.NullOr(StringRecord)),
});
export type RunEvidenceInput = typeof RunEvidenceInput.Type;
export const decodeRunEvidenceInput = Schema.decodeUnknownSync(RunEvidenceInput);

const RecoveryRunInput = Schema.Struct({
  requestId: Uuid,
  actor: Schema.String.check(Schema.isLengthBetween(1, 128)),
  reason: Schema.NullOr(
    Schema.String.check(Schema.isLengthBetween(1, 4_000)),
  ),
});
const decodeRecoveryRunInput = Schema.decodeUnknownSync(RecoveryRunInput);

export function validateRecoveryRunInput(input: unknown): void {
  decodeRecoveryRunInput(input);
}

const ReworkRunInput = Schema.Struct({
  requestId: Uuid,
  actor: Schema.String.check(Schema.isLengthBetween(1, 128)),
  workflowStage: WorkflowStageId,
  reason: Schema.Trim.check(Schema.isLengthBetween(1, 4_000)),
});
const decodeReworkRunInput = Schema.decodeUnknownSync(ReworkRunInput);

export function validateReworkRunInput(input: unknown): void {
  decodeReworkRunInput(input);
}

const ResumeRunInput = Schema.Struct({
  requestId: Uuid,
  actor: Schema.String.check(Schema.isLengthBetween(1, 128)),
  checkpointKey: Schema.optional(WorkflowStageId),
  attempt: Schema.optional(PositiveInteger),
  revision: Schema.optional(PositiveInteger),
}).check(
  Schema.makeFilter((candidate) => {
    const supplied = [
      candidate.checkpointKey,
      candidate.attempt,
      candidate.revision,
    ].filter((item) => item !== undefined).length;
    return supplied === 0 || supplied === 3
      ? undefined
      : "--checkpoint, --attempt, and --revision must be supplied together";
  }),
);
const decodeResumeRunInput = Schema.decodeUnknownSync(ResumeRunInput);

export function validateResumeRunInput(input: unknown): void {
  decodeResumeRunInput(input);
}

const WorkflowTransitionInput = Schema.Struct({
  requestId: Uuid,
  actor: Schema.String.check(Schema.isLengthBetween(1, 128)),
  attempt: Schema.optional(PositiveInteger),
  revision: Schema.optional(PositiveInteger),
});
const decodeWorkflowTransitionInput = Schema.decodeUnknownSync(
  WorkflowTransitionInput,
);

export function validateWorkflowTransitionInput(input: unknown): void {
  decodeWorkflowTransitionInput(input);
}
