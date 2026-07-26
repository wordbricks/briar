import type { HuntRun } from "../types";

const dayCount = 7;
const minuteMs = 60_000;

export type ScheduleSegment = {
  id: string;
  run: HuntRun;
  agent: string;
  dayIndex: number;
  start: Date;
  end: Date;
  startMinute: number;
  endMinute: number;
  lane: number;
  laneCount: number;
};

type ExecutionWindow = {
  run: HuntRun;
  agent: string;
  start: Date;
  end: Date;
};

export function startOfCalendarWeek(value: Date) {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function addCalendarDays(value: Date, count: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + count);
  return next;
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function agentForRun(run: HuntRun) {
  if (run.claimedBy?.trim()) return run.claimedBy.trim();
  const eventActor = [...run.events]
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime(),
    )
    .find((event) => event.actor.trim())?.actor;
  return eventActor?.trim() || "Briar Agent";
}

function executionWindow(run: HuntRun, now: Date): ExecutionWindow | null {
  const chronologicalEvents = run.events
    .map((event) => ({ event, date: validDate(event.occurredAt) }))
    .filter(
      (
        candidate,
      ): candidate is { event: HuntRun["events"][number]; date: Date } =>
        candidate.date !== null,
    )
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const runningEvent = chronologicalEvents.find(
    ({ event }) => event.status === "running",
  );
  const firstEvent = chronologicalEvents[0];
  const lastEvent = chronologicalEvents[chronologicalEvents.length - 1];
  const start =
    validDate(run.claimedAt) ??
    runningEvent?.date ??
    firstEvent?.date ??
    validDate(run.startedAt);
  if (!start) return null;

  const recordedEnd =
    validDate(run.completedAt) ??
    lastEvent?.date ??
    validDate(run.updatedAt);
  const end =
    run.status === "running" && now.getTime() > start.getTime()
      ? now
      : recordedEnd ?? new Date(start.getTime() + 15 * minuteMs);
  const normalizedEnd =
    end.getTime() > start.getTime()
      ? end
      : new Date(start.getTime() + 15 * minuteMs);

  return { run, agent: agentForRun(run), start, end: normalizedEnd };
}

export function minutesIntoCalendarDay(value: Date) {
  return (
    value.getHours() * 60 +
    value.getMinutes() +
    value.getSeconds() / 60
  );
}

function assignLanes(segments: ScheduleSegment[]) {
  const sorted = [...segments].sort(
    (left, right) =>
      left.startMinute - right.startMinute ||
      left.endMinute - right.endMinute,
  );
  let cluster: ScheduleSegment[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const finishCluster = () => {
    const laneCount = Math.max(1, laneEnds.length);
    for (const segment of cluster) segment.laneCount = laneCount;
    cluster = [];
    clusterEnd = -1;
    laneEnds = [];
  };

  for (const segment of sorted) {
    if (cluster.length > 0 && segment.startMinute >= clusterEnd) {
      finishCluster();
    }
    const availableLane = laneEnds.findIndex(
      (laneEnd) => laneEnd <= segment.startMinute,
    );
    const lane = availableLane === -1 ? laneEnds.length : availableLane;
    laneEnds[lane] = segment.endMinute;
    segment.lane = lane;
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.endMinute);
  }
  finishCluster();
  return sorted;
}

export function scheduleSegmentsForWeek(
  runs: HuntRun[],
  weekStart: Date,
  now: Date,
) {
  const weekEnd = addCalendarDays(weekStart, dayCount);
  const byDay: ScheduleSegment[][] = Array.from(
    { length: dayCount },
    () => [],
  );

  for (const run of runs) {
    const window = executionWindow(run, now);
    if (
      !window ||
      window.end.getTime() <= weekStart.getTime() ||
      window.start.getTime() >= weekEnd.getTime()
    ) {
      continue;
    }

    for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
      const dayStart = addCalendarDays(weekStart, dayIndex);
      const dayEnd = addCalendarDays(dayStart, 1);
      if (
        window.end.getTime() <= dayStart.getTime() ||
        window.start.getTime() >= dayEnd.getTime()
      ) {
        continue;
      }
      const start =
        window.start.getTime() > dayStart.getTime() ? window.start : dayStart;
      const end =
        window.end.getTime() < dayEnd.getTime() ? window.end : dayEnd;
      const startMinute =
        start.getTime() === dayStart.getTime()
          ? 0
          : minutesIntoCalendarDay(start);
      const endMinute =
        end.getTime() === dayEnd.getTime()
          ? 1_440
          : minutesIntoCalendarDay(end);
      byDay[dayIndex].push({
        id: `${run.id}:${dayIndex}`,
        run,
        agent: window.agent,
        dayIndex,
        start,
        end,
        startMinute,
        endMinute: Math.max(startMinute + 1, endMinute),
        lane: 0,
        laneCount: 1,
      });
    }
  }

  return byDay.map(assignLanes);
}
