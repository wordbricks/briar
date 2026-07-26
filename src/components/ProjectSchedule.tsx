import {
  Bot,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  addCalendarDays,
  minutesIntoCalendarDay,
  scheduleSegmentsForWeek,
  startOfCalendarWeek,
  type ScheduleSegment,
} from "../lib/project-schedule";
import type { DashboardPayload } from "../types";

const dayCount = 7;

function sameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

function formatOffset(date: Date) {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(totalMinutes) / 60);
  const minutes = Math.abs(totalMinutes) % 60;
  return `GMT${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatHour(hour: number, localeTag: string) {
  const value = new Date(2026, 0, 1, hour);
  return new Intl.DateTimeFormat(localeTag, {
    hour: "numeric",
    hour12: true,
  }).format(value);
}

function formatTime(value: Date, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatDuration(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function ProjectSchedule({
  dashboard,
  isSidebarOpen,
  now: providedNow,
  onRunOpen,
}: {
  dashboard: DashboardPayload | null;
  isSidebarOpen: boolean;
  now?: Date;
  onRunOpen: (runId: string) => void;
}) {
  const { localeTag, t } = useI18n();
  const [liveNow, setLiveNow] = useState(() => providedNow ?? new Date());
  const now = providedNow ?? liveNow;
  const [weekStart, setWeekStart] = useState(() =>
    startOfCalendarWeek(now),
  );
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, index) =>
        addCalendarDays(weekStart, index),
      ),
    [weekStart],
  );
  const segmentsByDay = useMemo(
    () => scheduleSegmentsForWeek(dashboard?.runs ?? [], weekStart, now),
    [dashboard?.runs, now, weekStart],
  );
  const allSegments = segmentsByDay.flat();
  const visibleRuns = new Set(allSegments.map((segment) => segment.run.id)).size;
  const totalMinutes = allSegments.reduce(
    (total, segment) => total + segment.endMinute - segment.startMinute,
    0,
  );
  const todayWeek = startOfCalendarWeek(now);
  const isCurrentWeek = todayWeek.getTime() === weekStart.getTime();

  useEffect(() => {
    if (providedNow) return;
    const intervalId = window.setInterval(() => setLiveNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, [providedNow]);

  useEffect(() => {
    const scroll = calendarScrollRef.current;
    if (!scroll) return;
    const firstSegment = allSegments.reduce<ScheduleSegment | null>(
      (first, segment) =>
        !first || segment.startMinute < first.startMinute ? segment : first,
      null,
    );
    const focusMinute = isCurrentWeek
      ? minutesIntoCalendarDay(now)
      : (firstSegment?.startMinute ?? 8 * 60);
    const frame = window.requestAnimationFrame(() => {
      scroll.scrollTop = Math.max(0, focusMinute - 120);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isCurrentWeek, weekStart]);

  const weekRange = new Intl.DateTimeFormat(localeTag, {
    month: "short",
    day: "numeric",
  }).formatRange(days[0], days[6]);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <main className="main-content project-schedule-page" id="project-schedule">
      <header
        className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
      />
      <section className="project-schedule-heading">
        <div>
          <p className="eyebrow">
            <CalendarClock size={13} />
            {t("schedule.eyebrow")}
          </p>
          <h1>{t("schedule.title")}</h1>
          <p>{t("schedule.description")}</p>
        </div>
        <div className="project-schedule-summary">
          <span>
            <strong>{visibleRuns}</strong>
            {t("schedule.runs")}
          </span>
          <i />
          <span>
            <strong>{formatDuration(totalMinutes)}</strong>
            {t("schedule.agentTime")}
          </span>
        </div>
      </section>

      <section
        aria-label={t("schedule.calendarLabel")}
        className="project-schedule-calendar"
      >
        <header className="project-schedule-toolbar">
          <div className="project-schedule-period">
            <button
              aria-label={t("schedule.previousWeek")}
              onClick={() =>
                setWeekStart((current) => addCalendarDays(current, -7))
              }
              type="button"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              aria-label={t("schedule.nextWeek")}
              onClick={() =>
                setWeekStart((current) => addCalendarDays(current, 7))
              }
              type="button"
            >
              <ChevronRight size={17} />
            </button>
            <button
              className="project-schedule-today"
              disabled={isCurrentWeek}
              onClick={() => setWeekStart(startOfCalendarWeek(now))}
              type="button"
            >
              {t("schedule.today")}
            </button>
            <strong>{weekRange}</strong>
          </div>
          <div className="project-schedule-timezone">
            <Clock3 size={13} />
            <span>{formatOffset(now)}</span>
            <span>{timeZone}</span>
          </div>
        </header>

        <div className="project-schedule-calendar-scroll" ref={calendarScrollRef}>
          <div className="project-schedule-grid">
            <div className="project-schedule-days">
              <div aria-hidden="true" className="project-schedule-day-corner" />
              {days.map((day) => {
                const isToday = sameLocalDay(day, now);
                return (
                  <div
                    className={`project-schedule-day-heading${isToday ? " today" : ""}`}
                    key={day.toISOString()}
                  >
                    <span>
                      {new Intl.DateTimeFormat(localeTag, {
                        weekday: "short",
                      }).format(day)}
                    </span>
                    <strong>{day.getDate()}</strong>
                  </div>
                );
              })}
            </div>

            <div className="project-schedule-week">
              <div aria-hidden="true" className="project-schedule-time-gutter">
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    className={hour === 0 ? "first" : undefined}
                    key={hour}
                    style={{ top: hour === 0 ? 8 : hour * 60 }}
                  >
                    {formatHour(hour, localeTag)}
                  </span>
                ))}
              </div>
              {days.map((day, dayIndex) => {
                const isToday = sameLocalDay(day, now);
                return (
                  <div
                    className={`project-schedule-day-column${isToday ? " today" : ""}`}
                    key={day.toISOString()}
                  >
                    {isToday && isCurrentWeek && (
                      <div
                        aria-label={t("schedule.currentTime")}
                        className="project-schedule-now"
                        style={{
                          top: `${(minutesIntoCalendarDay(now) / 1_440) * 100}%`,
                        }}
                      >
                        <span />
                      </div>
                    )}
                    {segmentsByDay[dayIndex].map((segment) => {
                      const top = (segment.startMinute / 1_440) * 100;
                      const duration = segment.endMinute - segment.startMinute;
                      const height = Math.max((duration / 1_440) * 100, 1.25);
                      const laneWidth = 100 / segment.laneCount;
                      const style = {
                        top: `${top}%`,
                        height: `${height}%`,
                        left: `calc(${segment.lane * laneWidth}% + 3px)`,
                        width: `calc(${laneWidth}% - 6px)`,
                      } satisfies CSSProperties;
                      const statusKey =
                        `status.${segment.run.status}` as MessageKey;
                      const color = hash(segment.agent) % 6;
                      const label = t("schedule.runLabel", {
                        agent: segment.agent,
                        title: segment.run.title,
                        time: `${formatTime(segment.start, localeTag)}–${formatTime(segment.end, localeTag)}`,
                      });
                      return (
                        <button
                          aria-label={label}
                          className={`project-schedule-event color-${color} ${segment.run.status}`}
                          key={segment.id}
                          onClick={() => onRunOpen(segment.run.id)}
                          style={style}
                          title={label}
                          type="button"
                        >
                          <span className="project-schedule-event-agent">
                            <Bot size={11} />
                            <strong>{segment.agent}</strong>
                            {segment.run.status === "running" && <i />}
                          </span>
                          <time>
                            {formatTime(segment.start, localeTag)} –{" "}
                            {formatTime(segment.end, localeTag)}
                          </time>
                          <span className="project-schedule-event-title">
                            {segment.run.title}
                          </span>
                          <small>{t(statusKey)}</small>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {allSegments.length === 0 && (
                <div className="project-schedule-empty">
                  <span>
                    <CalendarClock size={22} />
                  </span>
                  <strong>{t("schedule.emptyTitle")}</strong>
                  <p>{t("schedule.emptyDescription")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
