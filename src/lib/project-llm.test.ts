import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  chatWithProjectLlm,
  createProjectChat,
  loadAppProviderSettings,
  loadProjectLlmSettings,
  loadProjectSandboxSettings,
  runProjectAgent,
  stopProjectAgentSession,
  updateAppProviderSettings,
  updateProjectLlmSettings,
  updateProjectSandboxSettings,
} from "./project-llm";

describe("project LLM gateway", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });

  afterEach(() => vi.unstubAllGlobals());

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
        conversationId: null,
        instructions: "Be concise",
        outputSchema: { type: "string" },
      },
    });
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty("cwd");
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty("workspaceRoot");
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
        responsibility: "Handle release work.",
        skill: "# Release agent",
        message: "Auto Hunt로 대기 이슈 3개를 처리해 줘",
        conversationId: null,
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

  it("continues and serializes a project conversation", async () => {
    invoke
      .mockResolvedValueOnce({
        conversationId: "briar:project-1:thread-1",
        message: "first",
        workspaceRoot: "/repo",
      })
      .mockResolvedValueOnce({
        conversationId: "briar:project-1:thread-1",
        message: "second",
        workspaceRoot: "/repo",
      });
    const chat = createProjectChat("project-1");

    const first = chat.send("first question");
    const second = chat.send("follow-up question");

    await expect(first).resolves.toMatchObject({ message: "first" });
    await expect(second).resolves.toMatchObject({ message: "second" });
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      request: { conversationId: null },
    });
    expect(invoke.mock.calls[1]?.[1]).toMatchObject({
      request: { conversationId: "briar:project-1:thread-1" },
    });
    expect(chat.conversationId).toBe("briar:project-1:thread-1");
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
      .mockResolvedValueOnce({ codex: true, claude: true, grok: true })
      .mockResolvedValueOnce({ codex: false, claude: true, grok: true });

    await expect(loadAppProviderSettings()).resolves.toEqual({
      codex: true,
      claude: true,
      grok: true,
    });
    await expect(
      updateAppProviderSettings({ codex: false, claude: true, grok: true }),
    ).resolves.toEqual({ codex: false, claude: true, grok: true });

    expect(invoke).toHaveBeenNthCalledWith(1, "load_app_provider_settings");
    expect(invoke).toHaveBeenNthCalledWith(2, "update_app_provider_settings", {
      settings: { codex: false, claude: true, grok: true },
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
