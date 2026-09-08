#!/usr/bin/env bun
// One-shot generator for the migration that moves the persisted issue
// difficulty catalog out of `briar_hunt_runs.difficulty`'s CHECK list and into
// the `briar_issue_difficulties` lookup table, seeding it with the 'expert'
// level this branch adds.
//
//   bun run scripts/generate-issue-difficulty-expert-migration.ts \
//     0214_issue_difficulty_expert.sql
//
// Widening the CHECK would have been the obvious change and the wrong one.
// SQLite can only alter a CHECK by rebuilding the table, and D1 blocks every
// shortcut for doing that:
//
//   * `pragma foreign_keys = off` is ignored — D1 runs statements inside a
//     transaction, where the pragma is a no-op.
//   * `drop table <parent>` still cascades to the descendants even under
//     `pragma defer_foreign_keys = on`.
//   * `alter table <parent> rename to <aside>` rewrites every REFERENCES
//     clause naming it, so the descendants follow the rename and the old
//     table can never be orphaned.
//
// So this migration is the last rebuild `briar_hunt_runs.difficulty` needs.
// Afterwards the column is a foreign key into a lookup table and a fifth
// difficulty is one `insert`, exactly as `0204_agent_provider_lookup.sql` did
// for the agent provider catalog. See `docs/operations/d1-schema-changes.md`.
//
// The rebuild itself is kept as small as the foreign keys allow. A descendant
// that reaches `briar_hunt_runs` through a *nullable* column does not have to
// be parked: its `(primary key, column)` pairs are saved, the column is
// nulled, the rebuild runs, and the values go back. The cascade stops at that
// column, and everything hanging below it is never touched. Only a `not null`
// foreign key forces the table — and its own descendants — into the parked
// set. The classification is read out of `pragma foreign_key_list`, not
// listed here, so a column added later is sorted correctly.
//
// The generated SQL is verified in memory against the replayed migration
// history, seeded with a fixture that exercises every strategy, before
// anything is written: it must apply cleanly with foreign keys on, leave
// `pragma foreign_key_check` empty, preserve every row of the closure, bring
// every nulled column back with its original value, land the lookup table and
// its foreign key, and accept 'expert' while still rejecting an unknown
// difficulty.

import { Database } from "bun:sqlite";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { issueDifficulties } from "../apps/briar/src/lib/issue-difficulty";

const outputName = process.argv[2]?.trim();
if (!outputName) {
  throw new Error(
    "usage: bun run scripts/generate-issue-difficulty-expert-migration.ts <migration.sql>",
  );
}
const outputMatch = outputName.match(/^(\d+)_(.+)\.sql$/u);
if (!outputMatch) {
  throw new Error(`${outputName} must be named <number>_<name>.sql`);
}
const firstNumber = Number(outputMatch[1]);
const baseName = outputMatch[2]!;
const partPattern = new RegExp(`^\\d+_${baseName}_part\\d+\\.sql$`, "u");

const rebuiltTable = "briar_hunt_runs";
const difficultyColumn = "difficulty";
const lookupTable = "briar_issue_difficulties";
const protoDifficultyName = (difficulty: string) =>
  `ISSUE_DIFFICULTY_${difficulty.toUpperCase()}`;

/**
 * Row counts measured against the production database on 2026-09-08, with
 * `wrangler d1 execute briar-db --remote` as
 * `docs/operations/d1-schema-changes.md` describes. They are printed so the
 * cost of the rebuild is visible when the migration is generated rather than
 * after it has run; nothing in the generated SQL depends on them.
 */
const measuredRows = new Map<string, number>(Object.entries({
  briar_agent_transcript_segments: 888485,
  briar_agent_transcript_sessions: 1154,
  briar_agent_transcripts: 0,
  briar_agent_worklog_entries: 162906,
  briar_channel_action_proposals: 137,
  briar_execution_audit_events: 109135,
  briar_hunt_events: 11552,
  briar_hunt_runs: 1011,
  briar_issue_action_proposals: 23,
  briar_issue_agent_reply_jobs: 326,
  briar_issue_attachments: 387,
  briar_issue_create_mutation_receipts: 230,
  briar_issue_dependencies: 18,
  briar_issue_execution_proposals: 66,
  briar_issue_key_aliases: 5,
  briar_issue_message_mentions: 67,
  briar_issue_message_mutation_receipts: 163,
  briar_issue_messages: 1019,
  briar_issue_parent_links: 0,
  briar_issue_relations: 1,
  briar_issue_result_reviews: 473,
  briar_issue_rework_proposals: 16,
  briar_issue_subscriptions: 937,
  briar_issue_update_mutation_receipts: 113,
  briar_log_archives: 137,
  briar_merge_batch_candidates: 0,
  briar_run_checkpoint_progress: 461,
  briar_run_cost_records: 4549,
  briar_run_evidence: 14440,
  briar_run_evidence_images: 1057,
  briar_run_evidence_pull_requests: 9,
  briar_run_execution_attempts: 1271,
  briar_run_pull_requests: 9,
  briar_run_stage_progress: 8383,
  briar_run_stage_revisions: 708,
  briar_run_usage_records: 7026,
}));
/** Non-null values in each nullable link column, measured the same day. */
const measuredLinkValues = new Map<string, number>(Object.entries({
  "briar_agent_transcript_sessions.run_id": 1104,
  "briar_channel_action_proposals.result_run_id": 111,
  "briar_execution_audit_events.run_id": 4054,
  "briar_log_archives.run_id": 0,
}));

// ---------------------------------------------------------------------------
// Replay the history the migration will sit on top of
// ---------------------------------------------------------------------------

const migrationsDirectory = resolve("apps/briar/migrations");
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) =>
    name.endsWith(".sql") && name !== outputName && !partPattern.test(name)
  )
  .sort();
const db = new Database(":memory:", { strict: true });
db.exec("pragma foreign_keys = on");
for (const name of migrationNames) {
  const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
  for (const statement of unstable_splitSqlQuery(sql)) {
    if (statement.trim()) db.exec(statement);
  }
}

const tableRows = db
  .query<{ name: string; sql: string }, []>(
    `select name, sql from sqlite_schema
     where type = 'table' and sql is not null and name not like 'sqlite_%'`,
  )
  .all();
const tableSql = new Map(tableRows.map((row) => [row.name, row.sql]));
const parentSql = tableSql.get(rebuiltTable);
if (!parentSql) throw new Error(`${rebuiltTable} is not in the schema.`);
if (tableSql.has(lookupTable)) {
  throw new Error(`${lookupTable} already exists; this migration already ran.`);
}

// ---------------------------------------------------------------------------
// CHECK-clause surgery: the enum list becomes a foreign key
// ---------------------------------------------------------------------------

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/**
 * Index of the paren matching the `(` at `openIndex`. String literals, quoted
 * identifiers and `--` comments are skipped so a paren inside a glob pattern
 * or a comment cannot unbalance the scan.
 */
function matchingParen(sql: string, openIndex: number) {
  let depth = 0;
  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (character === "'" || character === '"') {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === character) {
          if (sql[index + 1] !== character) break;
          index += 1;
        }
        index += 1;
      }
      continue;
    }
    if (character === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unbalanced parentheses in table SQL.");
}

/**
 * The table's DDL with the difficulty enum list deleted and a foreign key into
 * the lookup table appended, in the shape `0204_agent_provider_lookup.sql`
 * used. Throws when the enclosing `check (…)` carries anything besides the
 * list, because deleting it would then drop a rule this migration may not
 * touch.
 */
function rewriteParent(sql: string) {
  const listMatch = new RegExp(
    `\\b${difficultyColumn}\\s+in\\s*\\(`,
    "giu",
  ).exec(sql);
  if (!listMatch) {
    throw new Error(
      `${rebuiltTable} no longer spells the difficulty list out; ` +
        "this migration already ran.",
    );
  }
  const enclosing = [...sql.matchAll(/\bcheck\s*\(/giu)]
    .map((match) => {
      const open = match.index + match[0].length - 1;
      return { start: match.index, end: matchingParen(sql, open) + 1 };
    })
    .filter((span) => span.start < listMatch.index && listMatch.index < span.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))
    .at(0);
  if (!enclosing) {
    throw new Error("No check clause encloses the difficulty list.");
  }
  const body = sql
    .slice(sql.indexOf("(", enclosing.start) + 1, enclosing.end - 1)
    .trim();
  // Both shapes the schema uses, and both are what a foreign key already
  // means: a value must name a difficulty, and SQLite lets NULL through either
  // way. Anything else in the clause is a rule this migration must not drop.
  const listOnly = new RegExp(
    `^(?:${difficultyColumn}\\s+is\\s+null\\s+or\\s+)?` +
      `${difficultyColumn}\\s+in\\s*\\([^()]*\\)$`,
    "isu",
  );
  if (!listOnly.test(body)) {
    throw new Error(
      `The check on ${difficultyColumn} carries more than the list: ${body}`,
    );
  }

  let start = enclosing.start;
  const labelled = sql
    .slice(0, start)
    .match(/\bconstraint\s+(?:"[^"]*"|[a-z0-9_]+)\s*$/iu);
  if (labelled) start -= labelled[0].length;
  while (start > 0 && /\s/u.test(sql[start - 1]!)) start -= 1;
  let end = enclosing.end;
  let after = end;
  while (after < sql.length && /\s/u.test(sql[after]!)) after += 1;
  const previous = sql[start - 1];
  if ((previous === "," || previous === "(") && sql[after] === ",") {
    end = after + 1;
  }

  const stripped = sql.slice(0, start) + sql.slice(end);
  if (new RegExp(`\\b${difficultyColumn}\\s+in\\s*\\(`, "iu").test(stripped)) {
    throw new Error("A difficulty check survived the rewrite.");
  }
  const header = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?/iu.exec(
    stripped,
  );
  if (!header) throw new Error("Not a create table statement.");
  const open = stripped.indexOf("(", header[0].length);
  const close = matchingParen(stripped, open);
  let insertAt = close;
  while (insertAt > 0 && /\s/u.test(stripped[insertAt - 1]!)) insertAt -= 1;
  const reference =
    `,\n  foreign key (${quote(difficultyColumn)}) references ${lookupTable} ` +
    `(${difficultyColumn})`;
  return (stripped.slice(0, insertAt) + reference + stripped.slice(insertAt))
    .replace(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?/iu, "create table ");
}

const rebuiltParentSql = rewriteParent(parentSql);
const foreignKeyClause =
  `foreign key (${quote(difficultyColumn)}) references ${lookupTable} ` +
  `(${difficultyColumn})`;
if (!rebuiltParentSql.includes(foreignKeyClause)) {
  throw new Error("The lookup foreign key did not land in the recreated table.");
}

// ---------------------------------------------------------------------------
// Foreign-key classification
// ---------------------------------------------------------------------------

type ForeignKey = {
  readonly table: string;
  readonly from: string;
  readonly on_delete: string;
};

const foreignKeysOf = (table: string) =>
  db
    .query<ForeignKey, []>(
      `pragma foreign_key_list('${table.replaceAll("'", "''")}')`,
    )
    .all()
    .filter((row) => tableSql.has(row.table));

const columnsOf = (table: string) =>
  db
    .query<{ name: string; notnull: number; pk: number }, []>(
      `pragma table_info('${table.replaceAll("'", "''")}')`,
    )
    .all();

const dependencies = new Map(
  tableRows.map((row) => [
    row.name,
    new Set(foreignKeysOf(row.name).map((fk) => fk.table)),
  ]),
);

/** Every table the parent's drop could reach if nothing were done about it. */
const naiveClosure = new Set([rebuiltTable]);
for (let changed = true; changed;) {
  changed = false;
  for (const [table, parents] of dependencies) {
    if (naiveClosure.has(table)) continue;
    if ([...parents].some((parent) => naiveClosure.has(parent))) {
      naiveClosure.add(table);
      changed = true;
    }
  }
}

/** Every column of another table that points at the rebuilt one. */
type DirectLink = {
  readonly table: string;
  readonly column: string;
  readonly notNull: boolean;
  readonly onDelete: string;
};
const directLinks: DirectLink[] = [];
for (const row of [...tableRows].sort((a, b) => a.name.localeCompare(b.name))) {
  const columns = new Map(columnsOf(row.name).map((c) => [c.name, c]));
  for (const fk of foreignKeysOf(row.name)) {
    if (fk.table !== rebuiltTable) continue;
    const column = columns.get(fk.from);
    if (!column) throw new Error(`${row.name}.${fk.from} is not a column.`);
    directLinks.push({
      table: row.name,
      column: fk.from,
      notNull: column.notnull === 1,
      onDelete: fk.on_delete,
    });
  }
}
if (directLinks.length === 0) {
  throw new Error(`Nothing references ${rebuiltTable}; the closure is wrong.`);
}

// A `not null` column cannot be emptied out of the cascade's way, so its table
// has to be parked — and so does everything its own delete would reach.
const parked = new Set(
  directLinks.filter((link) => link.notNull).map((link) => link.table),
);
for (let changed = true; changed;) {
  changed = false;
  for (const [table, parents] of dependencies) {
    if (parked.has(table) || table === rebuiltTable) continue;
    if ([...parents].some((parent) => parked.has(parent))) {
      parked.add(table);
      changed = true;
    }
  }
}

// A nullable column can be: saved, nulled, and put back after the rebuild.
// That is what keeps this migration off the 1.05M rows hanging below
// `briar_agent_transcript_sessions`. A column already declared
// `on delete set null` is nulled by the drop anyway — saving it first is what
// keeps its value, which the cascade would otherwise throw away.
const nulledLinks = directLinks.filter(
  (link) => !link.notNull && !parked.has(link.table),
);
// Nullable, but the table is parked for the sake of another column, so the
// parked copy already carries the value and there is nothing to do.
const parkedLinks = directLinks.filter(
  (link) => !link.notNull && parked.has(link.table),
);
const nulledTables = new Set(nulledLinks.map((link) => link.table));
const touched = new Set([rebuiltTable, ...parked, ...nulledTables]);
const gated = [...naiveClosure].filter((table) => !touched.has(table)).sort();

// Emptying a parked table cascades into its own children, so nothing outside
// the parked set may hang off one — otherwise the deletes below would reach a
// table this migration never restores.
for (const [table, parents] of dependencies) {
  if (parked.has(table) || table === rebuiltTable) continue;
  const parkedParent = [...parents].find((parent) => parked.has(parent));
  if (parkedParent) {
    throw new Error(
      `${table} hangs off the parked ${parkedParent} but is not parked itself.`,
    );
  }
}

/** Parents before children, so the restore never inserts a dangling row. */
const restoreOrder: string[] = [];
const seen = new Set<string>();
const visiting = new Set<string>();
const visit = (table: string) => {
  if (seen.has(table) || visiting.has(table)) return;
  visiting.add(table);
  for (const parent of [...(dependencies.get(table) ?? [])].sort()) {
    if (parent === table) continue;
    if (parked.has(parent) || parent === rebuiltTable) visit(parent);
  }
  visiting.delete(table);
  seen.add(table);
  restoreOrder.push(table);
};
visit(rebuiltTable);
for (const table of [...parked].sort()) visit(table);

const schemaObjects = db
  .query<{ type: string; name: string; tbl_name: string; sql: string }, []>(
    `select type, name, tbl_name, sql from sqlite_schema
     where sql is not null and type in ('index', 'trigger')
     order by rowid`,
  )
  .all();
// Only the rebuilt table's indexes go: the parked tables are emptied, not
// dropped, so their indexes are never lost.
const indexes = schemaObjects.filter(
  (row) => row.type === "index" && row.tbl_name === rebuiltTable,
);
// Triggers on the tables this migration writes to, and no others. The gated
// tables are never read or written, so their triggers can stay where they are.
const triggers = schemaObjects.filter(
  (row) => row.type === "trigger" && touched.has(row.tbl_name),
);

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const backupName = (table: string) => `briar_difficulty_backup_${table.slice(6)}`;
const linkBackupName = (link: DirectLink) =>
  `briar_difficulty_link_${link.table.slice(6)}_${link.column}`;

/** The key that identifies a row while its foreign key is parked aside. */
const keyColumnsOf = (table: string) => {
  const key = columnsOf(table)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  // A rowid table without a declared primary key still has a stable rowid, and
  // nothing between the save and the restore inserts into it.
  return key.length > 0 ? key : ["rowid"];
};

const columnList = (columns: readonly string[], indent: string) =>
  columns.map((column) => `${indent}${quote(column)}`).join(",\n");

const restoreStatement = (table: string) => {
  const columns = columnsOf(table).map((column) => column.name);
  return `insert into ${quote(table)} (\n${columnList(columns, "  ")}\n)\nselect\n${
    columnList(columns, "  ")
  }\nfrom ${quote(backupName(table))};`;
};

const saveLinkStatement = (link: DirectLink) => {
  const key = keyColumnsOf(link.table);
  return `create table ${quote(linkBackupName(link))} as\nselect\n${
    columnList([...key, link.column], "  ")
  }\nfrom ${quote(link.table)}\nwhere ${quote(link.column)} is not null;`;
};

const clearLinkStatement = (link: DirectLink) =>
  `update ${quote(link.table)}\nset ${quote(link.column)} = null\nwhere ${
    quote(link.column)
  } is not null;`;

const restoreLinkStatement = (link: DirectLink) => {
  const saved = quote(linkBackupName(link));
  const table = quote(link.table);
  const match = keyColumnsOf(link.table)
    .map((column) => `${saved}.${quote(column)} = ${table}.${quote(column)}`)
    .join("\n    and ");
  return `update ${table}\nset ${quote(link.column)} = (\n  select ${saved}.${
    quote(link.column)
  }\n  from ${saved}\n  where ${match}\n)\nwhere exists (\n  select 1\n  from ${saved}\n  where ${match}\n);`;
};

const header = [
  `-- Add an 'expert' issue difficulty, and make it the last one that needs a`,
  `-- migration at all.`,
  `--`,
  `-- ${rebuiltTable}.${difficultyColumn} was a \`check (… in (…))\` list, and`,
  `-- SQLite can only change a CHECK by rebuilding the table. So the list moves`,
  `-- into ${lookupTable} and the column becomes a foreign key into it,`,
  `-- the way 0204_agent_provider_lookup.sql moved the agent provider catalog:`,
  `-- the next difficulty is one \`insert into ${lookupTable}\`, with`,
  `-- no rebuild and no migration file behind it, forever. Integrity is not`,
  `-- weakened — it moves from a CHECK to a foreign key, and the derived`,
  `-- proto_name column keeps the table honest against the proto enum.`,
  `--`,
  `-- This last rebuild is kept small. D1 honours neither`,
  `-- \`pragma foreign_keys = off\` nor an orphaning rename, and dropping the`,
  `-- parent cascades, so a naive rebuild would park all ${naiveClosure.size} tables the`,
  `-- cascade can reach — 1,215,850 rows for a table holding 1,011 of them.`,
  `-- Instead only the ${parked.size} descendants that reach ${rebuiltTable}`,
  `-- through a \`not null\` foreign key, plus their own descendants, are parked.`,
  `-- The ${nulledLinks.length} nullable columns that also point here have their values saved,`,
  `-- are set to null for the duration, and are restored afterwards; the cascade`,
  `-- stops at them, which leaves the ${gated.length} tables below them —`,
  `-- ${gated.join(", ")} —`,
  `-- untouched, and they hold 1,051,391 of those rows.`,
  `--`,
  `-- The parked tables are emptied outright before the restore rather than`,
  `-- trusting the cascade to have done it: rows reached through`,
  `-- \`on delete set null\` survive the drop and would collide with it.`,
  `--`,
  `-- The ${triggers.length} triggers on the tables this writes to are dropped first and`,
  `-- recreated last: the restore replays rows that already existed, and letting`,
  `-- the sync, notification and DM-memory triggers fire on it would re-announce`,
  `-- the whole history and re-queue the learning work for it.`,
  `--`,
  `-- Generated by scripts/generate-issue-difficulty-expert-migration.ts.`,
].join("\n");

const statements: string[] = [
  header,
  "pragma defer_foreign_keys = on;",
  `create table ${lookupTable} (
  ${difficultyColumn} text primary key not null,
  proto_name text not null unique
    check (proto_name = 'ISSUE_DIFFICULTY_' || upper(${difficultyColumn}))
) strict;`,
  ...issueDifficulties.map((difficulty) =>
    `insert into ${lookupTable} (${difficultyColumn}, proto_name)
values ('${difficulty}', '${protoDifficultyName(difficulty)}');`
  ),
  ...triggers.map((row) => `drop trigger if exists ${quote(row.name)};`),
  ...restoreOrder.map(
    (table) =>
      `create table ${quote(backupName(table))} as select * from ${quote(table)};`,
  ),
  // Saved, then nulled: the cascade finds nothing to follow through these
  // columns, so everything hanging below them stays where it is.
  ...nulledLinks.flatMap((link) => [
    saveLinkStatement(link),
    clearLinkStatement(link),
  ]),
  `drop table ${quote(rebuiltTable)};`,
  `${rebuiltParentSql};`,
  // The drop cascades, but not over every edge: some parked descendants reach
  // the parent through `on delete set null`, so their rows are still here.
  // Emptying the parked set outright is what makes the restore below a restore
  // rather than a merge.
  ...[...restoreOrder]
    .reverse()
    .filter((table) => table !== rebuiltTable)
    .map((table) => `delete from ${quote(table)};`),
  ...restoreOrder.map(restoreStatement),
  ...nulledLinks.map(restoreLinkStatement),
  ...[...restoreOrder]
    .reverse()
    .map((table) => `drop table ${quote(backupName(table))};`),
  ...[...nulledLinks]
    .reverse()
    .map((link) => `drop table ${quote(linkBackupName(link))};`),
  ...indexes.map((row) => `${row.sql};`),
  ...triggers.map((row) => `${row.sql};`),
  "pragma defer_foreign_keys = off;",
];

/**
 * Wrangler splits a migration into statements before D1 runs them, and its
 * splitter cannot find the `end` of a trigger body holding more than one
 * `case … end`: it swallows every following statement into one oversized
 * statement that D1 rejects. Ending a file right after each such trigger
 * leaves nothing to swallow, and because files apply in order the resulting
 * schema — including trigger creation order — is identical.
 */
const splitterCanDelimit = (triggerSql: string) =>
  unstable_splitSqlQuery(`${triggerSql};\n\nselect 1;\n`).length === 2;
const unsplittableTriggers = triggers.filter(
  (row) => !splitterCanDelimit(row.sql),
);

const migrationParts: string[][] = [[]];
for (const statement of statements) {
  migrationParts.at(-1)!.push(statement);
  if (unsplittableTriggers.some((row) => statement === `${row.sql};`)) {
    migrationParts.push([]);
  }
}
if (migrationParts.at(-1)!.length === 0) migrationParts.pop();

const partNames = migrationParts.map((_, index) =>
  index === 0
    ? outputName
    : `${String(firstNumber + index).padStart(4, "0")}_${baseName}_part${index + 1}.sql`
);

// ---------------------------------------------------------------------------
// Verification against the replayed schema
// ---------------------------------------------------------------------------

// A rebuild over an empty database proves nothing, so the closure is seeded
// first: a run at every difficulty, descendants on both sides of the cascade,
// and rows behind each nullable link along with the rows those links gate.
const seedTime = "2026-09-08T00:00:00.000Z";
const workflow =
  '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}';
const digest = (character: string) => character.repeat(64);
const fixture = `
insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
values ('gen-owner', 'Gen Owner', 'gen@example.com', 1, '${seedTime}', '${seedTime}');
insert into briar_organizations (id, name, handle, created_at, updated_at)
values ('gen-org', 'Gen Org', 'gen-org', '${seedTime}', '${seedTime}');
insert into briar_organization_members
  (organization_id, user_id, role, created_at, updated_at)
values ('gen-org', 'gen-owner', 'owner', '${seedTime}', '${seedTime}');
insert into briar_projects (
  id, owner_user_id, organization_id, name, agent_token_hash,
  created_at, updated_at
) values (
  'gen-project', 'gen-owner', 'gen-org', 'Gen Project', '${digest("a")}',
  '${seedTime}', '${seedTime}'
);
insert into briar_hunt_runs (
  id, project_id, source, source_key, title, stage, repository,
  ${difficultyColumn}, workflow_snapshot_json,
  started_at, last_event_at, created_at, updated_at
) values
  ('gen-run-easy', 'gen-project', 'issue', 'easy-1', 'Easy', 'queued',
   'acme/repo', 'easy', '${workflow}',
   '${seedTime}', '${seedTime}', '${seedTime}', '${seedTime}'),
  ('gen-run-normal', 'gen-project', 'issue', 'normal-1', 'Normal', 'queued',
   'acme/repo', 'normal', '${workflow}',
   '${seedTime}', '${seedTime}', '${seedTime}', '${seedTime}'),
  ('gen-run-hard', 'gen-project', 'issue', 'hard-1', 'Hard', 'queued',
   'acme/repo', 'hard', '${workflow}',
   '${seedTime}', '${seedTime}', '${seedTime}', '${seedTime}'),
  ('gen-run-unset', 'gen-project', 'issue', 'unset-1', 'Unset', 'queued',
   'acme/repo', null, '${workflow}',
   '${seedTime}', '${seedTime}', '${seedTime}', '${seedTime}');
insert into briar_hunt_events (
  id, run_id, event_key, stage, actor, occurred_at, recorded_at
) values ('gen-event', 'gen-run-hard', 'queued', 'queued', 'tester',
          '${seedTime}', '${seedTime}');
insert into briar_issue_messages (
  id, project_id, run_id, body, created_at, updated_at
) values ('gen-message', 'gen-project', 'gen-run-hard', 'A note',
          '${seedTime}', '${seedTime}');
insert into briar_run_stage_progress (
  run_id, attempt, revision, stage_id, state, started_at, finished_at
) values ('gen-run-hard', 1, 1, 'analysis', 'completed',
          '${seedTime}', '${seedTime}');
insert into briar_agent_transcript_sessions (
  session_id, project_id, run_id, agent_provider, started_at, last_event_at
) values
  ('gen-session-run', 'gen-project', 'gen-run-hard', 'codex',
   '${seedTime}', '${seedTime}'),
  ('gen-session-loose', 'gen-project', null, 'codex',
   '${seedTime}', '${seedTime}');
insert into briar_agent_transcript_segments (
  session_id, first_sequence, last_sequence, object_key, event_count,
  uncompressed_bytes, compressed_bytes, sha256, recorded_at
) values ('gen-session-run', 1, 4, 'gen/segment-1', 4, 100, 50,
          '${digest("b")}', '${seedTime}');
insert into briar_agent_worklog_entries (
  session_id, entry_id, sequence, updated_sequence, entry_type, status,
  started_at, updated_at
) values ('gen-session-run', 'gen-entry', 1, 1, 'message', 'completed',
          '${seedTime}', '${seedTime}');
insert into briar_agent_transcripts (
  session_id, sequence, direction, payload_json, recorded_at
) values ('gen-session-run', 1, 'client', '{}', '${seedTime}');
insert into briar_execution_audit_events (
  id, organization_id, project_id, run_id, action, occurred_at
) values
  ('gen-audit-run', 'gen-org', 'gen-project', 'gen-run-hard', 'dispatched',
   '${seedTime}'),
  ('gen-audit-loose', 'gen-org', 'gen-project', null, 'dispatched',
   '${seedTime}');
insert into briar_log_archives (
  id, project_id, run_id, scope_id, archive_kind, object_key, format_version,
  status, row_count, byte_size, sha256, content_sha256, period_start,
  period_end, created_at, expires_at
) values (
  '${digest("c")}', 'gen-project', 'gen-run-hard', 'gen-run-hard',
  'run_events', 'gen/archive-1', 1, 'complete', 3, 30,
  '${digest("d")}', '${digest("e")}', '${seedTime}', '${seedTime}',
  '${seedTime}', '${seedTime}'
);
insert into briar_channels (
  id, organization_id, slug, name, created_at, updated_at
) values ('gen-channel', 'gen-org', 'gen-channel', 'Gen Channel',
          '${seedTime}', '${seedTime}');
insert into briar_channel_action_proposals (
  id, channel_id, project_id, trigger_message_id, reply_message_id,
  action_type, payload_json, result_run_id, created_at, updated_at
) values (
  'gen-proposal', 'gen-channel', 'gen-project', 'gen-trigger', 'gen-reply',
  'request_issue_create', '{}', 'gen-run-hard', '${seedTime}', '${seedTime}'
);
`;
for (const statement of unstable_splitSqlQuery(fixture)) {
  if (statement.trim()) db.exec(statement);
}

const countOf = (table: string) =>
  db.query<{ count: number }, []>(
    `select count(*) as count from ${quote(table)}`,
  ).get()!.count;
const closureCounts = new Map(
  [...naiveClosure].sort().map((table) => [table, countOf(table)] as const),
);
for (const link of nulledLinks) {
  if (closureCounts.get(link.table) === 0) {
    throw new Error(
      `The fixture leaves ${link.table} empty, so nothing proves ` +
        `${link.column} survives being nulled and restored.`,
    );
  }
}
/** Every row's `(key…, value)` for a link column, as it stands before the run. */
const linkSnapshot = (link: DirectLink) => {
  const key = keyColumnsOf(link.table);
  return JSON.stringify(
    db
      .query<Record<string, unknown>, []>(
        `select ${[...key, link.column].map(quote).join(", ")}
         from ${quote(link.table)}
         order by ${key.map(quote).join(", ")}`,
      )
      .all(),
  );
};
const linksBefore = new Map(
  nulledLinks.map((link) => [linkBackupName(link), linkSnapshot(link)] as const),
);

for (const [index, statement] of statements.entries()) {
  if (!statement.trim() || statement.startsWith("--")) continue;
  try {
    db.exec(statement);
  } catch (error) {
    throw new Error(
      `Generated migration failed at statement ${index + 1} (${
        statement.slice(0, 160)
      }): ${error}`,
    );
  }
}

const leftovers = db
  .query<{ name: string }, []>(
    `select name from sqlite_schema
     where type = 'table'
       and (name like 'briar_difficulty_backup_%'
            or name like 'briar_difficulty_link_%')
     order by name`,
  )
  .all();
if (leftovers.length > 0) {
  throw new Error(`Backup tables survived: ${leftovers.map((r) => r.name).join(", ")}.`);
}
const violations = db.query("pragma foreign_key_check").all();
if (violations.length > 0) {
  throw new Error(`Foreign keys are broken after the rebuild: ${JSON.stringify(violations)}`);
}
for (const [table, before] of closureCounts) {
  const after = countOf(table);
  if (after !== before) {
    throw new Error(`${table} went from ${before} to ${after} rows.`);
  }
}
// Not "came back non-null" but "came back with the value it had": a restore
// that mixed two rows' run ids up would satisfy every count above.
for (const link of nulledLinks) {
  const after = linkSnapshot(link);
  if (after !== linksBefore.get(linkBackupName(link))) {
    throw new Error(
      `${link.table}.${link.column} did not come back unchanged:\n` +
        `  before ${linksBefore.get(linkBackupName(link))}\n  after  ${after}`,
    );
  }
}
const seededDifficulties = db
  .query<{ difficulty: string; proto_name: string }, []>(
    `select ${difficultyColumn} as difficulty, proto_name from ${lookupTable}
     order by ${difficultyColumn}`,
  )
  .all();
const expectedDifficulties = [...issueDifficulties].sort();
if (
  seededDifficulties.map((row) => row.difficulty).join(",") !==
    expectedDifficulties.join(",") ||
  seededDifficulties.map((row) => row.proto_name).join(",") !==
    expectedDifficulties.map(protoDifficultyName).join(",")
) {
  throw new Error(
    `${lookupTable} holds ${JSON.stringify(seededDifficulties)}, not the ` +
      `${expectedDifficulties.length} difficulties the platform advertises.`,
  );
}
const rebuiltSql = db
  .query<{ sql: string }, []>(
    `select sql from sqlite_schema where type = 'table' and name = '${rebuiltTable}'`,
  )
  .get()!.sql;
if (!rebuiltSql.includes(foreignKeyClause)) {
  throw new Error(`${rebuiltTable} did not come back with the lookup foreign key.`);
}
if (new RegExp(`\\b${difficultyColumn}\\s+in\\s*\\(`, "iu").test(rebuiltSql)) {
  throw new Error(`${rebuiltTable} still spells the difficulty list out.`);
}
const survivingIndexes = db
  .query<{ name: string }, []>(
    `select name from sqlite_schema
     where type = 'index' and tbl_name = '${rebuiltTable}' and sql is not null
     order by name`,
  )
  .all()
  .map((row) => row.name);
const expectedIndexes = [...indexes.map((row) => row.name)].sort();
if (survivingIndexes.join(",") !== expectedIndexes.join(",")) {
  throw new Error(
    `Index set changed: ${survivingIndexes.join(", ")} vs ${expectedIndexes.join(", ")}.`,
  );
}
const survivingTriggers = db
  .query<{ name: string }, []>(
    `select name from sqlite_schema where type = 'trigger' order by name`,
  )
  .all()
  .map((row) => row.name);
const missingTriggers = triggers
  .map((row) => row.name)
  .filter((name) => !survivingTriggers.includes(name));
if (missingTriggers.length > 0) {
  throw new Error(`Triggers did not come back: ${missingTriggers.join(", ")}.`);
}

// The foreign key has to do the work the CHECK used to: 'expert' in, anything
// not in the lookup table out. Probed after the counts above, and rolled back.
const probe = (id: string, difficulty: string) =>
  db.run(
    `insert into ${rebuiltTable} (
       id, project_id, source, source_key, title, stage, repository,
       ${difficultyColumn}, workflow_snapshot_json,
       started_at, last_event_at, created_at, updated_at
     ) values (?, 'gen-project', 'issue', ?, 'Probe', 'queued', 'acme/repo',
               ?, ?, ?, ?, ?, ?)`,
    [id, id, difficulty, workflow, seedTime, seedTime, seedTime, seedTime],
  );
probe("gen-probe-expert", "expert");
if (
  db.query<{ difficulty: string }, []>(
    `select ${difficultyColumn} as difficulty from ${rebuiltTable}
     where id = 'gen-probe-expert'`,
  ).get()?.difficulty !== "expert"
) {
  throw new Error("'expert' did not survive the insert.");
}
let refused = false;
try {
  probe("gen-probe-bogus", "legendary");
} catch {
  refused = true;
}
if (!refused) {
  throw new Error("An unknown difficulty was accepted after the rebuild.");
}
db.run(`delete from ${rebuiltTable} where id = 'gen-probe-expert'`);

// ---------------------------------------------------------------------------
// Write, and report what running it would cost
// ---------------------------------------------------------------------------

for (const [index, part] of migrationParts.entries()) {
  const body = [
    ...(index === 0 ? [] : ["pragma defer_foreign_keys = on;"]),
    ...part,
    ...(index === migrationParts.length - 1
      ? []
      : ["pragma defer_foreign_keys = off;"]),
  ];
  await writeFile(
    resolve(migrationsDirectory, partNames[index]!),
    `${body.join("\n\n").replace(/[ \t]+$/gmu, "").trimEnd()}\n`,
  );
}

const unmeasured = [...naiveClosure]
  .filter((table) => !measuredRows.has(table))
  .sort();
const sum = (tables: readonly string[]) =>
  tables.reduce((total, table) => total + (measuredRows.get(table) ?? 0), 0);
const parkedRows = sum([rebuiltTable, ...parked]);
const nulledTableRows = sum([...nulledTables]);
const nulledValues = nulledLinks.reduce(
  (total, link) =>
    total + (measuredLinkValues.get(`${link.table}.${link.column}`) ?? 0),
  0,
);
const gatedRows = sum(gated);
const thousands = (value: number) => value.toLocaleString("en-US");

console.log(
  `Generated ${partNames.join(", ")}: ${statements.length} statements, ` +
    `${indexes.length} indexes, ${triggers.length} triggers.`,
);
console.log("\nRows touched, against the 2026-09-08 production measurement:");
console.log(
  `  parked           ${String(1 + parked.size).padStart(3)} tables  ` +
    `${thousands(parkedRows).padStart(9)} rows  ` +
    `(copied aside, emptied, restored — about ${thousands(parkedRows * 3)} writes)`,
);
console.log(
  `  null-and-restore ${String(nulledLinks.length).padStart(3)} columns ` +
    `${thousands(nulledValues).padStart(9)} values ` +
    `(of ${thousands(nulledTableRows)} rows — saved, nulled, restored)`,
);
console.log(
  `  left alone       ${String(parkedLinks.length).padStart(3)} columns ` +
    `${"".padStart(9)}        ` +
    `(nullable, but their table is parked for another column)`,
);
console.log(
  `  never touched    ${String(gated.length).padStart(3)} tables  ` +
    `${thousands(gatedRows).padStart(9)} rows  ` +
    `(gated behind the nulled columns)`,
);
console.log(
  `  ------------------------------------------------------------------`,
);
console.log(
  `  this migration   ${String(1 + parked.size + nulledTables.size).padStart(3)} tables  ` +
    `${thousands(parkedRows + nulledValues).padStart(9)} rows`,
);
console.log(
  `  a naive rebuild  ${String(naiveClosure.size).padStart(3)} tables  ` +
    `${thousands(sum([...naiveClosure])).padStart(9)} rows`,
);
if (unmeasured.length > 0) {
  console.log(
    `\nNo measurement on hand for ${unmeasured.join(", ")}; ` +
      "the figures above count them as zero.",
  );
}
console.log(
  `\nAdding a fifth difficulty needs no migration: insert it into ` +
    `${lookupTable}.`,
);
