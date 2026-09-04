import { execFileSync } from "node:child_process";

import {
  type ReleaseChange,
  releaseImpactReasons,
} from "../apps/briar/src-cli/release-impact";
import type { SignoffGitRunner, SignoffTarget } from "./verify-signoff-ready";

/**
 * Paths whose version-only edits `releaseImpactReasons` already normalizes away.
 * Any other edit inside them produces a reason and blocks the fast path.
 */
const releaseImpactPaths: ReadonlySet<string> = new Set([
  "apps/briar/src-tauri/Cargo.lock",
  "apps/briar/src-tauri/Cargo.toml",
  "apps/briar/src-tauri/tauri.conf.json",
  "config/release.env",
  "package.json",
]);

export const changelogPath = "apps/landing/app/views/changelog.tsx";

const skillVersionPattern = /^skills\/[^/]+\/VERSION$/u;
const semverPattern = /^\d+\.\d+\.\d+$/u;

const packageJsonPath = "package.json";
const tauriConfigPath = "apps/briar/src-tauri/tauri.conf.json";
const cargoTomlPath = "apps/briar/src-tauri/Cargo.toml";

export type ReleaseBumpFastPath =
  | {
    readonly changedPaths: ReadonlyArray<string>;
    readonly eligible: true;
    readonly parentSha: string;
    readonly version: string;
  }
  | { readonly eligible: false; readonly reason: string };

export type ReleaseBumpTarget = Pick<SignoffTarget, "baseSha" | "head">;

const runGit: SignoffGitRunner = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });

const shortSha = (sha: string) => sha.slice(0, 7);

const ineligible = (reason: string): ReleaseBumpFastPath => ({
  eligible: false,
  reason,
});

const isAllowedPath = (path: string) =>
  releaseImpactPaths.has(path) ||
  path === changelogPath ||
  skillVersionPattern.test(path);

function jsonVersion(contents: string): string | null {
  const parsed = JSON.parse(contents) as Record<string, unknown>;
  const version = parsed["version"];
  return typeof version === "string" ? version : null;
}

function cargoPackageVersion(contents: string): string | null {
  let inPackage = false;
  for (const line of contents.split(/\r?\n/u)) {
    const section = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
    if (section) {
      inPackage = section[1] === "package";
      continue;
    }
    if (!inPackage) continue;
    const match = /^\s*version\s*=\s*"([^"]+)"\s*$/u.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** A VERSION file must hold exactly one semver line, with or without a trailing newline. */
function singleSemverLine(contents: string): string | null {
  const lines = contents.replace(/\r?\n$/u, "").split(/\r?\n/u);
  const first = lines[0] ?? "";
  return lines.length === 1 && semverPattern.test(first) ? first : null;
}

function evaluate(
  target: ReleaseBumpTarget,
  cwd: string,
  git: SignoffGitRunner,
): ReleaseBumpFastPath {
  const revList = git(
    ["rev-list", "--parents", "-n", "1", target.head],
    cwd,
  ).trim();
  const [, ...parents] = revList.split(/\s+/u).filter(Boolean);
  if (parents.length !== 1) {
    return ineligible(
      `HEAD has ${parents.length} parent(s); a release bump commit has exactly one`,
    );
  }
  const parentSha = parents[0] ?? "";

  try {
    git(["merge-base", "--is-ancestor", parentSha, target.baseSha], cwd);
  } catch {
    return ineligible(
      `parent ${shortSha(parentSha)} is not an ancestor of origin/main ${shortSha(target.baseSha)}`,
    );
  }

  const nameStatus = git(
    ["diff", "--no-renames", "--name-status", parentSha, target.head],
    cwd,
  ).trim();
  if (nameStatus === "") {
    return ineligible("the commit changes no files");
  }

  const changedPaths: Array<string> = [];
  for (const line of nameStatus.split(/\r?\n/u)) {
    const [status = "", path = ""] = line.split("\t");
    if (path === "") {
      return ineligible(`could not parse the diff entry ${JSON.stringify(line)}`);
    }
    if (status !== "M") {
      return ineligible(
        `${path} is ${status}, not a modification; a release bump only edits existing files`,
      );
    }
    if (!isAllowedPath(path)) {
      return ineligible(`${path} is not a release bump file`);
    }
    changedPaths.push(path);
  }

  const impactChanges: Array<ReleaseChange> = changedPaths
    .filter((path) => releaseImpactPaths.has(path))
    .map((path) => ({
      after: git(["show", `${target.head}:${path}`], cwd),
      before: git(["show", `${parentSha}:${path}`], cwd),
      path,
    }));
  const reasons = releaseImpactReasons(impactChanges);
  if (reasons.length > 0) {
    return ineligible(
      `${reasons.join(", ")} changed beyond the release version field`,
    );
  }

  const version = jsonVersion(git(["show", `${target.head}:${packageJsonPath}`], cwd));
  const tauriVersion = jsonVersion(
    git(["show", `${target.head}:${tauriConfigPath}`], cwd),
  );
  const cargoVersion = cargoPackageVersion(
    git(["show", `${target.head}:${cargoTomlPath}`], cwd),
  );
  if (version === null || tauriVersion === null || cargoVersion === null) {
    return ineligible(
      "could not read the release version from package.json, tauri.conf.json, and Cargo.toml at HEAD",
    );
  }
  if (version !== tauriVersion || version !== cargoVersion) {
    return ineligible(
      `versions disagree at HEAD: package.json ${version}, tauri.conf.json ${tauriVersion}, Cargo.toml ${cargoVersion}`,
    );
  }

  for (const path of changedPaths.filter((entry) => skillVersionPattern.test(entry))) {
    const skillVersion = singleSemverLine(
      git(["show", `${target.head}:${path}`], cwd),
    );
    if (skillVersion === null) {
      return ineligible(`${path} is not a single semver line`);
    }
    if (skillVersion !== version) {
      return ineligible(
        `${path} is ${skillVersion}, not the release version ${version}`,
      );
    }
  }

  return { changedPaths, eligible: true, parentSha, version };
}

/**
 * Decide whether `target.head` is a mechanical release version bump on top of a
 * commit already contained in `origin/main`. Fails closed: any unexpected Git
 * output or error makes the commit ineligible for the fast path.
 */
export function evaluateReleaseBumpFastPath(
  target: ReleaseBumpTarget,
  cwd = process.cwd(),
  git: SignoffGitRunner = runGit,
): ReleaseBumpFastPath {
  try {
    return evaluate(target, cwd, git);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return ineligible(`could not evaluate the commit: ${message}`);
  }
}
