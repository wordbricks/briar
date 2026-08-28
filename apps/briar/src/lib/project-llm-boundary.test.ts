import { describe, expect, it } from "vitest";
import {
  projectAgentRunRequest,
  projectLlmChatRequest,
  type ProjectAgentRunInput,
  type ProjectLlmChatInput,
} from "./project-llm";

describe("project native gateway boundary", () => {
  it("passes issue identity without forwarding caller-controlled paths", () => {
    const input = Object.assign(
      {
        projectId: "project-1",
        message: "Review the failed run",
        workspaceMode: "issueWorktree" as const,
        workspaceRunId: "run-1",
        workspaceBranch: "auto-hunt/run-1",
      },
      {
        cwd: "/untrusted/repository",
        workspaceRoot: "/untrusted/repository",
      },
    ) satisfies ProjectLlmChatInput & {
      cwd: string;
      workspaceRoot: string;
    };

    const request = projectLlmChatRequest(input, null);

    expect(request).toEqual({
      message: "Review the failed run",
      progressId: null,
      conversationId: null,
      instructions: null,
      outputSchema: null,
    });
    expect(request).not.toHaveProperty("cwd");
    expect(request).not.toHaveProperty("workspaceRoot");
  });

  it("sends saved-Agent identity and context without a filesystem override", () => {
    const input = Object.assign(
      {
        projectId: "project-1",
        sessionId: "session-1",
        agent: {
          id: "agent-1",
          name: "Release Agent",
          provider: "codex" as const,
          model: null,
          effort: null,
          responsibility: "Validate releases",
          skill: "release",
        },
        message: "Validate the release",
      },
      { workspaceRoot: "/untrusted/repository" },
    ) satisfies ProjectAgentRunInput & { workspaceRoot: string };

    const request = projectAgentRunRequest(input);

    expect(request).toMatchObject({
      sessionId: "session-1",
      agentId: "agent-1",
      message: "Validate the release",
      runs: [],
      resumeAfterUpdate: false,
    });
    expect(request).not.toHaveProperty("workspaceRoot");
  });
});
