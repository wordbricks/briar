import { z } from "zod";
import { agentProviders, type AgentProvider } from "../agent-provider-contract";

const tokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const observedAtSchema = z.string().datetime({ offset: true });

export const agentExecutionMetricsSchema = z
  .object({
    inputTokens: tokenCountSchema.nullable(),
    outputTokens: tokenCountSchema.nullable(),
    cacheReadTokens: tokenCountSchema.nullable(),
    cacheWriteTokens: tokenCountSchema.nullable(),
    reasoningOutputTokens: tokenCountSchema.nullable(),
    totalTokens: tokenCountSchema.nullable(),
    durationMs: tokenCountSchema,
  })
  .strict();

export type AgentExecutionMetrics = z.infer<typeof agentExecutionMetricsSchema>;
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

export const agentExecutionUsageRecordSchema = z
  .object({
    usageKey: z.string().trim().min(1).max(512),
    sessionId: z.string().trim().min(1).max(512).nullable(),
    scopeId: z.string().trim().min(1).max(512).nullable(),
    turnId: z.string().trim().min(1).max(512).nullable(),
    agentProvider: z.enum(agentProviders),
    modelProvider: z.string().trim().min(1).max(256).nullable(),
    model: z.string().trim().min(1).max(512).nullable(),
    canonicalModel: z.string().trim().min(1).max(512).nullable(),
    modelSource: z.enum([
      "providerReported",
      "providerConfig",
      "configuredFallback",
      "unknown",
    ]),
    source: z.string().trim().min(1).max(128),
    uncachedInputTokens: tokenCountSchema.nullable(),
    cacheReadTokens: tokenCountSchema.nullable(),
    cacheWriteTokens: tokenCountSchema.nullable(),
    outputTokens: tokenCountSchema.nullable(),
    reasoningOutputTokens: tokenCountSchema.nullable(),
    totalTokens: tokenCountSchema.nullable(),
    observedAt: observedAtSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.uncachedInputTokens === null &&
      record.cacheReadTokens === null &&
      record.cacheWriteTokens === null &&
      record.outputTokens === null &&
      record.reasoningOutputTokens === null &&
      record.totalTokens === null
    ) {
      context.addIssue({
        code: "custom",
        message: "usage records require at least one token value",
      });
    }
    if (
      record.reasoningOutputTokens !== null &&
      (record.outputTokens === null ||
        record.reasoningOutputTokens > record.outputTokens)
    ) {
      context.addIssue({
        code: "custom",
        message: "reasoningOutputTokens must be a subset of outputTokens",
        path: ["reasoningOutputTokens"],
      });
    }
    // Total equality is intentionally not enforced because provider total
    // token semantics are not uniform.
  });

export type AgentExecutionUsageRecord = z.infer<
  typeof agentExecutionUsageRecordSchema
>;

export type AgentExecutionCollectedTokenObservation =
  AgentExecutionTokenObservation & {
    dedupeKey: string;
    observedAt: string;
  };

export const parseObservedAt = (value: string) => observedAtSchema.parse(value);
