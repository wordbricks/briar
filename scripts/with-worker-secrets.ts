import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { join } from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { applyRemoteD1Migrations } from "./apply-remote-d1-migrations";
import { verifyProductionGitTarget } from "./production-git-target";
import { withRemoteOperationLease } from "./remote-operation-lease";

const WorkerDevPort = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 65_535 }),
);

class WorkerSecretsError extends Schema.TaggedError<WorkerSecretsError>()(
  "WorkerSecretsError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

const workerSecretsError = (message: string) =>
  Effect.mapError((cause: unknown) => new WorkerSecretsError({ cause, message }));

const REQUIRED_SECRETS = [
  "RELEASE_PROMOTION_SECRET",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MANAGED_COMPUTER_PROMOTION_CODE",
  "MANAGED_COMPUTER_ENROLLMENT_SECRET",
  "MANAGED_COMPUTER_AWS_ACCESS_KEY_ID",
  "MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY",
] as const;

const OPTIONAL_SECRET_GROUPS = [
  [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_SLUG",
    "GITHUB_CALLBACK_ORIGIN",
    "GITHUB_WEBHOOK_SECRET",
  ],
  [
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
    "SLACK_TOKEN_ENCRYPTION_KEY",
  ],
  ["MANAGED_COMPUTER_AWS_SESSION_TOKEN"],
  ["APNS_KEY_ID", "APNS_PRIVATE_KEY"],
  ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"],
] as const;

function readSecrets(): Record<string, string> {
  const secrets = Object.fromEntries(
    REQUIRED_SECRETS.map((name) => {
      const value = process.env[name]?.trim();
      if (!value) {
        throw new Error(`Missing required secret: ${name}`);
      }
      return [name, value];
    }),
  );
  for (const group of OPTIONAL_SECRET_GROUPS) {
    const configured = group.filter((name) => process.env[name]?.trim());
    if (configured.length > 0 && configured.length !== group.length) {
      const missing = group.filter((name) => !process.env[name]?.trim());
      throw new Error(
        `Optional secret group is incomplete. Missing: ${missing.join(", ")}`,
      );
    }
    for (const name of configured) {
      secrets[name] = process.env[name]!.trim();
    }
  }
  return secrets;
}

function serializeDotenv(secrets: Record<string, string>): string {
  return `${Object.entries(secrets)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

async function runWranglerCommand(
  args: string[],
  captureOutput = false,
  signal?: AbortSignal,
) {
  const processHandle = Bun.spawn(["wrangler", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: captureOutput ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const abortProcess = () => processHandle.kill();
  if (signal?.aborted) abortProcess();
  signal?.addEventListener("abort", abortProcess, { once: true });
  try {
    if (!captureOutput) {
      return { exitCode: await processHandle.exited, stdout: "" };
    }
    const [stdout, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      processHandle.exited,
    ]);
    return { exitCode, stdout };
  } finally {
    signal?.removeEventListener("abort", abortProcess);
  }
}

const runWrangler = async (args: string[], signal?: AbortSignal) =>
  (await runWranglerCommand(args, false, signal)).exitCode;

const migrateRemoteD1 = (signal?: AbortSignal) =>
  applyRemoteD1Migrations({ signal });

export async function runWorkerDeploy(
  secretsPath: string,
  runner: (args: string[], signal?: AbortSignal) => Promise<number> = runWrangler,
  migrate: (signal?: AbortSignal) => Promise<number> = migrateRemoteD1,
  signal?: AbortSignal,
): Promise<number> {
  const migrationExitCode = await migrate(signal);
  if (migrationExitCode !== 0) return migrationExitCode;
  return runner(["deploy", "--keep-vars", "--secrets-file", secretsPath], signal);
}

const main = Effect.fn("withWorkerSecrets.main")(
  function* withWorkerSecretsMainEffect() {
    const mode = process.argv[2];
    if (mode !== "check" && mode !== "deploy" && mode !== "dev") {
      return yield* new WorkerSecretsError({
        cause: new Error("invalid mode"),
        message: "Usage: with-worker-secrets.ts <check|deploy|dev>",
      });
    }

    const secrets = yield* Effect.try({
      try: readSecrets,
      catch: (cause) => new WorkerSecretsError({
        cause,
        message: String(cause),
      }),
    });
    if (mode === "check") {
      yield* Console.log(
        `Validated ${Object.keys(secrets).length} encrypted Worker secrets.`,
      );
      return;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({
      directory: (process.env.TMPDIR || "/tmp").replace(/\/$/u, ""),
      prefix: "briar-worker-secrets-",
    }).pipe(workerSecretsError("Could not create the Worker secrets directory."));
    const secretsPath = join(
      temporaryDirectory,
      mode === "deploy" ? "secrets.json" : ".dev.vars",
    );
    yield* fileSystem.writeFileString(
      secretsPath,
      mode === "deploy"
        ? `${JSON.stringify(secrets, null, 2)}\n`
        : serializeDotenv(secrets),
      { mode: 0o600 },
    ).pipe(workerSecretsError("Could not write the temporary Worker secrets."));

    const workerDevPortInput = process.env.BRIAR_WORKER_DEV_PORT?.trim();
    const workerDevPort = workerDevPortInput
      ? yield* Schema.decodeUnknownEffect(WorkerDevPort)(workerDevPortInput).pipe(
          Effect.mapError((cause) => new WorkerSecretsError({
            cause,
            message: "BRIAR_WORKER_DEV_PORT must be a valid TCP port.",
          })),
        )
      : undefined;
    const exitCode = mode === "deploy"
      ? yield* Effect.gen(function* workerDeployLeaseEffect() {
          const headSha = yield* verifyProductionGitTarget();
          return yield* withRemoteOperationLease({
            headSha,
            name: "worker-production",
            runner: runWranglerCommand,
          }, (signal) => runWorkerDeploy(
            secretsPath,
            runWrangler,
            migrateRemoteD1,
            signal,
          ));
        })
      : yield* Effect.tryPromise({
          try: (signal) => runWrangler([
            "dev",
            "--env-file",
            secretsPath,
            ...(workerDevPort ? ["--port", String(workerDevPort)] : []),
          ], signal),
          catch: (cause) => new WorkerSecretsError({
            cause,
            message: "Could not run the local Worker.",
          }),
        });

    if (exitCode !== 0) {
      yield* Effect.sync(() => {
        process.exitCode = exitCode;
      });
    }
  },
  Effect.scoped,
);

if (import.meta.main) {
  main().pipe(
    Effect.tapError((error) => Console.error(String(error))),
    Effect.provide(BunServices.layer),
    BunRuntime.runMain({ disableErrorReporting: true }),
  );
}
