import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateReleaseManifest,
  verifyReleaseManifest,
} from "./release-manifest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "briar-release-manifest-"));
  directories.push(directory);
  await writeFile(join(directory, "Briar_0.3.0_aarch64.dmg"), "dmg fixture");
  await writeFile(join(directory, "Briar_0.3.0_macos.app.zip"), "app fixture");
  return directory;
}

describe("release manifest", () => {
  it("generates and verifies deterministic artifact metadata", async () => {
    const directory = await fixture();
    const manifest = await generateReleaseManifest(directory, {
      version: "0.3.0",
      channel: "rc",
      previousVersion: "0.2.0",
      commitSha: "a".repeat(40),
      releasedAt: "2026-07-22T00:00:00Z",
    });

    expect(manifest.artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      "app",
      "dmg",
    ]);
    await expect(verifyReleaseManifest(directory)).resolves.toEqual(manifest);
  });

  it("rejects a modified artifact", async () => {
    const directory = await fixture();
    await generateReleaseManifest(directory, {
      version: "0.3.0",
      channel: "rc",
      previousVersion: "0.2.0",
      commitSha: "b".repeat(40),
      releasedAt: "2026-07-22T00:00:00Z",
    });
    await writeFile(join(directory, "Briar_0.3.0_macos.app.zip"), "tampered");

    await expect(verifyReleaseManifest(directory)).rejects.toThrow(
      /artifact size mismatch|artifact checksum mismatch/iu,
    );
  });

  it("rejects a non-forward release", async () => {
    const directory = await fixture();
    await expect(
      generateReleaseManifest(directory, {
        version: "0.3.0",
        channel: "rc",
        previousVersion: "0.3.0",
        commitSha: "c".repeat(40),
        releasedAt: "2026-07-22T00:00:00Z",
      }),
    ).rejects.toThrow("previousVersion must be lower than version");
  });
});
