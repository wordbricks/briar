import { describe, expect, it } from "vitest";
import {
  isVirtualTableSql,
  migrationNames,
  partitionVirtualTableMigrations,
} from "./d1-schema-dump";

const reader =
  (virtual: ReadonlySet<string>) => async (name: string) =>
    virtual.has(name)
      ? "create virtual table search using fts5(body);"
      : "create table t(id text);";

describe("isVirtualTableSql", () => {
  it("matches FTS5 virtual tables case-insensitively", () => {
    expect(isVirtualTableSql("CREATE VIRTUAL TABLE x USING fts5(body);")).toBe(true);
    expect(isVirtualTableSql("create virtual table x using fts5(body);")).toBe(true);
  });

  it("ignores ordinary tables and virtual only in prose", () => {
    expect(isVirtualTableSql("create table x(id text);")).toBe(false);
    expect(isVirtualTableSql("-- never use a virtual table here\ncreate table x(id text);"))
      .toBe(false);
  });
});

describe("partitionVirtualTableMigrations", () => {
  it("passes ordinary migrations through in order", async () => {
    const names = ["0001_a.sql", "0002_b.sql"];
    expect(await partitionVirtualTableMigrations(names, reader(new Set())))
      .toEqual({ ordinary: names, virtual: [] });
  });

  it("collects a virtual-table suffix in apply order", async () => {
    const names = ["0001_a.sql", "0002_fts.sql", "0003_fts_more.sql"];
    expect(await partitionVirtualTableMigrations(
      names,
      reader(new Set(["0002_fts.sql", "0003_fts_more.sql"])),
    )).toEqual({
      ordinary: ["0001_a.sql"],
      virtual: ["0002_fts.sql", "0003_fts_more.sql"],
    });
  });

  it("rejects an ordinary migration after a virtual-table one, by name", async () => {
    const names = ["0001_a.sql", "0002_fts.sql", "0003_b.sql"];
    await expect(partitionVirtualTableMigrations(
      names,
      reader(new Set(["0002_fts.sql"])),
    )).rejects.toThrow(/0003_b\.sql.*0002_fts\.sql/s);
  });

  it("keeps the real migration history suffix-clean", async () => {
    // Tripwire: the snapshot appends virtual-table migrations last, so a new
    // ordinary migration must never land after one. Today exactly the message
    // search migration is virtual.
    const { virtual } = await partitionVirtualTableMigrations(await migrationNames());
    expect(virtual).toEqual(["0224_channel_message_search.sql"]);
  });
});
