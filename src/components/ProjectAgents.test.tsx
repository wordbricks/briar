/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { runProjectAgent } from "../lib/project-llm";
import type { DashboardPayload } from "../types";
import {
  CreateProjectAgentDialog,
  ProjectAgents,
} from "./ProjectAgents";

vi.mock("../lib/project-llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/project-llm")>();
  return {
    ...actual,
    runProjectAgent: vi.fn(),
  };
});

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
  onIssueOpen: () => undefined,
  onSettleTaskSession: () => undefined,
  onStopSession: async () => true,
  onStart: () => "session-new",
  onStartTaskSession: () => undefined,
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

    expect(container.textContent).toContain("이슈 처리 에이전트");
    expect(container.textContent).toContain("Sentry 오류 탐지 에이전트");
    expect(container.textContent).toContain("Feedback 분석 에이전트");
    expect(container.textContent).toContain(
      "대기 중인 모든 이슈를 처리합니다.",
    );
    const createCard = container.querySelector<HTMLButtonElement>(
      ".project-agent-create-card",
    );
    expect(createCard?.textContent).toContain("에이전트 만들기");
    expect(createCard?.textContent).toContain("책임과 프로바이더, 모델");

    const providerIcons = [
      { provider: "codex", label: "Codex", element: "svg" },
      { provider: "claude", label: "Claude", element: "svg" },
      { provider: "grok", label: "Grok", element: "img" },
    ];
    for (const { provider, label, element } of providerIcons) {
      const icon = container.querySelector(
        `.project-agent-provider-icon.${provider}`,
      );
      expect(icon?.getAttribute("aria-label")).toBe(label);
      expect(icon?.getAttribute("role")).toBe("img");
      expect(icon?.textContent).toBe("");
      expect(icon?.querySelector(element)).not.toBeNull();
    }
  });

  it("shows only the agent with an active session as running", async () => {
    const runningSession: AutoHuntSession = {
      id: "running-session",
      dispatchGroupId: "running-session",
      workers: [],
      dispatchEvents: [],
      projectId: project.id,
      agentId: "demo-agent-auto-hunt",
      status: "running",
      issues: [],
      startedAt: "2026-07-28T00:00:00.000Z",
      completedAt: null,
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [],
    };
    const container = await mount(
      <ProjectAgents {...projectAgentsProps} sessions={[runningSession]} />,
    );
    await act(async () => Promise.resolve());

    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="이슈 처리 에이전트 세부 정보 열기"]',
      )?.textContent,
    ).toContain("실행 중");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Sentry 오류 탐지 에이전트 세부 정보 열기"]',
      )?.textContent,
    ).toContain("준비됨");
  });

  it("runs an agent's saved responsibility immediately from the play button", async () => {
    let finishRun:
      | ((value: Awaited<ReturnType<typeof runProjectAgent>>) => void)
      | undefined;
    vi.mocked(runProjectAgent).mockReturnValue(
      new Promise((resolve) => {
        finishRun = resolve;
      }),
    );
    const onStartTaskSession = vi.fn();
    const onSettleTaskSession = vi.fn();
    const onStart = vi.fn(() => "dispatch-session");
    const container = await mount(
      <ProjectAgents
        {...projectAgentsProps}
        onSettleTaskSession={onSettleTaskSession}
        onStart={onStart}
        onStartTaskSession={onStartTaskSession}
      />,
    );
    await act(async () => Promise.resolve());

    const runButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="이슈 처리 에이전트 책임 실행"]',
    );
    expect(runButton).not.toBeNull();

    await act(async () => {
      runButton?.click();
      await Promise.resolve();
    });

    const [startedAgent, startedSession] =
      onStartTaskSession.mock.calls[0] ?? [];
    expect(startedAgent.id).toBe("demo-agent-auto-hunt");
    expect(startedSession).toMatchObject({
      sessionId: expect.any(String),
      request: "대기 중인 모든 이슈를 처리합니다.",
      startedAt: expect.any(String),
    });
    expect(runProjectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({ id: "demo-agent-auto-hunt" }),
        message: "대기 중인 모든 이슈를 처리합니다.",
        sessionId: startedSession.sessionId,
      }),
    );
    expect(runButton?.disabled).toBe(true);

    await act(async () => {
      finishRun?.({
        conversationId: "agent-conversation",
        action: "respond",
        message: "책임 수행 완료",
        maxIssues: null,
        workspaceRoot: "/repo",
        structuredResult: null,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onStart).not.toHaveBeenCalled();
    expect(onSettleTaskSession).toHaveBeenCalledWith(
      startedSession.sessionId,
      {
        status: "completed",
        conversationId: "agent-conversation",
        workspaceRoot: "/repo",
        summary: "책임 수행 완료",
        error: null,
      },
    );
  });

  it("dispatches an agent to remote Workers directly in companion mode", async () => {
    vi.mocked(runProjectAgent).mockClear();
    const onStart = vi.fn(async () => "remote-dispatch");
    const onStartTaskSession = vi.fn();
    const container = await mount(
      <ProjectAgents
        {...projectAgentsProps}
        companionMode
        onStart={onStart}
        onStartTaskSession={onStartTaskSession}
      />,
    );
    await act(async () => Promise.resolve());

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="이슈 처리 에이전트 책임 실행"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "demo-agent-auto-hunt" }),
      dashboard.runs,
    );
    expect(runProjectAgent).not.toHaveBeenCalled();
    expect(onStartTaskSession).not.toHaveBeenCalled();
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
        )?.set?.call(name, "Jay 이슈 처리 에이전트");
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
      name: "Jay 이슈 처리 에이전트",
      provider: "codex",
      model: null,
      effort: null,
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
      'button[aria-label="이슈 처리 에이전트 설정"]',
    );
    expect(settingsButton).not.toBeNull();
    expect(settingsButton?.textContent).toBe("");
    await act(async () => settingsButton?.click());

    const settingsPage = container.querySelector("#project-agent-settings");
    const form = settingsPage?.querySelector<HTMLFormElement>(
      "form.project-agent-settings-card",
    );
    const name = form?.querySelector<HTMLInputElement>(
      'input:not([type="file"]):not([type="color"])',
    );
    const responsibility = form?.querySelector<HTMLTextAreaElement>("textarea");
    expect(settingsPage?.textContent).toContain("에이전트 설정");
    expect(settingsPage?.textContent).not.toContain("프로젝트 실행 기본값");
    expect(name?.value).toBe("이슈 처리 에이전트");
    expect(responsibility?.value).toBe(
      "대기 중인 모든 이슈를 처리합니다.",
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

  it("deletes an agent from settings after confirmation", async () => {
    const container = await mount(<ProjectAgents {...projectAgentsProps} />);
    await act(async () => Promise.resolve());
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="이슈 처리 에이전트 설정"]',
        )
        ?.click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "에이전트 삭제")
        ?.click();
    });
    expect(document.body.textContent).toContain(
      "‘이슈 처리 에이전트’ 에이전트를 삭제할까요?",
    );

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(".project-agent-delete-confirm")
        ?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("#project-agents")).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="이슈 처리 에이전트 설정"]',
      ),
    ).toBeNull();
  });

  it("shows the selected agent sessions and opens task input in a dialog", async () => {
    const onIssueOpen = vi.fn();
    const sessions: AutoHuntSession[] = [
      {
        id: "legacy-auto-session",
        dispatchGroupId: "legacy-auto-session",
        workers: [],
        dispatchEvents: [],
        projectId: project.id,
        agentId: "demo-agent-auto-hunt",
        status: "completed",
        issues: [{
          runId: "run-auto",
          runNumber: 1,
          sourceKey: "AUTO-1",
          title: "이슈 처리 작업",
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
        dispatchGroupId: "sentry-session",
        workers: [],
        dispatchEvents: [],
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
      <ProjectAgents
        {...projectAgentsProps}
        onIssueOpen={onIssueOpen}
        sessions={sessions}
      />,
    );
    await act(async () => Promise.resolve());

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="이슈 처리 에이전트 세부 정보 열기"]',
        )
        ?.click();
    });

    expect(container.querySelector("#project-agent-detail")).not.toBeNull();
    expect(container.textContent).toContain("이슈 처리 작업");
    expect(container.textContent).not.toContain("Sentry 오류 조사");
    expect(container.textContent).not.toContain("에이전트에게 작업 요청");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-row")
        ?.click();
    });

    expect(container.querySelector("#project-agent-session")).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("수행 로그");
    expect(container.textContent).toContain("단계 진행");
    expect(container.textContent).toContain("세션 정보");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="이슈 처리 작업 상세"]',
        )
        ?.click();
    });
    expect(onIssueOpen).toHaveBeenCalledWith("run-auto");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-back")
        ?.click();
    });

    expect(container.querySelector("#project-agent-detail")).not.toBeNull();

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "작업 실행")
        ?.click();
    });

    expect(document.body.textContent).toContain("에이전트에게 작업 요청");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "대기 중인 모든 이슈를 처리합니다.",
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".project-agent-detail-back")
        ?.click();
    });
    expect(container.querySelector("#project-agents")).not.toBeNull();
  });
});
