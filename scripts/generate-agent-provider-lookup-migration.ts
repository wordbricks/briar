import { Database } from "bun:sqlite";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { agentProviders } from "../apps/briar/src/lib/agent-provider";
import { agentProviderConstraints } from "./agent-provider-sql-constraints";

/**
 * One-shot generator for the migration that moves the persisted Agent provider
 * catalog out of `check (… in (…))` lists and into the `briar_agent_providers`
 * lookup table.
 *
 * Until this migration, adding a provider meant rewriting every constrained
 * column, and SQLite can only change a CHECK constraint by rebuilding the
 * table — which drags in every foreign-key descendant and rewrites the whole
 * database. The two rebuilds that added `vertex` and `pi` wrote 10.4M D1 rows
 * between them, and the cost grew with the database.
 *
 * This is the last such rebuild. Afterwards a provider is one row, and
 * `scripts/generate-agent-provider-migration.ts` emits that single insert.
 *
 * Kept in the repository for provenance: the migration it wrote is 500 KB of
 * generated SQL, and this file is how that SQL is reproduced and checked.
 *
 *   bun run scripts/generate-agent-provider-lookup-migration.ts 0204_agent_provider_lookup.sql
 */

const outputName = process.argv[2]?.trim();
if (!outputName) {
  throw new Error(
    "usage: bun run scripts/generate-agent-provider-lookup-migration.ts <migration.sql>",
  );
}

const lookupTable = "briar_agent_providers";
const protoProviderName = (provider: string) =>
  `AGENT_PROVIDER_${provider.toUpperCase()}`;

const migrationsDirectory = resolve("apps/briar/migrations");
const outputMatch = outputName.match(/^(\d+)_(.+)\.sql$/u);
if (!outputMatch) {
  throw new Error(`${outputName} must be named <number>_<name>.sql`);
}
const firstNumber = Number(outputMatch[1]);
const baseName = outputMatch[2]!;
// The continuation files this run would write, so regenerating over an
// existing migration replays the schema it was written against rather than the
// schema it produced. Their numbers follow `outputName`'s, so they are matched
// by shape instead of by a prefix.
const partPattern = new RegExp(`^\\d+_${baseName}_part\\d+\\.sql$`, "u");

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
     where type = 'table' and name not like 'sqlite_%'`,
  )
  .all();
if (tableRows.some((row) => row.name === lookupTable)) {
  throw new Error(`${lookupTable} already exists; this migration already ran.`);
}

/**
 * The constrained columns, grouped by table. Read out of the schema rather
 * than listed here so a column that was added after this file was written
 * still loses its CHECK list.
 */
const constrainedColumns = new Map<string, string[]>();
for (const row of tableRows) {
  const columns = agentProviderConstraints(row.sql)
    .map(({ column }) => column);
  if (columns.length > 0) constrainedColumns.set(row.name, columns);
}
if (constrainedColumns.size === 0) {
  throw new Error("No provider-constrained tables found.");
}

// ---------------------------------------------------------------------------
// CHECK-clause surgery
// ---------------------------------------------------------------------------

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

type Span = { readonly start: number; readonly end: number };

/** Every `check (…)` clause in `sql`, as spans over the whole clause. */
function checkClauses(sql: string): Span[] {
  const spans: Span[] = [];
  for (const match of sql.matchAll(/\bcheck\s*\(/giu)) {
    const open = match.index + match[0].length - 1;
    spans.push({ start: match.index, end: matchingParen(sql, open) + 1 });
  }
  return spans;
}

/**
 * The clause to delete for one provider constraint: the smallest `check (…)`
 * containing it, plus the `constraint <name>` label in front of it and the
 * separator the deletion would otherwise leave doubled.
 *
 * Throws when the clause carries anything besides the provider list, because
 * deleting it would then also drop a rule this migration is not allowed to
 * touch.
 */
function providerCheckSpan(sql: string, column: string, listStart: number) {
  const enclosing = checkClauses(sql)
    .filter((span) => span.start < listStart && listStart < span.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))
    .at(0);
  if (!enclosing) {
    throw new Error(`No check clause encloses the ${column} provider list.`);
  }
  const body = sql
    .slice(sql.indexOf("(", enclosing.start) + 1, enclosing.end - 1)
    .trim();
  // Both shapes the schema uses, and both are what a foreign key already
  // means: a value must name a provider, and SQLite lets NULL through either
  // way. Anything else in the clause is a rule this migration must not drop.
  const listOnly = new RegExp(
    `^(?:${column}\\s+is\\s+null\\s+or\\s+)?${column}\\s+in\\s*\\([^()]*\\)$`,
    "isu",
  );
  if (!listOnly.test(body)) {
    throw new Error(
      `The check on ${column} carries more than the provider list: ${body}`,
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
  return { start, end };
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** The table's DDL with its provider CHECK lists replaced by lookup-table FKs. */
function rewriteConstrainedTable(sql: string, columns: readonly string[]) {
  const spans = agentProviderConstraints(sql)
    .map((constraint) =>
      providerCheckSpan(sql, constraint.column, constraint.listIndex)
    )
    // Right to left, so an earlier span's offsets survive a later deletion.
    .sort((left, right) => right.start - left.start);

  // Deleting right to left is only safe while the spans stay apart; two that
  // touched would leave the second deletion working from stale offsets.
  for (const [index, span] of spans.entries()) {
    const next = spans[index + 1];
    if (next && next.end > span.start) {
      throw new Error(`Overlapping provider checks at ${next.end}/${span.start}.`);
    }
  }

  let rewritten = sql;
  for (const span of spans) {
    rewritten = rewritten.slice(0, span.start) + rewritten.slice(span.end);
  }
  if (agentProviderConstraints(rewritten).length > 0) {
    throw new Error("A provider check survived the rewrite.");
  }

  const header = /^\s*create\s+table\s+/iu.exec(rewritten);
  if (!header) throw new Error(`Not a create table statement: ${rewritten.slice(0, 60)}`);
  const open = rewritten.indexOf("(", header[0].length);
  const close = matchingParen(rewritten, open);
  let insertAt = close;
  while (insertAt > 0 && /\s/u.test(rewritten[insertAt - 1]!)) insertAt -= 1;
  const references = columns
    .map((column) =>
      `,\n  foreign key (${quote(column)}) references ${lookupTable} (provider)`
    )
    .join("");
  return rewritten.slice(0, insertAt) + references + rewritten.slice(insertAt);
}

// ---------------------------------------------------------------------------
// Rebuild set
// ---------------------------------------------------------------------------

const allTables = new Set(tableRows.map((row) => row.name));
const dependencies = new Map<string, Set<string>>();
for (const table of allTables) {
  dependencies.set(
    table,
    new Set(
      db.query<{ table: string }, []>(
        `pragma foreign_key_list('${table.replaceAll("'", "''")}')`,
      )
        .all()
        .map((row) => row.table)
        .filter((parent) => allTables.has(parent)),
    ),
  );
}

// Dropping a table runs an implicit delete, which fires the `on delete`
// actions of everything pointing at it. Descendants are backed up and restored
// for the same reason the per-provider rebuilds backed them up.
const backed = new Set(constrainedColumns.keys());
let changed = true;
while (changed) {
  changed = false;
  for (const [table, parents] of dependencies) {
    if (backed.has(table)) continue;
    if ([...parents].some((parent) => backed.has(parent))) {
      backed.add(table);
      changed = true;
    }
  }
}

const restoreOrder: string[] = [];
const visiting = new Set<string>();
const visited = new Set<string>();
const visit = (table: string) => {
  if (visited.has(table) || visiting.has(table)) return;
  visiting.add(table);
  for (const parent of [...(dependencies.get(table) ?? [])].sort()) {
    if (backed.has(parent)) visit(parent);
  }
  visiting.delete(table);
  visited.add(table);
  restoreOrder.push(table);
};
for (const table of [...backed].sort()) visit(table);

const schema = db
  .query<
    { type: string; name: string; tbl_name: string; sql: string },
    []
  >(
    `select type, name, tbl_name, sql from sqlite_schema
     where sql is not null and type in ('index', 'trigger', 'view')
     order by rowid`,
  )
  .all();
const indexes = schema.filter(
  (row) => row.type === "index" && backed.has(row.tbl_name),
);
// Every trigger, not only the ones on a rebuilt table: SQLite fires triggers
// in creation order, and dropping a subset would leave the survivors ahead of
// everything recreated here, which several `*_sync` pairs depend on.
const triggers = schema.filter((row) => row.type === "trigger");

// ---------------------------------------------------------------------------
// Views that carry a second copy of the catalog
// ---------------------------------------------------------------------------

const providerViews = schema.filter(
  (row) => row.type === "view" && row.sql.includes("AGENT_PROVIDER_"),
);
const rewrittenViews = new Map<string, string>([
  [
    "briar_execution_worker_healthy_providers",
    `create view briar_execution_worker_healthy_providers as
select worker.id as worker_id,
       health_provider.provider as provider,
       runtime_provider.provider as agent_provider
from briar_execution_workers worker,
     json_each(worker.runtime_proto_json, '$.providerHealth') health
join ${lookupTable} health_provider
  on health_provider.proto_name = json_extract(health.value, '$.provider')
left join ${lookupTable} runtime_provider
  on runtime_provider.proto_name
     = json_extract(worker.runtime_proto_json, '$.agentProvider')
where json_extract(health.value, '$.healthy') = 1`,
  ],
  [
    "briar_invalid_execution_worker_runtime",
    `create view briar_invalid_execution_worker_runtime as
select worker.id
from briar_execution_workers worker
where not (
  json_valid(worker.runtime_proto_json)
  and json_type(worker.runtime_proto_json) = 'object'
  and length(cast(worker.runtime_proto_json as blob)) <= 1048576
  and json_extract(worker.runtime_proto_json, '$.agentProvider') in (
    select proto_name from ${lookupTable}
  )
  and json_type(worker.runtime_proto_json, '$.providerHealth') = 'array'
  and json_array_length(worker.runtime_proto_json, '$.providerHealth')
    = (select count(*) from ${lookupTable})
  and (
    select count(distinct json_extract(health.value, '$.provider'))
    from json_each(worker.runtime_proto_json, '$.providerHealth') health
    where health.type = 'object'
      and json_extract(health.value, '$.provider') in (
        select proto_name from ${lookupTable}
      )
  ) = (select count(*) from ${lookupTable})
  and json_type(worker.runtime_proto_json, '$.capabilities') = 'object'
  and json_type(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = 'array'
  and json_array_length(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = (select count(*) from ${lookupTable})
  and (
    select count(distinct json_extract(capability.value, '$.provider'))
    from json_each(
      worker.runtime_proto_json, '$.capabilities.providerCapabilities'
    ) capability
    where capability.type = 'object'
      and json_extract(capability.value, '$.provider') in (
        select proto_name from ${lookupTable}
      )
  ) = (select count(*) from ${lookupTable})
  and (
    json_type(worker.runtime_proto_json, '$.versions') is null
    or json_type(worker.runtime_proto_json, '$.versions') = 'object'
  )
)`,
  ],
]);
const unhandledViews = providerViews
  .map((row) => row.name)
  .filter((name) => !rewrittenViews.has(name));
if (unhandledViews.length > 0) {
  throw new Error(
    `Views still spell the catalog out: ${unhandledViews.join(", ")}.`,
  );
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const tableSql = new Map(tableRows.map((row) => [row.name, row.sql]));
const backupName = (table: string) => `briar_provider_backup_${table.slice(6)}`;

const statements: string[] = [
  "-- Move the persisted Agent provider catalog into a lookup table.",
  `-- Every 'codex', 'claude', … CHECK list becomes a foreign key into`,
  `-- ${lookupTable}, so a new provider is one row instead of a rebuild of`,
  "-- every constrained table and its foreign-key descendants.",
  "pragma defer_foreign_keys = on;",
  `create table ${lookupTable} (
  provider text primary key not null,
  proto_name text not null unique
    check (proto_name = 'AGENT_PROVIDER_' || upper(provider))
) strict;`,
  ...agentProviders.map((provider) =>
    `insert into ${lookupTable} (provider, proto_name)
values ('${provider}', '${protoProviderName(provider)}');`
  ),
  ...triggers.map((row) => `drop trigger if exists ${quote(row.name)};`),
  ...providerViews.map((row) => `drop view if exists ${quote(row.name)};`),
  ...restoreOrder.map(
    (table) =>
      `create table ${quote(backupName(table))} as select * from ${quote(table)};`,
  ),
  ...[...restoreOrder].reverse().map((table) => `drop table ${quote(table)};`),
  ...restoreOrder.map((table) => {
    const sql = tableSql.get(table);
    if (!sql) throw new Error(`Missing table schema for ${table}.`);
    const columns = constrainedColumns.get(table);
    return `${columns ? rewriteConstrainedTable(sql, columns) : sql};`;
  }),
  // Indexes come back before the rows do: a foreign key resolves against the
  // parent's primary key or a unique index, and restoring rows while that
  // index is missing raises "foreign key mismatch", which
  // `defer_foreign_keys` does not defer.
  ...indexes.map((row) => `${row.sql};`),
  ...[...restoreOrder].reverse().map((table) => `delete from ${quote(table)};`),
  ...restoreOrder.map(
    (table) =>
      `insert into ${quote(table)} select * from ${quote(backupName(table))};`,
  ),
  ...[...restoreOrder]
    .reverse()
    .map((table) => `drop table ${quote(backupName(table))};`),
  ...providerViews.map((row) => `${rewrittenViews.get(row.name)!};`),
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
for (const [index, part] of migrationParts.entries()) {
  // Each file applies as its own migration, so every part opens and closes the
  // deferred-foreign-key window itself.
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

// ---------------------------------------------------------------------------
// Verification against the replayed schema
// ---------------------------------------------------------------------------

db.exec("begin");
try {
  for (const [index, statement] of statements.entries()) {
    if (!statement.trim() || statement.startsWith("--")) continue;
    try {
      db.exec(statement);
    } catch (error) {
      throw new Error(
        `Generated migration failed at statement ${index + 1} (${
          statement.slice(0, 120)
        }): ${error}`,
      );
    }
  }
  db.exec("commit");
} catch (error) {
  db.exec("rollback");
  throw error;
}

const migratedTableSql = db
  .query<{ sql: string }, []>(
    `select sql from sqlite_schema where type = 'table' and sql is not null`,
  )
  .all()
  .map((row) => row.sql)
  .join(";\n");
const survivors = agentProviderConstraints(migratedTableSql)
  .map(({ table, column }) => `${table}.${column}`);
if (survivors.length > 0) {
  throw new Error(`Provider CHECK lists survived: ${survivors.join(", ")}.`);
}
const seeded = db
  .query<{ provider: string }, []>(
    `select provider from ${lookupTable} order by provider`,
  )
  .all()
  .map((row) => row.provider);
const expected = [...agentProviders].sort();
if (seeded.join(",") !== expected.join(",")) {
  throw new Error(
    `Seeded catalog ${seeded.join(", ")} is not the platform catalog.`,
  );
}
for (const [table, columns] of constrainedColumns) {
  const references = new Set(
    db.query<{ table: string; from: string }, []>(
      `pragma foreign_key_list('${table.replaceAll("'", "''")}')`,
    )
      .all()
      .filter((row) => row.table === lookupTable)
      .map((row) => row.from),
  );
  const missing = columns.filter((column) => !references.has(column));
  if (missing.length > 0) {
    throw new Error(
      `${table} lost its provider constraint without gaining a key: ${
        missing.join(", ")
      }.`,
    );
  }
}
for (const view of providerViews) db.query(`select * from ${quote(view.name)}`).all();

console.log(
  `Generated ${partNames.join(", ")}: ${constrainedColumns.size} constrained tables, ` +
    `${backed.size} backed tables, ${triggers.length} triggers, ${providerViews.length} views.`,
);
