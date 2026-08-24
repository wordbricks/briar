import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectId = "11111111-1111-4111-8111-111111111111";
const temporaryDirectories: string[] = [];
const bunExecutable = spawnSync("/usr/bin/env", ["which", "bun"], {
  encoding: "utf8",
}).stdout.trim();

async function configDirectory(config: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "briar-cli-config-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify(config)}\n`,
  );
  return directory;
}

function workerStatus(directory: string) {
  const environment = { ...process.env };
  for (const name of [
    "BRIAR_API_URL",
    "BRIAR_CONFIG_HOME",
    "BRIAR_PROJECT_ID",
  ]) {
    delete environment[name];
  }
  return spawnSync(
    bunExecutable,
    [
      "run",
      "src-cli/index.ts",
      "worker",
      "status",
      "--project",
      projectId,
    ],
    {
      cwd: process.cwd(),
      env: { ...environment, BRIAR_CONFIG_HOME: directory },
      encoding: "utf8",
    },
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI config loading", () => {
  it("loads a canonical workflow execution boundary", async () => {
    const directory = await configDirectory({
      apiUrl: "https://briar.example.com",
      projects: [
        {
          id: projectId,
          repositoryPath: process.cwd(),
          agentToken: "briar_agent_test",
          autoHunt: {
            workflow: {
              version: 2,
              requirements: [],
              stages: [
                { id: "analyzing", label: "Analyze", required: true },
              ],
              execution: { checkpoints: [] },
              completion: { requiredStages: ["analyzing"] },
            },
          },
        },
      ],
    });

    const result = workerStatus(directory);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      projectId,
      registered: false,
    });
  });

  it("reports an invalid config instead of pretending it has no projects", async () => {
    const directory = await configDirectory({
      apiUrl: "https://briar.example.com",
      projects: "invalid",
    });

    const result = workerStatus(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Briar 로컬 설정이 손상되었습니다");
    expect(result.stderr).toContain("projects");
    expect(result.stderr).not.toContain(
      "이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다",
    );
  });

  it("keeps the enrolled API origin authoritative over environment overrides", async () => {
    const managedComputerId = "44444444-4444-4444-8444-444444444444";
    const organizationId = "55555555-5555-4555-8555-555555555555";
    const directory = await configDirectory({
      apiUrl: "https://stored.example",
      managedComputer: {
        managedComputerId,
        deviceId: `managed-${managedComputerId}`,
        organizationId,
        credentialFile: "/tmp/briar-managed-credential-placeholder.json",
      },
      projects: [],
    });
    const credentialFile = join(directory, "credential.json");
    const configFile = join(directory, "config.json");
    const config = JSON.parse(await readFile(configFile, "utf8"));
    config.managedComputer.credentialFile = credentialFile;
    await writeFile(configFile, `${JSON.stringify(config)}\n`);
    await writeFile(credentialFile, JSON.stringify({
      credential: `briar_worker_${"a".repeat(43)}`,
      deviceId: `managed-${managedComputerId}`,
      organizationId,
      managedComputerId,
      apiOrigin: "https://enrolled.example",
    }), { mode: 0o600 });

    const environment = { ...process.env };
    delete environment.BRIAR_CONFIG_HOME;
    delete environment.BRIAR_MANAGED_CREDENTIAL_FILE;
    const result = spawnSync(
      bunExecutable,
      [
        "-e",
        'const { loadConfig } = await import("./src-cli/command-support.ts"); console.log((await loadConfig()).apiUrl);',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...environment,
          BRIAR_API_URL: "https://override.example",
          BRIAR_CONFIG_HOME: directory,
          BRIAR_MANAGED_CREDENTIAL_FILE: credentialFile,
        },
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("https://enrolled.example");
  });
});
