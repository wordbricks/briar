import * as Schema from "effect/Schema";
import type { AgentProvider } from "../agent-provider";
import {
  AgentExecutionModelSourceSchema,
  AgentProviderSchema,
  NonnegativeSafeInteger,
  NullableTrimmedText,
  ObservedAt,
  strictAgentExecutionSchemaOptions,
  TrimmedText,
} from "./codec";

const NullableTokenCount = Schema.NullOr(NonnegativeSafeInteger);

export const AgentExecutionMetrics = Schema.Struct({
  inputTokens: NullableTokenCount,
  outputTokens: NullableTokenCount,
  cacheReadTokens: NullableTokenCount,
  cacheWriteTokens: NullableTokenCount,
  reasoningOutputTokens: NullableTokenCount,
  totalTokens: NullableTokenCount,
  durationMs: NonnegativeSafeInteger,
}).annotate({ parseOptions: strictAgentExecutionSchemaOptions });

export type AgentExecutionMetrics = typeof AgentExecutionMetrics.Type;
export type AgentExecutionTokenUsage = Omit<
  AgentExecutionMetrics,
  "durationMs"
>;
export type AgentExecutionUsageProvider = AgentProvider;

export type AgentExecutionUsageObservationBase = {
  /** Briar runtime provider, separate from the provider's billing namespace. */
  provider: AgentProvider;
  model: string | null;
  canonicalModel: string | null;
  /** Raw provider/billing namespace such as openai, bedrock, or vertex. */
  modelProvider: string | null;
  modelSource:
    | "providerReported"
    | "providerConfig"
    | "configuredFallback"
    | "unknown";
  scopeId: string | null;
  sessionId: string | null;
  turnId: string | null;
  /** Stable when the provider supplies enough identity to replace a replay. */
  dedupeKey: string | null;
};

export type AgentExecutionModelObservation =
  AgentExecutionUsageObservationBase & {
    kind: "model";
    source:
      | "claude.init"
      | "claude.assistant"
      | "agy.init"
      | "codex.config"
      | "codex.modelDefault"
      | "codex.thread"
      | "codex.turnRequest"
      | "codex.threadSettings"
      | "codex.rerouted"
      | "opencode.assistant"
      | "grok.session"
      | "grok.sessionNew"
      | "grok.sessionLoad"
      | "grok.modelSet";
  };

export type AgentExecutionTokenObservation =
  AgentExecutionUsageObservationBase & {
    /**
     * A delta is one provider message/turn. A cumulative observation replaces
     * earlier deltas for the same session and model.
     */
    kind: "delta" | "cumulative";
    tokenUsage: AgentExecutionTokenUsage;
    source:
      | "claude.assistant.usage"
      | "claude.result.modelUsage"
      | "claude.result.usage"
      | "agy.result.usage"
      | "codex.threadTokenUsage"
      | "codex.turnUsage"
      | "opencode.step.usage"
      | "opencode.assistant.usage"
      | "grok.turnCompleted.modelUsage"
      | "grok.turnCompleted.usage"
      | "grok.prompt.metaModelUsage"
      | "grok.prompt.metaUsage"
      | "grok.prompt.usage";
  };

export type AgentExecutionUsageObservation =
  | AgentExecutionModelObservation
  | AgentExecutionTokenObservation;

export type AgentExecutionCostObservation =
  AgentExecutionUsageObservationBase & {
    kind: "cost";
    amountUsdTicks: number;
    usageKey: string | null;
    source:
      | "claude.result.modelUsage.costUSD"
      | "claude.result.total_cost_usd"
      | "opencode.step.cost"
      | "opencode.assistant.cost"
      | "grok.usageUpdate.cost"
      | "grok.prompt.costUsdTicks"
      | "grok.prompt.metaCostUsdTicks"
      | "grok.prompt.metaModelUsage.costUsdTicks"
      | "grok.turnCompleted.costUsdTicks"
      | "grok.turnCompleted.modelUsage.costUsdTicks";
  };

export type AgentExecutionCollectedCostObservation =
  AgentExecutionCostObservation & {
    dedupeKey: string;
    observedAt: string;
  };

export const AgentExecutionUsageRecord = Schema.Struct({
  usageKey: TrimmedText(512),
  sessionId: NullableTrimmedText(512),
  scopeId: NullableTrimmedText(512),
  turnId: NullableTrimmedText(512),
  agentProvider: AgentProviderSchema,
  modelProvider: NullableTrimmedText(256),
  model: NullableTrimmedText(512),
  canonicalModel: NullableTrimmedText(512),
  modelSource: AgentExecutionModelSourceSchema,
  source: TrimmedText(128),
  uncachedInputTokens: NullableTokenCount,
  cacheReadTokens: NullableTokenCount,
  cacheWriteTokens: NullableTokenCount,
  outputTokens: NullableTokenCount,
  reasoningOutputTokens: NullableTokenCount,
  totalTokens: NullableTokenCount,
  observedAt: ObservedAt,
}).check(
  Schema.makeFilter((record) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (
      record.uncachedInputTokens === null &&
      record.cacheReadTokens === null &&
      record.cacheWriteTokens === null &&
      record.outputTokens === null &&
      record.reasoningOutputTokens === null &&
      record.totalTokens === null
    ) {
      issues.push("usage records require at least one token value");
    }
    if (
      record.reasoningOutputTokens !== null &&
      (record.outputTokens === null ||
        record.reasoningOutputTokens > record.outputTokens)
    ) {
      issues.push({
        path: ["reasoningOutputTokens"],
        issue: "reasoningOutputTokens must be a subset of outputTokens",
      });
    }
    // Total equality is intentionally not enforced because provider total
    // token semantics are not uniform.
    return issues;
  }),
).annotate({ parseOptions: strictAgentExecutionSchemaOptions });

export type AgentExecutionUsageRecord =
  typeof AgentExecutionUsageRecord.Type;

export type AgentExecutionCollectedTokenObservation =
  AgentExecutionTokenObservation & {
    dedupeKey: string;
    observedAt: string;
  };

export const decodeAgentExecutionMetrics = Schema.decodeUnknownSync(
  AgentExecutionMetrics,
  strictAgentExecutionSchemaOptions,
);

export const decodeAgentExecutionMetricsOption = Schema.decodeUnknownOption(
  AgentExecutionMetrics,
  strictAgentExecutionSchemaOptions,
);

export const decodeAgentExecutionUsageRecord = Schema.decodeUnknownSync(
  AgentExecutionUsageRecord,
  strictAgentExecutionSchemaOptions,
);

export const parseObservedAt = Schema.decodeUnknownSync(ObservedAt);
