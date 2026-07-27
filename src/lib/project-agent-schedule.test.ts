import { describe, expect, it } from "vitest";
import {
  isValidProjectAgentScheduleTimeZone,
  nextProjectAgentScheduleRunAt,
  normalizeProjectAgentScheduleDay,
} from "./project-agent-schedule";

describe("project agent schedule timing", () => {
  it("validates IANA time-zone identifiers before persistence", () => {
    expect(isValidProjectAgentScheduleTimeZone("Asia/Seoul")).toBe(true);
    expect(isValidProjectAgentScheduleTimeZone("Mars/Olympus")).toBe(false);
  });

  it("resolves a daily wall-clock time in its configured zone", () => {
    expect(
      nextProjectAgentScheduleRunAt(
        {
          recurrence: "daily",
          timeOfDay: "09:00",
          dayOfWeek: null,
          timeZone: "Asia/Seoul",
        },
        new Date("2026-07-27T23:59:00Z"),
      ),
    ).toBe("2026-07-28T00:00:00.000Z");
  });

  it("skips weekends and targets the configured weekly day", () => {
    expect(
      nextProjectAgentScheduleRunAt(
        {
          recurrence: "weekdays",
          timeOfDay: "09:00",
          dayOfWeek: null,
          timeZone: "Etc/UTC",
        },
        new Date("2026-07-31T09:00:00Z"),
      ),
    ).toBe("2026-08-03T09:00:00.000Z");
    expect(
      nextProjectAgentScheduleRunAt(
        {
          recurrence: "weekly",
          timeOfDay: "12:30",
          dayOfWeek: normalizeProjectAgentScheduleDay("weekly", 3),
          timeZone: "Etc/UTC",
        },
        new Date("2026-07-27T00:00:00Z"),
      ),
    ).toBe("2026-07-29T12:30:00.000Z");
  });

  it("uses the earlier matching minute when daylight saving time repeats", () => {
    expect(
      nextProjectAgentScheduleRunAt(
        {
          recurrence: "daily",
          timeOfDay: "01:30",
          dayOfWeek: null,
          timeZone: "America/New_York",
        },
        new Date("2026-11-01T04:00:00Z"),
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("normalizes a daylight-saving gap forward", () => {
    expect(
      nextProjectAgentScheduleRunAt(
        {
          recurrence: "daily",
          timeOfDay: "02:30",
          dayOfWeek: null,
          timeZone: "America/New_York",
        },
        new Date("2026-03-08T00:00:00Z"),
      ),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("keeps interval schedules aligned to their creation instant", () => {
    const schedule = {
      recurrence: "interval" as const,
      intervalValue: 30,
      intervalUnit: "minute" as const,
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
      anchorAt: "2026-07-27T00:00:00.000Z",
    };

    expect(
      nextProjectAgentScheduleRunAt(
        schedule,
        new Date("2026-07-27T00:00:00.000Z"),
      ),
    ).toBe("2026-07-27T00:30:00.000Z");
    expect(
      nextProjectAgentScheduleRunAt(
        schedule,
        new Date("2026-07-27T01:05:00.000Z"),
      ),
    ).toBe("2026-07-27T01:30:00.000Z");
  });

  it("supports custom multi-day schedules every several weeks", () => {
    const schedule = {
      recurrence: "custom" as const,
      intervalValue: 2,
      intervalUnit: "week" as const,
      daysOfWeek: [1, 3],
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
      anchorAt: "2026-07-27T00:00:00.000Z",
    };

    expect(
      nextProjectAgentScheduleRunAt(
        schedule,
        new Date("2026-07-27T10:00:00.000Z"),
      ),
    ).toBe("2026-07-29T09:00:00.000Z");
    expect(
      nextProjectAgentScheduleRunAt(
        schedule,
        new Date("2026-07-29T09:00:00.000Z"),
      ),
    ).toBe("2026-08-10T09:00:00.000Z");
  });
});
