import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MERGE_GROUP_CI_AUDITED_IMAGE,
  MERGE_GROUP_STATUS_CONTEXTS,
  MERGE_GROUP_BUN_CONFIG_PATH,
  MERGE_GROUP_VALIDATION_COMMAND,
  MERGE_GROUP_VALIDATION_DEFINITION_PATHS,
  MERGE_GROUP_VALIDATION_PROFILE_PATH,
  MERGE_GROUP_VITEST_CONFIG_PATH,
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

export function assertTrustedCandidateConfiguration(paths: readonly string[]) {
  const rejected = paths.find((path) =>
    /^(?:bunfig(?:\..+)?\.toml|vitest\.(?:config|workspace)\.[^/]+|\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\..*)?|node_modules\/|\.bun\/)/u
      .test(path) ||
    /(?:^|\/)(?:preload|register|loader)\.(?:js|cjs|mjs|ts|cts|mts)$/u
      .test(path)
  );
  if (rejected) {
    throw new MergeGroupCiDefinitionChangedError(
      `The candidate adds an auto-loaded CI control file: ${rejected}`,
    );
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
  const changedPaths = git([
    "diff",
    "--name-only",
    "-z",
    job.baseSha,
    job.headSha,
  ], { cwd: repositoryPath });
  if (changedPaths.exitCode !== 0) {
    throw new Error(`Candidate path inspection failed: ${changedPaths.stderr.trim()}`);
  }
  assertTrustedCandidateConfiguration(
    changedPaths.stdout.split("\0").filter(Boolean),
  );
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
  const root = await mkdtemp(join(tmpdir(), "briar-merge-group-ci."));
  await chmod(root, 0o755);
  const trustedFiles = async (repositoryPathname: string, filename: string) => {
    const source = git([
      "show",
      `${job.baseSha}:${repositoryPathname}`,
    ], { cwd: repositoryPath });
    if (source.exitCode !== 0 || source.stdout.length === 0) {
      throw new Error(`Trusted base file could not be loaded: ${repositoryPathname}`);
    }
    const path = join(root, filename);
    await writeFile(path, source.stdout, { mode: 0o555 });
    return path;
  };
  const profilePath = await trustedFiles(
    MERGE_GROUP_VALIDATION_PROFILE_PATH,
    "ci-local.sh",
  );
  const bunConfigPath = await trustedFiles(
    MERGE_GROUP_BUN_CONFIG_PATH,
    "bunfig.toml",
  );
  const vitestConfigPath = await trustedFiles(
    MERGE_GROUP_VITEST_CONFIG_PATH,
    "vitest.config.ts",
  );
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
  return {
    root,
    profilePath,
    bunConfigPath,
    vitestConfigPath,
    scratchPath,
    bundlePath,
  };
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
  if (image !== MERGE_GROUP_CI_AUDITED_IMAGE) {
    return {
      ready: false as const,
      detail: "BRIAR_MERGE_GROUP_CI_IMAGE must match the audited image policy",
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
    bunConfigPath: string;
    vitestConfigPath: string;
    headSha: string;
    runtime: { executable: string; image: string };
    signal: AbortSignal;
    killGraceMs?: number;
    deadlineMs?: number;
    containerName?: string;
  },
): Promise<{
  passed: boolean;
  exitCode: number;
  log: string;
  logSha256: string;
  logTruncated: boolean;
}> {
  const containerName = input.containerName ??
    `briar-merge-group-${input.headSha.slice(0, 20)}`;
  if (!/^briar-merge-group-[a-z0-9-]{1,100}$/u.test(containerName)) {
    throw new Error("Merge-group container name is invalid");
  }
  const cleanEnvironment = {
    HOME: input.scratchPath,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: input.scratchPath,
  };
  const removeContainer = () => spawnSync(
    input.runtime.executable,
    ["rm", "-f", containerName],
    {
      cwd: input.cwd,
      env: cleanEnvironment,
      shell: false,
      stdio: "ignore",
      timeout: 30_000,
    },
  );
  // A previous CLI/host crash must be cleaned before a new synthetic tail can
  // consume the same lane. Docker returns nonzero when no such name exists.
  removeContainer();
  const args = [
    "run",
    `--name=${containerName}`,
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=65532:65532",
    "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=4g",
    "--tmpfs=/scratch:rw,nosuid,nodev,size=12g,uid=65532,gid=65532",
    "--memory=16g",
    "--memory-swap=16g",
    "--cpus=4",
    "--pids-limit=1024",
    "--ulimit=nofile=4096:4096",
    "--ulimit=core=0:0",
    `--mount=type=bind,src=${input.bundlePath},dst=/opt/briar/repository.bundle,ro`,
    `--mount=type=bind,src=${input.profilePath},dst=/opt/briar/ci-local.sh,ro`,
    `--mount=type=bind,src=${input.bunConfigPath},dst=/opt/briar/bunfig.toml,ro`,
    `--mount=type=bind,src=${input.vitestConfigPath},dst=/opt/briar/vitest.config.ts,ro`,
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
    "--env=BRIAR_CI_BUN_CONFIG=/opt/briar/bunfig.toml",
    "--env=BRIAR_CI_VITEST_CONFIG=/opt/briar/vitest.config.ts",
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
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineReached = false;
  const logHash = createHash("sha256");
  const logChunks: Buffer[] = [];
  let logBytes = 0;
  let logTruncated = false;
  const logLimit = 256 * 1_024;
  const capture = (chunk: Buffer, output: NodeJS.WriteStream) => {
    logHash.update(chunk);
    output.write(chunk);
    if (logBytes >= logLimit) {
      logTruncated = true;
      return;
    }
    const remaining = logLimit - logBytes;
    const retained = chunk.subarray(0, remaining);
    logChunks.push(retained);
    logBytes += retained.length;
    if (retained.length !== chunk.length) logTruncated = true;
  };
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
    deadlineTimer = setTimeout(() => {
      deadlineReached = true;
      abort();
    }, input.deadlineMs ?? 50 * 60_000);
    child = spawn(input.runtime.executable, args, {
      cwd: input.cwd,
      detached: process.platform !== "win32",
      env: cleanEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, process.stdout));
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, process.stderr));
    if (input.signal.aborted) abort();
    if (abortRequested) terminateProcessGroup(child, "SIGTERM");
    const runningChild = child;
    const exit = await new Promise<number>((resolve, reject) => {
      runningChild.once("error", reject);
      runningChild.once("close", (code, childSignal) => {
        if (childSignal) {
          if (input.signal.aborted || abortRequested) {
            resolve(75);
            return;
          }
          reject(new Error(`Validation process stopped by ${childSignal}`));
          return;
        }
        resolve(code ?? 1);
      });
    });
    if (input.signal.aborted || deadlineReached) {
      await forcedKill;
      throw input.signal.aborted
        ? input.signal.reason ?? new Error("Validation aborted")
        : new Error("Isolated validation exceeded the 50 minute deadline");
    }
    if ([75, 125, 126, 127, 137].includes(exit)) {
      throw new Error(`Isolated validation infrastructure failed (${exit})`);
    }
    return {
      passed: exit === 0,
      exitCode: exit,
      log: Buffer.concat(logChunks).toString("utf8") || "(no container output)",
      logSha256: logHash.digest("hex"),
      logTruncated,
    };
  } finally {
    input.signal.removeEventListener("abort", abort);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (!abortRequested && forcedKillTimer) clearTimeout(forcedKillTimer);
    const removed = removeContainer();
    if (removed.status !== 0) {
      throw new Error(
        "Isolated validation container cleanup was not acknowledged",
      );
    }
  }
}

export { MERGE_GROUP_STATUS_CONTEXTS, MERGE_GROUP_VALIDATION_COMMAND };
