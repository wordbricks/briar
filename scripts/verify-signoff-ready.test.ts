import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifySignoffReady } from "./verify-signoff-ready";

const fixtureRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createPushedRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "briar-signoff-preflight-"));
  fixtureRoots.push(root);
  const remote = join(root, "remote.git");
  const repository = join(root, "repository");

  git(root, "init", "--bare", remote);
  git(root, "init", "--initial-branch", "signoff-test", repository);
  git(repository, "config", "user.name", "Signoff Test");
  git(repository, "config", "user.email", "signoff@example.com");
  writeFileSync(join(repository, "tracked.txt"), "initial\n");
  git(repository, "add", "tracked.txt");
  git(repository, "commit", "-m", "initial");
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "--set-upstream", "origin", "signoff-test");

  return repository;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("signoff preflight", () => {
  it("accepts a clean commit that matches its push branch", () => {
    const repository = createPushedRepository();

    expect(verifySignoffReady(repository)).toEqual({
      head: git(repository, "rev-parse", "HEAD"),
      upstream: "origin/signoff-test",
    });
  });

  it("rejects uncommitted changes before running CI", () => {
    const repository = createPushedRepository();
    writeFileSync(join(repository, "tracked.txt"), "changed\n");

    expect(() => verifySignoffReady(repository)).toThrow("uncommitted changes");
  });

  it("rejects a commit that has not been pushed", () => {
    const repository = createPushedRepository();
    writeFileSync(join(repository, "tracked.txt"), "next\n");
    git(repository, "add", "tracked.txt");
    git(repository, "commit", "-m", "next");

    expect(() => verifySignoffReady(repository)).toThrow("push the exact commit");
  });

  it("rejects a branch without a push remote", () => {
    const repository = createPushedRepository();
    git(repository, "branch", "--unset-upstream");

    expect(() => verifySignoffReady(repository)).toThrow("not tracking a remote branch");
  });
});
