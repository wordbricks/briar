import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type GitCommandRunner = (
  args: ReadonlyArray<string>,
  cwd: string,
) => Promise<{ readonly exitCode: number; readonly stdout: string }>;

const FullCommitSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const ProductionGitTarget = Schema.Struct({
  head: FullCommitSha,
  main: FullCommitSha,
});

export class ProductionGitTargetError extends Schema.TaggedError<ProductionGitTargetError>()(
  "ProductionGitTargetError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

const runGit: GitCommandRunner = async (args, cwd) => {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { exitCode, stdout: stdout.trim() };
};

const requiredGit = Effect.fn("productionGitTarget.requiredGit")(
  function* requiredProductionGitCommandEffect(
    runner: GitCommandRunner,
    cwd: string,
    args: ReadonlyArray<string>,
    failure: string,
  ) {
    const result = yield* Effect.tryPromise({
      try: () => runner(args, cwd),
      catch: (cause) => new ProductionGitTargetError({ cause, message: failure }),
    });
    if (result.exitCode !== 0) {
      return yield* new ProductionGitTargetError({
        cause: new Error(`git exited with ${result.exitCode}`),
        message: failure,
      });
    }
    return result.stdout.trim();
  },
);

export const verifyProductionGitTarget = Effect.fn("verifyProductionGitTarget")(
  function* verifyProductionGitTargetEffect(
    cwd = process.cwd(),
    runner: GitCommandRunner = runGit,
  ) {
    const status = yield* requiredGit(
      runner,
      cwd,
      ["status", "--porcelain", "--untracked-files=all"],
      "Could not inspect the Worker deployment worktree.",
    );
    if (status) {
      return yield* new ProductionGitTargetError({
        cause: new Error("dirty worktree"),
        message: "Worker deployment requires a clean worktree.",
      });
    }

    yield* requiredGit(
      runner,
      cwd,
      ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"],
      "Could not fetch origin/main before Worker deployment.",
    );
    const head = yield* requiredGit(
      runner,
      cwd,
      ["rev-parse", "HEAD"],
      "Could not resolve the Worker deployment commit.",
    );
    const main = yield* requiredGit(
      runner,
      cwd,
      ["rev-parse", "refs/remotes/origin/main"],
      "Could not resolve origin/main before Worker deployment.",
    );
    const target = yield* Schema.decodeUnknownEffect(ProductionGitTarget)({
      head,
      main,
    }).pipe(
      Effect.mapError((cause) => new ProductionGitTargetError({
        cause,
        message: "Worker deployment resolved an invalid Git commit SHA.",
      })),
    );
    if (target.head !== target.main) {
      return yield* new ProductionGitTargetError({
        cause: new Error("HEAD does not match origin/main"),
        message: `Worker deployment must run from the exact origin/main commit (${target.main}); HEAD is ${target.head}.`,
      });
    }
    return target.head;
  },
);
