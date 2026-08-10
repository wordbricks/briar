import { describe, expect, it, vi } from "vitest";

import { parseAgentUsageModelRates } from "../../src/lib/agent-usage-pricing";
import type {
  OrganizationCostRecordRow,
  OrganizationUsageRecordRow,
} from "./db";
import {
  createAgentUsagePricingLoader,
  estimateOrganizationUsageCosts,
} from "./usage-pricing";

const pricingDocument = {
  "model-a": {
    litellm_provider: "provider-a",
    input_cost_per_token: 1e-6,
    output_cost_per_token: 4e-6,
    cache_read_input_token_cost: 0.1e-6,
    cache_creation_input_token_cost: 1.25e-6,
  },
  "model-b": {
    litellm_provider: "provider-a",
    input_cost_per_token: 2e-6,
    output_cost_per_token: 5e-6,
  },
};

const usageRow = (
  overrides: Partial<OrganizationUsageRecordRow> = {},
): OrganizationUsageRecordRow => ({
  execution_id: "execution-1",
  run_id: "run-1",
  project_id: "project-1",
  run_attempt: 1,
  claim_attempt: 1,
  worker_id: "worker-1",
  claimed_at: "2026-08-10T00:00:00.000Z",
  usage_key: "usage-a",
  session_id: "session-1",
  turn_id: "turn-1",
  scope_id: "scope-1",
  agent_provider: "opencode",
  model_provider: "provider-a",
  model: "model-a",
  canonical_model: null,
  model_source: "providerReported",
  source: "opencode.step.usage",
  uncached_input_tokens: 100,
  cache_read_tokens: 20,
  cache_write_tokens: 10,
  output_tokens: 5,
  reasoning_output_tokens: 2,
  total_tokens: 137,
  observed_at: "2026-08-10T00:01:00.000Z",
  recorded_at: "2026-08-10T00:02:00.000Z",
  ...overrides,
});

const costRow = (
  overrides: Partial<OrganizationCostRecordRow> = {},
): OrganizationCostRecordRow => ({
  execution_id: "execution-1",
  run_id: "run-1",
  project_id: "project-1",
  run_attempt: 1,
  claim_attempt: 1,
  worker_id: "worker-1",
  claimed_at: "2026-08-10T00:00:00.000Z",
  cost_key: "cost-a",
  usage_key: "usage-a",
  session_id: "session-1",
  turn_id: "turn-1",
  scope_id: "scope-1",
  agent_provider: "opencode",
  model_provider: "provider-a",
  model: "model-a",
  canonical_model: null,
  model_source: "providerReported",
  source: "opencode.step.cost",
  amount_usd_ticks: 0,
  observed_at: "2026-08-10T00:01:00.000Z",
  recorded_at: "2026-08-10T00:02:00.000Z",
  ...overrides,
});

describe("worker usage pricing", () => {
  it("caches a live table and falls back to its last good copy", async () => {
    let now = 1_000;
    const fetcher = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json(pricingDocument))
      .mockRejectedValueOnce(new Error("offline"));
    const load = createAgentUsagePricingLoader({
      fetcher,
      now: () => now,
      cacheTtlMs: 100,
      timeoutMs: 1_000,
    });

    const live = await load();
    expect(live.pricing).toMatchObject({
      status: "live",
      knownModels: 2,
      fetchedAt: new Date(1_000).toISOString(),
    });
    now = 1_050;
    await expect(load()).resolves.toMatchObject({
      pricing: { status: "cached", knownModels: 2 },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    now = 1_101;
    const stale = await load();
    expect(stale.pricing).toMatchObject({
      status: "cached",
      knownModels: 2,
      fetchedAt: new Date(1_000).toISOString(),
    });
    expect(stale.table?.entries).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable instead of failing the usage endpoint", async () => {
    const load = createAgentUsagePricingLoader({
      fetcher: vi.fn(async () => new Response("bad", { status: 503 })),
      timeoutMs: 1_000,
    });
    await expect(load()).resolves.toMatchObject({
      table: null,
      pricing: {
        status: "unavailable",
        fetchedAt: null,
        knownModels: 0,
      },
    });
  });

  it("replaces prior rates after the cache window instead of pinning history", async () => {
    let now = 10_000;
    const fetcher = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json(pricingDocument))
      .mockResolvedValueOnce(
        Response.json({
          ...pricingDocument,
          "model-a": {
            ...pricingDocument["model-a"],
            input_cost_per_token: 9e-6,
          },
        }),
      );
    const load = createAgentUsagePricingLoader({
      fetcher,
      now: () => now,
      cacheTtlMs: 100,
    });

    expect((await load()).table?.exact.get("model-a")?.[0]).toMatchObject({
      inputCostPerToken: 1e-6,
    });
    now = 10_101;
    expect((await load()).table?.exact.get("model-a")?.[0]).toMatchObject({
      inputCostPerToken: 9e-6,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("prices uncovered usage but preserves provider-reported zero cost", () => {
    const table = parseAgentUsageModelRates(pricingDocument);
    const first = usageRow();
    const second = usageRow({
      usage_key: "usage-b",
      model: "model-b",
      uncached_input_tokens: 10,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 2,
    });
    const estimated = estimateOrganizationUsageCosts({
      usageRecords: [first, second],
      costRecords: [costRow()],
      table,
    });

    expect(estimated).toEqual([
      expect.objectContaining({
        usageKey: "usage-b",
        pricingKey: "model-b",
        amountUsdTicks: 300_000,
        costSource: "modelPriced",
      }),
    ]);
  });

  it("lets aggregate and per-model provider costs cover the right rows", () => {
    const table = parseAgentUsageModelRates(pricingDocument);
    const modelA = usageRow();
    const modelB = usageRow({ usage_key: "usage-b", model: "model-b" });

    expect(
      estimateOrganizationUsageCosts({
        usageRecords: [modelA, modelB],
        costRecords: [
          costRow({ usage_key: null, model: null, canonical_model: null }),
        ],
        table,
      }),
    ).toEqual([]);

    const afterModelCost = estimateOrganizationUsageCosts({
      usageRecords: [modelA, modelB],
      costRecords: [
        costRow({ usage_key: null, model: "model-a", canonical_model: null }),
      ],
      table,
    });
    expect(afterModelCost).toEqual([
      expect.objectContaining({ usageKey: "usage-b", model: "model-b" }),
    ]);
  });

  it("does not let provider costs cover another turn or model provider", () => {
    const table = parseAgentUsageModelRates(pricingDocument);
    const usage = usageRow();

    expect(
      estimateOrganizationUsageCosts({
        usageRecords: [usage],
        costRecords: [
          costRow({
            usage_key: null,
            turn_id: "turn-2",
            model: null,
            canonical_model: null,
          }),
          costRow({
            cost_key: "cost-b",
            usage_key: null,
            model_provider: "provider-b",
          }),
        ],
        table,
      }),
    ).toEqual([
      expect.objectContaining({ usageKey: "usage-a", model: "model-a" }),
    ]);
  });

  it("does not price rows without a trustworthy model or token split", () => {
    const table = parseAgentUsageModelRates(pricingDocument);
    expect(
      estimateOrganizationUsageCosts({
        usageRecords: [
          usageRow({ model: null, canonical_model: null }),
          usageRow({ usage_key: "usage-b", uncached_input_tokens: null }),
        ],
        costRecords: [],
        table,
      }),
    ).toEqual([]);
  });
});
