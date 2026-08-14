import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordDesktopChannelFirstMessage,
  recordDesktopChannelHeader,
  resetDesktopChannelPerformanceForTests,
  startDesktopChannelTransition,
} from "./channel-performance";

describe("desktop channel transition performance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDesktopChannelPerformanceForTests();
  });

  it("records click-to-header and click-to-first-message timing", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125)
      .mockReturnValueOnce(180);
    startDesktopChannelTransition("channel-1");
    recordDesktopChannelHeader("channel-1");

    expect(recordDesktopChannelFirstMessage("channel-1", "cache")).toEqual({
      channelId: "channel-1",
      headerMs: 25,
      firstMessageMs: 80,
      source: "cache",
      targetMs: 150,
    });
  });

  it("ignores display marks without a matching click", () => {
    expect(recordDesktopChannelFirstMessage("channel-1", "network")).toBeNull();
  });
});
