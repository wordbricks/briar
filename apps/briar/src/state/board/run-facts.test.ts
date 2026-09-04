import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type {
  AutoHuntSession,
  ExecutionWorker,
  HuntRun,
  OrganizationMember,
  ProjectAgent,
} from "../../types";
import { membersByIdAtom, teamMemberIdsAtom } from "../entities/members";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamWorkerIdsAtom, workersByIdAtom } from "../entities/workers";
import { createTestRegistry } from "../registry";
import { boardRunKey } from "./atoms";
import {
  boardAgentsAtom,
  boardSessionsAtom,
  runAgentAssociationAtom,
  runAssignedWorkerAtom,
  runAssigneeAtom,
} from "./run-facts";

/*
  The per-run facts, checked against the two-pass loop the board ran over every
  run at once: a run's own agent labels it and counts as working only while the
  run is in flight, and otherwise the newest session that touched the run wins.
*/

const teamId = "team-a";

const agentOf = (id: string, name: string): ProjectAgent => ({
  id,
  teamId,
  name,
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Process issues",
  skill: "# Agent",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
});

const runAgent = agentOf("agent-run", "Run agent");
const sessionAgent = agentOf("agent-session", "Session agent");
const olderSessionAgent = agentOf("agent-older", "Older session agent");

const workerTemplate: ExecutionWorker = {
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "user-1",
  label: "Lemon Worker",
  icon: { type: "emoji", value: "\u{1F34B}" },
  agentProvider: "codex",
  providers: ["codex"],
  versions: { briar: "1.2.25" },
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-07-29T00:00:00.000Z",
  createdAt: "2026-07-29T00:00:00.000Z",
};

const memberTemplate: OrganizationMember = {
  userId: "member-1",
  name: "Member",
  email: "member@briar.local",
  image: null,
  role: "developer",
  createdAt: "2026-07-29T00:00:00.000Z",
};

const template = demoDashboard.runs[0]!;
const runOf = (run: Partial<HuntRun> & { id: string }): HuntRun => ({
  ...template,
  teamId,
  agentId: null,
  assigneeUserId: null,
  workerId: null,
  requestedWorkerId: null,
  ...run,
});

const sessionOf = (
  session: Partial<AutoHuntSession> & { id: string; runId: string },
): AutoHuntSession => ({
  dispatchGroupId: "dispatch-1",
  projectId: teamId,
  agentId: sessionAgent.id,
  sessionType: "dispatch",
  status: "running",
  issues: [
    {
      runId: session.runId,
      runNumber: 1,
      sourceKey: "ISSUE-1",
      title: "Issue",
      outcome: "pending",
      summary: null,
    },
  ],
  startedAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
  completedAt: null,
  conversationId: null,
  workspaceRoot: null,
  summary: null,
  error: null,
  events: [],
  dispatchEvents: [],
  workers: [],
  ...session,
});

const harness = (
  runs: readonly HuntRun[],
  sessions: readonly AutoHuntSession[] = [],
  agents: readonly ProjectAgent[] = [runAgent, sessionAgent, olderSessionAgent],
) =>
  createTestRegistry([
    [runsByIdAtom, new Map(runs.map((run) => [run.id, run]))],
    [teamRunIdsAtom(teamId), runs.map((run) => run.id)],
    [boardAgentsAtom, agents],
    [boardSessionsAtom, sessions],
  ]);

describe("board run facts", () => {
  it("labels a run with its own agent and calls it active while it runs", () => {
    const registry = harness([
      runOf({ id: "run-a", agentId: runAgent.id, status: "running" }),
    ]);

    expect(
      registry.get(runAgentAssociationAtom(boardRunKey(teamId, "run-a"))),
    ).toEqual({ active: runAgent, performed: runAgent });
  });

  it("keeps a finished run's agent as the performer but not as active", () => {
    const registry = harness([
      runOf({ id: "run-a", agentId: runAgent.id, status: "completed" }),
    ]);

    expect(
      registry.get(runAgentAssociationAtom(boardRunKey(teamId, "run-a"))),
    ).toEqual({ active: null, performed: runAgent });
  });

  it("falls back to a running session for a run with no agent of its own", () => {
    const registry = harness(
      [runOf({ id: "run-a", status: "queued" })],
      [sessionOf({ id: "session-1", runId: "run-a" })],
    );

    expect(
      registry.get(runAgentAssociationAtom(boardRunKey(teamId, "run-a"))),
    ).toEqual({ active: sessionAgent, performed: sessionAgent });
  });

  it("lets a running session mark a queued run with its own agent as active", () => {
    const registry = harness(
      [runOf({ id: "run-a", agentId: runAgent.id, status: "queued" })],
      [sessionOf({ id: "session-1", runId: "run-a" })],
    );

    // The run's agent still performed it; the session says who is on it now.
    expect(
      registry.get(runAgentAssociationAtom(boardRunKey(teamId, "run-a"))),
    ).toEqual({ active: sessionAgent, performed: runAgent });
  });

  it("prefers the session that started most recently", () => {
    const registry = harness(
      [runOf({ id: "run-a", status: "queued" })],
      [
        sessionOf({
          id: "session-old",
          runId: "run-a",
          agentId: olderSessionAgent.id,
          startedAt: "2026-07-28T00:00:00.000Z",
        }),
        sessionOf({
          id: "session-new",
          runId: "run-a",
          startedAt: "2026-07-30T00:00:00.000Z",
        }),
      ],
    );

    expect(
      registry.get(runAgentAssociationAtom(boardRunKey(teamId, "run-a")))
        .performed,
    ).toBe(sessionAgent);
  });

  it("ignores sessions of other teams and a completed session's pending flag", () => {
    const registry = harness(
      [runOf({ id: "run-a", status: "queued" })],
      [
        sessionOf({ id: "session-other", runId: "run-a", projectId: "team-b" }),
      ],
    );
    expect(
      registry.get(runAgentAssociationAtom(boardRunKey(teamId, "run-a"))),
    ).toEqual({ active: null, performed: null });

    const finished = harness(
      [runOf({ id: "run-a", status: "queued" })],
      [
        sessionOf({
          id: "session-done",
          runId: "run-a",
          status: "completed",
          issues: [
            {
              runId: "run-a",
              runNumber: 1,
              sourceKey: "ISSUE-1",
              title: "Issue",
              outcome: "completed",
              summary: null,
            },
          ],
        }),
      ],
    );
    expect(
      finished.get(runAgentAssociationAtom(boardRunKey(teamId, "run-a"))),
    ).toEqual({ active: null, performed: sessionAgent });
  });

  it("notifies a card only when its own agent changes", () => {
    const registry = harness(
      [
        runOf({ id: "run-a", agentId: runAgent.id, status: "running" }),
        runOf({ id: "run-b", status: "queued" }),
      ],
      [sessionOf({ id: "session-1", runId: "run-b" })],
    );
    const seen: unknown[] = [];
    registry.subscribe(
      runAgentAssociationAtom(boardRunKey(teamId, "run-a")),
      (value) => {
        seen.push(value);
      },
      { immediate: true },
    );
    seen.length = 0;

    // A new session array with the same content must not reach run-a.
    registry.set(boardSessionsAtom, [
      sessionOf({ id: "session-1", runId: "run-b" }),
    ]);

    expect(seen).toEqual([]);
  });

  it("resolves the assigned worker, then the requested one", () => {
    const worker = (id: string): ExecutionWorker => ({ ...workerTemplate, id });
    const registry = createTestRegistry([
      [
        runsByIdAtom,
        new Map([
          [
            "run-a",
            runOf({ id: "run-a", workerId: "worker-1" }),
          ],
          [
            "run-b",
            runOf({ id: "run-b", requestedWorkerId: "worker-2" }),
          ],
          ["run-c", runOf({ id: "run-c", workerId: "worker-gone" })],
        ]),
      ],
      [
        workersByIdAtom,
        new Map([
          ["worker-1", worker("worker-1")],
          ["worker-2", worker("worker-2")],
        ]),
      ],
      [teamWorkerIdsAtom(teamId), ["worker-1", "worker-2"]],
    ]);

    expect(
      registry.get(runAssignedWorkerAtom(boardRunKey(teamId, "run-a")))?.id,
    ).toBe("worker-1");
    expect(
      registry.get(runAssignedWorkerAtom(boardRunKey(teamId, "run-b")))?.id,
    ).toBe("worker-2");
    expect(
      registry.get(runAssignedWorkerAtom(boardRunKey(teamId, "run-c"))),
    ).toBeNull();
  });

  it("resolves the assignee against the team's members", () => {
    const member: OrganizationMember = { ...memberTemplate, userId: "member-1" };
    const registry = createTestRegistry([
      [
        runsByIdAtom,
        new Map([
          ["run-a", runOf({ id: "run-a", assigneeUserId: "member-1" })],
          ["run-b", runOf({ id: "run-b", assigneeUserId: null })],
        ]),
      ],
      [membersByIdAtom, new Map([["member-1", member]])],
      [teamMemberIdsAtom(teamId), ["member-1"]],
    ]);

    expect(
      registry.get(runAssigneeAtom(boardRunKey(teamId, "run-a"))),
    ).toBe(member);
    expect(
      registry.get(runAssigneeAtom(boardRunKey(teamId, "run-b"))),
    ).toBeNull();
  });
});
