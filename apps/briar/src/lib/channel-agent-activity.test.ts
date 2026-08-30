import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  ChannelAgentActivityPublishInput,
  decodeAgentReplyActivityFrameBinaryOption,
  encodeAgentReplyActivityFrameBinary,
  type AgentReplyActivityFrame,
} from "./channel-agent-activity";

describe("channel Agent activity contract", () => {
  it("normalizes publish descriptors and reserves the terminal sequence", () => {
    const decode = Schema.decodeUnknownSync(ChannelAgentActivityPublishInput);

    expect(decode({
      sequence: 1,
      activity: {
        id: "  tool-1  ",
        kind: "tool",
        headline: "  Running tests  ",
      },
    })).toEqual({
      sequence: 1,
      activity: {
        id: "tool-1",
        kind: "tool",
        headline: "Running tests",
      },
    });
    expect(() =>
      decode({
        sequence: Number.MAX_SAFE_INTEGER,
        activity: null,
      })
    ).toThrow();
  });

  it("round-trips generated channel and issue scope oneofs", () => {
    const common = {
      replyJobId: "11111111-1111-4111-8111-111111111111",
      attempt: 1,
      sequence: 1,
      triggerMessageId: "44444444-4444-4444-8444-444444444444",
      parentMessageId: "55555555-5555-4555-8555-555555555555",
      activity: {
        id: "command-1",
        kind: "command" as const,
        headline: "Running tests",
      },
      sentAt: "2026-08-20T07:00:00.000Z",
      expiresAt: "2026-08-20T07:00:30.000Z",
    };
    const frames: AgentReplyActivityFrame[] = [
      {
        ...common,
        agentId: "22222222-2222-4222-8222-222222222222",
        channelId: "33333333-3333-4333-8333-333333333333",
      },
      {
        ...common,
        projectId: "66666666-6666-4666-8666-666666666666",
        runId: "77777777-7777-4777-8777-777777777777",
      },
    ];

    expect(frames.map((frame) => Option.getOrNull(
      decodeAgentReplyActivityFrameBinaryOption(
        encodeAgentReplyActivityFrameBinary(frame),
      ),
    ))).toEqual(frames);
  });
});
