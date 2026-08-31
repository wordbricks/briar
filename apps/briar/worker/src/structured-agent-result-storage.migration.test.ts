import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { encodeStructuredAgentResultJson } from "../../src/lib/agent-result";
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
  it("retires corrupt optional metadata and seals both storage boundaries", async () => {
    const db = env.DB;
    const canonicalJson = encodeStructuredAgentResultJson(canonicalResult);
    const invalidOutcomeJson = JSON.stringify({
      ...canonicalResult,
      outcome: "unknown",
    });
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
         values ('corrupt-hunt', 'Keep hunt summary', '{not-json')`,
      ),
      db.prepare(
        `insert into briar_project_agent_schedule_runs
           (id, result_summary, structured_result_json)
         values ('corrupt-schedule', 'Keep schedule summary', ?)`,
      ).bind(invalidOutcomeJson),
      db.prepare(
        `insert into briar_hunt_runs
           (id, result_summary, structured_result_json)
         values ('canonical-hunt', 'Keep canonical summary', ?)`,
      ).bind(canonicalJson),
    ]);

    await applyD1Migrations(db, {
      files: ["0163_canonical_structured_agent_result_storage.sql"],
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
        id: "canonical-hunt",
        result_summary: "Keep canonical summary",
        structured_result_json: canonicalJson,
      },
      {
        id: "corrupt-hunt",
        result_summary: "Keep hunt summary",
        structured_result_json: null,
      },
      {
        id: "corrupt-schedule",
        result_summary: "Keep schedule summary",
        structured_result_json: null,
      },
    ]);

    await expect(db.prepare(
      `update briar_hunt_runs
       set structured_result_json = '{}'
       where id = 'corrupt-hunt'`,
    ).run()).rejects.toThrow(/canonical shape/iu);
    await expect(db.prepare(
      `insert into briar_project_agent_schedule_runs
         (id, result_summary, structured_result_json)
       values ('future-corrupt', 'Must reject', ?)`,
    ).bind(invalidOutcomeJson).run()).rejects.toThrow(/canonical shape/iu);
  });
});
