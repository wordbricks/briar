import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MERGE_GROUP_STATUS_CONTEXTS,
  MERGE_GROUP_VALIDATION_COMMAND,
  MERGE_GROUP_VALIDATION_DEFINITION_PATHS,
  MERGE_GROUP_VALIDATION_PROFILE_PATH,
} from "../src/lib/merge-group-validation-contract";
import type { ClaimedMergeGroupValidation } from "./worker-claim-contract";
import type { GitRunner } from "./worktree";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => CommandResult;

export class StaleMergeGroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleMergeGroupError";
  }
}

export class MergeGroupCiDefinitionChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeGroupCiDefinitionChangedError";
  }
}

export function fetchExactMergeGroupHead(
  git: GitRunner,
  repositoryPath: string,
  job: Pick<
    ClaimedMergeGroupValidation,
    "workId" | "headRef" | "headSha" | "baseSha"
  > & { fetchToken: string },
) {
  const localRef = `refs/briar/merge-group-validation/${job.workId}`;
  const authorization = Buffer.from(`x-access-token:${job.fetchToken}`).toString("base64");
  const fetched = git([
    "-c",
    "maintenance.auto=false",
    "-c",
    `http.https://github.com/.extraheader=AUTHORIZATION: basic ${authorization}`,
    "fetch",
    "--no-tags",
    "origin",
    `+${job.headRef}:${localRef}`,
  ], { cwd: repositoryPath, timeoutMs: 120_000 });
  if (fetched.exitCode !== 0) {
    if (/couldn(?:'|’)t find remote ref|remote ref .* not found/iu.test(fetched.stderr)) {
      throw new StaleMergeGroupError("The signed merge-group ref no longer exists");
    }
    throw new Error(
      `Exact merge-group ref fetch failed: ${fetched.stderr.trim() || "git fetch failed"}`,
    );
  }
  const exact = git(["rev-parse", localRef], { cwd: repositoryPath });
  if (exact.exitCode !== 0 || exact.stdout.trim() !== job.headSha) {
    throw new StaleMergeGroupError(
      "Fetched merge-group SHA did not match the signed webhook SHA",
    );
  }
  const baseExists = git(["cat-file", "-e", `${job.baseSha}^{commit}`], {
    cwd: repositoryPath,
  });
  const containsBase = git([
    "merge-base",
    "--is-ancestor",
    job.baseSha,
    job.headSha,
  ], { cwd: repositoryPath });
  if (baseExists.exitCode !== 0 || containsBase.exitCode !== 0) {
    throw new StaleMergeGroupError(
      "Synthetic merge-group head does not descend from its signed base SHA",
    );
  }
  return localRef;
}

export async function prepareTrustedMergeGroupProfile(
  git: GitRunner,
  repositoryPath: string,
  job: Pick<ClaimedMergeGroupValidation, "workId" | "baseSha" | "headSha">,
) {
  const changed = git([
    "diff",
    "--quiet",
    job.baseSha,
    job.headSha,
    "--",
    ...MERGE_GROUP_VALIDATION_DEFINITION_PATHS,
  ], { cwd: repositoryPath });
  if (changed.exitCode === 1) {
    throw new MergeGroupCiDefinitionChangedError(
      "The candidate changes the trusted merge-group CI definition",
    );
  }
  if (changed.exitCode !== 0) {
    throw new Error(`CI-definition comparison failed: ${changed.stderr.trim()}`);
  }
  const source = git([
    "show",
    `${job.baseSha}:${MERGE_GROUP_VALIDATION_PROFILE_PATH}`,
  ], { cwd: repositoryPath });
  if (source.exitCode !== 0 || source.stdout.length === 0) {
    throw new Error("Trusted base CI profile could not be loaded");
  }
  const root = await mkdtemp(join(tmpdir(), "briar-merge-group-ci."));
  await chmod(root, 0o755);
  const profilePath = join(root, "ci-local.sh");
  await writeFile(profilePath, source.stdout, { mode: 0o555 });
  const scratchPath = join(root, "scratch");
  await mkdir(scratchPath, { recursive: true, mode: 0o777 });
  await chmod(scratchPath, 0o777);
  const bundlePath = join(root, "repository.bundle");
  const bundled = git([
    "bundle",
    "create",
    bundlePath,
    `refs/briar/merge-group-validation/${job.workId}`,
  ], {
    cwd: repositoryPath,
    timeoutMs: 120_000,
  });
  if (bundled.exitCode !== 0) {
    await rm(root, { recursive: true, force: true });
    throw new Error(`Trusted repository bundle failed: ${bundled.stderr.trim()}`);
  }
  return { root, profilePath, scratchPath, bundlePath };
}

export function assertValidationWorktreeHead(
  git: GitRunner,
  path: string,
  expectedSha: string,
) {
  const head = git(["rev-parse", "HEAD"], { cwd: path });
  if (head.exitCode !== 0 || head.stdout.trim() !== expectedSha) {
    throw new StaleMergeGroupError(
      "Validation worktree HEAD changed from the claimed synthetic SHA",
    );
  }
}

export function assertValidationWorktreeClean(git: GitRunner, path: string) {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: path,
  });
  if (status.exitCode !== 0 || status.stdout.trim() !== "") {
    throw new Error("Validation worktree is not clean after fresh allocation");
  }
}

export function mergeGroupContainerRuntime(
  source: NodeJS.ProcessEnv = process.env,
  which: (command: string) => string | null = (command) => Bun.which(command),
  inspect: (executable: string, image: string) => boolean = (executable, image) =>
    spawnSync(executable, ["image", "inspect", image], {
      env: {
        HOME: tmpdir(),
        PATH: "/usr/local/bin:/usr/bin:/bin",
        TMPDIR: tmpdir(),
      },
      shell: false,
      stdio: "ignore",
      timeout: 10_000,
    }).status === 0,
) {
  const image = source.BRIAR_MERGE_GROUP_CI_IMAGE?.trim() ?? "";
  const executable = which("docker");
  if (!executable) return { ready: false as const, detail: "Docker is not installed" };
  if (!/^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/u.test(image)) {
    return {
      ready: false as const,
      detail: "BRIAR_MERGE_GROUP_CI_IMAGE must pin an image by sha256 digest",
    };
  }
  if (!inspect(executable, image)) {
    return {
      ready: false as const,
      detail: "The digest-pinned merge-group CI image is not installed locally",
    };
  }
  return { ready: true as const, executable, image };
}

export function terminateProcessGroup(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal: NodeJS.Signals,
  platform = process.platform,
) {
  if (!child.pid) return false;
  try {
    return platform === "win32"
      ? child.kill(signal)
      : process.kill(-child.pid, signal);
  } catch {
    return false;
  }
}

export async function runFixedMergeGroupValidation(
  input: {
    cwd: string;
    profilePath: string;
    scratchPath: string;
    bundlePath: string;
    headSha: string;
    runtime: { executable: string; image: string };
    signal: AbortSignal;
    killGraceMs?: number;
  },
): Promise<{ passed: boolean; exitCode: number }> {
  const args = [
    "run",
    "--rm",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=65532:65532",
    "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=4g",
    "--tmpfs=/scratch:rw,nosuid,nodev,size=12g,uid=65532,gid=65532",
    "--pids-limit=1024",
    `--mount=type=bind,src=${input.bundlePath},dst=/opt/briar/repository.bundle,ro`,
    `--mount=type=bind,src=${input.profilePath},dst=/opt/briar/ci-local.sh,ro`,
    "--env=CI=true",
    "--env=GIT_TERMINAL_PROMPT=0",
    "--env=GH_PROMPT_DISABLED=1",
    "--env=HOME=/scratch/home",
    "--env=TMPDIR=/tmp",
    "--env=BUN_INSTALL_CACHE_DIR=/opt/briar/bun-cache",
    "--env=CARGO_HOME=/opt/briar/cargo",
    "--env=RUSTUP_HOME=/opt/briar/rustup",
    "--env=BRIAR_TRUSTED_MERGE_GROUP_CI=1",
    "--env=BRIAR_CI_WORKSPACE_ROOT=/scratch/workspace",
    "--env=BRIAR_CI_REPOSITORY_BUNDLE=/opt/briar/repository.bundle",
    `--env=BRIAR_CI_HEAD_SHA=${input.headSha}`,
    input.runtime.image,
    "/bin/bash",
    "/opt/briar/ci-local.sh",
  ];
  let child: ChildProcess | null = null;
  let abortRequested = false;
  let finishForcedKill: (() => void) | null = null;
  const forcedKill = new Promise<void>((resolve) => {
    finishForcedKill = resolve;
  });
  let forcedKillTimer: ReturnType<typeof setTimeout> | null = null;
  const abort = () => {
    if (abortRequested) return;
    abortRequested = true;
    if (child) terminateProcessGroup(child, "SIGTERM");
    forcedKillTimer = setTimeout(() => {
      if (child) terminateProcessGroup(child, "SIGKILL");
      finishForcedKill?.();
    }, input.killGraceMs ?? 5_000);
  };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    child = spawn(input.runtime.executable, args, {
      cwd: input.cwd,
      detached: process.platform !== "win32",
      env: {
        HOME: input.scratchPath,
        PATH: "/usr/local/bin:/usr/bin:/bin",
        TMPDIR: input.scratchPath,
      },
      stdio: "inherit",
      shell: false,
    });
    if (input.signal.aborted) abort();
    if (abortRequested) terminateProcessGroup(child, "SIGTERM");
    const runningChild = child;
    const exit = await new Promise<number>((resolve, reject) => {
      runningChild.once("error", reject);
      runningChild.once("close", (code, childSignal) => {
        if (childSignal) {
          if (input.signal.aborted) {
            resolve(75);
            return;
          }
          reject(new Error(`Validation process stopped by ${childSignal}`));
          return;
        }
        resolve(code ?? 1);
      });
    });
    if (input.signal.aborted) {
      await forcedKill;
      throw input.signal.reason ?? new Error("Validation aborted");
    }
    if ([75, 125, 126, 127, 137].includes(exit)) {
      throw new Error(`Isolated validation infrastructure failed (${exit})`);
    }
    return { passed: exit === 0, exitCode: exit };
  } finally {
    input.signal.removeEventListener("abort", abort);
    if (!abortRequested && forcedKillTimer) clearTimeout(forcedKillTimer);
  }
}

export { MERGE_GROUP_STATUS_CONTEXTS, MERGE_GROUP_VALIDATION_COMMAND };
