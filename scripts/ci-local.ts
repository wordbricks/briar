import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  ciContextNames,
  type CiContextName,
  type CiOptions,
} from "./ci-local-arguments";
import { withCiWorktreeLockAt } from "./ci-worktree-lock";
import {
  type SignoffTarget,
  verifySignoffReady,
  verifySignoffTargetUnchanged,
} from "./verify-signoff-ready";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rustToolchain = "1.96.0";
const cargoAuditVersion = "0.22.2";
const gitleaksVersion = "8.30.1";
const ciContextChoices = [...ciContextNames, "all"] as const;

type CommandOutput =
  | { readonly _tag: "capture" }
  | { readonly _tag: "inherit" }
  | { readonly _tag: "log"; readonly path: string };

export type CiCommand = {
  readonly argv: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly output?: CommandOutput;
};

export type CiCommandResult = {
  readonly exitCode: number;
  readonly output: string;
};

export class CiCommandLaunchError extends Schema.TaggedError<CiCommandLaunchError>()(
  "CiCommandLaunchError",
  {
    cause: Schema.Defect(),
    command: Schema.String,
    message: Schema.String,
  },
) {}

export class CiCommandFailed extends Schema.TaggedError<CiCommandFailed>()(
  "CiCommandFailed",
  {
    command: Schema.String,
    context: Schema.String,
    exitCode: Schema.Int,
    label: Schema.String,
    message: Schema.String,
  },
) {}

export class CiInvariantError extends Schema.TaggedError<CiInvariantError>()(
  "CiInvariantError",
  { message: Schema.String },
) {}

export class CiFileSystemError extends Schema.TaggedError<CiFileSystemError>()(
  "CiFileSystemError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    operation: Schema.String,
  },
) {}

const commandText = (argv: ReadonlyArray<string>) =>
  argv.map((argument) =>
    /^[A-Za-z0-9_./:=+@%-]+$/u.test(argument)
      ? argument
      : JSON.stringify(argument)
  ).join(" ");

export class CiCommandExecutor extends Context.Service<CiCommandExecutor, {
  execute(
    command: CiCommand,
  ): Effect.Effect<CiCommandResult, CiCommandLaunchError>;
}>()("briar/scripts/ci-local/CiCommandExecutor") {
  static readonly layer = Layer.effect(
    CiCommandExecutor,
    Effect.gen(function* makeCiCommandExecutorEffect() {
      const fileSystem = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const execute = Effect.fn("CiCommandExecutor.execute")(
        function* executeCiCommandEffect(command: CiCommand) {
          const [program, ...arguments_] = command.argv;
          if (!program) {
            return yield* new CiCommandLaunchError({
              cause: new Error("empty argv"),
              command: "",
              message: "Cannot execute an empty CI command",
            });
          }
          const output = command.output ?? { _tag: "inherit" as const };
          const stdio = output._tag === "capture" || output._tag === "log"
            ? { stdout: "pipe" as const, stderr: "pipe" as const }
            : { stdout: "inherit" as const, stderr: "inherit" as const };
          const childOptions: ChildProcess.CommandOptions = {
            cwd: command.cwd ?? workspaceRoot,
            detached: false,
            env: command.env ? { ...command.env } : undefined,
            extendEnv: true,
            forceKillAfter: "5 seconds",
            stdin: "inherit",
            ...stdio,
          };
          const child = ChildProcess.make(program, arguments_, childOptions);

          return yield* Effect.scoped(Effect.gen(function* runChildEffect() {
            const handle = yield* spawner.spawn(child);
            if (output._tag === "capture") {
              const [captured, exitCode] = yield* Effect.all([
                handle.all.pipe(Stream.decodeText(), Stream.mkString),
                handle.exitCode,
              ], { concurrency: 2 });
              return { exitCode: Number(exitCode), output: captured };
            }
            if (output._tag === "log") {
              const [, exitCode] = yield* Effect.all([
                handle.all.pipe(
                  Stream.run(fileSystem.sink(output.path, { flag: "a" })),
                ),
                handle.exitCode,
              ], { concurrency: 2 });
              return { exitCode: Number(exitCode), output: "" };
            }
            const exitCode = yield* handle.exitCode;
            return { exitCode: Number(exitCode), output: "" };
          })).pipe(
            Effect.mapError((cause) =>
              new CiCommandLaunchError({
                cause,
                command: commandText(command.argv),
                message: `Could not execute ${commandText(command.argv)}`,
              })
            ),
          );
        },
      );

      return CiCommandExecutor.of({ execute });
    }),
  );
}

export const executeCheckedCommand = Effect.fn("executeCheckedCommand")(
  function* executeCheckedCommandEffect(
    context: string,
    label: string,
    command: CiCommand,
  ) {
    const executor = yield* CiCommandExecutor;
    const result = yield* executor.execute(command);
    if (result.exitCode !== 0) {
      return yield* new CiCommandFailed({
        command: commandText(command.argv),
        context,
        exitCode: result.exitCode,
        label,
        message: `${context}/${label} failed with exit code ${result.exitCode}: ${commandText(command.argv)}`,
      });
    }
    return result;
  },
);

export const runCommandSequence = Effect.fn("runCommandSequence")(
  function* runCommandSequenceEffect(
    context: string,
    commands: ReadonlyArray<{
      readonly label: string;
      readonly command: CiCommand;
    }>,
  ) {
    for (const { command, label } of commands) {
      yield* executeCheckedCommand(context, label, command);
    }
  },
);

export const runPrograms = <E, R>(
  programs: ReadonlyArray<Effect.Effect<void, E, R>>,
  serial: boolean,
) => Effect.all(programs, {
  concurrency: serial ? 1 : "unbounded",
  discard: true,
});

type TimingStatus = "cancelled" | "fail" | "ok";

type Timing = {
  readonly context: string;
  readonly label: string;
  readonly seconds: number;
  readonly status: TimingStatus;
};

const fileSystemError = (operation: string) =>
  Effect.mapError((cause: unknown) =>
    new CiFileSystemError({
      cause,
      message: `Local CI could not ${operation}`,
      operation,
    })
  );

const appendLog = Effect.fn("appendCiLog")(
  function* appendCiLogEffect(path: string, message: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(path, message, { flag: "a" }).pipe(
      fileSystemError(`append ${path}`),
    );
  },
);

const exitStatus = <E>(exit: Exit.Exit<unknown, E>): TimingStatus =>
  Exit.isSuccess(exit)
    ? "ok"
    : Cause.hasInterruptsOnly(exit.cause)
      ? "cancelled"
      : "fail";

const elapsedSeconds = (startedAt: number, finishedAt: number) =>
  Math.max(0, Math.round((finishedAt - startedAt) / 1_000));

const recordTiming = Effect.fn("recordCiTiming")(
  function* recordCiTimingEffect(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    timing: Timing,
  ) {
    yield* Ref.update(timings, (current) => [...current, timing]);
  },
);

const timed = Effect.fn("timedCi")(
  function* timedCiEffect<A, E, R>(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    context: string,
    label: string,
    logPath: string,
    effect: Effect.Effect<A, E, R>,
  ) {
    const startedAt = yield* Clock.currentTimeMillis;
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* recordTimedExitEffect() {
          const finishedAt = yield* Clock.currentTimeMillis;
          const timing = {
            context,
            label,
            seconds: elapsedSeconds(startedAt, finishedAt),
            status: exitStatus(exit),
          } as const;
          yield* recordTiming(timings, timing);
          yield* appendLog(
            logPath,
            `[local-ci] [timing] ${context} ${label} ${timing.seconds}s ${timing.status}\n`,
          );
          const marker = timing.status === "ok"
            ? "✓"
            : timing.status === "cancelled"
              ? "⊘"
              : "✗";
          yield* Effect.sync(() => process.stdout.write(
            `[local-ci] ${marker} ${context}/${label} (${timing.seconds}s)\n`,
          ));
        })
      ),
    );
  },
);

const runTimedCommand = Effect.fn("runTimedCiCommand")(
  function* runTimedCiCommandEffect(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    context: string,
    logPath: string,
    label: string,
    command: CiCommand,
  ) {
    const loggedCommand = {
      ...command,
      output: { _tag: "log" as const, path: logPath },
    };
    yield* appendLog(logPath, `$ ${commandText(command.argv)}\n`);
    yield* Effect.sync(() => process.stdout.write(
      `[local-ci] ▶ ${context}/${label}\n`,
    ));
    return yield* timed(
      timings,
      context,
      label,
      logPath,
      executeCheckedCommand(context, label, loggedCommand),
    );
  },
);

const capture = Effect.fn("captureCiCommand")(
  function* captureCiCommandEffect(
    context: string,
    label: string,
    argv: ReadonlyArray<string>,
    env?: Readonly<Record<string, string>>,
  ) {
    return yield* executeCheckedCommand(context, label, {
      argv,
      env,
      output: { _tag: "capture" },
    });
  },
);

const runAppWorker = Effect.fn("runAppWorkerCi")(
  function* runAppWorkerCiEffect(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    logPath: string,
  ) {
    const fileSystem = yield* FileSystem.FileSystem;
    const workflowsDirectory = join(workspaceRoot, ".github", "workflows");
    if (yield* fileSystem.exists(workflowsDirectory)) {
      const workflow = yield* capture(
        "app-worker",
        "hosted-workflow-check",
        ["find", workflowsDirectory, "-type", "f", "-print", "-quit"],
      );
      if (workflow.output.trim()) {
        return yield* new CiInvariantError({
          message: "GitHub Actions workflows are not allowed; use the local CI and release scripts.",
        });
      }
    }
    const shellFiles = [
      "scripts/import-apple-signing-assets.sh",
      "scripts/ios-simulator.sh",
      "scripts/release-ios.sh",
      "scripts/verify-ios-archive.sh",
      "scripts/package-macos-release.sh",
      "scripts/package-production-release.sh",
      "scripts/release-macos-candidate.sh",
      "scripts/release-macos-production.sh",
      "scripts/verify-bundled-runtime.sh",
      "scripts/qa-production-updater-build.sh",
      "scripts/qa-macos-lifecycle.sh",
      "scripts/qa-managed-computer-health.sh",
      "scripts/qa-managed-runtime-updater.sh",
      "scripts/release-cargo-cache.sh",
      "infrastructure/managed-computers/assert-debian-13-x86_64",
      "infrastructure/managed-computers/bootstrap-ssm.sh.tftpl",
      "infrastructure/managed-computers/briar",
      "infrastructure/managed-computers/briar-managed-computer-health",
      "infrastructure/managed-computers/briar-managed-enroll",
      "infrastructure/managed-computers/briar-managed-runtime-update-request",
      "infrastructure/managed-computers/briar-managed-runtime-updater",
      "infrastructure/managed-computers/briar-remote-desktop",
      "infrastructure/managed-computers/build-managed-computer-image",
      "infrastructure/managed-computers/configure-debian-snapshot",
      "infrastructure/managed-computers/install-image-runtime",
      "infrastructure/managed-computers/install-remote-desktop",
      "infrastructure/managed-computers/prepare-image-artifacts",
      "infrastructure/managed-computers/resolve-remote-desktop-packages",
      "infrastructure/managed-computers/verify-managed-image",
      "infrastructure/managed-computers/verify-remote-desktop",
    ];
    const steps = [
      ["check", ["bun", "run", "check"]],
      ["managed-computer-image-check", ["bun", "run", "managed-computer:image:check"]],
      ["qa-managed-computer-health", ["bash", "scripts/qa-managed-computer-health.sh"]],
      ["test", ["bun", "run", "test"]],
      ["shell-syntax", ["bash", "-n", ...shellFiles]],
      ["ios-release-verify", ["bun", "run", "ios:release:verify"]],
      ["build-workspaces", ["bun", "run", "build:workspaces"]],
      ["build-release", ["bun", "run", "build:release"]],
      ["worker-check", ["bun", "run", "worker:check"]],
      ["worker-build", ["bun", "run", "worker:build"]],
      ["worker-startup", ["bun", "run", "worker:startup"]],
    ] as const;

    for (const [label, argv] of steps) {
      yield* runTimedCommand(timings, "app-worker", logPath, label, { argv });
    }
  },
);

const runD1Migrations = Effect.fn("runD1MigrationsCi")(
  function* runD1MigrationsCiEffect(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    logPath: string,
    overlapAppWorker: boolean,
  ) {
    yield* runTimedCommand(
      timings,
      "d1-migrations",
      logPath,
      "snapshot-check",
      { argv: ["bun", "run", "d1:snapshot:check"] },
    );
    yield* runTimedCommand(
      timings,
      "d1-migrations",
      logPath,
      "test-migrations",
      {
        argv: ["bun", "run", "test:d1:migrations"],
        // Pinned while the app-worker context is running: the migration suite
        // starts each file from an empty database and replays the whole
        // history, so at full worker count it times out against the parallel
        // Worker suites and the Rust build. Cheap now that a warm cache skips
        // the step entirely.
        env: overlapAppWorker ? { VITEST_MAX_WORKERS: "1" } : undefined,
      },
    );
  },
);

const resolveCargoTargetDirectory = Effect.fn("resolveCargoTargetDirectory")(
  function* resolveCargoTargetDirectoryEffect(logPath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const override = process.env.BRIAR_CI_CARGO_TARGET_DIR?.trim();
    if (override === "local") {
      yield* appendLog(logPath, "[local-ci] Using the per-worktree Cargo target directory.\n");
      return undefined;
    }

    // Shared with the release scripts (see scripts/release-cargo-cache.sh).
    // Deliberately under the XDG cache rather than DARWIN_USER_CACHE_DIR: macOS
    // treats the latter as purgeable, and every eviction turned a ~20s
    // incremental Rust check into a ~10 minute cold build.
    const cacheBase = process.env.XDG_CACHE_HOME?.trim() ||
      join(process.env.HOME ?? process.env.TMPDIR ?? "/tmp", ".cache");
    const targetDirectory = override || join(
      cacheBase.replace(/\/$/u, ""),
      "briar/cargo-target",
    );
    if (!targetDirectory.startsWith("/") || !targetDirectory.endsWith("/cargo-target")) {
      return yield* new CiInvariantError({
        message: "BRIAR_CI_CARGO_TARGET_DIR must be an absolute path ending in /cargo-target.",
      });
    }
    yield* fileSystem.makeDirectory(targetDirectory, { recursive: true }).pipe(
      fileSystemError(`create ${targetDirectory}`),
    );
    const physicalTargetDirectory = yield* fileSystem.realPath(targetDirectory).pipe(
      fileSystemError(`resolve ${targetDirectory}`),
    );
    yield* appendLog(
      logPath,
      `[local-ci] Using shared CI Cargo target at ${physicalTargetDirectory}\n`,
    );
    return physicalTargetDirectory;
  },
);

const runRust = Effect.fn("runRustCi")(
  function* runRustCiEffect(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    logPath: string,
  ) {
    yield* runTimedCommand(timings, "rust", logPath, "toolchain-install", {
      argv: [
        "rustup",
        "toolchain",
        "install",
        rustToolchain,
        "--profile",
        "minimal",
        "--component",
        "rustfmt,clippy",
      ],
    });
    const targetDirectory = yield* resolveCargoTargetDirectory(logPath);
    // Lint and build in one pass: scripts/ci-rust-lint-wrapper.sh compiles the
    // workspace crates through clippy-driver with `-D warnings`, so `cargo test`
    // enforces exactly what the separate `cargo clippy --all-targets -- -D
    // warnings` step did (clippy and rustc warnings, lib/bin/test targets) while
    // compiling the crate once instead of once in check mode and once for the
    // test binaries. Dependencies still compile with plain rustc.
    const clippyDriver = yield* capture("rust", "clippy-driver-path", [
      "rustup", "which", "--toolchain", rustToolchain, "clippy-driver",
    ]);
    const env = {
      ...(targetDirectory ? { CARGO_TARGET_DIR: targetDirectory } : {}),
      BRIAR_CLIPPY_DRIVER: clippyDriver.output.trim(),
      RUSTC_WORKSPACE_WRAPPER: join(workspaceRoot, "scripts", "ci-rust-lint-wrapper.sh"),
    };
    yield* runTimedCommand(timings, "rust", logPath, "cargo-fmt", {
      argv: [
        "rustup", "run", rustToolchain, "cargo", "fmt",
        "--manifest-path", "apps/briar/src-tauri/Cargo.toml", "--all", "--check",
      ],
      env,
    });
    yield* appendLog(
      logPath,
      "[local-ci] rust: clippy runs inside cargo test via RUSTC_WORKSPACE_WRAPPER.\n",
    );
    yield* runTimedCommand(timings, "rust", logPath, "cargo-test", {
      argv: [
        "rustup", "run", rustToolchain, "cargo", "test",
        "--manifest-path", "apps/briar/src-tauri/Cargo.toml",
      ],
      env,
    });
  },
);

const gitleaksLogOptions = Effect.fn("gitleaksLogOptions")(
  function* gitleaksLogOptionsEffect(logPath: string) {
    if (process.env.BRIAR_CI_GITLEAKS_FULL === "true") {
      yield* appendLog(
        logPath,
        "[local-ci] gitleaks: full history scan (BRIAR_CI_GITLEAKS_FULL=true).\n",
      );
      return "--all";
    }

    const candidates = [
      process.env.BRIAR_CI_BASE_REF?.trim(),
      "origin/main",
      "main",
    ].filter((candidate): candidate is string => Boolean(candidate));
    const executor = yield* CiCommandExecutor;
    let baseRef: string | undefined;
    for (const candidate of candidates) {
      const result = yield* executor.execute({
        argv: ["git", "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
        output: { _tag: "capture" },
      });
      if (result.exitCode === 0) {
        baseRef = candidate;
        break;
      }
    }
    if (!baseRef) {
      yield* appendLog(logPath, "[local-ci] gitleaks: no base ref resolved; scanning full history.\n");
      return "--all";
    }

    const count = yield* capture(
      "security",
      "gitleaks-commit-count",
      ["git", "rev-list", "--count", `${baseRef}..HEAD`],
    );
    if (count.output.trim() === "0") {
      yield* appendLog(
        logPath,
        `[local-ci] gitleaks: HEAD adds nothing over ${baseRef}; scanning full history.\n`,
      );
      return "--all";
    }
    if (!/^\d+$/u.test(count.output.trim())) {
      return yield* new CiInvariantError({
        message: `git rev-list returned an invalid count: ${count.output.trim()}`,
      });
    }
    yield* appendLog(
      logPath,
      `[local-ci] gitleaks: scanning ${baseRef}..HEAD (set BRIAR_CI_GITLEAKS_FULL=true for full history).\n`,
    );
    return `${baseRef}..HEAD`;
  },
);

const runSecurity = Effect.fn("runSecurityCi")(
  function* runSecurityCiEffect(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    logPath: string,
  ) {
    const cargoAudit = yield* capture(
      "security",
      "cargo-audit-version",
      ["cargo-audit", "--version"],
    );
    if (cargoAudit.output.trim() !== `cargo-audit ${cargoAuditVersion}`) {
      return yield* new CiInvariantError({
        message: `Expected cargo-audit ${cargoAuditVersion}, found ${cargoAudit.output.trim()}.`,
      });
    }
    const gitleaks = yield* capture(
      "security",
      "gitleaks-version",
      ["gitleaks", "version"],
    );
    if (gitleaks.output.trim() !== gitleaksVersion) {
      return yield* new CiInvariantError({
        message: `Expected gitleaks ${gitleaksVersion}, found ${gitleaks.output.trim()}.`,
      });
    }

    yield* runTimedCommand(timings, "security", logPath, "audit-dependencies", {
      argv: ["bun", "run", "audit:dependencies"],
    });
    yield* runTimedCommand(timings, "security", logPath, "audit-rust", {
      argv: ["bun", "run", "audit:rust"],
    });
    yield* runTimedCommand(timings, "security", logPath, "secrets-verify-encrypted", {
      argv: ["bun", "run", "secrets:verify-encrypted"],
    });
    const logOptions = yield* gitleaksLogOptions(logPath);
    yield* runTimedCommand(timings, "security", logPath, "gitleaks", {
      argv: [
        "gitleaks", "git", "--config", ".gitleaks.toml", "--redact",
        "--no-banner", `--log-opts=${logOptions}`, ".",
      ],
    });
  },
);

const printFailureTail = Effect.fn("printCiFailureTail")(
  function* printCiFailureTailEffect(path: string) {
    yield* Effect.sync(() => process.stderr.write(
      `[local-ci] Last 200 log lines from ${path}:\n`,
    ));
    const executor = yield* CiCommandExecutor;
    yield* executor.execute({
      argv: ["tail", "-n", "200", path],
      output: { _tag: "inherit" },
    }).pipe(
      Effect.catch(() => Effect.void),
      Effect.asVoid,
    );
  },
);

const runContext = Effect.fn("runCiContext")(
  function* runCiContextEffect<E, R>(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    context: string,
    logPath: string,
    program: Effect.Effect<void, E, R>,
  ) {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(
      logPath,
      `\n[local-ci] === ${context} ===\n`,
    ).pipe(fileSystemError(`initialize ${logPath}`));
    const startedAt = yield* Clock.currentTimeMillis;
    return yield* program.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* finishContextEffect() {
          const finishedAt = yield* Clock.currentTimeMillis;
          const status = exitStatus(exit);
          const seconds = elapsedSeconds(startedAt, finishedAt);
          yield* recordTiming(timings, {
            context,
            label: "context-total",
            seconds,
            status,
          });
          yield* appendLog(
            logPath,
            `[local-ci] [timing] ${context} context-total ${seconds}s ${status}\n`,
          );
          if (status === "fail") {
            yield* printFailureTail(logPath);
          }
          yield* Effect.sync(() => process.stdout.write(
            `[local-ci] ${status === "ok" ? "✓" : status === "cancelled" ? "⊘" : "✗"} ${context} (${seconds}s)\n`,
          ));
        })
      ),
    );
  },
);

const runSharedInputs = Effect.fn("runSharedInputs")(
  function* runSharedInputsEffect(
    timings: Ref.Ref<ReadonlyArray<Timing>>,
    logPath: string,
  ) {
    yield* runContext(
      timings,
      "shared-inputs",
      logPath,
      Effect.gen(function* sharedInputsEffect() {
        yield* runTimedCommand(timings, "shared-inputs", logPath, "runtime-prepare", {
          argv: ["bun", "run", "runtime:prepare"],
        });
        yield* runTimedCommand(timings, "shared-inputs", logPath, "cli-build", {
          argv: ["bun", "run", "cli:build"],
        });
        yield* runTimedCommand(timings, "shared-inputs", logPath, "agent-build", {
          argv: ["bun", "run", "agent:build"],
        });
      }),
    );
  },
);

const timingSummary = (timings: ReadonlyArray<Timing>) => {
  const stepRows = timings
    .filter(({ label }) => label !== "context-total" && label !== "run-total")
    .sort((left, right) => right.seconds - left.seconds);
  const totalRows = timings
    .filter(({ label }) => label === "context-total" || label === "run-total")
    .sort((left, right) => right.seconds - left.seconds);
  const row = (timing: Timing) =>
    `${String(timing.seconds).padStart(6)}s  ${timing.context.padEnd(16)} ${timing.label.padEnd(44)} ${timing.status}`;
  return [
    "",
    "[local-ci] === timing: steps (slowest first) ===",
    ...stepRows.map(row),
    "",
    "[local-ci] === timing: contexts and total ===",
    ...totalRows.map(row),
  ].join("\n");
};

const timingTsv = (timings: ReadonlyArray<Timing>) =>
  `${timings.map(({ context, label, seconds, status }) =>
    `${context}\t${label}\t${seconds}\t${status}`
  ).join("\n")}\n`;

type SignoffState = "failure" | "pending" | "success";

const publishSignoffStatus = Effect.fn("publishSignoffStatus")(
  function* publishSignoffStatusEffect(
    target: SignoffTarget,
    context: CiContextName,
    state: SignoffState,
  ) {
    const description = state === "pending"
      ? "Local signoff is running"
      : state === "success"
        ? "Local signoff passed"
        : "Local signoff failed or became stale";
    yield* executeCheckedCommand("signoff", `${context}-${state}`, {
      argv: [
        "gh",
        "api",
        "--silent",
        "--method",
        "POST",
        `repos/{owner}/{repo}/statuses/${target.head}`,
        "-f",
        `state=${state}`,
        "-f",
        `context=signoff/${context}`,
        "-f",
        `description=${description}`,
      ],
      output: { _tag: "inherit" },
    });
  },
);

const publishSignoffStatuses = (
  target: SignoffTarget,
  contexts: ReadonlyArray<CiContextName>,
  state: SignoffState,
) => Effect.all(
  contexts.map((context) => publishSignoffStatus(target, context, state)),
  { concurrency: 4, discard: true },
);

const checkSignoffTarget = Effect.fn("checkSignoffTarget")(
  function* checkSignoffTargetEffect(target: SignoffTarget) {
    yield* Effect.try({
      try: () => verifySignoffTargetUnchanged(target, workspaceRoot),
      catch: (cause) => new CiInvariantError({
        message: `Signoff target changed: ${String(cause)}`,
      }),
    });
  },
);

const withSignoffLifecycle = Effect.fn("withSignoffLifecycle")(
  function* withSignoffLifecycleEffect<A, E, R>(
    target: SignoffTarget,
    contexts: ReadonlyArray<CiContextName>,
    program: Effect.Effect<A, E, R>,
  ) {
    const lifecycle = Effect.gen(function* signoffRunEffect() {
      yield* publishSignoffStatuses(target, contexts, "pending");
      const monitoredProgram = program.pipe(
        Effect.andThen(checkSignoffTarget(target)),
      );
      const targetMonitor = Effect.sleep(10_000).pipe(
        Effect.andThen(checkSignoffTarget(target)),
        Effect.forever,
      );
      return yield* Effect.raceFirst(monitoredProgram, targetMonitor);
    });
    return yield* lifecycle.pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : publishSignoffStatuses(target, contexts, "failure").pipe(
            Effect.catch((error) => Effect.sync(() => process.stderr.write(
              `[local-ci] Could not publish final failure statuses: ${String(error)}\n`,
            ))),
          )
      ),
    );
  },
);

const runCi = Effect.fn("runCi")(
  function* runCiEffect(options: CiOptions, signoffTarget?: SignoffTarget) {
    const fileSystem = yield* FileSystem.FileSystem;
    const temporaryRoot = yield* fileSystem.makeTempDirectoryScoped({
      directory: (process.env.TMPDIR || "/tmp").replace(/\/$/u, ""),
      prefix: "briar-local-ci.",
    }).pipe(fileSystemError("create the local CI temporary directory"));
    const timings = yield* Ref.make<ReadonlyArray<Timing>>([]);
    const startedAt = yield* Clock.currentTimeMillis;
    const requestedTimingPath = process.env.BRIAR_CI_TIMING_FILE?.trim();
    const timingPath = requestedTimingPath || join(
      temporaryRoot,
      "timing.tsv",
    );
    const serial = process.env.BRIAR_CI_SERIAL_CONTEXTS === "true";
    const overlapAppWorker = !serial && options.contexts.includes("app-worker");

    const program = Effect.gen(function* ciProgramEffect() {
      if (options.contexts.includes("rust")) {
        yield* runSharedInputs(timings, join(temporaryRoot, "shared-inputs.log"));
      }

      yield* Effect.sync(() => {
        process.stdout.write(
          `\n[local-ci] Running ${options.contexts.length} context(s) ${serial ? "serially" : "in parallel"}.\n`,
        );
      });
      const contexts = options.contexts.map((context) => {
        const logPath = join(temporaryRoot, `${context}.log`);
        let contextProgram: Effect.Effect<
          void,
          unknown,
          CiCommandExecutor | FileSystem.FileSystem
        >;
        switch (context) {
          case "app-worker":
            contextProgram = runAppWorker(timings, logPath);
            break;
          case "d1-migrations":
            contextProgram = runD1Migrations(
              timings,
              logPath,
              overlapAppWorker,
            );
            break;
          case "rust":
            contextProgram = runRust(timings, logPath);
            break;
          case "security":
            contextProgram = runSecurity(timings, logPath);
            break;
        }
        const contextEffect = runContext(timings, context, logPath, contextProgram);
        return signoffTarget
          ? contextEffect.pipe(
            Effect.onExit((exit) =>
              publishSignoffStatus(
                signoffTarget,
                context,
                Exit.isSuccess(exit) ? "success" : "failure",
              )
            ),
          )
          : contextEffect;
      });
      yield* runPrograms(contexts, serial);

      if (!options.signoff) {
        yield* Effect.sync(() => process.stdout.write(
          "\n[local-ci] All selected checks passed.\n" +
          "[local-ci] After committing and pushing, run: bun run ci:signoff\n",
        ));
      }
    });

    const lifecycleProgram = signoffTarget
      ? withSignoffLifecycle(signoffTarget, options.contexts, program)
      : program;
    return yield* lifecycleProgram.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* finishCiEffect() {
          const finishedAt = yield* Clock.currentTimeMillis;
          yield* recordTiming(timings, {
            context: "run",
            label: "run-total",
            seconds: elapsedSeconds(startedAt, finishedAt),
            status: exitStatus(exit),
          });
          const recorded = yield* Ref.get(timings);
          yield* fileSystem.writeFileString(timingPath, timingTsv(recorded)).pipe(
            fileSystemError(`write ${timingPath}`),
          );
          yield* Effect.sync(() => process.stdout.write(
            `${timingSummary(recorded)}${requestedTimingPath ? `\n[local-ci] timing file: ${timingPath}` : ""}\n`,
          ));
        })
      ),
    );
  },
);

const signoffPreflight = Effect.fn("signoffPreflight")(
  function* signoffPreflightEffect() {
    return yield* Effect.try({
      try: () => verifySignoffReady(workspaceRoot),
      catch: (cause) => new CiInvariantError({
        message: `Signoff preflight failed: ${String(cause)}`,
      }),
    });
  },
);

const withWorktreeCiLock = Effect.fn("withWorktreeCiLock")(
  function* withWorktreeCiLockEffect<A, E, R>(program: Effect.Effect<A, E, R>) {
    const lockPathResult = yield* capture(
      "local-ci",
      "resolve-worktree-lock",
      ["git", "rev-parse", "--git-path", "briar-ci.lock"],
    );
    const headResult = yield* capture(
      "local-ci",
      "resolve-head",
      ["git", "rev-parse", "HEAD"],
    );
    const lockPath = resolve(workspaceRoot, lockPathResult.output.trim());
    return yield* withCiWorktreeLockAt(
      lockPath,
      headResult.output.trim(),
      program,
    );
  },
);

const selectedContexts = (
  contexts: ReadonlyArray<CiContextName | "all">,
): ReadonlyArray<CiContextName> => {
  if (contexts.length === 0 || contexts.includes("all")) return ciContextNames;
  return [...new Set(contexts.filter(
    (context): context is CiContextName => context !== "all",
  ))];
};

const contextsArgument: Argument.Argument<
  ReadonlyArray<CiContextName | "all">
> = Argument.withDescription(
  Argument.variadic(Argument.choice("context", ciContextChoices)),
  "CI contexts to run; defaults to all",
);

const ciCommand = Command.make(
  "ci-local",
  {
    contexts: contextsArgument,
    signoff: Flag.boolean("signoff").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Publish a signoff after verifying the pushed revision"),
    ),
  },
  Effect.fn(function* runCiCommand({ contexts, signoff }) {
    const selected = selectedContexts(contexts);
    yield* withWorktreeCiLock(Effect.gen(function* lockedCiEffect() {
      const target = signoff ? yield* signoffPreflight() : undefined;
      yield* runCi({ contexts: selected, signoff }, target);
    }));
  }),
).pipe(
  Command.withDescription("Run Briar repository CI checks locally"),
  Command.withExamples([
    { command: "bun run ci:local", description: "Run every CI context" },
    {
      command: "bun run ci:local d1-migrations",
      description: "Run only the D1 migration context",
    },
    {
      command: "bun run ci:signoff",
      description: "Run every context and publish a signoff",
    },
  ]),
);

const CiLive = CiCommandExecutor.layer.pipe(
  Layer.provideMerge(BunServices.layer),
);

export const runCiMain = () => {
  ciCommand.pipe(
    Command.run({ version: process.env.npm_package_version ?? "0.0.0" }),
    Effect.scoped,
    Effect.tapError((error) =>
      CliError.isCliError(error)
        ? Effect.void
        : Effect.sync(() => process.stderr.write(`[local-ci] ${String(error)}\n`))
    ),
    Effect.provide(CiLive),
    BunRuntime.runMain({ disableErrorReporting: true }),
  );
};

if (import.meta.main) runCiMain();
