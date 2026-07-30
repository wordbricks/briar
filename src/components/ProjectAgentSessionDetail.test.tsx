/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { useAutoHuntAppServerEvents } from "../hooks/useAutoHuntAppServerEvents";
import { ProjectAgentSessionDetail } from "./ProjectAgentSessionDetail";

vi.mock("../hooks/useAutoHuntAppServerEvents", () => ({
  useAutoHuntAppServerEvents: vi.fn(() => ({
    events: [],
    isLoading: false,
    error: null,
  })),
}));

const mockedAppServerEvents = vi.mocked(useAutoHuntAppServerEvents);

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

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await act(async () => item.root.unmount());
    item.container.remove();
  }
  mockedAppServerEvents.mockReturnValue({
    events: [],
    isLoading: false,
    error: null,
  });
});

async function mount(session: AutoHuntSession) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      <ProjectAgentSessionDetail
        isSidebarOpen={true}
        onBack={vi.fn()}
        onStop={vi.fn().mockResolvedValue(true)}
        session={session}
      />,
    );
  });
  return container;
}

const session: AutoHuntSession = {
  id: "session-1",
  dispatchGroupId: "session-1",
  projectId: "project-1",
  agentId: "agent-1",
  sessionType: "dispatch",
  request: "대기 이슈를 처리해 줘",
  status: "running",
  issues: [],
  startedAt: "2026-07-29T11:00:00.000Z",
  completedAt: null,
  conversationId: null,
  workspaceRoot: null,
  summary: null,
  error: null,
  events: [],
  dispatchEvents: [{
    dispatchGroupId: "session-1",
    cursor: 1,
    type: "worker_progress",
    workerSessionId: "session-1-w1",
    runId: "run-1",
    status: "running",
    message:
      '[commentary] {"issues":[],"summary":"원인을 확인하고 화면을 수정하고 있습니다."}',
    occurredAt: "2026-07-29T11:01:00.000Z",
  }],
  workers: [],
};

describe("ProjectAgentSessionDetail", () => {
  it("shows readable worker progress in a scroll region without an execution log", async () => {
    const container = await mount(session);
    const progress = container.querySelector(".auto-hunt-worker-progress");

    expect(progress).not.toBeNull();
    expect(progress?.getAttribute("role")).toBe("region");
    expect(progress?.getAttribute("tabindex")).toBe("0");
    expect(progress?.textContent).toContain(
      "원인을 확인하고 화면을 수정하고 있습니다.",
    );
    expect(progress?.textContent).not.toContain("[commentary]");
    expect(container.querySelector(".auto-hunt-app-server-section")).toBeNull();
    expect(container.textContent).not.toContain("수행 로그");
  });

  it("shows live execution messages for a task session", async () => {
    mockedAppServerEvents.mockReturnValue({
      events: [{
        sessionId: "task-session-1",
        sequence: 1,
        occurredAtMs: Date.parse("2026-07-29T11:01:00.000Z"),
        direction: "server",
        message: {},
        event: {
          type: "messageCompleted",
          id: "message-1",
          phase: "commentary",
          text:
            '[commentary] {"action":"call_host_tool","message":"블록된 이슈의 상태를 확인하고 있습니다.","structuredResult":null,"toolCall":{"name":"list_briar_runs","arguments":{"statuses":["blocked","failed"]}}}',
        },
      }],
      isLoading: false,
      error: null,
    });

    const container = await mount({
      ...session,
      id: "task-session-1",
      dispatchGroupId: "",
      sessionType: "task",
      dispatchEvents: [],
    });

    expect(mockedAppServerEvents).toHaveBeenCalledWith("task-session-1");
    expect(container.textContent).toContain("수행 로그");
    expect(container.textContent).toContain(
      "블록된 이슈의 상태를 확인하고 있습니다.",
    );
    expect(container.textContent).not.toContain("[commentary]");
    expect(container.textContent).not.toContain("call_host_tool");
    expect(
      container.querySelector(".auto-hunt-agent-messages")
        ?.getAttribute("role"),
    ).toBe("log");
  });
});
