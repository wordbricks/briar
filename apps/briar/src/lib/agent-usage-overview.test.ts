import { describe, expect, it } from "vitest";
import type {
  AgentUsageCostRecord,
  AgentUsageEstimatedCostRecord,
  AgentUsageRecord,
  HuntRun,
} from "../types";
import type { AgentExecutionMetrics } from "./agent-execution-metrics";
import {
  aggregateAgentUsageOverview,
  type AgentUsageOverviewRun,
  type UsageAttribution,
} from "./agent-usage-overview";

const localInstant = (
  year: number,
  month: number,
  day: number,
  hour = 12,
) => new Date(year, month - 1, day, hour).toISOString();

const metrics = (
  values: Partial<AgentExecutionMetrics>,
): AgentExecutionMetrics => ({
  totalTokens: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningOutputTokens: null,
  durationMs: 1,
  ...values,
});

const usageRecord = (
  overrides: Partial<AgentUsageRecord> = {},
): AgentUsageRecord => ({
  executionId: "execution-1",
  teamId: "project-1",
  runAttempt: 1,
  claimAttempt: 1,
  workerId: "worker-1",
  claimedAt: localInstant(2026, 8, 9),
  recordedAt: localInstant(2026, 8, 9),
  usageKey: "usage-1",
  sessionId: "session-1",
  scopeId: "turn-1",
  turnId: "turn-1",
  agentProvider: "claude",
  modelProvider: "anthropic",
  model: "claude-sonnet-4-6",
  canonicalModel: null,
  modelSource: "providerReported",
  source: "claude.assistant.usage",
  uncachedInputTokens: 60,
  cacheReadTokens: 20,
  cacheWriteTokens: 5,
  outputTokens: 15,
  reasoningOutputTokens: 3,
  totalTokens: 100,
  observedAt: localInstant(2026, 8, 9),
  ...overrides,
});

const costRecord = (
  overrides: Partial<AgentUsageCostRecord> = {},
): AgentUsageCostRecord => ({
  executionId: "execution-1",
  teamId: "project-1",
  runAttempt: 1,
  claimAttempt: 1,
  workerId: "worker-1",
  claimedAt: localInstant(2026, 8, 9),
  recordedAt: localInstant(2026, 8, 9),
  costKey: "cost-1",
  usageKey: "usage-1",
  sessionId: "session-1",
  scopeId: "turn-1",
  turnId: "turn-1",
  agentProvider: "claude",
  modelProvider: "anthropic",
  model: "claude-sonnet-4-6",
  canonicalModel: null,
  modelSource: "providerReported",
  source: "claude.result.modelUsage.costUSD",
  amountUsdTicks: 100,
  observedAt: localInstant(2026, 8, 9),
  costSource: "providerReported",
  ...overrides,
});

const estimatedCostRecord = (
  overrides: Partial<AgentUsageEstimatedCostRecord> = {},
): AgentUsageEstimatedCostRecord => ({
  executionId: "execution-1",
  teamId: "project-1",
  runAttempt: 1,
  claimAttempt: 1,
  workerId: "worker-1",
  claimedAt: localInstant(2026, 8, 9),
  usageKey: "usage-2",
  sessionId: "session-1",
  scopeId: "turn-2",
  turnId: "turn-2",
  agentProvider: "claude",
  modelProvider: "anthropic",
  model: "claude-opus-4-6",
  canonicalModel: null,
  modelSource: "providerReported",
  usageSource: "claude.assistant.usage",
  pricingKey: "claude-opus-4-6",
  amountUsdTicks: 200,
  observedAt: localInstant(2026, 8, 9),
  costSource: "modelPriced",
  ...overrides,
});

const huntRun = (
  id: string,
  values: Partial<HuntRun> = {},
): HuntRun =>
  ({
    id,
    startedAt: localInstant(2026, 8, 9),
    updatedAt: localInstant(2026, 8, 9),
    completedAt: localInstant(2026, 8, 9),
    status: "completed",
    claimAttempts: 1,
    executionMetrics: null,
    preferredProvider: null,
    preferredModel: null,
    requestedProvider: null,
    requestedModel: null,
    ...values,
  }) as HuntRun;

const providerPointKeys: UsageAttribution[] = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "agy",
  "opencode",
  "openrouter",
  "vertex",
  "pi",
  "unknown",
];

describe("aggregateAgentUsageOverview", () => {
  it("uses a complete local-calendar range and the timestamp fallback order", () => {
    const overview = aggregateAgentUsageOverview(
      [
        huntRun("first-day", {
          completedAt: localInstant(2026, 8, 3, 0),
        }),
        huntRun("last-day", {
          completedAt: localInstant(2026, 8, 9, 23),
        }),
        huntRun("before-range", {
          completedAt: localInstant(2026, 8, 2, 23),
        }),
        huntRun("after-range", {
          completedAt: localInstant(2026, 8, 10, 0),
        }),
        huntRun("updated-fallback", {
          completedAt: null,
          updatedAt: localInstant(2026, 8, 4),
          startedAt: localInstant(2026, 7, 1),
        }),
        huntRun("completed-takes-precedence", {
          completedAt: localInstant(2026, 8, 2),
          updatedAt: localInstant(2026, 8, 5),
        }),
      ],
      7,
      new Date(2026, 7, 9, 8),
    );

    expect(overview.observedRuns).toBe(3);
    expect(overview.daily).toHaveLength(7);
    expect(overview.daily.map((point) => point.dateKey)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(new Date(overview.startAt).getHours()).toBe(0);
    expect(new Date(overview.endAt).getHours()).toBe(0);
  });

  it("keeps the model paired with the provider that won attribution", () => {
    const overview = aggregateAgentUsageOverview(
      [
        huntRun("preferred", {
          preferredProvider: "claude",
          preferredModel: null,
          requestedProvider: "codex",
          requestedModel: "gpt-5.6-sol",
        }),
        huntRun("unknown", {
          preferredModel: "orphan-preferred-model",
          requestedModel: "orphan-requested-model",
        }),
      ],
      7,
      new Date(2026, 7, 9, 8),
    );

    expect(
      overview.models.map(({ provider, model }) => ({ provider, model })),
    ).toEqual([
      { provider: "claude", model: null },
      { provider: "unknown", model: null },
    ]);
  });

  it("does not count backlog or unclaimed queued issues as usage", () => {
    const overview = aggregateAgentUsageOverview(
      [
        huntRun("backlog", {
          status: "backlog",
          claimAttempts: 0,
          completedAt: null,
          executionMetrics: null,
        }),
        huntRun("queued", {
          status: "queued",
          claimAttempts: 0,
          completedAt: null,
          executionMetrics: null,
        }),
        huntRun("retried", {
          status: "queued",
          claimAttempts: 1,
          completedAt: null,
          executionMetrics: null,
        }),
      ],
      7,
      new Date(2026, 7, 9, 8),
    );

    expect(overview.observedRuns).toBe(1);
    expect(overview.reportedRuns).toBe(0);
  });

  it("prefers ledger rows, preserves actual models, and combines cost sources", () => {
    const first = usageRecord();
    const second = usageRecord({
      usageKey: "usage-2",
      scopeId: "turn-2",
      turnId: "turn-2",
      model: "claude-opus-4-6",
      uncachedInputTokens: 30,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 2,
      totalTokens: 50,
    });
    const run = {
      ...huntRun("ledger", {
        preferredProvider: "claude",
        preferredModel: "configured-default",
        executionMetrics: metrics({ totalTokens: 99_999 }),
      }),
      executionProvider: "claude",
      executionModel: "configured-default",
      usageRecords: [first, second],
      costRecords: [costRecord()],
      estimatedCostRecords: [estimatedCostRecord()],
    } satisfies AgentUsageOverviewRun;

    const overview = aggregateAgentUsageOverview(
      [run],
      7,
      new Date(2026, 7, 9, 8),
    );

    expect(overview.totals.totalTokens).toBe(150);
    expect(overview).toMatchObject({
      observedRuns: 1,
      reportedRuns: 1,
      actualModelRuns: 1,
      configuredModelRuns: 0,
      ledgerRuns: 1,
      usageRecords: 2,
      costs: {
        totalUsdTicks: 300,
        providerReportedUsdTicks: 100,
        estimatedUsdTicks: 200,
        costedRuns: 1,
        unpricedRuns: 0,
      },
    });
    expect(
      overview.models.map((row) => ({
        model: row.model,
        source: row.modelSource,
        tokens: row.totalTokens,
        cost: row.totalCostUsdTicks,
      })),
    ).toEqual([
      {
        model: "claude-sonnet-4-6",
        source: "providerReported",
        tokens: 100,
        cost: 100,
      },
      {
        model: "claude-opus-4-6",
        source: "providerReported",
        tokens: 50,
        cost: 200,
      },
    ]);
    expect(overview.models.some((row) => row.model === "configured-default")).toBe(
      false,
    );
  });

  it("labels configured model fallback and keeps aggregate costs unattributed", () => {
    const run = {
      ...huntRun("configured", {
        preferredProvider: "grok",
        preferredModel: "grok-configured",
      }),
      executionProvider: "grok",
      executionModel: "grok-configured",
      usageRecords: [
        usageRecord({
          agentProvider: "grok",
          modelProvider: "xai",
          model: null,
          modelSource: "unknown",
          source: "grok.prompt.usage",
        }),
      ],
      costRecords: [
        costRecord({
          agentProvider: "grok",
          modelProvider: "xai",
          model: null,
          canonicalModel: null,
          modelSource: "unknown",
          usageKey: null,
          source: "grok.usageUpdate.cost",
          amountUsdTicks: 500,
        }),
      ],
      estimatedCostRecords: [],
    } satisfies AgentUsageOverviewRun;

    const overview = aggregateAgentUsageOverview(
      [run],
      7,
      new Date(2026, 7, 9, 8),
    );

    expect(overview.models).toMatchObject([
      {
        provider: "grok",
        model: "grok-configured",
        modelSource: "configuredFallback",
        totalTokens: 100,
        totalCostUsdTicks: 0,
      },
    ]);
    expect(overview).toMatchObject({
      actualModelRuns: 0,
      configuredModelRuns: 1,
      costs: {
        totalUsdTicks: 500,
        unattributedUsdTicks: 500,
      },
    });
  });

  it("zero-fills every day and every provider in the daily series", () => {
    const overview = aggregateAgentUsageOverview(
      [
        {
          ...huntRun("grok", {
            completedAt: localInstant(2026, 8, 7),
            preferredProvider: "grok",
          }),
          usageRecords: [usageRecord({
            agentProvider: "grok",
            modelProvider: "xai",
            model: "grok-4.5",
            uncachedInputTokens: 40,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 2,
            reasoningOutputTokens: 0,
            totalTokens: 42,
            observedAt: localInstant(2026, 8, 7),
          })],
        },
      ],
      7,
      new Date(2026, 7, 9, 8),
    );

    expect(overview.daily).toHaveLength(7);
    for (const point of overview.daily) {
      expect(Object.keys(point.byProvider)).toEqual(providerPointKeys);
    }
    expect(overview.daily[0]).toMatchObject({
      dateKey: "2026-08-03",
      totalTokens: 0,
      runs: 0,
    });
    expect(overview.daily[4]).toMatchObject({
      dateKey: "2026-08-07",
      totalTokens: 42,
      runs: 1,
      byProvider: {
        grok: { tokens: 42, runs: 1 },
        codex: { tokens: 0, runs: 0 },
      },
    });
  });

  it("supports 90 days across daylight-saving calendar boundaries", () => {
    const overview = aggregateAgentUsageOverview(
      [],
      90,
      new Date(2026, 10, 3, 12),
    );

    expect(overview.daily).toHaveLength(90);
    expect(overview.daily[0]?.dateKey).toBe("2026-08-06");
    expect(overview.daily.at(-1)?.dateKey).toBe("2026-11-03");
  });
});
