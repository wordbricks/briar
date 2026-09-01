import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { encodeAgentExecutionMetricsJson } from "../../src/lib/agent-execution-metrics";
import { parseExecutionMetrics } from "./agent-result-json";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

const canonicalMetrics = {
  inputTokens: 1_000,
  outputTokens: 250,
  cacheReadTokens: 800,
  cacheWriteTokens: null,
  reasoningOutputTokens: 100,
  totalTokens: 1_250,
  durationMs: 90_000,
} as const;

describe("agent execution metrics storage cutover", () => {
  it("preserves canonical telemetry and rejects invalid future storage", async () => {
    const db = env.DB;
    const canonicalJson = encodeAgentExecutionMetricsJson(canonicalMetrics);
    await executeD1Sql(db, `
      create table briar_hunt_runs (
        id text primary key not null,
        execution_metrics_json text
      );
    `);
    await db.batch([
      db.prepare(
        `insert into briar_hunt_runs (id, execution_metrics_json)
         values ('old-canonical', ?)`,
      ).bind(canonicalJson),
      db.prepare(
        `insert into briar_hunt_runs (id, execution_metrics_json)
         values ('old-corrupt', '{not-json')`,
      ),
    ]);

    await applyD1Migrations(db, {
      files: ["0163_canonical_agent_execution_metrics_storage.sql"],
    });

    expect((await db.prepare(
      `select id, execution_metrics_json
       from briar_hunt_runs
       order by id`,
    ).all()).results).toEqual([
      { id: "old-canonical", execution_metrics_json: canonicalJson },
      { id: "old-corrupt", execution_metrics_json: null },
    ]);

    await db.prepare(
      `update briar_hunt_runs
       set execution_metrics_json = ?
       where id = 'old-canonical'`,
    ).bind(canonicalJson).run();
    expect(parseExecutionMetrics(await db.prepare(
      `select execution_metrics_json from briar_hunt_runs
       where id = 'old-canonical'`,
    ).first<string>("execution_metrics_json"))).toEqual(canonicalMetrics);

    await expect(db.prepare(
      `update briar_hunt_runs
       set execution_metrics_json = '{not-json'
       where id = 'old-corrupt'`,
    ).run()).rejects.toThrow(/bounded JSON object/iu);
    await expect(db.prepare(
      `insert into briar_hunt_runs (id, execution_metrics_json)
       values ('future-oversized', ?)`,
    ).bind(JSON.stringify({ value: "x".repeat(4_096) })).run())
      .rejects.toThrow(/bounded JSON object/iu);

    const semanticallyInvalid = JSON.stringify({ durationMs: -1 });
    await db.prepare(
      `update briar_hunt_runs
       set execution_metrics_json = ?
       where id = 'old-corrupt'`,
    ).bind(semanticallyInvalid).run();
    expect(() => parseExecutionMetrics(semanticallyInvalid)).toThrow();
  });
});
