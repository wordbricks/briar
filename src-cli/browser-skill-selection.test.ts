import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const bunExecutable = spawnSync("/usr/bin/env", ["which", "bun"], {
  encoding: "utf8",
}).stdout.trim();

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("browser skill selection", () => {
  it("binds the browser selected in local settings without a fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-browser-skill-"));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, "config.json"),
      `${JSON.stringify({
        apiUrl: "https://briar.example.com",
        appSettings: {
          browserAutomationProvider: "agent-browser",
        },
        projects: [],
      })}\n`,
    );

    const result = spawnSync(
      bunExecutable,
      ["run", "src-cli/index.ts", "skills", "get", "browser"],
      {
        cwd: process.cwd(),
        env: { ...process.env, BRIAR_CONFIG_HOME: directory },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "selected **`agent-browser`** in **Briar Settings → Browser**",
    );
    expect(result.stdout).toContain(
      "Never switch to the other browser tool automatically",
    );
    expect(result.stdout).not.toContain("{{BROWSER_AUTOMATION_PROVIDER}}");
  });
});
