/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { demoDashboard, demoRepositoryReadiness } from "../lib/demo-data";
import { defaultProjectUsageDateRange } from "../lib/project-usage-summary";
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
  it("loads the latest 14 days by default and applies a custom date range", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const expectedDefault = defaultProjectUsageDateRange();
    const loadUsage = vi.fn(async () => emptyUsageSummary);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            connectionState="connected"
            dashboard={demoDashboard}
            isSidebarOpen
            onLoadUsageSummary={loadUsage}
            onOpenAgents={() => undefined}
            onOpenIssue={() => undefined}
            onOpenIssues={() => undefined}
            onOpenRepository={() => undefined}
            onOpenSettings={() => undefined}
            project={demoDashboard.project}
            readiness={demoRepositoryReadiness}
            requiresLocalReadiness
          />
        </I18nProvider>,
      );
    });

    expect(loadUsage).toHaveBeenLastCalledWith(
      demoDashboard.project.id,
      "day",
      { force: false, range: expectedDefault },
    );
    const from = container.querySelector<HTMLInputElement>('input[name="from"]');
    const to = container.querySelector<HTMLInputElement>('input[name="to"]');
    const form = container.querySelector<HTMLFormElement>(
      ".project-lobby-date-range",
    );
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    expect(form).not.toBeNull();

    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setInputValue(from!, "2026-08-01");
      setInputValue(to!, "2026-08-05");
    });
    await act(async () => {
      form!.dispatchEvent(new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(loadUsage).toHaveBeenLastCalledWith(
      demoDashboard.project.id,
      "day",
      {
        force: false,
        range: { from: "2026-08-01", to: "2026-08-05" },
      },
    );

    await act(async () => root.unmount());
  });

  it("shows an accessible difficulty icon for every recent issue", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            connectionState="connected"
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
            requiresLocalReadiness
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

  it.each([
    {
      connectionState: "unknown" as const,
      expectedAction: "다시 확인",
      expectedStatus: "확인 필요",
      readiness: null,
    },
    {
      connectionState: "disconnected" as const,
      expectedAction: "저장소 연결",
      expectedStatus: "설정 필요",
      readiness: demoRepositoryReadiness,
    },
  ])("renders $connectionState repository state honestly", async ({
    connectionState,
    expectedAction,
    expectedStatus,
    readiness,
  }) => {
    localStorage.setItem("briar.locale.v1", "ko");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            connectionState={connectionState}
            dashboard={demoDashboard}
            isSidebarOpen
            onLoadUsageSummary={async () => emptyUsageSummary}
            onOpenAgents={() => undefined}
            onOpenIssue={() => undefined}
            onOpenIssues={() => undefined}
            onOpenRepository={() => undefined}
            onOpenSettings={() => undefined}
            project={demoDashboard.project}
            readiness={readiness}
            requiresLocalReadiness
          />
        </I18nProvider>,
      );
    });

    const repositoryPanel = container.querySelector(".repository-panel");
    expect(repositoryPanel?.textContent).toContain(expectedStatus);
    expect(repositoryPanel?.textContent).toContain(expectedAction);

    await act(async () => root.unmount());
  });

  it("directs repository setup to the desktop instead of a remote dead end", async () => {
    localStorage.setItem("briar.locale.v1", "ko");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            connectionState="unknown"
            dashboard={{
              ...demoDashboard,
              settings: {
                ...demoDashboard.settings,
                githubRepository: null,
              },
            }}
            isSidebarOpen
            onLoadUsageSummary={async () => emptyUsageSummary}
            onOpenAgents={() => undefined}
            onOpenIssue={() => undefined}
            onOpenIssues={() => undefined}
            onOpenRepository={() => undefined}
            onOpenSettings={() => undefined}
            project={demoDashboard.project}
            readiness={null}
            requiresLocalReadiness={false}
          />
        </I18nProvider>,
      );
    });

    const repositoryButton = container.querySelector<HTMLButtonElement>(
      ".repository-panel button",
    );
    expect(repositoryButton?.disabled).toBe(true);
    expect(repositoryButton?.textContent).toContain("데스크톱 Briar에서 연결");

    await act(async () => root.unmount());
  });

  it("does not call a non-GitHub repository a connected GitHub integration", async () => {
    localStorage.setItem("briar.locale.v1", "ko");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectLobby
            connectionState="connected"
            dashboard={{
              ...demoDashboard,
              settings: { ...demoDashboard.settings, githubRepository: null },
            }}
            isSidebarOpen
            onLoadUsageSummary={async () => emptyUsageSummary}
            onOpenAgents={() => undefined}
            onOpenIssue={() => undefined}
            onOpenIssues={() => undefined}
            onOpenRepository={() => undefined}
            onOpenSettings={() => undefined}
            project={demoDashboard.project}
            readiness={{
              ...demoRepositoryReadiness,
              ghAccount: null,
              ghAuthenticated: false,
              ghInstalled: false,
              ghVersion: null,
              githubRepository: null,
              githubWriteAccess: false,
              pushAccess: false,
              remote: null,
              remoteReachable: false,
              requiresGithub: false,
            }}
            requiresLocalReadiness
          />
        </I18nProvider>,
      );
    });

    const repositoryPanel = container.querySelector(".repository-panel");
    expect(repositoryPanel?.textContent).toContain("연결된 GitHub 저장소 없음");
    expect(repositoryPanel?.textContent).toContain("선택");
    expect(repositoryPanel?.textContent).toContain("현재 워크플로우에는 필요하지 않습니다");
    expect(repositoryPanel?.textContent).not.toContain("GitHub 준비 완료");
    expect(repositoryPanel?.textContent).not.toContain("저장소 연결");

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
