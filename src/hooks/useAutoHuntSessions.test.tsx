/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { useAutoHuntSessions } from "./useAutoHuntSessions";

type SessionsHook = ReturnType<typeof useAutoHuntSessions>;

let sessionsHook: SessionsHook;

function Harness() {
  sessionsHook = useAutoHuntSessions();
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("useAutoHuntSessions", () => {
  it("starts and settles a scheduled task session with schedule identity", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    let sessionId = "";
    await act(async () => {
      sessionId = sessionsHook.startTaskSession("project-1", "agent-1", {
        request: "Daily repository audit",
        startedAt: "2026-07-28T01:00:00.000Z",
        trigger: "scheduled",
        scheduleId: "schedule-1",
        scheduleRunId: "schedule-run-1",
      });
    });

    expect(sessionsHook.sessions[0]).toMatchObject({
      id: sessionId,
      projectId: "project-1",
      agentId: "agent-1",
      sessionType: "task",
      trigger: "scheduled",
      scheduleId: "schedule-1",
      scheduleRunId: "schedule-run-1",
      request: "Daily repository audit",
      status: "running",
    });

    let repeatedSessionId = "";
    await act(async () => {
      repeatedSessionId = sessionsHook.startTaskSession(
        "project-1",
        "agent-1",
        {
          request: "Daily repository audit",
          startedAt: "2026-07-28T01:00:00.000Z",
          trigger: "scheduled",
          scheduleId: "schedule-1",
          scheduleRunId: "schedule-run-1",
        },
      );
    });
    expect(repeatedSessionId).toBe(sessionId);
    expect(sessionsHook.sessions).toHaveLength(1);

    await act(async () => {
      sessionsHook.settleTaskSession(sessionId, {
        status: "completed",
        conversationId: "conversation-1",
        workspaceRoot: "/repo",
        summary: "Audit complete.",
        error: null,
      });
    });

    expect(sessionsHook.sessions[0]).toMatchObject({
      id: sessionId,
      status: "completed",
      conversationId: "conversation-1",
      workspaceRoot: "/repo",
      summary: "Audit complete.",
      error: null,
    });

    await act(async () => root.unmount());
  });
});
