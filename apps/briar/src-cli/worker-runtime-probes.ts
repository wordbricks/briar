/**
 * Keeps the Worker's runtime probes off the claim path.
 *
 * Reading provider health, capabilities and versions means spawning every
 * provider CLI (measured at 3.0 s warm and 11.6 s cold), and the loop awaits
 * its heartbeat before every claim. A wake that landed on a due heartbeat
 * therefore paid the whole probe before the claim RPC even started. The
 * scheduler below keeps the last reading in memory so a heartbeat reports
 * immediately, and refreshes that reading in the background once it is older
 * than the TTL.
 */

/** Refresh a reading older than this the next time a heartbeat reads it. */
export const WORKER_RUNTIME_PROBE_TTL_MS = 60_000;

const SLOW_REFRESH_LOG_MS = 2_000;

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export type WorkerRuntimeProbeSnapshot<T> = {
  readonly value: T;
  readonly probedAt: number;
};

export type WorkerRuntimeProbes<T> = {
  /**
   * The most recent reading, or null before the first one lands. Kicks a
   * background refresh when the reading is stale and never awaits it.
   */
  snapshot: () => WorkerRuntimeProbeSnapshot<T> | null;
  /** Probe and await the result; used where the report must be accurate now. */
  refreshNow: () => Promise<WorkerRuntimeProbeSnapshot<T>>;
  /** Stop kicking refreshes. A refresh already in flight is left to settle. */
  stop: () => void;
};

export type WorkerRuntimeProbesOptions<T> = {
  probe: () => Promise<T>;
  now?: () => number;
  ttlMs?: number;
  log?: (line: string) => void;
};

export function createWorkerRuntimeProbes<T>({
  probe,
  now = Date.now,
  ttlMs = WORKER_RUNTIME_PROBE_TTL_MS,
  log = (line: string) => console.log(line),
}: WorkerRuntimeProbesOptions<T>): WorkerRuntimeProbes<T> {
  let latest: WorkerRuntimeProbeSnapshot<T> | null = null;
  let inFlight: Promise<WorkerRuntimeProbeSnapshot<T>> | null = null;
  let stopped = false;

  const probeAgeMs = () => {
    const current = latest;
    return current === null ? "unknown" : `${now() - current.probedAt}`;
  };

  const refresh = () => {
    const running = inFlight;
    // One refresh at a time: a slow probe must never stack up behind the
    // heartbeat cadence and multiply the CLI spawns it makes.
    if (running) return running;
    const startedAt = now();
    const started = probe().then(
      (value) => {
        const snapshot = { value, probedAt: now() };
        latest = snapshot;
        const elapsedMs = now() - startedAt;
        if (elapsedMs >= SLOW_REFRESH_LOG_MS) {
          log(`worker runtime probes refreshed in ${elapsedMs}ms`);
        }
        return snapshot;
      },
      (error: unknown) => {
        // Keep the previous reading: a probe failure must not blank the
        // runtime the server sees.
        log(
          `worker runtime probes refresh failed (probeAgeMs=${probeAgeMs()}): ${
            describeError(error)
          }`,
        );
        throw error;
      },
    );
    const settling = started.finally(() => {
      inFlight = null;
    });
    inFlight = settling;
    return settling;
  };

  return {
    snapshot: () => {
      const current = latest;
      const stale = current === null || now() - current.probedAt >= ttlMs;
      if (stale && !stopped) void refresh().catch(() => undefined);
      return current;
    },
    refreshNow: refresh,
    stop: () => {
      stopped = true;
    },
  };
}

export type BackgroundSweep = {
  /** Run the sweep when it is due and not already running; never awaits it. */
  kick: () => void;
  /** Resolves once no sweep is in flight. */
  settled: () => Promise<void>;
  stop: () => void;
};

export type BackgroundSweepOptions = {
  /** Minimum gap between two sweep starts. */
  intervalMs: number;
  run: () => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
};

/**
 * A periodic maintenance job the heartbeat kicks but never awaits. The job
 * reports its own outcome; anything it still throws is logged here instead of
 * failing the heartbeat that kicked it.
 */
export function createBackgroundSweep({
  intervalMs,
  run,
  now = Date.now,
  log = (line: string) => console.error(line),
}: BackgroundSweepOptions): BackgroundSweep {
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  return {
    kick: () => {
      if (stopped || inFlight !== null) return;
      if (now() - lastStartedAt < intervalMs) return;
      lastStartedAt = now();
      inFlight = (async () => {
        await run();
      })()
        .catch((error: unknown) => {
          log(`worker background sweep failed: ${describeError(error)}`);
        })
        .finally(() => {
          inFlight = null;
        });
    },
    settled: async () => {
      let running = inFlight;
      while (running) {
        await running;
        running = inFlight;
      }
    },
    stop: () => {
      stopped = true;
    },
  };
}
