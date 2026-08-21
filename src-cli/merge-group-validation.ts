import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import checkedInImagePolicy from "../config/merge-group-ci-image.json";
import {
  MERGE_GROUP_CI_AUDITED_IMAGE,
  MERGE_GROUP_CI_BUN_CONFIG_PATH,
  MERGE_GROUP_CI_CONTAINER_LIMITS,
  MERGE_GROUP_CI_CONTEXT_CONCURRENCY,
  MERGE_GROUP_CI_CONTEXTS,
  MERGE_GROUP_CI_DEFAULT_DEADLINE_MS,
  MERGE_GROUP_CI_IMAGE_REPOSITORY,
  MERGE_GROUP_CI_LOCAL_PROFILE_PATH,
  MERGE_GROUP_CI_MAX_DEADLINE_MS,
  MERGE_GROUP_CI_MAX_OUTPUT_BYTES,
  MERGE_GROUP_CI_PHASES,
  MERGE_GROUP_CI_PROTECTED_BASE_REF_PREFIX,
  MERGE_GROUP_CI_PROFILE_PATH,
  MERGE_GROUP_CI_PROTOCOL,
  MERGE_GROUP_CI_RETAINED_LOG_BYTES,
  MERGE_GROUP_CI_SOURCE_REF_PREFIX,
  MERGE_GROUP_CI_TRUSTED_FILES,
  type MergeGroupCiContext,
  type MergeGroupCiPhase,
} from "../src/lib/merge-group-validation-contract";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GitRunner = (
  command: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    /** Complete child environment; implementations must not merge process.env. */
    env: Readonly<Record<string, string>>;
  },
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
  /^(?:babel|postcss|tailwind|eslint|prettier)\.config\.[^/]+$/u,
  /^\.(?:babel|postcss|eslint|prettier)rc(?:\.[^/]+)?$/u,
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

function assertExecutionRef(
  name: "sourceRef" | "protectedBaseRef",
  value: string,
  expectedPrefix: string,
  executionId: string,
) {
  const expected = `${expectedPrefix}/${executionId}`;
  if (value !== expected) {
    throw new ExactShaValidationInputError(
      `${name} must be the private ref bound to this execution`,
    );
  }
}

const GIT_TIMEOUT_MS = 30_000;

function sanitizedGitEnvironment(root: string) {
  return {
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    HOME: root,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    XDG_CONFIG_HOME: root,
  } as const;
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
    protectedBaseRef: string;
    baseSha: string;
    headSha: string;
  },
): Promise<PreparedExactShaValidation> {
  assertExecutionId(input.executionId);
  assertExecutionRef(
    "sourceRef",
    input.sourceRef,
    MERGE_GROUP_CI_SOURCE_REF_PREFIX,
    input.executionId,
  );
  assertExecutionRef(
    "protectedBaseRef",
    input.protectedBaseRef,
    MERGE_GROUP_CI_PROTECTED_BASE_REF_PREFIX,
    input.executionId,
  );
  assertObjectId("baseSha", input.baseSha);
  assertObjectId("headSha", input.headSha);
  if (input.baseSha === input.headSha) {
    throw new ExactShaValidationInputError(
      "The protected base SHA and candidate SHA must be distinct",
    );
  }

  const root = await mkdtemp(join(tmpdir(), "briar-merge-group-ci."));
  try {
    await chmod(root, 0o700);
    const env = sanitizedGitEnvironment(root);
    const runGit = (
      command: string[],
      cwd: string,
      timeoutMs = GIT_TIMEOUT_MS,
    ) =>
      git(["--no-replace-objects", ...command], {
        cwd,
        env,
        timeoutMs,
      });
    const quarantinePath = join(root, "repository.git");
    const initialized = runGit(["init", "--bare", quarantinePath], root);
    if (initialized.exitCode !== 0) {
      throw new MergeGroupCiInfrastructureError(
        `Git quarantine initialization failed: ${initialized.stderr.trim()}`,
      );
    }
    const fetched = runGit([
      "fetch",
      "--no-tags",
      "--force",
      resolve(repositoryPath),
      `+${input.protectedBaseRef}:${input.protectedBaseRef}`,
      `+${input.sourceRef}:${input.sourceRef}`,
    ], quarantinePath, 120_000);
    if (fetched.exitCode !== 0) {
      throw new MergeGroupCiInfrastructureError(
        `Exact refs could not be copied into Git quarantine: ${fetched.stderr.trim()}`,
      );
    }
    const checkedObjects = runGit(
      ["fsck", "--strict", "--no-dangling"],
      quarantinePath,
      120_000,
    );
    if (checkedObjects.exitCode !== 0) {
      throw new MergeGroupCiInfrastructureError(
        `Git quarantine object verification failed: ${checkedObjects.stderr.trim()}`,
      );
    }

    const protectedBase = runGit([
      "rev-parse",
      "--verify",
      `${input.protectedBaseRef}^{commit}`,
    ], quarantinePath);
    if (
      protectedBase.exitCode !== 0 ||
      protectedBase.stdout.trim() !== input.baseSha
    ) {
      throw new ExactShaValidationInputError(
        "The protected base ref does not resolve to the expected exact SHA",
      );
    }
    const sourceHead = runGit([
      "rev-parse",
      "--verify",
      `${input.sourceRef}^{commit}`,
    ], quarantinePath);
    if (sourceHead.exitCode !== 0 || sourceHead.stdout.trim() !== input.headSha) {
      throw new ExactShaValidationInputError(
        "The local validation ref does not resolve to the expected exact SHA",
      );
    }
    const descendsFromBase = runGit([
      "merge-base",
      "--is-ancestor",
      input.baseSha,
      input.headSha,
    ], quarantinePath);
    if (descendsFromBase.exitCode !== 0) {
      throw new ExactShaValidationInputError(
        "The exact candidate SHA does not descend from the protected base SHA",
      );
    }

    const changedPaths = runGit([
      "diff",
      "--name-only",
      "-z",
      input.baseSha,
      input.headSha,
      "--",
    ], quarantinePath);
    if (changedPaths.exitCode !== 0) {
      throw new MergeGroupCiInfrastructureError(
        `Candidate path inspection failed: ${changedPaths.stderr.trim()}`,
      );
    }
    assertTrustedCandidateConfiguration(
      changedPaths.stdout.split("\0").filter(Boolean),
    );

    const trustedPaths = new Map<string, string>();
    for (const [repositoryPathname, filename] of MERGE_GROUP_CI_TRUSTED_FILES) {
      const source = runGit(
        ["show", `${input.baseSha}:${repositoryPathname}`],
        quarantinePath,
      );
      if (source.exitCode !== 0 || source.stdout.length === 0) {
        throw new MergeGroupCiInfrastructureError(
          `Trusted base file could not be loaded: ${repositoryPathname}`,
        );
      }
      const destination = join(root, filename);
      await writeFile(destination, source.stdout, {
        mode: filename.endsWith(".sh") ? 0o555 : 0o444,
      });
      trustedPaths.set(repositoryPathname, destination);
    }

    const bundlePath = join(root, "repository.bundle");
    const bundled = runGit([
      "bundle",
      "create",
      bundlePath,
      input.sourceRef,
    ], quarantinePath, 120_000);
    if (bundled.exitCode !== 0) {
      throw new MergeGroupCiInfrastructureError(
        `Exact repository bundle failed: ${bundled.stderr.trim()}`,
      );
    }
    await chmod(bundlePath, 0o444);
    const bundleHeads = runGit(
      ["bundle", "list-heads", bundlePath],
      quarantinePath,
    );
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
  schemaVersion: number;
  protocol: number;
  repository: string;
  manifestDigest: string | null;
  platforms: string[];
  verification: {
    independentBuilds: number;
    matchingManifestDigests: boolean;
    verifiedAt: string | null;
  };
  rollout: {
    published: boolean;
    enabled: boolean;
  };
};

export function isAuditedMergeGroupImagePolicy(
  policy: MergeGroupImagePolicy,
  auditedDigest: string | null,
) {
  return auditedDigest !== null &&
    policy.schemaVersion === 1 &&
    policy.protocol === MERGE_GROUP_CI_PROTOCOL &&
    policy.repository === MERGE_GROUP_CI_IMAGE_REPOSITORY &&
    policy.manifestDigest === auditedDigest &&
    /^sha256:[0-9a-f]{64}$/u.test(auditedDigest) &&
    policy.platforms.length > 0 &&
    policy.platforms.every((platform) => /^linux\/(?:amd64|arm64)$/u.test(platform)) &&
    Number.isInteger(policy.verification.independentBuilds) &&
    policy.verification.independentBuilds >= 2 &&
    policy.verification.matchingManifestDigests &&
    policy.verification.verifiedAt !== null &&
    !Number.isNaN(Date.parse(policy.verification.verifiedAt)) &&
    policy.rollout.published &&
    policy.rollout.enabled;
}

export function resolveMergeGroupContainerRuntime(
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
  const policy = checkedInImagePolicy as MergeGroupImagePolicy;
  if (!isAuditedMergeGroupImagePolicy(policy, MERGE_GROUP_CI_AUDITED_IMAGE)) {
    return {
      ready: false,
      detail: "The checked-in OCI image is not independently audited and enabled",
    };
  }
  const executable = which("docker");
  if (!executable) return { ready: false, detail: "Docker is not installed" };
  const image = `${policy.repository}@${policy.manifestDigest!}`;
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
  phase: MergeGroupCiPhase;
  containerName: string;
  cidFile: string;
  deadlineSeconds: number;
  deadlineUnix: number;
}) {
  if (!/^[a-z0-9][a-z0-9._/-]*[a-z0-9-]@sha256:[0-9a-f]{64}$/u
    .test(input.runtime.image)) {
    throw new ExactShaValidationInputError("OCI image must use an immutable digest");
  }
  if (!/^briar-merge-group-[a-z0-9-]{1,100}$/u.test(input.containerName)) {
    throw new ExactShaValidationInputError("OCI container name is invalid");
  }
  if (!(MERGE_GROUP_CI_PHASES[input.context] as readonly string[]).includes(input.phase)) {
    throw new ExactShaValidationInputError("OCI validation phase does not match its context");
  }
  if (
    !Number.isInteger(input.deadlineSeconds) || input.deadlineSeconds < 1 ||
    input.deadlineSeconds > Math.ceil(MERGE_GROUP_CI_MAX_DEADLINE_MS / 1_000) ||
    !Number.isInteger(input.deadlineUnix) || input.deadlineUnix < 1
  ) {
    throw new ExactShaValidationInputError("OCI validation deadline is invalid");
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
    "--rm",
    "--init",
    `--name=${input.containerName}`,
    `--cidfile=${input.cidFile}`,
    "--stop-timeout=5",
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
    `--label=io.briar.merge-group-ci.protocol=${MERGE_GROUP_CI_PROTOCOL}`,
    `--label=io.briar.merge-group-ci.execution=${input.prepared.executionId}`,
    `--label=io.briar.merge-group-ci.context=${input.context}`,
    `--label=io.briar.merge-group-ci.phase=${input.phase}`,
    `--label=io.briar.merge-group-ci.deadline-unix=${input.deadlineUnix}`,
    `--mount=type=bind,src=${input.prepared.bundlePath},dst=/opt/briar/repository.bundle,readonly`,
    `--mount=type=bind,src=${input.prepared.profilePath},dst=/opt/briar/ci-merge-group.sh,readonly`,
    `--mount=type=bind,src=${input.prepared.profilePath},dst=/opt/briar/trusted-bin/bun,readonly`,
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
    "/usr/bin/timeout",
    "--signal=TERM",
    "--kill-after=5s",
    `${input.deadlineSeconds}s`,
    "/bin/bash",
    "/opt/briar/ci-merge-group.sh",
    input.context,
    input.phase,
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

type MergeGroupPhaseResult = Omit<MergeGroupContextResult, "context"> & {
  phase: MergeGroupCiPhase;
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
    timeout: 10_000,
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
    timeout: 5_000,
  }).status === 0;
}

async function runMergeGroupPhase(input: {
  prepared: PreparedExactShaValidation;
  runtime: MergeGroupContainerRuntime;
  context: MergeGroupCiContext;
  phase: MergeGroupCiPhase;
  signal: AbortSignal;
  deadlineAt: number;
  killGraceMs: number;
}): Promise<MergeGroupPhaseResult> {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const safeExecutionId = input.prepared.executionId.slice(0, 24);
  const containerName =
    `briar-merge-group-${safeExecutionId}-${input.context}-${input.phase}-${nonce}`;
  const cidFile = join(input.prepared.root, `${containerName}.cid`);
  const remaining = input.deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new MergeGroupCiInfrastructureError("Exact-SHA validation deadline expired");
  }
  if (input.signal.aborted) throw input.signal.reason;
  const args = mergeGroupDockerArguments({
    prepared: input.prepared,
    runtime: input.runtime,
    context: input.context,
    phase: input.phase,
    containerName,
    cidFile,
    deadlineSeconds: Math.max(1, Math.ceil(remaining / 1_000)),
    deadlineUnix: Math.ceil(input.deadlineAt / 1_000),
  });

  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  let outputBytes = 0;
  let logTruncated = false;
  let child: ChildProcess | null = null;
  let stop: "external" | "deadline" | "output" | null = null;
  let primaryError: unknown;
  let result: MergeGroupPhaseResult | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const requestStop = (reason: typeof stop) => {
    if (stop === null) stop = reason;
    if (child) terminateProcessGroup(child, "SIGTERM");
    if (!killTimer) {
      killTimer = setTimeout(() => {
        if (child) terminateProcessGroup(child, "SIGKILL");
        removeContainer(input.runtime, containerName, input.prepared.root);
      }, input.killGraceMs);
    }
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
        phase: input.phase,
        passed: false,
        exitCode: 1,
        failureCode: "output_limit",
        log,
        logSha256: hash.digest("hex"),
        logTruncated: true,
      };
    } else if ([75, 124, 125, 126, 127].includes(exitCode)) {
      throw new MergeGroupCiInfrastructureError(
        `Isolated ${input.phase} validation failed as infrastructure (${exitCode})`,
      );
    } else {
      result = {
        phase: input.phase,
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
    removeContainer(input.runtime, containerName, input.prepared.root);
    const stillExists = containerExists(
      input.runtime,
      containerName,
      input.prepared.root,
    );
    if (stillExists) {
      const cleanupError = new MergeGroupCiInfrastructureError(
        `OCI container cleanup was not acknowledged for ${input.phase}`,
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

async function runMergeGroupContext(input: {
  prepared: PreparedExactShaValidation;
  runtime: MergeGroupContainerRuntime;
  context: MergeGroupCiContext;
  signal: AbortSignal;
  deadlineAt: number;
  killGraceMs: number;
}): Promise<MergeGroupContextResult> {
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  let logTruncated = false;

  for (const phase of MERGE_GROUP_CI_PHASES[input.context]) {
    const phaseResult = await runMergeGroupPhase({
      ...input,
      phase,
    });
    hash.update(phase);
    hash.update("\0");
    hash.update(phaseResult.logSha256);
    hash.update("\0");
    hash.update(String(phaseResult.exitCode));
    hash.update("\n");

    const phaseLog = Buffer.from(`[${phase}]\n${phaseResult.log}\n`);
    const retain = Math.max(0, MERGE_GROUP_CI_RETAINED_LOG_BYTES - retainedBytes);
    if (retain > 0) {
      const retained = phaseLog.subarray(0, retain);
      chunks.push(retained);
      retainedBytes += retained.length;
    }
    if (phaseLog.length > retain || phaseResult.logTruncated) logTruncated = true;

    if (!phaseResult.passed) {
      return {
        context: input.context,
        passed: false,
        exitCode: phaseResult.exitCode,
        failureCode: phaseResult.failureCode,
        log: Buffer.concat(chunks).toString("utf8"),
        logSha256: hash.digest("hex"),
        logTruncated,
      };
    }
  }

  return {
    context: input.context,
    passed: true,
    exitCode: 0,
    failureCode: null,
    log: Buffer.concat(chunks).toString("utf8") || "(no container output)",
    logSha256: hash.digest("hex"),
    logTruncated,
  };
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
  const killGraceMs = input.killGraceMs ?? 5_000;
  if (!Number.isInteger(killGraceMs) || killGraceMs < 10 || killGraceMs > 30_000) {
    throw new ExactShaValidationInputError(
      "killGraceMs must be between 10 and 30000",
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
          killGraceMs,
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
