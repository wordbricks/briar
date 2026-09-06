import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as Effect from "effect/Effect";
import { backfillRemoteArchiveStorage } from "./backfill-archive-storage";
import { verifyProductionGitTarget } from "./production-git-target";
import { withRemoteOperationLease } from "./remote-operation-lease";

export interface WranglerResult {
  exitCode: number;
  stdout: string;
}

export type WranglerRunner = (
  args: string[],
  captureOutput?: boolean,
  signal?: AbortSignal,
) => Promise<WranglerResult>;

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;

async function runWrangler(
  args: string[],
  captureOutput = false,
  signal?: AbortSignal,
): Promise<WranglerResult> {
  const processHandle = Bun.spawn(["wrangler", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: captureOutput ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const abortProcess = () => processHandle.kill();
  if (signal?.aborted) abortProcess();
  signal?.addEventListener("abort", abortProcess, { once: true });

  try {
    if (!captureOutput) {
      return { exitCode: await processHandle.exited, stdout: "" };
    }

    const [stdout, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      processHandle.exited,
    ]);
    return { exitCode, stdout };
  } finally {
    signal?.removeEventListener("abort", abortProcess);
  }
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

/**
 * Header line a squashed baseline carries, naming the last migration it stands
 * in for. Written by `scripts/generate-d1-baseline-migration.ts` on every part.
 */
export const BASELINE_MARKER = "-- baseline-through: ";

function baselineCutoff(migrationSql: string): string | null {
  const line = migrationSql
    .split("\n", 40)
    .find((entry) => entry.startsWith(BASELINE_MARKER));
  return line?.slice(BASELINE_MARKER.length).trim() || null;
}

/**
 * Whether a pending baseline is already in the database, in the shape of the
 * history it replaced.
 *
 * A baseline creates the tables, views, indexes and triggers of a database
 * migrated up to its cut-off. On a database that has already run that history
 * it must never execute: the tables exist, and its triggers and views are the
 * ones the cut-off had, which later migrations have since replaced. So a
 * database whose history reaches the cut-off records the baseline as applied
 * instead of running it. A fresh database has no such history, and runs it.
 */
export function baselineAlreadyApplied(
  migrationSql: string,
  appliedMigrations: ReadonlySet<string>,
): boolean {
  const cutoff = baselineCutoff(migrationSql);
  // The cut-off migration itself, not merely something below it: a database
  // that stopped partway through the squashed history has neither the schema
  // the baseline describes nor the files to reach it, and running the baseline
  // there fails loudly on the tables it already has. That is the right
  // outcome, so it is not recorded away.
  return cutoff !== null && appliedMigrations.has(cutoff);
}

const runRequiredMigrationPreflight = (
  migrationName: string,
  signal?: AbortSignal,
) =>
  migrationName.endsWith("_canonical_archive_storage.sql")
    ? backfillRemoteArchiveStorage(signal)
    : Promise.resolve(0);

async function readAppliedMigrations(
  runner: WranglerRunner,
  database: string,
  signal?: AbortSignal,
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
    signal,
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
  beforeMigration = runRequiredMigrationPreflight,
  importRetryDelayMillis = defaultImportRetryDelayMillis,
  signal,
}: {
  database?: string;
  migrationsDirectory?: string;
  runner?: WranglerRunner;
  beforeMigration?: (migrationName: string, signal?: AbortSignal) => Promise<number>;
  importRetryDelayMillis?: number;
  signal?: AbortSignal;
} = {}): Promise<number> {
  const initialize = await runner([
    "d1",
    "execute",
    database,
    "--remote",
    "--command",
    MIGRATIONS_TABLE_SQL,
    "--yes",
  ], false, signal);
  if (initialize.exitCode !== 0) return initialize.exitCode;

  const history = await readAppliedMigrations(runner, database, signal);
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
        const preflightExitCode = await beforeMigration(migrationName, signal);
        if (preflightExitCode !== 0) return preflightExitCode;
      }
      const migrationPath = join(migrationsDirectory, migrationName);
      const migrationSql = await readFile(migrationPath, "utf8");
      const importPath = join(temporaryDirectory, basename(migrationName));
      // A baseline squashes history this database may already hold, in which
      // case running it would recreate the cut-off's triggers and views over
      // the current ones. Record it instead, so the squash needs no manual
      // step against an existing database.
      const recordOnly = baselineAlreadyApplied(migrationSql, appliedMigrations);
      await writeFile(
        importPath,
        buildMigrationImport(recordOnly ? "" : migrationSql, migrationName),
        { mode: 0o600 },
      );

      console.log(
        recordOnly
          ? `Recording baseline ${migrationName} as applied; this database already holds the history it replaces.`
          : `Applying remote D1 migration ${migrationName}...`,
      );
      // The import endpoint can both lose its final poll after D1 has already
      // committed the file and return success while the server-side job never
      // commits. Only the history INSERT, the last statement of the atomic
      // import, proves the migration applied, so verify it after every import
      // and retry while the record is missing.
      const exitCode = await importWithVerification(
        runner,
        database,
        importPath,
        migrationName,
        importRetryDelayMillis,
        signal,
      );
      if (exitCode !== 0) return exitCode;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return 0;
}

const importVerificationAttempts = 3;

const defaultImportRetryDelayMillis = 5_000;

const readAppliedMigrationsWithRetry = async (
  runner: WranglerRunner,
  database: string,
  retryDelayMillis: number,
  signal?: AbortSignal,
): Promise<{ exitCode: number; names: Set<string> }> => {
  let history = await readAppliedMigrations(runner, database, signal);
  for (let attempt = 1; history.exitCode !== 0 && attempt < importVerificationAttempts; attempt++) {
    await delayMigrationRetry(retryDelayMillis, signal);
    history = await readAppliedMigrations(runner, database, signal);
  }
  return history;
};

const delayMigrationRetry = (delayMillis: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMillis);
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const makeAbortError = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new Error("aborted");

async function importWithVerification(
  runner: WranglerRunner,
  database: string,
  importPath: string,
  migrationName: string,
  retryDelayMillis: number,
  signal?: AbortSignal,
): Promise<number> {
  let lastExitCode = 0;
  for (let attempt = 1; attempt <= importVerificationAttempts; attempt++) {
    if (attempt > 1) {
      console.warn(
        `Remote D1 migration ${migrationName} was not recorded after import attempt ${attempt - 1}; retrying.`,
      );
      await delayMigrationRetry(retryDelayMillis, signal);
    }
    lastExitCode = (
      await runner([
        "d1",
        "execute",
        database,
        "--remote",
        "--file",
        importPath,
        "--yes",
      ], false, signal)
    ).exitCode;
    // Re-importing an already committed migration fails its trailing history
    // INSERT and rolls the duplicate back, so re-reading the history is what
    // distinguishes "committed despite a failed poll" from "never applied".
    const refreshedHistory = await readAppliedMigrationsWithRetry(
      runner,
      database,
      retryDelayMillis,
      signal,
    );
    if (refreshedHistory.names.has(migrationName)) {
      if (lastExitCode !== 0) {
        console.warn(
          `Remote D1 migration ${migrationName} was committed despite a failed final import poll.`,
        );
      }
      return 0;
    }
    if (lastExitCode !== 0) return lastExitCode;
  }
  return lastExitCode !== 0 ? lastExitCode : 1;
}

const main = Effect.fn("applyRemoteD1Migrations.main")(
  function* applyRemoteD1MigrationsMainEffect() {
    const headSha = yield* verifyProductionGitTarget();
    const exitCode = yield* withRemoteOperationLease({
      headSha,
      name: "worker-production",
      runner: runWrangler,
    }, (signal) => applyRemoteD1Migrations({ signal }));
    if (exitCode !== 0) {
      yield* Effect.sync(() => {
        process.exitCode = exitCode;
      });
    }
  },
);

if (import.meta.main) main().pipe(BunRuntime.runMain);
