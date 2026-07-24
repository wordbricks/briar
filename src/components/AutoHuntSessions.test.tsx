/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { DashboardPayload, HuntRun } from "../types";
import { AutoHuntSessions } from "./AutoHuntSessions";

const queuedRun = (index: number) => ({
  id: `run-${index}`,
  runNumber: index,
  sourceKey: `BRIAR-${index}`,
  title: `대기 이슈 ${index}`,
  status: "queued",
} as HuntRun);

const dashboard = {
  project: { id: "project-1", name: "Briar", createdAt: "2026-07-22T00:00:00Z" },
  runs: [1, 2, 3, 4].map(queuedRun),
} as DashboardPayload;

describe("AutoHuntSessions", () => {
  it("starts a session with no more than three queued issues", async () => {
    const onStart = vi.fn((_runs: HuntRun[]) => "session-1");
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <AutoHuntSessions
        dashboard={dashboard}
        error={null}
        isSidebarOpen
        onStart={onStart}
        sessions={[]}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".auto-hunt-start-button")?.click();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    const selectedRuns = onStart.mock.calls[0]?.[0] ?? [];
    expect(selectedRuns).toHaveLength(3);
    expect(selectedRuns.map((run) => run.id)).toEqual([
      "run-1",
      "run-2",
      "run-3",
    ]);
    await act(async () => root.unmount());
  });

  it("opens session details as a page and returns to the session list", async () => {
    const session: AutoHuntSession = {
      id: "session-1",
      projectId: "project-1",
      status: "completed",
      issues: [{
        runId: "run-1",
        runNumber: 1,
        sourceKey: "BRIAR-1",
        title: "삭제 오류 수정",
        outcome: "completed",
        summary: "수정하고 검증했습니다.",
      }],
      startedAt: "2026-07-22T01:00:00Z",
      completedAt: "2026-07-22T01:10:00Z",
      conversationId: "thread-1",
      workspaceRoot: "/repo",
      summary: "이슈 1개를 처리했습니다.",
      error: null,
      events: [{ id: "event-1", type: "started", occurredAt: "2026-07-22T01:00:00Z" }],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <AutoHuntSessions
        dashboard={dashboard}
        error={null}
        isSidebarOpen
        onStart={() => "session-2"}
        sessions={[session]}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".auto-hunt-session-row")?.click();
    });

    const detailPage = container.querySelector(".auto-hunt-session-page");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(detailPage?.textContent).toContain("삭제 오류 수정");
    expect(detailPage?.textContent).toContain("수정하고 검증했습니다.");
    expect(detailPage?.textContent).toContain("세션을 시작했습니다.");
    expect(detailPage?.textContent).toContain("Agent 메시지");
    expect(detailPage?.textContent).toContain("아직 Agent 메시지가 없습니다.");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".auto-hunt-session-back")?.click();
    });

    expect(container.querySelector(".auto-hunt-session-page")).toBeNull();
    expect(container.querySelector(".auto-hunt-session-list")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("does not render a duplicate running status callout in session details", async () => {
    const session: AutoHuntSession = {
      id: "session-running",
      projectId: "project-1",
      status: "running",
      issues: [{
        runId: "run-1",
        runNumber: 1,
        sourceKey: "BRIAR-1",
        title: "진행 중인 이슈",
        outcome: "pending",
        summary: null,
      }],
      startedAt: "2026-07-22T01:00:00Z",
      completedAt: null,
      conversationId: "thread-1",
      workspaceRoot: "/repo",
      summary: null,
      error: null,
      events: [{ id: "event-1", type: "started", occurredAt: "2026-07-22T01:00:00Z" }],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <AutoHuntSessions
        dashboard={dashboard}
        error={null}
        isSidebarOpen
        onStart={() => "session-2"}
        sessions={[session]}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".auto-hunt-session-row")?.click();
    });

    expect(container.querySelector(".auto-hunt-running-callout")).toBeNull();
    expect(container.querySelector(".auto-hunt-status.running")).not.toBeNull();
    expect(container.querySelector(".auto-hunt-event-count i")).not.toBeNull();
    await act(async () => root.unmount());
  });
});
