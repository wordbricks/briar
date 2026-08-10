import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import {
  chatWithProjectLlm,
  loadAppProviderSettings,
  loadProjectLlmSettings,
  loadProjectSandboxSettings,
  projectAgentRunSnapshots,
  runProjectAgent,
  stopProjectAgentSession,
  updateAppProviderSettings,
  updateProjectLlmSettings,
  updateProjectSandboxSettings,
} from "./project-llm";

describe("project LLM gateway", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("bounds the saved-Agent host snapshot to blocked and failed runs", () => {
    const run = (index: number, status: string) => ({
      id: `run-${index}`,
      sourceKey: `BRIAR-${index}`,
      title: `Run ${index}`,
      status,
      currentAttempt: 1,
      detail: null,
      resultSummary: null,
      updatedAt: "2026-07-30T09:00:00.000Z",
    });
    const snapshots = projectAgentRunSnapshots([
      run(0, "queued"),
      ...Array.from({ length: 501 }, (_, index) => run(index + 1, "blocked")),
    ]);

    expect(snapshots).toHaveLength(500);
    expect(snapshots[0]).toMatchObject({
      runId: "run-1",
      status: "blocked",
    });
    expect(snapshots.at(-1)?.runId).toBe("run-500");
  });

  it("sends only a project id and model request to the native gateway", async () => {
    invoke.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      message: "summary",
      workspaceRoot: "/repo",
    });

    await chatWithProjectLlm({
      projectId: "project-1",
      message: "Summarize this project",
      instructions: "Be concise",
      outputSchema: { type: "string" },
    });

    expect(invoke).toHaveBeenCalledWith("project_llm_chat", {
      projectId: "project-1",
      fullAccess: false,
      workspaceMode: "connected",
      workspaceRunId: null,
      workspaceBranch: null,
      request: {
        message: "Summarize this project",
        progressId: null,
        conversationId: null,
        instructions: "Be concise",
        outputSchema: { type: "string" },
      },
    });
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty("cwd");
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty("workspaceRoot");
  });

  it("rolls provider message deltas into request-scoped progress updates", async () => {
    let progressHandler:
      | ((event: { payload: Record<string, unknown> }) => void)
      | undefined;
    const unlisten = vi.fn();
    listen.mockImplementation(async (_event, handler) => {
      progressHandler = handler;
      return unlisten;
    });
    invoke.mockImplementation(async (_command, args) => {
      const invocation = args as { request: { progressId: string } };
      progressHandler?.({
        payload: {
          requestId: "another-request",
          projectId: "project-1",
          provider: "codex",
          event: {
            type: "messageCompleted",
            id: "ignored",
            phase: "commentary",
            text: "ignore me",
          },
        },
      });
      progressHandler?.({
        payload: {
          requestId: invocation.request.progressId,
          projectId: "project-1",
          provider: "codex",
          event: {
            type: "activityStarted",
            id: "command-1",
            kind: "command",
            title: "git status",
            text: "",
          },
        },
      });
      progressHandler?.({
        payload: {
          requestId: invocation.request.progressId,
          projectId: "project-1",
          provider: "codex",
          event: {
            type: "activityDelta",
            id: "command-1",
            delta: "On branch main",
          },
        },
      });
      progressHandler?.({
        payload: {
          requestId: invocation.request.progressId,
          projectId: "project-1",
          provider: "codex",
          event: {
            type: "activityCompleted",
            id: "command-1",
            kind: "command",
            title: "git status",
            text: "On branch main",
            status: "completed",
          },
        },
      });
      progressHandler?.({
        payload: {
          requestId: invocation.request.progressId,
          projectId: "project-1",
          provider: "codex",
          event: {
            type: "messageStarted",
            id: "message-1",
            phase: "commentary",
            text: "저장소 구조를",
          },
        },
      });
      progressHandler?.({
        payload: {
          requestId: invocation.request.progressId,
          projectId: "project-1",
          provider: "codex",
          event: {
            type: "messageDelta",
            id: "message-1",
            delta: " 분석하고 있습니다.",
          },
        },
      });
      return {
        conversationId: "briar:project-1:thread-1",
        message: "{}",
        workspaceRoot: "/repo",
      };
    });
    const onProgress = vi.fn();

    await chatWithProjectLlm({
      projectId: "project-1",
      message: "Analyze",
      onProgress,
    });

    expect(listen).toHaveBeenCalledWith(
      "project-llm-progress",
      expect.any(Function),
    );
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      provider: "codex",
      messageId: "message-1",
      phase: "commentary",
      message: "저장소 구조를",
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      provider: "codex",
      messageId: "message-1",
      phase: "commentary",
      message: "저장소 구조를 분석하고 있습니다.",
    });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("forwards explicit unrestricted access to the native gateway", async () => {
    invoke.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      message: "done",
      workspaceRoot: "/repo",
    });

    await chatWithProjectLlm({
      projectId: "project-1",
      message: "Fix the issue",
      fullAccess: true,
    });

    expect(invoke).toHaveBeenCalledWith(
      "project_llm_chat",
      expect.objectContaining({ fullAccess: true }),
    );
  });

  it("runs a saved agent turn that may request host Auto Hunt dispatch", async () => {
    invoke.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      workspaceRoot: "/repo",
      action: "dispatch_auto_hunt",
      message: "대기 이슈 처리를 요청했습니다.",
      maxIssues: 3,
    });

    await runProjectAgent({
      projectId: "project-1",
      sessionId: "session-1",
      agent: {
        id: "agent-1",
        name: "Release agent",
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        responsibility: "Handle release work.",
        skill: "# Release agent",
      },
      message: "Auto Hunt로 대기 이슈 3개를 처리해 줘",
      conversationId: null,
    });

    expect(invoke).toHaveBeenCalledWith("run_project_agent", {
      projectId: "project-1",
      request: {
        sessionId: "session-1",
        agentId: "agent-1",
        agentName: "Release agent",
        agentProvider: "codex",
        agentModel: "gpt-5.6-sol",
        agentEffort: "high",
        responsibility: "Handle release work.",
        skill: "# Release agent",
        message: "Auto Hunt로 대기 이슈 3개를 처리해 줘",
        conversationId: null,
        runs: [],
        resumeAfterUpdate: false,
      },
    });
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty("workspaceRoot");
  });

  it("requests interruption for one native agent session", async () => {
    invoke.mockResolvedValue(true);

    await expect(stopProjectAgentSession("session-1")).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith("stop_project_agent_session", {
      sessionId: "session-1",
    });
  });

  it("routes issue conversations by run and registered branch", async () => {
    invoke.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      message: "done",
      workspaceRoot: "/worktrees/issue-run-1",
    });

    await chatWithProjectLlm({
      projectId: "project-1",
      message: "Explain the completed work",
      workspaceMode: "issueWorktree",
      workspaceRunId: "11111111-2222-3333-4444-555555555555",
      workspaceBranch: "briar/issue-run-11111111",
    });

    expect(invoke).toHaveBeenCalledWith(
      "project_llm_chat",
      expect.objectContaining({
        workspaceMode: "issueWorktree",
        workspaceRunId: "11111111-2222-3333-4444-555555555555",
        workspaceBranch: "briar/issue-run-11111111",
      }),
    );
  });

  it("routes durable issue context without requiring a surviving worktree", async () => {
    invoke.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      message: "Urgency is normal.",
      workspaceRoot: "/latest-remote-base",
    });

    await chatWithProjectLlm({
      projectId: "project-1",
      message: "What is the urgency?",
      workspaceMode: "issueContext",
      workspaceRunId: "11111111-2222-3333-4444-555555555555",
      workspaceBranch: null,
    });

    expect(invoke).toHaveBeenCalledWith(
      "project_llm_chat",
      expect.objectContaining({
        workspaceMode: "issueContext",
        workspaceRunId: "11111111-2222-3333-4444-555555555555",
        workspaceBranch: null,
      }),
    );
  });

  it("loads and updates the project approval policy", async () => {
    invoke
      .mockResolvedValueOnce({
        provider: "codex",
        model: null,
        effort: null,
        approvalPolicy: "never",
      })
      .mockResolvedValueOnce({
        provider: "claude",
        model: "sonnet",
        effort: "high",
        approvalPolicy: "on-request",
      });

    await expect(loadProjectLlmSettings("project-1")).resolves.toEqual({
      provider: "codex",
      model: null,
      effort: null,
      approvalPolicy: "never",
    });
    await expect(
      updateProjectLlmSettings("project-1", {
        provider: "claude",
        model: "sonnet",
        effort: "high",
        approvalPolicy: "on-request",
      }),
    ).resolves.toEqual({
      provider: "claude",
      model: "sonnet",
      effort: "high",
      approvalPolicy: "on-request",
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "load_project_llm_settings", {
      projectId: "project-1",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "update_project_llm_settings", {
      projectId: "project-1",
      settings: {
        provider: "claude",
        model: "sonnet",
        effort: "high",
        approvalPolicy: "on-request",
      },
    });
  });

  it("loads and updates app-wide provider enablement", async () => {
    invoke
      .mockResolvedValueOnce({ codex: true, claude: true, grok: true, opencode: true })
      .mockResolvedValueOnce({ codex: false, claude: true, grok: true, opencode: true });

    await expect(loadAppProviderSettings()).resolves.toEqual({
      codex: true,
      claude: true,
      grok: true,
      opencode: true,
    });
    await expect(
      updateAppProviderSettings({ codex: false, claude: true, grok: true, opencode: true }),
    ).resolves.toEqual({ codex: false, claude: true, grok: true, opencode: true });

    expect(invoke).toHaveBeenNthCalledWith(1, "load_app_provider_settings");
    expect(invoke).toHaveBeenNthCalledWith(2, "update_app_provider_settings", {
      settings: { codex: false, claude: true, grok: true, opencode: true },
    });
  });

  it("loads and updates the project Auto Hunt filesystem access", async () => {
    invoke
      .mockResolvedValueOnce({ fullAccess: true })
      .mockResolvedValueOnce({ fullAccess: false });

    await expect(loadProjectSandboxSettings("project-1")).resolves.toEqual({
      fullAccess: true,
    });
    await expect(
      updateProjectSandboxSettings("project-1", { fullAccess: false }),
    ).resolves.toEqual({ fullAccess: false });

    expect(invoke).toHaveBeenNthCalledWith(1, "load_project_sandbox_settings", {
      projectId: "project-1",
    });
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "update_project_sandbox_settings",
      {
        projectId: "project-1",
        settings: { fullAccess: false },
      },
    );
  });
});
