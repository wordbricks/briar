import { describe, expect, it } from "vitest";
import {
  channelReplyNoAvailableWorkerError,
  channelReplyProviderUsageExhaustedError,
} from "./channels-contract";
import { channelReplyErrorText } from "./channel-reply-error";

const messages = {
  fallback: "fallback",
  noAvailableWorker: "worker unavailable",
  usageExhausted: "usage exhausted",
};

describe("channelReplyErrorText", () => {
  it("localizes stable channel reply availability errors", () => {
    expect(channelReplyErrorText(channelReplyNoAvailableWorkerError, messages))
      .toBe("worker unavailable");
    expect(
      channelReplyErrorText(
        channelReplyProviderUsageExhaustedError,
        messages,
      ),
    ).toBe("usage exhausted");
  });

  it("preserves unknown server errors and falls back for null", () => {
    expect(channelReplyErrorText("Runner failed", messages))
      .toBe("Runner failed");
    expect(channelReplyErrorText(null, messages)).toBe("fallback");
  });
});
