import type { HuntRun } from "../types";
import {
  agentProviders,
  type AgentProvider,
} from "./project-llm";

export type UsageRangeDays = 7 | 30 | 90;

export type UsageAttribution = AgentProvider | "unknown";

export type UsageTokenTotals = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  uncachedInputTokens: number;
};

export type UsageBreakdownRow = UsageTokenTotals & {
  provider: UsageAttribution;
  model: string | null;
  runs: number;
};

export type UsageDailyProviderPoint = {
  tokens: number;
  runs: number;
};

export type UsageDailyPoint = {
  dateKey: string;
  timestamp: number;
  totalTokens: number;
  runs: number;
  byProvider: Record<UsageAttribution, UsageDailyProviderPoint>;
};

export type AgentUsageOverview = {
  startAt: number;
  endAt: number;
  totals: UsageTokenTotals;
  observedRuns: number;
  reportedRuns: number;
  activeDays: number;
  providers: UsageBreakdownRow[];
  models: UsageBreakdownRow[];
  daily: UsageDailyPoint[];
};

export type AgentUsageOverviewRun = Pick<
  HuntRun,
  | "status"
  | "executionMetrics"
  | "claimedBy"
  | "claimedAt"
  | "claimAttempts"
  | "workerId"
  | "preferredProvider"
  | "preferredModel"
  | "requestedProvider"
  | "requestedModel"
  | "startedAt"
  | "updatedAt"
  | "completedAt"
> & {
  executionProvider?: AgentProvider | null;
  executionModel?: string | null;
};

export const usageAttributions = [
  ...agentProviders,
  "unknown",
] as const satisfies readonly UsageAttribution[];

type RunUsage = UsageTokenTotals & {
  reported: boolean;
};

const emptyTokenTotals = (): UsageTokenTotals => ({
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  uncachedInputTokens: 0,
});

const emptyBreakdownRow = (
  provider: UsageAttribution,
  model: string | null,
): UsageBreakdownRow => ({
  provider,
  model,
  runs: 0,
  ...emptyTokenTotals(),
});

const emptyProviderPoints = () =>
  Object.fromEntries(
    usageAttributions.map((provider) => [provider, { tokens: 0, runs: 0 }]),
  ) as Record<UsageAttribution, UsageDailyProviderPoint>;

const localDateKey = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

const localMidnight = (value: Date | number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const finiteTokenCount = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;

const hasTokenCount = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const resolveRunAttribution = (run: AgentUsageOverviewRun) => {
  if (run.preferredProvider != null) {
    return {
      provider: run.preferredProvider,
      model: run.preferredModel ?? null,
    };
  }
  if (run.requestedProvider != null) {
    return {
      provider: run.requestedProvider,
      model: run.requestedModel ?? null,
    };
  }
  if (run.executionProvider != null) {
    return {
      provider: run.executionProvider,
      model: run.executionModel ?? null,
    };
  }
  return { provider: "unknown" as const, model: null };
};

const runUsage = (
  run: AgentUsageOverviewRun,
  provider: UsageAttribution,
): RunUsage => {
  const metrics = run.executionMetrics;
  if (!metrics) return { ...emptyTokenTotals(), reported: false };

  const reported = [
    metrics.totalTokens,
    metrics.inputTokens,
    metrics.outputTokens,
    metrics.cacheReadTokens,
    metrics.cacheWriteTokens,
    metrics.reasoningOutputTokens,
  ].some(hasTokenCount);
  if (!reported) return { ...emptyTokenTotals(), reported: false };

  const inputTokens = finiteTokenCount(metrics.inputTokens);
  const outputTokens = finiteTokenCount(metrics.outputTokens);
  const cacheReadTokens = finiteTokenCount(metrics.cacheReadTokens);
  const cacheWriteTokens = finiteTokenCount(metrics.cacheWriteTokens);
  const reasoningTokens = finiteTokenCount(metrics.reasoningOutputTokens);

  // Anthropic reports cache reads and writes separately from input tokens.
  // Other providers include cache reads in input tokens.
  const derivedTotal =
    provider === "claude"
      ? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
      : inputTokens + outputTokens;
  const totalTokens = hasTokenCount(metrics.totalTokens)
    ? finiteTokenCount(metrics.totalTokens)
    : derivedTotal;

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    uncachedInputTokens:
      provider === "claude"
        ? inputTokens
        : Math.max(0, inputTokens - cacheReadTokens),
    reported: true,
  };
};

const addUsage = (target: UsageTokenTotals, usage: UsageTokenTotals) => {
  target.totalTokens += usage.totalTokens;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheWriteTokens += usage.cacheWriteTokens;
  target.reasoningTokens += usage.reasoningTokens;
  target.uncachedInputTokens += usage.uncachedInputTokens;
};

const compareBreakdownRows = (
  left: UsageBreakdownRow,
  right: UsageBreakdownRow,
) =>
  right.totalTokens - left.totalTokens ||
  right.runs - left.runs ||
  left.provider.localeCompare(right.provider) ||
  (left.model ?? "").localeCompare(right.model ?? "");

const executedStatuses = new Set([
  "running",
  "paused",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);

const hasExecutionEvidence = (run: AgentUsageOverviewRun) =>
  run.executionMetrics != null ||
  run.claimedAt != null ||
  run.claimedBy != null ||
  run.workerId != null ||
  run.claimAttempts > 0 ||
  executedStatuses.has(run.status);

/**
 * Aggregates runs from the local-calendar window ending on `now`'s date.
 * `startAt` and `endAt` are the local-midnight timestamps of the first and
 * last displayed dates. Runs throughout the entire last date are included.
 */
export function aggregateAgentUsageOverview(
  runs: readonly AgentUsageOverviewRun[],
  days: UsageRangeDays,
  now: Date | number = new Date(),
): AgentUsageOverview {
  const endDate = localMidnight(now);
  if (!Number.isFinite(endDate.getTime())) {
    throw new RangeError("Invalid usage overview date");
  }
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  const exclusiveEndDate = new Date(endDate);
  exclusiveEndDate.setDate(exclusiveEndDate.getDate() + 1);

  const daily: UsageDailyPoint[] = [];
  const dailyByKey = new Map<string, UsageDailyPoint>();
  for (
    const cursor = new Date(startDate);
    cursor.getTime() < exclusiveEndDate.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateKey = localDateKey(cursor);
    const point: UsageDailyPoint = {
      dateKey,
      timestamp: cursor.getTime(),
      totalTokens: 0,
      runs: 0,
      byProvider: emptyProviderPoints(),
    };
    daily.push(point);
    dailyByKey.set(dateKey, point);
  }

  const totals = emptyTokenTotals();
  const providerRows = new Map<UsageAttribution, UsageBreakdownRow>();
  const modelRows = new Map<
    UsageAttribution,
    Map<string | null, UsageBreakdownRow>
  >();
  let observedRuns = 0;
  let reportedRuns = 0;

  for (const run of runs) {
    // Backlog and unclaimed queued issues are planning records, not usage.
    if (!hasExecutionEvidence(run)) continue;
    const observedAt = Date.parse(
      run.completedAt ?? run.updatedAt ?? run.startedAt,
    );
    if (
      !Number.isFinite(observedAt) ||
      observedAt < startDate.getTime() ||
      observedAt >= exclusiveEndDate.getTime()
    ) {
      continue;
    }

    const { provider, model } = resolveRunAttribution(run);
    const usage = runUsage(run, provider);
    observedRuns += 1;
    if (usage.reported) reportedRuns += 1;
    addUsage(totals, usage);

    let providerRow = providerRows.get(provider);
    if (!providerRow) {
      providerRow = emptyBreakdownRow(provider, null);
      providerRows.set(provider, providerRow);
    }
    providerRow.runs += 1;
    addUsage(providerRow, usage);

    let rowsForProvider = modelRows.get(provider);
    if (!rowsForProvider) {
      rowsForProvider = new Map();
      modelRows.set(provider, rowsForProvider);
    }
    let modelRow = rowsForProvider.get(model);
    if (!modelRow) {
      modelRow = emptyBreakdownRow(provider, model);
      rowsForProvider.set(model, modelRow);
    }
    modelRow.runs += 1;
    addUsage(modelRow, usage);

    const runDate = new Date(observedAt);
    const point = dailyByKey.get(localDateKey(runDate));
    if (point) {
      point.totalTokens += usage.totalTokens;
      point.runs += 1;
      point.byProvider[provider].tokens += usage.totalTokens;
      point.byProvider[provider].runs += 1;
    }
  }

  return {
    startAt: startDate.getTime(),
    endAt: endDate.getTime(),
    totals,
    observedRuns,
    reportedRuns,
    activeDays: daily.filter((point) => point.runs > 0).length,
    providers: [...providerRows.values()].sort(compareBreakdownRows),
    models: [...modelRows.values()]
      .flatMap((rows) => [...rows.values()])
      .sort(compareBreakdownRows),
    daily,
  };
}
