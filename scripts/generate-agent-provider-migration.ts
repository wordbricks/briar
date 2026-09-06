import { Database } from "bun:sqlite";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { agentProviders } from "../apps/briar/src/lib/agent-provider";
import { agentProviderConstraints } from "./agent-provider-sql-constraints";

/**
 * Writes the migration that adds a provider to the persisted catalog.
 *
 * The catalog lives in `briar_agent_providers` and every provider column is a
 * foreign key into it, so adding a provider is one row. It used to be a rebuild
 * of every constrained table plus its foreign-key descendants — SQLite cannot
 * alter a CHECK constraint in place — which rewrote the whole database and cost
 * millions of D1 row writes per provider. `0204_agent_provider_lookup.sql` was
 * the last of those; see
 * `scripts/generate-agent-provider-lookup-migration.ts`.
 *
 *   bun run scripts/generate-agent-provider-migration.ts <provider> <migration.sql>
 */

const lookupTable = "briar_agent_providers";

const nextProvider = process.argv[2]?.trim();
const outputName = process.argv[3]?.trim();
if (!nextProvider || !/^[a-z][a-z0-9_-]*$/u.test(nextProvider) || !outputName) {
  throw new Error(
    "usage: bun run scripts/generate-agent-provider-migration.ts <provider> <migration.sql>",
  );
}
if (!/^\d+_.+\.sql$/u.test(outputName)) {
  throw new Error(`${outputName} must be named <number>_<name>.sql`);
}

// The provider being added must already exist in briar.types.v1.AgentProvider:
// the proto owns provider identity and every other site derives from it.
if (!agentProviders.some((provider) => provider === nextProvider)) {
  throw new Error(
    `Add ${nextProvider} to briar/types/v1/provider.proto and run contracts:generate first.`,
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

const tableSchemaSql = db
  .query<{ name: string; sql: string }, []>(
    `select name, sql from sqlite_schema where type = 'table' and sql is not null`,
  )
  .all();
if (!tableSchemaSql.some((row) => row.name === lookupTable)) {
  throw new Error(
    `${lookupTable} is missing. Apply 0204_agent_provider_lookup.sql first.`,
  );
}
/**
 * A column that spells the catalog out again would silently reject the new
 * provider, and no insert here could fix it. Catching that at generation time
 * is what keeps the single insert honest.
 */
const spelledOut = agentProviderConstraints(
  tableSchemaSql.map((row) => row.sql).join(";\n"),
).map(({ table, column }) => `${table}.${column}`);
if (spelledOut.length > 0) {
  throw new Error(
    `These columns still carry a provider CHECK list and need a foreign key ` +
      `into ${lookupTable} instead: ${spelledOut.join(", ")}.`,
  );
}
const known = db
  .query<{ provider: string }, []>(`select provider from ${lookupTable}`)
  .all()
  .map((row) => row.provider);
if (known.includes(nextProvider)) {
  throw new Error(`${nextProvider} is already in the persisted catalog.`);
}

const protoName = `AGENT_PROVIDER_${nextProvider.toUpperCase()}`;
const migration = `-- Add ${nextProvider} to the persisted Agent provider catalog.
-- Provider columns are foreign keys into ${lookupTable}, so this row is the
-- whole migration.

insert into ${lookupTable} (provider, proto_name)
values ('${nextProvider}', '${protoName}');
`;

db.exec("begin");
try {
  for (const statement of unstable_splitSqlQuery(migration)) {
    if (statement.trim()) db.exec(statement);
  }
  db.exec("commit");
} catch (error) {
  db.exec("rollback");
  throw error;
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
    `The persisted catalog would be ${seeded.join(", ")}, not the platform ` +
      `catalog ${expected.join(", ")}. Generate the missing providers too.`,
  );
}

await writeFile(outputPath, migration);
console.log(`Generated ${outputName}: ${nextProvider} added to ${lookupTable}.`);
