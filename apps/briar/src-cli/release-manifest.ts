import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

export type ReleaseArtifact = {
  kind: "app" | "dmg";
  name: string;
  bytes: number;
  sha256: string;
};

export type ReleaseManifest = {
  schemaVersion: 1;
  product: "Briar";
  version: string;
  channel: "rc" | "stable";
  previousVersion: string | null;
  target: "aarch64-apple-darwin";
  commitSha: string;
  releasedAt: string;
  artifacts: ReleaseArtifact[];
};

const manifestName = "release-manifest.json";
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const shaPattern = /^[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;

function artifactKind(name: string): ReleaseArtifact["kind"] | null {
  if (name.endsWith("_macos.app.zip")) return "app";
  if (name.endsWith(".dmg")) return "dmg";
  return null;
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function assertSemver(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !semverPattern.test(value)) {
    throw new Error(`${field} must be a semantic version.`);
  }
}

function compareSemver(left: string, right: string) {
  const [leftCore, leftPrerelease] = left.split("-", 2);
  const [rightCore, rightPrerelease] = right.split("-", 2);
  const leftParts = leftCore.split(".").map(Number);
  const rightParts = rightCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  if (leftPrerelease === rightPrerelease) return 0;
  if (leftPrerelease === undefined) return 1;
  if (rightPrerelease === undefined) return -1;
  return leftPrerelease.localeCompare(rightPrerelease, "en", { numeric: true });
}

function assertPreviousVersion(previousVersion: string | null, version: string) {
  if (previousVersion !== null && compareSemver(previousVersion, version) >= 0) {
    throw new Error("previousVersion must be lower than version.");
  }
}

function parseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Release manifest must be an object.");
  }
  const manifest = value as Partial<ReleaseManifest>;
  if (manifest.schemaVersion !== 1 || manifest.product !== "Briar") {
    throw new Error("Unsupported release manifest schema or product.");
  }
  assertSemver(manifest.version, "version");
  if (manifest.previousVersion !== null) {
    assertSemver(manifest.previousVersion, "previousVersion");
    assertPreviousVersion(manifest.previousVersion, manifest.version);
  }
  if (manifest.channel !== "rc" && manifest.channel !== "stable") {
    throw new Error("channel must be rc or stable.");
  }
  if (manifest.target !== "aarch64-apple-darwin") {
    throw new Error("Unexpected release target.");
  }
  if (typeof manifest.commitSha !== "string" || !commitPattern.test(manifest.commitSha)) {
    throw new Error("commitSha must be a full Git SHA.");
  }
  if (
    typeof manifest.releasedAt !== "string" ||
    Number.isNaN(Date.parse(manifest.releasedAt))
  ) {
    throw new Error("releasedAt must be an RFC 3339 timestamp.");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < 2) {
    throw new Error("Release manifest must contain app and DMG artifacts.");
  }
  return manifest as ReleaseManifest;
}

export async function generateReleaseManifest(
  root: string,
  input: Omit<ReleaseManifest, "schemaVersion" | "product" | "target" | "artifacts">,
) {
  assertSemver(input.version, "version");
  if (input.previousVersion !== null) {
    assertSemver(input.previousVersion, "previousVersion");
    assertPreviousVersion(input.previousVersion, input.version);
  }
  const entries = await readdir(root, { withFileTypes: true });
  const artifacts: ReleaseArtifact[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue;
    const kind = artifactKind(entry.name);
    if (!kind) continue;
    const path = join(root, entry.name);
    artifacts.push({
      kind,
      name: entry.name,
      bytes: (await stat(path)).size,
      sha256: await sha256(path),
    });
  }
  if (!artifacts.some((artifact) => artifact.kind === "app")) {
    throw new Error("Release app ZIP is missing.");
  }
  if (!artifacts.some((artifact) => artifact.kind === "dmg")) {
    throw new Error("Release DMG is missing.");
  }
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    product: "Briar",
    target: "aarch64-apple-darwin",
    ...input,
    artifacts,
  };
  await writeFile(join(root, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function verifyReleaseManifest(root: string) {
  const manifest = parseManifest(
    JSON.parse(await readFile(join(root, manifestName), "utf8")) as unknown,
  );
  const kinds = new Set<ReleaseArtifact["kind"]>();
  const names = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      (artifact.kind !== "app" && artifact.kind !== "dmg") ||
      artifactKind(artifact.name) !== artifact.kind ||
      basename(artifact.name) !== artifact.name ||
      names.has(artifact.name) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      !shaPattern.test(artifact.sha256)
    ) {
      throw new Error(`Invalid artifact entry: ${artifact.name ?? "<missing>"}`);
    }
    const path = join(root, artifact.name);
    const metadata = await stat(path);
    if (metadata.size !== artifact.bytes) {
      throw new Error(`Artifact size mismatch: ${artifact.name}`);
    }
    if ((await sha256(path)) !== artifact.sha256) {
      throw new Error(`Artifact checksum mismatch: ${artifact.name}`);
    }
    names.add(artifact.name);
    kinds.add(artifact.kind);
  }
  if (!kinds.has("app") || !kinds.has("dmg")) {
    throw new Error("Manifest does not cover both app and DMG artifacts.");
  }
  return manifest;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.main) {
  const command = process.argv[2];
  const root = argument("--root");
  if (!root) throw new Error("--root is required.");
  if (command === "generate") {
    const version = argument("--version");
    if (!version) throw new Error("--version is required.");
    const commitSha =
      process.env.BRIAR_RELEASE_COMMIT ??
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const releasedAt = execFileSync(
      "git",
      ["show", "-s", "--format=%cI", commitSha],
      { encoding: "utf8" },
    ).trim();
    const manifest = await generateReleaseManifest(root, {
      version,
      channel: process.env.BRIAR_RELEASE_CHANNEL === "stable" ? "stable" : "rc",
      previousVersion: process.env.BRIAR_PREVIOUS_VERSION ?? null,
      commitSha,
      releasedAt,
    });
    console.log(`Generated ${manifestName} for Briar v${manifest.version}.`);
  } else if (command === "verify") {
    const manifest = await verifyReleaseManifest(root);
    console.log(`Verified ${manifestName} for Briar v${manifest.version}.`);
  } else {
    throw new Error("Expected generate or verify command.");
  }
}
