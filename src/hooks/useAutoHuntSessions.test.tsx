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

function Harness() {
  sessionsHook = useAutoHuntSessions(runner);
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  runner = undefined;
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
        { agent: { id: "agent-1" } as ProjectAgent },
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
          status: "running",
        }),
      ]),
    );

    await act(async () => root.unmount());
  });

  it("still rejects a second running Auto Hunt dispatch", async () => {
    runner = () =>
      new Promise<Awaited<ReturnType<AutoHuntRunner>>>(() => undefined);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));
    const runs = [{
      id: "run-1",
      runNumber: 1,
      sourceKey: "issue-1",
      title: "Queued issue",
      status: "queued",
      priority: null,
      sourceCreatedAt: null,
      startedAt: "2026-07-28T00:00:00.000Z",
    } as HuntRun];
    const options = { agent: { id: "agent-1" } as ProjectAgent };

    act(() => {
      sessionsHook.startSession("project-1", runs, undefined, options);
    });

    expect(() => {
      sessionsHook.startSession("project-1", runs, undefined, options);
    }).toThrow("이 프로젝트에서 이미 자동사냥 세션이 진행 중입니다.");

    await act(async () => root.unmount());
  });
});
