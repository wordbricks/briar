import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const LockFailure = Schema.Struct({
  code: Schema.OptionFromOptional(Schema.String),
  errcode: Schema.OptionFromOptional(Schema.Finite),
});

export class CiAlreadyRunning extends Schema.TaggedError<CiAlreadyRunning>()(
  "CiAlreadyRunning",
  {
    head: Schema.String,
    lockPath: Schema.String,
    message: Schema.String,
  },
) {}

export class CiWorktreeLockError extends Schema.TaggedError<CiWorktreeLockError>()(
  "CiWorktreeLockError",
  {
    cause: Schema.Defect(),
    lockPath: Schema.String,
    message: Schema.String,
  },
) {}

const sqliteBusyCode = 5;

const isSqliteBusy = (cause: unknown) =>
  Schema.decodeUnknownOption(LockFailure)(cause).pipe(
    Option.exists(({ errcode }) =>
      errcode.pipe(
        Option.exists((value) => value % 256 === sqliteBusyCode),
      )
    ),
  );

const acquireLock = Effect.fn("ciWorktreeLock.acquire")(
  function* acquireCiWorktreeLockEffect(
    lockPath: string,
    head: string,
  ): Effect.fn.Return<
    DatabaseSync,
    CiAlreadyRunning | CiWorktreeLockError
  > {
    const database = yield* Effect.try({
      try: () => new DatabaseSync(lockPath, { timeout: 0 }),
      catch: (cause) => new CiWorktreeLockError({
        cause,
        lockPath,
        message: `Could not open the local CI lock at ${lockPath}.`,
      }),
    });

    return yield* Effect.try({
      try: () => {
        // SQLite admits exactly one IMMEDIATE writer. The transaction remains
        // open for the surrounding Effect scope and is released by dispose,
        // including on interruption or process exit.
        database.exec("BEGIN IMMEDIATE");
        return database;
      },
      catch: (cause) => isSqliteBusy(cause)
        ? new CiAlreadyRunning({
            head,
            lockPath,
            message: `Local CI is already running in this worktree (${lockPath}).`,
          })
        : new CiWorktreeLockError({
            cause,
            lockPath,
            message: `Could not acquire the local CI lock at ${lockPath}.`,
          }),
    }).pipe(
      Effect.onError(() => Effect.sync(() => database[Symbol.dispose]())),
    );
  },
);

export const withCiWorktreeLockAt = Effect.fn("withCiWorktreeLockAt")(
  function* withCiWorktreeLockAtEffect<A, E, R>(
    lockPath: string,
    head: string,
    program: Effect.Effect<A, E, R>,
  ) {
    yield* Effect.acquireDisposable(acquireLock(lockPath, head));
    return yield* program;
  },
  Effect.scoped,
);
