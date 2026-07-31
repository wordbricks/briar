import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allocateIssueWorktree,
  assertPathWithinRoot,
  copyWorktreeIncludes,
  defaultWorktreeRoot,
  findExistingIssueWorktree,
  isPathWithinRoot,
  listIssueWorktrees,
  parseRemoteTrackingBase,
  parseWorktreeIncludeFile,
  parseWorktreeList,
  qualifyBaseRef,
  refreshRemoteBase,
  removeIssueWorktree,
  resolveBaseRef,
  samePath,
  sanitizeWorktreeSlug,
  worktreeBranchFor,
  worktreeNameFor,
  type GitResult,
  type GitRunner,
} from "./worktree";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

const ok = (stdout = ""): GitResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = "boom"): GitResult => ({ exitCode: 1, stdout: "", stderr });

/** Records every invocation so ordering assertions stay honest. */
function fakeGit(handler: (gitArgs: string[]) => GitResult) {
  const calls: string[][] = [];
  const git: GitRunner = (gitArgs) => {
    calls.push(gitArgs);
    return handler(gitArgs);
  };
  return { git, calls };
}

describe("worktree naming", () => {
  it("keeps the default root in the persistent Briar workspace directory", () => {
    expect(defaultWorktreeRoot("/home/dev")).toBe(join("/home/dev", "briar", "workspaces"));
  });

  it("keeps unicode titles readable and strips unsafe characters", () => {
    expect(sanitizeWorktreeSlug("Fix: 로그인 실패 (urgent!)")).toBe("fix-로그인-실패-urgent");
    expect(sanitizeWorktreeSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeWorktreeSlug("...")).toBe("");
  });

  it("derives a deterministic name from the run id", () => {
    const issue = {
      runId: "3f6b9c21-1111-2222-3333-444455556666",
      sourceKey: "github://wordbricks/briar/issues/42",
      title: "Fix login redirect",
    };
    expect(worktreeNameFor(issue)).toBe("fix-login-redirect-3f6b9c21");
    expect(worktreeNameFor(issue)).toBe(worktreeNameFor(issue));
  });

  it("falls back to the source key tail when the title is unusable", () => {
    expect(
      worktreeNameFor({
        runId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        sourceKey: "linear://BRI-128",
        title: "***",
      }),
    ).toBe("bri-128-aaaaaaaa");
  });

  it("normalizes the branch prefix so git accepts the ref", () => {
    expect(worktreeBranchFor("briar/", "fix-1a2b3c4d")).toBe("briar/fix-1a2b3c4d");
    expect(worktreeBranchFor("", "fix-1a2b3c4d")).toBe("fix-1a2b3c4d");
    expect(worktreeBranchFor("team//bots/", "fix")).toBe("team/bots/fix");
  });

  it("refuses paths that escape the project root", () => {
    expect(() => assertPathWithinRoot("/tmp/roots/project/name", "/tmp/roots/project")).not.toThrow();
    expect(() => assertPathWithinRoot("/tmp/roots/other", "/tmp/roots/project")).toThrow();
    expect(() => assertPathWithinRoot("/tmp/roots/project", "/tmp/roots/project")).toThrow();
  });
});

describe("base ref resolution", () => {
  it("prefers origin/HEAD over local branches", () => {
    const { git } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/trunk\n");
      if (gitArgs.at(-1) === "refs/remotes/origin/trunk^{commit}") return ok("sha");
      return fail();
    });
    expect(resolveBaseRef(git, "/repo")).toBe("origin/trunk");
  });

  it("ignores an origin/HEAD that points at a deleted ref", () => {
    const { git } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/gone\n");
      if (gitArgs.at(-1) === "refs/remotes/origin/main^{commit}") return ok("sha");
      return fail();
    });
    expect(resolveBaseRef(git, "/repo")).toBe("origin/main");
  });

  it("prefers the remote branch over a stale local branch", () => {
    const { git } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "symbolic-ref") return fail();
      const ref = gitArgs.at(-1);
      if (ref === "refs/remotes/origin/main^{commit}" || ref === "refs/heads/main^{commit}") {
        return ok("sha");
      }
      return fail();
    });
    expect(resolveBaseRef(git, "/repo")).toBe("origin/main");
  });

  it("returns null when nothing usable exists", () => {
    const { git } = fakeGit(() => fail());
    expect(resolveBaseRef(git, "/repo")).toBeNull();
  });

  it("qualifies short refs by the namespace the picker implies", () => {
    const remoteOnly = (ref: string) => ref === "refs/remotes/origin/main";
    expect(qualifyBaseRef("origin/main", remoteOnly)).toBe("refs/remotes/origin/main");
    expect(qualifyBaseRef("main", () => true)).toBe("refs/heads/main");
    expect(qualifyBaseRef("refs/heads/main", () => false)).toBe("refs/heads/main");
  });

  it("splits remote-tracking bases and ignores local branches", () => {
    expect(parseRemoteTrackingBase("origin/main", ["origin", "upstream"])).toEqual({
      remote: "origin",
      branch: "main",
      ref: "refs/remotes/origin/main",
    });
    expect(parseRemoteTrackingBase("feature/login", ["origin"])).toBeNull();
  });
});

describe("base ref refresh", () => {
  it("fetches only the base branch with maintenance suppressed", () => {
    const { git, calls } = fakeGit((gitArgs) => (gitArgs[0] === "-c" ? ok() : ok("sha")));
    expect(
      refreshRemoteBase(git, "/repo", {
        remote: "origin",
        branch: "main",
        ref: "refs/remotes/origin/main",
      }),
    ).toEqual({ fetched: true });
    expect(calls.at(-1)).toEqual([
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
  });

  it("degrades to the existing local ref when the fetch fails", () => {
    const { git } = fakeGit((gitArgs) => (gitArgs[0] === "rev-parse" ? ok("sha") : fail("offline")));
    const result = refreshRemoteBase(git, "/repo", {
      remote: "origin",
      branch: "main",
      ref: "refs/remotes/origin/main",
    });
    expect(result.fetched).toBe(false);
    expect(result.warning).toContain("refs/remotes/origin/main");
  });

  it("fails when the fetch fails and no local ref exists", () => {
    const { git } = fakeGit(() => fail("offline"));
    expect(() =>
      refreshRemoteBase(git, "/repo", {
        remote: "origin",
        branch: "main",
        ref: "refs/remotes/origin/main",
      }),
    ).toThrow(/네트워크/u);
  });
});

describe(".worktreeinclude", () => {
  it("keeps literal entries and skips patterns and traversal", () => {
    expect(
      parseWorktreeIncludeFile(
        ["# comment", "", ".env.keys", "./.dev.vars/", "*.log", "!keep", "../escape", ".git/config"].join(
          "\n",
        ),
      ),
    ).toEqual([".env.keys", ".dev.vars"]);
  });

  it("copies listed gitignored files into the worktree", async () => {
    const repository = await temporaryDirectory("briar-include-repo-");
    const worktree = await temporaryDirectory("briar-include-worktree-");
    await writeFile(join(repository, ".worktreeinclude"), ".env.keys\nmissing.txt\n");
    await writeFile(join(repository, ".env.keys"), "DOTENV_PRIVATE_KEY=abc");

    expect(await copyWorktreeIncludes(repository, worktree)).toEqual([".env.keys"]);
    expect(await readFile(join(worktree, ".env.keys"), "utf8")).toBe("DOTENV_PRIVATE_KEY=abc");
  });

  it("returns nothing when the repository has no include file", async () => {
    const repository = await temporaryDirectory("briar-include-none-");
    const worktree = await temporaryDirectory("briar-include-none-worktree-");
    expect(await copyWorktreeIncludes(repository, worktree)).toEqual([]);
  });
});

describe("worktree list parsing", () => {
  it("pairs paths with their branches", () => {
    const stdout = [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /roots/project/fix-1a2b3c4d",
      "HEAD def",
      "branch refs/heads/briar/fix-1a2b3c4d",
      "",
      "worktree /roots/project/detached",
      "HEAD 000",
      "detached",
    ].join("\n");
    expect(parseWorktreeList(stdout)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/roots/project/fix-1a2b3c4d", branch: "briar/fix-1a2b3c4d" },
      { path: "/roots/project/detached", branch: null },
    ]);
  });

  it("lists only worktrees inside the project root", () => {
    const { git } = fakeGit(() =>
      ok(
        [
          "worktree /repo",
          "branch refs/heads/main",
          "",
          "worktree /roots/project/fix-1a2b3c4d",
          "branch refs/heads/briar/fix-1a2b3c4d",
        ].join("\n"),
      ),
    );
    expect(listIssueWorktrees(git, "/repo", "/roots/project")).toEqual([
      { path: "/roots/project/fix-1a2b3c4d", branch: "briar/fix-1a2b3c4d" },
    ]);
  });

  it("finds the previous issue worktree without allocating a replacement", () => {
    const issue = {
      runId: "3f6b9c21-1111-2222-3333-444455556666",
      sourceKey: "github://wordbricks/briar/issues/42",
      title: "Fix login redirect",
    };
    const { git, calls } = fakeGit(() =>
      ok(
        [
          "worktree /repo",
          "branch refs/heads/main",
          "",
          "worktree /roots/project/fix-login-redirect-3f6b9c21",
          "branch refs/heads/briar/fix-login-redirect-3f6b9c21",
        ].join("\n"),
      ),
    );

    expect(
      findExistingIssueWorktree(
        git,
        "/repo",
        "/roots/project",
        issue,
        null,
      ),
    ).toEqual({
      path: "/roots/project/fix-login-redirect-3f6b9c21",
      branch: "briar/fix-login-redirect-3f6b9c21",
    });
    expect(calls).toEqual([["worktree", "list", "--porcelain"]]);
  });
});

describe("allocation", () => {
  const issue = {
    runId: "3f6b9c21-1111-2222-3333-444455556666",
    sourceKey: "github://wordbricks/briar/issues/42",
    title: "Fix login redirect",
  };

  async function allocationHarness(
    overrides: (gitArgs: string[]) => GitResult | null = () => null,
  ) {
    const root = await temporaryDirectory("briar-worktree-root-");
    const { git, calls } = fakeGit((gitArgs) => {
      const override = overrides(gitArgs);
      if (override) return override;
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") return ok("worktree /repo\nbranch refs/heads/main");
      if (gitArgs[0] === "remote") return ok("origin");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main");
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--verify") {
        // Only the base ref exists; no issue branch has been created yet.
        return gitArgs.at(-1)?.includes("briar/") ? fail() : ok("sha");
      }
      if (gitArgs[0] === "rev-parse") return ok("basesha");
      if (gitArgs[0] === "-c") return ok();
      if (gitArgs[0] === "config") return fail();
      return ok();
    });
    return { root, git, calls };
  }

  it("fetches the base before adding the worktree and cuts from the remote ref", async () => {
    const { root, git, calls } = await allocationHarness();
    const worktree = await allocateIssueWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      issue,
      settings: { root, branchPrefix: "briar" },
      git,
    });

    expect(worktree.branch).toBe("briar/fix-login-redirect-3f6b9c21");
    expect(worktree.path).toBe(join(root, "project-1", "fix-login-redirect-3f6b9c21"));
    expect(worktree.baseRef).toBe("origin/main");
    expect(worktree.baseRefResolved).toBe("refs/remotes/origin/main");
    expect(worktree.reused).toBe(false);

    const fetchIndex = calls.findIndex((gitArgs) => gitArgs.includes("fetch"));
    const addIndex = calls.findIndex((gitArgs) => gitArgs[0] === "worktree" && gitArgs[1] === "add");
    expect(fetchIndex).toBeGreaterThanOrEqual(0);
    expect(addIndex).toBeGreaterThan(fetchIndex);
    expect(calls[addIndex]).toEqual([
      "worktree",
      "add",
      "--no-track",
      "-b",
      "briar/fix-login-redirect-3f6b9c21",
      worktree.path,
      "refs/remotes/origin/main",
    ]);
  });

  it("sets push.autoSetupRemote when the user has no preference", async () => {
    const { root, git, calls } = await allocationHarness();
    await allocateIssueWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      issue,
      settings: { root, branchPrefix: "briar" },
      git,
    });
    expect(calls).toContainEqual(["config", "--local", "push.autoSetupRemote", "true"]);
  });

  it("keeps an existing push.autoSetupRemote value untouched", async () => {
    const { root, git, calls } = await allocationHarness((gitArgs) =>
      gitArgs[0] === "config" && gitArgs[1] === "--get" ? ok("false") : null,
    );
    await allocateIssueWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      issue,
      settings: { root, branchPrefix: "briar" },
      git,
    });
    expect(calls).not.toContainEqual(["config", "--local", "push.autoSetupRemote", "true"]);
  });

  it("re-attaches the same run to its existing worktree instead of creating another", async () => {
    const root = await temporaryDirectory("briar-worktree-reuse-");
    const existingPath = join(root, "project-1", "fix-login-redirect-3f6b9c21");
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") {
        return ok(
          [
            "worktree /repo",
            "branch refs/heads/main",
            "",
            `worktree ${existingPath}`,
            "branch refs/heads/briar/fix-login-redirect-3f6b9c21",
          ].join("\n"),
        );
      }
      if (gitArgs[0] === "remote") return ok("origin");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main");
      if (gitArgs[0] === "-c") return ok();
      return ok("existingsha");
    });

    const worktree = await allocateIssueWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      issue,
      settings: { root, branchPrefix: "briar" },
      git,
    });

    expect(worktree).toMatchObject({ path: existingPath, reused: true, baseSha: "existingsha" });
    expect(calls.some((gitArgs) => gitArgs[0] === "worktree" && gitArgs[1] === "add")).toBe(false);
  });

  it("honors an explicit base branch", async () => {
    const { root, git, calls } = await allocationHarness();
    const worktree = await allocateIssueWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      issue,
      settings: { root, branchPrefix: "briar" },
      git,
      baseRef: "origin/release",
    });
    expect(worktree.baseRef).toBe("origin/release");
    expect(calls).toContainEqual([
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/release:refs/remotes/origin/release",
    ]);
  });

  it("fails when no base ref can be resolved", async () => {
    const root = await temporaryDirectory("briar-worktree-nobase-");
    const { git } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") return ok("worktree /repo");
      if (gitArgs[0] === "remote") return ok("origin");
      return fail();
    });
    await expect(
      allocateIssueWorktree({
        repositoryPath: "/repo",
        projectId: "project-1",
        issue,
        settings: { root, branchPrefix: "briar" },
        git,
      }),
    ).rejects.toThrow(/기준 브랜치/u);
  });

  it("skips a name whose branch already exists", async () => {
    const { root, git } = await allocationHarness((gitArgs) =>
      gitArgs[0] === "rev-parse" &&
      gitArgs[1] === "--verify" &&
      gitArgs.at(-1) === "refs/heads/briar/fix-login-redirect-3f6b9c21^{commit}"
        ? ok("sha")
        : null,
    );
    const worktree = await allocateIssueWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      issue,
      settings: { root, branchPrefix: "briar" },
      git,
    });
    expect(worktree.branch).toBe("briar/fix-login-redirect-3f6b9c21-2");
  });
});

describe("symlinked roots", () => {
  it("matches the canonical paths git reports", async () => {
    const real = await temporaryDirectory("briar-symlink-real-");
    const link = join(await temporaryDirectory("briar-symlink-parent-"), "root");
    await symlink(real, link);
    await mkdir(join(real, "project-1", "fix-1a2b3c4d"), { recursive: true });

    const linked = join(link, "project-1", "fix-1a2b3c4d");
    const canonical = join(real, "project-1", "fix-1a2b3c4d");
    expect(samePath(linked, canonical)).toBe(true);
    expect(isPathWithinRoot(canonical, join(link, "project-1"))).toBe(true);
    expect(isPathWithinRoot(join(real, "elsewhere"), join(link, "project-1"))).toBe(false);
  });

  it("re-attaches a run whose worktree git reports under the canonical path", async () => {
    const real = await temporaryDirectory("briar-symlink-reuse-real-");
    const link = join(await temporaryDirectory("briar-symlink-reuse-parent-"), "root");
    await symlink(real, link);
    const canonical = join(real, "project-1", "fix-login-redirect-3f6b9c21");
    await mkdir(canonical, { recursive: true });

    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") {
        return ok(`worktree ${canonical}\nbranch refs/heads/briar/fix-login-redirect-3f6b9c21`);
      }
      if (gitArgs[0] === "remote") return ok("origin");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main");
      if (gitArgs[0] === "-c") return ok();
      return ok("sha");
    });

    const worktree = await allocateIssueWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      issue: {
        runId: "3f6b9c21-1111-2222-3333-444455556666",
        sourceKey: "github://wordbricks/briar/issues/42",
        title: "Fix login redirect",
      },
      settings: { root: link, branchPrefix: "briar" },
      git,
    });

    expect(worktree).toMatchObject({ path: canonical, reused: true });
    expect(calls.some((gitArgs) => gitArgs[0] === "worktree" && gitArgs[1] === "add")).toBe(false);
  });
});

describe("removal", () => {
  const worktree = { path: "/roots/project/fix-1a2b3c4d", branch: "briar/fix-1a2b3c4d" };

  it("refuses to remove a dirty worktree before touching git", () => {
    const { git, calls } = fakeGit((gitArgs) =>
      gitArgs[0] === "status" ? ok(" M src/app.ts\n") : ok(),
    );
    expect(() => removeIssueWorktree(git, "/repo", worktree)).toThrow(/커밋되지 않은/u);
    expect(calls.every((gitArgs) => gitArgs[0] === "status")).toBe(true);
  });

  it("removes a clean worktree and deletes its branch safely", () => {
    const { git, calls } = fakeGit(() => ok());
    expect(removeIssueWorktree(git, "/repo", worktree)).toEqual({
      removed: true,
      branchDeleted: true,
    });
    expect(calls).toContainEqual(["worktree", "remove", worktree.path]);
    expect(calls).toContainEqual(["branch", "-d", worktree.branch]);
  });

  it("drops an untouched branch that -d only refused because HEAD is stale", () => {
    // `-d` refuses (the branch is ahead of the behind-by-N local main), but the
    // branch is an ancestor of the base ref, so it holds no unique work.
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "branch" && gitArgs[1] === "-d") return fail("not fully merged");
      if (gitArgs[0] === "merge-base") return ok();
      return ok();
    });
    expect(removeIssueWorktree(git, "/repo", worktree, { baseRef: "origin/main" })).toEqual({
      removed: true,
      branchDeleted: true,
    });
    expect(calls).toContainEqual([
      "merge-base",
      "--is-ancestor",
      `refs/heads/${worktree.branch}`,
      "refs/remotes/origin/main",
    ]);
    expect(calls).toContainEqual(["branch", "-D", worktree.branch]);
  });

  it("preserves a branch that holds commits the base ref does not have", () => {
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "branch") return fail("not fully merged");
      if (gitArgs[0] === "merge-base") return fail("not an ancestor");
      return ok();
    });
    expect(removeIssueWorktree(git, "/repo", worktree, { baseRef: "origin/main" })).toEqual({
      removed: true,
      branchDeleted: false,
      preservedBranch: worktree.branch,
    });
    expect(calls).not.toContainEqual(["branch", "-D", worktree.branch]);
  });

  it("keeps the branch when the base ref cannot be resolved", () => {
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "branch" && gitArgs[1] === "-d") return fail("not fully merged");
      if (gitArgs[0] === "symbolic-ref" || gitArgs[0] === "rev-parse") return fail();
      return ok();
    });
    expect(removeIssueWorktree(git, "/repo", worktree).preservedBranch).toBe(worktree.branch);
    expect(calls).not.toContainEqual(["branch", "-D", worktree.branch]);
  });

  it("prunes bookkeeping when the directory is already gone", () => {
    const { git, calls } = fakeGit((gitArgs) =>
      gitArgs[0] === "worktree" && gitArgs[1] === "remove"
        ? fail("fatal: '/roots/project/fix-1a2b3c4d' is not a working tree")
        : ok(),
    );
    expect(removeIssueWorktree(git, "/repo", worktree, { force: true }).removed).toBe(true);
    expect(calls).toContainEqual(["worktree", "prune"]);
  });
});
