import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const defaultComputerUseBrowserProfilesDirectory =
  "/var/lib/briar-computer-use/profiles";

export const defaultComputerUseSharedBrowserProfileDirectory =
  "/var/lib/briar-computer-use/profiles/shared";

/**
 * Every Computer Use display runs Chrome with its own `--user-data-dir`, and
 * that directory is deleted when the display is released. Only the entries
 * below travel through the shared store, so a login survives the release
 * without carrying caches, sessions, or extensions between Agents.
 */
export const computerUseSharedLoginSqliteEntries = [
  "Default/Network/Cookies",
  "Default/Cookies",
  "Default/Login Data",
  "Default/Login Data For Account",
  "Default/Web Data",
] as const;

export const computerUseSharedLoginDirectoryEntries = [
  "Default/Local Storage",
  "Default/IndexedDB",
] as const;

/** SQLite entries merged row by row instead of replaced as whole files. */
export const computerUseSharedLoginCookieEntries = [
  "Default/Network/Cookies",
  "Default/Cookies",
] as const;

const sqliteSidecarSuffixes = ["-journal", "-wal", "-shm"] as const;

const temporarySuffixPattern = /\.(?:tmp|old)-\d+$/u;

export const computerUseBrowserProfileDirectory = (
  displayIndex: number,
  profilesDirectory = defaultComputerUseBrowserProfilesDirectory,
): string => {
  if (!Number.isInteger(displayIndex) || displayIndex < 2 || displayIndex > 100) {
    throw new Error("Computer Use display index must be between 2 and 100");
  }
  return join(profilesDirectory, `display-${displayIndex}`);
};

export interface ComputerUseBrowserLoginStoreReport {
  readonly merged: string[];
  readonly replaced: string[];
  readonly copied: string[];
  readonly skipped: { entry: string; reason: string }[];
}

export interface ComputerUseBrowserLoginStore {
  /** Copy the shared login state into a display profile before Chrome starts. */
  seed(displayIndex: number): Promise<ComputerUseBrowserLoginStoreReport>;
  /** Fold a display profile's login state back into the shared store. */
  capture(displayIndex: number): Promise<ComputerUseBrowserLoginStoreReport>;
}

export interface FileComputerUseBrowserLoginStoreOptions {
  readonly sharedDirectory?: string;
  readonly profilesDirectory?: string;
  readonly log?: (message: string) => void;
}

const emptyReport = (): ComputerUseBrowserLoginStoreReport => ({
  merged: [],
  replaced: [],
  copied: [],
  skipped: [],
});

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

class CookieMergeUnsupportedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CookieMergeUnsupportedError";
  }
}

const tableColumns = (database: DatabaseSync, schema: string): string[] =>
  database.prepare(`PRAGMA ${schema}.table_info('cookies')`)
    .all()
    .map((row) => String((row as { name: unknown }).name));

const metaVersion = (database: DatabaseSync, schema: string): string => {
  const row = database
    .prepare(`SELECT value FROM ${schema}.meta WHERE key = 'version'`)
    .get() as { value?: unknown } | undefined;
  if (row === undefined || row.value === undefined || row.value === null) {
    throw new CookieMergeUnsupportedError(`${schema} cookie database has no meta.version`);
  }
  return String(row.value);
};

const uniqueIndexColumns = (database: DatabaseSync, schema: string): string[] => {
  const indexes = database.prepare(`PRAGMA ${schema}.index_list('cookies')`).all() as {
    name?: unknown;
    unique?: unknown;
    partial?: unknown;
  }[];
  for (const index of indexes) {
    if (Number(index.unique) !== 1 || Number(index.partial ?? 0) !== 0) continue;
    const name = String(index.name);
    const columns = database
      .prepare(`PRAGMA ${schema}.index_info(${quoteIdentifier(name)})`)
      .all()
      .map((row) => (row as { name: unknown }).name);
    if (columns.length === 0 || columns.some((column) => column === null)) continue;
    return columns.map((column) => String(column));
  }
  throw new CookieMergeUnsupportedError(
    `${schema} cookie database has no usable unique index on cookies`,
  );
};

/**
 * Fold the display profile's cookies into the shared store row by row. Two
 * Agents releasing their displays at once must not drop each other's fresh
 * logins, so a whole-file replacement is only the fallback.
 */
const mergeCookieDatabase = (sharedPath: string, displayPath: string): void => {
  const database = new DatabaseSync(sharedPath);
  let attached = false;
  try {
    database.prepare("ATTACH DATABASE ? AS src").run(displayPath);
    attached = true;
    const target = tableColumns(database, "main");
    const source = tableColumns(database, "src");
    if (target.length === 0 || source.length === 0) {
      throw new CookieMergeUnsupportedError("cookie database has no cookies table");
    }
    if (target.length !== source.length || target.some((name, at) => name !== source[at])) {
      throw new CookieMergeUnsupportedError("cookie databases have different columns");
    }
    if (!target.includes("last_update_utc")) {
      throw new CookieMergeUnsupportedError("cookie database has no last_update_utc column");
    }
    if (metaVersion(database, "main") !== metaVersion(database, "src")) {
      throw new CookieMergeUnsupportedError("cookie databases have different meta.version");
    }
    const condition = uniqueIndexColumns(database, "main")
      .map((column) => `s.${quoteIdentifier(column)} IS d.${quoteIdentifier(column)}`)
      .join(" AND ");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(
        `INSERT OR REPLACE INTO main.cookies SELECT s.* FROM src.cookies s`
          + ` LEFT JOIN main.cookies d ON ${condition}`
          + ` WHERE d.rowid IS NULL OR s.last_update_utc >= d.last_update_utc`,
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    if (attached) {
      try {
        database.exec("DETACH DATABASE src");
      } catch {
        // The database is closed right after; a failed detach is not fatal.
      }
    }
    database.close();
  }
};

export class FileComputerUseBrowserLoginStore implements ComputerUseBrowserLoginStore {
  private readonly sharedDirectory: string;
  private readonly profilesDirectory: string;
  private readonly log: (message: string) => void;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FileComputerUseBrowserLoginStoreOptions = {}) {
    this.sharedDirectory = options.sharedDirectory
      ?? defaultComputerUseSharedBrowserProfileDirectory;
    this.profilesDirectory = options.profilesDirectory
      ?? defaultComputerUseBrowserProfilesDirectory;
    this.log = options.log
      ?? ((message) => console.warn(`[computer-use-login-store] ${message}`));
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private displayDirectory(displayIndex: number): string {
    return computerUseBrowserProfileDirectory(displayIndex, this.profilesDirectory);
  }

  /** Drop half-written entries a crashed capture may have left behind. */
  private async purgeTemporaryEntries(): Promise<void> {
    const parents = new Set(
      [
        ...computerUseSharedLoginSqliteEntries,
        ...computerUseSharedLoginDirectoryEntries,
      ].map((entry) => dirname(entry)),
    );
    for (const parent of parents) {
      const directory = join(this.sharedDirectory, parent);
      let names: string[];
      try {
        names = await readdir(directory);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!temporarySuffixPattern.test(name)) continue;
        await rm(join(directory, name), { recursive: true, force: true });
      }
    }
  }

  private async copySqliteFile(source: string, target: string): Promise<void> {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${process.pid}`;
    await copyFile(source, temporary);
    await rename(temporary, target);
    for (const suffix of sqliteSidecarSuffixes) {
      const sidecar = `${source}${suffix}`;
      if (await pathExists(sidecar)) {
        const sidecarTemporary = `${target}${suffix}.tmp-${process.pid}`;
        await copyFile(sidecar, sidecarTemporary);
        await rename(sidecarTemporary, `${target}${suffix}`);
      } else {
        // A stale journal from the replaced database would corrupt the copy.
        await rm(`${target}${suffix}`, { force: true });
      }
    }
  }

  private async replaceDirectory(source: string, target: string): Promise<void> {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${process.pid}`;
    await rm(temporary, { recursive: true, force: true });
    await cp(source, temporary, { recursive: true });
    const previous = `${target}.old-${process.pid}`;
    const existed = await pathExists(target);
    if (existed) await rename(target, previous);
    try {
      await rename(temporary, target);
    } catch (error) {
      if (existed) await rename(previous, target);
      throw error;
    }
    if (existed) await rm(previous, { recursive: true, force: true });
  }

  seed(displayIndex: number): Promise<ComputerUseBrowserLoginStoreReport> {
    return this.runExclusive(async () => {
      const report = emptyReport();
      const displayDirectory = this.displayDirectory(displayIndex);
      if (await pathExists(displayDirectory)) {
        report.skipped.push({
          entry: `display-${displayIndex}`,
          reason: "display profile already exists",
        });
        return report;
      }
      if (!(await pathExists(this.sharedDirectory))) {
        report.skipped.push({
          entry: `display-${displayIndex}`,
          reason: "shared login store does not exist",
        });
        return report;
      }
      const staging = `${displayDirectory}.seed-${process.pid}`;
      try {
        await this.purgeTemporaryEntries();
        await rm(staging, { recursive: true, force: true });
        await mkdir(staging, { recursive: true, mode: 0o700 });
        for (const entry of computerUseSharedLoginSqliteEntries) {
          const source = join(this.sharedDirectory, entry);
          if (!(await pathExists(source))) continue;
          const target = join(staging, entry);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await copyFile(source, target);
          for (const suffix of sqliteSidecarSuffixes) {
            if (await pathExists(`${source}${suffix}`)) {
              await copyFile(`${source}${suffix}`, `${target}${suffix}`);
            }
          }
          report.copied.push(entry);
        }
        for (const entry of computerUseSharedLoginDirectoryEntries) {
          const source = join(this.sharedDirectory, entry);
          if (!(await pathExists(source))) continue;
          const target = join(staging, entry);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await cp(source, target, { recursive: true });
          report.copied.push(entry);
        }
        await chmod(staging, 0o700);
        await rename(staging, displayDirectory);
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        this.log(`seed display-${displayIndex} failed: ${describe(error)}`);
        const failure = emptyReport();
        failure.skipped.push({
          entry: `display-${displayIndex}`,
          reason: describe(error),
        });
        return failure;
      }
      this.log(`seed display-${displayIndex} copied ${report.copied.length} entries`);
      return report;
    });
  }

  capture(displayIndex: number): Promise<ComputerUseBrowserLoginStoreReport> {
    return this.runExclusive(async () => {
      const report = emptyReport();
      const displayDirectory = this.displayDirectory(displayIndex);
      if (!(await pathExists(displayDirectory))) return report;
      try {
        await mkdir(this.sharedDirectory, { recursive: true, mode: 0o700 });
        await chmod(this.sharedDirectory, 0o700);
        await this.purgeTemporaryEntries();
      } catch (error) {
        report.skipped.push({
          entry: `display-${displayIndex}`,
          reason: describe(error),
        });
        this.log(`capture display-${displayIndex} failed: ${describe(error)}`);
        return report;
      }
      for (const entry of computerUseSharedLoginSqliteEntries) {
        const source = join(displayDirectory, entry);
        const target = join(this.sharedDirectory, entry);
        try {
          if (!(await pathExists(source))) continue;
          const targetExists = await pathExists(target);
          const isCookieDatabase = (
            computerUseSharedLoginCookieEntries as readonly string[]
          ).includes(entry);
          if (isCookieDatabase && targetExists) {
            try {
              mergeCookieDatabase(target, source);
              report.merged.push(entry);
              continue;
            } catch (error) {
              this.log(
                `capture display-${displayIndex} ${entry} merge fell back to replacement: `
                  + describe(error),
              );
            }
          }
          await this.copySqliteFile(source, target);
          (targetExists ? report.replaced : report.copied).push(entry);
        } catch (error) {
          report.skipped.push({ entry, reason: describe(error) });
        }
      }
      for (const entry of computerUseSharedLoginDirectoryEntries) {
        const source = join(displayDirectory, entry);
        const target = join(this.sharedDirectory, entry);
        try {
          if (!(await pathExists(source))) continue;
          const targetExists = await pathExists(target);
          await this.replaceDirectory(source, target);
          (targetExists ? report.replaced : report.copied).push(entry);
        } catch (error) {
          report.skipped.push({ entry, reason: describe(error) });
        }
      }
      this.log(
        `capture display-${displayIndex} merged ${report.merged.length},`
          + ` replaced ${report.replaced.length}, copied ${report.copied.length},`
          + ` skipped ${report.skipped.length}`,
      );
      return report;
    });
  }
}
