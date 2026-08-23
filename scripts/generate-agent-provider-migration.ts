import { Database } from "bun:sqlite";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";

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

const existingProviders = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "agy",
  "cursor",
];
const providerList = existingProviders.map((value) => `'${value}'`).join(", ");
const expandedProviderList = [...existingProviders, nextProvider]
  .map((value) => `'${value}'`)
  .join(", ");
const affected = db
  .query<{ name: string }, [string]>(
    `select name from sqlite_schema
     where type = 'table' and sql like ? order by name`,
  )
  .all(`%${providerList}%`)
  .map((row) => row.name);
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
     where sql is not null and type in ('index', 'trigger') order by rowid`,
  )
  .all();
const affectedSet = new Set(affected);
const backedPattern = new RegExp(
  [...backed]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|"),
  "u",
);
const indexes = schema.filter(
  (row) => row.type === "index" && backed.has(row.tbl_name),
);
const triggers = schema.filter(
  (row) =>
    row.type === "trigger" &&
    (backed.has(row.tbl_name) || backedPattern.test(row.sql)),
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
    if (!affectedSet.has(table)) return `${sql};`;
    const expanded = sql.replaceAll(providerList, expandedProviderList);
    if (expanded === sql) {
      throw new Error(`Provider constraint not found in ${table}.`);
    }
    return `${expanded};`;
  }),
  ...[...restoreOrder]
    .reverse()
    .map((table) => `delete from ${quote(table)};`),
  ...restoreOrder.map(
    (table) =>
      `insert into ${quote(table)} select * from ${quote(backupName(table))};`,
  ),
  ...indexes.map((row) => `${row.sql};`),
  ...triggers.map((row) => `${row.sql};`),
  ...[...restoreOrder]
    .reverse()
    .map((table) => `drop table ${quote(backupName(table))};`),
  "pragma defer_foreign_keys = off;",
  "",
];
const renderedMigration = `${statements
  .join("\n\n")
  .replace(/[ \t]+$/gmu, "")
  .trimEnd()}\n`;
await writeFile(outputPath, renderedMigration);
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
