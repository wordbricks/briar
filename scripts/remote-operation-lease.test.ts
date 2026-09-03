import { describe, expect, it } from "vitest";

import type { WranglerRunner } from "./apply-remote-d1-migrations";
import {
  RemoteLeaseBusy,
  withRemoteOperationLease,
} from "./remote-operation-lease";

type StoredLease = {
  readonly expiresAt: number;
  readonly headSha: string;
  readonly owner: string;
};

function leaseRunner() {
  let stored: StoredLease | null = null;
  const runner: WranglerRunner = async (args, captureOutput) => {
    const commandIndex = args.indexOf("--command");
    const sql = commandIndex >= 0 ? args[commandIndex + 1] ?? "" : "";
    if (sql.startsWith("delete from")) {
      const owner = /owner = '([^']+)'/u.exec(sql)?.[1];
      if (owner === stored?.owner) stored = null;
      return { exitCode: 0, stdout: "" };
    }

    if (sql.includes("insert into briar_production_operation_leases")) {
      const values = /values \(\s*'[^']+', '([^']+)', '([^']+)'/u.exec(sql);
      if (!stored && values) {
        stored = {
          expiresAt: 9_999_999_999,
          headSha: values[2]!,
          owner: values[1]!,
        };
      }
    }

    const rows = stored
      ? [{
          owner: stored.owner,
          head_sha: stored.headSha,
          expires_at: stored.expiresAt,
        }]
      : [];
    return {
      exitCode: 0,
      stdout: captureOutput
        ? JSON.stringify([{ success: true, results: rows }])
        : "",
    };
  };
  return {
    current: () => stored,
    runner,
    steal: () => {
      if (stored) {
        stored = { ...stored, owner: "99999999-9999-4999-8999-999999999999" };
      }
    },
  };
}

const headSha = "a".repeat(40);

describe("remote production operation lease", () => {
  it("excludes another deploy until the first deploy releases the lease", async () => {
    const lease = leaseRunner();
    let startFirst!: () => void;
    let finishFirst!: () => void;
    const started = new Promise<void>((resolve) => {
      startFirst = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const first = withRemoteOperationLease({
      headSha,
      heartbeatMillis: 59_000,
      name: "worker-production",
      owner: "11111111-1111-4111-8111-111111111111",
      runner: lease.runner,
      ttlSeconds: 60,
    }, async () => {
      startFirst();
      await finish;
      return "deployed";
    });
    await started;

    await expect(withRemoteOperationLease({
      headSha: "b".repeat(40),
      heartbeatMillis: 59_000,
      name: "worker-production",
      owner: "22222222-2222-4222-8222-222222222222",
      runner: lease.runner,
      ttlSeconds: 60,
    }, async () => "must-not-run")).rejects.toBeInstanceOf(RemoteLeaseBusy);

    finishFirst();
    await expect(first).resolves.toBe("deployed");
    expect(lease.current()).toBeNull();
  });

  it("releases the lease when the protected operation fails", async () => {
    const lease = leaseRunner();
    await expect(withRemoteOperationLease({
      headSha,
      heartbeatMillis: 59_000,
      name: "worker-production",
      owner: "33333333-3333-4333-8333-333333333333",
      runner: lease.runner,
      ttlSeconds: 60,
    }, async () => {
      throw new Error("migration failed");
    })).rejects.toThrow("Production operation worker-production failed");

    await expect(withRemoteOperationLease({
      headSha,
      heartbeatMillis: 59_000,
      name: "worker-production",
      owner: "44444444-4444-4444-8444-444444444444",
      runner: lease.runner,
      ttlSeconds: 60,
    }, async () => "retry succeeded")).resolves.toBe("retry succeeded");
  });

  it("aborts the protected process when the lease is lost", async () => {
    const lease = leaseRunner();
    let operationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    let aborted = false;
    const deployment = withRemoteOperationLease({
      headSha,
      heartbeatMillis: 1_000,
      name: "worker-production",
      owner: "55555555-5555-4555-8555-555555555555",
      runner: lease.runner,
      ttlSeconds: 60,
    }, (signal) => new Promise<never>((_resolve, reject) => {
      operationStarted();
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("process aborted"));
      }, { once: true });
    }));
    await started;
    lease.steal();

    await expect(deployment).rejects.toThrow("Lost production operation lease");
    expect(aborted).toBe(true);
  });
});
