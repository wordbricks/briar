import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type {
  CreateIssueInput,
  DashboardPayload,
  HuntRun,
  IssueMessage,
  PlanningProject,
  Project,
  SessionUser,
} from "../../types";
import { runAtom, teamRunIdsAtom } from "../entities/runs";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { planningProjectsAtom } from "../planning/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { issueMessagesAtom, runEventsAtom } from "../run-detail/atoms";
import { sessionErrorAtom, tokenAtom, userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { teamSyncApiAtom } from "../sync/loader";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  createIssueActions,
  type IssueActionApi,
  type IssueActions,
} from "./actions";
import { pendingIssueMutationAtom, recoveryErrorAtom } from "./atoms";

const teamId = "team-a";
const otherTeamId = "team-b";

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
});

const planningProjectOf = (id: string, team: string): PlanningProject =>
  ({
    ...demoDashboard.team,
    id,
    teamId: team,
    name: id,
    isDefault: true,
  }) as unknown as PlanningProject;

const runOf = (id: string, overrides: Partial<HuntRun> = {}): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  title: id,
  teamId,
  updatedAt: "2026-09-01T00:00:00.000Z",
  prerequisites: [],
  dependents: [],
  subIssues: [],
  relatedIssues: [],
  parent: null,
  ...overrides,
});

const snapshotOf = (runs: HuntRun[]): DashboardPayload => ({
  ...demoDashboard,
  team: teamOf(teamId),
  runs,
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const messageOf = (
  id: string,
  runId: string,
  overrides: Partial<IssueMessage> = {},
): IssueMessage => ({
  id,
  runId,
  parentMessageId: null,
  body: id,
  attachments: [],
  author: { id: user.id, name: user.name, image: null, provider: null },
  replyCount: 0,
  proposedAction: null,
  executionProposal: null,
  skillExecutionProposal: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

/** In-memory stand-in for the issue and run RPCs the actions call. */
class IssueServer {
  readonly calls: string[] = [];
  /** Payload the dashboard loader answers a `snapshot` refresh with. */
  snapshot: DashboardPayload = snapshotOf([]);
  failWith: Error | null = null;
  readonly resumeRequestIds: string[] = [];

  private guard(call: string) {
    this.calls.push(call);
    if (this.failWith) throw this.failWith;
  }

  readonly api: Partial<IssueActionApi> = {
    createIssue: async (_token, target, input) => {
      this.guard(`createIssue:${target.teamId}:${target.planningProjectId}`);
      return {
        runId: "created-run",
        sourceKey: "briar-issue:created",
        stage: "queued" as const,
        status: input.status,
      } as never;
    },
    deleteIssue: async (_token, projectId, runId) => {
      this.guard(`deleteIssue:${projectId}:${runId}`);
    },
    transferIssue: async (_token, projectId, runId, targetProjectId) => {
      this.guard(`transferIssue:${projectId}:${runId}:${targetProjectId}`);
      return { runId, targetProjectId } as never;
    },
    updateIssueSubscription: async (_token, projectId, runId, subscribed) => {
      this.guard(`subscription:${projectId}:${runId}:${subscribed}`);
      return {
        runId,
        subscribers: subscribed
          ? [{ userId: user.id, subscribedAt: "2026-09-02T00:00:00.000Z" }]
          : [],
      };
    },
    retryHuntRun: async (_token, projectId, runId) => {
      this.guard(`retry:${projectId}:${runId}`);
      return { runId } as never;
    },
    cancelHuntRun: async (_token, projectId, runId) => {
      this.guard(`cancel:${projectId}:${runId}`);
      return { runId } as never;
    },
    unassignHuntRun: async (_token, projectId, runId) => {
      this.guard(`unassign:${projectId}:${runId}`);
      return { runId, outcome: "unassigned" as const };
    },
    resumeHuntRun: async (_token, projectId, runId, _checkpoint, requestId) => {
      this.resumeRequestIds.push(requestId ?? "");
      this.guard(`resume:${projectId}:${runId}`);
      return { runId } as never;
    },
    acceptIssueActionProposal: async (_token, projectId, runId, proposalId) => {
      this.guard(`acceptAction:${projectId}:${runId}:${proposalId}`);
      return {
        proposal: { id: proposalId, type: "update_issue", status: "accepted" },
      } as never;
    },
  };
}

interface Harness {
  readonly actions: IssueActions;
  readonly registry: AtomRegistry;
  readonly server: IssueServer;
}

const harness = (
  options: {
    runs?: HuntRun[];
    token?: string | null;
    demoMode?: boolean;
    loaded?: boolean;
  } = {},
): Harness => {
  const registry = createTestRegistry();
  const server = new IssueServer();
  registry.set(teamsAtom, [teamOf(teamId), teamOf(otherTeamId)]);
  registry.set(planningProjectsAtom, [
    planningProjectOf("plan-a", teamId),
    planningProjectOf("plan-b", otherTeamId),
  ]);
  registry.set(activeTeamIdAtom, teamId);
  registry.set(userAtom, user);
  registry.set(tokenAtom, options.token === undefined ? "token" : options.token);
  registry.set(teamSyncApiAtom, {
    loadDashboard: (async () => server.snapshot) as never,
    loadDashboardDelta: (async () => {
      throw new Error("unexpected delta");
    }) as never,
  });
  if (options.loaded !== false) {
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId,
      payload: snapshotOf(options.runs ?? []),
    });
  }
  const actions = createIssueActions(registry, {
    api: server.api,
    demoMode: options.demoMode ?? false,
  });
  return { actions, registry, server };
};

describe("guards", () => {
  it("refuses every board write while no dashboard is loaded", async () => {
    const { actions } = harness({ loaded: false });
    await expect(actions.editIssue("run-1", {} as never)).rejects.toThrow(
      "이슈를 수정할 프로젝트가 없습니다.",
    );
    await expect(actions.removeIssue("run-1")).rejects.toThrow(
      "이슈를 삭제할 프로젝트가 없습니다.",
    );
    await expect(actions.recoverRun("run-1", "retry")).rejects.toThrow(
      "복구할 이슈 처리 작업이 없습니다.",
    );
  });

  it("refuses a signed-out write and reports it as a session error", async () => {
    const { actions, registry } = harness({
      runs: [runOf("run-1")],
      token: null,
    });
    await expect(actions.removeIssue("run-1")).rejects.toThrow(
      "로그인이 필요합니다.",
    );
    expect(registry.get(sessionErrorAtom)).toBe("로그인이 필요합니다.");
    expect(registry.get(pendingIssueMutationAtom)).toBeNull();
  });

  it("refuses to transfer an issue into the team it is already in", async () => {
    const { actions } = harness({ runs: [runOf("run-1")] });
    await expect(actions.transferIssue("run-1", teamId)).rejects.toThrow(
      "같은 프로젝트로는 옮길 수 없습니다.",
    );
  });
});

describe("pending mutation", () => {
  it("marks the mutation in flight and clears it when it settles", async () => {
    const { actions, registry } = harness({ runs: [runOf("run-1")] });
    const seen: unknown[] = [];
    const unsubscribe = registry.subscribe(pendingIssueMutationAtom, (value) => {
      seen.push(value);
    });

    await actions.removeIssue("run-1");

    expect(seen).toEqual([{ kind: "deleting", runId: "run-1" }, null]);
    unsubscribe();
  });

  it("leaves a later mutation's marker alone when an earlier one settles", async () => {
    const { actions, registry } = harness({ runs: [runOf("run-1")] });
    const removal = actions.removeIssue("run-1");
    registry.set(pendingIssueMutationAtom, {
      kind: "updating",
      runId: "run-2",
    });
    await removal;
    expect(registry.get(pendingIssueMutationAtom)).toEqual({
      kind: "updating",
      runId: "run-2",
    });
  });
});

describe("removeIssue", () => {
  it("drops the run, strips links to it and forgets its detail", async () => {
    const linked = runOf("run-2", {
      prerequisites: [
        { id: "run-1", runNumber: 1, title: "run-1", status: "queued" },
      ],
      parent: { id: "run-1", runNumber: 1, title: "run-1", status: "queued" },
    });
    const untouched = runOf("run-3");
    const { actions, registry, server } = harness({
      runs: [runOf("run-1"), linked, untouched],
    });
    registry.set(issueMessagesAtom("run-1"), [messageOf("m-1", "run-1")]);
    const before = registry.get(runAtom("run-3"));

    await actions.removeIssue("run-1");

    expect(server.calls).toEqual([`deleteIssue:${teamId}:run-1`]);
    expect(registry.get(teamRunIdsAtom(teamId))).toEqual(["run-2", "run-3"]);
    expect(registry.get(runAtom("run-1"))).toBeNull();
    expect(registry.get(runAtom("run-2"))?.prerequisites).toEqual([]);
    expect(registry.get(runAtom("run-2"))?.parent).toBeNull();
    // A run that never referenced the deleted one keeps its identity, so the
    // row rendering it does not re-render.
    expect(registry.get(runAtom("run-3"))).toBe(before);
    expect(registry.get(issueMessagesAtom("run-1"))).toEqual([]);
  });

  it("notifies a run's subscribers once", async () => {
    const { actions, registry } = harness({
      runs: [runOf("run-1"), runOf("run-2")],
    });
    let notifications = 0;
    const unsubscribe = registry.subscribe(teamRunIdsAtom(teamId), () => {
      notifications += 1;
    });
    await actions.removeIssue("run-1");
    expect(notifications).toBe(1);
    unsubscribe();
  });
});

describe("editIssueSubscription", () => {
  it("writes the subscribers the server confirmed onto the run", async () => {
    const { actions, registry } = harness({ runs: [runOf("run-1")] });
    await actions.editIssueSubscription("run-1", true);
    expect(registry.get(runAtom("run-1"))?.subscribers).toEqual([
      { userId: user.id, subscribedAt: "2026-09-02T00:00:00.000Z" },
    ]);
  });

  it("keeps the assignee subscribed in demo mode", async () => {
    const { actions } = harness({
      demoMode: true,
      token: null,
      runs: [runOf("run-1", { assigneeUserId: user.id })],
    });
    await expect(
      actions.editIssueSubscription("run-1", false),
    ).rejects.toThrow("담당자는 이슈 구독을 해제할 수 없습니다.");
  });

  it("subscribes locally in demo mode without a server call", async () => {
    const { actions, registry, server } = harness({
      demoMode: true,
      token: null,
      runs: [runOf("run-1", { assigneeUserId: "someone-else", subscribers: [] })],
    });
    await actions.editIssueSubscription("run-1", true);
    expect(registry.get(runAtom("run-1"))?.subscribers).toHaveLength(1);
    expect(server.calls).toEqual([]);
  });
});

describe("recoverRun", () => {
  it("refreshes the board after the server accepted the retry", async () => {
    const { actions, registry, server } = harness({ runs: [runOf("run-1")] });
    server.snapshot = snapshotOf([runOf("run-1", { status: "queued" })]);
    await actions.recoverRun("run-1", "retry");
    expect(server.calls).toEqual([`retry:${teamId}:run-1`]);
    expect(registry.get(runAtom("run-1"))?.status).toBe("queued");
  });

  it("records the failure as a recovery error, not a session error", async () => {
    const { actions, registry, server } = harness({ runs: [runOf("run-1")] });
    server.failWith = new Error("서버가 거절했습니다.");
    await expect(actions.recoverRun("run-1", "cancel")).rejects.toThrow(
      "서버가 거절했습니다.",
    );
    expect(registry.get(recoveryErrorAtom)).toBe("서버가 거절했습니다.");
    expect(registry.get(sessionErrorAtom)).toBeNull();
  });

  it("cancels the run locally in demo mode and records the event", async () => {
    const { actions, registry, server } = harness({
      demoMode: true,
      token: null,
      runs: [runOf("run-1")],
    });
    await actions.recoverRun("run-1", "cancel");
    expect(registry.get(runAtom("run-1"))?.status).toBe("cancelled");
    expect(registry.get(runEventsAtom("run-1"))).toHaveLength(1);
    expect(server.calls).toEqual([]);
  });
});

describe("resumeRun", () => {
  it("reuses one request id when the first attempt failed", async () => {
    const checkpoint = { key: "stage:1", attempt: 1, revision: 1 };
    const { actions, server } = harness({
      runs: [runOf("run-1", { checkpoint } as Partial<HuntRun>)],
    });
    server.failWith = new Error("네트워크 오류");
    await expect(actions.resumeRun("run-1")).rejects.toThrow("네트워크 오류");
    server.failWith = null;
    await actions.resumeRun("run-1");
    expect(server.resumeRequestIds).toHaveLength(2);
    expect(server.resumeRequestIds[0]).toBe(server.resumeRequestIds[1]);
  });

  it("refuses to resume a run with no checkpoint", async () => {
    const { actions } = harness({ runs: [runOf("run-1")] });
    await expect(actions.resumeRun("run-1")).rejects.toThrow(
      "이 앱 버전에서는 현재 대기 지점을 안전하게 확인할 수 없습니다. 새로고침하거나 앱을 업데이트해 주세요.",
    );
  });
});

describe("addIssue", () => {
  it("refreshes in place when the issue belongs to the selected team", async () => {
    const { actions, registry, server } = harness();
    const result = await actions.addIssue("plan-a", {
      title: "새 이슈",
      description: "",
      status: "queued",
      attachments: [],
    } as unknown as CreateIssueInput);
    expect(result.runId).toBe("created-run");
    expect(server.calls[0]).toBe(`createIssue:${teamId}:plan-a`);
    expect(registry.get(activeTeamIdAtom)).toBe(teamId);
  });

  it("switches teams when the issue belongs to another one", async () => {
    const { actions, registry } = harness();
    await actions.addIssue("plan-b", {
      title: "다른 팀",
      description: "",
      status: "queued",
      attachments: [],
    } as unknown as CreateIssueInput);
    expect(registry.get(activeTeamIdAtom)).toBe(otherTeamId);
  });

  it("creates the run locally in demo mode", async () => {
    const { actions, registry, server } = harness({
      demoMode: true,
      token: null,
    });
    const result = await actions.addIssue("plan-a", {
      title: " 데모 이슈 ",
      description: "",
      status: "backlog",
      attachments: [],
    } as unknown as CreateIssueInput);
    expect(server.calls).toEqual([]);
    expect(registry.get(teamRunIdsAtom(teamId))).toEqual([result.runId]);
    expect(registry.get(runAtom(result.runId))?.title).toBe("데모 이슈");
    expect(registry.get(runEventsAtom(result.runId))).toHaveLength(1);
    expect(registry.get(activeOrganizationIdAtom)).toBe(
      teamOf(teamId).organizationId,
    );
  });
});

describe("conversation proposals", () => {
  it("rewrites the message carrying the accepted proposal", async () => {
    const { actions, registry } = harness({ runs: [runOf("run-1")] });
    registry.set(issueMessagesAtom("run-1"), [
      messageOf("m-1", "run-1", {
        proposedAction: { id: "p-1", type: "update_issue" } as never,
      }),
      messageOf("m-2", "run-1"),
    ]);

    await actions.acceptConversationIssueAction("run-1", {
      id: "p-1",
      type: "update_issue",
    } as never);

    const messages = registry.get(issueMessagesAtom("run-1"));
    expect(messages[0]?.proposedAction).toEqual({
      id: "p-1",
      type: "update_issue",
      status: "accepted",
    });
    expect(messages[1]?.proposedAction).toBeNull();
  });
});

describe("unassignRun", () => {
  it("unassigns through the server and catches the board up", async () => {
    const { actions, server } = harness({ runs: [runOf("run-1")] });
    await actions.unassignRun(teamId, "run-1");
    expect(server.calls).toEqual([`unassign:${teamId}:run-1`]);
  });

  it("refuses without a token", async () => {
    const { actions } = harness({ token: null });
    await expect(actions.unassignRun(teamId, "run-1")).rejects.toThrow(
      "로그인이 필요합니다.",
    );
  });
});
