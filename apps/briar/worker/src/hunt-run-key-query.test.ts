import { env } from "cloudflare:workers";
import { asTeamId } from "../../src/lib/entity-ids";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { listDashboardRunSummaries, recordHuntEvent, type HuntEventInput } from "./db";
import { executeD1Sql } from "./test-helpers/d1-sql";

const BASE_MINUTE = Date.parse("2026-09-01T00:00:00.000Z");
const atMinute = (minute: number) =>
  new Date(BASE_MINUTE + minute * 60_000).toISOString();

const event = (
  stage: HuntEventInput["stage"],
  minute: number,
  overrides: Partial<HuntEventInput> = {},
): HuntEventInput => ({
  source: "issue",
  sourceKey: "integration-run",
  title: "Run key query integration",
  stage,
  eventKey: `run-key-query:${stage}:${minute}`,
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
  structuredResult: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  executionPlan: null,
  progress: null,
  blocked: null,
  ...overrides,
});

describe("run key query integration", () => {
  const db = env.DB;
  const teamId = asTeamId("6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const now = "2026-09-01T00:00:00.000Z";

  const workflow = normalizeAutoHuntWorkflow({
    version: 2,
    requirements: [],
    stages: [{ id: "implementing", label: "Implement", required: true }],
    execution: { checkpoints: [] },
    completion: { requiredStages: ["implementing"] },
  });

  beforeAll(async () => {
    const ownerId = "62222222-2222-4222-8222-222222222222";
    const workspaceId = "61111111-1111-4111-8111-111111111111";
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${ownerId}', 'RunKey Owner', 'runkey-owner@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${workspaceId}', 'RunKey Workspace', 'runkey-workspace', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${workspaceId}', '${ownerId}', 'owner', '${now}', '${now}');
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        issue_key_prefix, created_at, updated_at
      ) values (
        '${teamId}', '${ownerId}', '${workspaceId}', 'RunKey Team',
        '${"c".repeat(64)}', 'BR', '${now}', '${now}'
      );
      insert into briar_project_settings (
        project_id, workflow_json, mandatory_checkpoints_json,
        github_repository_id, github_repository, created_at, updated_at
      ) values (
        '${teamId}', '${JSON.stringify(workflow).replace(/'/g, "''")}', '[]',
        6101, 'example/run-key-query', '${now}', '${now}'
      );
    `);
  });

  it("matches an issue key or bare number query against the run number", async () => {
    const betaId = await recordHuntEvent(
      db,
      teamId,
      event("queued", 1, {
        sourceKey: "run-key-fixture-beta",
        eventKey: "run-key-fixture-beta:queued",
        title: "Beta card",
        status: "queued",
      }),
    );
    await recordHuntEvent(
      db,
      teamId,
      event("queued", 2, {
        sourceKey: "run-key-fixture-alpha",
        eventKey: "run-key-fixture-alpha:queued",
        title: "Alpha card",
        status: "queued",
      }),
    );

    const observedAt = "2027-01-01T00:00:00.000Z";
    const all = await listDashboardRunSummaries(db, teamId, { pageSize: 10 }, observedAt);
    const target = all.rows.find((row) => row.id === betaId);
    expect(target).toBeDefined();
    const targetNumber = target?.run_number;
    expect(typeof targetNumber).toBe("number");

    for (const query of [`BR-${targetNumber}`, `${targetNumber}`]) {
      const found = await listDashboardRunSummaries(
        db,
        teamId,
        { pageSize: 10, query },
        observedAt,
      );
      expect(found.rows.map((row) => row.id)).toContain(betaId);
      expect(
        found.rows.every((row) => row.run_number === targetNumber),
      ).toBe(true);
    }

    const miss = await listDashboardRunSummaries(
      db,
      teamId,
      { pageSize: 10, query: `BR-${Number(targetNumber) + 9_999}` },
      observedAt,
    );
    expect(miss.rows.some((row) => row.id === betaId)).toBe(false);
  });
});
