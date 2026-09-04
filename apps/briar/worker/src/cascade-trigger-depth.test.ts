import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileDepth,
  D1_TRIGGER_DEPTH_LIMIT,
  parseSchema,
} from "./test-helpers/cascade-trigger-depth";

const snapshotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations-snapshot",
  "schema.sql",
);

describe("cascade trigger depth", () => {
  const schema = parseSchema(readFileSync(snapshotPath, "utf8"));

  it("keeps every statement inside D1's trigger nesting limit", () => {
    const worst: { statement: string; depth: number }[] = [];
    for (const table of schema.tables) {
      const columns = schema.columns.get(table) ?? null;
      for (
        const [event, changed] of [
          ["delete", null],
          ["insert", null],
          ["update", columns],
        ] as const
      ) {
        const depth = compileDepth(schema, table, event, changed);
        worst.push({ statement: `${event} ${table}`, depth });
      }
    }
    worst.sort((left, right) => right.depth - left.depth);
    // D1 refuses to prepare a statement whose chain of trigger programs is
    // deeper than this, so the budget is the limit itself rather than a
    // comfortable margin: `delete from briar_projects` and `delete from "user"`
    // already sit on it. A new trigger layer on an erasure path has to be
    // folded into an existing one instead of stacked on top of it, and a
    // migration that rebuilds tables has to be re-measured, because reordering
    // `sqlite_schema` alone can move these numbers by two.
    expect(
      worst.filter((entry) => entry.depth > D1_TRIGGER_DEPTH_LIMIT),
    ).toEqual([]);
    // These two sit exactly on the limit today, so this list is the early
    // warning the number itself cannot give: a third entry means some erasure
    // path grew a level and is one migration away from failing in production.
    expect(
      worst
        .filter((entry) => entry.depth === D1_TRIGGER_DEPTH_LIMIT)
        .map((entry) => entry.statement)
        .sort(),
    ).toEqual(["delete briar_projects", "delete user"]);
  });

  it("still reads the schema it is guarding", () => {
    expect(schema.tables.length).toBeGreaterThan(100);
    expect([...schema.triggersOf.values()].flat().length).toBeGreaterThan(300);
    expect(schema.referencesTo.get("briar_projects")?.length)
      .toBeGreaterThan(10);
  });
});
