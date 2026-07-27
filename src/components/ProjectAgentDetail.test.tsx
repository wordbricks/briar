/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardPayload, ProjectAgent } from "../types";

const { runProjectAgent } = vi.hoisted(() => ({
  runProjectAgent: vi.fn(),
}));

vi.mock("../lib/project-llm", () => ({ runProjectAgent }));

import { ProjectAgentDetail } from "./ProjectAgentDetail";

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
    randomUUID: vi.fn()
      .mockReturnValueOnce("message-user")
      .mockReturnValueOnce("message-agent"),
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
  kind: "custom",
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

describe("ProjectAgentDetail", () => {
  it("keeps ordinary work in the current agent conversation", async () => {
    runProjectAgent.mockResolvedValue({
      conversationId: "briar:project-1:ordinary-1",
      workspaceRoot: "/repo",
      action: "respond",
      message: "릴리스 상태를 확인했습니다.",
      maxIssues: null,
    });
    const onStartAutoHunt = vi.fn(() => "dispatch-1");
    const container = await mount(
      <ProjectAgentDetail
        agent={agent}
        dashboard={dashboard}
        error={null}
        isSidebarOpen={true}
        onBack={() => undefined}
        onStartAutoHunt={onStartAutoHunt}
        requestedSessionId={null}
        sessions={[]}
      />,
    );

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "현재 릴리스 상태를 확인해 줘");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(onStartAutoHunt).not.toHaveBeenCalled();
    expect(container.textContent).toContain("릴리스 상태를 확인했습니다.");
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("hands an explicit Auto Hunt decision to the host with its conversation", async () => {
    runProjectAgent.mockResolvedValue({
      conversationId: "briar:project-1:coordinator-1",
      workspaceRoot: "/repo",
      action: "dispatch_auto_hunt",
      message: "대기 이슈 세 건을 Auto Hunt로 요청했습니다.",
      maxIssues: 3,
    });
    const onStartAutoHunt = vi.fn(() => "dispatch-1");
    const container = await mount(
      <ProjectAgentDetail
        agent={agent}
        dashboard={dashboard}
        error={null}
        isSidebarOpen={true}
        onBack={() => undefined}
        onStartAutoHunt={onStartAutoHunt}
        requestedSessionId={null}
        sessions={[]}
      />,
    );

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "Auto Hunt로 대기 이슈 세 건을 처리해 줘");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(runProjectAgent).toHaveBeenCalledWith({
      projectId: "project-1",
      agent,
      message: "Auto Hunt로 대기 이슈 세 건을 처리해 줘",
      conversationId: null,
    });
    expect(onStartAutoHunt).toHaveBeenCalledWith([], {
      coordinatorConversationId: "briar:project-1:coordinator-1",
      maxIssues: 3,
    });
    expect(container.textContent).toContain("수행 세션");
    expect(container.textContent).toContain("대기 이슈 0개");
  });
});
