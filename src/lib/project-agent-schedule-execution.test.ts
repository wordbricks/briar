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
    responsibility: "Fulfill the saved responsibility.",
    skill: "# Agent",
  },
  workflow: repositoryWorkflowBootstrap,
  status: "running",
  claimToken: `briar_schedule_claim_${"a".repeat(64)}`,
  scheduledFor: "2026-07-28T00:00:00.000Z",
  leaseExpiresAt: "2026-07-28T02:00:00.000Z",
  startedAt: "2026-07-28T00:00:01.000Z",
  completedAt: null,
  resultSummary: null,
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
    },
  ],
  generatedAt: "2026-07-28T00:00:00.000Z",
} as DashboardPayload;

const dependencies = (): ProjectAgentScheduleExecutionDependencies => ({
  loadDashboard: vi.fn(async () => dashboard),
  runAgent: vi.fn(async () => ({
    conversationId: "agent-conversation",
    action: "respond" as const,
    message: "Responsibility complete.",
    maxIssues: null,
    workspaceRoot: "/repo",
  })),
  startAutoHunt: vi.fn(async () => ({
    dispatchGroupId: "dispatch-1",
    conversationId: "coordinator-conversation",
    workspaceRoot: "/worktree",
    workers: [],
    result: {
      summary: "Auto Hunt complete.",
      issues: [],
    },
  })),
});

describe("scheduled project agent execution", () => {
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
      agent: scheduledRun().agent,
      message: [
        'Run the scheduled automation "Weekly Auto Hunt".',
        "It was scheduled for 2026-07-28T00:00:00.000Z.",
        "Fulfill your saved responsibility for this scheduled run:",
        "Fulfill the saved responsibility.",
      ].join("\n"),
      conversationId: null,
    });
    expect(current.loadDashboard).not.toHaveBeenCalled();
    expect(current.startAutoHunt).not.toHaveBeenCalled();
  });

  it("honors a dispatch decision from any scheduled Agent", async () => {
    const current = dependencies();
    vi.mocked(current.runAgent).mockResolvedValue({
      conversationId: "agent-conversation",
      action: "dispatch_auto_hunt",
      message: "Dispatch the queued work.",
      maxIssues: 3,
      workspaceRoot: "/repo",
    });

    await expect(
      executeScheduledProjectAgent(
        current,
        "token",
        scheduledRun("Any saved Agent"),
      ),
    ).resolves.toMatchObject({
      conversationId: "coordinator-conversation",
      message: "Auto Hunt complete.",
      workspaceRoot: "/worktree",
    });

    expect(current.startAutoHunt).toHaveBeenCalledWith(
      scheduledRun().projectId,
      dashboard.runs,
      expect.any(String),
      scheduledRun("Any saved Agent").agent,
      { coordinatorConversationId: "agent-conversation" },
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

    expect(current.loadDashboard).not.toHaveBeenCalled();
    expect(current.startAutoHunt).not.toHaveBeenCalled();
  });

  it("fails the schedule when the Agent requests dispatch with no queued work", async () => {
    const current = dependencies();
    vi.mocked(current.runAgent).mockResolvedValue({
      conversationId: "agent-conversation",
      action: "dispatch_auto_hunt",
      message: "Dispatch the queued work.",
      maxIssues: null,
      workspaceRoot: "/repo",
    });
    vi.mocked(current.loadDashboard).mockResolvedValue({
      ...dashboard,
      runs: [],
    });

    await expect(
      executeScheduledProjectAgent(current, "token", scheduledRun()),
    ).rejects.toThrow("대기 상태인 이슈가 없습니다.");

    expect(current.startAutoHunt).not.toHaveBeenCalled();
  });
});
