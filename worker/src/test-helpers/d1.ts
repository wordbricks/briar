import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";

type ApplyD1MigrationsOptions = {
  files?: readonly string[];
  exclude?: readonly string[];
};

export async function executeD1Sql(db: D1Database, sql: string) {
  for (const statement of unstable_splitSqlQuery(sql)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
}

export async function applyD1Migrations(
  db: D1Database,
  options: ApplyD1MigrationsOptions = {},
) {
  const excluded = new Set(options.exclude ?? []);
  const files = options.files
    ? [...options.files]
    : (await readdir(resolve("migrations")))
      .filter((name) => /^\d+_.*\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    if (excluded.has(file)) continue;
    const sql = await readFile(resolve("migrations", file), "utf8");
    await executeD1Sql(db, sql);
  }
}
