import * as Schema from "effect/Schema";
import { agentProviders } from "../agent-provider";

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

const isoDateSource =
  "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
const isoTimeSource = "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?";
const isoDateTimeWithOffsetPattern = new RegExp(
  `^${isoDateSource}T${isoTimeSource}(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`,
  "u",
);

export const ObservedAt = Schema.String.check(
  Schema.isPattern(isoDateTimeWithOffsetPattern, {
    expected: "an ISO 8601 date-time with an explicit offset",
  }),
);

export const TrimmedText = (maximumLength: number) =>
  Schema.Trim.check(Schema.isLengthBetween(1, maximumLength));

export const NullableTrimmedText = (maximumLength: number) =>
  Schema.NullOr(TrimmedText(maximumLength));
