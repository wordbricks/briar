import * as Option from "effect/Option";
import type {
  HuntEventRow,
  IssueMessageRow,
  ProjectAgentSessionRow,
  RunEvidenceImageRow,
  RunEvidenceRow,
} from "./db";
import { upsertProjectAgentSessionSummary } from "./db";
import type { TranscriptSessionRow } from "./workers";
import type {
  AgentTranscriptSegmentRow,
  AgentWorkLogEntryRow,
} from "./agent-worklog";
import {
  archiveFormatVersion,
  decodeArchivedExecutionAudit,
  decodeArchivedHuntEvent,
  decodeArchivedIssueMessage,
  decodeArchivedProjectAgentSession,
  decodeArchivedRunEvidence,
  decodeArchivedRunEvidenceImage,
  decodeArchivedTranscriptSegment,
  decodeArchivedTranscriptSession,
  decodeArchivedWorkLogEntry,
  decodeArchiveLine,
  decodeArchiveManifest,
  decodeRelatedArchiveObjectKeysOption,
  type ArchiveKind,
  type ExecutionAuditArchiveRow,
} from "./archive-contract";

export const defaultArchiveRowLimit = 500;
export const maxArchiveUncompressedBytes = 16 * 1024 * 1024;
const deleteBatchSize = 100;

export const archiveCleanupRetryPolicy = {
  maxAttempts: 8,
  baseDelayMilliseconds: 60_000,
  maxDelayMilliseconds: 64 * 60_000,
} as const;

type ArchiveObjectMetadata = {
  size: number;
  checksums: { sha256?: ArrayBuffer | ArrayBufferView };
  customMetadata?: Record<string, string>;
};

type ArchiveObjectBody = ArchiveObjectMetadata & { body: ReadableStream };

export type ArchiveBucket = {
  head(key: string): Promise<ArchiveObjectMetadata | null>;
  get(key: string): Promise<ArchiveObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string; contentEncoding: string };
      customMetadata: Record<string, string>;
      sha256: string;
      storageClass: string;
    },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
};

export type ArchivePolicy = {
  kind: ArchiveKind;
  hotRetentionDays: number;
  longRetentionDays: number;
  description: string;
};

/**
 * Policies are code-owned so the scheduler, metrics endpoint, tests, and
 * operations runbook all share one explicit source of truth.
 */
export const archivePolicies = [
  {
    kind: "run_events",
    hotRetentionDays: 90,
    longRetentionDays: 2_555,
    description: "Completed run timeline events",
  },
  {
    kind: "run_evidence",
    hotRetentionDays: 180,
    longRetentionDays: 2_555,
    description: "Run evidence and evidence image metadata",
  },
  {
    kind: "execution_audit",
    hotRetentionDays: 365,
    longRetentionDays: 2_555,
    description: "Run-scoped execution audit records",
  },
  {
    kind: "agent_transcript",
    hotRetentionDays: 30,
    longRetentionDays: 1_095,
    description: "Detached agent work logs and raw transcript segments",
  },
  {
    kind: "issue_messages",
    hotRetentionDays: 365,
    longRetentionDays: 2_555,
    description: "Completed issue conversations",
  },
  {
    kind: "project_agent_sessions",
    hotRetentionDays: 30,
    longRetentionDays: 365,
    description: "Completed project agent session snapshots",
  },
] as const satisfies readonly ArchivePolicy[];

export type ArchiveMetadataRow = {
  id: string;
  project_id: string;
  run_id: string | null;
  scope_id: string;
  archive_kind: ArchiveKind;
  object_key: string;
  format_version: number;
  status: "failed" | "verified" | "complete";
  row_count: number;
  byte_size: number;
  sha256: string;
  content_sha256: string;
  period_start: string;
  period_end: string;
  created_at: string;
  verified_at: string | null;
  completed_at: string | null;
  expires_at: string;
  failure_count: number;
  last_error: string | null;
  related_object_keys_json: string;
};

type ArchiveRecordType =
  | "hunt_event"
  | "run_evidence"
  | "run_evidence_image"
  | "execution_audit"
  | "transcript_session"
  | "worklog_entry"
  | "transcript_segment"
  | "issue_message"
  | "project_agent_session";

type ArchiveRecord = {
  recordType: ArchiveRecordType;
  data: unknown;
};

type ArchiveCandidate = {
  projectId: string;
  runId: string | null;
  scopeId: string;
  kind: ArchiveKind;
  records: ArchiveRecord[];
  rowCount: number;
  periodStart: string;
  periodEnd: string;
  relatedObjectKeys: string[];
};

const encoder = new TextEncoder();

const ownedBytes = (bytes: ArrayBuffer | ArrayBufferView) =>
  bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();

const bytesToHex = (bytes: ArrayBuffer | ArrayBufferView) =>
  [...ownedBytes(bytes)].map(
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");

const sha256Bytes = async (bytes: ArrayBuffer | ArrayBufferView) =>
  crypto.subtle.digest("SHA-256", ownedBytes(bytes).buffer).then(bytesToHex);

const sha256Text = (value: string) => sha256Bytes(encoder.encode(value));

const cutoffIso = (observedAt: string, days: number) =>
  new Date(Date.parse(observedAt) - days * 86_400_000).toISOString();

const expiryIso = (periodEnd: string, days: number) =>
  new Date(Date.parse(periodEnd) + days * 86_400_000).toISOString();

const gzip = async (text: string) => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
};

const gunzip = async (body: ReadableStream) =>
  new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();

const eventCandidate = async (
  db: D1Database,
  cutoff: string,
  rowLimit: number,
): Promise<ArchiveCandidate | null> => {
  const run = await db
    .prepare(
      `select run.id, run.project_id
       from briar_hunt_runs run
       where run.status = 'completed' and run.completed_at <= ?
         and exists (
           select 1 from briar_hunt_events event
           where event.run_id = run.id and event.occurred_at <= ?
         )
       order by run.completed_at, run.id limit 1`,
    )
    .bind(cutoff, cutoff)
    .first<{ id: string; project_id: string }>();
  if (!run) return null;
  const result = await db
    .prepare(
      `select event.id, event.run_id, event.event_key, event.attempt,
              event.revision, event.stage, event.status, event.workflow_stage,
              event.detail, event.actor, event.branch, event.commit_sha,
              event.qa_status, event.tracker_issue_state,
              event.pull_request_urls, event.target_sha,
              event.occurred_at, event.recorded_at
       from briar_hunt_events event
       where event.run_id = ? and event.occurred_at <= ?
       order by event.occurred_at, event.id limit ?`,
    )
    .bind(run.id, cutoff, rowLimit)
    .all<HuntEventRow>();
  const rows = result.results ?? [];
  if (rows.length === 0) return null;
  return {
    projectId: run.project_id,
    runId: run.id,
    scopeId: run.id,
    kind: "run_events",
    records: rows.map((data) => ({ recordType: "hunt_event", data })),
    rowCount: rows.length,
    periodStart: rows[0]?.occurred_at ?? cutoff,
    periodEnd: rows.at(-1)?.occurred_at ?? cutoff,
    relatedObjectKeys: [],
  };
};

const evidenceCandidate = async (
  db: D1Database,
  cutoff: string,
  rowLimit: number,
): Promise<ArchiveCandidate | null> => {
  const run = await db
    .prepare(
      `select run.id, run.project_id
       from briar_hunt_runs run
       where run.status = 'completed' and run.completed_at <= ?
         and exists (
           select 1 from briar_run_evidence evidence
           where evidence.run_id = run.id and evidence.observed_at <= ?
         )
       order by run.completed_at, run.id limit 1`,
    )
    .bind(cutoff, cutoff)
    .first<{ id: string; project_id: string }>();
  if (!run) return null;
  const result = await db
    .prepare(
      `select id, run_id, attempt, revision, evidence_key, workflow_stage,
              evidence_type, status, detail, command, url, metadata_json,
              actor, observed_at, recorded_at
       from briar_run_evidence
       where run_id = ? and observed_at <= ?
       order by observed_at, id limit ?`,
    )
    .bind(run.id, cutoff, rowLimit)
    .all<RunEvidenceRow>();
  const evidence = result.results ?? [];
  if (evidence.length === 0) return null;
  const placeholders = evidence.map(() => "?").join(",");
  const images = await db
    .prepare(
      `select id, project_id, run_id, evidence_id, object_key, filename,
              content_type, byte_size, sha256, position, created_at
       from briar_run_evidence_images
       where evidence_id in (${placeholders})
       order by evidence_id, position, id`,
    )
    .bind(...evidence.map((item) => item.id))
    .all<RunEvidenceImageRow>();
  const imageRows = images.results ?? [];
  return {
    projectId: run.project_id,
    runId: run.id,
    scopeId: run.id,
    kind: "run_evidence",
    records: [
      ...evidence.map((data) => ({ recordType: "run_evidence" as const, data })),
      ...imageRows.map((data) => ({
        recordType: "run_evidence_image" as const,
        data,
      })),
    ],
    rowCount: evidence.length + imageRows.length,
    periodStart: evidence[0]?.observed_at ?? cutoff,
    periodEnd: evidence.at(-1)?.observed_at ?? cutoff,
    relatedObjectKeys: imageRows.map((image) => image.object_key),
  };
};

const auditCandidate = async (
  db: D1Database,
  cutoff: string,
  rowLimit: number,
): Promise<ArchiveCandidate | null> => {
  const run = await db
    .prepare(
      `select audit.run_id as id, audit.project_id
       from briar_execution_audit_events audit
       join briar_hunt_runs run on run.id = audit.run_id
       where run.status = 'completed' and run.completed_at <= ?
         and audit.occurred_at <= ?
         and not (
           run.dispatch_request_id is not null
           and audit.project_id = run.project_id
           and audit.request_id = run.dispatch_request_id
           and audit.action in ('dispatched', 'reassigned')
         )
       order by run.completed_at, run.id, audit.project_id,
                audit.occurred_at, audit.id
       limit 1`,
    )
    .bind(cutoff, cutoff)
    .first<{ id: string; project_id: string }>();
  const projectAudit = run
    ? null
    : await db
        .prepare(
          `select audit.project_id
           from briar_execution_audit_events audit
           where audit.run_id is null and audit.occurred_at <= ?
           order by audit.occurred_at, audit.id limit 1`,
        )
        .bind(cutoff)
        .first<{ project_id: string }>();
  const projectId = run?.project_id ?? projectAudit?.project_id;
  if (!projectId) return null;
  const result = run
    ? await db
        .prepare(
          `select audit.id, audit.run_id, audit.worker_id, audit.agent_id,
                  audit.actor_user_id, audit.actor_device_id, audit.action,
                  audit.request_id, audit.detail_json, audit.occurred_at
           from briar_execution_audit_events audit
           join briar_hunt_runs run on run.id = audit.run_id
           where audit.run_id = ? and audit.project_id = ?
             and audit.occurred_at <= ?
             and not (
               run.dispatch_request_id is not null
               and audit.project_id = run.project_id
               and audit.request_id = run.dispatch_request_id
               and audit.action in ('dispatched', 'reassigned')
             )
           order by audit.occurred_at, audit.id limit ?`,
        )
        .bind(run.id, projectId, cutoff, rowLimit)
        .all<ExecutionAuditArchiveRow>()
    : await db
        .prepare(
          `select id, run_id, worker_id, agent_id, actor_user_id,
                  actor_device_id, action, request_id, detail_json, occurred_at
           from briar_execution_audit_events
           where project_id = ? and run_id is null and occurred_at <= ?
           order by occurred_at, id limit ?`,
        )
        .bind(projectId, cutoff, rowLimit)
        .all<ExecutionAuditArchiveRow>();
  const rows = result.results ?? [];
  if (rows.length === 0) return null;
  return {
    projectId,
    runId: run?.id ?? null,
    scopeId: run?.id ?? projectId,
    kind: "execution_audit",
    records: rows.map((data) => ({ recordType: "execution_audit", data })),
    rowCount: rows.length,
    periodStart: rows[0]?.occurred_at ?? cutoff,
    periodEnd: rows.at(-1)?.occurred_at ?? cutoff,
    relatedObjectKeys: [],
  };
};

const transcriptCandidate = async (
  db: D1Database,
  cutoff: string,
): Promise<ArchiveCandidate | null> => {
  const session = await db
    .prepare(
      `select session.*
       from briar_agent_transcript_sessions session
       left join briar_hunt_runs run on run.id = session.run_id
       where session.last_event_at <= ?
         and exists (
           select 1 from briar_agent_transcript_segments segment
           where segment.session_id = session.session_id
         )
         and (
           session.run_id is null
           or (
             run.status = 'completed'
             and run.project_id = session.project_id
           )
         )
       order by session.last_event_at, session.session_id limit 1`,
    )
    .bind(cutoff)
    .first<TranscriptSessionRow>();
  if (!session) return null;
  const workLog = await db
    .prepare(
      `select * from briar_agent_worklog_entries
       where session_id = ? order by sequence, entry_id`,
    )
    .bind(session.session_id)
    .all<AgentWorkLogEntryRow>();
  const segments = await db
    .prepare(
      `select * from briar_agent_transcript_segments
       where session_id = ? order by first_sequence, last_sequence`,
    )
    .bind(session.session_id)
    .all<AgentTranscriptSegmentRow>();
  const workLogEntries = workLog.results ?? [];
  const transcriptSegments = segments.results ?? [];
  return {
    projectId: session.project_id,
    runId: session.run_id,
    scopeId: session.session_id,
    kind: "agent_transcript",
    records: [
      { recordType: "transcript_session", data: session },
      ...workLogEntries.map((data) => ({
        recordType: "worklog_entry" as const,
        data,
      })),
      ...transcriptSegments.map((data) => ({
        recordType: "transcript_segment" as const,
        data,
      })),
    ],
    rowCount: workLogEntries.length + transcriptSegments.length + 1,
    periodStart: session.started_at,
    periodEnd: session.last_event_at,
    relatedObjectKeys: transcriptSegments.map((segment) => segment.object_key),
  };
};

const messagesCandidate = async (
  db: D1Database,
  cutoff: string,
  rowLimit: number,
): Promise<ArchiveCandidate | null> => {
  const thread = await db
    .prepare(
      `with recursive thread_messages(root_id, message_id, run_id, updated_at) as (
         select root.id, root.id, root.run_id, root.updated_at
         from briar_issue_messages root
         join briar_hunt_runs run on run.id = root.run_id
         where root.parent_message_id is null
           and run.status = 'completed' and run.completed_at <= ?
         union all
         select thread.root_id, message.id, message.run_id, message.updated_at
         from briar_issue_messages message
         join thread_messages thread on message.parent_message_id = thread.message_id
       )
       select run.id, run.project_id, thread.root_id
       from thread_messages thread
       join briar_hunt_runs run on run.id = thread.run_id
       where run.status = 'completed' and run.completed_at <= ?
       group by run.id, run.project_id, thread.root_id
       having max(thread.updated_at) <= ? and count(*) <= ?
       order by run.completed_at, run.id, thread.root_id limit 1`,
    )
    .bind(cutoff, cutoff, cutoff, rowLimit)
    .first<{ id: string; project_id: string; root_id: string }>();
  if (!thread) return null;
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name, author.image as author_image,
              message.body,
              (select count(*) from briar_issue_messages reply
               where reply.parent_message_id = message.id) as reply_count,
              message.created_at, message.updated_at
       from briar_issue_messages message
       left join "user" author on author.id = message.author_user_id
       where message.id in (
         with recursive thread_messages(id) as (
           select ?
           union
           select reply.id
           from briar_issue_messages reply
           join thread_messages thread on reply.parent_message_id = thread.id
         )
         select id from thread_messages
       )
       order by message.created_at, message.id`,
    )
    .bind(thread.root_id)
    .all<IssueMessageRow>();
  const rows = result.results ?? [];
  if (rows.length === 0) return null;
  return {
    projectId: thread.project_id,
    runId: thread.id,
    scopeId: thread.id,
    kind: "issue_messages",
    records: rows.map((data) => ({ recordType: "issue_message", data })),
    rowCount: rows.length,
    periodStart: rows[0]?.created_at ?? cutoff,
    periodEnd: rows.at(-1)?.updated_at ?? cutoff,
    relatedObjectKeys: [],
  };
};

const projectSessionCandidate = async (
  db: D1Database,
  cutoff: string,
): Promise<ArchiveCandidate | null> => {
  const session = await db
    .prepare(
      `select project_id, id, agent_id, requested_by_user_id, status,
              session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where status in ('completed', 'failed', 'interrupted') and updated_at <= ?
       order by updated_at, project_id, id limit 1`,
    )
    .bind(cutoff)
    .first<ProjectAgentSessionRow>();
  if (!session) return null;
  return {
    projectId: session.project_id,
    runId: null,
    scopeId: session.id,
    kind: "project_agent_sessions",
    records: [{ recordType: "project_agent_session", data: session }],
    rowCount: 1,
    periodStart: session.started_at,
    periodEnd: session.updated_at,
    relatedObjectKeys: [],
  };
};

const selectCandidate = async (
  db: D1Database,
  policy: ArchivePolicy,
  observedAt: string,
  rowLimit: number,
) => {
  const cutoff = cutoffIso(observedAt, policy.hotRetentionDays);
  switch (policy.kind) {
    case "run_events":
      return eventCandidate(db, cutoff, rowLimit);
    case "run_evidence":
      return evidenceCandidate(db, cutoff, Math.min(rowLimit, 4));
    case "execution_audit":
      return auditCandidate(db, cutoff, Math.min(rowLimit, 4));
    case "agent_transcript":
      return transcriptCandidate(db, cutoff);
    case "issue_messages":
      return messagesCandidate(db, cutoff, Math.min(rowLimit, 1_000));
    case "project_agent_sessions":
      return projectSessionCandidate(db, cutoff);
  }
};

const serializeCandidate = async (
  candidate: ArchiveCandidate,
  policy: ArchivePolicy,
  observedAt: string,
) => {
  const recordsJson = candidate.records.map((record) => JSON.stringify(record));
  const seed = [
    archiveFormatVersion,
    candidate.projectId,
    candidate.scopeId,
    candidate.kind,
    ...recordsJson,
  ].join("\n");
  const archiveId = await sha256Text(seed);
  const manifest = {
    recordType: "manifest" as const,
    formatVersion: archiveFormatVersion,
    archiveId,
    projectId: candidate.projectId,
    runId: candidate.runId,
    scopeId: candidate.scopeId,
    kind: candidate.kind,
    rowCount: candidate.rowCount,
    periodStart: candidate.periodStart,
    periodEnd: candidate.periodEnd,
    createdAt: observedAt,
  };
  const content = [JSON.stringify(manifest), ...recordsJson, ""].join("\n");
  const uncompressedBytes = encoder.encode(content).byteLength;
  if (uncompressedBytes > maxArchiveUncompressedBytes) {
    throw new Error(
      `${candidate.kind} archive exceeds ${maxArchiveUncompressedBytes} uncompressed bytes`,
    );
  }
  const compressed = await gzip(content);
  const scope = candidate.runId ? `runs/${candidate.runId}` : `project/${candidate.scopeId}`;
  return {
    archiveId,
    content,
    compressed,
    contentSha256: await sha256Text(content),
    objectSha256: await sha256Bytes(compressed),
    objectKey:
      `logs/v${archiveFormatVersion}/projects/${candidate.projectId}/${scope}/` +
      `${candidate.kind}/${archiveId}.jsonl.gz`,
    expiresAt: expiryIso(candidate.periodEnd, policy.longRetentionDays),
  };
};

const checksumMatches = (object: ArchiveObjectMetadata, expected: string) => {
  const checksum = object.checksums.sha256;
  return checksum
    ? bytesToHex(checksum) === expected
    : object.customMetadata?.sha256 === expected;
};

const verifyObject = async (
  bucket: ArchiveBucket,
  objectKey: string,
  byteSize: number,
  objectSha256: string,
  contentSha256: string,
) => {
  const object = await bucket.head(objectKey);
  if (
    !object ||
    object.size !== byteSize ||
    !checksumMatches(object, objectSha256) ||
    object.customMetadata?.contentSha256 !== contentSha256
  ) {
    throw new Error(`R2 checksum verification failed for ${objectKey}`);
  }
};

const insertArchiveMetadata = async (
  db: D1Database,
  candidate: ArchiveCandidate,
  serialized: Awaited<ReturnType<typeof serializeCandidate>>,
  observedAt: string,
  status: ArchiveMetadataRow["status"],
  error: string | null,
) => {
  const result = await db
    .prepare(
      `insert into briar_log_archives (
         id, project_id, run_id, scope_id, archive_kind, object_key,
         format_version, status, row_count, byte_size, sha256,
         content_sha256, period_start, period_end, created_at, verified_at,
         completed_at, expires_at, failure_count, last_error,
         related_object_keys_json
       )
       select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?
       where ? = 'execution_audit'
          or ? is null
          or exists (
            select 1 from briar_hunt_runs run
            where run.id = ? and run.project_id = ?
          )
       on conflict (id) do update set
         status = excluded.status,
         byte_size = excluded.byte_size,
         sha256 = excluded.sha256,
         content_sha256 = excluded.content_sha256,
         verified_at = excluded.verified_at,
         expires_at = excluded.expires_at,
         failure_count = briar_log_archives.failure_count + excluded.failure_count,
         last_error = excluded.last_error`,
    )
    .bind(
      serialized.archiveId,
      candidate.projectId,
      candidate.runId,
      candidate.scopeId,
      candidate.kind,
      serialized.objectKey,
      archiveFormatVersion,
      status,
      candidate.rowCount,
      serialized.compressed.byteLength,
      serialized.objectSha256,
      serialized.contentSha256,
      candidate.periodStart,
      candidate.periodEnd,
      observedAt,
      status === "verified" ? observedAt : null,
      serialized.expiresAt,
      status === "failed" ? 1 : 0,
      error,
      JSON.stringify(candidate.relatedObjectKeys),
      candidate.kind,
      candidate.runId,
      candidate.runId,
      candidate.projectId,
    )
    .run();
  return result.meta.changes > 0;
};

const deleteIds = async (
  db: D1Database,
  table: string,
  column: string,
  ids: string[],
) => {
  for (let offset = 0; offset < ids.length; offset += deleteBatchSize) {
    const batch = ids.slice(offset, offset + deleteBatchSize);
    const placeholders = batch.map(() => "?").join(",");
    await db.prepare(`delete from ${table} where ${column} in (${placeholders})`).bind(
      ...batch,
    ).run();
  }
};

const deleteArchivedExecutionAuditIds = async (
  db: D1Database,
  ids: string[],
) => {
  for (let offset = 0; offset < ids.length; offset += deleteBatchSize) {
    const batch = ids.slice(offset, offset + deleteBatchSize);
    const placeholders = batch.map(() => "?").join(",");
    // A verified archive may have been produced by the previous Worker just
    // before this retention rule deployed. Preserve the exact current
    // dispatch/reassign audit even when finishing that already-staged purge.
    await db.prepare(
      `delete from briar_execution_audit_events
       where id in (${placeholders})
         and not exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_execution_audit_events.run_id
             and run.dispatch_request_id is not null
             and run.project_id = briar_execution_audit_events.project_id
             and run.dispatch_request_id =
               briar_execution_audit_events.request_id
             and briar_execution_audit_events.action in (
               'dispatched', 'reassigned'
             )
         )`,
    ).bind(...batch).run();
  }
};

const purgeArchiveRecords = async (
  db: D1Database,
  metadata: ArchiveMetadataRow,
  records: ArchiveRecord[],
) => {
  switch (metadata.archive_kind) {
    case "run_events":
      await deleteIds(
        db,
        "briar_hunt_events",
        "id",
        records.map((record) => decodeArchivedHuntEvent(record.data).id),
      );
      break;
    case "run_evidence":
      await deleteIds(
        db,
        "briar_run_evidence",
        "id",
        records
          .filter((record) => record.recordType === "run_evidence")
          .map((record) => decodeArchivedRunEvidence(record.data).id),
      );
      break;
    case "execution_audit":
      await deleteArchivedExecutionAuditIds(
        db,
        records.map((record) => decodeArchivedExecutionAudit(record.data).id),
      );
      break;
    case "agent_transcript":
      await deleteIds(
        db,
        "briar_agent_transcript_sessions",
        "session_id",
        records
          .filter((record) => record.recordType === "transcript_session")
          .map((record) =>
            decodeArchivedTranscriptSession(record.data).session_id
          ),
      );
      break;
    case "issue_messages":
      await deleteIds(
        db,
        "briar_issue_messages",
        "id",
        records.map((record) => decodeArchivedIssueMessage(record.data).id),
      );
      break;
    case "project_agent_sessions":
      for (const record of records) {
        const session = decodeArchivedProjectAgentSession(record.data);
        await upsertProjectAgentSessionSummary(db, session, true);
        await db
          .prepare(
            `delete from briar_project_agent_sessions
             where project_id = ? and id = ?`,
          )
          .bind(session.project_id, session.id)
          .run();
      }
      break;
  }
};

const readArchiveObject = async (
  bucket: ArchiveBucket,
  metadata: ArchiveMetadataRow,
) => {
  await verifyObject(
    bucket,
    metadata.object_key,
    metadata.byte_size,
    metadata.sha256,
    metadata.content_sha256,
  );
  const object = await bucket.get(metadata.object_key);
  if (!object) throw new Error(`Archive object not found: ${metadata.object_key}`);
  const content = await gunzip(object.body);
  if ((await sha256Text(content)) !== metadata.content_sha256) {
    throw new Error(`Archive content checksum failed: ${metadata.object_key}`);
  }
  const lines = content.trimEnd().split("\n");
  const manifest = decodeArchiveManifest(JSON.parse(lines.shift() ?? "null"));
  if (
    manifest.archiveId !== metadata.id ||
    manifest.kind !== metadata.archive_kind ||
    manifest.rowCount !== metadata.row_count
  ) {
    throw new Error(`Archive manifest does not match D1 metadata: ${metadata.id}`);
  }
  return lines.map((line) => decodeArchiveLine(JSON.parse(line)));
};

export async function readArchivedProjectAgentSession(
  bucket: ArchiveBucket,
  metadata: ArchiveMetadataRow,
): Promise<ProjectAgentSessionRow> {
  if (metadata.archive_kind !== "project_agent_sessions") {
    throw new Error(
      `Archive is not a project agent session: ${metadata.id}`,
    );
  }
  if (metadata.status !== "verified" && metadata.status !== "complete") {
    throw new Error(
      `Project agent session archive is not readable: ${metadata.id}`,
    );
  }

  const records = await readArchiveObject(bucket, metadata);
  if (
    metadata.row_count !== 1 ||
    records.length !== 1 ||
    records[0]?.recordType !== "project_agent_session"
  ) {
    throw new Error(
      `Project agent session archive must contain exactly one session: ${metadata.id}`,
    );
  }

  const session = decodeArchivedProjectAgentSession(records[0].data);
  if (
    session.project_id !== metadata.project_id ||
    session.id !== metadata.scope_id
  ) {
    throw new Error(
      `Project agent session archive scope does not match metadata: ${metadata.id}`,
    );
  }
  return session;
}

async function restoreArchivedProjectAgentSessionRequester(
  db: D1Database,
  session: ProjectAgentSessionRow,
) {
  if (session.requested_by_user_id !== null) return session;
  const approval = await db
    .prepare(
      `select approved_by_user_id
       from briar_agent_skill_execution_approval_audit
       where project_id = ? and result_session_id = ?
         and approved_by_user_id is not null
       limit 1`,
    )
    .bind(session.project_id, session.id)
    .first<{ approved_by_user_id: string }>();
  if (!approval) return session;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(session.payload_json) as Record<string, unknown>;
  } catch {
    return session;
  }
  return {
    ...session,
    requested_by_user_id: approval.approved_by_user_id,
    payload_json: JSON.stringify({
      ...payload,
      requestedByUserId: approval.approved_by_user_id,
    }),
  };
}

const completeVerifiedArchive = async (
  db: D1Database,
  bucket: ArchiveBucket,
  metadata: ArchiveMetadataRow,
  observedAt: string,
) => {
  try {
    const records = await readArchiveObject(bucket, metadata);
    await purgeArchiveRecords(db, metadata, records);
    await db
      .prepare(
        `update briar_log_archives
         set status = 'complete', completed_at = ?, last_error = null
         where id = ?`,
      )
      .bind(observedAt, metadata.id)
      .run();
    return metadata.row_count;
  } catch (error) {
    await db
      .prepare(
        `update briar_log_archives
         set failure_count = failure_count + 1, last_error = ?
         where id = ?`,
      )
      .bind(error instanceof Error ? error.message.slice(0, 1_000) : String(error), metadata.id)
      .run();
    throw error;
  }
};

class ArchiveCandidateOwnershipChangedError extends Error {}

export type ArchiveSweepResult = {
  attemptedObjects: number;
  completedObjects: number;
  archivedRows: number;
  failures: Array<{ kind: ArchiveKind; message: string }>;
};

export async function archiveCompletedLogs(
  db: D1Database,
  bucket: ArchiveBucket,
  observedAt: string,
  options: { maxObjects?: number; rowLimit?: number } = {},
): Promise<ArchiveSweepResult> {
  const maxObjects = Math.max(1, Math.min(options.maxObjects ?? 6, 24));
  const rowLimit = Math.max(1, Math.min(options.rowLimit ?? defaultArchiveRowLimit, 1_000));
  const result: ArchiveSweepResult = {
    attemptedObjects: 0,
    completedObjects: 0,
    archivedRows: 0,
    failures: [],
  };

  const resumable = await db
    .prepare(
      `select * from briar_log_archives
       where status = 'verified'
       order by created_at, id limit ?`,
    )
    .bind(maxObjects)
    .all<ArchiveMetadataRow>();
  for (const metadata of resumable.results ?? []) {
    result.attemptedObjects += 1;
    try {
      result.archivedRows += await completeVerifiedArchive(
        db,
        bucket,
        metadata,
        observedAt,
      );
      result.completedObjects += 1;
    } catch (error) {
      result.failures.push({
        kind: metadata.archive_kind,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  while (result.attemptedObjects < maxObjects) {
    let found = false;
    for (const policy of archivePolicies) {
      if (result.attemptedObjects >= maxObjects) break;
      const candidate = await selectCandidate(db, policy, observedAt, rowLimit);
      if (!candidate) continue;
      found = true;
      result.attemptedObjects += 1;
      let serialized: Awaited<ReturnType<typeof serializeCandidate>> | null = null;
      let verifiedMetadataPersisted = false;
      try {
        serialized = await serializeCandidate(candidate, policy, observedAt);
        const existing = await bucket.head(serialized.objectKey);
        if (!existing) {
          await bucket.put(serialized.objectKey, serialized.compressed, {
            httpMetadata: {
              contentType: "application/x-ndjson",
              contentEncoding: "gzip",
            },
            customMetadata: {
              archiveId: serialized.archiveId,
              formatVersion: String(archiveFormatVersion),
              contentSha256: serialized.contentSha256,
              sha256: serialized.objectSha256,
            },
            sha256: serialized.objectSha256,
            storageClass: "InfrequentAccess",
          });
        }
        await verifyObject(
          bucket,
          serialized.objectKey,
          serialized.compressed.byteLength,
          serialized.objectSha256,
          serialized.contentSha256,
        );
        const persisted = await insertArchiveMetadata(
          db,
          candidate,
          serialized,
          observedAt,
          "verified",
          null,
        );
        if (!persisted) {
          await bucket.delete(serialized.objectKey);
          throw new ArchiveCandidateOwnershipChangedError(
            "Archive candidate moved to another project before verification",
          );
        }
        verifiedMetadataPersisted = true;
        const metadata = await db
          .prepare(`select * from briar_log_archives where id = ?`)
          .bind(serialized.archiveId)
          .first<ArchiveMetadataRow>();
        if (!metadata) throw new Error("Archive metadata was not persisted");
        result.archivedRows += await completeVerifiedArchive(
          db,
          bucket,
          metadata,
          observedAt,
        );
        result.completedObjects += 1;
      } catch (error) {
        if (
          serialized &&
          !verifiedMetadataPersisted &&
          !(error instanceof ArchiveCandidateOwnershipChangedError)
        ) {
          await insertArchiveMetadata(
            db,
            candidate,
            serialized,
            observedAt,
            "failed",
            error instanceof Error ? error.message.slice(0, 1_000) : String(error),
          );
        }
        result.failures.push({
          kind: policy.kind,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!found) break;
  }
  return result;
}

const listArchiveMetadata = async (
  db: D1Database,
  projectId: string,
  options: { runId?: string; kind?: ArchiveKind; scopeId?: string } = {},
) => {
  const result = await db
    .prepare(
      `select * from briar_log_archives
       where project_id = ? and status = 'complete'
         and (? is null or run_id = ?)
         and (? is null or archive_kind = ?)
         and (? is null or scope_id = ?)
       order by period_start, id limit 200`,
    )
    .bind(
      projectId,
      options.runId ?? null,
      options.runId ?? null,
      options.kind ?? null,
      options.kind ?? null,
      options.scopeId ?? null,
      options.scopeId ?? null,
    )
    .all<ArchiveMetadataRow>();
  return result.results ?? [];
};

const archivedRecords = async (
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  options: { runId?: string; kind?: ArchiveKind; scopeId?: string },
) => {
  const metadata = await listArchiveMetadata(db, projectId, options);
  const records: ArchiveRecord[] = [];
  for (const archive of metadata) records.push(...(await readArchiveObject(bucket, archive)));
  return records;
};

const runCurrentlyBelongsToProject = async (
  db: D1Database,
  projectId: string,
  runId: string,
) => Boolean(await db
  .prepare(
    `select 1 as current
     from briar_hunt_runs where id = ? and project_id = ?`,
  )
  .bind(runId, projectId)
  .first<{ current: number }>());

export async function listArchivedRunEvents(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  runId: string,
) {
  if (!(await runCurrentlyBelongsToProject(db, projectId, runId))) return [];
  const records = await archivedRecords(db, bucket, projectId, {
    runId,
    kind: "run_events",
  });
  return records.map((record) => decodeArchivedHuntEvent(record.data));
}

export async function listArchivedRunEvidence(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  runId: string,
) {
  if (!(await runCurrentlyBelongsToProject(db, projectId, runId))) {
    return { evidence: [], images: [] };
  }
  const records = await archivedRecords(db, bucket, projectId, {
    runId,
    kind: "run_evidence",
  });
  return {
    evidence: records
      .filter((record) => record.recordType === "run_evidence")
      .map((record) => ({
        ...decodeArchivedRunEvidence(record.data),
        project_id: projectId,
        run_id: runId,
      })),
    images: records
      .filter((record) => record.recordType === "run_evidence_image")
      .map((record) => ({
        ...decodeArchivedRunEvidenceImage(record.data),
        project_id: projectId,
        run_id: runId,
      })),
  };
}

export async function listArchivedIssueMessages(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  runId: string,
) {
  if (!(await runCurrentlyBelongsToProject(db, projectId, runId))) return [];
  const records = await archivedRecords(db, bucket, projectId, {
    runId,
    kind: "issue_messages",
  });
  return records.map((record) => decodeArchivedIssueMessage(record.data));
}

export async function listArchivedExecutionAuditEvents(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  runId?: string,
) {
  const records = await archivedRecords(db, bucket, projectId, {
    runId,
    kind: "execution_audit",
  });
  return records.map((record) => decodeArchivedExecutionAudit(record.data));
}

const archivedWorkLogFromRecords = (records: ArchiveRecord[]) => {
  const sessionRecord = records.find(
    (record) => record.recordType === "transcript_session",
  );
  if (!sessionRecord) return null;
  return {
    session: decodeArchivedTranscriptSession(sessionRecord.data),
    entries: records
      .filter((record) => record.recordType === "worklog_entry")
      .map((record) => decodeArchivedWorkLogEntry(record.data))
      .sort(
        (left, right) =>
          left.sequence - right.sequence ||
          left.entry_id.localeCompare(right.entry_id),
      ),
    segments: records
      .filter((record) => record.recordType === "transcript_segment")
      .map((record) => decodeArchivedTranscriptSegment(record.data))
      .sort(
        (left, right) =>
          left.first_sequence - right.first_sequence ||
          left.last_sequence - right.last_sequence,
      ),
  };
};

export async function readArchivedWorkLog(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  sessionId: string,
) {
  const metadata = await listArchiveMetadata(db, projectId, {
    kind: "agent_transcript",
    scopeId: sessionId,
  });
  const records: ArchiveRecord[] = [];
  for (const archive of metadata) {
    if (
      archive.run_id &&
      !(await runCurrentlyBelongsToProject(db, projectId, archive.run_id))
    ) {
      continue;
    }
    records.push(...await readArchiveObject(bucket, archive));
  }
  const workLog = archivedWorkLogFromRecords(records);
  if (!workLog?.session.run_id) return workLog;
  const current = await runCurrentlyBelongsToProject(
    db,
    projectId,
    workLog.session.run_id,
  );
  return current ? workLog : null;
}

export async function readLatestArchivedWorkLogForRun(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  runId: string,
) {
  if (!(await runCurrentlyBelongsToProject(db, projectId, runId))) return null;
  const metadata = await db
    .prepare(
      `select * from briar_log_archives
       where project_id = ? and run_id = ?
         and archive_kind = 'agent_transcript' and status = 'complete'
       order by period_end desc, completed_at desc, id desc
       limit 1`,
    )
    .bind(projectId, runId)
    .first<ArchiveMetadataRow>();
  return metadata
    ? archivedWorkLogFromRecords(await readArchiveObject(bucket, metadata))
    : null;
}

export async function listArchivedProjectAgentSessions(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
) {
  const records = await archivedRecords(db, bucket, projectId, {
    kind: "project_agent_sessions",
  });
  return Promise.all(records.map((record) =>
    restoreArchivedProjectAgentSessionRequester(
      db,
      decodeArchivedProjectAgentSession(record.data),
    )
  ));
}

export async function getArchivedProjectAgentSession(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  sessionId: string,
) {
  const metadata = await db
    .prepare(
      `select * from briar_log_archives
       where project_id = ? and scope_id = ?
         and archive_kind = 'project_agent_sessions'
         and status in ('verified', 'complete')
       order by completed_at desc, verified_at desc, created_at desc, id desc
       limit 1`,
    )
    .bind(projectId, sessionId)
    .first<ArchiveMetadataRow>();
  if (!metadata) return null;
  return restoreArchivedProjectAgentSessionRequester(
    db,
    await readArchivedProjectAgentSession(bucket, metadata),
  );
}

/**
 * Migration 0093 can project hot rows in SQL, but historical archive payloads
 * only exist in R2. Read each missing legacy object once and persist its small
 * D1 catalog entry so every later list/delta request remains R2-free.
 */
export async function backfillArchivedProjectAgentSessionSummaries(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select archive.*
       from briar_log_archives archive
       where archive.project_id = ?
         and archive.archive_kind = 'project_agent_sessions'
         and archive.status in ('verified', 'complete')
         and not exists (
           select 1 from briar_project_agent_session_summaries summary
           where summary.project_id = archive.project_id
             and summary.session_id = archive.scope_id
         )
       order by archive.period_end desc, archive.id
       limit 200`,
    )
    .bind(projectId)
    .all<ArchiveMetadataRow>();
  for (let offset = 0; offset < result.results.length; offset += 8) {
    const archived = await Promise.all(
      result.results
        .slice(offset, offset + 8)
        .map(async (metadata) =>
          restoreArchivedProjectAgentSessionRequester(
            db,
            await readArchivedProjectAgentSession(bucket, metadata),
          )
        ),
    );
    for (const session of archived) {
      await upsertProjectAgentSessionSummary(db, session, true);
    }
  }
  return result.results.length;
}

export async function getArchivedEvidenceImage(
  db: D1Database,
  bucket: ArchiveBucket,
  projectId: string,
  runId: string,
  imageId: string,
) {
  if (!(await runCurrentlyBelongsToProject(db, projectId, runId))) return null;
  const archive = await listArchivedRunEvidence(db, bucket, projectId, runId);
  return archive.images.find((image) => image.id === imageId) ?? null;
}

export async function listArchiveObjectsForDeletion(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  const result = await db
    .prepare(
      `select object_key, related_object_keys_json
       from briar_log_archives archive
       where (? is null or archive.run_id = ?)
         and (
           archive.project_id = ?
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = archive.run_id and run.project_id = ?
           )
         )`,
    )
    .bind(runId ?? null, runId ?? null, projectId, projectId)
    .all<{ object_key: string; related_object_keys_json: string }>();
  const archives: string[] = [];
  const attachments: string[] = [];
  for (const row of result.results ?? []) {
    archives.push(row.object_key);
    const parsed = decodeRelatedArchiveObjectKeysOption(
      JSON.parse(row.related_object_keys_json),
    );
    if (Option.isSome(parsed)) attachments.push(...parsed.value);
  }
  return { archives, attachments };
}

export async function enqueueArchiveCleanup(
  db: D1Database,
  projectId: string,
  runId: string | null,
  objects: { archives: string[]; attachments: string[] },
  observedAt: string,
) {
  const entries = [
    ...objects.archives.map((objectKey) => ({ bucket: "archives", objectKey })),
    ...objects.attachments.map((objectKey) => ({ bucket: "attachments", objectKey })),
  ] as const;
  for (let offset = 0; offset < entries.length; offset += deleteBatchSize) {
    await db.batch(
      entries.slice(offset, offset + deleteBatchSize).map((entry) =>
        db
          .prepare(
            `insert into briar_archive_cleanup_queue (
             bucket, object_key, project_id, run_id, queued_at
             ) values (?, ?, ?, ?, ?)
             on conflict (bucket, object_key) do update set
               project_id = excluded.project_id,
               run_id = excluded.run_id,
               queued_at = excluded.queued_at,
               attempts = 0,
               last_attempt_at = null,
               last_error = null,
               generation = briar_archive_cleanup_queue.generation + 1,
               next_attempt_at = null,
               dead_lettered_at = null,
               alert_state = 'none',
               alert_detail_json = null`,
          )
          .bind(entry.bucket, entry.objectKey, projectId, runId, observedAt),
      ),
    );
  }
}

export async function processArchiveCleanupQueue(
  db: D1Database,
  archivesBucket: ArchiveBucket,
  attachmentsBucket: ArchiveBucket,
  observedAt: string,
  limit = 100,
) {
  const result = await db
    .prepare(
      `select queue.bucket, queue.object_key, queue.project_id, queue.run_id,
              queue.queued_at, queue.attempts, queue.generation
       from briar_archive_cleanup_queue queue
       where queue.dead_lettered_at is null
         and (queue.next_attempt_at is null or queue.next_attempt_at <= ?)
         and (
           (
             queue.run_id is not null
             and not exists (
               select 1 from briar_hunt_runs run where run.id = queue.run_id
             )
           ) or (
             queue.run_id is null
             and not exists (
               select 1 from briar_projects project
               where project.id = queue.project_id
             )
           )
         )
       order by coalesce(queue.next_attempt_at, queue.queued_at),
                queue.queued_at, queue.bucket, queue.object_key
       limit ?`,
    )
    .bind(observedAt, Math.max(1, Math.min(limit, 1_000)))
    .all<{
      bucket: "archives" | "attachments";
      object_key: string;
      project_id: string;
      run_id: string | null;
      queued_at: string;
      attempts: number;
      generation: number;
    }>();
  let deleted = 0;
  let failed = 0;
  for (const item of result.results ?? []) {
    const stillOwned = item.run_id
      ? await db
          .prepare(`select 1 as present from briar_hunt_runs where id = ?`)
          .bind(item.run_id)
          .first<{ present: number }>()
      : await db
          .prepare(`select 1 as present from briar_projects where id = ?`)
          .bind(item.project_id)
          .first<{ present: number }>();
    if (stillOwned) continue;
    const referenced = item.bucket === "archives"
      ? await db
          .prepare(
            `select 1 as present from briar_log_archives
             where object_key = ? limit 1`,
          )
          .bind(item.object_key)
          .first<{ present: number }>()
      : await db
          .prepare(
            `select 1 as present
             where exists (
               select 1 from briar_issue_attachments
               where object_key = ?
             )
             or exists (
               select 1 from briar_run_evidence_images
               where object_key = ?
             )
             or exists (
               select 1 from briar_project_agents
               where avatar_spritesheet_object_key = ?
             )
             or exists (
               select 1 from briar_channel_message_attachments
               where object_key = ?
             )
             or exists (
               select 1
               from briar_log_archives archive,
                    json_each(archive.related_object_keys_json) related
               where related.type = 'text' and related.value = ?
             )`,
          )
          .bind(
            item.object_key,
            item.object_key,
            item.object_key,
            item.object_key,
            item.object_key,
          )
          .first<{ present: number }>();
    if (referenced) {
      // Ownership moved after this cleanup item was queued. The destination
      // metadata is authoritative; a future destination deletion will enqueue
      // the object again under its own lifecycle. Recheck that reference in
      // the same statement as the generation CAS so a stale worker cannot
      // remove a cleanup request that was concurrently refreshed.
      await db
        .prepare(
          `delete from briar_archive_cleanup_queue
           where bucket = ? and object_key = ?
             and project_id = ? and run_id is ? and queued_at = ?
             and generation = ?
             and (
               (
                 bucket = 'archives'
                 and exists (
                   select 1 from briar_log_archives archive
                   where archive.object_key = briar_archive_cleanup_queue.object_key
                 )
               ) or (
                 bucket = 'attachments'
                 and (
                   exists (
                     select 1 from briar_issue_attachments attachment
                     where attachment.object_key = briar_archive_cleanup_queue.object_key
                   )
                   or exists (
                     select 1 from briar_run_evidence_images image
                     where image.object_key = briar_archive_cleanup_queue.object_key
                   )
                   or exists (
                     select 1 from briar_project_agents agent
                     where agent.avatar_spritesheet_object_key = briar_archive_cleanup_queue.object_key
                   )
                   or exists (
                     select 1 from briar_channel_message_attachments attachment
                     where attachment.object_key = briar_archive_cleanup_queue.object_key
                   )
                   or exists (
                     select 1
                     from briar_log_archives archive,
                          json_each(archive.related_object_keys_json) related
                     where related.type = 'text'
                       and related.value = briar_archive_cleanup_queue.object_key
                   )
                 )
               )
             )`,
        )
        .bind(
          item.bucket,
          item.object_key,
          item.project_id,
          item.run_id,
          item.queued_at,
          item.generation,
        )
        .run();
      continue;
    }
    try {
      await (item.bucket === "archives" ? archivesBucket : attachmentsBucket).delete(
        item.object_key,
      );
      const completion = await db
        .prepare(
          `delete from briar_archive_cleanup_queue
           where bucket = ? and object_key = ?
             and project_id = ? and run_id is ? and queued_at = ?
             and generation = ?
             and (
               (
                 run_id is not null
                 and not exists (
                   select 1 from briar_hunt_runs run
                   where run.id = briar_archive_cleanup_queue.run_id
                 )
               ) or (
                 run_id is null
                 and not exists (
                   select 1 from briar_projects project
                   where project.id = briar_archive_cleanup_queue.project_id
                 )
               )
             )
             and (
               (
                 bucket = 'archives'
                 and not exists (
                   select 1 from briar_log_archives archive
                   where archive.object_key = briar_archive_cleanup_queue.object_key
                 )
               ) or (
                 bucket = 'attachments'
                 and not exists (
                   select 1 from briar_issue_attachments attachment
                   where attachment.object_key = briar_archive_cleanup_queue.object_key
                 )
                 and not exists (
                   select 1 from briar_run_evidence_images image
                   where image.object_key = briar_archive_cleanup_queue.object_key
                 )
                 and not exists (
                   select 1 from briar_project_agents agent
                   where agent.avatar_spritesheet_object_key = briar_archive_cleanup_queue.object_key
                 )
                 and not exists (
                   select 1 from briar_channel_message_attachments attachment
                   where attachment.object_key = briar_archive_cleanup_queue.object_key
                 )
                 and not exists (
                   select 1
                   from briar_log_archives archive,
                        json_each(archive.related_object_keys_json) related
                   where related.type = 'text'
                     and related.value = briar_archive_cleanup_queue.object_key
                 )
               )
             )`,
        )
        .bind(
          item.bucket,
          item.object_key,
          item.project_id,
          item.run_id,
          item.queued_at,
          item.generation,
        )
        .run();
      if ((completion.meta.changes ?? 0) > 0) deleted += 1;
    } catch (error) {
      const message = error instanceof Error
        ? error.message.slice(0, 1_000)
        : String(error).slice(0, 1_000);
      const attempts = item.attempts + 1;
      const deadLettered = attempts >= archiveCleanupRetryPolicy.maxAttempts;
      const delay = Math.min(
        archiveCleanupRetryPolicy.baseDelayMilliseconds * (2 ** (attempts - 1)),
        archiveCleanupRetryPolicy.maxDelayMilliseconds,
      );
      const nextAttemptAt = deadLettered
        ? null
        : new Date(Date.parse(observedAt) + delay).toISOString();
      const alertDetail = deadLettered
        ? JSON.stringify({
            code: "ARCHIVE_CLEANUP_DEAD_LETTER",
            bucket: item.bucket,
            objectKey: item.object_key,
            projectId: item.project_id,
            runId: item.run_id,
            attempts,
            lastError: message,
            deadLetteredAt: observedAt,
          })
        : null;
      const failure = await db
        .prepare(
          `update briar_archive_cleanup_queue
           set attempts = ?, last_attempt_at = ?, last_error = ?,
               next_attempt_at = ?, dead_lettered_at = ?,
               alert_state = ?, alert_detail_json = ?
           where bucket = ? and object_key = ?
             and project_id = ? and run_id is ? and queued_at = ?
             and generation = ?`,
        )
        .bind(
          attempts,
          observedAt,
          message,
          nextAttemptAt,
          deadLettered ? observedAt : null,
          deadLettered ? "pending" : "none",
          alertDetail,
          item.bucket,
          item.object_key,
          item.project_id,
          item.run_id,
          item.queued_at,
          item.generation,
        )
        .run();
      if ((failure.meta.changes ?? 0) > 0) failed += 1;
    }
  }
  return { deleted, failed };
}

export async function expireArchives(
  db: D1Database,
  archivesBucket: ArchiveBucket,
  attachmentsBucket: ArchiveBucket,
  observedAt: string,
  limit = 100,
) {
  const result = await db
    .prepare(
      `select * from briar_log_archives
       where status = 'complete' and expires_at <= ?
       order by expires_at, id limit ?`,
    )
    .bind(observedAt, Math.max(1, Math.min(limit, 1_000)))
    .all<ArchiveMetadataRow>();
  let deleted = 0;
  for (const archive of result.results ?? []) {
    const related = decodeRelatedArchiveObjectKeysOption(
      JSON.parse(archive.related_object_keys_json),
    );
    await archivesBucket.delete(archive.object_key);
    if (Option.isSome(related) && related.value.length > 0) {
      await attachmentsBucket.delete(related.value);
    }
    if (archive.archive_kind === "project_agent_sessions") {
      await db.batch([
        db.prepare(`delete from briar_log_archives where id = ?`).bind(archive.id),
        db.prepare(
          `delete from briar_project_agent_session_summaries
           where project_id = ? and session_id = ?
             and not exists (
               select 1 from briar_project_agent_sessions session
               where session.project_id = ? and session.id = ?
             )
             and not exists (
               select 1 from briar_log_archives retained
               where retained.project_id = ? and retained.scope_id = ?
                 and retained.archive_kind = 'project_agent_sessions'
                 and retained.status in ('verified', 'complete')
             )`,
        ).bind(
          archive.project_id,
          archive.scope_id,
          archive.project_id,
          archive.scope_id,
          archive.project_id,
          archive.scope_id,
        ),
        db.prepare(
          `delete from briar_project_agent_session_context_membership
           where project_id = ? and session_id = ?
             and not exists (
               select 1 from briar_project_agent_sessions session
               where session.project_id = ? and session.id = ?
             )
             and not exists (
               select 1 from briar_log_archives retained
               where retained.project_id = ? and retained.scope_id = ?
                 and retained.archive_kind = 'project_agent_sessions'
                 and retained.status in ('verified', 'complete')
             )`,
        ).bind(
          archive.project_id,
          archive.scope_id,
          archive.project_id,
          archive.scope_id,
          archive.project_id,
          archive.scope_id,
        ),
      ]);
    } else {
      await db.prepare(`delete from briar_log_archives where id = ?`).bind(archive.id).run();
    }
    deleted += 1;
  }
  return deleted;
}

export type StorageMetrics = {
  databaseBytes: number | null;
  hotRows: Record<ArchiveKind, number>;
  archives: Array<{
    kind: ArchiveKind;
    status: ArchiveMetadataRow["status"];
    objects: number;
    rows: number;
    bytes: number;
    failures: number;
  }>;
  cleanupPending: number;
  policies: readonly ArchivePolicy[];
};

export async function collectStorageMetrics(
  db: D1Database,
  projectId: string,
): Promise<StorageMetrics> {
  const [sizeProbe, hot, archives, cleanup] = await Promise.all([
    db.prepare(`select 1`).run(),
    db
      .prepare(
        `select
           (select count(*) from briar_hunt_events event
            join briar_hunt_runs run on run.id = event.run_id
            where run.project_id = ?) as run_events,
           (select count(*) from briar_run_evidence where project_id = ?) as run_evidence,
           (select count(*) from briar_execution_audit_events where project_id = ?) as execution_audit,
           ((select count(*) from briar_agent_worklog_entries entry
            join briar_agent_transcript_sessions session
              on session.session_id = entry.session_id
            where session.project_id = ?) +
            (select count(*) from briar_agent_transcript_segments segment
             join briar_agent_transcript_sessions session
               on session.session_id = segment.session_id
             where session.project_id = ?)) as agent_transcript,
           (select count(*) from briar_issue_messages where project_id = ?) as issue_messages,
           (select count(*) from briar_project_agent_sessions where project_id = ?) as project_agent_sessions`,
      )
      .bind(
        projectId,
        projectId,
        projectId,
        projectId,
        projectId,
        projectId,
        projectId,
      )
      .first<Record<ArchiveKind, number>>(),
    db
      .prepare(
        `select archive_kind as kind, status, count(*) as objects,
                coalesce(sum(row_count), 0) as rows,
                coalesce(sum(byte_size), 0) as bytes,
                coalesce(sum(failure_count), 0) as failures
         from briar_log_archives where project_id = ?
         group by archive_kind, status order by archive_kind, status`,
      )
      .bind(projectId)
      .all<{
        kind: ArchiveKind;
        status: ArchiveMetadataRow["status"];
        objects: number;
        rows: number;
        bytes: number;
        failures: number;
      }>(),
    db
      .prepare(
        `select count(*) as pending from briar_archive_cleanup_queue
         where project_id = ?`,
      )
      .bind(projectId)
      .first<{ pending: number }>(),
  ]);
  return {
    databaseBytes: sizeProbe.meta.size_after,
    hotRows: hot ?? {
      run_events: 0,
      run_evidence: 0,
      execution_audit: 0,
      agent_transcript: 0,
      issue_messages: 0,
      project_agent_sessions: 0,
    },
    archives: archives.results ?? [],
    cleanupPending: cleanup?.pending ?? 0,
    policies: archivePolicies,
  };
}
