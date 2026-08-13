import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HuntEventInput } from "./db";
import {
  completeWorkflowStageLifecycle,
  deleteIssue,
  recordHuntEvent,
  reworkHuntRun,
  startWorkflowStageLifecycle,
} from "./db";
import {
  type ArchiveBucket,
  archiveCleanupRetryPolicy,
  archiveCompletedLogs,
  collectStorageMetrics,
  defaultArchiveRowLimit,
  enqueueArchiveCleanup,
  expireArchives,
  listArchivedExecutionAuditEvents,
  listArchivedIssueMessages,
  listArchivedProjectAgentSessions,
  listArchivedRunEvidence,
  listArchivedRunEvents,
  listArchiveObjectsForDeletion,
  maxArchiveUncompressedBytes,
  processArchiveCleanupQueue,
  readArchivedWorkLog,
  readLatestArchivedWorkLogForRun,
} from "./archive";
import { applyD1Migrations, executeD1Sql } from "./test-helpers/d1";

const projectId = "11111111-1111-4111-8111-111111111111";
let runId = "";
let secondRunId = "";
const oldTime = "2020-01-01T00:00:00.000Z";
const observedAt = "2028-01-01T00:00:00.000Z";

const deleteOnlyBucket = (
  onDelete: (keys: string | string[]) => Promise<void> | void,
): ArchiveBucket => ({
  async head() {
    return null;
  },
  async get() {
    return null;
  },
  async put() {
    return undefined;
  },
  async delete(keys) {
    await onDelete(keys);
  },
});

const event = (
  sourceKey: string,
  stage: HuntEventInput["stage"],
  status: NonNullable<HuntEventInput["status"]>,
  minute: number,
): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title: `Archive ${sourceKey}`,
  stage,
  status,
  workflowStage:
    stage === "analyzing"
      ? "archive_analyzing"
      : stage === "implementing"
        ? "archive_implementing"
        : null,
  eventKey: `${sourceKey}:${stage}:${minute}`,
  occurredAt: new Date(Date.parse(oldTime) + minute * 60_000).toISOString(),
  actor: "archive-test",
  repository: "wordbricks/briar",
  detail: `${stage} detail`,
  priority: 2,
  branch: "briar/archive-test",
  commitSha: "abcdef1",
  tracker: null,
  issueDescription: "Archive integration fixture",
  resultSummary: status === "completed" ? "Archived fixture completed." : null,
  structuredResult:
    status === "completed"
      ? {
          summary: "Archived fixture completed.",
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        }
      : null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: oldTime,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
});

describe("D1 to R2 log archives", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-archive-test" },
    r2Buckets: ["ARCHIVES"],
  });
  let db: D1Database;
  let bucket: ArchiveBucket;

  beforeAll(async () => {
    db = await miniflare.getD1Database("DB");
    const miniflareBucket = await miniflare.getR2Bucket("ARCHIVES");
    bucket = {
      async head(key) {
        const object = await miniflareBucket.head(key);
        if (!object) return null;
        return {
          size: object.size,
          checksums: {
            sha256: object.checksums.sha256
              ? new Uint8Array(object.checksums.sha256).slice().buffer
              : undefined,
          },
          customMetadata: object.customMetadata,
        };
      },
      async get(key) {
        const object = await miniflareBucket.get(key);
        if (!object) return null;
        const bytes = await object.arrayBuffer();
        return {
          size: object.size,
          checksums: {
            sha256: object.checksums.sha256
              ? new Uint8Array(object.checksums.sha256).slice().buffer
              : undefined,
          },
          customMetadata: object.customMetadata,
          body: new Blob([bytes]).stream(),
        };
      },
      async put(key, value, options) {
        return miniflareBucket.put(key, value, options);
      },
      async delete(keys) {
        await miniflareBucket.delete(keys);
      },
    };
    await applyD1Migrations(db);
    await executeD1Sql(
      db,
      `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
       values ('owner', 'Owner', 'owner@example.com', 1, '${oldTime}', '${oldTime}');
       insert into briar_organizations (id, name, handle, created_at, updated_at)
       values ('${projectId}', 'Archive Org', 'archive-org', '${oldTime}', '${oldTime}');
       insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values ('${projectId}', 'owner', 'owner', '${oldTime}', '${oldTime}');
       insert into briar_projects (
         id, owner_user_id, organization_id, name, agent_token_hash,
         created_at, updated_at
       ) values (
         '${projectId}', 'owner', '${projectId}', 'Archive',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         '${oldTime}', '${oldTime}'
       );
       insert into briar_project_settings (
         project_id, velen_org, linear_enabled, workflow_json,
         mandatory_checkpoints_json, created_at, updated_at
       ) values (
         '${projectId}', null, 0,
         '{"version":2,"requirements":[],"stages":[{"id":"archive_analyzing","label":"Analyze","required":true},{"id":"archive_implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["archive_analyzing","archive_implementing"]}}',
         '[]',
         '${oldTime}', '${oldTime}'
       );`,
    );

    await recordHuntEvent(db, projectId, event("large-run", "queued", "queued", 0));
    runId = (await db
      .prepare(`select id from briar_hunt_runs where source_key = ?`)
      .bind("large-run")
      .first<string>("id")) ?? "";
    for (const [stageId, minute] of [
      ["archive_analyzing", 2.1],
      ["archive_implementing", 2.2],
    ] as const) {
      await startWorkflowStageLifecycle(db, projectId, {
        runId,
        stageId,
        startedAt: new Date(Date.parse(oldTime) + minute * 60_000).toISOString(),
        actor: "archive-test",
      });
      await completeWorkflowStageLifecycle(db, projectId, {
        runId,
        stageId,
        finishedAt: new Date(Date.parse(oldTime) + (minute + 0.05) * 60_000).toISOString(),
      });
    }
    await recordHuntEvent(db, projectId, event("large-run", "completed", "completed", 3));
    await db
      .prepare(
        `update briar_hunt_runs
         set completed_at = ?, dispatch_mode = 'any',
             dispatch_request_id = 'archive-current-dispatch',
             dispatched_at = ?, requested_by_user_id = 'owner',
             requested_agent_provider = 'codex'
         where id = ?`,
      )
      .bind(oldTime, oldTime, runId)
      .run();

    const largeDetail = "x".repeat(2_048);
    for (let offset = 0; offset < 1_200; offset += 100) {
      await db.batch(
        Array.from({ length: 100 }, (_, index) => {
          const sequence = offset + index;
          return db
            .prepare(
              `insert into briar_hunt_events (
                 id, run_id, event_key, attempt, revision, stage, status,
                 workflow_stage, detail, actor, pull_request_urls,
                 occurred_at, recorded_at
               ) values (?, ?, ?, 1, 1, 'implementing', 'running',
                         'implementing', ?, 'fixture', '[]', ?, ?)`,
            )
            .bind(
              `bulk-event-${String(sequence).padStart(5, "0")}`,
              runId,
              `bulk:${sequence}`,
              largeDetail,
              oldTime,
              oldTime,
            );
        }),
      );
    }

    await executeD1Sql(
      db,
      `insert into briar_run_evidence (
         id, project_id, run_id, attempt, revision, evidence_key,
         workflow_stage, evidence_type, status, detail, command, url,
         metadata_json, actor, observed_at, recorded_at
       ) values (
         'evidence-1', '${projectId}', '${runId}', 1, 1, 'archive:evidence',
         'implementing', 'diff', 'passed', 'Verified diff', null, null,
         '{"fixture":true}', 'fixture', '${oldTime}', '${oldTime}'
       );
       insert into briar_run_evidence_images (
         id, project_id, run_id, evidence_id, object_key, filename,
         content_type, byte_size, sha256, position, created_at
       ) values (
         'image-1', '${projectId}', '${runId}', 'evidence-1',
         'run-evidence/${projectId}/${runId}/image-1', 'result.png',
         'image/png', 4,
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         0, '${oldTime}'
       );
       insert into briar_execution_audit_events (
         id, organization_id, project_id, run_id, action, detail_json, occurred_at
       ) values (
         'audit-1', '${projectId}', '${projectId}', '${runId}',
         'completed', '{"fixture":true}', '${oldTime}'
       );
       insert into briar_execution_audit_events (
         id, organization_id, project_id, run_id, actor_user_id, action,
         request_id, detail_json, occurred_at
       ) values (
         'audit-current-dispatch', '${projectId}', '${projectId}', '${runId}',
         'owner', 'dispatched', 'archive-current-dispatch',
         '{"fixture":true}', '${oldTime}'
       );
       insert into briar_channel_issue_approval_audit (
         id, proposal_id, organization_id, channel_id, project_id, run_id,
         approved_by_user_id, approved_at, issue_source_key,
         result_verification, payload_json, created_at
       ) values (
         'archive-channel-approval', 'archive-proposal', '${projectId}',
         'archive-channel', '${projectId}', '${runId}', 'owner', '${oldTime}',
         'large-run', 'atomic', '{"issue":{"title":"Archive large run"}}',
         '${oldTime}'
       );
       insert into briar_execution_audit_events (
         id, organization_id, project_id, action, detail_json, occurred_at
       ) values (
         'audit-project-1', '${projectId}', '${projectId}',
         'worker_readiness_changed', '{"fixture":true}', '${oldTime}'
       );
       insert into briar_agent_transcript_sessions (
         session_id, project_id, run_id, agent_provider, started_at,
         last_event_at, event_count, byte_count
       ) values (
         'session-archive', '${projectId}', '${runId}', 'codex',
         '${oldTime}', '${oldTime}', 0, 0
       );
       insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         body, created_at, updated_at
       ) values (
         'message-1', '${projectId}', '${runId}', null, 'owner',
         'Archived question', '${oldTime}', '${oldTime}'
       );
       insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_agent_provider,
         body, created_at, updated_at
       ) values (
         'message-2', '${projectId}', '${runId}', 'message-1', 'codex',
         'Archived answer', '${oldTime}', '${oldTime}'
       );
       insert into briar_project_agent_sessions (
         project_id, id, status, session_type, payload_json,
         started_at, completed_at, updated_at
       ) values (
         '${projectId}', 'project-session-1', 'completed', 'task',
         '{"summary":"done"}', '${oldTime}', '${oldTime}', '${oldTime}'
       );`,
    );
    const rawTranscript =
      '{"sequence":3,"direction":"server","payload":{"raw":"thought"}}\n';
    const rawTranscriptBytes = new TextEncoder().encode(rawTranscript);
    const compressedRawTranscript = await new Response(
      new Blob([rawTranscriptBytes]).stream().pipeThrough(
        new CompressionStream("gzip"),
      ),
    ).arrayBuffer();
    const hexDigest = (digest: ArrayBuffer) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    const rawTranscriptSha256 = hexDigest(await crypto.subtle.digest(
      "SHA-256",
      rawTranscriptBytes.slice().buffer as ArrayBuffer,
    ));
    const compressedRawTranscriptSha256 = hexDigest(await crypto.subtle.digest(
      "SHA-256",
      compressedRawTranscript,
    ));
    const rawTranscriptKey =
      `raw-transcripts/${projectId}/session-archive/` +
      "000000000003-000000000003-" + rawTranscriptSha256 + ".jsonl.gz";
    await bucket.put(rawTranscriptKey, compressedRawTranscript, {
      httpMetadata: {
        contentType: "application/x-ndjson",
        contentEncoding: "gzip",
      },
      customMetadata: { sessionId: "session-archive" },
      sha256: compressedRawTranscriptSha256,
      storageClass: "Standard",
    });
    await db.batch([
      db.prepare(
        `insert into briar_agent_worklog_entries (
           session_id, entry_id, sequence, updated_sequence, entry_type,
           phase, body, status, started_at, updated_at, completed_at
         ) values (?, 'archive-answer', 2, 2, 'message', 'final',
                   'Archived answer', 'completed', ?, ?, ?)`,
      ).bind("session-archive", oldTime, oldTime, oldTime),
      db.prepare(
        `insert into briar_agent_transcript_segments (
           session_id, first_sequence, last_sequence, object_key, event_count,
           uncompressed_bytes, compressed_bytes, sha256, recorded_at
         ) values (?, 3, 3, ?, 1, ?, ?, ?, ?)`,
      ).bind(
        "session-archive",
        rawTranscriptKey,
        rawTranscriptBytes.byteLength,
        compressedRawTranscript.byteLength,
        rawTranscriptSha256,
        oldTime,
      ),
      db.prepare(
        `update briar_agent_transcript_sessions
         set event_count = 1
         where session_id = ?`,
      ).bind("session-archive"),
    ]);
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("archives large fixtures in bounded verified batches and restores every view", async () => {
    const before = await db
      .prepare(`select count(*) as count from briar_hunt_events where run_id = ?`)
      .bind(runId)
      .first<{ count: number }>();
    expect(before?.count).toBeGreaterThan(1_200);

    const result = await archiveCompletedLogs(db, bucket, observedAt, {
      maxObjects: 24,
      rowLimit: 200,
    });
    expect(result.failures).toEqual([]);
    expect(result.completedObjects).toBeGreaterThanOrEqual(10);

    const archiveRows = await db
      .prepare(
        `select row_count, byte_size, status from briar_log_archives
         where project_id = ?`,
      )
      .bind(projectId)
      .all<{ row_count: number; byte_size: number; status: string }>();
    expect(archiveRows.results.every((row) => row.status === "complete")).toBe(true);
    expect(
      archiveRows.results
        .filter((row) => row.row_count > 10)
        .every((row) => row.row_count <= 200),
    ).toBe(true);
    expect(
      archiveRows.results.every((row) => row.byte_size < maxArchiveUncompressedBytes),
    ).toBe(true);

    expect(
      await db
        .prepare(`select count(*) as count from briar_hunt_events where run_id = ?`)
        .bind(runId)
        .first<number>("count"),
    ).toBe(0);
    expect((await listArchivedRunEvents(db, bucket, projectId, runId)).length).toBe(
      before?.count,
    );
    expect(
      (await listArchivedRunEvidence(db, bucket, projectId, runId)).evidence,
    ).toHaveLength(1);
    expect(
      await listArchivedExecutionAuditEvents(db, bucket, projectId, runId),
    ).toHaveLength(1);
    expect(
      await listArchivedExecutionAuditEvents(db, bucket, projectId),
    ).toHaveLength(2);
    expect(await listArchivedIssueMessages(db, bucket, projectId, runId)).toHaveLength(2);
    const archivedWorkLog = await readArchivedWorkLog(
      db,
      bucket,
      projectId,
      "session-archive",
    );
    expect(archivedWorkLog?.entries).toEqual([
      expect.objectContaining({
        entry_id: "archive-answer",
        body: "Archived answer",
      }),
    ]);
    expect(archivedWorkLog?.segments).toHaveLength(1);
    expect(await bucket.head(archivedWorkLog!.segments[0]!.object_key))
      .not.toBeNull();
    expect(
      (await readLatestArchivedWorkLogForRun(db, bucket, projectId, runId))
        ?.session.session_id,
    ).toBe("session-archive");
    expect(await listArchivedProjectAgentSessions(db, bucket, projectId)).toHaveLength(1);
    await expect(
      db.prepare(
        `select archived from briar_project_agent_session_summaries
         where project_id = ? and session_id = 'project-session-1'`,
      ).bind(projectId).first<number>("archived"),
    ).resolves.toBe(1);

    const secondPass = await archiveCompletedLogs(db, bucket, observedAt, {
      maxObjects: 24,
      rowLimit: defaultArchiveRowLimit,
    });
    expect(secondPass.completedObjects).toBe(0);
    const objectCount = await db
      .prepare(`select count(*) as count from briar_log_archives where project_id = ?`)
      .bind(projectId)
      .first<number>("count");
    expect(objectCount).toBe(archiveRows.results.length);

    const metrics = await collectStorageMetrics(db, projectId);
    expect(metrics.hotRows.run_events).toBe(0);
    expect(metrics.hotRows.execution_audit).toBe(1);
    expect(metrics.archives.every((metric) => metric.status === "complete")).toBe(true);
    expect(metrics.databaseBytes).toBeGreaterThan(0);

    await expect(reworkHuntRun(db, projectId, {
      runId,
      workflowStage: "archive_implementing",
      requestId: "99999999-9999-4999-8999-999999999991",
      actor: "archive-test",
      reason: "Verify retained dispatch boundary after archival.",
      occurredAt: "2028-01-01T00:01:00.000Z",
      completed: { expectedAttempt: 1, expectedRevision: 1 },
    })).rejects.toThrow(
      "Approved issue execution requires fresh approval before rework",
    );
  }, 30_000);

  it("keeps D1 originals when an R2 upload or checksum verification fails", async () => {
    await recordHuntEvent(db, projectId, event("failure-run", "queued", "queued", 10));
    secondRunId = (await db
      .prepare(`select id from briar_hunt_runs where source_key = 'failure-run'`)
      .first<string>("id")) ?? "";
    for (const [stageId, minute] of [
      ["archive_analyzing", 12.1],
      ["archive_implementing", 12.2],
    ] as const) {
      await startWorkflowStageLifecycle(db, projectId, {
        runId: secondRunId,
        stageId,
        startedAt: new Date(Date.parse(oldTime) + minute * 60_000).toISOString(),
        actor: "archive-test",
      });
      await completeWorkflowStageLifecycle(db, projectId, {
        runId: secondRunId,
        stageId,
        finishedAt: new Date(Date.parse(oldTime) + (minute + 0.05) * 60_000).toISOString(),
      });
    }
    await recordHuntEvent(db, projectId, event("failure-run", "completed", "completed", 13));
    expect(secondRunId).toBeTruthy();
    await db
      .prepare(`update briar_hunt_runs set completed_at = ? where id = ?`)
      .bind(oldTime, secondRunId)
      .run();
    await db
      .prepare(`update briar_hunt_events set occurred_at = ? where run_id = ?`)
      .bind(oldTime, secondRunId)
      .run();

    const corruptBytes = new TextEncoder().encode("corrupt").buffer;
    const corruptSha256 = [...new Uint8Array(
      await crypto.subtle.digest("SHA-256", corruptBytes),
    )].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const corruptingBucket: ArchiveBucket = {
      ...bucket,
      put(key, _value, options) {
        return bucket.put(key, corruptBytes, {
          ...options,
          sha256: corruptSha256,
        });
      },
    };
    const failed = await archiveCompletedLogs(db, corruptingBucket, observedAt, {
      maxObjects: 1,
      rowLimit: 100,
    });
    expect(failed.failures).toHaveLength(1);
    expect(
      await db
        .prepare(`select count(*) as count from briar_hunt_events where run_id = ?`)
        .bind(secondRunId)
        .first<number>("count"),
    // v2 snapshots do not activate the legacy resume event lifecycle; the
    // queued, two stage, and completed events are the four retained rows.
    ).toBe(4);

    await bucket.delete(
      (await db
        .prepare(
          `select object_key from briar_log_archives
           where run_id = ? and status = 'failed'`,
        )
        .bind(secondRunId)
        .first<string>("object_key")) ?? "missing",
    );
    const retried = await archiveCompletedLogs(db, bucket, observedAt, {
      maxObjects: 1,
      rowLimit: 100,
    });
    expect(retried.failures).toEqual([]);
    expect(retried.completedObjects).toBe(1);
    expect(
      await db
        .prepare(`select count(*) as count from briar_hunt_events where run_id = ?`)
        .bind(secondRunId)
        .first<number>("count"),
    ).toBe(0);
  }, 30_000);

  it("expires archive and related evidence objects from separate buckets and retains metadata for retry", async () => {
    const archiveId = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const archiveObjectKey = "archives/expiry-bucket-separation.jsonl.gz";
    const relatedObjectKey = "run-evidence/expiry-bucket-separation.png";
    await db
      .prepare(
        `insert into briar_log_archives (
           id, project_id, run_id, scope_id, archive_kind, object_key,
           format_version, status, row_count, byte_size, sha256,
           content_sha256, period_start, period_end, created_at, verified_at,
           completed_at, expires_at, failure_count, last_error,
           related_object_keys_json
         ) values (
           ?, ?, null, 'expiry-bucket-separation', 'run_evidence', ?,
           1, 'complete', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?
         )`,
      )
      .bind(
        archiveId,
        projectId,
        archiveObjectKey,
        "c".repeat(64),
        "d".repeat(64),
        oldTime,
        oldTime,
        oldTime,
        oldTime,
        oldTime,
        "1900-01-01T00:00:00.000Z",
        JSON.stringify([relatedObjectKey]),
      )
      .run();

    const archiveDeletes: Array<string | string[]> = [];
    const attachmentDeletes: Array<string | string[]> = [];
    let failAttachmentDelete = true;
    const archivesBucket = deleteOnlyBucket((keys) => {
      archiveDeletes.push(keys);
    });
    const attachmentsBucket = deleteOnlyBucket((keys) => {
      attachmentDeletes.push(keys);
      if (failAttachmentDelete) {
        failAttachmentDelete = false;
        throw new Error("attachments bucket unavailable");
      }
    });

    await expect(
      expireArchives(
        db,
        archivesBucket,
        attachmentsBucket,
        "1900-01-02T00:00:00.000Z",
        1,
      ),
    ).rejects.toThrow("attachments bucket unavailable");
    expect(
      await db
        .prepare(`select count(*) as count from briar_log_archives where id = ?`)
        .bind(archiveId)
        .first<number>("count"),
    ).toBe(1);

    await expect(
      expireArchives(
        db,
        archivesBucket,
        attachmentsBucket,
        "1900-01-02T00:00:00.000Z",
        1,
      ),
    ).resolves.toBe(1);
    expect(archiveDeletes).toEqual([archiveObjectKey, archiveObjectKey]);
    expect(attachmentDeletes).toEqual([
      [relatedObjectKey],
      [relatedObjectKey],
    ]);
    expect(
      await db
        .prepare(`select count(*) as count from briar_log_archives where id = ?`)
        .bind(archiveId)
        .first<number>("count"),
    ).toBe(0);
  });

  it("preserves cleanup objects that are still referenced by live project metadata", async () => {
    const archiveId = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const archiveObjectKey = "archives/live-destination-metadata.jsonl.gz";
    const relatedObjectKey = "run-evidence/live-destination-metadata.png";
    await db
      .prepare(
        `insert into briar_log_archives (
           id, project_id, run_id, scope_id, archive_kind, object_key,
           format_version, status, row_count, byte_size, sha256,
           content_sha256, period_start, period_end, created_at, verified_at,
           completed_at, expires_at, failure_count, last_error,
           related_object_keys_json
         ) values (
           ?, ?, null, 'live-destination-metadata', 'run_evidence', ?,
           1, 'complete', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?
         )`,
      )
      .bind(
        archiveId,
        projectId,
        archiveObjectKey,
        "e".repeat(64),
        "f".repeat(64),
        oldTime,
        oldTime,
        oldTime,
        oldTime,
        oldTime,
        "2099-01-01T00:00:00.000Z",
        JSON.stringify([relatedObjectKey]),
      )
      .run();
    await enqueueArchiveCleanup(
      db,
      "deleted-source-project",
      null,
      { archives: [archiveObjectKey], attachments: [relatedObjectKey] },
      observedAt,
    );

    const archiveDeletes: Array<string | string[]> = [];
    const attachmentDeletes: Array<string | string[]> = [];
    const cleanup = await processArchiveCleanupQueue(
      db,
      deleteOnlyBucket((keys) => {
        archiveDeletes.push(keys);
      }),
      deleteOnlyBucket((keys) => {
        attachmentDeletes.push(keys);
      }),
      observedAt,
      10,
    );

    expect(cleanup).toEqual({ deleted: 0, failed: 0 });
    expect(archiveDeletes).toEqual([]);
    expect(attachmentDeletes).toEqual([]);
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_archive_cleanup_queue
           where object_key in (?, ?)`,
        )
        .bind(archiveObjectKey, relatedObjectKey)
        .first<number>("count"),
    ).toBe(0);
    expect(
      await db
        .prepare(`select count(*) as count from briar_log_archives where id = ?`)
        .bind(archiveId)
        .first<number>("count"),
    ).toBe(1);
  });

  it("plans cleanup for historical project archives that cascade with the current run", async () => {
    const historicalProjectId = "22222222-2222-4222-8222-222222222222";
    const historicalArchiveId = "c".repeat(64);
    const historicalObjectKey =
      `logs/v1/projects/${historicalProjectId}/runs/${runId}/execution_audit/` +
      `${historicalArchiveId}.jsonl.gz`;
    await executeD1Sql(
      db,
      `insert into briar_projects (
         id, owner_user_id, organization_id, name, agent_token_hash,
         created_at, updated_at
       ) values (
         '${historicalProjectId}', 'owner', '${projectId}',
         'Historical audit project',
         'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
         '${oldTime}', '${oldTime}'
       );
       insert into briar_log_archives (
         id, project_id, run_id, scope_id, archive_kind, object_key,
         format_version, status, row_count, byte_size, sha256,
         content_sha256, period_start, period_end, created_at, verified_at,
         completed_at, expires_at, failure_count, last_error,
         related_object_keys_json
       ) values (
         '${historicalArchiveId}', '${historicalProjectId}', '${runId}',
         '${runId}', 'execution_audit', '${historicalObjectKey}',
         1, 'complete', 1, 1,
         'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
         'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
         '${oldTime}', '${oldTime}', '${oldTime}', '${oldTime}', '${oldTime}',
         '${observedAt}', 0, null, '[]'
       );`,
    );

    const cleanup = await listArchiveObjectsForDeletion(db, projectId, runId);
    expect(cleanup.archives).toContain(historicalObjectKey);
  });

  it("retains a concurrently refreshed cleanup generation after R2 deletion", async () => {
    const objectKey = "run-evidence/cleanup-generation-race.png";
    const initialQueuedAt = "2027-11-01T00:00:00.000Z";
    const refreshedQueuedAt = "2028-01-01T00:00:01.000Z";
    await enqueueArchiveCleanup(
      db,
      "deleted-generation-source",
      null,
      { archives: [], attachments: [objectKey] },
      initialQueuedAt,
    );

    const cleanup = await processArchiveCleanupQueue(
      db,
      deleteOnlyBucket(() => undefined),
      deleteOnlyBucket(async () => {
        await enqueueArchiveCleanup(
          db,
          "deleted-generation-destination",
          null,
          { archives: [], attachments: [objectKey] },
          refreshedQueuedAt,
        );
      }),
      observedAt,
      1,
    );

    expect(cleanup).toEqual({ deleted: 0, failed: 0 });
    await expect(
      db
        .prepare(
          `select project_id, queued_at, generation
           from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(objectKey)
        .first(),
    ).resolves.toEqual({
      project_id: "deleted-generation-destination",
      queued_at: refreshedQueuedAt,
      generation: 2,
    });
    await db
      .prepare(
        `delete from briar_archive_cleanup_queue
         where bucket = 'attachments' and object_key = ?`,
      )
      .bind(objectKey)
      .run();
  });

  it("atomically rechecks global references before completing cleanup", async () => {
    const objectKey = "run-evidence/cleanup-reference-race.png";
    const archiveId = "9".repeat(64);
    const archiveObjectKey = "archives/cleanup-reference-race.jsonl.gz";
    await enqueueArchiveCleanup(
      db,
      "deleted-reference-source",
      null,
      { archives: [], attachments: [objectKey] },
      "2027-11-02T00:00:00.000Z",
    );

    const cleanup = await processArchiveCleanupQueue(
      db,
      deleteOnlyBucket(() => undefined),
      deleteOnlyBucket(async () => {
        await db
          .prepare(
            `insert into briar_log_archives (
               id, project_id, run_id, scope_id, archive_kind, object_key,
               format_version, status, row_count, byte_size, sha256,
               content_sha256, period_start, period_end, created_at, verified_at,
               completed_at, expires_at, failure_count, last_error,
               related_object_keys_json
             ) values (
               ?, ?, null, 'cleanup-reference-race', 'run_evidence', ?,
               1, 'complete', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?
             )`,
          )
          .bind(
            archiveId,
            projectId,
            archiveObjectKey,
            "9".repeat(64),
            "8".repeat(64),
            oldTime,
            oldTime,
            oldTime,
            oldTime,
            oldTime,
            "2099-01-01T00:00:00.000Z",
            JSON.stringify([objectKey]),
          )
          .run();
      }),
      observedAt,
      1,
    );

    expect(cleanup).toEqual({ deleted: 0, failed: 0 });
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(objectKey)
        .first<number>("count"),
    ).toBe(1);
    await db.batch([
      db.prepare(`delete from briar_log_archives where id = ?`).bind(archiveId),
      db
        .prepare(
          `delete from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(objectKey),
    ]);
  });

  it("balances fresh cleanup with overdue retries in bounded batches", async () => {
    const permanentKey = "run-evidence/permanent-cleanup-failure.png";
    const duringBackoffKey = "run-evidence/during-backoff-privacy-cleanup.png";
    const afterDueKey = "run-evidence/after-due-privacy-cleanup.png";
    await enqueueArchiveCleanup(
      db,
      "deleted-backoff-source",
      null,
      { archives: [], attachments: [permanentKey] },
      "2027-12-01T00:00:00.000Z",
    );
    const deletedKeys: string[] = [];
    const attachments = deleteOnlyBucket((keys) => {
      const key = typeof keys === "string" ? keys : keys[0];
      if (key === permanentKey) throw new Error("permanent R2 failure");
      deletedKeys.push(key);
    });

    await expect(
      processArchiveCleanupQueue(db, attachments, attachments, observedAt, 1),
    ).resolves.toEqual({ deleted: 0, failed: 1 });
    await enqueueArchiveCleanup(
      db,
      "deleted-backoff-source",
      null,
      { archives: [], attachments: [duringBackoffKey] },
      "2028-01-01T00:00:30.000Z",
    );
    await expect(
      processArchiveCleanupQueue(
        db,
        attachments,
        attachments,
        "2028-01-01T00:00:30.000Z",
        1,
      ),
    ).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(deletedKeys).toEqual([duringBackoffKey]);

    await enqueueArchiveCleanup(
      db,
      "deleted-backoff-source",
      null,
      { archives: [], attachments: [afterDueKey] },
      "2028-01-01T00:01:30.000Z",
    );
    await expect(
      processArchiveCleanupQueue(
        db,
        attachments,
        attachments,
        "2028-01-01T00:02:00.000Z",
        1,
      ),
    ).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(deletedKeys).toEqual([duringBackoffKey]);
    await expect(
      processArchiveCleanupQueue(
        db,
        attachments,
        attachments,
        "2028-01-01T00:02:00.000Z",
        1,
      ),
    ).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(deletedKeys).toEqual([duringBackoffKey, afterDueKey]);
    await expect(
      db
        .prepare(
          `select attempts, next_attempt_at, dead_lettered_at
           from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(permanentKey)
        .first(),
    ).resolves.toEqual({
      attempts: 2,
      next_attempt_at: "2028-01-01T00:04:00.000Z",
      dead_lettered_at: null,
    });
    await db
      .prepare(
        `delete from briar_archive_cleanup_queue
         where bucket = 'attachments' and object_key = ?`,
      )
      .bind(permanentKey)
      .run();
  });

  it("dead-letters bounded failures with a structured alert and supports manual replay", async () => {
    const objectKey = "run-evidence/dead-letter-cleanup.png";
    await enqueueArchiveCleanup(
      db,
      "deleted-dead-letter-source",
      null,
      { archives: [], attachments: [objectKey] },
      "2027-12-03T00:00:00.000Z",
    );
    await db
      .prepare(
        `update briar_archive_cleanup_queue set attempts = ?
         where bucket = 'attachments' and object_key = ?`,
      )
      .bind(archiveCleanupRetryPolicy.maxAttempts - 1, objectKey)
      .run();

    await expect(
      processArchiveCleanupQueue(
        db,
        deleteOnlyBucket(() => undefined),
        deleteOnlyBucket(() => {
          throw new Error("R2 credentials rejected");
        }),
        observedAt,
        1,
      ),
    ).resolves.toEqual({ deleted: 0, failed: 1 });
    const deadLetter = await db
      .prepare(
        `select attempts, next_attempt_at, dead_lettered_at, alert_state,
                alert_detail_json
         from briar_archive_cleanup_queue
         where bucket = 'attachments' and object_key = ?`,
      )
      .bind(objectKey)
      .first<{
        attempts: number;
        next_attempt_at: string | null;
        dead_lettered_at: string | null;
        alert_state: string;
        alert_detail_json: string;
      }>();
    expect(deadLetter).toMatchObject({
      attempts: archiveCleanupRetryPolicy.maxAttempts,
      next_attempt_at: null,
      dead_lettered_at: observedAt,
      alert_state: "pending",
    });
    expect(JSON.parse(deadLetter?.alert_detail_json ?? "{}")).toMatchObject({
      code: "ARCHIVE_CLEANUP_DEAD_LETTER",
      objectKey,
      attempts: archiveCleanupRetryPolicy.maxAttempts,
      lastError: "R2 credentials rejected",
    });

    let replayDeletes = 0;
    await processArchiveCleanupQueue(
      db,
      deleteOnlyBucket(() => undefined),
      deleteOnlyBucket(() => {
        replayDeletes += 1;
      }),
      "2030-01-01T00:00:00.000Z",
      1,
    );
    expect(replayDeletes).toBe(0);

    const replayedAt = "2030-01-01T00:00:01.000Z";
    await db
      .prepare(
        `update briar_archive_cleanup_queue
         set attempts = 0, next_attempt_at = null, dead_lettered_at = null,
             alert_state = 'acknowledged', generation = generation + 1,
             queued_at = ?
         where bucket = 'attachments' and object_key = ?`,
      )
      .bind(replayedAt, objectKey)
      .run();
    await expect(
      processArchiveCleanupQueue(
        db,
        deleteOnlyBucket(() => undefined),
        deleteOnlyBucket(() => {
          replayDeletes += 1;
        }),
        replayedAt,
        1,
      ),
    ).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(replayDeletes).toBe(1);
  });

  it("protects an organization Agent sprite that shares a queued object key", async () => {
    const agentId = "organization-agent-cleanup-reference";
    const objectKey =
      `project-agent-spritesheets/${projectId}/${agentId}/sprites.webp`;
    await db
      .prepare(
        `insert into briar_project_agents (
           id, organization_id, project_id, name, provider,
           responsibility, avatar_spritesheet_object_key, created_at, updated_at
         ) values (?, ?, null, 'Cleanup reference',
                   'codex', 'Protect shared sprite metadata', ?, ?, ?)`,
      )
      .bind(agentId, projectId, objectKey, oldTime, oldTime)
      .run();
    await enqueueArchiveCleanup(
      db,
      "deleted-agent-source",
      null,
      { archives: [], attachments: [objectKey] },
      "2027-12-04T00:00:00.000Z",
    );
    const attachmentDeletes: Array<string | string[]> = [];

    await expect(
      processArchiveCleanupQueue(
        db,
        deleteOnlyBucket(() => undefined),
        deleteOnlyBucket((keys) => {
          attachmentDeletes.push(keys);
        }),
        observedAt,
        1,
      ),
    ).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(attachmentDeletes).toEqual([]);
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(objectKey)
        .first<number>("count"),
    ).toBe(0);
    await db
      .prepare(`delete from briar_project_agents where id = ?`)
      .bind(agentId)
      .run();
  });

  it("retries linked R2 cleanup after an archived issue is deleted", async () => {
    const hotAttachmentKey =
      `issue-attachments/${projectId}/${runId}/delete-retry.png`;
    await db
      .prepare(
        `insert into briar_issue_attachments (
           id, run_id, project_id, object_key, filename, content_type,
           byte_size, created_at
         ) values (?, ?, ?, ?, 'delete-retry.png', 'image/png', 5, ?)`,
      )
      .bind(crypto.randomUUID(), runId, projectId, hotAttachmentKey, oldTime)
      .run();
    const objects = await listArchiveObjectsForDeletion(db, projectId, runId);
    expect(objects.archives.length).toBeGreaterThan(0);
    expect(await deleteIssue(db, projectId, runId, observedAt)).toBe("deleted");
    await expect(
      db
        .prepare(
          `select project_id, run_id from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(hotAttachmentKey)
        .first(),
    ).resolves.toEqual({ project_id: projectId, run_id: runId });
    await enqueueArchiveCleanup(db, projectId, runId, objects, observedAt);

    const cleanup = await processArchiveCleanupQueue(
      db,
      bucket,
      bucket,
      observedAt,
      1_000,
    );
    expect(cleanup.failed).toBe(0);
    expect(cleanup.deleted).toBe(
      objects.archives.length + objects.attachments.length + 1,
    );
    for (const objectKey of objects.archives) {
      expect(await bucket.head(objectKey)).toBeNull();
    }
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_archive_cleanup_queue
           where run_id = ?`,
        )
        .bind(runId)
        .first<number>("count"),
    ).toBe(0);
  });
});
