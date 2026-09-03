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

export async function applyD1Migrations(
  db: D1Database,
  options: ApplyD1MigrationsOptions = {},
) {
  await applyCloudflareD1Migrations(
    db,
    selectedMigrations(env.TEST_MIGRATIONS, options),
  );
}
