import { describe, expect, it, vi } from "vitest";
import { runWorkerDeploy } from "./with-worker-secrets";

describe("Worker deployment", () => {
  it("applies remote D1 migrations before deploying the Worker", async () => {
    const runner = vi.fn(async () => 0);
    const migrate = vi.fn(async () => 0);

    await expect(
      runWorkerDeploy("/tmp/secrets.json", runner, migrate),
    ).resolves.toBe(0);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls).toEqual([
      [["deploy", "--secrets-file", "/tmp/secrets.json"]],
    ]);
  });

  it("does not deploy when migration fails", async () => {
    const runner = vi.fn(async () => 0);
    const migrate = vi.fn(async () => 17);

    await expect(
      runWorkerDeploy("/tmp/secrets.json", runner, migrate),
    ).resolves.toBe(17);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(runner).not.toHaveBeenCalled();
  });
});
