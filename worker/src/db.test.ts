import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HuntEventInput } from "./db";
import {
  HuntTransitionError,
  recordHuntEvent,
  recordQaResult,
} from "./db";

const projectId = "11111111-1111-4111-8111-111111111111";
const baseTime = Date.parse("2026-07-21T00:00:00Z");
const atMinute = (minute: number) =>
  new Date(baseTime + minute * 60_000).toISOString();
const executeSql = async (db: D1Database, sql: string) => {
  for (const statement of sql.split(/;\s*(?:\n|$)/u)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
};

const event = (
  stage: HuntEventInput["stage"],
  minute: number,
  overrides: Partial<HuntEventInput> = {},
): HuntEventInput => ({
  source: "issue",
  sourceKey: "integration-run",
  title: "D1 lifecycle integration",
  stage,
  eventKey: `integration:${stage}:${minute}`,
  occurredAt: atMinute(minute),
  actor: "vitest",
  repository: "example/repository",
  detail: `${stage} detail`,
  priority: null,
  branch: "codex/integration",
  commitSha: "abcdef1",
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
  ...overrides,
});

describe("Briar Auto Hunt D1 lifecycle", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-test" },
  });
  let db: D1Database;

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    for (const migration of [
      "migrations/0001_briar.sql",
      "migrations/0002_remove_repository_path.sql",
      "migrations/0003_generalize_auto_hunt.sql",
    ]) {
      await executeSql(db, await readFile(resolve(migration), "utf8"));
    }
    await executeSql(db, `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_projects (
        id, owner_user_id, name, agent_token_hash, created_at, updated_at
      ) values (
        '${projectId}', 'owner', 'Example',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, created_at, updated_at
      ) values ('${projectId}', 'example', 0, '${atMinute(0)}', '${atMinute(0)}');
    `);
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("enforces forward stages, QA gates, and a completion summary", async () => {
    const runId = await recordHuntEvent(db, projectId, event("queued", 1));
    expect(runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await recordHuntEvent(db, projectId, event("implementing", 2));
    await expect(
      recordHuntEvent(db, projectId, event("analyzing", 3)),
    ).rejects.toBeInstanceOf(HuntTransitionError);

    await recordHuntEvent(
      db,
      projectId,
      event("staging_qa", 4, { qaStatus: "pending", targetSha: "abcdef1" }),
    );
    expect(
      await recordQaResult(db, projectId, {
        runId,
        environment: "staging",
        result: "passed",
        actor: "vitest",
        observedAt: atMinute(5),
        detail: "staging verified",
      }),
    ).toBe("passed");
    await recordHuntEvent(
      db,
      projectId,
      event("production_qa", 6, { qaStatus: "pending", targetSha: "abcdef1" }),
    );
    await expect(
      recordHuntEvent(
        db,
        projectId,
        event("completed", 7, { resultSummary: "too early" }),
      ),
    ).rejects.toThrow("Production QA");
    expect(
      await recordQaResult(db, projectId, {
        runId,
        environment: "production",
        result: "passed",
        actor: "vitest",
        observedAt: atMinute(8),
        detail: "production verified",
      }),
    ).toBe("passed");
    await expect(
      recordHuntEvent(db, projectId, event("completed", 9)),
    ).rejects.toThrow("result summary");
    await recordHuntEvent(
      db,
      projectId,
      event("completed", 10, { resultSummary: "Production verified" }),
    );

    const run = await db
      .prepare(
        `select stage, staging_qa_status, production_qa_status, result_summary
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        staging_qa_status: string;
        production_qa_status: string;
        result_summary: string;
      }>();
    expect(run).toEqual({
      stage: "completed",
      staging_qa_status: "passed",
      production_qa_status: "passed",
      result_summary: "Production verified",
    });
  });
});
