import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allocateAnalysisWorktree,
  allocateCachedAnalysisWorktree,
  allocateIssueWorktree,
  assertPathWithinRoot,
  compactWorktreeArtifacts,
  COMPLETED_WORKTREE_RETENTION_MS,
  copyWorktreeIncludes,
  defaultWorktreeRoot,
  findExistingIssueWorktree,
  isPathWithinRoot,
  issueReplyWorkspaceMode,
  listCachedAnalysisWorktrees,
  listCompletedWorktrees,
  listIssueWorktrees,
  maintainIdleAnalysisWorktrees,
  maintainTerminalIssueWorktree,
  parseRemoteTrackingBase,
  parseWorktreeIncludeFile,
  parseWorktreeList,
  qualifyBaseRef,
  recordCompletedWorktree,
  refreshRemoteBase,
  removeAnalysisWorktree,
  removeCompletedWorktreeRecord,
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

  it("recreates a removed worktree from its preserved local branch", async () => {
    const { root, git, calls } = await allocationHarness((gitArgs) =>
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
    expect(worktree).toMatchObject({
      branch: "briar/fix-login-redirect-3f6b9c21",
      reused: true,
    });
    expect(calls).toContainEqual([
      "worktree",
      "add",
      "--no-track",
      worktree.path,
      "refs/heads/briar/fix-login-redirect-3f6b9c21",
    ]);
  });

  it("skips a name reserved only by a remote branch", async () => {
    const { root, git } = await allocationHarness((gitArgs) =>
      gitArgs[0] === "rev-parse" &&
      gitArgs[1] === "--verify" &&
      gitArgs.at(-1) ===
        "refs/remotes/origin/briar/fix-login-redirect-3f6b9c21^{commit}"
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

describe("conversation worktree allocation", () => {
  it("uses cached analysis only for replies that do not require an execution worktree", () => {
    expect(issueReplyWorkspaceMode({
      worktreesEnabled: true,
      hasConfiguredWorktree: false,
      requiresPreferredWorker: false,
      branch: null,
    })).toBe("cached-analysis");
    expect(issueReplyWorkspaceMode({
      worktreesEnabled: true,
      hasConfiguredWorktree: false,
      requiresPreferredWorker: true,
      branch: "briar/in-progress",
    })).toBe("missing-required");
    expect(issueReplyWorkspaceMode({
      worktreesEnabled: true,
      hasConfiguredWorktree: true,
      requiresPreferredWorker: true,
      branch: "briar/in-progress",
    })).toBe("shared");
    expect(issueReplyWorkspaceMode({
      worktreesEnabled: false,
      hasConfiguredWorktree: false,
      branch: null,
    })).toBe("project");
  });

  it("uses branch presence as the safe rollout fallback for older servers", () => {
    expect(issueReplyWorkspaceMode({
      worktreesEnabled: true,
      hasConfiguredWorktree: false,
      branch: null,
    })).toBe("cached-analysis");
    expect(issueReplyWorkspaceMode({
      worktreesEnabled: true,
      hasConfiguredWorktree: false,
      branch: "briar/in-progress",
    })).toBe("missing-required");
  });

  it("uses a detached latest-remote checkout and removes it without a branch", async () => {
    const root = await temporaryDirectory("briar-analysis-root-");
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "remote") return ok("origin\n");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main\n");
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--verify") return ok("base-sha\n");
      if (gitArgs[0] === "rev-parse") return ok("base-sha\n");
      if (gitArgs[0] === "-c") return ok();
      return ok();
    });
    const worktree = await allocateAnalysisWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      workId: "abababab-abab-4bab-8bab-abababababab",
      settings: { root, branchPrefix: "unused" },
      git,
    });

    expect(worktree.path).toBe(
      join(root, "project-1", "analysis", "analysis-abababab-abab-4bab-8bab-abababababab"),
    );
    expect(worktree).toMatchObject({
      baseRef: "origin/main",
      baseSha: "base-sha",
      includedPaths: [],
    });
    expect(calls).toContainEqual([
      "worktree", "add", "--detach", worktree.path, "refs/remotes/origin/main",
    ]);
    expect(calls.some((args) => args.includes("-b"))).toBe(false);

    await removeAnalysisWorktree({ repositoryPath: "/repo", path: worktree.path, git });
    expect(calls).toContainEqual(["worktree", "remove", "--force", worktree.path]);
  });

  it("copies .worktreeinclude inputs into the disposable checkout", async () => {
    const repository = await temporaryDirectory("briar-conversation-repo-");
    const root = await temporaryDirectory("briar-conversation-root-");
    await writeFile(join(repository, ".worktreeinclude"), ".env.keys\n");
    await writeFile(join(repository, ".env.keys"), "DOTENV_PRIVATE_KEY=abc");
    const { git } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "remote") return ok("origin\n");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main\n");
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--verify") {
        return ok("base-sha\n");
      }
      if (gitArgs[0] === "rev-parse") return ok("base-sha\n");
      if (gitArgs[0] === "-c") return ok();
      return ok();
    });

    const worktree = await allocateAnalysisWorktree({
      repositoryPath: repository,
      projectId: "project-1",
      workId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      settings: { root, branchPrefix: "unused" },
      git,
    });

    expect(worktree.includedPaths).toEqual([".env.keys"]);
    expect(await readFile(join(worktree.path, ".env.keys"), "utf8")).toBe(
      "DOTENV_PRIVATE_KEY=abc",
    );
  });

  it("reuses one cached checkout for successive replies to the same issue", async () => {
    const root = await temporaryDirectory("briar-analysis-cache-root-");
    const runId = "edededed-eded-4ded-8ded-edededededed";
    const expectedPath = join(
      root,
      "project-1",
      "analysis",
      `analysis-${runId}`,
    );
    let attached = false;
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") {
        return ok([
          "worktree /repo",
          "branch refs/heads/main",
          ...(attached ? ["", `worktree ${expectedPath}`, "detached"] : []),
        ].join("\n"));
      }
      if (gitArgs[0] === "worktree" && gitArgs[1] === "add") {
        attached = true;
        return ok();
      }
      if (gitArgs[0] === "remote") return ok("origin\n");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main\n");
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--verify") {
        return ok("base-sha\n");
      }
      if (gitArgs[0] === "rev-parse") return ok("base-sha\n");
      if (gitArgs[0] === "-c") return ok();
      return ok();
    });

    const first = await allocateCachedAnalysisWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      runId,
      settings: { root, branchPrefix: "unused" },
      git,
      nowMs: 1_000,
    });
    await mkdir(first.path, { recursive: true });
    const second = await allocateCachedAnalysisWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      runId,
      settings: { root, branchPrefix: "unused" },
      git,
      nowMs: 2_000,
    });

    expect(first.reused).toBe(false);
    expect(second).toMatchObject({
      path: first.path,
      baseSha: "base-sha",
      reused: true,
    });
    expect(
      calls.filter((args) => args[0] === "worktree" && args[1] === "add"),
    ).toHaveLength(1);
    await expect(
      listCachedAnalysisWorktrees(join(root, "project-1")),
    ).resolves.toEqual([
      expect.objectContaining({
        runId,
        path: first.path,
        lastUsedAt: new Date(2_000).toISOString(),
      }),
    ]);
  });

  it("coalesces concurrent checkout allocation for the same issue", async () => {
    const root = await temporaryDirectory("briar-analysis-concurrent-root-");
    const runId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") {
        return ok("worktree /repo\nbranch refs/heads/main\n");
      }
      if (gitArgs[0] === "remote") return ok("origin\n");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main\n");
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--verify") {
        return ok("base-sha\n");
      }
      if (gitArgs[0] === "rev-parse") return ok("base-sha\n");
      return ok();
    });
    const input = {
      repositoryPath: "/repo",
      projectId: "project-1",
      runId,
      settings: { root, branchPrefix: "unused" },
      git,
    };

    const [first, second] = await Promise.all([
      allocateCachedAnalysisWorktree(input),
      allocateCachedAnalysisWorktree(input),
    ]);

    expect(second.path).toBe(first.path);
    expect(
      calls.filter((args) => args[0] === "worktree" && args[1] === "add"),
    ).toHaveLength(1);
  });

  it("removes an idle cached checkout but never one with an active reply", async () => {
    const root = await temporaryDirectory("briar-analysis-idle-root-");
    const projectRoot = join(root, "project-1");
    const runId = "efefefef-efef-4fef-8fef-efefefefefef";
    const expectedPath = join(
      projectRoot,
      "analysis",
      `analysis-${runId}`,
    );
    let attached = false;
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") {
        return ok([
          "worktree /repo",
          "branch refs/heads/main",
          ...(attached ? ["", `worktree ${expectedPath}`, "detached"] : []),
        ].join("\n"));
      }
      if (gitArgs[0] === "worktree" && gitArgs[1] === "add") {
        attached = true;
        return ok();
      }
      if (gitArgs[0] === "worktree" && gitArgs[1] === "remove") {
        attached = false;
        return ok();
      }
      if (gitArgs[0] === "remote") return ok("origin\n");
      if (gitArgs[0] === "symbolic-ref") return ok("refs/remotes/origin/main\n");
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--verify") {
        return ok("base-sha\n");
      }
      if (gitArgs[0] === "rev-parse") return ok("base-sha\n");
      if (gitArgs[0] === "-c") return ok();
      return ok();
    });
    const worktree = await allocateCachedAnalysisWorktree({
      repositoryPath: "/repo",
      projectId: "project-1",
      runId,
      settings: { root, branchPrefix: "unused" },
      git,
      nowMs: 1_000,
    });
    await mkdir(worktree.path, { recursive: true });

    await expect(
      maintainIdleAnalysisWorktrees(git, "/repo", projectRoot, {
        nowMs: 2_000,
        idleTtlMs: 500,
        activePaths: [worktree.path],
      }),
    ).resolves.toEqual([{
      runId,
      path: worktree.path,
      status: "retained",
      reason: "active",
    }]);
    expect(calls.some((args) => args[1] === "remove")).toBe(false);

    await expect(
      maintainIdleAnalysisWorktrees(git, "/repo", projectRoot, {
        nowMs: 2_000,
        idleTtlMs: 500,
      }),
    ).resolves.toEqual([{
      runId,
      path: worktree.path,
      status: "removed",
    }]);
    expect(calls).toContainEqual([
      "worktree", "remove", "--force", worktree.path,
    ]);
    await expect(listCachedAnalysisWorktrees(projectRoot)).resolves.toEqual([]);
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

describe("terminal worktree maintenance", () => {
  it("persists completed cleanup records outside the disposable worktree", async () => {
    const root = await temporaryDirectory("briar-worktree-registry-");
    const path = join(root, "issue-12345678");
    await mkdir(path);
    const record = {
      runId: "515b7a2c-8918-5a8f-a292-f0b95090281c",
      path,
      branch: "briar/issue-12345678",
      completedAt: "2026-08-01T00:00:00.000Z",
    };

    await recordCompletedWorktree(root, record);
    await expect(listCompletedWorktrees(root)).resolves.toEqual([record]);
    await removeCompletedWorktreeRecord(root, record.runId);
    await expect(listCompletedWorktrees(root)).resolves.toEqual([]);
  });

  it("compacts only known artifact directories that Git confirms are ignored", async () => {
    const worktree = await temporaryDirectory("briar-worktree-compact-");
    const ignoredArtifacts = ["node_modules", "src-tauri/target", "apps/web/.next"];
    const trackedBuild = "src/build";
    for (const path of [...ignoredArtifacts, trackedBuild]) {
      await mkdir(join(worktree, path), { recursive: true });
      await writeFile(join(worktree, path, "artifact.bin"), path);
    }
    await mkdir(join(worktree, "config"), { recursive: true });
    await writeFile(join(worktree, "config/.env"), "SECRET=preserved\n");

    const ignored = new Set(ignoredArtifacts);
    const { git } = fakeGit((gitArgs) =>
      gitArgs[0] === "check-ignore" && ignored.has(gitArgs.at(-1) ?? "") ? ok() : fail(),
    );
    const result = await compactWorktreeArtifacts(git, worktree);

    expect(result).toEqual({ compactedPaths: ignoredArtifacts.sort(), failedPaths: [] });
    for (const path of ignoredArtifacts) {
      expect(existsSync(join(worktree, path))).toBe(false);
    }
    expect(existsSync(join(worktree, trackedBuild, "artifact.bin"))).toBe(true);
    expect(existsSync(join(worktree, "config/.env"))).toBe(true);
  });

  it("compacts outputs and removes a clean completed worktree after 24 hours", async () => {
    const path = await temporaryDirectory("briar-worktree-gc-");
    await mkdir(join(path, "node_modules"));
    await writeFile(join(path, "node_modules/package.json"), "{}");
    const worktree = { path, branch: "briar/merged-12345678" };
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "check-ignore") return ok();
      return ok();
    });

    await expect(
      maintainTerminalIssueWorktree(git, "/repo", worktree, {
        baseRef: "origin/main",
        completedAt: "2026-08-01T00:00:00.000Z",
        nowMs: Date.parse("2026-08-02T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      compactedPaths: ["node_modules"],
      failedPaths: [],
      gc: { status: "removed", branchDeleted: true },
    });
    expect(calls).toContainEqual(["worktree", "remove", path]);
  });

  it("removes an expired clean worktree but preserves its unmerged branch", async () => {
    const path = await temporaryDirectory("briar-worktree-unmerged-");
    await mkdir(join(path, "src-tauri/target"), { recursive: true });
    await writeFile(join(path, "src-tauri/target/app"), "binary");
    const worktree = { path, branch: "briar/open-12345678" };
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "check-ignore") return ok();
      if (gitArgs[0] === "merge-base") return fail("not an ancestor");
      if (gitArgs[0] === "branch" && gitArgs[1] === "-d") return fail("not fully merged");
      return ok();
    });

    await expect(
      maintainTerminalIssueWorktree(git, "/repo", worktree, {
        baseRef: "origin/main",
        completedAt: "2026-08-01T00:00:00.000Z",
        nowMs: Date.parse("2026-08-02T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      compactedPaths: ["src-tauri/target"],
      failedPaths: [],
      gc: {
        status: "removed",
        branchDeleted: false,
        preservedBranch: "briar/open-12345678",
      },
    });
    expect(calls).toContainEqual(["worktree", "remove", path]);
    expect(calls).not.toContainEqual(["branch", "-D", worktree.branch]);
  });

  it("keeps a completed worktree during its 24-hour retention period", async () => {
    const path = await temporaryDirectory("briar-worktree-retention-");
    const worktree = { path, branch: "briar/recent-12345678" };
    const nowMs = Date.parse("2026-08-02T00:00:00.000Z");
    const { git, calls } = fakeGit(() => ok());

    await expect(
      maintainTerminalIssueWorktree(git, "/repo", worktree, {
        completedAt: new Date(nowMs - COMPLETED_WORKTREE_RETENTION_MS + 1).toISOString(),
        nowMs,
      }),
    ).resolves.toMatchObject({ gc: { status: "retained", reason: "retention-period" } });
    expect(calls.some((gitArgs) => gitArgs[0] === "worktree" && gitArgs[1] === "remove")).toBe(
      false,
    );
  });

  it("keeps worktrees that have not completed", async () => {
    const path = await temporaryDirectory("briar-worktree-running-");
    const worktree = { path, branch: "briar/running-12345678" };
    const { git, calls } = fakeGit(() => ok());

    await expect(
      maintainTerminalIssueWorktree(git, "/repo", worktree),
    ).resolves.toMatchObject({ gc: { status: "retained", reason: "not-completed" } });
    expect(calls.some((gitArgs) => gitArgs[0] === "worktree" && gitArgs[1] === "remove")).toBe(
      false,
    );
  });

  it("keeps expired completed worktrees that still contain source changes", async () => {
    const path = await temporaryDirectory("briar-worktree-dirty-");
    const worktree = { path, branch: "briar/dirty-12345678" };
    let statusCalls = 0;
    const { git, calls } = fakeGit((gitArgs) => {
      if (gitArgs[0] === "merge-base") return ok();
      if (gitArgs[0] === "status") {
        statusCalls += 1;
        return ok(" M src/app.ts\n");
      }
      return ok();
    });

    await expect(
      maintainTerminalIssueWorktree(git, "/repo", worktree, {
        baseRef: "origin/main",
        completedAt: "2026-08-01T00:00:00.000Z",
        nowMs: Date.parse("2026-08-02T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ gc: { status: "retained", reason: "dirty" } });
    expect(statusCalls).toBe(1);
    expect(calls.some((gitArgs) => gitArgs[0] === "worktree" && gitArgs[1] === "remove")).toBe(
      false,
    );
  });
});
