import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  AgentReplyActivityFrame,
  ChannelAgentActivityPublishInput,
  decodeAgentReplyActivityFrameOption,
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

  it("keeps strict frame boundaries and UTC timestamps", () => {
    const frame = {
      version: 1,
      replyJobId: "11111111-1111-4111-8111-111111111111",
      attempt: 1,
      sequence: 1,
      agentId: "22222222-2222-4222-8222-222222222222",
      channelId: "33333333-3333-4333-8333-333333333333",
      triggerMessageId: "44444444-4444-4444-8444-444444444444",
      parentMessageId: "55555555-5555-4555-8555-555555555555",
      activity: null,
      sentAt: "2026-08-20T07:00:00.000Z",
      expiresAt: "2026-08-20T07:00:30.000Z",
    };

    expect(
      Option.getOrNull(decodeAgentReplyActivityFrameOption(frame)),
    ).toEqual(frame);
    expect(
      Option.isNone(
        decodeAgentReplyActivityFrameOption({ ...frame, traceId: "future" }),
      ),
    ).toBe(true);
    expect(
      Option.isNone(
        decodeAgentReplyActivityFrameOption({
          ...frame,
          sentAt: "2026-08-20T16:00:00+09:00",
        }),
      ),
    ).toBe(true);
    expect(() =>
      Schema.decodeUnknownSync(AgentReplyActivityFrame)({
        ...frame,
        sequence: 0,
      })
    ).toThrow();
  });
});
