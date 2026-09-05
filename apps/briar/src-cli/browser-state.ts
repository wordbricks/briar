import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import * as Schema from "effect/Schema";

/**
 * Shared login state for `agent-browser`.
 *
 * Every Briar Agent run starts its own `agent-browser` session, so a login a
 * run performs would die with that session. Chrome allows a single process per
 * user-data-dir, which rules out a shared persistent profile for concurrently
 * running Agents. Instead each session starts from, and merges back into, one
 * Playwright `storageState` file: browsers stay separate, login state travels.
 *
 * The file holds plaintext cookies, so it is written 0600 inside a 0700
 * directory and never printed.
 */

const stateFileEnvironmentVariable = "BRIAR_AGENT_BROWSER_STATE_FILE";

/** Retry budget for taking the cross-process lock before giving up. */
const lockTimeoutMs = 10_000;
/** Wait between lock attempts. Merges hold the lock for a few milliseconds. */
const lockRetryIntervalMs = 50;
/** A lock this old belongs to a process that died before releasing it. */
const staleLockMs = 60_000;

/**
 * Playwright's `storageState` shape. Only the fields the merge keys on are
 * required: `agent-browser` versions differ in which cookie attributes they
 * emit, and unknown extra fields must never cost a run its logins.
 */
const StateCookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.optional(Schema.String),
  expires: Schema.optional(Schema.Finite),
  httpOnly: Schema.optional(Schema.Boolean),
  secure: Schema.optional(Schema.Boolean),
  sameSite: Schema.optional(Schema.Literals(["Strict", "Lax", "None"])),
});
export type StateCookie = typeof StateCookie.Type;

const StateStorageItem = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
});

const StateOrigin = Schema.Struct({
  origin: Schema.String,
  localStorage: Schema.optional(Schema.Array(StateStorageItem)),
});
export type StateOrigin = typeof StateOrigin.Type;

const SharedState = Schema.Struct({
  cookies: Schema.optional(Schema.Array(StateCookie)),
  origins: Schema.optional(Schema.Array(StateOrigin)),
});

export type SharedState = {
  cookies: readonly StateCookie[];
  origins: readonly StateOrigin[];
};

const decodeSharedState = Schema.decodeUnknownSync(
  Schema.fromJsonString(SharedState),
  { errors: "all" },
);

export const emptySharedState: SharedState = { cookies: [], origins: [] };

export type SharedStateSummary = {
  path: string;
  cookies: number;
  origins: number;
};

export type SharedStateMergeSummary = SharedStateSummary & {
  added: number;
  replaced: number;
  expired: number;
};

export type SharedStateDependencies = {
  /** Current epoch milliseconds. Injected so tests can drive lock expiry. */
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
};

export type SharedStateOptions = {
  /** Explicit state file, ahead of the environment and the default path. */
  path?: string;
  environment?: NodeJS.ProcessEnv;
  home?: string;
} & Partial<SharedStateDependencies>;

/** Where the shared state lives when nothing overrides it. */
export function defaultSharedStatePath(home: string = homedir()) {
  return join(home, ".local", "share", "briar", "agent-browser", "shared-state.json");
}

/**
 * The state file this process should use. Auto Hunt runs the CLI under a
 * wrapper that swaps `HOME`, so Briar passes the real path in the environment
 * and it wins over the `~`-derived default.
 */
export function sharedStatePath(options: SharedStateOptions = {}) {
  if (options.path) return options.path;
  const environment = options.environment ?? process.env;
  const configured = environment[stateFileEnvironmentVariable]?.trim();
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new Error(`${stateFileEnvironmentVariable} must be an absolute path`);
    }
    return configured;
  }
  return defaultSharedStatePath(options.home);
}

const dependenciesOf = (options: SharedStateOptions): SharedStateDependencies => ({
  now: options.now ?? Date.now,
  sleep: options.sleep ??
    ((milliseconds) =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))),
});

const hasCode = (error: unknown, code: string) =>
  Boolean(
    error && typeof error === "object" && "code" in error && error.code === code,
  );

const summaryOf = (path: string, state: SharedState): SharedStateSummary => ({
  path,
  cookies: state.cookies.length,
  origins: state.origins.length,
});

const cookieKey = (cookie: StateCookie) =>
  JSON.stringify([cookie.name, cookie.domain, cookie.path ?? "/"]);

/** Playwright rejects a cookie without a path, so absence reads as the root. */
const normalizeCookie = (cookie: StateCookie): StateCookie => ({
  ...cookie,
  path: cookie.path ?? "/",
});

/**
 * A cookie the browser would already have discarded. Session cookies carry
 * `expires` 0 or -1 and are kept: they die with the browser, not with a clock.
 */
const isExpired = (cookie: StateCookie, now: number) =>
  cookie.expires !== undefined && cookie.expires > 0 &&
  cookie.expires * 1_000 < now;

/**
 * Merge two storage states. The incoming side wins on every conflict, so the
 * login a run just performed replaces the older cookie for the same key.
 */
export function mergeStates(
  existing: SharedState,
  incoming: SharedState,
  now: number,
) {
  const keptExisting = existing.cookies.filter((cookie) => !isExpired(cookie, now));
  const keptIncoming = incoming.cookies.filter((cookie) => !isExpired(cookie, now));
  const expired = existing.cookies.length - keptExisting.length +
    (incoming.cookies.length - keptIncoming.length);

  const cookies = new Map<string, StateCookie>();
  for (const cookie of keptExisting) {
    cookies.set(cookieKey(cookie), normalizeCookie(cookie));
  }
  let added = 0;
  let replaced = 0;
  for (const cookie of keptIncoming) {
    const key = cookieKey(cookie);
    if (cookies.has(key)) replaced += 1;
    else added += 1;
    cookies.set(key, normalizeCookie(cookie));
  }

  const origins = new Map<string, Map<string, string>>();
  const collect = (origin: StateOrigin) => {
    const items = origins.get(origin.origin) ?? new Map<string, string>();
    for (const item of origin.localStorage ?? []) items.set(item.name, item.value);
    origins.set(origin.origin, items);
  };
  for (const origin of existing.origins) collect(origin);
  for (const origin of incoming.origins) collect(origin);

  const state: SharedState = {
    cookies: [...cookies.values()],
    origins: [...origins].map(([origin, items]) => ({
      origin,
      localStorage: [...items].map(([name, value]) => ({ name, value })),
    })),
  };
  return { state, added, replaced, expired };
}

function decodeState(contents: string, source: string): SharedState {
  let decoded: typeof SharedState.Type;
  try {
    decoded = decodeSharedState(contents);
  } catch (error) {
    throw new Error(
      `${source} is not a Playwright storage state file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return {
    cookies: decoded.cookies ?? [],
    origins: decoded.origins ?? [],
  };
}

async function readState(path: string): Promise<SharedState | null> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  return decodeState(contents, `Shared agent-browser state ${path}`);
}

/**
 * Write through a private temporary file and rename, so a reader never sees a
 * half-written state and a failed write never destroys the current logins.
 */
async function writeState(path: string, state: SharedState) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  const file = await open(temporaryPath, "w", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await file.sync();
    await file.close();
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Hold the cross-process lock while reading and rewriting the state, so two
 * runs finishing together cannot drop each other's new logins. A lock left by
 * a killed process is taken over once it is older than the stale window.
 */
async function withLock<A>(
  path: string,
  dependencies: SharedStateDependencies,
  body: () => Promise<A>,
): Promise<A> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = dependencies.now() + lockTimeoutMs;
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const held = await stat(lockPath).catch(() => null);
      if (held && dependencies.now() - held.mtimeMs >= staleLockMs) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (dependencies.now() >= deadline) {
        throw new Error(
          `Timed out waiting for the shared agent-browser state lock ${lockPath}. ` +
            "Remove it if no other Briar command is running.",
        );
      }
      await dependencies.sleep(lockRetryIntervalMs);
    }
  }
  try {
    return await body();
  } finally {
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Create the shared state file when it is missing and report what it holds. */
export async function ensureSharedState(
  options: SharedStateOptions = {},
): Promise<SharedStateSummary> {
  const path = sharedStatePath(options);
  const dependencies = dependenciesOf(options);
  return withLock(path, dependencies, async () => {
    const existing = await readState(path);
    if (existing) return summaryOf(path, existing);
    await writeState(path, emptySharedState);
    return summaryOf(path, emptySharedState);
  });
}

/**
 * Merge a state file written by `agent-browser state save` into the shared
 * state. The input is validated before the lock is taken, so a malformed file
 * leaves the shared logins untouched.
 */
export async function mergeSharedState(
  inputPath: string,
  options: SharedStateOptions = {},
): Promise<SharedStateMergeSummary> {
  const path = sharedStatePath(options);
  const dependencies = dependenciesOf(options);
  const incoming = decodeState(
    await readFile(inputPath, "utf8"),
    `Saved agent-browser state ${inputPath}`,
  );
  return withLock(path, dependencies, async () => {
    const existing = (await readState(path)) ?? emptySharedState;
    const merged = mergeStates(existing, incoming, dependencies.now());
    await writeState(path, merged.state);
    return {
      ...summaryOf(path, merged.state),
      added: merged.added,
      replaced: merged.replaced,
      expired: merged.expired,
    };
  });
}

/** Reset the shared state, signing every future Agent session out. */
export async function clearSharedState(
  options: SharedStateOptions = {},
): Promise<SharedStateSummary> {
  const path = sharedStatePath(options);
  const dependencies = dependenciesOf(options);
  return withLock(path, dependencies, async () => {
    await writeState(path, emptySharedState);
    return summaryOf(path, emptySharedState);
  });
}
