import { describe, expect, it, vi } from "vitest";
import type { DashboardPayload } from "../types";
import { executeTeamAgentTask } from "./team-agent-execution";

describe("executeTeamAgentTask", () => {
  it("resumes a planned-update task in the same provider conversation", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      conversationId: "briar:claude:project-1:conversation-1",
      workspaceRoot: "/repo",
      action: "respond",
      message: "Finished after the update.",
      maxIssues: null,
      structuredResult: {
        summary: "Finished after the update.",
        outcome: "completed",
        importance: "routine",
        urgency: "normal",
        impact: "project",
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      },
    });
    const settleSession = vi.fn();

    await executeTeamAgentTask(
      {
        runAgent,
        startSession: vi.fn(),
        settleSession,
        startAutoHunt: vi.fn(),
      },
      {
        agent: {
          id: "agent-1",
          name: "Release agent",
          provider: "claude",
          model: "sonnet",
          effort: null,
          responsibility: "Maintain releases.",
          skill: "# Release agent",
        },
        dashboard: {
          team: { id: "project-1" },
          runs: [],
        } as unknown as DashboardPayload,
        message: "Prepare the release.",
        sessionId: "session-1",
        conversationId: "briar:claude:project-1:conversation-1",
        recoveringAfterUpdate: true,
      },
    );

    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      conversationId: "briar:claude:project-1:conversation-1",
      resumeAfterUpdate: true,
      message: expect.stringContaining("Original request:\nPrepare the release."),
    }));
    expect(settleSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        status: "completed",
        conversationId: "briar:claude:project-1:conversation-1",
      }),
    );
  });

  it.each(["partial", "blocked", "failed"] as const)(
    "records a %s structured result as a failed session",
    async (outcome) => {
      const settleSession = vi.fn();
      await executeTeamAgentTask(
        {
          runAgent: vi.fn().mockResolvedValue({
            conversationId: "briar:project-1:conversation-1",
            workspaceRoot: "/repo",
            action: "respond",
            message: `Agent returned ${outcome}.`,
            maxIssues: null,
            structuredResult: {
              summary: `Agent returned ${outcome}.`,
              outcome,
              importance: "important",
              urgency: "normal",
              impact: "project",
              humanActionRequired: outcome === "blocked",
              nextAction: outcome === "blocked" ? "Restore access." : null,
              dueAt: null,
            },
          }),
          startSession: vi.fn(),
          settleSession,
          startAutoHunt: vi.fn(),
        },
        {
          agent: {
            id: "agent-1",
            name: "Release agent",
            provider: "codex",
            model: null,
            effort: null,
            responsibility: "Publish releases.",
            skill: "# Release agent",
          },
          dashboard: {
            team: { id: "project-1" },
            runs: [],
          } as unknown as DashboardPayload,
          message: "Publish the release.",
          sessionId: "session-1",
        },
      );

      expect(settleSession).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          status: "failed",
          summary: `Agent returned ${outcome}.`,
        }),
      );
    },
  );

  it("continues an existing task session and preserves its conversation on failure", async () => {
    const startSession = vi.fn();
    const settleSession = vi.fn();
    await expect(executeTeamAgentTask(
      {
        runAgent: vi.fn().mockRejectedValue(new Error("provider unavailable")),
        startSession,
        settleSession,
        startAutoHunt: vi.fn(),
      },
      {
        agent: {
          id: "agent-1",
          name: "Release agent",
          provider: "codex",
          model: null,
          effort: null,
          responsibility: "Publish releases.",
          skill: "# Release agent",
        },
        dashboard: {
          team: { id: "project-1" },
          runs: [],
        } as unknown as DashboardPayload,
        message: "Retry the upload.",
        sessionId: "session-1",
        conversationId: "briar:project-1:thread-1",
        workspaceRoot: "/repo",
        isFollowUp: true,
      },
    )).rejects.toThrow("provider unavailable");

    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      request: "Retry the upload.",
      isFollowUp: true,
    }));
    expect(settleSession).toHaveBeenCalledWith("session-1", expect.objectContaining({
      status: "failed",
      conversationId: "briar:project-1:thread-1",
      workspaceRoot: "/repo",
    }));
  });
});
