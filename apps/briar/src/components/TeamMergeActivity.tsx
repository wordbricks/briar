import { GitMerge, Github, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  MERGE_ACTIVITY_DAY,
  MERGE_ACTIVITY_HOUR,
  summarizeMergeActivity,
  type TeamMergeActivity as MergeActivity,
  type TeamMergeActivityLoader,
} from "../lib/team-merge-activity";
import { Spinner } from "./ui/spinner";
import "./TeamMergeActivity.css";

function MergeDots({ count, unit, muted = false }: { count: number; unit: number; muted?: boolean }) {
  return (
    <div aria-hidden className={`merge-activity-dots${muted ? " is-muted" : ""}`}>
      {Array.from({ length: Math.ceil(count / unit) }, (_, index) => (
        <i key={index} style={{ opacity: Math.min(1, (count - index * unit) / unit) }} />
      ))}
    </div>
  );
}

export function TeamMergeActivity({ projectId, repository, onLoad, refreshKey = 0 }: {
  projectId: string;
  repository: string | null | undefined;
  onLoad?: TeamMergeActivityLoader;
  refreshKey?: number;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ projectId: string; repository: string; activity: MergeActivity } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const activity = result?.projectId === projectId && result.repository === repository ? result.activity : null;

  useEffect(() => {
    if (!repository || !onLoad) return;
    const controller = new AbortController();
    setStatus("loading");
    setResult(null);
    void onLoad(projectId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setResult({ projectId, repository, activity: value });
      setStatus("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("error");
    });
    return () => controller.abort();
  }, [projectId, repository, onLoad, refreshKey, attempt]);

  return (
    <section className="merge-activity" aria-labelledby="project-merge-activity-title" aria-busy={Boolean(repository && onLoad && status === "loading")}>
      <header className="merge-activity-header">
        <div className="merge-activity-heading">
          <span className="merge-activity-icon"><GitMerge aria-hidden size={18} /></span>
          <div>
            <h2 id="project-merge-activity-title">{t("lobby.merges.title")}</h2>
            <p>{t("lobby.merges.description")}</p>
          </div>
        </div>
        <span className="merge-activity-period">{t("lobby.merges.last24Hours")}</span>
      </header>
      {!repository ? (
        <p className="merge-activity-state"><Github aria-hidden size={20} />{t("lobby.merges.connect")}</p>
      ) : !onLoad || status === "error" ? (
        <div className="merge-activity-state" role="status">
          <p>{t("lobby.merges.unavailable")}</p>
          {onLoad ? <button className="merge-activity-retry" onClick={() => setAttempt((value) => value + 1)} type="button"><RefreshCw aria-hidden size={14} />{t("lobby.merges.retry")}</button> : null}
        </div>
      ) : !activity ? (
        <p className="merge-activity-state" role="status"><Spinner className="size-[18px]" />{t("lobby.merges.loading")}</p>
      ) : <MergeActivityCharts activity={activity} />}
    </section>
  );
}

function MergeActivityCharts({ activity }: { activity: MergeActivity }) {
  const { localeTag, t } = useI18n();
  const summary = useMemo(() => summarizeMergeActivity(activity), [activity]);
  const [selected, setSelected] = useState<number | null>(null);
  const number = (value: number, digits = 1) => new Intl.NumberFormat(localeTag, { maximumFractionDigits: digits }).format(value);
  const date = (timestamp: number) => new Intl.DateTimeFormat(localeTag, { month: "short", day: "numeric", timeZone: "UTC" }).format(timestamp);
  const time = (timestamp: number) => new Intl.DateTimeFormat(localeTag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(timestamp);
  const dateTime = (timestamp: number) => `${date(timestamp)} ${time(timestamp)}`;
  const count = summary.current.length;
  const dotUnit = Math.max(1, Math.ceil(Math.max(count, summary.median) / 150));
  const maximum = Math.max(4, Math.ceil(Math.max(summary.maximum, ...summary.timeline.map((point) => point.count)) / 4) * 4);
  const plot = { left: 42, right: 918, top: 26, bottom: 174 };
  const x = (index: number) => plot.left + index / (summary.timeline.length - 1) * (plot.right - plot.left);
  const y = (value: number) => plot.bottom - value / maximum * (plot.bottom - plot.top);
  const line = summary.timeline.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.count)}`).join(" ");
  const lastIndex = summary.timeline.length - 1;
  const selectedIndex = selected ?? lastIndex;
  const point = summary.timeline[selectedIndex];
  const busiest = summary.busiestHour;

  return (
    <div className="merge-activity-body">
      <div className="merge-activity-summary">
        <div className="merge-activity-current">
          <span className="merge-activity-eyebrow">{t("lobby.merges.merged")}</span>
          <strong className="merge-activity-number">{number(count, 0)}<small>PRs</small></strong>
          <span className="merge-activity-caption">{t("lobby.merges.last24Hours")}</span>
          <MergeDots count={count} unit={dotUnit} />
        </div>
        <div className="merge-activity-baseline">
          <span className="merge-activity-eyebrow">{t("lobby.merges.baseline")}</span>
          <strong className="merge-activity-number">{number(summary.median)}<small>PRs</small></strong>
          <span className="merge-activity-caption">{t("lobby.merges.medianHint")}</span>
          <MergeDots count={summary.median} unit={dotUnit} muted />
        </div>
        <div className="merge-activity-rate">
          <span className="merge-activity-eyebrow">{t("lobby.merges.relativeRate")}</span>
          <strong className="merge-activity-number">{summary.multiplier === null ? "—" : number(summary.multiplier)}{summary.multiplier !== null ? <small>×</small> : null}</strong>
          <span className="merge-activity-caption">{t(summary.multiplier === null ? "lobby.merges.noBaseline" : "lobby.merges.rateHint")}</span>
          <span className="merge-activity-dot-key"><i />{t("lobby.merges.dotKey", { count: dotUnit })}</span>
        </div>
      </div>

      <dl className="merge-activity-stats">
        {[
          [number(summary.mean), t("lobby.merges.mean")],
          [number(summary.p75), t("lobby.merges.p75")],
          [number(summary.p90), t("lobby.merges.p90")],
          [number(summary.maximum), t("lobby.merges.maximum")],
          [`${number(summary.reachedPercent)}%`, t("lobby.merges.reached", { count })],
        ].map(([value, label]) => <div key={label}><dd>{value}</dd><dt>{label}</dt></div>)}
      </dl>

      <div className="merge-activity-chart-heading">
        <h3>{t("lobby.merges.landed")}</h3>
        <span>{dateTime(summary.currentStart)} – {dateTime(summary.now)} UTC</span>
      </div>
      <div className="merge-activity-rug" aria-label={t("lobby.merges.landed")}>
        {summary.current.map((pr) => (
          <a
            key={pr.number}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="merge-activity-pr"
            style={{ left: `${(pr.timestamp - summary.currentStart) / MERGE_ACTIVITY_DAY * 100}%` }}
            title={`#${pr.number} ${pr.title} · ${dateTime(pr.timestamp)} UTC`}
            aria-label={`#${pr.number} ${pr.title} · ${time(pr.timestamp)} UTC`}
          ><i /></a>
        ))}
        {count === 0 ? <span className="merge-activity-no-merges">{t("lobby.merges.empty")}</span> : null}
      </div>
      <div className="merge-activity-hours" aria-hidden>
        {summary.hours.map((hour) => <i key={hour.timestamp} style={{ height: `${hour.count / Math.max(1, busiest.count) * 100}%` }} title={`${time(hour.timestamp)} · ${hour.count} PRs`} />)}
      </div>
      <div className="merge-activity-time-axis" aria-hidden>
        {[0, 6, 12, 18, 24].map((hour) => <span key={hour}>{time(summary.currentStart + hour * MERGE_ACTIVITY_HOUR)}</span>)}
      </div>
      <p className="merge-activity-note">{t("lobby.merges.timelineHint")}{count > 0 ? ` ${t("lobby.merges.busiest", { from: time(busiest.timestamp), to: time(busiest.timestamp + MERGE_ACTIVITY_HOUR), count: busiest.count })}` : ""}</p>

      <div className="merge-activity-chart-heading merge-activity-trend-heading">
        <h3>{t("lobby.merges.trend")}</h3>
        <span className={selected === null ? "merge-activity-now" : ""} aria-live="polite">{selected === null ? t("lobby.merges.now") : `${dateTime(point.timestamp)} UTC`} · {number(point.count, 0)} PRs</span>
      </div>
      <svg
        className="merge-activity-trend"
        viewBox="0 0 960 204"
        role="slider"
        tabIndex={0}
        aria-label={t("lobby.merges.trend")}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={selectedIndex}
        aria-valuetext={`${dateTime(point.timestamp)} UTC, ${point.count} PRs`}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = (event.clientX - bounds.left) / bounds.width * 960;
          setSelected(Math.max(0, Math.min(lastIndex, Math.round((position - plot.left) / (plot.right - plot.left) * lastIndex))));
        }}
        onMouseLeave={() => setSelected(null)}
        onBlur={() => setSelected(null)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setSelected(event.key === "Home" ? 0 : event.key === "End" ? lastIndex : Math.max(0, Math.min(lastIndex, selectedIndex + (event.key === "ArrowLeft" ? -1 : 1))));
        }}
      >
        {[0, 1, 2, 3, 4].map((tick) => <g key={tick}>
          <line x1={plot.left} x2={plot.right} y1={y(tick * maximum / 4)} y2={y(tick * maximum / 4)} className="merge-activity-grid" />
          <text x={plot.left - 12} y={y(tick * maximum / 4) + 4} textAnchor="end">{number(tick * maximum / 4, 0)}</text>
        </g>)}
        <path d={`${line} L${plot.right},${plot.bottom} L${plot.left},${plot.bottom} Z`} className="merge-activity-area" />
        <line x1={plot.left} x2={plot.right} y1={y(summary.p90)} y2={y(summary.p90)} className="merge-activity-reference" />
        <line x1={plot.left} x2={plot.right} y1={y(summary.median)} y2={y(summary.median)} className="merge-activity-reference is-median" />
        <path d={line} className="merge-activity-line" />
        <path d={`M${x(lastIndex - 1)},${y(summary.timeline[lastIndex - 1].count)} L${x(lastIndex)},${y(count)}`} className="merge-activity-line is-current" />
        {selected !== null ? <line x1={x(selected)} x2={x(selected)} y1={plot.top} y2={plot.bottom} className="merge-activity-reference" /> : null}
        <circle cx={x(selectedIndex)} cy={y(point.count)} r={4} className="merge-activity-point" />
        {[0, 2, 4, 6, 8, 10, 12, 14].map((day) => <text key={day} x={x(day * 24)} y={198} textAnchor={day === 0 ? "start" : day === 14 ? "end" : "middle"}>{date(summary.now - (14 - day) * MERGE_ACTIVITY_DAY)}</text>)}
      </svg>
      <div className="merge-activity-legend">
        <span><i className="is-trend" />{t("lobby.merges.rolling")}</span>
        <span><i className="is-median" />{t("lobby.merges.median")} {number(summary.median)}</span>
        <span><i />p90 {number(summary.p90)}</span>
      </div>
      <footer className="merge-activity-footer">
        <span><Github aria-hidden size={13} /><a href={`https://github.com/${activity.repository}/pulls?q=is%3Apr+is%3Amerged`} target="_blank" rel="noreferrer">{activity.repository}</a></span>
        <p>{t("lobby.merges.method", { count: summary.baselineWindows, reached: summary.reachedCount })}</p>
      </footer>
    </div>
  );
}
