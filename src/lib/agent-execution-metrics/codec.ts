import * as Schema from "effect/Schema";
import { agentProviders } from "../agent-provider";
import { IsoDateTimeWithOffset } from "../date-time-schema";

export const strictAgentExecutionSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

export const AgentProviderSchema = Schema.Literals(agentProviders);

export const AgentExecutionModelSourceSchema = Schema.Literals([
  "providerReported",
  "providerConfig",
  "configuredFallback",
  "unknown",
]);

export const NonnegativeSafeInteger = Schema.Natural;

export const TrimmedText = (maximumLength: number) =>
  Schema.Trim.check(Schema.isLengthBetween(1, maximumLength));

export const NullableTrimmedText = (maximumLength: number) =>
  Schema.NullOr(TrimmedText(maximumLength));
