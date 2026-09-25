import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { moveProjectIssueRun } from "./issue-control-routes";
import { getHuntRunForProject } from "./db";
import { executeD1Sql } from "./test-helpers/d1-sql";

const teamId = "b1111111-1111-4111-8111-111111111111";
const workspaceId = "b2222222-2222-4222-8222-222222222222";
const ownerId = "b3333333-3333-4333-8333-333333333333";
const editorId = "b4444444-4444-4444-8444-444444444444";
const queuedId = "b5555555-5555-4555-8555-555555555555";
const dispatchedId = "b6666666-6666-4666-8666-666666666666";
const now = "2026-09-25T00:00:00.000Z";

const move = (runId: string, status: "backlog" | "queued", userId = editorId) =>
  moveProjectIssueRun({
    db: env.DB, projectId: teamId, runId, userId,
    request: { requestId: crypto.randomUUID(), status, workflowStage: null },
  });

describe("queued issue editor corrections", () => {
  beforeAll(async () => {
    await executeD1Sql(env.DB, `
      insert into "user" (id,name,email,emailVerified,createdAt,updatedAt) values
      ('${ownerId}','Owner','owner-queued@example.com',1,'${now}','${now}'),
      ('${editorId}','Editor','editor-queued@example.com',1,'${now}','${now}');
      insert into briar_organizations (id,name,handle,created_at,updated_at)
      values ('${workspaceId}','Queued tests','queued-tests','${now}','${now}');
      insert into briar_organization_members (organization_id,user_id,role,created_at,updated_at) values
      ('${workspaceId}','${ownerId}','owner','${now}','${now}'),
      ('${workspaceId}','${editorId}','editor','${now}','${now}');
      insert into briar_teams (id,owner_user_id,organization_id,name,agent_token_hash,created_at,updated_at)
      values ('${teamId}','${ownerId}','${workspaceId}','Queued tests','${"a".repeat(64)}','${now}','${now}');
      insert into briar_project_members (project_id,organization_id,user_id,created_at,updated_at)
      values ('${teamId}','${workspaceId}','${editorId}','${now}','${now}');
      insert into briar_hunt_runs (id,project_id,source,source_key,title,stage,status,
        workflow_stage,workflow_snapshot_json,issue_checkpoints_json,repository,
        started_at,last_event_at,created_at,updated_at) values
      ('${queuedId}','${teamId}','issue','queued-test','Queued test','queued','queued',null,
        '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}',
        '[]','test/queued','${now}','${now}','${now}','${now}'),
      ('${dispatchedId}','${teamId}','issue','dispatched-test','Dispatched test','queued','queued',null,
        '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}',
        '[]','test/queued','${now}','${now}','${now}','${now}');
      update briar_hunt_runs set dispatch_request_id = '${queuedId}' where id = '${dispatchedId}';
    `);
  });

  it("lets an editor return only an unclaimed, undispatched queue entry to backlog", async () => {
    await expect(move(dispatchedId, "backlog")).rejects.toMatchObject({ status: 403 });
    await expect(move(queuedId, "queued")).rejects.toMatchObject({ status: 403 });
    await expect(move(queuedId, "backlog")).resolves.toMatchObject({ outcome: "moved", status: "backlog" });
    expect(await getHuntRunForProject(env.DB, teamId, queuedId)).toMatchObject({ status: "backlog" });
  });

  it("keeps execution changes restricted and reports missing runs", async () => {
    await expect(move(queuedId, "queued")).rejects.toMatchObject({ status: 403 });
    await expect(move("b7777777-7777-4777-8777-777777777777", "backlog"))
      .rejects.toMatchObject({ status: 404 });
    await expect(move(queuedId, "queued", ownerId)).resolves.toMatchObject({ outcome: "moved" });
  });
});
