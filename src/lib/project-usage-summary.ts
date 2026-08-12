import type {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "./agent-execution-metrics";
import type { AgentProvider } from "./agent-provider-contract";
import type { AutoHuntRunStatus } from "./auto-hunt-contract";

type UsageRangeDays = 7 | 30 | 90;

export type ProjectUsageSummary = {
  totalTokens: number;
  trackedDurationMs: number;
  observedRuns: number;
  reportedRuns: number;
  generatedAt: string;
};

export const PROJECT_USAGE_SUMMARY_CACHE_TTL_MS = 5 * 60_000;

type ProjectUsageRecord = Pick<
  AgentExecutionUsageRecord,
  | "uncachedInputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "outputTokens"
  | "totalTokens"
  | "observedAt"
>;

export type ProjectUsageSummaryRun = {
  id: string;
  status: AutoHuntRunStatus;
  executionMetrics?: AgentExecutionMetrics | null;
  claimedBy: string | null;
  claimedAt: string | null;
  claimAttempts: number;
  workerId?: string | null;
  preferredProvider?: AgentProvider | null;
  requestedProvider?: AgentProvider | null;
  executionProvider?: AgentProvider | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  hasUsageLedger?: boolean;
  usageRecords?: ProjectUsageRecord[];
};

const executedStatuses = new Set<AutoHuntRunStatus>([
  "running",
  "paused",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);

const finiteTokenCount = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;

const hasTokenCount = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function runTimestamp(run: ProjectUsageSummaryRun) {
  return Date.parse(run.completedAt ?? run.updatedAt ?? run.startedAt);
}

export function projectUsageSummaryWindow(days: UsageRangeDays, now: number) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

export function projectTrackedDuration(
  runs: readonly ProjectUsageSummaryRun[],
  days: UsageRangeDays,
  now: number,
) {
  const { startAt, endAt } = projectUsageSummaryWindow(days, now);
  return runs.reduce((total, run) => {
    const timestamp = runTimestamp(run);
    if (
      !Number.isFinite(timestamp) ||
      timestamp < startAt ||
      timestamp >= endAt
    ) {
      return total;
    }
    return total + (run.executionMetrics?.durationMs ?? 0);
  }, 0);
}

export function summarizeProjectUsage(
  runs: readonly ProjectUsageSummaryRun[],
  days: UsageRangeDays,
  now: number = Date.now(),
): ProjectUsageSummary {
  const { startAt, endAt } = projectUsageSummaryWindow(days, now);
  const inWindow = (timestamp: number) =>
    Number.isFinite(timestamp) && timestamp >= startAt && timestamp < endAt;
  let totalTokens = 0;
  let observedRuns = 0;
  let reportedRuns = 0;

  for (const run of runs) {
    const timestamp = runTimestamp(run);
    const runIsInWindow = inWindow(timestamp);
    const records = (run.usageRecords ?? []).filter((record) =>
      inWindow(Date.parse(record.observedAt)),
    );
    const hasExecutionEvidence =
      run.executionMetrics != null ||
      run.hasUsageLedger ||
      run.claimedAt !== null ||
      run.claimedBy !== null ||
      run.workerId !== null ||
      run.claimAttempts > 0 ||
      executedStatuses.has(run.status);
    if (!hasExecutionEvidence || (!runIsInWindow && records.length === 0)) {
      continue;
    }

    observedRuns += 1;
    const hasLedger = run.hasUsageLedger ?? records.length > 0;
    if (hasLedger) {
      if (records.length > 0) reportedRuns += 1;
      for (const record of records) {
        totalTokens += hasTokenCount(record.totalTokens)
          ? finiteTokenCount(record.totalTokens)
          : finiteTokenCount(record.uncachedInputTokens) +
            finiteTokenCount(record.cacheReadTokens) +
            finiteTokenCount(record.cacheWriteTokens) +
            finiteTokenCount(record.outputTokens);
      }
      continue;
    }

    if (!runIsInWindow || !run.executionMetrics) continue;
    const metrics = run.executionMetrics;
    const reported = [
      metrics.totalTokens,
      metrics.inputTokens,
      metrics.outputTokens,
      metrics.cacheReadTokens,
      metrics.cacheWriteTokens,
      metrics.reasoningOutputTokens,
    ].some(hasTokenCount);
    if (!reported) continue;
    reportedRuns += 1;
    const provider = run.executionProvider ?? run.requestedProvider ??
      run.preferredProvider;
    totalTokens += hasTokenCount(metrics.totalTokens)
      ? finiteTokenCount(metrics.totalTokens)
      : provider === "claude"
        ? finiteTokenCount(metrics.inputTokens) +
          finiteTokenCount(metrics.outputTokens) +
          finiteTokenCount(metrics.cacheReadTokens) +
          finiteTokenCount(metrics.cacheWriteTokens)
        : finiteTokenCount(metrics.inputTokens) +
          finiteTokenCount(metrics.outputTokens);
  }

  return {
    totalTokens,
    trackedDurationMs: projectTrackedDuration(runs, days, now),
    observedRuns,
    reportedRuns,
    generatedAt: new Date(now).toISOString(),
  };
}

export type ProjectUsageSummaryLoadOptions = {
  force?: boolean;
};

export function createCachedProjectUsageSummaryLoader(
  load: (projectId: string) => Promise<ProjectUsageSummary | null>,
  options: {
    ttlMs?: number;
    now?: () => number;
  } = {},
) {
  const ttlMs = options.ttlMs ?? PROJECT_USAGE_SUMMARY_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<
    string,
    { value: ProjectUsageSummary | null; expiresAt: number }
  >();
  const inFlight = new Map<string, Promise<ProjectUsageSummary | null>>();

  return async (
    projectId: string,
    loadOptions: ProjectUsageSummaryLoadOptions = {},
  ) => {
    const pending = inFlight.get(projectId);
    if (pending) return pending;

    const cached = cache.get(projectId);
    if (!loadOptions.force && cached && cached.expiresAt > now()) {
      return cached.value;
    }

    const request = load(projectId)
      .then((value) => {
        cache.set(projectId, { value, expiresAt: now() + ttlMs });
        return value;
      })
      .finally(() => {
        inFlight.delete(projectId);
      });
    inFlight.set(projectId, request);
    return request;
  };
}
