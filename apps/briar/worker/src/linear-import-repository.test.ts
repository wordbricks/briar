import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  importLinearHuntRuns,
  type LinearImportRunInput,
} from "./linear-import-repository";
import { executeD1Sql } from "./test-helpers/d1";

describe("two-phase Linear relationship import", () => {
  let db: D1Database;
  const userID = "11111111-1111-4111-8111-111111111111";
  const organizationID = "22222222-2222-4222-8222-222222222222";
  const projectID = "33333333-3333-4333-8333-333333333333";
  const now = "2026-09-01T00:00:00.000Z";

  beforeAll(async () => {
    db = env.DB;
    const workflow = JSON.stringify({
      version: 2,
      stages: [{ id: "implementing", label: "Implement", required: true }],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    });
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${userID}', 'Owner', 'owner@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationID}', 'Workspace', 'workspace', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationID}', '${userID}', 'owner', '${now}', '${now}');
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        issue_key_prefix, created_at, updated_at
      ) values (
        '${projectID}', '${userID}', '${organizationID}', 'Project',
        '${"a".repeat(64)}', 'PR', '${now}', '${now}'
      );
      insert into briar_project_settings (
        project_id, velen_org, data_source, linear_enabled, linear_source,
        linear_team_key, github_repository, workflow_json,
        mandatory_checkpoints_json, created_at, updated_at
      ) values (
        '${projectID}', null, null, 0, null, null, 'example/repository',
        '${workflow.replaceAll("'", "''")}', '[]', '${now}', '${now}'
      );
    `);
  });

  it("links supported relationships after creating all issues and skips duplicates on reimport", async () => {
    await importLinearHuntRuns(
      db,
      projectID,
      "example/repository",
      [issue("outside-existing", "LIN-0", null, [])],
    );
    const inputs = fixtures();
    const first = await importLinearHuntRuns(
      db,
      projectID,
      "example/repository",
      inputs,
    );

    expect(first.imported).toBe(2);
    expect(first.failed).toBe(0);
    expect(first.relations.hierarchy.linked).toBe(1);
    expect(first.relations.related.linked).toBe(2);
    expect(first.relations.related.outsideScope).toBe(1);
    expect(first.relations.dependencies.linked).toBe(1);
    expect(first.relations.unsupported).toEqual({ duplicate: 1, similar: 1 });

    const hierarchy = await db.prepare(
      "select count(*) as count from briar_issue_parent_links where project_id = ?",
    ).bind(projectID).first<{ count: number }>();
    const related = await db.prepare(
      "select count(*) as count from briar_issue_relations where project_id = ?",
    ).bind(projectID).first<{ count: number }>();
    const dependencies = await db.prepare(
      "select count(*) as count from briar_issue_dependencies where project_id = ?",
    ).bind(projectID).first<{ count: number }>();
    expect(hierarchy?.count).toBe(1);
    expect(related?.count).toBe(2);
    expect(dependencies?.count).toBe(1);

    const second = await importLinearHuntRuns(
      db,
      projectID,
      "example/repository",
      inputs,
    );
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.relations.hierarchy.skipped).toBe(1);
    expect(second.relations.related.skipped).toBe(2);
    expect(second.relations.dependencies.skipped).toBe(1);
  });

  function fixtures(): LinearImportRunInput[] {
    return [
      issue("linear-parent", "LIN-1", null, [
        relation("linear-parent", "linear-child", "related"),
        relation("linear-parent", "linear-child", "blocks"),
        relation("linear-parent", "outside-existing", "related"),
        relation("linear-parent", "outside-missing", "related"),
        relation("linear-parent", "linear-child", "duplicate"),
        relation("linear-parent", "linear-child", "similar"),
      ]),
      issue("linear-child", "LIN-2", "linear-parent", [
        relation("linear-child", "linear-parent", "related"),
      ]),
    ];
  }

  function issue(
    issueID: string,
    identifier: string,
    parentIssueId: string | null,
    relations: LinearImportRunInput["relations"],
  ): LinearImportRunInput {
    return {
      sourceKey: `linear:${issueID}`,
      title: identifier,
      description: null,
      priority: 2,
      status: "queued",
      workflowStage: null,
      tracker: {
        provider: "linear",
        issueId: issueID,
        identifier,
        url: `https://linear.app/issue/${identifier}`,
        state: "Todo",
      },
      sourceCreatedAt: now,
      parentIssueId,
      relations,
    };
  }

  function relation(sourceIssueId: string, targetIssueId: string, type: string) {
    return { sourceIssueId, targetIssueId, type };
  }
});
