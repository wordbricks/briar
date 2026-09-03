import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  type GitCommandRunner,
  verifyProductionGitTarget,
} from "./production-git-target";

const headSha = "a".repeat(40);

function gitRunner(mainSha: string) {
  return (async (args) => {
    const command = args.join(" ");
    if (command === "status --porcelain --untracked-files=all") {
      return { exitCode: 0, stdout: "" };
    }
    if (command.startsWith("fetch ")) return { exitCode: 0, stdout: "" };
    if (command === "rev-parse HEAD") return { exitCode: 0, stdout: headSha };
    if (command === "rev-parse refs/remotes/origin/main") {
      return { exitCode: 0, stdout: mainSha };
    }
    return { exitCode: 1, stdout: "" };
  }) satisfies GitCommandRunner;
}

describe("Production Git target", () => {
  it.effect("accepts only the exact freshly fetched origin/main commit", () =>
    Effect.gen(function* productionGitTargetEffect() {
      const accepted = yield* verifyProductionGitTarget(
        "/test/repository",
        gitRunner(headSha),
      );
      assert.strictEqual(accepted, headSha);

      const rejected = yield* verifyProductionGitTarget(
        "/test/repository",
        gitRunner("b".repeat(40)),
      ).pipe(Effect.flip);
      assert.match(rejected.message, /exact origin\/main commit/u);
    }));
});
