import * as Schema from "effect/Schema";
import {
  AgentExecutionModelSourceSchema,
  AgentProviderSchema,
  NonnegativeSafeInteger,
  NullableTrimmedText,
  ObservedAt,
  strictAgentExecutionSchemaOptions,
  TrimmedText,
} from "./agent-execution-metrics/codec";

/** Exact fixed-point scale used for provider-reported USD costs. */
export const AGENT_EXECUTION_USD_TICKS_PER_DOLLAR = 10_000_000_000;

/**
 * An immutable provider-reported cost observation. `amountUsdTicks` is exact
 * fixed-point USD where one dollar equals 10^10 ticks.
 */
export const AgentExecutionCostRecord = Schema.Struct({
  costKey: TrimmedText(512),
  usageKey: NullableTrimmedText(512),
  sessionId: NullableTrimmedText(512),
  scopeId: NullableTrimmedText(512),
  turnId: NullableTrimmedText(512),
  agentProvider: AgentProviderSchema,
  modelProvider: NullableTrimmedText(256),
  model: NullableTrimmedText(512),
  canonicalModel: NullableTrimmedText(512),
  modelSource: AgentExecutionModelSourceSchema,
  source: TrimmedText(128),
  amountUsdTicks: NonnegativeSafeInteger,
  observedAt: ObservedAt,
}).annotate({ parseOptions: strictAgentExecutionSchemaOptions });

export type AgentExecutionCostRecord =
  typeof AgentExecutionCostRecord.Type;
export const agentExecutionCostRecordSchema = AgentExecutionCostRecord;

export const decodeAgentExecutionCostRecord = Schema.decodeUnknownSync(
  AgentExecutionCostRecord,
  strictAgentExecutionSchemaOptions,
);
