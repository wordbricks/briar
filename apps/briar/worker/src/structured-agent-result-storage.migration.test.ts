import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { encodeStructuredAgentResultJson } from "../../src/lib/agent-result";
import { parseStructuredResult } from "./agent-result-json";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

const canonicalResult = {
  summary: "Implemented and verified.",
  outcome: "completed",
  importance: "routine",
  urgency: "normal",
  impact: "issue",
  humanActionRequired: false,
  nextAction: null,
  dueAt: null,
} as const;

describe("structured agent result storage cutover", () => {
  it("preserves canonical history and rejects invalid future storage", async () => {
    const db = env.DB;
    const canonicalJson = encodeStructuredAgentResultJson(canonicalResult);
    await executeD1Sql(db, `
      create table briar_hunt_runs (
        id text primary key not null,
        result_summary text,
        structured_result_json text
      );
      create table briar_project_agent_schedule_runs (
        id text primary key not null,
        result_summary text,
        structured_result_json text
      );
    `);
    await db.batch([
      db.prepare(
        `insert into briar_hunt_runs
           (id, result_summary, structured_result_json)
         values ('old-hunt', 'Keep hunt summary', ?)`,
      ).bind(canonicalJson),
      db.prepare(
        `insert into briar_project_agent_schedule_runs
           (id, result_summary, structured_result_json)
         values ('old-schedule', 'Keep schedule summary', '{not-json')`,
      ),
    ]);

    await applyD1Migrations(db, {
      files: ["0167_canonical_structured_agent_result_storage.sql"],
    });

    expect((await db.prepare(
      `select id, result_summary, structured_result_json
       from briar_hunt_runs
       union all
       select id, result_summary, structured_result_json
       from briar_project_agent_schedule_runs
       order by id`,
    ).all()).results).toEqual([
      {
        id: "old-hunt",
        result_summary: "Keep hunt summary",
        structured_result_json: canonicalJson,
      },
      {
        id: "old-schedule",
        result_summary: "Keep schedule summary",
        structured_result_json: null,
      },
    ]);

    await db.prepare(
      `update briar_hunt_runs
       set structured_result_json = ?
       where id = 'old-hunt'`,
    ).bind(canonicalJson).run();
    expect(parseStructuredResult(await db.prepare(
      `select structured_result_json from briar_hunt_runs
       where id = 'old-hunt'`,
    ).first<string>("structured_result_json"))).toEqual(canonicalResult);

    await expect(db.prepare(
      `update briar_project_agent_schedule_runs
       set structured_result_json = '[]'
       where id = 'old-schedule'`,
    ).run()).rejects.toThrow(/bounded JSON object/iu);
    await expect(db.prepare(
      `insert into briar_project_agent_schedule_runs
         (id, result_summary, structured_result_json)
       values ('future-oversized', 'Must reject', ?)`,
    ).bind(JSON.stringify({ summary: "x".repeat(131_072) })).run())
      .rejects.toThrow(/bounded JSON object/iu);

    const semanticallyInvalid = JSON.stringify({ outcome: "unknown" });
    await db.prepare(
      `update briar_project_agent_schedule_runs
       set structured_result_json = ?
       where id = 'old-schedule'`,
    ).bind(semanticallyInvalid).run();
    expect(() => parseStructuredResult(semanticallyInvalid)).toThrow();
  });
});
