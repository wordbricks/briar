import { describe, expect, it, vi } from "vitest";
import type {
  ClaimedProjectAgentScheduleRun,
  DashboardPayload,
} from "../types";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";
import {
  executeScheduledProjectAgent,
  type ProjectAgentScheduleExecutionDependencies,
} from "./project-agent-schedule-execution";

const scheduledRun = (
  name = "Repository agent",
): ClaimedProjectAgentScheduleRun => ({
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  scheduleId: "33333333-3333-4333-8333-333333333333",
  scheduleName: "Weekly Auto Hunt",
  agent: {
    id: "44444444-4444-4444-8444-444444444444",
    name,
    provider: "codex",
    model: null,
    effort: null,
    responsibility: "Fulfill the saved responsibility.",
    skill: "# Agent",
    skills: [],
  },
  workflow: repositoryWorkflowBootstrap,
  status: "running",
  claimToken: `briar_schedule_claim_${"a".repeat(64)}`,
  scheduledFor: "2026-07-28T00:00:00.000Z",
  leaseExpiresAt: "2026-07-28T02:00:00.000Z",
  startedAt: "2026-07-28T00:00:01.000Z",
  completedAt: null,
  resultSummary: null,
  structuredResult: null,
  error: null,
});

const dashboard = {
  project: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Briar",
    createdAt: "2026-07-28T00:00:00.000Z",
  },
  settings: {
    velenOrg: null,
    dataSource: null,
    linear: { enabled: false, source: null, teamKey: null },
    githubRepository: null,
    workflow: repositoryWorkflowBootstrap,
  },
  runs: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      runNumber: 1,
      sourceKey: "issue:1",
      title: "Queued issue",
      status: "queued",
      currentAttempt: 1,
      detail: null,
      resultSummary: null,
      updatedAt: "2026-07-28T00:00:00.000Z",
    },
  ],
  generatedAt: "2026-07-28T00:00:00.000Z",
} as DashboardPayload;

const dependencies = (): ProjectAgentScheduleExecutionDependencies => ({
  loadDashboard: vi.fn(async () => dashboard),
  retryRun: vi.fn(async () => ({
    outcome: "retried",
  })),
  runAgent: vi.fn(async () => ({
    conversationId: "agent-conversation",
    action: "respond" as const,
    message: "Responsibility complete.",
    maxIssues: null,
    workspaceRoot: "/repo",
    structuredResult: {
      summary: "Responsibility complete.",
      outcome: "completed",
      importance: "routine",
      urgency: "normal",
      impact: "issue",
      humanActionRequired: false,
      nextAction: null,
      dueAt: null,
    } as const,
  })),
  dispatchRun: vi.fn(async () => ({ outcome: "dispatched" })),
});

describe("scheduled project agent execution", () => {
  it("runs the Agent's default Skill with its own provider, model, and effort", async () => {
    const current = dependencies();
    const run = scheduledRun();
    run.agent.skills = [{
      id: "66666666-6666-4666-8666-666666666666",
      agentId: run.agent.id,
      name: "Desktop release",
      instructions: "Publish the signed desktop release.",
      provider: "claude",
      model: "claude-sonnet-4-5",
      effort: "high",
      kind: "custom",
      isDefault: true,
      position: 0,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    }];

    await executeScheduledProjectAgent(current, "token", run);

    expect(current.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          provider: "claude",
          model: "claude-sonnet-4-5",
          effort: "high",
          skill: expect.stringContaining("Desktop release (active)"),
        }),
        message: expect.stringContaining("Publish the signed desktop release."),
      }),
    );
  });

  it("runs a schedule through the same saved-Agent turn as a direct invocation", async () => {
    const current = dependencies();

    await expect(
      executeScheduledProjectAgent(current, "token", scheduledRun()),
    ).resolves.toMatchObject({
      conversationId: "agent-conversation",
      message: "Responsibility complete.",
      workspaceRoot: "/repo",
    });

    expect(current.runAgent).toHaveBeenCalledWith({
      projectId: scheduledRun().projectId,
      sessionId: expect.any(String),
      agent: scheduledRun().agent,
      message: [
        'Run the scheduled automation "Weekly Auto Hunt".',
        "It was scheduled for 2026-07-28T00:00:00.000Z.",
        "Fulfill your saved responsibility for this scheduled run:",
        "Fulfill the saved responsibility.",
      ].join("\n"),
      conversationId: null,
      runs: [],
    });
    expect(current.loadDashboard).toHaveBeenCalledOnce();
    expect(current.dispatchRun).not.toHaveBeenCalled();
  });

  it("records a scheduled Agent session from start through completion", async () => {
    const current = dependencies();
    current.startSession = vi.fn(() => "scheduled-session");
    current.settleSession = vi.fn();

    await executeScheduledProjectAgent(current, "token", scheduledRun());

    expect(current.startSession).toHaveBeenCalledWith(scheduledRun());
    expect(current.settleSession).toHaveBeenCalledWith("scheduled-session", {
      status: "completed",
      conversationId: "agent-conversation",
      workspaceRoot: "/repo",
      summary: "Responsibility complete.",
      error: null,
    });
  });

  it.each(["partial", "blocked", "failed"] as const)(
    "records a scheduled %s structured result as a failed session",
    async (outcome) => {
      const current = dependencies();
      current.startSession = vi.fn(() => "scheduled-session");
      current.settleSession = vi.fn();
      vi.mocked(current.runAgent).mockResolvedValue({
        conversationId: "agent-conversation",
        action: "respond",
        message: `Responsibility returned ${outcome}.`,
        maxIssues: null,
        workspaceRoot: "/repo",
        structuredResult: {
          summary: `Responsibility returned ${outcome}.`,
          outcome,
          importance: "important",
          urgency: "normal",
          impact: "project",
          humanActionRequired: outcome === "blocked",
          nextAction: outcome === "blocked" ? "Restore access." : null,
          dueAt: null,
        },
      });

      await executeScheduledProjectAgent(current, "token", scheduledRun());

      expect(current.settleSession).toHaveBeenCalledWith(
        "scheduled-session",
        expect.objectContaining({
          status: "failed",
          summary: `Responsibility returned ${outcome}.`,
        }),
      );
    },
  );

  it("records a failed scheduled Agent session before propagating the error", async () => {
    const current = dependencies();
    current.startSession = vi.fn(() => "scheduled-session");
    current.settleSession = vi.fn();
    vi.mocked(current.runAgent).mockRejectedValue(
      new Error("provider unavailable"),
    );

    await expect(
      executeScheduledProjectAgent(current, "token", scheduledRun()),
    ).rejects.toThrow("provider unavailable");

    expect(current.settleSession).toHaveBeenCalledWith("scheduled-session", {
      status: "failed",
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: "provider unavailable",
    });
  });

  it("honors a dispatch decision from any scheduled Agent", async () => {
    const current = dependencies();
    current.startSession = vi.fn(() => "scheduled-session");
    current.startWorkerDispatchSession = vi.fn();
    vi.mocked(current.runAgent).mockResolvedValue({
      conversationId: "agent-conversation",
      action: "dispatch_auto_hunt",
      message: "Dispatch the queued work.",
      maxIssues: 3,
      workspaceRoot: "/repo",
      structuredResult: null,
    });

    await expect(
      executeScheduledProjectAgent(
        current,
        "token",
        scheduledRun("Any saved Agent"),
      ),
    ).resolves.toMatchObject({
      conversationId: "agent-conversation",
      message: "1개 이슈를 등록 Worker에 배정했습니다.",
      workspaceRoot: "/repo",
    });

    expect(current.dispatchRun).toHaveBeenCalledWith(
      "token",
      scheduledRun().projectId,
      dashboard.runs[0],
      {
        agentId: scheduledRun().agent.id,
        provider: scheduledRun().agent.provider,
        model: null,
        effort: null,
        workerId: null,
        reassign: false,
      },
    );
    expect(current.startWorkerDispatchSession).toHaveBeenCalledWith(
      "scheduled-session",
      scheduledRun("Any saved Agent"),
      dashboard.runs,
      {
        dispatchId: expect.any(String),
        runIds: [dashboard.runs[0].id],
      },
    );
  });

  it("retries and dispatches the exact blocked run selected by the host tool", async () => {
    const blockedRun = {
      ...dashboard.runs[0],
      status: "blocked" as const,
      detail: "GitHub authentication is missing.",
    };
    const current = dependencies();
    vi.mocked(current.loadDashboard).mockResolvedValueOnce({
      ...dashboard,
      runs: [blockedRun],
    });
    vi.mocked(current.runAgent).mockResolvedValue({
      conversationId: "agent-conversation",
      action: "dispatch_auto_hunt",
      message: "Resume the recovered run.",
      maxIssues: 1,
      workspaceRoot: "/repo",
      structuredResult: null,
      targetRunIds: [blockedRun.id],
      retryReason: "GitHub authentication was restored.",
    });

    await executeScheduledProjectAgent(current, "token", scheduledRun());

    expect(current.retryRun).toHaveBeenCalledWith(
      "token",
      scheduledRun().projectId,
      blockedRun.id,
      "GitHub authentication was restored.",
    );
    expect(current.dispatchRun).toHaveBeenCalledWith(
      "token",
      scheduledRun().projectId,
      blockedRun,
      {
        agentId: scheduledRun().agent.id,
        provider: scheduledRun().agent.provider,
        model: null,
        effort: null,
        workerId: null,
        reassign: false,
      },
    );
  });

  it("does not infer dispatch from an Agent name or kind", async () => {
    const current = dependencies();

    await expect(
      executeScheduledProjectAgent(
        current,
        "token",
        scheduledRun("Auto Hunt agent"),
      ),
    ).resolves.toMatchObject({ message: "Responsibility complete." });

    expect(current.loadDashboard).toHaveBeenCalledOnce();
    expect(current.dispatchRun).not.toHaveBeenCalled();
  });

  it("skips the session when the Agent requests dispatch with no queued work", async () => {
    const current = dependencies();
    current.startSession = vi.fn(() => "scheduled-session");
    current.settleSession = vi.fn();
    current.startWorkerDispatchSession = vi.fn();
    vi.mocked(current.runAgent).mockResolvedValue({
      conversationId: "agent-conversation",
      action: "dispatch_auto_hunt",
      message: "Dispatch the queued work.",
      maxIssues: null,
      workspaceRoot: "/repo",
      structuredResult: null,
    });
    vi.mocked(current.loadDashboard).mockResolvedValue({
      ...dashboard,
      runs: [],
    });

    await expect(
      executeScheduledProjectAgent(current, "token", scheduledRun()),
    ).resolves.toMatchObject({
      conversationId: "agent-conversation",
      message: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
      structuredResult: {
        outcome: "completed",
        importance: "routine",
        humanActionRequired: false,
      },
    });

    expect(current.dispatchRun).not.toHaveBeenCalled();
    expect(current.startWorkerDispatchSession).not.toHaveBeenCalled();
    expect(current.settleSession).toHaveBeenCalledWith("scheduled-session", {
      status: "skipped",
      conversationId: "agent-conversation",
      workspaceRoot: "/repo",
      summary: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
      error: null,
    });
  });

  it("keeps a queued issue with unfinished prerequisites as a failure", async () => {
    const current = dependencies();
    vi.mocked(current.runAgent).mockResolvedValue({
      conversationId: "agent-conversation",
      action: "dispatch_auto_hunt",
      message: "Dispatch the queued work.",
      maxIssues: null,
      workspaceRoot: "/repo",
      structuredResult: null,
    });
    vi.mocked(current.loadDashboard).mockResolvedValue({
      ...dashboard,
      runs: [{
        ...dashboard.runs[0],
        executionReadiness: "waiting",
        waitingOnPrerequisiteCount: 1,
      }],
    });

    await expect(
      executeScheduledProjectAgent(current, "token", scheduledRun()),
    ).rejects.toThrow("대기 상태인 이슈가 없습니다.");
    expect(current.dispatchRun).not.toHaveBeenCalled();
  });
});
