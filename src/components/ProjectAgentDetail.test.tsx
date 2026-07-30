/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { DashboardPayload, ProjectAgent } from "../types";

const { runProjectAgent } = vi.hoisted(() => ({
  runProjectAgent: vi.fn(),
}));

vi.mock("../lib/project-llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/project-llm")>()),
  runProjectAgent,
}));

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
  dashboardValue = dashboard,
  onSettleTaskSession,
  onStopSession = async () => true,
  onStartAutoHunt,
  onStartTaskSession,
}: {
  dashboardValue?: DashboardPayload;
  onSettleTaskSession: (
    sessionId: string,
    settlement: ProjectAgentTaskSessionSettlement,
  ) => void;
  onStopSession?: (sessionId: string) => Promise<boolean>;
  onStartAutoHunt: (
    runs: DashboardPayload["runs"],
    options?: {
      coordinatorConversationId?: string | null;
      parentSessionId?: string;
      maxIssues?: number;
      targetRunIds?: string[];
      retryReason?: string | null;
    },
  ) => string | Promise<string>;
  onStartTaskSession: (session: ProjectAgentTaskSessionStart) => void;
}) {
  const [sessions, setSessions] = useState<AutoHuntSession[]>([]);

  return (
    <ProjectAgentDetail
      agent={agent}
      dashboard={dashboardValue}
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
      onStopSession={onStopSession}
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
  it("uses the same compact header UI as the Agents list", async () => {
    const onBack = vi.fn();
    const container = await mount(
      <ProjectAgentDetail
        agent={agent}
        dashboard={dashboard}
        error={null}
        isSidebarOpen={true}
        onBack={onBack}
        onSettleTaskSession={() => undefined}
        onStopSession={async () => true}
        onStartAutoHunt={() => "dispatch-1"}
        onStartTaskSession={() => undefined}
        requestedSessionId={null}
        sessions={[]}
      />,
    );

    const header = container.querySelector(
      ".page-header.app-page-header.project-agents-heading.project-agent-detail-heading",
    );
    expect(header).not.toBeNull();
    expect(container.querySelector(".page-hero")).toBeNull();
    expect(
      header?.querySelector("#project-agent-detail-title")?.textContent,
    ).toContain(agent.name);
    expect(header?.textContent).toContain(agent.responsibility);
    expect(
      header?.querySelector(".project-agent-run-task")?.textContent,
    ).toContain("작업 실행");

    await act(async () => {
      header
        ?.querySelector<HTMLButtonElement>(".project-agent-detail-back")
        ?.click();
    });
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("opens the linked Auto Hunt dispatch instead of its coordinator task", async () => {
    const coordinatorSession: AutoHuntSession = {
      id: "task-session",
      dispatchGroupId: "",
      projectId: agent.projectId,
      agentId: agent.id,
      sessionType: "task",
      request: "Auto Hunt로 대기 이슈를 처리해 줘",
      status: "completed",
      issues: [],
      startedAt: "2026-07-28T01:00:00.000Z",
      completedAt: "2026-07-28T01:01:00.000Z",
      conversationId: "coordinator-conversation",
      workspaceRoot: "/repo",
      summary: "Auto Hunt를 요청했습니다.",
      error: null,
      events: [],
      dispatchEvents: [],
      workers: [],
    };
    const dispatchSession: AutoHuntSession = {
      ...coordinatorSession,
      id: "dispatch-session",
      dispatchGroupId: "dispatch-session",
      sessionType: "dispatch",
      parentSessionId: coordinatorSession.id,
      status: "running",
      completedAt: null,
      conversationId: null,
      summary: null,
      issues: [{
        runId: "run-1",
        runNumber: 1,
        sourceKey: "issue-1",
        title: "연결된 Auto Hunt 이슈",
        outcome: "pending",
        summary: null,
      }],
    };
    const container = await mount(
      <ProjectAgentDetail
        agent={agent}
        dashboard={dashboard}
        error={null}
        isSidebarOpen={true}
        onBack={() => undefined}
        onSettleTaskSession={() => undefined}
        onStopSession={async () => true}
        onStartAutoHunt={() => dispatchSession.id}
        onStartTaskSession={() => undefined}
        requestedSessionId={coordinatorSession.id}
        sessions={[dispatchSession, coordinatorSession]}
      />,
    );

    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("연결된 Auto Hunt 이슈");
    expect(container.textContent).not.toContain("Auto Hunt를 요청했습니다.");
  });

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
      runs: [],
    });
    expect(onStartAutoHunt).toHaveBeenCalledWith([], {
      coordinatorConversationId: "briar:project-1:coordinator-1",
      parentSessionId: "task-session",
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

  it("forwards an exact blocked-run retry selected by the host tool", async () => {
    const blockedRun = {
      id: "blocked-run",
      runNumber: 42,
      sourceKey: "BRIAR-42",
      title: "막힌 배포 재개",
      status: "blocked",
      currentAttempt: 1,
      detail: "GitHub 인증이 필요합니다.",
      resultSummary: null,
      updatedAt: "2026-07-30T09:00:00.000Z",
    } as DashboardPayload["runs"][number];
    const dashboardWithBlockedRun = {
      ...dashboard,
      runs: [blockedRun],
    };
    runProjectAgent.mockResolvedValue({
      conversationId: "briar:project-1:recovery-coordinator",
      workspaceRoot: "/repo",
      action: "dispatch_auto_hunt",
      message: "블로킹이 해소된 이슈를 다시 시작합니다.",
      maxIssues: 1,
      structuredResult: null,
      targetRunIds: [blockedRun.id],
      retryReason: "GitHub 인증이 복구되었습니다.",
    });
    const onStartAutoHunt = vi.fn(() => "dispatch-1");
    const container = await mount(
      <ProjectAgentDetailHarness
        dashboardValue={dashboardWithBlockedRun}
        onSettleTaskSession={() => undefined}
        onStartAutoHunt={onStartAutoHunt}
        onStartTaskSession={() => undefined}
      />,
    );

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "작업 실행")
        ?.click();
    });
    await act(async () => {
      document.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(onStartAutoHunt).toHaveBeenCalledWith([blockedRun], {
      coordinatorConversationId: "briar:project-1:recovery-coordinator",
      parentSessionId: "task-session",
      maxIssues: 1,
      targetRunIds: [blockedRun.id],
      retryReason: "GitHub 인증이 복구되었습니다.",
    });
  });

  it("stops a running session from its detail page", async () => {
    runProjectAgent.mockImplementation(
      () => new Promise(() => undefined),
    );
    const onStopSession = vi.fn(async () => true);
    const container = await mount(
      <ProjectAgentDetailHarness
        onSettleTaskSession={() => undefined}
        onStartAutoHunt={() => "dispatch-1"}
        onStartTaskSession={() => undefined}
        onStopSession={onStopSession}
      />,
    );

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "작업 실행")
        ?.click();
    });
    await act(async () => {
      document.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="세션 정지"]',
        )
        ?.click();
      await Promise.resolve();
    });

    expect(onStopSession).toHaveBeenCalledWith("task-session");
  });
});
