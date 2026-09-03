#!/usr/bin/env bun

const runInherited = async (command: readonly string[]) => {
  const child = Bun.spawn([...command], {
    cwd: import.meta.dir + "/..",
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
};

const startedAt = performance.now();
const installExitCode = await runInherited([
  "bun",
  "install",
  "--frozen-lockfile",
]);
if (installExitCode !== 0) {
  process.exitCode = installExitCode;
} else {
  const installSeconds = Math.max(
    0,
    Math.round((performance.now() - startedAt) / 1_000),
  );
  const { runCiMain } = await import("./ci-local");
  runCiMain(installSeconds);
}
