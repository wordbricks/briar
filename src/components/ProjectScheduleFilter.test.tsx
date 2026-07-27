/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import type { HuntRun } from "../types";
import { ProjectSchedule } from "./ProjectSchedule";

const baseRun = demoDashboard.runs[0];

function calendarRun(id: string, agent: string, title: string): HuntRun {
  return {
    ...baseRun,
    id,
    runNumber: Number(id.replace(/\D/gu, "")) || 1,
    title,
    status: "completed",
    workflowStage: null,
    claimedBy: agent,
    claimedAt: "2026-07-27T01:00:00",
    startedAt: "2026-07-27T01:00:00",
    updatedAt: "2026-07-27T02:00:00",
    completedAt: "2026-07-27T02:00:00",
  };
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
  it("filters calendar activity and summary metrics by agent", async () => {
    const dashboard = {
      ...demoDashboard,
      runs: [
        calendarRun("run-1", "Agent A", "Review calendar layout"),
        calendarRun("run-2", "Agent B", "Audit release notes"),
        {
          ...calendarRun("run-3", "Agent C", "Older activity"),
          claimedAt: "2026-07-20T01:00:00",
          startedAt: "2026-07-20T01:00:00",
          updatedAt: "2026-07-20T02:00:00",
          completedAt: "2026-07-20T02:00:00",
        },
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectSchedule
            dashboard={dashboard}
            isSidebarOpen
            now={new Date("2026-07-27T03:00:00")}
            onRunOpen={() => undefined}
            project={dashboard.project}
            token={null}
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("Review calendar layout");
    expect(container.textContent).toContain("Audit release notes");
    const trigger = container.querySelector<HTMLButtonElement>(
      "#project-schedule-agent-filter",
    );
    expect(trigger?.getAttribute("aria-label")).toBe("Agent filter");
    expect(trigger?.textContent).toContain("All agents");

    await act(async () => trigger?.click());
    const agentA = document.querySelector<HTMLButtonElement>(
      '[data-value="agent:Agent A"]',
    );
    await act(async () => agentA?.click());

    expect(container.textContent).toContain("Review calendar layout");
    expect(container.textContent).not.toContain("Audit release notes");
    expect(trigger?.textContent).toContain("Agent A");

    await act(async () => trigger?.click());
    const agentC = document.querySelector<HTMLButtonElement>(
      '[data-value="agent:Agent C"]',
    );
    await act(async () => agentC?.click());

    expect(container.textContent).toContain("No work was recorded for Agent C.");
    expect(container.textContent).toContain("0m");

    await act(async () => root.unmount());
    container.remove();
  });

  it("filters saved schedules by their assigned agent", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const agentA = {
      id: "11111111-1111-4111-8111-111111111111",
      projectId,
      name: "Agent A",
      kind: "custom",
      provider: "codex",
      model: null,
      responsibility: "Review changes.",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    };
    const agentB = {
      ...agentA,
      id: "33333333-3333-4333-8333-333333333333",
      name: "Agent B",
      provider: "claude",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.includes("/agent-schedules")
              ? {
                  schedules: [
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
                  ],
                }
              : { agents: [agentA, agentB] },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const dashboard = {
      ...demoDashboard,
      project: { ...demoDashboard.project, id: projectId },
      runs: [],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectSchedule
            dashboard={dashboard}
            isSidebarOpen
            now={new Date("2026-07-27T03:00:00")}
            onRunOpen={() => undefined}
            project={dashboard.project}
            token="token"
          />
        </I18nProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Agent A audit");
    expect(container.textContent).toContain("Agent B report");
    const trigger = container.querySelector<HTMLButtonElement>(
      "#project-schedule-agent-filter",
    );
    await act(async () => trigger?.click());
    const agentAOption = document.querySelector<HTMLButtonElement>(
      '[data-value="agent:Agent A"]',
    );
    await act(async () => agentAOption?.click());

    expect(container.textContent).toContain("Agent A audit");
    expect(container.textContent).not.toContain("Agent B report");

    await act(async () => root.unmount());
    container.remove();
  });
});
