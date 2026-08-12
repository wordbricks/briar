import { AGENT_EXECUTION_USD_TICKS_PER_DOLLAR } from "./agent-execution-cost";
import type { AgentExecutionUsageRecord } from "./agent-execution-metrics";

export const LITELLM_MAIN_PRICING_SOURCE =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export type AgentUsagePricing = {
  status: "live" | "cached" | "unavailable";
  source: string;
  fetchedAt: string | null;
  knownModels: number;
};

export type AgentUsageModelRate = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken: number;
  cacheWriteCostPerToken: number;
};

export type AgentUsageModelRateEntry = AgentUsageModelRate & {
  pricingKey: string;
  modelProvider: string | null;
};

export type AgentUsageModelRateTable = {
  readonly entries: readonly AgentUsageModelRateEntry[];
  readonly exact: ReadonlyMap<string, readonly AgentUsageModelRateEntry[]>;
  readonly suffix: ReadonlyMap<string, readonly AgentUsageModelRateEntry[]>;
};

export type AgentExecutionCostEstimateModel = AgentUsageModelRate & {
  pricingKey: string;
  modelProvider: string | null;
  model: string;
  estimatedUsdTicks: number;
};

export type AgentExecutionCostEstimate = {
  pricing: AgentUsagePricing;
  status: "estimated" | "partial" | "unavailable";
  reason:
    | "pricingUnavailable"
    | "usageUnavailable"
    | "modelRateUnavailable"
    | "tokenBreakdownUnavailable"
    | null;
  usageRecords: number;
  pricedUsageRecords: number;
  estimatedUsdTicks: number | null;
  pricedUsdTicks: number;
  models: AgentExecutionCostEstimateModel[];
};

type LiteLlmPricingEntry = {
  input_cost_per_token?: unknown;
  output_cost_per_token?: unknown;
  cache_read_input_token_cost?: unknown;
  cache_creation_input_token_cost?: unknown;
  litellm_provider?: unknown;
};

const finiteNonnegativeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const normalizedIdentifier = (value: string) => value.trim().toLowerCase();

const modelSuffix = (model: string) => {
  const normalized = normalizedIdentifier(model);
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? normalized : normalized.slice(separator + 1);
};

const pushIndexedEntry = (
  index: Map<string, AgentUsageModelRateEntry[]>,
  key: string,
  entry: AgentUsageModelRateEntry,
) => {
  index.set(key, [...(index.get(key) ?? []), entry]);
};

/**
 * Parse the mutable LiteLLM `main` document without collapsing provider
 * prefixes. Multiple providers frequently publish the same model basename at
 * different prices, so those candidates must remain distinct until lookup.
 */
export function parseAgentUsageModelRates(
  document: unknown,
): AgentUsageModelRateTable {
  const exact = new Map<string, AgentUsageModelRateEntry[]>();
  const suffix = new Map<string, AgentUsageModelRateEntry[]>();
  const entries: AgentUsageModelRateEntry[] = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { entries, exact, suffix };
  }

  for (const [pricingKey, value] of Object.entries(
    document as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const raw = value as LiteLlmPricingEntry;
    const inputCostPerToken = finiteNonnegativeNumber(
      raw.input_cost_per_token,
    );
    const outputCostPerToken = finiteNonnegativeNumber(
      raw.output_cost_per_token,
    );
    if (inputCostPerToken === null || outputCostPerToken === null) continue;

    const normalizedKey = normalizedIdentifier(pricingKey);
    if (!normalizedKey) continue;
    const entry: AgentUsageModelRateEntry = {
      pricingKey,
      modelProvider:
        typeof raw.litellm_provider === "string" &&
        raw.litellm_provider.trim()
          ? raw.litellm_provider.trim()
          : null,
      inputCostPerToken,
      outputCostPerToken,
      cacheReadCostPerToken:
        finiteNonnegativeNumber(raw.cache_read_input_token_cost) ??
        inputCostPerToken,
      cacheWriteCostPerToken:
        finiteNonnegativeNumber(raw.cache_creation_input_token_cost) ??
        inputCostPerToken,
    };
    entries.push(entry);
    pushIndexedEntry(exact, normalizedKey, entry);
    pushIndexedEntry(suffix, modelSuffix(normalizedKey), entry);
  }

  return { entries, exact, suffix };
}

const normalizedProvider = (value: string) =>
  normalizedIdentifier(value)
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

const providerFamily = (provider: string): ReadonlySet<string> => {
  const normalized = normalizedProvider(provider);
  if (["anthropic", "firstparty", "first_party"].includes(normalized)) {
    return new Set(["anthropic"]);
  }
  if (["aws", "amazon_bedrock", "bedrock"].includes(normalized)) {
    return new Set(["bedrock", "bedrock_converse"]);
  }
  if (["vertex", "vertex_ai", "google_vertex"].includes(normalized)) {
    return new Set([
      "vertex_ai",
      "vertex_ai_anthropic_models",
      "vertex_ai_language_models",
    ]);
  }
  if (["x_ai", "xai"].includes(normalized)) return new Set(["xai"]);
  if (["open_ai", "openai"].includes(normalized)) {
    return new Set(["openai"]);
  }
  return new Set(normalized ? [normalized] : []);
};

const rateSignature = (entry: AgentUsageModelRateEntry) =>
  JSON.stringify([
    entry.inputCostPerToken,
    entry.outputCostPerToken,
    entry.cacheReadCostPerToken,
    entry.cacheWriteCostPerToken,
  ]);

const uniqueRate = (
  entries: readonly AgentUsageModelRateEntry[],
): AgentUsageModelRateEntry | null => {
  if (entries.length === 0) return null;
  const signature = rateSignature(entries[0]!);
  if (entries.some((entry) => rateSignature(entry) !== signature)) return null;
  return [...entries].sort(
    (left, right) =>
      left.pricingKey.length - right.pricingKey.length ||
      left.pricingKey.localeCompare(right.pricingKey),
  )[0]!;
};

const unpriceableModels = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

export function lookupAgentUsageModelRate(
  table: AgentUsageModelRateTable,
  input: {
    model: string | null;
    canonicalModel: string | null;
    modelProvider: string | null;
  },
): AgentUsageModelRateEntry | null {
  const reportedModels = [...new Set([input.canonicalModel, input.model])]
    .filter((model): model is string => typeof model === "string")
    .map(normalizedIdentifier)
    .filter(
      (model) => model.length > 0 && !unpriceableModels.has(modelSuffix(model)),
    );
  if (reportedModels.length === 0) return null;

  const providers = input.modelProvider
    ? providerFamily(input.modelProvider)
    : null;
  const models = [...reportedModels];
  if (providers?.has("xai")) {
    for (const model of reportedModels) {
      const xaiVersionAlias = model.replace(
        /(^|\/)grok-(\d+)\.(\d+)(?=-|$)/u,
        "$1grok-$2-$3",
      );
      if (xaiVersionAlias !== model) models.push(xaiVersionAlias);
    }
  }
  const compatible = (entry: AgentUsageModelRateEntry) =>
    providers === null ||
    (entry.modelProvider !== null &&
      providers.has(normalizedProvider(entry.modelProvider)));

  // Exact full model identifiers are stronger than any suffix candidate.
  for (const model of models) {
    const match = uniqueRate((table.exact.get(model) ?? []).filter(compatible));
    if (match) return match;
  }

  // A provider-qualified suffix is safe only when all surviving candidates
  // have the same effective rates. Unknown providers never borrow another
  // provider's price merely because the model basename happens to match.
  for (const model of models) {
    const candidates = table.suffix.get(modelSuffix(model)) ?? [];
    const match = uniqueRate(candidates.filter(compatible));
    if (match) return match;
  }
  return null;
}

const requiredTokenCount = (value: number | null): number | null =>
  value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;

const optionalTokenCount = (value: number | null): number =>
  value !== null && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/**
 * Calculate one usage row at the rates loaded for the current request. Cache
 * buckets fall back to the input rate when LiteLLM omits a specialized rate.
 * Reasoning output is already included in outputTokens and is never charged a
 * second time.
 */
export function priceAgentExecutionUsage(
  usage: Pick<
    AgentExecutionUsageRecord,
    | "uncachedInputTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "outputTokens"
  >,
  rate: AgentUsageModelRate,
): number | null {
  const uncachedInputTokens = requiredTokenCount(usage.uncachedInputTokens);
  const outputTokens = requiredTokenCount(usage.outputTokens);
  if (uncachedInputTokens === null || outputTokens === null) return null;

  const amountUsd =
    uncachedInputTokens * rate.inputCostPerToken +
    optionalTokenCount(usage.cacheReadTokens) * rate.cacheReadCostPerToken +
    optionalTokenCount(usage.cacheWriteTokens) * rate.cacheWriteCostPerToken +
    outputTokens * rate.outputCostPerToken;
  const ticks = Math.round(amountUsd * AGENT_EXECUTION_USD_TICKS_PER_DOLLAR);
  return Number.isSafeInteger(ticks) && ticks >= 0 ? ticks : null;
}
