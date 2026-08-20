import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AgentExecutionCostRecord } from "../../src/lib/agent-execution-cost";
import {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "../../src/lib/agent-execution-metrics";
import { agentProviders } from "../../src/lib/agent-provider";
import { MAX_TRANSCRIPT_EVENTS_PER_REQUEST } from "./transcript-limits";

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const PositiveInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Uuid = Schema.String.check(Schema.isUUID());
const SessionId = Schema.Trim.check(
  Schema.isLengthBetween(1, 128),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/u),
);
const WorkerId = Schema.NullOr(
  Schema.Trim.check(Schema.isLengthBetween(1, 128)),
);

const TranscriptEvent = Schema.Struct({
  sequence: PositiveInteger,
  direction: Schema.Literals(["client", "server"]),
  payload: Schema.optional(Schema.Unknown),
});

const mutableArrayBetween = <S extends Schema.Top>(
  item: S,
  minimum: number,
  maximum: number,
) =>
  Schema.mutable(Schema.Array(item)).check(
    Schema.isLengthBetween(minimum, maximum),
  );

export const transcriptSchema = Schema.Struct({
  sessionId: SessionId,
  runId: Schema.optional(Schema.NullOr(Uuid)),
  runAttempt: Schema.optional(PositiveInteger),
  executionId: Schema.optional(Uuid),
  projectId: Schema.optional(Uuid),
  workerId: Schema.optional(WorkerId),
  agentProvider: Schema.Literals(agentProviders),
  executionMetrics: Schema.optional(AgentExecutionMetrics),
  usageRecords: Schema.optional(
    mutableArrayBetween(AgentExecutionUsageRecord, 1, 1_000),
  ),
  costRecords: Schema.optional(
    mutableArrayBetween(AgentExecutionCostRecord, 1, 1_000),
  ),
  events: mutableArrayBetween(
    TranscriptEvent,
    1,
    MAX_TRANSCRIPT_EVENTS_PER_REQUEST,
  ),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (
      input.executionMetrics !== undefined &&
      (!input.runId || input.runAttempt === undefined)
    ) {
      issues.push({
        path: ["executionMetrics"],
        issue: "runId and runAttempt are required with executionMetrics",
      });
    }
    if (input.executionId && !input.runId) {
      issues.push({
        path: ["executionId"],
        issue: "runId is required with executionId",
      });
    }
    if (input.usageRecords && !input.executionId) {
      issues.push({
        path: ["usageRecords"],
        issue: "executionId is required with usageRecords",
      });
    }
    if (input.usageRecords && input.runAttempt === undefined) {
      issues.push({
        path: ["usageRecords"],
        issue: "runAttempt is required with usageRecords",
      });
    }
    if (input.costRecords && !input.executionId) {
      issues.push({
        path: ["costRecords"],
        issue: "executionId is required with costRecords",
      });
    }
    if (input.costRecords && input.runAttempt === undefined) {
      issues.push({
        path: ["costRecords"],
        issue: "runAttempt is required with costRecords",
      });
    }
    if (
      input.usageRecords?.some(
        (record) => record.agentProvider !== input.agentProvider,
      )
    ) {
      issues.push({
        path: ["usageRecords"],
        issue: "usage record providers must match agentProvider",
      });
    }
    if (
      input.costRecords?.some(
        (record) => record.agentProvider !== input.agentProvider,
      )
    ) {
      issues.push({
        path: ["costRecords"],
        issue: "cost record providers must match agentProvider",
      });
    }
    return issues;
  }),
).annotate({ parseOptions: strictSchemaOptions });

export type TranscriptRequest = typeof transcriptSchema.Type;

export class TranscriptRequestDecodeError extends Data.TaggedError(
  "TranscriptRequestDecodeError",
)<{
  readonly cause: Schema.SchemaError;
}> {}

export const decodeTranscriptRequest = Schema.decodeUnknownSync(
  transcriptSchema,
  strictSchemaOptions,
);

export const decodeTranscriptRequestEffect = Effect.fn(
  "decodeTranscriptRequestEffect",
)(function*(input: unknown) {
  return yield* Schema.decodeUnknownEffect(
    transcriptSchema,
    strictSchemaOptions,
  )(input).pipe(
    Effect.mapError((cause) => new TranscriptRequestDecodeError({ cause })),
  );
});
