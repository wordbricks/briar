import * as Schema from "effect/Schema";
import { IsoDateTimeWithOffset } from "./date-time-schema";

export const agentResultOutcomes = [
  "completed",
  "partial",
  "blocked",
  "failed",
] as const;

export const agentResultImportances = [
  "routine",
  "important",
  "critical",
] as const;

export const agentResultUrgencies = [
  "normal",
  "time_sensitive",
  "immediate",
] as const;

export const agentResultImpacts = [
  "issue",
  "project",
  "organization",
] as const;

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const trimmedText = (maximumLength: number) =>
  Schema.Trim.check(Schema.isLengthBetween(1, maximumLength));

export const StructuredAgentResult = Schema.Struct({
  summary: trimmedText(100_000),
  outcome: Schema.Literals(agentResultOutcomes),
  importance: Schema.Literals(agentResultImportances),
  urgency: Schema.Literals(agentResultUrgencies),
  impact: Schema.Literals(agentResultImpacts),
  humanActionRequired: Schema.Boolean,
  nextAction: Schema.NullOr(trimmedText(4_000)),
  dueAt: Schema.NullOr(IsoDateTimeWithOffset),
}).check(
  Schema.makeFilter((result) =>
    result.humanActionRequired && !result.nextAction
      ? {
          path: ["nextAction"],
          issue: "humanActionRequired results require nextAction",
        }
      : undefined
  ),
).annotate({ parseOptions: strictSchemaOptions });

export type StructuredAgentResult = typeof StructuredAgentResult.Type;

export const decodeStructuredAgentResult = Schema.decodeUnknownSync(
  StructuredAgentResult,
  strictSchemaOptions,
);

export const decodeStructuredAgentResultOption = Schema.decodeUnknownOption(
  StructuredAgentResult,
  strictSchemaOptions,
);
