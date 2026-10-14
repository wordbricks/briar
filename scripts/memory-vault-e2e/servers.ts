/**
 * Starts and stops the two local `wrangler dev` processes of the e2e check:
 * the real `briar-api` Worker (generated config, private persist dir) and the
 * Artifacts admin Worker. Both bind the remote `briar-memory-e2e` namespace;
 * nothing is deployed.
 *
 * `bun scripts/memory-vault-e2e/servers.ts up` resets the local state, applies
 * every migration and runs both servers in the foreground (for debugging).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { e2eNamespace, writeDevConfig } from "./dev-config";
import { adminPort, adminUrl, apiPort, apiUrl, repoRoot, workDirectory } from "./lib";

const appRoot = join(repoRoot, "apps/briar");
/*
  wrangler 4.150: the repository's 4.127 runs remote Artifacts bindings in dev,
  but its bridge cannot carry the Blob that `repo.readFile` returns
  ("Cannot serialize value: [object Blob]"), so every vault read would fail
  locally. Deployed Workers are unaffected (the live check reads files).
*/
export const wranglerVersion = "4.150.0";
const wrangler = "npx";
const wranglerArgs = ["-y", `wrangler@${wranglerVersion}`];
const persistDirectory = join(workDirectory, "state");
export const apiLogPath = join(workDirectory, "api-dev.log");
export const adminLogPath = join(workDirectory, "admin-dev.log");

const wranglerEnvironment = () => {
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== "459bc0fca39fa1adab8aed615098fcaf") {
    throw new Error("export CLOUDFLARE_ACCOUNT_ID=459bc0fca39fa1adab8aed615098fcaf (two accounts share this login)");
  }
  return { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
};

async function run(args: string[], logPath: string) {
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(wrangler, [...wranglerArgs, ...args], { cwd: appRoot, env: wranglerEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  if (code !== 0) throw new Error(`wrangler ${args[0]} ${args[1] ?? ""} exited ${code}; see ${logPath}`);
}

/** Fresh local D1 with every migration applied. Returns the API config path. */
export async function prepareApi() {
  await rm(persistDirectory, { recursive: true, force: true });
  await mkdir(workDirectory, { recursive: true });
  const { path } = await writeDevConfig({ repoRoot, workDirectory });
  await writeFile(apiLogPath, "");
  await run(["d1", "migrations", "apply", "briar-db", "--local", "--persist-to", persistDirectory, "-c", path], apiLogPath);
  return path;
}

async function writeAdminConfig(adminToken: string) {
  const path = join(workDirectory, "wrangler.admin.json");
  await writeFile(path, `${JSON.stringify({
    name: "briar-memory-vault-e2e-admin",
    main: join(import.meta.dir, "artifacts-admin-worker.ts"),
    compatibility_date: "2026-07-21",
    compatibility_flags: ["nodejs_compat"],
    artifacts: [{ binding: "MEMORY_ARTIFACTS", namespace: e2eNamespace, remote: true }],
    vars: { ADMIN_TOKEN: adminToken, E2E_NAMESPACE: e2eNamespace },
  }, null, 2)}\n`, { mode: 0o600 });
  return path;
}

async function waitFor(url: string, child: ChildProcess, logPath: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited ${child.exitCode}; see ${logPath}`);
    const ok = await fetch(url, { signal: AbortSignal.timeout(3_000) }).then((response) => response.status < 500, () => false);
    if (ok) return;
    await Bun.sleep(1_000);
  }
  throw new Error(`${url} did not come up; see ${logPath}`);
}

function startDev(configPath: string, port: number, logPath: string, extra: string[] = []) {
  // Two dev servers: each needs its own inspector port.
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(wrangler, [
    ...wranglerArgs, "dev", "-c", configPath, "--port", String(port), "--ip", "127.0.0.1",
    "--inspector-port", String(port + 1000), "--show-interactive-dev-session=false", ...extra,
  ], { cwd: appRoot, env: wranglerEnvironment(), stdio: ["ignore", "pipe", "pipe"], detached: false });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  return child;
}

export type Servers = { api: ChildProcess; admin: ChildProcess; stop(): Promise<void> };

export async function startServers(input: { configPath: string; adminToken: string }): Promise<Servers> {
  const api = startDev(input.configPath, apiPort, apiLogPath, ["--persist-to", persistDirectory, "--test-scheduled"]);
  await writeFile(adminLogPath, "");
  const admin = startDev(await writeAdminConfig(input.adminToken), adminPort, adminLogPath);
  const stopOne = async (child: ChildProcess) => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), Bun.sleep(10_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  const servers: Servers = { api, admin, stop: async () => { await Promise.all([stopOne(api), stopOne(admin)]); } };
  try {
    await Promise.all([
      waitFor(`${apiUrl}/health`, api, apiLogPath),
      waitFor(`${adminUrl}/`, admin, adminLogPath),
    ]);
  } catch (error) {
    await servers.stop();
    throw error;
  }
  return servers;
}

/** Calls the admin Worker. */
export async function admin<T>(adminToken: string, route: string, name?: string): Promise<T> {
  const url = new URL(route, adminUrl);
  if (name) url.searchParams.set("name", name);
  const response = await fetch(url, { headers: { authorization: `Bearer ${adminToken}` } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(`admin ${route} failed: ${body.error ?? response.status}`);
  return body;
}

/** Triggers the API Worker's minute cron (the purge processor) once. */
export async function triggerMinuteCron() {
  const cron = encodeURIComponent("* * * * *");
  let response = await fetch(`${apiUrl}/cdn-cgi/handler/scheduled?cron=${cron}`);
  if (response.status === 404) response = await fetch(`${apiUrl}/__scheduled?cron=${cron}`);
  if (!response.ok) throw new Error(`scheduled trigger failed: ${response.status}`);
  return response.text();
}

if (import.meta.main && process.argv[2] === "up") {
  const configPath = await prepareApi();
  const token = crypto.randomUUID();
  const servers = await startServers({ configPath, adminToken: token });
  console.log(`api ${apiUrl}, admin ${adminUrl} (token in ${join(workDirectory, "wrangler.admin.json")}); Ctrl-C stops`);
  process.on("SIGINT", () => void servers.stop().then(() => process.exit(0)));
  process.on("SIGTERM", () => void servers.stop().then(() => process.exit(0)));
  await new Promise(() => undefined);
}
