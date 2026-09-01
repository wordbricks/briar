import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { archiveFormatVersion } from "./archive-contract";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("canonical archive storage migration", () => {
  it("preserves readable archives and guards cleanup identities", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    const archiveId = "a".repeat(64);
    const archiveObjectKey = "logs/v1/archive-cutover.jsonl.gz";
    const relatedObjectKey = "run-evidence/archive-cutover.png";
    await applyD1Migrations(db, {
      through: "0156_canonical_project_agent_schedule_recurrence.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'archive-owner', 'Archive Owner', 'archive@example.com', 1,
        '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'archive-org', 'Archive Org', 'archive-org', '${now}', '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        'archive-org', 'archive-owner', 'owner', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'archive-project', 'archive-owner', 'archive-org', 'Archive Project',
        '${"b".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_log_archives (
        id, project_id, run_id, scope_id, archive_kind, object_key,
        format_version, status, row_count, byte_size, sha256,
        content_sha256, period_start, period_end, created_at, verified_at,
        completed_at, expires_at, failure_count, last_error,
        related_object_keys_json
      ) values (
        '${archiveId}', 'archive-project', null, 'archive-project',
        'execution_audit', '${archiveObjectKey}', 1, 'complete', 1, 10,
        '${"c".repeat(64)}', '${"d".repeat(64)}', '${now}', '${now}',
        '${now}', '${now}', '${now}', '2027-08-31T00:00:00.000Z',
        0, null, '["${relatedObjectKey}"]'
      );
    `);

    await applyD1Migrations(db, {
      files: ["0157_archive_format_v2.sql"],
    });

    expect(await db.prepare(
      `select count(*) as count from briar_log_archives`,
    ).first<number>("count")).toBe(1);
    expect((await db.prepare(
      `select id, object_key, format_version, related_object_keys_json
       from briar_log_archives where id = ?`,
    ).bind(archiveId).all()).results).toEqual([
      {
        id: archiveId,
        object_key: archiveObjectKey,
        format_version: archiveFormatVersion,
        related_object_keys_json: JSON.stringify([relatedObjectKey]),
      },
    ]);
    expect(await db.prepare(
      `select count(*) as count from briar_archive_cleanup_queue
       where object_key in (?, ?)`,
    ).bind(archiveObjectKey, relatedObjectKey).first<number>("count")).toBe(0);

    const insertArchive = (
      id: string,
      objectKey: string,
      formatVersion: number,
    ) => db.prepare(
      `insert into briar_log_archives (
         id, project_id, run_id, scope_id, archive_kind, object_key,
         format_version, status, row_count, byte_size, sha256,
         content_sha256, period_start, period_end, created_at, verified_at,
         completed_at, expires_at, failure_count, last_error,
         related_object_keys_json
       ) values (
         ?, 'archive-project', null, 'archive-project', 'execution_audit',
         ?, ?, 'complete', 1, 10, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, '[]'
       )`,
    ).bind(
      id,
      objectKey,
      formatVersion,
      "e".repeat(64),
      "f".repeat(64),
      now,
      now,
      now,
      now,
      now,
      "2027-08-31T00:00:00.000Z",
    ).run();
    await expect(insertArchive(
      "1".repeat(64),
      "logs/v1/archive-current.jsonl.gz",
      archiveFormatVersion,
    )).resolves.toBeDefined();
    await expect(insertArchive(
      "2".repeat(64),
      "logs/v2/archive-rejected.jsonl.gz",
      2,
    )).rejects.toThrow();
    await expect(db.prepare(
      `update briar_log_archives
       set related_object_keys_json = '[" leading-space"]'
       where id = ?`,
    ).bind("1".repeat(64)).run()).rejects.toThrow(
      /invalid archive related object key/iu,
    );
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);
  });
});
