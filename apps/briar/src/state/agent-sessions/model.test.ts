import { describe, expect, it } from "vitest";

import { testAgentSession } from "../../test/agent-sessions";
import type { AutoHuntSession, HuntRun } from "../../types";
import {
  applyProjectAgentSessionSync,
  canStopAutoHuntSession,
  collapseLinkedAutoHuntSessions,
  mergeSynchronizedSessions,
  reconcileWorkerDispatchSession,
} from "./model";

const dispatchSession = (overrides: Partial<AutoHuntSession> = {}) =>
  testAgentSession("dispatch-1", {
    sessionType: "dispatch",
    agentName: "Inbox Agent",
    issues: [{
      runId: "run-1",
      runNumber: 1,
      sourceKey: "BRIAR-1",
      title: "세션 로그 복구",
      outcome: "pending",
      summary: null,
    }],
    ...overrides,
  });

describe("collapseLinkedAutoHuntSessions", () => {
  it("hides the task a dispatch session was spawned from", () => {
    const task = testAgentSession("task-1");
    const dispatch = dispatchSession({ parentSessionId: "task-1" });
    expect(
      collapseLinkedAutoHuntSessions([dispatch, task]).map((s) => s.id),
    ).toEqual(["dispatch-1"]);
  });
});

describe("canStopAutoHuntSession", () => {
  it("stops a locally owned session and a remote task with a worker", () => {
    expect(canStopAutoHuntSession(testAgentSession("s"))).toBe(true);
    expect(
      canStopAutoHuntSession(
        testAgentSession("s", { localOwner: false, workerId: "worker-1" }),
      ),
    ).toBe(true);
  });

  it("cannot stop a remote task no worker has claimed, or a remote dispatch", () => {
    expect(
      canStopAutoHuntSession(testAgentSession("s", { localOwner: false })),
    ).toBe(false);
    expect(
      canStopAutoHuntSession(
        testAgentSession("s", {
          localOwner: false,
          sessionType: "dispatch",
          workerId: "worker-1",
        }),
      ),
    ).toBe(false);
  });
});

describe("reconcileWorkerDispatchSession", () => {
  it("completes the session from the outcomes of the runs it dispatched", () => {
    const completed = reconcileWorkerDispatchSession(
      dispatchSession(),
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
  });

  it("returns the session itself when nothing moved", () => {
    const session = dispatchSession();
    expect(
      reconcileWorkerDispatchSession(
        session,
        [{ id: "run-1", status: "running" } as HuntRun],
      ),
    ).toBe(session);
  });

  it("waits for a run the board does not list yet", () => {
    const session = dispatchSession();
    expect(reconcileWorkerDispatchSession(session, [])).toBe(session);
  });
});

describe("mergeSynchronizedSessions", () => {
  it("merges a newer remote status without losing local-only details", () => {
    const local = testAgentSession("session-1", {
      workspaceRoot: "/repo",
      summary: "로컬 상세 결과",
      events: [{
        id: "local-event",
        type: "completed",
        occurredAt: "2026-07-28T01:00:00.000Z",
      }],
      detailLoaded: true,
    });
    const remote: AutoHuntSession = {
      ...local,
      status: "completed",
      completedAt: "2026-07-28T01:10:00.000Z",
      workspaceRoot: null,
      summary: null,
      events: [],
      updatedAt: "2026-07-28T01:10:00.000Z",
      localOwner: false,
      detailLoaded: false,
    };

    expect(mergeSynchronizedSessions([local], [remote])[0]).toMatchObject({
      status: "completed",
      workspaceRoot: "/repo",
      summary: "로컬 상세 결과",
      events: [{ id: "local-event" }],
      detailLoaded: true,
      localOwner: true,
    });
  });

  it("invalidates stale loaded detail when a newer remote summary arrives", () => {
    const local = testAgentSession("remote-task-1", {
      startedAt: "2026-08-18T01:00:00.000Z",
      updatedAt: "2026-08-18T01:00:00.000Z",
      events: [{
        id: "started-1",
        type: "started",
        occurredAt: "2026-08-18T01:00:00.000Z",
      }],
      localOwner: false,
      detailLoaded: true,
    });
    const completedSummary: AutoHuntSession = {
      ...local,
      status: "completed",
      completedAt: "2026-08-18T01:05:00.000Z",
      events: [],
      updatedAt: "2026-08-18T01:05:00.000Z",
      detailLoaded: false,
    };

    expect(mergeSynchronizedSessions([local], [completedSummary])[0])
      .toMatchObject({
        status: "completed",
        events: [],
        detailLoaded: false,
        localOwner: false,
      });
  });

  it("keeps the local copy when it is at least as new", () => {
    const local = testAgentSession("session-1", { summary: "local" });
    const merged = mergeSynchronizedSessions([local], [{
      ...local,
      summary: "remote",
    }]);
    expect(merged[0]).toBe(local);
  });
});

describe("applyProjectAgentSessionSync", () => {
  it("replaces remote project summaries without deleting local-owned sessions", () => {
    const base = testAgentSession("session-1", {
      status: "completed",
      completedAt: "2026-07-28T01:10:00.000Z",
      updatedAt: "2026-07-28T01:10:00.000Z",
    });
    const result = applyProjectAgentSessionSync(
      [
        { ...base, id: "local-session", localOwner: true },
        { ...base, id: "stale-session", localOwner: false },
      ],
      "project-1",
      [{ ...base, id: "next-session", localOwner: false, detailLoaded: false }],
      [],
      true,
    );
    expect(result.map((session) => session.id).sort()).toEqual([
      "local-session",
      "next-session",
    ]);
  });

  it("drops only the remote sessions the page reported deleted", () => {
    const base = testAgentSession("kept", { localOwner: false });
    const result = applyProjectAgentSessionSync(
      [base, { ...base, id: "gone" }],
      "project-1",
      [],
      ["gone"],
      false,
    );
    expect(result.map((session) => session.id)).toEqual(["kept"]);
  });
});
