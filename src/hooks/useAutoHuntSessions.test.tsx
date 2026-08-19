/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { HuntRun } from "../types";
import {
  applyProjectAgentSessionSync,
  mergeSynchronizedSessions,
  reconcileWorkerDispatchSession,
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
  it("links dispatched Worker runs and completes the session from run outcomes", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    await act(async () => {
      sessionsHook.startTaskSession("project-1", "agent-1", {
        sessionId: "task-session-1",
        agentName: "Inbox Agent",
        request: "대기 이슈를 처리해 줘",
        startedAt: "2026-07-28T01:00:00.000Z",
      });
      sessionsHook.startWorkerDispatchSession(
        "project-1",
        { id: "agent-1", name: "Inbox Agent" },
        [{
          id: "run-1",
          runNumber: 1,
          sourceKey: "BRIAR-1",
          title: "세션 로그 복구",
        } as HuntRun],
        {
          dispatchId: "dispatch-1",
          runIds: ["run-1"],
          parentSessionId: "task-session-1",
          startedAt: "2026-07-28T01:00:01.000Z",
        },
      );
    });

    const dispatch = sessionsHook.sessions.find(
      (candidate) => candidate.id === "dispatch-1",
    )!;
    expect(dispatch).toMatchObject({
      parentSessionId: "task-session-1",
      agentName: "Inbox Agent",
      status: "running",
      issues: [{ runId: "run-1", outcome: "pending" }],
    });

    const completed = reconcileWorkerDispatchSession(
      dispatch,
      [{
        id: "run-1",
        status: "completed",
        resultSummary: "워커 결과가 저장되었습니다.",
      } as HuntRun],
      "2026-07-28T01:10:00.000Z",
    );
    expect(completed).toMatchObject({
      status: "completed",
      completedAt: "2026-07-28T01:10:00.000Z",
      summary: "BRIAR-1: 워커 결과가 저장되었습니다.",
      issues: [{ outcome: "completed", summary: "워커 결과가 저장되었습니다." }],
    });
    expect(completed.events.at(-1)?.type).toBe("completed");

    await act(async () => root.unmount());
  });

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
      summary: "로컬 상세 결과",
      error: null,
      events: [{
        id: "local-event",
        type: "completed",
        occurredAt: "2026-07-28T01:00:00.000Z",
      }],
      dispatchEvents: [],
      workers: [],
      updatedAt: "2026-07-28T01:00:00.000Z",
      localOwner: true,
      detailLoaded: true,
    } as AutoHuntSession;
    const remote = {
      ...local,
      status: "completed",
      completedAt: "2026-07-28T01:10:00.000Z",
      workspaceRoot: null,
      summary: null,
      events: [],
      updatedAt: "2026-07-28T01:10:00.000Z",
      localOwner: false,
      detailLoaded: false,
    } as AutoHuntSession;

    expect(mergeSynchronizedSessions([local], [remote])[0])
      .toMatchObject({
        status: "completed",
        workspaceRoot: "/repo",
        summary: "로컬 상세 결과",
        events: [{ id: "local-event" }],
        detailLoaded: true,
        localOwner: true,
      });
  });

  it("invalidates stale loaded detail when a newer remote summary arrives", () => {
    const local = {
      id: "remote-task-1",
      dispatchGroupId: "remote-task-1",
      projectId: "project-1",
      agentId: "agent-1",
      sessionType: "task",
      status: "running",
      issues: [],
      startedAt: "2026-08-18T01:00:00.000Z",
      completedAt: null,
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [{
        id: "started-1",
        type: "started",
        occurredAt: "2026-08-18T01:00:00.000Z",
      }],
      dispatchEvents: [],
      workers: [],
      updatedAt: "2026-08-18T01:00:00.000Z",
      localOwner: false,
      detailLoaded: true,
    } as AutoHuntSession;
    const completedSummary = {
      ...local,
      status: "completed",
      completedAt: "2026-08-18T01:05:00.000Z",
      events: [],
      updatedAt: "2026-08-18T01:05:00.000Z",
      detailLoaded: false,
    } as AutoHuntSession;

    expect(mergeSynchronizedSessions([local], [completedSummary])[0])
      .toMatchObject({
        status: "completed",
        events: [],
        detailLoaded: false,
        localOwner: false,
      });
  });

  it("replaces remote project summaries without deleting local-owned sessions", () => {
    const base = {
      id: "session-1",
      dispatchGroupId: "session-1",
      projectId: "project-1",
      agentId: "agent-1",
      sessionType: "task",
      status: "completed",
      issues: [],
      startedAt: "2026-07-28T01:00:00.000Z",
      completedAt: "2026-07-28T01:10:00.000Z",
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [],
      dispatchEvents: [],
      workers: [],
      updatedAt: "2026-07-28T01:10:00.000Z",
    } as AutoHuntSession;
    const local = {
      ...base,
      id: "local-session",
      localOwner: true,
    };
    const staleRemote = {
      ...base,
      id: "stale-session",
      localOwner: false,
    };
    const nextRemote = {
      ...base,
      id: "next-session",
      localOwner: false,
      detailLoaded: false,
    };

    const result = applyProjectAgentSessionSync(
      [local, staleRemote],
      "project-1",
      [nextRemote],
      [],
      true,
    );
    expect(result.map((session) => session.id).sort()).toEqual([
      "local-session",
      "next-session",
    ]);
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

    await act(async () => {
      sessionsHook.startTaskSession("project-1", "agent-1", {
        sessionId,
        request: "Also inspect the release notes.",
        startedAt: "2026-07-28T01:11:00.000Z",
        isFollowUp: true,
      });
    });

    expect(sessionsHook.sessions[0]).toMatchObject({
      id: sessionId,
      request: "Daily repository audit",
      startedAt: "2026-07-28T01:00:00.000Z",
      status: "running",
      completedAt: null,
      conversationId: "conversation-1",
      workspaceRoot: "/repo",
      followUps: [{
        message: "Also inspect the release notes.",
        sentAt: "2026-07-28T01:11:00.000Z",
      }],
    });

    await act(async () => root.unmount());
  });

  it("records a no-work scheduled task as skipped", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    await act(async () => {
      sessionsHook.startTaskSession("project-1", "agent-1", {
        sessionId: "scheduled-session-1",
        request: "Auto Hunt",
        startedAt: "2026-07-28T01:00:00.000Z",
        trigger: "scheduled",
      });
      sessionsHook.settleTaskSession("scheduled-session-1", {
        status: "skipped",
        conversationId: "conversation-1",
        workspaceRoot: "/repo",
        summary: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
        error: null,
      });
    });

    expect(sessionsHook.sessions[0]).toMatchObject({
      status: "skipped",
      summary: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
      error: null,
    });
    expect(sessionsHook.sessions[0]?.events.at(-1)?.type).toBe("skipped");

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
