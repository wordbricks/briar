/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { DashboardPayload } from "../types";
import {
  CreateProjectAgentDialog,
  ProjectAgents,
} from "./ProjectAgents";

const mounted: Array<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await act(async () => item.root.unmount());
    item.container.remove();
  }
});

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => root.render(node));
  return container;
}

const project = {
  id: "project-1",
  name: "Briar",
  createdAt: "2026-07-26T00:00:00.000Z",
};

const dashboard = {
  project,
  runs: [],
} as unknown as DashboardPayload;

const projectAgentsProps = {
  dashboard,
  error: null,
  isSidebarOpen: true,
  onStart: () => "session-new",
  project,
  sessions: [] as AutoHuntSession[],
  token: null,
};

describe("ProjectAgents", () => {
  it("shows the example responsibility-based agent roster in demo mode", async () => {
    const container = await mount(
      <ProjectAgents
        {...projectAgentsProps}
      />,
    );
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("자동 사냥 에이전트");
    expect(container.textContent).toContain("Sentry 오류 탐지 에이전트");
    expect(container.textContent).toContain("Feedback 분석 에이전트");
    expect(container.textContent).toContain(
      "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
    );
  });

  it("submits provider, default model, and a concrete responsibility", async () => {
    const onCreate = vi.fn(async () => undefined);
    const container = await mount(
      <CreateProjectAgentDialog
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={onCreate}
      />,
    );

    const name = container.querySelector<HTMLInputElement>("input");
    const responsibility =
      container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      if (name) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(name, "Jay 자동 사냥 에이전트");
        name.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (responsibility) {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(
          responsibility,
          "Jay한테 assign된 todo 이슈를 3개씩 처리하는 에이전트",
        );
        responsibility.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(onCreate).toHaveBeenCalledWith({
      name: "Jay 자동 사냥 에이전트",
      provider: "codex",
      model: null,
      responsibility:
        "Jay한테 assign된 todo 이슈를 3개씩 처리하는 에이전트",
      calendarColor: "#3275d5",
    });
  });

  it("opens a prefilled settings page from the card icon and saves changes", async () => {
    const container = await mount(
      <ProjectAgents
        {...projectAgentsProps}
      />,
    );
    await act(async () => Promise.resolve());

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="자동 사냥 에이전트 설정"]',
    );
    expect(settingsButton).not.toBeNull();
    expect(settingsButton?.textContent).toBe("");
    await act(async () => settingsButton?.click());

    const settingsPage = container.querySelector("#project-agent-settings");
    const form = settingsPage?.querySelector<HTMLFormElement>(
      "form.project-agent-settings-card",
    );
    const name = form?.querySelector<HTMLInputElement>("input");
    const responsibility = form?.querySelector<HTMLTextAreaElement>("textarea");
    expect(settingsPage?.textContent).toContain("에이전트 설정");
    expect(settingsPage?.textContent).toContain("프로젝트 실행 기본값");
    expect(name?.value).toBe("자동 사냥 에이전트");
    expect(responsibility?.value).toBe(
      "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
    );

    await act(async () => {
      if (name) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(name, "릴리스 점검 에이전트");
        name.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (responsibility) {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(responsibility, "릴리스 상태를 점검하고 결과를 보고합니다.");
        responsibility.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("릴리스 점검 에이전트");
    expect(container.textContent).toContain(
      "릴리스 상태를 점검하고 결과를 보고합니다.",
    );
    expect(container.querySelector("#project-agent-settings")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".project-agent-settings-back")
        ?.click();
    });
    expect(container.querySelector("#project-agents")).not.toBeNull();
    expect(container.textContent).toContain("릴리스 점검 에이전트");
  });

  it("opens an agent detail page with only that agent's sessions", async () => {
    const sessions: AutoHuntSession[] = [
      {
        id: "legacy-auto-session",
        projectId: project.id,
        status: "completed",
        issues: [{
          runId: "run-auto",
          runNumber: 1,
          sourceKey: "AUTO-1",
          title: "자동 사냥 이슈",
          outcome: "completed",
          summary: null,
        }],
        startedAt: "2026-07-26T01:00:00.000Z",
        completedAt: "2026-07-26T01:10:00.000Z",
        conversationId: "thread-auto",
        workspaceRoot: "/repo",
        summary: null,
        error: null,
        events: [],
      },
      {
        id: "sentry-session",
        projectId: project.id,
        agentId: "demo-agent-sentry",
        status: "completed",
        issues: [{
          runId: "run-sentry",
          runNumber: 2,
          sourceKey: "SENTRY-1",
          title: "Sentry 오류 조사",
          outcome: "completed",
          summary: null,
        }],
        startedAt: "2026-07-26T02:00:00.000Z",
        completedAt: "2026-07-26T02:10:00.000Z",
        conversationId: "thread-sentry",
        workspaceRoot: "/repo",
        summary: null,
        error: null,
        events: [],
      },
    ];
    const container = await mount(
      <ProjectAgents {...projectAgentsProps} sessions={sessions} />,
    );
    await act(async () => Promise.resolve());

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="자동 사냥 에이전트 세부 정보 열기"]',
        )
        ?.click();
    });

    expect(container.querySelector("#project-agent-detail")).not.toBeNull();
    expect(container.textContent).toContain("자동 사냥 이슈");
    expect(container.textContent).not.toContain("Sentry 오류 조사");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".project-agent-detail-back")
        ?.click();
    });
    expect(container.querySelector("#project-agents")).not.toBeNull();
  });
});
