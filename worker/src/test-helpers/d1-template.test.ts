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
import {
  createIsolatedTestDatabase,
  prepareD1TestTemplate,
  type IsolatedTestDatabase,
} from "./d1";

const databases: IsolatedTestDatabase[] = [];
const isolatedTemplateTimeout =
  process.env.BRIAR_TRUSTED_MERGE_GROUP_CI === "1" ? 180_000 : undefined;

afterAll(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
});

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
  }, isolatedTemplateTimeout ?? 30_000);

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
  }, isolatedTemplateTimeout ?? 15_000);

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
    isolatedTemplateTimeout ?? 60_000,
  );
});
