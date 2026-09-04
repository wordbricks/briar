import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectId = "11111111-1111-4111-8111-111111111111";
const temporaryDirectories: string[] = [];
const localSettings = {
  agentProviders: {
    codex: true,
    claude: true,
    cursor: true,
    grok: true,
    agy: true,
    opencode: true,
    openrouter: true,
    vertex: true,
    pi: true,
  },
  appSettings: {
    preventSleepWhileRunning: false,
    browserAutomationProvider:
      "LOCAL_BROWSER_AUTOMATION_PROVIDER_EGO_BROWSER",
  },
};
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
  it("ports a 1.2.174 config and skips an unrelated stale repository", async () => {
    const staleRepository = join(
      tmpdir(),
      `briar-deleted-repository-${crypto.randomUUID()}`,
    );
    const directory = await configDirectory({
      apiUrl: "https://briar.example.com",
      agentProviders: localSettings.agentProviders,
      appSettings: {
        preventSleepWhileRunning: false,
        browserAutomationProvider: "ego-browser",
      },
      projects: [
        {
          id: projectId,
          repositoryPath: process.cwd(),
          agentToken: "briar_agent_current",
          apiUrl: "https://briar.example.com",
          autoHunt: {
            linear: { enabled: false },
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
        {
          id: "22222222-2222-4222-8222-222222222222",
          repositoryPath: staleRepository,
          agentToken: "briar_agent_stale",
          apiUrl: "https://briar.example.com",
        },
      ],
    });
    const environment = { ...process.env };
    delete environment.BRIAR_API_URL;
    delete environment.BRIAR_PROJECT_ID;
    environment.BRIAR_CONFIG_HOME = directory;

    const result = spawnSync(
      bunExecutable,
      ["run", "src-cli/index.ts", "workflow", "show"],
      { cwd: process.cwd(), env: environment, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ teamId: projectId });
    const canonical = JSON.parse(
      await readFile(join(directory, "config.json"), "utf8"),
    );
    expect(canonical.appSettings.browserAutomationProvider).toBe(
      "LOCAL_BROWSER_AUTOMATION_PROVIDER_EGO_BROWSER",
    );
    const backups = (await readdir(directory)).filter((name) =>
      name.startsWith("config.pre-proto-ssot-")
    );
    expect(backups).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(directory, backups[0]), "utf8"))
        .appSettings.browserAutomationProvider,
    ).toBe("ego-browser");
  });

  it("defaults browser automation to agent-browser when config is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-cli-config-"));
    temporaryDirectories.push(directory);
    const environment = { ...process.env };
    delete environment.BRIAR_API_URL;
    delete environment.BRIAR_MANAGED_CREDENTIAL_FILE;
    const result = spawnSync(
      bunExecutable,
      [
        "-e",
        'const { loadConfig } = await import("./src-cli/command-support.ts"); console.log((await loadConfig()).appSettings.browserAutomationProvider);',
      ],
      {
        cwd: process.cwd(),
        env: { ...environment, BRIAR_CONFIG_HOME: directory },
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("agent-browser");
  });

  it("loads a canonical workflow execution boundary", async () => {
    const directory = await configDirectory({
      apiUrl: "https://briar.example.com",
      ...localSettings,
      projects: [
        {
          id: projectId,
          repositoryPath: process.cwd(),
          agentToken: "briar_agent_test",
          apiUrl: "https://briar.example.com",
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
      ...localSettings,
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
      ...localSettings,
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
