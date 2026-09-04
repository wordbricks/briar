import { Database } from "bun:sqlite";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { agentProviders } from "../apps/briar/src/lib/agent-provider";
import {
  agentProviderConstraints,
  currentSqlProviderList,
} from "./agent-provider-sql-constraints";

const nextProvider = process.argv[2]?.trim();
const outputName = process.argv[3]?.trim();
if (!nextProvider || !/^[a-z][a-z0-9_-]*$/u.test(nextProvider) || !outputName) {
  throw new Error(
    "usage: bun run scripts/generate-agent-provider-migration.ts <provider> <migration.sql>",
  );
}

const migrationsDirectory = resolve("apps/briar/migrations");
const outputPath = resolve(migrationsDirectory, outputName);
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql") && name !== outputName)
  .sort();
const db = new Database(":memory:", { strict: true });
db.exec("pragma foreign_keys = on");
for (const name of migrationNames) {
  const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
  for (const statement of unstable_splitSqlQuery(sql)) {
    if (statement.trim()) db.exec(statement);
  }
}

// The provider being added must already exist in briar.types.v1.AgentProvider:
// the proto owns provider identity and every other site derives from it.
if (!agentProviders.some((provider) => provider === nextProvider)) {
  throw new Error(
    `Add ${nextProvider} to briar/types/v1/provider.proto and run contracts:generate first.`,
  );
}
const tableSchemaSql = db
  .query<{ sql: string }, []>(
    `select sql from sqlite_schema where type = 'table' and sql is not null`,
  )
  .all()
  .map((row) => row.sql)
  .join(";\n");
// Membership is checked against the generated enum; ordering comes from the
// schema so the replacement matches the SQL text it rewrites.
currentSqlProviderList(
  tableSchemaSql,
  agentProviders.filter((provider) => provider !== nextProvider),
);
// Every provider list in a table is rewritten, not just one canonical spelling.
// Tables that ordered their list differently used to be skipped silently, which
// is how columns fell behind the catalog in the first place.
const expandedLists = new Map<string, Map<string, string>>();
for (
  const { table, listText, providers } of agentProviderConstraints(
    tableSchemaSql,
  )
) {
  // Append every catalog provider the list is missing, not just the new one.
  // A list that fell behind an earlier migration would otherwise stay behind
  // forever, silently rejecting a provider the catalog already advertises.
  const missing = agentProviders.filter(
    (provider) => !providers.includes(provider),
  );
  if (missing.length === 0) continue;
  const lists = expandedLists.get(table) ?? new Map<string, string>();
  lists.set(
    listText,
    [...providers, ...missing].map((value) => `'${value}'`).join(", "),
  );
  expandedLists.set(table, lists);
}
const affected = [...expandedLists.keys()].sort();
if (affected.length === 0) throw new Error("No provider-constrained tables found.");

const tableRows = db
  .query<{ name: string; sql: string }, []>(
    `select name, sql from sqlite_schema
     where type = 'table' and name not like 'sqlite_%'`,
  )
  .all();
const allTables = new Set(tableRows.map((row) => row.name));
const dependencies = new Map<string, Set<string>>();
for (const table of allTables) {
  const parents = new Set(
    db.query<{ table: string }, []>(`pragma foreign_key_list('${table.replaceAll("'", "''")}')`)
      .all()
      .map((row) => row.table)
      .filter((parent) => allTables.has(parent)),
  );
  dependencies.set(table, parents);
}

const backed = new Set(affected);
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
    { rowid: number; type: string; name: string; tbl_name: string; sql: string },
    []
  >(
    `select rowid, type, name, tbl_name, sql from sqlite_schema
     where sql is not null and type in ('index', 'trigger', 'view')
     order by rowid`,
  )
  .all();

/**
 * Views that read a provider out of stored ProtoJSON spell it as the generated
 * enum value name (`AGENT_PROVIDER_CODEX`) rather than the platform name, and
 * they assert the provider count. They are a second persisted copy of the
 * catalog, so they are rewritten and recreated alongside the tables.
 */
const protoProviderName = (provider: string) =>
  `AGENT_PROVIDER_${provider.toUpperCase()}`;

function rewriteProviderView(sql: string) {
  const previousCount = agentProviders.length - 1;
  let rewritten = sql;
  // `in (…)` membership lists: append every catalog provider they are missing.
  // Anchored on `in (` so the single names in a `when … then …` arm below are
  // not mistaken for one-element lists.
  rewritten = rewritten.replaceAll(
    /in\s*\(\s*('AGENT_PROVIDER_[A-Z_]+'(?:\s*,\s*'AGENT_PROVIDER_[A-Z_]+')*)\s*\)/gu,
    (match, list: string) => {
      const missing = agentProviders
        .map(protoProviderName)
        .filter((name) => !list.includes(`'${name}'`));
      return missing.length === 0 ? match : match.replace(
        list,
        `${list}, ${missing.map((name) => `'${name}'`).join(", ")}`,
      );
    },
  );
  // `when '<enum>' then '<platform name>'` translation chains.
  rewritten = rewritten.replaceAll(
    /( *)when '(AGENT_PROVIDER_[A-Z_]+)' then '([a-z0-9_-]+)'\n(?! *when 'AGENT_PROVIDER_)/gu,
    (match, indent: string) => {
      const missing = agentProviders.filter(
        (provider) => !rewritten.includes(`'${protoProviderName(provider)}' then`),
      );
      return missing.length === 0 ? match : `${match}${
        missing
          .map((provider) =>
            `${indent}when '${protoProviderName(provider)}' then '${provider}'\n`
          )
          .join("")
      }`;
    },
  );
  // Provider cardinality assertions.
  rewritten = rewritten.replaceAll(
    new RegExp(`= ${previousCount}\\b`, "gu"),
    `= ${agentProviders.length}`,
  );
  if (rewritten === sql) {
    throw new Error(`Provider list not found in view ${sql.slice(0, 60)}.`);
  }
  return rewritten;
}

const providerViews = schema.filter(
  (row) => row.type === "view" && row.sql.includes("AGENT_PROVIDER_"),
);
const backedPattern = new RegExp(
  [...backed]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|"),
  "u",
);
const indexes = schema.filter(
  (row) => row.type === "index" && backed.has(row.tbl_name),
);
/**
 * Every trigger, not only the ones attached to a rebuilt table.
 *
 * SQLite fires triggers in creation order, and dropping a subset leaves the
 * survivors ahead of everything this migration recreates. Recreating all of
 * them in `sqlite_schema` order keeps the firing order the database already
 * had, which several `*_sync` trigger pairs depend on.
 */
const triggers = schema.filter((row) => row.type === "trigger");
// Triggers the rebuild would have dropped anyway, kept only for the assertion
// below that the migration is still rewriting the tables it set out to.
const backedTriggers = triggers.filter(
  (row) => backed.has(row.tbl_name) || backedPattern.test(row.sql),
);
if (backedTriggers.length === 0) {
  throw new Error("No triggers depend on the rebuilt tables.");
}
/**
 * Wrangler splits a migration into statements before D1 runs them, and its
 * splitter cannot find the `end` of a trigger body that holds more than one
 * `case … end` expression: it swallows every following statement into one
 * oversized statement, which D1 rejects with SQLITE_TOOBIG.
 *
 * Such a trigger is still valid SQL and still has to be recreated, so it is
 * emitted at the end of the migration where there is nothing left to swallow.
 */
const splitterCanDelimit = (triggerSql: string) =>
  unstable_splitSqlQuery(`${triggerSql};\n\nselect 1;\n`).length === 2;

const safeTriggers = triggers.filter((row) => splitterCanDelimit(row.sql));
const unsplittableTriggers = triggers.filter(
  (row) => !splitterCanDelimit(row.sql),
);

const tableSql = new Map(tableRows.map((row) => [row.name, row.sql]));
const backupName = (table: string) => `briar_provider_backup_${table.slice(6)}`;
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const statements: string[] = [
  `-- Add ${nextProvider} to every persisted Agent provider constraint.`,
  "-- Generated from the fully migrated schema so columns, indexes, triggers,",
  "-- and dependent rows remain byte-for-byte compatible with the prior schema.",
  "pragma defer_foreign_keys = on;",
  ...triggers.map((row) => `drop trigger if exists ${quote(row.name)};`),
  ...providerViews.map((row) => `drop view if exists ${quote(row.name)};`),
  ...restoreOrder.map(
    (table) =>
      `create table ${quote(backupName(table))} as select * from ${quote(table)};`,
  ),
  ...[...restoreOrder]
    .reverse()
    .map((table) => `drop table ${quote(table)};`),
  ...restoreOrder.map((table) => {
    const sql = tableSql.get(table);
    if (!sql) throw new Error(`Missing table schema for ${table}.`);
    const lists = expandedLists.get(table);
    if (!lists) return `${sql};`;
    let expanded = sql;
    for (const [listText, expandedList] of lists) {
      expanded = expanded.replaceAll(listText, expandedList);
    }
    if (expanded === sql) {
      throw new Error(`Provider constraint not found in ${table}.`);
    }
    return `${expanded};`;
  }),
  // Indexes come back before the rows do. A foreign key is resolved against the
  // parent's primary key or a unique index, so restoring data while the
  // parent's unique index is still missing raises "foreign key mismatch" — a
  // schema error that `defer_foreign_keys` does not defer.
  ...indexes.map((row) => `${row.sql};`),
  ...[...restoreOrder]
    .reverse()
    .map((table) => `delete from ${quote(table)};`),
  ...restoreOrder.map(
    (table) =>
      `insert into ${quote(table)} select * from ${quote(backupName(table))};`,
  ),
  ...[...restoreOrder]
    .reverse()
    .map((table) => `drop table ${quote(backupName(table))};`),
  ...providerViews.map((row) => `${rewriteProviderView(row.sql)};`),
  // Triggers fire in creation order, so they are recreated in the order
  // `sqlite_schema` already had them.
  ...triggers.map((row) => `${row.sql};`),
  "pragma defer_foreign_keys = off;",
  "",
];
const renderedMigration = `${statements
  .join("\n\n")
  .replace(/[ \t]+$/gmu, "")
  .trimEnd()}\n`;

/**
 * Wrangler's splitter cannot delimit a trigger whose body holds more than one
 * `case … end`, so everything after such a trigger is swallowed into one
 * oversized statement that D1 rejects. Ending a migration file right after each
 * of those triggers leaves nothing for it to swallow, and because migration
 * files apply in order the resulting schema is identical to the single file —
 * including the trigger creation order the `*_sync` pairs depend on.
 */
const migrationParts: string[][] = [[]];
for (const statement of statements) {
  migrationParts.at(-1)!.push(statement);
  const endsAPart = unsplittableTriggers.some(
    (row) => statement === `${row.sql};`,
  );
  if (endsAPart) migrationParts.push([]);
}
if (migrationParts.at(-1)!.length === 0) migrationParts.pop();

const outputMatch = outputName.match(/^(\d+)_(.+)\.sql$/u);
if (!outputMatch) {
  throw new Error(`${outputName} must be named <number>_<name>.sql`);
}
const firstNumber = Number(outputMatch[1]);
const baseName = outputMatch[2];
const partNames = migrationParts.map((_, index) =>
  index === 0
    ? outputName
    : `${String(firstNumber + index).padStart(4, "0")}_${baseName}_part${
      index + 1
    }.sql`
);
for (const [index, part] of migrationParts.entries()) {
  // Every part opens and closes the deferred-foreign-key window itself, since
  // each file is applied as its own migration.
  const body = [
    ...(index === 0 ? [] : ["pragma defer_foreign_keys = on;"]),
    ...part.filter((statement) => statement !== ""),
    ...(index === migrationParts.length - 1
      ? []
      : ["pragma defer_foreign_keys = off;"]),
  ];
  await writeFile(
    resolve(migrationsDirectory, partNames[index]!),
    `${body.join("\n\n").replace(/[ \t]+$/gmu, "").trimEnd()}\n`,
  );
}
db.exec("begin");
try {
  for (const [index, statement] of statements.entries()) {
    if (!statement.trim() || statement.startsWith("--")) continue;
    try {
      db.exec(statement);
    } catch (error) {
      throw new Error(
        `Generated migration failed at statement ${index + 1} (${statement.slice(0, 100)}): ${error}`,
      );
    }
  }
  db.exec("commit");
} catch (error) {
  db.exec("rollback");
  throw error;
}
console.log(
  `Generated ${outputName}: ${affected.length} constrained tables, ${backed.size} backed tables, ${triggers.length} triggers.`,
);
