import { describe, expect, it } from "vitest";
import {
  createBackgroundSweep,
  createWorkerRuntimeProbes,
} from "./worker-runtime-probes";

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createWorkerRuntimeProbes", () => {
  it("serves the cached reading and refreshes in the background once stale", async () => {
    let clock = 1_000;
    let probes = 0;
    const runtime = createWorkerRuntimeProbes({
      probe: async () => {
        await Promise.resolve();
        probes += 1;
        return `reading-${probes}`;
      },
      now: () => clock,
      ttlMs: 60_000,
      log: () => undefined,
    });

    // Nothing probed yet: the caller decides whether to await the first one.
    expect(runtime.snapshot()).toBeNull();
    await flush();
    expect(probes).toBe(1);
    expect(runtime.snapshot()).toEqual({
      value: "reading-1",
      probedAt: 1_000,
    });

    clock = 30_000;
    expect(runtime.snapshot()?.value).toBe("reading-1");
    await flush();
    expect(probes).toBe(1);

    clock = 61_000;
    // Stale: the reading is still the old one and the refresh is not awaited.
    expect(runtime.snapshot()?.value).toBe("reading-1");
    expect(probes).toBe(1);
    await flush();
    expect(probes).toBe(2);
    expect(runtime.snapshot()).toEqual({
      value: "reading-2",
      probedAt: 61_000,
    });
  });

  it("never runs two refreshes at once", async () => {
    let clock = 0;
    let started = 0;
    const gate = deferred<void>();
    const runtime = createWorkerRuntimeProbes({
      probe: async () => {
        started += 1;
        await gate.promise;
        return started;
      },
      now: () => clock,
      ttlMs: 1_000,
      log: () => undefined,
    });

    const first = runtime.refreshNow();
    clock = 10_000;
    runtime.snapshot();
    runtime.snapshot();
    const second = runtime.refreshNow();
    expect(started).toBe(1);

    gate.resolve();
    expect((await first).value).toBe(1);
    expect((await second).value).toBe(1);
    expect(started).toBe(1);

    clock = 20_000;
    await runtime.refreshNow();
    expect(started).toBe(2);
  });

  it("keeps the previous reading and logs one line when a refresh fails", async () => {
    let clock = 0;
    let attempt = 0;
    const lines: string[] = [];
    const runtime = createWorkerRuntimeProbes({
      probe: async () => {
        attempt += 1;
        if (attempt === 2) throw new Error("agy CLI timed out");
        return `reading-${attempt}`;
      },
      now: () => clock,
      ttlMs: 60_000,
      log: (line) => lines.push(line),
    });

    await runtime.refreshNow();
    clock = 90_000;
    expect(runtime.snapshot()?.value).toBe("reading-1");
    await flush();

    expect(runtime.snapshot()).toEqual({ value: "reading-1", probedAt: 0 });
    expect(lines).toEqual([
      "worker runtime probes refresh failed (probeAgeMs=90000): agy CLI timed out",
    ]);
  });

  it("reports a slow refresh once", async () => {
    let clock = 0;
    const lines: string[] = [];
    const runtime = createWorkerRuntimeProbes({
      probe: async () => {
        clock += 4_200;
        return "reading";
      },
      now: () => clock,
      log: (line) => lines.push(line),
    });
    await runtime.refreshNow();
    expect(lines).toEqual(["worker runtime probes refreshed in 4200ms"]);
  });

  it("stops kicking background refreshes after stop()", async () => {
    let clock = 0;
    let probes = 0;
    const runtime = createWorkerRuntimeProbes({
      probe: async () => {
        probes += 1;
        return probes;
      },
      now: () => clock,
      ttlMs: 1_000,
      log: () => undefined,
    });
    await runtime.refreshNow();
    runtime.stop();
    clock = 100_000;
    expect(runtime.snapshot()?.value).toBe(1);
    await flush();
    expect(probes).toBe(1);
  });
});

describe("createBackgroundSweep", () => {
  it("runs when due, never overlaps, and never rejects the kicking caller", async () => {
    let clock = 0;
    let runs = 0;
    const gate = deferred<void>();
    const sweep = createBackgroundSweep({
      intervalMs: 5_000,
      now: () => clock,
      run: async () => {
        runs += 1;
        if (runs === 1) await gate.promise;
      },
    });

    sweep.kick();
    expect(runs).toBe(1);
    clock = 60_000;
    sweep.kick();
    expect(runs).toBe(1);

    gate.resolve();
    await sweep.settled();
    sweep.kick();
    expect(runs).toBe(2);
    await sweep.settled();

    // Not due yet.
    sweep.kick();
    expect(runs).toBe(2);
  });

  it("logs a throwing sweep instead of failing the caller", async () => {
    const lines: string[] = [];
    const sweep = createBackgroundSweep({
      intervalMs: 1,
      run: async () => {
        throw new Error("worktree list failed");
      },
      log: (line) => lines.push(line),
    });
    sweep.kick();
    await sweep.settled();
    expect(lines).toEqual([
      "worker background sweep failed: worktree list failed",
    ]);
  });

  it("stays quiet after stop()", async () => {
    let runs = 0;
    const sweep = createBackgroundSweep({
      intervalMs: 1,
      run: async () => {
        runs += 1;
      },
    });
    sweep.stop();
    sweep.kick();
    await sweep.settled();
    expect(runs).toBe(0);
  });
});
