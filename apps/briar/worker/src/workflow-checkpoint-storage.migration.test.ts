import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { recordHuntEvent } from "./db";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("workflow checkpoint storage migration", () => {
  it("fails closed for execution policy, removes bad user defaults, and guards writes", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    const workflow = JSON.stringify({
      version: 2,
      requirements: [],
      stages: [{ id: "analyzing", label: "Analyze", required: true }],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["analyzing"] },
    });
    const projectCheckpoint = JSON.stringify([{
      key: "project-before-analyzing",
      stage: "analyzing",
      position: "before",
    }]);
    const userCheckpoint = JSON.stringify([{
      key: "user-after-analyzing",
      stage: "analyzing",
      position: "after",
    }]);
    const issueCheckpoint = JSON.stringify([{
      key: "issue-before-analyzing",
      stage: "analyzing",
      position: "before",
    }]);

    await applyD1Migrations(db, {
      through: "0159_canonical_archive_related_object_keys.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values
        ('checkpoint-owner', 'Checkpoint Owner', 'owner@example.com', 1,
         '${now}', '${now}'),
        ('checkpoint-user', 'Checkpoint User', 'user@example.com', 1,
         '${now}', '${now}'),
        ('checkpoint-invalid-user', 'Invalid User', 'invalid@example.com', 1,
         '${now}', '${now}');
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'checkpoint-org', 'Checkpoint Org', 'checkpoint-org', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'checkpoint-project', 'checkpoint-owner', 'checkpoint-org',
        'Checkpoint Project', '${"a".repeat(64)}', '${now}', '${now}'
      );
    `);
    await db.prepare(
      `insert into briar_project_settings (
         project_id, workflow_json, mandatory_checkpoints_json,
         created_at, updated_at
       ) values ('checkpoint-project', ?, ?, ?, ?)`,
    ).bind(workflow, projectCheckpoint, now, now).run();
    await db.prepare(
      `insert into briar_user_workflow_checkpoint_defaults (
         project_id, user_id, checkpoints_json, created_at, updated_at
       ) values
         ('checkpoint-project', 'checkpoint-user', ?, ?, ?),
         ('checkpoint-project', 'checkpoint-invalid-user', ?, ?, ?)`,
    ).bind(
      userCheckpoint,
      now,
      now,
      JSON.stringify([{
        key: "user-before-analyzing",
        stage: "analyzing",
        position: "before",
        legacy: true,
      }]),
      now,
      now,
    ).run();
    const runId = await recordHuntEvent(db, "checkpoint-project", {
      source: "issue",
      sourceKey: "checkpoint-migration",
      title: "Checkpoint migration",
      stage: "queued",
      status: "backlog",
      workflowStage: null,
      eventKey: "checkpoint-migration:backlog",
      occurredAt: now,
      actor: "migration-test",
      repository: "Checkpoint Project",
      detail: null,
      priority: null,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription: null,
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: now,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: null,
    });

    const legacyProjectCheckpoint = JSON.stringify([{
      ...JSON.parse(projectCheckpoint)[0],
      legacy: true,
    }]);
    await db.prepare(
      `update briar_project_settings
       set mandatory_checkpoints_json = ? where project_id = ?`,
    ).bind(legacyProjectCheckpoint, "checkpoint-project").run();
    await expect(applyD1Migrations(db, {
      files: ["0161_canonical_workflow_checkpoint_storage.sql"],
    })).rejects.toThrow(/canonical shape/iu);

    await db.prepare(
      `update briar_project_settings
       set mandatory_checkpoints_json = ? where project_id = ?`,
    ).bind(projectCheckpoint, "checkpoint-project").run();
    const legacyIssueCheckpoint = JSON.stringify([{
      ...JSON.parse(issueCheckpoint)[0],
      legacy: true,
    }]);
    await db.prepare(
      `update briar_hunt_runs set issue_checkpoints_json = ? where id = ?`,
    ).bind(legacyIssueCheckpoint, runId).run();
    await expect(applyD1Migrations(db, {
      files: ["0161_canonical_workflow_checkpoint_storage.sql"],
    })).rejects.toThrow(/canonical shape/iu);

    await db.prepare(
      `update briar_hunt_runs set issue_checkpoints_json = ? where id = ?`,
    ).bind(issueCheckpoint, runId).run();
    await applyD1Migrations(db, {
      files: ["0161_canonical_workflow_checkpoint_storage.sql"],
    });

    expect((await db.prepare(
      `select user_id from briar_user_workflow_checkpoint_defaults
       order by user_id`,
    ).all()).results).toEqual([{ user_id: "checkpoint-user" }]);
    expect(await db.prepare(
      `select count(*) as count
       from briar_workflow_checkpoint_storage_validation`,
    ).first()).toEqual({ count: 0 });

    await expect(db.prepare(
      `update briar_project_settings
       set mandatory_checkpoints_json = ? where project_id = ?`,
    ).bind(projectCheckpoint, "checkpoint-project").run()).resolves.toBeDefined();
    await expect(db.prepare(
      `update briar_user_workflow_checkpoint_defaults
       set checkpoints_json = ? where project_id = ? and user_id = ?`,
    ).bind(
      userCheckpoint,
      "checkpoint-project",
      "checkpoint-user",
    ).run()).resolves.toBeDefined();
    await expect(db.prepare(
      `update briar_hunt_runs set issue_checkpoints_json = ? where id = ?`,
    ).bind(issueCheckpoint, runId).run()).resolves.toBeDefined();

    await expect(db.prepare(
      `update briar_project_settings
       set mandatory_checkpoints_json = ? where project_id = ?`,
    ).bind(legacyProjectCheckpoint, "checkpoint-project").run())
      .rejects.toThrow(/canonical shape/iu);
    await expect(db.prepare(
      `update briar_user_workflow_checkpoint_defaults
       set checkpoints_json = ? where project_id = ? and user_id = ?`,
    ).bind(
      JSON.stringify([{
        key: "project-after-analyzing",
        stage: "analyzing",
        position: "after",
      }]),
      "checkpoint-project",
      "checkpoint-user",
    ).run()).rejects.toThrow(/canonical shape/iu);
    await expect(db.prepare(
      `update briar_hunt_runs set issue_checkpoints_json = ? where id = ?`,
    ).bind(legacyIssueCheckpoint, runId).run())
      .rejects.toThrow(/canonical shape/iu);
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);
  });
});
