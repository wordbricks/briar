import { describe, expect, it } from "vitest";
import { MERGE_ACTIVITY_DAY as DAY, MERGE_ACTIVITY_HOUR as HOUR, summarizeMergeActivity, type MergedPullRequest } from "./project-merge-activity";

const now = Date.parse("2026-09-03T08:28:00Z");
const pr = (number: number, timestamp: number): MergedPullRequest => ({
  number, title: `PR ${number}`, url: `https://github.com/briar/app/pull/${number}`, mergedAt: new Date(timestamp).toISOString(),
});
const summarize = (pullRequests: MergedPullRequest[]) => summarizeMergeActivity({
  repository: "briar/app", generatedAt: new Date(now).toISOString(), pullRequests,
});

describe("merge activity", () => {
  it("uses all 337 baseline windows, including the earliest full day, and excludes the current day", () => {
    const history = Array.from({ length: 16 * 24 }, (_, i) => pr(i + 1, now - i * HOUR));
    const burst = Array.from({ length: 65 }, (_, i) => pr(1000 + i, now));
    const summary = summarize([...history, ...burst]);
    expect(summary.current).toHaveLength(89);
    expect(summary.baselineWindows).toBe(337);
    expect(summary.mean).toBe(24);
    expect(summary.median).toBe(24);
    expect(summary.p75).toBe(24);
    expect(summary.p90).toBe(24);
    expect(summary.maximum).toBe(24);
    expect(summary.multiplier).toBe(89 / 24);
    expect(summary.reachedCount).toBe(0);
    expect(summary.timeline.at(-1)?.count).toBe(89);
    expect(summary.timeline[0].count).toBe(24);
  });

  it("deduplicates PRs and keeps window and hourly boundaries consistent", () => {
    const latest = pr(1, now);
    const summary = summarize([latest, latest, pr(2, now - DAY), pr(3, now - 23 * HOUR), pr(4, now + 1)]);
    expect(summary.current.map((item) => item.number)).toEqual([3, 1]);
    expect(summary.hours[0].count).toBe(1);
    expect(summary.hours[23].count).toBe(1);
    expect(summary.hours.reduce((sum, hour) => sum + hour.count, 0)).toBe(2);
  });

  it("handles no history and no merges without infinite rates or invalid scales", () => {
    const empty = summarize([]);
    expect(empty.current).toEqual([]);
    expect(empty.mean).toBe(0);
    expect(empty.multiplier).toBeNull();
    expect(empty.reachedPercent).toBe(100);
    const firstMerge = summarize([pr(1, now)]);
    expect(firstMerge.multiplier).toBeNull();
    expect(firstMerge.reachedPercent).toBe(0);
  });

  it("matches direct window counts for uneven history", () => {
    const history = Array.from({ length: 570 }, (_, i) => pr(i + 1, now - ((i * 7919) % (16 * 24 * 60)) * 60_000));
    const summary = summarize(history);
    const counts = Array.from({ length: 337 }, (_, i) => {
      const end = now - 15 * DAY + i * HOUR;
      return history.filter((item) => Date.parse(item.mergedAt) > end - DAY && Date.parse(item.mergedAt) <= end).length;
    }).sort((a, b) => a - b);
    expect(summary.median).toBe(counts[168]);
    expect(summary.p75).toBe(counts[252]);
    expect(summary.p90).toBeCloseTo(counts[302] + (counts[303] - counts[302]) * .4);
    expect(summary.maximum).toBe(counts.at(-1));
  });
});
