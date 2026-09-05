import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  args,
  cliVersion,
  has,
  value,
} from "./command-support";
import {
  type ComputerUseBrowserLoginStoreReport,
  computerUsePrimaryBrowserProfileDirectory,
  computerUseSharedLoginDirectoryEntries,
  computerUseSharedLoginSqliteEntries,
  copyComputerUseLoginEntries,
  defaultComputerUseBrowserProfilesDirectory,
  FileComputerUseBrowserLoginStore,
  snapshotComputerUseLoginEntries,
} from "./computer-use-browser-login-store";

/**
 * Move the shared browser login store between computers.
 *
 * Replacing a managed computer with a new AMI leaves the owner with an empty
 * `/var/lib/briar-computer-use`: the in-place upgrade path keeps the root
 * volume, but a replacement does not. These two commands move only the browser
 * login state the owner consented to move — never the Worker credential,
 * repository clones, or provider authentication.
 */

export const COMPUTER_USE_LOGIN_STORE_SHARED_ROOT = "shared";
export const COMPUTER_USE_LOGIN_STORE_PRIMARY_ROOT = "display-1";
const archiveRoots = [
  COMPUTER_USE_LOGIN_STORE_SHARED_ROOT,
  COMPUTER_USE_LOGIN_STORE_PRIMARY_ROOT,
] as const;

const sqliteSidecarSuffixes = ["-journal", "-wal", "-shm"] as const;

export const defaultLoginStoreTarBinary = "/usr/bin/tar";

/** Resolves the command's stdout, rejects when it exits non-zero. */
export type ComputerUseLoginStoreCommandRunner = (
  binary: string,
  commandArgs: readonly string[],
) => Promise<string>;

const defaultCommandRunner: ComputerUseLoginStoreCommandRunner = (binary, commandArgs) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(binary, [...commandArgs], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 4_000_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 16_384) stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(stdout);
      else {
        reject(new Error(
          `${basename(binary)} exited ${code ?? signal ?? "unknown"}${
            stderr.trim() === "" ? "" : `: ${stderr.trim()}`
          }`,
        ));
      }
    });
  });

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * True when an archive member belongs to the login state layout: a whitelist
 * entry (or one of its SQLite sidecars) under `shared/` or `display-1/`, or a
 * directory on the way to one.
 */
export const isComputerUseLoginStoreArchivePath = (member: string): boolean => {
  if (member.startsWith("/") || member.includes("\\")) return false;
  const normalized = member.replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (normalized === "" || normalized === ".") return true;
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  const [root, ...rest] = parts;
  if (root === undefined || !(archiveRoots as readonly string[]).includes(root)) return false;
  if (rest.length === 0) return true;
  const relative = rest.join("/");
  for (const entry of computerUseSharedLoginSqliteEntries) {
    if (entry === relative) return true;
    if (sqliteSidecarSuffixes.some((suffix) => `${entry}${suffix}` === relative)) return true;
    if (entry.startsWith(`${relative}/`)) return true;
  }
  for (const entry of computerUseSharedLoginDirectoryEntries) {
    if (entry === relative || relative.startsWith(`${entry}/`)) return true;
    if (entry.startsWith(`${relative}/`)) return true;
  }
  return false;
};

export class ComputerUseLoginStoreArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerUseLoginStoreArchiveError";
  }
}

const assertArchiveMembers = (listing: string): void => {
  const members = listing.split("\n").map((line) => line.trim()).filter(Boolean);
  if (members.length === 0) {
    throw new ComputerUseLoginStoreArchiveError("The archive is empty");
  }
  for (const member of members) {
    if (!isComputerUseLoginStoreArchivePath(member)) {
      throw new ComputerUseLoginStoreArchiveError(
        `The archive contains ${member}, which is not browser login state`,
      );
    }
  }
};

/** Extraction can still produce a symlink or a device node; those are refused. */
const assertExtractedTree = async (root: string, prefix = ""): Promise<void> => {
  for (const name of await readdir(root)) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (!isComputerUseLoginStoreArchivePath(relative)) {
      throw new ComputerUseLoginStoreArchiveError(
        `The archive contains ${relative}, which is not browser login state`,
      );
    }
    const metadata = await lstat(join(root, name));
    if (metadata.isDirectory()) {
      await assertExtractedTree(join(root, name), relative);
      continue;
    }
    if (!metadata.isFile()) {
      throw new ComputerUseLoginStoreArchiveError(
        `The archive contains ${relative}, which is not a regular file`,
      );
    }
  }
};

export interface ComputerUseLoginStoreExportOptions {
  readonly outputPath: string;
  readonly profilesDirectory?: string;
  readonly force?: boolean;
  readonly tarBinary?: string;
  readonly runCommand?: ComputerUseLoginStoreCommandRunner;
  readonly log?: (message: string) => void;
}

export interface ComputerUseLoginStoreExportSummary {
  readonly archive: string;
  readonly shared: readonly string[];
  readonly primary: readonly string[];
  readonly skipped: readonly { entry: string; reason: string }[];
}

/**
 * Stage the whitelist from the shared store and the owner's display `:1` into
 * a temporary directory and hand it to `tar`. The owner's Chrome may be
 * running, so `display-1` goes through the snapshot path.
 */
export const exportComputerUseLoginStore = async (
  options: ComputerUseLoginStoreExportOptions,
): Promise<ComputerUseLoginStoreExportSummary> => {
  const outputPath = resolve(options.outputPath);
  const profilesDirectory = options.profilesDirectory
    ?? defaultComputerUseBrowserProfilesDirectory;
  const runCommand = options.runCommand ?? defaultCommandRunner;
  const log = options.log ?? (() => undefined);
  if (!options.force && await pathExists(outputPath)) {
    throw new Error(`${outputPath} already exists. Pass --force to overwrite it.`);
  }
  const sharedDirectory = join(profilesDirectory, COMPUTER_USE_LOGIN_STORE_SHARED_ROOT);
  const primaryDirectory = computerUsePrimaryBrowserProfileDirectory(profilesDirectory);
  const staging = await mkdtemp(join(tmpdir(), "briar-login-store-export-"));
  try {
    await chmod(staging, 0o700);
    const shared = await pathExists(sharedDirectory)
      ? await copyComputerUseLoginEntries(
        sharedDirectory,
        join(staging, COMPUTER_USE_LOGIN_STORE_SHARED_ROOT),
      )
      : undefined;
    const primary = await pathExists(primaryDirectory)
      ? await snapshotComputerUseLoginEntries(
        primaryDirectory,
        join(staging, COMPUTER_USE_LOGIN_STORE_PRIMARY_ROOT),
        { log },
      )
      : undefined;
    const staged = (shared?.copied.length ?? 0) + (primary?.copied.length ?? 0);
    if (staged === 0) {
      throw new Error(
        `No browser login state was found under ${profilesDirectory}`,
      );
    }
    await rm(outputPath, { force: true });
    await runCommand(options.tarBinary ?? defaultLoginStoreTarBinary, [
      "-C",
      staging,
      "-czf",
      outputPath,
      ".",
    ]);
    await chmod(outputPath, 0o600);
    return {
      archive: outputPath,
      shared: shared?.copied ?? [],
      primary: primary?.copied ?? [],
      skipped: [...(shared?.skipped ?? []), ...(primary?.skipped ?? [])],
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

export interface ComputerUseLoginStoreImportOptions {
  readonly archivePath: string;
  readonly profilesDirectory?: string;
  readonly tarBinary?: string;
  readonly runCommand?: ComputerUseLoginStoreCommandRunner;
  readonly log?: (message: string) => void;
}

export interface ComputerUseLoginStoreImportSummary {
  readonly archive: string;
  readonly merged: readonly string[];
  readonly replaced: readonly string[];
  readonly copied: readonly string[];
  readonly skipped: readonly { entry: string; reason: string }[];
}

/**
 * Fold an exported archive into this computer's shared store through the same
 * capture path a released display uses: cookies merge row by row, everything
 * else is replaced. The live `display-1` profile is never written to; its own
 * watcher keeps adding the owner's newer logins on top.
 */
export const importComputerUseLoginStore = async (
  options: ComputerUseLoginStoreImportOptions,
): Promise<ComputerUseLoginStoreImportSummary> => {
  const archivePath = resolve(options.archivePath);
  const profilesDirectory = options.profilesDirectory
    ?? defaultComputerUseBrowserProfilesDirectory;
  const runCommand = options.runCommand ?? defaultCommandRunner;
  const tarBinary = options.tarBinary ?? defaultLoginStoreTarBinary;
  const log = options.log ?? (() => undefined);
  if (!(await pathExists(archivePath))) {
    throw new Error(`${archivePath} does not exist`);
  }
  const staging = await mkdtemp(join(tmpdir(), "briar-login-store-import-"));
  try {
    await chmod(staging, 0o700);
    // Every member name is checked before anything is written to disk, so a
    // traversal or an unexpected path never reaches the store.
    assertArchiveMembers(await runCommand(tarBinary, ["-tzf", archivePath]));
    await runCommand(tarBinary, ["-xzf", archivePath, "-C", staging]);
    await assertExtractedTree(staging);
    const store = new FileComputerUseBrowserLoginStore({
      sharedDirectory: join(profilesDirectory, COMPUTER_USE_LOGIN_STORE_SHARED_ROOT),
      profilesDirectory,
      log,
    });
    const reports: ComputerUseBrowserLoginStoreReport[] = [];
    for (const root of archiveRoots) {
      const directory = join(staging, root);
      if (!(await pathExists(directory))) continue;
      reports.push(await store.captureLive(directory, { sqliteOnly: false }));
    }
    return {
      archive: archivePath,
      merged: reports.flatMap((report) => report.merged),
      replaced: reports.flatMap((report) => report.replaced),
      copied: reports.flatMap((report) => report.copied),
      skipped: reports.flatMap((report) => report.skipped),
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

const configuredProfilesDirectory = (): string | undefined => {
  const configured = value("--profiles-directory");
  if (configured === undefined) return undefined;
  if (!isAbsolute(configured)) {
    throw new Error("--profiles-directory must be an absolute path");
  }
  return configured;
};

const positionalArchivePath = (): string => {
  const rest = args.slice(args.indexOf("import") + 1);
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;
    if (argument === "--profiles-directory") {
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) continue;
    return argument;
  }
  throw new Error(
    "Usage: briar computer-use login-store import <archive.tar.gz> [--json]",
  );
};

export async function exportComputerUseLoginStoreCommand(): Promise<void> {
  const outputPath = value("--out");
  if (!outputPath) {
    throw new Error(
      "Usage: briar computer-use login-store export --out <archive.tar.gz> [--force] [--json]",
    );
  }
  const summary = await exportComputerUseLoginStore({
    outputPath,
    profilesDirectory: configuredProfilesDirectory(),
    force: has("--force"),
    log: (message) => console.error(`[login-store] ${message}`),
  });
  if (has("--json")) {
    console.log(JSON.stringify({ version: cliVersion, ...summary }, null, 2));
    return;
  }
  process.stdout.write(
    `Exported ${summary.shared.length + summary.primary.length} login entries to ${
      summary.archive
    }\n`,
  );
  for (const { entry, reason } of summary.skipped) {
    process.stdout.write(`  skipped ${entry}: ${reason}\n`);
  }
}

export async function importComputerUseLoginStoreCommand(): Promise<void> {
  const summary = await importComputerUseLoginStore({
    archivePath: positionalArchivePath(),
    profilesDirectory: configuredProfilesDirectory(),
    log: (message) => console.error(`[login-store] ${message}`),
  });
  if (has("--json")) {
    console.log(JSON.stringify({ version: cliVersion, ...summary }, null, 2));
    return;
  }
  process.stdout.write(
    `Imported ${summary.archive}: merged ${summary.merged.length}, replaced ${
      summary.replaced.length
    }, copied ${summary.copied.length}\n`,
  );
  for (const { entry, reason } of summary.skipped) {
    process.stdout.write(`  skipped ${entry}: ${reason}\n`);
  }
}
