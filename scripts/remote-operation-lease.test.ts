import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import type { WranglerRunner } from "./apply-remote-d1-migrations";
import { withRemoteOperationLease } from "./remote-operation-lease";

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
  it.effect("excludes a concurrent deploy and admits its successor", () =>
    Effect.gen(function* remoteLeaseExclusionEffect() {
      const lease = leaseRunner();
      let markStarted!: () => void;
      let finishFirst!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const finish = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      const first = yield* withRemoteOperationLease({
        headSha,
        heartbeatMillis: 59_000,
        name: "worker-production",
        owner: "11111111-1111-4111-8111-111111111111",
        runner: lease.runner,
        ttlSeconds: 60,
      }, async () => {
        markStarted();
        await finish;
        return "deployed";
      }).pipe(Effect.forkChild);
      yield* Effect.promise(() => started);

      const collision = yield* withRemoteOperationLease({
        headSha: "b".repeat(40),
        heartbeatMillis: 59_000,
        name: "worker-production",
        owner: "22222222-2222-4222-8222-222222222222",
        runner: lease.runner,
        ttlSeconds: 60,
      }, async () => "must-not-run").pipe(Effect.flip);
      assert.strictEqual(collision._tag, "RemoteLeaseBusy");

      finishFirst();
      assert.strictEqual(yield* Fiber.join(first), "deployed");
      assert.strictEqual(lease.current(), null);
    }));

  it.effect("interrupts the protected process when the lease is lost", () =>
    Effect.gen(function* remoteLeaseLossEffect() {
      const lease = leaseRunner();
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let aborted = false;
      const deployment = yield* withRemoteOperationLease({
        headSha,
        heartbeatMillis: 1_000,
        name: "worker-production",
        owner: "55555555-5555-4555-8555-555555555555",
        runner: lease.runner,
        ttlSeconds: 60,
      }, (signal) => new Promise<never>((_resolve, reject) => {
        markStarted();
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("process aborted"));
        }, { once: true });
      })).pipe(Effect.forkChild);
      yield* Effect.promise(() => started);
      lease.steal();

      yield* TestClock.adjust(1_000);
      const failure = yield* Fiber.join(deployment).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "RemoteLeaseLost");
      assert.strictEqual(aborted, true);
    }));

  it.effect("keeps the lease while a transient renew failure recurs", () =>
    Effect.gen(function* remoteLeaseTransientRenewEffect() {
      let stored: StoredLease | null = {
        expiresAt: 9_999_999_999,
        headSha,
        owner: "33333333-3333-4333-8333-333333333333",
      };
      let renewAttempts = 0;
      let releaseRenewed!: () => void;
      const renewed = new Promise<void>((resolve) => {
        releaseRenewed = resolve;
      });
      // The renew fails while a long D1 import blocks queries, then succeeds.
      const runner: WranglerRunner = async (args, captureOutput) => {
        const commandIndex = args.indexOf("--command");
        const sql = commandIndex >= 0 ? args[commandIndex + 1] ?? "" : "";
        if (sql.startsWith("update")) {
          renewAttempts += 1;
          if (renewAttempts >= 3) releaseRenewed();
          if (renewAttempts <= 2) return { exitCode: 1, stdout: "" };
        }
        if (sql.startsWith("delete from")) {
          stored = null;
          return { exitCode: 0, stdout: "" };
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

      const deployment = yield* withRemoteOperationLease({
        headSha,
        heartbeatMillis: 1_000,
        name: "worker-production",
        owner: "33333333-3333-4333-8333-333333333333",
        runner,
        ttlSeconds: 60,
      }, async () => {
        // Finish only after the spaced retries have healed two transient
        // renew failures; a lost lease would instead abort this process.
        await renewed;
        return "deployed";
      }).pipe(Effect.forkChild);

      // First renew attempt fails inside the import window; the schedule
      // retries after 10 seconds.
      yield* TestClock.adjust(1_000);
      yield* TestClock.adjust(10_000);
      // Second renew attempt also fails; the spaced retry heals it.
      yield* TestClock.adjust(10_000);

      assert.strictEqual(
        yield* Fiber.join(deployment),
        "deployed",
      );
      assert.strictEqual(stored, null);
      assert.strictEqual(renewAttempts, 3);
    }));
});
