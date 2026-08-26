import { Database } from "bun:sqlite";

type CheckpointResult = {
  busy: number;
  log: number;
  checkpointed: number;
};

const databasePath = process.argv[2]?.trim();
const checkpointOnly = process.argv[3] === "--checkpoint-only";
if (!databasePath) {
  throw new Error(
    "usage: bun run scripts/verify-d1-test-template.ts <database.sqlite> " +
      "[--checkpoint-only]",
  );
}

const database = new Database(databasePath, { strict: true });
try {
  const checkpoint = database
    .query<CheckpointResult, []>("pragma wal_checkpoint(truncate)")
    .get();
  if (checkpointOnly) {
    process.stdout.write(`${JSON.stringify({ checkpoint })}\n`);
  } else {
    const quickCheckRow = database
      .query<Record<string, string>, []>("pragma quick_check")
      .get();
    const schemaObjects = database
      .query<{ count: number }, []>(
        `select count(*) as count from sqlite_master
         where type in ('table', 'index', 'trigger')
           and name not like 'sqlite_%'`,
      )
      .get();
    const migrations = database
      .query<{ name: string }, []>("select name from d1_migrations order by id")
      .all()
      .map(({ name }) => name);

    process.stdout.write(
      `${JSON.stringify({
        checkpoint,
        quickCheck: quickCheckRow ? Object.values(quickCheckRow)[0] : null,
        schemaObjects: schemaObjects?.count ?? null,
        migrations,
      })}\n`,
    );
  }
} finally {
  database.close();
}
