/**
 * Timestamps on the long-running Worker's own log.
 *
 * The service writes stdout and stderr into
 * `~/.local/state/briar/worker/<projectId>.log`, and until now the only lines
 * in it that said when anything happened were the `[briar-agent-runner]` JSON
 * diagnostics — which a memory-backed reply suppresses almost entirely. Every
 * other line ("claimed …", "execution started …", "finished …") had to be
 * placed against D1 rows and file mtimes to reconstruct a reply's timeline.
 *
 * The prefix is installed once at the Worker command boundary rather than at
 * the call sites, so nothing that logs has to know about it, and one-shot CLI
 * commands keep their bare output.
 */

/** The console methods the Worker process writes its log through. */
const timestampedMethods = ["log", "warn", "error"] as const;

type TimestampedMethod = (typeof timestampedMethods)[number];

export type TimestampedConsole = Pick<Console, TimestampedMethod>;

/**
 * `BRIAR_WORKER_LOG_TIMESTAMPS=0` (or `false`) turns the prefix off, for a
 * test that reads the Worker's output and for a human tailing the log who
 * would rather not have it.
 */
export function workerLogTimestampsEnabled(setting: string | undefined): boolean {
  return setting !== "0" && setting !== "false";
}

/** `2026-09-10T02:14:05.123Z`: UTC, milliseconds, sortable. */
export function workerLogTimestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

/**
 * The prefix goes on the first line and nowhere else: a JSON blob, a stack
 * trace or a provider's own multi-line output keeps the shape it was written
 * with. A leading format string keeps its position so `%s` substitution still
 * lines up with the arguments after it.
 */
export function timestampedLogArguments(
  stamp: string,
  values: readonly unknown[],
): unknown[] {
  const [first, ...rest] = values;
  if (values.length === 0) return [stamp];
  return typeof first === "string"
    ? [`${stamp} ${first}`, ...rest]
    : [stamp, first, ...rest];
}

let installed = false;

/**
 * Wrap `console.log`/`warn`/`error` so every line the Worker writes carries an
 * ISO-8601 UTC timestamp. Returns the restore function; installing twice is a
 * no-op, so a nested command cannot double-prefix a line.
 */
export function installWorkerLogTimestamps(options: {
  now?: () => number;
  target?: TimestampedConsole;
  enabled?: boolean;
} = {}): () => void {
  const enabled = options.enabled ??
    workerLogTimestampsEnabled(process.env.BRIAR_WORKER_LOG_TIMESTAMPS);
  if (!enabled || installed) return () => {};
  const now = options.now ?? Date.now;
  const target = options.target ?? console;
  const original = new Map<TimestampedMethod, TimestampedConsole[TimestampedMethod]>(
    timestampedMethods.map((method) => [method, target[method].bind(target)]),
  );
  for (const method of timestampedMethods) {
    const write = original.get(method)!;
    target[method] = (...values: unknown[]) => {
      write(...timestampedLogArguments(workerLogTimestamp(now()), values));
    };
  }
  installed = true;
  return () => {
    for (const method of timestampedMethods) {
      target[method] = original.get(method)!;
    }
    installed = false;
  };
}
