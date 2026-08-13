/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { demoDashboard, demoRepositoryReadiness } from "../lib/demo-data";
import type { ProjectUsageSummary } from "../types";
import { ProjectLobby, projectTrackedDuration } from "./ProjectLobby";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const emptyUsageSummary: ProjectUsageSummary = {
  period: "day",
  rangeStart: "2026-07-30T00:00:00.000Z",
  rangeEnd: "2026-08-13T00:00:00.000Z",
  generatedAt: "2026-08-12T00:00:00.000Z",
  totalTokens: 0,
  trackedDurationMs: 0,
  observedRuns: 0,
  reportedRuns: 0,
  completedIssues: 0,
  timeline: Array.from({ length: 14 }, (_, index) => ({
    startAt: new Date(Date.UTC(2026, 6, 30 + index)).toISOString(),
    completedIssues: 0,
    totalTokens: 0,
  })),
  issueCreators: [],
  agents: [],
};

const scaledUsageSummary: ProjectUsageSummary = {
  period: "day",
  rangeStart: "2026-07-30T00:00:00.000Z",
  rangeEnd: "2026-08-13T00:00:00.000Z",
  generatedAt: "2026-08-12T00:00:00.000Z",
  totalTokens: 1_500_000,
  trackedDurationMs: 120_000,
  observedRuns: 4,
  reportedRuns: 4,
  completedIssues: 8,
  timeline: Array.from({ length: 14 }, (_, index) => ({
    startAt: new Date(Date.UTC(2026, 6, 30 + index)).toISOString(),
    completedIssues: index === 10 ? 8 : index === 5 ? 3 : 0,
    totalTokens: index === 10 ? 1_500_000 : index === 5 ? 250_000 : 0,
  })),
  issueCreators: [{ id: "user-1", name: "Ada", issues: 5 }],
  agents: [{ id: "agent-1", name: "Builder", issues: 8 }],
};

describe("ProjectLobby", () => {
  it("summarizes only execution time inside the daily analytics window", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const run = (updatedAt: string, durationMs: number) => ({
      id: updatedAt,
      status: "completed" as const,
      executionMetrics: {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningOutputTokens: null,
        totalTokens: null,
        durationMs,
      },
      claimedBy: "worker",
      claimedAt: updatedAt,
      claimAttempts: 1,
      workerId: "worker-1",
      preferredProvider: "codex" as const,
      preferredModel: null,
      requestedProvider: null,
      requestedModel: null,
      startedAt: updatedAt,
      updatedAt,
      completedAt: updatedAt,
    });

    expect(projectTrackedDuration([
      run("2026-08-10T12:00:00.000Z", 90_000),
      run("2026-06-01T12:00:00.000Z", 600_000),
    ], now)).toBe(90_000);
  });

  it("shows repository, project metrics, shortcuts, and recent work", async () => {
    const onOpenIssues = vi.fn();
    const onLoadUsageSummary = vi.fn().mockResolvedValue(emptyUsageSummary);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            dashboard={demoDashboard}
            isSidebarOpen
            onLoadUsageSummary={onLoadUsageSummary}
            onOpenAgents={() => undefined}
            onOpenIssue={() => undefined}
            onOpenIssues={onOpenIssues}
            onOpenRepository={() => undefined}
            onOpenSettings={() => undefined}
            project={demoDashboard.project}
            readiness={demoRepositoryReadiness}
          />
        </I18nProvider>,
      );
    });

    expect(onLoadUsageSummary).toHaveBeenCalledOnce();
    expect(onLoadUsageSummary).toHaveBeenCalledWith(
      demoDashboard.project.id,
      "day",
      { force: false },
    );
    expect(container.textContent).toContain("Project overview");
    expect(container.textContent).toContain("Work analytics");
    expect(container.textContent).toContain("Tokens used");
    expect(container.textContent).toContain("Agent work time");
    expect(container.textContent).toContain("GitHub connection");
    expect(container.textContent).toContain(
      demoDashboard.settings.githubRepository,
    );
    expect(container.textContent).toContain("Recent activity");
    expect(container.textContent).toContain(demoDashboard.runs[0].title);

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".project-lobby-period-picker button")]
        .find((button) => button.textContent === "Weekly")
        ?.click();
    });
    expect(onLoadUsageSummary).toHaveBeenLastCalledWith(
      demoDashboard.project.id,
      "week",
      { force: false },
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".activity-panel > header button")
        ?.click();
    });
    expect(onOpenIssues).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows compact vertical scale values for issues and tokens", async () => {
    const onLoadUsageSummary = vi.fn().mockResolvedValue(scaledUsageSummary);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            dashboard={demoDashboard}
            isSidebarOpen
            onLoadUsageSummary={onLoadUsageSummary}
            onOpenAgents={() => undefined}
            onOpenIssue={() => undefined}
            onOpenIssues={() => undefined}
            onOpenRepository={() => undefined}
            onOpenSettings={() => undefined}
            project={demoDashboard.project}
            readiness={demoRepositoryReadiness}
          />
        </I18nProvider>,
      );
    });

    const issueTicks = Array.from(
      container.querySelectorAll(".project-lobby-chart-y-axis.issues span"),
      (tick) => tick.textContent,
    );
    const tokenTicks = Array.from(
      container.querySelectorAll(".project-lobby-chart-y-axis.tokens span"),
      (tick) => tick.textContent,
    );

    // Issue count scale (max 8 → nice step 2): 0,2,4,6,8
    expect(issueTicks).toEqual(["0", "2", "4", "6", "8"]);
    // Token scale (max 1.5M → nice 2M) with compact labels
    expect(tokenTicks[0]).toBe("0");
    expect(tokenTicks.at(-1)).toMatch(/2(\.0)?\s?M/i);
    expect(tokenTicks.some((tick) => /1(\.0)?\s?M/i.test(tick ?? ""))).toBe(
      true,
    );
    expect(
      container.querySelectorAll(".project-lobby-chart-y-axis.issues span")
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      container.querySelectorAll(".project-lobby-chart-y-axis.tokens span")
        .length,
    ).toBeGreaterThanOrEqual(2);

    await act(async () => root.unmount());
    container.remove();
  });
});
