export type GitCommandRunner = (
  args: ReadonlyArray<string>,
  cwd: string,
) => Promise<{ readonly exitCode: number; readonly stdout: string }>;

const runGit: GitCommandRunner = async (args, cwd) => {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { exitCode, stdout: stdout.trim() };
};

async function requiredGit(
  runner: GitCommandRunner,
  cwd: string,
  args: ReadonlyArray<string>,
  failure: string,
) {
  const result = await runner(args, cwd);
  if (result.exitCode !== 0) throw new Error(failure);
  return result.stdout.trim();
}

export async function verifyProductionGitTarget(
  cwd = process.cwd(),
  runner: GitCommandRunner = runGit,
) {
  const status = await requiredGit(
    runner,
    cwd,
    ["status", "--porcelain", "--untracked-files=all"],
    "Could not inspect the Worker deployment worktree.",
  );
  if (status) {
    throw new Error("Worker deployment requires a clean worktree.");
  }

  await requiredGit(
    runner,
    cwd,
    ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"],
    "Could not fetch origin/main before Worker deployment.",
  );
  const head = await requiredGit(
    runner,
    cwd,
    ["rev-parse", "HEAD"],
    "Could not resolve the Worker deployment commit.",
  );
  const main = await requiredGit(
    runner,
    cwd,
    ["rev-parse", "refs/remotes/origin/main"],
    "Could not resolve origin/main before Worker deployment.",
  );
  if (head !== main) {
    throw new Error(
      `Worker deployment must run from the exact origin/main commit (${main}); HEAD is ${head}.`,
    );
  }
  if (!/^[0-9a-f]{40}$/u.test(head)) {
    throw new Error("Worker deployment resolved an invalid Git commit SHA.");
  }
  return head;
}
