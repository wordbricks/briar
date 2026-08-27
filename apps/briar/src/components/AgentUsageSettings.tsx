import { CircleDashed, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "./ui/spinner";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  SettingsAlert,
  SettingsIconButton,
  SettingsSection,
} from "@/components/settings";
import { useI18n } from "../i18n";
import {
  clearAgentUsageHistory,
  formatUsageDuration,
  formatUsageWindowLabel,
  loadAgentUsage,
  readAgentUsageHistory,
  recordAgentUsageSnapshot,
  tightestUsageWindow,
  quotaUsageProviderLabel,
  quotaUsageProviders,
  type AgentUsageProvider,
  type AgentUsageSnapshot,
} from "../lib/agent-usage";
import {
  aggregateAgentUsageOverview,
  type UsageAttribution,
  type UsageModelSource,
  type UsageRangeDays,
} from "../lib/agent-usage-overview";
import { AGENT_EXECUTION_USD_TICKS_PER_DOLLAR } from "../lib/agent-execution-cost";
import { LITELLM_MAIN_PRICING_SOURCE } from "../lib/agent-usage-pricing";
import type { AgentUsagePricing, AgentUsageReport } from "../types";
import { AgentProviderIcon } from "./AgentIcons";
import { cn } from "../lib/utils";

const rangeOptions = [7, 30, 90] as const satisfies readonly UsageRangeDays[];

const providerColors = {
  claude: "#d97757",
  codex: "var(--foreground)",
  cursor: "var(--foreground)",
  grok: "#7765b5",
  agy: "#4285f4",
  opencode: "#4f8a70",
  openrouter: "#6d5bd0",
  unknown: "var(--muted-foreground)",
} satisfies Record<UsageAttribution, string>;

type ChartMetric = "tokens" | "cost" | "runs";
type BreakdownMode = "model" | "day";

function providerName(provider: UsageAttribution) {
  if (provider === "unknown") return null;
  return quotaUsageProviderLabel(provider);
}

function formatCompact(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

function formatPercent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(Math.max(0, Math.min(1, value)));
}

function formatUsdTicks(value: number, locale: string, compact = false) {
  const dollars = value / AGENT_EXECUTION_USD_TICKS_PER_DOLLAR;
  const magnitude = Math.abs(dollars);
  const minimumFractionDigits =
    magnitude === 0 || magnitude >= 1
      ? 2
      : magnitude >= 0.01
        ? 4
        : magnitude >= 0.0001
          ? 6
          : 8;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: compact && magnitude >= 10_000 ? "compact" : "standard",
    minimumFractionDigits,
    maximumFractionDigits: magnitude >= 1 ? 2 : 10,
  }).format(dollars);
}

function chartValue(
  point: ReturnType<
    typeof aggregateAgentUsageOverview
  >["daily"][number]["byProvider"][UsageAttribution],
  metric: ChartMetric,
) {
  return metric === "cost" ? point.costUsdTicks : point[metric];
}

function modelSourceLabel(
  source: UsageModelSource,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (source === "providerReported") return t("usage.modelSourceReported");
  if (source === "providerConfig") return t("usage.modelSourceProviderConfig");
  if (source === "configuredFallback" || source === "legacyConfigured") {
    return t("usage.modelSourceConfigured");
  }
  return t("usage.modelSourceUnknown");
}

function pricingStatusLabel(
  pricing: AgentUsagePricing,
  locale: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (pricing.status === "unavailable") return t("usage.pricingUnavailable");
  const fetchedAtTimestamp = pricing.fetchedAt
    ? Date.parse(pricing.fetchedAt)
    : Number.NaN;
  const fetchedAt = Number.isFinite(fetchedAtTimestamp)
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(fetchedAtTimestamp)
    : t("usage.pricingTimeUnknown");
  return t(
    pricing.status === "live" ? "usage.pricingLive" : "usage.pricingCached",
    { time: fetchedAt },
  );
}

function formatDateRange(startAt: number, endAt: number, locale: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const sameYear = start.getFullYear() === end.getFullYear();
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
  };
  if (!sameYear) options.year = "numeric";
  const formatter = new Intl.DateTimeFormat(locale, options);
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function ProviderMark({ provider }: { provider: UsageAttribution }) {
  const className = cn(
    "grid size-5 shrink-0 place-items-center rounded-md border border-border bg-card text-foreground",
    provider === "claude" && "text-[#d97757]",
    provider === "grok" && "text-[#7765b5]",
    provider === "agy" && "text-[#4285f4]",
    provider === "opencode" && "text-[#4f8a70]",
    provider === "openrouter" && "text-[#6d5bd0]",
    provider === "unknown" && "text-muted-foreground",
  );
  if (provider === "unknown") {
    return (
      <span className={className}>
        <CircleDashed aria-hidden size={14} />
      </span>
    );
  }
  return (
    <span className={className}>
      <AgentProviderIcon provider={provider} size={14} />
    </span>
  );
}

function niceTokenMaximum(value: number) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const rounded =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

type ChartPoint = { x: number; y: number };

function smoothPath(points: ChartPoint[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midpoint = (previous.x + current.x) / 2;
    path += ` C ${midpoint} ${previous.y}, ${midpoint} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

function DailyUsageChart({
  dataReady,
  metric,
  overview,
  unavailableMessage,
}: {
  dataReady: boolean;
  metric: ChartMetric;
  overview: ReturnType<typeof aggregateAgentUsageOverview>;
  unavailableMessage: string;
}) {
  const { localeTag, t } = useI18n();
  const dataTableId = useId();
  const width = 720;
  const height = 268;
  const left = metric === "cost" ? 86 : 62;
  const right = 12;
  const top = 15;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const providers = overview.providers
    .filter((provider) =>
      metric === "tokens"
        ? provider.totalTokens > 0
        : metric === "cost"
          ? provider.totalCostUsdTicks > 0
          : provider.runs > 0,
    )
    .map((provider) => provider.provider);
  let maximum = 0;
  for (const day of overview.daily) {
    for (const provider of providers) {
      const value = chartValue(day.byProvider[provider], metric);
      if (value > maximum) maximum = value;
    }
  }
  const runTickStep = Math.max(1, Math.ceil(maximum / 4));
  const runTickCount = Math.max(1, Math.ceil(maximum / runTickStep));
  const yMaximum =
    metric === "runs" ? runTickStep * runTickCount : niceTokenMaximum(maximum);
  const xAt = (index: number) =>
    left +
    (overview.daily.length <= 1
      ? plotWidth / 2
      : (index / (overview.daily.length - 1)) * plotWidth);
  const yAt = (value: number) =>
    top + plotHeight - (value / yMaximum) * plotHeight;
  const baseline = top + plotHeight;
  const tickValues =
    maximum === 0
      ? [0]
      : metric === "runs"
        ? Array.from(
            { length: runTickCount + 1 },
            (_, index) => index * runTickStep,
          )
        : [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * yMaximum);
  const dateFormatter = new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    month: "short",
  });
  const accessibleDateFormatter = new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateIndexes = Array.from(
    new Set([
      0,
      Math.floor((overview.daily.length - 1) / 2),
      overview.daily.length - 1,
    ]),
  ).filter((index) => index >= 0);

  return (
    <div className="relative mt-1.5 h-[286px] min-w-0 max-[560px]:h-60">
      <svg
        aria-describedby={dataTableId}
        aria-label={
          metric === "tokens"
            ? t("usage.chartLabelTokens")
            : metric === "cost"
              ? t("usage.chartLabelCost")
              : t("usage.chartLabelRuns")
        }
        className="block size-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <desc>
          {metric === "tokens"
            ? t("usage.chartLabelTokens")
            : metric === "cost"
              ? t("usage.chartLabelCost")
              : t("usage.chartLabelRuns")}
        </desc>
        {tickValues.map((value) => {
          const y = baseline - (value / yMaximum) * plotHeight;
          return (
            <g key={value}>
              <line
                className="stroke-border [stroke-width:1] [vector-effect:non-scaling-stroke]"
                x1={left}
                x2={width - right}
                y1={y}
                y2={y}
              />
              <text
                className="fill-muted-foreground font-mono text-[10px] font-medium"
                textAnchor="end"
                x={left - 12}
                y={y + 4}
              >
                {metric === "cost"
                  ? formatUsdTicks(value, localeTag, true)
                  : formatCompact(value, localeTag)}
              </text>
            </g>
          );
        })}

        {providers.map((provider) => {
          const points = overview.daily.map((day, index) => ({
            x: xAt(index),
            y: yAt(chartValue(day.byProvider[provider], metric)),
          }));
          const line = smoothPath(points);
          const area = points.length
            ? `${line} L ${points.at(-1)!.x} ${baseline} L ${points[0].x} ${baseline} Z`
            : "";
          return (
            <g key={provider}>
              <path
                d={area}
                fill={providerColors[provider]}
                fillOpacity="0.1"
              />
              <path
                d={line}
                fill="none"
                stroke={providerColors[provider]}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.6"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {dateIndexes.map((index) => (
          <text
            className="fill-muted-foreground text-[10px] font-medium"
            key={overview.daily[index]?.dateKey ?? index}
            textAnchor={
              index === 0
                ? "start"
                : index === overview.daily.length - 1
                  ? "end"
                  : "middle"
            }
            x={xAt(index)}
            y={height - 6}
          >
            {overview.daily[index]
              ? dateFormatter.format(overview.daily[index].timestamp)
              : ""}
          </text>
        ))}
      </svg>
      <table className="visually-hidden" id={dataTableId}>
        <caption>
          {metric === "tokens"
            ? t("usage.chartLabelTokens")
            : metric === "cost"
              ? t("usage.chartLabelCost")
              : t("usage.chartLabelRuns")}
        </caption>
        <thead>
          <tr>
            <th>{t("usage.day")}</th>
            <th>{t("usage.provider")}</th>
            <th>
              {t(
                metric === "tokens"
                  ? "usage.tokens"
                  : metric === "cost"
                    ? "usage.cost"
                    : "usage.runs",
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {overview.daily.flatMap((day) =>
            providers.flatMap((provider) => {
              const value = chartValue(day.byProvider[provider], metric);
              return value > 0 ? (
                <tr key={`${day.dateKey}:${provider}`}>
                  <td>{accessibleDateFormatter.format(day.timestamp)}</td>
                  <td>
                    {providerName(provider) ?? t("usage.unknownProvider")}
                  </td>
                  <td>
                    {metric === "cost"
                      ? formatUsdTicks(value, localeTag)
                      : new Intl.NumberFormat(localeTag).format(value)}
                  </td>
                </tr>
              ) : (
                []
              );
            }),
          )}
        </tbody>
      </table>
      {maximum === 0 ? (
        <p className="absolute inset-x-5 top-[45%] m-0 ml-[54px] text-center text-xs text-muted-foreground">
          {!dataReady
            ? unavailableMessage
            : t(
                metric === "tokens"
                  ? "usage.noRecordedTokens"
                  : metric === "cost"
                    ? overview.costs.costedRuns > 0
                      ? "usage.zeroRecordedCost"
                      : "usage.noRecordedCost"
                    : "usage.noRecordedRuns",
              )}
        </p>
      ) : null}
    </div>
  );
}

function ProviderLimitRow({ provider }: { provider: AgentUsageProvider }) {
  const { t } = useI18n();
  const window = tightestUsageWindow(provider);
  const percentage = window ? Math.round(window.usedPercent) : null;
  const providerLabel = providerName(provider.provider) ?? provider.provider;
  return (
    <div>
      <div className="flex items-center gap-2">
        <ProviderMark provider={provider.provider} />
        <strong className="min-w-0 truncate text-xs font-semibold">
          {providerLabel}
        </strong>
        <span className="ml-auto font-mono text-xs font-semibold text-muted-foreground">
          {percentage === null
            ? t(`usage.status.${provider.status}`)
            : `${percentage}%`}
        </span>
      </div>
      <i className="mt-1.5 ml-7 block h-1 overflow-hidden rounded-full bg-secondary">
        <b
          className={cn(
            "block h-full rounded-[inherit] bg-[var(--status-success-foreground)]",
            (provider.status === "error" ||
              provider.status === "unavailable") &&
              "bg-[var(--status-warning-foreground)]",
          )}
          style={{
            width: `${Math.min(100, Math.max(0, percentage ?? 0))}%`,
          }}
        />
      </i>
      <small className="mt-1 ml-7 block truncate text-micro text-muted-foreground">
        {window
          ? `${formatUsageWindowLabel(window)} · ${
              window.resetsAt && window.resetsAt > Date.now()
                ? t("usage.resetsIn", {
                    duration: formatUsageDuration(window.resetsAt - Date.now()),
                  })
                : t("usage.resetUnknown")
            }`
          : (provider.error ?? t("usage.noProviderUsage"))}
      </small>
    </div>
  );
}

export function AgentUsageSettings({
  onLoadProviderUsage,
  onLoadUsageReport,
  onManageAccounts,
  usageScopeKey = "default",
}: {
  onLoadProviderUsage?: () => Promise<AgentUsageSnapshot>;
  onLoadUsageReport?: () => Promise<AgentUsageReport>;
  onManageAccounts: () => void;
  usageScopeKey?: string;
}) {
  const { localeTag, t } = useI18n();
  const breakdownTitleId = useId();
  const [history, setHistory] = useState<AgentUsageSnapshot[]>(
    readAgentUsageHistory,
  );
  const [rangeDays, setRangeDays] = useState<UsageRangeDays>(30);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("tokens");
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("model");
  const [refreshing, setRefreshing] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [usageRunsError, setUsageRunsError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [usageReport, setUsageReport] = useState<AgentUsageReport | null>(null);
  const loadProviderUsageRef = useRef(onLoadProviderUsage ?? loadAgentUsage);
  loadProviderUsageRef.current = onLoadProviderUsage ?? loadAgentUsage;
  const loadUsageReportRef = useRef(onLoadUsageReport);
  loadUsageReportRef.current = onLoadUsageReport;
  const refreshGenerationRef = useRef(0);
  const latest = history[0] ?? null;

  const refresh = useCallback(
    async (generation = refreshGenerationRef.current) => {
      setRefreshing(true);
      setProviderError(null);
      setUsageRunsError(null);
      const [providerResult, reportResult] = await Promise.allSettled([
        loadProviderUsageRef.current(),
        loadUsageReportRef.current
          ? loadUsageReportRef.current()
          : Promise.resolve({
              runs: [],
              generatedAt: new Date().toISOString(),
              pricing: {
                status: "unavailable" as const,
                source: LITELLM_MAIN_PRICING_SOURCE,
                fetchedAt: null,
                knownModels: 0,
              },
            }),
      ]);
      if (generation !== refreshGenerationRef.current) return;
      if (providerResult.status === "fulfilled") {
        setHistory(recordAgentUsageSnapshot(providerResult.value));
      } else {
        setProviderError(
          providerResult.reason instanceof Error
            ? providerResult.reason.message
            : String(providerResult.reason),
        );
      }
      if (reportResult.status === "fulfilled") {
        setUsageReport(reportResult.value);
      } else {
        setUsageRunsError(
          reportResult.reason instanceof Error
            ? reportResult.reason.message
            : String(reportResult.reason),
        );
      }
      setNow(Date.now());
      setRefreshing(false);
    },
    [],
  );

  useEffect(() => {
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    setUsageReport(null);
    setUsageRunsError(null);
    void refresh(generation);
    return () => {
      if (refreshGenerationRef.current === generation) {
        refreshGenerationRef.current += 1;
      }
    };
  }, [refresh, usageScopeKey]);

  const overview = useMemo(
    () => aggregateAgentUsageOverview(usageReport?.runs ?? [], rangeDays, now),
    [now, rangeDays, usageReport],
  );
  const usageRunsLoaded = usageReport !== null;
  const totalTokens = overview.totals.totalTokens;
  const cachedDenominator =
    overview.totals.cacheReadTokens + overview.totals.uncachedInputTokens;
  const cacheShare =
    cachedDenominator > 0
      ? overview.totals.cacheReadTokens / cachedDenominator
      : 0;
  const providerRows = overview.providers.filter(
    (provider) => provider.totalTokens > 0 || provider.runs > 0,
  );
  const breakdownRows =
    breakdownMode === "model"
      ? overview.models.map((row) => ({
          key: `${row.provider}:${row.modelProvider ?? ""}:${row.model ?? ""}`,
          label: row.model ?? t("usage.modelNotReported"),
          provider: row.provider,
          modelProvider: row.modelProvider,
          modelSource: row.modelSource,
          runs: row.runs,
          timestamp: null,
          tokens: row.totalTokens,
          costUsdTicks: row.totalCostUsdTicks,
        }))
      : [...overview.daily]
          .reverse()
          .filter((day) => day.totalTokens > 0 || day.runs > 0)
          .map((day) => ({
            key: day.dateKey,
            label: new Intl.DateTimeFormat(localeTag, {
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(day.timestamp),
            provider: null,
            modelProvider: null,
            modelSource: null,
            runs: day.runs,
            timestamp: day.timestamp,
            tokens: day.totalTokens,
            costUsdTicks: day.totalCostUsdTicks,
          }));
  const coverage =
    overview.observedRuns > 0
      ? overview.reportedRuns / overview.observedRuns
      : 0;
  const missingCoverage = overview.observedRuns > 0 ? 1 - coverage : 0;
  const actualModelCoverage =
    overview.reportedRuns > 0
      ? overview.actualModelRuns / overview.reportedRuns
      : 0;
  const costCoverage =
    overview.reportedRuns > 0
      ? overview.costs.costedRuns / overview.reportedRuns
      : 0;
  const dateRange = formatDateRange(
    overview.startAt,
    overview.endAt,
    localeTag,
  );
  const chartProviders = providerRows.filter((provider) =>
    chartMetric === "tokens"
      ? provider.totalTokens > 0
      : chartMetric === "cost"
        ? provider.totalCostUsdTicks > 0
        : provider.runs > 0,
  );
  const unavailableMessage = usageRunsError
    ? t("usage.loadRunsFailed")
    : t("usage.loadingRuns");

  return (
    <SettingsSection className="max-w-[1240px] text-foreground">
      <header className="mb-5 flex min-h-[72px] items-start justify-between gap-7 max-[820px]:items-stretch max-[820px]:flex-col max-[820px]:gap-3.5">
        <div className="min-w-0">
          <h1 className="m-0 text-[27px] leading-tight font-bold tracking-tighter">
            {t("usage.title")}
          </h1>
          <p className="mt-2.5 mb-0 text-sm text-muted-foreground">
            {dateRange}
          </p>
        </div>
        <div className="flex items-center gap-2.5 max-[820px]:justify-between max-[560px]:items-end">
          <div
            aria-label={`${t("usage.title")} · ${dateRange}`}
            className="flex items-stretch rounded-lg border border-border bg-muted p-0.5 max-[560px]:w-full [&>button]:min-h-[29px] [&>button]:cursor-pointer [&>button]:whitespace-nowrap [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:py-0 [&>button]:text-micro [&>button]:font-semibold [&>button]:text-muted-foreground [&>button]:transition-colors [&>button]:hover:text-foreground [&>button[aria-pressed=true]]:bg-card [&>button[aria-pressed=true]]:text-foreground [&>button[aria-pressed=true]]:shadow-sm motion-reduce:[&>button]:transition-none max-[560px]:[&>button]:min-w-0 max-[560px]:[&>button]:flex-1 max-[560px]:[&>button]:px-1.5"
            role="group"
          >
            {rangeOptions.map((days) => (
              <button
                aria-pressed={rangeDays === days}
                key={days}
                onClick={() => setRangeDays(days)}
                type="button"
              >
                {t(`usage.period${days}`)}
              </button>
            ))}
          </div>
          <SettingsIconButton
            aria-label={t("usage.refresh")}
            disabled={refreshing}
            onClick={() => void refresh()}
            title={t("usage.refresh")}
          >
            <Spinner icon={RefreshCw} size={16} spinning={refreshing} />
          </SettingsIconButton>
        </div>
      </header>

      <section className="grid min-w-0 grid-cols-[minmax(260px,.68fr)_minmax(480px,1.32fr)] gap-12 border-b border-border px-0 pt-2.5 pb-8 max-[1050px]:grid-cols-[minmax(220px,.55fr)_minmax(420px,1.45fr)] max-[1050px]:gap-7 max-[820px]:grid-cols-1">
        <div className="min-w-0 max-[820px]:max-w-[480px]">
          <span className="block text-micro font-bold tracking-wider text-muted-foreground uppercase">
            {t("usage.observedTokens")}
          </span>
          <strong
            className="mt-3.5 block truncate font-mono text-[clamp(36px,4.5vw,48px)] leading-none font-semibold tracking-tighter"
            title={
              usageRunsLoaded
                ? new Intl.NumberFormat(localeTag).format(totalTokens)
                : undefined
            }
          >
            {usageRunsLoaded ? formatCompact(totalTokens, localeTag) : "—"}
          </strong>
          <p className="mt-3 mb-0 text-micro leading-relaxed text-muted-foreground">
            {usageRunsLoaded
              ? t("usage.runsReportedSummary", {
                  reported: overview.reportedRuns,
                  total: overview.observedRuns,
                })
              : unavailableMessage}
          </p>

          <div className="mt-7 grid gap-5">
            {providerRows.length > 0 ? (
              providerRows.map((provider) => {
                const share =
                  totalTokens > 0 ? provider.totalTokens / totalTokens : 0;
                const label =
                  providerName(provider.provider) ?? t("usage.unknownProvider");
                return (
                  <div className="min-w-0" key={provider.provider}>
                    <header className="flex min-w-0 items-center gap-2">
                      <ProviderMark provider={provider.provider} />
                      <strong className="min-w-0 truncate text-sm font-semibold">
                        {label}
                      </strong>
                      <b className="ml-auto font-mono text-sm font-semibold">
                        {formatCompact(provider.totalTokens, localeTag)}
                      </b>
                    </header>
                    <i className="mt-2 block h-1.25 overflow-hidden rounded-full bg-secondary">
                      <b
                        className="block h-full rounded-[inherit] bg-[var(--usage-provider-color)]"
                        style={
                          {
                            "--usage-provider-color":
                              providerColors[provider.provider],
                            width: `${share * 100}%`,
                          } as CSSProperties
                        }
                      />
                    </i>
                    <small className="mt-1.5 block text-micro text-muted-foreground">
                      {formatPercent(share, localeTag)} · {provider.runs}{" "}
                      {t("usage.runs").toLocaleLowerCase(localeTag)}
                    </small>
                  </div>
                );
              })
            ) : (
              <p className="m-0 px-0 py-5 text-xs text-muted-foreground">
                {usageRunsLoaded
                  ? t("usage.noRecordedTokens")
                  : unavailableMessage}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <header className="flex min-h-8 items-start justify-between gap-4 max-[560px]:items-stretch max-[560px]:flex-col">
            <h2 className="m-0 text-base font-semibold tracking-tight">
              {t("usage.dailyUsage")}
            </h2>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 max-[560px]:justify-between">
              <div
                aria-label={t("usage.dailyUsage")}
                className="flex items-stretch rounded-lg border border-border bg-muted p-0.5 [&>button]:min-h-6 [&>button]:cursor-pointer [&>button]:whitespace-nowrap [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2.5 [&>button]:py-0 [&>button]:text-[10px] [&>button]:font-semibold [&>button]:tracking-wide [&>button]:text-muted-foreground [&>button]:uppercase [&>button]:hover:text-foreground [&>button[aria-pressed=true]]:bg-card [&>button[aria-pressed=true]]:text-foreground [&>button[aria-pressed=true]]:shadow-sm"
                role="group"
              >
                {(["tokens", "cost", "runs"] as const).map((metric) => (
                  <button
                    aria-pressed={chartMetric === metric}
                    key={metric}
                    onClick={() => setChartMetric(metric)}
                    type="button"
                  >
                    {t(`usage.${metric}`)}
                  </button>
                ))}
              </div>
              <div className="flex min-h-6 flex-wrap items-center justify-end gap-x-3 gap-y-1.5 max-[560px]:justify-start [&>span]:flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:whitespace-nowrap [&>span]:text-micro [&>span]:text-muted-foreground [&_i]:size-1.5 [&_i]:rounded-full">
                {chartProviders.map((provider) => (
                  <span key={provider.provider}>
                    <i
                      style={{
                        background: providerColors[provider.provider],
                      }}
                    />
                    {providerName(provider.provider) ??
                      t("usage.unknownProvider")}
                  </span>
                ))}
              </div>
            </div>
          </header>
          <DailyUsageChart
            dataReady={usageRunsLoaded}
            metric={chartMetric}
            overview={overview}
            unavailableMessage={unavailableMessage}
          />
        </div>
      </section>

      <section
        aria-busy={!usageRunsLoaded && !usageRunsError}
        className="grid grid-cols-6 border-b border-border max-[820px]:grid-cols-2 [&>div]:flex [&>div]:min-h-[116px] [&>div]:min-w-0 [&>div]:flex-col [&>div]:justify-center [&>div]:border-l [&>div]:border-border [&>div]:px-4 [&>div]:py-5 [&>div:first-child]:border-l-0 [&>div:first-child]:pl-0 [&>div:last-child]:pr-0 [&_span]:text-micro [&_span]:text-muted-foreground [&_strong]:mt-2 [&_strong]:truncate [&_strong]:font-mono [&_strong]:text-[20px] [&_strong]:leading-tight [&_strong]:font-semibold [&_strong]:tracking-tighter [&_small]:mt-1.5 [&_small]:truncate [&_small]:text-micro [&_small]:leading-snug [&_small]:text-muted-foreground max-[1050px]:[&>div]:px-3 max-[820px]:[&>div]:min-h-0 max-[820px]:[&>div]:border-t max-[820px]:[&>div]:border-l-0 max-[820px]:[&>div]:px-3.5 max-[820px]:[&>div]:py-4 max-[820px]:[&>div:nth-child(even)]:border-l max-[820px]:[&>div:nth-child(-n+2)]:border-t-0"
      >
        <div>
          <span>{t("usage.processedTokens")}</span>
          <strong>
            {usageRunsLoaded ? formatCompact(totalTokens, localeTag) : "—"}
          </strong>
          <small>
            {usageRunsLoaded
              ? t("usage.perActiveDay", {
                  value: formatCompact(
                    overview.activeDays > 0
                      ? totalTokens / overview.activeDays
                      : 0,
                    localeTag,
                  ),
                })
              : unavailableMessage}
          </small>
        </div>
        <div>
          <span>{t("usage.totalCost")}</span>
          <strong>
            {usageRunsLoaded
              ? formatUsdTicks(overview.costs.totalUsdTicks, localeTag)
              : "—"}
          </strong>
          <small>
            {usageRunsLoaded
              ? t("usage.costMix", {
                  estimated: formatUsdTicks(
                    overview.costs.estimatedUsdTicks,
                    localeTag,
                  ),
                  reported: formatUsdTicks(
                    overview.costs.providerReportedUsdTicks,
                    localeTag,
                  ),
                })
              : "—"}
          </small>
        </div>
        <div>
          <span>{t("usage.cachedInput")}</span>
          <strong>
            {usageRunsLoaded
              ? formatCompact(overview.totals.cacheReadTokens, localeTag)
              : "—"}
          </strong>
          <small>
            {usageRunsLoaded
              ? t("usage.cachedShare", {
                  percent: formatPercent(cacheShare, localeTag),
                })
              : "—"}
          </small>
        </div>
        <div>
          <span>{t("usage.uncachedInput")}</span>
          <strong>
            {usageRunsLoaded
              ? formatCompact(overview.totals.uncachedInputTokens, localeTag)
              : "—"}
          </strong>
          <small>
            {usageRunsLoaded
              ? t("usage.cacheWrites", {
                  value: formatCompact(
                    overview.totals.cacheWriteTokens,
                    localeTag,
                  ),
                })
              : "—"}
          </small>
        </div>
        <div>
          <span>{t("usage.outputTokens")}</span>
          <strong>
            {usageRunsLoaded
              ? formatCompact(overview.totals.outputTokens, localeTag)
              : "—"}
          </strong>
          <small>
            {usageRunsLoaded
              ? t("usage.includesReasoning", {
                  value: formatCompact(
                    overview.totals.reasoningTokens,
                    localeTag,
                  ),
                })
              : "—"}
          </small>
        </div>
        <div>
          <span>{t("usage.reportedRuns")}</span>
          <strong>{usageRunsLoaded ? overview.reportedRuns : "—"}</strong>
          <small>
            {usageRunsLoaded
              ? t("usage.reportedRunSummary", {
                  reported: overview.reportedRuns,
                  total: overview.observedRuns,
                })
              : "—"}
          </small>
        </div>
      </section>

      {usageRunsError ? <SettingsAlert>{usageRunsError}</SettingsAlert> : null}

      <section className="grid min-w-0 grid-cols-[minmax(0,2.05fr)_minmax(255px,.82fr)] items-start gap-10 pt-7 max-[1050px]:gap-7 max-[820px]:grid-cols-1">
        <div className="min-w-0">
          <header className="flex min-h-8 items-start justify-between gap-4">
            <h2
              className="m-0 text-base font-semibold tracking-tight"
              id={breakdownTitleId}
            >
              {t("usage.breakdown")}
            </h2>
            <div
              aria-label={t("usage.breakdown")}
              className="flex items-stretch rounded-lg border border-border bg-muted p-0.5 [&>button]:min-h-6 [&>button]:cursor-pointer [&>button]:whitespace-nowrap [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2.5 [&>button]:py-0 [&>button]:text-[10px] [&>button]:font-semibold [&>button]:tracking-wide [&>button]:text-muted-foreground [&>button]:uppercase [&>button]:hover:text-foreground [&>button[aria-pressed=true]]:bg-card [&>button[aria-pressed=true]]:text-foreground [&>button[aria-pressed=true]]:shadow-sm"
              role="group"
            >
              {(["model", "day"] as const).map((mode) => (
                <button
                  aria-pressed={breakdownMode === mode}
                  key={mode}
                  onClick={() => setBreakdownMode(mode)}
                  type="button"
                >
                  {t(mode === "model" ? "usage.byModel" : "usage.byDay")}
                </button>
              ))}
            </div>
          </header>
          <div
            aria-labelledby={breakdownTitleId}
            className="scrollbar-subtle max-h-[420px] overflow-auto focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring [&_table]:w-full [&_table]:min-w-[650px] [&_table]:table-fixed [&_table]:border-collapse [&_th]:h-[38px] [&_th]:border-b [&_th]:border-border [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-right [&_th]:text-micro [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:h-12 [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_td]:text-right [&_td]:text-xs [&_td:not(:first-child)]:font-mono [&_th:first-child]:w-[43%] [&_th:first-child]:pl-0 [&_th:first-child]:text-left [&_td:first-child]:w-[43%] [&_td:first-child]:pl-0 [&_td:first-child]:text-left [&_th:last-child]:pr-0 [&_td:last-child]:pr-0"
            role="region"
            tabIndex={0}
          >
            <table>
              <caption className="visually-hidden">
                {t("usage.breakdown")}
              </caption>
              <thead>
                <tr>
                  <th>
                    {t(breakdownMode === "model" ? "usage.model" : "usage.day")}
                  </th>
                  <th>{t("usage.tokens")}</th>
                  <th>{t("usage.cost")}</th>
                  <th>{t("usage.share")}</th>
                  <th>{t("usage.runs")}</th>
                </tr>
              </thead>
              <tbody>
                {breakdownRows.length > 0 ? (
                  breakdownRows.map((row) => {
                    const share =
                      totalTokens > 0 ? row.tokens / totalTokens : 0;
                    return (
                      <tr key={row.key}>
                        <td>
                          <div className="flex min-w-0 items-center gap-2">
                            {row.provider ? (
                              <ProviderMark provider={row.provider} />
                            ) : null}
                            <span className="flex min-w-0 flex-col gap-0.5 [&>strong]:truncate [&>strong]:text-xs [&>strong]:font-semibold [&>time]:truncate [&>time]:text-xs [&>time]:font-semibold">
                              {row.timestamp ? (
                                <time
                                  dateTime={new Date(
                                    row.timestamp,
                                  ).toISOString()}
                                >
                                  {row.label}
                                </time>
                              ) : (
                                <strong>{row.label}</strong>
                              )}
                              {row.provider ? (
                                <small className="truncate text-micro text-muted-foreground">
                                  {providerName(row.provider) ??
                                    t("usage.unknownProvider")}
                                  {row.modelSource
                                    ? ` · ${modelSourceLabel(row.modelSource, t)}`
                                    : ""}
                                  {row.modelProvider
                                    ? ` · ${row.modelProvider}`
                                    : ""}
                                </small>
                              ) : null}
                            </span>
                          </div>
                        </td>
                        <td>{formatCompact(row.tokens, localeTag)}</td>
                        <td>{formatUsdTicks(row.costUsdTicks, localeTag)}</td>
                        <td>{formatPercent(share, localeTag)}</td>
                        <td>{row.runs}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      className="h-[130px]! text-center! text-muted-foreground"
                      colSpan={5}
                    >
                      {usageRunsLoaded
                        ? t("usage.noRecordedTokens")
                        : unavailableMessage}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="grid min-w-0 gap-7 [&_h2]:m-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&>section>p]:mt-2.5 [&>section>p]:mb-0 [&>section>p]:text-micro [&>section>p]:leading-relaxed [&>section>p]:text-muted-foreground">
          <section>
            <h2>{t("usage.dataCoverage")}</h2>
            <dl className="mt-3 mb-0 [&>div]:flex [&>div]:min-h-11 [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-border [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:text-right [&_dd]:font-mono [&_dd]:text-xs [&_dd]:font-semibold">
              <div>
                <dt>{t("usage.tokenReported")}</dt>
                <dd>
                  {usageRunsLoaded ? formatPercent(coverage, localeTag) : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("usage.actualModelReported")}</dt>
                <dd>
                  {usageRunsLoaded
                    ? formatPercent(actualModelCoverage, localeTag)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("usage.costCovered")}</dt>
                <dd>
                  {usageRunsLoaded
                    ? formatPercent(costCoverage, localeTag)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("usage.tokenMissing")}</dt>
                <dd>
                  {usageRunsLoaded
                    ? formatPercent(missingCoverage, localeTag)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("usage.cacheShare")}</dt>
                <dd>
                  {usageRunsLoaded ? formatPercent(cacheShare, localeTag) : "—"}
                </dd>
              </div>
            </dl>
            <p>
              {usageRunsLoaded
                ? t("usage.ledgerCoverage", {
                    ledger: overview.ledgerRuns,
                    legacy: overview.legacyRuns,
                    records: overview.usageRecords,
                  })
                : unavailableMessage}
            </p>
          </section>

          <section>
            <h2>{t("usage.costCalculation")}</h2>
            <strong className="mt-3 block text-xs font-semibold leading-snug">
              {usageReport
                ? pricingStatusLabel(usageReport.pricing, localeTag, t)
                : "—"}
            </strong>
            <dl className="mt-3 mb-0 [&>div]:flex [&>div]:min-h-11 [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-border [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:text-right [&_dd]:font-mono [&_dd]:text-xs [&_dd]:font-semibold">
              <div>
                <dt>{t("usage.providerReportedCost")}</dt>
                <dd>
                  {usageRunsLoaded
                    ? formatUsdTicks(
                        overview.costs.providerReportedUsdTicks,
                        localeTag,
                      )
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("usage.currentPriceEstimate")}</dt>
                <dd>
                  {usageRunsLoaded
                    ? formatUsdTicks(
                        overview.costs.estimatedUsdTicks,
                        localeTag,
                      )
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("usage.unattributedCost")}</dt>
                <dd>
                  {usageRunsLoaded
                    ? formatUsdTicks(
                        overview.costs.unattributedUsdTicks,
                        localeTag,
                      )
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("usage.unpricedRuns")}</dt>
                <dd>{usageRunsLoaded ? overview.costs.unpricedRuns : "—"}</dd>
              </div>
            </dl>
            <p>{t("usage.currentPricingNote")}</p>
            {usageReport ? (
              <a
                className="mt-2.5 inline-flex text-micro text-muted-foreground underline decoration-current/45 underline-offset-3 hover:text-foreground"
                href={LITELLM_MAIN_PRICING_SOURCE}
                rel="noreferrer"
                target="_blank"
              >
                {t("usage.pricingSource", {
                  count: usageReport.pricing.knownModels,
                })}
              </a>
            ) : null}
          </section>

          <section>
            <header className="flex min-h-8 items-start justify-between gap-3">
              <h2>{t("usage.providerLimits")}</h2>
              <div className="flex items-center gap-0.5">
                <button
                  className="min-h-7 cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-0 text-micro text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={onManageAccounts}
                  type="button"
                >
                  {t("usage.manageAccounts")}
                </button>
                <SettingsIconButton
                  aria-label={t("usage.clearHistory")}
                  disabled={history.length === 0}
                  onClick={() => {
                    clearAgentUsageHistory();
                    setHistory([]);
                  }}
                  title={t("usage.clearHistory")}
                >
                  <Trash2 size={14} />
                </SettingsIconButton>
              </div>
            </header>
            <p className="mt-2.5 mb-0 text-micro leading-relaxed text-muted-foreground">
              {t("usage.localLimitsScope")}
            </p>
            {providerError ? (
              <SettingsAlert>{providerError}</SettingsAlert>
            ) : null}
            <div className="mt-3 grid gap-4 [&>p]:m-0 [&>p]:text-xs [&>p]:text-muted-foreground">
              {latest ? (
                quotaUsageProviders.map((provider) => (
                  <ProviderLimitRow
                    key={provider}
                    provider={latest[provider]}
                  />
                ))
              ) : (
                <p>{t("usage.noLimitData")}</p>
              )}
            </div>
          </section>
        </aside>
      </section>

      <p className="mt-6 mb-0 text-micro leading-relaxed text-muted-foreground">
        {t("usage.metricsScope")}
      </p>
    </SettingsSection>
  );
}
