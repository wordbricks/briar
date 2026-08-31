import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createIssueRelation,
  deleteIssueParent,
  deleteIssueRelation,
  listIssueHierarchy,
  listIssueHierarchyByRunIds,
  listIssueRelations,
  listIssueRelationsByRunIds,
  setIssueParent,
} from "./issue-relation-repository";
import { executeD1Sql } from "./test-helpers/d1";
import { transferredIssueRelationStatements } from "./issue-transfer-relations";

describe("issue hierarchy and related issue repository", () => {
  let db: D1Database;
  const userId = "11111111-1111-4111-8111-111111111111";
  const organizationId = "22222222-2222-4222-8222-222222222222";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const otherProjectId = "44444444-4444-4444-8444-444444444444";
  const parentA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const parentB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const child = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
  const grandchild = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
  const outside = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  const transferRun = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const transferSibling = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
  const now = "2026-09-01T00:00:00.000Z";
  const workflow = JSON.stringify({
    version: 2,
    stages: [{ id: "implementing", label: "Implement", required: true }],
    execution: { checkpoints: [] },
    completion: { requiredStages: ["implementing"] },
  });

  beforeAll(async () => {
    db = env.DB;
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${userId}', 'Owner', 'owner@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Workspace', 'workspace', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', '${userId}', 'owner', '${now}', '${now}');
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        issue_key_prefix, created_at, updated_at
      ) values
        ('${projectId}', '${userId}', '${organizationId}', 'Project',
         '${"a".repeat(64)}', 'PR', '${now}', '${now}'),
        ('${otherProjectId}', '${userId}', '${organizationId}', 'Other',
         '${"b".repeat(64)}', 'OT', '${now}', '${now}');
    `);
    for (const [id, project, number] of [
      [parentA, projectId, 1],
      [parentB, projectId, 2],
      [child, projectId, 3],
      [grandchild, projectId, 4],
      [outside, otherProjectId, 5],
      [transferRun, projectId, 6],
      [transferSibling, projectId, 7],
    ] as const) {
      await db.prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
           repository, run_number, started_at, last_event_at, created_at,
           updated_at
         ) values (?, ?, 'issue', ?, ?, 'queued', 'backlog', null, ?, '[]',
                   'example/repository', ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        project,
        `issue:${id}`,
        `Issue ${number}`,
        workflow,
        number,
        now,
        now,
        now,
        now,
      ).run();
    }
  });

  it("keeps one parent per child and rejects self, cycles, and other projects", async () => {
    await expect(setIssueParent(db, projectId, {
      parentRunId: parentA,
      childRunId: child,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("created");
    await expect(setIssueParent(db, projectId, {
      parentRunId: parentA,
      childRunId: child,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("already_exists");
    await expect(setIssueParent(db, projectId, {
      parentRunId: parentB,
      childRunId: child,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("updated");
    await expect(setIssueParent(db, projectId, {
      parentRunId: child,
      childRunId: grandchild,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("created");
    await expect(setIssueParent(db, projectId, {
      parentRunId: grandchild,
      childRunId: child,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("cycle");
    await expect(setIssueParent(db, projectId, {
      parentRunId: child,
      childRunId: child,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("cycle");
    await expect(setIssueParent(db, projectId, {
      parentRunId: outside,
      childRunId: child,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("not_found");

    const links = await listIssueHierarchy(db, projectId);
    expect(links).toHaveLength(2);
    expect(links.find((link) => link.child_run_id === child))
      .toMatchObject({ parent_run_id: parentB });
    await expect(
      listIssueHierarchyByRunIds(db, projectId, [grandchild]),
    ).resolves.toEqual([
      expect.objectContaining({
        parent_run_id: child,
        child_run_id: grandchild,
      }),
    ]);
  });

  it("stores a symmetric related pair once and removes it from either side", async () => {
    await expect(createIssueRelation(db, projectId, {
      runId: parentA,
      relatedRunId: child,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("created");
    await expect(createIssueRelation(db, projectId, {
      runId: child,
      relatedRunId: parentA,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("already_exists");
    await expect(createIssueRelation(db, projectId, {
      runId: parentA,
      relatedRunId: parentA,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("ineligible");
    await expect(createIssueRelation(db, projectId, {
      runId: parentA,
      relatedRunId: outside,
      createdByUserId: userId,
      createdAt: now,
    })).resolves.toBe("not_found");

    await expect(listIssueRelations(db, projectId)).resolves.toHaveLength(1);
    await expect(
      listIssueRelationsByRunIds(db, projectId, [child]),
    ).resolves.toEqual([
      expect.objectContaining({
        first_run_id: parentA,
        second_run_id: child,
      }),
    ]);
    await expect(
      deleteIssueRelation(db, projectId, child, parentA),
    ).resolves.toBe(true);
    await expect(listIssueRelations(db, projectId)).resolves.toEqual([]);
  });

  it("emits dashboard changes for both endpoints and cascades on deletion", async () => {
    await db.prepare("delete from briar_dashboard_changes").run();
    await createIssueRelation(db, projectId, {
      runId: parentA,
      relatedRunId: parentB,
      createdByUserId: userId,
      createdAt: now,
    });
    const changes = await db.prepare(
      `select entity_id from briar_dashboard_changes
       where project_id = ? and entity_type = 'run'
       order by entity_id`,
    ).bind(projectId).all<{ entity_id: string }>();
    expect(changes.results.map((change) => change.entity_id)).toEqual([
      parentA,
      parentB,
    ]);

    await db.prepare("delete from briar_hunt_runs where id = ?")
      .bind(parentB).run();
    await expect(listIssueRelations(db, projectId)).resolves.toEqual([]);
    await expect(listIssueHierarchy(db, projectId)).resolves.toEqual([
      expect.objectContaining({
        parent_run_id: child,
        child_run_id: grandchild,
      }),
    ]);
    await expect(deleteIssueParent(db, projectId, grandchild)).resolves.toBe(true);
  });

  it("cleans hierarchy and related links when an issue moves projects", async () => {
    await setIssueParent(db, projectId, {
      parentRunId: transferSibling,
      childRunId: transferRun,
      createdByUserId: userId,
      createdAt: now,
    });
    await createIssueRelation(db, projectId, {
      runId: transferRun,
      relatedRunId: transferSibling,
      createdByUserId: userId,
      createdAt: now,
    });
    await db.prepare(
      "update briar_hunt_runs set project_id = ? where id = ?",
    ).bind(otherProjectId, transferRun).run();
    await db.batch(await transferredIssueRelationStatements(db, {
      sourceProjectId: projectId,
      targetProjectId: otherProjectId,
      runId: transferRun,
      observedAt: now,
    }));

    await expect(db.prepare(
      `select count(*) as count from briar_issue_parent_links
       where parent_run_id = ? or child_run_id = ?`,
    ).bind(transferRun, transferRun).first<number>("count")).resolves.toBe(0);
    await expect(db.prepare(
      `select count(*) as count from briar_issue_relations
       where first_run_id = ? or second_run_id = ?`,
    ).bind(transferRun, transferRun).first<number>("count")).resolves.toBe(0);
  });

  it("rejects invalid direct writes at the database boundary", async () => {
    await expect(db.prepare(
      `insert into briar_issue_relations (
         project_id, first_run_id, second_run_id, relation_type, created_at
       ) values (?, ?, ?, 'related', ?)`,
    ).bind(projectId, parentA, outside, now).run()).rejects.toThrow(
      /endpoints must belong to the project/iu,
    );
    await expect(db.prepare(
      `insert into briar_issue_parent_links (
         project_id, parent_run_id, child_run_id, created_at
       ) values (?, ?, ?, ?)`,
    ).bind(projectId, parentA, parentA, now).run()).rejects.toThrow();
  });
});
