import { describe, expect, it } from "vitest";

import {
  evaluateReleaseBumpFastPath,
  type ReleaseBumpFastPath,
} from "./release-bump-fast-path";
import type { SignoffGitRunner } from "./verify-signoff-ready";

const head = "a".repeat(40);
const parent = "b".repeat(40);
const baseSha = "c".repeat(40);

const packageJson = (version: string) =>
  `${JSON.stringify({ name: "briar", scripts: { build: "turbo run build" }, version }, null, 2)}\n`;

const tauriConfig = (version: string) =>
  `${JSON.stringify({ productName: "Briar", version }, null, 2)}\n`;

const cargoToml = (version: string) =>
  `[package]\nname = "briar"\nversion = "${version}"\n\n[dependencies]\ntauri = "2"\n`;

const cargoLock = (version: string) =>
  `[[package]]\nname = "briar"\nversion = "${version}"\n\n[[package]]\nname = "tauri"\nversion = "2.0.0"\n`;

const releaseEnvironment = (previous: string) =>
  `BRIAR_RELEASE_CHANNEL=stable\nBRIAR_PREVIOUS_VERSION=${previous}\n`;

const changelog = (entries: string) =>
  `export function Changelog() {\n  return <ul>${entries}</ul>;\n}\n`;

type Repository = {
  files: Map<string, string>;
  nameStatus: string;
  onAncestor: () => void;
  onDiff: () => void;
  parents: ReadonlyArray<string>;
};

function repository() {
  const files = new Map<string, string>([
    [`${parent}:package.json`, packageJson("1.2.189")],
    [`${head}:package.json`, packageJson("1.2.190")],
    [`${parent}:apps/briar/src-tauri/tauri.conf.json`, tauriConfig("1.2.189")],
    [`${head}:apps/briar/src-tauri/tauri.conf.json`, tauriConfig("1.2.190")],
    [`${parent}:apps/briar/src-tauri/Cargo.toml`, cargoToml("1.2.189")],
    [`${head}:apps/briar/src-tauri/Cargo.toml`, cargoToml("1.2.190")],
    [`${parent}:apps/briar/src-tauri/Cargo.lock`, cargoLock("1.2.189")],
    [`${head}:apps/briar/src-tauri/Cargo.lock`, cargoLock("1.2.190")],
    [`${parent}:config/release.env`, releaseEnvironment("1.2.188")],
    [`${head}:config/release.env`, releaseEnvironment("1.2.189")],
    [`${parent}:skills/browser/VERSION`, "1.2.189\n"],
    [`${head}:skills/browser/VERSION`, "1.2.190\n"],
    [`${parent}:apps/landing/app/views/changelog.tsx`, changelog("<li>1.2.189</li>")],
    [
      `${head}:apps/landing/app/views/changelog.tsx`,
      changelog("<li>1.2.190</li><li>1.2.189</li>"),
    ],
  ]);
  const state: Repository = {
    files,
    nameStatus: [
      "M\tpackage.json",
      "M\tapps/briar/src-tauri/tauri.conf.json",
      "M\tapps/briar/src-tauri/Cargo.toml",
      "M\tapps/briar/src-tauri/Cargo.lock",
      "M\tconfig/release.env",
      "M\tskills/browser/VERSION",
      "M\tapps/landing/app/views/changelog.tsx",
    ].join("\n"),
    onAncestor: () => {},
    onDiff: () => {},
    parents: [parent],
  };
  const git: SignoffGitRunner = (args) => {
    const command = args.join(" ");
    if (command === `rev-list --parents -n 1 ${head}`) {
      return `${head} ${state.parents.join(" ")}\n`;
    }
    if (command.startsWith("merge-base --is-ancestor ")) {
      state.onAncestor();
      return "";
    }
    if (command === `diff --no-renames --name-status ${parent} ${head}`) {
      state.onDiff();
      return `${state.nameStatus}\n`;
    }
    const show = /^show (.+)$/u.exec(command);
    if (show?.[1]) {
      const contents = state.files.get(show[1]);
      if (contents === undefined) {
        throw new Error(`fatal: path does not exist: ${show[1]}`);
      }
      return contents;
    }
    throw new Error(`Unexpected Git command: ${command}`);
  };
  return { git, state };
}

const evaluate = (git: SignoffGitRunner): ReleaseBumpFastPath =>
  evaluateReleaseBumpFastPath({ baseSha, head }, "/repository", git);

describe("release bump fast path", () => {
  it("accepts a version-only bump on a commit contained in origin/main", () => {
    const { git } = repository();
    const result = evaluate(git);

    expect(result).toMatchObject({
      eligible: true,
      parentSha: parent,
      version: "1.2.190",
    });
    expect(result.eligible && result.changedPaths).toContain(
      "apps/landing/app/views/changelog.tsx",
    );
    expect(result.eligible && result.changedPaths).toHaveLength(7);
  });

  it("rejects a commit that also touches a file outside the allowlist", () => {
    const { git, state } = repository();
    state.nameStatus = `${state.nameStatus}\nM\tapps/briar/src/App.tsx`;

    expect(evaluate(git)).toEqual({
      eligible: false,
      reason: "apps/briar/src/App.tsx is not a release bump file",
    });
  });

  it("rejects a commit whose parent is not contained in origin/main", () => {
    const { git, state } = repository();
    state.onAncestor = () => {
      throw new Error("Command failed: git merge-base --is-ancestor");
    };

    expect(evaluate(git)).toMatchObject({
      eligible: false,
      reason: `parent ${parent.slice(0, 7)} is not an ancestor of origin/main ${baseSha.slice(0, 7)}`,
    });
  });

  it("rejects a merge commit", () => {
    const { git, state } = repository();
    state.parents = [parent, "d".repeat(40)];

    expect(evaluate(git)).toEqual({
      eligible: false,
      reason: "HEAD has 2 parent(s); a release bump commit has exactly one",
    });
  });

  it("rejects a package.json edit beyond the version field", () => {
    const { git, state } = repository();
    state.files.set(
      `${head}:package.json`,
      `${JSON.stringify({ name: "briar", scripts: { build: "vite build" }, version: "1.2.190" }, null, 2)}\n`,
    );

    expect(evaluate(git)).toEqual({
      eligible: false,
      reason: "package.json changed beyond the release version field",
    });
  });

  it("rejects a bump whose version fields disagree at HEAD", () => {
    const { git, state } = repository();
    state.files.set(
      `${head}:apps/briar/src-tauri/tauri.conf.json`,
      tauriConfig("1.2.191"),
    );

    expect(evaluate(git)).toMatchObject({
      eligible: false,
      reason:
        "versions disagree at HEAD: package.json 1.2.190, tauri.conf.json 1.2.191, Cargo.toml 1.2.190",
    });
  });

  it("rejects a skill VERSION that does not match the release version", () => {
    const { git, state } = repository();
    state.files.set(`${head}:skills/browser/VERSION`, "1.2.191\n");

    expect(evaluate(git)).toEqual({
      eligible: false,
      reason: "skills/browser/VERSION is 1.2.191, not the release version 1.2.190",
    });
  });

  it("rejects an added or deleted allowlisted file", () => {
    const added = repository();
    added.state.nameStatus = `${added.state.nameStatus}\nA\tskills/new-skill/VERSION`;
    expect(evaluate(added.git)).toEqual({
      eligible: false,
      reason:
        "skills/new-skill/VERSION is A, not a modification; a release bump only edits existing files",
    });

    const deleted = repository();
    deleted.state.nameStatus = `${deleted.state.nameStatus}\nD\tskills/browser/VERSION`;
    expect(evaluate(deleted.git)).toEqual({
      eligible: false,
      reason:
        "skills/browser/VERSION is D, not a modification; a release bump only edits existing files",
    });
  });

  it("fails closed when Git errors", () => {
    const { git, state } = repository();
    state.onDiff = () => {
      throw new Error("fatal: bad object");
    };

    expect(evaluate(git)).toEqual({
      eligible: false,
      reason: "could not evaluate the commit: fatal: bad object",
    });
  });
});
