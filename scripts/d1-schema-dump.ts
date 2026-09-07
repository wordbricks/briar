#!/usr/bin/env bun
// Replays D1 migrations into a throwaway local database and dumps the result
// as SQL that loads back in one pass.
//
// Two callers share this: `generate-d1-schema-snapshot.ts`, which dumps the
// fully migrated schema as a test fixture, and
// `generate-d1-baseline-migration.ts`, which dumps the schema at a cut-off
// migration so the history below it can be deleted. Both need the same
// statement regrouping, so it lives here rather than in either of them.

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const appDir = join(root, "apps", "briar");
export const migrationsDir = join(appDir, "migrations");

/**
 * Migrations the snapshot and the baseline both leave out: data-only files too
 * large to belong in a fixture. Empty today —
 * `0142_restore_cvs_slack_history.sql` was the last one, a 6.5 MB one-off
 * restore of historical customer Slack messages that made no schema change,
 * and the baseline cut-off replaced it. The mechanism stays for the next one.
 */
export const EXCLUDED_MIGRATIONS = new Set<string>([]);

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function migrationNumber(name: string) {
  return Number.parseInt(name.split("_")[0] ?? "", 10);
}

/** Migration file names in apply order, minus the excluded ones. */
export async function migrationNames() {
  return (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql") && !EXCLUDED_MIGRATIONS.has(name))
    .sort();
}

/**
 * Identifies the exact migration inputs a dump was built from, so a `--check`
 * can detect drift without spending ~45s replaying them.
 */
export async function migrationsDigest(names?: readonly string[]) {
  const parts: string[] = [];
  for (const name of names ?? await migrationNames()) {
    parts.push(`${name}\0${sha256(await readFile(join(migrationsDir, name), "utf8"))}`);
  }
  return sha256(parts.join("\n"));
}

export async function run(command: string[], cwd: string) {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${exitCode})\n${stdout}\n${stderr}`,
    );
  }
  return stdout;
}

// `wrangler d1 migrations apply` cannot skip a file, so migrate against a copy
// of the migrations directory that simply does not contain the excluded ones.
async function stageMigrations(stateDir: string, names: readonly string[]) {
  const staged = join(stateDir, "migrations");
  await mkdir(staged, { recursive: true });
  for (const name of names) {
    await copyFile(join(migrationsDir, name), join(staged, name));
  }
  await writeFile(
    join(stateDir, "wrangler.jsonc"),
    JSON.stringify(
      {
        name: "briar-d1-schema-snapshot",
        compatibility_date: "2026-01-01",
        d1_databases: [
          {
            binding: "DB",
            database_name: "briar-db",
            database_id: "b83c9a2a-2a41-48ec-8bc4-ef038f5c9685",
            migrations_dir: "migrations",
          },
        ],
      },
      null,
      2,
    ),
  );
}

// `wrangler d1 export` emits the schema in sqlite_master (creation) order and
// rows in rowid order, so the dump is already stable across runs. Three kinds of
// line are dropped:
//   - `d1_migrations` rows, whose `applied_at` timestamps change every run (the
//     table itself stays, empty: the dump is not a migrated database and
//     nothing should replay migrations on top of it);
//   - `sqlite_sequence` bookkeeping, which only restates the defaults of a fresh
//     database and which D1 rejects as a write to an internal table;
//   - the transaction/PRAGMA wrapper, which neither the Worker test setup nor
//     the D1 migration runner can run statement-by-statement.
// Lines are otherwise passed through byte for byte so string literals in seeded
// rows survive intact.
// Statements are separated by this sentinel so the Worker test setup can split
// the dump with a plain string split. A general SQL splitter cannot be used
// at runtime: several triggers contain `case ... end,` inside their body, which
// the character-scanning splitter in worker/src/test-helpers/d1.ts mistakes for
// an unterminated compound statement. The sentinel is a comment, so the dump
// still runs as-is through sqlite3 or `wrangler d1 execute --file`.
export const STATEMENT_SENTINEL = "-- @statement";

// `wrangler d1 export` writes one top-level statement per block, always ending
// in `;` at the end of a line, with the next block starting at column 0 on a
// keyword. That is enough to recover the boundaries exactly.
const STATEMENT_START = /^(?:CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i;

function splitDump(sql: string) {
  const statements: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const statement = current.join("\n").trim();
    if (statement) statements.push(statement);
    current = [];
  };
  for (const line of sql.split("\n")) {
    if (
      STATEMENT_START.test(line) &&
      current.join("\n").trim().endsWith(";")
    ) {
      flush();
    }
    current.push(line);
  }
  flush();
  for (const statement of statements) {
    if (!statement.endsWith(";")) {
      throw new Error(
        `Could not split the D1 export into statements; this one has no terminator:\n${statement.slice(0, 400)}`,
      );
    }
  }
  return statements;
}

// The export lists objects in sqlite_master order, which replays badly: a
// trigger declared `instead of insert on <view>` is emitted before the view it
// targets. Regroup into an order that is always loadable — tables, then the
// seeded rows (before triggers, so change-log triggers do not fire on them),
// then views, indexes and finally triggers. The order inside each group is
// preserved, so views that build on other views still come out right and the
// output stays byte-stable across runs.
const STATEMENT_GROUPS: ReadonlyArray<RegExp> = [
  /^CREATE\s+(?:VIRTUAL\s+)?TABLE\b/i,
  /^(?:INSERT|REPLACE|UPDATE|DELETE)\b/i,
  /^CREATE\s+VIEW\b/i,
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
  /^CREATE\s+TRIGGER\b/i,
];

function groupOrder(statement: string) {
  const index = STATEMENT_GROUPS.findIndex((pattern) => pattern.test(statement));
  return index === -1 ? STATEMENT_GROUPS.length : index;
}

/** The export, stripped and regrouped into statements that load in one pass. */
export function dumpStatements(exported: string) {
  const dropped =
    /^\s*(?:INSERT INTO ["`]?d1_migrations["`]?|INSERT INTO ["`]?sqlite_sequence["`]?|DELETE FROM ["`]?sqlite_sequence["`]?|PRAGMA |BEGIN TRANSACTION;|COMMIT;)/;
  const kept = exported.split("\n").filter((line) => !dropped.test(line));
  return splitDump(kept.join("\n"))
    .map((statement, index) => ({ statement, index }))
    .sort((left, right) =>
      groupOrder(left.statement) - groupOrder(right.statement) ||
      left.index - right.index
    )
    .map((entry) => entry.statement);
}

export function withSentinels(statements: readonly string[]) {
  return `${statements.map((statement) => `${STATEMENT_SENTINEL}\n${statement}`).join("\n")}\n`;
}

/**
 * Applies `names` to a throwaway local database and returns the export's
 * statements, already regrouped into load order.
 */
export async function dumpMigratedSchema(
  names: readonly string[],
  label: string,
) {
  const stateDir = await mkdtemp(join(tmpdir(), "briar-d1-dump-"));
  try {
    await stageMigrations(stateDir, names);
    const config = join(stateDir, "wrangler.jsonc");
    await run([
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "briar-db",
      "--local",
      "--config",
      config,
    ], stateDir);
    const output = join(stateDir, "export.sql");
    await run([
      "bunx",
      "wrangler",
      "d1",
      "export",
      "briar-db",
      "--local",
      "--config",
      config,
      "--output",
      output,
    ], stateDir);
    console.log(`[${label}] applied ${names.length} migrations`);
    return dumpStatements(await Bun.file(output).text());
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}
