import { describe, expect, it } from "vitest";

import {
  lookupAgentUsageModelRate,
  parseAgentUsageModelRates,
  priceAgentExecutionUsage,
} from "./agent-usage-pricing";

const rates = (
  input: number,
  output: number,
  provider: string,
  cacheRead?: number,
  cacheWrite?: number,
) => ({
  input_cost_per_token: input,
  output_cost_per_token: output,
  litellm_provider: provider,
  ...(cacheRead === undefined
    ? {}
    : { cache_read_input_token_cost: cacheRead }),
  ...(cacheWrite === undefined
    ? {}
    : { cache_creation_input_token_cost: cacheWrite }),
});

describe("agent usage pricing", () => {
  it("keeps provider-qualified entries distinct and drops partial rates", () => {
    const table = parseAgentUsageModelRates({
      "claude-sonnet-4-6": rates(3e-6, 15e-6, "anthropic", 0.3e-6),
      "snowflake/claude-sonnet-4-6": rates(4e-6, 16e-6, "snowflake"),
      "missing-output": { input_cost_per_token: 1e-6 },
      "negative-input": rates(-1, 1, "broken"),
    });

    expect(table.entries).toHaveLength(2);
    expect(table.suffix.get("claude-sonnet-4-6")).toHaveLength(2);
    expect(table.entries[0]).toMatchObject({
      cacheReadCostPerToken: 0.3e-6,
      cacheWriteCostPerToken: 3e-6,
    });
  });

  it("matches exact and provider-compatible prices without basename guessing", () => {
    const table = parseAgentUsageModelRates({
      "claude-sonnet-4-6": rates(3e-6, 15e-6, "anthropic"),
      "snowflake/claude-sonnet-4-6": rates(4e-6, 16e-6, "snowflake"),
      "fireworks/deepseek-v4": rates(1e-6, 2e-6, "fireworks_ai"),
      "azure_ai/deepseek-v4": rates(3e-6, 4e-6, "azure_ai"),
      "xai/grok-4-1-fast-non-reasoning": rates(0.2e-6, 0.5e-6, "xai"),
    });

    expect(
      lookupAgentUsageModelRate(table, {
        model: "claude-sonnet-4-6",
        canonicalModel: null,
        modelProvider: "firstParty",
      })?.pricingKey,
    ).toBe("claude-sonnet-4-6");
    expect(
      lookupAgentUsageModelRate(table, {
        model: "claude-sonnet-4-6",
        canonicalModel: null,
        modelProvider: "snowflake",
      })?.pricingKey,
    ).toBe("snowflake/claude-sonnet-4-6");
    expect(
      lookupAgentUsageModelRate(table, {
        model: "deepseek-v4",
        canonicalModel: null,
        modelProvider: "opencode-go",
      }),
    ).toBeNull();
    expect(
      lookupAgentUsageModelRate(table, {
        model: "other/deepseek-v4",
        canonicalModel: null,
        modelProvider: null,
      }),
    ).toBeNull();
    expect(
      lookupAgentUsageModelRate(table, {
        model: "grok-4.1-fast-non-reasoning",
        canonicalModel: null,
        modelProvider: "xAI",
      })?.pricingKey,
    ).toBe("xai/grok-4-1-fast-non-reasoning");
  });

  it("allows an unambiguous same-rate suffix and prefers canonical exact keys", () => {
    const table = parseAgentUsageModelRates({
      "provider-a/model-safe": rates(1e-6, 2e-6, "provider-a"),
      "provider-b/model-safe": rates(1e-6, 2e-6, "provider-b"),
      "canonical-model": rates(3e-6, 4e-6, "provider-a"),
      "reported-model": rates(5e-6, 6e-6, "provider-a"),
    });

    expect(
      lookupAgentUsageModelRate(table, {
        model: "unknown-prefix/model-safe",
        canonicalModel: null,
        modelProvider: null,
      })?.pricingKey,
    ).toBe("provider-a/model-safe");
    expect(
      lookupAgentUsageModelRate(table, {
        model: "reported-model",
        canonicalModel: "canonical-model",
        modelProvider: "provider-a",
      })?.pricingKey,
    ).toBe("canonical-model");
  });

  it("prices token buckets once and requires input/output detail", () => {
    expect(
      priceAgentExecutionUsage(
        {
          uncachedInputTokens: 100,
          cacheReadTokens: 20,
          cacheWriteTokens: 10,
          outputTokens: 5,
        },
        {
          inputCostPerToken: 1e-6,
          outputCostPerToken: 4e-6,
          cacheReadCostPerToken: 0.1e-6,
          cacheWriteCostPerToken: 1.25e-6,
        },
      ),
    ).toBe(1_345_000);
    expect(
      priceAgentExecutionUsage(
        {
          uncachedInputTokens: null,
          cacheReadTokens: 20,
          cacheWriteTokens: null,
          outputTokens: 5,
        },
        {
          inputCostPerToken: 1e-6,
          outputCostPerToken: 4e-6,
          cacheReadCostPerToken: 0.1e-6,
          cacheWriteCostPerToken: 1.25e-6,
        },
      ),
    ).toBeNull();
  });
});
