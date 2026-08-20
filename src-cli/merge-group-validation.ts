import { spawn, type ChildProcess } from "node:child_process";
import * as Schema from "effect/Schema";
import {
  MERGE_GROUP_STATUS_CONTEXTS,
  MERGE_GROUP_VALIDATION_COMMAND,
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

const GitObjectSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const GitHubRefResponse = Schema.Struct({
  object: Schema.Struct({ sha: GitObjectSha }),
});
const decodeGitHubRefResponse = Schema.decodeUnknownSync(GitHubRefResponse);

const parseJson = (source: string, label: string): unknown => {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} response was not valid JSON`);
  }
};

export function assertLiveMergeGroupRef(
  command: CommandRunner,
  job: Pick<ClaimedMergeGroupValidation, "repository" | "headRef" | "headSha">,
) {
  const response = command([
    "gh",
    "api",
    `repos/${job.repository}/git/ref/${job.headRef.replace(/^refs\//u, "")}`,
  ]);
  if (response.exitCode !== 0) {
    throw new StaleMergeGroupError(
      "GitHub merge-group ref is no longer the live queue head",
    );
  }
  const live = decodeGitHubRefResponse(
    parseJson(response.stdout, "GitHub merge-group ref"),
  );
  if (live.object.sha !== job.headSha) {
    throw new StaleMergeGroupError(
      "GitHub merge-group ref changed to a different SHA",
    );
  }
}

export function fetchExactMergeGroupHead(
  git: GitRunner,
  repositoryPath: string,
  job: Pick<
    ClaimedMergeGroupValidation,
    "workId" | "headRef" | "headSha" | "baseSha"
  >,
) {
  const localRef = `refs/briar/merge-group-validation/${job.workId}`;
  const fetched = git([
    "-c",
    "maintenance.auto=false",
    "fetch",
    "--no-tags",
    "origin",
    `+${job.headRef}:${localRef}`,
  ], { cwd: repositoryPath, timeoutMs: 120_000 });
  if (fetched.exitCode !== 0) {
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

export function publishMergeGroupStatus(
  command: CommandRunner,
  input: {
    repository: string;
    headSha: string;
    context: (typeof MERGE_GROUP_STATUS_CONTEXTS)[number];
    passed: boolean;
  },
) {
  const response = command([
    "gh",
    "api",
    "--method",
    "POST",
    `repos/${input.repository}/statuses/${input.headSha}`,
    "-f",
    `state=${input.passed ? "success" : "failure"}`,
    "-f",
    `context=${input.context}`,
    "-f",
    `description=Briar merge-group validation ${input.passed ? "passed" : "failed"}`,
  ]);
  if (response.exitCode !== 0) {
    throw new Error(`Exact-SHA status ${input.context} could not be published`);
  }
}

const validationEnvironmentKeys = [
  "HOME",
  "PATH",
  "TMPDIR",
  "USER",
  "LANG",
  "LC_ALL",
  "CARGO_HOME",
  "RUSTUP_HOME",
] as const;

export function mergeGroupValidationEnvironment(
  source: NodeJS.ProcessEnv = process.env,
) {
  const environment: NodeJS.ProcessEnv = {
    CI: "true",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
  };
  for (const key of validationEnvironmentKeys) {
    if (source[key]) environment[key] = source[key];
  }
  return environment;
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
  cwd: string,
  signal: AbortSignal,
): Promise<number> {
  if (signal.aborted) throw signal.reason ?? new Error("Validation aborted");
  const [executable, ...args] = MERGE_GROUP_VALIDATION_COMMAND;
  const child = spawn(executable, args, {
    cwd,
    detached: process.platform !== "win32",
    env: mergeGroupValidationEnvironment(),
    stdio: "inherit",
    shell: false,
  });
  let forcedKillTimer: ReturnType<typeof setTimeout> | null = null;
  const abort = () => {
    terminateProcessGroup(child, "SIGTERM");
    forcedKillTimer = setTimeout(() => {
      terminateProcessGroup(child, "SIGKILL");
    }, 5_000);
    forcedKillTimer.unref();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, childSignal) => {
        if (signal.aborted) {
          reject(signal.reason ?? new Error("Validation aborted"));
          return;
        }
        if (childSignal) {
          reject(new Error(`Validation process stopped by ${childSignal}`));
          return;
        }
        resolve(code ?? 1);
      });
    });
  } finally {
    signal.removeEventListener("abort", abort);
    if (forcedKillTimer) clearTimeout(forcedKillTimer);
  }
}

export { MERGE_GROUP_STATUS_CONTEXTS, MERGE_GROUP_VALIDATION_COMMAND };
