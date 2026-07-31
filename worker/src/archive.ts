export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_MAX_ROWS = 500;
export const ARCHIVE_MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024;
export const ARCHIVE_DELETE_BATCH_SIZE = 50;

export const archiveRetention = {
  huntEventDays: 30,
  runEvidenceDays: 90,
  issueMessageDays: 365,
  executionAuditDays: 90,
  agentTranscriptDays: 14,
  projectAgentSessionDays: 30,
  r2ArchiveDays: 7 * 365,
} as const;

export type ArchiveTable =
  | "briar_hunt_events"
  | "briar_run_evidence"
  | "briar_issue_messages"
  | "briar_execution_audit_events"
  | "briar_agent_transcripts"
  | "briar_project_agent_sessions";

export type ArchiveRecord = {
  table: ArchiveTable;
  key: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

export type ArchiveManifest = {
  id: string;
  project_id: string;
  run_id: string | null;
  object_key: string;
  format_version: number;
  content_encoding: "gzip";
  row_count: number;
  byte_count: number;
  sha256: string;
  period_start: string;
  period_end: string;
  created_at: string;
  verified_at: string;
};

export type ArchiveCycleMetrics = {
  outcome: "completed" | "partial";
  archivedObjects: number;
  archivedRows: number;
  archivedBytes: number;
  failedObjects: number;
  purgedObjects: number;
  hotRows: Record<string, number>;
  d1Bytes: number | null;
};

const DAY_MS = 86_400_000;
const cutoff = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS).toISOString();

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (value: ArrayBuffer) =>
  hex(await crypto.subtle.digest("SHA-256", value));

const gzip = async (value: string) =>
  await new Response(
    new Blob([value]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

const gunzip = async (value: ArrayBuffer) =>
  await new Response(
    new Blob([value]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();

const chunks = <T>(values: T[], size: number) => {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
};

const placeholders = (count: number) => Array(count).fill("?").join(", ");

const selectRows = async <T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  bindings: unknown[],
) => {
  const result = await db.prepare(sql).bind(...bindings).all<T>();
  return result.results ?? [];
};

const recordSize = (record: ArchiveRecord) =>
  new TextEncoder().encode(`${JSON.stringify(record)}\n`).byteLength;

function boundedRecords(records: ArchiveRecord[]) {
  const selected: ArchiveRecord[] = [];
  let bytes = 0;
  for (const record of records) {
    const nextBytes = recordSize(record);
    if (
      selected.length >= ARCHIVE_MAX_ROWS ||
      (selected.length > 0 && bytes + nextBytes > ARCHIVE_MAX_UNCOMPRESSED_BYTES)
    ) {
      break;
    }
    selected.push(record);
    bytes += nextBytes;
  }
  return selected;
}

async function collectRunRecords(
  db: D1Database,
  projectId: string,
  runId: string,
  now: Date,
) {
  const limit = ARCHIVE_MAX_ROWS;
  const [events, evidence, messages, audits, transcripts] = await Promise.all([
    selectRows<Record<string, unknown>>(
      db,
      `select event.* from briar_hunt_events event
       join briar_hunt_runs run on run.id = event.run_id
       where run.project_id = ? and event.run_id = ? and event.occurred_at < ?
       order by event.occurred_at, event.id limit ?`,
      [projectId, runId, cutoff(now, archiveRetention.huntEventDays), limit],
    ),
    selectRows<Record<string, unknown>>(
      db,
      `select evidence.*,
              coalesce((select json_group_array(json_object(
                'id', image.id, 'project_id', image.project_id,
                'run_id', image.run_id, 'evidence_id', image.evidence_id,
                'object_key', image.object_key, 'filename', image.filename,
                'content_type', image.content_type, 'byte_size', image.byte_size,
                'sha256', image.sha256, 'position', image.position,
                'created_at', image.created_at
              )) from briar_run_evidence_images image
              where image.evidence_id = evidence.id), '[]') as archive_images_json
       from briar_run_evidence evidence
       where evidence.project_id = ? and evidence.run_id = ?
         and evidence.observed_at < ?
       order by evidence.observed_at, evidence.id limit ?`,
      [projectId, runId, cutoff(now, archiveRetention.runEvidenceDays), limit],
    ),
    selectRows<Record<string, unknown>>(
      db,
      `select message.*, author.name as author_name,
              author.image as author_image,
              (select count(*) from briar_issue_messages reply_count
               where reply_count.parent_message_id = message.id) as reply_count
       from briar_issue_messages message
       join briar_hunt_runs run on run.id = message.run_id
       left join "user" author on author.id = message.author_user_id
       where run.project_id = ? and message.run_id = ? and message.updated_at < ?
         and not exists (
           select 1 from briar_issue_messages reply
           where reply.parent_message_id = message.id
         )
       order by message.updated_at, message.id limit ?`,
      [projectId, runId, cutoff(now, archiveRetention.issueMessageDays), limit],
    ),
    selectRows<Record<string, unknown>>(
      db,
      `select * from briar_execution_audit_events
       where project_id = ? and run_id = ? and occurred_at < ?
       order by occurred_at, id limit ?`,
      [projectId, runId, cutoff(now, archiveRetention.executionAuditDays), limit],
    ),
    selectRows<Record<string, unknown>>(
      db,
      `select transcript.* from briar_agent_transcripts transcript
       join briar_agent_transcript_sessions session
         on session.session_id = transcript.session_id
       where session.project_id = ? and session.run_id = ?
         and transcript.recorded_at < ?
       order by transcript.recorded_at, transcript.session_id, transcript.sequence
       limit ?`,
      [projectId, runId, cutoff(now, archiveRetention.agentTranscriptDays), limit],
    ),
  ]);

  const mapRows = (
    table: ArchiveTable,
    rows: Record<string, unknown>[],
    key: (row: Record<string, unknown>) => string,
    time: (row: Record<string, unknown>) => string,
  ) => rows.map((data) => ({ table, key: key(data), occurredAt: time(data), data }));

  return boundedRecords([
    ...mapRows("briar_hunt_events", events, (row) => String(row.id), (row) => String(row.occurred_at)),
    ...mapRows("briar_run_evidence", evidence, (row) => String(row.id), (row) => String(row.observed_at)),
    ...mapRows("briar_execution_audit_events", audits, (row) => String(row.id), (row) => String(row.occurred_at)),
    ...mapRows("briar_agent_transcripts", transcripts, (row) => `${row.session_id}:${row.sequence}`, (row) => String(row.recorded_at)),
    ...mapRows("briar_issue_messages", messages, (row) => String(row.id), (row) => String(row.updated_at)),
  ]);
}

async function collectProjectSessionRecords(
  db: D1Database,
  projectId: string,
  now: Date,
) {
  const [sessions, audits, transcripts] = await Promise.all([
    selectRows<Record<string, unknown>>(
      db,
      `select * from briar_project_agent_sessions
       where project_id = ? and status != 'running' and updated_at < ?
       order by updated_at, id limit ?`,
      [projectId, cutoff(now, archiveRetention.projectAgentSessionDays), ARCHIVE_MAX_ROWS],
    ),
    selectRows<Record<string, unknown>>(
      db,
      `select * from briar_execution_audit_events
       where project_id = ? and run_id is null and occurred_at < ?
       order by occurred_at, id limit ?`,
      [projectId, cutoff(now, archiveRetention.executionAuditDays), ARCHIVE_MAX_ROWS],
    ),
    selectRows<Record<string, unknown>>(
      db,
      `select transcript.* from briar_agent_transcripts transcript
       join briar_agent_transcript_sessions session
         on session.session_id = transcript.session_id
       where session.project_id = ? and session.run_id is null
         and transcript.recorded_at < ?
       order by transcript.recorded_at, transcript.session_id, transcript.sequence
       limit ?`,
      [projectId, cutoff(now, archiveRetention.agentTranscriptDays), ARCHIVE_MAX_ROWS],
    ),
  ]);
  return boundedRecords([
    ...audits.map((data) => ({
      table: "briar_execution_audit_events" as const,
      key: String(data.id), occurredAt: String(data.occurred_at), data,
    })),
    ...transcripts.map((data) => ({
      table: "briar_agent_transcripts" as const,
      key: `${data.session_id}:${data.sequence}`,
      occurredAt: String(data.recorded_at), data,
    })),
    ...sessions.map((data) => ({
      table: "briar_project_agent_sessions" as const,
      key: String(data.id), occurredAt: String(data.updated_at), data,
    })),
  ]);
}

function deleteStatements(db: D1Database, records: ArchiveRecord[]) {
  const statements: D1PreparedStatement[] = [];
  const byTable = new Map<ArchiveTable, ArchiveRecord[]>();
  for (const record of records) {
    byTable.set(record.table, [...(byTable.get(record.table) ?? []), record]);
  }
  for (const [table, tableRecords] of byTable) {
    if (table === "briar_agent_transcripts") {
      for (const group of chunks(tableRecords, ARCHIVE_DELETE_BATCH_SIZE)) {
        statements.push(db.prepare(
          `delete from briar_agent_transcripts where ${group.map(() => "(session_id = ? and sequence = ?)").join(" or ")}`,
        ).bind(...group.flatMap((record) => [record.data.session_id, record.data.sequence])));
      }
      continue;
    }
    const keyColumn = table === "briar_project_agent_sessions" ? "id" : "id";
    for (const group of chunks(tableRecords, ARCHIVE_DELETE_BATCH_SIZE)) {
      statements.push(db.prepare(
        `delete from ${table} where ${keyColumn} in (${placeholders(group.length)})`,
      ).bind(...group.map((record) => record.key)));
    }
  }
  return statements;
}

async function persistArchive(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
  runId: string | null,
  records: ArchiveRecord[],
  now: Date,
) {
  if (records.length === 0) return null;
  records.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.table.localeCompare(right.table) || left.key.localeCompare(right.key));
  const header = JSON.stringify({
    format: "briar-log-archive",
    version: ARCHIVE_FORMAT_VERSION,
    projectId,
    runId,
  });
  const body = `${header}\n${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const contentChecksum = await sha256(new TextEncoder().encode(body).buffer);
  const compressed = await gzip(body);
  const checksum = await sha256(compressed);
  const scope = runId ? `runs/${runId}` : "project-logs";
  const objectKey = `v1/projects/${projectId}/${scope}/${contentChecksum}.jsonl.gz`;
  await bucket.put(objectKey, compressed, {
    httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
    customMetadata: { sha256: checksum, formatVersion: String(ARCHIVE_FORMAT_VERSION) },
  });
  const uploaded = await bucket.get(objectKey);
  if (!uploaded) throw new Error(`archive upload verification failed: ${objectKey} is missing`);
  const uploadedBytes = await uploaded.arrayBuffer();
  const verifiedChecksum = await sha256(uploadedBytes);
  if (verifiedChecksum !== checksum) {
    throw new Error(`archive upload verification failed: checksum mismatch for ${objectKey}`);
  }

  const createdAt = now.toISOString();
  const manifest: ArchiveManifest = {
    id: crypto.randomUUID(), project_id: projectId, run_id: runId,
    object_key: objectKey, format_version: ARCHIVE_FORMAT_VERSION,
    content_encoding: "gzip", row_count: records.length,
    byte_count: uploadedBytes.byteLength, sha256: checksum,
    period_start: records[0]!.occurredAt,
    period_end: records.at(-1)!.occurredAt,
    created_at: createdAt, verified_at: createdAt,
  };
  const insert = db.prepare(
    `insert into briar_log_archives (
       id, project_id, run_id, object_key, format_version, content_encoding,
       row_count, byte_count, sha256, period_start, period_end, created_at, verified_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (object_key) do nothing`,
  ).bind(
    manifest.id, manifest.project_id, manifest.run_id, manifest.object_key,
    manifest.format_version, manifest.content_encoding, manifest.row_count,
    manifest.byte_count, manifest.sha256, manifest.period_start,
    manifest.period_end, manifest.created_at, manifest.verified_at,
  );
  await db.batch([insert, ...deleteStatements(db, records)]);
  return manifest;
}

export async function archiveRunBatch(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
  runId: string,
  now = new Date(),
) {
  const run = await db.prepare(
    `select id from briar_hunt_runs
     where id = ? and project_id = ? and status = 'completed'`,
  ).bind(runId, projectId).first<{ id: string }>();
  if (!run) return null;
  return persistArchive(db, bucket, projectId, runId,
    await collectRunRecords(db, projectId, runId, now), now);
}

export async function archiveProjectSessionBatch(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
  now = new Date(),
) {
  return persistArchive(db, bucket, projectId, null,
    await collectProjectSessionRecords(db, projectId, now), now);
}

export async function listArchiveManifests(
  db: D1Database,
  projectId: string,
  runId?: string | null,
) {
  const condition = runId === undefined ? "" : runId === null
    ? " and run_id is null" : " and run_id = ?";
  const result = await db.prepare(
    `select * from briar_log_archives where project_id = ?${condition}
     order by period_start, id`,
  ).bind(...(typeof runId === "string" ? [projectId, runId] : [projectId]))
    .all<ArchiveManifest>();
  return result.results ?? [];
}

export async function readArchivedRecords(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
  runId?: string | null,
) {
  const manifests = await listArchiveManifests(db, projectId, runId);
  const records: ArchiveRecord[] = [];
  for (const manifest of manifests) {
    const object = await bucket.get(manifest.object_key);
    if (!object) throw new Error(`archive object missing: ${manifest.object_key}`);
    const bytes = await object.arrayBuffer();
    if (await sha256(bytes) !== manifest.sha256) {
      throw new Error(`archive checksum mismatch: ${manifest.object_key}`);
    }
    const lines = (await gunzip(bytes)).trimEnd().split("\n");
    const header = JSON.parse(lines.shift() ?? "null") as Record<string, unknown> | null;
    if (header?.format !== "briar-log-archive" || header.version !== ARCHIVE_FORMAT_VERSION) {
      throw new Error(`unsupported archive format: ${manifest.object_key}`);
    }
    records.push(...lines.filter(Boolean).map((line) => JSON.parse(line) as ArchiveRecord));
  }
  return records;
}

export async function archivedRows<T>(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
  runId: string | null,
  table: ArchiveTable,
) {
  const records = await readArchivedRecords(db, bucket, projectId, runId);
  return records.filter((record) => record.table === table).map((record) => record.data as T);
}

export async function restoreArchivedIssueMessage(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
  runId: string,
  messageId: string,
) {
  const hot = await db.prepare(
    `select id from briar_issue_messages
     where id = ? and project_id = ? and run_id = ? and parent_message_id is null`,
  ).bind(messageId, projectId, runId).first<{ id: string }>();
  if (hot) return true;
  const archived = (await archivedRows<Record<string, unknown>>(
    db, bucket, projectId, runId, "briar_issue_messages",
  )).find((message) => message.id === messageId);
  if (!archived || archived.parent_message_id !== null) return false;
  const result = await db.prepare(
    `insert into briar_issue_messages (
       id, project_id, run_id, parent_message_id, author_user_id,
       author_agent_provider, body, created_at, updated_at
     ) values (?, ?, ?, null, (select id from "user" where id = ?), ?, ?, ?, ?)
     on conflict (id) do nothing`,
  ).bind(
    archived.id, projectId, runId, archived.author_user_id,
    archived.author_agent_provider, archived.body,
    archived.created_at, archived.updated_at,
  ).run();
  return result.meta.changes > 0;
}

export async function purgeExpiredArchives(
  db: D1Database,
  bucket: R2Bucket,
  now = new Date(),
) {
  const expired = await selectRows<ArchiveManifest>(db,
    `select * from briar_log_archives where period_end < ? order by period_end limit 100`,
    [cutoff(now, archiveRetention.r2ArchiveDays)]);
  for (const manifest of expired) {
    await bucket.delete(manifest.object_key);
    await db.prepare(`delete from briar_log_archives where id = ?`).bind(manifest.id).run();
  }
  return expired.length;
}

async function hotRowMetrics(db: D1Database) {
  const tables = [
    "briar_hunt_events", "briar_run_evidence", "briar_issue_messages",
    "briar_execution_audit_events", "briar_agent_transcripts",
    "briar_project_agent_sessions",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await db.prepare(`select count(*) as count from ${table}`).first<{ count: number }>();
    counts[table] = row?.count ?? 0;
  }
  return counts;
}

async function d1Size(db: D1Database) {
  try {
    const [pages, size] = await Promise.all([
      db.prepare("pragma page_count").first<Record<string, number>>(),
      db.prepare("pragma page_size").first<Record<string, number>>(),
    ]);
    return (Object.values(pages ?? {})[0] ?? 0) * (Object.values(size ?? {})[0] ?? 0);
  } catch {
    return null;
  }
}

export async function runArchiveCycle(
  db: D1Database,
  bucket: R2Bucket,
  now = new Date(),
): Promise<ArchiveCycleMetrics> {
  let archivedObjects = 0;
  let archivedRows = 0;
  let archivedBytes = 0;
  let failedObjects = 0;
  const candidates = await selectRows<{ id: string; project_id: string }>(db,
    `select id, project_id from briar_hunt_runs
     where status = 'completed' and (
       exists (select 1 from briar_hunt_events event
               where event.run_id = briar_hunt_runs.id and event.occurred_at < ?)
       or exists (select 1 from briar_run_evidence evidence
                  where evidence.run_id = briar_hunt_runs.id and evidence.observed_at < ?)
       or exists (select 1 from briar_issue_messages message
                  where message.run_id = briar_hunt_runs.id and message.updated_at < ?
                    and not exists (select 1 from briar_issue_messages reply
                                    where reply.parent_message_id = message.id))
       or exists (select 1 from briar_execution_audit_events audit
                  where audit.run_id = briar_hunt_runs.id and audit.occurred_at < ?)
       or exists (select 1 from briar_agent_transcripts transcript
                  join briar_agent_transcript_sessions session
                    on session.session_id = transcript.session_id
                  where session.run_id = briar_hunt_runs.id and transcript.recorded_at < ?)
     )
     order by completed_at, id limit 20`, [
       cutoff(now, archiveRetention.huntEventDays),
       cutoff(now, archiveRetention.runEvidenceDays),
       cutoff(now, archiveRetention.issueMessageDays),
       cutoff(now, archiveRetention.executionAuditDays),
       cutoff(now, archiveRetention.agentTranscriptDays),
     ]);
  for (const candidate of candidates) {
    try {
      const manifest = await archiveRunBatch(db, bucket, candidate.project_id, candidate.id, now);
      if (manifest) {
        archivedObjects += 1;
        archivedRows += manifest.row_count;
        archivedBytes += manifest.byte_count;
      }
    } catch (error) {
      failedObjects += 1;
      console.error(JSON.stringify({ metric: "briar_archive_failure", runId: candidate.id,
        error: error instanceof Error ? error.message : String(error) }));
    }
  }
  const projects = await selectRows<{ id: string }>(db, `select id from briar_projects order by id`, []);
  for (const project of projects) {
    try {
      const manifest = await archiveProjectSessionBatch(db, bucket, project.id, now);
      if (manifest) {
        archivedObjects += 1;
        archivedRows += manifest.row_count;
        archivedBytes += manifest.byte_count;
      }
    } catch (error) {
      failedObjects += 1;
      console.error(JSON.stringify({ metric: "briar_archive_failure", projectId: project.id,
        error: error instanceof Error ? error.message : String(error) }));
    }
  }
  const metrics: ArchiveCycleMetrics = {
    outcome: failedObjects ? "partial" : "completed",
    archivedObjects, archivedRows, archivedBytes, failedObjects,
    purgedObjects: await purgeExpiredArchives(db, bucket, now),
    hotRows: await hotRowMetrics(db), d1Bytes: await d1Size(db),
  };
  console.log(JSON.stringify({ metric: "briar_archive_cycle", ...metrics }));
  return metrics;
}
