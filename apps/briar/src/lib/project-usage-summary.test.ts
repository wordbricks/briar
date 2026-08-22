import { describe, expect, it, vi } from "vitest";

import {
  createCachedProjectUsageSummaryLoader,
  projectUsageSummaryWindow,
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
  it("uses complete UTC day, Monday week, and calendar month buckets", () => {
    const now = Date.parse("2026-01-01T23:30:00.000Z");

    expect(projectUsageSummaryWindow("day", now)).toEqual({
      startAt: Date.parse("2025-12-19T00:00:00.000Z"),
      endAt: Date.parse("2026-01-02T00:00:00.000Z"),
    });
    expect(projectUsageSummaryWindow("week", now)).toEqual({
      startAt: Date.parse("2025-10-13T00:00:00.000Z"),
      endAt: Date.parse("2026-01-05T00:00:00.000Z"),
    });
    expect(projectUsageSummaryWindow("month", now)).toEqual({
      startAt: Date.parse("2025-02-01T00:00:00.000Z"),
      endAt: Date.parse("2026-02-01T00:00:00.000Z"),
    });
  });

  it("uses ledger rows without falling back to a lifetime metric total", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const summary = summarizeProjectUsage([
      run("legacy", "2026-08-10T12:00:00.000Z"),
      run("ledger", "2026-08-10T12:00:00.000Z", {
        hasUsageLedger: true,
        usageRecords: [],
      }),
    ], "day", now);

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
    ], "day", now);

    expect(summary).toMatchObject({
      totalTokens: 0,
      trackedDurationMs: 0,
      observedRuns: 0,
      reportedRuns: 0,
    });
  });

  it("reuses cached and in-flight requests until forced or expired", async () => {
    let currentTime = 1_000;
    const load = vi.fn(async (projectId: string, period: "day" | "week" | "month") => ({
      period,
      rangeStart: "2026-07-30T00:00:00.000Z",
      rangeEnd: "2026-08-13T00:00:00.000Z",
      totalTokens: projectId === "p1" ? 10 : 20,
      trackedDurationMs: 100,
      observedRuns: 1,
      reportedRuns: 1,
      completedIssues: 1,
      timeline: [],
      issueCreators: [],
      agents: [],
      generatedAt: "2026-08-12T00:00:00.000Z",
    }));
    const cachedLoad = createCachedProjectUsageSummaryLoader(load, {
      ttlMs: 500,
      now: () => currentTime,
    });

    const [first, duplicate] = await Promise.all([
      cachedLoad("p1", "day"),
      cachedLoad("p1", "day"),
    ]);
    expect(first).toEqual(duplicate);
    expect(load).toHaveBeenCalledOnce();

    await cachedLoad("p1", "day");
    expect(load).toHaveBeenCalledOnce();
    await cachedLoad("p1", "day", { force: true });
    expect(load).toHaveBeenCalledTimes(2);

    currentTime += 501;
    await cachedLoad("p1", "day");
    await cachedLoad("p2", "day");
    expect(load).toHaveBeenCalledTimes(4);

    await cachedLoad("p1", "week");
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("buckets completed issues and tokens while preserving creator and agent attribution", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const summary = summarizeProjectUsage([
      run("first", "2026-08-10T12:00:00.000Z", {
        sourceCreatedAt: "2026-08-09T12:00:00.000Z",
        createdByUserId: "user-1",
        createdByName: "Ada",
        agentId: "agent-1",
        agentName: "Mango",
        hasUsageLedger: true,
        usageRecords: [{
          uncachedInputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          outputTokens: null,
          totalTokens: 75,
          observedAt: "2026-08-10T12:00:00.000Z",
        }],
      }),
      run("second", "2026-08-10T18:00:00.000Z", {
        sourceCreatedAt: "2026-08-10T09:00:00.000Z",
        createdByUserId: "user-1",
        createdByName: "Ada",
        agentId: "agent-2",
        agentName: "Kiwi",
      }),
    ], "day", now);

    expect(summary).toMatchObject({
      period: "day",
      rangeStart: "2026-07-30T00:00:00.000Z",
      rangeEnd: "2026-08-13T00:00:00.000Z",
      totalTokens: 195,
      completedIssues: 2,
      issueCreators: [{ id: "user-1", name: "Ada", issues: 2 }],
      agents: [
        { id: "agent-2", name: "Kiwi", issues: 1 },
        { id: "agent-1", name: "Mango", issues: 1 },
      ],
    });
    expect(summary.timeline.at(-3)).toMatchObject({
      startAt: "2026-08-10T00:00:00.000Z",
      completedIssues: 2,
      totalTokens: 195,
    });
  });
});
