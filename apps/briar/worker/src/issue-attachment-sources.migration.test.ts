import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

const now = "2026-09-09T00:00:00.000Z";
const target = "0218_issue_attachment_sources.sql";
const previous = "0217_dm_schedules.sql";
// `briar_hunt_runs_workflow_v2_insert` refuses a run whose snapshot is not a
// canonical v2 one, and the column default is still v1.
const workflow =
  '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}';

/*
  An issue created from an approved DM proposal carries whatever files that DM
  held, and those may be PDF, Markdown or plain text. The column allowed only
  images, text/html and video, so 0218 rebuilds this leaf table to widen the
  CHECK.

  What the rebuild has to preserve is what these tests are for: the rows it
  parks and puts back, the indexes and the dashboard sync triggers the drop
  took with it, the wider set of types, and a type that is still refused.

  The fixture is written with plain inserts rather than through the repository
  functions, because the schema here is the one this migration is about to
  change.
*/
const seed = async (db: D1Database) => {
  await executeD1Sql(db, `
    insert into "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) values (
      'source-owner', 'Source Owner', 'source@example.com', 1, '${now}', '${now}'
    );
    insert into briar_organizations (
      id, name, handle, created_at, updated_at
    ) values (
      'source-org', 'Source Org', 'source-org', '${now}', '${now}'
    );
    insert into briar_organization_members (
      organization_id, user_id, role, created_at, updated_at
    ) values ('source-org', 'source-owner', 'owner', '${now}', '${now}');
    insert into briar_projects (
      id, owner_user_id, organization_id, name, agent_token_hash,
      created_at, updated_at
    ) values (
      'source-project', 'source-owner', 'source-org', 'Source Project',
      '${"a".repeat(64)}', '${now}', '${now}'
    );
    insert into briar_hunt_runs (
      id, project_id, source, source_key, title, stage, repository,
      workflow_snapshot_json, started_at, last_event_at, created_at, updated_at
    ) values (
      'source-run', 'source-project', 'issue', 'source-1', 'Source issue',
      'queued', 'acme/repo', '${workflow}', '${now}', '${now}', '${now}',
      '${now}'
    );
  `);
};

const insertAttachment = (
  db: D1Database,
  id: string,
  contentType: string,
) =>
  db.prepare(
    `insert into briar_issue_attachments (
       id, run_id, project_id, object_key, filename, content_type, byte_size,
       created_at
     ) values (?, 'source-run', 'source-project', ?, ?, ?, 12, '${now}')`,
  ).bind(id, `attachments/${id}`, id, contentType).run();

const issueAttachmentSchemaObjects = (db: D1Database) =>
  db.prepare(
    `select type, name, sql from sqlite_master
     where tbl_name = 'briar_issue_attachments' and sql is not null
     order by type, name`,
  ).all();

describe("issue attachment source migration", () => {
  it("widens the stored attachment types without losing rows or schema objects", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);
    await insertAttachment(db, "legacy.png", "image/png");
    await insertAttachment(db, "legacy.mp4", "video/mp4");
    const before = await db.prepare(
      "select * from briar_issue_attachments order by id",
    ).all();
    const schemaBefore = await issueAttachmentSchemaObjects(db);

    await applyD1Migrations(db, { files: [target] });

    // Every parked row came back, byte for byte.
    expect(
      (await db.prepare(
        "select * from briar_issue_attachments order by id",
      ).all()).results,
    ).toEqual(before.results);

    // Only the CHECK changed. Both indexes and both dashboard sync triggers
    // went with the dropped table and had to be recreated.
    const schemaAfter = await issueAttachmentSchemaObjects(db);
    expect(schemaAfter.results.map((row) => [row.type, row.name])).toEqual(
      schemaBefore.results.map((row) => [row.type, row.name]),
    );
    expect(schemaAfter.results.map((row) => [row.type, row.name])).toEqual(
      expect.arrayContaining([
        ["index", "briar_issue_attachments_project_idx"],
        ["index", "briar_issue_attachments_run_idx"],
        ["trigger", "briar_dashboard_attachments_delete_sync"],
        ["trigger", "briar_dashboard_attachments_insert_sync"],
      ]),
    );

    for (
      const [id, contentType] of [
        ["carried.pdf", "application/pdf"],
        ["carried.md", "text/markdown"],
        ["carried.txt", "text/plain"],
      ] as const
    ) {
      await insertAttachment(db, id, contentType);
    }
    expect(
      (await db.prepare(
        "select count(*) as count from briar_issue_attachments",
      ).first<{ count: number }>())?.count,
    ).toBe(5);

    // The CHECK is still a closed list, not an open door.
    await expect(insertAttachment(db, "bad.zip", "application/zip"))
      .rejects.toThrow();

    // The recreated insert trigger still announces the run to the dashboard.
    expect(
      (await db.prepare(
        `select count(*) as count from briar_dashboard_changes
         where project_id = 'source-project' and entity_id = 'source-run'`,
      ).first<{ count: number }>())?.count,
    ).toBeGreaterThan(0);
    expect((await db.prepare("pragma foreign_key_check").all()).results)
      .toEqual([]);

    // Still a leaf whose rows leave with the run they belong to.
    await db.prepare("delete from briar_hunt_runs where id = 'source-run'")
      .run();
    expect(
      (await db.prepare("select * from briar_issue_attachments").all()).results,
    ).toEqual([]);
  });

  it("keeps both approved-proposal guards, now bound to the payload", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await applyD1Migrations(db, { files: [target] });

    const guards = await db.prepare(
      `select name, sql from sqlite_master
       where type = 'trigger' and name in (
         'briar_hunt_runs_channel_proposal_reservation_required',
         'briar_hunt_runs_finalize_channel_proposal_approval'
       ) order by name`,
    ).all<{ name: string; sql: string }>();
    expect(guards.results.map(({ name }) => name)).toEqual([
      "briar_hunt_runs_channel_proposal_reservation_required",
      "briar_hunt_runs_finalize_channel_proposal_approval",
    ]);
    for (const guard of guards.results) {
      // Both payload shapes stay approvable: 24 three-key proposals were
      // pending in production, and their payloads are immutable.
      expect(guard.sql).toContain("in (3, 4)");
      expect(guard.sql).toContain("'$.issue.attachmentIds'");
      // The run's attachment count follows the approved payload rather than
      // being pinned to zero, which is what blocked the carry-over.
      expect(guard.sql).not.toContain(
        "json_extract(new.context_json, '$.attachmentCount') = 0",
      );
      // A dropped clause silently removes a guard, so the assertions the
      // rebuild had to reproduce verbatim are spot-checked here.
      expect(guard.sql).toContain("and new.requires_claim_token = 0");
      expect(guard.sql).toContain("and new.created_at = new.updated_at");
      expect(guard.sql).toContain(
        "and json_extract(new.context_json, '$.origin') = 'briar-channel'",
      );
    }
  });
});
