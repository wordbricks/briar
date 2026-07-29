/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { HuntRun, ProjectAgent } from "../types";
import { useAutoHuntSessions } from "./useAutoHuntSessions";

type SessionsHook = ReturnType<typeof useAutoHuntSessions>;
type AutoHuntRunner = NonNullable<
  Parameters<typeof useAutoHuntSessions>[0]
>;

let sessionsHook: SessionsHook;
let runner: AutoHuntRunner | undefined;
let stopper: Parameters<typeof useAutoHuntSessions>[1] | undefined;

function Harness() {
  sessionsHook = useAutoHuntSessions(runner, stopper);
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  runner = undefined;
  stopper = undefined;
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

  it("allows a task session to hand off to an Auto Hunt dispatch", async () => {
    runner = () =>
      new Promise<Awaited<ReturnType<AutoHuntRunner>>>(() => undefined);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    await act(async () => {
      sessionsHook.startTaskSession("project-1", "agent-1", {
        sessionId: "task-session-1",
        request: "Process queued issues with Auto Hunt.",
        startedAt: "2026-07-28T01:00:00.000Z",
      });
    });

    await act(async () => {
      sessionsHook.startSession(
        "project-1",
        [{
          id: "run-1",
          runNumber: 1,
          sourceKey: "issue-1",
          title: "Queued issue",
          status: "queued",
          priority: null,
          sourceCreatedAt: null,
          startedAt: "2026-07-28T00:00:00.000Z",
        } as HuntRun],
        undefined,
        {
          agent: { id: "agent-1" } as ProjectAgent,
          parentSessionId: "task-session-1",
        },
      );
    });

    expect(sessionsHook.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: "project-1",
          sessionType: "task",
          status: "running",
        }),
        expect.objectContaining({
          projectId: "project-1",
          sessionType: "dispatch",
          parentSessionId: "task-session-1",
          request: "Process queued issues with Auto Hunt.",
          status: "running",
        }),
      ]),
    );

    await act(async () => root.unmount());
  });

  it("runs multiple Auto Hunt dispatches with disjoint issue claims", async () => {
    runner = () =>
      new Promise<Awaited<ReturnType<AutoHuntRunner>>>(() => undefined);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    const runs = [
      {
        id: "run-1",
        runNumber: 1,
        sourceKey: "issue-1",
        title: "Queued issue 1",
        status: "queued",
        priority: null,
        sourceCreatedAt: null,
        startedAt: "2026-07-28T00:00:00.000Z",
      },
      {
        id: "run-2",
        runNumber: 2,
        sourceKey: "issue-2",
        title: "Queued issue 2",
        status: "queued",
        priority: null,
        sourceCreatedAt: null,
        startedAt: "2026-07-28T00:01:00.000Z",
      },
    ] as HuntRun[];
    const options = { agent: { id: "agent-1" } as ProjectAgent };

    act(() => {
      sessionsHook.startSession("project-1", [runs[0]], undefined, options);
    });

    act(() => {
      sessionsHook.startSession("project-1", runs, undefined, options);
    });

    const dispatches = sessionsHook.sessions.filter(
      (session) => session.sessionType === "dispatch",
    );
    expect(dispatches).toHaveLength(2);
    expect(dispatches.map((session) => session.issues[0].runId).sort()).toEqual([
      "run-1",
      "run-2",
    ]);

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
