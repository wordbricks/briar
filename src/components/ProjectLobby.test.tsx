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
  generatedAt: "2026-08-12T00:00:00.000Z",
  totalTokens: 0,
  trackedDurationMs: 0,
  observedRuns: 0,
  reportedRuns: 0,
};

describe("ProjectLobby", () => {
  it("summarizes only execution time inside the 30-day window", () => {
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
      { force: false },
    );
    expect(container.textContent).toContain("Project overview");
    expect(container.textContent).toContain("Tokens used");
    expect(container.textContent).toContain("Agent work time");
    expect(container.textContent).toContain("GitHub connection");
    expect(container.textContent).toContain(
      demoDashboard.settings.githubRepository,
    );
    expect(container.textContent).toContain("Recent activity");
    expect(container.textContent).toContain(demoDashboard.runs[0].title);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".activity-panel > header button")
        ?.click();
    });
    expect(onOpenIssues).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
