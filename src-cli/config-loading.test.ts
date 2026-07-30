import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  it("repairs a legacy empty workflow execution boundary", async () => {
    const directory = await configDirectory({
      apiUrl: "https://briar.example.com",
      projects: [
        {
          id: projectId,
          repositoryPath: process.cwd(),
          agentToken: "briar_agent_test",
          autoHunt: {
            workflow: {
              version: 1,
              stages: [
                { id: "analyzing", label: "Analyze", required: true },
              ],
              execution: { stopAfterStage: "" },
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
});
