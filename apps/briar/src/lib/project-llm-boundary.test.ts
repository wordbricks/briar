import { describe, expect, it } from "vitest";
import {
  projectAgentRunInvocation,
  projectLlmChatInvocation,
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

    const invocation = projectLlmChatInvocation(input, null);

    expect(invocation).toEqual({
      command: "project_llm_chat",
      payload: {
        projectId: "project-1",
        fullAccess: false,
        workspaceMode: "issueWorktree",
        workspaceRunId: "run-1",
        workspaceBranch: "auto-hunt/run-1",
        request: {
          message: "Review the failed run",
          progressId: null,
          conversationId: null,
          instructions: null,
          outputSchema: null,
        },
      },
    });
    expect(invocation.payload).not.toHaveProperty("cwd");
    expect(invocation.payload).not.toHaveProperty("workspaceRoot");
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

    const invocation = projectAgentRunInvocation(input);

    expect(invocation.command).toBe("run_project_agent");
    expect(invocation.payload).toMatchObject({
      projectId: "project-1",
      request: {
        sessionId: "session-1",
        agentId: "agent-1",
        message: "Validate the release",
        runs: [],
        resumeAfterUpdate: false,
      },
    });
    expect(invocation.payload).not.toHaveProperty("workspaceRoot");
    expect(invocation.payload.request).not.toHaveProperty("workspaceRoot");
  });
});
