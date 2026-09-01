import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  ChannelAgentActivityPublishInput,
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
});
