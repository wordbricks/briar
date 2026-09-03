import { execFileSync } from "node:child_process";

export interface SignoffTarget {
  head: string;
  upstream: string;
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function verifySignoffReady(cwd = process.cwd()): SignoffTarget {
  if (git(["status", "--porcelain"], cwd) !== "") {
    throw new Error("repository has uncommitted changes; commit them before signoff");
  }

  let upstream: string;
  try {
    upstream = git(["rev-parse", "--abbrev-ref", "@{push}"], cwd);
  } catch {
    throw new Error("current branch is not tracking a remote branch");
  }

  const head = git(["rev-parse", "HEAD"], cwd);
  const pushedHead = git(["rev-parse", "@{push}"], cwd);
  if (head !== pushedHead) {
    throw new Error(`HEAD does not match ${upstream}; push the exact commit before signoff`);
  }

  return { head, upstream };
}

if (import.meta.main) {
  try {
    const target = verifySignoffReady();
    console.log(`[signoff-preflight] ${target.head} is clean and pushed to ${target.upstream}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[signoff-preflight] ${message}`);
    process.exit(1);
  }
}
