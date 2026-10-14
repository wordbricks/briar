#!/usr/bin/env bun
// Verifies the production memory vault store (`ArtifactsVaultGitStore`)
// against real Cloudflare Artifacts (docs/operations/memory-vault.md,
// "Live check").
//
//   bun scripts/memory-vault-live-check.ts [--out <file.md>]
//
// 1. Deploys scripts/memory-vault-live-check/worker.ts under a random name
//    (`briar-memory-vault-live-check-<random>`) with a random bearer token,
//    bound to the separate `briar-memory-live-check` Artifacts namespace.
// 2. Calls it once; the Worker runs the scenario (create, CAS writes,
//    concurrent writers, history and old reads, forget + history rewrite into
//    the next generation, deletion purge, cleanup) and returns every step.
// 3. Deletes the Worker, also on failure or Ctrl-C.
//
// Uses the Wrangler login or CLOUDFLARE_API_TOKEN of the caller. It never
// touches the production `briar-api` Worker or the `briar-memory` namespace.
// Exits 1 if any step failed. `--out` also writes the result as Markdown
// evidence (see docs/operations/evidence/).

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..");
const appDir = join(repoRoot, "apps", "briar");
const config = join(repoRoot, "scripts", "memory-vault-live-check", "wrangler.jsonc");

type Step = { name: string; ok: boolean; ms: number; detail?: unknown; error?: string };
type CheckResult = { ok: boolean; prefix: string; steps: Step[] };

const outIndex = process.argv.indexOf("--out");
const outFile = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

async function wrangler(args: string[], options: { quiet?: boolean } = {}) {
  const child = Bun.spawn(["bunx", "wrangler", ...args], { cwd: appDir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (!options.quiet) process.stderr.write(stderr);
  if (code !== 0) throw new Error(`wrangler ${args[0]} failed (${code}):\n${stdout}\n${stderr}`);
  return stdout;
}

const name = `briar-memory-vault-live-check-${crypto.randomUUID().slice(0, 8)}`;
const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
let deployed = false;

async function cleanup() {
  if (!deployed) return;
  deployed = false;
  try {
    await wrangler(["delete", "--name", name, "--force"], { quiet: true });
    console.error(`[live-check] deleted ${name}`);
  } catch (error) {
    console.error(`[live-check] could not delete ${name}; delete it by hand: bunx wrangler delete --name ${name}`);
    console.error(error);
  }
}

process.on("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});

async function callCheck(url: string): Promise<CheckResult> {
  // A new workers.dev host can take a few seconds to answer.
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (response?.ok) return await response.json() as CheckResult;
    if (attempt >= 20) throw new Error(`the check Worker did not answer: ${response?.status ?? "no response"}`);
    await Bun.sleep(3_000);
  }
}

function markdown(result: CheckResult, url: string) {
  const lines = result.steps.map((step) => JSON.stringify(step));
  return [
    `# Memory vault live store check — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `\`scripts/memory-vault-live-check.ts\`: \`ArtifactsVaultGitStore\` bundled unchanged into a throwaway Worker (\`${new URL(url).hostname.split(".")[0]}\`, namespace \`briar-memory-live-check\`), run once against real Artifacts, then deleted. Result: **${result.ok ? "pass" : "FAIL"}**. Times are wall-clock ms inside the Worker.`,
    "",
    "```json",
    ...lines,
    "```",
    "",
  ].join("\n");
}

try {
  console.error(`[live-check] deploying ${name}`);
  deployed = true;
  const output = await wrangler(["deploy", "--config", config, "--name", name, "--var", `CHECK_TOKEN:${token}`]);
  const url = /https:\/\/[^\s]+\.workers\.dev/u.exec(output)?.[0];
  if (!url) throw new Error(`could not find the workers.dev URL in the deploy output:\n${output}`);
  console.error(`[live-check] running the scenario at ${url}`);
  const result = await callCheck(url);
  for (const step of result.steps) {
    console.log(`${step.ok ? "PASS" : "FAIL"} ${step.name} (${step.ms} ms)${step.error ? ` — ${step.error}` : ""}`);
  }
  console.log(result.ok ? "live check passed" : "live check FAILED");
  if (outFile) await writeFile(outFile, markdown(result, url));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
