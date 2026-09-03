import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const LockRecord = Schema.Struct({
  head: Schema.String,
  pid: Schema.Int,
  startedAt: Schema.Int,
  token: Schema.String,
});
const decodeLockRecord = Schema.decodeUnknownSync(LockRecord);

export class CiAlreadyRunning extends Schema.TaggedError<CiAlreadyRunning>()(
  "CiAlreadyRunning",
  {
    head: Schema.String,
    message: Schema.String,
    pid: Schema.Int,
    startedAt: Schema.Int,
  },
) {}

export class CiWorktreeLockError extends Schema.TaggedError<CiWorktreeLockError>()(
  "CiWorktreeLockError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

type LockRecord = typeof LockRecord.Type;

const isAlreadyExists = (error: unknown) =>
  typeof error === "object" && error !== null && "reason" in error &&
  typeof error.reason === "object" && error.reason !== null &&
  "_tag" in error.reason && error.reason._tag === "AlreadyExists";

const processIsAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error &&
      error.code === "EPERM";
  }
};

const readLock = Effect.fn("ciWorktreeLock.read")(
  function* readCiWorktreeLockEffect(path: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFileString(path).pipe(
      Effect.flatMap((contents) => Effect.try({
        try: () => decodeLockRecord(JSON.parse(contents)),
        catch: () => undefined,
      })),
      Effect.catch(() => Effect.succeed(undefined)),
    );
  },
);

const moveStaleLockAside = Effect.fn("ciWorktreeLock.moveStaleAside")(
  function* moveStaleCiWorktreeLockAsideEffect(path: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const stalePath = `${path}.stale.${crypto.randomUUID()}`;
    const moved = yield* fileSystem.rename(path, stalePath).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (moved) {
      yield* fileSystem.remove(stalePath).pipe(
        Effect.catch(() => Effect.void),
      );
    }
  },
);

const acquireLock = Effect.fn("ciWorktreeLock.acquire")(
  function* acquireCiWorktreeLockEffect(
    path: string,
    head: string,
    attempt = 0,
  ): Effect.fn.Return<LockRecord, CiAlreadyRunning | CiWorktreeLockError, FileSystem.FileSystem> {
    if (attempt >= 8) {
      return yield* new CiWorktreeLockError({
        cause: new Error("lock contention did not settle"),
        message: `Could not acquire the local CI lock at ${path}.`,
      });
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const startedAt = yield* Clock.currentTimeMillis;
    const record = {
      head,
      pid: process.pid,
      startedAt,
      token: crypto.randomUUID(),
    } satisfies LockRecord;
    const result = yield* fileSystem.writeFileString(
      path,
      `${JSON.stringify(record)}\n`,
      { flag: "wx", mode: 0o600 },
    ).pipe(Effect.result);
    if (Result.isSuccess(result)) return record;
    if (!isAlreadyExists(result.failure)) {
      return yield* new CiWorktreeLockError({
        cause: result.failure,
        message: `Could not create the local CI lock at ${path}.`,
      });
    }

    const existing = yield* readLock(path);
    if (existing && processIsAlive(existing.pid)) {
      return yield* new CiAlreadyRunning({
        head: existing.head,
        message: `Local CI is already running in this worktree (pid ${existing.pid}, ${existing.head}).`,
        pid: existing.pid,
        startedAt: existing.startedAt,
      });
    }
    yield* moveStaleLockAside(path);
    return yield* acquireLock(path, head, attempt + 1);
  },
);

const releaseLock = Effect.fn("ciWorktreeLock.release")(
  function* releaseCiWorktreeLockEffect(path: string, lock: LockRecord) {
    const fileSystem = yield* FileSystem.FileSystem;
    const current = yield* readLock(path);
    if (current?.token === lock.token) {
      yield* fileSystem.remove(path).pipe(
        Effect.catch(() => Effect.void),
      );
    }
  },
);

export const withCiWorktreeLockAt = <A, E, R>(
  path: string,
  head: string,
  program: Effect.Effect<A, E, R>,
) => Effect.acquireUseRelease(
  acquireLock(path, head),
  () => program,
  (lock) => releaseLock(path, lock),
);
