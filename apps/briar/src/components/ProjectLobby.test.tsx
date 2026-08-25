/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { demoDashboard, demoRepositoryReadiness } from "../lib/demo-data";
import type { ProjectUsageSummary } from "../types";
import { ProjectLobby, projectTrackedDuration } from "./ProjectLobby";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

describe("ProjectLobby", () => {
  it("shows an accessible difficulty icon for every recent issue", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            dashboard={demoDashboard}
            isSidebarOpen
            onLoadUsageSummary={async () => null}
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

    const icons = [...container.querySelectorAll<HTMLElement>(
      ".project-lobby-activity-list [data-difficulty]",
    )];
    expect(icons).toHaveLength(demoDashboard.runs.length);
    expect(icons.map((icon) => icon.dataset.difficulty).sort()).toEqual([
      "easy",
      "hard",
      "normal",
      "normal",
    ]);
    expect(icons.every((icon) => icon.getAttribute("role") === "img"))
      .toBe(true);
    expect(icons.every((icon) => icon.getAttribute("aria-label")))
      .toBe(true);

    await act(async () => root.unmount());
  });

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

});
