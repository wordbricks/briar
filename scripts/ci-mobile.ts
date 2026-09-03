import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { withCiWorktreeLockAt } from "./ci-worktree-lock";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fallbackJavaHome = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
const MobileCiJobs = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 3 }),
);

export class MobileCiCommandError extends Schema.TaggedError<MobileCiCommandError>()(
  "MobileCiCommandError",
  {
    cause: Schema.Defect(),
    command: Schema.String,
    message: Schema.String,
  },
) {}

export class MobileCiInvariantError extends Schema.TaggedError<MobileCiInvariantError>()(
  "MobileCiInvariantError",
  { message: Schema.String },
) {}

type MobileCommand = {
  readonly argv: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly output?: "capture" | "ignore" | "inherit";
};

type MobileCommandResult = {
  readonly exitCode: number;
  readonly output: string;
};

const commandText = (argv: ReadonlyArray<string>) => argv.map((argument) =>
  /^[A-Za-z0-9_./:=+@%-]+$/u.test(argument)
    ? argument
    : JSON.stringify(argument)
).join(" ");

const execute = Effect.fn("mobileCi.execute")(
  function* executeMobileCiCommandEffect(
    command: MobileCommand,
  ): Effect.fn.Return<
    MobileCommandResult,
    MobileCiCommandError,
    ChildProcessSpawner.ChildProcessSpawner
  > {
    const [program, ...arguments_] = command.argv;
    if (!program) {
      return yield* new MobileCiCommandError({
        cause: new Error("empty argv"),
        command: "",
        message: "Cannot execute an empty mobile CI command.",
      });
    }
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = command.output ?? "inherit";
    const child = ChildProcess.make(program, arguments_, {
      cwd: command.cwd ?? workspaceRoot,
      detached: false,
      env: command.env ? { ...command.env } : undefined,
      extendEnv: true,
      forceKillAfter: "5 seconds",
      stdin: "inherit",
      stdout: output === "capture" ? "pipe" : output,
      stderr: output === "capture" ? "pipe" : output,
    });
    return yield* Effect.scoped(Effect.gen(function* executeScopedEffect() {
      const handle = yield* spawner.spawn(child);
      if (output === "capture") {
        const [captured, exitCode] = yield* Effect.all([
          handle.all.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ], { concurrency: 2 });
        return { exitCode: Number(exitCode), output: captured };
      }
      const exitCode = yield* handle.exitCode;
      return { exitCode: Number(exitCode), output: "" };
    })).pipe(
      Effect.mapError((cause) => new MobileCiCommandError({
        cause,
        command: commandText(command.argv),
        message: `Could not execute ${commandText(command.argv)}.`,
      })),
    );
  },
);

const run = Effect.fn("mobileCi.run")(
  function* runMobileCiCommandEffect(
    label: string,
    command: MobileCommand,
  ) {
    yield* Console.log(`[mobile-ci] ▶ ${label}`);
    const result = yield* execute(command);
    if (result.exitCode !== 0) {
      return yield* new MobileCiCommandError({
        cause: new Error(`exit code ${result.exitCode}`),
        command: commandText(command.argv),
        message: `${label} failed with exit code ${result.exitCode}.`,
      });
    }
    yield* Console.log(`[mobile-ci] ✓ ${label}`);
    return result;
  },
);

const requireCommand = Effect.fn("mobileCi.requireCommand")(
  function* requireMobileCiCommandEffect(name: string, installHint: string) {
    const result = yield* execute({
      argv: ["which", name],
      output: "ignore",
    });
    if (result.exitCode !== 0) {
      return yield* new MobileCiInvariantError({
        message: `Missing ${name}. ${installHint}`,
      });
    }
  },
);

const resolveMobileEnvironment = Effect.fn("mobileCi.resolveEnvironment")(
  function* resolveMobileCiEnvironmentEffect() {
    const java = yield* execute({ argv: ["which", "java"], output: "ignore" });
    if (java.exitCode === 0) return undefined;

    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(join(fallbackJavaHome, "bin", "java")))) {
      return yield* new MobileCiInvariantError({
        message: "Missing JDK 17. Install it and set JAVA_HOME for the Android build.",
      });
    }
    return {
      JAVA_HOME: fallbackJavaHome,
      PATH: `${join(fallbackJavaHome, "bin")}:${process.env.PATH ?? ""}`,
    };
  },
);

const verifyNoSwiftConsoleLogging = Effect.fn("mobileCi.verifyNoSwiftConsoleLogging")(
  function* verifyNoSwiftConsoleLoggingEffect() {
    const result = yield* execute({
      argv: [
        "rg",
        "-n",
        String.raw`(^|[^A-Za-z])(print|debugPrint|dump)\(`,
        "apps/briar/ios/BriarCompanion/App",
      ],
      output: "inherit",
    });
    if (result.exitCode === 0) {
      return yield* new MobileCiInvariantError({
        message: "Production Swift sources must not use unredacted console logging.",
      });
    }
    if (result.exitCode !== 1) {
      return yield* new MobileCiCommandError({
        cause: new Error(`exit code ${result.exitCode}`),
        command: "rg Swift console logging",
        message: "Could not inspect Swift console logging.",
      });
    }
  },
);

const prepareMobileBuildCopy = Effect.fn("mobileCi.prepareBuildCopy")(
  function* prepareMobileBuildCopyEffect(temporaryRoot: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const buildRoot = join(temporaryRoot, "worktree");
    const fileListPath = join(temporaryRoot, "tracked-files.txt");
    const files = yield* run("list isolated mobile build inputs", {
      argv: ["git", "ls-files", "-co", "--exclude-standard"],
      output: "capture",
    });
    yield* fileSystem.writeFileString(fileListPath, files.output);
    yield* fileSystem.makeDirectory(buildRoot, { recursive: true });
    yield* run("copy isolated mobile build inputs", {
      argv: [
        "rsync",
        "-a",
        `--files-from=${fileListPath}`,
        `${workspaceRoot}/`,
        `${buildRoot}/`,
      ],
    });

    const environmentKeys = join(workspaceRoot, ".env.keys");
    if (yield* fileSystem.exists(environmentKeys)) {
      yield* fileSystem.copyFile(environmentKeys, join(buildRoot, ".env.keys"));
    }
    yield* fileSystem.symlink(
      join(workspaceRoot, "node_modules"),
      join(buildRoot, "node_modules"),
    );
    yield* fileSystem.symlink(
      join(workspaceRoot, "apps", "briar", "node_modules"),
      join(buildRoot, "apps", "briar", "node_modules"),
    );
    return buildRoot;
  },
);

const mobileCi = Effect.fn("mobileCi")(
  function* mobileCiEffect(jobs: number) {
    yield* Effect.all([
      requireCommand("bun", "Install the repository-pinned Bun version."),
      requireCommand("rg", "Install ripgrep for the mobile security checks."),
      requireCommand("xcodebuild", "Run mobile CI on a macOS worker with Xcode installed."),
      requireCommand("rsync", "Install rsync to create an isolated mobile build copy."),
    ], { concurrency: 4, discard: true });
    const mobileEnvironment = yield* resolveMobileEnvironment();
    const fileSystem = yield* FileSystem.FileSystem;
    const temporaryRoot = yield* fileSystem.makeTempDirectoryScoped({
      directory: (process.env.TMPDIR || "/tmp").replace(/\/$/u, ""),
      prefix: "briar-mobile-ci.",
    });

    yield* run("validate shared protobuf contracts", {
      argv: ["bun", "run", "contracts:check"],
      env: mobileEnvironment,
    });
    yield* run("validate iOS release contract", {
      argv: ["bun", "run", "ios:release:verify"],
      env: mobileEnvironment,
    });
    const mobileBuildRoot = yield* prepareMobileBuildCopy(temporaryRoot);
    yield* run("regenerate native iOS project", {
      argv: ["bun", "run", "ios:native:project"],
      cwd: mobileBuildRoot,
      env: mobileEnvironment,
    });

    yield* Effect.all([
      run("build and test SwiftUI app on iPhone", {
        argv: ["bash", "scripts/ios-simulator.sh", "test"],
        cwd: mobileBuildRoot,
        env: {
          ...mobileEnvironment,
          BRIAR_IOS_DERIVED_DATA_PATH: join(temporaryRoot, "swift-derived-data"),
          BRIAR_IOS_PROJECT_PREGENERATED: "true",
        },
      }),
      run("run iPad accessibility and layout tests", {
        argv: ["bash", "scripts/ios-simulator.sh", "test-ipad-accessibility"],
        cwd: mobileBuildRoot,
        env: {
          ...mobileEnvironment,
          BRIAR_IOS_DERIVED_DATA_PATH: join(temporaryRoot, "ipad-derived-data"),
          BRIAR_IOS_PROJECT_PREGENERATED: "true",
        },
      }),
      run("analyze and build the Production iOS configuration", {
        argv: ["bash", "scripts/ios-simulator.sh", "build-production"],
        cwd: mobileBuildRoot,
        env: {
          ...mobileEnvironment,
          BRIAR_IOS_DERIVED_DATA_PATH: join(temporaryRoot, "production-derived-data"),
          BRIAR_IOS_PROJECT_PREGENERATED: "true",
        },
      }),
    ], { concurrency: jobs, discard: true });

    yield* run("verify keychain accessibility", {
      argv: [
        "rg", "-F", "--quiet",
        "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly",
        "apps/briar/ios/BriarCompanion/App/SessionStore.swift",
      ],
      output: "ignore",
    });
    yield* run("verify bounded download-memory API", {
      argv: [
        "rg", "-F", "--quiet",
        "session.download(for: request)",
        "apps/briar/ios/BriarCompanion/App/MobileAPIContract.swift",
      ],
      output: "ignore",
    });
    yield* verifyNoSwiftConsoleLogging();

    yield* run("build retained Tauri Android debug path", {
      argv: ["bun", "run", "android:build:debug"],
      cwd: mobileBuildRoot,
      env: mobileEnvironment,
    });
    yield* Console.log("[mobile-ci] All generated contract and mobile build checks passed.");
  },
);

const withMobileCiLock = Effect.fn("withMobileCiLock")(
  function* withMobileCiLockEffect<A, E, R>(program: Effect.Effect<A, E, R>) {
    const lockPath = yield* run("resolve worktree CI lock", {
      argv: ["git", "rev-parse", "--git-path", "briar-ci.lock"],
      output: "capture",
    });
    const head = yield* run("resolve mobile CI commit", {
      argv: ["git", "rev-parse", "HEAD"],
      output: "capture",
    });
    return yield* withCiWorktreeLockAt(
      resolve(workspaceRoot, lockPath.output.trim()),
      head.output.trim(),
      program,
    );
  },
);

const mobileCiCommand = Command.make(
  "ci-mobile",
  {
    jobs: Flag.integer("jobs").pipe(
      Flag.withDefault(2),
      Flag.withSchema(MobileCiJobs),
      Flag.withDescription("Maximum concurrent iOS builds (1-3)"),
    ),
  },
  Effect.fn(function* runMobileCiCommand({ jobs }) {
    yield* withMobileCiLock(mobileCi(jobs));
  }),
).pipe(Command.withDescription("Run Briar native iOS and Android CI"));

export const runMobileCiMain = () => {
  mobileCiCommand.pipe(
    Command.run({ version: process.env.npm_package_version ?? "0.0.0" }),
    Effect.scoped,
    Effect.tapError((error) =>
      CliError.isCliError(error)
        ? Effect.void
        : Effect.sync(() => process.stderr.write(`[mobile-ci] ${String(error)}\n`))
    ),
    Effect.provide(BunServices.layer),
    BunRuntime.runMain({ disableErrorReporting: true }),
  );
};

if (import.meta.main) runMobileCiMain();
