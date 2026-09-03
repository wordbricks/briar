export const teamAgentScheduleRecurrences = [
  "interval",
  "daily",
  "weekdays",
  "weekly",
  "custom",
] as const;

export type TeamAgentScheduleRecurrence =
  (typeof teamAgentScheduleRecurrences)[number];

export const teamAgentScheduleIntervalUnits = [
  "minute",
  "hour",
  "day",
  "week",
] as const;

export type TeamAgentScheduleIntervalUnit =
  (typeof teamAgentScheduleIntervalUnits)[number];

export const teamAgentScheduleNotificationLevels = [
  "important_updates",
  "none",
] as const;

export type TeamAgentScheduleNotificationLevel =
  (typeof teamAgentScheduleNotificationLevels)[number];

export function isValidTeamAgentScheduleTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

export function isValidTeamAgentScheduleTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeTeamAgentScheduleDay(
  recurrence: TeamAgentScheduleRecurrence,
  dayOfWeek: number | null | undefined,
) {
  if (recurrence !== "weekly") return null;
  return Number.isInteger(dayOfWeek) && dayOfWeek! >= 0 && dayOfWeek! <= 6
    ? dayOfWeek!
    : 1;
}

export function normalizeTeamAgentScheduleInterval(
  value: number | null | undefined,
) {
  return Number.isInteger(value) && value! >= 1 && value! <= 999 ? value! : 1;
}

export function normalizeTeamAgentScheduleDays(
  values: readonly number[] | null | undefined,
) {
  return [
    ...new Set(
      (values ?? []).filter(
        (value) => Number.isInteger(value) && value >= 0 && value <= 6,
      ),
    ),
  ].sort((left, right) => left - right);
}

export function serializeTeamAgentScheduleDays(
  values: readonly number[] | null | undefined,
) {
  const normalized = normalizeTeamAgentScheduleDays(values);
  return normalized.length > 0 ? normalized.join(",") : null;
}

export function parseTeamAgentScheduleDays(
  value: string | null | undefined,
) {
  return normalizeTeamAgentScheduleDays(
    value
      ?.split(",")
      .map(Number)
      .filter((day) => Number.isFinite(day)),
  );
}

export type TeamAgentScheduleTiming = {
  recurrence: TeamAgentScheduleRecurrence;
  timeOfDay: string;
  dayOfWeek: number | null;
  timeZone: string;
  intervalValue?: number;
  intervalUnit?: TeamAgentScheduleIntervalUnit;
  daysOfWeek?: number[];
  anchorAt?: string;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
};

const weekdayIndex = new Map([
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
]);

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

function partsAt(value: Date, timeZone: string) {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayOfWeek: weekdayIndex.get(parts.weekday) ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function offsetAt(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(value);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value;
  if (!offset || offset === "GMT") return 0;
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/u);
  if (!match) {
    throw new RangeError(`Unsupported time-zone offset: ${offset}`);
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === "-" ? -1 : 1) * minutes * 60_000;
}

function zonedMinuteCandidates(
  date: ZonedDateParts,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const wallTime = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const offsets = new Set([
    offsetAt(new Date(wallTime), timeZone),
    offsetAt(new Date(wallTime - 24 * 60 * 60_000), timeZone),
    offsetAt(new Date(wallTime + 24 * 60 * 60_000), timeZone),
  ]);
  const exact: number[] = [];
  const normalized: number[] = [];
  for (const offset of offsets) {
    const candidate = wallTime - offset;
    const parts = partsAt(new Date(candidate), timeZone);
    if (
      parts.year === date.year &&
      parts.month === date.month &&
      parts.day === date.day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      exact.push(candidate);
    } else if (
      parts.year === date.year &&
      parts.month === date.month &&
      parts.day === date.day &&
      (parts.hour > hour || (parts.hour === hour && parts.minute > minute))
    ) {
      // A wall-clock minute can be skipped by a DST transition. Match
      // Temporal's compatible behavior and run at the first normalized time
      // after that gap instead of silently dropping the recurrence.
      normalized.push(candidate);
    }
  }
  return [...new Set(exact.length > 0 ? exact : normalized)].sort(
    (left, right) => left - right,
  );
}

function addUtcDays(date: ZonedDateParts, amount: number): ZonedDateParts {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    dayOfWeek: next.getUTCDay(),
  };
}

function calendarDayNumber(date: ZonedDateParts) {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function intervalMilliseconds(unit: TeamAgentScheduleIntervalUnit) {
  if (unit === "minute") return 60_000;
  if (unit === "hour") return 60 * 60_000;
  if (unit === "day") return 24 * 60 * 60_000;
  return 7 * 24 * 60 * 60_000;
}

function nextIntervalRunAt(
  schedule: TeamAgentScheduleTiming,
  after: Date,
) {
  const intervalValue = normalizeTeamAgentScheduleInterval(
    schedule.intervalValue,
  );
  const intervalUnit = schedule.intervalUnit ?? "hour";
  const duration = intervalValue * intervalMilliseconds(intervalUnit);
  const parsedAnchor = schedule.anchorAt
    ? Date.parse(schedule.anchorAt)
    : Number.NaN;
  const anchor = Number.isFinite(parsedAnchor) ? parsedAnchor : after.getTime();
  const elapsed = after.getTime() - anchor;
  const step = Math.max(1, Math.floor(elapsed / duration) + 1);
  return new Date(anchor + step * duration).toISOString();
}

function dateMatches(
  date: ZonedDateParts,
  schedule: TeamAgentScheduleTiming,
  anchor: ZonedDateParts,
) {
  const { recurrence, dayOfWeek } = schedule;
  if (recurrence === "daily") return true;
  if (recurrence === "weekdays") {
    return date.dayOfWeek >= 1 && date.dayOfWeek <= 5;
  }
  if (recurrence === "weekly") {
    return (
      date.dayOfWeek ===
      normalizeTeamAgentScheduleDay(recurrence, dayOfWeek)
    );
  }
  if (recurrence !== "custom") return false;

  const interval = normalizeTeamAgentScheduleInterval(
    schedule.intervalValue,
  );
  const dayOffset = calendarDayNumber(date) - calendarDayNumber(anchor);
  if (dayOffset < 0) return false;
  if ((schedule.intervalUnit ?? "week") === "day") {
    return dayOffset % interval === 0;
  }

  const anchorWeek =
    calendarDayNumber(anchor) - anchor.dayOfWeek;
  const dateWeek = calendarDayNumber(date) - date.dayOfWeek;
  const weekOffset = (dateWeek - anchorWeek) / 7;
  const days = normalizeTeamAgentScheduleDays(schedule.daysOfWeek);
  return (
    weekOffset >= 0 &&
    weekOffset % interval === 0 &&
    (days.length > 0 ? days : [1]).includes(date.dayOfWeek)
  );
}

/**
 * Return the first scheduled instant strictly after `after`.
 *
 * Schedule fields are wall-clock values in an IANA time zone. Keeping this
 * conversion in one shared helper makes creation and post-claim advancement
 * agree across DST boundaries.
 */
export function nextTeamAgentScheduleRunAt(
  schedule: TeamAgentScheduleTiming,
  after: Date,
) {
  if (schedule.recurrence === "interval") {
    return nextIntervalRunAt(schedule, after);
  }
  if (!isValidTeamAgentScheduleTime(schedule.timeOfDay)) {
    throw new RangeError(`Invalid schedule time: ${schedule.timeOfDay}`);
  }
  const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
  const local = partsAt(after, schedule.timeZone);
  const start: ZonedDateParts = {
    year: local.year,
    month: local.month,
    day: local.day,
    dayOfWeek: local.dayOfWeek,
  };
  const anchorInstant = schedule.anchorAt
    ? new Date(schedule.anchorAt)
    : after;
  const anchor = Number.isNaN(anchorInstant.getTime())
    ? start
    : partsAt(anchorInstant, schedule.timeZone);
  const lookaheadDays =
    schedule.recurrence === "custom"
      ? normalizeTeamAgentScheduleInterval(schedule.intervalValue) * 7 + 7
      : 8;
  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    const date = addUtcDays(start, offset);
    if (!dateMatches(date, schedule, anchor)) continue;
    const candidate = zonedMinuteCandidates(
      date,
      hour,
      minute,
      schedule.timeZone,
    ).find((value) => value > after.getTime());
    if (candidate !== undefined) return new Date(candidate).toISOString();
  }
  throw new RangeError("Unable to resolve the next schedule occurrence");
}
