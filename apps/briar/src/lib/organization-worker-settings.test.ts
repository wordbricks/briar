import { describe, expect, it, vi } from "vitest";
import { loadExecutionWorkerSettings } from "./organization-worker-settings";

describe("loadExecutionWorkerSettings", () => {
  it("loads Worker status when label synchronization fails", async () => {
    const syncLabels = vi
      .fn()
      .mockRejectedValue(new Error("Worker is not enabled for this project"));
    const loadRemote = vi.fn().mockResolvedValue({ workers: [] });
    const loadLocal = vi.fn().mockResolvedValue([{ registered: true }]);

    await expect(
      loadExecutionWorkerSettings({ loadLocal, loadRemote, syncLabels }),
    ).resolves.toEqual([{ workers: [] }, [{ registered: true }]]);
    expect(syncLabels).toHaveBeenCalledOnce();
    expect(loadRemote).toHaveBeenCalledOnce();
    expect(loadLocal).toHaveBeenCalledOnce();
  });
});
