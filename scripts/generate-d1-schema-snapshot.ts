#!/usr/bin/env bun
// Regenerates apps/briar/migrations-snapshot/schema.sql: the fully migrated D1
// schema plus the rows seeded by data-only migrations. The Worker D1 Vitest
// project loads that snapshot instead of replaying every migration.
//
//   bun run d1:snapshot              regenerate and write the snapshot
//   bun run d1:snapshot:check        fast: compare the digests recorded in the
//                                    snapshot header against the migration
//                                    files on disk (this is what CI runs)
//   bun run d1:snapshot:check:full   definitive: regenerate into a temp file and
//                                    print a diff if it differs
//
// The migrations themselves stay the source of truth: `d1:migrate:local` and
// the migration regression suite still replay every file. The replay and dump
// machinery lives in `d1-schema-dump.ts`, shared with the baseline generator.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  appDir,
  dumpMigratedSchema,
  EXCLUDED_MIGRATIONS,
  migrationNames,
  migrationsDigest,
  sha256,
  withSentinels,
} from "./d1-schema-dump";

const snapshotPath = join(appDir, "migrations-snapshot", "schema.sql");

const MIGRATIONS_DIGEST_PREFIX = "-- migrations-digest: ";
const SNAPSHOT_DIGEST_PREFIX = "-- snapshot-digest: ";

function header(migrations: string, snapshot: string) {
  return [
    "-- GENERATED FILE - DO NOT EDIT BY HAND.",
    "-- Produced by scripts/generate-d1-schema-snapshot.ts from apps/briar/migrations",
    ...(EXCLUDED_MIGRATIONS.size > 0
      ? [`-- (excluding ${[...EXCLUDED_MIGRATIONS].join(", ")}).`]
      : []),
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

async function build() {
  const body = withSentinels(
    await dumpMigratedSchema(await migrationNames(), "d1-snapshot"),
  );
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
