export const projectAgentScheduleRecurrences = [
  "daily",
  "weekdays",
  "weekly",
] as const;

export type ProjectAgentScheduleRecurrence =
  (typeof projectAgentScheduleRecurrences)[number];

export function isValidProjectAgentScheduleTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

export function normalizeProjectAgentScheduleDay(
  recurrence: ProjectAgentScheduleRecurrence,
  dayOfWeek: number | null | undefined,
) {
  if (recurrence !== "weekly") return null;
  return Number.isInteger(dayOfWeek) && dayOfWeek! >= 0 && dayOfWeek! <= 6
    ? dayOfWeek!
    : 1;
}
