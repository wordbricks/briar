import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRemoteD1Migrations } from "./apply-remote-d1-migrations";
import { verifyProductionGitTarget } from "./production-git-target";
import { withRemoteOperationLease } from "./remote-operation-lease";

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

async function runWrangler(args: string[], signal?: AbortSignal): Promise<number> {
  const processHandle = Bun.spawn(["wrangler", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const abortProcess = () => processHandle.kill();
  if (signal?.aborted) abortProcess();
  signal?.addEventListener("abort", abortProcess, { once: true });
  try {
    return await processHandle.exited;
  } finally {
    signal?.removeEventListener("abort", abortProcess);
  }
}

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

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "check" && mode !== "deploy" && mode !== "dev") {
    throw new Error("Usage: with-worker-secrets.ts <check|deploy|dev>");
  }

  const secrets = readSecrets();
  if (mode === "check") {
    console.log(
      `Validated ${Object.keys(secrets).length} encrypted Worker secrets.`,
    );
    return;
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "briar-worker-secrets-"));

  try {
    const secretsPath = join(
      temporaryDirectory,
      mode === "deploy" ? "secrets.json" : ".dev.vars",
    );

    await writeFile(
      secretsPath,
      mode === "deploy"
        ? `${JSON.stringify(secrets, null, 2)}\n`
        : serializeDotenv(secrets),
      { mode: 0o600 },
    );

    const workerDevPort = process.env.BRIAR_WORKER_DEV_PORT?.trim();
    if (workerDevPort) {
      const parsedWorkerDevPort = Number(workerDevPort);
      if (
        !/^\d{1,5}$/u.test(workerDevPort) ||
        !Number.isInteger(parsedWorkerDevPort) ||
        parsedWorkerDevPort < 1 ||
        parsedWorkerDevPort > 65_535
      ) {
        throw new Error("BRIAR_WORKER_DEV_PORT must be a valid TCP port.");
      }
    }
    const exitCode = mode === "deploy"
      ? await (async () => {
          const headSha = await verifyProductionGitTarget();
          return withRemoteOperationLease({
            headSha,
            name: "worker-production",
            runner: async (args, captureOutput = false, signal) => {
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
            },
          }, (signal) => runWorkerDeploy(
            secretsPath,
            runWrangler,
            migrateRemoteD1,
            signal,
          ));
        })()
      : await runWrangler([
          "dev",
          "--env-file",
          secretsPath,
          ...(workerDevPort ? ["--port", workerDevPort] : []),
        ]);

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
