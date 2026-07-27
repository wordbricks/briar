import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import {
  scheduleOccurrenceSegmentsForWeek,
  scheduleSegmentsForWeek,
  startOfCalendarWeek,
} from "../lib/project-schedule";
import type {
  ProjectAgent,
  ProjectAgentSchedule,
  ProjectAgentScheduleRun,
} from "../types";
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

  it("maps planned, completed, failed, and missed occurrences to calendar blocks", () => {
    const agent: ProjectAgent = {
      id: "11111111-1111-4111-8111-111111111111",
      projectId: demoDashboard.project.id,
      name: "Calendar agent",
      provider: "codex",
      model: null,
      responsibility: "Run calendar work.",
      calendarColor: "#8b5cf6",
      kind: "custom",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
    const schedule = (
      id: string,
      name: string,
      timeOfDay: string,
    ): ProjectAgentSchedule => ({
      id,
      projectId: demoDashboard.project.id,
      agentId: agent.id,
      agentName: agent.name,
      agentProvider: agent.provider,
      name,
      recurrence: "daily",
      timeOfDay,
      dayOfWeek: null,
      timeZone: "Asia/Seoul",
      enabled: true,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    });
    const completedSchedule = schedule(
      "22222222-2222-4222-8222-222222222222",
      "Completed task",
      "09:00",
    );
    const failedSchedule = schedule(
      "33333333-3333-4333-8333-333333333333",
      "Failed task",
      "10:00",
    );
    const missedSchedule = schedule(
      "44444444-4444-4444-8444-444444444444",
      "Missed task",
      "11:00",
    );
    const completedRun = calendarRun(
      "55555555-5555-4555-8555-555555555555",
      agent.name,
      "2026-07-27T00:02:00.000Z",
      "2026-07-27T00:20:00.000Z",
      completedSchedule.name,
    );
    completedRun.scheduleId = completedSchedule.id;
    completedRun.scheduledFor = "2026-07-27T00:00:00.000Z";
    const failedRun = calendarRun(
      "66666666-6666-4666-8666-666666666666",
      agent.name,
      "2026-07-27T01:01:00.000Z",
      "2026-07-27T01:10:00.000Z",
      failedSchedule.name,
    );
    failedRun.scheduleId = failedSchedule.id;
    failedRun.scheduledFor = "2026-07-27T01:00:00.000Z";
    failedRun.status = "failed";

    const segments = scheduleOccurrenceSegmentsForWeek(
      [completedSchedule, failedSchedule, missedSchedule],
      [completedRun, failedRun],
      [agent],
      weekStart,
      new Date("2026-07-27T03:00:00.000Z"),
    ).flat();

    expect(
      segments.find(
        (segment) =>
          segment.schedule.id === completedSchedule.id &&
          segment.start.toISOString() === completedRun.scheduledFor,
      )?.status,
    ).toBe("completed");
    expect(
      segments.find(
        (segment) =>
          segment.schedule.id === failedSchedule.id &&
          segment.start.toISOString() === failedRun.scheduledFor,
      )?.status,
    ).toBe("failed");
    expect(
      segments.find(
        (segment) =>
          segment.schedule.id === missedSchedule.id &&
          segment.start.toISOString() === "2026-07-27T02:00:00.000Z",
      )?.status,
    ).toBe("missed");
    expect(
      segments.find(
        (segment) =>
          segment.schedule.id === completedSchedule.id &&
          segment.start.toISOString() === "2026-07-28T00:00:00.000Z",
      )?.status,
    ).toBe("scheduled");
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
