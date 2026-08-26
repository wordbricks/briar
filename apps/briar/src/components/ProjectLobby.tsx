import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleAlert,
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
import { ProjectIcon } from "./ProjectIcon";
import { IssueDifficultyIcon } from "./hunt/IssueDifficultyIcon";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { formatUsageDuration } from "../lib/agent-usage";
import type { RepositoryReadiness } from "../lib/project-connection";
import {
  isLocalProjectRepositoryReady,
  localProjectReadiness,
  type LocalProjectConnectionState,
} from "../lib/local-project-connection";
import {
  projectTrackedDuration as trackedDurationForRange,
  summarizeProjectUsage,
  type ProjectUsageBreakdownItem,
  type ProjectUsagePeriod,
  type ProjectUsageSummaryRun,
  type ProjectUsageSummaryLoadOptions,
} from "../lib/project-usage-summary";
import type {
  DashboardPayload,
  HuntRun,
  Project,
  ProjectUsageSummary,
} from "../types";

const defaultPeriod: ProjectUsagePeriod = "day";
const activeStatuses = new Set(["queued", "running", "paused"]);
const attentionStatuses = new Set(["blocked", "failed"]);

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

export function projectTrackedDuration(
  runs: readonly ProjectUsageSummaryRun[],
  now: number,
) {
  return trackedDurationForRange(runs, defaultPeriod, now);
}

function breakdownLabel(
  item: ProjectUsageBreakdownItem,
  fallback: string,
) {
  return item.name?.trim() || item.id?.trim() || fallback;
}

function statusLabel(run: HuntRun, t: ReturnType<typeof useI18n>["t"]) {
  const key = `status.${run.status}` as MessageKey;
  return t(key);
}

export function ProjectLobby({
  connectionState,
  dashboard,
  isSidebarOpen,
  onLoadUsageSummary,
  onOpenAgents,
  onOpenIssue,
  onOpenIssues,
  onOpenRepository,
  onOpenSettings,
  project,
  readiness,
  requiresLocalReadiness,
}: {
  connectionState: LocalProjectConnectionState;
  dashboard: DashboardPayload | null;
  isSidebarOpen: boolean;
  onLoadUsageSummary: (
    projectId: string,
    period: ProjectUsagePeriod,
    options?: ProjectUsageSummaryLoadOptions,
  ) => Promise<ProjectUsageSummary | null>;
  onOpenAgents: () => void;
  onOpenIssue: (runId: string) => void;
  onOpenIssues: () => void;
  onOpenRepository: () => void;
  onOpenSettings: () => void;
  project: Project;
  readiness: RepositoryReadiness | null;
  requiresLocalReadiness: boolean;
}) {
  const { localeTag, t } = useI18n();
  const [usageSummary, setUsageSummary] =
    useState<ProjectUsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [period, setPeriod] = useState<ProjectUsagePeriod>(defaultPeriod);
  const [now, setNow] = useState(Date.now);
  const usageRequest = useRef(0);

  const refreshUsage = useCallback(async (force = false) => {
    const request = ++usageRequest.current;
    setUsageLoading(true);
    setUsageError(null);
    try {
      const summary = await onLoadUsageSummary(project.id, period, { force });
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
  }, [onLoadUsageSummary, period, project.id]);

  useEffect(() => {
    setUsageSummary(null);
    setUsageError(null);
    void refreshUsage();
  }, [period, project.id, refreshUsage]);

  const dashboardRuns = dashboard?.project.id === project.id
    ? dashboard.runs
    : [];
  const dashboardUsage = useMemo(
    () => summarizeProjectUsage(dashboardRuns, period, now),
    [dashboardRuns, now, period],
  );
  const totalTokens = usageSummary?.totalTokens ??
    dashboardUsage.totalTokens;
  const observedRuns = usageSummary?.observedRuns ?? dashboardUsage.observedRuns;
  const reportedRuns = usageSummary?.reportedRuns ?? dashboardUsage.reportedRuns;
  const trackedDuration = usageSummary?.trackedDurationMs ??
    trackedDurationForRange(dashboardRuns, period, now);
  const completedIssues = usageSummary?.completedIssues ??
    dashboardUsage.completedIssues;
  const timeline = usageSummary?.timeline ?? dashboardUsage.timeline;
  const issueCreators = usageSummary?.issueCreators ?? dashboardUsage.issueCreators;
  const agents = usageSummary?.agents ?? dashboardUsage.agents;
  const activeRuns = dashboardRuns.filter((run) => activeStatuses.has(run.status));
  const attentionRuns = dashboardRuns.filter((run) =>
    attentionStatuses.has(run.status)
  );
  const recentRuns = [...dashboardRuns]
    .sort(
      (left, right) =>
        Date.parse(right.lastEventAt || right.updatedAt) -
        Date.parse(left.lastEventAt || left.updatedAt),
    )
    .slice(0, 5);
  const inspectedReadiness = requiresLocalReadiness
    ? localProjectReadiness(connectionState, readiness)
    : readiness;
  const githubRepository = inspectedReadiness?.githubRepository ??
    (dashboard?.project.id === project.id
      ? dashboard.settings.githubRepository
      : null);
  const localSetupReady = Boolean(
    (!requiresLocalReadiness || connectionState === "connected") &&
      (requiresLocalReadiness
        ? isLocalProjectRepositoryReady(inspectedReadiness)
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
  const periodLabel = t(`lobby.period.${period}` as MessageKey);
  const bucketLabel = (startAt: string) => {
    const timestamp = Date.parse(startAt);
    return period === "month"
      ? analyticsMonthFormatter.format(timestamp)
      : analyticsDayFormatter.format(timestamp);
  };
  const renderBreakdown = (
    items: readonly ProjectUsageBreakdownItem[],
    fallback: string,
  ) => {
    const max = Math.max(1, ...items.map((item) => item.issues));
    if (items.length === 0) {
      return <p className="project-lobby-analytics-empty">{t("lobby.analyticsEmpty")}</p>;
    }
    return (
      <ol className="project-lobby-breakdown-list">
        {items.map((item, index) => (
          <li key={`${item.id ?? item.name ?? "unknown"}-${index}`}>
            <span>{breakdownLabel(item, fallback)}</span>
            <strong>{t("lobby.issueCount", { count: item.issues })}</strong>
            <i aria-hidden style={{ width: `${(item.issues / max) * 100}%` }} />
          </li>
        ))}
      </ol>
    );
  };

  return (
    <MainContent id="project-lobby">
      <PageHeader
        className={`app-page-header project-lobby-header${
          isSidebarOpen ? "" : " sidebar-closed"
        }`}
        data-tauri-drag-region="deep"
        title={
          <span className="project-lobby-title">
            <ProjectIcon className="size-5" project={project} />
            <span>{project.name}</span>
          </span>
        }
      />
      <div className="project-lobby-scroll">
        <div className="project-lobby-content">
          <section className="project-lobby-intro">
            <div>
              <span className="project-lobby-kicker">
                <Sparkles aria-hidden size={14} />
                {periodLabel}
              </span>
              <h1>{t("lobby.title")}</h1>
              <p>{t("lobby.description", { project: project.name })}</p>
            </div>
            <button
              aria-label={t("lobby.refresh")}
              className="project-lobby-refresh"
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

          <section aria-label={t("lobby.metrics")} className="project-lobby-metrics">
            <article className="project-lobby-metric primary">
              <span><Sparkles aria-hidden size={16} />{t("lobby.tokens")}</span>
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
            <article className="project-lobby-metric">
              <span><Clock3 aria-hidden size={16} />{t("lobby.workTime")}</span>
              <strong>{formatUsageDuration(trackedDuration)}</strong>
              <small>{t("lobby.trackedTimeHint")}</small>
            </article>
            <article className="project-lobby-metric">
              <span><CheckCircle2 aria-hidden size={16} />{t("lobby.completed")}</span>
              <strong>{formatCompact(completedIssues, localeTag)}</strong>
              <small>{t("lobby.completedHint", { period: periodLabel })}</small>
            </article>
            <article className="project-lobby-metric">
              <span><CircleAlert aria-hidden size={16} />{t("lobby.active")}</span>
              <strong>{formatCompact(activeRuns.length, localeTag)}</strong>
              <small>
                {attentionRuns.length > 0
                  ? t("lobby.attentionCount", { count: attentionRuns.length })
                  : t("lobby.noAttention")}
              </small>
            </article>
          </section>

          {usageError ? (
            <p className="project-lobby-usage-error" role="status">
              {t("lobby.usageUnavailable")}
              <span title={usageError}>{usageError}</span>
            </p>
          ) : null}

          <section className="project-lobby-analytics" aria-labelledby="project-analytics-title">
            <header>
              <div>
                <span className="project-lobby-panel-icon"><BarChart3 aria-hidden size={18} /></span>
                <div>
                  <h2 id="project-analytics-title">{t("lobby.analyticsTitle")}</h2>
                  <p>{t("lobby.analyticsDescription")}</p>
                </div>
              </div>
              <div
                aria-label={t("lobby.analyticsPeriod")}
                className="project-lobby-period-picker"
                role="group"
              >
                {(["day", "week", "month"] as const).map((value) => (
                  <button
                    aria-pressed={period === value}
                    className={period === value ? "active" : ""}
                    key={value}
                    onClick={() => {
                      usageRequest.current += 1;
                      setUsageSummary(null);
                      setPeriod(value);
                    }}
                    type="button"
                  >
                    {t(`lobby.periodOption.${value}` as MessageKey)}
                  </button>
                ))}
              </div>
            </header>
            <div className="project-lobby-chart-wrap">
              <div className="project-lobby-chart-legend" aria-hidden>
                <span className="issues">{t("lobby.completedIssuesLegend")}</span>
                <span className="tokens">{t("lobby.tokensLegend")}</span>
              </div>
              <div className="project-lobby-chart-body">
                <div
                  aria-hidden
                  className="project-lobby-chart-y-axis issues"
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
                  aria-label={t("lobby.analyticsChartLabel", { period: periodLabel })}
                  className="project-lobby-chart"
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
                        className="project-lobby-chart-column"
                        key={point.startAt}
                        role="listitem"
                        title={t("lobby.analyticsPoint", {
                          date: label,
                          issues: point.completedIssues,
                          tokens: formatCompact(point.totalTokens, localeTag),
                        })}
                      >
                        <div className="project-lobby-chart-bars" aria-hidden>
                          <i
                            className="issues"
                            style={{
                              height: `${(point.completedIssues / maxIssues) * 100}%`,
                            }}
                          />
                          <i
                            className="tokens"
                            style={{
                              height: `${(point.totalTokens / maxTokens) * 100}%`,
                            }}
                          />
                        </div>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
                <div
                  aria-hidden
                  className="project-lobby-chart-y-axis tokens"
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
            <div className="project-lobby-breakdowns">
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

          <div className="project-lobby-grid">
            <section className="project-lobby-panel repository-panel">
              <header>
                <span className="project-lobby-panel-icon"><Github aria-hidden size={18} /></span>
                <div>
                  <h2>{t("lobby.githubTitle")}</h2>
                  <p>{t("lobby.githubDescription")}</p>
                </div>
                <span className={`project-lobby-state ${repositoryState}`}>
                  {repositoryState === "ready"
                    ? t("lobby.connected")
                    : repositoryState === "optional"
                      ? t("common.optional")
                    : repositoryState === "unknown"
                      ? t("common.checkNeeded")
                      : t("lobby.needsConnection")}
                </span>
              </header>
              <div className="project-lobby-repository">
                <div>
                  <small>{t("lobby.repository")}</small>
                  <strong>{githubRepository ?? t("lobby.noRepository")}</strong>
                  <span>
                    {repositoryState === "unknown"
                      ? t("common.checkNeeded")
                      : repositoryState === "optional"
                        ? t("lobby.githubOptional")
                      : connectsOnDesktop
                        ? t("health.desktopOnly")
                      : inspectedReadiness?.ghAccount
                        ? t("lobby.githubAccount", {
                            account: inspectedReadiness.ghAccount,
                          })
                        : repositoryReady
                          ? t("lobby.githubReady")
                          : t("lobby.githubSetupHint")}
                  </span>
                </div>
                {!githubOptional ? (
                  <button
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

            <section className="project-lobby-panel quick-panel">
              <header>
                <span className="project-lobby-panel-icon"><Home aria-hidden size={18} /></span>
                <div>
                  <h2>{t("lobby.quickActions")}</h2>
                  <p>{t("lobby.quickActionsDescription")}</p>
                </div>
              </header>
              <div className="project-lobby-actions">
                <button onClick={onOpenIssues} type="button">
                  <ListTodo aria-hidden size={17} />
                  <span><strong>{t("sidebar.issues")}</strong><small>{t("lobby.openIssues")}</small></span>
                  <ArrowRight aria-hidden size={14} />
                </button>
                <button onClick={onOpenAgents} type="button">
                  <Bot aria-hidden size={17} />
                  <span><strong>{t("sidebar.agents")}</strong><small>{t("lobby.openAgents")}</small></span>
                  <ArrowRight aria-hidden size={14} />
                </button>
                <button onClick={onOpenSettings} type="button">
                  <Settings aria-hidden size={17} />
                  <span><strong>{t("sidebar.projectSettings")}</strong><small>{t("lobby.openSettings")}</small></span>
                  <ArrowRight aria-hidden size={14} />
                </button>
              </div>
            </section>

            <section className="project-lobby-panel activity-panel">
              <header>
                <div>
                  <h2>{t("lobby.recentActivity")}</h2>
                  <p>{t("lobby.recentActivityDescription")}</p>
                </div>
                <button onClick={onOpenIssues} type="button">
                  {t("lobby.viewAll")}<ArrowRight aria-hidden size={14} />
                </button>
              </header>
              {recentRuns.length > 0 ? (
                <div className="project-lobby-activity-list">
                  {recentRuns.map((run) => (
                    <button key={run.id} onClick={() => onOpenIssue(run.id)} type="button">
                      <span className={`project-lobby-status-dot ${run.status}`} aria-hidden />
                      <IssueDifficultyIcon difficulty={run.difficulty} size={12} />
                      <span>
                        <strong>{run.title}</strong>
                        <small>
                          {project.issueKeyPrefix
                            ? `${project.issueKeyPrefix}-${run.runNumber}`
                            : `#${run.runNumber}`}
                          <i>·</i>
                          {statusLabel(run, t)}
                        </small>
                      </span>
                      <time dateTime={run.lastEventAt}>
                        {dateFormatter.format(Date.parse(run.lastEventAt || run.updatedAt))}
                      </time>
                      <ArrowRight aria-hidden size={14} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="project-lobby-empty">
                  <ListTodo aria-hidden size={22} />
                  <strong>{t("lobby.noActivity")}</strong>
                  <p>{t("lobby.noActivityDescription")}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </MainContent>
  );
}
