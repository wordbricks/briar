import { describe, expect, it } from "vitest";
import {
  agentMessagesFromAppServerEvents,
  displayChannelActivityHeadline,
  mergeAutoHuntAppServerEvents,
  naturalLanguageFromAgentMessage,
  type AutoHuntAppServerEvent,
} from "./auto-hunt-agent";

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

  it("extracts a string body from a channel reply envelope", () => {
    expect(naturalLanguageFromAgentMessage(JSON.stringify({
      body: "Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다.",
      attachments: [],
      document: null,
      issueProposal: null,
    }))).toBe("Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다.");
  });

  it("extracts a complete body from a streamed or truncated reply envelope", () => {
    expect(naturalLanguageFromAgentMessage(
      '{"body":"Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다.","attachments":[],"document":null,"issueProposal"',
    )).toBe("Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다.");
  });

  it("keeps valid JSON without a string body unchanged", () => {
    expect(naturalLanguageFromAgentMessage(
      '{"body":null,"attachments":[],"document":null}',
    )).toBe('{"body":null,"attachments":[],"document":null}');
  });
});

describe("displayChannelActivityHeadline", () => {
  it("post-processes only message headlines", () => {
    expect(displayChannelActivityHeadline({
      kind: "message",
      headline: '{"body":"저장소를 확인하고 있습니다.","attachments":[]}',
    })).toBe("저장소를 확인하고 있습니다.");
    expect(displayChannelActivityHeadline({
      kind: "command",
      headline: '{"body":"should not extract"}',
    })).toBe('{"body":"should not extract"}');
  });
});
