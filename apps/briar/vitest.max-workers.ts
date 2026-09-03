import { availableParallelism, cpus } from "node:os";

const detected = (() => {
  try {
    return availableParallelism();
  } catch {
    return cpus().length;
  }
})();

/**
 * Resolves the Vitest worker count.
 *
 * `VITEST_MAX_WORKERS` always wins so CI and constrained machines can pin a
 * value (it is in `globalPassThroughEnv`, so it never enters a Turborepo cache
 * key). Otherwise we scale to the machine's available parallelism instead of
 * the previous hard-coded 4.
 *
 * @param cap Upper bound applied when no override is set. Miniflare-backed
 * suites pass a cap because every worker boots its own workerd process with an
 * isolated SQLite-backed D1; beyond roughly 8 the process and memory overhead
 * outweighs the extra parallelism and the suites get flaky on timeouts.
 */
export function resolveMaxWorkers(cap = detected): number {
  const override = Number(process.env.VITEST_MAX_WORKERS);
  if (Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return Math.max(1, Math.min(detected, cap));
}
