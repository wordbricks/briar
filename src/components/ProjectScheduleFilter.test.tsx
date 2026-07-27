/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import type {
  ProjectAgent,
  ProjectAgentSchedule,
  ProjectAgentScheduleRun,
} from "../types";
import { ProjectSchedule } from "./ProjectSchedule";

const projectId = "22222222-2222-4222-8222-222222222222";
const project = { ...demoDashboard.project, id: projectId };
const agentA: ProjectAgent = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId,
  name: "Agent A",
  kind: "custom",
  provider: "codex",
  model: null,
  responsibility: "Review changes.",
  calendarColor: "#3275d5",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};
const agentB: ProjectAgent = {
  ...agentA,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Agent B",
  provider: "claude",
};
const agentC: ProjectAgent = {
  ...agentA,
  id: "66666666-6666-4666-8666-666666666666",
  name: "Agent C",
};

function calendarRun(
  id: string,
  scheduleId: string,
  agent: ProjectAgent,
  scheduleName: string,
  startedAt = "2026-07-27T01:00:00.000Z",
  completedAt = "2026-07-27T02:00:00.000Z",
  status: ProjectAgentScheduleRun["status"] = "completed",
): ProjectAgentScheduleRun {
  return {
    id,
    projectId,
    scheduleId,
    scheduleName,
    agent: {
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      responsibility: agent.responsibility,
    },
    status,
    scheduledFor: startedAt,
    leaseExpiresAt: null,
    startedAt,
    completedAt,
    resultSummary: status === "completed" ? "Completed." : null,
    error: status === "failed" ? "Execution failed." : null,
  };
}

function calendarSchedule(
  id: string,
  agent: ProjectAgent,
  name: string,
  timeOfDay = "10:00",
): ProjectAgentSchedule {
  return {
    id,
    projectId,
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
  };
}

function stubScheduleApi({
  agents,
  runs = [],
  schedules = [],
}: {
  agents: ProjectAgent[];
  runs?: ProjectAgentScheduleRun[];
  schedules?: ProjectAgentSchedule[];
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/agent-schedule-runs")
        ? { runs }
        : url.endsWith("/agent-schedules")
          ? { schedules }
          : { agents };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectSchedule agent filter", () => {
  it("filters agent execution history and summary metrics by agent id", async () => {
    stubScheduleApi({
      agents: [agentA, agentB, agentC],
      schedules: [
        calendarSchedule(
          "44444444-4444-4444-8444-444444444444",
          agentA,
          "Review calendar layout",
        ),
        calendarSchedule(
          "55555555-5555-4555-8555-555555555555",
          agentB,
          "Audit release notes",
        ),
      ],
      runs: [
        calendarRun(
          "77777777-7777-4777-8777-777777777777",
          "44444444-4444-4444-8444-444444444444",
          { ...agentA, name: "Stale Agent A" },
          "Review calendar layout",
        ),
        calendarRun(
          "88888888-8888-4888-8888-888888888888",
          "55555555-5555-4555-8555-555555555555",
          agentB,
          "Audit release notes",
          "2026-07-27T01:00:00.000Z",
          "2026-07-27T02:00:00.000Z",
          "failed",
        ),
        calendarRun(
          "99999999-9999-4999-8999-999999999999",
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          agentC,
          "Older activity",
          "2026-07-20T01:00:00.000Z",
          "2026-07-20T02:00:00.000Z",
        ),
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectSchedule
            isSidebarOpen
            now={new Date("2026-07-27T03:00:00.000Z")}
            project={project}
            token="token"
          />
        </I18nProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Review calendar layout");
    expect(container.textContent).toContain("Audit release notes");
    expect(container.textContent).not.toContain("Stale Agent A");
    expect(
      container.querySelector(".project-schedule-event.completed"),
    ).not.toBeNull();
    expect(
      container.querySelector(".project-schedule-event.failed"),
    ).not.toBeNull();
    expect(
      container
        .querySelector<HTMLElement>(".project-schedule-event.completed")
        ?.style.getPropertyValue("--agent-color"),
    ).toBe(agentA.calendarColor);
    const trigger = container.querySelector<HTMLButtonElement>(
      "#project-schedule-agent-filter",
    );
    expect(trigger?.getAttribute("aria-label")).toBe("Agent filter");
    expect(trigger?.textContent).toContain("All agents");

    await act(async () => trigger?.click());
    const agentAOption = document.querySelector<HTMLButtonElement>(
      `[data-value="agent:${agentA.id}"]`,
    );
    await act(async () => agentAOption?.click());

    expect(container.textContent).toContain("Review calendar layout");
    expect(container.textContent).not.toContain("Audit release notes");
    expect(trigger?.textContent).toContain("Agent A");

    await act(async () => trigger?.click());
    const agentCOption = document.querySelector<HTMLButtonElement>(
      `[data-value="agent:${agentC.id}"]`,
    );
    await act(async () => agentCOption?.click());

    expect(container.textContent).toContain("No scheduled work for Agent C.");
    expect(container.textContent).toContain("0m");

    await act(async () => root.unmount());
    container.remove();
  });

  it("filters saved schedules by their assigned agent id", async () => {
    const schedules: ProjectAgentSchedule[] = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        projectId,
        agentId: agentA.id,
        agentName: agentA.name,
        agentProvider: agentA.provider,
        name: "Agent A audit",
        recurrence: "weekdays",
        timeOfDay: "09:00",
        dayOfWeek: null,
        timeZone: "Asia/Seoul",
        enabled: true,
        createdAt: agentA.createdAt,
        updatedAt: agentA.updatedAt,
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        projectId,
        agentId: agentB.id,
        agentName: agentB.name,
        agentProvider: agentB.provider,
        name: "Agent B report",
        recurrence: "daily",
        timeOfDay: "10:00",
        dayOfWeek: null,
        timeZone: "Asia/Seoul",
        enabled: true,
        createdAt: agentB.createdAt,
        updatedAt: agentB.updatedAt,
      },
    ];
    stubScheduleApi({ agents: [agentA, agentB], schedules });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectSchedule
            isSidebarOpen
            now={new Date("2026-07-27T03:00:00.000Z")}
            project={project}
            token="token"
          />
        </I18nProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Agent A audit");
    expect(container.textContent).toContain("Agent B report");
    expect(container.querySelector(".project-schedule-plans")).toBeNull();
    expect(
      container.querySelector(".project-schedule-event.missed"),
    ).not.toBeNull();
    expect(
      container.querySelector(".project-schedule-event.scheduled"),
    ).not.toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>(
      "#project-schedule-agent-filter",
    );
    await act(async () => trigger?.click());
    const agentAOption = document.querySelector<HTMLButtonElement>(
      `[data-value="agent:${agentA.id}"]`,
    );
    await act(async () => agentAOption?.click());

    expect(container.textContent).toContain("Agent A audit");
    expect(container.textContent).not.toContain("Agent B report");

    await act(async () => root.unmount());
    container.remove();
  });
});
