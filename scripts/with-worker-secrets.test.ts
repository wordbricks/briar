import { describe, expect, it, vi } from "vitest";
import { runWorkerDeploy } from "./with-worker-secrets";

describe("Worker deployment", () => {
  it("applies remote D1 migrations before deploying the Worker", async () => {
    const runner = vi.fn(async () => 0);

    await expect(runWorkerDeploy("/tmp/secrets.json", runner)).resolves.toBe(0);
    expect(runner.mock.calls).toEqual([
      [["d1", "migrations", "apply", "briar-db", "--remote"]],
      [["deploy", "--secrets-file", "/tmp/secrets.json"]],
    ]);
  });

  it("does not deploy when migration fails", async () => {
    const runner = vi.fn(async () => 17);

    await expect(runWorkerDeploy("/tmp/secrets.json", runner)).resolves.toBe(17);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith([
      "d1",
      "migrations",
      "apply",
      "briar-db",
      "--remote",
    ]);
  });
});
