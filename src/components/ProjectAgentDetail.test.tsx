/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { DashboardPayload, ProjectAgent } from "../types";

const { runProjectAgent } = vi.hoisted(() => ({
  runProjectAgent: vi.fn(),
}));

vi.mock("../lib/project-llm", () => ({ runProjectAgent }));

import {
  ProjectAgentDetail,
  type ProjectAgentTaskSessionSettlement,
  type ProjectAgentTaskSessionStart,
} from "./ProjectAgentDetail";

const mounted: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  runProjectAgent.mockReset();
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn().mockReturnValue("task-session"),
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
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

const agent: ProjectAgent = {
  id: "agent-1",
  projectId: "project-1",
  name: "릴리스 에이전트",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  responsibility: "릴리스 작업을 처리합니다.",
  skill: "# 릴리스 에이전트",
  calendarColor: "#3275d5",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const dashboard = {
  project: {
    id: "project-1",
    name: "Briar",
    createdAt: "2026-07-28T00:00:00.000Z",
  },
  runs: [],
} as unknown as DashboardPayload;

function ProjectAgentDetailHarness({
  onSettleTaskSession,
  onStartAutoHunt,
  onStartTaskSession,
}: {
  onSettleTaskSession: (
    sessionId: string,
    settlement: ProjectAgentTaskSessionSettlement,
  ) => void;
  onStartAutoHunt: (
    runs: DashboardPayload["runs"],
    options?: {
      coordinatorConversationId?: string | null;
      maxIssues?: number;
    },
  ) => string;
  onStartTaskSession: (session: ProjectAgentTaskSessionStart) => void;
}) {
  const [sessions, setSessions] = useState<AutoHuntSession[]>([]);

  return (
    <ProjectAgentDetail
      agent={agent}
      dashboard={dashboard}
      error={null}
      isSidebarOpen={true}
      onBack={() => undefined}
      onSettleTaskSession={(sessionId, settlement) => {
        onSettleTaskSession(sessionId, settlement);
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  ...settlement,
                  status: settlement.status,
                  completedAt: new Date().toISOString(),
                }
              : session
          ),
        );
      }}
      onStartAutoHunt={onStartAutoHunt}
      onStartTaskSession={(session) => {
        onStartTaskSession(session);
        setSessions((current) => [
          {
            id: session.sessionId,
            dispatchGroupId: "",
            projectId: agent.projectId,
            agentId: agent.id,
            sessionType: "task",
            trigger: "manual",
            request: session.request,
            status: "running",
            issues: [],
            startedAt: session.startedAt,
            completedAt: null,
            conversationId: null,
            workspaceRoot: null,
            summary: null,
            error: null,
            events: [],
            dispatchEvents: [],
            workers: [],
          },
          ...current,
        ]);
      }}
      requestedSessionId={null}
      sessions={sessions}
    />
  );
}

describe("ProjectAgentDetail", () => {
  it("opens the task session detail as soon as the session is created", async () => {
    const response = {
      conversationId: "briar:project-1:ordinary-1",
      workspaceRoot: "/repo",
      action: "respond" as const,
      message: "릴리스 상태를 확인했습니다.",
      maxIssues: null,
    };
    let resolveRun: ((value: typeof response) => void) | undefined;
    runProjectAgent.mockImplementation(
      () => new Promise((resolve) => {
        resolveRun = resolve;
      }),
    );
    const onStartAutoHunt = vi.fn(() => "dispatch-1");
    const onStartTaskSession = vi.fn();
    const onSettleTaskSession = vi.fn();
    const container = await mount(
      <ProjectAgentDetailHarness
        onSettleTaskSession={onSettleTaskSession}
        onStartAutoHunt={onStartAutoHunt}
        onStartTaskSession={onStartTaskSession}
      />,
    );

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "작업 실행")
        ?.click();
    });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toBe(agent.responsibility);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "현재 릴리스 상태를 확인해 줘");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      document.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(onStartAutoHunt).not.toHaveBeenCalled();
    expect(onStartTaskSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "task-session",
        request: "현재 릴리스 상태를 확인해 줘",
      }),
    );
    expect(onSettleTaskSession).not.toHaveBeenCalled();
    expect(container.querySelector("#project-agent-session")).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".project-agent-run-message")).toBeNull();
    expect(container.textContent).toContain("진행 중");

    await act(async () => {
      resolveRun?.(response);
      await Promise.resolve();
    });

    expect(onSettleTaskSession).toHaveBeenCalledWith(
      "task-session",
      expect.objectContaining({
        status: "completed",
        conversationId: "briar:project-1:ordinary-1",
        summary: "릴리스 상태를 확인했습니다.",
      }),
    );
    expect(document.body.textContent).toContain("릴리스 상태를 확인했습니다.");
  });

  it("records the coordinator session when handing Auto Hunt to the host", async () => {
    runProjectAgent.mockResolvedValue({
      conversationId: "briar:project-1:coordinator-1",
      workspaceRoot: "/repo",
      action: "dispatch_auto_hunt",
      message: "대기 이슈 세 건을 Auto Hunt로 요청했습니다.",
      maxIssues: 3,
    });
    const onStartAutoHunt = vi.fn(() => "dispatch-1");
    const onStartTaskSession = vi.fn();
    const onSettleTaskSession = vi.fn();
    const container = await mount(
      <ProjectAgentDetailHarness
        onSettleTaskSession={onSettleTaskSession}
        onStartAutoHunt={onStartAutoHunt}
        onStartTaskSession={onStartTaskSession}
      />,
    );

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "작업 실행")
        ?.click();
    });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "Auto Hunt로 대기 이슈 세 건을 처리해 줘");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      document.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(runProjectAgent).toHaveBeenCalledWith({
      projectId: "project-1",
      sessionId: "task-session",
      agent,
      message: "Auto Hunt로 대기 이슈 세 건을 처리해 줘",
      conversationId: null,
    });
    expect(onStartAutoHunt).toHaveBeenCalledWith([], {
      coordinatorConversationId: "briar:project-1:coordinator-1",
      maxIssues: 3,
    });
    expect(onStartTaskSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "task-session",
        request: "Auto Hunt로 대기 이슈 세 건을 처리해 줘",
      }),
    );
    expect(onSettleTaskSession).toHaveBeenCalledWith(
      "task-session",
      expect.objectContaining({
        status: "completed",
        conversationId: "briar:project-1:coordinator-1",
        summary: "대기 이슈 세 건을 Auto Hunt로 요청했습니다.",
      }),
    );
    expect(container.querySelector("#project-agent-session")).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".project-agent-run-message")).toBeNull();
    expect(document.body.textContent).toContain(
      "대기 이슈 세 건을 Auto Hunt로 요청했습니다.",
    );
  });
});
