import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const pluginPath = join(
  repositoryRoot,
  "tools/oxlint/anti-slop/index.ts",
);
const oxlintPath = join(
  repositoryRoot,
  "node_modules/.bin",
  process.platform === "win32" ? "oxlint.cmd" : "oxlint",
);
const temporaryDirectories: string[] = [];

type Fixture = {
  configPath: string;
  files: string[];
};

async function makeFixture(
  sources: Readonly<Record<string, string>>,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "briar-tauri-ipc-lint-"));
  temporaryDirectories.push(root);

  const configPath = join(root, ".oxlintrc.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        jsPlugins: [{ name: "anti-slop", specifier: pluginPath }],
        categories: { correctness: "off" },
        rules: { "anti-slop/no-raw-tauri-ipc": "error" },
      },
      null,
      2,
    )}\n`,
  );

  const files = await Promise.all(
    Object.entries(sources).map(async ([relativePath, source]) => {
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source);
      return path;
    }),
  );
  return { configPath, files };
}

function lint(fixture: Fixture): { output: string; status: number | null } {
  const result = spawnSync(
    oxlintPath,
    ["--config", fixture.configPath, "--format", "unix", ...fixture.files],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("no-raw-tauri-ipc", () => {
  it("allows generated bindings and the exact native plugin call", async () => {
    const fixture = await makeFixture({
      "apps/briar/src/generated/tauri.ts":
        'import { invoke as __TAURI_INVOKE } from "@tauri-apps/api/core";\nvoid __TAURI_INVOKE;\n',
      "apps/briar/src/lib/auth-session.ts":
        'export async function start() {\n  const { invoke } = await import("@tauri-apps/api/core");\n  await invoke("plugin:auth-session|start", {});\n}\n',
    });

    expect(lint(fixture)).toMatchObject({ status: 0 });
  });

  it("rejects static, dynamic, and re-exported raw Tauri IPC modules", async () => {
    const fixture = await makeFixture({
      "apps/briar/src/lib/static-core.ts":
        'import { invoke } from "@tauri-apps/api/core";\nvoid invoke;\n',
      "apps/briar/src/lib/dynamic-event.ts":
        'void import("@tauri-apps/api/event");\n',
      "apps/briar/src/lib/named-export.ts":
        'export { listen } from "@tauri-apps/api/event";\n',
      "apps/briar/src/lib/star-export.ts":
        'export * from "@tauri-apps/api/core";\n',
      "apps/briar/src/lib/barrel.ts":
        'import { core, event } from "@tauri-apps/api";\nvoid core;\nvoid event;\n',
      "apps/briar/src/lib/barrel-index.ts":
        'import { core } from "@tauri-apps/api/index";\nvoid core;\n',
    });

    const result = lint(fixture);
    expect(result.status).toBe(1);
    expect(result.output.match(/bypasses the Rust SSOT/gu)).toHaveLength(6);
  });

  it("keeps the auth-session exception exact", async () => {
    const wrongCommand = await makeFixture({
      "apps/briar/src/lib/auth-session.ts":
        'export async function start() {\n  const { invoke } = await import("@tauri-apps/api/core");\n  await invoke("load_project", {});\n}\n',
    });
    const staticImport = await makeFixture({
      "apps/briar/src/lib/auth-session.ts":
        'import { invoke } from "@tauri-apps/api/core";\nvoid invoke;\n',
    });
    const escapedInvoke = await makeFixture({
      "apps/briar/src/lib/auth-session.ts":
        'export async function start() {\n  const { invoke } = await import("@tauri-apps/api/core");\n  const appInvoke = invoke;\n  await appInvoke("load_project", {});\n}\n',
    });

    const wrongCommandResult = lint(wrongCommand);
    expect(wrongCommandResult.status).toBe(1);
    expect(wrongCommandResult.output).toContain(
      'only permits `invoke("plugin:auth-session|start", ...)`',
    );

    const staticImportResult = lint(staticImport);
    expect(staticImportResult.status).toBe(1);
    expect(staticImportResult.output).toContain("bypasses the Rust SSOT");

    const escapedInvokeResult = lint(escapedInvoke);
    expect(escapedInvokeResult.status).toBe(1);
    expect(escapedInvokeResult.output).toContain(
      'only permits `invoke("plugin:auth-session|start", ...)`',
    );
  });
});
