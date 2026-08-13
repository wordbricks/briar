import {
  LITELLM_MAIN_PRICING_SOURCE,
  lookupAgentUsageModelRate,
  parseAgentUsageModelRates,
  priceAgentExecutionUsage,
  type AgentExecutionCostEstimate,
  type AgentExecutionCostEstimateModel,
  type AgentUsagePricing,
  type AgentUsageModelRateTable,
} from "../../src/lib/agent-usage-pricing";
import type {
  OrganizationCostRecordRow,
  OrganizationUsageRecordRow,
} from "./db";

export const AGENT_USAGE_PRICING_CACHE_TTL_MS = 5 * 60_000;
const AGENT_USAGE_PRICING_FETCH_TIMEOUT_MS = 10_000;

export type EstimatedOrganizationUsageCostRecord = {
  executionId: string;
  projectId: string;
  runAttempt: number;
  claimAttempt: number;
  workerId: string | null;
  claimedAt: string;
  usageKey: string;
  sessionId: string | null;
  scopeId: string | null;
  turnId: string | null;
  agentProvider: OrganizationUsageRecordRow["agent_provider"];
  modelProvider: string | null;
  model: string | null;
  canonicalModel: string | null;
  modelSource: OrganizationUsageRecordRow["model_source"];
  usageSource: string;
  pricingKey: string;
  amountUsdTicks: number;
  observedAt: string;
  costSource: "modelPriced";
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type CachedPricing = {
  table: AgentUsageModelRateTable;
  fetchedAtMs: number;
};

export type LoadedAgentUsagePricing = {
  table: AgentUsageModelRateTable | null;
  pricing: AgentUsagePricing;
};

const pricingInfo = (
  cache: CachedPricing | null,
  status: AgentUsagePricing["status"],
): AgentUsagePricing => ({
  status,
  source: LITELLM_MAIN_PRICING_SOURCE,
  fetchedAt: cache ? new Date(cache.fetchedAtMs).toISOString() : null,
  knownModels: cache?.table.entries.length ?? 0,
});

/**
 * Keep the latest mutable LiteLLM `main` table in isolate memory for five
 * minutes. A failed refresh can use the last good in-memory copy, but no rate
 * snapshot is persisted or attached to historical records.
 */
export function createAgentUsagePricingLoader(
  options: {
    fetcher?: Fetcher;
    now?: () => number;
    cacheTtlMs?: number;
    timeoutMs?: number;
  } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? AGENT_USAGE_PRICING_CACHE_TTL_MS;
  const timeoutMs =
    options.timeoutMs ?? AGENT_USAGE_PRICING_FETCH_TIMEOUT_MS;
  let cache: CachedPricing | null = null;
  let lastAttemptAtMs: number | null = null;
  let inFlight: Promise<LoadedAgentUsagePricing> | null = null;

  const refresh = async (): Promise<LoadedAgentUsagePricing> => {
    lastAttemptAtMs = now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(LITELLM_MAIN_PRICING_SOURCE, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`pricing fetch failed (${response.status})`);
      }
      const table = parseAgentUsageModelRates(await response.json());
      if (table.entries.length === 0) {
        throw new Error("pricing response contained no usable model rates");
      }
      cache = { table, fetchedAtMs: now() };
      return { table, pricing: pricingInfo(cache, "live") };
    } catch {
      return {
        table: cache?.table ?? null,
        pricing: pricingInfo(cache, cache ? "cached" : "unavailable"),
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  return async (): Promise<LoadedAgentUsagePricing> => {
    const requestedAt = now();
    if (cache && requestedAt - cache.fetchedAtMs < cacheTtlMs) {
      return { table: cache.table, pricing: pricingInfo(cache, "cached") };
    }
    if (inFlight) return inFlight;
    if (
      lastAttemptAtMs !== null &&
      requestedAt - lastAttemptAtMs < cacheTtlMs
    ) {
      return {
        table: cache?.table ?? null,
        pricing: pricingInfo(cache, cache ? "cached" : "unavailable"),
      };
    }
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export const loadAgentUsagePricing = createAgentUsagePricingLoader();

type RunUsagePricingInput = Pick<
  OrganizationUsageRecordRow,
  | "agent_provider"
  | "model_provider"
  | "model"
  | "canonical_model"
  | "uncached_input_tokens"
  | "cache_read_tokens"
  | "cache_write_tokens"
  | "output_tokens"
>;

export type RunUsagePricingFallback = {
  agentProvider: OrganizationUsageRecordRow["agent_provider"];
  model: string | null;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
};

const fallbackModelProvider = (
  provider: RunUsagePricingFallback["agentProvider"],
) => {
  if (provider === "codex") return "openai";
  if (provider === "claude") return "anthropic";
  if (provider === "grok") return "xai";
  return null;
};

const fallbackUsage = (
  fallback: RunUsagePricingFallback,
): RunUsagePricingInput => {
  const cacheReadTokens = fallback.cacheReadTokens ?? 0;
  const cacheWriteTokens = fallback.cacheWriteTokens ?? 0;
  const inputIncludesCache =
    fallback.agentProvider === "codex" || fallback.agentProvider === "grok";
  return {
    agent_provider: fallback.agentProvider,
    model_provider: fallbackModelProvider(fallback.agentProvider),
    model: fallback.model,
    canonical_model: null,
    uncached_input_tokens:
      fallback.inputTokens === null
        ? null
        : inputIncludesCache
          ? Math.max(
              0,
              fallback.inputTokens - cacheReadTokens - cacheWriteTokens,
            )
          : fallback.inputTokens,
    cache_read_tokens: fallback.cacheReadTokens,
    cache_write_tokens: fallback.cacheWriteTokens,
    output_tokens: fallback.outputTokens,
  };
};

/**
 * Reprice one run from immutable usage rows whenever the issue detail is read.
 * The execution summary is used only for older runs that predate the ledger.
 */
export function estimateRunExecutionCost(input: {
  usageRecords: readonly OrganizationUsageRecordRow[];
  loadedPricing: LoadedAgentUsagePricing;
  fallback: RunUsagePricingFallback | null;
}): AgentExecutionCostEstimate {
  const providerReportedModels = [...new Set(
    input.usageRecords.flatMap((record) => {
      if (record.model_source !== "providerReported") return [];
      const model = record.model?.trim() || record.canonical_model?.trim();
      return model ? [model] : [];
    }),
  )];
  const records: readonly RunUsagePricingInput[] =
    input.usageRecords.length > 0
      ? input.usageRecords
      : input.fallback
        ? [fallbackUsage(input.fallback)]
        : [];
  const unavailable = (
    reason: NonNullable<AgentExecutionCostEstimate["reason"]>,
  ): AgentExecutionCostEstimate => ({
    pricing: input.loadedPricing.pricing,
    status: "unavailable",
    reason,
    usageRecords: records.length,
    pricedUsageRecords: 0,
    providerReportedModels,
    estimatedUsdTicks: null,
    pricedUsdTicks: 0,
    models: [],
  });
  if (records.length === 0) return unavailable("usageUnavailable");
  if (!input.loadedPricing.table) return unavailable("pricingUnavailable");

  const models = new Map<string, AgentExecutionCostEstimateModel>();
  let missingRate = 0;
  let missingBreakdown = 0;
  let pricedUsdTicks = 0;
  let pricedUsageRecords = 0;
  for (const usage of records) {
    const rate = lookupAgentUsageModelRate(input.loadedPricing.table, {
      model: usage.model,
      canonicalModel: usage.canonical_model,
      modelProvider: usage.model_provider,
    });
    if (!rate) {
      missingRate += 1;
      continue;
    }
    const amountUsdTicks = priceAgentExecutionUsage(
      {
        uncachedInputTokens: usage.uncached_input_tokens,
        cacheReadTokens: usage.cache_read_tokens,
        cacheWriteTokens: usage.cache_write_tokens,
        outputTokens: usage.output_tokens,
      },
      rate,
    );
    if (amountUsdTicks === null) {
      missingBreakdown += 1;
      continue;
    }
    if (!Number.isSafeInteger(pricedUsdTicks + amountUsdTicks)) {
      missingBreakdown += 1;
      continue;
    }
    pricedUsageRecords += 1;
    pricedUsdTicks += amountUsdTicks;
    const model = usage.canonical_model ?? usage.model ?? rate.pricingKey;
    const key = JSON.stringify([
      rate.pricingKey,
      usage.model_provider,
      model,
      rate.inputCostPerToken,
      rate.outputCostPerToken,
      rate.cacheReadCostPerToken,
      rate.cacheWriteCostPerToken,
    ]);
    const current = models.get(key);
    const next: AgentExecutionCostEstimateModel = {
      pricingKey: rate.pricingKey,
      modelProvider: usage.model_provider,
      model,
      inputCostPerToken: rate.inputCostPerToken,
      outputCostPerToken: rate.outputCostPerToken,
      cacheReadCostPerToken: rate.cacheReadCostPerToken,
      cacheWriteCostPerToken: rate.cacheWriteCostPerToken,
      estimatedUsdTicks:
        (current?.estimatedUsdTicks ?? 0) + amountUsdTicks,
    };
    models.set(key, next);
  }

  const complete = pricedUsageRecords === records.length;
  const status = complete
    ? "estimated"
    : pricedUsageRecords > 0
      ? "partial"
      : "unavailable";
  return {
    pricing: input.loadedPricing.pricing,
    status,
    reason: complete
      ? null
      : missingRate > 0
        ? "modelRateUnavailable"
        : missingBreakdown > 0
          ? "tokenBreakdownUnavailable"
          : "usageUnavailable",
    usageRecords: records.length,
    pricedUsageRecords,
    providerReportedModels,
    estimatedUsdTicks: complete ? pricedUsdTicks : null,
    pricedUsdTicks,
    models: [...models.values()].sort((left, right) =>
      left.model.localeCompare(right.model),
    ),
  };
}

const normalizedModel = (value: string | null) =>
  value?.trim().toLowerCase() ?? null;

const modelNames = (record: {
  model: string | null;
  canonical_model: string | null;
}) =>
  new Set(
    [normalizedModel(record.canonical_model), normalizedModel(record.model)]
      .filter((value): value is string => value !== null),
  );

const costCoversUsage = (
  cost: OrganizationCostRecordRow,
  usage: OrganizationUsageRecordRow,
) => {
  if (cost.execution_id !== usage.execution_id) return false;
  if (cost.usage_key !== null) return cost.usage_key === usage.usage_key;
  if (cost.session_id !== null && cost.session_id !== usage.session_id) {
    return false;
  }
  if (cost.scope_id !== null && cost.scope_id !== usage.scope_id) return false;
  if (cost.turn_id !== null && cost.turn_id !== usage.turn_id) return false;
  if (cost.model === null && cost.canonical_model === null) return true;
  if (
    cost.model_provider !== null &&
    usage.model_provider !== null &&
    normalizedModel(cost.model_provider) !== normalizedModel(usage.model_provider)
  ) {
    return false;
  }

  const costModels = modelNames(cost);
  const usageModels = modelNames(usage);
  return [...costModels].some((model) => usageModels.has(model));
};

/**
 * Price only token rows not already covered by a provider-reported cost. An
 * unattributed provider aggregate covers its whole scope/session; a per-model
 * provider row covers only the same model when it lacks a direct usage key.
 */
export function estimateOrganizationUsageCosts(input: {
  usageRecords: readonly OrganizationUsageRecordRow[];
  costRecords: readonly OrganizationCostRecordRow[];
  table: AgentUsageModelRateTable | null;
}): EstimatedOrganizationUsageCostRecord[] {
  if (!input.table) return [];
  const costsByExecution = new Map<string, OrganizationCostRecordRow[]>();
  for (const cost of input.costRecords) {
    costsByExecution.set(cost.execution_id, [
      ...(costsByExecution.get(cost.execution_id) ?? []),
      cost,
    ]);
  }

  return input.usageRecords.flatMap((usage) => {
    if (
      (costsByExecution.get(usage.execution_id) ?? []).some((cost) =>
        costCoversUsage(cost, usage),
      )
    ) {
      return [];
    }
    const rate = lookupAgentUsageModelRate(input.table!, {
      model: usage.model,
      canonicalModel: usage.canonical_model,
      modelProvider: usage.model_provider,
    });
    if (!rate) return [];
    const amountUsdTicks = priceAgentExecutionUsage(
      {
        uncachedInputTokens: usage.uncached_input_tokens,
        cacheReadTokens: usage.cache_read_tokens,
        cacheWriteTokens: usage.cache_write_tokens,
        outputTokens: usage.output_tokens,
      },
      rate,
    );
    if (amountUsdTicks === null) return [];

    return [
      {
        executionId: usage.execution_id,
        projectId: usage.project_id,
        runAttempt: usage.run_attempt,
        claimAttempt: usage.claim_attempt,
        workerId: usage.worker_id,
        claimedAt: usage.claimed_at,
        usageKey: usage.usage_key,
        sessionId: usage.session_id,
        scopeId: usage.scope_id,
        turnId: usage.turn_id,
        agentProvider: usage.agent_provider,
        modelProvider: usage.model_provider,
        model: usage.model,
        canonicalModel: usage.canonical_model,
        modelSource: usage.model_source,
        usageSource: usage.source,
        pricingKey: rate.pricingKey,
        amountUsdTicks,
        observedAt: usage.observed_at,
        costSource: "modelPriced",
      } satisfies EstimatedOrganizationUsageCostRecord,
    ];
  });
}
