import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRAIN_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_ERROR_DELAY_MS,
  DEFAULT_MAX_HEARTBEAT_ERROR_DELAY_MS,
  DEFAULT_MAX_IDLE_DELAY_MS,
  DM_REPLY_STEER_POLL_MS,
  createWorkerDeviceIdentity,
  createWorkerLoopHeartbeat,
  defaultWorkerLabel,
  emptyClaimDelayMs,
  errorDelayMs,
  heartbeatDelayMs,
  heartbeatErrorDelayMs,
  idleDelayWithBackoffMs,
  isLaunchdServiceNotFound,
  issueWorkerSessionDirectory,
  isReplyWork,
  leaseRenewDelayMs,
  launchdPlist,
  launchdServiceTarget,
  runWorkerLoop,
  restartInstalledServices,
  removeServiceDefinition,
  serviceDefinition,
  serviceLabel,
  systemdUnit,
  workerCliPath,
  workerExecutionPath,
  workerLogPath,
  type ClaimedIssue,
  type WorkerLoopDependencies,
} from "./worker";
import type { WorkerWakeReason } from "../src/lib/worker-wake-protocol";

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
    claim: async (options) => {
      if (options?.repliesOnly) {
        const replyIndex = queue.findIndex(
          (candidate) => candidate !== null && isReplyWork(candidate),
        );
        return replyIndex >= 0 ? queue.splice(replyIndex, 1)[0]! : null;
      }
      return queue.shift() ?? null;
    },
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
    random: () => 0.5,
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
      heartbeatIntervalMs: 10 * 60_000,
    });

    expect(result.processed).toBe(1);
    expect(test.sleeps).toEqual([15_000, 30_000]);
  });

  it("honors the server retry floor and caps sustained idle polling", async () => {
    let polls = 0;
    const test = harness([], {
      claim: async () => {
        polls += 1;
        return polls > 4
          ? { work: issue("issue-late") }
          : { work: null, retryAfterMs: 20_000 };
      },
    });
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      idleDelayMs: 15_000,
      maxIdleDelayMs: 60_000,
      heartbeatIntervalMs: 10 * 60_000,
    });

    expect(result.processed).toBe(1);
    expect(test.sleeps).toEqual([20_000, 40_000, 60_000, 60_000]);
  });

  /*
    The server shortens `retryAfterMs` while a DM reply is inside its settle
    window. Stretching that hint up to the poll interval would strand work the
    server already knows is about to be claimable.
  */
  it("re-claims on a short server retry hint instead of the idle interval", async () => {
    let polls = 0;
    const test = harness([], {
      claim: async () => {
        polls += 1;
        return polls > 2
          ? { work: issue("issue-settled") }
          : { work: null, retryAfterMs: 2_000 };
      },
    });
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      idleDelayMs: 15_000,
      maxIdleDelayMs: 60_000,
      heartbeatIntervalMs: 10 * 60_000,
    });

    expect(result.processed).toBe(1);
    // No backoff and no jitter: the hint is obeyed exactly, twice over.
    expect(test.sleeps).toEqual([2_000, 2_000]);
  });

  it("claims at once when the server pushes a wake, and restarts the backoff", async () => {
    const idleWaits: number[] = [];
    let polls = 0;
    let notify: ((reason: WorkerWakeReason) => void) | null = null;
    let unsubscribed = false;
    const test = harness([], {
      claim: async () => {
        polls += 1;
        return polls > 4 ? issue("issue-pushed") : null;
      },
      sleep: async (milliseconds, signal) => {
        // Only lease renewal asks for a wait this long; it blocks until the
        // loop aborts it, exactly as the real timer does.
        if (milliseconds >= 100_000) {
          if (signal?.aborted) return;
          await new Promise<void>((resolve) => {
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return;
        }
        idleWaits.push(milliseconds);
        // The third wait is the one the server interrupts.
        if (idleWaits.length === 3) notify?.("channel_reply_enqueued");
        if (signal?.aborted) return;
      },
      wake: {
        subscribe: (listener) => {
          notify = listener;
          return () => {
            unsubscribed = true;
          };
        },
      },
    });
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      idleDelayMs: 15_000,
      maxIdleDelayMs: 60_000,
      heartbeatIntervalMs: 10 * 60_000,
      leaseRenewIntervalMs: 10 * 60_000,
    });

    expect(result.processed).toBe(1);
    // The wake ends the 60s wait and drops the fleet back to its base delay
    // instead of leaving it at the backoff ceiling.
    expect(idleWaits).toEqual([15_000, 30_000, 60_000, 15_000]);
    expect(test.logs).toContain(
      "worker woken by server (channel_reply_enqueued)",
    );
    expect(unsubscribed).toBe(true);
  });

  it.each(["channel_reply_completed", "channel_reply_enqueued"] as const)("%s rechecks the active lease and aborts a revoked execution", async (reason) => {
    let notify: ((reason: WorkerWakeReason) => void) | undefined;
    let aborted = false;
    let renewed = false;
    const test = harness([issue("cancelled-reply")], {
      sleep: async (_milliseconds, signal) => {
        if (!signal || signal.aborted) return;
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      },
      wake: { subscribe: (listener) => { notify = listener; return () => {}; } },
      renewLease: async () => { renewed = true; throw new Error("Claim revoked"); },
      runIssue: async (_issue, signal) => {
        const stopped = new Promise<void>((resolve) => signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true }));
        notify?.(reason);
        await stopped;
      },
    });
    await runWorkerLoop(test.dependencies, { once: true, leaseRenewIntervalMs: 600_000 });
    expect(renewed).toBe(true);
    expect(aborted).toBe(true);
  });

  it("reclaims a steered response without counting an execution failure or final response", async () => {
    const original = { ...issue("steered"), workType: "channelReply" as const,
      workId: "response", session: { id: "same-session" } };
    const resumed = { ...original, claimToken: "new-claim" };
    let notify: ((reason: WorkerWakeReason) => void) | undefined;
    const order: string[] = [];
    const test = harness([original, resumed], {
      wake: { subscribe: (listener) => { notify = listener; return () => {}; } },
      sleep: async (_milliseconds, signal) => {
        if (!signal || signal.aborted) return;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      },
      renewLease: async (work) => {
        if (work.claimToken === original.claimToken) throw new Error("pending steer");
      },
      runIssue: async (work, signal) => {
        if (work.claimToken === resumed.claimToken) {
          order.push("resumed");
          return;
        }
        const stopped = new Promise<void>((resolve) => signal.addEventListener("abort", () => {
          order.push("provider stopped");
          resolve();
        }, { once: true }));
        notify?.("channel_reply_enqueued");
        await stopped;
        order.push("acknowledged");
        return { steered: true };
      },
    });
    const result = await runWorkerLoop(test.dependencies, { maxIssues: 1 });
    expect(order).toEqual(["provider stopped", "acknowledged", "resumed"]);
    expect(result).toMatchObject({ processed: 1, failures: 0 });
  });

  /*
    The wake that says "this job just absorbed another message" is sent while
    the claim RPC is still in flight. Reading the counter inside the execution
    swallowed it, and the renewal then waited a whole interval before asking
    again — five minutes for a plain direct message.
  */
  it.each([true, false])(
    "renews before waiting when a wake landed during the claim: %s",
    async (wakeDuringClaim) => {
      let notify: ((reason: WorkerWakeReason) => void) | undefined;
      const events: string[] = [];
      const test = harness([], {
        wake: { subscribe: (listener) => { notify = listener; return () => {}; } },
        claim: async () => {
          if (wakeDuringClaim) notify?.("channel_reply_enqueued");
          return issue("wake-during-claim");
        },
        sleep: async (milliseconds, signal) => {
          if (!signal) return;
          events.push(`wait:${milliseconds}`);
          if (signal.aborted) return;
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
        renewLease: async () => { events.push("renew"); },
        runIssue: async () => {
          // The renewal loop is scheduled synchronously with the execution, so
          // one macrotask is enough for it to have asked or waited.
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
      });
      await runWorkerLoop(test.dependencies, {
        once: true,
        leaseRenewIntervalMs: 600_000,
      });
      expect(events[0]).toBe(wakeDuringClaim ? "renew" : "wait:600000");
    },
  );

  it.each([
    ["a direct message reply", { workType: "channelReply" as const, workId: "dm-work",
      routing: null, snapshot: { channel: { kind: "dm" } } }, DM_REPLY_STEER_POLL_MS],
    ["an issue", {}, 5 * 60_000],
  ])("renews %s on its own interval", async (_label, extra, expected) => {
    const renewalWaits: number[] = [];
    const test = harness([{ ...issue("renewal-interval"), ...extra }], {
      sleep: async (milliseconds, signal) => {
        if (!signal) return;
        renewalWaits.push(milliseconds);
        if (signal.aborted) return;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      runIssue: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    await runWorkerLoop(test.dependencies, {
      once: true,
      leaseRenewIntervalMs: 5 * 60_000,
    });
    // Jitter is pinned by the harness random, so this is the interval itself.
    expect(renewalWaits[0]).toBe(expected);
  });

  /*
    With the short interval the steer now reaches the renewal while the reply is
    still being set up. Aborting there would trade the wasted provider turn for
    a wasted setup; the reply folds the steer into this same claim right before
    its first turn instead.
  */
  it("defers a pre-turn lease conflict on a direct message to the steer fold", async () => {
    let abortedDuringRun = false;
    const dmReply = {
      ...issue("dm-steered"),
      workType: "channelReply" as const,
      workId: "dm-work",
      routing: null,
      snapshot: { channel: { kind: "dm" } },
    };
    const test = harness(
      [dmReply],
      {
        replyTurnStarted: () => false,
        renewLease: async () => { throw new Error("Reply claim is no longer active"); },
        runIssue: async (_work, signal) => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          await new Promise((resolve) => setTimeout(resolve, 0));
          abortedDuringRun = signal.aborted;
        },
      },
      { renewalTicks: 2 },
    );
    const result = await runWorkerLoop(test.dependencies, {
      once: true,
      leaseRenewIntervalMs: 5 * 60_000,
    });
    expect(abortedDuringRun).toBe(false);
    expect(result).toMatchObject({ processed: 1, failures: 0 });
    expect(test.logs.some((line) => line.includes("deferred to the steer fold")))
      .toBe(true);
    expect(test.logs.some((line) => line.includes("lease renewal failed")))
      .toBe(false);
  });

  it("still aborts a channel reply that is not a direct message before its turn", async () => {
    let aborted = false;
    const channelReply = {
      ...issue("channel-lost"),
      workType: "channelReply" as const,
      workId: "channel-work",
      routing: null,
      snapshot: { channel: { kind: "channel" } },
    };
    const test = harness(
      [channelReply],
      {
        replyTurnStarted: () => false,
        renewLease: async () => { throw new Error("Reply claim is no longer active"); },
        runIssue: async (_work, signal) => {
          await new Promise<void>((resolve) => {
            if (signal.aborted) { aborted = true; resolve(); return; }
            signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
          });
        },
      },
      { renewalTicks: 1 },
    );
    const result = await runWorkerLoop(test.dependencies, {
      once: true,
      leaseRenewIntervalMs: 5 * 60_000,
    });
    expect(aborted).toBe(true);
    expect(result.failures).toBe(1);
    expect(test.logs.some((line) => line.includes("deferred to the steer fold"))).toBe(false);
  });

  it("still aborts a direct message once its provider turn has started", async () => {
    let aborted = false;
    const dmReply = {
      ...issue("dm-running"),
      workType: "channelReply" as const,
      workId: "dm-work",
      routing: null,
      snapshot: { channel: { kind: "dm" } },
    };
    const test = harness(
      [dmReply],
      {
        replyTurnStarted: () => true,
        renewLease: async () => { throw new Error("Reply claim is no longer active"); },
        runIssue: async (_work, signal) => {
          await new Promise<void>((resolve) => {
            if (signal.aborted) { aborted = true; resolve(); return; }
            signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
          });
        },
      },
      { renewalTicks: 1 },
    );
    const result = await runWorkerLoop(test.dependencies, {
      once: true,
      leaseRenewIntervalMs: 5 * 60_000,
    });
    expect(aborted).toBe(true);
    expect(result.failures).toBe(1);
    expect(test.logs.some((line) => line.includes("lease renewal failed"))).toBe(true);
  });

  it("polls exactly as before when no wake source is attached", async () => {
    let polls = 0;
    const test = harness([], {
      claim: async () => {
        polls += 1;
        return polls > 2 ? issue("issue-polled") : null;
      },
    });
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      idleDelayMs: 15_000,
      heartbeatIntervalMs: 10 * 60_000,
    });

    expect(result.processed).toBe(1);
    expect(test.sleeps).toEqual([15_000, 30_000]);
  });

  /*
    Reconstructing a two-minute DM reply meant guessing where the time before
    the claim went. These hold the account the loop now writes: the idle wait,
    what ended it, the claim RPC and the heartbeat that ran right before it.
  */
  describe("claim latency", () => {
    /** One measured claim latency line, decoded. */
    const claimLatency = (logs: readonly string[]) =>
      logs.flatMap((line) =>
        line.startsWith("claim latency: ")
          ? [JSON.parse(line.slice("claim latency: ".length))]
          : []
      );

    /** A loop whose every blocking step costs the fake clock something. */
    const timedHarness = (input: {
      claim: (attempt: number) => ClaimedIssue | null;
      claimRpcMs: number;
      heartbeatMs: number;
      wake?: WorkerLoopDependencies["wake"];
      sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
      clock: { value: number };
    }) => {
      let attempts = 0;
      return harness([], {
        now: () => input.clock.value,
        claim: async () => {
          attempts += 1;
          input.clock.value += input.claimRpcMs;
          return input.claim(attempts);
        },
        heartbeat: async () => {
          input.clock.value += input.heartbeatMs;
        },
        sleep: input.sleep ?? (async (milliseconds) => {
          input.clock.value += milliseconds;
        }),
        ...(input.wake ? { wake: input.wake } : {}),
      });
    };

    it("reports the poll it waited on and the claim RPC it paid for", async () => {
      const clock = { value: 0 };
      const test = timedHarness({
        clock,
        claimRpcMs: 40,
        heartbeatMs: 12,
        claim: (attempt) => attempt > 1 ? issue("issue-polled") : null,
      });
      await runWorkerLoop(test.dependencies, {
        maxIssues: 1,
        idleDelayMs: 15_000,
        heartbeatIntervalMs: 10 * 60_000,
        leaseRenewIntervalMs: 10 * 60_000,
      });

      expect(claimLatency(test.logs)).toEqual([
        {
          workId: null,
          rpcMs: 40,
          waitedMs: 15_000,
          wake: "poll",
          heartbeatMs: 0,
        },
      ]);
    });

    /*
      #1837 moved the heartbeat off the claim's critical path. `heartbeatMs` is
      what proves it stayed there: a beat that blocks is visible here rather
      than hidden inside the gap between two lines.
    */
    it("names the heartbeat the wait ended for, and what it blocked", async () => {
      const clock = { value: 0 };
      const test = timedHarness({
        clock,
        claimRpcMs: 40,
        heartbeatMs: 12,
        claim: (attempt) => attempt > 1 ? issue("issue-beaten") : null,
      });
      await runWorkerLoop(test.dependencies, {
        maxIssues: 1,
        idleDelayMs: 15_000,
        heartbeatIntervalMs: 10_000,
        leaseRenewIntervalMs: 10 * 60_000,
      });

      // The first beat costs 12ms and puts the next one 10s out, so the idle
      // wait is cut to it: 9_960ms rather than the 15s poll.
      expect(claimLatency(test.logs)).toEqual([
        {
          workId: null,
          rpcMs: 40,
          waitedMs: 9_960,
          wake: "heartbeat",
          heartbeatMs: 12,
        },
      ]);
    });

    it("names the server wake that cut the wait short", async () => {
      const clock = { value: 0 };
      const reply: ClaimedIssue = {
        ...issue("briar-channel:reply"),
        workType: "channelReply",
        workId: "reply-work-1",
      };
      let notify: ((reason: WorkerWakeReason) => void) | null = null;
      const idleWaits: number[] = [];
      const test = timedHarness({
        clock,
        claimRpcMs: 40,
        heartbeatMs: 12,
        claim: (attempt) => attempt > 1 ? reply : null,
        wake: {
          subscribe: (listener) => {
            notify = listener;
            return () => {};
          },
        },
        sleep: async (milliseconds, signal) => {
          // Only the lease renewal waits this long; it blocks until the loop
          // aborts it, exactly as the real timer does.
          if (milliseconds >= 100_000) {
            if (signal?.aborted) return;
            await new Promise<void>((resolve) => {
              signal?.addEventListener("abort", () => resolve(), { once: true });
            });
            return;
          }
          idleWaits.push(milliseconds);
          // The person's message lands three seconds into the poll wait.
          clock.value += 3_000;
          notify?.("channel_reply_enqueued");
        },
      });
      await runWorkerLoop(test.dependencies, {
        maxIssues: 1,
        idleDelayMs: 15_000,
        heartbeatIntervalMs: 10 * 60_000,
        leaseRenewIntervalMs: 10 * 60_000,
      });

      expect(idleWaits).toEqual([15_000]);
      expect(claimLatency(test.logs)).toEqual([
        {
          workId: "reply-work-1",
          rpcMs: 40,
          waitedMs: 3_000,
          wake: "channel_reply_enqueued",
          heartbeatMs: 0,
        },
      ]);
    });

    it("says a claim that followed another one waited on nothing", async () => {
      const clock = { value: 0 };
      const first = { ...issue("first"), workType: "channelReply" as const, workId: "a" };
      const second = { ...issue("second"), workType: "channelReply" as const, workId: "b" };
      const test = timedHarness({
        clock,
        claimRpcMs: 40,
        heartbeatMs: 12,
        claim: (attempt) => attempt === 1 ? first : attempt === 2 ? second : null,
      });
      await runWorkerLoop(test.dependencies, {
        maxIssues: 2,
        maxConcurrentSessions: 2,
        idleDelayMs: 15_000,
        heartbeatIntervalMs: 10 * 60_000,
        leaseRenewIntervalMs: 10 * 60_000,
      });

      const measured = claimLatency(test.logs);
      expect(measured).toHaveLength(2);
      expect(measured[0]).toMatchObject({ workId: "a", waitedMs: 0, wake: "poll" });
      // The heartbeat after the first claim is the one this claim waited on.
      expect(measured[1]).toMatchObject({
        workId: "b",
        waitedMs: 0,
        wake: "poll",
        heartbeatMs: 12,
      });
    });
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

  it("fills every configured session slot and reuses it after completion", async () => {
    let inFlight = 0;
    let observedMaximum = 0;
    let started = 0;
    const waiting: Array<() => void> = [];
    const test = harness(
      [issue("issue-1"), issue("issue-2"), issue("issue-3")],
      {
        runIssue: async () => {
          started += 1;
          inFlight += 1;
          observedMaximum = Math.max(observedMaximum, inFlight);
          if (started <= 2) {
            await new Promise<void>((resolve) => {
              waiting.push(resolve);
              if (waiting.length === 2) {
                for (const release of waiting.splice(0)) release();
              }
            });
          }
          inFlight -= 1;
        },
      },
    );
    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 3,
      maxConcurrentSessions: 2,
    });

    expect(result.processed).toBe(3);
    expect(observedMaximum).toBe(2);
  });

  it("runs three independent DM sessions and an issue reply while regular slots are full", async () => {
    const regularWork = [issue("issue-1")];
    const replyWork: ClaimedIssue[] = [
      ...["structure", "logs", "docs"].map((id) => ({
        ...issue(id), workType: "channelReply" as const, runId: "same-dm",
        workId: id, session: { id: `session-${id}` }, routing: { action: "new" },
      })),
      {
        ...issue("issue-reply"),
        workType: "issueReply",
        workId: "issue-reply",
      },
    ];
    const claimModes: boolean[] = [];
    const readinessStates: Array<"ready" | "busy" | undefined> = [];
    const replyReleases: Array<() => void> = [];
    let releaseRegular: (() => void) | undefined;
    let allReleased = false;
    let inFlight = 0;
    let observedMaximum = 0;

    const maybeRelease = () => {
      if (allReleased || replyReleases.length < 4 || !releaseRegular) return;
      allReleased = true;
      releaseRegular();
      for (const release of replyReleases.splice(0)) release();
    };
    const test = harness([], {
      claim: async (options) => {
        const repliesOnly = options?.repliesOnly === true;
        claimModes.push(repliesOnly);
        return repliesOnly
          ? replyWork.shift() ?? null
          : regularWork.shift() ?? null;
      },
      heartbeat: async (readinessState) => {
        readinessStates.push(readinessState);
      },
      runIssue: async (claimed) => {
        inFlight += 1;
        observedMaximum = Math.max(observedMaximum, inFlight);
        await new Promise<void>((resolve) => {
          if (isReplyWork(claimed)) {
            replyReleases.push(resolve);
            maybeRelease();
          } else {
            releaseRegular = resolve;
            maybeRelease();
          }
        });
        inFlight -= 1;
      },
    });

    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 5,
      maxConcurrentSessions: 1,
    });

    expect(result).toMatchObject({ processed: 5, failures: 0 });
    expect(observedMaximum).toBe(5);
    expect(claimModes.slice(0, 5)).toEqual([false, true, true, true, true]);
    expect(readinessStates).toContain("busy");
    expect(readinessStates.at(-1)).toBe("ready");
  });

  it("serializes repeated claims for one issue run without overlapping worktree mutations", async () => {
    const sharedRunId = "run-shared";
    const claims = [
      { ...issue("shared-r1"), runId: sharedRunId, executionId: "execution-1" },
      { ...issue("shared-r2"), runId: sharedRunId, executionId: "execution-2" },
      { ...issue("other"), executionId: "execution-3" },
      { ...issue("unexpected"), executionId: "execution-4" },
    ];
    let claimCount = 0;
    let releaseFirst = () => {};
    let sharedInFlight = 0;
    let maximumSharedInFlight = 0;
    const ranExecutionIds: string[] = [];
    const renewalSignals = new WeakSet<AbortSignal>();
    const test = harness(
      [],
      {
        claim: async (options) => {
          if (options?.repliesOnly) return null;
          const claimed = claims.shift() ?? null;
          if (claimed) claimCount += 1;
          return claimed;
        },
        heartbeat: async () => {
          if (claimCount === 2) releaseFirst();
        },
        runIssue: async (claimed) => {
          ranExecutionIds.push(claimed.executionId!);
          if (claimed.runId !== sharedRunId) return;
          sharedInFlight += 1;
          maximumSharedInFlight = Math.max(
            maximumSharedInFlight,
            sharedInFlight,
          );
          if (claimed.executionId === "execution-1") {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
          }
          sharedInFlight -= 1;
        },
        sleep: async (_milliseconds, signal) => {
          if (!signal || signal.aborted) return;
          if (!renewalSignals.has(signal)) {
            renewalSignals.add(signal);
            return;
          }
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true })
          );
        },
      },
    );

    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 3,
      maxConcurrentSessions: 2,
    });

    expect(result).toMatchObject({ processed: 3, failures: 0 });
    expect(maximumSharedInFlight).toBe(1);
    expect(ranExecutionIds).toHaveLength(3);
    expect(ranExecutionIds).not.toContain("execution-4");
    expect(test.renewals).toEqual(expect.arrayContaining([
      "shared-r1",
      "shared-r2",
    ]));
  });

  it("uses normal slots but serializes successive phases of one merge batch", async () => {
    const mergeBatch = (phase: string, token: string): ClaimedIssue => ({
      ...issue(`merge-${phase}`),
      workType: "mergeBatch",
      workId: "merge-batch-1",
      runId: "merge-batch-1",
      claimToken: token,
    });
    const queue = [
      mergeBatch("enqueue", "briar_merge_claim_one"),
      mergeBatch("validate", "briar_merge_claim_two"),
    ];
    let inFlight = 0;
    let maximumInFlight = 0;
    let releaseFirst = () => {};
    const test = harness([], {
      claim: async (options) => options?.repliesOnly ? null : queue.shift() ?? null,
      heartbeat: async () => {
        if (queue.length === 0) releaseFirst();
      },
      runIssue: async (claimed) => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        if (claimed.claimToken.endsWith("one")) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        inFlight -= 1;
      },
    });

    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 2,
      maxConcurrentSessions: 2,
    });

    expect(result.processed).toBe(2);
    expect(maximumInFlight).toBe(1);
  });

  it("adopts a device concurrency change from heartbeat", async () => {
    let inFlight = 0;
    let observedMaximum = 0;
    const waiting: Array<() => void> = [];
    const test = harness(
      [issue("issue-1"), issue("issue-2")],
      {
        heartbeat: async () => ({ maxConcurrentSessions: 2 }),
        runIssue: async () => {
          inFlight += 1;
          observedMaximum = Math.max(observedMaximum, inFlight);
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
            if (waiting.length === 2) {
              for (const release of waiting.splice(0)) release();
            }
          });
          inFlight -= 1;
        },
      },
    );
    await runWorkerLoop(test.dependencies, { maxIssues: 2 });

    expect(observedMaximum).toBe(2);
  });

  it("renews the lease while an issue is in flight", async () => {
    const test = harness([issue("issue-1")], {}, { renewalTicks: 1 });
    const result = await runWorkerLoop(test.dependencies, {
      once: true,
      leaseRenewIntervalMs: 5 * 60_000,
    });

    expect(result.processed).toBe(1);
    expect(test.renewals).toEqual(["issue-1"]);
  });

  it("aborts the execution when a lease renewal fails", async () => {
    let aborted = false;
    const test = harness(
      [issue("issue-1")],
      {
        renewLease: async () => {
          throw new Error("claim token is no longer active");
        },
        runIssue: async (_issue, signal) => {
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              aborted = true;
              resolve();
              return;
            }
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            }, { once: true });
          });
        },
      },
      { renewalTicks: 1 },
    );
    const result = await runWorkerLoop(test.dependencies, {
      once: true,
      leaseRenewIntervalMs: 5 * 60_000,
    });

    expect(result.processed).toBe(0);
    expect(result.failures).toBe(1);
    expect(aborted).toBe(true);
    expect(test.logs.some((line) => line.includes("lease renewal failed"))).toBe(true);
  });

  it("hands an active provider to the next Worker during a planned update", async () => {
    let heartbeatCount = 0;
    let providerAborted = false;
    const handoffs: Array<{
      requestId: string;
      conversationId: string | null | undefined;
      workspacePath: string | null | undefined;
    }> = [];
    const test = harness([issue("issue-update")], {
      heartbeat: async () => {
        heartbeatCount += 1;
        return heartbeatCount >= 2
          ? {
              acceptingWork: false,
              updateDirective: {
                id: "update-request",
                targetVersion: "2.0.0",
                status: "requested" as const,
                requestedAt: new Date(0).toISOString(),
                handoffState: "draining" as const,
              },
            }
          : { acceptingWork: true };
      },
      runIssue: async (_claimed, signal, reportCheckpoint) => {
        reportCheckpoint({
          conversationId: "conversation-before-update",
          workspacePath: "/tmp/worker-update-worktree",
        });
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            providerAborted = true;
            resolve();
            return;
          }
          signal.addEventListener("abort", () => {
            providerAborted = true;
            resolve();
          }, { once: true });
        });
      },
      handoff: async (_claimed, requestId, checkpoint) => {
        handoffs.push({
          requestId,
          conversationId: checkpoint.conversationId,
          workspacePath: checkpoint.workspacePath,
        });
      },
    });

    const result = await runWorkerLoop(test.dependencies, { once: true });

    expect(result).toEqual({
      processed: 0,
      failures: 0,
      stoppedBecause: "emptyQueue",
    });
    expect(providerAborted).toBe(true);
    expect(handoffs).toEqual([{
      requestId: "update-request",
      conversationId: "conversation-before-update",
      workspacePath: "/tmp/worker-update-worktree",
    }]);
    expect(test.logs).toContain(
      "handed off issue-update for planned Worker update",
    );
  });

  it("preserves the update directive for the worker loop", () => {
    const updateDirective = {
      id: "update-request",
      targetVersion: "2.0.0",
      status: "requested" as const,
      requestedAt: new Date(0).toISOString(),
      handoffState: "draining" as const,
    };

    expect(createWorkerLoopHeartbeat({
      acceptingWork: false,
      maxConcurrentSessions: 2,
      updateDirective,
    })).toEqual({
      acceptingWork: false,
      maxConcurrentSessions: 2,
      updateDirective,
    });
  });

  it("finishes the budgeted memory-learning transaction without replaying it during drain", async () => {
    let heartbeatCount = 0;
    let completed = false;
    const test = harness([{ ...issue("memory-update"), workType: "dmMemory" }], {
      heartbeat: async () => ++heartbeatCount >= 2 ? {
        acceptingWork: false, updateDirective: { id: "update-request", targetVersion: "2.0.0",
          status: "requested", requestedAt: new Date(0).toISOString(), handoffState: "draining" },
      } : { acceptingWork: true },
      runIssue: async (_claimed, signal) => {
        await Promise.resolve();
        await Promise.resolve();
        expect(signal.aborted).toBe(false);
        completed = true;
      },
      handoff: async () => { throw new Error("Memory transaction must not be replayed"); },
    });
    const result = await runWorkerLoop(test.dependencies, { once: true });
    expect(completed).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.failures).toBe(0);
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

  it("jitters heartbeat and retry delays inside their configured bands", () => {
    expect(heartbeatDelayMs(DEFAULT_HEARTBEAT_INTERVAL_MS, () => 0)).toBe(27_000);
    expect(heartbeatDelayMs(DEFAULT_HEARTBEAT_INTERVAL_MS, () => 0.5)).toBe(
      30_000,
    );
    expect(heartbeatDelayMs(DEFAULT_HEARTBEAT_INTERVAL_MS, () => 1)).toBe(33_000);
    expect(heartbeatErrorDelayMs(1, 30_000, () => 0)).toBe(1_600);
    expect(heartbeatErrorDelayMs(2, 30_000, () => 1)).toBe(4_800);
  });

  it("jitters empty-queue backoff without exceeding its configured band", () => {
    expect(idleDelayWithBackoffMs(1, 15_000, 60_000, () => 0)).toBe(12_000);
    expect(idleDelayWithBackoffMs(2, 15_000, 60_000, () => 0.5)).toBe(30_000);
    expect(idleDelayWithBackoffMs(50, 15_000, 60_000, () => 1)).toBe(
      DEFAULT_MAX_IDLE_DELAY_MS,
    );
  });

  it("obeys a short server retry hint but floors a long one with backoff", () => {
    expect(emptyClaimDelayMs({
      serverDelayMs: 2_000,
      consecutiveEmptyClaims: 5,
      idleDelayMs: 15_000,
      maxIdleDelayMs: 60_000,
      random: () => 0.5,
    })).toBe(2_000);
    expect(emptyClaimDelayMs({
      serverDelayMs: null,
      consecutiveEmptyClaims: 1,
      idleDelayMs: 15_000,
      maxIdleDelayMs: 60_000,
      random: () => 0.5,
    })).toBe(15_000);
    expect(emptyClaimDelayMs({
      serverDelayMs: 20_000,
      consecutiveEmptyClaims: 2,
      idleDelayMs: 15_000,
      maxIdleDelayMs: 60_000,
      random: () => 0.5,
    })).toBe(40_000);
  });

  it("jitters five-minute lease renewal without approaching expiry", () => {
    expect(leaseRenewDelayMs(5 * 60_000, () => 0)).toBe(4.5 * 60_000);
    expect(leaseRenewDelayMs(5 * 60_000, () => 0.5)).toBe(5 * 60_000);
    expect(leaseRenewDelayMs(5 * 60_000, () => 1)).toBe(5.5 * 60_000);
  });

  it("heartbeats on the first iteration and then on the interval", async () => {
    const test = harness([issue("issue-1"), issue("issue-2")]);
    await runWorkerLoop(test.dependencies, {
      maxIssues: 2,
      heartbeatIntervalMs: 60_000,
    });

    // Initial readiness plus busy/ready transitions for each issue.
    expect(test.heartbeats).toBe(5);
  });

  it("uses the short heartbeat cadence only while an update is draining", async () => {
    let heartbeats = 0;
    const test = harness([], {
      heartbeat: async () => {
        heartbeats += 1;
        if (heartbeats === 2) {
          return {
            acceptingWork: false,
            updateDirective: {
              id: "update-request",
              targetVersion: "2.0.0",
              status: "requested" as const,
              requestedAt: new Date(0).toISOString(),
              handoffState: "draining" as const,
            },
          };
        }
        if (heartbeats === 3) {
          return { acceptingWork: true, updateDirective: null };
        }
        return { acceptingWork: true };
      },
      claim: async () => heartbeats >= 3 ? issue("issue-after-drain") : null,
    });

    const result = await runWorkerLoop(test.dependencies, { maxIssues: 1 });

    expect(result.processed).toBe(1);
    expect(test.sleeps).toEqual([
      15_000,
      15_000,
      DEFAULT_DRAIN_HEARTBEAT_INTERVAL_MS,
    ]);
  });

  it("backs off a disconnected heartbeat and reports promptly after reconnect", async () => {
    let heartbeatAttempts = 0;
    const test = harness([issue("issue-after-reconnect")], {
      heartbeat: async () => {
        heartbeatAttempts += 1;
        if (heartbeatAttempts <= 6) throw new Error("network disconnected");
        return { acceptingWork: true };
      },
    });

    const result = await runWorkerLoop(test.dependencies, { maxIssues: 1 });

    expect(result).toMatchObject({ processed: 1, failures: 6 });
    expect(test.sleeps).toEqual([
      2_000,
      4_000,
      8_000,
      16_000,
      DEFAULT_MAX_HEARTBEAT_ERROR_DELAY_MS,
      DEFAULT_MAX_HEARTBEAT_ERROR_DELAY_MS,
    ]);
    expect(heartbeatAttempts).toBeGreaterThanOrEqual(7);
  });

  it("does not claim work until the heartbeat reports a healthy provider", async () => {
    let heartbeats = 0;
    let claims = 0;
    const test = harness([issue("issue-after-login")], {
      heartbeat: async () => {
        heartbeats += 1;
        return { acceptingWork: heartbeats > 1 };
      },
      claim: async () => {
        claims += 1;
        return issue("issue-after-login");
      },
    });

    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      heartbeatIntervalMs: 1,
      idleDelayMs: 1,
    });

    expect(result.processed).toBe(1);
    expect(heartbeats).toBeGreaterThanOrEqual(2);
    expect(claims).toBe(1);
  });

  it("keeps heartbeating while every session slot is occupied", async () => {
    const readinessStates: Array<"ready" | "busy" | undefined> = [];
    const wakeDelays: number[] = [];
    let finishIssue: (() => void) | undefined;
    let clock = 0;
    const test = harness([issue("issue-long")], {
      heartbeat: async (readinessState) => {
        readinessStates.push(readinessState);
        if (
          readinessStates.filter((state) => state === "busy").length === 2
        ) {
          finishIssue?.();
        }
      },
      runIssue: async () => {
        await new Promise<void>((resolve) => {
          finishIssue = resolve;
        });
      },
      sleep: async (milliseconds, signal) => {
        if (milliseconds === 60_000) {
          wakeDelays.push(milliseconds);
          clock += milliseconds;
          return;
        }
        if (signal?.aborted) return;
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      now: () => clock,
    });

    const result = await runWorkerLoop(test.dependencies, {
      maxIssues: 1,
      maxConcurrentSessions: 1,
      heartbeatIntervalMs: 60_000,
    });

    expect(result.processed).toBe(1);
    expect(
      readinessStates.filter((state) => state === "busy").length,
    ).toBeGreaterThanOrEqual(2);
    expect(wakeDelays).toContain(60_000);
  });
});

describe("worker identity", () => {
  it("isolates issue runtime directories by execution identity", () => {
    const configDirectory = join("/private", "briar-config");
    const first = issueWorkerSessionDirectory(configDirectory, {
      runId: "run-42",
      executionId: "execution-1",
    });
    const second = issueWorkerSessionDirectory(configDirectory, {
      runId: "run-42",
      executionId: "execution-2",
    });

    expect(first).toBe(
      join(configDirectory, "worker-sessions", "run-42--execution-1"),
    );
    expect(second).toBe(
      join(configDirectory, "worker-sessions", "run-42--execution-2"),
    );
    expect(first).not.toBe(second);
    expect(first).not.toBe(join(configDirectory, "worker-sessions", "run-42"));
  });

  it("creates an opaque random device identity for local persistence", () => {
    expect(createWorkerDeviceIdentity(() => "a".repeat(64))).toBe(
      `briar_device_${"a".repeat(64)}`,
    );
    expect(() => createWorkerDeviceIdentity(() => "not-random")).toThrow(
      "32 random bytes",
    );
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
    environmentPath:
      "/Users/dev/.local/bin:/opt/homebrew/bin:/usr/bin:/bin",
  };

  it("builds a launchd agent that restarts and logs", () => {
    const definition = serviceDefinition({ ...input, platform: "darwin" });
    expect(definition.path).toBe(
      `/Users/dev/Library/LaunchAgents/${serviceLabel(projectId)}.plist`,
    );
    expect(definition.contents).toContain("<key>KeepAlive</key>");
    expect(definition.contents).toContain("<key>RunAtLoad</key>");
    expect(definition.contents).toContain("<key>EnvironmentVariables</key>");
    expect(definition.contents).toContain("<key>PATH</key>");
    expect(definition.contents).toContain("<key>BRIAR_CLI</key>");
    expect(definition.contents).toContain(
      "<string>/Users/dev/.local/bin/briar</string>",
    );
    expect(definition.contents).toContain(
      "<string>/Users/dev/.local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>",
    );
    expect(definition.contents).toContain(workerLogPath(projectId, "/Users/dev"));
    expect(definition.enableCommand[0]).toBe("launchctl");
    expect(definition.restartCommand).toEqual([
      "launchctl",
      "kickstart",
      "-k",
      `gui/${process.getuid?.() ?? 501}/${serviceLabel(projectId)}`,
    ]);
  });

  it("recognizes an already-removed launchd service", () => {
    const definition = serviceDefinition({ ...input, platform: "darwin" });

    expect(launchdServiceTarget(definition)).toBe(
      `gui/${process.getuid?.() ?? 501}/${serviceLabel(projectId)}`,
    );
    expect(
      isLaunchdServiceNotFound(
        `Could not find service "${serviceLabel(projectId)}" in domain for user gui`,
      ),
    ).toBe(true);
    expect(isLaunchdServiceNotFound("Boot-out failed: 5: Input/output error"))
      .toBe(false);
  });

  it("runs a packaged CLI with the bundled runtime on macOS", () => {
    const previousCli = process.env.BRIAR_CLI;
    delete process.env.BRIAR_CLI;
    try {
      const definition = serviceDefinition({
        ...input,
        platform: "darwin",
        runtimeBinary: "/Applications/Briar.app/Contents/MacOS/bun",
        cliScript: "/Users/dev/.local/share/briar/briar.js",
      });
      expect(definition.contents).toContain(
        "<string>/Applications/Briar.app/Contents/MacOS/bun</string>",
      );
      expect(definition.contents).toContain(
        "<string>/Users/dev/.local/share/briar/briar.js</string>",
      );
      expect(definition.contents).toContain(
        "<string>/Users/dev/.local/bin/briar</string>",
      );
    } finally {
      if (previousCli === undefined) {
        delete process.env.BRIAR_CLI;
      } else {
        process.env.BRIAR_CLI = previousCli;
      }
    }
  });

  it("inherits the installer PATH when no service PATH is provided", () => {
    const previousPath = process.env.PATH;
    process.env.PATH = "/Users/dev/.local/bin:/opt/homebrew/bin:/usr/bin:/bin";
    try {
      const definition = serviceDefinition({
        ...input,
        platform: "darwin",
        environmentPath: undefined,
      });
      expect(definition.contents).toContain(
        `<key>PATH</key>
    <string>${process.env.PATH}</string>`,
      );
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it("keeps the user CLI ahead of the desktop app bundle", () => {
    const environmentPath = workerExecutionPath(
      "/Applications/Briar.app/Contents/MacOS:/Users/dev/.local/bin:/usr/bin",
      "/Users/dev",
    );
    expect(environmentPath).toBe(
      "/Users/dev/.local/bin:/Applications/Briar.app/Contents/MacOS:/usr/bin",
    );
    expect(
      workerCliPath(
        "/Users/dev",
        "/Applications/Briar.app/Contents/MacOS/briar",
      ),
    ).toBe("/Users/dev/.local/bin/briar");
    expect(workerCliPath("/Users/dev", "briar")).toBe(
      "/Users/dev/.local/bin/briar",
    );
  });

  it("requires the packaged runtime and CLI script together", () => {
    expect(() =>
      serviceDefinition({
        ...input,
        platform: "darwin",
        runtimeBinary: "/Applications/Briar.app/Contents/MacOS/bun",
      }),
    ).toThrow(/configured together/u);
  });

  it("escapes packaged runtime paths in launchd plists", () => {
    const definition = serviceDefinition({
      ...input,
      platform: "darwin",
      runtimeBinary: "/Applications/Briar & Test.app/Contents/MacOS/bun",
      cliScript: "/Users/dev/<briar>/briar.js",
      environmentPath: "/Users/dev/bin&tools:/usr/bin",
    });
    expect(definition.contents).toContain(
      "<string>/Applications/Briar &amp; Test.app/Contents/MacOS/bun</string>",
    );
    expect(definition.contents).toContain(
      "<string>/Users/dev/&lt;briar&gt;/briar.js</string>",
    );
    expect(definition.contents).toContain(
      "<string>/Users/dev/.local/bin:/Users/dev/bin&amp;tools:/usr/bin</string>",
    );
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
    expect(definition.restartCommand).toEqual([
      "systemctl",
      "--user",
      "restart",
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
    ).toContain(`worker --team ${projectId}`);
  });

  it("refuses platforms it cannot manage, in Korean", () => {
    expect(() => serviceDefinition({ ...input, platform: "win32" })).toThrow(
      /지원하지 않습니다/u,
    );
  });

  it("restarts only installed worker services", () => {
    const installed = serviceDefinition({ ...input, platform: "darwin" });
    const missing = serviceDefinition({
      ...input,
      projectId: "22222222-2222-4222-8222-222222222222",
      platform: "darwin",
    });
    const commands: string[][] = [];

    expect(
      restartInstalledServices([installed, missing], {
        exists: (path) => path === installed.path,
        run: (command) => {
          commands.push(command);
          return { success: true };
        },
      }),
    ).toEqual({ restarted: 1, skipped: 1 });
    expect(commands).toEqual([installed.restartCommand]);
  });

  it("removes a disabled worker service definition idempotently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-worker-service-"));
    const definition = {
      ...serviceDefinition({ ...input, platform: "darwin" }),
      path: join(directory, "worker.plist"),
    };
    try {
      await writeFile(definition.path, definition.contents);
      await removeServiceDefinition(definition);
      await expect(access(definition.path)).rejects.toThrow();
      await expect(removeServiceDefinition(definition)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reports worker service restart failures", () => {
    const definition = serviceDefinition({ ...input, platform: "darwin" });
    expect(() =>
      restartInstalledServices([definition], {
        exists: () => true,
        run: () => ({ success: false, error: "service unavailable" }),
      }),
    ).toThrow(`${definition.label}: service unavailable`);
  });
});
