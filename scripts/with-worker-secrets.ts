import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED_SECRETS = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

type Mode = "check" | "deploy" | "dev";

function readSecrets(): Record<(typeof REQUIRED_SECRETS)[number], string> {
  return Object.fromEntries(
    REQUIRED_SECRETS.map((name) => {
      const value = process.env[name]?.trim();
      if (!value) {
        throw new Error(`Missing required secret: ${name}`);
      }
      return [name, value];
    }),
  ) as Record<(typeof REQUIRED_SECRETS)[number], string>;
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

async function main(): Promise<void> {
  const mode = process.argv[2] as Mode | undefined;
  if (!mode || !["check", "deploy", "dev"].includes(mode)) {
    throw new Error("Usage: with-worker-secrets.ts <check|deploy|dev>");
  }

  const secrets = readSecrets();
  if (mode === "check") {
    console.log(`Validated ${REQUIRED_SECRETS.length} encrypted Worker secrets.`);
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

    const exitCode = await runWrangler(
      mode === "deploy"
        ? ["deploy", "--secrets-file", secretsPath]
        : ["dev", "--env-file", secretsPath],
    );

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
