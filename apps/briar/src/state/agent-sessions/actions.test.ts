/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import { testAgentSession } from "../../test/agent-sessions";
import type { AutoHuntSession, HuntRun } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import {
  createAgentSessionActions,
  type AgentSessionApi,
} from "./actions";
import {
  agentSessionSyncContextAtom,
  agentSessionsAtom,
} from "./atoms";

/** The calls an action made against the app server. */
interface RecordedCalls {
  readonly cancelledRuns: {
    token: string;
    projectId: string;
    runId: string;
  }[];
  readonly cancelledTasks: {
    token: string;
    projectId: string;
    sessionId: string;
  }[];
  readonly stopped: string[];
}

const harness = (api: Partial<AgentSessionApi> = {}) => {
  const registry = createTestRegistry();
  const calls: RecordedCalls = {
    cancelledRuns: [],
    cancelledTasks: [],
    stopped: [],
  };
  const actions = createAgentSessionActions(registry, {
    api: {
      cancelHuntRun: async (token, projectId, runId) => {
        calls.cancelledRuns.push({ token, projectId, runId });
        return {
          runId,
          outcome: "cancelled" as const,
          attempt: 1,
          stage: "cancelled" as const,
        };
      },
      stopTeamAgentSession: async (sessionId) => {
        calls.stopped.push(sessionId);
        return true;
      },
      ...api,
    },
  });
  const sessions = () => registry.get(agentSessionsAtom);
  return { actions, calls, registry, sessions };
};

const configured = (registry: AtomRegistry) =>
  registry.set(agentSessionSyncContextAtom, {
    token: "token-1",
    targets: [{ id: "project-1", organizationId: null }],
  });

const run = (id: string, overrides: Partial<HuntRun> = {}) =>
  ({
    id,
    runNumber: 1,
    sourceKey: "BRIAR-1",
    title: "세션 로그 복구",
    status: "running",
    ...overrides,
  }) as HuntRun;

beforeEach(() => {
  window.localStorage.clear();
});

describe("startTaskSession", () => {
  it("starts a scheduled session and reuses it for the same schedule run", () => {
    const { actions, sessions } = harness();
    const sessionId = actions.startTaskSession("project-1", "agent-1", {
      request: "Daily repository audit",
      startedAt: "2026-07-28T01:00:00.000Z",
      trigger: "scheduled",
      scheduleId: "schedule-1",
      scheduleRunId: "schedule-run-1",
    });

    expect(sessions()[0]).toMatchObject({
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

    expect(
      actions.startTaskSession("project-1", "agent-1", {
        request: "Daily repository audit",
        startedAt: "2026-07-28T01:00:00.000Z",
        trigger: "scheduled",
        scheduleId: "schedule-1",
        scheduleRunId: "schedule-run-1",
      }),
    ).toBe(sessionId);
    expect(sessions()).toHaveLength(1);
  });

  it("restarts a settled session and records a follow-up on it", () => {
    const { actions, sessions } = harness();
    const sessionId = actions.startTaskSession("project-1", "agent-1", {
      sessionId: "task-1",
      request: "Daily repository audit",
      startedAt: "2026-07-28T01:00:00.000Z",
    });
    actions.settleTaskSession(sessionId, {
      status: "completed",
      conversationId: "conversation-1",
      workspaceRoot: "/repo",
      summary: "Audit complete.",
      error: null,
    });
    actions.startTaskSession("project-1", "agent-1", {
      sessionId,
      request: "Also inspect the release notes.",
      startedAt: "2026-07-28T01:11:00.000Z",
      isFollowUp: true,
    });

    expect(sessions()[0]).toMatchObject({
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
  });

  it("leaves a session that is still running alone", () => {
    const { actions, sessions } = harness();
    actions.startTaskSession("project-1", "agent-1", {
      sessionId: "task-1",
      request: "First",
      startedAt: "2026-07-28T01:00:00.000Z",
    });
    actions.startTaskSession("project-1", "agent-1", {
      sessionId: "task-1",
      request: "Second",
      startedAt: "2026-07-28T01:05:00.000Z",
    });

    expect(sessions()[0]).toMatchObject({ request: "First" });
  });
});

describe("settleTaskSession", () => {
  it("records a no-work scheduled task as skipped", () => {
    const { actions, sessions } = harness();
    actions.startTaskSession("project-1", "agent-1", {
      sessionId: "scheduled-session-1",
      request: "Auto Hunt",
      startedAt: "2026-07-28T01:00:00.000Z",
      trigger: "scheduled",
    });
    actions.settleTaskSession("scheduled-session-1", {
      status: "skipped",
      conversationId: "conversation-1",
      workspaceRoot: "/repo",
      summary: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
      error: null,
    });

    expect(sessions()[0]).toMatchObject({
      status: "skipped",
      summary: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
      error: null,
    });
    expect(sessions()[0]?.events.at(-1)?.type).toBe("skipped");
  });
});

describe("startWorkerDispatchSession", () => {
  it("links the dispatched runs and inherits the parent session's identity", () => {
    const { actions, sessions } = harness();
    actions.startTaskSession("project-1", "agent-1", {
      sessionId: "task-session-1",
      agentName: "Inbox Agent",
      request: "대기 이슈를 처리해 줘",
      startedAt: "2026-07-28T01:00:00.000Z",
    });
    actions.startWorkerDispatchSession(
      "project-1",
      { id: "agent-1", name: "Inbox Agent" },
      [run("run-1")],
      {
        dispatchId: "dispatch-1",
        runIds: ["run-1"],
        parentSessionId: "task-session-1",
        startedAt: "2026-07-28T01:00:01.000Z",
      },
    );

    expect(sessions().find((s) => s.id === "dispatch-1")).toMatchObject({
      parentSessionId: "task-session-1",
      agentName: "Inbox Agent",
      status: "running",
      issues: [{ runId: "run-1", outcome: "pending" }],
    });
  });

  it("refuses a dispatch whose runs are not on the board", () => {
    const { actions } = harness();
    expect(() =>
      actions.startWorkerDispatchSession(
        "project-1",
        { id: "agent-1", name: "Inbox Agent" },
        [],
        { dispatchId: "dispatch-1", runIds: ["run-1"] },
      ),
    ).toThrow("전송한 이슈를 처리 세션에 연결하지 못했습니다.");
  });
});

describe("reconcileWorkerDispatches", () => {
  it("completes a dispatch once every run it sent reached an outcome", () => {
    const { actions, sessions } = harness();
    actions.startWorkerDispatchSession(
      "project-1",
      { id: "agent-1", name: "Inbox Agent" },
      [run("run-1")],
      { dispatchId: "dispatch-1", runIds: ["run-1"] },
    );
    actions.reconcileWorkerDispatches("project-1", [
      run("run-1", { status: "completed", resultSummary: "저장되었습니다." }),
    ]);

    expect(sessions()[0]).toMatchObject({
      status: "completed",
      summary: "BRIAR-1: 저장되었습니다.",
    });
  });

  it("leaves another team's dispatches alone", () => {
    const { actions, sessions } = harness();
    actions.startWorkerDispatchSession(
      "project-2",
      { id: "agent-1", name: "Inbox Agent" },
      [run("run-1")],
      { dispatchId: "dispatch-1", runIds: ["run-1"] },
    );
    const before = sessions()[0];
    actions.reconcileWorkerDispatches("project-1", [
      run("run-1", { status: "completed" }),
    ]);

    expect(sessions()[0]).toBe(before);
  });
});

describe("adoptRemoteSession", () => {
  it("takes in a session the server owns", () => {
    const { actions, sessions } = harness();
    actions.adoptRemoteSession(
      testAgentSession("remote-1", { localOwner: true }),
    );
    expect(sessions()[0]).toMatchObject({
      id: "remote-1",
      localOwner: false,
    });
  });
});

describe("stopSession", () => {
  it("stops a locally owned session and ignores late settlement", async () => {
    const { actions, calls, sessions } = harness();
    actions.startTaskSession("project-1", "agent-1", {
      sessionId: "task-session-1",
      request: "Long-running audit",
      startedAt: "2026-07-28T01:00:00.000Z",
    });

    expect(await actions.stopSession("task-session-1")).toBe(true);
    actions.settleTaskSession("task-session-1", {
      status: "failed",
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: "late provider error",
    });

    expect(calls.stopped).toEqual(["task-session-1"]);
    expect(sessions()[0]).toMatchObject({
      id: "task-session-1",
      status: "interrupted",
      error: null,
    });
    expect(sessions()[0]?.events.at(-1)?.type).toBe("stopped");
  });

  it("cancels the pending runs of a worker dispatch", async () => {
    const { actions, calls, registry } = harness();
    configured(registry);
    actions.startWorkerDispatchSession(
      "project-1",
      { id: "agent-1", name: "Inbox Agent" },
      [run("run-1")],
      { dispatchId: "dispatch-1", runIds: ["run-1"] },
    );

    expect(await actions.stopSession("dispatch-1")).toBe(true);
    expect(calls.cancelledRuns).toEqual([{
      token: "token-1",
      projectId: "project-1",
      runId: "run-1",
    }]);
    expect(calls.stopped).toEqual([]);
  });

  it("cancels a remote worker task session through the app server", async () => {
    const remoteSession = testAgentSession("remote-task-session", {
      request: "Audit the release worker",
      requestedWorkerId: "worker-1",
      workerId: "worker-1",
      events: [{
        id: "remote-task-session-started",
        type: "started",
        occurredAt: "2026-07-28T01:00:00.000Z",
      }],
      localOwner: false,
      detailLoaded: true,
    });
    const cancelledTasks: RecordedCalls["cancelledTasks"] = [];
    const { actions, registry, sessions } = harness({
      stopTeamAgentSession: async () => {
        throw new Error(
          "The desktop stop command cannot reach a worker session.",
        );
      },
      cancelProjectAgentTask: async (token, projectId, sessionId) => {
        cancelledTasks.push({ token, projectId, sessionId });
        return {
          ...remoteSession,
          status: "interrupted",
          completedAt: "2026-07-28T01:05:00.000Z",
          updatedAt: "2026-07-28T01:05:00.000Z",
          events: [...remoteSession.events, {
            id: "remote-task-session-stopped",
            type: "stopped",
            occurredAt: "2026-07-28T01:05:00.000Z",
          }],
        } satisfies AutoHuntSession;
      },
    });
    actions.adoptRemoteSession(remoteSession);
    configured(registry);

    expect(await actions.stopSession("remote-task-session")).toBe(true);
    expect(cancelledTasks).toEqual([{
      token: "token-1",
      projectId: "project-1",
      sessionId: "remote-task-session",
    }]);
    expect(sessions()[0]).toMatchObject({
      id: "remote-task-session",
      status: "interrupted",
      localOwner: false,
      error: null,
    });
    expect(sessions()[0]?.events.at(-1)?.type).toBe("stopped");
  });

  it("reports a failed remote cancel to the caller", async () => {
    const { actions, registry, sessions } = harness({
      cancelProjectAgentTask: async () => {
        throw new Error("Agent task not found for this session");
      },
    });
    actions.adoptRemoteSession(
      testAgentSession("remote-task-session", {
        requestedWorkerId: "worker-1",
        workerId: "worker-1",
        localOwner: false,
        detailLoaded: true,
      }),
    );
    configured(registry);

    await expect(actions.stopSession("remote-task-session")).rejects.toThrow(
      "Agent task not found for this session",
    );
    expect(sessions()[0]?.status).toBe("running");
  });

  it("does nothing for a session that is not running", async () => {
    const { actions, calls } = harness();
    expect(await actions.stopSession("missing")).toBe(false);
    expect(calls.stopped).toEqual([]);
  });
});

describe("removeTeamSessions", () => {
  it("drops the sessions of a team that is being deleted", () => {
    const { actions, sessions } = harness();
    actions.startTaskSession("project-1", "agent-1", {
      sessionId: "a",
      request: "a",
      startedAt: "2026-07-28T01:00:00.000Z",
    });
    actions.startTaskSession("project-2", "agent-1", {
      sessionId: "b",
      request: "b",
      startedAt: "2026-07-28T01:00:00.000Z",
    });
    actions.removeTeamSessions("project-1");

    expect(sessions().map((session) => session.id)).toEqual(["b"]);
  });
});

describe("configureSync", () => {
  it("keeps the context object identical for the same account and teams", () => {
    const { actions, registry } = harness();
    actions.configureSync("token-1", [
      { id: "project-2", organizationId: "org-1" },
      { id: "project-1" },
    ]);
    const first = registry.get(agentSessionSyncContextAtom);
    actions.configureSync("token-1", [
      { id: "project-1", organizationId: null },
      { id: "project-2", organizationId: "org-1" },
      { id: "project-2", organizationId: "org-1" },
    ]);

    expect(registry.get(agentSessionSyncContextAtom)).toBe(first);
    expect(first?.targets.map((target) => target.id)).toEqual([
      "project-1",
      "project-2",
    ]);
  });

  it("clears the context when the account signs out", () => {
    const { actions, registry } = harness();
    actions.configureSync("token-1", [{ id: "project-1" }]);
    actions.configureSync(null, []);
    expect(registry.get(agentSessionSyncContextAtom)).toBeNull();
  });
});
