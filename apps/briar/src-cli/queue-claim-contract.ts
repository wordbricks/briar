import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ModelEffort } from "../src/lib/agent-provider-contract";
import { agentProviders } from "../src/lib/agent-provider";
import { autoHuntSources } from "../src/lib/auto-hunt-contract";
import { IsoDateTimeWithOffset } from "../src/lib/date-time-schema";
import { WorkflowConfig, WorkflowStageId } from "./config-contract";

const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));
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

const Uuid = Schema.String.check(Schema.isUUID());
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const AgentProviderSchema = Schema.Literals(agentProviders);

export const QueuedAttachment = Schema.Struct({
  id: Uuid,
  filename: Schema.String.check(Schema.isLengthBetween(1, 255)),
  contentType: Schema.String.check(Schema.isPattern(/^(?:image|video)\//u)),
  byteSize: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(20 * 1024 * 1024),
  ),
  url: Schema.String.check(Schema.isStartsWith("/")),
});
export type QueuedAttachment = typeof QueuedAttachment.Type;

const QueuedIssueMessage = Schema.Struct({
  id: Uuid,
  runId: Uuid,
  parentMessageId: Schema.NullOr(Uuid),
  body: Schema.NonEmptyString,
  attachments: defaultedWith(
    mutableArray(QueuedAttachment).check(Schema.isMaxLength(5)),
    () => [],
  ),
  author: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    name: Schema.NonEmptyString,
    image: Schema.NullOr(Schema.String),
    provider: Schema.NullOr(AgentProviderSchema),
  }),
  replyCount: NonNegativeInteger,
  createdAt: IsoDateTimeWithOffset,
  updatedAt: IsoDateTimeWithOffset,
});

const ResumeContext = Schema.Struct({
  checkpointKey: WorkflowStageId,
  position: Schema.Literals(["before", "after"]),
  revision: PositiveInteger,
  terminalReviewOnly: Schema.Boolean,
});

export const QueuedIssue = Schema.Struct({
  executionId: Schema.optional(Uuid),
  runId: Uuid,
  runNumber: PositiveInteger,
  currentAttempt: PositiveInteger,
  currentRevision: PositiveInteger,
  source: Schema.Literals(autoHuntSources),
  sourceKey: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  priority: Schema.NullOr(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(4),
    ),
  ),
  repository: Schema.NonEmptyString,
  sourceCreatedAt: Schema.NullOr(IsoDateTimeWithOffset),
  createdByUserId: defaulted(Schema.NullOr(Schema.String), null),
  context: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  reviewFeedback: defaulted(Schema.NullOr(Schema.String), null),
  workflow: WorkflowConfig,
  workflowStage: Schema.NullOr(Schema.String),
  startStage: Schema.NullOr(Schema.String),
  resumeContext: Schema.NullOr(ResumeContext),
  attachments: defaultedWith(
    mutableArray(QueuedAttachment).check(Schema.isMaxLength(5)),
    () => [],
  ),
  messages: defaultedWith(mutableArray(QueuedIssueMessage), () => []),
  claimToken: Schema.String.check(Schema.isStartsWith("briar_claim_")),
  claimedBy: Schema.NonEmptyString,
  claimedAt: IsoDateTimeWithOffset,
  leaseExpiresAt: IsoDateTimeWithOffset,
  claimAttempts: PositiveInteger,
  execution: Schema.optional(Schema.NullOr(Schema.Struct({
    provider: AgentProviderSchema,
    model: Schema.NullOr(Schema.String),
    effort: defaulted(Schema.NullOr(ModelEffort), null),
  }))),
});

export const decodeQueuedIssue = Schema.decodeUnknownSync(QueuedIssue);
