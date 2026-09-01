import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  type ArchiveBucket,
  type ArchiveMetadataRow,
  readArchivedProjectAgentSession,
} from "./archive";
import { archiveFormatVersion } from "./archive-contract";
import { backfillProjectAgentSessionArchives } from "./archive-storage-backfill";
import { encodeStoredProjectAgentSessionPayload } from "./project-request-contract";
import { executeD1Sql } from "./test-helpers/d1";

const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (bytes: ArrayBuffer | Uint8Array) =>
  hex(await crypto.subtle.digest(
    "SHA-256",
    bytes instanceof Uint8Array ? bytes.slice().buffer : bytes,
  ));

const gzip = (content: string) =>
  new Response(
    new Blob([content]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

describe("project agent session archive storage backfill", () => {
  it("ports legacy payload identity before atomically switching D1 to R2", async () => {
    const db = env.DB;
    const bucket = env.ARCHIVES as unknown as ArchiveBucket;
    const now = "2026-08-31T00:00:00.000Z";
    const archiveId = "a".repeat(64);
    const projectId = "archive-backfill-project";
    const sessionId = "archive-backfill-session";
    const ownerId = "archive-backfill-owner";
    const objectKey = `logs/v1/${archiveId}.jsonl.gz`;
    const payload = JSON.parse(encodeStoredProjectAgentSessionPayload({
      dispatchGroupId: sessionId,
      agentId: null,
      agentName: "Backfilled Agent",
      skillId: null,
      sessionType: "task",
      trigger: "manual",
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      request: "Keep this visible session",
      followUps: [],
      status: "completed",
      issues: [],
      startedAt: now,
      completedAt: now,
      conversationId: null,
      summary: "preserved",
      error: null,
      requestedWorkerId: null,
      workerId: null,
      events: [],
      updatedAt: now,
      requestedByUserId: ownerId,
    })) as Record<string, unknown>;
    payload.dispatchGroupId = "";
    delete payload.requestedByUserId;

    const manifest = {
      recordType: "manifest",
      formatVersion: archiveFormatVersion,
      archiveId,
      projectId,
      runId: null,
      scopeId: sessionId,
      kind: "project_agent_sessions",
      rowCount: 1,
      periodStart: now,
      periodEnd: now,
      createdAt: now,
    };
    const content = [
      JSON.stringify(manifest),
      JSON.stringify({
        recordType: "project_agent_session",
        data: {
          project_id: projectId,
          id: sessionId,
          agent_id: null,
          requested_by_user_id: ownerId,
          status: "completed",
          session_type: "task",
          payload_json: JSON.stringify(payload),
          started_at: now,
          completed_at: now,
          updated_at: now,
        },
      }),
      "",
    ].join("\n");
    const compressed = await gzip(content);
    const objectSha256 = await sha256(compressed);
    const contentSha256 = await sha256(encoder.encode(content));

    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        '${ownerId}', 'Archive Owner', 'archive-backfill@example.com', 1,
        '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'archive-backfill-org', 'Archive Org', 'archive-backfill-org',
        '${now}', '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        'archive-backfill-org', '${ownerId}', 'owner', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        '${projectId}', '${ownerId}', 'archive-backfill-org', 'Archive Project',
        '${"b".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_log_archives (
        id, project_id, run_id, scope_id, archive_kind, object_key,
        format_version, status, row_count, byte_size, sha256,
        content_sha256, period_start, period_end, created_at, verified_at,
        completed_at, expires_at, failure_count, last_error,
        related_object_keys_json
      ) values (
        '${archiveId}', '${projectId}', null, '${sessionId}',
        'project_agent_sessions', '${objectKey}', 1, 'complete', 1,
        ${compressed.byteLength}, '${objectSha256}', '${contentSha256}',
        '${now}', '${now}', '${now}', '${now}', '${now}',
        '2027-08-31T00:00:00.000Z', 0, null, '[]'
      );
    `);
    await bucket.put(objectKey, compressed, {
      httpMetadata: {
        contentType: "application/x-ndjson",
        contentEncoding: "gzip",
      },
      customMetadata: {
        archiveId,
        formatVersion: String(archiveFormatVersion),
        contentSha256,
        sha256: objectSha256,
      },
      sha256: objectSha256,
      storageClass: "InfrequentAccess",
    });

    await expect(backfillProjectAgentSessionArchives(db, bucket, {
      observedAt: "2026-09-01T00:00:00.000Z",
    })).resolves.toEqual({ processed: 1, remaining: 0 });

    const metadata = await db.prepare(
      `select * from briar_log_archives where id = ?`,
    ).bind(archiveId).first<ArchiveMetadataRow>();
    expect(metadata?.object_key).toContain(".canonical-v1-");
    expect(metadata?.object_key).not.toBe(objectKey);
    expect(await db.prepare(
      `select count(*) as count from briar_archive_cleanup_queue
       where bucket = 'archives' and object_key = ?`,
    ).bind(objectKey).first<number>("count")).toBe(1);

    const session = await readArchivedProjectAgentSession(bucket, metadata!);
    expect(JSON.parse(session.payload_json)).toMatchObject({
      dispatchGroupId: sessionId,
      requestedByUserId: ownerId,
      summary: "preserved",
    });
  });
});
