import { describe, expect, it } from "vitest";
import type { AgentUsageRun, HuntRun } from "../types";
import type { AgentExecutionMetrics } from "./agent-execution-metrics";
import {
  aggregateAgentUsageOverview,
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
  "grok",
  "opencode",
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

  it("aggregates tokens, provider-aware cache math, and sorted breakdowns", () => {
    const overview = aggregateAgentUsageOverview(
      [
        huntRun("codex", {
          preferredProvider: "codex",
          preferredModel: "gpt-5.6-sol",
          executionMetrics: metrics({
            totalTokens: 120,
            inputTokens: 80,
            outputTokens: 20,
            cacheReadTokens: 50,
            reasoningOutputTokens: 5,
          }),
        }),
        huntRun("claude", {
          requestedProvider: "claude",
          requestedModel: "opus",
          executionMetrics: metrics({
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 70,
            cacheWriteTokens: 20,
            reasoningOutputTokens: 2,
          }),
        }),
        huntRun("unknown", {
          requestedModel: "must-not-be-attributed",
          executionMetrics: metrics({
            totalTokens: 30,
            inputTokens: 25,
            outputTokens: 5,
            cacheReadTokens: 10,
          }),
        }),
        huntRun("unreported-codex", {
          preferredProvider: "codex",
        }),
      ],
      30,
      new Date(2026, 7, 9, 8),
    );

    expect(overview.totals).toEqual({
      totalTokens: 255,
      inputTokens: 115,
      outputTokens: 30,
      cacheReadTokens: 130,
      cacheWriteTokens: 20,
      reasoningTokens: 7,
      uncachedInputTokens: 55,
    });
    expect(overview.observedRuns).toBe(4);
    expect(overview.reportedRuns).toBe(3);
    expect(overview.activeDays).toBe(1);
    expect(
      overview.providers.map(({ provider, totalTokens, runs }) => ({
        provider,
        totalTokens,
        runs,
      })),
    ).toEqual([
      { provider: "codex", totalTokens: 120, runs: 2 },
      { provider: "claude", totalTokens: 105, runs: 1 },
      { provider: "unknown", totalTokens: 30, runs: 1 },
    ]);
    expect(
      overview.models.map(({ provider, model, totalTokens, runs }) => ({
        provider,
        model,
        totalTokens,
        runs,
      })),
    ).toEqual([
      {
        provider: "codex",
        model: "gpt-5.6-sol",
        totalTokens: 120,
        runs: 1,
      },
      { provider: "claude", model: "opus", totalTokens: 105, runs: 1 },
      { provider: "unknown", model: null, totalTokens: 30, runs: 1 },
      { provider: "codex", model: null, totalTokens: 0, runs: 1 },
    ]);
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

  it("accepts the lightweight API DTO and its resolved attribution", () => {
    const usageRun: AgentUsageRun = {
      id: "usage-run",
      projectId: "project-1",
      status: "completed",
      executionMetrics: metrics({ totalTokens: 42 }),
      claimedBy: "worker",
      claimedAt: localInstant(2026, 8, 9),
      claimAttempts: 1,
      workerId: "worker-1",
      preferredProvider: null,
      preferredModel: null,
      requestedProvider: null,
      requestedModel: null,
      executionProvider: "grok",
      executionModel: "grok-4.5",
      startedAt: localInstant(2026, 8, 9),
      updatedAt: localInstant(2026, 8, 9),
      completedAt: localInstant(2026, 8, 9),
    };

    const overview = aggregateAgentUsageOverview(
      [usageRun],
      7,
      new Date(2026, 7, 9, 8),
    );

    expect(overview.models).toMatchObject([
      { provider: "grok", model: "grok-4.5", totalTokens: 42, runs: 1 },
    ]);
  });

  it("zero-fills every day and every provider in the daily series", () => {
    const overview = aggregateAgentUsageOverview(
      [
        huntRun("grok", {
          completedAt: localInstant(2026, 8, 7),
          preferredProvider: "grok",
          executionMetrics: metrics({ totalTokens: 42 }),
        }),
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
