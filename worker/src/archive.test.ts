import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HuntEventInput } from "./db";
import {
  completeWorkflowStageLifecycle,
  deleteIssue,
  recordHuntEvent,
  startWorkflowStageLifecycle,
} from "./db";
import {
  type ArchiveBucket,
  archiveCompletedLogs,
  collectStorageMetrics,
  defaultArchiveRowLimit,
  enqueueArchiveCleanup,
  listArchivedExecutionAuditEvents,
  listArchivedIssueMessages,
  listArchivedProjectAgentSessions,
  listArchivedRunEvidence,
  listArchivedRunEvents,
  listArchiveObjectsForDeletion,
  maxArchiveUncompressedBytes,
  processArchiveCleanupQueue,
  readArchivedTranscript,
} from "./archive";
import { applyD1Migrations, executeD1Sql } from "./test-helpers/d1";

const projectId = "11111111-1111-4111-8111-111111111111";
let runId = "";
let secondRunId = "";
const oldTime = "2020-01-01T00:00:00.000Z";
const observedAt = "2028-01-01T00:00:00.000Z";

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
      .prepare(`update briar_hunt_runs set completed_at = ? where id = ?`)
      .bind(oldTime, runId)
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
         '${oldTime}', '${oldTime}', 2, 32
       );
       insert into briar_agent_transcripts (
         session_id, sequence, direction, payload_json, recorded_at
       ) values ('session-archive', 1, 'client', '{"type":"prompt"}', '${oldTime}');
       insert into briar_agent_transcripts (
         session_id, sequence, direction, payload_json, recorded_at
       ) values ('session-archive', 2, 'server', '{"type":"result"}', '${oldTime}');
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
    expect(
      (await readArchivedTranscript(db, bucket, projectId, "session-archive"))?.events,
    ).toHaveLength(2);
    expect(await listArchivedProjectAgentSessions(db, bucket, projectId)).toHaveLength(1);

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
    expect(metrics.archives.every((metric) => metric.status === "complete")).toBe(true);
    expect(metrics.databaseBytes).toBeGreaterThan(0);
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

  it("retries linked R2 cleanup after an archived issue is deleted", async () => {
    const objects = await listArchiveObjectsForDeletion(db, projectId, runId);
    expect(objects.archives.length).toBeGreaterThan(0);
    expect(await deleteIssue(db, projectId, runId, observedAt)).toBe("deleted");
    await enqueueArchiveCleanup(db, projectId, runId, objects, observedAt);

    const cleanup = await processArchiveCleanupQueue(
      db,
      bucket,
      bucket,
      observedAt,
      1_000,
    );
    expect(cleanup.failed).toBe(0);
    expect(cleanup.deleted).toBe(objects.archives.length + objects.attachments.length);
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
