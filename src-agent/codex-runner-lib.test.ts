import { describe, expect, it } from "vitest";
import {
  codexAppServerArgs,
  codexApprovalRequest,
  codexConfigReadRequest,
  codexFinalMessage,
  codexInitializeRequest,
  codexModelListRequest,
  codexServerRequestResponse,
  codexThreadRequest,
  codexTurnRequest,
  consumeCodexAppServerMessage,
  createCodexAppServerState,
  normalizeCodexAppServerMessage,
  type CodexRunnerRequest,
} from "./codex-runner-lib";

const request: CodexRunnerRequest = {
  type: "run",
  message: "Inspect the repository",
  workspaceRoot: "/worktree",
  instructions: "Use the Briar workflow.",
  outputSchema: null,
  model: "gpt-5",
  effort: "high",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  codexBinary: "/usr/local/bin/codex",
};

describe("Codex App Server runner", () => {
  it("uses the desktop App Server command and sandbox requests", () => {
    expect(codexAppServerArgs(request)).toEqual([
      "app-server",
      "--listen",
      "stdio://",
      "--config",
      "sandbox_workspace_write.network_access=true",
    ]);
    expect(codexAppServerArgs({ networkAccess: false })).toEqual([
      "app-server",
      "--listen",
      "stdio://",
    ]);
    expect(codexInitializeRequest()).toMatchObject({
      method: "initialize",
      id: 1,
      params: { clientInfo: { name: "briar", title: "Briar" } },
    });
    expect(codexThreadRequest(request)).toMatchObject({
      method: "thread/start",
      id: 4,
      params: {
        cwd: "/worktree",
        sandbox: "workspace-write",
        approvalPolicy: "never",
        developerInstructions: "Use the Briar workflow.",
      },
    });
    expect(codexTurnRequest(request, "thread-1")).toMatchObject({
      method: "turn/start",
      id: 5,
      params: {
        threadId: "thread-1",
        cwd: "/worktree",
        model: "gpt-5",
        effort: "high",
      },
    });
    expect(codexConfigReadRequest(request)).toEqual({
      method: "config/read",
      id: 2,
      params: { cwd: "/worktree", includeLayers: false },
    });
    expect(codexModelListRequest()).toEqual({
      method: "model/list",
      id: 3,
      params: { includeHidden: false },
    });
  });

  it("maps App Server messages to the shared Agent event contract", () => {
    expect(
      normalizeCodexAppServerMessage({
        method: "item/started",
        params: {
          item: {
            id: "message-1",
            type: "agentMessage",
            phase: "commentary",
            text: "Working",
          },
        },
      }),
    ).toEqual({
      type: "messageStarted",
      id: "message-1",
      phase: "commentary",
      text: "Working",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/agentMessage/delta",
        params: { itemId: "message-1", delta: " more" },
      }),
    ).toEqual({ type: "messageDelta", id: "message-1", delta: " more" });
    expect(
      normalizeCodexAppServerMessage({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      }),
    ).toEqual({ type: "turnCompleted", status: "completed" });
  });

  it("normalizes command activity output and terminal outcomes", () => {
    expect(
      normalizeCodexAppServerMessage({
        method: "item/started",
        params: {
          item: {
            id: "command-1",
            type: "commandExecution",
            command: "bun test",
            status: "inProgress",
            aggregatedOutput: null,
            exitCode: null,
          },
        },
      }),
    ).toEqual({
      type: "activityStarted",
      id: "command-1",
      kind: "command",
      title: "bun test",
      text: "",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/commandExecution/outputDelta",
        params: { itemId: "command-1", delta: "PASS first suite\n" },
      }),
    ).toEqual({
      type: "activityDelta",
      id: "command-1",
      delta: "PASS first suite\n",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/completed",
        params: {
          item: {
            id: "command-1",
            type: "commandExecution",
            command: "bun test",
            status: "completed",
            aggregatedOutput: "PASS first suite\nPASS second suite\n",
            exitCode: 0,
          },
        },
      }),
    ).toEqual({
      type: "activityCompleted",
      id: "command-1",
      kind: "command",
      title: "bun test",
      text: "PASS first suite\nPASS second suite\n",
      status: "completed",
    });

    expect(
      normalizeCodexAppServerMessage({
        method: "item/completed",
        params: {
          item: {
            id: "command-failed",
            type: "commandExecution",
            command: "bun test",
            status: "failed",
            aggregatedOutput: "1 test failed",
            exitCode: 1,
          },
        },
      }),
    ).toMatchObject({
      type: "activityCompleted",
      id: "command-failed",
      text: "1 test failed",
      status: "failed",
    });
    expect(
      normalizeCodexAppServerMessage({
        method: "item/completed",
        params: {
          item: {
            id: "command-declined",
            type: "commandExecution",
            command: "git push",
            status: "declined",
            aggregatedOutput: null,
            exitCode: null,
          },
        },
      }),
    ).toMatchObject({
      type: "activityCompleted",
      id: "command-declined",
      status: "cancelled",
    });
  });

  it("adds local channel images to the same App Server turn as the text", () => {
    const turn = codexTurnRequest(
      {
        ...request,
        attachments: [
          {
            type: "image",
            path: "/worktree/.briar-channel-images/first.png",
            name: "first.png",
            mimeType: "image/png",
          },
          {
            type: "image",
            path: "/worktree/.briar-channel-images/second.jpg",
            name: "second.jpg",
            mimeType: "image/jpeg",
          },
        ],
      },
      "thread-1",
    );

    expect(turn).toMatchObject({
      method: "turn/start",
      params: {
        input: [
          { type: "text", text: "Inspect the repository" },
          {
            type: "localImage",
            path: "/worktree/.briar-channel-images/first.png",
          },
          {
            type: "localImage",
            path: "/worktree/.briar-channel-images/second.jpg",
          },
        ],
      },
    });
  });

  it("reads effective config before starting a thread and turn", () => {
    const state = createCodexAppServerState();
    const defaultRequest = { ...request, model: null };
    const initialized = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 1,
      result: {},
    });
    expect(initialized.outgoing.map((message) => message.method)).toEqual([
      "initialized",
      "config/read",
    ]);

    const configured = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 2,
      result: { config: { model: "gpt-5.6-sol" } },
    });
    expect(configured.outgoing[0]).toMatchObject({ method: "thread/start" });

    const thread = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 4,
      result: { thread: { id: "thread-1" } },
    });
    expect(state.threadId).toBe("thread-1");
    expect(thread.outgoing[0]).toMatchObject({
      method: "turn/start",
      params: { threadId: "thread-1" },
    });

    consumeCodexAppServerMessage(state, defaultRequest, {
      id: 5,
      result: { turn: { id: "turn-1" } },
    });
    consumeCodexAppServerMessage(state, defaultRequest, {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "message-1",
          type: "agentMessage",
          phase: "final_answer",
          text: "Done",
        },
      },
    });
    const completed = consumeCodexAppServerMessage(state, defaultRequest, {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    });
    expect(completed.completed).toBe(true);
    expect(codexFinalMessage(state)).toBe("Done");
  });

  it("skips default-model discovery when a model was explicitly configured", () => {
    const state = createCodexAppServerState();
    const initialized = consumeCodexAppServerMessage(state, request, {
      id: 1,
      result: {},
    });
    expect(initialized.outgoing.map((message) => message.method)).toEqual([
      "initialized",
      "thread/start",
    ]);
  });

  it("falls back to the provider model catalog when config has no model", () => {
    const state = createCodexAppServerState();
    const defaultRequest = { ...request, model: null };
    consumeCodexAppServerMessage(state, defaultRequest, {
      id: 1,
      result: {},
    });
    const config = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 2,
      result: { config: { model: null } },
    });
    expect(config.outgoing).toEqual([codexModelListRequest()]);

    const models = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 3,
      result: {
        data: [{ model: "gpt-5.6-sol", isDefault: true }],
        nextCursor: null,
      },
    });
    expect(models.outgoing[0]).toMatchObject({ method: "thread/start", id: 4 });
  });

  it("keeps running when model-discovery RPCs are unavailable", () => {
    const state = createCodexAppServerState();
    const defaultRequest = { ...request, model: null };
    consumeCodexAppServerMessage(state, defaultRequest, {
      id: 1,
      result: {},
    });

    const fallback = consumeCodexAppServerMessage(state, defaultRequest, {
      id: 2,
      error: { code: -32601, message: "Method not found" },
    });

    expect(fallback.outgoing).toEqual([codexThreadRequest(defaultRequest)]);
  });

  it("keeps approval handling compatible with the desktop decisions", () => {
    const approval = {
      id: 4,
      method: "item/commandExecution/requestApproval",
      params: { command: "git status" },
    };
    expect(codexApprovalRequest(approval)).toMatchObject({
      id: "codex-4",
      toolName: "item/commandExecution/requestApproval",
      input: { command: "git status" },
    });
    expect(codexServerRequestResponse(approval, true)).toEqual({
      id: 4,
      result: { decision: "accept" },
    });
    expect(codexServerRequestResponse(approval, false)).toEqual({
      id: 4,
      result: { decision: "decline" },
    });
  });

  it("turns a failed App Server turn into a terminal runner error", () => {
    const state = createCodexAppServerState();
    state.threadId = "thread-1";
    state.turnId = "turn-1";
    expect(() =>
      consumeCodexAppServerMessage(state, request, {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "failed",
            error: { message: "provider disconnected" },
          },
        },
      }),
    ).toThrow("provider disconnected");
  });
});
