import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  expireArchives,
  type ArchiveBucket,
} from "./archive";
import { archiveFormatVersion } from "./archive-contract";
import { applyD1Migrations } from "./test-helpers/d1";

const deleteOnlyBucket = (deleted: Array<string | string[]>): ArchiveBucket => ({
  head: async () => null,
  get: async () => null,
  put: async () => undefined,
  delete: async (keys) => {
    deleted.push(keys);
  },
});

describe("archive related-object key cutover", () => {
  it("retires malformed v2 metadata and seals the cleanup boundary", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    const projectId = "archive-related-key-project";
    const archiveId = "a".repeat(64);
    const retainedArchiveId = "b".repeat(64);
    const currentArchiveId = "f".repeat(64);
    const archiveObjectKey = "logs/v2/malformed-related-keys.jsonl.gz";
    const retainedArchiveObjectKey = "logs/v2/retained-related-keys.jsonl.gz";
    const recoverableRelatedObjectKey =
      "run-evidence/recoverable-related-key.png";
    const sharedRelatedObjectKey = "run-evidence/shared-related-key.png";
    const currentRelatedObjectKey = "run-evidence/current-related-key.png";
    await applyD1Migrations(db, {
      through: "0158_canonical_channel_message_blocks.sql",
    });
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Archive Owner', 'archive-related@example.com', 1, ?, ?)`,
      ).bind("archive-related-key-owner", now, now),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Archive Related Keys', 'archive-related-keys', ?, ?)`,
      ).bind("archive-related-key-org", now, now),
    ]);
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (?, ?, 'owner', ?, ?)`,
    ).bind(
      "archive-related-key-org",
      "archive-related-key-owner",
      now,
      now,
    ).run();
    await db.prepare(
      `insert into briar_projects (
         id, owner_user_id, organization_id, name, agent_token_hash,
         created_at, updated_at
       ) values (?, ?, ?, 'Archive Related Keys', ?, ?, ?)`,
    ).bind(
      projectId,
      "archive-related-key-owner",
      "archive-related-key-org",
      "e".repeat(64),
      now,
      now,
    ).run();

    const insertArchive = (
      id: string,
      objectKey: string,
      relatedObjectKeysJson: string,
    ) => db.prepare(
      `insert into briar_log_archives (
         id, project_id, run_id, scope_id, archive_kind, object_key,
         format_version, status, row_count, byte_size, sha256,
         content_sha256, period_start, period_end, created_at, verified_at,
         completed_at, expires_at, failure_count, last_error,
         related_object_keys_json
       ) values (
         ?, ?, null, 'archive-related-key-cutover', 'execution_audit', ?,
         ?, 'complete', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?
       )`,
    ).bind(
      id,
      projectId,
      objectKey,
      archiveFormatVersion,
      "c".repeat(64),
      "d".repeat(64),
      now,
      now,
      now,
      now,
      now,
      "1900-01-01T00:00:00.000Z",
      relatedObjectKeysJson,
    ).run();

    await insertArchive(
      archiveId,
      archiveObjectKey,
      JSON.stringify([
        recoverableRelatedObjectKey,
        sharedRelatedObjectKey,
        7,
      ]),
    );
    await insertArchive(
      retainedArchiveId,
      retainedArchiveObjectKey,
      JSON.stringify([sharedRelatedObjectKey]),
    );

    const archiveDeletes: Array<string | string[]> = [];
    const attachmentDeletes: Array<string | string[]> = [];
    await expect(expireArchives(
      db,
      deleteOnlyBucket(archiveDeletes),
      deleteOnlyBucket(attachmentDeletes),
      now,
      1,
    )).rejects.toThrow();
    expect(archiveDeletes).toEqual([]);
    expect(attachmentDeletes).toEqual([]);
    expect(await db.prepare(
      `select count(*) as count from briar_log_archives where id = ?`,
    ).bind(archiveId).first<number>("count")).toBe(1);

    await applyD1Migrations(db, {
      files: ["0159_canonical_archive_related_object_keys.sql"],
    });

    expect((await db.prepare(
      `select bucket, object_key, project_id
       from briar_archive_cleanup_queue
       where object_key in (?, ?, ?)
       order by bucket, object_key`,
    ).bind(
      archiveObjectKey,
      recoverableRelatedObjectKey,
      sharedRelatedObjectKey,
    ).all()).results).toEqual([
      {
        bucket: "archives",
        object_key: archiveObjectKey,
        project_id: projectId,
      },
      {
        bucket: "attachments",
        object_key: recoverableRelatedObjectKey,
        project_id: projectId,
      },
    ]);
    expect(await db.prepare(
      `select count(*) as count from briar_log_archives where id = ?`,
    ).bind(archiveId).first<number>("count")).toBe(0);

    await expect(insertArchive(
      archiveId,
      archiveObjectKey,
      JSON.stringify([recoverableRelatedObjectKey, 7]),
    )).rejects.toThrow(/invalid archive related object key/iu);
    await insertArchive(
      currentArchiveId,
      "logs/v2/current-related-keys.jsonl.gz",
      JSON.stringify([currentRelatedObjectKey]),
    );
    await expect(db.prepare(
      `update briar_log_archives
       set related_object_keys_json = ? where id = ?`,
    ).bind(JSON.stringify([" leading-space"]), currentArchiveId).run())
      .rejects.toThrow(/invalid archive related object key/iu);
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);
  });
});
