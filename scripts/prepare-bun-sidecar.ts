import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

type BunRuntimeManifest = {
  version: string;
  targets: Record<string, { sha256: string }>;
};

export function bunTargetTriple(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
) {
  if (platform !== "darwin") {
    throw new Error(`Bundled Bun is currently supported only for macOS, not ${platform}.`);
  }
  if (architecture === "arm64") return "aarch64-apple-darwin";
  if (architecture === "x64") return "x86_64-apple-darwin";
  throw new Error(`Unsupported macOS architecture for bundled Bun: ${architecture}.`);
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function prepareBunSidecar(workspaceRoot = resolve(import.meta.dir, "..")) {
  const packageJson = JSON.parse(
    await readFile(join(workspaceRoot, "package.json"), "utf8"),
  ) as { packageManager?: string };
  const expectedVersion = packageJson.packageManager?.match(/^bun@(.+)$/u)?.[1];
  if (!expectedVersion) {
    throw new Error("package.json packageManager must pin an exact Bun version.");
  }
  const manifest = JSON.parse(
    await readFile(join(workspaceRoot, "config/bun-runtime.json"), "utf8"),
  ) as BunRuntimeManifest;
  if (manifest.version !== expectedVersion || Bun.version !== expectedVersion) {
    throw new Error(
      `Bundled Bun requires ${expectedVersion}; manifest=${manifest.version}, build runtime=${Bun.version}.`,
    );
  }

  const targetTriple = bunTargetTriple();
  const expectedHash = manifest.targets[targetTriple]?.sha256;
  if (!expectedHash) {
    throw new Error(`Missing bundled Bun checksum for ${targetTriple}.`);
  }
  const source = await realpath(process.execPath);
  const sourceHash = await sha256(source);
  if (sourceHash !== expectedHash) {
    throw new Error(
      `Bun ${expectedVersion} checksum mismatch for ${targetTriple}: expected ${expectedHash}, found ${sourceHash}.`,
    );
  }

  const binariesDirectory = join(workspaceRoot, "src-tauri/binaries");
  const destination = join(binariesDirectory, `bun-${targetTriple}`);
  await mkdir(binariesDirectory, { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  if ((await sha256(destination)) !== expectedHash) {
    throw new Error(`Copied Bun sidecar failed checksum verification: ${destination}.`);
  }
  console.log(`Prepared bundled Bun ${expectedVersion} for ${targetTriple}.`);
  return destination;
}

if (import.meta.main) {
  if (process.platform === "darwin") {
    await prepareBunSidecar();
  } else {
    console.log(`Skipping macOS Bun sidecar preparation on ${process.platform}.`);
  }
}
