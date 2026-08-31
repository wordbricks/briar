import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { encodeAgentExecutionMetricsJson } from "../../src/lib/agent-execution-metrics";
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
  it("retires corrupt derived metrics and seals future writes", async () => {
    const db = env.DB;
    const canonicalJson = encodeAgentExecutionMetricsJson(canonicalMetrics);
    const excessPropertyJson = JSON.stringify({
      ...canonicalMetrics,
      requestTraceId: "legacy-trace",
    });
    await executeD1Sql(db, `
      create table briar_hunt_runs (
        id text primary key not null,
        execution_metrics_json text
      );
    `);
    await db.batch([
      db.prepare(
        `insert into briar_hunt_runs (id, execution_metrics_json)
         values ('canonical', ?)`,
      ).bind(canonicalJson),
      db.prepare(
        `insert into briar_hunt_runs (id, execution_metrics_json)
         values ('invalid-json', '{not-json')`,
      ),
      db.prepare(
        `insert into briar_hunt_runs (id, execution_metrics_json)
         values ('legacy-shape', ?)`,
      ).bind(excessPropertyJson),
    ]);

    await applyD1Migrations(db, {
      files: ["0164_canonical_agent_execution_metrics_storage.sql"],
    });

    expect((await db.prepare(
      `select id, execution_metrics_json
       from briar_hunt_runs
       order by id`,
    ).all()).results).toEqual([
      { id: "canonical", execution_metrics_json: canonicalJson },
      { id: "invalid-json", execution_metrics_json: null },
      { id: "legacy-shape", execution_metrics_json: null },
    ]);

    await expect(db.prepare(
      `update briar_hunt_runs
       set execution_metrics_json = ?
       where id = 'invalid-json'`,
    ).bind(canonicalJson).run()).resolves.toBeDefined();
    await expect(db.prepare(
      `update briar_hunt_runs
       set execution_metrics_json = ?
       where id = 'canonical'`,
    ).bind(JSON.stringify({
      ...canonicalMetrics,
      durationMs: -1,
    })).run()).rejects.toThrow(/canonical shape/iu);
    await expect(db.prepare(
      `insert into briar_hunt_runs (id, execution_metrics_json)
       values ('future-corrupt', ?)`,
    ).bind(excessPropertyJson).run()).rejects.toThrow(/canonical shape/iu);
  });
});
