import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  CiCommandExecutor,
  runCommandSequence,
  runPrograms,
} from "./ci-local";

describe("Effect local CI runner", () => {
  it.effect("propagates an intermediate command failure and skips later work", () =>
    Effect.gen(function* commandFailureEffect() {
      const executed: string[] = [];
      const executor = CiCommandExecutor.of({
        execute: (command) => Effect.sync(() => {
          const name = command.argv.join(" ");
          executed.push(name);
          return {
            exitCode: name === "fail now" ? 17 : 0,
            output: "",
          };
        }),
      });
      const error = yield* runCommandSequence("test-context", [
        { label: "first", command: { argv: ["pass"] } },
        { label: "middle", command: { argv: ["fail", "now"] } },
        { label: "last", command: { argv: ["must-not-run"] } },
      ]).pipe(
        Effect.provide(Layer.succeed(CiCommandExecutor, executor)),
        Effect.flip,
      );

      expect(error).toMatchObject({
        _tag: "CiCommandFailed",
        context: "test-context",
        exitCode: 17,
        label: "middle",
      });
      expect(executed).toEqual(["pass", "fail now"]);
    }));

  it.effect("interrupts sibling contexts after a parallel failure", () =>
    Effect.gen(function* parallelFailureEffect() {
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Ref.make(false);
      const sibling = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Ref.set(interrupted, true)),
      );
      const failure = Deferred.await(started).pipe(
        Effect.andThen(Effect.fail("context failed")),
      );
      const exit = yield* Effect.exit(runPrograms([sibling, failure], false));
      const wasInterrupted = yield* Ref.get(interrupted);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(wasInterrupted).toBe(true);
    }));
});
