import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type {
  ProjectGitHubCredential,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import { gitValueAt } from "./command-support";

/**
 * Headless repository bootstrap shared by the managed-computer guided setup
 * and the Docker sandbox bootstrap. Both receive a short-lived project GitHub
 * credential from the Worker and must end up with a verified clone whose
 * future fetches go through `briar github credential`.
 */

export function abortError() {
  const error = new Error("Repository bootstrap was cancelled");
  error.name = "AbortError";
  return error;
}

export function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

export async function runSimpleCommand(
  binary: string,
  args: string[],
  signal: AbortSignal,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const child = spawn(binary, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const exited = new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  try {
    const code = await Promise.race([exited, waitForAbort(signal)]);
    if (code !== 0) throw new Error(`${binary} command failed`);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

export async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return false;
    throw error;
  }
}

export function githubRepositoryFromRemote(remote: string) {
  const normalized = remote.trim().replace(/\.git$/u, "");
  const https = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/iu);
  if (https) return https[1]!.toLowerCase();
  const ssh = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/iu);
  return ssh?.[1]?.toLowerCase() ?? null;
}

/**
 * Resolve the workspace root that holds every bootstrapped project clone.
 * `BRIAR_MANAGED_WORKSPACE_ROOT` stays honoured so managed computers keep
 * their existing layout; the sandbox uses the same default under `$HOME`.
 */
export function bootstrapWorkspaceRoot(
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
) {
  const configured = environment.BRIAR_MANAGED_WORKSPACE_ROOT?.trim();
  const workspaceRoot = configured || join(home, "Briar", "projects");
  if (!isAbsolute(workspaceRoot)) {
    throw new Error("Managed workspace root must be absolute");
  }
  return workspaceRoot;
}

export async function ensureRepository(
  credential: ProjectGitHubCredential,
  signal: AbortSignal,
  workspaceRoot = bootstrapWorkspaceRoot(),
) {
  const repository = credential.repository;
  if (
    credential.projectId.length === 0 ||
    credential.organizationId.length === 0 ||
    credential.repositoryId <= 0n ||
    credential.cloneUrl !== `https://github.com/${repository}.git`
  ) {
    throw new Error("Managed repository credential identity is invalid");
  }
  const expiresAt = credential.expiresAt
    ? timestampDate(credential.expiresAt)
    : null;
  if (!expiresAt || expiresAt.getTime() <= Date.now() + 30_000) {
    throw new Error("Managed repository credential expired; restart setup to retry");
  }
  const repositoryName = repository.split("/")[1]!;
  const projectRoot = join(
    workspaceRoot,
    credential.organizationId,
    credential.projectId,
  );
  const repositoryPath = join(projectRoot, repositoryName);
  await mkdir(projectRoot, { recursive: true, mode: 0o700 });
  if (await pathExists(repositoryPath)) {
    const root = gitValueAt(repositoryPath, ["rev-parse", "--show-toplevel"]);
    const remote = gitValueAt(repositoryPath, ["remote", "get-url", "origin"]);
    if (
      !root || resolve(root) !== resolve(repositoryPath) || !remote ||
      githubRepositoryFromRemote(remote) !== repository.toLowerCase()
    ) {
      throw new Error("Managed project directory contains a different repository");
    }
    const marker = gitValueAt(repositoryPath, [
      "config",
      "--local",
      "--get",
      "briar.githubRepositoryId",
    ]);
    if (marker && marker !== String(credential.repositoryId)) {
      throw new Error("Managed clone has a different GitHub repository ID");
    }
  }
  const credentialDirectory = await mkdtemp(join(tmpdir(), "briar-git-"));
  const askpass = join(credentialDirectory, "askpass.sh");
  let cloneStagingDirectory: string | null = null;
  try {
    await writeFile(
      askpass,
      "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' \"$BRIAR_GIT_USERNAME\" ;;\n  *) printf '%s\\n' \"$BRIAR_GIT_PASSWORD\" ;;\nesac\n",
      { mode: 0o700 },
    );
    await chmod(askpass, 0o700);
    const env = {
      ...process.env,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      BRIAR_GIT_USERNAME: credential.username,
      BRIAR_GIT_PASSWORD: credential.password,
    };
    if (await pathExists(repositoryPath)) {
      await runSimpleCommand(
        "git",
        ["-c", "credential.helper=", "ls-remote", "--exit-code", credential.cloneUrl, "HEAD"],
        signal,
        { cwd: repositoryPath, env },
      );
    } else {
      cloneStagingDirectory = await mkdtemp(join(projectRoot, ".briar-clone-"));
      const checkout = join(cloneStagingDirectory, "repository");
      await runSimpleCommand(
        "git",
        ["-c", "credential.helper=", "clone", "--origin", "origin", "--", credential.cloneUrl, checkout],
        signal,
        { env },
      );
      await rename(checkout, repositoryPath);
    }
  } finally {
    await rm(credentialDirectory, { recursive: true, force: true });
    if (cloneStagingDirectory) {
      await rm(cloneStagingDirectory, { recursive: true, force: true });
    }
  }
  await runSimpleCommand(
    "git",
    ["config", "--local", "briar.githubRepositoryId", String(credential.repositoryId)],
    signal,
    { cwd: repositoryPath },
  );
  await runSimpleCommand(
    "git",
    ["config", "--local", "credential.useHttpPath", "true"],
    signal,
    { cwd: repositoryPath },
  );
  await runSimpleCommand(
    "git",
    ["config", "--local", "credential.https://github.com.helper", "!\"${BRIAR_CLI:-briar}\" github credential"],
    signal,
    { cwd: repositoryPath },
  );
  return repositoryPath;
}
