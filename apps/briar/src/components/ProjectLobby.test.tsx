/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
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
  it("renders a compact companion overview with back and recent-work actions", async () => {
    localStorage.setItem("briar.locale.v1", "en");
    const { cleanup, container, root } = createReactTestRoot();
    const onBack = vi.fn();
    const onOpenIssue = vi.fn();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ProjectLobby
          companionMode
          connectionState="connected"
          dashboard={demoDashboard}
          isSidebarOpen={false}
          onBack={onBack}
          onLoadUsageSummary={async () => emptyUsageSummary}
          onOpenAgents={() => undefined}
          onOpenIssue={onOpenIssue}
          onOpenIssues={() => undefined}
          onOpenRepository={() => undefined}
          onOpenSettings={() => undefined}
          project={demoDashboard.project}
          readiness={demoRepositoryReadiness}
          requiresLocalReadiness
        />
      </I18nProvider>,
    );

    expect(container.querySelector(".companion-mode")).not.toBeNull();
    expect(container.textContent).toContain("Project overview");
    expect(container.textContent).toContain("Recent activity");
    expect(container.querySelector(".project-lobby-date-range")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')?.click();
    });
    expect(onBack).toHaveBeenCalledOnce();

    const issueButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes(demoDashboard.runs[0]!.title),
    );
    await act(async () => issueButton?.click());
    expect(onOpenIssue).toHaveBeenCalledWith(demoDashboard.runs[0]!.id);
    await cleanup();
  });

  it("loads the latest 14 days by default and applies a custom date range", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const expectedDefault = defaultProjectUsageDateRange();
    const loadUsage = vi.fn(async () => emptyUsageSummary);

    await renderReactTestRoot(
      root,
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

    await cleanup();
  });

  it("shows an accessible difficulty icon for every recent issue", async () => {
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
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

    await cleanup();
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
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
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

    const repositoryPanel = container.querySelector(".repository-panel");
    expect(repositoryPanel?.textContent).toContain(expectedStatus);
    expect(repositoryPanel?.textContent).toContain(expectedAction);

    await cleanup();
  });

  it("directs repository setup to the desktop instead of a remote dead end", async () => {
    localStorage.setItem("briar.locale.v1", "ko");
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
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

    const repositoryButton = container.querySelector<HTMLButtonElement>(
      ".repository-panel button",
    );
    expect(repositoryButton?.disabled).toBe(true);
    expect(repositoryButton?.textContent).toContain("데스크톱 Briar에서 연결");

    await cleanup();
  });

  it("does not call a non-GitHub repository a connected GitHub integration", async () => {
    localStorage.setItem("briar.locale.v1", "ko");
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
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

    const repositoryPanel = container.querySelector(".repository-panel");
    expect(repositoryPanel?.textContent).toContain("연결된 GitHub 저장소 없음");
    expect(repositoryPanel?.textContent).toContain("선택");
    expect(repositoryPanel?.textContent).toContain("현재 워크플로우에는 필요하지 않습니다");
    expect(repositoryPanel?.textContent).not.toContain("GitHub 준비 완료");
    expect(repositoryPanel?.textContent).not.toContain("저장소 연결");

    await cleanup();
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
