import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryHomes: string[] = [];
const repositoryWorkflow = {
  version: 1,
  stages: [{ id: "analyzing", label: "Analyze", required: true }],
  completion: { requiredStages: ["analyzing"] },
  release: { enabled: false },
} as const;
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
  await writeFile(
    join(configDirectory, "config.json"),
    JSON.stringify({
      apiUrl: "http://127.0.0.1:8787",
      projects: [{
        id: "11111111-1111-4111-8111-111111111111",
        repositoryPath: process.cwd(),
        agentToken: "briar_agent_test",
        autoHunt: {
          ...(velenOrg ? { velenOrg } : {}),
          linear: { enabled: false },
          workflow: repositoryWorkflow,
        },
      }],
    }),
  );
}

function runDoctor(home: string, configDirectory?: string) {
  const environment = { ...process.env };
  for (const name of [
    "BRIAR_AGENT_TOKEN",
    "BRIAR_API_URL",
    "BRIAR_CONFIG_HOME",
    "BRIAR_PROJECT_ID",
    "BRIAR_WORKTREE_ROOT",
  ]) {
    delete environment[name];
  }
  return spawnSync(
    bunExecutable,
    ["run", "src-cli/index.ts", "project", "doctor"],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        HOME: home,
        PATH: `${dirname(bunExecutable)}:/usr/bin:/bin`,
        ...(configDirectory ? { BRIAR_CONFIG_HOME: configDirectory } : {}),
      },
      encoding: "utf8",
    },
  );
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
      linearEnabled: false,
      requestIds: [],
    });
  });

  it("still requires Velen when a project explicitly configures an organization", async () => {
    const result = runDoctor(await cliHome("wordbricks"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Velen CLI");
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
      projectId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
