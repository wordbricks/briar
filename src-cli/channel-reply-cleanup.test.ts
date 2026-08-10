import { describe, expect, it, vi } from "vitest";
import { cleanupChannelReplyResources } from "./channel-reply-cleanup";

describe("channel reply cleanup", () => {
  it("retries transient failures and continues independent cleanup", async () => {
    const imageCleanup = vi.fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(undefined);
    const workspaceCleanup = vi.fn().mockResolvedValue(undefined);

    await cleanupChannelReplyResources([
      { label: "channel images", run: imageCleanup },
      { label: "analysis workspace", run: workspaceCleanup },
    ]);

    expect(imageCleanup).toHaveBeenCalledTimes(2);
    expect(workspaceCleanup).toHaveBeenCalledTimes(1);
  });

  it("fails closed after exhausting retries", async () => {
    const imageCleanup = vi.fn().mockRejectedValue(new Error("still busy"));
    const workspaceCleanup = vi.fn().mockResolvedValue(undefined);

    await expect(
      cleanupChannelReplyResources([
        { label: "channel images", run: imageCleanup },
        { label: "analysis workspace", run: workspaceCleanup },
      ]),
    ).rejects.toThrow("Channel context and workspace cleanup failed");
    expect(imageCleanup).toHaveBeenCalledTimes(3);
    expect(workspaceCleanup).toHaveBeenCalledTimes(1);
  });
});
