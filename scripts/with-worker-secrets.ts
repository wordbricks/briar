import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRemoteD1Migrations } from "./apply-remote-d1-migrations";

const REQUIRED_SECRETS = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

const OPTIONAL_SECRET_GROUPS = [
  [
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
] as const;

type Mode = "check" | "deploy" | "dev";

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

async function runWrangler(args: string[]): Promise<number> {
  const processHandle = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return processHandle.exited;
}

export async function runWorkerDeploy(
  secretsPath: string,
  runner: (args: string[]) => Promise<number> = runWrangler,
  migrate: () => Promise<number> = applyRemoteD1Migrations,
): Promise<number> {
  const migrationExitCode = await migrate();
  if (migrationExitCode !== 0) return migrationExitCode;
  return runner(["deploy", "--keep-vars", "--secrets-file", secretsPath]);
}

async function main(): Promise<void> {
  const mode = process.argv[2] as Mode | undefined;
  if (!mode || !["check", "deploy", "dev"].includes(mode)) {
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
    const parsedWorkerDevPort = workerDevPort ? Number(workerDevPort) : null;
    if (
      workerDevPort &&
      (!/^\d{1,5}$/u.test(workerDevPort) ||
        !Number.isInteger(parsedWorkerDevPort) ||
        parsedWorkerDevPort! < 1 ||
        parsedWorkerDevPort! > 65_535)
    ) {
      throw new Error("BRIAR_WORKER_DEV_PORT must be a valid TCP port.");
    }
    const exitCode = mode === "deploy"
      ? await runWorkerDeploy(secretsPath)
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
