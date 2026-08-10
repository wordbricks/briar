import { z } from "zod";

import { agentProviders } from "./agent-provider-contract";

/** Exact fixed-point scale used for provider-reported USD costs. */
export const AGENT_EXECUTION_USD_TICKS_PER_DOLLAR = 10_000_000_000;

const nullableIdentifier = (max: number) =>
  z.string().trim().min(1).max(max).nullable();

/**
 * An immutable provider-reported cost observation. `amountUsdTicks` is exact
 * fixed-point USD where one dollar equals 10^10 ticks.
 */
export const agentExecutionCostRecordSchema = z
  .object({
    costKey: z.string().trim().min(1).max(512),
    usageKey: nullableIdentifier(512),
    sessionId: nullableIdentifier(512),
    scopeId: nullableIdentifier(512),
    turnId: nullableIdentifier(512),
    agentProvider: z.enum(agentProviders),
    modelProvider: nullableIdentifier(256),
    model: nullableIdentifier(512),
    canonicalModel: nullableIdentifier(512),
    modelSource: z.enum([
      "providerReported",
      "providerConfig",
      "configuredFallback",
      "unknown",
    ]),
    source: z.string().trim().min(1).max(128),
    amountUsdTicks: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type AgentExecutionCostRecord = z.infer<
  typeof agentExecutionCostRecordSchema
>;
