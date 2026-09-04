/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import { testAgentSession } from "../../test/agent-sessions";
import { quickStartingRunIdAtom } from "../dialogs/atoms";
import { createTestRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import {
  AGENT_SESSION_STORAGE_KEY,
  writeStoredAgentSessions,
} from "./persistence";
import {
  agentSessionAtom,
  agentSessionIdsAtom,
  agentSessionsAtom,
  agentSessionsByIdAtom,
  processingIssueIdsAtom,
  teamAgentSessionIdsAtom,
  teamAgentSessionsAtom,
} from "./atoms";

beforeEach(() => {
  window.localStorage.clear();
});

describe("agent session atoms", () => {
  it("restores the stored sessions the first time they are read", () => {
    window.localStorage.setItem(
      AGENT_SESSION_STORAGE_KEY,
      JSON.stringify([
        testAgentSession("remote-session-1", {
          status: "running",
          localOwner: false,
        }),
      ]),
    );
    const registry = createTestRegistry();

    expect(registry.get(agentSessionsAtom)).toMatchObject([
      { id: "remote-session-1", status: "running", localOwner: false },
    ]);
    expect(registry.get(agentSessionIdsAtom)).toEqual(["remote-session-1"]);
    expect(registry.get(agentSessionsByIdAtom).size).toBe(1);
  });

  it("does not read storage again once the store has been written", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("session-1")],
    });
    writeStoredAgentSessions(window.localStorage, [
      testAgentSession("written-elsewhere"),
    ]);

    expect(registry.get(agentSessionsAtom).map((s) => s.id)).toEqual([
      "session-1",
    ]);
  });

  it("prepends a new session and leaves the others in place", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("first")],
    });
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("second")],
    });

    expect(registry.get(agentSessionIdsAtom)).toEqual(["second", "first"]);
  });

  it("notifies only the session that changed", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("b"), testAgentSession("a")],
    });

    /*
      Every subscription is `immediate`: that is what builds a derived atom's
      dependency graph, without which it is never notified at all. The counts
      the mount pass produced are reset before the change under test.
    */
    const notifications = { a: 0, b: 0, ids: 0, teamIds: 0, list: 0 };
    const count = (key: keyof typeof notifications) => () => {
      notifications[key] += 1;
    };
    const unsubscribe = [
      registry.subscribe(agentSessionAtom("a"), count("a"), { immediate: true }),
      registry.subscribe(agentSessionAtom("b"), count("b"), { immediate: true }),
      registry.subscribe(agentSessionIdsAtom, count("ids"), {
        immediate: true,
      }),
      registry.subscribe(teamAgentSessionIdsAtom("project-1"), count("teamIds"), {
        immediate: true,
      }),
      registry.subscribe(agentSessionsAtom, count("list"), {
        immediate: true,
      }),
    ];
    Object.assign(notifications, { a: 0, b: 0, ids: 0, teamIds: 0, list: 0 });

    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [
        { ...registry.get(agentSessionAtom("a"))!, status: "completed" },
      ],
    });

    expect(notifications).toEqual({ a: 1, b: 0, ids: 0, teamIds: 0, list: 1 });
    for (const stop of unsubscribe) stop();
  });

  it("notifies nobody for a change that changes nothing", () => {
    const registry = createTestRegistry();
    const session = testAgentSession("a");
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [session],
    });

    let notified = 0;
    const stop = registry.subscribe(
      agentSessionsAtom,
      () => {
        notified += 1;
      },
      { immediate: true },
    );
    notified = 0;
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [{ ...session }],
    });

    expect(notified).toBe(0);
    stop();
  });

  it("indexes a team's sessions in the order the whole list has them", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [
        testAgentSession("a-1"),
        testAgentSession("b-1", { projectId: "project-2" }),
        testAgentSession("a-2"),
      ],
    });

    expect(registry.get(teamAgentSessionIdsAtom("project-1"))).toEqual([
      "a-1",
      "a-2",
    ]);
    expect(
      registry.get(teamAgentSessionsAtom("project-2")).map((s) => s.id),
    ).toEqual(["b-1"]);
  });

  it("drops every session of a removed team", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [
        testAgentSession("a-1"),
        testAgentSession("b-1", { projectId: "project-2" }),
      ],
    });
    applySyncEvent(registry, {
      kind: "agent-sessions-removed",
      teamId: "project-1",
    });

    expect(registry.get(agentSessionIdsAtom)).toEqual(["b-1"]);
    expect(registry.get(agentSessionsByIdAtom).has("a-1")).toBe(false);
  });

  it("marks the dispatching run and every running session issue as busy", () => {
    const registry = createTestRegistry([
      [quickStartingRunIdAtom, "run-dispatching"],
    ]);
    const issues = (runIds: string[]) =>
      runIds.map((runId, index) => ({
        runId,
        runNumber: index + 1,
        sourceKey: runId,
        title: runId,
        outcome: "pending" as const,
        summary: null,
      }));
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [
        testAgentSession("session-1", {
          sessionType: "dispatch",
          issues: issues(["run-1", "run-2"]),
        }),
        testAgentSession("session-2", {
          sessionType: "dispatch",
          status: "completed",
          issues: issues(["run-3"]),
        }),
      ],
    });

    expect([...registry.get(processingIssueIdsAtom)].sort()).toEqual([
      "run-1",
      "run-2",
      "run-dispatching",
    ]);
  });

  it("re-sorts by start time when server copies are merged in", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [
        testAgentSession("older", { startedAt: "2026-07-28T01:00:00.000Z" }),
      ],
    });
    applySyncEvent(registry, {
      kind: "agent-sessions-merged",
      sessions: [
        testAgentSession("newer", {
          startedAt: "2026-07-28T03:00:00.000Z",
          localOwner: false,
        }),
      ],
    });

    expect(registry.get(agentSessionIdsAtom)).toEqual(["newer", "older"]);
  });
});
