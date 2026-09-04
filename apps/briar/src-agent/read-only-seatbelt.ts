import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function seatbeltString(value: string) {
  return JSON.stringify(value);
}

function canonicalSeatbeltPath(value: string) {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

export const providerInstructionSeatbeltPattern =
  "/(?:AGENT|AGENTS|Agents|CLAUDE|Claude)[.]md$";

export function readOnlySeatbeltProfile(input: {
  workspaceRoot: string;
  stateRoot: string;
  executablePaths: string[];
  /**
   * Individual files outside the state root the provider still has to read,
   * such as a credential file named by an absolute path in the environment.
   * Each is granted on its own, never as a directory subtree.
   */
  readablePaths?: string[];
  deniedPathPatterns?: string[];
}) {
  const workspaceRoot = canonicalSeatbeltPath(input.workspaceRoot);
  const stateRoot = canonicalSeatbeltPath(input.stateRoot);
  const stateRelativeToWorkspace = relative(workspaceRoot, stateRoot);
  if (
    stateRelativeToWorkspace === "" ||
    (!stateRelativeToWorkspace.startsWith("..") &&
      !isAbsolute(stateRelativeToWorkspace))
  ) {
    throw new Error("Provider sandbox state must be outside the repository");
  }
  const executablePaths = Array.from(
    new Set(input.executablePaths.map(canonicalSeatbeltPath)),
  );
  const readablePaths = Array.from(
    new Set((input.readablePaths ?? []).map(canonicalSeatbeltPath)),
  );
  return [
    "(version 1)",
    "(deny default)",
    // Apple's baseline grants runtime/framework access without granting the
    // current user's home or arbitrary files under /private.
    '(import "system.sb")',
    "(allow process*)",
    "(allow signal (target self))",
    // The provider transport needs its model API. Model shell/web tools remain
    // disabled by the provider-specific read-only permission policy.
    "(allow network*)",
    "(allow file-read-metadata",
    `  (path-ancestors ${seatbeltString(workspaceRoot)})`,
    `  (path-ancestors ${seatbeltString(stateRoot)})`,
    ...executablePaths.map(
      (path) => `  (path-ancestors ${seatbeltString(path)})`,
    ),
    ...readablePaths.map(
      (path) => `  (path-ancestors ${seatbeltString(path)})`,
    ),
    ")",
    "(allow file-read*",
    '  (subpath "/usr/bin")',
    '  (subpath "/bin")',
    `  (subpath ${seatbeltString(workspaceRoot)})`,
    `  (subpath ${seatbeltString(stateRoot)})`,
    ...executablePaths.map((path) => `  (literal ${seatbeltString(path)})`),
    ...readablePaths.map((path) => `  (literal ${seatbeltString(path)})`),
    ")",
    "(allow file-write*",
    '  (literal "/dev/null")',
    `  (subpath ${seatbeltString(stateRoot)})`,
    ")",
    ...(input.deniedPathPatterns ?? []).map(
      (pattern) =>
        `(deny file-read* (regex #${seatbeltString(pattern)}))`,
    ),
    "",
  ].join("\n");
}

export function readOnlySeatbeltSpawnSpec(input: {
  providerName: string;
  binary: string;
  arguments: string[];
  workspaceRoot: string;
  stateRoot: string;
  readOnly: boolean;
  readablePaths?: string[];
  deniedPathPatterns?: string[];
  platform?: NodeJS.Platform;
}) {
  if (!input.readOnly) {
    return { command: input.binary, arguments: input.arguments };
  }
  if ((input.platform ?? process.platform) !== "darwin") {
    throw new Error(
      `Read-only ${input.providerName} conversations require the macOS OS sandbox`,
    );
  }
  const sandboxBinary = "/usr/bin/sandbox-exec";
  if (!existsSync(sandboxBinary)) {
    throw new Error("The macOS sandbox executable is unavailable");
  }
  if (!isAbsolute(input.stateRoot)) {
    throw new Error(`${input.providerName} read-only state is not isolated`);
  }
  const realBinary = realpathSync(input.binary);
  const profile = readOnlySeatbeltProfile({
    workspaceRoot: input.workspaceRoot,
    stateRoot: input.stateRoot,
    executablePaths: [input.binary, realBinary],
    readablePaths: input.readablePaths,
    deniedPathPatterns: input.deniedPathPatterns,
  });
  return {
    command: sandboxBinary,
    arguments: ["-p", profile, realBinary, ...input.arguments],
  };
}
