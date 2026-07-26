import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  chatWithProjectLlm,
  createProjectChat,
  loadAppProviderSettings,
  loadProjectLlmSettings,
  updateAppProviderSettings,
  updateProjectLlmSettings,
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
});
