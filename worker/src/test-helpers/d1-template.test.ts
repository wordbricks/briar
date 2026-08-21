import {
  access,
  appendFile,
  chmod,
  mkdir,
  readFile,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
  prepareD1TestTemplate,
  type IsolatedTestDatabase,
} from "./d1";

const databases: IsolatedTestDatabase[] = [];

afterAll(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
});

function observeD1Execution(db: D1Database) {
  const innerStatement = Symbol("inner D1 prepared statement");
  const batchSizes: number[] = [];
  const sequentialStatements: string[] = [];
  const observedDb = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        [innerStatement]: statement,
        run: async () => {
          sequentialStatements.push(sql);
          return statement.run();
        },
      };
    },
    batch(statements: D1PreparedStatement[]) {
      batchSizes.push(statements.length);
      return db.batch(statements.map((statement) => (
        statement as unknown as { [innerStatement]: D1PreparedStatement }
      )[innerStatement]));
    },
  } as unknown as D1Database;
  return { db: observedDb, batchSizes, sequentialStatements };
}

describe("D1 test template isolation", () => {
  it("clones data and schema into independent writable databases", async () => {
    const [first, second] = await Promise.all([
      createIsolatedTestDatabase({ suite: "template-isolation-first" }),
      createIsolatedTestDatabase({ suite: "template-isolation-second" }),
    ]);
    databases.push(first, second);

    expect(first.templateUsed).toBe(true);
    expect(second.templateUsed).toBe(true);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.persistencePath).not.toBe(second.persistencePath);

    await first.db.prepare(
      "create table d1_template_isolation_marker (value text not null)",
    ).run();
    await first.db.prepare(
      `create index d1_template_isolation_index
       on d1_template_isolation_marker (value)`,
    ).run();
    await first.db.prepare(
      `create trigger d1_template_isolation_trigger
       after insert on d1_template_isolation_marker
       begin select new.value; end`,
    ).run();
    await first.db.prepare(
      "insert into d1_template_isolation_marker (value) values ('first')",
    ).run();

    await expect(first.db.prepare(
      "select value from d1_template_isolation_marker",
    ).first("value")).resolves.toBe("first");
    await expect(second.db.prepare(
      `select name from sqlite_master
       where name in (
         'd1_template_isolation_marker',
         'd1_template_isolation_index',
         'd1_template_isolation_trigger'
       ) order by name`,
    ).all()).resolves.toMatchObject({ results: [] });
    await Promise.all([first.dispose(), second.dispose()]);
  }, 30_000);

  it("keeps the source read-only and removes suite clones on disposal", async () => {
    const template = await prepareD1TestTemplate();
    const templateFile = join(
      template.directory,
      "persistence",
      template.manifest.files[0]!.path,
    );
    expect((await stat(templateFile)).mode & 0o222).toBe(0);
    const sourceBefore = await readFile(templateFile);

    const database = await createIsolatedTestDatabase({
      suite: "template-cleanup",
    });
    expect(database.persistencePath).not.toBeNull();
    const persistencePath = database.persistencePath!;
    await database.db.prepare(
      "create table d1_template_cleanup_marker (value integer)",
    ).run();
    await database.dispose();

    await expect(access(persistencePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(templateFile)).resolves.toEqual(sourceBefore);
  });

  it.runIf(process.env.BRIAR_D1_TEST_CACHE_RECOVERY === "1")(
    "detects a corrupted cache entry and atomically regenerates it",
    async () => {
      const template = await prepareD1TestTemplate();
      const firstFile = template.manifest.files[0];
      expect(firstFile).toBeDefined();
      const corruptPath = join(
        template.directory,
        "persistence",
        firstFile!.path,
      );
      await chmod(corruptPath, 0o600);
      await appendFile(corruptPath, "intentional-corruption");
      const abandonedLock = `${template.directory}.lock`;
      await mkdir(abandonedLock);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_100));

      const regenerated = await prepareD1TestTemplate();
      expect(regenerated.fingerprint).toBe(template.fingerprint);
      expect(regenerated.cacheHit).toBe(false);
      expect(regenerated.manifest.files.length).toBeGreaterThan(0);
      const regeneratedFile = join(
        regenerated.directory,
        "persistence",
        regenerated.manifest.files[0]!.path,
      );
      expect((await stat(regeneratedFile)).mode & 0o222).toBe(0);
    },
    60_000,
  );
});

describe("executeD1Sql", () => {
  it("matches sequential execution while preserving order across chunks", async () => {
    const [batched, sequential] = await Promise.all([
      createIsolatedTestDatabase({ suite: "sql-batch-equivalence" }),
      createIsolatedTestDatabase({ suite: "sql-sequential-equivalence" }),
    ]);
    databases.push(batched, sequential);
    const inserts = Array.from({ length: 205 }, (_, index) => (
      `insert into d1_batch_equivalence_source (position, value)
       values (${index}, 'value-${index}');`
    )).join("\n");
    const sql = `
      create table d1_batch_equivalence_source (
        position integer primary key,
        value text not null
      );
      create table d1_batch_equivalence_audit (
        position integer not null,
        old_value text not null,
        new_value text not null
      );
      create trigger d1_batch_equivalence_trigger
      after update on d1_batch_equivalence_source
      begin
        insert into d1_batch_equivalence_audit (
          position,
          old_value,
          new_value
        ) values (new.position, old.value, new.value);
      END;
      ${inserts}
      update d1_batch_equivalence_source
      set value = value || '-updated'
      where position % 17 = 0;
    `;
    const observed = observeD1Execution(batched.db);

    await executeD1Sql(observed.db, sql);
    for (const statement of unstable_splitSqlQuery(sql)) {
      if (statement.trim()) await sequential.db.prepare(statement).run();
    }

    const readState = async (db: D1Database) => ({
      source: (await db.prepare(
        `select position, value from d1_batch_equivalence_source
         order by position`,
      ).all()).results,
      audit: (await db.prepare(
        `select position, old_value, new_value from d1_batch_equivalence_audit
         order by position`,
      ).all()).results,
      schema: (await db.prepare(
        `select type, name, sql from sqlite_master
         where name like 'd1_batch_equivalence_%'
         order by type, name`,
      ).all()).results,
    });
    const [batchedState, sequentialState] = await Promise.all([
      readState(batched.db),
      readState(sequential.db),
    ]);

    expect(batchedState).toEqual(sequentialState);
    expect(observed.batchSizes).toEqual([100, 100, 9]);
    expect(observed.sequentialStatements).toEqual([]);
  }, 30_000);

  it("keeps a deferred foreign-key region in one transaction", async () => {
    const database = await createIsolatedTestDatabase({
      suite: "sql-batch-deferred-foreign-keys",
    });
    databases.push(database);
    const childInserts = Array.from({ length: 120 }, (_, index) => (
      `insert into d1_batch_deferred_child (id, parent_id)
       values (${index}, ${index});`
    )).join("\n");
    const parentInserts = Array.from({ length: 120 }, (_, index) => (
      `insert into d1_batch_deferred_parent (id) values (${index});`
    )).join("\n");
    const observed = observeD1Execution(database.db);

    await executeD1Sql(observed.db, `
      create table d1_batch_deferred_parent (
        id integer primary key
      );
      create table d1_batch_deferred_child (
        id integer primary key,
        parent_id integer not null references d1_batch_deferred_parent (id)
      );
      pragma defer_foreign_keys = on;
      ${childInserts}
      ${parentInserts}
      pragma defer_foreign_keys = off;
    `);

    expect(observed.batchSizes).toEqual([2, 241]);
    expect(observed.sequentialStatements).toHaveLength(1);
    expect(observed.sequentialStatements[0]).toMatch(
      /pragma\s+defer_foreign_keys\s*=\s*off/iu,
    );
    await expect(database.db.prepare(
      "pragma foreign_key_check",
    ).all()).resolves.toMatchObject({ results: [] });
  }, 30_000);

  it("rejects unresolved foreign keys when a deferred batch commits", async () => {
    const database = await createIsolatedTestDatabase({
      suite: "sql-batch-unresolved-foreign-key",
    });
    databases.push(database);
    const observed = observeD1Execution(database.db);

    await expect(executeD1Sql(observed.db, `
      create table d1_batch_unresolved_parent (
        id integer primary key
      );
      create table d1_batch_unresolved_child (
        id integer primary key,
        parent_id integer not null references d1_batch_unresolved_parent (id)
      );
      pragma defer_foreign_keys = on;
      insert into d1_batch_unresolved_child (id, parent_id) values (1, 999);
      pragma defer_foreign_keys = off;
    `)).rejects.toThrow(/foreign key constraint failed/iu);

    expect(observed.batchSizes).toEqual([2, 2]);
    expect(observed.sequentialStatements).toHaveLength(2);
    await expect(database.db.prepare(
      "select id, parent_id from d1_batch_unresolved_child",
    ).all()).resolves.toMatchObject({ results: [] });
    await expect(database.db.prepare(
      "pragma foreign_key_check",
    ).all()).resolves.toMatchObject({ results: [] });
  }, 30_000);

  it("replays a rolled-back failed batch up to the original error", async () => {
    const database = await createIsolatedTestDatabase({
      suite: "sql-batch-error-boundary",
    });
    databases.push(database);
    await database.db.prepare(
      `create table d1_batch_error_boundary (
         id integer primary key,
         value text not null
       )`,
    ).run();
    const observed = observeD1Execution(database.db);

    await expect(executeD1Sql(observed.db, `
      insert into d1_batch_error_boundary (id, value) values (1, 'kept');
      insert into d1_batch_error_boundary (id, value) values (1, 'duplicate');
      insert into d1_batch_error_boundary (id, value) values (2, 'never');
    `)).rejects.toThrow(/unique constraint failed/iu);

    expect(observed.batchSizes).toEqual([3]);
    expect(observed.sequentialStatements).toHaveLength(2);
    expect(observed.sequentialStatements[0]).toContain("'kept'");
    expect(observed.sequentialStatements[1]).toContain("'duplicate'");
    await expect(database.db.prepare(
      "select id, value from d1_batch_error_boundary order by id",
    ).all()).resolves.toMatchObject({
      results: [{ id: 1, value: "kept" }],
    });
  }, 30_000);
});
