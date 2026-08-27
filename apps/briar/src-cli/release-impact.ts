import { execFileSync } from "node:child_process";

export type ReleaseChange = {
  path: string;
  before: string | null;
  after: string | null;
};

const alwaysBuildPatterns = [
  /^apps\/briar\/package\.json$/u,
  /^apps\/briar\/turbo\.json$/u,
  /^bun\.lock$/u,
  /^config\/bun-runtime\.json$/u,
  /^scripts\/(?:import-apple-signing-assets|package-macos-release|package-managed-runtime-release|package-production-release|prepare-bun-sidecar|qa-macos-lifecycle|qa-managed-runtime-updater|qa-production-updater-build|release-macos-candidate|release-macos-production|release-cargo-cache|verify-bundled-runtime|verify-release-config|with-release-env)\.(?:sh|ts)$/u,
  /^apps\/briar\/src-cli\/(?:production-release|release-impact|release-manifest)\.(?:ts|test\.ts)$/u,
  /^apps\/briar\/src-tauri\/(?:Entitlements\.plist|Info\.plist|build\.rs)$/u,
  /^apps\/briar\/src-tauri\/(?:binaries|capabilities|icons)\//u,
  /^turbo\.json$/u,
];

function normalizeJsonVersion(contents: string | null) {
  if (contents === null) return null;
  try {
    const value = JSON.parse(contents) as Record<string, unknown>;
    value.version = "<release-version>";
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeCargoToml(contents: string | null) {
  if (contents === null) return null;
  let inPackage = false;
  return contents
    .split(/\r?\n/u)
    .map((line) => {
      const section = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
      if (section) inPackage = section[1] === "package";
      return inPackage && /^\s*version\s*=/u.test(line)
        ? 'version = "<release-version>"'
        : line;
    })
    .join("\n");
}

function normalizeCargoLock(contents: string | null) {
  if (contents === null) return null;
  return contents.replace(
    /(\[\[package\]\]\r?\nname = "briar"\r?\nversion = )"[^"]+"/u,
    '$1"<release-version>"',
  );
}

function normalizeReleaseEnvironment(contents: string | null) {
  if (contents === null) return null;
  return contents.replace(
    /^BRIAR_PREVIOUS_VERSION=.*$/mu,
    "BRIAR_PREVIOUS_VERSION=<release-version>",
  );
}

function normalizedChange(change: ReleaseChange) {
  if (
    change.path === "package.json" ||
    change.path === "apps/briar/src-tauri/tauri.conf.json"
  ) {
    return [normalizeJsonVersion(change.before), normalizeJsonVersion(change.after)];
  }
  if (change.path === "apps/briar/src-tauri/Cargo.toml") {
    return [normalizeCargoToml(change.before), normalizeCargoToml(change.after)];
  }
  if (change.path === "apps/briar/src-tauri/Cargo.lock") {
    return [normalizeCargoLock(change.before), normalizeCargoLock(change.after)];
  }
  if (change.path === "config/release.env") {
    return [
      normalizeReleaseEnvironment(change.before),
      normalizeReleaseEnvironment(change.after),
    ];
  }
  return null;
}

export function releaseImpactReasons(changes: ReleaseChange[]) {
  const reasons: string[] = [];
  for (const change of changes) {
    const normalized = normalizedChange(change);
    if (normalized) {
      if (
        normalized[0] === null ||
        normalized[1] === null ||
        normalized[0] !== normalized[1]
      ) {
        reasons.push(change.path);
      }
      continue;
    }
    if (alwaysBuildPatterns.some((pattern) => pattern.test(change.path))) {
      reasons.push(change.path);
    }
  }
  return [...new Set(reasons)].sort();
}

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function contentsAt(ref: string, path: string) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const baseIndex = process.argv.indexOf("--base-ref");
  const baseRef = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
  if (!baseRef) throw new Error("--base-ref is required.");
  try {
    git("rev-parse", "--verify", `${baseRef}^{commit}`);
  } catch {
    console.log(`Candidate build required: base ref ${baseRef} is unavailable.`);
    process.exit(0);
  }
  const paths = git("diff", "--no-renames", "--name-only", `${baseRef}..HEAD`)
    .split(/\r?\n/u)
    .filter(Boolean);
  const changes = paths.map((path) => ({
    path,
    before: contentsAt(baseRef, path),
    after: contentsAt("HEAD", path),
  }));
  const reasons = releaseImpactReasons(changes);
  if (reasons.length > 0) {
    console.log(`Candidate build required by: ${reasons.join(", ")}`);
    process.exit(0);
  }
  console.log(
    `Candidate build skipped: no release or packaging impact since ${baseRef}.`,
  );
  process.exitCode = 20;
}
