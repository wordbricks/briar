import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ChevronLeft,
  Clock3,
  Github,
  Home,
  ListTodo,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MainContent, PageHeader } from "./layout";
import { TeamIcon } from "./TeamIcon";
import { TeamMergeActivity } from "./TeamMergeActivity";
import type { TeamMergeActivityLoader } from "../lib/team-merge-activity";
import { IssueDifficultyIcon } from "./hunt/IssueDifficultyIcon";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { formatUsageDuration } from "../lib/agent-usage";
import type { RepositoryReadiness } from "../generated/tauri";
import {
  isLocalTeamRepositoryReady,
  localTeamReadiness,
  type LocalTeamConnectionState,
} from "../lib/local-team-connection";
import {
  defaultTeamUsageDateRange,
  isTeamUsageDateRange,
  teamTrackedDuration as trackedDurationForRange,
  summarizeTeamUsage,
  type TeamUsageBreakdownItem,
  type TeamUsageDateRange,
  type TeamUsagePeriod,
  type TeamUsageSummaryRun,
  type TeamUsageSummaryLoadOptions,
} from "../lib/team-usage-summary";
import type {
  DashboardPayload,
  HuntRun,
  Project,
  TeamUsageSummary,
} from "../types";
import { cn } from "../lib/utils";

const defaultPeriod: TeamUsagePeriod = "day";
const activeStatuses = new Set(["queued", "running", "paused"]);
const attentionStatuses = new Set(["blocked", "failed"]);

const displayDateRange = (range: TeamUsageDateRange, locale: string) => {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
  const from = Date.parse(`${range.from}T00:00:00.000Z`);
  const to = Date.parse(`${range.to}T00:00:00.000Z`);
  return `${formatter.format(from)} – ${formatter.format(to)}`;
};

function formatCompact(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

/** Compact labels for chart axes (1k, 1M) so scale is readable at a glance. */
function formatAxisValue(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
    notation: value >= 1_000 ? "compact" : "standard",
  }).format(value);
}

/** Round a max up to 1/2/5 × 10^n so axis ticks stay clean. */
function niceScaleMaximum(value: number) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const rounded =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

/** Integer-friendly top for issue counts (small whole numbers). */
function niceCountMaximum(value: number) {
  if (value <= 0) return 1;
  const step = Math.max(1, Math.ceil(value / 4));
  return step * Math.ceil(value / step);
}

function chartTickValues(maximum: number, integerTicks: boolean) {
  if (maximum <= 0) return [0];
  // Small maxima collapse poorly with fractional ratios (e.g. 0/0.25/0.5 → "0","0","1").
  if (integerTicks || maximum <= 4) {
    const step = Math.max(1, Math.ceil(maximum / 4));
    const count = Math.max(1, Math.round(maximum / step));
    return Array.from({ length: count + 1 }, (_, index) => index * step);
  }
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * maximum);
}

export function teamTrackedDuration(
  runs: readonly TeamUsageSummaryRun[],
  now: number,
) {
  return trackedDurationForRange(runs, defaultPeriod, now);
}

function breakdownLabel(item: TeamUsageBreakdownItem, fallback: string) {
  return item.name?.trim() || item.id?.trim() || fallback;
}

function statusLabel(run: HuntRun, t: ReturnType<typeof useI18n>["t"]) {
  const key = `status.${run.status}` as MessageKey;
  return t(key);
}

export function TeamLobby({
  companionMode = false,
  connectionState,
  dashboard,
  isSidebarOpen,
  onLoadUsageSummary,
  onLoadMergeActivity,
  onOpenAgents,
  onOpenIssue,
  onOpenIssues,
  onOpenRepository,
  onOpenSettings,
  onBack,
  project,
  readiness,
  requiresLocalReadiness,
}: {
  companionMode?: boolean;
  connectionState: LocalTeamConnectionState;
  dashboard: DashboardPayload | null;
  isSidebarOpen: boolean;
  onLoadMergeActivity?: TeamMergeActivityLoader;
  onLoadUsageSummary: (
    projectId: string,
    period: TeamUsagePeriod,
    options?: TeamUsageSummaryLoadOptions,
  ) => Promise<TeamUsageSummary | null>;
  onOpenAgents: () => void;
  onOpenIssue: (runId: string) => void;
  onOpenIssues: () => void;
  onOpenRepository: () => void;
  onOpenSettings: () => void;
  onBack?: () => void;
  project: Project;
  readiness: RepositoryReadiness | null;
  requiresLocalReadiness: boolean;
}) {
  const { localeTag, t } = useI18n();
  const [usageSummary, setUsageSummary] = useState<TeamUsageSummary | null>(
    null,
  );
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [period, setPeriod] = useState<TeamUsagePeriod>(defaultPeriod);
  const [dateRange, setDateRange] = useState(defaultTeamUsageDateRange);
  const [draftDateRange, setDraftDateRange] = useState(dateRange);
  const [now, setNow] = useState(Date.now);
  const usageRequest = useRef(0);
  const [mergeRefreshKey, setMergeRefreshKey] = useState(0);

  const refreshUsage = useCallback(
    async (force = false) => {
      if (force) setMergeRefreshKey((value) => value + 1);
      const request = ++usageRequest.current;
      setUsageLoading(true);
      setUsageError(null);
      try {
        const summary = await onLoadUsageSummary(project.id, period, {
          force,
          range: dateRange,
        });
        if (request === usageRequest.current) {
          setUsageSummary(summary);
          setNow(Date.now());
        }
      } catch (cause) {
        if (request === usageRequest.current) {
          setUsageError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (request === usageRequest.current) setUsageLoading(false);
      }
    },
    [dateRange, onLoadUsageSummary, period, project.id],
  );

  useEffect(() => {
    setUsageSummary(null);
    setUsageError(null);
    void refreshUsage();
  }, [period, project.id, refreshUsage]);

  const dashboardRuns =
    dashboard?.team.id === project.id ? dashboard.runs : [];
  const dashboardUsage = useMemo(
    () => summarizeTeamUsage(dashboardRuns, period, now, dateRange),
    [dashboardRuns, dateRange, now, period],
  );
  const totalTokens = usageSummary?.totalTokens ?? dashboardUsage.totalTokens;
  const observedRuns =
    usageSummary?.observedRuns ?? dashboardUsage.observedRuns;
  const reportedRuns =
    usageSummary?.reportedRuns ?? dashboardUsage.reportedRuns;
  const trackedDuration =
    usageSummary?.trackedDurationMs ??
    trackedDurationForRange(dashboardRuns, period, now, dateRange);
  const completedIssues =
    usageSummary?.completedIssues ?? dashboardUsage.completedIssues;
  const timeline = usageSummary?.timeline ?? dashboardUsage.timeline;
  const issueCreators =
    usageSummary?.issueCreators ?? dashboardUsage.issueCreators;
  const agents = usageSummary?.agents ?? dashboardUsage.agents;
  const activeRuns = dashboardRuns.filter((run) =>
    activeStatuses.has(run.status),
  );
  const attentionRuns = dashboardRuns.filter((run) =>
    attentionStatuses.has(run.status),
  );
  const recentRuns = [...dashboardRuns]
    .sort(
      (left, right) =>
        Date.parse(right.lastEventAt || right.updatedAt) -
        Date.parse(left.lastEventAt || left.updatedAt),
    )
    .slice(0, 5);
  const inspectedReadiness = requiresLocalReadiness
    ? localTeamReadiness(connectionState, readiness)
    : readiness;
  const githubRepository =
    inspectedReadiness?.githubRepository ??
    (dashboard?.team.id === project.id
      ? dashboard.settings.githubRepository
      : null);
  const localSetupReady = Boolean(
    (!requiresLocalReadiness || connectionState === "connected") &&
    (requiresLocalReadiness
      ? isLocalTeamRepositoryReady(inspectedReadiness)
      : true),
  );
  const repositoryReady = Boolean(localSetupReady && githubRepository);
  const connectsOnDesktop = !requiresLocalReadiness && !githubRepository;
  const githubOptional = Boolean(
    requiresLocalReadiness &&
    connectionState === "connected" &&
    inspectedReadiness &&
    !inspectedReadiness.requiresGithub &&
    !githubRepository,
  );
  const repositoryState = !requiresLocalReadiness
    ? repositoryReady
      ? "ready"
      : "attention"
    : connectionState === "disconnected"
      ? "disconnected"
      : connectionState === "unknown" || !inspectedReadiness
        ? "unknown"
        : githubOptional
          ? "optional"
          : repositoryReady
            ? "ready"
            : "attention";
  const dateFormatter = new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    month: "short",
  });
  const analyticsDayFormatter = new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const analyticsMonthFormatter = new Intl.DateTimeFormat(localeTag, {
    month: "short",
    timeZone: "UTC",
    year: "2-digit",
  });
  const maxIssuesRaw = Math.max(
    0,
    ...timeline.map((point) => point.completedIssues),
  );
  const maxTokensRaw = Math.max(
    0,
    ...timeline.map((point) => point.totalTokens),
  );
  const maxIssues = niceCountMaximum(maxIssuesRaw);
  const maxTokens = niceScaleMaximum(maxTokensRaw);
  const issueTicks = chartTickValues(maxIssues, true);
  const tokenTicks = chartTickValues(maxTokens, false);
  const periodLabel = displayDateRange(dateRange, localeTag);
  const today = defaultTeamUsageDateRange(now).to;
  const dateRangeValid =
    isTeamUsageDateRange(draftDateRange, period) &&
    draftDateRange.to <= today;
  const dateRangeChanged =
    draftDateRange.from !== dateRange.from ||
    draftDateRange.to !== dateRange.to;
  const applyDateRange = () => {
    if (!dateRangeValid || !dateRangeChanged) return;
    usageRequest.current += 1;
    setUsageSummary(null);
    setDateRange(draftDateRange);
  };
  const bucketLabel = (startAt: string) => {
    const timestamp = Date.parse(startAt);
    return period === "month"
      ? analyticsMonthFormatter.format(timestamp)
      : analyticsDayFormatter.format(timestamp);
  };
  const renderBreakdown = (
    items: readonly TeamUsageBreakdownItem[],
    fallback: string,
  ) => {
    const max = Math.max(1, ...items.map((item) => item.issues));
    if (items.length === 0) {
      return (
        <p className="flex min-h-[72px] items-center text-micro text-muted-foreground">
          {t("lobby.analyticsEmpty")}
        </p>
      );
    }
    return (
      <ol className="mt-4 grid list-none gap-3 p-0">
        {items.map((item, index) => (
          <li
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
            key={`${item.id ?? item.name ?? "unknown"}-${index}`}
          >
            <span className="truncate text-xs font-semibold text-foreground">
              {breakdownLabel(item, fallback)}
            </span>
            <strong className="font-mono text-micro font-medium text-muted-foreground">
              {t("lobby.issueCount", { count: item.issues })}
            </strong>
            <i
              aria-hidden
              className="col-span-full h-1.25 min-w-0 rounded-full bg-gradient-to-r from-accent-foreground to-[#9d8bdd]"
              style={{ width: `${(item.issues / max) * 100}%` }}
            />
          </li>
        ))}
      </ol>
    );
  };

  if (companionMode) {
    return (
      <MainContent
        className="flex min-h-0 flex-col overflow-hidden"
        companionMode
        id="project-lobby"
      >
        <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto bg-background px-4 pt-3 pb-[120px]">
          <section className="mx-auto grid w-full max-w-xl gap-4">
            <header className="flex items-center gap-2 py-1">
              {onBack ? (
                <button
                  aria-label={t("navigation.back")}
                  className="grid size-10 shrink-0 place-items-center rounded-full border-0 bg-transparent text-foreground active:bg-muted"
                  onClick={onBack}
                  type="button"
                >
                  <ChevronLeft aria-hidden size={21} />
                </button>
              ) : null}
              <TeamIcon className="size-8 shrink-0" project={project} />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs text-muted-foreground">
                  {project.name}
                </span>
                <h1 className="m-0 truncate text-lg font-semibold tracking-tight">
                  {t("lobby.title")}
                </h1>
              </div>
              <button
                aria-label={t("lobby.refresh")}
                className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-xs disabled:opacity-60"
                disabled={usageLoading}
                onClick={() => void refreshUsage(true)}
                type="button"
              >
                <Spinner aria-hidden icon={RefreshCw} size={17} spinning={usageLoading} />
              </button>
            </header>

            <p className="m-0 text-sm leading-relaxed text-muted-foreground">
              {t("companion.viewLobbyDescription")}
            </p>

            <section
              aria-label={t("lobby.metrics")}
              className="grid grid-cols-2 gap-2.5"
            >
              {[
                {
                  icon: Sparkles,
                  label: t("lobby.tokens"),
                  value: formatCompact(totalTokens, localeTag),
                },
                {
                  icon: CheckCircle2,
                  label: t("lobby.completed"),
                  value: formatCompact(completedIssues, localeTag),
                },
                {
                  icon: Clock3,
                  label: t("lobby.active"),
                  value: formatCompact(activeRuns.length, localeTag),
                },
                {
                  icon: CircleAlert,
                  label: t("dashboard.attention"),
                  value: formatCompact(attentionRuns.length, localeTag),
                },
              ].map(({ icon: Icon, label, value }) => (
                <article
                  className="grid min-h-[112px] content-center gap-2 rounded-2xl border border-border bg-card p-4 shadow-xs"
                  key={label}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Icon aria-hidden className="text-primary" size={16} />
                    {label}
                  </span>
                  <strong className="font-mono text-2xl font-semibold tracking-tight text-foreground">
                    {value}
                  </strong>
                </article>
              ))}
            </section>

            {usageError ? (
              <p className="m-0 rounded-xl border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] p-3 text-xs text-[var(--status-destructive-foreground)]" role="status">
                {t("lobby.usageUnavailable")}
              </p>
            ) : null}

            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
              <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
                <div className="min-w-0">
                  <h2 className="m-0 text-sm font-semibold">
                    {t("lobby.recentActivity")}
                  </h2>
                  <p className="mt-0.5 mb-0 truncate text-xs text-muted-foreground">
                    {t("lobby.recentActivityDescription")}
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-lg border-0 bg-muted px-2.5 py-1.5 text-xs font-semibold text-foreground"
                  onClick={onOpenIssues}
                  type="button"
                >
                  {t("lobby.viewAll")}
                </button>
              </header>
              {recentRuns.length > 0 ? (
                <div className="grid">
                  {recentRuns.map((run) => (
                    <button
                      className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 border-t border-border bg-transparent px-4 py-2.5 text-left first:border-t-0 active:bg-muted"
                      key={run.id}
                      onClick={() => onOpenIssue(run.id)}
                      type="button"
                    >
                      <span className="grid min-w-0 gap-1">
                        <strong className="truncate text-sm font-semibold text-foreground">
                          {run.title}
                        </strong>
                        <small className="text-xs text-muted-foreground">
                          {project.issueKeyPrefix
                            ? `${project.issueKeyPrefix}-${run.runNumber}`
                            : `#${run.runNumber}`} · {statusLabel(run, t)}
                        </small>
                      </span>
                      <ArrowRight aria-hidden className="text-muted-foreground" size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="m-0 px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("lobby.noActivity")}
                </p>
              )}
            </section>
          </section>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent id="project-lobby">
      <PageHeader
        className={cn(
          "app-page-header [&_.page-header-title]:min-w-0",
          !isSidebarOpen && "sidebar-closed",
        )}
        data-tauri-drag-region="deep"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <TeamIcon className="size-5" project={project} />
            <span className="truncate">{project.name}</span>
          </span>
        }
      />
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto bg-background">
        <div className="mx-auto w-[min(1180px,calc(100%_-_64px))] py-11 pb-[72px] max-[980px]:w-[min(calc(100%_-_40px),900px)] max-[980px]:pt-8 max-[620px]:w-[calc(100%_-_28px)] max-[620px]:py-6 max-[620px]:pb-12">
          <section className="flex min-h-[122px] items-start justify-between gap-8 max-[620px]:mb-6 max-[620px]:min-h-0 max-[620px]:flex-col max-[620px]:gap-4">
            <div className="min-w-0">
              <span className="flex items-center gap-1.5 text-micro font-bold tracking-wide text-primary uppercase">
                <Sparkles aria-hidden size={14} />
                {periodLabel}
              </span>
              <h1 className="mt-3 mb-0 text-[clamp(28px,3vw,38px)] leading-[1.1] font-[680] tracking-[-.045em] text-foreground">
                {t("lobby.title")}
              </h1>
              <p className="mt-2.5 mb-0 text-sm leading-relaxed text-muted-foreground">
                {t("lobby.description", { project: project.name })}
              </p>
            </div>
            <button
              aria-label={t("lobby.refresh")}
              className="flex h-9 min-w-max cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-0 text-xs font-semibold text-muted-foreground shadow-xs hover:border-input hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60 max-[620px]:w-full max-[620px]:justify-center"
              disabled={usageLoading}
              onClick={() => void refreshUsage(true)}
              type="button"
            >
              <Spinner
                aria-hidden
                icon={RefreshCw}
                size={15}
                spinning={usageLoading}
              />
              <span>{t("lobby.refresh")}</span>
            </button>
          </section>

          <section
            aria-label={t("lobby.metrics")}
            className="grid grid-cols-4 overflow-hidden rounded-[18px] border border-border bg-card shadow-sm max-[980px]:grid-cols-2 max-[620px]:grid-cols-1 [&>article]:flex [&>article]:min-h-[156px] [&>article]:min-w-0 [&>article]:flex-col [&>article]:justify-center [&>article]:border-l [&>article]:border-border [&>article]:px-6 [&>article]:py-5 [&>article:first-child]:border-l-0 [&>article>span]:flex [&>article>span]:items-center [&>article>span]:gap-2 [&>article>span]:text-xs [&>article>span]:font-semibold [&>article>span]:text-muted-foreground [&>article>span_svg]:text-accent-foreground [&>article>strong]:mt-3.5 [&>article>strong]:truncate [&>article>strong]:font-mono [&>article>strong]:text-[clamp(26px,3vw,34px)] [&>article>strong]:leading-none [&>article>strong]:font-semibold [&>article>strong]:tracking-tighter [&>article>strong]:text-foreground [&>article>small]:mt-2.5 [&>article>small]:truncate [&>article>small]:text-micro [&>article>small]:leading-snug [&>article>small]:text-muted-foreground max-[980px]:[&>article]:min-h-[132px] max-[980px]:[&>article]:border-t max-[980px]:[&>article:nth-child(odd)]:border-l-0 max-[980px]:[&>article:nth-child(-n+2)]:border-t-0 max-[620px]:[&>article]:min-h-[120px] max-[620px]:[&>article]:border-t max-[620px]:[&>article]:border-l-0 max-[620px]:[&>article:first-child]:border-t-0"
          >
            <article className="bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_9%,var(--card)),var(--card)_74%)]">
              <span>
                <Sparkles aria-hidden size={16} />
                {t("lobby.tokens")}
              </span>
              <strong>{formatCompact(totalTokens, localeTag)}</strong>
              <small>
                {usageLoading && !usageSummary
                  ? t("lobby.loadingUsage")
                  : t("lobby.tokenRuns", {
                      count: reportedRuns,
                      total: observedRuns,
                    })}
              </small>
            </article>
            <article>
              <span>
                <Clock3 aria-hidden size={16} />
                {t("lobby.workTime")}
              </span>
              <strong>{formatUsageDuration(trackedDuration)}</strong>
              <small>{t("lobby.trackedTimeHint")}</small>
            </article>
            <article>
              <span>
                <CheckCircle2 aria-hidden size={16} />
                {t("lobby.completed")}
              </span>
              <strong>{formatCompact(completedIssues, localeTag)}</strong>
              <small>{t("lobby.completedHint", { period: periodLabel })}</small>
            </article>
            <article>
              <span>
                <CircleAlert aria-hidden size={16} />
                {t("lobby.active")}
              </span>
              <strong>{formatCompact(activeRuns.length, localeTag)}</strong>
              <small>
                {attentionRuns.length > 0
                  ? t("lobby.attentionCount", { count: attentionRuns.length })
                  : t("lobby.noAttention")}
              </small>
            </article>
          </section>

          {usageError ? (
            <p
              className="mt-3 mb-0 flex items-center gap-2 rounded-lg border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-2.5 py-2 text-micro text-[var(--status-destructive-foreground)]"
              role="status"
            >
              {t("lobby.usageUnavailable")}
              <span
                className="min-w-0 truncate text-muted-foreground"
                title={usageError}
              >
                {usageError}
              </span>
            </p>
          ) : null}

          <TeamMergeActivity
            projectId={project.id}
            repository={githubRepository}
            onLoad={onLoadMergeActivity}
            refreshKey={mergeRefreshKey}
          />

          <section
            className="mt-5 min-w-0 overflow-hidden rounded-[18px] border border-border bg-card shadow-sm [&_h2]:m-0 [&_h2]:text-md [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:m-0 [&_h3]:text-md [&_h3]:font-semibold [&_h3]:tracking-tight"
            aria-labelledby="project-analytics-title"
          >
            <header className="flex min-h-[86px] items-center justify-between gap-4 border-b border-border px-5 py-4 max-[620px]:items-stretch max-[620px]:flex-col">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-[38px] shrink-0 place-items-center rounded-xl border border-border bg-muted text-primary">
                  <BarChart3 aria-hidden size={18} />
                </span>
                <div className="min-w-0">
                  <h2 id="project-analytics-title">
                    {t("lobby.analyticsTitle")}
                  </h2>
                  <p className="mt-1 mb-0 text-micro leading-snug text-muted-foreground">
                    {t("lobby.analyticsDescription")}
                  </p>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-[620px]:w-full max-[620px]:justify-stretch">
                <div
                  aria-label={t("lobby.analyticsGranularity")}
                  className="flex shrink-0 items-center rounded-lg border border-border bg-muted p-0.5 max-[620px]:w-full [&>button]:h-[29px] [&>button]:cursor-pointer [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2.5 [&>button]:py-0 [&>button]:text-micro [&>button]:font-semibold [&>button]:text-muted-foreground [&>button]:hover:text-foreground [&>button]:disabled:cursor-not-allowed [&>button]:disabled:opacity-40 max-[620px]:[&>button]:flex-1"
                  role="group"
                >
                  {(["day", "week", "month"] as const).map((value) => {
                    const available = isTeamUsageDateRange(dateRange, value);
                    return (
                      <button
                        aria-pressed={period === value}
                        className={
                          period === value
                            ? "bg-card! text-foreground! shadow-xs"
                            : ""
                        }
                        disabled={!available}
                        key={value}
                        onClick={() => {
                          if (period === value) return;
                          usageRequest.current += 1;
                          setUsageSummary(null);
                          setPeriod(value);
                        }}
                        title={
                          !available
                            ? t("lobby.analyticsInvalidRange")
                            : undefined
                        }
                        type="button"
                      >
                        {t(`lobby.periodOption.${value}` as MessageKey)}
                      </button>
                    );
                  })}
                </div>
                <form
                  className="project-lobby-date-range flex min-h-[37px] min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card py-0 pr-0.5 pl-2 shadow-xs max-[620px]:grid max-[620px]:w-full max-[620px]:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-primary [&_label]:flex [&_label]:min-w-0 [&_label]:items-center [&_label]:gap-1 [&_label>span]:whitespace-nowrap [&_label>span]:text-micro [&_label>span]:font-semibold max-[620px]:[&_label>span]:sr-only [&_input]:h-[27px] [&_input]:w-28 [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-1 [&_input]:py-0 [&_input]:font-mono [&_input]:text-micro [&_input]:font-medium [&_input]:text-foreground [&_input]:hover:bg-muted [&_input[aria-invalid=true]]:bg-[var(--status-destructive-surface)] [&_input[aria-invalid=true]]:text-[var(--status-destructive-foreground)] max-[620px]:[&_input]:w-full [&>button]:h-[29px] [&>button]:cursor-pointer [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-primary [&>button]:px-2.5 [&>button]:py-0 [&>button]:text-micro [&>button]:font-semibold [&>button]:text-primary-foreground [&>button]:hover:brightness-95 [&>button]:disabled:cursor-not-allowed [&>button]:disabled:opacity-40"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyDateRange();
                  }}
                >
                  <CalendarDays aria-hidden size={15} />
                  <label>
                    <span>{t("lobby.analyticsFrom")}</span>
                    <input
                      aria-invalid={draftDateRange.from > draftDateRange.to}
                      max={
                        draftDateRange.to < today ? draftDateRange.to : today
                      }
                      name="from"
                      onChange={(event) =>
                        setDraftDateRange((current) => ({
                          ...current,
                          from: event.target.value,
                        }))
                      }
                      required
                      type="date"
                      value={draftDateRange.from}
                    />
                  </label>
                  <ArrowRight
                    aria-hidden
                    className="shrink-0 opacity-65"
                    size={13}
                  />
                  <label>
                    <span>{t("lobby.analyticsTo")}</span>
                    <input
                      aria-invalid={
                        draftDateRange.from > draftDateRange.to ||
                        draftDateRange.to > today
                      }
                      max={today}
                      min={draftDateRange.from}
                      name="to"
                      onChange={(event) =>
                        setDraftDateRange((current) => ({
                          ...current,
                          to: event.target.value,
                        }))
                      }
                      required
                      type="date"
                      value={draftDateRange.to}
                    />
                  </label>
                  <button
                    aria-label={
                      dateRangeValid
                        ? t("lobby.analyticsApply")
                        : t("lobby.analyticsInvalidRange")
                    }
                    disabled={
                      !dateRangeValid || !dateRangeChanged || usageLoading
                    }
                    title={
                      !dateRangeValid
                        ? t("lobby.analyticsInvalidRange")
                        : undefined
                    }
                    type="submit"
                  >
                    {t("lobby.analyticsApply")}
                  </button>
                </form>
              </div>
            </header>
            <div className="overflow-x-auto px-5 pt-5 pb-3 max-[620px]:px-3.5">
              <div className="flex min-w-[768px] justify-end gap-4 px-12 pl-10 text-micro text-muted-foreground [&>span]:flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:before:size-2 [&>span]:before:rounded-sm [&>span]:before:bg-accent-foreground [&>span]:before:content-['']">
                <span>{t("lobby.completedIssuesLegend")}</span>
                <span className="before:bg-success!">
                  {t("lobby.tokensLegend")}
                </span>
              </div>
              <div className="mt-3 grid min-w-[768px] grid-cols-[40px_minmax(0,1fr)_48px] items-start gap-x-1.5">
                <div
                  aria-hidden
                  className="relative mt-2 h-[168px] font-mono text-micro leading-none text-accent-foreground select-none [&>span]:absolute [&>span]:right-0 [&>span]:translate-y-1/2 [&>span]:whitespace-nowrap"
                >
                  {issueTicks.map((value) => (
                    <span
                      key={`issues-${value}`}
                      style={{
                        bottom: `${(value / maxIssues) * 100}%`,
                      }}
                    >
                      {formatAxisValue(value, localeTag)}
                    </span>
                  ))}
                </div>
                <div
                  aria-label={t("lobby.analyticsChartLabel", {
                    period: periodLabel,
                  })}
                  className="grid h-[210px] min-w-0 items-stretch gap-1.5 border-b border-border bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_41px,color-mix(in_srgb,var(--border)_65%,transparent)_42px)] bg-[length:100%_168px] bg-[position:0_8px] bg-no-repeat"
                  role="list"
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(timeline.length, 1)}, minmax(34px, 1fr))`,
                  }}
                >
                  {timeline.map((point) => {
                    const label = bucketLabel(point.startAt);
                    return (
                      <div
                        aria-label={t("lobby.analyticsPoint", {
                          date: label,
                          issues: point.completedIssues,
                          tokens: formatCompact(point.totalTokens, localeTag),
                        })}
                        className="grid min-w-0 grid-rows-[176px_33px] items-end"
                        key={point.startAt}
                        role="listitem"
                        title={t("lobby.analyticsPoint", {
                          date: label,
                          issues: point.completedIssues,
                          tokens: formatCompact(point.totalTokens, localeTag),
                        })}
                      >
                        <div
                          className="flex h-[168px] items-end justify-center gap-0.5"
                          aria-hidden
                        >
                          <i
                            className="w-[min(12px,42%)] rounded-t bg-accent-foreground"
                            style={{
                              height: `${(point.completedIssues / maxIssues) * 100}%`,
                            }}
                          />
                          <i
                            className="w-[min(12px,42%)] rounded-t bg-success"
                            style={{
                              height: `${(point.totalTokens / maxTokens) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="truncate text-center font-mono text-micro leading-[33px] text-muted-foreground">
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div
                  aria-hidden
                  className="relative mt-2 h-[168px] font-mono text-micro leading-none text-[var(--status-success-foreground)] select-none [&>span]:absolute [&>span]:left-0 [&>span]:translate-y-1/2 [&>span]:whitespace-nowrap"
                >
                  {tokenTicks.map((value) => (
                    <span
                      key={`tokens-${value}`}
                      style={{
                        bottom: `${(value / maxTokens) * 100}%`,
                      }}
                    >
                      {formatAxisValue(value, localeTag)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-border max-[980px]:grid-cols-1 [&>section]:min-w-0 [&>section]:p-5 [&>section+section]:border-l [&>section+section]:border-border [&>section+section_i]:from-[var(--status-success-foreground)] [&>section+section_i]:to-success max-[980px]:[&>section+section]:border-t max-[980px]:[&>section+section]:border-l-0 [&_p]:mt-1 [&_p]:mb-0 [&_p]:text-micro [&_p]:leading-snug [&_p]:text-muted-foreground">
              <section>
                <h3>{t("lobby.issueCreatorsTitle")}</h3>
                <p>{t("lobby.issueCreatorsDescription")}</p>
                {renderBreakdown(issueCreators, t("lobby.unknownCreator"))}
              </section>
              <section>
                <h3>{t("lobby.agentsTitle")}</h3>
                <p>{t("lobby.agentsDescription")}</p>
                {renderBreakdown(agents, t("lobby.unknownAgent"))}
              </section>
            </div>
          </section>

          <div className="mt-5 grid grid-cols-[minmax(0,1.35fr)_minmax(290px,.65fr)] items-start gap-5 max-[980px]:grid-cols-1">
            <section className="repository-panel min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
              <header className="flex min-h-[76px] items-center gap-3 border-b border-border px-5 py-4">
                <span className="grid size-[38px] shrink-0 place-items-center rounded-xl border border-border bg-muted text-primary">
                  <Github aria-hidden size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="m-0 text-md font-semibold tracking-tight">
                    {t("lobby.githubTitle")}
                  </h2>
                  <p className="mt-1 mb-0 text-micro leading-snug text-muted-foreground">
                    {t("lobby.githubDescription")}
                  </p>
                </div>
                <span
                  className={cn(
                    "ml-auto min-w-max rounded-full px-2 py-1 text-micro font-semibold max-[620px]:hidden",
                    repositoryState === "ready" &&
                      "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]",
                    repositoryState === "attention" &&
                      "bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]",
                    (repositoryState === "optional" ||
                      repositoryState === "unknown") &&
                      "bg-muted text-muted-foreground",
                  )}
                >
                  {repositoryState === "ready"
                    ? t("lobby.connected")
                    : repositoryState === "optional"
                      ? t("common.optional")
                      : repositoryState === "unknown"
                        ? t("common.checkNeeded")
                        : t("lobby.needsConnection")}
                </span>
              </header>
              <div className="flex min-h-[126px] items-center justify-between gap-6 p-5 max-[620px]:items-stretch max-[620px]:flex-col max-[620px]:gap-4">
                <div className="grid min-w-0 gap-1.5">
                  <small className="text-micro font-semibold text-muted-foreground">
                    {t("lobby.repository")}
                  </small>
                  <strong className="truncate font-mono text-md font-semibold text-foreground">
                    {githubRepository ?? t("lobby.noRepository")}
                  </strong>
                  <span className="text-micro leading-snug text-muted-foreground">
                    {repositoryState === "unknown"
                      ? t("common.checkNeeded")
                      : repositoryState === "optional"
                        ? t("lobby.githubOptional")
                        : connectsOnDesktop
                          ? t("health.desktopOnly")
                          : repositoryReady
                            ? t("lobby.githubReady")
                            : t("lobby.githubSetupHint")}
                  </span>
                </div>
                {!githubOptional ? (
                  <button
                    className="flex h-8 min-w-max cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-0 text-micro font-semibold text-foreground hover:border-input hover:bg-accent max-[620px]:justify-center"
                    disabled={connectsOnDesktop}
                    onClick={onOpenRepository}
                    type="button"
                  >
                    {connectsOnDesktop
                      ? t("lobby.connectOnDesktop")
                      : repositoryState === "unknown"
                        ? t("repositorySetup.recheck")
                        : repositoryReady
                          ? t("lobby.manageConnection")
                          : t("lobby.connectRepository")}
                    <ArrowRight aria-hidden size={14} />
                  </button>
                ) : null}
              </div>
            </section>

            <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
              <header className="flex min-h-[76px] items-center gap-3 border-b border-border px-5 py-4">
                <span className="grid size-[38px] shrink-0 place-items-center rounded-xl border border-border bg-muted text-primary">
                  <Home aria-hidden size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="m-0 text-md font-semibold tracking-tight">
                    {t("lobby.quickActions")}
                  </h2>
                  <p className="mt-1 mb-0 text-micro leading-snug text-muted-foreground">
                    {t("lobby.quickActionsDescription")}
                  </p>
                </div>
              </header>
              <div className="grid p-1.5 [&>button]:grid [&>button]:min-h-[59px] [&>button]:min-w-0 [&>button]:cursor-pointer [&>button]:grid-cols-[32px_minmax(0,1fr)_16px] [&>button]:items-center [&>button]:gap-2 [&>button]:rounded-lg [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2.5 [&>button]:py-2 [&>button]:text-left [&>button]:text-muted-foreground [&>button]:hover:bg-muted [&>button]:hover:text-foreground [&>button>svg:first-child]:size-8 [&>button>svg:first-child]:rounded-lg [&>button>svg:first-child]:border [&>button>svg:first-child]:border-border [&>button>svg:first-child]:bg-card [&>button>svg:first-child]:p-1.5 [&>button>svg:first-child]:text-primary [&>button>span]:grid [&>button>span]:min-w-0 [&>button>span]:gap-0.5 [&_strong]:truncate [&_strong]:text-xs [&_strong]:text-foreground [&_small]:truncate [&_small]:text-micro [&_small]:text-muted-foreground">
                <button onClick={onOpenIssues} type="button">
                  <ListTodo aria-hidden size={17} />
                  <span>
                    <strong>{t("sidebar.issues")}</strong>
                    <small>{t("lobby.openIssues")}</small>
                  </span>
                  <ArrowRight aria-hidden size={14} />
                </button>
                <button onClick={onOpenAgents} type="button">
                  <Bot aria-hidden size={17} />
                  <span>
                    <strong>{t("sidebar.agents")}</strong>
                    <small>{t("lobby.openAgents")}</small>
                  </span>
                  <ArrowRight aria-hidden size={14} />
                </button>
                <button onClick={onOpenSettings} type="button">
                  <Settings aria-hidden size={17} />
                  <span>
                    <strong>{t("sidebar.projectSettings")}</strong>
                    <small>{t("lobby.openSettings")}</small>
                  </span>
                  <ArrowRight aria-hidden size={14} />
                </button>
              </div>
            </section>

            <section className="col-span-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-xs max-[980px]:col-auto">
              <header className="flex min-h-[76px] items-center gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-md font-semibold tracking-tight">
                    {t("lobby.recentActivity")}
                  </h2>
                  <p className="mt-1 mb-0 text-micro leading-snug text-muted-foreground">
                    {t("lobby.recentActivityDescription")}
                  </p>
                </div>
                <button
                  className="flex h-8 min-w-max cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-0 text-micro font-semibold text-foreground hover:border-input hover:bg-accent"
                  onClick={onOpenIssues}
                  type="button"
                >
                  {t("lobby.viewAll")}
                  <ArrowRight aria-hidden size={14} />
                </button>
              </header>
              {recentRuns.length > 0 ? (
                <div className="project-lobby-activity-list grid">
                  {recentRuns.map((run) => (
                    <button
                      className="grid min-h-[66px] min-w-0 cursor-pointer grid-cols-[9px_minmax(0,1fr)_auto_16px] items-center gap-3 border-0 border-t border-border bg-transparent px-5 py-2.5 text-left text-muted-foreground first:border-t-0 hover:bg-muted max-[620px]:grid-cols-[9px_minmax(0,1fr)_14px]"
                      key={run.id}
                      onClick={() => onOpenIssue(run.id)}
                      type="button"
                    >
                      <span
                        className={cn(
                          "size-2 rounded-full bg-muted-foreground shadow-[0_0_0_3px_color-mix(in_srgb,var(--muted-foreground)_15%,transparent)]",
                          (run.status === "running" ||
                            run.status === "queued") &&
                            "bg-accent-foreground shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-foreground)_13%,transparent)]",
                          run.status === "completed" &&
                            "bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_13%,transparent)]",
                          (run.status === "blocked" ||
                            run.status === "failed") &&
                            "bg-destructive shadow-[0_0_0_3px_color-mix(in_srgb,var(--destructive)_13%,transparent)]",
                          run.status === "paused" &&
                            "bg-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_13%,transparent)]",
                        )}
                        aria-hidden
                      />
                      <IssueDifficultyIcon
                        className="grid size-5 shrink-0 place-items-center rounded-md border border-current/25 bg-current/10"
                        difficulty={run.difficulty}
                        size={12}
                      />
                      <span className="grid min-w-0 gap-1">
                        <strong className="truncate text-xs font-semibold text-foreground">
                          {run.title}
                        </strong>
                        <small className="flex items-center gap-1 text-micro text-muted-foreground">
                          {project.issueKeyPrefix
                            ? `${project.issueKeyPrefix}-${run.runNumber}`
                            : `#${run.runNumber}`}
                          <i>·</i>
                          {statusLabel(run, t)}
                        </small>
                      </span>
                      <time
                        className="font-mono text-micro font-medium text-muted-foreground max-[620px]:hidden"
                        dateTime={run.lastEventAt}
                      >
                        {dateFormatter.format(
                          Date.parse(run.lastEventAt || run.updatedAt),
                        )}
                      </time>
                      <ArrowRight aria-hidden size={14} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center p-7 text-center text-muted-foreground">
                  <ListTodo aria-hidden size={22} />
                  <strong className="mt-2.5 text-xs text-foreground">
                    {t("lobby.noActivity")}
                  </strong>
                  <p className="mt-1.5 mb-0 text-micro">
                    {t("lobby.noActivityDescription")}
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </MainContent>
  );
}
