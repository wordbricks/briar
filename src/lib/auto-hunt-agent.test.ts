import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentMessagesFromAppServerEvents,
  mergeAutoHuntAppServerEvents,
  naturalLanguageFromAgentMessage,
  retryProjectAutoHuntRun,
  startProjectAutoHunt,
  type AutoHuntAppServerEvent,
} from "./auto-hunt-agent";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("./api", () => ({ briarApiUrl: "http://127.0.0.1:8788" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

const event = (
  sequence: number,
  method: string,
): AutoHuntAppServerEvent => ({
  sessionId: "session-1",
  sequence,
  occurredAtMs: sequence,
  direction: sequence % 2 === 0 ? "server" : "client",
  message: { method },
});

describe("mergeAutoHuntAppServerEvents", () => {
  it("deduplicates persisted and live events and keeps wire order", () => {
    const merged = mergeAutoHuntAppServerEvents(
      [event(2, "thread/started"), event(1, "initialize")],
      [event(2, "thread/started"), event(3, "turn/started")],
    );

    expect(merged.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(merged.map((item) => item.message.method)).toEqual([
      "initialize",
      "thread/started",
      "turn/started",
    ]);
  });
});

describe("agentMessagesFromAppServerEvents", () => {
  it("renders final messages from detached Codex worker transcripts", () => {
    expect(agentMessagesFromAppServerEvents([{
      sessionId: "detached-run-1",
      sequence: 7,
      occurredAtMs: 700,
      direction: "server",
      provider: "codex",
      message: {
        type: "item.completed",
        item: {
          id: "worker-message-1",
          type: "agent_message",
          text: "워커 구현과 검증을 완료했습니다.",
        },
      },
    }])).toEqual([{
      id: "detached-run-1:worker-message-1",
      phase: "final_answer",
      text: "워커 구현과 검증을 완료했습니다.",
      startedAtMs: 700,
      updatedAtMs: 700,
      isComplete: true,
    }]);
  });

  it("renders provider-neutral agent events without parsing the raw protocol", () => {
    const events: AutoHuntAppServerEvent[] = [
      {
        ...event(1, "claude/stream"),
        direction: "server",
        event: {
          type: "messageStarted",
          id: "message-1",
          phase: "commentary",
          text: "",
        },
      },
      {
        ...event(2, "claude/stream"),
        direction: "server",
        event: {
          type: "messageDelta",
          id: "message-1",
          delta: "공통 이벤트입니다.",
        },
      },
      {
        ...event(3, "claude/result"),
        direction: "server",
        event: {
          type: "messageCompleted",
          id: "message-1",
          phase: "commentary",
          text: "공통 이벤트입니다.",
        },
      },
    ];

    expect(agentMessagesFromAppServerEvents(events)).toEqual([{
      id: "message-1",
      phase: "commentary",
      text: "공통 이벤트입니다.",
      startedAtMs: 1,
      updatedAtMs: 3,
      isComplete: true,
    }]);
  });

  it("keeps repeated provider message ids from follow-up turns", () => {
    const turn = (
      sequence: number,
      message: string,
    ): AutoHuntAppServerEvent[] => [{
      sessionId: "session-1",
      sequence,
      occurredAtMs: sequence,
      direction: "client",
      message: { type: "run" },
    }, {
      sessionId: "session-1",
      sequence: sequence + 1,
      occurredAtMs: sequence + 1,
      direction: "server",
      message: {},
      event: {
        type: "messageCompleted",
        id: "assistant:1",
        phase: "final_answer",
        text: message,
      },
    }];

    expect(agentMessagesFromAppServerEvents([
      ...turn(1, "첫 번째 답변"),
      ...turn(3, "후속 답변"),
    ])).toMatchObject([
      { id: "assistant:1", text: "첫 번째 답변" },
      { id: "turn:2:assistant:1", text: "후속 답변" },
    ]);
  });

  it("combines agent message deltas and hides non-message protocol events", () => {
    const events: AutoHuntAppServerEvent[] = [
      event(1, "initialize"),
      {
        ...event(2, "item/started"),
        direction: "server",
        message: {
          method: "item/started",
          params: {
            item: {
              id: "message-1",
              type: "agentMessage",
              phase: "commentary",
              text: "",
            },
          },
        },
      },
      {
        ...event(3, "item/agentMessage/delta"),
        direction: "server",
        message: {
          method: "item/agentMessage/delta",
          params: { itemId: "message-1", delta: "분석하고 " },
        },
      },
      {
        ...event(4, "item/agentMessage/delta"),
        direction: "server",
        message: {
          method: "item/agentMessage/delta",
          params: { itemId: "message-1", delta: "있습니다." },
        },
      },
      {
        ...event(5, "item/completed"),
        direction: "server",
        message: {
          method: "item/completed",
          params: {
            item: {
              id: "message-1",
              type: "agentMessage",
              phase: "commentary",
              text: "분석하고 있습니다.",
            },
          },
        },
      },
      {
        ...event(6, "item/completed"),
        direction: "server",
        message: {
          method: "item/completed",
          params: {
            item: {
              id: "command-1",
              type: "commandExecution",
              aggregatedOutput: "hidden",
            },
          },
        },
      },
    ];

    expect(agentMessagesFromAppServerEvents(events.slice(0, 4))).toEqual([{
      id: "message-1",
      phase: "commentary",
      text: "분석하고 있습니다.",
      startedAtMs: 2,
      updatedAtMs: 4,
      isComplete: false,
    }]);
    expect(agentMessagesFromAppServerEvents(events)).toEqual([{
      id: "message-1",
      phase: "commentary",
      text: "분석하고 있습니다.",
      startedAtMs: 2,
      updatedAtMs: 5,
      isComplete: true,
    }]);
  });

  it("hides blank incomplete rows that only show the writing placeholder", () => {
    expect(
      agentMessagesFromAppServerEvents([
        {
          ...event(1, "opencode/stream"),
          direction: "server",
          provider: "opencode",
          event: {
            type: "messageStarted",
            id: "msg_empty",
            phase: "commentary",
            text: "",
          },
        },
        {
          ...event(2, "opencode/stream"),
          direction: "server",
          provider: "opencode",
          event: {
            type: "messageStarted",
            id: "msg_text",
            phase: "commentary",
            text: "OpenCode 진행 메시지",
          },
        },
      ]),
    ).toEqual([{
      id: "msg_text",
      phase: "commentary",
      text: "OpenCode 진행 메시지",
      startedAtMs: 2,
      updatedAtMs: 2,
      isComplete: false,
    }]);
  });
});

describe("naturalLanguageFromAgentMessage", () => {
  it("extracts the user-facing message from a saved-agent response envelope", () => {
    expect(naturalLanguageFromAgentMessage(JSON.stringify({
      action: "call_host_tool",
      message: "현재 blocked/failed 실행을 조회합니다.",
      structuredResult: null,
      toolCall: {
        name: "list_briar_runs",
        arguments: { statuses: ["blocked", "failed"] },
      },
    }))).toBe("현재 blocked/failed 실행을 조회합니다.");
  });

  it("extracts the natural-language summary from a structured response", () => {
    expect(naturalLanguageFromAgentMessage(JSON.stringify({
      issues: [],
      summary: "원인을 확인하고 레이아웃을 수정했습니다.",
    }))).toBe("원인을 확인하고 레이아웃을 수정했습니다.");
  });

  it("supports fenced JSON and keeps ordinary or incomplete messages unchanged", () => {
    expect(naturalLanguageFromAgentMessage(
      '```json\n{"issues":[],"summary":"검증을 완료했습니다."}\n```',
    )).toBe("검증을 완료했습니다.");
    expect(naturalLanguageFromAgentMessage("파일을 분석하고 있습니다."))
      .toBe("파일을 분석하고 있습니다.");
    expect(naturalLanguageFromAgentMessage('{"issues":[],"summary":"작성 중'))
      .toBe('{"issues":[],"summary":"작성 중');
  });

  it("removes agent phase metadata and renders its structured summary", () => {
    expect(naturalLanguageFromAgentMessage(
      '[commentary] {"issues":[],"summary":"사람이 읽을 진행 상황입니다."}',
    )).toBe("사람이 읽을 진행 상황입니다.");
    expect(naturalLanguageFromAgentMessage(
      "[commentary] 저장소를 확인하고 있습니다.",
    )).toBe("저장소를 확인하고 있습니다.");
  });
});

describe("retryProjectAutoHuntRun", () => {
  it("routes a saved-Agent retry through the native Briar CLI host", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
    });
    invoke.mockResolvedValue({
      runId: "22222222-2222-4222-8222-222222222222",
      outcome: "retried",
      attempt: 2,
      stage: "queued",
    });

    await retryProjectAutoHuntRun(
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
      "GitHub authentication was restored.",
    );

    expect(invoke).toHaveBeenCalledWith("retry_project_auto_hunt_run", {
      projectId: "33333333-3333-4333-8333-333333333333",
      runId: "22222222-2222-4222-8222-222222222222",
      requestId: "11111111-1111-4111-8111-111111111111",
      reason: "GitHub authentication was restored.",
    });
  });
});

describe("startProjectAutoHunt", () => {
  it("pins the native session to the active API and project", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue({
      conversationId: "briar:project-local:thread-1",
      workspaceRoot: "/repo",
      result: { summary: "완료", issues: [] },
    });

    await startProjectAutoHunt(
      "535a1867-ba4c-430f-9c11-ddd46513ec7f",
      [{
        id: "run-1",
        runNumber: 13,
        sourceKey: "issue-13",
        title: "settings 페이지 구현",
      }],
      "session-1",
      {
        id: "agent-auto-hunt",
        name: "Auto Hunt agent",
        provider: "codex",
        model: null,
        responsibility: "Perform Auto Hunt for every queued issue.",
        skill: "# Auto Hunt agent\n\nUse `briar skills get briar-workflow`.",
      },
    );

    expect(invoke).toHaveBeenCalledWith("start_project_auto_hunt", {
      projectId: "535a1867-ba4c-430f-9c11-ddd46513ec7f",
      request: {
        sessionId: "session-1",
        apiUrl: "http://127.0.0.1:8788",
        agentId: "agent-auto-hunt",
        coordinatorConversationId: null,
        agentName: "Auto Hunt agent",
        agentProvider: "codex",
        agentModel: null,
        responsibility: "Perform Auto Hunt for every queued issue.",
        skill: "# Auto Hunt agent\n\nUse `briar skills get briar-workflow`.",
        issues: [{
          runId: "run-1",
          runNumber: 13,
          sourceKey: "issue-13",
          title: "settings 페이지 구현",
        }],
      },
    });
  });

  it("invokes the selected agent with its provider, model, and skill", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue({
      conversationId: "briar:claude:project-local:thread-1",
      workspaceRoot: "/repo",
      result: { summary: "완료", issues: [] },
    });

    await startProjectAutoHunt(
      "535a1867-ba4c-430f-9c11-ddd46513ec7f",
      [{
        id: "run-1",
        runNumber: 13,
        sourceKey: "issue-13",
        title: "settings 페이지 구현",
      }],
      "session-2",
      {
        id: "agent-release",
        name: "Release hunter",
        provider: "claude",
        model: "sonnet",
        responsibility: "Process every queued release issue.",
        skill: "# Release hunter\n\nFollow the attached workflow.",
      },
      {
        coordinatorConversationId:
          "briar:claude:535a1867-ba4c-430f-9c11-ddd46513ec7f:coordinator-1",
      },
    );

    expect(invoke).toHaveBeenCalledWith("start_project_auto_hunt", {
      projectId: "535a1867-ba4c-430f-9c11-ddd46513ec7f",
      request: expect.objectContaining({
        agentId: "agent-release",
        coordinatorConversationId:
          "briar:claude:535a1867-ba4c-430f-9c11-ddd46513ec7f:coordinator-1",
        agentName: "Release hunter",
        agentProvider: "claude",
        agentModel: "sonnet",
        responsibility: "Process every queued release issue.",
        skill: "# Release hunter\n\nFollow the attached workflow.",
      }),
    });
  });
});
