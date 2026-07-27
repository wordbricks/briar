import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import {
  scheduleSegmentsForWeek,
  startOfCalendarWeek,
} from "../lib/project-schedule";
import type { ProjectAgentScheduleRun } from "../types";
import { ProjectSchedule } from "./ProjectSchedule";

function calendarRun(
  id: string,
  agent: string,
  start: string,
  end: string,
  title = `Task ${id}`,
): ProjectAgentScheduleRun {
  return {
    id,
    projectId: demoDashboard.project.id,
    scheduleId: `schedule-${id}`,
    scheduleName: title,
    agent: {
      id: `agent-${id}`,
      name: agent,
      provider: "codex",
      model: null,
      responsibility: "Run scheduled work.",
    },
    status: "completed",
    scheduledFor: start,
    leaseExpiresAt: null,
    startedAt: start,
    completedAt: end,
    resultSummary: "Completed.",
    error: null,
  };
}

describe("ProjectSchedule", () => {
  const now = new Date("2026-07-27T02:15:00");
  const weekStart = startOfCalendarWeek(now);

  it("places overlapping agent runs in adjacent lanes", () => {
    const segments = scheduleSegmentsForWeek(
      [
        calendarRun(
          "run-1",
          "Agent A",
          "2026-07-27T01:00:00",
          "2026-07-27T03:00:00",
        ),
        calendarRun(
          "run-2",
          "Agent B",
          "2026-07-27T01:30:00",
          "2026-07-27T04:00:00",
        ),
        calendarRun(
          "run-3",
          "Agent C",
          "2026-07-27T04:00:00",
          "2026-07-27T05:00:00",
        ),
      ],
      weekStart,
      now,
    )[1];

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ lane: 0, laneCount: 2 });
    expect(segments[1]).toMatchObject({ lane: 1, laneCount: 2 });
    expect(segments[2]).toMatchObject({ lane: 0, laneCount: 1 });
  });

  it("splits a run that crosses midnight into day-sized blocks", () => {
    const segments = scheduleSegmentsForWeek(
      [
        calendarRun(
          "run-4",
          "Night Agent",
          "2026-07-27T23:30:00",
          "2026-07-28T01:15:00",
        ),
      ],
      weekStart,
      now,
    );

    expect(segments[1][0]).toMatchObject({
      startMinute: 1_410,
      endMinute: 1_440,
    });
    expect(segments[2][0]).toMatchObject({
      startMinute: 0,
      endMinute: 75,
    });
  });

  it("renders the calendar shell, live time, and week controls", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <ProjectSchedule
          isSidebarOpen
          now={now}
          project={demoDashboard.project}
          token={null}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("에이전트 작업 주간 캘린더");
    expect(markup).toContain("project-schedule-now");
    expect(markup).toContain('aria-label="이전 주"');
  });
});
