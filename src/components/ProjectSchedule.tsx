import {
  Bot,
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Plus,
  Repeat2,
  X,
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
  createProjectAgentSchedule,
  loadProjectAgentSchedules,
  loadProjectAgents,
} from "../lib/api";
import { demoProjectAgents } from "../lib/demo-project-agents";
import {
  isValidProjectAgentScheduleTime,
  normalizeProjectAgentScheduleDay,
  type ProjectAgentScheduleRecurrence,
} from "../lib/project-agent-schedule";
import {
  addCalendarDays,
  minutesIntoCalendarDay,
  scheduleSegmentsForWeek,
  startOfCalendarWeek,
  type ScheduleSegment,
} from "../lib/project-schedule";
import type {
  CreateProjectAgentScheduleInput,
  DashboardPayload,
  Project,
  ProjectAgent,
  ProjectAgentSchedule,
} from "../types";
import { NativeSelect } from "./NativeSelect";

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
  project,
  token,
}: {
  dashboard: DashboardPayload | null;
  isSidebarOpen: boolean;
  now?: Date;
  onRunOpen: (runId: string) => void;
  project: Project;
  token: string | null;
}) {
  const { locale, localeTag, t } = useI18n();
  const [liveNow, setLiveNow] = useState(() => providedNow ?? new Date());
  const now = providedNow ?? liveNow;
  const [weekStart, setWeekStart] = useState(() =>
    startOfCalendarWeek(now),
  );
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [schedules, setSchedules] = useState<ProjectAgentSchedule[]>([]);
  const [isScheduleDataLoading, setIsScheduleDataLoading] = useState(true);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
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
    let cancelled = false;
    setIsScheduleDataLoading(true);
    setScheduleError(null);
    const load = token
      ? Promise.all([
          loadProjectAgents(token, project.id, locale),
          loadProjectAgentSchedules(token, project.id),
        ])
      : Promise.resolve([
          demoProjectAgents(project.id, locale),
          [] as ProjectAgentSchedule[],
        ] as const);
    void load
      .then(([nextAgents, nextSchedules]) => {
        if (cancelled) return;
        setAgents(nextAgents);
        setSchedules(nextSchedules);
      })
      .catch((caught) => {
        if (!cancelled) {
          setScheduleError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsScheduleDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, project.id, token]);

  const addSchedule = async (input: CreateProjectAgentScheduleInput) => {
    setIsCreatingSchedule(true);
    setScheduleError(null);
    try {
      const agent = agents.find((candidate) => candidate.id === input.agentId);
      if (!agent) throw new Error(t("schedule.agentRequired"));
      const createdAt = new Date().toISOString();
      const schedule = token
        ? await createProjectAgentSchedule(token, project.id, input)
        : {
            id: crypto.randomUUID(),
            projectId: project.id,
            agentId: agent.id,
            agentName: agent.name,
            agentProvider: agent.provider,
            name: input.name,
            recurrence: input.recurrence,
            timeOfDay: input.timeOfDay,
            dayOfWeek: input.dayOfWeek,
            timeZone: input.timeZone,
            enabled: true,
            createdAt,
            updatedAt: createdAt,
          };
      setSchedules((current) => [...current, schedule]);
      setIsScheduleDialogOpen(false);
    } finally {
      setIsCreatingSchedule(false);
    }
  };

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
        <div className="project-schedule-heading-actions">
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
            <i />
            <span>
              <strong>{schedules.length}</strong>
              {t("schedule.automations")}
            </span>
          </div>
          <button
            className="project-schedule-create"
            disabled={isScheduleDataLoading || agents.length === 0}
            onClick={() => setIsScheduleDialogOpen(true)}
            type="button"
          >
            {isScheduleDataLoading ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Plus size={15} />
            )}
            {t("schedule.create")}
          </button>
        </div>
      </section>

      {scheduleError && (
        <div className="project-schedule-error" role="alert">
          <CircleAlert size={15} />
          <span>{scheduleError}</span>
        </div>
      )}

      {schedules.length > 0 && (
        <section
          aria-label={t("schedule.automations")}
          className="project-schedule-plans"
        >
          {schedules.map((schedule) => (
            <article key={schedule.id}>
              <span className={`provider-${schedule.agentProvider}`}>
                <CalendarClock size={15} />
              </span>
              <div>
                <strong>{schedule.name}</strong>
                <small>{schedule.agentName}</small>
              </div>
              <em>
                <Repeat2 size={12} />
                {formatScheduleCadence(schedule, localeTag, t)}
              </em>
            </article>
          ))}
        </section>
      )}

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

      {isScheduleDialogOpen && (
        <CreateProjectAgentScheduleDialog
          agents={agents}
          isSubmitting={isCreatingSchedule}
          onClose={() => setIsScheduleDialogOpen(false)}
          onCreate={addSchedule}
        />
      )}
    </main>
  );
}

type Translate = (
  key: MessageKey,
  variables?: Record<string, string | number>,
) => string;

function formatScheduleCadence(
  schedule: ProjectAgentSchedule,
  localeTag: string,
  t: Translate,
) {
  const recurrence =
    schedule.recurrence === "daily"
      ? t("schedule.recurrence.daily")
      : schedule.recurrence === "weekdays"
        ? t("schedule.recurrence.weekdays")
        : new Intl.DateTimeFormat(localeTag, { weekday: "long" }).format(
            addCalendarDays(new Date(2026, 6, 26), schedule.dayOfWeek ?? 1),
          );
  return `${recurrence} · ${schedule.timeOfDay}`;
}

export function CreateProjectAgentScheduleDialog({
  agents,
  isSubmitting,
  onClose,
  onCreate,
}: {
  agents: ProjectAgent[];
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (input: CreateProjectAgentScheduleInput) => Promise<void>;
}) {
  const { localeTag, t } = useI18n();
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [recurrence, setRecurrence] =
    useState<ProjectAgentScheduleRecurrence>("weekdays");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  const selectedAgent = agents.find((agent) => agent.id === agentId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onClose]);

  const dayOptions = Array.from({ length: 7 }, (_, index) => ({
    label: new Intl.DateTimeFormat(localeTag, { weekday: "long" }).format(
      addCalendarDays(new Date(2026, 6, 26), index),
    ),
    value: String(index),
  }));

  return (
    <div
      className="dialog-backdrop project-schedule-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label={t("schedule.createDialog")}
        aria-modal="true"
        className="project-schedule-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !name.trim() ||
            !agentId ||
            !isValidProjectAgentScheduleTime(timeOfDay) ||
            isSubmitting
          ) {
            return;
          }
          setSubmitError(null);
          void onCreate({
            agentId,
            name: name.trim(),
            recurrence,
            timeOfDay,
            dayOfWeek: normalizeProjectAgentScheduleDay(
              recurrence,
              dayOfWeek,
            ),
            timeZone,
          }).catch((caught) => {
            setSubmitError(
              caught instanceof Error ? caught.message : String(caught),
            );
          });
        }}
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">
              <CalendarPlus size={13} />
              {t("schedule.newEyebrow")}
            </p>
            <h2>{t("schedule.create")}</h2>
            <p>{t("schedule.createDescription")}</p>
          </div>
          <button
            aria-label={t("common.close")}
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="project-schedule-form">
          <label>
            <span>
              {t("schedule.name")} <em>{t("common.required")}</em>
            </span>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("schedule.namePlaceholder")}
              value={name}
            />
          </label>

          <label>
            <span>
              {t("schedule.agent")} <em>{t("common.required")}</em>
            </span>
            <NativeSelect
              label={t("schedule.agent")}
              onValueChange={setAgentId}
              options={agents.map((agent) => ({
                label: `${agent.name} · ${agent.provider}`,
                value: agent.id,
              }))}
              value={agentId}
            />
          </label>

          {selectedAgent && (
            <div className="project-schedule-agent-preview">
              <span className={`provider-${selectedAgent.provider}`}>
                <Bot size={18} />
              </span>
              <div>
                <strong>{selectedAgent.name}</strong>
                <p>{selectedAgent.responsibility}</p>
              </div>
            </div>
          )}

          <div className="project-schedule-form-cadence">
            <label>
              <span>
                {t("schedule.recurrence")} <em>{t("common.required")}</em>
              </span>
              <NativeSelect
                label={t("schedule.recurrence")}
                onValueChange={(value) =>
                  setRecurrence(value as ProjectAgentScheduleRecurrence)
                }
                options={[
                  {
                    label: t("schedule.recurrence.daily"),
                    value: "daily",
                  },
                  {
                    label: t("schedule.recurrence.weekdays"),
                    value: "weekdays",
                  },
                  {
                    label: t("schedule.recurrence.weekly"),
                    value: "weekly",
                  },
                ]}
                value={recurrence}
              />
            </label>
            {recurrence === "weekly" && (
              <label>
                <span>
                  {t("schedule.day")} <em>{t("common.required")}</em>
                </span>
                <NativeSelect
                  label={t("schedule.day")}
                  onValueChange={(value) => setDayOfWeek(Number(value))}
                  options={dayOptions}
                  value={String(dayOfWeek)}
                />
              </label>
            )}
            <label>
              <span>
                {t("schedule.time")} <em>{t("common.required")}</em>
              </span>
              <input
                aria-label={t("schedule.time")}
                onChange={(event) => setTimeOfDay(event.target.value)}
                required
                type="time"
                value={timeOfDay}
              />
            </label>
          </div>

          <div className="project-schedule-timezone-note">
            <Clock3 size={14} />
            <span>
              {t("schedule.timeZone", { timeZone })}
            </span>
          </div>

          {submitError && (
            <p className="project-schedule-form-error" role="alert">
              <CircleAlert size={14} />
              {submitError}
            </p>
          )}
        </div>

        <footer>
          <button disabled={isSubmitting} onClick={onClose} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="project-schedule-submit"
            disabled={
              isSubmitting ||
              !name.trim() ||
              !agentId ||
              !isValidProjectAgentScheduleTime(timeOfDay)
            }
            type="submit"
          >
            {isSubmitting ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Plus size={15} />
            )}
            {isSubmitting ? t("schedule.creating") : t("schedule.create")}
          </button>
        </footer>
      </form>
    </div>
  );
}
