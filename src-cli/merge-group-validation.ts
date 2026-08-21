import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  MERGE_GROUP_CI_BUN_CONFIG_PATH,
  MERGE_GROUP_CI_CONTAINER_LIMITS,
  MERGE_GROUP_CI_CONTEXT_CONCURRENCY,
  MERGE_GROUP_CI_CONTEXTS,
  MERGE_GROUP_CI_DEFAULT_DEADLINE_MS,
  MERGE_GROUP_CI_IMAGE_REPOSITORY,
  MERGE_GROUP_CI_LOCAL_PROFILE_PATH,
  MERGE_GROUP_CI_MAX_DEADLINE_MS,
  MERGE_GROUP_CI_MAX_OUTPUT_BYTES,
  MERGE_GROUP_CI_PROFILE_PATH,
  MERGE_GROUP_CI_PROTOCOL,
  MERGE_GROUP_CI_RETAINED_LOG_BYTES,
  MERGE_GROUP_CI_TRUSTED_FILES,
  type MergeGroupCiContext,
} from "../src/lib/merge-group-validation-contract";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GitRunner = (
  command: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => CommandResult;

export class ExactShaValidationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactShaValidationInputError";
  }
}

export class MergeGroupCiDefinitionChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeGroupCiDefinitionChangedError";
  }
}

export class MergeGroupCiInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MergeGroupCiInfrastructureError";
  }
}

const automaticControlBasenames = [
  /^(?:bunfig(?:\..+)?\.toml)$/u,
  /^(?:vitest|vite)\.(?:config|workspace)\.[^/]+$/u,
  /^(?:postcss|tailwind|eslint|prettier)\.config\.[^/]+$/u,
  /^(?:tsconfig)(?:\..+)?\.json$/u,
  /^(?:rust-toolchain)(?:\.toml)?$/u,
  /^(?:tauri\.conf\.[^/]+|wrangler\.(?:jsonc?|toml))$/u,
  /^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/u,
  /^(?:\.npmrc|\.yarnrc(?:\..*)?|\.pnpmfile\.cjs)$/u,
  /^(?:\.gitleaksignore|\.gitleaks\.toml)$/u,
  /^(?:package\.json|bun\.lock|Cargo\.toml|Cargo\.lock|build\.rs)$/u,
  /^(?:preload|register|loader)\.(?:js|cjs|mjs|ts|cts|mts)$/u,
] as const;

const exactControlPaths = new Set([
  MERGE_GROUP_CI_PROFILE_PATH,
  MERGE_GROUP_CI_BUN_CONFIG_PATH,
  MERGE_GROUP_CI_LOCAL_PROFILE_PATH,
  "src/test/setup.ts",
  "scripts/d1-test-template.ts",
  "worker/src/test-helpers/d1.ts",
]);

export function isMergeGroupCiControlPath(path: string) {
  const segments = path.split("/");
  if (
    path.length === 0 || path.startsWith("/") || path.includes("\\") ||
    segments.some((segment) => segment === "..")
  ) return true;
  if (exactControlPaths.has(path)) return true;
  if (
    path.startsWith("scripts/") || path.startsWith("config/") ||
    path.startsWith("containers/merge-group-ci/") ||
    path.startsWith(".github/") ||
    segments.some((segment) =>
      segment === ".cargo" || segment === "node_modules" || segment === ".bun"
    )
  ) return true;
  const pathBasename = basename(path);
  return automaticControlBasenames.some((pattern) => pattern.test(pathBasename));
}

export function assertTrustedCandidateConfiguration(paths: readonly string[]) {
  const rejected = paths.find(isMergeGroupCiControlPath);
  if (rejected) {
    throw new MergeGroupCiDefinitionChangedError(
      `The candidate changes the trusted CI control surface: ${rejected}`,
    );
  }
}

function assertObjectId(name: string, value: string) {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new ExactShaValidationInputError(`${name} must be a full lowercase Git SHA`);
  }
}

function assertExecutionId(value: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(value)) {
    throw new ExactShaValidationInputError("executionId must be a stable lowercase identifier");
  }
}

function assertSourceRef(value: string) {
  if (
    !/^refs\/briar\/merge-group-validation\/[a-z0-9][a-z0-9._-]{0,100}$/u
      .test(value) || value.includes("..")
  ) {
    throw new ExactShaValidationInputError(
      "sourceRef must be a private Briar merge-group validation ref",
    );
  }
}

export type PreparedExactShaValidation = {
  executionId: string;
  baseSha: string;
  headSha: string;
  root: string;
  bundlePath: string;
  profilePath: string;
  localProfilePath: string;
  bunConfigPath: string;
};

export async function prepareExactShaValidation(
  git: GitRunner,
  repositoryPath: string,
  input: {
    executionId: string;
    sourceRef: string;
    baseSha: string;
    headSha: string;
  },
): Promise<PreparedExactShaValidation> {
  assertExecutionId(input.executionId);
  assertSourceRef(input.sourceRef);
  assertObjectId("baseSha", input.baseSha);
  assertObjectId("headSha", input.headSha);

  const sourceHead = git([
    "rev-parse",
    "--verify",
    `${input.sourceRef}^{commit}`,
  ], { cwd: repositoryPath });
  if (sourceHead.exitCode !== 0 || sourceHead.stdout.trim() !== input.headSha) {
    throw new ExactShaValidationInputError(
      "The local validation ref does not resolve to the expected exact SHA",
    );
  }
  const baseExists = git(["cat-file", "-e", `${input.baseSha}^{commit}`], {
    cwd: repositoryPath,
  });
  const descendsFromBase = git([
    "merge-base",
    "--is-ancestor",
    input.baseSha,
    input.headSha,
  ], { cwd: repositoryPath });
  if (baseExists.exitCode !== 0 || descendsFromBase.exitCode !== 0) {
    throw new ExactShaValidationInputError(
      "The exact candidate SHA does not descend from the trusted base SHA",
    );
  }

  const changedPaths = git([
    "diff",
    "--name-only",
    "-z",
    input.baseSha,
    input.headSha,
    "--",
  ], { cwd: repositoryPath });
  if (changedPaths.exitCode !== 0) {
    throw new MergeGroupCiInfrastructureError(
      `Candidate path inspection failed: ${changedPaths.stderr.trim()}`,
    );
  }
  assertTrustedCandidateConfiguration(
    changedPaths.stdout.split("\0").filter(Boolean),
  );

  const root = await mkdtemp(join(tmpdir(), "briar-merge-group-ci."));
  await chmod(root, 0o700);
  try {
    const trustedPaths = new Map<string, string>();
    for (const [repositoryPathname, filename] of MERGE_GROUP_CI_TRUSTED_FILES) {
      const source = git(["show", `${input.baseSha}:${repositoryPathname}`], {
        cwd: repositoryPath,
      });
      if (source.exitCode !== 0 || source.stdout.length === 0) {
        throw new MergeGroupCiInfrastructureError(
          `Trusted base file could not be loaded: ${repositoryPathname}`,
        );
      }
      const destination = join(root, filename);
      await writeFile(destination, source.stdout, { mode: 0o444 });
      trustedPaths.set(repositoryPathname, destination);
    }

    const bundlePath = join(root, "repository.bundle");
    const bundled = git([
      "bundle",
      "create",
      bundlePath,
      input.sourceRef,
    ], { cwd: repositoryPath, timeoutMs: 120_000 });
    if (bundled.exitCode !== 0) {
      throw new MergeGroupCiInfrastructureError(
        `Exact repository bundle failed: ${bundled.stderr.trim()}`,
      );
    }
    await chmod(bundlePath, 0o444);
    const bundleHeads = git(["bundle", "list-heads", bundlePath], {
      cwd: repositoryPath,
    });
    const containsExactHead = bundleHeads.exitCode === 0 &&
      bundleHeads.stdout.split("\n").some((line) =>
        line === `${input.headSha} ${input.sourceRef}`
      );
    if (!containsExactHead) {
      throw new MergeGroupCiInfrastructureError(
        "The credential-free bundle did not preserve the exact validation ref",
      );
    }

    return {
      executionId: input.executionId,
      baseSha: input.baseSha,
      headSha: input.headSha,
      root,
      bundlePath,
      profilePath: trustedPaths.get(MERGE_GROUP_CI_PROFILE_PATH)!,
      localProfilePath: trustedPaths.get(MERGE_GROUP_CI_LOCAL_PROFILE_PATH)!,
      bunConfigPath: trustedPaths.get(MERGE_GROUP_CI_BUN_CONFIG_PATH)!,
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function disposeExactShaValidation(
  prepared: PreparedExactShaValidation,
) {
  const root = resolve(prepared.root);
  if (
    dirname(root) !== resolve(tmpdir()) ||
    !basename(root).startsWith("briar-merge-group-ci.")
  ) {
    throw new Error("Refusing to remove an unexpected validation directory");
  }
  await rm(root, { recursive: true, force: true });
}

export type MergeGroupContainerRuntime = {
  executable: string;
  image: string;
};

export type MergeGroupImagePolicy = {
  repository: string;
  manifestDigest: string | null;
  published: boolean;
  enabled: boolean;
};

export function resolveMergeGroupContainerRuntime(
  policy: MergeGroupImagePolicy,
  which: (command: string) => string | null = (command) => Bun.which(command),
  inspect: (executable: string, image: string) => boolean = (executable, image) => {
    const result = spawnSync(executable, [
      "image",
      "inspect",
      "--format",
      '{{.Config.User}} {{index .Config.Labels "io.briar.merge-group-ci.protocol"}}',
      image,
    ], {
      encoding: "utf8",
      env: {
        HOME: tmpdir(),
        PATH: "/usr/local/bin:/usr/bin:/bin",
        TMPDIR: tmpdir(),
      },
      shell: false,
      timeout: 10_000,
    });
    return result.status === 0 &&
      result.stdout.trim() === `65532:65532 ${MERGE_GROUP_CI_PROTOCOL}`;
  },
): { ready: false; detail: string } | ({ ready: true } & MergeGroupContainerRuntime) {
  if (!policy.published || !policy.enabled || policy.manifestDigest === null) {
    return { ready: false, detail: "The audited OCI image is not published and enabled" };
  }
  if (
    policy.repository !== MERGE_GROUP_CI_IMAGE_REPOSITORY ||
    !/^sha256:[0-9a-f]{64}$/u.test(policy.manifestDigest)
  ) {
    return { ready: false, detail: "The OCI image policy is not immutable" };
  }
  const executable = which("docker");
  if (!executable) return { ready: false, detail: "Docker is not installed" };
  const image = `${policy.repository}@${policy.manifestDigest}`;
  if (!inspect(executable, image)) {
    return { ready: false, detail: "The audited OCI image is not installed locally" };
  }
  return { ready: true, executable, image };
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

function assertMountPath(path: string) {
  if (path.includes(",") || path.includes("\n") || path.includes("\r")) {
    throw new ExactShaValidationInputError("OCI mount path contains an unsafe character");
  }
}

export function mergeGroupDockerArguments(input: {
  prepared: PreparedExactShaValidation;
  runtime: MergeGroupContainerRuntime;
  context: MergeGroupCiContext;
  containerName: string;
  cidFile: string;
}) {
  if (!/^[a-z0-9][a-z0-9._/-]*[a-z0-9-]@sha256:[0-9a-f]{64}$/u
    .test(input.runtime.image)) {
    throw new ExactShaValidationInputError("OCI image must use an immutable digest");
  }
  if (!/^briar-merge-group-[a-z0-9-]{1,100}$/u.test(input.containerName)) {
    throw new ExactShaValidationInputError("OCI container name is invalid");
  }
  for (const path of [
    input.prepared.bundlePath,
    input.prepared.profilePath,
    input.prepared.localProfilePath,
    input.prepared.bunConfigPath,
    input.cidFile,
  ]) assertMountPath(path);

  return [
    "run",
    `--name=${input.containerName}`,
    `--cidfile=${input.cidFile}`,
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=65532:65532",
    `--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=${MERGE_GROUP_CI_CONTAINER_LIMITS.tmp},uid=65532,gid=65532`,
    `--tmpfs=/scratch:rw,nosuid,nodev,size=${MERGE_GROUP_CI_CONTAINER_LIMITS.scratch},uid=65532,gid=65532`,
    `--memory=${MERGE_GROUP_CI_CONTAINER_LIMITS.memory}`,
    `--memory-swap=${MERGE_GROUP_CI_CONTAINER_LIMITS.memory}`,
    `--cpus=${MERGE_GROUP_CI_CONTAINER_LIMITS.cpus}`,
    `--pids-limit=${MERGE_GROUP_CI_CONTAINER_LIMITS.pids}`,
    "--ulimit=nofile=4096:4096",
    "--ulimit=core=0:0",
    `--mount=type=bind,src=${input.prepared.bundlePath},dst=/opt/briar/repository.bundle,readonly`,
    `--mount=type=bind,src=${input.prepared.profilePath},dst=/opt/briar/ci-merge-group.sh,readonly`,
    `--mount=type=bind,src=${input.prepared.localProfilePath},dst=/opt/briar/ci-local.sh,readonly`,
    `--mount=type=bind,src=${input.prepared.bunConfigPath},dst=/opt/briar/bunfig.toml,readonly`,
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
    `--env=BRIAR_CI_HEAD_SHA=${input.prepared.headSha}`,
    input.runtime.image,
    "/bin/bash",
    "/opt/briar/ci-merge-group.sh",
    input.context,
  ];
}

export type MergeGroupContextResult = {
  context: MergeGroupCiContext;
  passed: boolean;
  exitCode: number;
  failureCode: "ci_failed" | "output_limit" | null;
  log: string;
  logSha256: string;
  logTruncated: boolean;
};

function dockerEnvironment(root: string) {
  return {
    HOME: root,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: root,
  };
}

function removeContainer(
  runtime: MergeGroupContainerRuntime,
  name: string,
  root: string,
) {
  return spawnSync(runtime.executable, ["rm", "-f", name], {
    encoding: "utf8",
    env: dockerEnvironment(root),
    shell: false,
    timeout: 30_000,
  });
}

function containerExists(
  runtime: MergeGroupContainerRuntime,
  name: string,
  root: string,
) {
  return spawnSync(runtime.executable, ["container", "inspect", name], {
    encoding: "utf8",
    env: dockerEnvironment(root),
    shell: false,
    timeout: 10_000,
  }).status === 0;
}

async function runMergeGroupContext(input: {
  prepared: PreparedExactShaValidation;
  runtime: MergeGroupContainerRuntime;
  context: MergeGroupCiContext;
  signal: AbortSignal;
  deadlineAt: number;
  killGraceMs: number;
}): Promise<MergeGroupContextResult> {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const safeExecutionId = input.prepared.executionId.slice(0, 40);
  const containerName =
    `briar-merge-group-${safeExecutionId}-${input.context}-${nonce}`;
  const cidFile = join(input.prepared.root, `${containerName}.cid`);
  const args = mergeGroupDockerArguments({
    prepared: input.prepared,
    runtime: input.runtime,
    context: input.context,
    containerName,
    cidFile,
  });
  const remaining = input.deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new MergeGroupCiInfrastructureError("Exact-SHA validation deadline expired");
  }
  if (input.signal.aborted) throw input.signal.reason;

  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  let outputBytes = 0;
  let logTruncated = false;
  let child: ChildProcess | null = null;
  let stop: "external" | "deadline" | "output" | null = null;
  let primaryError: unknown;
  let result: MergeGroupContextResult | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const requestStop = (reason: typeof stop) => {
    if (stop !== null) return;
    stop = reason;
    if (child) terminateProcessGroup(child, "SIGTERM");
    removeContainer(input.runtime, containerName, input.prepared.root);
    killTimer = setTimeout(() => {
      if (child) terminateProcessGroup(child, "SIGKILL");
      removeContainer(input.runtime, containerName, input.prepared.root);
    }, input.killGraceMs);
  };
  const onAbort = () => requestStop("external");
  const capture = (chunk: Buffer) => {
    const allowed = Math.max(0, MERGE_GROUP_CI_MAX_OUTPUT_BYTES - outputBytes);
    const bounded = chunk.subarray(0, allowed);
    outputBytes += chunk.length;
    if (bounded.length > 0) hash.update(bounded);
    const retain = Math.max(0, MERGE_GROUP_CI_RETAINED_LOG_BYTES - retainedBytes);
    if (retain > 0) {
      const retained = bounded.subarray(0, retain);
      chunks.push(retained);
      retainedBytes += retained.length;
    }
    if (
      outputBytes > MERGE_GROUP_CI_RETAINED_LOG_BYTES ||
      bounded.length !== chunk.length
    ) logTruncated = true;
    if (outputBytes > MERGE_GROUP_CI_MAX_OUTPUT_BYTES) requestStop("output");
  };

  input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    deadlineTimer = setTimeout(() => requestStop("deadline"), remaining);
    child = spawn(input.runtime.executable, args, {
      cwd: input.prepared.root,
      detached: process.platform !== "win32",
      env: dockerEnvironment(input.prepared.root),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    if (input.signal.aborted) requestStop("external");
    const runningChild = child;
    const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
      runningChild.once("error", rejectExit);
      runningChild.once("close", (code, signal) => {
        if (signal && stop === null) {
          rejectExit(new MergeGroupCiInfrastructureError(
            `OCI validation process stopped by ${signal}`,
          ));
          return;
        }
        resolveExit(code ?? 1);
      });
    });

    if (stop === "external") throw input.signal.reason;
    if (stop === "deadline") {
      throw new MergeGroupCiInfrastructureError(
        `Exact-SHA validation exceeded ${Math.ceil(remaining / 1000)} seconds`,
      );
    }
    const log = Buffer.concat(chunks).toString("utf8") || "(no container output)";
    if (stop === "output") {
      result = {
        context: input.context,
        passed: false,
        exitCode: 1,
        failureCode: "output_limit",
        log,
        logSha256: hash.digest("hex"),
        logTruncated: true,
      };
    } else if ([75, 125, 126, 127, 137].includes(exitCode)) {
      throw new MergeGroupCiInfrastructureError(
        `Isolated ${input.context} validation failed as infrastructure (${exitCode})`,
      );
    } else {
      result = {
        context: input.context,
        passed: exitCode === 0,
        exitCode,
        failureCode: exitCode === 0 ? null : "ci_failed",
        log,
        logSha256: hash.digest("hex"),
        logTruncated,
      };
    }
  } catch (error) {
    primaryError = error;
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (killTimer) clearTimeout(killTimer);
    const hadContainer = existsSync(cidFile);
    const removed = removeContainer(input.runtime, containerName, input.prepared.root);
    const stillExists = containerExists(
      input.runtime,
      containerName,
      input.prepared.root,
    );
    const cleanupFailed = stillExists || (hadContainer && removed.status !== 0);
    if (cleanupFailed) {
      const cleanupError = new MergeGroupCiInfrastructureError(
        `OCI container cleanup was not acknowledged for ${input.context}`,
      );
      primaryError = primaryError === undefined
        ? cleanupError
        : new AggregateError([primaryError, cleanupError],
          "Exact-SHA validation and container cleanup both failed");
    }
  }

  if (primaryError !== undefined) throw primaryError;
  return result!;
}

export async function runFixedMergeGroupValidation(input: {
  prepared: PreparedExactShaValidation;
  runtime: MergeGroupContainerRuntime;
  signal: AbortSignal;
  deadlineMs?: number;
  killGraceMs?: number;
}): Promise<MergeGroupContextResult[]> {
  const deadlineMs = input.deadlineMs ?? MERGE_GROUP_CI_DEFAULT_DEADLINE_MS;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1_000 ||
    deadlineMs > MERGE_GROUP_CI_MAX_DEADLINE_MS) {
    throw new ExactShaValidationInputError(
      `deadlineMs must be between 1000 and ${MERGE_GROUP_CI_MAX_DEADLINE_MS}`,
    );
  }
  const deadlineAt = Date.now() + deadlineMs;
  const controller = new AbortController();
  const onAbort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", onAbort, { once: true });
  if (input.signal.aborted) controller.abort(input.signal.reason);

  const results = new Array<MergeGroupContextResult>(MERGE_GROUP_CI_CONTEXTS.length);
  let cursor = 0;
  let firstError: unknown;
  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = cursor++;
      if (index >= MERGE_GROUP_CI_CONTEXTS.length) return;
      try {
        results[index] = await runMergeGroupContext({
          prepared: input.prepared,
          runtime: input.runtime,
          context: MERGE_GROUP_CI_CONTEXTS[index],
          signal: controller.signal,
          deadlineAt,
          killGraceMs: input.killGraceMs ?? 5_000,
        });
      } catch (error) {
        if (firstError === undefined) firstError = error;
        if (!controller.signal.aborted) controller.abort(error);
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: MERGE_GROUP_CI_CONTEXT_CONCURRENCY }, worker),
    );
  } finally {
    input.signal.removeEventListener("abort", onAbort);
  }
  if (firstError !== undefined) throw firstError;
  if (controller.signal.aborted) throw controller.signal.reason;
  return results;
}
