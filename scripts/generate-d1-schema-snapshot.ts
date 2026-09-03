#!/usr/bin/env bun
// Regenerates apps/briar/migrations-snapshot/schema.sql: the fully migrated D1
// schema plus the rows seeded by data-only migrations. The Worker D1 Vitest
// project loads that snapshot instead of replaying ~190 migrations per file.
//
//   bun run d1:snapshot              regenerate and write the snapshot
//   bun run d1:snapshot:check        fast: compare the digests recorded in the
//                                    snapshot header against the migration
//                                    files on disk (this is what CI runs)
//   bun run d1:snapshot:check:full   definitive: regenerate into a temp file and
//                                    print a diff if it differs
//
// The migrations themselves stay the source of truth: `d1:migrate:local` and
// the migration regression suite still replay every file.

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "briar");
const migrationsDir = join(appDir, "migrations");
const snapshotPath = join(appDir, "migrations-snapshot", "schema.sql");

// Restores historical customer Slack messages. It makes no schema change, and
// its 6 MB of rows have no business in a test fixture, so the snapshot skips
// it exactly like the Worker D1 Vitest project does.
const EXCLUDED_MIGRATIONS = new Set(["0142_restore_cvs_slack_history.sql"]);

const MIGRATIONS_DIGEST_PREFIX = "-- migrations-digest: ";
const SNAPSHOT_DIGEST_PREFIX = "-- snapshot-digest: ";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function migrationNames() {
  return (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql") && !EXCLUDED_MIGRATIONS.has(name))
    .sort();
}

// Identifies the exact migration inputs the snapshot was built from, so
// `--check` can detect drift without spending ~45s replaying them.
async function migrationsDigest() {
  const parts: string[] = [];
  for (const name of await migrationNames()) {
    parts.push(`${name}\0${sha256(await readFile(join(migrationsDir, name), "utf8"))}`);
  }
  return sha256(parts.join("\n"));
}

function header(migrations: string, snapshot: string) {
  return [
    "-- GENERATED FILE - DO NOT EDIT BY HAND.",
    "-- Produced by scripts/generate-d1-schema-snapshot.ts from apps/briar/migrations",
    `-- (excluding ${[...EXCLUDED_MIGRATIONS].join(", ")}).`,
    "-- Loaded by the worker-d1 Vitest project in place of replaying migrations.",
    "-- Whenever a migration changes the schema or seeds rows, run",
    "-- `bun run d1:snapshot` and commit the result; `bun run d1:snapshot:check`",
    "-- fails in CI otherwise.",
    `${MIGRATIONS_DIGEST_PREFIX}${migrations}`,
    `${SNAPSHOT_DIGEST_PREFIX}${snapshot}`,
    "",
  ].join("\n");
}

function headerValue(snapshot: string, prefix: string) {
  const line = snapshot.split("\n").find((entry) => entry.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? null;
}

async function run(command: string[], cwd: string) {
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
async function stageMigrations(stateDir: string) {
  const staged = join(stateDir, "migrations");
  await mkdir(staged, { recursive: true });
  const names = await migrationNames();
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
  return names.length;
}

// `wrangler d1 export` emits the schema in sqlite_master (creation) order and
// rows in rowid order, so the dump is already stable across runs. Three kinds of
// line are dropped:
//   - `d1_migrations` rows, whose `applied_at` timestamps change every run (the
//     table itself stays, empty: the snapshot is not a migrated database and
//     nothing should replay migrations on top of it);
//   - `sqlite_sequence` bookkeeping, which only restates the defaults of a fresh
//     database and which D1 rejects as a write to an internal table;
//   - the transaction/PRAGMA wrapper, which the Worker test setup cannot run
//     statement-by-statement through the D1 binding.
// Lines are otherwise passed through byte for byte so string literals in seeded
// rows survive intact.
// Statements are separated by this sentinel so the Worker test setup can split
// the snapshot with a plain string split. A general SQL splitter cannot be used
// at runtime: several triggers contain `case ... end,` inside their body, which
// the character-scanning splitter in worker/src/test-helpers/d1.ts mistakes for
// an unterminated compound statement. The sentinel is a comment, so the snapshot
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

function normalize(sql: string) {
  const dropped =
    /^\s*(?:INSERT INTO ["`]?d1_migrations["`]?|INSERT INTO ["`]?sqlite_sequence["`]?|DELETE FROM ["`]?sqlite_sequence["`]?|PRAGMA |BEGIN TRANSACTION;|COMMIT;)/;
  const kept = sql.split("\n").filter((line) => !dropped.test(line));
  const statements = splitDump(kept.join("\n"))
    .map((statement, index) => ({ statement, index }))
    .sort((left, right) =>
      groupOrder(left.statement) - groupOrder(right.statement) ||
      left.index - right.index
    )
    .map((entry) => entry.statement);
  return `${statements.map((statement) => `${STATEMENT_SENTINEL}\n${statement}`).join("\n")}\n`;
}

async function generate() {
  const stateDir = await mkdtemp(join(tmpdir(), "briar-d1-snapshot-"));
  try {
    const applied = await stageMigrations(stateDir);
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
    const exported = await Bun.file(output).text();
    console.log(`[d1-snapshot] applied ${applied} migrations`);
    return normalize(exported);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function build() {
  const body = await generate();
  return `${header(await migrationsDigest(), sha256(body))}${body}`;
}

function stale(reason: string): never {
  console.error(`[d1-snapshot] ${reason}`);
  console.error(
    "[d1-snapshot] Run `bun run d1:snapshot` and commit " +
      "apps/briar/migrations-snapshot/schema.sql.",
  );
  process.exit(1);
}

// The fast check does not replay the migrations. It compares the digests the
// generator recorded in the header: `migrations-digest` catches a migration
// added or edited without regenerating, `snapshot-digest` catches a hand-edited
// snapshot. `--full` does the definitive regenerate-and-diff (~45s).
async function fastCheck() {
  const committed = await readFile(snapshotPath, "utf8").catch(() => null);
  if (committed === null) stale(`${snapshotPath} is missing.`);
  const body = committed.slice(committed.indexOf("\n", committed.indexOf(SNAPSHOT_DIGEST_PREFIX)) + 1);
  if (headerValue(committed, SNAPSHOT_DIGEST_PREFIX) !== sha256(body)) {
    stale("The snapshot body does not match its recorded snapshot-digest.");
  }
  if (headerValue(committed, MIGRATIONS_DIGEST_PREFIX) !== await migrationsDigest()) {
    stale("The migrations changed since the snapshot was generated.");
  }
  console.log("[d1-snapshot] snapshot digests match apps/briar/migrations");
}

async function fullCheck() {
  const generated = await build();
  const committed = await readFile(snapshotPath, "utf8").catch(() => null);
  if (committed === generated) {
    console.log("[d1-snapshot] snapshot is up to date");
    return;
  }
  const actual = join(
    await mkdtemp(join(tmpdir(), "briar-d1-snapshot-diff-")),
    "schema.sql",
  );
  await writeFile(actual, generated);
  console.error("[d1-snapshot] the committed snapshot differs from a fresh one:");
  await Bun.spawn(["diff", "-u", snapshotPath, actual], {
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  stale("apps/briar/migrations-snapshot/schema.sql is stale.");
}

if (process.argv.includes("--check")) {
  await (process.argv.includes("--full") ? fullCheck() : fastCheck());
} else {
  const generated = await build();
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, generated);
  console.log(`[d1-snapshot] wrote ${snapshotPath} (${generated.length} bytes)`);
}
