import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it.each([
    "0049_dashboard_delta_sync.sql",
    "0050_hunt_run_event_count.sql",
    "0053_issue_result_reviews.sql",
    "0055_agent_provider_opencode.sql",
  ])("keeps each trigger in a separate Wrangler statement: %s", async (name) => {
    const sql = await readFile(resolve("migrations", name), "utf8");
    const statements = unstable_splitSqlQuery(sql);
    const triggerCounts = statements.map(
      (statement) => statement.match(/\bcreate\s+trigger\b/giu)?.length ?? 0,
    );

    expect(Math.max(...triggerCounts)).toBeLessThanOrEqual(1);
    expect(triggerCounts.filter((count) => count === 1)).not.toHaveLength(0);
  });

  it("uses D1 transaction-safe foreign-key deferral for table rebuilds", async () => {
    const sql = await readFile(
      resolve("migrations", "0055_agent_provider_opencode.sql"),
      "utf8",
    );

    expect(sql).toMatch(/pragma\s+defer_foreign_keys\s*=\s*on\s*;/iu);
    expect(sql).toMatch(/pragma\s+defer_foreign_keys\s*=\s*off\s*;/iu);
    expect(sql).not.toMatch(/pragma\s+foreign_keys\s*=/iu);
  });

  it("adds workflow v2 progress without rewriting stored snapshots", async () => {
    const sql = await readFile(
      resolve("migrations", "0059_workflow_v2_progress.sql"),
      "utf8",
    );

    expect(sql).toMatch(/alter\s+table\s+briar_hunt_runs\s+add\s+column\s+waiting_checkpoint_key/iu);
    expect(sql).toMatch(/create\s+table\s+briar_run_stage_progress/iu);
    expect(sql).toMatch(/create\s+table\s+briar_run_checkpoint_progress/iu);
    expect(sql).toMatch(/create\s+unique\s+index\s+briar_run_checkpoint_waiting_unique_idx[\s\S]*where\s+state\s*=\s*'waiting'/iu);
    expect(sql).not.toMatch(/\bupdate\s+briar_(project_settings|hunt_runs)\b/iu);
  });
});
