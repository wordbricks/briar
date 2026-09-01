import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { backfillRemoteArchiveStorage } from "./backfill-archive-storage";

export interface WranglerResult {
  exitCode: number;
  stdout: string;
}

export type WranglerRunner = (
  args: string[],
  captureOutput?: boolean,
) => Promise<WranglerResult>;

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;

async function runWrangler(
  args: string[],
  captureOutput = false,
): Promise<WranglerResult> {
  const processHandle = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: captureOutput ? "pipe" : "inherit",
    stderr: "inherit",
  });

  if (!captureOutput) {
    return { exitCode: await processHandle.exited, stdout: "" };
  }

  const [stdout, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    processHandle.exited,
  ]);
  return { exitCode, stdout };
}

function leadingMigrationNumber(name: string): number {
  return Number.parseInt(name.split("_")[0] ?? "", 10);
}

export function compareMigrationNames(left: string, right: string): number {
  const leftNumber = leadingMigrationNumber(left);
  const rightNumber = leadingMigrationNumber(right);
  if (leftNumber !== rightNumber) {
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    if (Number.isFinite(leftNumber)) return -1;
    if (Number.isFinite(rightNumber)) return 1;
  }
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function parseAppliedMigrationNames(output: string): Set<string> {
  const response = JSON.parse(output) as Array<{
    results?: Array<{ name?: unknown }>;
    success?: boolean;
  }>;
  if (!Array.isArray(response) || response.some((result) => !result.success)) {
    throw new Error("Could not read the remote D1 migration history.");
  }

  return new Set(
    response.flatMap((result) =>
      (result.results ?? []).flatMap((row) =>
        typeof row.name === "string" ? [row.name] : []
      )
    ),
  );
}

export function buildMigrationImport(
  migrationSql: string,
  migrationName: string,
): string {
  const escapedName = migrationName.replaceAll("'", "''");
  return `${migrationSql.trimEnd()}\n\nINSERT INTO d1_migrations (name) VALUES ('${escapedName}');\n`;
}

async function readAppliedMigrations(
  runner: WranglerRunner,
  database: string,
): Promise<{ exitCode: number; names: Set<string> }> {
  const history = await runner(
    [
      "d1",
      "execute",
      database,
      "--remote",
      "--command",
      "SELECT name FROM d1_migrations ORDER BY id;",
      "--json",
    ],
    true,
  );
  if (history.exitCode !== 0) {
    return { exitCode: history.exitCode, names: new Set() };
  }
  return {
    exitCode: 0,
    names: parseAppliedMigrationNames(history.stdout),
  };
}

export async function applyRemoteD1Migrations({
  database = "briar-db",
  migrationsDirectory = join(process.cwd(), "migrations"),
  runner = runWrangler,
  beforeMigration,
}: {
  database?: string;
  migrationsDirectory?: string;
  runner?: WranglerRunner;
  beforeMigration?: (migrationName: string) => Promise<number>;
} = {}): Promise<number> {
  const initialize = await runner([
    "d1",
    "execute",
    database,
    "--remote",
    "--command",
    MIGRATIONS_TABLE_SQL,
    "--yes",
  ]);
  if (initialize.exitCode !== 0) return initialize.exitCode;

  const history = await readAppliedMigrations(runner, database);
  if (history.exitCode !== 0) return history.exitCode;

  const appliedMigrations = history.names;
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort(compareMigrationNames);
  const pendingMigrations = migrationNames.filter(
    (name) => !appliedMigrations.has(name),
  );

  if (pendingMigrations.length === 0) {
    console.log("No remote D1 migrations to apply.");
    return 0;
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "briar-d1-migrations-"),
  );
  try {
    for (const migrationName of pendingMigrations) {
      if (beforeMigration) {
        const preflightExitCode = await beforeMigration(migrationName);
        if (preflightExitCode !== 0) return preflightExitCode;
      }
      const migrationPath = join(migrationsDirectory, migrationName);
      const migrationSql = await readFile(migrationPath, "utf8");
      const importPath = join(temporaryDirectory, basename(migrationName));
      await writeFile(
        importPath,
        buildMigrationImport(migrationSql, migrationName),
        { mode: 0o600 },
      );

      console.log(`Applying remote D1 migration ${migrationName}...`);
      const result = await runner([
        "d1",
        "execute",
        database,
        "--remote",
        "--file",
        importPath,
        "--yes",
      ]);
      if (result.exitCode !== 0) {
        // Wrangler can lose the final import polling race after D1 has already
        // committed the file. The history INSERT is the last statement in the
        // same atomic import, so its presence proves the migration completed.
        const refreshedHistory = await readAppliedMigrations(runner, database);
        if (!refreshedHistory.names.has(migrationName)) {
          return result.exitCode;
        }
        console.warn(
          `Remote D1 migration ${migrationName} was committed despite a failed final import poll.`,
        );
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return 0;
}

async function main(): Promise<void> {
  const exitCode = await applyRemoteD1Migrations({
    beforeMigration: (migrationName) =>
      migrationName.endsWith("_canonical_archive_storage.sql")
        ? backfillRemoteArchiveStorage()
        : Promise.resolve(0),
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

if (import.meta.main) await main();
