import * as BunServices from "@effect/platform-bun/BunServices";
import { describe, expect, it } from "@effect/vitest";
import { join } from "node:path";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";

import { withCiWorktreeLockAt } from "./ci-worktree-lock";

describe("worktree-local CI lock", () => {
  it.effect("excludes a second run and releases the lock when interrupted", () =>
    Effect.gen(function* ciLockExclusionEffect() {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "briar-ci-lock-test.",
      });
      const lockPath = join(directory, "ci.lock");
      const started = yield* Deferred.make<void>();
      const first = yield* withCiWorktreeLockAt(
        lockPath,
        "a".repeat(40),
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(started);

      const collision = yield* withCiWorktreeLockAt(
        lockPath,
        "a".repeat(40),
        Effect.void,
      ).pipe(Effect.flip);
      expect(collision._tag).toBe("CiAlreadyRunning");

      yield* Fiber.interrupt(first);
      yield* withCiWorktreeLockAt(lockPath, "a".repeat(40), Effect.void);
    }).pipe(
      Effect.scoped,
      Effect.provide(BunServices.layer),
    ));
});
