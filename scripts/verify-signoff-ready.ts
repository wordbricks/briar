import { execFileSync } from "node:child_process";

export interface SignoffTarget {
  baseSha: string;
  head: string;
  pushBranch: string;
  upstream: string;
}

export type SignoffGitRunner = (
  args: readonly string[],
  cwd: string,
) => string;

const runGit: SignoffGitRunner = (args, cwd) => {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
};

export function verifySignoffReady(
  cwd = process.cwd(),
  git: SignoffGitRunner = runGit,
): SignoffTarget {
  if (git(["status", "--porcelain"], cwd) !== "") {
    throw new Error("repository has uncommitted changes; commit them before signoff");
  }

  let upstream: string;
  try {
    upstream = git(["rev-parse", "--abbrev-ref", "@{push}"], cwd);
  } catch {
    throw new Error("current branch is not tracking a remote branch");
  }

  const upstreamMatch = /^origin\/(.+)$/u.exec(upstream);
  if (!upstreamMatch?.[1]) {
    throw new Error(`signoff requires an origin push branch; found ${upstream}`);
  }
  const pushBranch = upstreamMatch[1];

  const head = git(["rev-parse", "HEAD"], cwd);
  let remoteOutput: string;
  try {
    remoteOutput = git([
      "ls-remote",
      "--exit-code",
      "origin",
      "refs/heads/main",
      `refs/heads/${pushBranch}`,
    ], cwd);
  } catch {
    throw new Error("could not resolve origin/main and the remote push branch");
  }
  const remoteRefs = new Map(remoteOutput.split("\n").map((line) => {
    const [sha = "", reference = ""] = line.split(/\s+/u);
    return [reference, sha] as const;
  }));
  const baseSha = remoteRefs.get("refs/heads/main");
  const pushedHead = remoteRefs.get(`refs/heads/${pushBranch}`);
  if (!baseSha) {
    throw new Error("origin/main does not exist");
  }
  if (head !== pushedHead) {
    throw new Error(`HEAD does not match ${upstream}; push the exact commit before signoff`);
  }

  return { baseSha, head, pushBranch, upstream };
}

export function verifySignoffTargetUnchanged(
  expected: SignoffTarget,
  cwd = process.cwd(),
  git: SignoffGitRunner = runGit,
): SignoffTarget {
  const current = verifySignoffReady(cwd, git);
  if (current.head !== expected.head) {
    throw new Error(`signoff HEAD moved from ${expected.head} to ${current.head}`);
  }
  if (current.pushBranch !== expected.pushBranch) {
    throw new Error(
      `signoff push branch moved from ${expected.pushBranch} to ${current.pushBranch}`,
    );
  }
  if (current.baseSha !== expected.baseSha) {
    throw new Error(
      `origin/main moved from ${expected.baseSha} to ${current.baseSha}; restart signoff on the new base`,
    );
  }
  return current;
}

if (import.meta.main) {
  try {
    const target = verifySignoffReady();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(target));
    } else {
      console.log(
        `[signoff-preflight] ${target.head} is clean, pushed to ${target.upstream}, and based on origin/main ${target.baseSha}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[signoff-preflight] ${message}`);
    process.exit(1);
  }
}
