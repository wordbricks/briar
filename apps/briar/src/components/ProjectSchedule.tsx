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

import { MainContent, PageHeader } from "@/components/layout";
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
import { cn } from "../lib/utils";

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
  const [weekStart, setWeekStart] = useState(() => startOfCalendarWeek(now));
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
  const filteredRuns = useMemo(() => {
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
  }, [agentById, scheduleRuns, selectedAgentId]);
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
          loadProjectAgents(token, project.id),
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
    <MainContent className="overflow-hidden bg-card" id="project-schedule">
      <PageHeader
        action={
          <div className="flex shrink-0 flex-nowrap items-center gap-2">
            <div className="flex h-[46px] shrink-0 flex-nowrap items-center gap-3 rounded-xl border border-border bg-card px-4 text-caption text-muted-foreground shadow-sm max-[760px]:hidden [&>span]:grid [&>span]:gap-0.5 [&>span]:whitespace-nowrap">
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
              className="h-[34px] whitespace-nowrap px-3 text-xs active:scale-[.97] disabled:cursor-not-allowed max-[760px]:size-[39px] max-[760px]:px-0 max-[760px]:text-[0px]"
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
        className={cn(
          "app-page-header px-5 [&_.page-header-description]:hidden max-[760px]:px-4",
          !isSidebarOpen && "sidebar-closed",
        )}
        data-tauri-drag-region
        title={t("schedule.title")}
      />

      {scheduleError && (
        <div
          className="flex min-h-[34px] shrink-0 items-center gap-1.5 border-b border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-4 py-2 text-micro text-[var(--status-destructive-foreground)]"
          role="alert"
        >
          <CircleAlert size={15} />
          <span>{scheduleError}</span>
        </div>
      )}

      <section
        aria-label={t("schedule.calendarLabel")}
        className="flex min-h-0 flex-1 flex-col bg-card"
      >
        <header className="flex min-h-[52px] items-center justify-between gap-4 border-b border-border bg-card pr-4 pl-3 max-[760px]:min-h-[78px] max-[760px]:items-start max-[760px]:flex-col max-[760px]:gap-1.5 max-[760px]:px-3 max-[760px]:py-2">
          <div className="flex min-w-0 items-center gap-1 max-[760px]:w-full [&>button]:grid [&>button]:size-[29px] [&>button]:cursor-pointer [&>button]:place-items-center [&>button]:rounded-lg [&>button]:border [&>button]:border-input [&>button]:bg-card [&>button]:p-0 [&>button]:text-muted-foreground [&>button]:hover:bg-secondary [&>button]:hover:text-foreground [&>button]:active:scale-95">
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
              className="ml-1.5 w-auto! px-2.5! text-micro font-semibold disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground"
              disabled={isCurrentWeek}
              onClick={() => setWeekStart(startOfCalendarWeek(now))}
              type="button"
            >
              {t("schedule.today")}
            </button>
            <strong className="ml-2.5 truncate text-xs text-foreground max-[760px]:ml-auto">
              {weekRange}
            </strong>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-3 max-[760px]:w-full max-[760px]:justify-between">
            <div className="flex w-[166px] items-center gap-1.5 text-muted-foreground max-[760px]:w-[min(190px,55%)] [&>svg]:shrink-0 [&_.select-menu-trigger]:h-[30px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:bg-muted [&_.select-menu-trigger]:text-foreground">
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
            <div className="flex items-center gap-1.5 whitespace-nowrap font-mono text-micro font-medium text-muted-foreground max-[760px]:pl-0.5 [&>span+span]:before:mr-1.5 [&>span+span]:before:text-muted-foreground [&>span+span]:before:content-['·'] [&_svg]:text-muted-foreground">
              <Clock3 size={13} />
              <span>{formatOffset(now)}</span>
              <span>{timeZone}</span>
            </div>
          </div>
        </header>

        <div
          aria-label={t("schedule.calendarLabel")}
          className="scrollbar-subtle min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          ref={calendarScrollRef}
          role="group"
          tabIndex={0}
        >
          <div className="relative min-w-[850px] max-[760px]:min-w-[780px]">
            <div className="sticky top-0 z-10 grid h-16 min-w-[850px] grid-cols-[64px_repeat(7,minmax(112px,1fr))] border-b border-border bg-card shadow-sm backdrop-blur-xl max-[760px]:min-w-[780px] max-[760px]:grid-cols-[54px_repeat(7,minmax(103px,1fr))]">
              <div aria-hidden="true" className="border-r border-border" />
              {days.map((day) => {
                const isToday = sameLocalDay(day, now);
                return (
                  <div
                    className={cn(
                      "flex items-center justify-center gap-1.5 border-r border-border text-muted-foreground [&>span]:text-micro [&>span]:font-bold [&>span]:tracking-wide [&>span]:uppercase [&>strong]:grid [&>strong]:size-[29px] [&>strong]:place-items-center [&>strong]:rounded-full [&>strong]:font-mono [&>strong]:text-base [&>strong]:font-semibold [&>strong]:text-foreground",
                      isToday &&
                        "[&>span]:text-primary [&>strong]:bg-primary [&>strong]:text-primary-foreground [&>strong]:shadow-[0_4px_12px_var(--primary-shadow)]",
                    )}
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

            <div className="relative grid h-[1440px] min-w-[850px] grid-cols-[64px_repeat(7,minmax(112px,1fr))] max-[760px]:min-w-[780px] max-[760px]:grid-cols-[54px_repeat(7,minmax(103px,1fr))]">
              <div
                aria-hidden="true"
                className="relative h-[1440px] border-r border-border bg-card text-muted-foreground [&>span]:absolute [&>span]:right-0 [&>span]:w-full [&>span]:-translate-y-1/2 [&>span]:pr-2.5 [&>span]:text-right [&>span]:font-mono [&>span]:text-micro [&>span]:font-medium max-[760px]:[&>span]:pr-1.5"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    className={hour === 0 ? "translate-y-0!" : undefined}
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
                    className={cn(
                      "relative h-[1440px] overflow-hidden border-r border-border bg-card bg-[linear-gradient(to_bottom,transparent_29px,color-mix(in_srgb,var(--border)_45%,transparent)_30px,transparent_31px),repeating-linear-gradient(to_bottom,transparent_0,transparent_59px,var(--border)_59px,var(--border)_60px)]",
                      isToday &&
                        "bg-[color-mix(in_srgb,var(--primary)_4%,var(--card))]",
                    )}
                    key={day.toISOString()}
                  >
                    {isToday && isCurrentWeek && (
                      <div
                        aria-label={t("schedule.currentTime")}
                        className="pointer-events-none absolute inset-x-0 z-[7] h-px bg-destructive [&>span]:absolute [&>span]:top-1/2 [&>span]:-left-1 [&>span]:size-2 [&>span]:-translate-y-1/2 [&>span]:rounded-full [&>span]:border-2 [&>span]:border-card [&>span]:bg-destructive [&>span]:shadow-sm"
                        role="img"
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
                          className={cn(
                            "project-schedule-event absolute z-[3] flex min-h-[18px] cursor-pointer flex-col items-start gap-0.5 overflow-hidden rounded-md border-[1.5px] border-[var(--agent-color)] bg-card px-1.5 py-1 text-left text-[var(--agent-color)] shadow-xs hover:z-[5] hover:brightness-[.985] hover:shadow-md focus-visible:z-[6]",
                            segment.status,
                            segment.status === "running" &&
                              "bg-[color-mix(in_srgb,var(--agent-color)_12%,var(--card))]",
                            segment.status === "completed" &&
                              "bg-[var(--agent-color)] text-[var(--agent-contrast)] shadow-[0_2px_5px_color-mix(in_srgb,var(--agent-color)_28%,transparent)]",
                            (segment.status === "failed" ||
                              segment.status === "missed") &&
                              "border-destructive bg-destructive text-destructive-foreground shadow-sm",
                          )}
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
                              x: Math.min(
                                event.clientX,
                                window.innerWidth - 190,
                              ),
                              y: Math.min(
                                event.clientY,
                                window.innerHeight - 110,
                              ),
                            });
                          }}
                          style={style}
                          title={label}
                          type="button"
                        >
                          <span className="flex max-w-full items-center gap-0.5 [&_svg]:shrink-0 [&_svg]:opacity-70">
                            <Bot size={11} />
                            <strong className="truncate text-micro leading-tight">
                              {segment.agent.name}
                            </strong>
                            {segment.status === "running" && (
                              <i className="size-1.25 shrink-0 rounded-full border border-white/70 bg-success shadow-[0_0_0_2px_color-mix(in_srgb,var(--success)_14%,transparent)]" />
                            )}
                          </span>
                          <time className="whitespace-nowrap font-mono text-micro font-medium opacity-75">
                            {formatTime(segment.start, localeTag)}
                          </time>
                          <span className="line-clamp-2 w-full overflow-hidden text-micro leading-snug">
                            {segment.schedule.name}
                          </span>
                          <small className="mt-auto text-micro font-semibold opacity-70">
                            {t(statusKey)}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {allSegments.length === 0 && (
                <div className="absolute top-[300px] left-[calc(50%+32px)] z-[5] flex min-h-[130px] w-[min(330px,calc(100%_-_110px))] -translate-x-1/2 flex-col items-center justify-center rounded-2xl border border-border bg-card p-5 text-center text-muted-foreground shadow-lg backdrop-blur-lg">
                  <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <CalendarClock size={22} />
                  </span>
                  <strong className="mt-3 text-micro text-foreground">
                    {selectedAgent
                      ? t("schedule.filteredEmptyTitle", {
                          agent: selectedAgent.name,
                        })
                      : t("schedule.emptyTitle")}
                  </strong>
                  <p className="mt-1.5 mb-0 max-w-[260px] text-micro leading-relaxed">
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
          className="project-schedule-context-menu fixed z-[1100] grid w-[178px] gap-0.5 rounded-xl border border-border bg-popover/98 p-1 text-popover-foreground shadow-xl backdrop-blur-lg [&>button]:flex [&>button]:h-[34px] [&>button]:w-full [&>button]:cursor-pointer [&>button]:items-center [&>button]:gap-2 [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2.5 [&>button]:py-0 [&>button]:text-left [&>button]:text-micro [&>button]:font-semibold [&>button]:text-popover-foreground [&>button]:hover:bg-accent [&>button]:hover:text-accent-foreground"
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
            className="danger text-[var(--status-destructive-foreground)]! hover:bg-[var(--status-destructive-surface)]!"
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
      className="fixed inset-0 z-[1002] grid place-items-center bg-foreground/20 p-6 backdrop-blur-sm max-[760px]:items-end max-[760px]:p-[max(14px,env(safe-area-inset-top))_max(14px,env(safe-area-inset-right))_max(14px,env(safe-area-inset-bottom))_max(14px,env(safe-area-inset-left))]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={t("schedule.detailsDialog", { name: schedule.name })}
        aria-modal="true"
        className="flex max-h-[calc(100dvh_-_48px)] w-[min(640px,calc(100vw_-_48px))] animate-in flex-col overflow-hidden rounded-[22px] border border-border bg-card text-foreground shadow-2xl duration-200 fade-in slide-in-from-bottom-2 zoom-in-95 motion-reduce:animate-none max-[760px]:max-h-[calc(100dvh_-_28px)] max-[760px]:w-full max-[760px]:rounded-[20px_20px_14px_14px]"
        role="dialog"
      >
        <header className="grid min-h-28 grid-cols-[13px_minmax(0,1fr)_auto] items-start gap-3.5 border-b border-border bg-gradient-to-br from-card to-muted px-5 py-5 max-[760px]:grid-cols-[11px_minmax(0,1fr)] max-[760px]:px-4 max-[760px]:py-4">
          <i
            aria-hidden="true"
            className="mt-[30px] size-3 rounded-sm border-2 border-card shadow-sm max-[760px]:mt-[29px]"
            style={{ backgroundColor: agent.calendarColor }}
          />
          <div className="min-w-0">
            <p className="mb-1.5 flex items-center gap-1.5 text-micro font-bold tracking-wide text-accent-foreground uppercase">
              <CalendarDays size={13} />
              {t("schedule.detailsEyebrow")}
            </p>
            <h2 className="m-0 truncate text-2xl tracking-tighter">
              {schedule.name}
            </h2>
            <p className="mt-1.5 mb-0 text-xs text-muted-foreground">
              {occurrenceDate} · {formatTime(start, localeTag)}
            </p>
          </div>
          <div className="project-schedule-detail-actions flex gap-1 max-[760px]:col-span-full max-[760px]:justify-end [&>button]:grid [&>button]:size-[34px] [&>button]:cursor-pointer [&>button]:place-items-center [&>button]:rounded-lg [&>button]:border [&>button]:border-transparent [&>button]:bg-card/70 [&>button]:p-0 [&>button]:text-muted-foreground [&>button]:hover:border-border [&>button]:hover:bg-card [&>button]:hover:text-foreground">
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
              className="hover:border-[var(--status-destructive-border)]! hover:bg-[var(--status-destructive-surface)]! hover:text-[var(--status-destructive-foreground)]!"
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

        <div className="scrollbar-subtle grid gap-4 overflow-y-auto p-5 max-[760px]:p-4">
          <dl className="m-0 grid grid-cols-2 gap-2.5 max-[760px]:grid-cols-1 [&>div]:grid [&>div]:min-h-[58px] [&>div]:content-center [&>div]:gap-1.5 [&>div]:rounded-xl [&>div]:border [&>div]:border-border [&>div]:bg-card [&>div]:px-3 [&>div]:py-2.5 [&_dt]:text-micro [&_dt]:font-bold [&_dt]:tracking-wide [&_dt]:text-muted-foreground [&_dt]:uppercase [&_dd]:m-0 [&_dd]:flex [&_dd]:items-center [&_dd]:gap-2 [&_dd]:text-micro [&_dd]:text-foreground [&_dd>span:not([data-slot=status-pill])]:grid [&_dd>span:not([data-slot=status-pill])]:min-w-0 [&_dd>span:not([data-slot=status-pill])]:gap-0.5 [&_dd_strong]:truncate [&_dd_small]:font-mono [&_dd_small]:text-micro [&_dd_small]:text-muted-foreground [&_dd_small]:uppercase">
            <div>
              <dt>{t("schedule.statusLabel")}</dt>
              <dd>
                <span
                  className={cn(
                    "inline-flex min-h-[22px] items-center rounded-full bg-[var(--status-info-surface)] px-2 text-micro font-bold text-[var(--status-info-foreground)]",
                    status === "running" &&
                      "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]",
                    status === "completed" &&
                      "bg-primary text-primary-foreground",
                    (status === "failed" || status === "missed") &&
                      "bg-destructive text-destructive-foreground",
                  )}
                  data-slot="status-pill"
                >
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

          <section className="overflow-hidden rounded-xl border border-border bg-card [&_dt]:text-micro [&_dt]:font-bold [&_dt]:tracking-wide [&_dt]:text-muted-foreground [&_dt]:uppercase [&_dd]:m-0 [&_dd]:text-micro [&_dd]:text-foreground">
            <header className="flex min-h-[58px] items-center gap-2.5 border-b border-border bg-muted px-3.5 py-2.5">
              <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                <Bot size={16} />
              </span>
              <div className="grid min-w-0 gap-0.5">
                <strong className="text-xs text-foreground">
                  {t("schedule.sessionContent")}
                </strong>
                <small className="font-mono text-micro text-muted-foreground">
                  {run
                    ? t("schedule.sessionRunId", { id: run.id.slice(0, 8) })
                    : t("schedule.sessionNotStarted")}
                </small>
              </div>
            </header>
            {run ? (
              <>
                <dl className="m-0 flex gap-6 border-b border-border px-3.5 py-2.5 max-[760px]:flex-col max-[760px]:gap-2.5 [&>div]:grid [&>div]:gap-1">
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
                  className={cn(
                    "m-3 [overflow-wrap:anywhere] whitespace-pre-wrap rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-surface)] px-3.5 py-3 text-micro leading-relaxed text-[var(--status-info-foreground)]",
                    run.status === "failed" &&
                      "border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] text-[var(--status-destructive-foreground)]",
                  )}
                >
                  {run.resultSummary ||
                    run.error ||
                    t("schedule.sessionRunning")}
                </div>
              </>
            ) : (
              <p className="m-0 p-5 text-center text-micro leading-relaxed text-muted-foreground">
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
      className="dialog-backdrop z-[1102]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onClose();
      }}
    >
      <section
        aria-label={t("schedule.deleteDialog", { name: schedule.name })}
        aria-modal="true"
        className="project-schedule-delete-dialog grid w-[min(440px,calc(100vw_-_36px))] grid-cols-[44px_minmax(0,1fr)] gap-3.5 rounded-[18px] border border-[var(--status-destructive-border)] bg-card p-5 shadow-2xl [&>span]:grid [&>span]:size-11 [&>span]:place-items-center [&>span]:rounded-xl [&>span]:bg-[var(--status-destructive-surface)] [&>span]:text-[var(--status-destructive-foreground)] [&_h2]:mt-0.5 [&_h2]:mb-0 [&_h2]:text-lg [&_h2]:tracking-tight [&_p]:mt-2 [&_p]:mb-0 [&_p]:text-micro [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_small[role=alert]]:mt-2 [&_small[role=alert]]:block [&_small[role=alert]]:text-micro [&_small[role=alert]]:text-[var(--status-destructive-foreground)] [&>footer]:col-span-full [&>footer]:mt-4 [&>footer]:flex [&>footer]:justify-end [&>footer]:gap-1.5 [&>footer>button]:flex [&>footer>button]:h-9 [&>footer>button]:min-w-[78px] [&>footer>button]:cursor-pointer [&>footer>button]:items-center [&>footer>button]:justify-center [&>footer>button]:gap-1.5 [&>footer>button]:rounded-lg [&>footer>button]:border [&>footer>button]:border-border [&>footer>button]:bg-card [&>footer>button]:px-3 [&>footer>button]:text-micro [&>footer>button]:font-semibold [&>footer>button]:text-foreground [&>footer>button]:disabled:cursor-not-allowed [&>footer>button]:disabled:opacity-55"
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
            className="danger border-destructive! bg-destructive! text-destructive-foreground!"
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
            {isDeleting ? <Spinner size={14} /> : <Trash2 size={14} />}
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
  const [recurrence, setRecurrence] = useState<ProjectAgentScheduleRecurrence>(
    schedule?.recurrence ?? "weekdays",
  );
  const [timeOfDay, setTimeOfDay] = useState(schedule?.timeOfDay ?? "09:00");
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
        (schedule?.recurrence === "weekly" ? [schedule.dayOfWeek ?? 1] : [1]),
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
  const isCustomWeekly = recurrence === "custom" && intervalUnit === "week";
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
      className="dialog-backdrop z-[1001] bg-foreground/25 p-6 backdrop-blur-md max-[760px]:items-end max-[760px]:p-[max(14px,env(safe-area-inset-top))_max(14px,env(safe-area-inset-right))_max(14px,env(safe-area-inset-bottom))_max(14px,env(safe-area-inset-left))]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        aria-label={t(
          isEditing ? "schedule.editDialog" : "schedule.createDialog",
        )}
        aria-modal="true"
        className="project-schedule-dialog flex max-h-[calc(100dvh_-_48px)] w-[min(720px,calc(100vw_-_48px))] animate-in flex-col overflow-hidden rounded-[20px] border border-border bg-card text-foreground shadow-2xl duration-200 fade-in slide-in-from-bottom-2 zoom-in-95 motion-reduce:animate-none max-[760px]:max-h-[calc(100dvh_-_28px)] max-[760px]:w-full max-[760px]:rounded-[20px_20px_14px_14px] [&>header]:flex [&>header]:min-h-[94px] [&>header]:items-start [&>header]:justify-between [&>header]:gap-5 [&>header]:border-b [&>header]:border-border [&>header]:px-5 [&>header]:py-4 [&>header>div]:min-w-0 [&>header_h2]:m-0 [&>header_h2]:text-xl [&>header_h2]:tracking-tighter [&>header_p:last-child]:mt-1.5 [&>header_p:last-child]:mb-0 [&>header_p:last-child]:text-micro [&>header_p:last-child]:text-muted-foreground [&>header>button]:grid [&>header>button]:size-[34px] [&>header>button]:shrink-0 [&>header>button]:cursor-pointer [&>header>button]:place-items-center [&>header>button]:rounded-lg [&>header>button]:border [&>header>button]:border-border [&>header>button]:bg-muted [&>header>button]:p-0 [&>header>button]:text-muted-foreground [&>header>button]:hover:bg-secondary [&>header>button]:hover:text-foreground max-[760px]:[&>header]:min-h-[88px] max-[760px]:[&>header]:px-4 max-[760px]:[&>header]:py-4 [&>footer]:flex [&>footer]:min-h-[65px] [&>footer]:items-center [&>footer]:justify-end [&>footer]:gap-2 [&>footer]:border-t [&>footer]:border-border [&>footer]:bg-muted [&>footer]:px-5 [&>footer]:py-3 max-[760px]:[&>footer]:pb-[max(12px,env(safe-area-inset-bottom))] [&>footer>button]:flex [&>footer>button]:h-[38px] [&>footer>button]:min-w-[78px] [&>footer>button]:cursor-pointer [&>footer>button]:items-center [&>footer>button]:justify-center [&>footer>button]:gap-1.5 [&>footer>button]:rounded-lg [&>footer>button]:border [&>footer>button]:border-border [&>footer>button]:bg-card [&>footer>button]:px-3.5 [&>footer>button]:text-micro [&>footer>button]:font-semibold [&>footer>button]:text-foreground [&>footer>button]:disabled:cursor-not-allowed [&>footer>button]:disabled:opacity-55 max-[760px]:[&>footer>button]:flex-1"
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
            dayOfWeek: normalizeProjectAgentScheduleDay(recurrence, dayOfWeek),
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
            <p className="mb-1 flex items-center gap-1.5 text-micro font-bold tracking-wide text-accent-foreground uppercase">
              {isEditing ? <Pencil size={13} /> : <CalendarPlus size={13} />}
              {t(isEditing ? "schedule.editEyebrow" : "schedule.newEyebrow")}
            </p>
            <h2>{t(isEditing ? "schedule.edit" : "schedule.create")}</h2>
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

        <div className="scrollbar-subtle grid auto-rows-max gap-4 overflow-y-auto px-5 py-5 max-[760px]:px-4 max-[760px]:py-4 [&>label]:grid [&>label]:min-w-0 [&>label]:gap-1.5 [&>label]:text-micro [&>label]:font-semibold [&>label]:text-foreground [&>label>span_em]:font-medium [&>label>span_em]:text-muted-foreground [&>label>span_em]:not-italic [&_input]:h-[42px] [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-border [&_input]:bg-muted [&_input]:px-3 [&_input]:py-0 [&_input]:text-xs [&_input]:text-foreground [&_input]:outline-none [&_input]:focus:border-ring [&_input]:focus:bg-card [&_input]:focus:ring-3 [&_input]:focus:ring-ring/15 [&_.native-select]:w-full [&_.select-menu-trigger]:h-[42px] [&_.select-menu-trigger]:w-full [&_.select-menu-trigger]:rounded-xl">
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
            <div className="grid min-h-[74px] grid-cols-[38px_minmax(0,1fr)] items-center gap-2.5 rounded-xl border border-border bg-muted px-3 py-2.5">
              <span
                className={cn(
                  "grid size-[38px] place-items-center rounded-xl bg-accent text-accent-foreground",
                  selectedAgent.provider === "claude" &&
                    "bg-orange-50 text-[#ad6540] dark:bg-orange-950/30",
                  selectedAgent.provider === "grok" &&
                    "bg-emerald-50 text-[#39776f] dark:bg-emerald-950/30",
                )}
              >
                <Bot size={18} />
              </span>
              <div className="min-w-0">
                <strong className="text-micro text-foreground">
                  {selectedAgent.name}
                </strong>
                <p className="mt-1 mb-0 line-clamp-2 text-micro leading-relaxed text-muted-foreground">
                  {selectedAgent.description || selectedAgent.responsibility}
                </p>
              </div>
            </div>
          )}

          <div className="project-schedule-frequency overflow-hidden rounded-xl border border-border bg-card [&>div]:grid [&>div]:min-h-12 [&>div]:grid-cols-[minmax(105px,1fr)_minmax(210px,1.35fr)] [&>div]:items-center [&>div]:gap-4 [&>div]:border-b [&>div]:border-border [&>div]:px-3 [&>div]:py-1.5 [&>div:last-child]:border-b-0 [&>div>span]:text-micro [&>div>span]:font-semibold [&>div>span]:text-foreground [&>div>.native-select]:w-full [&>div>.native-select]:justify-self-end [&>div>input]:h-9 [&>div>input]:w-full [&>div>input]:justify-self-end [&>div>input]:border-transparent [&>div>input]:bg-muted [&>div>input]:text-right [&>div_.select-menu-trigger]:h-9 [&>div_.select-menu-trigger]:border-transparent [&>div_.select-menu-trigger]:bg-muted max-[760px]:[&>div]:grid-cols-[minmax(78px,.6fr)_minmax(0,1.4fr)] max-[760px]:[&>div]:gap-2.5">
            <div>
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
              <div>
                <span>{t("schedule.repeats")}</span>
                <NativeSelect
                  label={t("schedule.repeats")}
                  onValueChange={(value) =>
                    setIntervalUnit(value as ProjectAgentScheduleIntervalUnit)
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
              <div>
                <span>{t("schedule.every")}</span>
                <div className="grid min-w-0 grid-cols-[82px_minmax(120px,1fr)] items-center gap-2 max-[760px]:grid-cols-[68px_minmax(0,1fr)] [&>input]:h-9 [&>input]:text-right [&>strong]:pr-2 [&>strong]:text-right [&>strong]:text-micro [&>strong]:font-medium [&>strong]:text-muted-foreground">
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
              <div>
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
              <div className="py-2! [&>small]:col-start-2 [&>small]:text-micro [&>small]:text-[var(--status-destructive-foreground)]">
                <span>{t("schedule.on")}</span>
                <div
                  aria-label={t("schedule.days")}
                  className="project-schedule-day-picker grid grid-cols-7 gap-1 max-[760px]:gap-0.5 [&>button]:h-8 [&>button]:min-w-0 [&>button]:cursor-pointer [&>button]:rounded-lg [&>button]:border [&>button]:border-border [&>button]:bg-muted [&>button]:px-0.5 [&>button]:text-micro [&>button]:font-semibold [&>button]:text-muted-foreground [&>button]:hover:border-ring [&>button[aria-pressed=true]]:border-primary [&>button[aria-pressed=true]]:bg-primary [&>button[aria-pressed=true]]:text-primary-foreground max-[760px]:[&>button]:h-[30px] max-[760px]:[&>button]:text-[7px]"
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
              <div>
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

            <div>
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

          <div className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-surface)] px-2.5 text-micro text-[var(--status-info-foreground)]">
            <Clock3 size={14} />
            <span>{t("schedule.timeZone", { timeZone })}</span>
          </div>

          {submitError && (
            <p
              className="m-0 flex items-center gap-1.5 rounded-lg border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-2.5 py-2 text-micro text-[var(--status-destructive-foreground)]"
              role="alert"
            >
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
            className="min-w-[126px]! border-primary! bg-primary! text-primary-foreground!"
            disabled={isSubmitting || !canSubmit}
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
