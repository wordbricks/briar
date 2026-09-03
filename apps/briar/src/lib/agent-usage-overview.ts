import type {
  AgentUsageCostRecord,
  AgentUsageEstimatedCostRecord,
  AgentUsageRecord,
  AgentUsageRun,
  HuntRun,
} from "../types";
import {
  agentProviders,
  type AgentProvider,
} from "./team-llm";

export type UsageRangeDays = 7 | 30 | 90;

export type UsageAttribution = AgentProvider | "unknown";
export type UsageModelSource = AgentUsageRecord["modelSource"];

export type UsageTokenTotals = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  uncachedInputTokens: number;
};

export type UsageCostTotals = {
  totalUsdTicks: number;
  providerReportedUsdTicks: number;
  estimatedUsdTicks: number;
  unattributedUsdTicks: number;
  costedRuns: number;
  providerReportedRuns: number;
  estimatedRuns: number;
  unpricedRuns: number;
};

export type UsageBreakdownRow = UsageTokenTotals & {
  provider: UsageAttribution;
  model: string | null;
  modelProvider: string | null;
  modelSource: UsageModelSource;
  runs: number;
  totalCostUsdTicks: number;
  providerReportedCostUsdTicks: number;
  estimatedCostUsdTicks: number;
};

export type UsageDailyProviderPoint = {
  tokens: number;
  runs: number;
  costUsdTicks: number;
};

export type UsageDailyPoint = {
  dateKey: string;
  timestamp: number;
  totalTokens: number;
  totalCostUsdTicks: number;
  runs: number;
  byProvider: Record<UsageAttribution, UsageDailyProviderPoint>;
};

export type AgentUsageOverview = {
  startAt: number;
  endAt: number;
  totals: UsageTokenTotals;
  costs: UsageCostTotals;
  observedRuns: number;
  reportedRuns: number;
  actualModelRuns: number;
  configuredModelRuns: number;
  ledgerRuns: number;
  usageRecords: number;
  activeDays: number;
  providers: UsageBreakdownRow[];
  models: UsageBreakdownRow[];
  daily: UsageDailyPoint[];
};

export type AgentUsageOverviewRun = Pick<
  HuntRun,
  | "id"
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
  executionAttempts?: AgentUsageRun["executionAttempts"];
  usageRecords?: AgentUsageRun["usageRecords"];
  costRecords?: AgentUsageRun["costRecords"];
  estimatedCostRecords?: AgentUsageRun["estimatedCostRecords"];
};

export const usageAttributions = [
  ...agentProviders,
  "unknown",
] as const satisfies readonly UsageAttribution[];

type RunUsage = UsageTokenTotals & {
  reported: boolean;
};

type ModelAttribution = {
  provider: UsageAttribution;
  model: string | null;
  modelProvider: string | null;
  modelSource: UsageModelSource;
};

type MutableBreakdownRow = UsageBreakdownRow & {
  runIds: Set<string>;
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
  attribution: ModelAttribution,
): MutableBreakdownRow => ({
  ...attribution,
  runs: 0,
  runIds: new Set(),
  totalCostUsdTicks: 0,
  providerReportedCostUsdTicks: 0,
  estimatedCostUsdTicks: 0,
  ...emptyTokenTotals(),
});

const emptyProviderPoints = () =>
  Object.fromEntries(
    usageAttributions.map((provider) => [
      provider,
      { tokens: 0, runs: 0, costUsdTicks: 0 },
    ]),
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

const normalizedLabel = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const configuredAttribution = (
  run: AgentUsageOverviewRun,
): ModelAttribution => {
  if (run.executionProvider != null) {
    return {
      provider: run.executionProvider,
      model: normalizedLabel(run.executionModel),
      modelProvider: null,
      modelSource: "configuredFallback",
    };
  }
  if (run.preferredProvider != null) {
    return {
      provider: run.preferredProvider,
      model: normalizedLabel(run.preferredModel),
      modelProvider: null,
      modelSource: "configuredFallback",
    };
  }
  if (run.requestedProvider != null) {
    return {
      provider: run.requestedProvider,
      model: normalizedLabel(run.requestedModel),
      modelProvider: null,
      modelSource: "configuredFallback",
    };
  }
  return {
    provider: "unknown",
    model: null,
    modelProvider: null,
    modelSource: "unknown",
  };
};

const ledgerAttribution = (
  run: AgentUsageOverviewRun,
  record: Pick<
    AgentUsageRecord,
    | "agentProvider"
    | "modelProvider"
    | "model"
    | "canonicalModel"
    | "modelSource"
  >,
): ModelAttribution => {
  const model =
    normalizedLabel(record.canonicalModel) ?? normalizedLabel(record.model);
  if (model) {
    return {
      provider: record.agentProvider,
      model,
      modelProvider: normalizedLabel(record.modelProvider),
      modelSource: record.modelSource,
    };
  }
  const fallback = configuredAttribution(run);
  return {
    provider: record.agentProvider,
    model: fallback.model,
    modelProvider: normalizedLabel(record.modelProvider),
    modelSource: fallback.model ? "configuredFallback" : "unknown",
  };
};

const ledgerRecordUsage = (record: AgentUsageRecord): RunUsage => {
  const uncachedInputTokens = finiteTokenCount(record.uncachedInputTokens);
  const cacheReadTokens = finiteTokenCount(record.cacheReadTokens);
  const cacheWriteTokens = finiteTokenCount(record.cacheWriteTokens);
  const outputTokens = finiteTokenCount(record.outputTokens);
  const reasoningTokens = finiteTokenCount(record.reasoningOutputTokens);
  const derivedTotal =
    uncachedInputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;
  return {
    totalTokens: hasTokenCount(record.totalTokens)
      ? finiteTokenCount(record.totalTokens)
      : derivedTotal,
    inputTokens: uncachedInputTokens + cacheReadTokens + cacheWriteTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    uncachedInputTokens,
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

const sourceRank = {
  providerReported: 4,
  providerConfig: 3,
  configuredFallback: 2,
  unknown: 1,
} satisfies Record<UsageModelSource, number>;

const compareBreakdownRows = (
  left: UsageBreakdownRow,
  right: UsageBreakdownRow,
) =>
  right.totalTokens - left.totalTokens ||
  right.totalCostUsdTicks - left.totalCostUsdTicks ||
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
  (run.executionAttempts?.length ?? 0) > 0 ||
  (run.usageRecords?.length ?? 0) > 0 ||
  (run.costRecords?.length ?? 0) > 0 ||
  (run.estimatedCostRecords?.length ?? 0) > 0 ||
  run.claimedAt != null ||
  run.claimedBy != null ||
  run.workerId != null ||
  run.claimAttempts > 0 ||
  executedStatuses.has(run.status);

const parsedTime = (value: string | null | undefined) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const inWindow = (timestamp: number | null, start: number, end: number) =>
  timestamp !== null && timestamp >= start && timestamp < end;

const rowKey = (attribution: ModelAttribution) =>
  JSON.stringify([
    attribution.provider,
    attribution.modelProvider?.toLowerCase() ?? null,
    attribution.model?.toLowerCase() ?? null,
  ]);

const usageIdentity = (record: {
  executionId: string;
  usageKey: string;
}) => `${record.executionId}\u0000${record.usageKey}`;

/** Aggregates immutable usage and cost ledger rows. */
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
  const startAt = startDate.getTime();
  const exclusiveEndAt = exclusiveEndDate.getTime();

  const daily: UsageDailyPoint[] = [];
  const dailyByKey = new Map<string, UsageDailyPoint>();
  const dailyRunIds = new Map<string, Set<string>>();
  const dailyProviderRunIds = new Map<string, Set<string>>();
  for (
    const cursor = new Date(startDate);
    cursor.getTime() < exclusiveEndAt;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateKey = localDateKey(cursor);
    const point: UsageDailyPoint = {
      dateKey,
      timestamp: cursor.getTime(),
      totalTokens: 0,
      totalCostUsdTicks: 0,
      runs: 0,
      byProvider: emptyProviderPoints(),
    };
    daily.push(point);
    dailyByKey.set(dateKey, point);
    dailyRunIds.set(dateKey, new Set());
    for (const provider of usageAttributions) {
      dailyProviderRunIds.set(`${dateKey}\u0000${provider}`, new Set());
    }
  }

  const totals = emptyTokenTotals();
  const providerRows = new Map<UsageAttribution, MutableBreakdownRow>();
  const modelRows = new Map<string, MutableBreakdownRow>();
  const observedRunIds = new Set<string>();
  const reportedRunIds = new Set<string>();
  const actualModelRunIds = new Set<string>();
  const configuredModelRunIds = new Set<string>();
  const providerCostRunIds = new Set<string>();
  const estimatedCostRunIds = new Set<string>();
  const costedRunIds = new Set<string>();
  let providerReportedUsdTicks = 0;
  let estimatedUsdTicks = 0;
  let unattributedUsdTicks = 0;
  let ledgerRuns = 0;
  let usageRecords = 0;

  const getProviderRow = (provider: UsageAttribution) => {
    let row = providerRows.get(provider);
    if (!row) {
      row = emptyBreakdownRow({
        provider,
        model: null,
        modelProvider: null,
        modelSource: "unknown",
      });
      providerRows.set(provider, row);
    }
    return row;
  };

  const getModelRow = (attribution: ModelAttribution) => {
    const key = rowKey(attribution);
    let row = modelRows.get(key);
    if (!row) {
      row = emptyBreakdownRow(attribution);
      modelRows.set(key, row);
    } else if (sourceRank[attribution.modelSource] > sourceRank[row.modelSource]) {
      row.modelSource = attribution.modelSource;
    }
    return row;
  };

  const addRunToRow = (row: MutableBreakdownRow, runId: string) => {
    row.runIds.add(runId);
  };

  const addRunToDay = (
    timestamp: number,
    runId: string,
    providers: ReadonlySet<UsageAttribution>,
  ) => {
    const dateKey = localDateKey(new Date(timestamp));
    const point = dailyByKey.get(dateKey);
    if (!point) return;
    dailyRunIds.get(dateKey)?.add(runId);
    for (const provider of providers) {
      dailyProviderRunIds
        .get(`${dateKey}\u0000${provider}`)
        ?.add(runId);
    }
  };

  const addCost = (
    run: AgentUsageOverviewRun,
    record: AgentUsageCostRecord | AgentUsageEstimatedCostRecord,
    attribution: ModelAttribution | null,
    providerReported: boolean,
  ) => {
    const amount = record.amountUsdTicks;
    if (providerReported) {
      providerReportedUsdTicks += amount;
      providerCostRunIds.add(run.id);
    } else {
      estimatedUsdTicks += amount;
      estimatedCostRunIds.add(run.id);
    }
    costedRunIds.add(run.id);

    const providerRow = getProviderRow(record.agentProvider);
    addRunToRow(providerRow, run.id);
    providerRow.totalCostUsdTicks += amount;
    if (providerReported) providerRow.providerReportedCostUsdTicks += amount;
    else providerRow.estimatedCostUsdTicks += amount;

    if (attribution) {
      const modelRow = getModelRow(attribution);
      addRunToRow(modelRow, run.id);
      modelRow.totalCostUsdTicks += amount;
      if (providerReported) modelRow.providerReportedCostUsdTicks += amount;
      else modelRow.estimatedCostUsdTicks += amount;
    } else {
      unattributedUsdTicks += amount;
    }

    const timestamp = parsedTime(record.observedAt);
    if (inWindow(timestamp, startAt, exclusiveEndAt)) {
      const point = dailyByKey.get(localDateKey(new Date(timestamp!)));
      if (point) {
        point.totalCostUsdTicks += amount;
        point.byProvider[record.agentProvider].costUsdTicks += amount;
      }
    }
  };

  for (const run of runs) {
    if (!hasExecutionEvidence(run)) continue;
    const runTimestamp = parsedTime(
      run.completedAt ?? run.updatedAt ?? run.startedAt,
    );
    const allUsageRecords = run.usageRecords ?? [];
    const windowUsageRecords = allUsageRecords.filter((record) =>
      inWindow(parsedTime(record.observedAt), startAt, exclusiveEndAt),
    );
    const windowCostRecords = (run.costRecords ?? []).filter((record) =>
      inWindow(parsedTime(record.observedAt), startAt, exclusiveEndAt),
    );
    const windowEstimatedCosts = (run.estimatedCostRecords ?? []).filter(
      (record) =>
        inWindow(parsedTime(record.observedAt), startAt, exclusiveEndAt),
    );
    const eventTimestamps = [
      ...windowUsageRecords.map((record) => parsedTime(record.observedAt)),
      ...windowCostRecords.map((record) => parsedTime(record.observedAt)),
      ...windowEstimatedCosts.map((record) => parsedTime(record.observedAt)),
    ].filter((timestamp): timestamp is number => timestamp !== null);
    const runIsInWindow = inWindow(runTimestamp, startAt, exclusiveEndAt);
    if (!runIsInWindow && eventTimestamps.length === 0) continue;

    observedRunIds.add(run.id);
    const runProviders = new Set<UsageAttribution>();
    if (allUsageRecords.length > 0) {
      ledgerRuns += 1;
      if (windowUsageRecords.length > 0) reportedRunIds.add(run.id);
      usageRecords += windowUsageRecords.length;
      for (const record of windowUsageRecords) {
        const attribution = ledgerAttribution(run, record);
        const usage = ledgerRecordUsage(record);
        runProviders.add(attribution.provider);
        if (
          attribution.model &&
          attribution.modelSource === "providerReported"
        ) {
          actualModelRunIds.add(run.id);
        } else if (attribution.model) {
          configuredModelRunIds.add(run.id);
        }

        addUsage(totals, usage);
        const providerRow = getProviderRow(attribution.provider);
        const modelRow = getModelRow(attribution);
        addRunToRow(providerRow, run.id);
        addRunToRow(modelRow, run.id);
        addUsage(providerRow, usage);
        addUsage(modelRow, usage);

        const timestamp = parsedTime(record.observedAt);
        if (timestamp !== null) {
          const point = dailyByKey.get(localDateKey(new Date(timestamp)));
          if (point) {
            point.totalTokens += usage.totalTokens;
            point.byProvider[attribution.provider].tokens += usage.totalTokens;
          }
        }
      }
    }

    const usageByIdentity = new Map(
      allUsageRecords.map((record) => [usageIdentity(record), record]),
    );
    for (const record of windowCostRecords) {
      runProviders.add(record.agentProvider);
      const linkedUsage = record.usageKey
        ? usageByIdentity.get(
            usageIdentity({
              executionId: record.executionId,
              usageKey: record.usageKey,
            }),
          )
        : undefined;
      const hasCostModel = Boolean(
        normalizedLabel(record.canonicalModel) ?? normalizedLabel(record.model),
      );
      addCost(
        run,
        record,
        linkedUsage
          ? ledgerAttribution(run, linkedUsage)
          : hasCostModel
            ? ledgerAttribution(run, record)
            : null,
        true,
      );
    }
    for (const record of windowEstimatedCosts) {
      runProviders.add(record.agentProvider);
      addCost(run, record, ledgerAttribution(run, record), false);
    }

    if (runProviders.size === 0) {
      const fallback = configuredAttribution(run);
      runProviders.add(fallback.provider);
      const providerRow = getProviderRow(fallback.provider);
      const modelRow = getModelRow(fallback);
      addRunToRow(providerRow, run.id);
      addRunToRow(modelRow, run.id);
    }
    const dailyTimestamp = runIsInWindow
      ? runTimestamp!
      : Math.min(...eventTimestamps);
    addRunToDay(dailyTimestamp, run.id, runProviders);
  }

  for (const row of [...providerRows.values(), ...modelRows.values()]) {
    row.runs = row.runIds.size;
  }
  for (const point of daily) {
    point.runs = dailyRunIds.get(point.dateKey)?.size ?? 0;
    for (const provider of usageAttributions) {
      point.byProvider[provider].runs =
        dailyProviderRunIds.get(`${point.dateKey}\u0000${provider}`)?.size ?? 0;
    }
  }

  const costedReportedRuns = [...reportedRunIds].filter((runId) =>
    costedRunIds.has(runId),
  ).length;
  const cleanRow = ({ runIds: _runIds, ...row }: MutableBreakdownRow) => row;
  return {
    startAt,
    endAt: endDate.getTime(),
    totals,
    costs: {
      totalUsdTicks: providerReportedUsdTicks + estimatedUsdTicks,
      providerReportedUsdTicks,
      estimatedUsdTicks,
      unattributedUsdTicks,
      costedRuns: costedReportedRuns,
      providerReportedRuns: providerCostRunIds.size,
      estimatedRuns: estimatedCostRunIds.size,
      unpricedRuns: reportedRunIds.size - costedReportedRuns,
    },
    observedRuns: observedRunIds.size,
    reportedRuns: reportedRunIds.size,
    actualModelRuns: actualModelRunIds.size,
    configuredModelRuns: [...configuredModelRunIds].filter(
      (runId) => !actualModelRunIds.has(runId),
    ).length,
    ledgerRuns,
    usageRecords,
    activeDays: daily.filter((point) => point.runs > 0).length,
    providers: [...providerRows.values()]
      .map(cleanRow)
      .sort(compareBreakdownRows),
    models: [...modelRows.values()].map(cleanRow).sort(compareBreakdownRows),
    daily,
  };
}
