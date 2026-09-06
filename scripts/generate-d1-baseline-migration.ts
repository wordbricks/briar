#!/usr/bin/env bun
// Squashes the migration history below a cut-off into one baseline migration.
//
//   bun run scripts/generate-d1-baseline-migration.ts \
//     0159_allow_duplicate_evidence_image_digests.sql 0000_baseline_schema.sql \
//     --drop 0142_restore_cvs_slack_history.sql
//
// The baseline is the schema and seeded rows a fresh database has after
// replaying everything up to and including the cut-off. Migrations above it are
// untouched, because the cutover tests in `worker/src/*.migration.test.ts`
// replay them by name to assert what a historical migration did to real rows —
// so the cut-off has to sit below the lowest migration any of them pins.
//
// `--drop` names a data-only migration whose rows are deliberately *not*
// carried into the baseline. Use it only for a file that makes no schema
// change and whose rows a fresh database has no business holding.
//
// Before writing anything this verifies, in memory, that
// `[baseline, ...above the cut-off]` produces byte-identical schema and rows to
// replaying the whole history. Re-running it needs the pre-squash migrations,
// which after the squash live only in git history.

import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { BASELINE_MARKER } from "./apply-remote-d1-migrations";
import {
  dumpMigratedSchema,
  migrationNames,
  migrationNumber,
  migrationsDir,
  sha256,
  withSentinels,
} from "./d1-schema-dump";

const label = "d1-baseline";
const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const [throughName, outputName] = positional;
const dropped = new Set(
  process.argv.reduce<string[]>(
    (names, value, index) =>
      value === "--drop" && process.argv[index + 1]
        ? [...names, process.argv[index + 1]!]
        : names,
    [],
  ),
);
if (!throughName || !outputName || !/^\d+_.+\.sql$/u.test(outputName)) {
  throw new Error(
    "usage: bun run scripts/generate-d1-baseline-migration.ts <through.sql> <output.sql> [--drop <name.sql>]…",
  );
}

const all = await migrationNames();
if (!all.includes(throughName)) {
  throw new Error(`${throughName} is not in ${migrationsDir}.`);
}
const cutoff = migrationNumber(throughName);
const carried = all.filter((name) => !dropped.has(name));
const source = carried.filter((name) => migrationNumber(name) <= cutoff);
const above = carried.filter((name) => migrationNumber(name) > cutoff);
if (migrationNumber(outputName) >= migrationNumber(above[0] ?? throughName)) {
  throw new Error(`${outputName} must sort below ${above[0] ?? throughName}.`);
}
for (const name of dropped) {
  if (!all.includes(name)) throw new Error(`--drop ${name} is not in ${migrationsDir}.`);
  if (migrationNumber(name) > cutoff) {
    throw new Error(`--drop ${name} is above the cut-off; it would not be squashed.`);
  }
}

const statements = await dumpMigratedSchema(source, label);

/**
 * Wrangler splits a migration into statements before D1 runs it, and its
 * splitter cannot find the `end` of a trigger body holding more than one
 * `case … end`: it swallows every following statement into one oversized
 * statement that D1 rejects. Ending a file right after each such trigger
 * leaves nothing to swallow, and because files apply in order the resulting
 * schema — including the trigger creation order the `*_sync` pairs depend
 * on — is identical to the single file. The provider migrations are split the
 * same way.
 */
const splitterCanDelimit = (statement: string) =>
  unstable_splitSqlQuery(`${statement}\n\nselect 1;\n`).length === 2;

const chunks: string[][] = [[]];
for (const statement of statements) {
  chunks.at(-1)!.push(statement);
  if (!splitterCanDelimit(statement)) chunks.push([]);
}
if (chunks.at(-1)!.length === 0) chunks.pop();

// Every part carries the baseline's number, so the whole baseline still sorts
// ahead of the history it fronts and the parts stay in order among themselves.
const stem = outputName.replace(/\.sql$/u, "");
const partName = (index: number) =>
  index === 0 ? outputName : `${stem}_part${String(index + 1).padStart(2, "0")}.sql`;

const parts = chunks.map((chunk, index) =>
  [
    `-- GENERATED FILE - DO NOT EDIT BY HAND.`,
    // Machine-readable, and on every part: this is what tells the remote
    // applier the file is a baseline and which history it stands in for.
    `${BASELINE_MARKER}${throughName}`,
    ...(index === 0
      ? [
        `-- Baseline: the schema and seeded rows of a database migrated through`,
        `-- ${throughName}. It replaces the ${source.length} migrations at or below`,
        `-- that cut-off, which were deleted; they are in git history if ever needed.`,
        ...(dropped.size > 0
          ? [
            `-- Deliberately not carried into the baseline (data-only, no schema`,
            `-- change): ${[...dropped].join(", ")}.`,
          ]
          : []),
        `-- An existing database must never run this file. The remote applier`,
        `-- records it as already applied when the history it replaces is`,
        `-- present; see baselineAlreadyApplied in`,
        `-- scripts/apply-remote-d1-migrations.ts.`,
        `-- Produced by scripts/generate-d1-baseline-migration.ts.`,
        `-- source-digest: ${sha256(source.join("\n"))}`,
      ]
      : [`-- Continuation ${index + 1} of ${outputName}.`]),
    "",
    withSentinels(chunk),
  ].join("\n")
);

// ---------------------------------------------------------------------------
// Equivalence: [baseline, ...above] must be the whole history, exactly.
// ---------------------------------------------------------------------------

async function replay(files: readonly string[], head: readonly string[] = []) {
  const db = new Database(":memory:", { strict: true });
  db.exec("pragma foreign_keys = on");
  const apply = (sql: string) => {
    for (const statement of unstable_splitSqlQuery(sql)) {
      if (statement.trim()) db.exec(statement);
    }
  };
  for (const sql of head) apply(sql);
  for (const name of files) apply(await readFile(join(migrationsDir, name), "utf8"));
  return db;
}

/**
 * Everything about a database that has to survive the squash: every object's
 * definition, every row, and the order the triggers were created in.
 *
 * Only the triggers are compared in creation order, because only they are
 * order-sensitive — SQLite fires them in that order, and several `*_sync` pairs
 * depend on it. Tables, views and indexes are compared as a set: the baseline
 * groups all its tables ahead of its indexes where the history interleaved
 * them, which changes nothing.
 */
function canonical(db: Database) {
  const schema = db
    .query<{ type: string; name: string; tbl_name: string; sql: string | null }, []>(
      `select type, name, tbl_name, sql from sqlite_schema order by rowid`,
    )
    .all()
    .filter((row) => row.name !== "d1_migrations" && !row.name.startsWith("sqlite_"));
  const definitions = schema
    .map((row) =>
      `${row.type}\t${row.name}\t${row.tbl_name}\t${(row.sql ?? "").replace(/\s+/gu, " ")}`
    )
    .sort();
  const triggerOrder = schema
    .filter((row) => row.type === "trigger")
    .map((row, index) => `trigger-order\t${index}\t${row.name}`);
  const rows = schema
    .filter((row) => row.type === "table")
    .flatMap((row) =>
      db
        .query(`select * from "${row.name}"`)
        .all()
        .map((stored) => `row\t${row.name}\t${JSON.stringify(stored)}`)
        .sort()
    );
  return [...definitions, ...triggerOrder, ...rows].join("\n");
}

const whole = canonical(await replay(carried));
const squashed = canonical(await replay(above, parts));
if (whole !== squashed) {
  const left = whole.split("\n");
  const right = squashed.split("\n");
  const at = left.findIndex((line, index) => line !== right[index]);
  throw new Error(
    `The baseline does not reproduce the history it replaces.\n` +
      `  history: ${left[at]?.slice(0, 300)}\n` +
      `  baseline: ${right[at]?.slice(0, 300)}`,
  );
}

// The remote applier hands each file to `wrangler d1 execute`, which splits it
// before D1 runs it. Every part has to survive that split intact, or the
// statements after an undelimitable one arrive as one oversized statement.
for (const [index, part] of parts.entries()) {
  const split = unstable_splitSqlQuery(part).filter((statement) => statement.trim());
  if (split.length !== chunks[index]!.length) {
    throw new Error(
      `Wrangler splits ${partName(index)} into ${split.length} statements, not ` +
        `${chunks[index]!.length}.`,
    );
  }
}

const bytes = parts.reduce((total, part) => total + part.length, 0);
for (const [index, part] of parts.entries()) {
  await writeFile(join(migrationsDir, partName(index)), part);
}
console.log(
  `[${label}] wrote ${parts.length} file(s) as ${partName(0)}: ` +
    `${bytes.toLocaleString()} bytes, ${statements.length} statements, ` +
    `replacing ${source.length} migrations (${dropped.size} dropped); ` +
    `${above.length} kept above ${throughName}.`,
);
console.log(
  `[${label}] now delete: ${source.length + dropped.size} files at or below ${throughName}.`,
);
