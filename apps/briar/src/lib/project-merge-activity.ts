export const MERGE_ACTIVITY_HOUR = 60 * 60 * 1_000;
export const MERGE_ACTIVITY_DAY = 24 * MERGE_ACTIVITY_HOUR;

export type MergedPullRequest = {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
};

export type ProjectMergeActivity = {
  repository: string;
  generatedAt: string;
  pullRequests: MergedPullRequest[];
};

export type ProjectMergeActivityLoader = (
  projectId: string,
  signal: AbortSignal,
) => Promise<ProjectMergeActivity>;

// Linear interpolation, including the midpoint for an even-sized median.
function percentile(sorted: readonly number[], fraction: number) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

export function summarizeMergeActivity(activity: ProjectMergeActivity) {
  const now = Date.parse(activity.generatedAt);
  const currentStart = now - MERGE_ACTIVITY_DAY;
  const unique = new Map(activity.pullRequests.map((pr) => [pr.number, pr]));
  const merges = [...unique.values()]
    .map((pr) => ({ ...pr, timestamp: Date.parse(pr.mergedAt) }))
    .filter((pr) => Number.isFinite(pr.timestamp) && pr.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Windows are (start, end], so a merge on a boundary is counted once.
  const rollingCounts = (start: number) => {
    let left = 0;
    let right = 0;
    return Array.from({ length: 14 * 24 + 1 }, (_, index) => {
      const timestamp = start + index * MERGE_ACTIVITY_HOUR;
      while (right < merges.length && merges[right].timestamp <= timestamp) right++;
      while (left < right && merges[left].timestamp <= timestamp - MERGE_ACTIVITY_DAY) left++;
      return { timestamp, count: right - left };
    });
  };
  // The baseline ends before the current 24 hours and needs 16 days of input.
  const baseline = rollingCounts(currentStart - 14 * MERGE_ACTIVITY_DAY);
  const sorted = baseline.map((point) => point.count).sort((a, b) => a - b);
  const current = merges.filter((pr) => pr.timestamp > currentStart);
  const median = percentile(sorted, 0.5);
  const hours = Array.from({ length: 24 }, (_, index) => ({
    timestamp: currentStart + index * MERGE_ACTIVITY_HOUR,
    count: 0,
  }));
  for (const pr of current) {
    const index = Math.min(23, Math.ceil((pr.timestamp - currentStart) / MERGE_ACTIVITY_HOUR) - 1);
    hours[index].count++;
  }
  const reachedCount = sorted.filter((count) => count >= current.length).length;
  return {
    now,
    currentStart,
    current,
    median,
    multiplier: median > 0 ? current.length / median : null,
    mean: sorted.reduce((sum, count) => sum + count, 0) / sorted.length,
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    maximum: sorted[sorted.length - 1],
    reachedCount,
    reachedPercent: (reachedCount / sorted.length) * 100,
    baselineWindows: sorted.length,
    hours,
    busiestHour: hours.reduce((busiest, hour) => hour.count > busiest.count ? hour : busiest),
    timeline: rollingCounts(now - 14 * MERGE_ACTIVITY_DAY),
  };
}
