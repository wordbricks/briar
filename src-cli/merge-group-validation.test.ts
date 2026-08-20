import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  fetchExactMergeGroupHead,
  MERGE_GROUP_STATUS_CONTEXTS,
  MERGE_GROUP_VALIDATION_COMMAND,
  mergeGroupContainerRuntime,
  prepareTrustedMergeGroupProfile,
  runFixedMergeGroupValidation,
  StaleMergeGroupError,
  terminateProcessGroup,
} from "./merge-group-validation";

const job = {
  workId: "11111111-1111-4111-8111-111111111111",
  repository: "wordbricks/briar",
  headRef: "refs/heads/gh-readonly-queue/main/pr-1-deadbeef",
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
};

describe("fixed merge-group executor", () => {
  it("has no configurable shell command or status contexts", () => {
    expect(MERGE_GROUP_VALIDATION_COMMAND).toEqual(["docker", "run", "--network=none"]);
    expect(MERGE_GROUP_STATUS_CONTEXTS).toEqual([
      "signoff/app-worker",
      "signoff/d1-migrations",
      "signoff/rust",
      "signoff/security",
    ]);
  });

  it("requires a digest-pinned isolated container runtime", () => {
    expect(mergeGroupContainerRuntime({}, () => "/usr/bin/docker")).toMatchObject({
      ready: false,
    });
    expect(mergeGroupContainerRuntime({
      BRIAR_MERGE_GROUP_CI_IMAGE: `ghcr.io/wordbricks/briar-ci@sha256:${"a".repeat(64)}`,
      GH_TOKEN: "must-not-be-forwarded",
    }, () => "/usr/bin/docker", () => true)).toEqual({
      ready: true,
      executable: "/usr/bin/docker",
      image: `ghcr.io/wordbricks/briar-ci@sha256:${"a".repeat(64)}`,
    });
  });

  it("fetches the signed ref to a private ref and verifies exact head and ancestry", () => {
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${job.headSha}\n`, stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    expect(fetchExactMergeGroupHead(git, "/repo", {
      ...job,
      fetchToken: "github-installation-token",
    })).toContain(job.workId);
    expect(calls[0]).toEqual([
      "-c",
      "maintenance.auto=false",
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
        "x-access-token:github-installation-token",
      ).toString("base64")}`,
      "fetch",
      "--no-tags",
      "origin",
      `+${job.headRef}:refs/briar/merge-group-validation/${job.workId}`,
    ]);
    expect(calls).toContainEqual([
      "merge-base",
      "--is-ancestor",
      job.baseSha,
      job.headSha,
    ]);
  });

  it("treats only a missing signed ref as stale fetch state", () => {
    const missing = () => ({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: couldn't find remote ref refs/heads/gh-readonly-queue/main/pr-1-deadbeef",
    });
    expect(() => fetchExactMergeGroupHead(missing, "/repo", {
      ...job,
      fetchToken: "token",
    })).toThrow(StaleMergeGroupError);
    const outage = () => ({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: unable to access github.com: HTTP 503",
    });
    expect(() => fetchExactMergeGroupHead(outage, "/repo", {
      ...job,
      fetchToken: "token",
    })).toThrow(/fetch failed/iu);
  });

  it("rejects candidate-owned CI entrypoint changes and loads the signed base copy", async () => {
    const changed = vi.fn(() => ({ exitCode: 1, stdout: "", stderr: "" }));
    await expect(prepareTrustedMergeGroupProfile(changed, "/repo", job))
      .rejects.toThrow(/changes the trusted/iu);

    const stable = vi.fn((args: string[]) => args[0] === "diff"
      ? { exitCode: 0, stdout: "", stderr: "" }
      : { exitCode: 0, stdout: "#!/bin/bash\nexit 0\n", stderr: "" });
    const profile = await prepareTrustedMergeGroupProfile(stable, "/repo", job);
    expect(await readFile(profile.profilePath, "utf8")).toContain("exit 0");
    expect(stable).toHaveBeenCalledWith([
      "show",
      `${job.baseSha}:scripts/ci-local.sh`,
    ], { cwd: "/repo" });
    expect(stable).toHaveBeenCalledWith([
      "bundle",
      "create",
      profile.bundlePath,
      `refs/briar/merge-group-validation/${job.workId}`,
    ], { cwd: "/repo", timeoutMs: 120_000 });
  });

  it("terminates the entire POSIX process group", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    try {
      expect(terminateProcessGroup({ pid: 4321, kill: vi.fn() } as never, "SIGTERM", "darwin"))
        .toBe(true);
      expect(kill).toHaveBeenCalledWith(-4321, "SIGTERM");
    } finally {
      kill.mockRestore();
    }
  });

  it("does not expose Worker, GitHub, keychain, or toolchain environment to the launcher", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "briar-clean-env."));
    const executable = join(root, "fake-docker.sh");
    const environmentFile = join(root, "environment.txt");
    const argumentFile = join(root, "arguments.txt");
    await writeFile(executable, `#!/bin/bash
env >${JSON.stringify(environmentFile)}
printf '%s\\n' "$@" >${JSON.stringify(argumentFile)}
`);
    await chmod(executable, 0o700);
    vi.stubEnv("BRIAR_WORKER_TOKEN", "worker-secret");
    vi.stubEnv("GH_TOKEN", "github-secret");
    vi.stubEnv("CARGO_HOME", "/private/cargo");
    try {
      await expect(runFixedMergeGroupValidation({
        cwd: root,
        profilePath: executable,
        scratchPath: root,
        bundlePath: executable,
        headSha: job.headSha,
        runtime: { executable, image: `example.invalid/ci@sha256:${"a".repeat(64)}` },
        signal: new AbortController().signal,
      })).resolves.toEqual({ passed: true, exitCode: 0 });
      const environment = await readFile(environmentFile, "utf8");
      expect(environment).not.toContain("BRIAR_WORKER_TOKEN");
      expect(environment).not.toContain("GH_TOKEN");
      expect(environment).not.toContain("CARGO_HOME");
      expect(environment).toContain(`HOME=${root}`);
      const dockerArguments = await readFile(argumentFile, "utf8");
      expect(dockerArguments).toContain("--network=none");
      expect(dockerArguments).toContain("--read-only");
      expect(dockerArguments).toContain("--cap-drop=ALL");
      expect(dockerArguments).toContain("--security-opt=no-new-privileges");
      expect(dockerArguments).toContain("--user=65532:65532");
      expect(dockerArguments).toContain("--tmpfs=/scratch:rw,nosuid,nodev,size=12g,uid=65532,gid=65532");
      expect(dockerArguments).toContain("--pids-limit=1024");
      expect(dockerArguments).toContain("--env=HOME=/scratch/home");
      expect(dockerArguments).toContain("--env=BUN_INSTALL_CACHE_DIR=/opt/briar/bun-cache");
      expect(dockerArguments).toContain("--env=CARGO_HOME=/opt/briar/cargo");
      expect(dockerArguments).toContain("--env=RUSTUP_HOME=/opt/briar/rustup");
      expect(dockerArguments).not.toContain(`src=${root},dst=/scratch`);
      expect(dockerArguments).not.toContain("dst=/candidate");
      expect(dockerArguments).not.toContain("BRIAR_CI_CANDIDATE_ROOT");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("waits through SIGKILL and kills a TERM-ignoring descendant", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "briar-kill-tree."));
    const executable = join(root, "fake-docker.sh");
    const pidFile = join(root, "descendant.pid");
    await writeFile(executable, `#!/bin/bash
trap '' TERM
bash -c 'trap "" TERM; while :; do sleep 1; done' &
echo $! >${JSON.stringify(pidFile)}
while :; do sleep 1; done
`);
    await chmod(executable, 0o700);
    const controller = new AbortController();
    const running = runFixedMergeGroupValidation({
      cwd: root,
      profilePath: executable,
      scratchPath: root,
      bundlePath: executable,
      headSha: job.headSha,
      runtime: { executable, image: `example.invalid/ci@sha256:${"a".repeat(64)}` },
      signal: controller.signal,
      killGraceMs: 25,
    });
    try {
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), {
        timeout: 5_000,
      });
      const descendantPid = Number((await readFile(pidFile, "utf8")).trim());
      controller.abort(new Error("lease lost"));
      await expect(running).rejects.toThrow("lease lost");
      expect(() => process.kill(descendantPid, 0)).toThrow();
    } finally {
      if (!controller.signal.aborted) {
        controller.abort(new Error("test cleanup"));
      }
      await running.catch(() => undefined);
    }
  });
});
