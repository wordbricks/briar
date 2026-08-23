/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { useAutoHuntAppServerEvents } from "../hooks/useAutoHuntAppServerEvents";
import { useProjectAgentWorkerEvents } from "../hooks/useProjectAgentWorkerEvents";
import { loadProjectAgentSession } from "../lib/api";
import {
  ProjectAgentSessionDetail,
  sessionWorkerLabel,
} from "./ProjectAgentSessionDetail";
import { ToastProvider } from "./ui/toast";

vi.mock("../hooks/useAutoHuntAppServerEvents", () => ({
  useAutoHuntAppServerEvents: vi.fn(() => ({
    events: [],
    isLoading: false,
    error: null,
  })),
}));
vi.mock("../hooks/useProjectAgentWorkerEvents", () => ({
  useProjectAgentWorkerEvents: vi.fn(() => ({
    events: [],
    isLoading: false,
    error: null,
  })),
}));
vi.mock("../lib/api", () => ({
  loadProjectAgentSession: vi.fn(),
}));

const mockedAppServerEvents = vi.mocked(useAutoHuntAppServerEvents);
const mockedWorkerEvents = vi.mocked(useProjectAgentWorkerEvents);
const mockedLoadProjectAgentSession = vi.mocked(loadProjectAgentSession);

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
  mockedWorkerEvents.mockReturnValue({
    events: [],
    isLoading: false,
    error: null,
  });
  mockedLoadProjectAgentSession.mockReset();
});

async function mount(
  session: AutoHuntSession,
  onIssueOpen: (runId: string) => void = vi.fn(),
  issueKeyPrefix?: string,
  onFollowUp?: (message: string) => Promise<void>,
  workers: Array<{ id: string; label: string }> = [],
  token: string | null = null,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      <ToastProvider>
        <ProjectAgentSessionDetail
          isSidebarOpen={true}
          issueKeyPrefix={issueKeyPrefix}
          onBack={vi.fn()}
          onIssueOpen={onIssueOpen}
          onFollowUp={onFollowUp}
          onStop={vi.fn().mockResolvedValue(true)}
          session={session}
          token={token}
          workers={workers}
        />
      </ToastProvider>,
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
  it("copies a link that identifies the exact session", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = await mount(session);
    const copyButton = container.querySelector<HTMLButtonElement>(
      ".auto-hunt-session-link-copy",
    );

    expect(copyButton?.getAttribute("aria-label")).toBe("세션 링크 복사");
    await act(async () => copyButton?.click());

    expect(writeText).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/open/sessions/project-1/session-1",
    );
    expect(document.body.querySelector('[data-testid="app-toast"]')?.textContent)
      .toContain("세션 링크가 복사되었습니다");
    expect(container.querySelector(".run-page-share-status")).toBeNull();
  });

  it("opens a target's linked issue", async () => {
    const onIssueOpen = vi.fn();
    const container = await mount({
      ...session,
      issues: [{
        runId: "run-42",
        runNumber: 42,
        sourceKey: "issue-42",
        title: "연결된 이슈",
        outcome: "pending",
        summary: "이슈 카드 요약",
      }],
    }, onIssueOpen, "BR");
    const card = container.querySelector<HTMLButtonElement>(
      'button[aria-label="연결된 이슈 상세"]',
    );

    expect(card?.textContent).toContain("BR-42");
    expect(card?.textContent).toContain("이슈 카드 요약");
    expect(card?.querySelector("svg")).not.toBeNull();

    await act(async () => card?.click());

    expect(onIssueOpen).toHaveBeenCalledOnce();
    expect(onIssueOpen).toHaveBeenCalledWith("run-42");
  });

  it("merges readable worker progress into the chronological execution log", async () => {
    const container = await mount(session);
    const progress = container.querySelector(".auto-hunt-agent-messages");
    const request = container.querySelector(".auto-hunt-session-request-card");

    expect(progress).not.toBeNull();
    expect(progress?.getAttribute("role")).toBe("log");
    expect(progress?.textContent).toContain(
      "원인을 확인하고 화면을 수정하고 있습니다.",
    );
    expect(progress?.textContent).not.toContain("[commentary]");
    expect(progress?.textContent).not.toContain("대기 이슈를 처리해 줘");
    expect(request?.textContent).toContain("에이전트 작업 요청");
    expect(request?.textContent).toContain("대기 이슈를 처리해 줘");
    expect(container.querySelector(".auto-hunt-message-avatar")).toBeNull();
    expect(
      container.querySelector(".auto-hunt-app-server-section"),
    ).not.toBeNull();
    expect(container.textContent).toContain("수행 로그");
    expect(container.textContent).toContain("단계 진행");
    expect(container.textContent).toContain("1/3 완료");
    expect(container.textContent).toContain("세션 정보");
    expect(container.textContent).toContain("session-1");
    expect(container.textContent).toContain("산출물");
  });


  it("exports the visible session request and execution log", async () => {
    const createObjectURL = vi.fn(() => "blob:session-log");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const container = await mount(session);
    const exportButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("로그 내보내기"));

    await act(async () => exportButton?.click());

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      "briar-session-session-1.txt",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:session-log");
    click.mockRestore();
  });


  it("separates requests from the shared work log and sends a follow-up", async () => {
    const onFollowUp = vi.fn().mockResolvedValue(undefined);
    const container = await mount({
      ...session,
      id: "task-session-1",
      dispatchGroupId: "",
      sessionType: "task",
      status: "completed",
      completedAt: "2026-07-29T11:02:00.000Z",
      conversationId: "briar:project-1:thread-1",
      localOwner: true,
      dispatchEvents: [],
      summary: "초기 작업을 완료했습니다.",
      followUps: [{
        id: "follow-up-1",
        message: "테스트 결과도 알려 줘",
        sentAt: "2026-07-29T11:01:30.000Z",
      }],
    }, vi.fn(), undefined, onFollowUp);

    const messages = container.querySelectorAll(".auto-hunt-agent-message");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.textContent).toContain("초기 작업을 완료했습니다.");
    expect(messages[0]?.textContent).not.toContain("대기 이슈를 처리해 줘");
    const requests = container.querySelectorAll(
      ".auto-hunt-session-request-card",
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]?.textContent).toContain("대기 이슈를 처리해 줘");
    expect(requests[1]?.textContent).toContain("테스트 결과도 알려 줘");

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="후속 메시지"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "변경 내용을 커밋해 줘");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>(
      'button[aria-label="후속 메시지 보내기"]',
    );
    await act(async () => send?.click());

    expect(onFollowUp).toHaveBeenCalledWith("변경 내용을 커밋해 줘");
  });




  it("loads authoritative completed detail after a lightweight remote update", async () => {
    const synchronizedSummary = {
      ...session,
      id: "completed-remote-task",
      dispatchGroupId: "completed-remote-task",
      sessionType: "task" as const,
      status: "completed" as const,
      completedAt: "2026-08-18T00:05:00.000Z",
      localOwner: false,
      dispatchEvents: [],
      summary: null,
      events: [],
      updatedAt: "2026-08-18T00:05:00.000Z",
      detailLoaded: false,
    };
    mockedLoadProjectAgentSession.mockResolvedValue({
      ...synchronizedSummary,
      summary: "완료된 원격 Agent 산출물입니다.",
      events: [{
        id: "completed-event",
        type: "completed",
        occurredAt: "2026-08-18T00:05:00.000Z",
      }],
      detailLoaded: true,
    });

    const container = await mount(
      synchronizedSummary,
      vi.fn(),
      undefined,
      undefined,
      [],
      "token",
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(mockedLoadProjectAgentSession).toHaveBeenCalledWith(
      "token",
      "project-1",
      "completed-remote-task",
    );
    expect(
      container.querySelector(".auto-hunt-session-output-card")?.textContent,
    ).toContain("완료된 원격 Agent 산출물입니다.");
  });

});
