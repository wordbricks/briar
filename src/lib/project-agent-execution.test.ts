import { describe, expect, it, vi } from "vitest";
import type { DashboardPayload } from "../types";
import { executeProjectAgentTask } from "./project-agent-execution";

describe("executeProjectAgentTask", () => {
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

    await executeProjectAgentTask(
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
          responsibility: "Maintain releases.",
          skill: "# Release agent",
        },
        dashboard: {
          project: { id: "project-1" },
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
});
