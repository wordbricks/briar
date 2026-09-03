import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`;

async function resetD1MigrationDatabase() {
  const session = env.DB.withSession("first-primary");
  const schema = await session.prepare(
    `select type, name
     from sqlite_schema
     where type in ('table', 'view', 'trigger')
       and name not like 'sqlite_%'
       and name not like '_cf_%'`,
  ).all<{ name: string; type: "table" | "trigger" | "view" }>();
  const tableNames = schema.results
    .filter(({ type }) => type === "table")
    .map(({ name }) => name);
  const knownTables = new Set(tableNames);
  const parentsByTable = new Map<string, ReadonlyArray<string>>();
  const dependentCount = new Map(tableNames.map((name) => [name, 0]));
  for (const tableName of tableNames) {
    const foreignKeys = await session
      .prepare(`pragma foreign_key_list(${quoteIdentifier(tableName)})`)
      .all<{ table: string }>();
    const parents = [...new Set(foreignKeys.results
      .map(({ table }) => table)
      .filter((parent) => parent !== tableName && knownTables.has(parent)))];
    parentsByTable.set(tableName, parents);
    for (const parent of parents) {
      dependentCount.set(parent, (dependentCount.get(parent) ?? 0) + 1);
    }
  }
  const ready = tableNames.filter((name) => dependentCount.get(name) === 0);
  const orderedTables: string[] = [];
  while (ready.length > 0) {
    const tableName = ready.shift()!;
    orderedTables.push(tableName);
    for (const parent of parentsByTable.get(tableName) ?? []) {
      const remaining = (dependentCount.get(parent) ?? 0) - 1;
      dependentCount.set(parent, remaining);
      if (remaining === 0) ready.push(parent);
    }
  }
  const cyclicTables = tableNames.filter((name) => !orderedTables.includes(name));
  const statements = [
    ...schema.results
      .filter(({ type }) => type === "trigger" || type === "view")
      .sort((left, right) => left.type.localeCompare(right.type))
      .map(({ name, type }) => `drop ${type} if exists ${quoteIdentifier(name)}`),
    ...[...orderedTables, ...cyclicTables]
      .map((name) => `drop table if exists ${quoteIdentifier(name)}`),
  ];

  try {
    if (statements.length > 0) {
      await session.batch([
        session.prepare("pragma defer_foreign_keys = on"),
        session.prepare("pragma ignore_check_constraints = on"),
        session.prepare("pragma recursive_triggers = off"),
        ...statements.map((statement) => session.prepare(statement)),
      ]);
    }
  } catch (cause) {
    throw new Error("Could not isolate the D1 migration test database", { cause });
  } finally {
    await session.prepare("pragma recursive_triggers = on").run();
    await session.prepare("pragma ignore_check_constraints = off").run();
    await session.prepare("pragma foreign_keys = on").run();
  }
}

export function isolateD1MigrationTests() {
  beforeEach(resetD1MigrationDatabase);
}
