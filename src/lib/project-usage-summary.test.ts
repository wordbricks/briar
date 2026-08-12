import { describe, expect, it, vi } from "vitest";

import {
  createCachedProjectUsageSummaryLoader,
  summarizeProjectUsage,
  type ProjectUsageSummaryRun,
} from "./project-usage-summary";

const run = (
  id: string,
  completedAt: string,
  overrides: Partial<ProjectUsageSummaryRun> = {},
): ProjectUsageSummaryRun => ({
  id,
  status: "completed",
  executionMetrics: {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: null,
    reasoningOutputTokens: 5,
    totalTokens: 120,
    durationMs: 1_000,
  },
  claimedBy: "worker",
  claimedAt: completedAt,
  claimAttempts: 1,
  workerId: "worker-1",
  preferredProvider: "codex",
  requestedProvider: null,
  startedAt: completedAt,
  updatedAt: completedAt,
  completedAt,
  ...overrides,
});

describe("project usage summary", () => {
  it("uses ledger rows without falling back to a lifetime metric total", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const summary = summarizeProjectUsage([
      run("legacy", "2026-08-10T12:00:00.000Z"),
      run("ledger", "2026-08-10T12:00:00.000Z", {
        hasUsageLedger: true,
        usageRecords: [],
      }),
    ], 30, now);

    expect(summary).toMatchObject({
      totalTokens: 120,
      trackedDurationMs: 2_000,
      observedRuns: 2,
      reportedRuns: 1,
    });
  });

  it("does not count an unexecuted run with omitted metrics", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const summary = summarizeProjectUsage([
      run("queued", "2026-08-10T12:00:00.000Z", {
        status: "queued",
        executionMetrics: undefined,
        claimedBy: null,
        claimedAt: null,
        claimAttempts: 0,
        workerId: null,
      }),
    ], 30, now);

    expect(summary).toMatchObject({
      totalTokens: 0,
      trackedDurationMs: 0,
      observedRuns: 0,
      reportedRuns: 0,
    });
  });

  it("reuses cached and in-flight requests until forced or expired", async () => {
    let currentTime = 1_000;
    const load = vi.fn(async (projectId: string) => ({
      totalTokens: projectId === "p1" ? 10 : 20,
      trackedDurationMs: 100,
      observedRuns: 1,
      reportedRuns: 1,
      generatedAt: "2026-08-12T00:00:00.000Z",
    }));
    const cachedLoad = createCachedProjectUsageSummaryLoader(load, {
      ttlMs: 500,
      now: () => currentTime,
    });

    const [first, duplicate] = await Promise.all([
      cachedLoad("p1"),
      cachedLoad("p1"),
    ]);
    expect(first).toEqual(duplicate);
    expect(load).toHaveBeenCalledOnce();

    await cachedLoad("p1");
    expect(load).toHaveBeenCalledOnce();
    await cachedLoad("p1", { force: true });
    expect(load).toHaveBeenCalledTimes(2);

    currentTime += 501;
    await cachedLoad("p1");
    await cachedLoad("p2");
    expect(load).toHaveBeenCalledTimes(4);
  });
});
