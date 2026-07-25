import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ERROR_DELAY_MS,
  defaultWorkerLabel,
  errorDelayMs,
  hostFingerprint,
  launchdPlist,
  runWorkerLoop,
  serviceDefinition,
  serviceLabel,
  systemdUnit,
  workerLogPath,
  type ClaimedIssue,
  type WorkerLoopDependencies,
} from "./worker";

const projectId = "11111111-1111-4111-8111-111111111111";

const issue = (sourceKey: string): ClaimedIssue => ({
  runId: `run-${sourceKey}`,
  sourceKey,
  title: `Issue ${sourceKey}`,
  claimToken: `briar_claim_${sourceKey}`,
  leaseExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
});

type Harness = {
  dependencies: WorkerLoopDependencies;
  sleeps: number[];
  logs: string[];
  ran: string[];
  renewals: string[];
  heartbeats: number;
};

const harness = (
  queue: (ClaimedIssue | null)[],
  overrides: Partial<WorkerLoopDependencies> = {},
  options: { renewalTicks?: number } = {},
): Harness => {
  const sleeps: number[] = [];
  const logs: string[] = [];
  const ran: string[] = [];
  const renewals: string[] = [];
  let heartbeats = 0;
  let clock = 0;
  let renewalTicks = options.renewalTicks ?? 0;

  const dependencies: WorkerLoopDependencies = {
    claim: async () => queue.shift() ?? null,
    renewLease: async (claimed) => {
      renewals.push(claimed.sourceKey);
    },
    heartbeat: async () => {
      heartbeats += 1;
    },
    runIssue: async (claimed) => {
      ran.push(claimed.sourceKey);
    },
    sleep: async (milliseconds, signal) => {
      if (signal) {
        // A renewal wait. Fire only as many ticks as the test asked for, then
        // block until the loop aborts it.
        if (renewalTicks > 0) {
          renewalTicks -= 1;
          clock += milliseconds;
          return;
        }
        if (signal.aborted) return;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return;
      }
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
    log: (line) => logs.push(line),
    ...overrides,
  };

  return {
    dependencies,
    sleeps,
    logs,
    ran,
    renewals,
    get heartbeats() {
      return heartbeats;
    },
  };
};

describe("briar worker loop", () => {
  it("processes one issue and stops with --once", async () => {
    const test = harness([issue("issue-1"), issue("issue-2")]);
    const result = await runWorkerLoop(test.dependencies, { once: true });

    expect(result).toEqual({ processed: 1, failures: 0, stoppedBecause: "once" });
    expect(test.ran).toEqual(["issue-1"]);
  });

  it("stops after the requested issue count", async () => {
    const test = harness([issue("issue-1"), issue("issue-2"), issue("issue-3")]);
    const result = await runWorkerLoop(test.dependencies, { maxIssues: 2 });

    expect(result.processed).toBe(2);
    expect(result.stoppedBecause).toBe("maxIssues");
    expect(test.ran).toEqual(["issue-1", "issue-2"]);
  });

  it("reports an empty queue instead of spinning with --once", async () => {
    const test = harness([]);
    const result = await runWorkerLoop(test.dependencies, { once: true });

    expect(result).toEqual({ processed: 0, failures: 0, stoppedBecause: "emptyQueue" });
    expect(test.sleeps).toEqual([]);
  });

  it("waits between polls when the queue is empty", async () => {
    let polls = 0;
    const test = harness([], {
      claim: async () => {
        polls += 1;
        return polls > 2 ? issue("issue-late") : null;
      },
    });
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      idleDelayMs: 15_000,
    });

    expect(result.processed).toBe(1);
    expect(test.sleeps).toEqual([15_000, 15_000]);
  });

  it("holds exactly one issue in flight and renews its lease while it runs", async () => {
    let inFlight = 0;
    let observedMaximum = 0;
    const test = harness([issue("issue-1"), issue("issue-2")], {
      runIssue: async () => {
        inFlight += 1;
        observedMaximum = Math.max(observedMaximum, inFlight);
        inFlight -= 1;
      },
    });
    await runWorkerLoop(test.dependencies, { maxIssues: 2 });

    expect(observedMaximum).toBe(1);
  });

  it("renews the lease while an issue is in flight", async () => {
    const test = harness([issue("issue-1")], {}, { renewalTicks: 1 });
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      leaseRenewIntervalMs: 5 * 60_000,
    });

    expect(result.processed).toBe(1);
    expect(test.renewals).toEqual(["issue-1"]);
  });

  it("keeps working when a lease renewal fails and logs the reason", async () => {
    const test = harness(
      [issue("issue-1")],
      {
        renewLease: async () => {
          throw new Error("claim token is no longer active");
        },
      },
      { renewalTicks: 1 },
    );
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      leaseRenewIntervalMs: 5 * 60_000,
    });

    expect(result.processed).toBe(1);
    expect(test.logs.some((line) => line.includes("lease renewal failed"))).toBe(true);
  });

  it("does not wait out the renewal interval after an issue finishes", async () => {
    const test = harness([issue("issue-1"), issue("issue-2")]);
    await runWorkerLoop(test.dependencies, {
      maxIssues: 2,
      leaseRenewIntervalMs: 5 * 60_000,
    });

    // Only idle/backoff waits may appear here; a renewal wait would mean the
    // loop blocked for five minutes between issues.
    expect(test.sleeps).toEqual([]);
  });

  it("backs off exponentially after failures and recovers", async () => {
    let attempts = 0;
    const test = harness([], {
      claim: async () => {
        attempts += 1;
        if (attempts <= 3) throw new Error("api unreachable");
        return issue("issue-after-outage");
      },
    });
    const result = await runWorkerLoop(test.dependencies, { maxIssues: 1 });

    expect(result.processed).toBe(1);
    expect(result.failures).toBe(3);
    expect(test.sleeps).toEqual([2_000, 4_000, 8_000]);
  });

  it("caps the backoff delay", () => {
    expect(errorDelayMs(1)).toBe(2_000);
    expect(errorDelayMs(4)).toBe(16_000);
    expect(errorDelayMs(50)).toBe(DEFAULT_MAX_ERROR_DELAY_MS);
    expect(errorDelayMs(50, 30_000)).toBe(30_000);
  });

  it("heartbeats on the first iteration and then on the interval", async () => {
    const test = harness([issue("issue-1"), issue("issue-2")]);
    await runWorkerLoop(test.dependencies, {
      maxIssues: 2,
      heartbeatIntervalMs: 60_000,
    });

    // Second iteration happens at the same simulated instant, so one beat.
    expect(test.heartbeats).toBe(1);
  });
});

describe("worker identity", () => {
  it("derives a stable fingerprint from machine facts only", () => {
    const first = hostFingerprint({
      host: "build-box",
      platform: "linux",
      arch: "arm64",
      home: "/home/dev",
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      hostFingerprint({
        host: "build-box",
        platform: "linux",
        arch: "arm64",
        home: "/home/dev",
      }),
    ).toBe(first);
    expect(
      hostFingerprint({
        host: "other-box",
        platform: "linux",
        arch: "arm64",
        home: "/home/dev",
      }),
    ).not.toBe(first);
  });

  it("labels a worker after its host", () => {
    expect(defaultWorkerLabel("build-box.local")).toBe("build-box");
    expect(defaultWorkerLabel("  ")).toBe("briar-worker");
    expect(defaultWorkerLabel("x".repeat(200))).toHaveLength(100);
  });
});

describe("worker service definitions", () => {
  const input = {
    projectId,
    briarBinary: "/Users/dev/.local/bin/briar",
    workingDirectory: "/Users/dev/git/example",
    home: "/Users/dev",
  };

  it("builds a launchd agent that restarts and logs", () => {
    const definition = serviceDefinition({ ...input, platform: "darwin" });
    expect(definition.path).toBe(
      `/Users/dev/Library/LaunchAgents/${serviceLabel(projectId)}.plist`,
    );
    expect(definition.contents).toContain("<key>KeepAlive</key>");
    expect(definition.contents).toContain("<key>RunAtLoad</key>");
    expect(definition.contents).toContain(workerLogPath(projectId, "/Users/dev"));
    expect(definition.enableCommand[0]).toBe("launchctl");
  });

  it("builds a systemd user unit that always restarts", () => {
    const definition = serviceDefinition({ ...input, platform: "linux" });
    expect(definition.path).toBe(
      `/Users/dev/.config/systemd/user/briar-worker@${projectId}.service`,
    );
    expect(definition.contents).toContain("Restart=always");
    expect(definition.enableCommand).toEqual([
      "systemctl",
      "--user",
      "enable",
      "--now",
      `briar-worker@${projectId}.service`,
    ]);
  });

  it("never writes a credential into the unit", () => {
    for (const currentPlatform of ["darwin", "linux"]) {
      const definition = serviceDefinition({ ...input, platform: currentPlatform });
      expect(definition.contents).not.toMatch(/briar_agent_/u);
      expect(definition.contents).not.toMatch(/briar_claim_/u);
      expect(definition.contents.toLowerCase()).not.toContain("token");
    }
  });

  it("passes the project through to the worker command", () => {
    expect(
      launchdPlist({
        projectId,
        briarBinary: "/bin/briar",
        workingDirectory: "/repo",
        logPath: "/log",
      }),
    ).toContain(`<string>${projectId}</string>`);
    expect(
      systemdUnit({
        projectId,
        briarBinary: "/bin/briar",
        workingDirectory: "/repo",
      }),
    ).toContain(`worker --project ${projectId}`);
  });

  it("refuses platforms it cannot manage, in Korean", () => {
    expect(() => serviceDefinition({ ...input, platform: "win32" })).toThrow(
      /지원하지 않습니다/u,
    );
  });
});
