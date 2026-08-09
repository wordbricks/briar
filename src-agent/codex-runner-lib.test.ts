import { describe, expect, it } from "vitest";
import {
  codexAppServerArgs,
  codexApprovalRequest,
  codexFinalMessage,
  codexInitializeRequest,
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
      id: 2,
      params: {
        cwd: "/worktree",
        sandbox: "workspace-write",
        approvalPolicy: "never",
        developerInstructions: "Use the Briar workflow.",
      },
    });
    expect(codexTurnRequest(request, "thread-1")).toMatchObject({
      method: "turn/start",
      id: 3,
      params: {
        threadId: "thread-1",
        cwd: "/worktree",
        model: "gpt-5",
        effort: "high",
      },
    });
  });

  it("maps App Server messages to the shared Agent event contract", () => {
    expect(
      normalizeCodexAppServerMessage({
        method: "item/started",
        params: {
          item: { id: "message-1", type: "agentMessage", phase: "commentary", text: "Working" },
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

  it("drives initialize, thread, turn, and final-message transitions", () => {
    const state = createCodexAppServerState();
    const initialized = consumeCodexAppServerMessage(state, request, {
      id: 1,
      result: {},
    });
    expect(initialized.outgoing.map((message) => message.method)).toEqual([
      "initialized",
      "thread/start",
    ]);

    const thread = consumeCodexAppServerMessage(state, request, {
      id: 2,
      result: { thread: { id: "thread-1" } },
    });
    expect(state.threadId).toBe("thread-1");
    expect(thread.outgoing[0]).toMatchObject({
      method: "turn/start",
      params: { threadId: "thread-1" },
    });

    consumeCodexAppServerMessage(state, request, {
      id: 3,
      result: { turn: { id: "turn-1" } },
    });
    consumeCodexAppServerMessage(state, request, {
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
    const completed = consumeCodexAppServerMessage(state, request, {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    });
    expect(completed.completed).toBe(true);
    expect(codexFinalMessage(state)).toBe("Done");
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
