import { describe, expect, it } from "vitest";
import {
  agentMessagesFromAppServerEvents,
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
});

describe("naturalLanguageFromAgentMessage", () => {
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
});
