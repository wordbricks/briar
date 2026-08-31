import { sha256 } from "./crypto-digest";

export type UploadPurpose =
  | "issue_reply"
  | "channel_reply"
  | "run_evidence"
  | "channel_message"
  | "issue_create"
  | "issue_update"
  | "issue_message";

export type UploadScope = {
  purpose: UploadPurpose;
  organizationId: string;
  projectId: string | null;
  channelId: string | null;
  userId: string | null;
  workId: string | null;
  runId: string | null;
  workerId: string | null;
  deviceId: string | null;
  claimTokenHash: string | null;
};

export type UploadMetadata = {
  clientId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: Uint8Array;
};

export type UploadBatchRow = {
  request_id: string;
  purpose: UploadPurpose;
  organization_id: string;
  project_id: string | null;
  channel_id: string | null;
  user_id: string | null;
  work_id: string | null;
  run_id: string | null;
  worker_id: string | null;
  device_id: string | null;
  claim_token_hash: string | null;
  metadata_hash: string;
  file_count: number;
  creation_nonce: string;
  expires_at: string;
  created_at: string;
};

export type UploadRow = {
  upload_id: string;
  batch_request_id: string;
  client_id: string;
  position: number;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: ArrayBuffer;
  object_key: string;
  uploaded_at: string | null;
  consumed_at: string | null;
  consumer_kind: string | null;
  consumer_id: string | null;
};

export type ScopedUploadRow = UploadRow & {
  purpose: UploadPurpose;
  organization_id: string;
  project_id: string | null;
  channel_id: string | null;
  user_id: string | null;
  work_id: string | null;
  run_id: string | null;
  worker_id: string | null;
  device_id: string | null;
  claim_token_hash: string | null;
  expires_at: string;
};

const bytesToHex = (value: Uint8Array) =>
  [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function uploadMetadataHash(files: readonly UploadMetadata[]) {
  return sha256(
    JSON.stringify(
      files.map((file) => ({
        clientId: file.clientId,
        filename: file.filename,
        contentType: file.contentType,
        byteSize: file.byteSize,
        sha256: bytesToHex(file.sha256),
      })),
    ),
  );
}

const sameNullable = (left: string | null, right: string | null) => left === right;

const batchMatches = (
  row: UploadBatchRow,
  input: UploadScope & {
    requestId: string;
    metadataHash: string;
    fileCount: number;
  },
) =>
  row.request_id === input.requestId &&
  row.purpose === input.purpose &&
  row.organization_id === input.organizationId &&
  sameNullable(row.project_id, input.projectId) &&
  sameNullable(row.channel_id, input.channelId) &&
  sameNullable(row.user_id, input.userId) &&
  sameNullable(row.work_id, input.workId) &&
  sameNullable(row.run_id, input.runId) &&
  sameNullable(row.worker_id, input.workerId) &&
  sameNullable(row.device_id, input.deviceId) &&
  sameNullable(row.claim_token_hash, input.claimTokenHash) &&
  row.metadata_hash === input.metadataHash &&
  row.file_count === input.fileCount;

export async function prepareUploadRows(
  db: D1Database,
  input: UploadScope & {
    requestId: string;
    files: readonly UploadMetadata[];
    createdAt: string;
    expiresAt: string;
  },
) {
  const metadataHash = await uploadMetadataHash(input.files);
  const prepared = input.files.map((file, position) => {
    const uploadId = crypto.randomUUID();
    return {
      ...file,
      position,
      uploadId,
      objectKey: `uploads/${input.purpose}/${input.organizationId}/${input.requestId}/${uploadId}`,
    };
  });
  const creationNonce = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_upload_batches (
         request_id, purpose, organization_id, project_id, channel_id, user_id,
         work_id, run_id, worker_id, device_id, claim_token_hash,
         metadata_hash, file_count, creation_nonce, expires_at, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (request_id) do nothing
       returning *`,
      )
      .bind(
        input.requestId,
        input.purpose,
        input.organizationId,
        input.projectId,
        input.channelId,
        input.userId,
        input.workId,
        input.runId,
        input.workerId,
        input.deviceId,
        input.claimTokenHash,
        metadataHash,
        prepared.length,
        creationNonce,
        input.expiresAt,
        input.createdAt,
      ),
    ...prepared.map((file) =>
      db
        .prepare(
          `insert into briar_uploads (
         upload_id, batch_request_id, client_id, position, filename,
         content_type, byte_size, sha256, object_key
       )
       select ?, batch.request_id, ?, ?, ?, ?, ?, ?, ?
       from briar_upload_batches batch
       where batch.request_id = ? and batch.creation_nonce = ?
       on conflict do nothing
       returning *`,
        )
        .bind(
          file.uploadId,
          file.clientId,
          file.position,
          file.filename,
          file.contentType,
          file.byteSize,
          file.sha256,
          file.objectKey,
          input.requestId,
          creationNonce,
        ),
    ),
  ]);
  const insertedBatch = results[0]?.results[0] as UploadBatchRow | undefined;
  const batch =
    insertedBatch ??
    (await db
      .prepare(`select * from briar_upload_batches where request_id = ?`)
      .bind(input.requestId)
      .first<UploadBatchRow>());
  if (
    !batch ||
    !batchMatches(batch, {
      ...input,
      metadataHash,
      fileCount: prepared.length,
    })
  )
    return null;
  const uploads = await db
    .prepare(
      `select * from briar_uploads
     where batch_request_id = ? order by position, upload_id`,
    )
    .bind(input.requestId)
    .all<UploadRow>();
  if (uploads.results.length !== prepared.length) {
    throw new Error("Upload batch was not stored atomically");
  }
  const byClientId = new Map(uploads.results.map((upload) => [upload.client_id, upload]));
  const ordered = input.files.map((file) => byClientId.get(file.clientId));
  if (ordered.some((upload) => upload === undefined)) return null;
  return {
    replayed: insertedBatch === undefined,
    batch,
    uploads: ordered as UploadRow[],
  };
}

export async function getScopedUpload(db: D1Database, uploadId: string) {
  return db
    .prepare(
      `select upload.*, batch.purpose, batch.organization_id,
            batch.project_id, batch.channel_id, batch.user_id, batch.work_id,
            batch.run_id, batch.worker_id, batch.device_id,
            batch.claim_token_hash, batch.expires_at
     from briar_uploads upload
     join briar_upload_batches batch
       on batch.request_id = upload.batch_request_id
     where upload.upload_id = ?`,
    )
    .bind(uploadId)
    .first<ScopedUploadRow>();
}

export async function markUploadStored(db: D1Database, uploadId: string, observedAt: string) {
  return db
    .prepare(
      `update briar_uploads as upload
     set uploaded_at = ?
     where upload.upload_id = ? and upload.uploaded_at is null
       and upload.consumed_at is null
       and exists (
         select 1 from briar_upload_batches batch
         where batch.request_id = upload.batch_request_id
           and batch.expires_at > ?
       )
     returning *`,
    )
    .bind(observedAt, uploadId, observedAt)
    .first<UploadRow>();
}

const scopeSql = `batch.purpose = ? and batch.organization_id = ?
  and batch.project_id is ? and batch.channel_id is ? and batch.user_id is ?
  and batch.work_id is ? and batch.run_id is ? and batch.worker_id is ?
  and batch.device_id is ?
  and batch.claim_token_hash is ?`;

const scopeBindings = (scope: UploadScope) => [
  scope.purpose,
  scope.organizationId,
  scope.projectId,
  scope.channelId,
  scope.userId,
  scope.workId,
  scope.runId,
  scope.workerId,
  scope.deviceId,
  scope.claimTokenHash,
];

export async function resolveAvailableUploads(
  db: D1Database,
  input: UploadScope & { uploadIds: readonly string[]; observedAt: string },
) {
  if (input.uploadIds.length === 0) return [];
  if (new Set(input.uploadIds).size !== input.uploadIds.length) return null;
  const placeholders = input.uploadIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `select upload.*, batch.purpose, batch.organization_id,
            batch.project_id, batch.channel_id, batch.user_id, batch.work_id,
            batch.run_id, batch.worker_id, batch.device_id,
            batch.claim_token_hash, batch.expires_at
     from briar_uploads upload
     join briar_upload_batches batch
       on batch.request_id = upload.batch_request_id
     where upload.upload_id in (${placeholders})
       and ${scopeSql} and batch.expires_at > ?
       and upload.uploaded_at is not null and upload.consumed_at is null`,
    )
    .bind(...input.uploadIds, ...scopeBindings(input), input.observedAt)
    .all<ScopedUploadRow>();
  const byId = new Map(result.results.map((upload) => [upload.upload_id, upload]));
  const ordered = input.uploadIds.map((id) => byId.get(id));
  return ordered.some((upload) => upload === undefined) ? null : (ordered as ScopedUploadRow[]);
}

export const uploadAvailabilityGuard = (
  input: UploadScope & { uploadIds: readonly string[]; observedAt: string },
) => {
  if (input.uploadIds.length === 0) {
    return { sql: "", bindings: [] as unknown[] };
  }
  const placeholders = input.uploadIds.map(() => "?").join(", ");
  return {
    sql: `and (
      select count(*)
      from briar_uploads upload
      join briar_upload_batches batch
        on batch.request_id = upload.batch_request_id
      where upload.upload_id in (${placeholders})
        and ${scopeSql} and batch.expires_at > ?
        and upload.uploaded_at is not null and upload.consumed_at is null
    ) = ?`,
    bindings: [
      ...input.uploadIds,
      ...scopeBindings(input),
      input.observedAt,
      input.uploadIds.length,
    ],
  };
};

export function consumeUploadStatements(
  db: D1Database,
  input: UploadScope & {
    uploadIds: readonly string[];
    consumerKind:
      | "reply_completion"
      | "run_evidence"
      | "channel_message"
      | "issue_create"
      | "issue_update"
      | "issue_message";
    consumerId: string;
    consumedAt: string;
  },
) {
  return input.uploadIds.map((uploadId) =>
    db
      .prepare(
        `update briar_uploads as upload
     set consumed_at = ?, consumer_kind = ?, consumer_id = ?
     where upload.upload_id = ? and upload.uploaded_at is not null
       and upload.consumed_at is null
       and exists (
         select 1 from briar_upload_batches batch
         where batch.request_id = upload.batch_request_id
           and ${scopeSql} and batch.expires_at > ?
       )
     returning upload_id`,
      )
      .bind(
        input.consumedAt,
        input.consumerKind,
        input.consumerId,
        uploadId,
        ...scopeBindings(input),
        input.consumedAt,
      ),
  );
}

/**
 * Relinquishes every unconsumed object in a prepared batch. The database
 * trigger records each object in the durable cleanup queue before its upload
 * row can be deleted, so a queue-write failure rolls back the whole D1 batch.
 */
export async function abandonUploadBatch(
  db: D1Database,
  batchRequestId: string,
) {
  const results = await db.batch([
    db
      .prepare(
        `delete from briar_uploads
         where batch_request_id = ? and consumed_at is null
         returning upload_id`,
      )
      .bind(batchRequestId),
    db
      .prepare(
        `delete from briar_upload_batches
         where request_id = ?
           and not exists (
             select 1 from briar_uploads upload
             where upload.batch_request_id = briar_upload_batches.request_id
           )
         returning request_id`,
      )
      .bind(batchRequestId),
  ]);
  return results[0]?.results.length ?? 0;
}

export async function enqueueExpiredUploadCleanup(db: D1Database, observedAt: string, limit = 100) {
  const uploads = await db
    .prepare(
      `select upload.upload_id, upload.batch_request_id
     from briar_uploads upload
     join briar_upload_batches batch
       on batch.request_id = upload.batch_request_id
     where batch.expires_at <= ? and upload.consumed_at is null
     order by batch.expires_at, batch.request_id, upload.upload_id
     limit ?`,
    )
    .bind(observedAt, limit)
    .all<{
      upload_id: string;
      batch_request_id: string;
    }>();
  if (uploads.results.length === 0) return 0;
  const statements: D1PreparedStatement[] = [];
  for (const upload of uploads.results) {
    statements.push(
      db
        .prepare(
          `insert into briar_upload_cleanup_queue (
           object_key, batch_request_id, queued_at, next_attempt_at
         )
         select upload.object_key, upload.batch_request_id, ?, ?
         from briar_uploads upload
         join briar_upload_batches batch
           on batch.request_id = upload.batch_request_id
         where upload.upload_id = ? and upload.consumed_at is null
           and batch.expires_at <= ?
         on conflict (object_key) do nothing`,
        )
        .bind(observedAt, observedAt, upload.upload_id, observedAt),
      db
        .prepare(
          `delete from briar_uploads
         where upload_id = ? and consumed_at is null
           and exists (
             select 1 from briar_upload_batches batch
             where batch.request_id = briar_uploads.batch_request_id
               and batch.expires_at <= ?
           )
         returning upload_id`,
        )
        .bind(upload.upload_id, observedAt),
      db
        .prepare(
          `delete from briar_upload_batches
         where request_id = ?
           and not exists (
             select 1 from briar_uploads upload
             where upload.batch_request_id = briar_upload_batches.request_id
           )`,
        )
        .bind(upload.batch_request_id),
    );
  }
  const results = await db.batch(statements);
  return results
    .filter((_, index) => index % 3 === 1)
    .reduce((total, result) => total + result.results.length, 0);
}

export type UploadCleanupRow = {
  object_key: string;
  batch_request_id: string;
  attempts: number;
  generation: number;
  queued_at: string;
  next_attempt_at: string;
  last_error: string | null;
};

export async function enqueueUploadObjectCleanup(
  db: D1Database,
  input: { objectKey: string; batchRequestId: string; observedAt: string },
) {
  return db
    .prepare(
      `insert into briar_upload_cleanup_queue (
       object_key, batch_request_id, queued_at, next_attempt_at
     ) values (?, ?, ?, ?)
     on conflict (object_key) do nothing
     returning object_key`,
    )
    .bind(input.objectKey, input.batchRequestId, input.observedAt, input.observedAt)
    .first<{ object_key: string }>();
}

const cleanupRetryAt = (observedAt: string, attempts: number) => {
  const base = Math.min(60 * 60_000, 2 ** Math.min(attempts, 10) * 1_000);
  return new Date(Date.parse(observedAt) + base).toISOString();
};

export async function processUploadCleanupQueue(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  observedAt: string,
  limit = 100,
) {
  const due = await db
    .prepare(
      `select * from briar_upload_cleanup_queue
     where next_attempt_at <= ?
     order by next_attempt_at, attempts, queued_at, object_key
     limit ?`,
    )
    .bind(observedAt, limit)
    .all<UploadCleanupRow>();
  let deleted = 0;
  let failed = 0;
  for (const item of due.results) {
    try {
      await bucket.delete(item.object_key);
      const removed = await db
        .prepare(
          `delete from briar_upload_cleanup_queue
         where object_key = ? and generation = ?
         returning object_key`,
        )
        .bind(item.object_key, item.generation)
        .first<{ object_key: string }>();
      if (removed) deleted += 1;
    } catch (error) {
      const nextAttempts = item.attempts + 1;
      await db
        .prepare(
          `update briar_upload_cleanup_queue
         set attempts = ?, generation = generation + 1,
             next_attempt_at = ?, last_error = ?
         where object_key = ? and generation = ?`,
        )
        .bind(
          nextAttempts,
          cleanupRetryAt(observedAt, nextAttempts),
          (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
          item.object_key,
          item.generation,
        )
        .run();
      failed += 1;
    }
  }
  return { processed: due.results.length, deleted, failed };
}

export async function maintainUploadCleanup(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  observedAt: string,
) {
  const enqueuedUploads = await enqueueExpiredUploadCleanup(db, observedAt);
  return {
    enqueuedUploads,
    ...(await processUploadCleanupQueue(db, bucket, observedAt)),
  };
}
