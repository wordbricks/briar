import type {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "./agent-execution-metrics";
import type { AgentProvider } from "./agent-provider";
import type { AutoHuntRunStatus } from "./auto-hunt-contract";

export type TeamUsagePeriod = "day" | "week" | "month";

export type TeamUsageDateRange = {
  from: string;
  to: string;
};

export const PROJECT_USAGE_MAX_TIMELINE_BUCKETS = 400;

export type TeamUsageTimelinePoint = {
  startAt: string;
  completedIssues: number;
  totalTokens: number;
};

export type TeamUsageBreakdownItem = {
  id: string | null;
  name: string | null;
  issues: number;
};

export type TeamUsageSummary = {
  period: TeamUsagePeriod;
  rangeStart: string;
  rangeEnd: string;
  totalTokens: number;
  trackedDurationMs: number;
  observedRuns: number;
  reportedRuns: number;
  completedIssues: number;
  timeline: TeamUsageTimelinePoint[];
  issueCreators: TeamUsageBreakdownItem[];
  agents: TeamUsageBreakdownItem[];
  generatedAt: string;
};

export const PROJECT_USAGE_SUMMARY_CACHE_TTL_MS = 5 * 60_000;

type TeamUsageRecord = Pick<
  AgentExecutionUsageRecord,
  | "uncachedInputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "outputTokens"
  | "totalTokens"
  | "observedAt"
>;

export type TeamUsageSummaryRun = {
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
  sourceCreatedAt?: string | null;
  createdByUserId?: string | null;
  createdByName?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  usageRecords?: TeamUsageRecord[];
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

function runTimestamp(run: TeamUsageSummaryRun) {
  return Date.parse(run.completedAt ?? run.updatedAt ?? run.startedAt);
}

const startOfUtcDay = (now: number) => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const utcDateKey = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

const parseUtcDateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && utcDateKey(timestamp) === value
    ? timestamp
    : null;
};

export function defaultTeamUsageDateRange(now: number = Date.now()) {
  const to = startOfUtcDay(now);
  return {
    from: utcDateKey(to - 13 * 86_400_000),
    to: utcDateKey(to),
  } satisfies TeamUsageDateRange;
}

export function isTeamUsageDateRange(
  range: TeamUsageDateRange,
  period?: TeamUsagePeriod,
) {
  const from = parseUtcDateKey(range.from);
  const to = parseUtcDateKey(range.to);
  if (from === null || to === null || from > to) return false;
  return period === undefined || hasAllowedBucketCount(
    period,
    from,
    to + 86_400_000,
  );
}

function customTeamUsageWindow(range: TeamUsageDateRange) {
  const startAt = parseUtcDateKey(range.from);
  const inclusiveEndAt = parseUtcDateKey(range.to);
  if (startAt === null || inclusiveEndAt === null || startAt > inclusiveEndAt) {
    throw new RangeError("Project usage date range is invalid");
  }
  return { startAt, endAt: inclusiveEndAt + 86_400_000 };
}

export function teamUsageSummaryWindow(
  period: TeamUsagePeriod,
  now: number,
  range?: TeamUsageDateRange,
) {
  if (range) {
    const window = customTeamUsageWindow(range);
    if (!hasAllowedBucketCount(period, window.startAt, window.endAt)) {
      throw new RangeError("Project usage date range has too many buckets");
    }
    return window;
  }
  const day = startOfUtcDay(now);
  if (period === "day") {
    return { startAt: day - 13 * 86_400_000, endAt: day + 86_400_000 };
  }
  if (period === "week") {
    const weekday = new Date(day).getUTCDay();
    const week = day - ((weekday + 6) % 7) * 86_400_000;
    return { startAt: week - 11 * 7 * 86_400_000, endAt: week + 7 * 86_400_000 };
  }
  const date = new Date(day);
  return {
    startAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11, 1),
    endAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  };
}

function nextBucketStart(period: TeamUsagePeriod, startAt: number) {
  if (period === "day") return startAt + 86_400_000;
  if (period === "week") return startAt + 7 * 86_400_000;
  const start = new Date(startAt);
  return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
}

function hasAllowedBucketCount(
  period: TeamUsagePeriod,
  startAt: number,
  endAt: number,
) {
  let count = 0;
  for (let current = startAt; current < endAt; current = nextBucketStart(period, current)) {
    count += 1;
    if (count > PROJECT_USAGE_MAX_TIMELINE_BUCKETS) return false;
  }
  return true;
}

function bucketStarts(
  period: TeamUsagePeriod,
  startAt: number,
  endAt: number,
) {
  const starts: number[] = [];
  for (let current = startAt; current < endAt; current = nextBucketStart(period, current)) {
    starts.push(current);
  }
  return starts;
}

function bucketIndex(
  starts: readonly number[],
  timestamp: number,
  endAt: number,
) {
  if (!Number.isFinite(timestamp) || timestamp < starts[0] || timestamp >= endAt) {
    return -1;
  }
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    if (timestamp >= starts[index]) return index;
  }
  return -1;
}

export function teamTrackedDuration(
  runs: readonly TeamUsageSummaryRun[],
  period: TeamUsagePeriod,
  now: number,
  range?: TeamUsageDateRange,
) {
  const { startAt, endAt } = teamUsageSummaryWindow(period, now, range);
  return runs.reduce((total, run) => {
    const timestamp = runTimestamp(run);
    if (!Number.isFinite(timestamp) || timestamp < startAt || timestamp >= endAt) {
      return total;
    }
    return total + (run.executionMetrics?.durationMs ?? 0);
  }, 0);
}

function addBreakdown(
  target: Map<string, TeamUsageBreakdownItem>,
  id: string | null | undefined,
  name: string | null | undefined,
) {
  const key = id ? `id:${id}` : `name:${name ?? ""}`;
  const current = target.get(key);
  if (current) current.issues += 1;
  else target.set(key, { id: id ?? null, name: name ?? null, issues: 1 });
}

const sortedBreakdown = (items: Map<string, TeamUsageBreakdownItem>) =>
  [...items.values()].sort((left, right) =>
    right.issues - left.issues ||
    (left.name ?? "").localeCompare(right.name ?? "") ||
    (left.id ?? "").localeCompare(right.id ?? "")
  );

export function summarizeTeamUsage(
  runs: readonly TeamUsageSummaryRun[],
  period: TeamUsagePeriod,
  now: number = Date.now(),
  range?: TeamUsageDateRange,
): TeamUsageSummary {
  const { startAt, endAt } = teamUsageSummaryWindow(period, now, range);
  const starts = bucketStarts(period, startAt, endAt);
  const timeline = starts.map((start) => ({
    startAt: new Date(start).toISOString(),
    completedIssues: 0,
    totalTokens: 0,
  }));
  const creators = new Map<string, TeamUsageBreakdownItem>();
  const agents = new Map<string, TeamUsageBreakdownItem>();
  const inWindow = (timestamp: number) =>
    Number.isFinite(timestamp) && timestamp >= startAt && timestamp < endAt;
  let totalTokens = 0;
  let observedRuns = 0;
  let reportedRuns = 0;
  let completedIssues = 0;

  for (const run of runs) {
    const createdAt = Date.parse(run.sourceCreatedAt ?? run.startedAt);
    if (inWindow(createdAt)) {
      addBreakdown(creators, run.createdByUserId, run.createdByName);
    }

    const completedAt = Date.parse(run.completedAt ?? "");
    if (run.status === "completed" && inWindow(completedAt)) {
      completedIssues += 1;
      const index = bucketIndex(starts, completedAt, endAt);
      if (index >= 0) timeline[index].completedIssues += 1;
      addBreakdown(agents, run.agentId ?? run.workerId, run.agentName ?? run.claimedBy);
    }

    const timestamp = runTimestamp(run);
    const runIsInWindow = inWindow(timestamp);
    const records = (run.usageRecords ?? []).filter((record) =>
      inWindow(Date.parse(record.observedAt)),
    );
    const hasExecutionEvidence =
      run.executionMetrics != null ||
      run.claimedAt !== null || run.claimedBy !== null || run.workerId !== null ||
      run.claimAttempts > 0 || executedStatuses.has(run.status);
    if (!hasExecutionEvidence || (!runIsInWindow && records.length === 0)) continue;

    observedRuns += 1;
    if (records.length > 0) reportedRuns += 1;
    for (const record of records) {
      const tokens = hasTokenCount(record.totalTokens)
        ? finiteTokenCount(record.totalTokens)
        : finiteTokenCount(record.uncachedInputTokens) +
          finiteTokenCount(record.cacheReadTokens) +
          finiteTokenCount(record.cacheWriteTokens) +
          finiteTokenCount(record.outputTokens);
      totalTokens += tokens;
      const index = bucketIndex(starts, Date.parse(record.observedAt), endAt);
      if (index >= 0) timeline[index].totalTokens += tokens;
    }
  }

  return {
    period,
    rangeStart: new Date(startAt).toISOString(),
    rangeEnd: new Date(endAt).toISOString(),
    totalTokens,
    trackedDurationMs: teamTrackedDuration(runs, period, now, range),
    observedRuns,
    reportedRuns,
    completedIssues,
    timeline,
    issueCreators: sortedBreakdown(creators),
    agents: sortedBreakdown(agents),
    generatedAt: new Date(now).toISOString(),
  };
}

export type TeamUsageSummaryLoadOptions = {
  force?: boolean;
  range?: TeamUsageDateRange;
};

export function createCachedTeamUsageSummaryLoader(
  load: (
    projectId: string,
    period: TeamUsagePeriod,
    range?: TeamUsageDateRange,
  ) => Promise<TeamUsageSummary | null>,
  options: { ttlMs?: number; now?: () => number } = {},
) {
  const ttlMs = options.ttlMs ?? PROJECT_USAGE_SUMMARY_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: TeamUsageSummary | null; expiresAt: number }>();
  const inFlight = new Map<string, Promise<TeamUsageSummary | null>>();

  return async (
    projectId: string,
    period: TeamUsagePeriod,
    loadOptions: TeamUsageSummaryLoadOptions = {},
  ) => {
    const range = loadOptions.range;
    const key = `${projectId}:${period}:${range?.from ?? "default"}:${range?.to ?? "default"}`;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const cached = cache.get(key);
    if (!loadOptions.force && cached && cached.expiresAt > now()) return cached.value;
    const request = load(projectId, period, range)
      .then((value) => {
        cache.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };
}
