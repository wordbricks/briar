/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mergeSynchronizedSessions,
  useAutoHuntSessions,
  type AutoHuntSession,
} from "./useAutoHuntSessions";

type SessionsHook = ReturnType<typeof useAutoHuntSessions>;

let sessionsHook: SessionsHook;
let stopper: Parameters<typeof useAutoHuntSessions>[0] | undefined;

function Harness() {
  sessionsHook = useAutoHuntSessions(stopper);
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  stopper = undefined;
});

describe("useAutoHuntSessions", () => {
  it("keeps a remotely owned running session active after app restart", async () => {
    window.localStorage.setItem(
      "briar.auto-hunt-sessions.v1",
      JSON.stringify([{
        id: "remote-session-1",
        dispatchGroupId: "",
        projectId: "project-1",
        agentId: "agent-1",
        sessionType: "task",
        trigger: "manual",
        request: "Remote repository audit",
        status: "running",
        issues: [],
        startedAt: "2026-07-28T01:00:00.000Z",
        completedAt: null,
        conversationId: null,
        workspaceRoot: null,
        summary: null,
        error: null,
        events: [],
        dispatchEvents: [],
        workers: [],
        updatedAt: "2026-07-28T01:00:00.000Z",
        localOwner: false,
      }]),
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    expect(sessionsHook.sessions[0]).toMatchObject({
      id: "remote-session-1",
      status: "running",
      localOwner: false,
    });

    await act(async () => root.unmount());
  });

  it("merges a newer remote status without losing local-only details", () => {
    const local = {
      id: "session-1",
      dispatchGroupId: "",
      projectId: "project-1",
      agentId: "agent-1",
      sessionType: "task",
      status: "running",
      issues: [],
      startedAt: "2026-07-28T01:00:00.000Z",
      completedAt: null,
      conversationId: null,
      workspaceRoot: "/repo",
      summary: null,
      error: null,
      events: [],
      dispatchEvents: [],
      workers: [],
      updatedAt: "2026-07-28T01:00:00.000Z",
      localOwner: true,
    } as AutoHuntSession;
    const remote = {
      ...local,
      status: "completed",
      completedAt: "2026-07-28T01:10:00.000Z",
      workspaceRoot: null,
      updatedAt: "2026-07-28T01:10:00.000Z",
      localOwner: false,
    } as AutoHuntSession;

    expect(mergeSynchronizedSessions([local], [remote])[0])
      .toMatchObject({
        status: "completed",
        workspaceRoot: "/repo",
        localOwner: true,
      });
  });

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

  it("stops a running session and ignores late settlement", async () => {
    stopper = async () => true;
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    await act(async () => {
      sessionsHook.startTaskSession("project-1", "agent-1", {
        sessionId: "task-session-1",
        request: "Long-running audit",
        startedAt: "2026-07-28T01:00:00.000Z",
      });
    });
    await act(async () => {
      await sessionsHook.stopSession("task-session-1");
    });
    await act(async () => {
      sessionsHook.settleTaskSession("task-session-1", {
        status: "failed",
        conversationId: null,
        workspaceRoot: null,
        summary: null,
        error: "late provider error",
      });
    });

    expect(sessionsHook.sessions[0]).toMatchObject({
      id: "task-session-1",
      status: "interrupted",
      error: null,
    });
    expect(sessionsHook.sessions[0]?.events.at(-1)?.type).toBe("stopped");

    await act(async () => root.unmount());
  });
});
