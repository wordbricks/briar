import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { archiveFormatVersion } from "./archive-contract";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("archive format v2 migration", () => {
  it("retires v1 objects through cleanup and enforces the current format", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    const archiveId = "a".repeat(64);
    const archiveObjectKey = "logs/v1/archive-cutover.jsonl.gz";
    const relatedObjectKey = "run-evidence/archive-cutover.png";
    await applyD1Migrations(db, {
      through: "0154_canonical_project_agent_schedule_recurrence.sql",
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
      insert into briar_archive_cleanup_queue (
        bucket, object_key, project_id, run_id, queued_at, attempts,
        last_attempt_at, last_error, generation, next_attempt_at,
        dead_lettered_at, alert_state, alert_detail_json
      ) values (
        'archives', '${archiveObjectKey}', 'stale-project', null, '${now}',
        3, '${now}', 'stale failure', 7, null, '${now}', 'pending', '{}'
      );
    `);

    await applyD1Migrations(db, {
      files: ["0155_archive_format_v2.sql"],
    });

    expect(await db.prepare(
      `select count(*) as count from briar_log_archives`,
    ).first<number>("count")).toBe(0);
    expect((await db.prepare(
      `select bucket, object_key, project_id, run_id, attempts, generation,
              last_error, dead_lettered_at, alert_state
       from briar_archive_cleanup_queue
       where object_key in (?, ?)
       order by bucket, object_key`,
    ).bind(archiveObjectKey, relatedObjectKey).all()).results).toEqual([
      {
        bucket: "archives",
        object_key: archiveObjectKey,
        project_id: "archive-project",
        run_id: null,
        attempts: 0,
        generation: 8,
        last_error: null,
        dead_lettered_at: null,
        alert_state: "none",
      },
      {
        bucket: "attachments",
        object_key: relatedObjectKey,
        project_id: "archive-project",
        run_id: null,
        attempts: 0,
        generation: 1,
        last_error: null,
        dead_lettered_at: null,
        alert_state: "none",
      },
    ]);

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
      "logs/v2/archive-current.jsonl.gz",
      archiveFormatVersion,
    )).resolves.toBeDefined();
    await expect(insertArchive(
      "2".repeat(64),
      "logs/v1/archive-rejected.jsonl.gz",
      1,
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
