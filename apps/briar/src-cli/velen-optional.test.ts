import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { type Config, encodeConfigJson } from "./config-contract";

const temporaryHomes: string[] = [];
const repositoryWorkflow = {
  version: 2 as const,
  requirements: [],
  stages: [{ id: "analyzing", label: "Analyze", required: true }],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["analyzing"] },
};
const bunExecutable = spawnSync("/usr/bin/env", ["which", "bun"], {
  encoding: "utf8",
}).stdout.trim();

async function cliHome(velenOrg?: string) {
  const home = await mkdtemp(join(tmpdir(), "briar-optional-velen-"));
  temporaryHomes.push(home);
  const configDirectory = join(home, ".config", "briar");
  await writeCliConfig(configDirectory, velenOrg);
  return home;
}

async function writeCliConfig(configDirectory: string, velenOrg?: string) {
  await mkdir(configDirectory, { recursive: true });
  const config = {
    apiUrl: "http://127.0.0.1:8787",
    agentProviders: {
      codex: true,
      claude: true,
      cursor: true,
      grok: true,
      agy: true,
      opencode: true,
      openrouter: true,
      vertex: true,
    },
    appSettings: {
      preventSleepWhileRunning: false,
      browserAutomationProvider: "ego-browser",
    },
    projects: [{
      id: "11111111-1111-4111-8111-111111111111",
      repositoryPath: process.cwd(),
      agentToken: "briar_agent_test",
      apiUrl: "http://127.0.0.1:8787",
      autoHunt: {
        ...(velenOrg ? { velenOrg } : undefined),
        linear: { enabled: false },
        workflow: repositoryWorkflow,
      },
    }],
  } satisfies Config;
  await writeFile(
    join(configDirectory, "config.json"),
    encodeConfigJson(config),
  );
}

function runCli(
  home: string,
  command: string[],
  configDirectory?: string,
  worktreeHome?: string,
) {
  const environment = { ...process.env };
  for (const name of [
    "BRIAR_AGENT_TOKEN",
    "BRIAR_API_URL",
    "BRIAR_CONFIG_HOME",
    "BRIAR_PROJECT_ID",
    "BRIAR_WORKTREE_HOME",
    "BRIAR_WORKTREE_ROOT",
  ]) {
    delete environment[name];
  }
  return spawnSync(
    bunExecutable,
    ["run", "src-cli/index.ts", ...command],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        HOME: home,
        PATH: "/usr/bin:/bin",
        ...(configDirectory
          ? { BRIAR_CONFIG_HOME: configDirectory }
          : undefined),
        ...(worktreeHome ? { BRIAR_WORKTREE_HOME: worktreeHome } : undefined),
      },
      encoding: "utf8",
    },
  );
}

function runDoctor(home: string, configDirectory?: string, worktreeHome?: string) {
  return runCli(home, ["project", "doctor"], configDirectory, worktreeHome);
}

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((home) =>
    rm(home, { recursive: true, force: true })
  ));
});

describe("optional Velen CLI preflight", () => {
  it("allows doctor to pass when a project does not configure Velen", async () => {
    const result = runDoctor(await cliHome());

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      velenOrg: null,
      velenHealthy: true,
      velenError: null,
      linearEnabled: false,
      requestIds: [],
    });
  });

  it("reports unavailable configured Velen without failing doctor", async () => {
    const result = runDoctor(await cliHome("wordbricks"));

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      velenOrg: "wordbricks",
      velenHealthy: false,
      requestIds: [],
    });
    expect(JSON.parse(result.stdout).velenError).toContain("Velen CLI");
  });

  it("does not preflight configured Velen before starting an issue worker", async () => {
    const result = runCli(await cliHome("wordbricks"), ["worker"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("worker가 등록되지 않았습니다");
    expect(result.stderr).not.toContain("Velen CLI");
  });

  it("uses an explicit Briar config home even when HOME points elsewhere", async () => {
    const home = await mkdtemp(join(tmpdir(), "briar-unrelated-home-"));
    const configRoot = await mkdtemp(join(tmpdir(), "briar-explicit-config-"));
    temporaryHomes.push(home, configRoot);
    await writeCliConfig(configRoot);

    const result = runDoctor(home, configRoot);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      teamId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("keeps the default worktree root under the persistent host home", async () => {
    const sandboxHome = await cliHome();
    const worktreeHome = await mkdtemp(join(tmpdir(), "briar-persistent-home-"));
    temporaryHomes.push(worktreeHome);

    const result = runDoctor(sandboxHome, undefined, worktreeHome);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).worktrees.root).toBe(
      join(
        worktreeHome,
        "briar",
        "workspaces",
        "11111111-1111-4111-8111-111111111111",
      ),
    );
  });
});
