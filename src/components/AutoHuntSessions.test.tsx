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
        onSidebarOpen={() => undefined}
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

  it("opens a session overview modal from the session list", async () => {
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
        onSidebarOpen={() => undefined}
        onStart={() => "session-2"}
        sessions={[session]}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".auto-hunt-session-row")?.click();
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("삭제 오류 수정");
    expect(dialog?.textContent).toContain("수정하고 검증했습니다.");
    expect(dialog?.textContent).toContain("세션을 시작했습니다.");
    expect(dialog?.textContent).toContain("Codex App Server 이벤트");
    expect(dialog?.textContent).toContain("아직 기록된 App Server 이벤트가 없습니다.");
    await act(async () => root.unmount());
  });
});
