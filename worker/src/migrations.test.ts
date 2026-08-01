import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it.each([
    "0049_dashboard_delta_sync.sql",
    "0050_hunt_run_event_count.sql",
  ])("keeps each trigger in a separate Wrangler statement: %s", async (name) => {
    const sql = await readFile(resolve("migrations", name), "utf8");
    const statements = unstable_splitSqlQuery(sql);
    const triggerCounts = statements.map(
      (statement) => statement.match(/\bcreate\s+trigger\b/giu)?.length ?? 0,
    );

    expect(Math.max(...triggerCounts)).toBeLessThanOrEqual(1);
    expect(triggerCounts.filter((count) => count === 1)).not.toHaveLength(0);
  });
});
