import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentBundleCandidates, findAgentBundle } from "./agent-bundle-path";

const roots: string[] = [];

async function layout(files: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), "briar-agent-bundle-"));
  roots.push(root);
  for (const file of files) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "// bundle\n");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agentBundleCandidates", () => {
  it("tries the installed agent directory, then a sibling, then the checkout dist-agent", () => {
    expect(agentBundleCandidates("/opt/briar/lib", "codex-runner.js")).toEqual([
      "/opt/briar/lib/agent/codex-runner.js",
      "/opt/briar/lib/codex-runner.js",
      "/opt/briar/dist-agent/codex-runner.js",
    ]);
  });
});

describe("findAgentBundle", () => {
  it("finds runners under agent/ for the installed CLI bundle", async () => {
    const root = await layout(["lib/briar.js", "lib/agent/codex-runner.js"]);
    await expect(findAgentBundle(join(root, "lib"), "codex-runner.js"))
      .resolves.toBe(join(root, "lib/agent/codex-runner.js"));
  });

  it("finds sibling runners for the installed Computer Use MCP server", async () => {
    // The MCP server bundle runs from inside lib/agent and starts child runs
    // from there, so it must find the runner next to itself.
    const root = await layout([
      "lib/briar.js",
      "lib/agent/computer-use-mcp-server.js",
      "lib/agent/codex-runner.js",
    ]);
    await expect(findAgentBundle(join(root, "lib/agent"), "codex-runner.js"))
      .resolves.toBe(join(root, "lib/agent/codex-runner.js"));
  });

  it("falls back to dist-agent for a checkout", async () => {
    const root = await layout(["dist-cli/briar.js", "dist-agent/codex-runner.js"]);
    await expect(findAgentBundle(join(root, "dist-cli"), "codex-runner.js"))
      .resolves.toBe(join(root, "dist-agent/codex-runner.js"));
    await expect(findAgentBundle(join(root, "src-cli"), "codex-runner.js"))
      .resolves.toBe(join(root, "dist-agent/codex-runner.js"));
  });

  it("returns null when nothing was built", async () => {
    const root = await layout(["lib/briar.js"]);
    await expect(findAgentBundle(join(root, "lib"), "codex-runner.js")).resolves.toBeNull();
  });
});
