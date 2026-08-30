import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { IsoDateTimeWithOffset } from "../src/lib/date-time-schema";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
} from "../src/lib/issue-title";
import { WorkflowStageId } from "./config-contract";

const Uuid = Schema.String.check(Schema.isUUID());

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
