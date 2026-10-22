import { env } from "cloudflare:workers";
import { asTeamId } from "../../src/lib/entity-ids";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import {
  listHuntRunEvents,
  moveHuntRun,
  recordHuntEvent,
  type HuntEventInput,
} from "./db";
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
  title: "Move detail integration",
  stage,
  eventKey: `move-detail:${stage}:${minute}`,
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

describe("manual move history detail integration", () => {
  const db = env.DB;
  const teamId = asTeamId("7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const now = "2026-09-01T00:00:00.000Z";

  const workflow = normalizeAutoHuntWorkflow({
    version: 2,
    requirements: [],
    stages: [{ id: "implementing", label: "Implement", required: true }],
    execution: { checkpoints: [] },
    completion: { requiredStages: ["implementing"] },
  });

  beforeAll(async () => {
    const ownerId = "72222222-2222-4222-8222-222222222222";
    const workspaceId = "71111111-1111-4111-8111-111111111111";
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${ownerId}', 'Move Owner', 'move-owner@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${workspaceId}', 'Move Workspace', 'move-workspace', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${workspaceId}', '${ownerId}', 'owner', '${now}', '${now}');
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        issue_key_prefix, created_at, updated_at
      ) values (
        '${teamId}', '${ownerId}', '${workspaceId}', 'Move Team',
        '${"d".repeat(64)}', 'MV', '${now}', '${now}'
      );
      insert into briar_project_settings (
        project_id, workflow_json, mandatory_checkpoints_json,
        github_repository_id, github_repository, created_at, updated_at
      ) values (
        '${teamId}', '${JSON.stringify(workflow).replace(/'/g, "''")}', '[]',
        7101, 'example/move-detail', '${now}', '${now}'
      );
    `);
  });

  it("records the source and target state in a manual move's history detail", async () => {
    const runId = await recordHuntEvent(
      db,
      teamId,
      event("queued", 1, {
        sourceKey: "move-detail-fixture",
        eventKey: "move-detail-fixture:queued",
        status: "queued",
      }),
    );
    const moved = await moveHuntRun(db, teamId, {
      runId,
      status: "blocked",
      workflowStage: null,
      requestId: "move-detail-1",
      actor: "briar-app:user-1",
      occurredAt: "2026-10-01T00:00:00.000Z",
    });
    expect(moved.outcome).toBe("moved");
    const events = await listHuntRunEvents(db, teamId, runId);
    const moveEvent = events.find(
      (row) => row.event_key === "admin:move:move-detail-1",
    );
    expect(moveEvent?.detail).toBe(
      "사용자가 작업을 대기에서 차단 상태로 이동했습니다.",
    );
  });
});
