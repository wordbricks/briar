import {
  Bot,
  CalendarDays,
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ListFilter,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  MainContent,
  PageHeader,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  createProjectAgentSchedule,
  deleteProjectAgentSchedule,
  loadProjectAgentSchedules,
  loadProjectAgentScheduleRuns,
  loadProjectAgents,
  updateProjectAgentSchedule,
} from "../lib/api";
import { demoProjectAgents } from "../lib/demo-project-agents";
import {
  isValidProjectAgentScheduleTime,
  normalizeProjectAgentScheduleDay,
  normalizeProjectAgentScheduleDays,
  normalizeProjectAgentScheduleInterval,
  type ProjectAgentScheduleIntervalUnit,
  type ProjectAgentScheduleNotificationLevel,
  type ProjectAgentScheduleRecurrence,
} from "../lib/project-agent-schedule";
import {
  addCalendarDays,
  minutesIntoCalendarDay,
  scheduleOccurrenceSegmentsForWeek,
  scheduleSegmentsForWeek,
  startOfCalendarWeek,
  type ScheduleOccurrenceSegment,
} from "../lib/project-schedule";
import type {
  CreateProjectAgentScheduleInput,
  Project,
  ProjectAgent,
  ProjectAgentSchedule,
  ProjectAgentScheduleRun,
  UpdateProjectAgentScheduleInput,
} from "../types";
import { NativeSelect } from "./NativeSelect";
import { SelectMenu } from "./SelectMenu";

const dayCount = 7;
const allAgentsFilter = "all";
const agentFilterPrefix = "agent:";

function agentFilterValue(id: string) {
  return `${agentFilterPrefix}${id}`;
}

function agentIdFromFilter(value: string) {
  return value.startsWith(agentFilterPrefix)
    ? value.slice(agentFilterPrefix.length)
    : null;
}

function sameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function contrastingTextColor(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 160
    ? "#1f2937"
    : "#ffffff";
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
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function ProjectSchedule({
  isSidebarOpen,
  now: providedNow,
  project,
  token,
}: {
  isSidebarOpen: boolean;
  now?: Date;
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
  const [scheduleRuns, setScheduleRuns] = useState<ProjectAgentScheduleRun[]>(
    [],
  );
  const [isScheduleDataLoading, setIsScheduleDataLoading] = useState(true);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] =
    useState<ProjectAgentSchedule | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] =
    useState<ScheduleOccurrenceSegment | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    occurrence: ScheduleOccurrenceSegment;
    x: number;
    y: number;
  } | null>(null);
  const [scheduleToDelete, setScheduleToDelete] =
    useState<ProjectAgentSchedule | null>(null);
  const [isMutatingSchedule, setIsMutatingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState(allAgentsFilter);
  const availableAgents = useMemo(
    () =>
      [...agents].sort((left, right) =>
        left.name.localeCompare(right.name, localeTag),
      ),
    [agents, localeTag],
  );
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const agentFilterOptions = useMemo(
    () => [
      { label: t("schedule.allAgents"), value: allAgentsFilter },
      ...availableAgents.map((agent) => ({
        label: agent.name,
        value: agentFilterValue(agent.id),
      })),
    ],
    [availableAgents, t],
  );
  const selectedAgentId = agentIdFromFilter(agentFilter);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const filteredSchedules = useMemo(
    () =>
      selectedAgentId
        ? schedules.filter((schedule) => schedule.agentId === selectedAgentId)
        : schedules,
    [schedules, selectedAgentId],
  );
  const filteredRuns = useMemo(
    () => {
      const definedAgentRuns = scheduleRuns.flatMap((run) => {
        const agent = agentById.get(run.agent.id);
        return agent
          ? [
              {
                ...run,
                agent: {
                  id: agent.id,
                  name: agent.name,
                  provider: agent.provider,
                  model: agent.model,
                  effort: agent.effort,
                  description: agent.description,
                  responsibility: agent.responsibility,
                  skill: agent.skill,
                  skills: agent.skills,
                },
              },
            ]
          : [];
      });
      return selectedAgentId
        ? definedAgentRuns.filter((run) => run.agent.id === selectedAgentId)
        : definedAgentRuns;
    },
    [agentById, scheduleRuns, selectedAgentId],
  );
  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, index) =>
        addCalendarDays(weekStart, index),
      ),
    [weekStart],
  );
  const segmentsByDay = useMemo(
    () =>
      scheduleOccurrenceSegmentsForWeek(
        filteredSchedules,
        filteredRuns,
        agents,
        weekStart,
        now,
      ),
    [agents, filteredRuns, filteredSchedules, now, weekStart],
  );
  const allSegments = segmentsByDay.flat();
  const executionSegments = useMemo(
    () => scheduleSegmentsForWeek(filteredRuns, weekStart, now).flat(),
    [filteredRuns, now, weekStart],
  );
  const visibleRuns = new Set(
    allSegments.flatMap((segment) => (segment.run ? [segment.run.id] : [])),
  ).size;
  const totalMinutes = executionSegments.reduce(
    (total, segment) => total + segment.endMinute - segment.startMinute,
    0,
  );
  const todayWeek = startOfCalendarWeek(now);
  const isCurrentWeek = todayWeek.getTime() === weekStart.getTime();

  useEffect(() => {
    if (
      agentFilter !== allAgentsFilter &&
      !agentFilterOptions.some((option) => option.value === agentFilter)
    ) {
      setAgentFilter(allAgentsFilter);
    }
  }, [agentFilter, agentFilterOptions]);

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
          loadProjectAgentScheduleRuns(token, project.id),
        ])
      : Promise.resolve([
          demoProjectAgents(project.id, locale),
          [] as ProjectAgentSchedule[],
          [] as ProjectAgentScheduleRun[],
        ] as const);
    void load
      .then(([nextAgents, nextSchedules, nextRuns]) => {
        if (cancelled) return;
        setAgents(nextAgents);
        setSchedules(nextSchedules);
        setScheduleRuns(nextRuns);
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
    setIsMutatingSchedule(true);
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
      setIsMutatingSchedule(false);
    }
  };

  const saveSchedule = async (input: UpdateProjectAgentScheduleInput) => {
    if (!editingSchedule) return;
    setIsMutatingSchedule(true);
    setScheduleError(null);
    try {
      const agent = agents.find((candidate) => candidate.id === input.agentId);
      if (!agent) throw new Error(t("schedule.agentRequired"));
      const updated = token
        ? await updateProjectAgentSchedule(
            token,
            project.id,
            editingSchedule.id,
            input,
          )
        : {
            ...editingSchedule,
            ...input,
            agentName: agent.name,
            agentProvider: agent.provider,
            updatedAt: new Date().toISOString(),
          };
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === updated.id ? updated : schedule,
        ),
      );
      setEditingSchedule(null);
      setSelectedOccurrence(null);
    } finally {
      setIsMutatingSchedule(false);
    }
  };

  const removeSchedule = async (schedule: ProjectAgentSchedule) => {
    setIsMutatingSchedule(true);
    setScheduleError(null);
    try {
      if (token) {
        await deleteProjectAgentSchedule(token, project.id, schedule.id);
      }
      setSchedules((current) =>
        current.filter((candidate) => candidate.id !== schedule.id),
      );
      setScheduleRuns((current) =>
        current.filter((run) => run.scheduleId !== schedule.id),
      );
      setScheduleToDelete(null);
      setSelectedOccurrence(null);
      setEditingSchedule(null);
      setContextMenu(null);
    } catch (caught) {
      setScheduleError(
        caught instanceof Error ? caught.message : String(caught),
      );
      throw caught;
    } finally {
      setIsMutatingSchedule(false);
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const scroll = calendarScrollRef.current;
    if (!scroll) return;
    const firstSegment = allSegments.reduce<ScheduleOccurrenceSegment | null>(
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
    <MainContent className="project-schedule-page" id="project-schedule">
      <PageHeader
        action={
          <div className="project-schedule-heading-actions flex flex-nowrap items-center gap-3">
            <div className="project-schedule-summary flex flex-nowrap items-center gap-3 text-caption text-muted-foreground">
              <span>
                <Typography as="strong" className="mr-1" variant="bodySm">
                  {visibleRuns}
                </Typography>
                {t("schedule.runs")}
              </span>
              <i className="h-3 w-px bg-border" />
              <span>
                <Typography as="strong" className="mr-1" variant="bodySm">
                  {formatDuration(totalMinutes)}
                </Typography>
                {t("schedule.agentTime")}
              </span>
              <i className="h-3 w-px bg-border" />
              <span>
                <Typography as="strong" className="mr-1" variant="bodySm">
                  {filteredSchedules.length}
                </Typography>
                {t("schedule.automations")}
              </span>
            </div>
            <Button
              className="project-schedule-create"
              disabled={isScheduleDataLoading || agents.length === 0}
              onClick={() => setIsScheduleDialogOpen(true)}
              type="button"
            >
              {isScheduleDataLoading ? (
                <Spinner size={16} />
              ) : (
                <Plus size={16} />
              )}
              {t("schedule.create")}
            </Button>
          </div>
        }
        className={`app-page-header project-schedule-heading${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
        title={t("schedule.title")}
      />

      {scheduleError && (
        <div className="project-schedule-error" role="alert">
          <CircleAlert size={15} />
          <span>{scheduleError}</span>
        </div>
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
          <div className="project-schedule-toolbar-meta">
            <div className="project-schedule-agent-filter">
              <ListFilter aria-hidden="true" size={13} />
              <SelectMenu
                align="end"
                disabled={availableAgents.length === 0}
                id="project-schedule-agent-filter"
                label={t("schedule.agentFilter")}
                onValueChange={setAgentFilter}
                options={agentFilterOptions}
                size="small"
                value={agentFilter}
              />
            </div>
            <div className="project-schedule-timezone">
              <Clock3 size={13} />
              <span>{formatOffset(now)}</span>
              <span>{timeZone}</span>
            </div>
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
                        "--agent-color": segment.agent.calendarColor,
                        "--agent-contrast": contrastingTextColor(
                          segment.agent.calendarColor,
                        ),
                      } satisfies CSSProperties & {
                        "--agent-color": string;
                        "--agent-contrast": string;
                      };
                      const statusKey =
                        `schedule.status.${segment.status}` as MessageKey;
                      const label = t("schedule.runLabel", {
                        agent: segment.agent.name,
                        title: segment.schedule.name,
                        time: `${formatTime(segment.start, localeTag)}–${formatTime(segment.end, localeTag)}`,
                      });
                      return (
                        <button
                          aria-label={label}
                          className={`project-schedule-event ${segment.status}`}
                          key={segment.id}
                          onClick={() => {
                            setContextMenu(null);
                            setSelectedOccurrence(segment);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSelectedOccurrence(null);
                            setContextMenu({
                              occurrence: segment,
                              x: Math.min(event.clientX, window.innerWidth - 190),
                              y: Math.min(event.clientY, window.innerHeight - 110),
                            });
                          }}
                          style={style}
                          title={label}
                          type="button"
                        >
                          <span className="project-schedule-event-agent">
                            <Bot size={11} />
                            <strong>{segment.agent.name}</strong>
                            {segment.status === "running" && <i />}
                          </span>
                          <time>
                            {formatTime(segment.start, localeTag)}
                          </time>
                          <span className="project-schedule-event-title">
                            {segment.schedule.name}
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
                  <strong>
                    {selectedAgent
                      ? t("schedule.filteredEmptyTitle", {
                          agent: selectedAgent.name,
                        })
                      : t("schedule.emptyTitle")}
                  </strong>
                  <p>
                    {selectedAgent
                      ? t("schedule.filteredEmptyDescription")
                      : t("schedule.emptyDescription")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {isScheduleDialogOpen && (
        <CreateProjectAgentScheduleDialog
          agents={agents}
          isSubmitting={isMutatingSchedule}
          onClose={() => setIsScheduleDialogOpen(false)}
          onCreate={addSchedule}
        />
      )}
      {selectedOccurrence && !editingSchedule && !scheduleToDelete && (
        <ProjectAgentScheduleDetails
          occurrence={selectedOccurrence}
          onClose={() => setSelectedOccurrence(null)}
          onDelete={() => setScheduleToDelete(selectedOccurrence.schedule)}
          onEdit={() => setEditingSchedule(selectedOccurrence.schedule)}
        />
      )}
      {editingSchedule && (
        <CreateProjectAgentScheduleDialog
          agents={agents}
          isSubmitting={isMutatingSchedule}
          onClose={() => setEditingSchedule(null)}
          onCreate={addSchedule}
          onUpdate={saveSchedule}
          schedule={editingSchedule}
        />
      )}
      {contextMenu && (
        <div
          aria-label={t("schedule.contextMenu")}
          className="project-schedule-context-menu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              setEditingSchedule(contextMenu.occurrence.schedule);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            <Pencil size={14} />
            {t("schedule.edit")}
          </button>
          <button
            className="danger"
            onClick={() => {
              setScheduleToDelete(contextMenu.occurrence.schedule);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            <Trash2 size={14} />
            {t("schedule.delete")}
          </button>
        </div>
      )}
      {scheduleToDelete && (
        <DeleteProjectAgentScheduleDialog
          isDeleting={isMutatingSchedule}
          onClose={() => setScheduleToDelete(null)}
          onDelete={() => removeSchedule(scheduleToDelete)}
          schedule={scheduleToDelete}
        />
      )}
    </MainContent>
  );
}

export function ProjectAgentScheduleDetails({
  occurrence,
  onClose,
  onDelete,
  onEdit,
}: {
  occurrence: ScheduleOccurrenceSegment;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { localeTag, t } = useI18n();
  const { agent, run, schedule, start, status } = occurrence;
  const statusKey = `schedule.status.${status}` as MessageKey;
  const recurrenceKey =
    `schedule.recurrence.${schedule.recurrence}` as MessageKey;
  const occurrenceDate = new Intl.DateTimeFormat(localeTag, {
    dateStyle: "full",
  }).format(start);
  const recurrenceDetail =
    schedule.recurrence === "weekly"
      ? `${t(recurrenceKey)} · ${new Intl.DateTimeFormat(localeTag, {
          weekday: "long",
        }).format(start)}`
      : t(recurrenceKey);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="project-schedule-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={t("schedule.detailsDialog", { name: schedule.name })}
        aria-modal="true"
        className="project-schedule-detail"
        role="dialog"
      >
        <header>
          <i
            aria-hidden="true"
            style={{ backgroundColor: agent.calendarColor }}
          />
          <div>
            <p className="eyebrow">
              <CalendarDays size={13} />
              {t("schedule.detailsEyebrow")}
            </p>
            <h2>{schedule.name}</h2>
            <p>
              {occurrenceDate} · {formatTime(start, localeTag)}
            </p>
          </div>
          <div className="project-schedule-detail-actions">
            <button
              aria-label={t("schedule.edit")}
              onClick={onEdit}
              title={t("schedule.edit")}
              type="button"
            >
              <Pencil size={16} />
            </button>
            <button
              aria-label={t("schedule.delete")}
              className="danger"
              onClick={onDelete}
              title={t("schedule.delete")}
              type="button"
            >
              <Trash2 size={16} />
            </button>
            <button
              aria-label={t("common.close")}
              onClick={onClose}
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="project-schedule-detail-content">
          <dl className="project-schedule-detail-meta">
            <div>
              <dt>{t("schedule.statusLabel")}</dt>
              <dd>
                <span className={`project-schedule-status-pill ${status}`}>
                  {t(statusKey)}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("schedule.agent")}</dt>
              <dd>
                <Bot size={14} />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.provider}</small>
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("schedule.recurrence")}</dt>
              <dd>{recurrenceDetail}</dd>
            </div>
            <div>
              <dt>{t("schedule.timeZoneLabel")}</dt>
              <dd>{schedule.timeZone}</dd>
            </div>
          </dl>

          <section className="project-schedule-session">
            <header>
              <span>
                <Bot size={16} />
              </span>
              <div>
                <strong>{t("schedule.sessionContent")}</strong>
                <small>
                  {run
                    ? t("schedule.sessionRunId", { id: run.id.slice(0, 8) })
                    : t("schedule.sessionNotStarted")}
                </small>
              </div>
            </header>
            {run ? (
              <>
                <dl>
                  <div>
                    <dt>{t("schedule.startedAt")}</dt>
                    <dd>
                      {new Intl.DateTimeFormat(localeTag, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(run.startedAt))}
                    </dd>
                  </div>
                  {run.completedAt && (
                    <div>
                      <dt>{t("schedule.completedAt")}</dt>
                      <dd>
                        {new Intl.DateTimeFormat(localeTag, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(run.completedAt))}
                      </dd>
                    </div>
                  )}
                </dl>
                <div
                  className={`project-schedule-session-message ${run.status}`}
                >
                  {run.resultSummary || run.error || t("schedule.sessionRunning")}
                </div>
              </>
            ) : (
              <p className="project-schedule-session-empty">
                {status === "missed"
                  ? t("schedule.sessionMissed")
                  : t("schedule.sessionScheduled")}
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export function DeleteProjectAgentScheduleDialog({
  isDeleting,
  onClose,
  onDelete,
  schedule,
}: {
  isDeleting: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
  schedule: ProjectAgentSchedule;
}) {
  const { t } = useI18n();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDeleting, onClose]);

  return (
    <div
      className="dialog-backdrop project-schedule-delete-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onClose();
      }}
    >
      <section
        aria-label={t("schedule.deleteDialog", { name: schedule.name })}
        aria-modal="true"
        className="project-schedule-delete-dialog"
        role="alertdialog"
      >
        <span>
          <Trash2 size={20} />
        </span>
        <div>
          <h2>{t("schedule.deleteTitle", { name: schedule.name })}</h2>
          <p>{t("schedule.deleteDescription")}</p>
          {deleteError && <small role="alert">{deleteError}</small>}
        </div>
        <footer>
          <button disabled={isDeleting} onClick={onClose} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="danger"
            disabled={isDeleting}
            onClick={() => {
              setDeleteError(null);
              void onDelete().catch((caught) =>
                setDeleteError(
                  caught instanceof Error ? caught.message : String(caught),
                ),
              );
            }}
            type="button"
          >
            {isDeleting ? (
              <Spinner size={14} />
            ) : (
              <Trash2 size={14} />
            )}
            {isDeleting ? t("schedule.deleting") : t("schedule.delete")}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function CreateProjectAgentScheduleDialog({
  agents,
  isSubmitting,
  onClose,
  onCreate,
  onUpdate,
  schedule,
}: {
  agents: ProjectAgent[];
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (input: CreateProjectAgentScheduleInput) => Promise<void>;
  onUpdate?: (input: UpdateProjectAgentScheduleInput) => Promise<void>;
  schedule?: ProjectAgentSchedule;
}) {
  const { localeTag, t } = useI18n();
  const [name, setName] = useState(schedule?.name ?? "");
  const [agentId, setAgentId] = useState(
    schedule?.agentId ?? agents[0]?.id ?? "",
  );
  const [recurrence, setRecurrence] =
    useState<ProjectAgentScheduleRecurrence>(
      schedule?.recurrence ?? "weekdays",
    );
  const [timeOfDay, setTimeOfDay] = useState(
    schedule?.timeOfDay ?? "09:00",
  );
  const [dayOfWeek, setDayOfWeek] = useState(schedule?.dayOfWeek ?? 1);
  const [intervalValue, setIntervalValue] = useState(
    schedule?.intervalValue ?? 1,
  );
  const [intervalUnit, setIntervalUnit] =
    useState<ProjectAgentScheduleIntervalUnit>(
      schedule?.intervalUnit ??
        (schedule?.recurrence === "interval"
          ? "hour"
          : schedule?.recurrence === "custom"
            ? "week"
            : "day"),
    );
  const [daysOfWeek, setDaysOfWeek] = useState(() =>
    normalizeProjectAgentScheduleDays(
      schedule?.daysOfWeek ??
        (schedule?.recurrence === "weekly"
          ? [schedule.dayOfWeek ?? 1]
          : [1]),
    ),
  );
  const [notificationLevel, setNotificationLevel] =
    useState<ProjectAgentScheduleNotificationLevel>(
      schedule?.notificationLevel ?? "important_updates",
    );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timeZone =
    schedule?.timeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "Etc/UTC";
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const isEditing = Boolean(schedule);

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
  const shortDayOptions = Array.from({ length: 7 }, (_, index) => ({
    label: new Intl.DateTimeFormat(localeTag, { weekday: "short" }).format(
      addCalendarDays(new Date(2026, 6, 26), index),
    ),
    value: index,
  }));
  const normalizedIntervalValue =
    normalizeProjectAgentScheduleInterval(intervalValue);
  const isCustomWeekly =
    recurrence === "custom" && intervalUnit === "week";
  const hasValidCustomDays = !isCustomWeekly || daysOfWeek.length > 0;
  const canSubmit =
    Boolean(name.trim() && agentId) &&
    isValidProjectAgentScheduleTime(timeOfDay) &&
    hasValidCustomDays;

  const changeRecurrence = (value: string) => {
    const next = value as ProjectAgentScheduleRecurrence;
    setRecurrence(next);
    if (next === "interval") {
      setIntervalUnit("hour");
    } else if (next === "custom") {
      setIntervalUnit("week");
    }
  };

  const toggleDay = (day: number) => {
    setDaysOfWeek((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : normalizeProjectAgentScheduleDays([...current, day]),
    );
  };

  return (
    <div
      className="dialog-backdrop project-schedule-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label={t(
          isEditing ? "schedule.editDialog" : "schedule.createDialog",
        )}
        aria-modal="true"
        className="project-schedule-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit || isSubmitting) {
            return;
          }
          setSubmitError(null);
          const input = {
            agentId,
            name: name.trim(),
            recurrence,
            timeOfDay,
            dayOfWeek: normalizeProjectAgentScheduleDay(
              recurrence,
              dayOfWeek,
            ),
            intervalValue: normalizedIntervalValue,
            intervalUnit,
            daysOfWeek: isCustomWeekly ? daysOfWeek : [],
            notificationLevel,
            timeZone,
          };
          const save = isEditing && onUpdate ? onUpdate : onCreate;
          void save(input).catch((caught) => {
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
              {isEditing ? <Pencil size={13} /> : <CalendarPlus size={13} />}
              {t(
                isEditing
                  ? "schedule.editEyebrow"
                  : "schedule.newEyebrow",
              )}
            </p>
            <h2>
              {t(isEditing ? "schedule.edit" : "schedule.create")}
            </h2>
            <p>
              {t(
                isEditing
                  ? "schedule.editDescription"
                  : "schedule.createDescription",
              )}
            </p>
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
              autoFocus={!isEditing}
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
                <p>
                  {selectedAgent.description || selectedAgent.responsibility}
                </p>
              </div>
            </div>
          )}

          <div className="project-schedule-frequency">
            <div className="project-schedule-frequency-row">
              <span>{t("schedule.repeat")}</span>
              <NativeSelect
                label={t("schedule.repeat")}
                onValueChange={changeRecurrence}
                options={[
                  {
                    label: t("schedule.recurrence.interval"),
                    value: "interval",
                  },
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
                  {
                    label: t("schedule.recurrence.custom"),
                    value: "custom",
                  },
                ]}
                value={recurrence}
              />
            </div>

            {recurrence === "custom" && (
              <div className="project-schedule-frequency-row">
                <span>{t("schedule.repeats")}</span>
                <NativeSelect
                  label={t("schedule.repeats")}
                  onValueChange={(value) =>
                    setIntervalUnit(
                      value as ProjectAgentScheduleIntervalUnit,
                    )
                  }
                  options={[
                    {
                      label: t("schedule.repeats.daily"),
                      value: "day",
                    },
                    {
                      label: t("schedule.repeats.weekly"),
                      value: "week",
                    },
                  ]}
                  value={intervalUnit}
                />
              </div>
            )}

            {(recurrence === "interval" || recurrence === "custom") && (
              <div className="project-schedule-frequency-row">
                <span>{t("schedule.every")}</span>
                <div className="project-schedule-interval-control">
                  <input
                    aria-label={t("schedule.every")}
                    inputMode="numeric"
                    max={999}
                    min={1}
                    onChange={(event) =>
                      setIntervalValue(Number(event.target.value))
                    }
                    type="number"
                    value={intervalValue}
                  />
                  {recurrence === "interval" ? (
                    <NativeSelect
                      label={t("schedule.intervalUnit")}
                      onValueChange={(value) =>
                        setIntervalUnit(
                          value as ProjectAgentScheduleIntervalUnit,
                        )
                      }
                      options={[
                        {
                          label: t("schedule.unit.minutes"),
                          value: "minute",
                        },
                        {
                          label: t("schedule.unit.hours"),
                          value: "hour",
                        },
                      ]}
                      value={intervalUnit}
                    />
                  ) : (
                    <strong>
                      {t(
                        intervalUnit === "day"
                          ? "schedule.unit.days"
                          : "schedule.unit.weeks",
                      )}
                    </strong>
                  )}
                </div>
              </div>
            )}

            {recurrence === "weekly" && (
              <div className="project-schedule-frequency-row">
                <span>{t("schedule.on")}</span>
                <NativeSelect
                  label={t("schedule.day")}
                  onValueChange={(value) => setDayOfWeek(Number(value))}
                  options={dayOptions}
                  value={String(dayOfWeek)}
                />
              </div>
            )}

            {isCustomWeekly && (
              <div className="project-schedule-frequency-row project-schedule-frequency-days">
                <span>{t("schedule.on")}</span>
                <div
                  aria-label={t("schedule.days")}
                  className="project-schedule-day-picker"
                  role="group"
                >
                  {shortDayOptions.map((option) => (
                    <button
                      aria-pressed={daysOfWeek.includes(option.value)}
                      key={option.value}
                      onClick={() => toggleDay(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {!hasValidCustomDays && (
                  <small>{t("schedule.daysRequired")}</small>
                )}
              </div>
            )}

            {recurrence !== "interval" && (
              <div className="project-schedule-frequency-row">
                <span>{t("schedule.at")}</span>
                <input
                  aria-label={t("schedule.time")}
                  onChange={(event) => setTimeOfDay(event.target.value)}
                  required
                  type="time"
                  value={timeOfDay}
                />
              </div>
            )}

            <div className="project-schedule-frequency-row">
              <span>{t("schedule.notifications")}</span>
              <NativeSelect
                label={t("schedule.notifications")}
                onValueChange={(value) =>
                  setNotificationLevel(
                    value as ProjectAgentScheduleNotificationLevel,
                  )
                }
                options={[
                  {
                    label: t("schedule.notifications.important"),
                    value: "important_updates",
                  },
                  {
                    label: t("schedule.notifications.none"),
                    value: "none",
                  },
                ]}
                value={notificationLevel}
              />
            </div>
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
              !canSubmit
            }
            type="submit"
          >
            {isSubmitting ? (
              <Spinner size={15} />
            ) : isEditing ? (
              <Pencil size={15} />
            ) : (
              <Plus size={15} />
            )}
            {isSubmitting
              ? t(isEditing ? "schedule.updating" : "schedule.creating")
              : t(isEditing ? "schedule.saveChanges" : "schedule.create")}
          </button>
        </footer>
      </form>
    </div>
  );
}
