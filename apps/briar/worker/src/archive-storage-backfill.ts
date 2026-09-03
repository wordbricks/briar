import {
  archiveFormatVersion,
  decodeArchivedProjectAgentSession,
  decodeArchivedProjectAgentSessionRow,
  decodeArchiveLine,
  decodeArchiveManifest,
} from "./archive-contract";
import type { ArchiveBucket, ArchiveMetadataRow } from "./archive";
import {
  decodeStoredTeamAgentSessionPayload,
  encodeStoredTeamAgentSessionPayload,
} from "./team-request-contract";

const encoder = new TextEncoder();
const canonicalObjectMarker = ".canonical-v1-";
const maxArchiveBytes = 16 * 1024 * 1024;

const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (bytes: ArrayBuffer | Uint8Array) =>
  bytesToHex(
    await crypto.subtle.digest(
      "SHA-256",
      bytes instanceof Uint8Array ? bytes.slice().buffer : bytes,
    ),
  );

const gzip = (content: string) =>
  new Response(
    new Blob([content]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

const gunzip = (bytes: ArrayBuffer) =>
  new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();

const parseJsonObject = (json: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(json);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Archived project agent session payload must be an object");
  }
  return value as Record<string, unknown>;
};

export function canonicalizeProjectAgentSessionArchive(
  content: string,
  metadata: ArchiveMetadataRow,
): string {
  if (!content.endsWith("\n")) {
    throw new Error(`Archive ${metadata.id} must end with a newline`);
  }
  const lines = content.slice(0, -1).split("\n");
  if (lines.length !== 2 || lines.some((line) => line.length === 0)) {
    throw new Error(
      `Project agent session archive ${metadata.id} must contain one record`,
    );
  }

  const manifest = decodeArchiveManifest(JSON.parse(lines[0]));
  if (
    manifest.archiveId !== metadata.id ||
    manifest.projectId !== metadata.project_id ||
    manifest.runId !== metadata.run_id ||
    manifest.scopeId !== metadata.scope_id ||
    manifest.kind !== "project_agent_sessions" ||
    manifest.rowCount !== 1 ||
    metadata.archive_kind !== "project_agent_sessions" ||
    metadata.row_count !== 1 ||
    metadata.format_version !== archiveFormatVersion
  ) {
    throw new Error(`Archive ${metadata.id} manifest does not match D1 metadata`);
  }

  const record = decodeArchiveLine(JSON.parse(lines[1]));
  if (record.recordType !== "project_agent_session") {
    throw new Error(`Archive ${metadata.id} contains the wrong record type`);
  }
  const row = decodeArchivedProjectAgentSessionRow(record.data);
  if (
    row.project_id !== metadata.project_id ||
    row.id !== metadata.scope_id
  ) {
    throw new Error(`Archive ${metadata.id} session scope does not match metadata`);
  }

  const legacyPayload = parseJsonObject(row.payload_json);
  const canonicalPayloadJson = JSON.stringify({
    ...legacyPayload,
    dispatchGroupId:
      typeof legacyPayload.dispatchGroupId === "string" &&
        legacyPayload.dispatchGroupId.length > 0
        ? legacyPayload.dispatchGroupId
        : row.id,
    requestedByUserId: row.requested_by_user_id,
  });
  const payload = decodeStoredTeamAgentSessionPayload(canonicalPayloadJson);
  const canonicalRow = decodeArchivedProjectAgentSession({
    ...row,
    payload_json: encodeStoredTeamAgentSessionPayload(payload),
  });
  return [
    JSON.stringify(manifest),
    JSON.stringify({ recordType: record.recordType, data: canonicalRow }),
    "",
  ].join("\n");
}

const canonicalObjectKey = (objectKey: string, objectSha256: string) => {
  if (!objectKey.endsWith(".jsonl.gz")) {
    throw new Error(`Archive object key is not JSONL gzip: ${objectKey}`);
  }
  return `${objectKey.slice(0, -".jsonl.gz".length)}` +
    `${canonicalObjectMarker}${objectSha256}.jsonl.gz`;
};

const verifyObject = async (
  bucket: ArchiveBucket,
  key: string,
  byteSize: number,
  objectSha256: string,
  contentSha256: string,
) => {
  const object = await bucket.head(key);
  if (
    !object ||
    object.size !== byteSize ||
    object.customMetadata?.sha256 !== objectSha256 ||
    object.customMetadata?.contentSha256 !== contentSha256
  ) {
    throw new Error(`R2 checksum verification failed for ${key}`);
  }
};

async function portArchive(
  db: D1Database,
  bucket: ArchiveBucket,
  metadata: ArchiveMetadataRow,
  observedAt: string,
) {
  const object = await bucket.get(metadata.object_key);
  if (!object) throw new Error(`Archive object ${metadata.object_key} is missing`);
  const compressed = await new Response(object.body).arrayBuffer();
  if (
    compressed.byteLength !== metadata.byte_size ||
    await sha256(compressed) !== metadata.sha256
  ) {
    throw new Error(`Archive object ${metadata.object_key} failed D1 checksum validation`);
  }

  const content = await gunzip(compressed);
  if (
    encoder.encode(content).byteLength > maxArchiveBytes ||
    await sha256(encoder.encode(content)) !== metadata.content_sha256
  ) {
    throw new Error(`Archive content ${metadata.object_key} failed checksum validation`);
  }

  const canonicalContent = canonicalizeProjectAgentSessionArchive(
    content,
    metadata,
  );
  const canonicalCompressed = await gzip(canonicalContent);
  const contentSha256 = await sha256(encoder.encode(canonicalContent));
  const objectSha256 = await sha256(canonicalCompressed);
  const objectKey = canonicalObjectKey(metadata.object_key, objectSha256);

  const existing = await bucket.head(objectKey);
  if (!existing) {
    await bucket.put(objectKey, canonicalCompressed, {
      httpMetadata: {
        contentType: "application/x-ndjson",
        contentEncoding: "gzip",
      },
      customMetadata: {
        archiveId: metadata.id,
        formatVersion: String(archiveFormatVersion),
        contentSha256,
        sha256: objectSha256,
      },
      sha256: objectSha256,
      storageClass: "InfrequentAccess",
    });
  }
  await verifyObject(
    bucket,
    objectKey,
    canonicalCompressed.byteLength,
    objectSha256,
    contentSha256,
  );

  const results = await db.batch([
    db.prepare(
      `update briar_log_archives
       set object_key = ?, byte_size = ?, sha256 = ?, content_sha256 = ?,
           last_error = null
       where id = ? and object_key = ? and sha256 = ? and content_sha256 = ?`,
    ).bind(
      objectKey,
      canonicalCompressed.byteLength,
      objectSha256,
      contentSha256,
      metadata.id,
      metadata.object_key,
      metadata.sha256,
      metadata.content_sha256,
    ),
    db.prepare(
      `insert into briar_archive_cleanup_queue (
         bucket, object_key, project_id, run_id, queued_at
       ) values ('archives', ?, ?, ?, ?)
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
    ).bind(
      metadata.object_key,
      metadata.project_id,
      metadata.run_id,
      observedAt,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const referenced = await db.prepare(
      `select 1 from briar_log_archives where object_key = ?`,
    ).bind(objectKey).first();
    if (!referenced) await bucket.delete(objectKey);
    throw new Error(`Archive ${metadata.id} changed during canonicalization`);
  }
}

export type ArchiveStorageBackfillResult = {
  processed: number;
  remaining: number;
};

export async function backfillProjectAgentSessionArchives(
  db: D1Database,
  bucket: ArchiveBucket,
  options: { limit?: number; observedAt?: string } = {},
): Promise<ArchiveStorageBackfillResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 24));
  const observedAt = options.observedAt ?? new Date().toISOString();
  const pending = await db.prepare(
    `select * from briar_log_archives
     where archive_kind = 'project_agent_sessions'
       and status in ('verified', 'complete')
       and instr(object_key, ?) = 0
     order by created_at, id limit ?`,
  ).bind(canonicalObjectMarker, limit).all<ArchiveMetadataRow>();

  let processed = 0;
  for (const metadata of pending.results ?? []) {
    await portArchive(db, bucket, metadata, observedAt);
    processed += 1;
  }
  const remaining = await db.prepare(
    `select count(*) as count from briar_log_archives
     where archive_kind = 'project_agent_sessions'
       and status in ('verified', 'complete')
       and instr(object_key, ?) = 0`,
  ).bind(canonicalObjectMarker).first<number>("count");
  return { processed, remaining: remaining ?? 0 };
}

