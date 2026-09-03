import {
  applyD1Migrations as applyCloudflareD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";

export type ApplyD1MigrationsOptions = {
  files?: readonly string[];
  exclude?: readonly string[];
  through?: string;
};

// Adapted from Wrangler's MIT-licensed D1 splitter. Keeping the small parser
// here avoids loading Wrangler's Node CLI into the workerd test runtime.
function splitD1Sql(sql: string) {
  const statements: string[] = [];
  const compoundStatements: Array<(value: string) => boolean> = [];
  const iterator = sql.trim()[Symbol.iterator]();
  let statement = "";
  let next = iterator.next();

  while (!next.done) {
    const character = next.value;
    if (compoundStatements[0]?.(`${statement}${character}`)) {
      compoundStatements.shift();
    }

    switch (character) {
      case "'":
      case '"':
      case "`":
        statement += character + consumeUntil(iterator, character);
        break;
      case "[":
        statement += character + consumeUntil(iterator, "]");
        break;
      case "-":
        next = iterator.next();
        if (!next.done && next.value === "-") {
          consumeUntil(iterator, "\n");
          statement += "\n";
        } else {
          statement += character;
          continue;
        }
        break;
      case "/":
        next = iterator.next();
        if (!next.done && next.value === "*") {
          consumeUntil(iterator, "*/");
        } else {
          statement += character;
          continue;
        }
        break;
      case ";":
        if (compoundStatements.length === 0) {
          if (statement.trim()) statements.push(statement.trim());
          statement = "";
        } else {
          statement += character;
        }
        break;
      default:
        statement += character;
        break;
    }

    if (/\s(?:begin|case)\s$/iu.test(statement)) {
      compoundStatements.unshift((value) => /\send[;\s]$/iu.test(value));
    }
    next = iterator.next();
  }

  if (statement.trim()) statements.push(statement.trim());
  return statements;
}

function consumeUntil(iterator: Iterator<string>, marker: string) {
  let value = "";
  let next = iterator.next();
  while (!next.done) {
    value += next.value;
    if (value.endsWith(marker)) break;
    next = iterator.next();
  }
  return value;
}

function selectedMigrations(
  migrations: readonly D1Migration[],
  options: ApplyD1MigrationsOptions,
) {
  const included = options.files ? new Set(options.files) : null;
  const excluded = new Set(options.exclude ?? []);
  return migrations.filter((migration) =>
    (!included || included.has(migration.name)) &&
    !excluded.has(migration.name) &&
    (!options.through || migration.name.localeCompare(options.through) <= 0)
  );
}

export function d1MigrationSql(pathOrName: string) {
  const name = pathOrName.split("/").at(-1);
  const migration = env.TEST_MIGRATIONS.find((candidate) =>
    candidate.name === name
  );
  if (!migration) throw new Error(`Unknown D1 migration: ${pathOrName}`);
  return migration.queries.join(";\n");
}

export async function executeD1Sql(db: D1Database, sql: string) {
  for (const statement of splitD1Sql(sql)) {
    await db.prepare(statement).run();
  }
}

// Must match STATEMENT_SENTINEL in scripts/generate-d1-schema-snapshot.ts. The
// generator records the statement boundaries so the snapshot needs no SQL
// parsing here: splitD1Sql mis-handles the `case ... end,` bodies of several
// triggers, and re-parsing 480 KB per test file would waste the time this
// snapshot exists to save.
const SCHEMA_SNAPSHOT_SENTINEL = "-- @statement\n";

/**
 * Loads apps/briar/migrations-snapshot/schema.sql into a fresh test database.
 * The leading chunk is the generated header comment and is skipped.
 */
export async function applyD1SchemaSnapshot(db: D1Database, snapshot: string) {
  const statements = snapshot
    .split(SCHEMA_SNAPSHOT_SENTINEL)
    .slice(1)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length === 0) {
    throw new Error("The D1 schema snapshot contained no statements");
  }
  // One batch per chunk: a single round trip beats ~680 sequential prepares,
  // while the chunking keeps any one batch well inside D1's request limits.
  const chunkSize = 100;
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(
      statements.slice(index, index + chunkSize).map((statement) =>
        db.prepare(statement)
      ),
    );
  }
}

export async function applyD1Migrations(
  db: D1Database,
  options: ApplyD1MigrationsOptions = {},
) {
  await applyCloudflareD1Migrations(
    db,
    selectedMigrations(env.TEST_MIGRATIONS, options),
  );
}
