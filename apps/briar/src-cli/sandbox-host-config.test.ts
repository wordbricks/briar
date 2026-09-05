import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSandboxHostConfig,
  removeSandboxHostEntry,
  sandboxHostConfigPath,
  upsertSandboxHostEntry,
} from "./sandbox-host-config";

const directories: string[] = [];
const projectId = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "briar-sandbox-host-"));
  directories.push(path);
  return path;
}

describe("sandbox host registry", () => {
  it("starts empty and round-trips entries", async () => {
    const root = await directory();
    expect(await loadSandboxHostConfig(root)).toEqual({ version: 1, sandboxes: {} });
    await upsertSandboxHostEntry("gx10", {
      dockerContext: "briar-sandbox-gx10",
      host: "ssh://jay@gx10",
      teamIds: [projectId],
      gpus: true,
      runtimeSha256: "a".repeat(64),
      updatedAt: "2026-09-05T00:00:00.000Z",
    }, root);
    const loaded = await loadSandboxHostConfig(root);
    expect(loaded.sandboxes.gx10?.host).toBe("ssh://jay@gx10");
    expect(loaded.sandboxes.gx10?.teamIds).toEqual([projectId]);
    const raw = await readFile(sandboxHostConfigPath(root), "utf8");
    expect(raw).not.toContain("briar_agent_");
    expect(raw).not.toContain("token");
    await removeSandboxHostEntry("gx10", root);
    const afterRemove = await loadSandboxHostConfig(root);
    expect(afterRemove.sandboxes.gx10).toMatchObject({
      dockerContext: "briar-sandbox-gx10",
      host: "ssh://jay@gx10",
      teamIds: [],
      gpus: true,
      runtimeSha256: "",
    });
    await removeSandboxHostEntry("missing", root);
    expect(Object.keys((await loadSandboxHostConfig(root)).sandboxes)).toEqual(["gx10"]);
  });

  it("reads a registry written before the project-to-team rename", async () => {
    const root = await directory();
    await writeFile(sandboxHostConfigPath(root), JSON.stringify({
      version: 1,
      sandboxes: {
        gx10: {
          dockerContext: "briar-sandbox-gx10",
          projectIds: [projectId],
          gpus: false,
          runtimeSha256: "a".repeat(64),
          updatedAt: "2026-09-05T00:00:00.000Z",
        },
      },
    }));
    const loaded = await loadSandboxHostConfig(root);
    expect(loaded.sandboxes.gx10?.teamIds).toEqual([projectId]);
  });

  it("rejects a corrupted registry instead of silently resetting it", async () => {
    const root = await directory();
    await writeFile(sandboxHostConfigPath(root), "{\"version\": 2}");
    await expect(loadSandboxHostConfig(root)).rejects.toThrow("corrupted");
  });
});
