import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryHomes: string[] = [];
const bunExecutable = spawnSync("/usr/bin/env", ["which", "bun"], {
  encoding: "utf8",
}).stdout.trim();

async function cliHome(velenOrg?: string) {
  const home = await mkdtemp(join(tmpdir(), "briar-optional-velen-"));
  temporaryHomes.push(home);
  const configDirectory = join(home, ".config", "briar");
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
        },
      }],
    }),
  );
  return home;
}

function runDoctor(home: string) {
  return spawnSync(
    bunExecutable,
    ["run", "src-cli/index.ts", "auto-hunt", "doctor"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        PATH: `${dirname(bunExecutable)}:/usr/bin:/bin`,
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
});
