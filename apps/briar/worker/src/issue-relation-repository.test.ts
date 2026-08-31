import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import type { BriarAuth } from "./auth";
import { getDashboardSyncCursor } from "./dashboard-change-repository";
import { handleDashboardRoute } from "./dashboard-routes";
import { handleIssueCoreRoute } from "./issue-core-routes";
import { readIssueRequest } from "./request-readers";
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
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";
import { transferredIssueRelationStatements } from "./issue-transfer-relations";

describe("issue hierarchy and related issue repository", () => {
  let miniflare: Miniflare;
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
  const apiParent = "dddddddd-dddd-4ddd-8ddd-dddddddddddd1";
  const apiChild = "dddddddd-dddd-4ddd-8ddd-dddddddddddd2";
  const validParentInput = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const viewerId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const now = "2026-09-01T00:00:00.000Z";
  const workflow = JSON.stringify({
    version: 2,
    stages: [{ id: "implementing", label: "Implement", required: true }],
    execution: { checkpoints: [] },
    completion: { requiredStages: ["implementing"] },
  });

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "issue-hierarchy-related",
    });
    miniflare = database.miniflare;
    db = database.db;
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values
        ('${userId}', 'Owner', 'owner@example.com', 1, '${now}', '${now}'),
        ('${viewerId}', 'Viewer', 'viewer@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Workspace', 'workspace', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values
        ('${organizationId}', '${userId}', 'owner', '${now}', '${now}'),
        ('${organizationId}', '${viewerId}', 'viewer', '${now}', '${now}');
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        issue_key_prefix, created_at, updated_at
      ) values
        ('${projectId}', '${userId}', '${organizationId}', 'Project',
         '${"a".repeat(64)}', 'PR', '${now}', '${now}'),
        ('${otherProjectId}', '${userId}', '${organizationId}', 'Other',
         '${"b".repeat(64)}', 'OT', '${now}', '${now}');
      insert into briar_project_members (
        project_id, organization_id, user_id, created_at, updated_at
      ) values ('${projectId}', '${organizationId}', '${viewerId}', '${now}', '${now}');
    `);
    for (const [id, project, number] of [
      [parentA, projectId, 1],
      [parentB, projectId, 2],
      [child, projectId, 3],
      [grandchild, projectId, 4],
      [outside, otherProjectId, 5],
      [transferRun, projectId, 6],
      [transferSibling, projectId, 7],
      [apiParent, projectId, 8],
      [apiChild, projectId, 9],
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

  afterAll(async () => {
    await miniflare.dispose();
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

  it("applies issue write permissions to hierarchy and related APIs", async () => {
    const authFor = (sessionUserId: string) => ({
      api: {
        getSession: async () => ({ user: { id: sessionUserId } }),
      },
    }) as unknown as BriarAuth;
    const invoke = (
      method: "PUT" | "DELETE",
      path: string,
      sessionUserId: string,
    ) => {
      const url = new URL(`https://briar.example${path}`);
      return handleIssueCoreRoute({
        request: new Request(url, { method }),
        url,
        auth: authFor(sessionUserId),
        db,
        attachmentsBucket: {} as R2Bucket,
        archivesBucket: {} as R2Bucket,
      });
    };

    await expect(invoke(
      "PUT",
      `/projects/${projectId}/runs/${apiChild}/parent/${apiParent}`,
      userId,
    )).resolves.toMatchObject({ status: 201 });
    await expect(invoke(
      "PUT",
      `/projects/${projectId}/runs/${apiChild}/related/${apiParent}`,
      userId,
    )).resolves.toMatchObject({ status: 201 });
    await expect(invoke(
      "DELETE",
      `/projects/${projectId}/runs/${apiChild}/related/${apiParent}`,
      viewerId,
    )).rejects.toMatchObject({
      status: 403,
      message: "Issue editing permission required",
    });
    await expect(invoke(
      "DELETE",
      `/projects/${projectId}/runs/${apiChild}/related/${apiParent}`,
      userId,
    )).resolves.toMatchObject({ status: 204 });
    await expect(invoke(
      "DELETE",
      `/projects/${projectId}/runs/${apiChild}/parent`,
      userId,
    )).resolves.toMatchObject({ status: 204 });
  });

  it("accepts an optional parent when creating JSON or multipart issues", async () => {
    const json = await readIssueRequest(new Request(
      "https://briar.example/issues",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "JSON child",
          description: null,
          priority: null,
          difficulty: null,
          assigneeUserId: null,
          parentRunId: validParentInput,
          status: "backlog",
          fullAuto: false,
        }),
      },
    ));
    expect(json.input.parentRunId).toBe(validParentInput);

    const form = new FormData();
    form.set("title", "Multipart child");
    form.set("description", "");
    form.set("priority", "");
    form.set("difficulty", "");
    form.set("assigneeUserId", "");
    form.set("parentRunId", validParentInput);
    form.set("status", "queued");
    form.set("fullAuto", "false");
    const multipart = await readIssueRequest(new Request(
      "https://briar.example/issues",
      {
        method: "POST",
        headers: { "Content-Length": "1024" },
        body: form,
      },
    ));
    expect(multipart.input.parentRunId).toBe(validParentInput);
  });

  it("projects both endpoints in full and delta dashboards", async () => {
    const cursor = await getDashboardSyncCursor(db, projectId);
    await setIssueParent(db, projectId, {
      parentRunId: apiParent,
      childRunId: apiChild,
      createdByUserId: userId,
      createdAt: now,
    });
    await createIssueRelation(db, projectId, {
      runId: apiParent,
      relatedRunId: apiChild,
      createdByUserId: userId,
      createdAt: now,
    });
    const auth = {
      api: { getSession: async () => ({ user: { id: userId } }) },
    } as unknown as BriarAuth;
    const requestDashboard = async (path: string) => {
      const url = new URL(`https://briar.example${path}`);
      const response = await handleDashboardRoute({
        request: new Request(url),
        url,
        auth,
        db,
        archivesBucket: {} as R2Bucket,
      });
      expect(response).toBeInstanceOf(Response);
      return response!.json() as Promise<{
        runs: Array<{
          id: string;
          parent: { id: string } | null;
          subIssues: Array<{ id: string }>;
          relatedIssues: Array<{ id: string }>;
        }>;
      }>;
    };

    for (const body of [
      await requestDashboard(`/projects/${projectId}/dashboard`),
      await requestDashboard(
        `/projects/${projectId}/dashboard/delta?cursor=${cursor}`,
      ),
    ]) {
      expect(body.runs.find((run) => run.id === apiChild)).toMatchObject({
        parent: { id: apiParent },
        relatedIssues: [{ id: apiParent }],
      });
      expect(body.runs.find((run) => run.id === apiParent)).toMatchObject({
        subIssues: [{ id: apiChild }],
        relatedIssues: [{ id: apiChild }],
      });
    }

    await deleteIssueRelation(db, projectId, apiParent, apiChild);
    await deleteIssueParent(db, projectId, apiChild);
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
      resetExecutionApproval: false,
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
